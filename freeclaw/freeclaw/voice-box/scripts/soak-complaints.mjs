#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// SOAK — full complaint lifecycle under sustained concurrency
// ═══════════════════════════════════════════════════════════════════
// Unlike scripts/loadtest.mjs (a random mix of read paths), this harness
// drives ONE complete, realistic user lifecycle per virtual user and then
// asserts on the moderation verdicts the server actually returned:
//
//   1. browse the feed                      GET  /api/posts?limit=10
//   2. submit a teacher-conduct complaint   POST /api/posts
//        └─ mints the session implicitly; X-Session-Token is captured
//           from the response header and replayed on every later request
//   3. (sampled) live review panel          POST /api/pre-publish
//   4. react (rating proxy) ON              POST /api/reactions
//   5. react (rating proxy) OFF             POST /api/reactions
//   6. comment                              POST /api/comments
//   7. delete own comment                   PUT  /api/comments  {deleted:true}
//   8. delete own post                      PUT  /api/posts     {deleted:true}
//
// Why "teacher-conduct complaint" and not just random text:
// the whole release rests on the claim that ordinary staff criticism is NOT
// mislabelled as abuse and NOT held for human review. A soak that submits
// filler would never exercise that path. Every single submission here is a
// fresh, non-duplicate complaint about a named staff member's conduct, so
// any "abuse" wording or pending_review hold is a real regression.
//
// Usage:
//   node scripts/soak-complaints.mjs --users 100 --concurrency 24
//   node scripts/soak-complaints.mjs --users 5000 --concurrency 48 \
//        --verdict-sample 120 --stage high-5000
//
// Gates (exit 1 on violation):
//   --slo-p95 <ms>            p95 for NON-LLM endpoints            (default 2500)
//   --slo-llm-write-p95 <ms>  p95 for LLM-BEARING writes           (default 6000)
//   --slo-prepublish-p95 <ms> p95 for POST /api/pre-publish only    (default 20000)
//   --slo-error <rate>        hard-error rate                      (default 0.02)
//   --max-holds <n>           pre-publish holds allowed            (default 0)
//   --max-abuse <n>           literal "report of abuse" verdicts   (default 0)
//   --max-nonsafe <n>         non-"safe" verdicts allowed          (default 0)
//
// There are THREE latency gates, not one, because this lifecycle hits three
// different classes of endpoint and averaging them together hides failures in
// all of them:
//
//   interactive  GET /posts, POST /reactions, PUT /comments, PUT /posts
//                Pure database/business path. No model is awaited anywhere on
//                this route, so 2500 ms is a fair service budget.
//   llm-write    POST /posts, POST /comments
//                Both await evaluateContentDeep() synchronously. Their floor is
//                therefore the deep-check budget (5000 ms), not a DB budget.
//                Gating them at 2500 ms would be a demand the architecture
//                cannot meet; gating them at nothing would let a runaway
//                model call hang a submission forever. 6000 ms is the hard
//                wall around the 5000 ms internal budget plus overhead.
//   pre-publish  POST /pre-publish
//                The dedicated review endpoint; measured p50 ≈ 10 s on a free
//                provider tier, so it gets its own deliberately wide gate.
//
// Model coverage (`llm_analyzed`) is REPORTED as an informational metric and is
// deliberately not a gate: on a saturated free tier the deterministic floor is
// the designed behaviour, and turning "the provider was busy" into a release
// failure would train us to loosen it.

//
// Safety: a non-localhost target requires --yes.
// ═══════════════════════════════════════════════════════════════════

import http from "node:http";
import https from "node:https";
import { complaintFor } from "./soak-content.mjs";

const argv = process.argv.slice(2);
function arg(name, fallback) {
	const i = argv.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = argv[i + 1];
	return v && !v.startsWith("--") ? v : true;
}

let BASE_URL = String(arg("url", "http://127.0.0.1:5173"));
if (BASE_URL.startsWith("http://localhost:")) {
	BASE_URL = BASE_URL.replace("http://localhost:", "http://127.0.0.1:");
}
BASE_URL = BASE_URL.replace(/\/+$/, "");

