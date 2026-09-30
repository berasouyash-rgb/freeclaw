// ═══════════════════════════════════════════════════════════════════
// Coercion moderation — blackmail/extortion/doxxing red team (spec §14/15)
// ═══════════════════════════════════════════════════════════════════
// Perpetrator demands BLOCK (critical); victim reports are HELD for human
// review and never blocked; ambiguous photo-sharing threats HOLD; ordinary
// fee reminders and leak-mentions publish. Every case asserts the exact
// decision — accuracy is measured, not assumed.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";

import { serverModerate } from "../../api/_moderation.js";

function mod(text: string) {
	return serverModerate("Report", text);
}

describe("coercion BLOCKs", () => {
	it("blocks a pay-or-leak blackmail demand", () => {
		const r = mod("Pay me 500 or I'll leak your photos everywhere");
		expect(r.blocked).toBe(true);
		expect(r.flags.some((f) => f.type === "coercion")).toBe(true);
	});

	it("blocks a do-what-I-say threat", () => {
		const r = mod("Do what I say or else you will regret it");
		expect(r.blocked).toBe(true);
		expect(r.flags.some((f) => f.type === "coercion")).toBe(true);
	});

	it("blocks a doxxing threat against a phone number", () => {
		const r = mod("I will publish your phone number tomorrow morning");
		expect(r.blocked).toBe(true);
		expect(r.flags.some((f) => f.type === "coercion")).toBe(true);
	});

	it("blocks send-or-post coercion", () => {
		const r = mod("Send me the money otherwise I will post your address in the group");
		expect(r.blocked).toBe(true);
	});

	it("blocks then-I'll extortion phrasing", () => {
		const r = mod("If you don't pay, I'll expose your photos to the class");
		expect(r.blocked).toBe(true);
	});
});

describe("victim reports HOLD, never block", () => {
	it("holds a blackmail victim report for review", () => {
		const r = mod("Someone is blackmailing me for money, please help");
		expect(r.blocked).toBe(false);
		expect(r.requiresReview).toBe(true);
		expect(r.flags.some((f) => f.type === "coercion_report")).toBe(true);
	});

	it("holds a threatened-to-leak report", () => {
		const r = mod("He threatened to leak my photos if I don't pay");
		expect(r.blocked).toBe(false);
		expect(r.requiresReview).toBe(true);
	});

	it("holds an ambiguous photo-sharing threat instead of blocking", () => {
		const r = mod("I will share your photo from the fest tomorrow");
		expect(r.blocked).toBe(false);
		expect(r.requiresReview).toBe(true);
		expect(r.flags.some((f) => f.type === "coercion_weak")).toBe(true);
	});
});

describe("legit text still publishes", () => {
	it("publishes a fee reminder with an or-consequence", () => {
		const r = mod("Pay the mess fee before Friday or lose your seat");
		expect(r.blocked).toBe(false);
		expect(r.flags.some((f) => f.type.startsWith("coercion"))).toBe(false);
	});

	it("publishes a leak mention with no coercion", () => {
		const r = mod("The hostel fee post was leaked early by mistake");
		expect(r.blocked).toBe(false);
		expect(r.flags.some((f) => f.type.startsWith("coercion"))).toBe(false);
	});

	it("publishes a plain complaint", () => {
		const r = mod("The water cooler near Block B has been broken for a week");
		expect(r.blocked).toBe(false);
	});

	it("publishes harmless tell-you phrasing (no exposure target)", () => {
		const r = mod("Give me the book, then I'll tell you the answer tomorrow");
		expect(r.blocked).toBe(false);
	});
});
