// Romantic/relationship sharing — HELD for review, never hard-blocked.
// Posts (queued) go to pending_review; comments/polls (direct) block.
// Bare love/date/proposal/engaged/break-up stay publishable school vocabulary.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

import { serverModerate } from "../../api/_moderation.js";
import { evaluateContent } from "../../api/_safety-pipeline.js";

function verdict(title: string, description: string) {
	const r = serverModerate(title, description, null);
	if (r.blocked) return "blocked";
	if (r.requiresReview) return "held";
	return "published";
}

function flagTypes(title: string, description: string) {
	return serverModerate(title, description, null).flags.map(
		(f: { type: string }) => f.type,
	);
}

const ROMANCE_CASES: Array<[string, string, string]> = [
	["crush", "Crush confession", "i have a crush on her since class 8"],
	["dating", "Dating news", "Rahul and Priya are dating now"],
	["person love", "Love note", "i love him so much"],
	["in love with", "Feelings", "i am in love with my bench partner"],
	["kiss", "Canteen gossip", "they kissed behind the library"],
	["girlfriend", "Breakup news", "my girlfriend broke up with me"],
	["boyfriend", "Relationship", "my boyfriend proposed to me"],
	["engaged to", "News", "my sister got engaged to her boyfriend"],
	["flirting", "Complaint", "he keeps flirting with girls in class"],
];

const CLEAN_CASES: Array<[string, string, string]> = [
	["bare love", "Canteen praise", "i love the canteen food"],
	["due date", "Fee reminder", "last date for fees is friday"],
	["exam date", "Schedule", "exam date sheet is out"],
	["project proposal", "Science fair", "my project proposal was accepted"],
	["engaged students", "Sports", "students are engaged in sports day"],
	["break up fight", "Fight report", "teacher told them to break up the fight"],
	["crush exam", "Study", "i will crush the exam tomorrow"],
];

describe("romantic sharing is held, never published or hard-blocked", () => {
	for (const [name, title, description] of ROMANCE_CASES) {
		it(`holds ${name}`, () => {
			expect(verdict(title, description), name).toBe("held");
		});
	}
	it("flags romantic_weak at high severity, never critical", () => {
		for (const [name, title, description] of ROMANCE_CASES) {
			const r = serverModerate(title, description, null);
			expect(r.flags.some((f) => f.type === "romantic_weak"), name).toBe(true);
			const flag = r.flags.find((f) => f.type === "romantic_weak");
			expect(flag?.severity, name).toBe("high");
			expect(r.blocked, name).toBe(false);
		}
	});
});

describe("ordinary school vocabulary stays publishable", () => {
	for (const [name, title, description] of CLEAN_CASES) {
		it(`publishes ${name}`, () => {
			expect(verdict(title, description), name).toBe("published");
			expect(flagTypes(title, description), name).not.toContain("romantic_weak");
		});
	}
});

describe("pipeline routes romantic_weak by surface", () => {
	it("queued (posts) quarantines for review without blocking", () => {
		const d = evaluateContent("i have a crush on her since class 8", "queued", null);
		expect(d.blocked).toBe(false);
		expect(d.needsReview).toBe(true);
	});
	it("direct (comments/polls) blocks", () => {
		const d = evaluateContent("i have a crush on her since class 8", "direct", null);
		expect(d.blocked).toBe(true);
		expect(d.code).toBe("CONTENT_BLOCKED");
	});
});