const USERS = Math.max(1, parseInt(arg("users", "50"), 10));
const CONCURRENCY = Math.max(1, parseInt(arg("concurrency", "12"), 10));
const VERDICT_SAMPLE = Math.max(0, parseInt(arg("verdict-sample", "40"), 10));
const TIMEOUT_MS = Math.max(2000, parseInt(arg("timeout", "60000"), 10));
const STAGE = String(arg("stage", `soak-${USERS}`));
const CONFIRMED = arg("yes", false) === true;
const SLO_P95 = Math.max(0, parseInt(arg("slo-p95", "2500"), 10) || 0);
const SLO_LLM_WRITE_P95 = Math.max(0, parseInt(arg("slo-llm-write-p95", "6000"), 10) || 0);
const SLO_PREPUBLISH_P95 = Math.max(0, parseInt(arg("slo-prepublish-p95", "20000"), 10) || 0);
const SLO_ERR = Math.max(0, parseFloat(arg("slo-error", "0.02")) || 0);
const MAX_HOLDS = Math.max(0, parseInt(arg("max-holds", "0"), 10) || 0);
const MAX_ABUSE = Math.max(0, parseInt(arg("max-abuse", "0"), 10) || 0);
const MAX_NONSAFE = Math.max(0, parseInt(arg("max-nonsafe", "0"), 10) || 0);
const PREPUBLISH_LABEL = "POST /pre-publish";

// Endpoint latency classes. Keep these in sync with the lifecycle below — a
// label missing from both sets is reported per-endpoint but never gated, which
// is exactly how a slow route hides from the release report.
const INTERACTIVE_LABELS = new Set(["GET /posts", "POST /reactions", "PUT /comments", "PUT /posts"]);
const LLM_WRITE_LABELS = new Set(["POST /posts", "POST /comments"]);

const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(BASE_URL);
if (!isLocal && !CONFIRMED) {
	console.error(
		`\nREFUSING: ${BASE_URL} is not localhost.\n` +
			`This harness writes and deletes real rows. Re-run with --yes if you mean it.\n`,
	);
	process.exit(1);
}

const httpClient = BASE_URL.startsWith("https:") ? https : http;
const AGENT = new httpClient.Agent({
	keepAlive: true,
	keepAliveMsecs: 30_000,
	maxSockets: Math.max(32, Math.min(CONCURRENCY * 3, 512)),
	maxFreeSockets: 128,
	scheduling: "lifo",
});

// ─── Metrics ──────────────────────────────────────────────────────
class Metrics {
	constructor() {
		this.byLabel = new Map(); // label → { lat: number[], status: Map }
		this.errors = new Map(); // network code → count
		this.hardErrors = 0;
		this.total = 0;
	}
	record(label, ms, status) {
		this.total++;
		let e = this.byLabel.get(label);
		if (!e) {
			e = { lat: [], status: new Map() };
			this.byLabel.set(label, e);
		}
		e.lat.push(ms);
		e.status.set(status, (e.status.get(status) || 0) + 1);
		if (status >= 500) this.hardErrors++;
	}
	recordError(label, code) {
		this.total++;
		this.hardErrors++;
		this.errors.set(code, (this.errors.get(code) || 0) + 1);
		let e = this.byLabel.get(label);
		if (!e) {
			e = { lat: [], status: new Map() };
			this.byLabel.set(label, e);
		}
		e.status.set(0, (e.status.get(0) || 0) + 1);
	}
	allLatencies() {
		const out = [];
		for (const e of this.byLabel.values()) out.push(...e.lat);
		return out;
	}
}

