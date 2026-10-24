// ═══════════════════════════════════════════════════════════════════
// Slice 18 — Orchestration domain enrollment (FRAMEWORK §8.1) +
// SPEC §7 (A–Q) ↔ FRAMEWORK §8 domain crosswalk (api/_domain-map.js).
// Slice 21 — Community (§8.3) + Search & Knowledge (§8.4) enrollment.
// ═══════════════════════════════════════════════════════════════════
// Held-out: the 6 §8.1 rows (shape/class/trigger/verify/ui), the
// deployed */5 cron schedule (vercel.json), class-A caps, the
// read-only tool envelope, disable-test form (24h, ≥40 chars),
// ALL_CONTRACTS composition behind the R14 gate, the full
// 17-system crosswalk with validator positives + tamper negatives,
// the 6 §8.3 + 5 §8.4 rows with raw-token → contract mapping
// (PA→parallelization, DS+EO/DS+CH→deterministic_sweep,
// CH→chaining_gates, EO→evaluator_optimizer, E/C→event with cron
// noted in expr, A/B→A + classDegradeTo B), their DECLARED (not
// deployed — R14 gate unwired) trigger exprs, label-style ui
// (A▸B → {surface:A, tab:B}), and class-driven caps.
// Expectations are copied from FRAMEWORK §8.1, §8.3, §8.4 / spec §7
// directly — independent of the modules under test.
// ═══════════════════════════════════════════════════════════════════

import { beforeAll, describe, expect, it } from "vitest";

type ToolSpec = {
	name: string;
	scope: string[];
	destructive: boolean;
	dryRunSupported: boolean;
};

type Contract = {
	id: string;
	domain: string;
	capability: string;
	class: string;
	classDegradeTo?: string;
	trigger: { kind: string; expr: string };
	tools: ToolSpec[];
	caps: { costUsdPerRun: number; attempts: number; durationMs: number };
	workflow: string;
	disableTest: string;
	verify: string[];
	ui?: { surface: string; tab: string };
};

type ContractsModule = {
	TRUST_SAFETY_CONTRACTS: Contract[];
	ORCHESTRATION_CONTRACTS: Contract[];
	COMMUNITY_CONTRACTS: Contract[];
	SEARCH_KNOWLEDGE_CONTRACTS: Contract[];
	PLATFORM_CONTRACTS: Contract[];
	SECURITY_CONTRACTS: Contract[];
	QUALITY_CONTRACTS: Contract[];
	COWORKER_CONTRACTS: Contract[];
	ALL_CONTRACTS: Contract[];
	DOMAINS: string[];
	validateContract: (c: Contract) => { ok: boolean; errors: string[] };
	assertDispatchable: (id: string) => Contract;
};

type MapEntry = { name: string; primary: string; source: string };

type MapModule = {
	SPEC_SYSTEMS: { key: string; name: string }[];
	SPEC_SYSTEM_MAP: Record<string, MapEntry>;
	validateDomainMap: (map?: Record<string, MapEntry>) => { ok: boolean; errors: string[] };
};

// Held-out FRAMEWORK §8.1 rows: Capability | Shape | Class | Trigger | Verify | UI.
const ORC_ROWS = [
	{
		id: "orc-event-engine",
		capability: "Event Engine",
		shape: "deterministic_sweep",
		class: "A",
		kind: "event",
		expr: "OPS_EVENT_TYPES (spec §4 catalog)",
		verify: ["V5"],
	},
	{
		id: "orc-work-dispatcher",
		capability: "Work Dispatcher",
		shape: "deterministic_sweep",
		class: "A",
		kind: "cron",
		expr: "*/5 * * * *",
		verify: ["V1"],
	},
	{
		id: "orc-scheduler",
		capability: "Scheduler",
		shape: "deterministic_sweep",
		class: "A",
		kind: "cron",
		expr: "*/5 * * * *",
		verify: ["V4"],
	},
	{
		id: "orc-retry-engine",
		capability: "Retry Engine",
		shape: "deterministic_sweep",
		class: "A",
		kind: "event",
		expr: "job failure → state RETRYING (nextRetryAt set)",
		verify: ["V1"],
	},
	{
		id: "orc-dependency-manager",
		capability: "Dependency Manager",
		shape: "deterministic_sweep",
		class: "A",
		kind: "event",
		expr: "WAITING job whose dependencies all finish",
		verify: ["V2"],
	},
	{
		id: "orc-watchdog",
		capability: "Watchdog",
		shape: "deterministic_sweep",
		class: "A",
		kind: "cron",
		expr: "*/5 * * * *",
		verify: ["V5"],
	},
] as const;

