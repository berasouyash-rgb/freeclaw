#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Production-shaped local server.
//
// `vite` (dev) and `vite preview` are NOT valid capacity targets: the dev
// server runs every request through a middleware chain built for HMR, and
// neither exposes the knobs that decide whether a real deployment survives a
// connection burst (listen backlog, keep-alive timeout, worker count). Load
// numbers taken against them are measuring the wrong thing.
//
// This server serves the built `dist/` and mounts the same consolidated
// Vercel function (`api/index.js`) that ships to production, across a cluster
// of workers — one Node process per core — so an in-memory admission guard
// (MAX_INFLIGHT) and a DB pool (DB_MAX_CONCURRENCY) exist PER WORKER, which is
// also how Vercel scales (one instance per concurrent invocation group).
//
// Usage:
//   node scripts/serve-prod.mjs                 # PORT=3000, all cores
//   PORT=4001 WEB_CONCURRENCY=4 node scripts/serve-prod.mjs
//
// Env:
//   PORT                  listen port              (default 3000)
//   HOST                  bind address             (default 127.0.0.1)
//   WEB_CONCURRENCY       worker processes         (default: all cores)
//   LISTEN_BACKLOG        listen(2) backlog        (default 65535)
//   KEEP_ALIVE_TIMEOUT_MS server keep-alive        (default 65000)
// ═══════════════════════════════════════════════════════════════════════════

import cluster from "node:cluster";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { availableParallelism } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");

// ─── Env loading (identical contract to plugins/api-dev.mjs) ────────────────
// `.env` then `.env.local`; a real process env var always wins over a file.
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
			if (_originalEnv.has(key)) continue;
			let value = t.slice(eq + 1).trim();
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

const PORT = Number.parseInt(process.env.PORT || "", 10) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const BACKLOG = Number.parseInt(process.env.LISTEN_BACKLOG || "", 10) || 65535;
const KEEP_ALIVE_TIMEOUT_MS =
	Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT_MS || "", 10) || 65_000;
const WORKERS = (() => {
	const raw = Number.parseInt(process.env.WEB_CONCURRENCY || "", 10);
	if (Number.isFinite(raw) && raw > 0) return raw;
	return Math.max(1, availableParallelism());
})();

// ─── Vercel request/response shim ───────────────────────────────────────────
// Mirrors plugins/api-dev.mjs: handlers rely on req.query, a pre-parsed
// req.body, and chainable res.status()/res.json(). Everything else (CORS,
// security headers, the 404/405 contract, error wrapping) is api/index.js.
async function shim(req, res) {
	if (!req.query) {
		const u = new URL(req.url || "/", "http://localhost");
		const q = {};
		for (const key of u.searchParams.keys()) {
			const all = u.searchParams.getAll(key);
			q[key] = all.length > 1 ? all : all[0];
		}
		req.query = q;
	}
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

// ─── Static file serving ────────────────────────────────────────────────────
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".eot": "application/vnd.ms-fontobject",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".wasm": "application/wasm",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".pdf": "application/pdf",
};

function sendFile(req, res, filePath, statusCode = 200) {
	let stat;
	try {
		stat = statSync(filePath);
	} catch {
		return false;
	}
	if (!stat.isFile()) return false;

	const ext = extname(filePath).toLowerCase();
	const type = MIME[ext] || "application/octet-stream";
	const immutable = filePath.startsWith(join(DIST, "assets") + sep);
	res.statusCode = statusCode;
	res.setHeader("Content-Type", type);
	res.setHeader("Content-Length", stat.size);
	res.setHeader(
		"Cache-Control",
		immutable
			? "public, max-age=31536000, immutable"
			: ext === ".html"
				? "no-cache"
				: "public, max-age=3600",
	);
	if (req.method === "HEAD") {
		res.end();
		return true;
	}
	createReadStream(filePath)
		.on("error", () => {
			if (!res.writableEnded) res.destroy();
		})
		.pipe(res);
	return true;
}