const metrics = new Metrics();
const assertions = {
	submitted: 0,
	created201: 0,
	deduped200: 0,
	createFailed: 0,
	pendingReview: 0,
	// Literal hold phrase from api/_pre-publish.js ABUSE_REPORT_MESSAGE.
	// Deliberately NOT /\babus(e|ive)\b/: the reviewer's own reason prose may
	// legitimately say "this is criticism, not abuse", and matching that would
	// report a false positive as the very bug this harness guards against.
	reportOfAbuse: 0,
	nonSafeVerdicts: 0,
	highRisk: 0,
	verdictsChecked: 0,
	// Model coverage: of the verdicts inspected, how many were actually
	// produced with a live model in the loop. Informational only — on a
	// saturated free tier the deterministic floor is the designed behaviour.
	modelAnalyzed: 0,
	commentCreated: 0,
	commentDeleted: 0,
	postDeleted: 0,
	cleanupFailed: 0,
	notes: [],
};
function note(msg) {
	if (assertions.notes.length < 30) assertions.notes.push(msg);
	else if (assertions.notes.length === 30) assertions.notes.push("…more suppressed");
}

function pct(sorted, p) {
	if (!sorted.length) return 0;
	const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[i];
}

// ─── HTTP ─────────────────────────────────────────────────────────
function send(method, path, headers, payload, collectBody) {
	return new Promise((resolve) => {
		const chunks = [];
		let settled = false;
		const done = (r) => {
			if (settled) return;
			settled = true;
			resolve(r);
		};
		const req = httpClient.request(
			`${BASE_URL}${path}`,
			{ method, headers, timeout: TIMEOUT_MS, agent: AGENT },
			(res) => {
				if (collectBody) res.on("data", (c) => chunks.push(c));
				res.resume();
				res.on("end", () => {
					let data = null;
					if (collectBody) {
						try {
							data = JSON.parse(Buffer.concat(chunks).toString());
						} catch {
							/* non-JSON body */
						}
					}
					done({ status: res.statusCode, data, headers: res.headers, code: null });
				});
			},
		);
		req.on("timeout", () => {
			done({ status: 0, data: null, headers: {}, code: "TIMEOUT" });
			req.destroy();
		});
		req.on("error", (err) => {
			done({ status: 0, data: null, headers: {}, code: err?.code || "ERROR" });
		});
		if (payload) req.write(payload);
		req.end();
	});
}

// Source-IP pool. This must be wide enough that per-IP rate limiting and the
// spam velocity window (VELOCITY_MAX = 5 per 60s) do not fire on legitimate
// traffic: 5,000 users behind a 32-address NAT pool is ~156 posts per address,
// which is a synthetic flood by definition. RFC 2544 reserves 198.18.0.0/15
// (131,072 addresses) for benchmarking, so a deterministic 4,096-address
// sample of it keeps every virtual user far below the velocity ceiling.
const NAT_POOL_SIZE = 4096;
const NAT_POOL = Array.from({ length: NAT_POOL_SIZE }, (_, i) => {
	const n = i * 32; // stride 32 spreads the sample evenly across the /15
	return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
});
function natIpFor(identity) {
	const s = String(identity || "anon");
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return NAT_POOL[Math.abs(h) % NAT_POOL.length];
}

function headersFor(payload, identity, session) {
	const headers = {
		"content-type": "application/json",
		accept: "application/json",
	};
	if (payload) headers["content-length"] = Buffer.byteLength(payload);
	if (identity) headers["x-anon-id"] = identity;
	headers["x-forwarded-for"] = natIpFor(identity);
	if (session) headers["x-session-token"] = session;
	return headers;
}

async function call(label, method, path, body, identity, session) {
	const payload = body ? JSON.stringify(body) : null;
	const started = performance.now();
	// Only idempotent GETs are retried: a POST/PUT may already have applied.
	let r = await send(method, path, headersFor(payload, identity, session), payload, true);
	if (r.status === 0 && method === "GET") {
		r = await send(method, path, headersFor(payload, identity, session), payload, true);
	}
	if (r.status === 0) {
		metrics.recordError(label, r.code);
		return r;
	}
	metrics.record(label, performance.now() - started, r.status);
	return r;
}

// ─── Identity ─────────────────────────────────────────────────────
let anonSeq = 0;
function newAnonId() {
	let s = "";
	while (s.length < 10) s += Math.random().toString(36).slice(2);
	const tail = (++anonSeq).toString(36).padStart(4, "0").slice(-4);
	return `anon_${s.slice(0, 10)}${tail}`;
}

