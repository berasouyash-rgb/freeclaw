// ═══════════════════════════════════════════════════════════════════════════
// Vercel-runtime shim shared by every local host of the consolidated API.
//
// `api/index.js` is written against the Vercel Node runtime: it expects a
// pre-parsed `req.body`, an Express-style `req.query`, and chainable
// `res.status()/res.json()` helpers. Anything that serves the API locally must
// provide exactly that surface, or local behaviour stops predicting production.
//
// Two hosts use this module:
//   - plugins/api-dev.mjs  → mounts the API inside the Vite dev server so
//                            `npm run dev` is full-stack.
//   - scripts/api-server.mjs → mounts ONLY the API on its own port, which is
//                            what load/soak runs use (no bundler in the
//                            process, so it fits in a small machine's RAM).
//
// Keeping one implementation means the two hosts cannot drift apart.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Load .env then .env.local into process.env (.env.local wins over .env,
 *  real process env wins over both). Mirrors how Vercel injects env vars
 *  for serverless functions so the API sees the same config locally. */
export function loadEnvFiles(root) {
	const originalEnv = new Set(Object.keys(process.env));
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
			if (originalEnv.has(key)) continue; // real env wins over files
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
export async function shim(req, res) {
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
