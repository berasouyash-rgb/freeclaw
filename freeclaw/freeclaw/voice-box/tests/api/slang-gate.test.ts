/**
 * Slang/abuse gate tests — slang must be MASKED (never public raw) but must
 * NOT block legitimate complaints; obfuscated profanity/slurs (leet) must
 * still be caught at base-word severity without mangling clean words.
 */
import { describe, it, expect } from "vitest";

import { moderateContent } from "../../api/_auth.js";

describe("slang gate", () => {
	it("masks slang as medium severity without blocking", () => {
		const r = moderateContent("The warden is so dumb, this sucks");
		expect(r.flags.some((f) => f.category === "slang")).toBe(true);
		expect(r.safe).toBe(true);
		expect(r.maskedText).not.toMatch(/dumb/);
		expect(r.maskedText).not.toMatch(/sucks/);
	});

	it("masks Hinglish slang without blocking", () => {
		const r = moderateContent("Yeh bakwas hai, bewakoof log");
		expect(r.flags.some((f) => f.category === "slang")).toBe(true);
		expect(r.safe).toBe(true);
	});

	it("still blocks plain profanity and slurs", () => {
		expect(moderateContent("You are a bitch").safe).toBe(false);
		const slur = moderateContent("You people are all niggers");
		expect(slur.safe).toBe(false);
		expect(
			slur.flags.some(
				(f) => f.category === "hate_speech" && f.severity === "critical",
			),
		).toBe(true);
	});

	it("catches leet-obfuscated profanity at high severity", () => {
		const r = moderateContent("You are a sh1t b!tch");
		expect(r.safe).toBe(false);
		expect(
			r.flags.some((f) => f.word === "shit (obfuscated)"),
		).toBe(true);
	});

	it("does not mangle clean words that share letters", () => {
		const r = moderateContent("Hello, the shell workshop is in the hall");
		expect(r.flags.length).toBe(0);
		expect(r.maskedText).toBe("Hello, the shell workshop is in the hall");
	});
});
