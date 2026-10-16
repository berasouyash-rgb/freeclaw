// Comment zero-tolerance tiers — SCHOOL POLICY: no stars are published.
// Every tier below runs against the REAL serverModerate gate:
//   - slang / profanity (even obfuscated or transliterated): BLOCKED
//     immediately, in-request — the user removes the word and resubmits.
//   - slurs, threats, PII, extortion demands: BLOCKED as before.
// maskProfanity still masks wherever masking applies (private support
// surfaces, legacy rows, LLM redaction) — that layer is unchanged and
// asserted once below.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

import { maskProfanity } from "../../api/_auth.js";
import { serverModerate } from "../../api/_moderation.js";

function verdict(text: string) {
	const r = serverModerate("", text, null);
	if (r.blocked) return "blocked";
	if (r.requiresReview) return "held";
	return "published";
}

describe("slang and profanity are blocked immediately — no stars", () => {
	it("english slang is blocked", () => {
		expect(verdict("this canteen food sucks, fix it")).toBe("blocked");
	});

	it("hindi-transliterated slang is blocked", () => {
		expect(verdict("yeh warden bilkul bewakoof hai")).toBe("blocked");
	});

	it("profanity is blocked", () => {
		expect(verdict("This is fucking ridiculous, fix the lift")).toBe("blocked");
	});

	it("obfuscated profanity (sh1t) is blocked, not slipped through", () => {
		expect(verdict("this hostel is sh1t")).toBe("blocked");
	});

	it("clean complaints still publish", () => {
		expect(verdict("the library fan has been broken for a week")).toBe(
			"published",
		);
	});
});

describe("directed self-harm and school abuse vocabulary are blocked", () => {
	it("kys is blocked", () => {
		expect(verdict("kys, nobody likes you")).toBe("blocked");
	});

	it("go kill yourself is blocked", () => {
		expect(verdict("go kill yourself, bully")).toBe("blocked");
	});

	it("hang yourself threats are blocked", () => {
		expect(verdict("go hang yourself after class")).toBe("blocked");
	});

	it("hindi abuse (chutiya) is blocked", () => {
		expect(verdict("you are a chutiya")).toBe("blocked");
	});

	it("hindi abuse (bhenchod) is blocked", () => {
		expect(verdict("bhenchod, leave him alone")).toBe("blocked");
	});

	it("sexual vulgarity (pervert) is blocked", () => {
		expect(verdict("that senior is a pervert")).toBe("blocked");
	});

	it("abbreviated abuse (stfu) is blocked", () => {
		expect(verdict("stfu, nobody is listening")).toBe("blocked");
	});

	it("bare shut up is blocked", () => {
		expect(verdict("shut up")).toBe("blocked");
	});

	it("clean controls still publish", () => {
		expect(verdict("the assembly hall was full")).toBe("published");
		expect(verdict("we won the match yesterday")).toBe("published");
	});
});

describe("real harm stays blocked", () => {
	it("slurs are blocked", () => {
		expect(verdict("he called me a faggot in class")).toBe("blocked");
	});

	it("violent threats are blocked", () => {
		expect(verdict("i will kill you after school")).toBe("blocked");
	});

	it("leaked PII is blocked", () => {
		expect(verdict("my address is 12 Park Street, call 9876543210")).toBe("blocked");
	});

	it("extortion demands are blocked", () => {
		expect(verdict("pay me or i will leak your photos")).toBe("blocked");
	});
});

describe("masking layer unchanged (defense-in-depth)", () => {
	it("maskProfanity still masks where masking applies", () => {
		expect(maskProfanity("this canteen food sucks")).toContain("s****");
		expect(maskProfanity("you are an idiot")).not.toContain("idiot");
	});
});
