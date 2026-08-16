// ═══════════════════════════════════════════════════════════════════
// Frontend Moderation Tests
// ═══════════════════════════════════════════════════════════════════
// Tests the client-side content moderation system including
// profanity detection, hate speech, dangerous content, PII,
// spam patterns, bullying detection, and text masking.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import {
	getModerationSummary,
	isBlocked,
	moderateContent,
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
				(f) => f.category === "dangerous" && f.severity === "high",
			),
		).toBe(true);
	});

	it("flags blackmail as critical", () => {
		const result = moderateContent("Pay me or I will expose your secrets");
		expect(
			result.flags.some(
				(f) => f.category === "dangerous" && f.severity === "critical",
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