// Held-out FRAMEWORK §8.3 Community rows: Capability | Shape | Class |
// Trigger | Verify | UI. Shape/class/trigger are the raw §8.3 tokens;
// expr is the exact DECLARED (not deployed — R14 gate unwired,
// vercel.json untouched) schedule/event string the contract must
// carry; ui is the FRAMEWORK label, mapped label-style.
const COMM_ROWS = [
	{
		id: "comm-duplicate-detection",
		capability: "Duplicate Detection",
		shape: "PA",
		class: "B",
		trigger: "C",
		expr: "0 * * * *",
		verify: ["V1", "V6"],
		ui: "Reports▸Review",
	},
	{
		id: "comm-issue-clustering",
		capability: "Issue Clustering",
		shape: "PA",
		class: "B",
		trigger: "C",
		expr: "20 * * * *",
		verify: ["V1", "V6"],
		ui: "Reports▸Review",
	},
	{
		id: "comm-priority",
		capability: "Priority",
		shape: "DS+EO",
		class: "B",
		trigger: "C",
		expr: "*/15 * * * *",
		verify: ["V4"],
		ui: "Reports",
	},
	{
		id: "comm-case-lifecycle",
		capability: "Case Lifecycle",
		shape: "CH",
		class: "A/B",
		trigger: "E/C",
		expr: "CASE_CREATED|CASE_UPDATED|CASE_RESOLVED|CASE_REOPENED|cron hourly",
		verify: ["V1", "V2"],
		ui: "Reports",
	},
	{
		id: "comm-poll-operations",
		capability: "Poll Operations",
		shape: "DS",
		class: "A",
		trigger: "C",
		expr: "10 * * * *",
		verify: ["V1", "V5"],
		ui: "Reports",
	},
	{
		id: "comm-community-health",
		capability: "Community Health",
		shape: "EO",
		class: "B",
		trigger: "C",
		expr: "0 5 * * *",
		verify: ["V4", "V6"],
		ui: "Overview",
	},
] as const;

// Held-out FRAMEWORK §8.4 Search & Knowledge rows — same raw-token +
// exact-declared-expr + label-ui rule as §8.3.
const SK_ROWS = [
	{
		id: "sk-search",
		capability: "Search",
		shape: "DS+CH",
		class: "B",
		trigger: "E/C",
		expr: "NEW_POST|CONTENT_EDITED|cron hourly",
		verify: ["V4"],
		ui: "Overview",
	},
	{
		id: "sk-ranking",
		capability: "Ranking",
		shape: "EO",
		class: "B",
		trigger: "C",
		expr: "30 5 * * *",
		verify: ["V4"],
		ui: "Overview",
	},
	{
		id: "sk-rag",
		capability: "RAG",
		shape: "CH",
		class: "B",
		trigger: "E",
		expr: "NEW_MESSAGE",
		verify: ["V1", "V6"],
		ui: "Reports▸Review",
	},
	{
		id: "sk-knowledge-updates",
		capability: "Knowledge Updates",
		shape: "CH",
		class: "B",
		trigger: "E",
		expr: "CASE_RESOLVED|CONTENT_EDITED",
		verify: ["V1", "V2"],
		ui: "Reports▸Review",
	},
	{
		id: "sk-zero-result-recovery",
		capability: "Zero-result Recovery",
		shape: "EO",
		class: "B",
		trigger: "C",
		expr: "0 */6 * * *",
		verify: ["V4"],
		ui: "Overview",
	},
] as const;

// §8 raw-token → contract-value mapping (first token is primary).
const SHAPE_TO_WORKFLOW: Record<string, string> = {
	PA: "parallelization",
	DS: "deterministic_sweep",
	"DS+EO": "deterministic_sweep",
	"DS+CH": "deterministic_sweep",
	CH: "chaining_gates",
	EO: "evaluator_optimizer",
	OW: "orchestrator_workers",
	RT: "routing",
};
const primaryKind = (token: string) => {
	const head = token.split("/")[0];
	return head === "E" ? "event" : head === "M" ? "manual" : "cron";
};
const primaryClass = (token: string) => token.split("/")[0];
const degradeClass = (token: string) => (token.includes("/") ? token.split("/")[1] : undefined);
const uiFromLabel = (label: string) => {
	if (label === "OpsCenter") return { surface: "OpsCenter", tab: "ops-center" };
	const diag = label.split("▸");
	if (diag.length > 1) return { surface: diag[0], tab: diag[1] };
	const plus = label.split(" + ");
	if (plus.length > 1) return { surface: plus[0], tab: plus[1] };
	const bare = label.replace(/\s*\(.*\)$/, "").trim();
	return { surface: bare, tab: bare };
};
const CLASS_A_CAPS = { costUsdPerRun: 0.002, attempts: 3, durationMs: 15000 };
const CLASS_B_CAPS = { costUsdPerRun: 0.01, attempts: 3, durationMs: 30000 };
const CLASS_C_CAPS = { costUsdPerRun: 0.005, attempts: 1, durationMs: 10000 };
const capsForClass = (cls: string) =>
	cls === "A" ? CLASS_A_CAPS : cls === "B" ? CLASS_B_CAPS : CLASS_C_CAPS;

