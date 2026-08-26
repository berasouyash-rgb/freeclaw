#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// LOAD TEST — mixed real-world behavior against a running Voice Box
// ═══════════════════════════════════════════════════════════════════
// Pure Node (no dependencies). Simulates concurrent anonymous visitors:
//
//   45% browse feed          GET  /api/posts
//   20% read post+comments   GET  /api/posts/:id + /api/comments/:id
//   12% search               GET  /api/search?q=…
//    8% browse polls         GET  /api/polls
//    6% suggestions          GET  /api/suggestions
//    4% create post          POST /api/posts
//    3% comment              POST /api/comments/:id
//    2% react                POST /api/reactions
//
// Usage:
//   node scripts/loadtest.mjs --url http://localhost:5173 --users 500 --duration 60
//   node scripts/loadtest.mjs --users 5000 --duration 120        # default url
//
// Safety: non-localhost targets require an explicit --yes flag so the
// harness can never be pointed at production by accident.
// ═══════════════════════════════════════════════════════════════════

import http from "node:http";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
function arg(name, fallback) {
	const i = args.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = args[i + 1];
	return v && !v.startsWith("--") ? v : true;
}

const BASE_URL = String(arg("url", "http://localhost:5173"));
const TARGET_USERS = Math.max(1, parseInt(arg("users", "500"), 10));
const DURATION_S = Math.max(5, parseInt(arg("duration", "30"), 10));
const RAMPUP_S = Math.max(0, parseInt(arg("rampup", "10"), 10));
const CONFIRMED = arg("yes", false) === true;

const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(BASE_URL);
if (!isLocal && !CONFIRMED) {
	console.error(
		`\nREFUSING: ${BASE_URL} is not localhost.\n` +
			`Load-testing a remote/deployment can cost money and affect real users.\n` +
			`If you really mean it, re-run with --yes\n`,
	);
	process.exit(1);
}

// ─── Metrics ──────────────────────────────────────────────────────
class Metrics {
	constructor() {
		this.byEndpoint = new Map(); // label → latencies[]
		this.statusCodes = new Map();
		this.errors = 0;
		this.requests = 0;
		this.start = Date.now();
	}
	record(label, ms, status) {
		this.requests++;
		if (!this.byEndpoint.has(label)) this.byEndpoint.set(label, []);
		this.byEndpoint.get(label).push(ms);
		this.statusCodes.set(status, (this.statusCodes.get(status) || 0) + 1);
	}
	recordError(label) {
		this.requests++;
		this.errors++;
		if (!this.byEndpoint.has(label)) this.byEndpoint.set(label, []);
		this.byEndpoint.get(label).push(NaN); // count as failure
	}
	percentile(sorted, p) {
		if (!sorted.length) return NaN;
		const idx = Math.ceil((p / 100) * sorted.length) - 1;
		return sorted[Math.max(0, idx)];
	}
	report() {
		const wall = (Date.now() - this.start) / 1000;
		const rps = (this.requests / wall).toFixed(1);
		console.log("\n" + "═".repeat(64));
		console.log(
			`LOAD TEST COMPLETE — ${this.requests} requests in ${wall.toFixed(1)}s · ${rps} req/s · ${this.errors} errors (${((100 * this.errors) / Math.max(1, this.requests)).toFixed(2)}%)`,
		);
		console.log("═".repeat(64));
		console.log(
			"endpoint".padEnd(26) +
				"n".padStart(7) +
				"p50".padStart(8) +
				"p95".padStart(8) +
				"p99".padStart(9) +
				"errs".padStart(6),
		);
		for (const [label, lat] of [...this.byEndpoint.entries()].sort()) {
			const ok = lat.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
			const errs = lat.length - ok.length;
			console.log(
				label.padEnd(26) +
					String(lat.length).padStart(7) +
					(this.percentile(ok, 50)?.toFixed(0) ?? "-").padStart(8) +
					(this.percentile(ok, 95)?.toFixed(0) ?? "-").padStart(8) +
					(this.percentile(ok, 99)?.toFixed(0) ?? "-").padStart(9) +
					String(errs).padStart(6),
			);
		}
		const codes = [...this.statusCodes.entries()]
			.sort()
			.map(([s, n]) => `${s}:${n}`)
			.join("  ");
		console.log("\nstatus codes:", codes || "(none)");
	}
}

const metrics = new Metrics();

// ─── HTTP helpers ─────────────────────────────────────────────────
const SEARCH_TERMS = [
	"library",
	"food",
	"transport",
	"teacher",
	"sports",
	"event",
	"classroom",
];

function request(label, method, path, body, identity) {
	return new Promise((resolve) => {
		const started = performance.now();
		const payload = body ? JSON.stringify(body) : null;
		const headers = {
			"content-type": "application/json",
			...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
		};
		if (identity) headers["x-anon-id"] = identity;
		const req = http.request(
			`${BASE_URL}${path}`,
			{
				method,
				headers,
				timeout: 15_000,
			},
			(res) => {
				res.resume(); // drain
				res.on("end", () => {
					metrics.record(label, performance.now() - started, res.statusCode);
					resolve({ status: res.statusCode });
				});
			},
		);
		req.on("timeout", () => {
			req.destroy();
		});
		req.on("error", () => {
			metrics.recordError(label);
			resolve({ status: 0 });
		});
		if (payload) req.write(payload);
		req.end();
	});
}

