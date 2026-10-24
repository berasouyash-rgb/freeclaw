import { describe, expect, it } from "vitest";
import {
	COMMENT_BLOCK_CONTENT_MSG,
	COMMENT_BLOCK_PII_MSG,
	POLL_BLOCK_CONTENT_MSG,
	POST_BLOCK_CONTENT_MSG,
	POST_BLOCK_PII_MSG,
	commentBlockMessage,
	getModerationSummary,
	isBlocked,
	isBlockedByServer,
	moderateContent,
	normalizePrePubResult,
	submitBlockMessage,
} from "../lib/moderation";

describe("moderation.coverage - severity labels and score mapping", () => {
	it("should return safe with score 0 for clean text", () => {
		const r = moderateContent("I think the library hours work well");
		expect(r.overallSeverity).toBe("none");
		expect(r.safe).toBe(true);
		expect(r.score).toBe(0);
		expect(r.flags).toHaveLength(0);
	});

	it("should map low severity to score 10 and stay safe", () => {
		const r = moderateContent(
			"THIS IS VERY ANGRY TEXT ABOUT SOMETHING REALLY BAD AND UNFAIR",
		);
		expect(r.overallSeverity).toBe("low");
		expect(r.safe).toBe(true);
		expect(r.score).toBe(10);
	});

	it("should map medium severity to score 35 and mark unsafe", () => {
		const r = moderateContent("Click here to buy now");
		expect(r.overallSeverity).toBe("medium");
		expect(r.safe).toBe(false);
		expect(r.score).toBe(35);
	});

	it("should map high severity (profanity) to score 70", () => {
		const r = moderateContent("fuck");
		expect(r.overallSeverity).toBe("high");
		expect(r.safe).toBe(false);
		expect(r.score).toBe(70);
	});

	it("should map critical severity to score 100", () => {
		const r = moderateContent("I will kill you");
		expect(r.overallSeverity).toBe("critical");
		expect(r.score).toBe(100);
	});

	it("should take the worst severity when multiple flags exist", () => {
		const r = moderateContent(
			"This is fucking ridiculous CLICK HERE TO BUY NOW",
		);
		expect(r.overallSeverity).toBe("high");
		expect(r.score).toBe(70);
	});
});

describe("moderation.coverage - profanity detector labels", () => {
	it("should label lexicon profanity hits as Profanity", () => {
		const r = moderateContent("This is shit");
		const flag = r.flags.find((f) => f.category === "profanity");
		expect(flag).toBeDefined();
		expect(flag!.severity).toBe("high");
		expect(flag!.message).toContain("Profanity");
	});

	it("should label lexicon slang hits as Slang", () => {
		const r = moderateContent("You are so dumb");
		const flag = r.flags.find((f) => f.category === "profanity");
		expect(flag).toBeDefined();
		expect(flag!.severity).toBe("high");
		expect(flag!.message).toContain("Slang");
	});

	it("should catch leet evasion sh1t", () => {
		const r = moderateContent("this hostel is sh1t");
		expect(r.flags.some((f) => f.category === "profanity")).toBe(true);
		expect(isBlocked(r)).toBe(true);
	});

	it("should catch interior separators s.h.i.t", () => {
		const r = moderateContent("this place is s.h.i.t");
		expect(r.flags.some((f) => f.category === "profanity")).toBe(true);
	});

	it("should catch spaced letters s h i t", () => {
		const r = moderateContent("this place is s h i t");
		expect(r.flags.some((f) => f.category === "profanity")).toBe(true);
	});

	it("should catch repeated letters shiiiit", () => {
		const r = moderateContent("this place is shiiiit");
		expect(r.flags.some((f) => f.category === "profanity")).toBe(true);
	});

	it("should catch Hinglish variant chutiya", () => {
		const r = moderateContent("you are a chutiya");
		expect(r.flags.some((f) => f.category === "profanity")).toBe(true);
		expect(isBlocked(r)).toBe(true);
	});

	it("should catch multi-word slang phrase shut up", () => {
		const r = moderateContent("shut up");
		expect(r.flags.some((f) => f.category === "profanity")).toBe(true);
	});

	it("should not flag class grass passage", () => {
		for (const t of [
			"the class was great today",
			"the grass is green outside school",
			"we walked through the passage to class",
		]) {
			expect(
				moderateContent(t).flags.some((f) => f.category === "profanity"),
			).toBe(false);
		}
	});
});

