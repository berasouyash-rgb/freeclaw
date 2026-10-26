#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// LOAD TEST — mixed real-world behavior against a running Voice Flow
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
//   node scripts/loadtest.mjs --users 10000 --duration 120     # default url
//   node scripts/loadtest.mjs --users 10000 --slo-p95 300 --slo-error 0.01
//
// SLO gates (exit code 1 when violated):
//   --slo-p95 <ms>     overall p95 latency must be ≤ this (0 = disabled)
//   --slo-error <rate> hard-error rate (network + 5xx) must be ≤ this
//                      (default 0.01 = 1%). 4xx are reported separately.
//   --read-only        skip all write journeys (posts/comments/reactions/
//                      reports) — for big sustained runs that shouldn't
//                      seed test rows into the target database.
//
// Safety: non-localhost targets require an explicit --yes flag so the
// harness can never be pointed at production by accident.
// ═══════════════════════════════════════════════════════════════════

import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
function arg(name, fallback) {
	const i = args.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = args[i + 1];
	return v && !v.startsWith("--") ? v : true;
}

let BASE_URL = String(arg("url", "http://127.0.0.1:5173"));
// On Node on Windows, 'localhost' often resolves to ::1 (IPv6) where dev servers
// bound to 127.0.0.1 drop connections. Normalize to 127.0.0.1.
if (BASE_URL.startsWith("http://localhost:")) {
	BASE_URL = BASE_URL.replace("http://localhost:", "http://127.0.0.1:");
}
const httpClient = BASE_URL.startsWith("https:") ? https : http;
const TARGET_USERS = Math.max(1, parseInt(arg("users", "100"), 10));
const DURATION_S = Math.max(5, parseInt(arg("duration", "30"), 10));
const RAMPUP_S = Math.max(0, parseInt(arg("rampup", "10"), 10));
const CONFIRMED = arg("yes", false) === true;
// SLO gates — a run that misses them exits 1 so CI/scripts can't ignore it.
const SLO_P95_MS = Math.max(0, parseInt(arg("slo-p95", "0"), 10) || 0);
const SLO_ERR_RATE = Math.max(0, parseFloat(arg("slo-error", "0.01")) || 0);
const READ_ONLY = arg("read-only", false) === true;

const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(BASE_URL);
if (!isLocal && !CONFIRMED) {
	console.error(
		`\nREFUSING: ${BASE_URL} is not localhost.\n` +
			`Load-testing a remote/deployment can cost money and affect real users.\n` +
			`If you really mean it, re-run with --yes\n`,
	);
	process.exit(1);
}

// Pre-flight check: ensure target is actually reachable before launching thousands of requests
const preflightPath = "/api/polls";
try {
	await new Promise((resolve, reject) => {
		const req = httpClient.get(`${BASE_URL}${preflightPath}`, { timeout: 8000 }, (res) => {
			res.resume();
			resolve(res.statusCode);
		});
		req.on("error", reject);
		req.on("timeout", () => {
			req.destroy();
			reject(new Error("Connection timed out (8000ms)"));
		});
	});
} catch (err) {
	console.error(
		`\n❌ Target server is not reachable at ${BASE_URL} (${err.message}).\n` +
		`   Please make sure the Voice Flow server is running before executing the load test:\n` +
		`   - For local testing: run "npm run dev" in another terminal (listens on http://127.0.0.1:5173)\n` +
		`   - For remote testing: pass --url https://your-deployment.vercel.app --yes\n`
	);
	process.exit(1);
}

// ─── Connection pooling ───────────────────────────────────────────
// Without keep-alive, every request opens a fresh TCP socket and closes it,
// leaving the local port in TIME_WAIT (120s on Windows). At thousands of
// users that exhausts the ~16k ephemeral port range long before the run
// ends, and the remaining requests fail at the socket layer with
// EADDRNOTAVAIL / ECONNRESET — which the report renders as "100% errors"
// with no status codes, indistinguishable from a dead server. One pooled
// agent reuses sockets instead, so the load test measures the app rather
// than the client machine's port table.
const AGENT = new httpClient.Agent({
	keepAlive: true,
	keepAliveMsecs: 30_000,
	// Never open more sockets than virtual users — extra ones are pure
	// overhead and push the port table harder.
	maxSockets: Math.max(64, Math.min(TARGET_USERS, 2048)),
	maxFreeSockets: 256,
	scheduling: "lifo",
});