// Held-out FRAMEWORK §8.5 Platform rows — same raw-token +
// exact-declared-expr + label-ui rule as §8.3/§8.4. OpsCenter ui maps
// to the admin nav key (ops-center), matching the §8.1 rows.
const PLAT_ROWS = [
	{
		id: "plat-database",
		capability: "Database",
		shape: "DS",
		class: "A/B",
		trigger: "C",
		expr: "25 * * * *",
		verify: ["V4", "V1"],
		ui: "Overview",
	},
	{
		id: "plat-cache",
		capability: "Cache",
		shape: "DS",
		class: "A",
		trigger: "E",
		expr: "CACHE_FAILURE|CONTENT_EDITED",
		verify: ["V4", "V2"],
		ui: "Overview",
	},
	{
		id: "plat-queue",
		capability: "Queue",
		shape: "DS",
		class: "A",
		trigger: "C",
		expr: "*/10 * * * *",
		verify: ["V4"],
		ui: "OpsCenter",
	},
	{
		id: "plat-realtime",
		capability: "Realtime",
		shape: "DS",
		class: "A",
		trigger: "C",
		expr: "50 * * * *",
		verify: ["V3"],
		ui: "OpsCenter",
	},
	{
		id: "plat-storage",
		capability: "Storage",
		shape: "DS",
		class: "A",
		trigger: "C",
		expr: "55 * * * *",
		verify: ["V1"],
		ui: "Overview",
	},
	{
		id: "plat-notifications",
		capability: "Notifications",
		shape: "DS",
		class: "A",
		trigger: "E",
		expr: "NOTIFICATION_FAILURE|EMAIL_FAILURE|SMS_FAILURE|PUSH_FAILURE",
		verify: ["V3"],
		ui: "Reports",
	},
	{
		id: "plat-performance",
		capability: "Performance (load manager)",
		shape: "DS+EO",
		class: "B",
		trigger: "C",
		expr: "45 * * * *",
		verify: ["V4", "V1"],
		ui: "Overview",
	},
] as const;

// Held-out FRAMEWORK §8.6 Security rows — same raw-token +
// exact-declared-expr + label-ui rule; all five land on OpsCenter.
const SEC_ROWS = [
	{
		id: "sec-detection",
		capability: "Detection",
		shape: "PA",
		class: "B",
		trigger: "E/C",
		expr: "SECURITY_EVENT|AUTHORIZATION_FAILURE|cron hourly",
		verify: ["V1", "V6"],
		ui: "OpsCenter",
	},
	{
		id: "sec-authz-testing",
		capability: "Authorization Testing",
		shape: "DS",
		class: "A/C",
		trigger: "C",
		expr: "5 * * * *",
		verify: ["V5", "V1"],
		ui: "OpsCenter",
	},
	{
		id: "sec-abuse-detection",
		capability: "Abuse Detection",
		shape: "PA",
		class: "B/C",
		trigger: "E",
		expr: "SUSPICIOUS_ACTIVITY|ABUSE_SPIKE",
		verify: ["V1", "V4"],
		ui: "OpsCenter",
	},
	{
		id: "sec-incident-response",
		capability: "Incident Response",
		shape: "OW",
		class: "C",
		trigger: "E/M",
		expr: "SECURITY_EVENT|ERROR_SPIKE|manual (approval handoff)",
		verify: ["V3", "V1"],
		ui: "OpsCenter",
	},
	{
		id: "sec-verification",
		capability: "Verification (meta)",
		shape: "DS",
		class: "A",
		trigger: "C",
		expr: "55 */2 * * *",
		verify: ["V5"],
		ui: "OpsCenter",
	},
] as const;

// Held-out FRAMEWORK §8.7 Quality rows — same raw-token +
// exact-declared-expr + label-ui rule; all seven land on OpsCenter.
const QUAL_ROWS = [
	{
		id: "qual-e2e-qa",
		capability: "E2E QA",
		shape: "DS",
		class: "A",
		trigger: "C",
		expr: "15 */6 * * *",
		verify: ["V5"],
		ui: "OpsCenter",
	},
	{
		id: "qual-mobile-qa",
		capability: "Mobile QA",
		shape: "DS",
		class: "A",
		trigger: "C",
		expr: "35 */12 * * *",
		verify: ["V5"],
		ui: "OpsCenter",
	},
	{
		id: "qual-accessibility",
		capability: "Accessibility",
		shape: "DS",
		class: "B",
		trigger: "C",
		expr: "10 3 * * *",
		verify: ["V1", "V6"],
		ui: "OpsCenter",
	},
	{
		id: "qual-ai-eval",
		capability: "AI Evaluation",
		shape: "EO",
		class: "B",
		trigger: "C",
		expr: "20 */6 * * *",
		verify: ["V6", "V1"],
		ui: "OpsCenter",
	},
	{
		id: "qual-regression",
		capability: "Regression",
		shape: "DS",
		class: "A",
		trigger: "E",
		expr: "AI_REGRESSION|TOOL_FAILURE",
		verify: ["V5"],
		ui: "OpsCenter",
	},
	{
		id: "qual-red-team",
		capability: "Red Team",
		shape: "OW",
		class: "C",
		trigger: "C",
		expr: "5 4 * * *",
		verify: ["V6"],
		ui: "OpsCenter",
	},
	{
		id: "qual-drift",
		capability: "Drift",
		shape: "EO",
		class: "B",
		trigger: "C",
		expr: "30 */8 * * *",
		verify: ["V4", "V6"],
		ui: "OpsCenter",
	},
] as const;

