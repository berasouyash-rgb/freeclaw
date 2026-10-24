#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// AGENT BEHAVIOUR REGISTRY GENERATOR
// ═══════════════════════════════════════════════════════════════════
// Derives the canonical behaviour registry from the ACTUAL router.
//
// `processAgentTask()` in api/_agent-team.js is one long if/else over
// `hasCap(agent, ...)` groups. That is the only place that decides what an
// agent is allowed to do, so it is the source of truth for the registry —
// hand-maintaining a parallel list is how the two drift apart.
//
// For each branch we record:
//   id            stable behaviour name
//   label         human label
//   impact        'act'      → the branch writes to the database
//                 'advisory' → the branch only reads and reports
//   capabilities  the capability strings that route to this branch
//
// Re-run after editing the router:  node scripts/agent-behaviours.gen.mjs
// The drift-guard test (src/__tests__/agent-behaviours.test.ts) fails if this
// file and the router ever disagree.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEAM = path.join(ROOT, "api", "_agent-team.js");
const OUT = path.join(ROOT, "api", "_agent-behaviours.data.js");

// Branch order in processAgentTask() — used to name each behaviour. The router
// returns on first match, so order matters and must be preserved.
const BEHAVIOUR_IDS = [
	"content-moderation",
	"sentiment-categorisation",
	"trend-detection",
	"threat-detection",
	"kpi-dashboard",
	"report-triage",
	"conversation-analysis",
	"user-lifecycle",
	"duplicate-clustering",
	"poll-analysis",
	"anonymity-verification",
	"anomaly-detection",
	"feedback-prioritisation",
	"notification-routing",
	"bulk-export",
	"search-relevance",
	"intent-extraction",
	"audit-forensics",
	"uptime-slo",
	"resilience-recovery",
	"performance-profiling",
	"cache-strategy",
	"capacity-planning",
	"schema-review",
	"log-error-analysis",
	"incident-coordination",
	"rate-limit-shaping",
	"queue-reliability",
	"api-monitoring",
	"api-architecture",
	"frontend-architecture",
	"ux-heatmap",
	"bundle-analysis",
	"accessibility-audit",
	"deployment-management",
	"release-management",
	"test-strategy",
	"static-analysis",
	"tooling-design",
	"agent-design",
	"capability-gap-analysis",
	"knowledge-curation",
	"cross-domain-insight",
	"workload-balancing",
	"presentation-design",
	"documentation",
	"dependency-audit",
	"integration-management",
	"secret-rotation",
	"disaster-recovery",
	"etl-design",
	"tech-debt",
	"service-contracts",
	"git-workflow",
	"process-automation",
	"risk-scoring",
	"predictive-modelling",
];

// Local helpers that write to the database. A branch that calls one of these
// changes real state even though it contains no inline `.update(` itself.
const MUTATING_HELPERS = [
	"autoModerateSpam",
	"saveAgentReport",
	"setAgentState",
	"closeReport",
	"archivePost",
	"hidePost",
];

const LABELS = {
	"content-moderation": "Content moderation",
	"sentiment-categorisation": "Sentiment / categorisation",
	"trend-detection": "Trend detection",
	"threat-detection": "Threat detection",
	"kpi-dashboard": "KPI dashboard",
	"report-triage": "Report triage",
	"conversation-analysis": "Conversation analysis",
	"user-lifecycle": "User lifecycle",
	"duplicate-clustering": "Duplicate clustering",
	"poll-analysis": "Poll analysis",
	"anonymity-verification": "Anonymity verification",
	"anomaly-detection": "Anomaly detection",
	"feedback-prioritisation": "Feedback prioritisation",
	"notification-routing": "Notification routing",
	"bulk-export": "Bulk export",
	"search-relevance": "Search relevance",
	"intent-extraction": "Intent extraction",
	"audit-forensics": "Audit / forensics",
	"uptime-slo": "Uptime / SLO",
	"resilience-recovery": "Resilience / recovery",
	"performance-profiling": "Performance profiling",
	"cache-strategy": "Cache strategy",
	"capacity-planning": "Capacity planning",
	"schema-review": "Schema review",
	"log-error-analysis": "Log / error analysis",
	"incident-coordination": "Incident coordination",
	"rate-limit-shaping": "Rate limiting / shaping",
	"queue-reliability": "Queue reliability",
	"api-monitoring": "API monitoring",
	"api-architecture": "API architecture",
	"frontend-architecture": "Frontend architecture",
	"ux-heatmap": "UX / heatmap",
	"bundle-analysis": "Bundle analysis",
	"accessibility-audit": "Accessibility audit",
	"deployment-management": "Deployment management",
	"release-management": "Release management",
	"test-strategy": "Test strategy",
	"static-analysis": "Static analysis",
	"tooling-design": "Tooling design",
	"agent-design": "Agent design",
	"capability-gap-analysis": "Capability gap analysis",
	"knowledge-curation": "Knowledge curation",
	"cross-domain-insight": "Cross-domain insight",
	"workload-balancing": "Workload balancing",
	"presentation-design": "Presentation design",
	documentation: "Documentation",
	"dependency-audit": "Dependency audit",
	"integration-management": "Integration management",
	"secret-rotation": "Secret rotation",
	"disaster-recovery": "Disaster recovery",
	"etl-design": "ETL design",
	"tech-debt": "Tech debt",
	"service-contracts": "Service contracts",
	"git-workflow": "Git workflow",
	"process-automation": "Process automation",
	"risk-scoring": "Risk scoring",
	"predictive-modelling": "Predictive modelling",
};