// ─── Metrics ──────────────────────────────────────────────────────
class Metrics {
	constructor() {
		this.byEndpoint = new Map(); // label → latencies[]
		this.statusCodes = new Map();
		this.statusByEndpoint = new Map(); // label → Map(status → count)
		this.networkCodes = new Map(); // failure code → count (ECONNRESET, TIMEOUT, …)
		this.errors = 0; // network / timeout
		this.serverErrors = 0; // 5xx — hard failures
		this.clientErrors = 0; // 4xx — reported, not SLO-failing (429 backoff is correct behavior under load)
		this.requests = 0;
		this.start = Date.now();
	}
	record(label, ms, status) {
		this.requests++;
		if (!this.byEndpoint.has(label)) this.byEndpoint.set(label, []);
		this.byEndpoint.get(label).push(ms);
		this.statusCodes.set(status, (this.statusCodes.get(status) || 0) + 1);
		if (!this.statusByEndpoint.has(label)) this.statusByEndpoint.set(label, new Map());
		const perEndpoint = this.statusByEndpoint.get(label);
		perEndpoint.set(status, (perEndpoint.get(status) || 0) + 1);
		if (status >= 500) this.serverErrors++;
		else if (status >= 400) this.clientErrors++;
	}
	recordError(label, code = "ERROR") {
		this.requests++;
		this.errors++;
		this.networkCodes.set(code, (this.networkCodes.get(code) || 0) + 1);
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
		// Zero requests is not a pass — it means every journey stalled before
		// recording (e.g. all timeouts lost). Fail loudly instead of a green
		// 0.00% error rate over nothing.
		if (this.requests === 0) {
			console.log("FAIL  no requests recorded — the run measured nothing");
			return false;
		}
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
		// Which endpoint produced which non-2xx — the global line alone cannot
		// tell you whether the 429s are one hot write path or the whole app.
		const problemEndpoints = [...this.statusByEndpoint.entries()]
			.map(([label, counts]) => ({
				label,
				bad: [...counts.entries()].filter(([s]) => s < 200 || s >= 300),
			}))
			.filter((e) => e.bad.length);
		if (problemEndpoints.length) {
			console.log("non-2xx by endpoint:");
			for (const { label, bad } of problemEndpoints.sort((a, b) => a.label.localeCompare(b.label))) {
				console.log(
					`  ${label.padEnd(26)}${bad.map(([s, n]) => `${s}:${n}`).join("  ")}`,
				);
			}
		}
		// When no response ever arrived, the status-code line alone reads like
		// an app outage. The transport-level code says what actually happened
		// (dead port, port exhaustion, DNS, TLS) — always print it.
		if (this.networkCodes.size) {
			const netCodes = [...this.networkCodes.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([c, n]) => `${c}:${n}`)
				.join("  ");
			console.log("network errors:", netCodes);
			if (this.statusCodes.size === 0) {
				console.log(
					`  ↑ zero HTTP responses received — this is a transport/connectivity failure, not an app error.`,
				);
				console.log(
					`    Check that the server is listening at ${BASE_URL} and that the client is not out of ephemeral ports.`,
				);
			}
		}

		// ── SLO verdict ───────────────────────────────────────────────
		// Overall p95 across every successful request + hard-error rate
		// (network/timeout + 5xx). 4xx are surfaced but don't fail the run:
		// rate-limit backoff is correct behavior under heavy load.
		const allOk = [...this.byEndpoint.values()]
			.flat()
			.filter((x) => !Number.isNaN(x))
			.sort((a, b) => a - b);
		const overallP95 = this.percentile(allOk, 95);
		const hardErrors = this.errors + this.serverErrors;
		const errRate = hardErrors / Math.max(1, this.requests);
		const checks = [];
		if (SLO_P95_MS > 0) {
			checks.push({
				name: `p95 latency ≤ ${SLO_P95_MS}ms`,
				got: `${Number.isFinite(overallP95) ? overallP95.toFixed(0) : "n/a"}ms`,
				pass: Number.isFinite(overallP95) && overallP95 <= SLO_P95_MS,
			});
		}
		checks.push({
			name: `hard-error rate ≤ ${(SLO_ERR_RATE * 100).toFixed(2)}%`,
			got: `${(errRate * 100).toFixed(2)}% (${hardErrors}/${this.requests})`,
			pass: errRate <= SLO_ERR_RATE,
		});
		console.log("\nSLO verdict:");
		for (const c of checks) {
			console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name} — got ${c.got}`);
		}
		if (this.clientErrors > 0) {
			console.log(
				`  note  ${this.clientErrors} client errors (4xx) — see status codes above`,
			);
		}
		return checks.every((c) => c.pass);
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

// A pooled keep-alive socket can be closed by the server between the moment
// the agent hands it out and the moment we write to it — the classic
// server-keepAliveTimeout race. It surfaces as ECONNRESET/EPIPE against a
// perfectly healthy server. Browsers retry idempotent requests in that case,
// and so do we (once), instead of charging the app with an error it did not
// cause. Non-idempotent POSTs are never retried.
const RETRYABLE_CODES = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED"]);

/**
 * One HTTP round-trip. Never touches metrics — the caller decides whether the
 * result is an error and whether to retry, so a retried attempt cannot be
 * double-counted.
 */
function send(method, path, headers, payload, collectBody) {
	return new Promise((resolve) => {
		const chunks = [];
		let settled = false;
		const done = (result) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};
		const req = httpClient.request(
			`${BASE_URL}${path}`,
			{ method, headers, timeout: 15_000, agent: AGENT },
			(res) => {
				if (collectBody) res.on("data", (c) => chunks.push(c));
				res.resume(); // drain (no-op body when collecting)
				res.on("end", () => {
					let data = null;
					if (collectBody) {
						try {
							data = JSON.parse(Buffer.concat(chunks).toString());
						} catch {
							/* non-JSON */
						}
					}
					done({ status: res.statusCode, data, code: null });
				});
			},
		);
		req.on("timeout", () => {
			done({ status: 0, data: null, code: "TIMEOUT", reused: false });
			req.destroy();
		});
		req.on("error", (err) => {
			done({
				status: 0,
				data: null,
				code: err?.code || "ERROR",
				// `reusedSocket` is true when the agent handed back a pooled
				// keep-alive socket. A reset on a reused socket is the server's
				// keepAliveTimeout closing it between hand-out and write — a
				// client-side race, not an app failure — so it earns an extra
				// retry instead of being charged to the app.
				reused: req.reusedSocket === true,
			});
		});
		if (payload) req.write(payload);
		req.end();
	});
}

function buildHeaders(payload, identity) {
	const headers = {
		"content-type": "application/json",
		...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
	};
	if (identity) headers["x-anon-id"] = identity;
	// Spread virtual users across a small pool of NAT addresses. Every user on
	// one synthetic IP is not a realistic client population — a real deployment
	// receives traffic from many buildings, carriers and campuses — and it makes
	// the per-IP flood backstops the only thing under test. The pool is sized so
	// a run still exercises those backstops, just at NAT scale (a few hundred
	// users per address) rather than "the whole internet is one person".
	headers["x-forwarded-for"] = natIpFor(identity);
	return headers;
}

// 198.51.100.0/24 is TEST-NET-2 (RFC 5737): documentation-only, never routed,
// so synthetic client addresses can never collide with a real host.
const NAT_POOL = Array.from({ length: 32 }, (_, i) => `198.51.100.${i + 1}`);

function natIpFor(identity) {
	const s = String(identity || "anon");
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return NAT_POOL[Math.abs(h) % NAT_POOL.length];
}

/**
 * Idempotent retry. A pooled keep-alive socket closed by the server between
 * agent hand-out and write surfaces as ECONNRESET/EPIPE against a healthy
 * server; a fresh-socket failure is more likely real. So: one retry for any
 * retryable GET failure, two when the failing attempt was on a reused socket.
 * Non-GET methods are never retried — a POST may already have been applied.
 */
async function withRetry(method, path, headers, payload, collectBody) {
	let result = await send(method, path, headers, payload, collectBody);
	let attempts = 1;
	while (
		result.status === 0 &&
		method === "GET" &&
		RETRYABLE_CODES.has(result.code) &&
		attempts < (result.reused ? 3 : 2)
	) {
		attempts++;
		result = await send(method, path, headers, payload, collectBody);
	}
	return result;
}

/** Fire-and-forget request (body discarded). */
async function request(label, method, path, body, identity) {
	const started = performance.now();
	const payload = body ? JSON.stringify(body) : null;
	const headers = buildHeaders(payload, identity);
	const result = await withRetry(method, path, headers, payload, false);
	// A timeout must count exactly like a network error: without this the
	// virtual user stalls for the rest of the run and effective concurrency
	// silently decays while the report understates the load.
	if (result.status === 0) {
		metrics.recordError(label, result.code);
		return { status: 0 };
	}
	metrics.record(label, performance.now() - started, result.status);
	return { status: result.status };
}

// ─── Buffered request (journey logic needs response data) ───────
async function requestJson(label, method, path, body, identity) {
	const started = performance.now();
	const payload = body ? JSON.stringify(body) : null;
	const headers = buildHeaders(payload, identity);
	const result = await withRetry(method, path, headers, payload, true);
	if (result.status === 0) {
		metrics.recordError(label, result.code);
		return { status: 0, data: null };
	}
	metrics.record(label, performance.now() - started, result.status);
	return { status: result.status, data: result.data };
}

// ─── Virtual user journeys ────────────────────────────────────────
let anonCounter = 0;

// Real browsers mint `anon_` + 14 base36 chars (src/lib/identity.ts). Using the
// same shape keeps the harness on the same validation path the app uses —
// a made-up id with underscores would silently fall back to IP bucketing and
// hide exactly the per-user rate-limit bug we are testing for.
function newAnonId() {
	let s = "";
	while (s.length < 10) s += Math.random().toString(36).slice(2);
	// Counter tail keeps ids unique per run without breaking the `anon_[a-z0-9]+`
	// format the server validates.
	const tail = (++anonCounter).toString(36).padStart(4, "0").slice(-4);
	return `anon_${s.slice(0, 10)}${tail}`;
}

async function virtualUser(stopAt, onDone) {
	const anonId = newAnonId();
	while (Date.now() < stopAt) {
		try {
			const roll = Math.random();
			// Read-only runs: everything at/after the write band (0.91+)
			// degrades to a plain feed read so no test rows are created.
			if (READ_ONLY && roll >= 0.91) {
				await requestJson("GET /posts", "GET", "/api/posts?limit=20", null, anonId);
			} else if (roll < 0.45) {
				await requestJson("GET /posts", "GET", "/api/posts?limit=20", null, anonId);
			} else if (roll < 0.65) {
				// Read one post + its comments (feed → detail flow)
				const feed = await requestJson(
					"GET /posts",
					"GET",
					"/api/posts?limit=20",
					null,
					anonId,
				);
				const postId = feed?.data?.data?.[0]?.id ?? feed?.data?.[0]?.id;
				if (postId) {
					// The posts handler reads `id` from the QUERY STRING (like the real
					// client does in PostDetail) — a path segment /api/posts/:id would
					// silently return the whole feed and never test the by-id path.
					await requestJson("GET /posts?id=", "GET", `/api/posts?id=${postId}`, null, anonId);
					await requestJson(
						"GET /comments?post_id",
						"GET",
						`/api/comments?post_id=${postId}&paginate=1&limit=20`,
						null,
						anonId,
					);
				}
			} else if (roll < 0.77) {
				const term =
					SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
				await requestJson("GET /search", "GET", `/api/search?q=${term}`, null, anonId);
			} else if (roll < 0.85) {
				await requestJson("GET /polls", "GET", "/api/polls", null, anonId);
			} else if (roll < 0.91) {
				// No /api/suggestions route exists (it404'd silently on every run);
				// suggestions are served by the posts handler with type=suggestion.
				await requestJson("GET /posts?type=suggestion", "GET", "/api/posts?type=suggestion", null, anonId);
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
					anonId,
				);
				const postId = feed?.data?.data?.[0]?.id ?? feed?.data?.[0]?.id;
				if (postId) {
					// The comments POST handler reads post_id from the BODY — without it
					// the insert target is undefined and every test comment failed.
					await request("POST /comments", "POST", "/api/comments", {
						post_id: postId,
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
					anonId,
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
					anonId,
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
		} catch (err) {
			metrics.recordError("journey-error", err?.code || "JOURNEY_ERROR");
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
		const passed = metrics.report();
		// Close pooled sockets so the process can exit immediately instead of
		// lingering until every keep-alive socket times out.
		AGENT.destroy();
		process.exit(passed ? 0 : 1);
	}, 10_000);
}, DURATION_S * 1000 + RAMPUP_S * 1000);