// Held-out FRAMEWORK §8.8 AI Coworker rows — same raw-token rule;
// manual (M) is the primary trigger for seven of eight rows.
const COW_ROWS = [
	{
		id: "cw-chat",
		capability: "Chat",
		shape: "RT",
		class: "B",
		trigger: "M/E",
		expr: "manual (user message)|event: intent-routed WorkItem",
		verify: ["V1"],
		ui: "Coworker panel",
	},
	{
		id: "cw-voice",
		capability: "Voice",
		shape: "CH",
		class: "B",
		trigger: "M",
		expr: "manual (voice submit → transcript)",
		verify: ["V3", "V1"],
		ui: "Submit voice UI",
	},
	{
		id: "cw-files",
		capability: "Files",
		shape: "CH",
		class: "A/B",
		trigger: "M",
		expr: "manual (file upload)",
		verify: ["V1", "V2"],
		ui: "Coworker panel",
	},
	{
		id: "cw-research",
		capability: "Research",
		shape: "CH",
		class: "B",
		trigger: "M",
		expr: "manual (research question)",
		verify: ["V6", "V1"],
		ui: "Coworker panel",
	},
	{
		id: "cw-coding",
		capability: "Coding",
		shape: "CH",
		class: "B",
		trigger: "M",
		expr: "manual (coding task)",
		verify: ["V5"],
		ui: "Coworker panel",
	},
	{
		id: "cw-investigation",
		capability: "Investigation",
		shape: "DS",
		class: "C",
		trigger: "M",
		expr: "manual (investigation question)",
		verify: ["V1"],
		ui: "Coworker panel",
	},
	{
		id: "cw-delegation",
		capability: "Delegation",
		shape: "OW",
		class: "B",
		trigger: "M",
		expr: "manual (delegate WorkItem)",
		verify: ["V1"],
		ui: "Coworker + OpsCenter",
	},
	{
		id: "cw-reports",
		capability: "Reports",
		shape: "DS",
		class: "A",
		trigger: "C/M",
		expr: "40 6 * * *|manual rerun",
		verify: ["V1"],
		ui: "Reports (3 tabs)",
	},
] as const;

// Held-out SPEC §7 crosswalk → primary FRAMEWORK §8 domain.
const EXPECTED_PRIMARY: Record<string, string> = {
	A: "orchestration",
	B: "trust_safety",
	C: "trust_safety",
	D: "community",
	E: "community",
	F: "search_knowledge",
	G: "platform",
	H: "platform",
	I: "platform",
	J: "platform",
	K: "platform",
	L: "platform",
	M: "security",
	N: "quality",
	O: "quality",
	P: "quality",
	Q: "coworker",
};

const EXPECTED_NAMES: Record<string, string> = {
	A: "OPERATIONS",
	B: "TRUST & SAFETY",
	C: "CONTENT UNDERSTANDING",
	D: "COMMUNITY OPERATIONS",
	E: "CASE MANAGEMENT",
	F: "SEARCH & KNOWLEDGE",
	G: "DATABASE",
	H: "PERFORMANCE",
	I: "QUEUES",
	J: "NOTIFICATIONS",
	K: "STORAGE",
	L: "REALTIME",
	M: "SECURITY",
	N: "QA",
	O: "AI QUALITY",
	P: "RELEASE & CHANGE",
	Q: "AUTONOMOUS COWORKER",
};

const SYSTEM_KEYS = [
	"A",
	"B",
	"C",
	"D",
	"E",
	"F",
	"G",
	"H",
	"I",
	"J",
	"K",
	"L",
	"M",
	"N",
	"O",
	"P",
	"Q",
];

let cm: ContractsModule;
let dm: MapModule;

beforeAll(async () => {
	cm = (await import("../../api/_worker-contracts.js")) as ContractsModule;
	dm = (await import("../../api/_domain-map.js")) as MapModule;
});

