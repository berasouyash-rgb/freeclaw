// Safety pipeline — one policy table, verdicts identical to the routes'
// inline gates on every locked case, plus the table itself is inspectable.
// If anyone changes enforcement, this file names the new behavior.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

import { evaluateContent, getPolicyTable } from "../../api/_safety-pipeline.js";

function direct(text: string) {
	return evaluateContent(text, "direct");
}

describe("blocking verdicts (comments/polls surfaces)", () => {
	it("blocks PII with the PII code", () => {
		const r = direct("email me at john.doe@example.com");
		expect(r.blocked).toBe(true);
		expect(r.action).toBe("BLOCK_ACTION");
		expect(r.policy).toBe("pii-leak");
		expect(r.code).toBe("PII_BLOCKED");
	});

	it("blocks slang immediately — no stars", () => {
		const r = direct("this canteen food sucks, fix it");
		expect(r.blocked).toBe(true);
		expect(r.policy).toBe("school-zero-tolerance");
		expect(r.code).toBe("CONTENT_BLOCKED");
	});

	it("blocks transliterated slang and obfuscated profanity", () => {
		expect(direct("yeh warden bilkul bewakoof hai").blocked).toBe(true);
		expect(direct("this hostel is sh1t").blocked).toBe(true);
	});

	it("blocks slurs, threats, bullying, blackmail", () => {
		expect(direct("he called me a faggot in class").blocked).toBe(true);
		expect(direct("i will kill you after school").blocked).toBe(true);
		expect(direct("pay me or i will leak your photos").blocked).toBe(true);
	});

	it("blocks weak privacy signals on direct surfaces", () => {
		const r = direct("my pin is 400001, come visit");
		expect(r.blocked).toBe(true);
		expect(r.policy).toBe("weak-signal-review");
	});
});

describe("allow verdicts (route parity — these publish today)", () => {
	it("publishes clean complaints", () => {
		const r = direct("the library fan has been broken for a week");
		expect(r.action).toBe("ALLOW");
		expect(r.blocked).toBe(false);
	});

	it("publishes victim coercion reports (never silences victims)", () => {
		const r = direct("someone is blackmailing me for money");
		expect(r.blocked).toBe(false);
	});

	it("publishes fee reminders (not extortion)", () => {
		const r = direct("pay the mess fee or lose your seat");
		expect(r.blocked).toBe(false);
	});
});

describe("queued surfaces quarantine instead of blocking weak signals", () => {
	it("quarantines weak privacy signals for human review", () => {
		const r = evaluateContent("my pin is 400001, come visit", "queued");
		expect(r.action).toBe("QUARANTINE");
		expect(r.blocked).toBe(false);
	});

	it("still blocks hard violations on queued surfaces", () => {
		const r = evaluateContent("this canteen food sucks", "queued");
		expect(r.action).toBe("BLOCK_ACTION");
		expect(r.blocked).toBe(true);
	});

	it("quarantines named accusations on queued surfaces, blocks them direct", () => {
		const text = "Student Rahul accused of blackmailing a peer";
		const queued = evaluateContent(text, "queued");
		expect(queued.action).toBe("QUARANTINE");
		expect(queued.blocked).toBe(false);
		expect(queued.policy).toBe("accused-person-review");
		const directVerdict = direct(text);
		expect(directVerdict.action).toBe("BLOCK_ACTION");
		expect(directVerdict.blocked).toBe(true);
	});
});

describe("traceability", () => {
	it("every verdict carries trace, language, and reasons", () => {
		const r = direct("this canteen food sucks");
		expect(r.trace.length).toBeGreaterThanOrEqual(3);
		expect(r.language).toBe("en");
		expect(r.reasons.length).toBeGreaterThan(0);
		expect(r.classification).toBe("profanity");
		expect(r.confidence).toBe("high");
	});

	it("exposes the policy table with the school rule explicit", () => {
		const table = getPolicyTable();
		const rule = table.find((p) => p.id === "school-zero-tolerance");
		expect(rule).toBeTruthy();
		expect(rule?.flagTypes).toContain("profanity");
		expect(rule?.action.direct).toBe("BLOCK_ACTION");
	});
});
