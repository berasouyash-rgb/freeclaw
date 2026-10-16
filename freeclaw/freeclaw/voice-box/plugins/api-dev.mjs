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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Load .env then .env.local into process.env (.env.local wins over .env,
 *  real process env wins over both). Mirrors how Vercel injects env vars
 *  for serverless functions so the API sees the same config locally. */
const _originalEnv = new Set(Object.keys(process.env));
function loadEnvFiles(root) {
	for (const file of [".env", ".env.local"]) {
		const p = join(root, file);
		if (!existsSync(p)) continue;
		let raw = "";
		try {
			raw = readFileSync(p, "utf8");
		} catch {
			continue;
		}
		for (const line of raw.split(/\r?\n/)) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const eq = t.indexOf("=");
			if (eq <= 0) continue;
			const key = t.slice(0, eq).trim();
			if (_originalEnv.has(key)) continue; // real env wins over files
			let value = t.slice(eq + 1).trim();
			// Strip matching quotes ("..." or '...')
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			process.env[key] = value;
		}
	}
}

/** Vercel runtime shims applied to a Node http request/response pair.
 *  Consumes the raw request stream for non-GET methods and attaches a parsed
 *  `req.body` object, mirroring Vercel's pre-parsed body so api/index.js's
 *  parseBody() short-circuits instead of defaulting to {}. */
async function shim(req, res) {
	// req.query — Express-style search-params object (handlers read it directly)
	if (!req.query) {
		const u = new URL(req.url || "/", "http://localhost");
		const q = {};
		for (const key of u.searchParams.keys()) {
			const all = u.searchParams.getAll(key);
			q[key] = all.length > 1 ? all : all[0];
		}
		req.query = q;
	}
	// req.body — read the raw stream when the method carries a payload
	if (
		!req.body &&
		req.method !== "GET" &&
		req.method !== "HEAD" &&
		req.method !== "OPTIONS"
	) {
		try {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const raw = Buffer.concat(chunks).toString("utf8");
			if (raw) {
				try {
					req.body = JSON.parse(raw);
				} catch {
					try {
						req.body = Object.fromEntries(new URLSearchParams(raw));
					} catch {
						req.body = {};
					}
				}
			} else {
				req.body = {};
			}
		} catch {
			req.body = {};
		}
	}
	// res.status(code).json(obj) — chainable Express-style response helpers
	if (!res.status) {
		res.status = (code) => {
			res.statusCode = code;
			return res;
		};
	}
	if (!res.json) {
		res.json = (obj) => {
			if (!res.getHeader("Content-Type")) {
				res.setHeader("Content-Type", "application/json; charset=utf-8");
			}
			return res.end(JSON.stringify(obj));
		};
	}
	return { req, res };
}

export function apiDev() {
	let handler = null;
	let loadError = null;

	async function ensureHandler(root) {
		if (handler || loadError) return;
		loadEnvFiles(root);
		try {
			const mod = await import(
				pathToFileURL(join(root, "api", "index.js")).href +
					`?api-dev=${Date.now()}`
			);
			handler = mod.default;
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
			startDevPatrol();
			server.middlewares.use((req, res, next) => {
				const url = req.url || "";
				if (!url.startsWith("/api/")) return next();

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
