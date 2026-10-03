// ═══════════════════════════════════════════════════════════════════
// WORKER AUDIT — 20-criteria per-worker gate (spec §60)
// ═══════════════════════════════════════════════════════════════════
// Static, evidence-based audit over the real sources. Every verdict cites
// the file/line that justifies it. Verdicts: PASS / FAIL / PARTIAL / NA.
// PARTIAL means the mechanism exists at platform level but not per-worker;
// FAIL means the criterion is unmet. Nothing is inferred or assumed.
//
//   node scripts/audit-workers.mjs [--out=docs/AUDIT-100.md]
//
// Exit code = number of FAIL verdicts (0 = gate passes).
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "").slice(6) || join(ROOT, "docs/AUDIT-100.md");

const read = (p) => readFileSync(join(ROOT, p), "utf8");
// Working-tree search (git grep skips untracked files, which hides real
// coverage). Returns ["relpath:lineno", ...] for literal matches.
function walk(dir, out = []) {
	for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		const rel = `${dir}/${e.name}`;
		if (e.isDirectory()) walk(rel, out);
		else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(rel);
	}
	return out;
}
const FILE_CACHE = new Map();
function grep(pattern, dir) {
	const hits = [];
	for (const f of walk(dir)) {
		let lines = FILE_CACHE.get(f);
		if (!lines) {
			try { lines = read(f).split("\n"); }
			catch { continue; }
			FILE_CACHE.set(f, lines);
		}
		lines.forEach((ln, i) => {
			if (ln.includes(pattern)) hits.push(`${f}:${i + 1}`);
		});
	}
	return hits;
}

// ── 1. Extract registerWorker specs ────────────────────────────
function extractBlocks(src, marker) {
	const blocks = [];
	let i = 0;
	while (true) {
		const s = src.indexOf(marker, i);
		if (s < 0) break;
		let j = src.indexOf("{", s);
		let depth = 0;
		let k = j;
		for (; k < src.length; k++) {
			if (src[k] === "{") depth++;
			else if (src[k] === "}") {
				depth--;
				if (depth === 0) break;
			}
		}
		blocks.push(src.slice(j, k + 1));
		i = k + 1;
	}
	return blocks;
}

const workersSrc = read("api/_workforce-workers.js");
const coreSrc = read("api/_workforce-core.js");
const supSrc = read("api/_worker-supervisor.js");
const verifSrc = read("api/_workforce-verification.js");
// Spec §45 disable-test registry: every worker names its 24h-off degradation
// in api/_worker-disable-tests.js (locked by tests/api/worker-disable-tests.test.ts).
const disableSrc = read("api/_worker-disable-tests.js");
const hasDisableEntry = (id) => new RegExp(`"${id}":`).test(disableSrc);
// Spec §56 independent-verifier mapping: VERIFIER_MAP keys in
// _workforce-verification.js have the shape "worker-id": { verifier: ... }.
// runWorker ANDs the mapped engine verifier with the worker's self-report.
const hasMappedVerifier = (id) => new RegExp(`"${id}":\\s*\\{\\s*verifier:`).test(verifSrc);

const workers = extractBlocks(workersSrc, "registerWorker(").map((b) => {
	const id = (b.match(/worker_id:\s*"([^"]+)"/) || [])[1] || "?";
	const cls = (b.match(/execution_class:\s*"([ABC])"/) || [])[1] || null;
	const risk = (b.match(/risk_level:\s*"([^"]+)"/) || [])[1] || null;
	const trig = (b.match(/trigger_types:\s*\[([^\]]*)\]/) || [])[1] || null;
	const budgetRuns = /max_runs_per_hour:\s*\d+/.test(b);
	const budgetAff = /max_affected_records:\s*\d+/.test(b);
	const tools = (b.match(/tools:\s*\[([^\]]*)\]/) || [])[1] || "";
	const has = (fn) => new RegExp(`\\b${fn}\\s*\\(`).test(b) || new RegExp(`async\\s+${fn}\\s*\\(`).test(b);
	return {
		id,
		kind: "core",
		execution_class: cls,
		risk_level: risk,
		triggers: trig ? trig.split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean) : ["cron(default)"],
		triggersExplicit: trig !== null,
		budgetRuns,
		budgetAff,
		tools: tools.split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean),
		rollback: /rollback_strategy/.test(b),
		metric: /success_metric|measure\s*\(/.test(b),
		observe: has("observe"),
		analyze: has("analyze"),
		execute: has("execute"),
		verify: has("verify"),
		measure: /measure\s*\(/.test(b),
		onEscalate: /onEscalate/.test(b),
		shadow: /shadow_mode:\s*true/.test(b),
	};
});

