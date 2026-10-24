// ═══════════════════════════════════════════════════════════════════
// Trust & Safety worker contracts — held-out FRAMEWORK §8.2 checks
// ═══════════════════════════════════════════════════════════════════
// Expected values are hard-coded HERE from FRAMEWORK.md §3/§8.2 —
// independent of the module — so any drift in api/_worker-contracts.js
// (renamed capability, changed class, dropped verify method, missing
// disable test) fails this test. Also locks the R14 gate behavior:
// valid contract → dispatchable, unknown id → refused.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it } from "vitest";

type Contract = {
	id: string;
	domain: string;
	capability: string;
	class: string;
	classDegradeTo?: string;
	trigger: { kind: string; expr: string };
	tools: Array<{
		name: string;
		scope: string[];
		destructive: boolean;
		dryRunSupported: boolean;
	}>;
	caps: { costUsdPerRun: number; attempts: number; durationMs: number };
	workflow: string;
	disableTest: string;
	verify: string[];
	ui?: { surface: string; tab: string };
};

let TRUST_SAFETY_CONTRACTS: Contract[];
let validateContract: (c: unknown) => { ok: boolean; errors: string[] };
let assertDispatchable: (id: string) => Contract;

// Held-out expectations — transcribed from FRAMEWORK.md §8.2
// (Capability | Shape | Class | Trigger | Verify | UI).
const EXPECTED: Array<{
	capability: string;
	workflow: string;
	class: string;
	degrade?: string;
	triggerKind: string;
	verify: string[];
	tab: string;
}> = [
	{
		capability: "Content Understanding",
		workflow: "routing",
		class: "B",
		triggerKind: "event",
		verify: ["V1", "V6"],
		tab: "Review",
	},
	{
		capability: "Context/Slang",
		workflow: "chaining_gates",
		class: "B",
		triggerKind: "event",
		verify: ["V1", "V6"],
		tab: "Review",
	},
	{
		capability: "Harassment",
		workflow: "parallelization",
		class: "B",
		degrade: "C",
		triggerKind: "event",
		verify: ["V1", "V6"],
		tab: "Review",
	},
	{
		capability: "Threat Detection",
		workflow: "chaining_gates",
		class: "B",
		degrade: "C",
		triggerKind: "event",
		verify: ["V1", "V3"],
		tab: "Approvals",
	},
	{
		capability: "PII Protection",
		workflow: "deterministic_sweep",
		class: "A",
		triggerKind: "event",
		verify: ["V1", "V2"],
		tab: "Review",
	},
	{
		capability: "Child Safety",
		workflow: "chaining_gates",
		class: "C",
		triggerKind: "event",
		verify: ["V6"],
		tab: "Approvals",
	},
	{
		capability: "Sexual Safety",
		workflow: "chaining_gates",
		class: "B",
		degrade: "C",
		triggerKind: "event",
		verify: ["V1", "V3"],
		tab: "Review",
	},
	{
		capability: "Scam/Fraud",
		workflow: "parallelization",
		class: "B",
		degrade: "C",
		triggerKind: "cron",
		verify: ["V1", "V4"],
		tab: "Review",
	},
	{
		capability: "Spam/Abuse",
		workflow: "parallelization",
		class: "A",
		degrade: "B",
		triggerKind: "event",
		verify: ["V1", "V2"],
		tab: "Review",
	},
	{
		capability: "Enforcement",
		workflow: "chaining_gates",
		class: "C",
		triggerKind: "manual",
		verify: ["V1", "V6"],
		tab: "Approvals",
	},
];

// Tool names must exist in api/_agent-tool-registry.js (held-out list).
const KNOWN_TOOLS = new Set([
	"get_posts",
	"get_comments",
	"get_reports",
	"search_users",
	"get_analytics",
	"update_post",
	"hide_post",
	"warn_user",
	"ban_user",
	"unban_user",
	"escalate_issue",
]);

const CLASS_CAPS: Record<string, { costUsdPerRun: number; attempts: number; durationMs: number }> = {
	A: { costUsdPerRun: 0.002, attempts: 3, durationMs: 15000 },
	B: { costUsdPerRun: 0.01, attempts: 3, durationMs: 30000 },
	C: { costUsdPerRun: 0.005, attempts: 1, durationMs: 10000 },
};

beforeEach(async () => {
	({ TRUST_SAFETY_CONTRACTS, validateContract, assertDispatchable } = await import(
		"../../api/_worker-contracts.js"
	));
});

