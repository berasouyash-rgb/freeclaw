// ═══════════════════════════════════════════════════════════════════════════
// API-only local host — the same consolidated handler production serves,
// with nothing else in the process.
//
// Why this exists: soak/load runs need the real backend, but `npm run dev`
// carries the whole Vite bundler in the same process. On a 16 GB machine with
// a few GB free, Vite + Node cannot reserve V8 zones and the server aborts
// mid-run with "Zone Allocation failed - process out of memory" (exit 134),
// which shows up in a load test as a burst of ECONNREFUSED — indistinguishable
// from a backend failure unless you read the log.
//
// This host mounts `api/index.js` exactly as plugins/api-dev.mjs does, using
// the SAME shim module, so request handling is identical to `npm run dev`.
// The only differences are the absent bundler and the parked dev patrol.
//
//   node scripts/api-server.mjs            # port 5174 (default)
//   API_PORT=5180 node scripts/api-server.mjs
//
// The dev patrol (api/_workforce.js on an interval) is disabled here so a
// background LLM workload cannot pollute latency measurements. Real cron
// behaviour is exercised separately, not during a soak.
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFiles, shim } from "../plugins/vercel-shim.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.API_PORT || 5174);

// No cron locally; never let the workforce patrol or the retention interval
// run under measurement (a background sweep would show up as random latency).
process.env.DEV_PATROL_INTERVAL_MS = "0";
process.env.MAINTENANCE_INTERVAL_MS = "0";

loadEnvFiles(root);

const { default: handler } = await import(
	pathToFileURL(join(root, "api", "index.js")).href
);

const server = createServer(async (req, res) => {
	const pathname = (req.url || "").split("?")[0];
	if (pathname !== "/api" && !pathname.startsWith("/api/")) {
		res.statusCode = 404;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		return res.end(JSON.stringify({ error: "Not found. This host serves /api/* only." }));
	}
	try {
		await shim(req, res);
		await handler(req, res);
	} catch (err) {
		if (res.writableEnded) return;
		res.statusCode = 500;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ error: "Local API error: " + (err?.message || String(err)) }));
	}
});

// Load runs open far more sockets than a browser; keep headers modest and let
// Node close idle connections instead of accumulating them.
server.keepAliveTimeout = 15_000;
server.headersTimeout = 20_000;
server.requestTimeout = 120_000;

server.listen(port, "127.0.0.1", () => {
	console.log(`[api-server] api/index.js listening on http://127.0.0.1:${port}/api/*`);
});