describe("orchestration domain enrollment — FRAMEWORK §8.1", () => {
	it("enrolls exactly the 6 §8.1 capabilities with held-out rows", () => {
		expect(cm.ORCHESTRATION_CONTRACTS).toHaveLength(6);
		expect(cm.ORCHESTRATION_CONTRACTS.map((c) => c.id)).toEqual(ORC_ROWS.map((r) => r.id));
		for (const row of ORC_ROWS) {
			const c = cm.ORCHESTRATION_CONTRACTS.find((x) => x.id === row.id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${row.id}`);
			expect(c.capability).toBe(row.capability);
			expect(c.domain).toBe("orchestration");
			expect(c.class).toBe(row.class);
			expect(c.classDegradeTo).toBeUndefined();
			expect(c.workflow).toBe(row.shape);
			expect(c.trigger.kind).toBe(row.kind);
			expect(c.trigger.expr).toBe(row.expr);
			expect(c.verify).toEqual([...row.verify]);
			expect(c.ui).toEqual({ surface: "OpsCenter", tab: "ops-center" });
		}
	});

	it("pins cron triggers to the deployed */5 schedule (vercel.json)", () => {
		const crons = ["orc-work-dispatcher", "orc-scheduler", "orc-watchdog"];
		for (const id of crons) {
			const c = cm.ORCHESTRATION_CONTRACTS.find((x) => x.id === id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${id}`);
			expect(c.trigger.kind).toBe("cron");
			expect(c.trigger.expr).toBe("*/5 * * * *");
		}
	});

	it("grants only a read envelope — no destructive or dry-run tools", () => {
		for (const c of cm.ORCHESTRATION_CONTRACTS) {
			expect(c.tools).toHaveLength(1);
			expect(c.tools[0].name).toBe("get_activity_logs");
			expect(c.tools[0].scope).toEqual(["activity_logs"]);
			expect(c.tools[0].destructive).toBe(false);
			expect(c.tools[0].dryRunSupported).toBe(false);
		}
	});

	it("caps every orchestration contract to the class-A budget (§5/R11)", () => {
		for (const c of cm.ORCHESTRATION_CONTRACTS) {
			expect(c.caps).toEqual({ costUsdPerRun: 0.002, attempts: 3, durationMs: 15000 });
		}
	});

	it("passes the FRAMEWORK §3 validator with a well-formed 24h disable test", () => {
		for (const c of cm.ORCHESTRATION_CONTRACTS) {
			const r = cm.validateContract(c);
			expect(r.errors).toEqual([]);
			expect(r.ok).toBe(true);
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
		}
	});

	it("indexes all eight enrolled domains behind ALL_CONTRACTS / the R14 gate", () => {
		expect(cm.TRUST_SAFETY_CONTRACTS).toHaveLength(10);
		expect(cm.ALL_CONTRACTS).toHaveLength(54);
		expect(new Set(cm.ALL_CONTRACTS.map((c) => c.domain))).toEqual(
			new Set([
				"trust_safety",
				"orchestration",
				"community",
				"search_knowledge",
				"platform",
				"security",
				"quality",
				"coworker",
			]),
		);
		const ids = cm.ALL_CONTRACTS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		const w = cm.assertDispatchable("orc-watchdog");
		expect(w.capability).toBe("Watchdog");
		expect(() => cm.assertDispatchable("orc-does-not-exist")).toThrow(/dispatch refused/);
	});
});