describe("TRUST_SAFETY_CONTRACTS — FRAMEWORK §8.2 enrollment", () => {
	it("enrolls exactly the 10 Trust & Safety capabilities with unique tst-* ids", () => {
		expect(TRUST_SAFETY_CONTRACTS).toHaveLength(10);
		const ids = TRUST_SAFETY_CONTRACTS.map((c) => c.id);
		expect(new Set(ids).size).toBe(10);
		for (const id of ids) expect(id.startsWith("tst-")).toBe(true);
		expect(ids).toContain("tst-threat-detect");
	});

	it("matches every held-out shape/class/trigger/verify/UI triple", () => {
		for (const exp of EXPECTED) {
			const c = TRUST_SAFETY_CONTRACTS.find((x) => x.capability === exp.capability);
			expect(c, `missing contract: ${exp.capability}`).toBeDefined();
			expect(c!.domain).toBe("trust_safety");
			expect(c!.workflow, exp.capability).toBe(exp.workflow);
			expect(c!.class, exp.capability).toBe(exp.class);
			expect(c!.classDegradeTo, exp.capability).toBe(exp.degrade);
			expect(c!.trigger.kind, exp.capability).toBe(exp.triggerKind);
			expect(c!.verify, exp.capability).toEqual(exp.verify);
			expect(c!.ui, exp.capability).toEqual({ surface: "Reports", tab: exp.tab });
		}
	});

	it("declares only real registry tools with valid ToolSpec shape", () => {
		for (const c of TRUST_SAFETY_CONTRACTS) {
			expect(c.tools.length).toBeGreaterThan(0);
			for (const t of c.tools) {
				expect(KNOWN_TOOLS.has(t.name), `${c.id}: unknown tool ${t.name}`).toBe(true);
				expect(Array.isArray(t.scope) && t.scope.length > 0).toBe(true);
				expect(typeof t.destructive).toBe("boolean");
				expect(typeof t.dryRunSupported).toBe("boolean");
			}
		}
	});

	it("sets caps by execution class", () => {
		for (const c of TRUST_SAFETY_CONTRACTS) {
			expect(c.caps, c.id).toEqual(CLASS_CAPS[c.class]);
		}
	});

	it("gives every worker a measurable 24h disable test", () => {
		for (const c of TRUST_SAFETY_CONTRACTS) {
			expect(c.disableTest.length).toBeGreaterThanOrEqual(40);
			expect(c.disableTest).toContain("24h");
		}
	});

	it("passes its own schema validation", () => {
		for (const c of TRUST_SAFETY_CONTRACTS) {
			const res = validateContract(c);
			expect(res.errors, `${c.id}: ${res.errors.join("; ")}`).toEqual([]);
			expect(res.ok).toBe(true);
		}
	});
});

describe("validateContract — rejection paths", () => {
	const base = () => JSON.parse(JSON.stringify(TRUST_SAFETY_CONTRACTS[0]));

	it("rejects non-objects, bad domain/class/workflow/verify, short disableTest, empty tools", () => {
		expect(validateContract(null).ok).toBe(false);
		expect(validateContract({}).ok).toBe(false);

		const badDomain = base();
		badDomain.domain = "not_a_domain";
		expect(validateContract(badDomain).ok).toBe(false);

		const badClass = base();
		badClass.class = "D";
		expect(validateContract(badClass).ok).toBe(false);

		const sameDegrade = base();
		sameDegrade.classDegradeTo = sameDegrade.class;
		expect(validateContract(sameDegrade).ok).toBe(false);

		const badWorkflow = base();
		badWorkflow.workflow = "improvised";
		expect(validateContract(badWorkflow).ok).toBe(false);

		const badVerify = base();
		badVerify.verify = ["V9"];
		expect(validateContract(badVerify).ok).toBe(false);

		const shortDisable = base();
		shortDisable.disableTest = "off 24h → broken";
		expect(validateContract(shortDisable).ok).toBe(false);

		const noTwentyFour = base();
		noTwentyFour.disableTest = "a".repeat(50);
		expect(validateContract(noTwentyFour).ok).toBe(false);

		const noTools = base();
		noTools.tools = [];
		expect(validateContract(noTools).ok).toBe(false);

		const toolNoScope = base();
		toolNoScope.tools = [{ name: "get_posts", scope: [], destructive: false, dryRunSupported: true }];
		expect(validateContract(toolNoScope).ok).toBe(false);

		const badTrigger = base();
		badTrigger.trigger = { kind: "webhook", expr: "x" };
		expect(validateContract(badTrigger).ok).toBe(false);

		expect(validateContract(base()).ok).toBe(true);
	});
});

describe("assertDispatchable — R14 gate", () => {
	it("returns the contract for a registered worker", () => {
		const c = assertDispatchable("tst-threat-detect");
		expect(c.capability).toBe("Threat Detection");
		expect(c.domain).toBe("trust_safety");
	});

	it("refuses dispatch for unknown workers", () => {
		expect(() => assertDispatchable("tst-does-not-exist")).toThrow(/dispatch refused/);
		expect(() => assertDispatchable("trend-watch")).toThrow(/R14/);
	});
});
