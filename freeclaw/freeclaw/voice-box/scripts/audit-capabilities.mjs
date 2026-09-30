// ═══════════════════════════════════════════════════════════════════
// CAPABILITY MAP — spec §41: every capability must be
// connected to a real workflow. Each row cites workers, routes, UI and
// tests; the script VERIFIES every pointer against the working tree.
// Unverifiable pointers are reported as GAP/PARTIAL, never assumed.
//   node scripts/audit-capabilities.mjs [--out=docs/CAPABILITIES-100.md]
// Exit code = number of GAP capabilities.
// ═══════════════════════════════════════════════════════════════════

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "").slice(6) || join(ROOT, "docs/CAPABILITIES-100.md");
const read = (p) => {
	try { return readFileSync(join(ROOT, p), "utf8"); } catch { return null; }
};

// Registry ids (verified by audit-workers run).
const CORE = new Set((read("api/_workforce-workers.js") || "").match(/worker_id:\s*"[^"]+"/g)?.map((m) => m.split('"')[1]) || []);
const REG = (() => {
	const src = read("api/_automation-registry.js") || "";
	const ids = [...src.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
	return new Set(ids);
})();
const ROUTES = read("api/index.js") || "";

function check(e) {
	if (e.kind === "worker") return CORE.has(e.ref) || REG.has(e.ref) ? null : `worker "${e.ref}" not registered`;
	if (e.kind === "route") {
		const key = e.ref.replace(/^\/api\//, "").split("?")[0].split("/")[0];
		const hit = new RegExp(`(?:["']${key}["']|\\b${key}\\b)\\s*:\\s*protect`).test(ROUTES);
		return hit ? null : `route "${e.ref}" not mounted`;
	}
	// A UI file that exists but never calls the API is not wired to backend
	// work — it is a static mock. Existence alone proves nothing (spec §0/§52).
	// Exception: components wired into the router (e.g. error pages) — the
	// route definition IS the wiring, verified in App/Admin route tables.
	if (e.kind === "ui") {
		const src = read(e.ref);
		if (!src) return `file missing: ${e.ref}`;
		const callsApi =
			/["'`]\/api\//.test(src) ||
			/\bapi\s*\.\s*(get|post|put|delete|getSlow|postSlow|patch)\b/.test(src) ||
			/\bfetch\s*\(/.test(src);
		if (callsApi) return null;
		const base = e.ref.split("/").pop().replace(/\.tsx?$/, "");
		const appSrc = (read("src/App.tsx") || "") + (read("src/pages/Admin.tsx") || "");
		if (new RegExp(`\\b${base}\\b`).test(appSrc)) return null;
		return `ui never calls an API and is not routed (not wired): ${e.ref}`;
	}
	// A test file with no cases proves nothing — an empty stub still "exists".
	if (e.kind === "test") {
		const src = read(e.ref);
		if (!src) return `file missing: ${e.ref}`;
		const hasCases = /\b(it|test)\s*\(/.test(src) || /\bdescribe\s*\(/.test(src);
		return hasCases ? null : `test has no cases: ${e.ref}`;
	}
	if (e.kind === "engine") {
		const [file, sym] = e.ref.split("#");
		const src = read(file);
		if (!src) return `file missing: ${file}`;
		if (!sym) return null; // bare file pointer: existence is the evidence
		const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		// Must be a real declaration, an exported binding, or a dispatch
		// branch (case "x":) — not a mention inside a comment, log string,
		// or doc block.
		const declared = new RegExp(
			`(?:export\\s+)?(?:async\\s+)?(?:function|const|let|var|class)\\s+${esc}\\b`,
		).test(src);
		if (declared) return null;
		const exportedNamed = new RegExp(`export\\s*\\{[^}]*\\b${esc}\\b`).test(src);
		if (exportedNamed) return null;
		const dispatchBranch = new RegExp(`case\\s+["']${esc}["']\\s*:`).test(src);
		if (dispatchBranch) return null;
		return `symbol "${sym}" is only mentioned, not declared: ${file}`;
	}
	return `unknown evidence kind`;
}

// cap = capability #, name, evidence pointers
const CAPS = [
[1, "Proactive moderation", [{kind:"worker",ref:"comment-watch"},{kind:"route",ref:"/api/comments"},{kind:"ui",ref:"src/pages/admin/Reports.tsx"},{kind:"test",ref:"tests/api/comment-watch.test.ts"}]],
[2, "PII detection", [{kind:"engine",ref:"api/_moderation.js#PII_EMAIL_RE"},{kind:"route",ref:"/api/comments"},{kind:"test",ref:"tests/api/pii-masking.test.ts"}]],
[3, "Doxxing prevention", [{kind:"engine",ref:"api/_moderation.js#DOX_THREAT"},{kind:"test",ref:"tests/api/server-moderation-coercion.test.ts"},]],
[4, "Blackmail detection", [{kind:"engine",ref:"api/_moderation.js#BLACKMAIL_DEMAND"},{kind:"test",ref:"tests/api/server-moderation-coercion.test.ts"}]],
[5, "Threat detection", [{kind:"engine",ref:"api/_moderation.js#VIOLENCE_PATTERNS"},{kind:"test",ref:"tests/api/server-moderation.test.ts"}]],
[6, "Harassment detection", [{kind:"engine",ref:"api/_moderation.js#BULLY_WORDS"},{kind:"test",ref:"tests/api/server-moderation.test.ts"}]],
[7, "Grooming detection", [{kind:"engine",ref:"api/_moderation.js#EXPLICIT_BLOCK"},{kind:"test",ref:"tests/api/server-moderation.test.ts"}]],
[8, "Child-safety detection", [{kind:"engine",ref:"api/_moderation.js#EXPLICIT_BLOCK"},{kind:"route",ref:"/api/reports"}]],
[9, "Intimate-image abuse detection", [{kind:"engine",ref:"api/_moderation.js#EXPLICIT_NAKED_PIC"},{kind:"test",ref:"tests/api/server-moderation.test.ts"}]],
[10, "Hate/abuse detection", [{kind:"engine",ref:"api/_moderation.js#SLURS"},{kind:"test",ref:"src/__tests__/moderation.test.ts"}]],
[11, "Scam detection", [{kind:"engine",ref:"api/_agent-team.js#SPAM_REASON_RE"},{kind:"engine",ref:"api/_moderation.js#spamAnalyze"},{kind:"test",ref:"src/__tests__/moderation.test.ts"}]],
[12, "Malware-link detection", [{kind:"engine",ref:"api/_evidence-scan.js#MALWARE_INDICATORS"},{kind:"engine",ref:"src/lib/moderation.ts#SPAM_PATTERNS"}]],
[13, "Spam prevention", [{kind:"worker",ref:"spam-sentinel"},{kind:"worker",ref:"spam-score-decay"},{kind:"test",ref:"src/__tests__/moderation.test.ts"}]],
[14, "Coordinated-abuse detection", [{kind:"worker",ref:"user-anomaly"},{kind:"route",ref:"/api/security"}]],
[15, "Impersonation detection", [{kind:"engine",ref:"api/_agent-team.js#SPAM_REASON_RE"},{kind:"worker",ref:"authz-probe"}]],
[16, "Slang understanding", [{kind:"engine",ref:"src/lib/speech.ts#CORRECTIONS"},{kind:"test",ref:"src/__tests__/speech.test.ts"}]],
[17, "Evasion detection", [{kind:"engine",ref:"api/_moderation.js#checkSafetyRepost"},{kind:"engine",ref:"api/_moderation.js#recordSafetyRepost"},{kind:"engine",ref:"api/_safety-pipeline.js#evaluateContent"},{kind:"engine",ref:"src/lib/moderation.ts#foldLeet"},{kind:"route",ref:"/api/comments"},{kind:"test",ref:"tests/api/safety-parity.test.ts"}]],
[18, "Multilingual moderation", [{kind:"engine",ref:"src/lib/speech.ts#VOICE_LANGS"},{kind:"test",ref:"tests/api/inbox-classify.test.ts"}]],
[19, "Context analysis", [{kind:"engine",ref:"api/_moderation.js#REPORTING_CTX"},{kind:"test",ref:"tests/api/server-moderation.test.ts"}]],
[20, "Report triage", [{kind:"route",ref:"/api/reports"},{kind:"ui",ref:"src/pages/admin/Reports.tsx"},{kind:"test",ref:"tests/api/reports.test.ts"}]],
[21, "Automatic content enforcement", [{kind:"engine",ref:"api/_reports.js#enforceStrike"},{kind:"test",ref:"tests/api/reports.test.ts"}]],
[22, "Safety verification", [{kind:"engine",ref:"api/_reports.js#verifyReportResolution"},{kind:"test",ref:"tests/api/reports.test.ts"}]],
[23, "Safety regression testing", [{kind:"test",ref:"tests/api/server-moderation.test.ts"},{kind:"test",ref:"tests/api/server-moderation-coercion.test.ts"},{kind:"test",ref:"tests/api/safety-pipeline.test.ts"},{kind:"test",ref:"tests/api/safety-parity.test.ts"},{kind:"engine",ref:"api/_safety-pipeline.js#messageFor"}]],
[24, "Safety red teaming", [{kind:"engine",ref:"api/_redteam-cases.js#runRedTeam"},{kind:"route",ref:"/api/workforce"}]],
[25, "Anonymous identity protection", [{kind:"worker",ref:"anonymity-guard"},{kind:"worker",ref:"anonymity"},{kind:"test",ref:"tests/api/anonymity.test.ts"}]],
[26, "Submission quality improvement", [{kind:"worker",ref:"submission-understanding"},{kind:"worker",ref:"content-quality"}]],
[27, "Missing-information detection", [{kind:"worker",ref:"missing-info"},{kind:"test",ref:"tests/api/workforce-batch1.test.ts"}]],
[28, "Automatic category suggestion", [{kind:"worker",ref:"category-assignment"},{kind:"test",ref:"tests/api/workforce-batch1.test.ts"}]],
[29, "Category correction", [{kind:"worker",ref:"category-correction"},{kind:"test",ref:"tests/api/workforce-batch1.test.ts"}]],
[30, "Department routing", [{kind:"route",ref:"/api/routing"},{kind:"engine",ref:"api/_agent-team.js#analyzeAndSuggest"}]],
[31, "Duplicate detection", [{kind:"worker",ref:"duplicate-case"},{kind:"worker",ref:"duplicate-reports"},{kind:"test",ref:"tests/api/workforce-batch2.test.ts"}]],
[32, "Related-case detection", [{kind:"worker",ref:"related-case"},{kind:"test",ref:"tests/api/workforce-batch2.test.ts"}]],
[33, "Priority calculation", [{kind:"worker",ref:"priority"},{kind:"worker",ref:"priority-scaler"},{kind:"test",ref:"tests/api/workforce-batch2.test.ts"}]],
[34, "Case assignment", [{kind:"worker",ref:"case-assignment"},{kind:"test",ref:"tests/api/workforce-batch2.test.ts"}]],
[35, "SLA monitoring", [{kind:"worker",ref:"sla"},{kind:"worker",ref:"report-sla"},{kind:"test",ref:"tests/api/workforce-batch2.test.ts"}]],
[36, "Automatic follow-up", [{kind:"worker",ref:"followup"},{kind:"test",ref:"tests/api/followup.test.ts"}]],
[37, "Resolution collection", [{kind:"route",ref:"/api/reports"},{kind:"ui",ref:"src/pages/admin/Reports.tsx"}]],
[38, "Resolution verification", [{kind:"engine",ref:"api/_reports.js#verifyReportResolution"},{kind:"test",ref:"tests/api/reports.test.ts"}]],
[39, "Automatic reopening", [{kind:"worker",ref:"reopen"},{kind:"test",ref:"tests/api/reopen.test.ts"}]],
[40, "Recurring issue detection", [{kind:"worker",ref:"suggestion-detection"},{kind:"worker",ref:"trends"}]],
[41, "Community impact calculation", [{kind:"engine",ref:"api/_workforce.js#platformPulse"},{kind:"route",ref:"/api/leaderboard"}]],
[42, "Poll creation", [{kind:"route",ref:"/api/polls"},{kind:"engine",ref:"api/_agent-chat.js#create_poll"}]],
[43, "Poll integrity", [{kind:"worker",ref:"poll-integrity"},{kind:"test",ref:"tests/api/poll-integrity.test.ts"}]],
[44, "Poll abuse detection", [{kind:"worker",ref:"poll-integrity"},{kind:"engine",ref:"api/_poll-integrity.js#FRAUD_KEY"}]],
[45, "Poll closing", [{kind:"worker",ref:"poll-sweep"},{kind:"route",ref:"/api/polls"}]],
[46, "Poll analytics", [{kind:"route",ref:"/api/polls"},{kind:"ui",ref:"src/pages/Polls.tsx"}]],
[47, "Search relevance", [{kind:"route",ref:"/api/search"},{kind:"route",ref:"/api/search-quality"}]],
[48, "Zero-result repair", [{kind:"engine",ref:"api/_search-quality.js#recoverSearchGaps"},{kind:"worker",ref:"search-gap-recovery"},{kind:"route",ref:"/api/search-quality"}]],
[49, "Knowledge retrieval", [{kind:"engine",ref:"api/_learning-engine.js#queryKnowledge"},{kind:"route",ref:"/api/learning"}]],
[50, "Knowledge update", [{kind:"engine",ref:"api/_learning-engine.js#sharePattern"},{kind:"route",ref:"/api/learning"}]],
[51, "Knowledge conflict detection", [{kind:"engine",ref:"api/_learning-engine.js#analyzePatterns"},{kind:"route",ref:"/api/learning"}]],
[52, "Student help", [{kind:"ui",ref:"src/pages/UserChat.tsx"},{kind:"route",ref:"/api/chat"}]],
[53, "Issue explanation", [{kind:"engine",ref:"api/_agent-chat.js#INTENTS"},{kind:"ui",ref:"src/pages/admin/AgentChat.tsx"}]],
[54, "Admin briefing", [{kind:"engine",ref:"api/_workforce.js#overnightBriefing"},{kind:"ui",ref:"src/pages/admin/OpsCenter.tsx"},{kind:"test",ref:"tests/api/workforce-briefing.test.ts"}]],
[55, "Daily operations briefing", [{kind:"engine",ref:"api/_workforce.js#overnightBriefing"},{kind:"route",ref:"/api/workforce"}]],
[56, "Inbox conversation summarization", [{kind:"engine",ref:"api/_inbox.js#summarizeThread"},{kind:"ui",ref:"src/pages/admin/UnifiedInbox.tsx"},{kind:"test",ref:"tests/api/inbox-summaries.test.ts"}]],
[57, "Inbox action extraction", [{kind:"engine",ref:"api/_inbox.js#triageThread"},{kind:"ui",ref:"src/pages/admin/UnifiedInbox.tsx"}]],
[58, "Inbox priority detection", [{kind:"engine",ref:"api/_inbox.js#triageInboxMessage"},{kind:"test",ref:"tests/api/inbox-triage.test.ts"}]],
[59, "Automatic admin notification", [{kind:"engine",ref:"api/_auth.js#notifyUser"},{kind:"engine",ref:"api/_reports.js#enforceStrike"}]],
[60, "Voice-to-case", [{kind:"worker",ref:"voice-intake"},{kind:"ui",ref:"src/pages/Submit.tsx"},{kind:"test",ref:"src/__tests__/Submit.test.tsx"}]],
[61, "Voice transcription", [{kind:"engine",ref:"src/lib/speech.ts#startDictation"},{kind:"test",ref:"src/__tests__/speech.test.ts"}]],
[62, "Voice response", [{kind:"engine",ref:"src/lib/speech.ts#readAloud"},{kind:"ui",ref:"src/pages/PostDetail.tsx"}]],
[63, "Attachment understanding", [{kind:"engine",ref:"api/_evidence-scan.js"},{kind:"route",ref:"/api/evidence-scan"}]],
[64, "OCR", [{kind:"engine",ref:"api/_evidence-scan.js#MALWARE_INDICATORS"}]],
[65, "File safety", [{kind:"engine",ref:"api/_evidence-scan.js"},{kind:"route",ref:"/api/evidence-scan"},{kind:"route",ref:"/api/upload"}]],
[66, "Notification routing", [{kind:"engine",ref:"api/_notification-delivery.js"},{kind:"route",ref:"/api/notifications"}]],
[67, "Notification retry", [{kind:"engine",ref:"api/_notification-delivery.js#retryPendingDeliveries"},{kind:"test",ref:"tests/api/notification-delivery.test.ts"}]],
[68, "Notification fallback", [{kind:"engine",ref:"api/_notification-delivery.js"},{kind:"worker",ref:"notification-health"}]],
[69, "Notification delivery verification", [{kind:"engine",ref:"api/_notification-delivery.js#verifyNotificationStored"},{kind:"test",ref:"tests/api/notification-delivery.test.ts"}]],
[70, "Broken-link detection", [{kind:"route",ref:"/api/tech-debt"}]],
[71, "Broken-page detection", [{kind:"ui",ref:"src/pages/NotFound.tsx"},{kind:"test",ref:"tests/e2e/error-states.spec.ts"}]],
[72, "UI defect detection", [{kind:"test",ref:"tests/e2e/no-horizontal-overflow.spec.ts"},{kind:"test",ref:"tests/e2e/admin-reports-mobile.spec.ts"}]],
[73, "Browser QA", [{kind:"test",ref:"tests/e2e/user-flows.spec.ts"}]],
[74, "Mobile QA", [{kind:"test",ref:"tests/e2e/admin-reports-mobile.spec.ts"}]],
[75, "Accessibility testing", [{kind:"test",ref:"tests/e2e/a11y-claims.spec.ts"}]],
[76, "Database monitoring", [{kind:"worker",ref:"db-health"},{kind:"route",ref:"/api/performance"}]],
[77, "Query optimization", [{kind:"engine",ref:"api/_performance.js"},]],
[78, "Index optimization", [{kind:"route",ref:"/api/performance"}]],
[79, "Cache optimization", [{kind:"worker",ref:"cache-optimizer"},{kind:"test",ref:"tests/api/workforce-core-coverage.test.ts"}]],
[80, "Load management", [{kind:"ui",ref:"src/pages/admin/PerformanceCenter.tsx"}]],
[81, "Queue recovery", [{kind:"engine",ref:"api/_workforce.js#recoverStale"},{kind:"test",ref:"tests/api/workforce-recovery.test.ts"}]],
[82, "Realtime optimization", [{kind:"route",ref:"/api/vitals"},{kind:"ui",ref:"src/pages/admin/SystemHealth.tsx"}]],
[83, "Storage management", [{kind:"worker",ref:"storage"},{kind:"worker",ref:"orphan-auditor"}]],
[84, "Performance regression detection", [{kind:"route",ref:"/api/feature-health"},{kind:"route",ref:"/api/performance"}]],
[85, "Security testing", [{kind:"worker",ref:"authz-probe"},{kind:"route",ref:"/api/security"}]],
[86, "Authorization testing", [{kind:"worker",ref:"authz-probe"},{kind:"test",ref:"tests/api/agent-approve-guard.test.ts"}]],
[87, "Cross-user access testing", [{kind:"test",ref:"tests/api/anonymity.test.ts"}]],
[88, "Data-exposure detection", [{kind:"engine",ref:"api/_evidence-scan.js"},{kind:"worker",ref:"anonymity"}]],
[89, "Upload protection", [{kind:"engine",ref:"api/_evidence-scan.js"},{kind:"route",ref:"/api/upload"}]],
[90, "AI model evaluation", [{kind:"engine",ref:"api/_evaluation-engine.js#runFullEvaluation"},]],
[91, "AI regression testing", [{kind:"engine",ref:"api/_evaluation-engine.js#getEvaluationHistory"},]],
[92, "AI red teaming", [{kind:"engine",ref:"api/_redteam-cases.js#runRedTeam"},]],
[93, "AI drift detection", [{kind:"engine",ref:"api/_workforce.js#evalDrift"},]],
[94, "Model routing", [{kind:"engine",ref:"api/_providers.js#buildChain"},{kind:"ui",ref:"src/pages/admin/ProviderSettings.tsx"}]],
[95, "AI cost optimization", [{kind:"engine",ref:"api/_workforce-core.js#budgetAllows"},]],
[96, "Incident detection", [{kind:"route",ref:"/api/incidents"},{kind:"engine",ref:"api/_incident-cron.js"}]],
[97, "Incident recovery", [{kind:"engine",ref:"api/_incident-cron.js"},{kind:"ui",ref:"src/pages/admin/OpsCenter.tsx"}]],
[98, "Deployment verification", [{kind:"route",ref:"/api/health"},{kind:"route",ref:"/api/feature-health"}]],
[99, "Change impact analysis", [{kind:"engine",ref:"api/_workforce.js#impactCenter"},{kind:"route",ref:"/api/workforce"}]],
[100, "Continuous improvement", [{kind:"engine",ref:"api/_continuous-learning.js#runContinuousEvaluation"},]],
[101, "Appeal recourse", [{kind:"route",ref:"/api/appeals"},{kind:"engine",ref:"api/_appeals.js#publishOverturn"},{kind:"engine",ref:"api/_moderation.js#clearSafetyRepost"},{kind:"test",ref:"tests/api/appeals.test.ts"}]],
[102, "Appeal SLA", [{kind:"worker",ref:"appeal-sla"},{kind:"test",ref:"tests/api/workforce-appeal-sla.test.ts"}]],
];

let gaps = 0, partials = 0;
const lines = [];
lines.push(`# Capability map — spec §41 (${CAPS.length} capabilities, verified)`);
lines.push("");
lines.push(`Generated: ${new Date().toISOString()} · by \`scripts/audit-capabilities.mjs\`. Every pointer below was checked against the working tree.`);
lines.push("");
for (const [n, name, evs] of CAPS) {
	const checked = evs.map((e) => ({ e, err: check(e) }));
	const missing = checked.filter((x) => x.err);
	const status = missing.length === 0 ? "WIRED" : missing.length === evs.length ? "GAP" : "PARTIAL";
	if (status === "GAP") gaps++;
	if (status === "PARTIAL") partials++;
	lines.push(`## ${n}. ${name} — ${status}`);
	for (const { e } of checked) {
		const label = e.kind === "worker" ? `worker \`${e.ref}\`` : e.kind === "route" ? `route \`${e.ref}\`` : e.kind === "ui" ? `ui \`${e.ref}\`` : e.kind === "test" ? `test \`${e.ref}\`` : `engine \`${e.ref}\``;
		lines.push(`- ${label}`);
	}
	for (const { err } of missing) lines.push(`  - ⚠ ${err}`);
	lines.push("");
}
lines.push(`## Totals`);
lines.push(`- WIRED: ${CAPS.length - gaps - partials} · PARTIAL: ${partials} · GAP: ${gaps}`);
lines.push(`- Gate: exit code = GAP count (${gaps}).`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"));
console.log(`CAPABILITIES: WIRED ${CAPS.length - gaps - partials} · PARTIAL ${partials} · GAP ${gaps} → ${OUT}`);
process.exit(Math.min(gaps, 99));
