import { describe, expect, it } from "vitest";
import { hasStalkingSignal, stalkingFlags } from "../../api/_stalking.js";
import { serverModerate } from "../../api/_moderation.js";
import { computeAutoPriority } from "../../api/_posts.js";

// Regression cover for the gap that let "i know your name" publish as a
// Low-priority post: surveillance statements carry no weapon and no verb of
// violence, so none of the earlier gates matched them.
describe("stalking / intimidation detection", () => {
	it.each([
		["i know your name", "i will not let you sleep"],
		["i know where you live", "see you soon"],
		["i'm watching you", "every day"],
		["i will follow you home", "you cannot hide from me"],
	])("blocks the author's surveillance claim: %s", (title, description) => {
		const result = serverModerate(title, description);
		expect(result.blocked).toBe(true);
		expect(result.flags.map((f) => f.type)).toContain("stalking");
		expect(computeAutoPriority(title, description)).toBe("critical");
	});

	it.each([
		["he said i know your name and he keeps following me", "i am scared"],
		["my senior keeps following me after class", "what should i do"],
	])("holds a victim's report for review instead of blocking: %s", (title, description) => {
		const result = serverModerate(title, description);
		expect(result.blocked).toBe(false);
		expect(result.flags.map((f) => f.type)).toContain("stalking_report");
		expect(result.requiresReview).toBe(true);
	});

	it("leaves ordinary sentences about a name alone", () => {
		expect(hasStalkingSignal("i know your name is on the exam sheet")).toBe(false);
		expect(serverModerate("i know your name is on the exam sheet", "nothing else").flags).toEqual([]);
		expect(computeAutoPriority("i know your name is on the exam sheet", "nothing else")).toBe("medium");
	});

	it("does not flag the teacher watching a class", () => {
		expect(hasStalkingSignal("the teacher keeps watching us during the exam")).toBe(false);
		expect(stalkingFlags("the teacher keeps watching us during the exam")).toEqual([]);
	});
});
