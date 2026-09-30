/**
 * Inbox triage tests — the inbox must file REAL reports from problem
 * messages instantly (no LLM), never strike anyone, and never confuse
 * chit-chat for a problem.
 */
import { describe, it, expect } from "vitest";

import { triageInboxMessage } from "../../api/_inbox.js";

describe("triageInboxMessage", () => {
	it("flags emergencies with urgent urgency", () => {
		for (const msg of [
			"Someone is bullying me every day",
			"I need help, this is urgent",
			"A senior threatened to hit me",
			"My photos are being leaked",
		]) {
			const t = triageInboxMessage(msg);
			expect(t.isProblem).toBe(true);
			expect(t.urgency).toBe("urgent");
			expect(t.isPrivate).toBe(true);
		}
	});

	it("detects real problems as normal urgency", () => {
		for (const msg of [
			"I have a problem with the bus timing",
			"The water cooler on floor 2 is not working",
			"A teacher is very rude and shouts daily",
			"Someone cheats in exams, it is unfair",
		]) {
			const t = triageInboxMessage(msg);
			expect(t.isProblem).toBe(true);
			expect(t.urgency).toBe("normal");
		}
	});

	it("marks personal problems private", () => {
		const t = triageInboxMessage(
			"I have a personal family problem, please don't share this",
		);
		expect(t.isProblem).toBe(true);
		expect(t.isPrivate).toBe(true);
		expect(t.urgency).toBe("normal");
	});

	it("ignores chit-chat and greetings", () => {
		for (const msg of [
			"Hi, how are you?",
			"Thanks for the help!",
			"What time does the library open?",
			"Great work on the new canteen menu",
		]) {
			const t = triageInboxMessage(msg);
			expect(t.isProblem).toBe(false);
			expect(t.urgency).toBe("none");
		}
	});

	it("handles empty input without throwing", () => {
		expect(triageInboxMessage("")).toEqual({
			isProblem: false,
			isPrivate: false,
			urgency: "none",
		});
	});
});

describe("coercion and distress triage (blackmail must page, fear stays private)", () => {
	it("flags named-person blackmail as urgent and private", () => {
		const t = triageInboxMessage(
			"A boy named Rahul is blackmailing me and I am scared to go to school",
		);
		expect(t.isProblem).toBe(true);
		expect(t.urgency).toBe("urgent");
		expect(t.isPrivate).toBe(true);
	});

	it("keeps fear/distress reports private", () => {
		for (const msg of [
			"I am scared to walk home alone",
			"I feel afraid in the hostel at night",
			"The ragging leaves me tense every morning",
		]) {
			const t = triageInboxMessage(msg);
			expect(t.isPrivate).toBe(true);
		}
	});
});