function sliceFunction(source, name) {
	const start = source.indexOf(`async function ${name}`);
	if (start === -1) throw new Error(`function ${name} not found`);
	let depth = 0;
	let began = false;
	for (let i = source.indexOf("{", start); i < source.length; i++) {
		if (source[i] === "{") {
			depth++;
			began = true;
		} else if (source[i] === "}") {
			depth--;
			if (began && depth === 0) return source.slice(start, i + 1);
		}
	}
	throw new Error(`unbalanced braces in ${name}`);
}

function capabilityGroups(fnBody) {
	const re = /hasCap\(\s*agent\s*,\s*([\s\S]*?)\)\s*\)\s*\{/g;
	const groups = [];
	let m;
	while ((m = re.exec(fnBody))) {
		const caps = [
			...new Set(
				(m[1].match(/"([a-z_]+)"/g) || []).map((s) => s.replace(/"/g, "")),
			),
		];
		groups.push({ caps, at: m.index });
	}
	return groups;
}

function main() {
	const source = fs.readFileSync(TEAM, "utf8");
	const fn = sliceFunction(source, "processAgentTask");
	const groups = capabilityGroups(fn);

	if (groups.length !== BEHAVIOUR_IDS.length) {
		throw new Error(
			`router has ${groups.length} branches but ${BEHAVIOUR_IDS.length} names are declared — ` +
				`add/remove a name in BEHAVIOUR_IDS to match`,
		);
	}

	const bounds = [...groups.map((g) => g.at), fn.length];
	const behaviours = groups.map((g, i) => {
		const chunk = fn.slice(bounds[i], bounds[i + 1]);
		const inline = (chunk.match(/\.(update|insert|upsert|delete)\(/g) || [])
			.length;
		const helperHits = MUTATING_HELPERS.filter((h) =>
			new RegExp(`\\b${h}\\s*\\(`).test(chunk),
		).length;
		const changesState = inline > 0 || helperHits > 0;
		const id = BEHAVIOUR_IDS[i];
		return {
			id,
			label: LABELS[id] || id,
			impact: changesState ? "act" : "advisory",
			changes_state: changesState,
			capabilities: g.caps,
		};
	});

	const uniqCaps = new Set(behaviours.flatMap((b) => b.capabilities));

	const header = `// AUTO-GENERATED FROM THE ROUTER — do not hand-edit.
// Regenerate with: node scripts/agent-behaviours.gen.mjs
//
// Source of truth: the hasCap(...) branch groups inside processAgentTask()
// in _agent-team.js. A drift-guard test asserts this file and the router
// expose exactly the same capability strings, so the two cannot diverge
// silently again.
//
// ${behaviours.length} behaviours · ${
		behaviours.filter((b) => b.impact === "act").length
	} change state · ${
		behaviours.filter((b) => b.impact === "advisory").length
	} are advisory · ${uniqCaps.size} capabilities
`;

	const out =
		`${header}\nexport const BEHAVIOURS = ${JSON.stringify(behaviours, null, 1)};\n\n` +
		`export const ROUTED_CAPABILITIES = new Set(\n\tBEHAVIOURS.flatMap((b) => b.capabilities),\n);\n`;

	fs.writeFileSync(OUT, out);
	console.log(
		`wrote ${path.relative(ROOT, OUT)} — ${behaviours.length} behaviours, ` +
			`${behaviours.filter((b) => b.impact === "act").length} state-changing, ` +
			`${uniqCaps.size} capabilities`,
	);
	for (const b of behaviours) {
		console.log(
			`  ${b.impact === "act" ? "STATE " : "      "} ${b.id} (${b.capabilities.length} caps)`,
		);
	}
}

main();
