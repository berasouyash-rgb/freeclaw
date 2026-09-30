// Threat-vs-report context (Rajiv/Rahul rule) — regression tests.
// Identical violent wording from the author is a direct threat (blocked);
// quoted/reported wording is held for human review (threat_report) —
// never public unreviewed, never silently auto-blocking a victim report.
// Heuristic-only threats ("I will kill Rahul tomorrow") must never publish.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

import { evaluateContext, serverModerate } from "../../api/_moderation.js";
import { evaluateContent, getPolicyTable } from "../../api/_safety-pipeline.js";

describe("evaluateContext", () => {
	it("rates direct first-person threats as direct_threat", () => {
		expect(evaluateContext("I will kill you")).toBe("direct_threat");
		expect(evaluateContext("I will kill Rahul tomorrow")).toBe("direct_threat");
		expect(evaluateContext("gonna hurt you after school")).toBe("direct_threat");
	});
	it("rates quoted threats without first-person intent as reported_threat", () => {
		expect(evaluateContext("Rajiv told the class he will kill you tomorrow")).toBe(
			"reported_threat",
		);
		expect(evaluateContext("Rahul said someone will stab him")).toBe("reported_threat");
	});
	it("rates first-person wording as direct even inside a quoting frame (fail closed)", () => {
		expect(evaluateContext("He said it, but I will kill you myself")).toBe("direct_threat");
	});
	it("rates bare violent wording with no signal as unclear", () => {
		expect(evaluateContext("kill you!!")).toBe("unclear");
	});
	it("rates ordinary complaints as clean", () => {
		expect(evaluateContext("The canteen food is bad")).toBe("clean");
		expect(evaluateContext("")).toBe("clean");
		expect(evaluateContext(null)).toBe("clean");
	});
});

describe("serverModerate threat routing", () => {
	it("keeps blocking direct threats as violence (critical)", () => {
		const r = serverModerate("", "I will kill you", null);
		expect(r.blocked).toBe(true);
		expect(r.flags.map((f: { type: string }) => f.type)).toContain("violence");
	});
	it("flags heuristic-only threats as threat (high) for review, never clean", () => {
		const r = serverModerate("", "I will kill Rahul tomorrow", null);
		const types = r.flags.map((f: { type: string }) => f.type);
		expect(types).toContain("threat");
		expect(types).not.toContain("violence");
		expect(r.requiresReview).toBe(true);
	});
	it("downgrades quoted threats to threat_report (no violence auto-block)", () => {
		const r = serverModerate("", "Rajiv told the class he will kill you tomorrow", null);
		const types = r.flags.map((f: { type: string }) => f.type);
		expect(types).toContain("threat_report");
		expect(types).not.toContain("violence");
		expect(r.blocked).toBe(false);
		expect(r.requiresReview).toBe(true);
	});
});

describe("policy mapping keeps every threat out of public", () => {
	it("exposes the threat-review row covering both flag types", () => {
		const row = getPolicyTable().find((p) => p.id === "threat-review");
		expect(row).toBeTruthy();
		expect(row?.flagTypes).toContain("threat");
		expect(row?.flagTypes).toContain("threat_report");
		expect(row?.action.queued).toBe("QUARANTINE");
		expect(row?.action.direct).toBe("BLOCK_ACTION");
	});
	it("quarantines heuristic threats on posts (never public)", () => {
		const d = evaluateContent("I will kill Rahul tomorrow", "queued", null);
		expect(d.policy).toBe("threat-review");
		expect(d.action).toBe("QUARANTINE");
		expect(d.blocked).toBe(false);
		expect(d.needsReview).toBe(true);
	});
	it("blocks heuristic threats on comments (no review queue there)", () => {
		const d = evaluateContent("I will kill Rahul tomorrow", "direct", null);
		expect(d.action).toBe("BLOCK_ACTION");
		expect(d.blocked).toBe(true);
		expect(d.code).toBe("CONTENT_BLOCKED");
	});
	it("quarantines reported threats on posts without a violence block", () => {
		const d = evaluateContent(
			"Rajiv told the class he will kill you tomorrow",
			"queued",
			null,
		);
		expect(d.policy).toBe("threat-review");
		expect(d.action).toBe("QUARANTINE");
		expect(d.blocked).toBe(false);
		expect(d.flags.map((f: { type: string }) => f.type)).not.toContain("violence");
	});
	it("still blocks direct violence first (critical-harm row wins)", () => {
		const d = evaluateContent("I will kill you", "direct", null);
		expect(d.policy).toBe("critical-harm");
		expect(d.blocked).toBe(true);
	});
});
