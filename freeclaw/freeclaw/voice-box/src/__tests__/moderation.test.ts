// ═══════════════════════════════════════════════════════════════════
// Frontend Moderation Tests
// ═══════════════════════════════════════════════════════════════════
// Tests the client-side content moderation system including
// profanity detection, hate speech, dangerous content, PII,
// spam patterns, bullying detection, and text masking.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import {
	commentBlockMessage,
	getModerationSummary,
	isBlocked,
	isBlockedByServer,
	moderateContent,
	normalizePrePubResult,
	submitBlockMessage,
} from "../lib/moderation";

describe("Frontend Moderation - Basic Detection", () => {
	it("flags profanity as high severity", () => {
		const result = moderateContent("This is fucking ridiculous");
		expect(result.safe).toBe(false);
		expect(
			result.flags.some(
				(f) => f.category === "profanity" && f.severity === "high",
			),
		).toBe(true);
	});

	it("flags hate speech as critical", () => {
		const result = moderateContent("This is some nigger shit");
		expect(
			result.flags.some(
				(f) => f.category === "hate_speech" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("flags self-harm as critical", () => {
		const result = moderateContent("I want to kill myself");
		expect(
			result.flags.some(
				(f) => f.category === "dangerous" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("flags violence threats as critical", () => {
		const result = moderateContent("I am going to kill you");
		expect(
			result.flags.some(
				(f) => f.category === "dangerous" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("flags doxxing attempts as high", () => {
		const result = moderateContent("I am going to dox you");
		expect(
			result.flags.some(
				(f) => f.category === "coercion" && f.severity === "high",
			),
		).toBe(true);
	});

	it("flags blackmail as critical", () => {
		const result = moderateContent("Pay me or I will expose your secrets");
		expect(
			result.flags.some(
				(f) => f.category === "coercion" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("flags weapons mentions as high", () => {
		const result = moderateContent("I am bringing a knife to school");
		expect(
			result.flags.some(
				(f) => f.category === "dangerous" && f.severity === "high",
			),
		).toBe(true);
	});

	it("flags hot-pics solicitation as critical, matching the server gate", () => {
		for (const text of [
			"User requests hot photos of Shaksi Piry",
			"priyya pic hot phots",
		]) {
			const result = moderateContent(text);
			expect(
				result.flags.some(
					(f) => f.category === "dangerous" && f.severity === "critical",
				),
			).toBe(true);
		}
	});

	it("leaves innocent hot/food language alone", () => {
		const result = moderateContent("hot lunch served fresh every day");
		expect(
			result.flags.some((f) => f.severity === "critical"),
		).toBe(false);
	});
});

describe("Frontend Moderation - Spam Detection", () => {
	it("flags spam keywords", () => {
		const result = moderateContent("Click here to buy now and earn $5000");
		expect(result.flags.some((f) => f.category === "spam")).toBe(true);
	});

	it("flags shortened URLs", () => {
		// Note: The regex pattern requires the domain to appear after the initial URL segment
		// Example: https://redirect.com/bit.ly/abc or similar format
		const result = moderateContent(
			"Check this out: https://redirect.com/bit.ly/abc123",
		);
		expect(result.flags.some((f) => f.category === "spam")).toBe(true);
	});

	it("flags repeated words as spam", () => {
		const result = moderateContent("bad bad bad bad bad this is terrible");
		expect(result.flags.some((f) => f.category === "spam")).toBe(true);
	});

	it("flags repeated characters", () => {
		const result = moderateContent("This is so goooooooooood");
		expect(result.flags.some((f) => f.category === "spam")).toBe(true);
	});
});

describe("Frontend Moderation - PII Detection", () => {
	it("detects email addresses", () => {
		const result = moderateContent("Contact me at student@school.edu");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(true);
	});

	it("detects phone numbers", () => {
		const result = moderateContent("Call me at 555-123-4567");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(true);
	});

	it("detects street address with number BEFORE street name (123 Main Street)", () => {
		const result = moderateContent("I live at 123 Main Street");
		expect(
			result.flags.some(
				(f) => f.category === "privacy" && f.severity === "high",
			),
		).toBe(true);
		expect(result.safe).toBe(false);
	});

	it("detects street address with number AFTER street name (Bally Street 123)", () => {
		const result = moderateContent("My home is on Bally Street 123");
		expect(
			result.flags.some(
				(f) => f.category === "privacy" && f.severity === "high",
			),
		).toBe(true);
	});

	it("detects address abbreviations (St, Ave, Rd, Ln, Dr, Blvd)", () => {
		for (const addr of [
			"456 Oak St",
			"789 Park Ave",
			"321 Lake Rd",
			"42 Maple Ln",
			"100 Sunset Dr",
			"1 Hollywood Blvd",
		]) {
			const result = moderateContent(`I stay at ${addr}`);
			expect(result.flags.some((f) => f.category === "privacy")).toBe(true);
		}
	});

	it("detects name + location: lowercase name (kaku lives in bally street 123)", () => {
		const result = moderateContent("kaku lives in bally street 123");
		expect(
			result.flags.some(
				(f) => f.category === "privacy" && f.severity === "high",
			),
		).toBe(true);
	});

	it("detects name + location: ALL CAPS with misspelled street (user reported case)", () => {
		const result = moderateContent(
			"MAAM KAULI LIVES IN STREE 123 AND BALLY HOWRAG",
		);
		expect(
			result.flags.some(
				(f) => f.category === "privacy" && f.severity === "high",
			),
		).toBe(true);
	});

	it('detects name + location: correctly-spelled "howrah" locality (live production leak case)', () => {
		const result = moderateContent("souaysh live in bally howrah");
		expect(
			result.flags.some(
				(f) => f.category === "privacy" && f.severity === "high",
			),
		).toBe(true);
		expect(result.safe).toBe(false);
	});

	it('detects name + location: gerund "living" with "howrah" locality', () => {
		const result = moderateContent("souaysh is living in bally howrah");
		expect(
			result.flags.some(
				(f) => f.category === "privacy" && f.severity === "high",
			),
		).toBe(true);
		expect(result.safe).toBe(false);
	});

	it("detects name + stays/resides variants", () => {
		expect(
			moderateContent("Raju stays at MG Road 42").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(true);
		expect(
			moderateContent("Priya resides near Gandhi Street").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(true);
	});

	it("does NOT flag a bare name without location context", () => {
		const result = moderateContent("Kaku is a bad boy");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(false);
	});

	it("does NOT flag generic street mention without an address", () => {
		expect(
			moderateContent("I crossed the street to get to school").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(false);
		expect(
			moderateContent("The road to school is bumpy").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(false);
	});

	it('does NOT flag "the best 5 students" (embedded st false positive)', () => {
		const result = moderateContent("The best 5 students in class");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(false);
	});

	it('does NOT flag "first place 5 times" (place is a common English word)', () => {
		const result = moderateContent("I got first place 5 times in the race");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(false);
	});

	it('does NOT flag "phase 2" or "highway 12"', () => {
		expect(
			moderateContent("We are starting phase 2 of the project").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(false);
		expect(
			moderateContent("Take highway 12 to school").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(false);
	});

	it('does NOT flag "block 3" or "park 7" without street context', () => {
		expect(
			moderateContent("The exam is in block 3").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(false);
		expect(
			moderateContent("Meet me at the park at 7 oclock").flags.some(
				(f) => f.category === "privacy",
			),
		).toBe(false);
	});

	it('does NOT flag "Grade 5 went to the park" (park is a common noun)', () => {
		const result = moderateContent("Grade 5 went to the park today");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(false);
	});

	it('does NOT flag "bus 12 to the city" (city is a common noun)', () => {
		const result = moderateContent("We took bus 12 to the city");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(false);
	});

	it('does NOT flag "the exam is in building 5" (building is a common noun)', () => {
		const result = moderateContent("The exam is in building 5 today");
		expect(result.flags.some((f) => f.category === "privacy")).toBe(false);
	});
});

describe("Frontend Moderation - Bullying Detection", () => {
	it("detects targeted teacher insults", () => {
		// No period after Mr/Mrs/Ms because the regex expects whitespace after the honorific
		const result = moderateContent("Mr Smith is a terrible teacher");
		expect(result.flags.some((f) => f.category === "bullying")).toBe(true);
	});

	it("detects teacher insults with honorifics", () => {
		const result = moderateContent("Mrs Johnson is a horrible principal");
		expect(result.flags.some((f) => f.category === "bullying")).toBe(true);
	});
});

describe("Frontend Moderation - Quality Issues", () => {
	it("flags ALL CAPS text", () => {
		// 45 continuous uppercase chars guarantees detection
		const result = moderateContent(
			"THIS IS VERY ANGRY TEXT ABOUT SOMETHING REALLY BAD AND UNFAIR",
		);
		expect(result.flags.length).toBeGreaterThan(0);
		expect(result.flags.some((f) => f.category === "quality")).toBe(true);
	});

	it("flags excessive exclamation marks", () => {
		const result = moderateContent("This is so bad!!!!!!");
		expect(result.flags.some((f) => f.category === "quality")).toBe(true);
	});
});

describe("Frontend Moderation - Edge Cases", () => {
	it("allows safe content", () => {
		const result = moderateContent(
			"I think the school cafeteria could improve the food quality",
		);
		expect(result.safe).toBe(true);
		expect(result.flags).toHaveLength(0);
	});

	it("handles empty text", () => {
		const result = moderateContent("");
		expect(result.safe).toBe(true);
		expect(result.flags).toHaveLength(0);
	});

	it("handles text with only numbers", () => {
		const result = moderateContent("12345 67890");
		expect(result.safe).toBe(true);
	});

	it("handles text with special characters only", () => {
		const result = moderateContent("!@#$%^&*()_+-=[]{}|;:,.<>?");
		expect(result.safe).toBe(true);
	});
});

describe("Frontend Moderation - Masked Text", () => {
	it("masks profanity", () => {
		const result = moderateContent("This is fucking awful");
		expect(result.maskedText).not.toContain("fucking");
		expect(result.maskedText).toContain("f*****");
	});

	it("masks slurs", () => {
		const result = moderateContent("What a nigger");
		expect(result.maskedText).not.toContain("nigger");
		expect(result.maskedText).toContain("n*****");
	});

	it("preserves safe text unchanged", () => {
		const result = moderateContent("Hello, how are you today?");
		expect(result.maskedText).toBe("Hello, how are you today?");
	});
});

describe("Frontend Moderation - isBlocked", () => {
	it("blocks critical content", () => {
		const result = moderateContent("I will kill you");
		expect(isBlocked(result)).toBe(true);
	});

	it("does not block safe content", () => {
		const result = moderateContent("The food needs improvement");
		expect(isBlocked(result)).toBe(false);
	});

	it("blocks directed self-harm and school abuse like the server gate", () => {
		for (const t of [
			"kys, nobody likes you",
			"go kill yourself, bully",
			"you are a chutiya",
			"that senior is a pervert",
			"stfu, nobody is listening",
			"shut up",
		]) {
			expect(isBlocked(moderateContent(t))).toBe(true);
		}
	});
});

describe("Frontend Moderation - client/server parity (live feedback must match the publish verdict)", () => {
	it("blocks perpetrator coercion like the server", () => {
		for (const t of [
			"Pay me 500 or I'll leak your photos everywhere",
			"Do what I say or else you will regret it",
			"I will publish your phone number tomorrow morning",
			"Send me the money otherwise I will post your address in the group",
		]) {
			expect(isBlocked(moderateContent(t))).toBe(true);
		}
	});

	it("never blocks victim reports (server holds them for review)", () => {
		for (const t of [
			"Someone is blackmailing me for money, please help",
			"He threatened to leak my photos if I don't pay",
		]) {
			const r = moderateContent(t);
			expect(isBlocked(r)).toBe(false);
			expect(r.flags.length).toBeGreaterThan(0);
		}
	});

	it("holds ambiguous photo threats instead of blocking", () => {
		const r = moderateContent("I will share your photo from the fest tomorrow");
		expect(isBlocked(r)).toBe(false);
	});

	it("blocks leaked credentials like the server", () => {
		for (const t of [
			"my password: hunter2hunter",
			"api_key = ak_live_9876543210abcdef",
			"token: xyz9876543210qwerty",
			"key sk-abcdefghijklmnopqrstuvwx here",
		]) {
			expect(isBlocked(moderateContent(t))).toBe(true);
		}
	});

	it("publishes plain words without values", () => {
		for (const t of [
			"I forgot my password, how do I reset it",
			"secret santa gifts are due Friday",
			"Pay the mess fee before Friday or lose your seat",
			"The water cooler near Block B has been broken for a week",
			"Give me the book, then I'll tell you the answer tomorrow",
		]) {
			expect(isBlocked(moderateContent(t))).toBe(false);
		}
	});

	it("blocks then-I'll extortion phrasing", () => {
		expect(
			isBlocked(
				moderateContent("If you don't pay, I'll expose your photos to the class"),
			),
		).toBe(true);
	});
});

describe("Frontend Moderation - comment-surface gate (isBlockedByServer mirrors api/_comments.js)", () => {
	it("blocks PII comments — comments have no review queue, server 403s any privacy flag", () => {
		for (const t of [
			"email me at john.doe@example.com",
			"my number is 123-456-7890",
			"i live at 123 Main Street",
		]) {
			const r = moderateContent(t);
			expect(
				r.flags.some((f) => f.category === "privacy"),
			).toBe(true);
			expect(isBlockedByServer(r)).toBe(true);
			expect(commentBlockMessage(r)).toBe(
				"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
			);
		}
	});

	it("blocks critical content with the generic safety message", () => {
		const r = moderateContent("I will kill you");
		expect(isBlockedByServer(r)).toBe(true);
		expect(commentBlockMessage(r)).toBe(
			"This comment violates our safety guidelines and cannot be posted.",
		);
	});

	it("blocks plain profanity — no stars are published (school zero-tolerance)", () => {
		const r = moderateContent("This is fucking ridiculous");
		expect(isBlockedByServer(r)).toBe(true);
		expect(isBlocked(r)).toBe(true);
	});

	it("blocks slang — remove the word and resubmit", () => {
		for (const t of ["this assignment sucks", "what a dumb idea"]) {
			const r = moderateContent(t);
			expect(isBlockedByServer(r)).toBe(true);
		}
	});

	it("does not block clean comments", () => {
		expect(
			isBlockedByServer(moderateContent("Great points, thanks for sharing")),
		).toBe(false);
	});
});

describe("Frontend Moderation - Submit-surface gate (submitBlockMessage mirrors api/_posts.js + api/_polls.js)", () => {
	it("post PII → api/_posts.js PII 403 wording, byte-identical", () => {
		const r = moderateContent("my number is 123-456-7890");
		expect(isBlockedByServer(r)).toBe(true);
		expect(submitBlockMessage(r, "post")).toBe(
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove all personal details and try again.",
		);
	});

	it("post critical content → api/_posts.js CONTENT 403 wording, byte-identical", () => {
		const r = moderateContent("I will kill you");
		expect(isBlockedByServer(r)).toBe(true);
		expect(submitBlockMessage(r, "post")).toBe(
			"This content violates our safety guidelines and cannot be published. If you are in crisis, please contact a counselor or call a crisis hotline.",
		);
	});

	it("poll PII → api/_polls.js PII 403 wording (reuses comment PII text)", () => {
		const r = moderateContent("email me at john.doe@example.com");
		expect(isBlockedByServer(r)).toBe(true);
		expect(submitBlockMessage(r, "poll")).toBe(
			"Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details.",
		);
	});

	it("poll critical content → api/_polls.js CONTENT 403 wording, byte-identical", () => {
		const r = moderateContent("I will kill you");
		expect(isBlockedByServer(r)).toBe(true);
		expect(submitBlockMessage(r, "poll")).toBe(
			"This poll violates our safety guidelines and cannot be published.",
		);
	});

	it("post and poll PII wording differ exactly as the two routes do", () => {
		const r = moderateContent("my number is 123-456-7890");
		expect(submitBlockMessage(r, "post")).not.toBe(
			submitBlockMessage(r, "poll"),
		);
	});
});

describe("Frontend Moderation - getModerationSummary", () => {
	it("returns empty for safe content", () => {
		const result = moderateContent("Nice weather today");
		expect(getModerationSummary(result)).toBe("");
	});

	it("summarizes issues for flagged content", () => {
		const result = moderateContent("This is fucking shit and you are a nigger");
		const summary = getModerationSummary(result);
		expect(summary.length).toBeGreaterThan(0);
		expect(summary).toContain("critical");
	});

	it("summarizes medium-only flags as warnings", () => {
		const result = moderateContent("Click here to buy now");
		const summary = getModerationSummary(result);
		expect(summary).toContain("warning");
		expect(summary).toContain("1");
	});
});

describe("Frontend Moderation - Scoring", () => {
	it("scores clean content as 0", () => {
		const result = moderateContent("Clean content");
		expect(result.score).toBe(0);
	});

	it("scores critical content as 100", () => {
		const result = moderateContent("I am going to kill myself");
		expect(result.score).toBe(100);
	});

	it("scores severe content correctly", () => {
		const result = moderateContent("Fuck you bitch");
		expect(result.score).toBeLessThanOrEqual(100);
		expect(result.score).toBeGreaterThan(0);
	});
});

describe("Frontend Moderation - evasion parity (client gate must match the server 403)", () => {
	it("blocks full-width evasion like the server NFKC gate", () => {
		for (const t of [
			"this canteen food ｓｕｃｋｓ",
			"this hostel is ｓｈｉｔ",
			"he called me a ｆａｇｇｏｔ in class",
		]) {
			expect(isBlocked(moderateContent(t))).toBe(true);
		}
	});

	it("blocks leet evasion with the server substitution map", () => {
		for (const t of [
			"this hostel is sh1t",
			"shut up you b!tch",
			"this canteen food suck5",
		]) {
			expect(isBlocked(moderateContent(t))).toBe(true);
		}
	});

	it("does not flag ordinary words containing leet characters", () => {
		for (const t of [
			"win7 update broke my laptop",
			"class 5 homework is on page 10",
			"room 101 is locked",
			"I got an a+ in maths",
		]) {
			expect(isBlocked(moderateContent(t))).toBe(false);
		}
	});

	it("flags zero-width splitter evasion like the server strip", () => {
		expect(isBlocked(moderateContent("sh\u200bit happens here"))).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════
// normalizePrePubResult — the /api/pre-publish trust boundary
// ═══════════════════════════════════════════════════════════════════
// The advisory verdict comes from an LLM pipeline behind a lambda: it can
// arrive partial, degraded, proxied, or from an older deploy. The submit
// page renders every field, so ONE missing field used to throw during
// render and unmount the whole page. The only safe rule is that the page
// never sees the raw body:
//   - every field it reads is the right type, and
//   - nothing is coerced toward reassurance (a check that did not run is
//     NOT a pass; an unreadable decision is NOT "safe").
describe("normalizePrePubResult - untrusted verdict shapes", () => {
	it("round-trips a complete, well-formed verdict", () => {
		const verdict = normalizePrePubResult({
			decision: "revision",
			reason: "Looks like spam",
			risk_score: 45,
			review_id: "rev_1",
			checks: {
				privacy: { pass: true, issues: [] },
				safety: { pass: true, issues: [] },
				spam: { pass: false, issues: ["promotional tone"] },
				quality: { pass: true, issues: [] },
			},
			analysis: {
				llm_analyzed: true,
				estimated_resolution_time: "2d",
			},
		});

		expect(verdict.decision).toBe("revision");
		expect(verdict.reason).toBe("Looks like spam");
		expect(verdict.risk_score).toBe(45);
		expect(verdict.review_id).toBe("rev_1");
		expect(verdict.checks?.spam).toEqual({
			pass: false,
			issues: ["promotional tone"],
		});
		expect(verdict.analysis?.llm_analyzed).toBe(true);
		expect(verdict.analysis?.estimated_resolution_time).toBe("2d");
	});

	it("keeps only the checks the server actually reported", () => {
		const verdict = normalizePrePubResult({
			decision: "high_risk",
			reason: "pii",
			risk_score: 90,
			checks: { privacy: { pass: false } },
		});

		// A check that never ran must not be rendered as a green pass…
		expect(Object.keys(verdict.checks ?? {})).toEqual(["privacy"]);
		// …and a missing `issues` list is an empty list, not a crash.
		expect(verdict.checks?.privacy).toEqual({ pass: false, issues: [] });
	});

	it("never reports a check as passing unless the server said so", () => {
		const verdict = normalizePrePubResult({
			checks: {
				privacy: { issues: ["phone number"] },
				safety: { pass: "yes", issues: [] },
			},
		});

		expect(verdict.checks?.privacy?.pass).toBe(false);
		expect(verdict.checks?.safety?.pass).toBe(false);
	});

	it("omits `checks` entirely when the server reported none", () => {
		const verdict = normalizePrePubResult({ decision: "safe", risk_score: 0 });
		expect(verdict.checks).toBeUndefined();
	});

	it("does not invent a decision — an unknown or absent one reads as empty", () => {
		expect(normalizePrePubResult({ risk_score: 0 }).decision).toBe("");
		expect(
			normalizePrePubResult({ decision: "APPROVED", risk_score: 0 }).decision,
		).toBe("APPROVED");
	});

	it("clamps an out-of-range or unreadable risk score to a usable number", () => {
		expect(normalizePrePubResult({ risk_score: 240 }).risk_score).toBe(100);
		expect(normalizePrePubResult({ risk_score: -30 }).risk_score).toBe(0);
		expect(normalizePrePubResult({ risk_score: "55" }).risk_score).toBe(55);
		// NaN must never reach the render: it prints as "NaN/100" and an
		// invalid CSS width.
		expect(normalizePrePubResult({ risk_score: "high" }).risk_score).toBe(0);
		expect(normalizePrePubResult({}).risk_score).toBe(0);
	});

	it("survives a body that is not an object at all", () => {
		for (const raw of [null, undefined, "nope", 42, [], true]) {
			const verdict = normalizePrePubResult(raw);
			expect(verdict.decision).toBe("");
			expect(verdict.reason).toBe("");
			expect(verdict.risk_score).toBe(0);
			expect(verdict.checks).toBeUndefined();
			expect(verdict.analysis).toBeUndefined();
		}
	});

	it("drops non-string entries from an issues list", () => {
		const verdict = normalizePrePubResult({
			checks: { safety: { pass: false, issues: ["ok", 7, null, { a: 1 }] } },
		});
		expect(verdict.checks?.safety?.issues).toEqual(["ok"]);
	});

	it("coerces analysis fields to their types", () => {
		const verdict = normalizePrePubResult({
			analysis: { llm_analyzed: "yes", estimated_resolution_time: 5 },
		});
		expect(verdict.analysis?.llm_analyzed).toBe(false);
		expect(verdict.analysis?.estimated_resolution_time).toBeUndefined();
	});
});
