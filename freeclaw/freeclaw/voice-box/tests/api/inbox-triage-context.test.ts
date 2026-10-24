/**
 * REGRESSION — the inbox triage was regex-FIRST and missed targeted hostility.
 *
 * `triageInboxMessage` fires only when a hardcoded word appears. Given
 * "dhansiri i will hate you", no list entry matches ("hate" is not in any
 * triage list), so the message was filed as not-a-problem with urgency
 * "none": no report row, no admin page — the exact "inbox does not flag
 * high-priority problems" failure.
 *
 * `contextualTriageUpgrade` runs the same deterministic contextual scan the
 * comment/post write paths use (`useModel: false`: no provider, no network)
 * and can only ESCALATE the regex verdict, never downgrade it.
 *
 * This file pins:
 *   1. The reported text now pages (urgent + problem + private).
 *   2. Threats and obfuscated hostility page too.
 *   3. Near-identical harmless sentences do NOT page.
 *   4. Quoted/reported abuse is filed privately WITHOUT paging.
 *   5. An already-urgent verdict is never downgraded.
 */
import { describe, expect, it } from "vitest";

import {
	contextualTriageUpgrade,
	triageInboxMessage,
} from "../../api/_inbox.js";

const NONE = { isProblem: false, isPrivate: false, urgency: "none" };

describe("REGRESSION: targeted hostility pages even with no listed word", () => {
	it.each([
		"dhansiri i will hate you",
		"*\ndhansiri i will hate you\n25/120",
		"Rahul, I hate you.",
		"so yes, I hate you.",
		"R@hul I h4te you",
		"Rahul you're dead",
		"you're finished",
		"don't come to school tomorrow",
	])("upgrades %j to urgent", async (text) => {
		// Prove the regex layer really misses it — otherwise this test
		// would pass without the contextual layer doing anything.
		const regexOnly = triageInboxMessage(text);
		expect(regexOnly.urgency).not.toBe("urgent");

		const upgraded = await contextualTriageUpgrade(text, regexOnly);
		expect(upgraded.urgency).toBe("urgent");
		expect(upgraded.isProblem).toBe(true);
		// Targeted-abuse reports must never be eligible to become public.
		expect(upgraded.isPrivate).toBe(true);
	});
});

describe("does NOT page the near-identical harmless sentences", () => {
	it.each([
		"I hate this homework.",
		"I hate this exam so much",
		"Rahul helped me with maths.",
		"the canteen food is bad",
		"we need more bins in the cafeteria",
		"Hi, how are you?",
	])("leaves %j exactly as the regex layer left it", async (text) => {
		const regexOnly = triageInboxMessage(text);
		const upgraded = await contextualTriageUpgrade(text, regexOnly);
		expect(upgraded).toEqual(regexOnly);
	});
});

describe("a victim's report is filed privately, not paged", () => {
	it("routes quoted abuse to problem+private with urgency untouched", async () => {
		const text = "Rahul said 'I hate you' yesterday.";
		const regexOnly = triageInboxMessage(text);
		const upgraded = await contextualTriageUpgrade(text, regexOnly);
		// The decisive property: a victim telling us what someone said is
		// filed for a human — never paged like an in-progress attack, and
		// never left invisible either.
		expect(upgraded.isProblem).toBe(true);
		expect(upgraded.isPrivate).toBe(true);
		expect(upgraded.urgency).toBe(regexOnly.urgency);
	});
});

describe("the upgrade can only escalate, never downgrade", () => {
	it("returns an already-urgent verdict untouched", async () => {
		const urgent = { isProblem: true, isPrivate: true, urgency: "urgent" };
		const out = await contextualTriageUpgrade(
			"the library closes too early",
			urgent,
		);
		expect(out).toEqual(urgent);
	});

	it("leaves empty input alone", async () => {
		expect(await contextualTriageUpgrade("", NONE)).toEqual(NONE);
	});

	it("tolerates a missing verdict object", async () => {
		expect(await contextualTriageUpgrade("Rahul, I hate you.", null)).toEqual({
			isProblem: true,
			isPrivate: true,
			urgency: "urgent",
		});
	});
});