describe("community domain enrollment — FRAMEWORK §8.3", () => {
	it("enrolls exactly the 6 §8.3 rows under the §8.3 mapping rules", () => {
		expect(cm.COMMUNITY_CONTRACTS).toHaveLength(6);
		expect(cm.COMMUNITY_CONTRACTS.map((c) => c.id)).toEqual(COMM_ROWS.map((r) => r.id));
		for (const row of COMM_ROWS) {
			const c = cm.COMMUNITY_CONTRACTS.find((x) => x.id === row.id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${row.id}`);
			expect(c.capability).toBe(row.capability);
			expect(c.domain).toBe("community");
			expect(c.class).toBe(primaryClass(row.class));
			expect(c.classDegradeTo).toBe(degradeClass(row.class));
			expect(c.workflow).toBe(SHAPE_TO_WORKFLOW[row.shape]);
			expect(c.trigger.kind).toBe(primaryKind(row.trigger));
			expect(c.trigger.expr).toBe(row.expr);
			expect(c.verify).toEqual([...row.verify]);
			expect(c.ui).toEqual(uiFromLabel(row.ui));
		}
	});

	it("caps by primary class, keeps every tool non-destructive, passes §3 validation", () => {
		for (const c of cm.COMMUNITY_CONTRACTS) {
			expect(c.caps).toEqual(c.class === "A" ? CLASS_A_CAPS : CLASS_B_CAPS);
			expect(c.tools.every((t) => !t.destructive)).toBe(true);
			const r = cm.validateContract(c);
			expect(r.errors).toEqual([]);
			expect(r.ok).toBe(true);
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
		}
	});
});

describe("search & knowledge domain enrollment — FRAMEWORK §8.4", () => {
	it("enrolls exactly the 5 §8.4 rows under the §8.4 mapping rules", () => {
		expect(cm.SEARCH_KNOWLEDGE_CONTRACTS).toHaveLength(5);
		expect(cm.SEARCH_KNOWLEDGE_CONTRACTS.map((c) => c.id)).toEqual(SK_ROWS.map((r) => r.id));
		for (const row of SK_ROWS) {
			const c = cm.SEARCH_KNOWLEDGE_CONTRACTS.find((x) => x.id === row.id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${row.id}`);
			expect(c.capability).toBe(row.capability);
			expect(c.domain).toBe("search_knowledge");
			expect(c.class).toBe(primaryClass(row.class));
			expect(c.classDegradeTo).toBe(degradeClass(row.class));
			expect(c.workflow).toBe(SHAPE_TO_WORKFLOW[row.shape]);
			expect(c.trigger.kind).toBe(primaryKind(row.trigger));
			expect(c.trigger.expr).toBe(row.expr);
			expect(c.verify).toEqual([...row.verify]);
			expect(c.ui).toEqual(uiFromLabel(row.ui));
		}
	});

	it("caps at class B, keeps a non-destructive envelope, passes §3 validation", () => {
		for (const c of cm.SEARCH_KNOWLEDGE_CONTRACTS) {
			expect(c.class).toBe("B");
			expect(c.caps).toEqual(CLASS_B_CAPS);
			expect(c.tools.every((t) => !t.destructive)).toBe(true);
			const r = cm.validateContract(c);
			expect(r.errors).toEqual([]);
			expect(r.ok).toBe(true);
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
		}
	});

	it("keeps Knowledge Updates read-only (update_knowledge_base absent from the registry)", () => {
		const ku = cm.SEARCH_KNOWLEDGE_CONTRACTS.find((x) => x.id === "sk-knowledge-updates");
		expect(ku).toBeDefined();
		if (!ku) throw new Error("missing sk-knowledge-updates");
		expect(ku.tools.map((t) => t.name)).toEqual(["search_knowledge_base", "get_activity_logs"]);
	});
});

describe("platform domain enrollment — FRAMEWORK §8.5", () => {
	it("enrolls exactly the 7 §8.5 rows under the §8.5 mapping rules", () => {
		expect(cm.PLATFORM_CONTRACTS).toHaveLength(7);
		expect(cm.PLATFORM_CONTRACTS.map((c) => c.id)).toEqual(PLAT_ROWS.map((r) => r.id));
		for (const row of PLAT_ROWS) {
			const c = cm.PLATFORM_CONTRACTS.find((x) => x.id === row.id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${row.id}`);
			expect(c.capability).toBe(row.capability);
			expect(c.domain).toBe("platform");
			expect(c.class).toBe(primaryClass(row.class));
			expect(c.classDegradeTo).toBe(degradeClass(row.class));
			expect(c.workflow).toBe(SHAPE_TO_WORKFLOW[row.shape]);
			expect(c.trigger.kind).toBe(primaryKind(row.trigger));
			expect(c.trigger.expr).toBe(row.expr);
			expect(c.verify).toEqual([...row.verify]);
			expect(c.ui).toEqual(uiFromLabel(row.ui));
		}
	});

	it("caps by primary class, keeps every tool non-destructive, passes §3 validation", () => {
		for (const c of cm.PLATFORM_CONTRACTS) {
			expect(c.caps).toEqual(c.class === "A" ? CLASS_A_CAPS : CLASS_B_CAPS);
			expect(c.tools.every((t) => !t.destructive)).toBe(true);
			const r = cm.validateContract(c);
			expect(r.errors).toEqual([]);
			expect(r.ok).toBe(true);
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
		}
	});

	it("keeps Database on the single-SELECT least-privilege envelope", () => {
		const db = cm.PLATFORM_CONTRACTS.find((x) => x.id === "plat-database");
		expect(db).toBeDefined();
		if (!db) throw new Error("missing plat-database");
		expect(db.tools.map((t) => t.name)).toEqual(["execute_sql", "get_analytics"]);
		for (const t of db.tools) {
			expect(t.destructive).toBe(false);
			expect(t.dryRunSupported).toBe(false);
		}
	});
});

describe("security domain enrollment — FRAMEWORK §8.6", () => {
	it("enrolls exactly the 5 §8.6 rows under the §8.6 mapping rules", () => {
		expect(cm.SECURITY_CONTRACTS).toHaveLength(5);
		expect(cm.SECURITY_CONTRACTS.map((c) => c.id)).toEqual(SEC_ROWS.map((r) => r.id));
		for (const row of SEC_ROWS) {
			const c = cm.SECURITY_CONTRACTS.find((x) => x.id === row.id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${row.id}`);
			expect(c.capability).toBe(row.capability);
			expect(c.domain).toBe("security");
			expect(c.class).toBe(primaryClass(row.class));
			expect(c.classDegradeTo).toBe(degradeClass(row.class));
			expect(c.workflow).toBe(SHAPE_TO_WORKFLOW[row.shape]);
			expect(c.trigger.kind).toBe(primaryKind(row.trigger));
			expect(c.trigger.expr).toBe(row.expr);
			expect(c.verify).toEqual([...row.verify]);
			expect(c.ui).toEqual(uiFromLabel(row.ui));
		}
	});

	it("caps by primary class, keeps observation-only envelopes, passes §3 validation", () => {
		for (const c of cm.SECURITY_CONTRACTS) {
			expect(c.caps).toEqual(capsForClass(c.class));
			expect(c.tools.every((t) => !t.destructive)).toBe(true);
			const r = cm.validateContract(c);
			expect(r.errors).toEqual([]);
			expect(r.ok).toBe(true);
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
		}
	});

	it("routes containment through escalate_issue only — no enforcement tools", () => {
		const ir = cm.SECURITY_CONTRACTS.find((x) => x.id === "sec-incident-response");
		expect(ir).toBeDefined();
		if (!ir) throw new Error("missing sec-incident-response");
		expect(ir.tools.map((t) => t.name)).toEqual(["get_activity_logs", "escalate_issue"]);
		const banned = ["ban_user", "warn_user", "hide_post", "execute_sql"];
		for (const c of cm.SECURITY_CONTRACTS) {
			for (const t of c.tools) expect(banned).not.toContain(t.name);
		}
	});
});