// ─── Content ──────────────────────────────────────────────────────
// The corpus lives in scripts/soak-content.mjs so it can be replayed against
// the real moderation predicates before any load is generated. See that file
// for why every phrase is constrained: the whole point of this harness is that
// ordinary staff criticism is neither labelled "a report of abuse" nor held.


async function preflight() {
	try {
		const r = await send("GET", "/api/posts?limit=1", { accept: "application/json" }, null, true);
		if (r.status === 0) throw new Error(r.code || "no response");
		if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
		return r.status;
	} catch (err) {
		console.error(
			`\nTarget not reachable at ${BASE_URL} (${err.message}).\n` +
				`Start the app first:  npm run dev\n`,
		);
		process.exit(1);
	}
}

const sampleEvery = VERDICT_SAMPLE > 0 ? Math.max(1, Math.floor(USERS / VERDICT_SAMPLE)) : 0;

async function lifecycle(idx) {
	const anon = newAnonId();
	// Deterministic unique content: index → a distinct (staff, opinion, topic,
	// slot) tuple. scripts/verify-soak-content.mjs replays the whole corpus
	// through the real predicates before the run, so a generated submission
	// that the server would treat as something other than an ordinary staff
	// complaint never reaches the wire.
	const { title, description, parts } = complaintFor(idx);

	// 1. browse
	await call("GET /posts", "GET", "/api/posts?limit=10", null, anon, null);

	// 2. submit complaint (mints the session; header carries the token back)
	assertions.submitted++;
	let session = null;
	let postId = null;
	const created = await call(
		"POST /posts",
		"POST",
		"/api/posts",
		{ title, description, category: "Teachers", type: "problem" },
		anon,
		null,
	);
	session = created.headers?.["x-session-token"] || null;
	if (created.status === 201 && created.data?.id) {
		assertions.created201++;
		postId = created.data.id;
		if (created.data.status === "pending_review") {
			assertions.pendingReview++;
			note(`pending_review on submit: ${title.slice(0, 70)}`);
		}
	} else if (created.status === 200 && created.data?.deduped) {
		// Should never happen: content is unique per user.
		assertions.deduped200++;
		note(`unexpected dedupe: ${created.data?.title?.slice(0, 60)}`);
	} else {
		assertions.createFailed++;
		note(`POST /posts -> ${created.status} ${JSON.stringify(created.data?.error || created.data?.code || "")}`);
		return;
	}

	// 3. sampled live review panel — assert the verdict itself
	if (sampleEvery && idx % sampleEvery === 0) {
		const v = await call(
			"POST /pre-publish",
			"POST",
			"/api/pre-publish",
			{
				author_id: anon,
				title,
				description,
				content_type: "post",
				category: "Teachers",
				visibility: "public",
			},
			anon,
			session,
		);
		if (v.status === 200 && v.data) {
			assertions.verdictsChecked++;
			if (v.data.analysis?.llm_analyzed === true) assertions.modelAnalyzed++;
			const decision = String(v.data.decision || "");
			const blob = JSON.stringify({ reason: v.data.reason || "", checks: v.data.checks || [] });
			if (decision === "high_risk") {
				assertions.highRisk++;
				note(`high_risk: ${title.slice(0, 60)} | ${String(v.data.reason || "").slice(0, 120)}`);
			}
			if (/\breport of abuse\b/i.test(blob)) {
				assertions.reportOfAbuse++;
				note(`"report of abuse": ${blob.slice(0, 160)}`);
			}
			if (decision !== "safe") {
				assertions.nonSafeVerdicts++;
				note(
					`non-safe verdict (${decision}): ${title.slice(0, 60)} | ${String(v.data.reason || "").slice(0, 120)}`,
				);
			}
		} else if (v.status !== 429) {
			note(`pre-publish -> ${v.status}`);
		}
	}

	// 4 + 5. reaction ON then OFF (there is no separate rating endpoint)
	const reactBody = { kind: "support", target_id: postId, target_type: "post" };
	await call("POST /reactions", "POST", "/api/reactions", reactBody, anon, session);
	await call("POST /reactions", "POST", "/api/reactions", reactBody, anon, session);

	// 6. comment
	const cmt = await call(
		"POST /comments",
		"POST",
		"/api/comments",
		{
			post_id: postId,
			body: `I have noticed the same thing about ${parts.topic} too, thank you for raising it.`,
		},
		anon,
		session,
	);
	let commentId = null;
	if (cmt.status === 201 && cmt.data?.id) {
		assertions.commentCreated++;
		commentId = cmt.data.id;
	}

	// 7. delete own comment
	if (commentId) {
		const del = await call("PUT /comments", "PUT", "/api/comments", { id: commentId, deleted: true }, anon, session);
		if (del.status === 200) assertions.commentDeleted++;
		else assertions.cleanupFailed++;
	}

	// 8. delete own post
	const delPost = await call("PUT /posts", "PUT", "/api/posts", { id: postId, deleted: true }, anon, session);
	if (delPost.status === 200) assertions.postDeleted++;
	else {
		assertions.cleanupFailed++;
		note(`PUT /posts delete -> ${delPost.status}`);
	}
}