describe("moderation.coverage - dangerous classification branches", () => {
	it("should flag murder threats as critical dangerous", () => {
		const r = moderateContent("I will murder you tomorrow");
		expect(
			r.flags.some(
				(f) => f.category === "dangerous" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag shoot threats as critical", () => {
		const r = moderateContent("I will shoot you tomorrow");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});

	it("should flag stab threats as critical", () => {
		const r = moderateContent("I will stab you tomorrow");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});

	it("should flag beat-you-up threats as critical", () => {
		const r = moderateContent("I will beat you up after school");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});

	it("should flag hurt threats as critical", () => {
		const r = moderateContent("I will hurt you badly");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});

	it("should flag burn threats as critical", () => {
		const r = moderateContent("I will burn the school down");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});

	it("should flag bomb threats as critical", () => {
		const r = moderateContent("I will bomb the school tomorrow");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});

	it("should flag bringing a weapon as high dangerous", () => {
		const r = moderateContent("I am bringing a gun to class");
		expect(
			r.flags.some(
				(f) => f.category === "dangerous" && f.severity === "high",
			),
		).toBe(true);
	});

	it("should flag drug dealing as high dangerous", () => {
		const r = moderateContent("selling cocaine downtown");
		expect(
			r.flags.some(
				(f) => f.category === "dangerous" && f.severity === "high",
			),
		).toBe(true);
	});

	it("should flag bare blackmail word as high coercion", () => {
		const r = moderateContent("this is blackmail");
		expect(
			r.flags.some(
				(f) => f.category === "coercion" && f.severity === "high",
			),
		).toBe(true);
	});

	it("should flag if-you-dont-pay extortion as critical coercion", () => {
		const r = moderateContent(
			"If you don't pay me then I'll expose them",
		);
		expect(
			r.flags.some(
				(f) => f.category === "coercion" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag doxxing publication threats as critical coercion", () => {
		const r = moderateContent("I'll post your address online tomorrow");
		expect(
			r.flags.some(
				(f) => f.category === "coercion" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag do-as-i-say coercion as critical and dedupe the duplicate pattern", () => {
		const r = moderateContent("do as i say or else you suffer");
		const matches = r.flags.filter((f) =>
			f.message.includes("Coercive threat"),
		);
		expect(matches.length).toBe(1);
		expect(matches[0]!.severity).toBe("critical");
	});

	it("should hold ambiguous photo threats as high without blocking", () => {
		const r = moderateContent("I'll share your videos tomorrow");
		expect(
			r.flags.some(
				(f) => f.category === "dangerous" && f.severity === "high",
			),
		).toBe(true);
		expect(isBlocked(r)).toBe(false);
	});

	it("should flag dox keyword as high coercion", () => {
		const r = moderateContent("I will dox you now");
		expect(
			r.flags.some(
				(f) => f.category === "coercion" && f.severity === "high",
			),
		).toBe(true);
	});

	it("should flag generic destroy-you threats as critical", () => {
		const r = moderateContent("I'll destroy you");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});

	it("should flag you-will-regret intimidation as high", () => {
		const r = moderateContent("you'll regret this");
		expect(
			r.flags.some(
				(f) => f.category === "dangerous" && f.severity === "high",
			),
		).toBe(true);
	});

	it("should flag kys direction as critical dangerous", () => {
		const r = moderateContent("kys loser");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
		expect(isBlocked(r)).toBe(true);
	});

	it("should flag reversed hot-pics phrasing as critical", () => {
		const r = moderateContent("send pics hot now");
		expect(r.flags.some((f) => f.severity === "critical")).toBe(true);
	});
});

describe("moderation.coverage - victim report demotion", () => {
	it("should add a coercion_report even when no coercion flag fired", () => {
		const r = moderateContent("Someone is threatening me every day");
		expect(
			r.flags.some((f) => f.category === "coercion_report"),
		).toBe(true);
		expect(isBlocked(r)).toBe(false);
	});

	it("should replace coercion flags with a review note on victim reports", () => {
		const r = moderateContent(
			"Pay me or I'll leak your photos, someone is blackmailing me",
		);
		expect(r.flags.some((f) => f.category === "coercion")).toBe(false);
		expect(
			r.flags.some((f) => f.category === "coercion_report"),
		).toBe(true);
		expect(isBlocked(r)).toBe(false);
	});
});

describe("moderation.coverage - spam quality and repetition branches", () => {
	it("should flag four repeats but not three", () => {
		expect(
			moderateContent("bad bad bad bad").flags.some(
				(f) => f.category === "spam" && f.severity === "medium",
			),
		).toBe(true);
		expect(
			moderateContent("bad bad bad").flags.some(
				(f) => f.category === "spam",
			),
		).toBe(false);
	});

	it("should ignore short words in repetition detection", () => {
		expect(
			moderateContent("is is is is is is").flags.some(
				(f) => f.category === "spam",
			),
		).toBe(false);
	});

	it("should not flag stripped text shorter than 10 chars as ALL CAPS", () => {
		expect(
			moderateContent("HI THERE!").flags.some(
				(f) => f.category === "quality",
			),
		).toBe(false);
	});

	it("should not flag 10-15 char all-caps runs as shouting", () => {
		expect(
			moderateContent("HELLO WORLD").flags.some(
				(f) => f.category === "quality",
			),
		).toBe(false);
	});

	it("should not flag mixed case prose as ALL CAPS", () => {
		expect(
			moderateContent(
				"Hello World this is a normal sentence with Mixed Case",
			).flags.some((f) => f.category === "quality"),
		).toBe(false);
	});

	it("should flag only 5+ exclamation marks", () => {
		expect(
			moderateContent("Wow!!!!!").flags.some(
				(f) => f.category === "quality",
			),
		).toBe(true);
		expect(
			moderateContent("Wow!!!!").flags.some(
				(f) => f.category === "quality",
			),
		).toBe(false);
	});

	it("should flag six repeated characters but not five", () => {
		expect(
			moderateContent("so gooooooood").flags.some(
				(f) => f.category === "spam",
			),
		).toBe(true);
		expect(
			moderateContent("so goooood").flags.some(
				(f) => f.category === "spam",
			),
		).toBe(false);
	});

	it("should not flag ordinary https links as shortened spam", () => {
		expect(
			moderateContent("see https://example.com/page here").flags.some(
				(f) => f.category === "spam",
			),
		).toBe(false);
	});
});

describe("moderation.coverage - PII and credential branches", () => {
	it("should flag api_key assignments as critical privacy", () => {
		const r = moderateContent("api_key: abcdefgh1234");
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag secret_key assignments as critical privacy", () => {
		const r = moderateContent("secret_key: abc123XYZ789");
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag sk- keys as critical privacy", () => {
		const r = moderateContent("key sk-abcdefghijklmnopqrstuvwx here");
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag github tokens as critical privacy", () => {
		const r = moderateContent(`token ghp_${"a".repeat(36)} leaked`);
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag AWS keys as critical privacy", () => {
		const r = moderateContent(`key AKIA${"A".repeat(16)} here`);
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag slack tokens as critical privacy", () => {
		const r = moderateContent("token xoxb-abc123-def here");
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should flag Bearer tokens as critical privacy", () => {
		const r = moderateContent("Bearer abcdefghij1234567890");
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("should emit only one credential flag even with two secrets", () => {
		const r = moderateContent(
			"password: hunter2hunter api_key: abcdefgh1234",
		);
		const critical = r.flags.filter(
			(f) => f.category === "privacy" && f.severity === "critical",
		);
		expect(critical).toHaveLength(1);
	});

	it("should not flag bare words without values", () => {
		expect(
			moderateContent("I forgot my password").flags.some(
				(f) => f.severity === "critical",
			),
		).toBe(false);
	});

	it("should flag street address number-after-street", () => {
		const r = moderateContent("My home is on Bally Street 123");
		expect(
			r.flags.some(
				(f) => f.category === "privacy" && f.severity === "high",
			),
		).toBe(true);
	});
});

describe("moderation.coverage - bullying branches", () => {
	it("should flag coach insults as bullying", () => {
		const r = moderateContent("Coach Carter is a pathetic coach");
		expect(r.flags.some((f) => f.category === "bullying")).toBe(true);
	});

	it("should not flag praise as bullying", () => {
		expect(
			moderateContent("Mr Smith is a great teacher").flags.some(
				(f) => f.category === "bullying",
			),
		).toBe(false);
	});
});

describe("moderation.coverage - masking", () => {
	it("should mask slang keeping the first letter", () => {
		const r = moderateContent("you are dumb");
		expect(r.maskedText).not.toContain("dumb");
		expect(r.maskedText).toContain("d***");
	});

	it("should mask short slurs keeping the first letter", () => {
		const r = moderateContent("What a fag");
		expect(r.maskedText).not.toContain(" fag");
		expect(r.maskedText).toContain("f**");
	});

	it("should mask profanity case-insensitively", () => {
		const r = moderateContent("This is SHIT");
		expect(r.maskedText).not.toMatch(/shit/i);
	});
});

describe("moderation.coverage - block gates", () => {
	it("should not block medium privacy alone via isBlocked but block via server gate", () => {
		const r = moderateContent("Contact me at student@school.edu");
		expect(isBlocked(r)).toBe(false);
		expect(isBlockedByServer(r)).toBe(true);
	});

	it("should not block low quality via either gate", () => {
		const r = moderateContent(
			"THIS IS VERY ANGRY TEXT ABOUT SOMETHING REALLY BAD AND UNFAIR",
		);
		expect(isBlocked(r)).toBe(false);
		expect(isBlockedByServer(r)).toBe(false);
	});

	it("should tolerate missing flags without throwing", () => {
		const empty = {} as unknown as Parameters<typeof isBlocked>[0];
		expect(isBlocked(empty)).toBe(false);
		expect(isBlockedByServer(empty)).toBe(false);
		expect(commentBlockMessage(empty)).toBe(COMMENT_BLOCK_CONTENT_MSG);
		expect(getModerationSummary({ safe: true } as never)).toBe("");
	});

	it("should return PII message only for privacy flags", () => {
		const pii = moderateContent("email me at john.doe@example.com");
		expect(commentBlockMessage(pii)).toBe(COMMENT_BLOCK_PII_MSG);
		const critical = moderateContent("I will kill you");
		expect(commentBlockMessage(critical)).toBe(COMMENT_BLOCK_CONTENT_MSG);
	});

	it("should select post versus poll wording for each flag kind", () => {
		const pii = moderateContent("my number is 123-456-7890");
		expect(submitBlockMessage(pii, "post")).toBe(POST_BLOCK_PII_MSG);
		expect(submitBlockMessage(pii, "poll")).toBe(COMMENT_BLOCK_PII_MSG);
		const critical = moderateContent("I will kill you");
		expect(submitBlockMessage(critical, "post")).toBe(
			POST_BLOCK_CONTENT_MSG,
		);
		expect(submitBlockMessage(critical, "poll")).toBe(
			POLL_BLOCK_CONTENT_MSG,
		);
	});
});

describe("moderation.coverage - getModerationSummary branches", () => {
	it("should report serious issues for high-only flags", () => {
		const r = moderateContent("fuck");
		expect(getModerationSummary(r)).toContain("serious");
	});

	it("should combine critical serious and warning counts", () => {
		const r = moderateContent(
			"I will kill you you fucking shit Click here to buy now",
		);
		const summary = getModerationSummary(r);
		expect(summary).toContain("critical");
		expect(summary).toContain("serious");
	});

	it("should return review fallback for unsafe results with no counted severity", () => {
		expect(
			getModerationSummary({
				safe: false,
				overallSeverity: "low",
				flags: [
					{
						category: "quality",
						severity: "low",
						message: "shouting",
						matched: "HI",
					},
				],
				maskedText: "HI",
				score: 10,
			}),
		).toBe("Content needs review");
	});
});

describe("moderation.coverage - normalizePrePubResult branches", () => {
	it("should keep priority department and summary analysis fields", () => {
		const v = normalizePrePubResult({
			decision: "safe",
			reason: "ok",
			risk_score: 10,
			analysis: {
				llm_analyzed: true,
				priority: "high",
				department: "safety",
				summary: "all good",
			},
		});
		expect(v.analysis?.priority).toBe("high");
		expect(v.analysis?.department).toBe("safety");
		expect(v.analysis?.summary).toBe("all good");
	});

	it("should omit review_id when it is not a string", () => {
		const v = normalizePrePubResult({ review_id: 123, risk_score: 0 });
		expect(v.review_id).toBeUndefined();
	});

	it("should ignore unknown check keys", () => {
		const v = normalizePrePubResult({
			decision: "safe",
			risk_score: 0,
			checks: { privacy: { pass: true, issues: [] }, bogus: { pass: true } },
		});
		expect(Object.keys(v.checks ?? {}).sort()).toEqual(["privacy"]);
	});

	it("should keep malformed present checks as failed with no issues", () => {
		const v = normalizePrePubResult({
			risk_score: 0,
			checks: { safety: null },
		});
		expect(v.checks?.safety).toEqual({ pass: false, issues: [] });
	});

	it("should omit analysis when it has no keys", () => {
		const v = normalizePrePubResult({
			decision: "safe",
			risk_score: 0,
			analysis: {},
		});
		expect(v.analysis).toBeUndefined();
	});

	it("should coerce non-string reason to empty string", () => {
		expect(
			normalizePrePubResult({ reason: 42, risk_score: 0 }).reason,
		).toBe("");
	});
});
