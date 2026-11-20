// ═══════════════════════════════════════════════════════════════════════════
// Local full-stack dev adapter for the Vercel serverless API.
//
// The app's entire backend lives in one consolidated Vercel function
// (api/index.js, rewritten from /api/* by vercel.json). `vite` alone does not
// serve it — historically every /api call 404'd under `npm run dev`, forcing
// developers to use `vercel dev` or deploy to see real data.
//
// This plugin mounts api/index.js directly inside the Vite dev server and
// shims the small Vercel-runtime surface the handlers rely on:
//   req.query              → parsed URL search params
//   res.status(code)       → chainable status setter
//   res.json(obj)          → JSON body terminator
// Everything else (req.body streaming parse, CORS, security headers, the
// 404/405 contract, error wrapper) is already handled by api/index.js itself.
// ═══════════════════════════════════════════════════════════════════════════

import { watch } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvFiles, shim } from "./vercel-shim.mjs";

export function apiDev() {
	let handler = null;
	let loadError = null;

	async function ensureHandler(root) {
		if (handler) return;
		loadEnvFiles(root);
		try {
			const mod = await import(
				pathToFileURL(join(root, "api", "index.js")).href +
					`?api-dev=${Date.now()}`
			);
			handler = mod.default;
			loadError = null;
			console.log("[api-dev] Mounted api/index.js on /api/* (full-stack dev)");
		} catch (err) {
			loadError = err;
			console.error(
				"[api-dev] Failed to load api/index.js:",
				err?.message || err,
			);
		}
	}

	return {
		name: "voicebox-api-dev",
		apply: "serve", // dev-server only — never in build
		async configureServer(server) {
			await ensureHandler(server.config.root);
			// The router used to be cached for the whole dev session, so a new
			// endpoint added while the server was running returned 404 until
			// someone restarted Vite. Invalidate on any api/ change instead.
			try {
				watch(join(server.config.root, "api"), { recursive: true }, () => {
					handler = null;
					loadError = null;
					console.log("[api-dev] API files changed — router reloads on next request");
				});
			} catch {
				/* platforms without recursive watch keep the old behaviour */
			}
			startDevPatrol();
			server.middlewares.use(async (req, res, next) => {
				const rawUrl = req.url || "";
				const pathname = rawUrl.split("?")[0];
				if (pathname !== "/api" && !pathname.startsWith("/api/")) return next();

				if (!handler) {
					await ensureHandler(server.config.root);
				}

				if (!handler) {
					res.statusCode = 500;
					res.setHeader("Content-Type", "application/json; charset=utf-8");
					return res.end(
						JSON.stringify({
							error: "api/index.js failed to load locally",
							detail: loadError?.message || "unknown",
						}),
					);
				}

				shim(req, res).then(() => {
					// Let the consolidated handler do everything (route dispatch, body
					// parsing, CORS, security, error wrapper). Guard the promise so a
					// thrown async error still produces a JSON 500 instead of a hang.
					Promise.resolve()
						.then(() => handler(req, res))
						.catch((err) => {
							if (res.writableEnded) return;
							res.statusCode = 500;
							res.setHeader("Content-Type", "application/json; charset=utf-8");
							res.end(
								JSON.stringify({
									error: "Local API error: " + (err?.message || String(err)),
								}),
							);
						});
				});
			});
		},
	};
}

// ─── Dev-only autonomous patrol ─────────────────────────────────────
// Production drives the hidden workforce via the Vercel cron (agent-cron).
// Locally there is NO cron, so without this the Ops Center stays frozen at
// its last manual "Run patrol" — the workforce looks dead. Spawn a light-
// weight interval that runs the REAL patrol (api/_workforce.js, same instance
// the API routes use) on a schedule: default every 10 minutes, override with
// DEV_PATROL_INTERVAL_MS (0 disables, values < 60s clamp to 60s). The patrol
// respects the kill switch (paused/stop/maintenance), so this can't fight an
// admin decision. apply:'serve' already guarantees this never ships in build.
let _devPatrolStarted = false;
let _devPatrolRunning = false;
function startDevPatrol() {
	if (_devPatrolStarted) return;
	const raw = process.env.DEV_PATROL_INTERVAL_MS;
	if (raw === "0") return; // explicitly disabled
	_devPatrolStarted = true;
	const intervalMs = Math.max(60_000, Number(raw || 600_000) || 600_000);

	const run = async () => {
		// Overlap guard: agents may take minutes (LLM provider timeouts) — skip a
		// tick if the previous patrol is still running instead of piling up.
		if (_devPatrolRunning) return;
		_devPatrolRunning = true;
		try {
			const { patrol } = await import("../api/_workforce.js");
			const res = await patrol({ limit: 3 });
			console.log(
				`[dev-patrol] ${res?.executed ?? 0} agent(s) executed, ${res?.failed ?? 0} failed`,
			);
		} catch (err) {
			console.warn("[dev-patrol] failed:", err?.message || err);
		} finally {
			_devPatrolRunning = false;
		}
	};

	// First run shortly after boot (API + DB warm), then on the interval.
	setTimeout(run, 45_000);
	const timer = setInterval(run, intervalMs);
	if (timer.unref) timer.unref(); // never hold the dev process open
}