describe("quality domain enrollment — FRAMEWORK §8.7", () => {
	it("enrolls exactly the 7 §8.7 rows under the §8.7 mapping rules", () => {
		expect(cm.QUALITY_CONTRACTS).toHaveLength(7);
		expect(cm.QUALITY_CONTRACTS.map((c) => c.id)).toEqual(QUAL_ROWS.map((r) => r.id));
		for (const row of QUAL_ROWS) {
			const c = cm.QUALITY_CONTRACTS.find((x) => x.id === row.id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${row.id}`);
			expect(c.capability).toBe(row.capability);
			expect(c.domain).toBe("quality");
			expect(c.class).toBe(primaryClass(row.class));
			expect(c.classDegradeTo).toBe(degradeClass(row.class));
			expect(c.workflow).toBe(SHAPE_TO_WORKFLOW[row.shape]);
			expect(c.trigger.kind).toBe(primaryKind(row.trigger));
			expect(c.trigger.expr).toBe(row.expr);
			expect(c.verify).toEqual([...row.verify]);
			expect(c.ui).toEqual(uiFromLabel(row.ui));
		}
	});

	it("caps by primary class, keeps observation-only envelopes, passes §3 validation", () => {
		for (const c of cm.QUALITY_CONTRACTS) {
			expect(c.caps).toEqual(capsForClass(c.class));
			expect(c.tools.every((t) => !t.destructive)).toBe(true);
			const r = cm.validateContract(c);
			expect(r.errors).toEqual([]);
			expect(r.ok).toBe(true);
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
		}
	});

	it("fires regression replay only on canonical events — cron schedules stay declared", () => {
		const rg = cm.QUALITY_CONTRACTS.find((x) => x.id === "qual-regression");
		expect(rg).toBeDefined();
		if (!rg) throw new Error("missing qual-regression");
		expect(rg.trigger.kind).toBe("event");
		expect(rg.trigger.expr).toBe("AI_REGRESSION|TOOL_FAILURE");
		for (const c of cm.QUALITY_CONTRACTS) {
			if (c.trigger.kind === "cron") expect(c.trigger.expr.split(" ")).toHaveLength(5);
		}
	});
});

describe("coworker domain enrollment — FRAMEWORK §8.8", () => {
	it("enrolls exactly the 8 §8.8 rows under the §8.8 mapping rules", () => {
		expect(cm.COWORKER_CONTRACTS).toHaveLength(8);
		expect(cm.COWORKER_CONTRACTS.map((c) => c.id)).toEqual(COW_ROWS.map((r) => r.id));
		for (const row of COW_ROWS) {
			const c = cm.COWORKER_CONTRACTS.find((x) => x.id === row.id);
			expect(c).toBeDefined();
			if (!c) throw new Error(`missing ${row.id}`);
			expect(c.capability).toBe(row.capability);
			expect(c.domain).toBe("coworker");
			expect(c.class).toBe(primaryClass(row.class));
			expect(c.classDegradeTo).toBe(degradeClass(row.class));
			expect(c.workflow).toBe(SHAPE_TO_WORKFLOW[row.shape]);
			expect(c.trigger.kind).toBe(primaryKind(row.trigger));
			expect(c.trigger.expr).toBe(row.expr);
			expect(c.verify).toEqual([...row.verify]);
			expect(c.ui).toEqual(uiFromLabel(row.ui));
		}
	});

	it("caps by primary class, keeps R5 observation-only envelopes, passes §3 validation", () => {
		for (const c of cm.COWORKER_CONTRACTS) {
			expect(c.caps).toEqual(capsForClass(c.class));
			const r = cm.validateContract(c);
			expect(r.errors).toEqual([]);
			expect(r.ok).toBe(true);
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
			// R5: the coworker never gets a tool handle — every enrolled
			// tool is a read (get_/search_), never a mutation or enforce.
			for (const t of c.tools) {
				expect(t.destructive).toBe(false);
				expect(t.name).toMatch(/^(get_|search_)/);
			}
		}
	});

	it("keeps investigation read-only and routes delegation through WorkItems", () => {
		const inv = cm.COWORKER_CONTRACTS.find((x) => x.id === "cw-investigation");
		expect(inv).toBeDefined();
		if (!inv) throw new Error("missing cw-investigation");
		expect(inv.trigger.kind).toBe("manual");
		expect(inv.tools.map((t) => t.name)).toEqual(["get_analytics", "get_activity_logs"]);
		const del = cm.COWORKER_CONTRACTS.find((x) => x.id === "cw-delegation");
		expect(del).toBeDefined();
		if (!del) throw new Error("missing cw-delegation");
		expect(del.workflow).toBe("orchestrator_workers");
		const reports = cm.COWORKER_CONTRACTS.find((x) => x.id === "cw-reports");
		expect(reports).toBeDefined();
		if (!reports) throw new Error("missing cw-reports");
		expect(reports.trigger.kind).toBe("cron");
		expect(reports.trigger.expr).toContain("manual rerun");
	});
});

describe("SPEC §7 ↔ FRAMEWORK §8 domain map", () => {
	it("holds out the full 17-system crosswalk (keys, names, primaries)", () => {
		expect(cm.DOMAINS).toHaveLength(8);
		expect(dm.SPEC_SYSTEMS.map((s) => s.key)).toEqual(SYSTEM_KEYS);
		expect(dm.SPEC_SYSTEMS.map((s) => s.name)).toEqual(SYSTEM_KEYS.map((k) => EXPECTED_NAMES[k]));
		expect(Object.keys(dm.SPEC_SYSTEM_MAP)).toEqual(SYSTEM_KEYS);
		for (const key of SYSTEM_KEYS) {
			const entry = dm.SPEC_SYSTEM_MAP[key];
			expect(entry).toBeDefined();
			if (!entry) throw new Error(`missing map entry ${key}`);
			expect(entry.name).toBe(EXPECTED_NAMES[key]);
			expect(entry.primary).toBe(EXPECTED_PRIMARY[key]);
		}
	});

	it("validates clean; every entry cites §8 rows; every domain is covered", () => {
		expect(dm.validateDomainMap()).toEqual({ ok: true, errors: [] });
		for (const key of SYSTEM_KEYS) {
			const entry = dm.SPEC_SYSTEM_MAP[key];
			if (!entry) throw new Error(`missing map entry ${key}`);
			expect(entry.source).toContain("§8");
		}
		const covered = new Set(Object.values(dm.SPEC_SYSTEM_MAP).map((e) => e.primary));
		expect(covered).toEqual(new Set(cm.DOMAINS));
	});

	it("rejects missing, extra, renamed, uncited, unmapped, and orphaned entries", () => {
		const clone = () => JSON.parse(JSON.stringify(dm.SPEC_SYSTEM_MAP)) as Record<string, MapEntry>;

		const missing = clone();
		delete missing.A;
		const r1 = dm.validateDomainMap(missing);
		expect(r1.ok).toBe(false);
		expect(r1.errors.some((e) => e.includes("missing spec system A"))).toBe(true);

		const extra = clone();
		extra.Z = { name: "BOGUS", primary: "platform", source: "§8.5 Database" };
		expect(
			dm.validateDomainMap(extra).errors.some((e) => e.includes('unknown map key "Z"')),
		).toBe(true);

		const renamed = clone();
		renamed.A!.name = "OPS";
		expect(
			dm.validateDomainMap(renamed).errors.some((e) => e.includes("does not match spec §7")),
		).toBe(true);

		const badPrimary = clone();
		badPrimary.A!.primary = "ops";
		expect(
			dm.validateDomainMap(badPrimary).errors.some((e) => e.includes("not a FRAMEWORK §8 domain")),
		).toBe(true);

		const uncited = clone();
		uncited.A!.source = "queue stuff, no citation";
		expect(
			dm.validateDomainMap(uncited).errors.some((e) => e.includes("source must cite")),
		).toBe(true);

		const orphaned = clone();
		orphaned.A!.primary = "platform";
		expect(
			dm.validateDomainMap(orphaned).errors.some((e) => e.includes('"orchestration" carries no')),
		).toBe(true);
	});
});