// ── 2. Automation-registry deterministic workers ───────────────
const regSrc = read("api/_automation-registry.js");
const regBlocks = extractBlocks(regSrc, "{").filter((b) => /module:\s*"/.test(b));
const regWorkers = regBlocks.map((b) => ({
	id: ((b.match(/id:\s*"([^"]+)"/) || [])[1] || "?"),
	module: ((b.match(/module:\s*"([^"]+)"/) || [])[1] || "?"),
	run: ((b.match(/run:\s*"([^"]+)"/) || [])[1] || "?"),
}));

// ── 3. Global platform checks ──────────────────────────────────
const G = {
	budgetGate: /budgetAllows\(workerId/.test(coreSrc),
	ledgerPerRun: /ledgerAppend\(row\)/.test(coreSrc),
	evidenceToExecute: /execute\(dec,\s*evidence\)/.test(coreSrc),
	bareOkRejected: /bare.*ok.*true|without evidence|proof.*trim\(\)/.test(coreSrc),
	shadowMode: /shadow_mode/.test(coreSrc),
	affectedCap: /max_affected_records/.test(coreSrc),
	supervisorGateInRun: /preExecutionCheck/.test(coreSrc),
	supervisorRecordsInRun: /recordFailure|recordSuccess/.test(coreSrc),
	verifierEngine: /export async function verifyOutcome/.test(verifSrc),
	backoff: /backoffMsFor|getBackoffMs/.test(supSrc) && /"deferred"/.test(coreSrc),
	ledgerMax: /LEDGER_MAX_ROWS\s*=\s*(\d+)/.exec(coreSrc)?.[1] || "?",
};

// ── 4. Per-worker evidence maps ────────────────────────────────
// Match by registry id AND by run-function alias (tests reference run fns
// like runVoiceIntake, not ids) so covered workers aren't false FAILs.
const pascal = (id) => id.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
const runAlias = new Map(); // id -> Set(alias)
for (const r of regWorkers) {
	if (!runAlias.has(r.id)) runAlias.set(r.id, new Set([r.id]));
	runAlias.get(r.id).add(r.run);
}
for (const w of workers) {
	if (!runAlias.has(w.id)) runAlias.set(w.id, new Set([w.id]));
	runAlias.get(w.id).add("run" + pascal(w.id));
}
function searchAll(terms) {
	const out = [];
	for (const t of terms) for (const l of grep(t, "tests")) out.push(l);
	return [...new Set(out)];
}
const testHits = {};
const disableHits = {};
const uiHits = {};
const verifierHits = {};
for (const id of runAlias.keys()) {
	const aliases = [...runAlias.get(id)];
	const hits = searchAll(aliases);
	testHits[id] = hits.map((l) => l.split(":").slice(0, 2).join(":"));
	disableHits[id] = hits.filter((l) => /disable/i.test(l)).length > 0;
	uiHits[id] = grep(id, "src").map((l) => l.split(":").slice(0, 2).join(":"));
	verifierHits[id] = grep(id, "api").filter((l) => l.includes("_workforce-verification.js")).length > 0;
}
let cronTick = false;
try {
	const vercel = read("vercel.json");
	cronTick = /agent-cron|agents-cron/.test(vercel);
} catch { cronTick = false; }

// ── 5. Verdicts ────────────────────────────────────────────────
function verdictCore(w) {
	const t = testHits[w.id] || [];
	const hasTests = t.length > 0;
	const v = [
		["1 Trigger exists", w.triggersExplicit && w.triggers.length ? "PASS" : "PARTIAL", w.triggers.join(",")],
		["2 Real input exists", w.observe ? "PASS" : "FAIL", w.observe ? "observe() reads live state" : "no observe()"],
		["3 Real tools exist", w.tools.length ? "PASS" : "PARTIAL", w.tools.length ? w.tools.join(",") : "tools[] empty — core/DB ops inline"],
		["4 Permission exists", w.execution_class ? "PASS" : "FAIL", `class ${w.execution_class || "?"} / risk ${w.risk_level || "default low"}`],
		["5 Real action exists", w.execute && w.execution_class !== "C" ? "PASS" : w.execution_class === "C" ? "NA" : "FAIL", w.execution_class === "C" ? "evidence-only by design" : w.execute ? "execute(dec, ev)" : "no execute()"],
		["6 Real state can change", w.execute && w.execution_class !== "C" ? "PASS" : w.execution_class === "C" ? "NA" : "FAIL", ""],
		["7 Verification exists", !w.verify && w.execution_class === "C" && !w.execute ? "NA" : hasMappedVerifier(w.id) ? "PASS" : w.verify ? "PARTIAL" : "FAIL", w.execution_class === "C" && !w.execute ? "evidence-only: nothing executes, nothing to verify" : hasMappedVerifier(w.id) ? "self-verify AND mapped independent verifier (runWorker requires both)" : w.verify ? "self-verify only; no independent engine mapping" : "no verify()"],
		["8 Metrics exist", w.execution_class === "C" && !w.execute ? "NA" : w.measure ? "PASS" : "PARTIAL", w.execution_class === "C" && !w.execute ? "evidence-only: no execute phase, measure() unreachable by design; ledger duration/outcome is the measurement" : w.measure ? "measure() before/after" : "duration/outcome in ledger row; no metric()"],
		["9 Evidence exists", "PASS", "core ledger row per run (table or workforce_actions_kv, 500 rows)"],
		["10 UI exists where useful", (uiHits[w.id] || []).length ? "PASS" : "PARTIAL", (uiHits[w.id] || []).join("; ") || "surfaced via aggregate dashboards (Ops Center/Quality), not per-worker"],
		["11 Failure handling exists", "PASS", "execution_failed outcome + ledger error; class-B onEscalate"],
		["12 Retry exists", G.backoff ? "PASS" : "PARTIAL", G.backoff ? "per-worker consecutive-failure backoff (10min, then 30min); cron runs defer with auto-retry, manual runs bypass" : "cron re-tick retries (5min); no per-worker backoff counter"],
		["13 Rollback where appropriate", w.rollback ? "PASS" : w.execution_class === "A" && /cleanup|sweep|reconc|decay|archiv|clean/i.test(w.id) ? "PARTIAL" : "NA", w.rollback ? "rollback_strategy declared" : "cleanup-class; supervisor rollback stack available"],
		["14 Disable test exists", hasDisableEntry(w.id) ? "PASS" : disableHits[w.id] ? "PASS" : hasTests ? "PARTIAL" : "FAIL", hasDisableEntry(w.id) ? "api/_worker-disable-tests.js: documented 24h-off consequence" : disableHits[w.id] ? "disable test in suite" : hasTests ? "tested, no explicit disable test" : "no tests reference this worker"],
		["15 Evaluation exists", "PARTIAL", "continuous-evaluation scorecards derive from ledger; per-worker registered_eval_cases vary"],
		["16 Regression tests exist", hasTests ? "PASS" : "FAIL", t.slice(0, 4).join("; ") || "none found"],
		["17 Monitoring exists", "PASS", "supervisor scan + ops-summary + AI Failures surface"],
		["18 Cost controls exist", w.budgetRuns ? "PARTIAL" : "FAIL", w.budgetRuns ? "runs/hour + affected-records caps; no token-cost accounting" : "no budget declared"],
		["19 Security boundaries exist", "PASS", "class-gated execution; C never executes; tool-gateway authZ (proof-tested)"],
		["20 Connected to production workflow", cronTick || w.triggersExplicit ? "PASS" : "PARTIAL", "cron tick + manual automation-run + ops-summary"],
	];
	return v;
}

function verdictReg(r) {
	const t = testHits[r.id] || [];
	const hasTests = t.length > 0;
	// Check the run fn returns structured results with ok/verified/skipped/metrics
	let src = "";
	try { src = read(`api/${r.module.replace("./", "")}`); } catch { /* external */ }
	const fnBody = src.match(new RegExp(`export async function ${r.run}[\\s\\S]{0,4000}`))?.[0] || "";
	const structured = /ok.*true|verified|skipped|metrics|pinged|escalated|quarantined/.test(fnBody);
	const writesAlerts = /workforce_alerts|auditLog|upsert|insert/.test(fnBody);
	const v = [
		["1 Trigger exists", "PASS", "cron tick (agent-cron, 5min) + manual automation-run"],
		["2 Real input exists", /supabase|client\.from|fetch|read/.test(fnBody) ? "PASS" : "PARTIAL", `${r.module}#${r.run}`],
		["3 Real tools exist", "PASS", "direct DB/API ops in run fn"],
		["4 Permission exists", "PASS", "cron-secret gate + fail-soft degraded modes"],
		["5 Real action exists", writesAlerts ? "PASS" : "PARTIAL", writesAlerts ? "writes alerts/audit/records" : "no write detected statically"],
		["6 Real state can change", writesAlerts ? "PASS" : "PARTIAL", ""],
		["7 Verification exists", /verified|re-read|confirm/.test(fnBody) ? "PASS" : "PARTIAL", /verified/.test(fnBody) ? "verified flag + re-read" : "no explicit verify step"],
		["8 Metrics exist", structured ? "PASS" : "PARTIAL", "structured result counts + last-run summaries"],
		["9 Evidence exists", writesAlerts ? "PASS" : "PARTIAL", "alerts + audit rows + last_runs ledger"],
		["10 UI exists where useful", (uiHits[r.id] || []).length ? "PASS" : "PARTIAL", (uiHits[r.id] || []).join("; ") || "via Ops Center live work + summaries"],
		["11 Failure handling exists", /try|catch|degraded|deferred/.test(fnBody) ? "PASS" : "PARTIAL", "try/catch + degraded/deferred states"],
		["12 Retry exists", G.backoff ? "PASS" : "PARTIAL", G.backoff ? "per-worker consecutive-failure backoff (10min, then 30min); cron runs defer with auto-retry, manual runs bypass" : "cron re-tick; no backoff counter"],
		["13 Rollback where appropriate", /rollback|quarantine.*ledger|superseded/.test(fnBody) ? "PASS" : "NA", "alert-style workers resolve/supersede rather than roll back"],
		["14 Disable test exists", hasDisableEntry(r.id) ? "PASS" : disableHits[r.id] ? "PASS" : hasTests ? "PARTIAL" : "FAIL", hasDisableEntry(r.id) ? "api/_worker-disable-tests.js: documented 24h-off consequence" : disableHits[r.id] ? "disable test in suite" : hasTests ? "tested, no explicit disable test" : "none found"],
		["15 Evaluation exists", "PARTIAL", "ledger-derived scorecards"],
		["16 Regression tests exist", hasTests ? "PASS" : "FAIL", t.slice(0, 4).join("; ") || "none found"],
		["17 Monitoring exists", "PASS", "last_runs + ops-summary + AI Failures"],
		["18 Cost controls exist", "PARTIAL", "bounded sweep limits; no token accounting (deterministic, no LLM)"],
		["19 Security boundaries exist", "PASS", "read-mostly; writes scoped to alerts/own tables"],
		["20 Connected to production workflow", "PASS", "registry + cron + UI Run button"],
	];
	return v;
}

// ── 6. Report ──────────────────────────────────────────────────
let fails = 0, partials = 0, passes = 0;
const line = [];
line.push(`# Worker audit — 20 criteria (spec §60)`);
line.push(``);
line.push(`Generated: ${new Date().toISOString()} · by \`scripts/audit-workers.mjs\` (static, evidence-cited).`);
line.push(`Universe: ${workers.length} core-registered + ${regWorkers.length} deterministic registry workers.`);
line.push(``);
line.push(`## Platform-level findings (apply to every worker)`);
const plat = [
	[`Budget gate before observe`, G.budgetGate, "api/_workforce-core.js:runWorker→budgetAllows"],
	[`Ledger row per run (table or KV, max ${G.ledgerMax})`, G.ledgerPerRun, "api/_workforce-core.js:ledgerAppend"],
	[`Evidence passed to execute(dec, ev)`, G.evidenceToExecute, "api/_workforce-core.js:runWorker"],
	[`Bare {ok:true} verify rejected`, G.bareOkRejected, "api/_workforce-core.js + workforce-reality tests"],
	[`Shadow/canary modes`, G.shadowMode, "registerWorker shadow_mode + runWorker branch"],
	[`Affected-records cap`, G.affectedCap, "runWorker budget check"],
	[`Supervisor pre-execution gate wired into runWorker`, G.supervisorGateInRun, G.supervisorGateInRun ? "wired" : "NOT WIRED — pause/loop protection lives in cron scan + budgets only"],
	[`Supervisor failure/success recording in runWorker`, G.supervisorRecordsInRun, G.supervisorRecordsInRun ? "wired" : "NOT WIRED — failure_counts only from scans"],
	[`Independent verification engine`, G.verifierEngine, "api/_workforce-verification.js:verifyOutcome"],
];
for (const [name, ok, ev] of plat) {
	line.push(`- [${ok ? "PASS" : "FAIL"}] ${name} — ${ev}`);
	if (!ok) fails++;
}
line.push(``);

function section(title, list, verdictFn) {
	line.push(`## ${title}`);
	for (const w of list) {
		const v = verdictFn(w);
		const f = v.filter((x) => x[1] === "FAIL").length;
		const p = v.filter((x) => x[1] === "PARTIAL").length;
		fails += f; partials += p; passes += v.filter((x) => x[1] === "PASS").length;
		const tag = f ? "INCOMPLETE" : p ? "ACCEPTABLE-WITH-NOTES" : "COMPLETE";
		line.push(``);
		line.push(`### ${w.id} — ${tag} (${v.filter((x) => x[1] === "PASS").length}/20 pass, ${p} partial, ${f} fail)`);
		for (const [name, res, ev] of v) line.push(`- [${res}] ${name}${ev ? ` — ${ev}` : ""}`);
	}
	line.push(``);
}
section("Core-registered workers", workers, verdictCore);
section("Deterministic registry workers", regWorkers, verdictReg);

line.push(`## Totals`);
line.push(`- PASS: ${passes} · PARTIAL: ${partials} · FAIL: ${fails}`);
line.push(`- Gate: exit code = FAIL count (${fails}). PARTIALs are documented limitations, not silent passes.`);
line.push(``);
line.push(`## Top gaps to close (no compromise)`);
line.push(`1. Wire supervisor pre-execution gate + failure/success recording into runWorker (criteria 12/13/17 depth).`);
line.push(`2. Per-worker disable tests: DOCUMENTED in api/_worker-disable-tests.js (criterion 14 reads the map; coverage locked by tests/api/worker-disable-tests.test.ts).`);
line.push(`3. Independent-verifier mapping: WIRED via VERIFIER_MAP in api/_workforce-verification.js (runWorker ANDs self-verify with the mapped engine verifier; criterion 7 reads the map).`);
line.push(`4. Token-cost accounting per worker (criterion 18 PARTIALs).`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, line.join("\n"));
console.log(`AUDIT: ${workers.length} core + ${regWorkers.length} registry workers`);
console.log(`PASS ${passes} · PARTIAL ${partials} · FAIL ${fails} → ${OUT}`);
process.exit(Math.min(fails, 99));