// ─── Buffered request (journey logic needs response data) ───────
function requestJson(label, method, path, body, identity) {
	return new Promise((resolve) => {
		const started = performance.now();
		const payload = body ? JSON.stringify(body) : null;
		const headers = {
			"content-type": "application/json",
			...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
		};
		if (identity) headers["x-anon-id"] = identity;
		const chunks = [];
		const req = http.request(
			`${BASE_URL}${path}`,
			{
				method,
				headers,
				timeout: 15_000,
			},
			(res) => {
				res.on("data", (c) => chunks.push(c));
				res.on("end", () => {
					metrics.record(label, performance.now() - started, res.statusCode);
					let parsed = null;
					try {
						parsed = JSON.parse(Buffer.concat(chunks).toString());
					} catch {
						/* non-JSON */
					}
					resolve({ status: res.statusCode, data: parsed });
				});
			},
		);
		req.on("timeout", () => req.destroy());
		req.on("error", () => {
			metrics.recordError(label);
			resolve({ status: 0, data: null });
		});
		if (payload) req.write(payload);
		req.end();
	});
}

// ─── Virtual user journeys ────────────────────────────────────────
let anonCounter = 0;

async function virtualUser(stopAt, onDone) {
	const anonId = `anon_loadtest_${randomUUID().slice(0, 8)}_${++anonCounter}`;
	while (Date.now() < stopAt) {
		try {
			const roll = Math.random();
			if (roll < 0.45) {
				await requestJson("GET /posts", "GET", "/api/posts?limit=20", null, anonId);
			} else if (roll < 0.65) {
				// Read one post + its comments (feed → detail flow)
				const feed = await requestJson(
					"GET /posts",
					"GET",
					"/api/posts?limit=20",
					null,
					onId,
				);
				const postId = feed?.data?.data?.[0]?.id ?? feed?.data?.[0]?.id;
				if (postId) {
					await requestJson("GET /posts/:id", "GET", `/api/posts/${postId}`, null, anonId);
					await requestJson(
						"GET /comments/:id",
						"GET",
						`/api/comments/${postId}?paginate=1&limit=20`,
						null,
						onId,
					);
				}
			} else if (roll < 0.77) {
				const term =
					SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
				await requestJson("GET /search", "GET", `/api/search?q=${term}`, null, anonId);
			} else if (roll < 0.85) {
				await requestJson("GET /polls", "GET", "/api/polls", null, anonId);
			} else if (roll < 0.91) {
				await requestJson("GET /suggestions", "GET", "/api/suggestions", null, anonId);
			} else if (roll < 0.95) {
				await request("POST /posts", "POST", "/api/posts", {
					title: `Load test test-issue ${randomUUID().slice(0, 6)}`,
					description:
						"Automated load-test test-submission describing a genuine-sounding campus test-problem.",
					category: "Other",
					type: "issue",
					author_id: anonId,
				}, anonId);
			} else if (roll < 0.98) {
				const feed = await requestJson(
					"GET /posts",
					"GET",
					"/api/posts?limit=20",
					null,
					onId,
				);
				const postId = feed?.data?.data?.[0]?.id ?? feed?.data?.[0]?.id;
				if (postId) {
					await request("POST /comments", "POST", `/api/comments/${postId}`, {
						body: "Automated load-test test-comment agreeing with this test-report.",
						author_id: anonId,
					}, anonId);
				}
			} else if (roll < 0.999) {
				const feed = await requestJson(
					"GET /posts",
					"GET",
					"/api/posts?limit=20",
					null,
					onId,
				);
				const postId = feed?.data?.data?.[0]?.id ?? feed?.data?.[0]?.id;
				if (postId) {
					await request("POST /reactions", "POST", "/api/reactions", {
						target_type: "post",
						target_id: postId,
						kind: "support",
						author_id: anonId,
					}, anonId);
				}
			} else {
				const feed = await requestJson(
					"GET /posts",
					"GET",
					"/api/posts?limit=20",
					null,
					onId,
				);
				const postId = feed?.data?.data?.[0]?.id ?? feed?.data?.[0]?.id;
				if (postId) {
					await request("POST /reports", "POST", "/api/reports", {
						target_type: "post",
						target_id: postId,
						reason: "spam",
						details: "Automated load-test test-report — test artifact, safe to ignore.",
						reported_by: anonId,
					}, anonId);
				}
			}
		} catch {
			metrics.recordError("journey-error");
		}
		// Think time: real readers pause between actions (0.5–3s)
		await sleep(500 + Math.random() * 2500);
	}
	onDone();
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

// ─── Orchestrator ─────────────────────────────────────────────────
console.log(`Target:      ${BASE_URL}`);
console.log(`Users:       ${TARGET_USERS} virtual (ramp-up ${RAMPUP_S}s)`);
console.log(`Duration:    ${DURATION_S}s`);
console.log("");

const stopAt = Date.now() + DURATION_S * 1000;
let finished = 0;
let spawned = 0;

// Progress ticker
const ticker = setInterval(() => {
	const elapsed = ((DURATION_S * 1000 - (stopAt - Date.now())) / 1000).toFixed(
		0,
	);
	process.stdout.write(
		`\r${elapsed}s · ${metrics.requests} reqs · ${metrics.errors} errs · live users ~${spawned - finished}`,
	);
}, 2000);

// Ramp-up spawn schedule
for (let i = 0; i < TARGET_USERS; i++) {
	const delay = RAMPUP_S > 0 ? (i / TARGET_USERS) * RAMPUP_S * 1000 : 0;
	setTimeout(() => {
		spawned++;
		virtualUser(stopAt, () => finished++);
	}, delay);
}

setTimeout(() => {
	clearInterval(ticker);
	// Give in-flight requests up to 10s to drain
	setTimeout(() => {
		metrics.report();
		process.exit(metrics.errors > metrics.requests * 0.5 ? 1 : 0);
	}, 10_000);
}, DURATION_S * 1000 + RAMPUP_S * 1000);
