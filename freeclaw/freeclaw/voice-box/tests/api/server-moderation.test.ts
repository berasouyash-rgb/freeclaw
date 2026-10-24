// Server moderation gate — addresses + sexual content must never publish.
// Regression suite for reported misses: comma addresses, digit-less street
// addresses, and sexual sharing/solicitation passing serverModerate clean.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));

import { serverModerate } from "../../api/_moderation.js";

function verdict(title: string, description: string) {
	const r = serverModerate(title, description, null);
	if (r.blocked) return "blocked";
	if (r.requiresReview) return "held";
	return "published";
}

describe("address leaks are blocked or held, never published", () => {
	it("blocks a comma-separated street address", () => {
		expect(
			verdict(
				"Package complaint",
				"My address is 12, Park Street, Kolkata. Come collect it",
			),
		).not.toBe("published");
	});

	it("holds a digit-less street address with a place", () => {
		expect(
			verdict(
				"Road issue",
				"I live on Park Street, Kolkata near the school, my name is Rahul",
			),
		).not.toBe("published");
	});

	it("holds a self-located street with no number or place", () => {
		expect(
			verdict("Hostel issue", "I live on Park Street near the school"),
		).not.toBe("published");
	});

	it("holds flat + road addresses without street digits", () => {
		expect(
			verdict(
				"Water problem",
				"Flat 4B Sunshine Apartments, MG Road, Bangalore, no water",
			),
		).not.toBe("published");
	});
});

describe("sexual sharing and solicitation never publish", () => {
	it("blocks sharing nudes", () => {
		expect(
			verdict("Sharing pics", "She sent nudes, posting them here for everyone"),
		).toBe("blocked");
	});

	it("blocks porn solicitation", () => {
		expect(
			verdict("Video share", "watch my porn video tonight, link below"),
		).toBe("blocked");
	});

	it("blocks hot-pics solicitation naming a student (both orders)", () => {
		expect(
			verdict("User requests hot photos of Shaksi Piry", "shaksi priyya pic hot phots"),
		).toBe("blocked");
	});

	it("blocks the phots-typo variant", () => {
		const r = serverModerate("priyya pic hot phots", "hot priya very hot", null);
		expect(r.blocked).toBe(true);
		expect(r.flags.some((f) => f.type === "explicit")).toBe(true);
	});

	it("lets innocent hot/food/event language publish", () => {
		expect(verdict("Canteen menu", "hot lunch served fresh every day")).toBe("published");
		expect(verdict("Sports day", "sports day photos in the hot sun")).toBe("published");
	});

	it("holds sexualized solicitation for review", () => {
		expect(
			verdict("Meet up", "looking for a hookup tonight, DM me right now"),
		).not.toBe("published");
	});
});

describe("legitimate complaints still publish", () => {
	it("publishes an abuse report", () => {
		expect(
			verdict(
				"Bullying report",
				"A student uses profanity toward staff every day",
			),
		).toBe("published");
	});

	it("blocks direct abuse", () => {
		const r = serverModerate(
			"Trash",
			"You are an idiot and everyone hates you",
			null,
		);
		expect(r.blocked).toBe(true);
		expect(r.flags.some((f) => f.type === "bullying")).toBe(true);
	});

	it("blocks victim reports that quote the insult verbatim — rephrase without the word to publish", () => {
		// School zero-tolerance: the insult itself never publishes, even quoted.
		// The reporting channel survives — the same report without the quoted
		// insult publishes, so victims are never silenced, only asked to rephrase.
		const quoted = serverModerate(
			"Harassment report",
			"A student told me you suck every day in class",
			null,
		);
		expect(quoted.blocked).toBe(true);
		expect(quoted.flags.some((f) => f.type === "profanity")).toBe(true);
		const rephrased = serverModerate(
			"Harassment report",
			"A student told me I am harassed every day in class",
			null,
		);
		expect(rephrased.blocked).toBe(false);
	});

	it("never hard-blocks crossing a road", () => {
		const r = serverModerate(
			"Traffic",
			"Kids should cross the main road carefully",
			null,
		);
		expect(r.blocked).toBe(false);
	});
});

describe("named accusations are held for human review, never published blind", () => {
	it("holds an AI-polished accusation that names a person", () => {
		expect(
			verdict(
				"Student Rahul accused of blackmailing a peer",
				"A boy named Rahul has been blackmailing students",
			),
		).toBe("held");
	});

	it("never auto-blocks a named accusation (review, not rejection)", () => {
		const r = serverModerate(
				"Student Rahul accused of blackmailing a peer",
				"A boy named Rahul has been blackmailing students",
				null,
		);
		expect(r.blocked).toBe(false);
		expect(r.flags.some((f) => f.type === "accusation_weak")).toBe(true);
	});

	it("still publishes the victim's own lowercase report", () => {
		// Lowercase prose carries no identifiable name; the coercion-report
		// path (publishable + reviewed) must not be swallowed by the
		// accusation rule.
		expect(verdict("a boy name rahul was blackmail me", "")).not.toBe("blocked");
	});

	it("ignores sentence-initial capitalization (ordinary prose)", () => {
		expect(verdict("Rahul stole my pen", "It happened yesterday")).toBe("published");
	});

	it("ignores generic capitalized words near accusation verbs", () => {
		expect(
			verdict("The class accused the schedule", "Monday assembly ran long again"),
		).toBe("published");
	});
});