// ─── Runner ───────────────────────────────────────────────────────
async function main() {
	console.log(`\nVoice Flow — complaint lifecycle soak`);
	console.log(`  target      : ${BASE_URL}`);
	console.log(`  stage       : ${STAGE}`);
	console.log(`  users       : ${USERS}`);
	console.log(`  concurrency : ${CONCURRENCY}`);
	console.log(`  verdict samp: ${sampleEvery ? `every ${sampleEvery}th (~${VERDICT_SAMPLE})` : "off"}`);

	await preflight();
	const t0 = Date.now();
	let next = 0;
	let done = 0;

	async function worker() {
		while (true) {
			const i = next++;
			if (i >= USERS) return;
			try {
				await lifecycle(i);
			} catch (err) {
				metrics.recordError("lifecycle", err?.code || "THROW");
				note(`lifecycle throw: ${String(err?.message || err).slice(0, 120)}`);
			}
			done++;
			if (done % Math.max(1, Math.floor(USERS / 10)) === 0) {
				const el = ((Date.now() - t0) / 1000).toFixed(1);
				process.stdout.write(`  … ${done}/${USERS} in ${el}s\n`);
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, USERS) }, worker));
	const elapsed = (Date.now() - t0) / 1000;

	// ─── Report ───────────────────────────────────────────────────
	const lat = metrics.allLatencies().sort((x, y) => x - y);
	const p50 = pct(lat, 50);
	const p90 = pct(lat, 90);
	const p95 = pct(lat, 95);
	const p99 = pct(lat, 99);

	// Three latency classes, gated separately. See the header comment for why
	// a single blanket p95 over all endpoints is the wrong instrument: it
	// blends a DB-only route with a route that awaits a 5 s model budget.
	const ppLat = (metrics.byLabel.get(PREPUBLISH_LABEL)?.lat || []).slice().sort((x, y) => x - y);
	const prepublishP95 = ppLat.length ? pct(ppLat, 95) : 0;

	const interactiveLat = [];
	const llmWriteLat = [];
	const unclassified = [];
	for (const [label, e] of metrics.byLabel.entries()) {
		if (INTERACTIVE_LABELS.has(label)) interactiveLat.push(...e.lat);
		else if (LLM_WRITE_LABELS.has(label)) llmWriteLat.push(...e.lat);
		else if (label !== PREPUBLISH_LABEL) unclassified.push(label);
	}
	interactiveLat.sort((x, y) => x - y);
	llmWriteLat.sort((x, y) => x - y);
	const interactiveP95 = interactiveLat.length ? pct(interactiveLat, 95) : 0;
	const llmWriteP95 = llmWriteLat.length ? pct(llmWriteLat, 95) : 0;
	const modelCoverage = assertions.verdictsChecked
		? assertions.modelAnalyzed / assertions.verdictsChecked
		: 0;

	const errRate = metrics.total ? metrics.hardErrors / metrics.total : 0;
	const rps = metrics.total / Math.max(0.001, elapsed);

	console.log(`\n── ${STAGE} ─────────────────────────────────────`);
	console.log(`  elapsed        : ${elapsed.toFixed(1)}s`);
	console.log(`  requests       : ${metrics.total}  (${rps.toFixed(1)} req/s)`);
	console.log(`  latency p50/90/95/99 : ${p50.toFixed(0)} / ${p90.toFixed(0)} / ${p95.toFixed(0)} / ${p99.toFixed(0)} ms   (all endpoints, context only)`);
	console.log(
		`  interactive p95      : ${interactiveP95.toFixed(0)} ms  (n=${interactiveLat.length})  ${[...INTERACTIVE_LABELS].join(", ")}`,
	);
	console.log(
		`  llm-write p95        : ${llmWriteP95.toFixed(0)} ms  (n=${llmWriteLat.length})  ${[...LLM_WRITE_LABELS].join(", ")}`,
	);
	console.log(`  pre-publish p95      : ${prepublishP95.toFixed(0)} ms  (n=${ppLat.length})`);
	console.log(`  hard errors    : ${metrics.hardErrors} (${(errRate * 100).toFixed(2)}%)`);
	if (unclassified.length) {
		console.log(`  UNGATED endpoints    : ${unclassified.join(", ")}  ← classify in INTERACTIVE_LABELS or LLM_WRITE_LABELS`);
	}
	if (metrics.errors.size) {
		console.log(`  network        : ${[...metrics.errors.entries()].map(([k, v]) => `${k}×${v}`).join(", ")}`);
	}

	console.log(`\n  per endpoint:`);
	for (const [label, e] of [...metrics.byLabel.entries()].sort()) {
		const l = e.lat.slice().sort((x, y) => x - y);
		const codes = [...e.status.entries()]
			.filter(([c]) => c !== 200 && c !== 201 && c !== 204)
			.map(([c, n]) => `${c}×${n}`)
			.join(" ");
		console.log(
			`    ${label.padEnd(16)} n=${String(l.length).padStart(5)}  p50=${pct(l, 50).toFixed(0).padStart(5)}ms  p95=${pct(l, 95).toFixed(0).padStart(5)}ms${codes ? `  odd=[${codes}]` : ""}`,
		);
	}

	console.log(`\n  lifecycle:`);
	console.log(`    submitted           : ${assertions.submitted}`);
	console.log(`    created (201)       : ${assertions.created201}`);
	console.log(`    created failed      : ${assertions.createFailed}`);
	console.log(`    unexpected dedupe   : ${assertions.deduped200}`);
	console.log(`    pending_review      : ${assertions.pendingReview}`);
	console.log(`    verdicts inspected  : ${assertions.verdictsChecked}`);
	console.log(
		`    model coverage      : ${assertions.modelAnalyzed}/${assertions.verdictsChecked} (${(modelCoverage * 100).toFixed(0)}%)  informational`,
	);
	console.log(`    high_risk verdicts  : ${assertions.highRisk}`);
	console.log(`    non-safe verdicts   : ${assertions.nonSafeVerdicts}`);
	console.log(`    "report of abuse"   : ${assertions.reportOfAbuse}`);
	console.log(`    comments created    : ${assertions.commentCreated}`);
	console.log(`    comments deleted    : ${assertions.commentDeleted}`);
	console.log(`    posts deleted       : ${assertions.postDeleted}`);
	console.log(`    cleanup failures    : ${assertions.cleanupFailed}`);
	if (assertions.notes.length) {
		console.log(`\n  notes:`);
		for (const n of assertions.notes) console.log(`    • ${n}`);
	}

	// ─── Gates ────────────────────────────────────────────────────
	const failures = [];
	if (SLO_P95 && interactiveP95 > SLO_P95)
		failures.push(`interactive p95 ${interactiveP95.toFixed(0)}ms > ${SLO_P95}ms (${[...INTERACTIVE_LABELS].join(", ")})`);
	if (SLO_LLM_WRITE_P95 && llmWriteP95 > SLO_LLM_WRITE_P95)
		failures.push(`llm-write p95 ${llmWriteP95.toFixed(0)}ms > ${SLO_LLM_WRITE_P95}ms (${[...LLM_WRITE_LABELS].join(", ")})`);
	if (SLO_PREPUBLISH_P95 && ppLat.length && prepublishP95 > SLO_PREPUBLISH_P95)
		failures.push(`pre-publish p95 ${prepublishP95.toFixed(0)}ms > ${SLO_PREPUBLISH_P95}ms`);
	if (errRate > SLO_ERR) failures.push(`error rate ${(errRate * 100).toFixed(2)}% > ${(SLO_ERR * 100).toFixed(2)}%`);
	if (assertions.createFailed > 0) failures.push(`${assertions.createFailed} submissions rejected`);
	if (assertions.pendingReview > MAX_HOLDS) failures.push(`${assertions.pendingReview} holds > ${MAX_HOLDS}`);
	if (assertions.reportOfAbuse > MAX_ABUSE)
		failures.push(`${assertions.reportOfAbuse} "report of abuse" verdicts > ${MAX_ABUSE}`);
	if (assertions.nonSafeVerdicts > MAX_NONSAFE)
		failures.push(`${assertions.nonSafeVerdicts} non-safe verdicts > ${MAX_NONSAFE}`);
	if (assertions.highRisk > 0) failures.push(`${assertions.highRisk} high_risk verdicts`);
	if (assertions.deduped200 > 0) failures.push(`${assertions.deduped200} unintended dedupes`);
	if (assertions.cleanupFailed > 0) failures.push(`${assertions.cleanupFailed} cleanup failures`);

	if (failures.length) {
		console.log(`\n  GATE FAILED:`);
		for (const f of failures) console.log(`    ✗ ${f}`);
		process.exitCode = 1;
	} else {
		console.log(`\n  GATE PASSED`);
	}

	// machine-readable line for the release report
	console.log(
		`\nSOAK_JSON ${JSON.stringify({
			stage: STAGE,
			users: USERS,
			concurrency: Math.min(CONCURRENCY, USERS),
			elapsed_s: +elapsed.toFixed(1),
			requests: metrics.total,
			rps: +rps.toFixed(2),
			p50_ms: Math.round(p50),
			p90_ms: Math.round(p90),
			p95_ms: Math.round(p95),
			p99_ms: Math.round(p99),
			// The three separately gated latency classes. p95_ms above is
			// reported for context only and blends all of them.
			interactive_p95_ms: Math.round(interactiveP95),
			interactive_samples: interactiveLat.length,
			llm_write_p95_ms: Math.round(llmWriteP95),
			llm_write_samples: llmWriteLat.length,
			prepublish_p95_ms: Math.round(prepublishP95),
			prepublish_samples: ppLat.length,
			ungated_endpoints: unclassified,
			error_rate: +errRate.toFixed(4),
			submitted: assertions.submitted,
			created201: assertions.created201,
			create_failed: assertions.createFailed,
			deduped200: assertions.deduped200,
			pending_review: assertions.pendingReview,
			verdicts_checked: assertions.verdictsChecked,
			model_analyzed: assertions.modelAnalyzed,
			model_coverage: +modelCoverage.toFixed(4),
			high_risk: assertions.highRisk,
			non_safe_verdicts: assertions.nonSafeVerdicts,
			report_of_abuse: assertions.reportOfAbuse,
			comment_created: assertions.commentCreated,
			comment_deleted: assertions.commentDeleted,
			post_deleted: assertions.postDeleted,
			cleanup_failed: assertions.cleanupFailed,
			failures,
			notes: assertions.notes,
			ok: failures.length === 0,
		})}`,
	);
}

main().catch((err) => {
	console.error("soak crashed:", err);
	process.exit(1);
});