function serveStatic(req, res, pathname) {
	if (!existsSync(DIST)) return false;

	// Decode + normalise, then prove the result is still inside DIST.
	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return false;
	}
	const rel = normalize(decoded).replace(/^([/\\])+/, "");
	const candidate = resolve(DIST, rel);
	if (candidate !== DIST && !candidate.startsWith(DIST + sep)) return false;

	// Real file?
	if (rel && sendFile(req, res, candidate)) return true;

	// Directory index (e.g. /admin/ → /admin/index.html)
	if (rel && !extname(rel)) {
		const indexPath = resolve(DIST, rel, "index.html");
		if (indexPath.startsWith(DIST + sep) && sendFile(req, res, indexPath)) {
			return true;
		}
	}

	// SPA fallback: only for navigation requests, never for asset-looking
	// paths (a missing .js must 404, not return HTML with a JS content-type).
	const looksLikeFile = extname(rel) !== "";
	const acceptsHtml = String(req.headers.accept || "").includes("text/html");
	if (!looksLikeFile && (acceptsHtml || rel === "")) {
		return sendFile(req, res, join(DIST, "index.html"));
	}
	return false;
}

// ─── Worker ─────────────────────────────────────────────────────────────────
async function startWorker() {
	loadEnvFiles(ROOT);

	let handler = null;
	let loadError = null;
	try {
		const mod = await import(pathToFileURL(join(ROOT, "api", "index.js")).href);
		handler = mod.default;
		console.log(`[serve-prod:${process.pid}] mounted api/index.js`);
	} catch (err) {
		loadError = err;
		console.error(
			`[serve-prod:${process.pid}] failed to load api/index.js:`,
			err?.message || err,
		);
	}

	const server = createServer(async (req, res) => {
		const rawUrl = req.url || "/";
		const pathname = rawUrl.split("?")[0];

		if (pathname === "/api" || pathname.startsWith("/api/")) {
			if (!handler) {
				res.statusCode = 500;
				res.setHeader("Content-Type", "application/json; charset=utf-8");
				res.end(
					JSON.stringify({
						error: "api/index.js failed to load",
						detail: loadError?.message || "unknown",
					}),
				);
				return;
			}
			try {
				await shim(req, res);
				await handler(req, res);
			} catch (err) {
				if (res.writableEnded) return;
				res.statusCode = 500;
				res.setHeader("Content-Type", "application/json; charset=utf-8");
				res.end(
					JSON.stringify({ error: "API error: " + (err?.message || String(err)) }),
				);
			}
			return;
		}

		if (serveStatic(req, res, pathname)) return;

		res.statusCode = 404;
		res.setHeader("Content-Type", "text/plain; charset=utf-8");
		res.end("Not found");
	});

	// Defaults that decide whether a burst survives. Node's default
	// keep-alive timeout is 5s, which closes pooled client sockets mid-flight
	// and surfaces as ECONNRESET/EPIPE on a perfectly healthy server.
	server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
	server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000;
	server.requestTimeout = 120_000;
	server.maxRequestsPerSocket = 0;

	server.on("clientError", (err, socket) => {
		if (socket.writable && !socket.destroyed) {
			socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
		}
	});

	server.on("error", (err) => {
		console.error(`[serve-prod:${process.pid}] server error:`, err?.message || err);
	});

	server.listen({ port: PORT, host: HOST, backlog: BACKLOG }, () => {
		console.log(
			`[serve-prod:${process.pid}] listening on http://${HOST}:${PORT} (backlog ${BACKLOG})`,
		);
	});

	const shutdown = (signal) => {
		console.log(`[serve-prod:${process.pid}] ${signal} — closing`);
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 5_000).unref();
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Primary ────────────────────────────────────────────────────────────────
if (cluster.isPrimary) {
	console.log(
		`[serve-prod] primary ${process.pid} — ${WORKERS} worker(s) on ${HOST}:${PORT}`,
	);
	for (let i = 0; i < WORKERS; i += 1) cluster.fork();

	cluster.on("exit", (worker, code, signal) => {
		console.error(
			`[serve-prod] worker ${worker.process.pid} exited (code ${code}, signal ${signal}) — respawning`,
		);
		// A crash-loop would otherwise fork forever with no backoff.
		setTimeout(() => cluster.fork(), 500).unref();
	});

	const shutdownAll = (signal) => {
		console.log(`[serve-prod] ${signal} — stopping workers`);
		for (const worker of Object.values(cluster.workers || {})) {
			worker?.kill(signal);
		}
		setTimeout(() => process.exit(0), 5_000).unref();
	};
	process.on("SIGINT", () => shutdownAll("SIGINT"));
	process.on("SIGTERM", () => shutdownAll("SIGTERM"));
} else {
	startWorker();
}
