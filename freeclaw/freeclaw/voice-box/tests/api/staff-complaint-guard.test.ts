// ═══════════════════════════════════════════════════════════════════
// Staff-complaint guard — an opinion about a teacher is not a report of abuse
// ═══════════════════════════════════════════════════════════════════
// Reported bug: "Kakuli mam is a horrible teacher" was surfaced to the author
// as "This reads as a report of abuse — held for a human to review."
//
// Two separate errors produced that:
//   1. The classifier sometimes answers reported_or_quoted:true for a sentence
//      that reports nothing (it is a complaint / an opinion).
//   2. The hold decision read the model's explanation prose instead of the
//      ORIGINAL text.
//
// The guard fixes both by reading the text itself, and it is deterministic, so
// the guarantee holds when no model is reachable.

import { describe, expect, it } from "vitest";

import { contextualFlags, isStaffComplaint } from "../../api/_context-moderation.js";

/** A model verdict that claims this is a reported, high-severity incident. */
const ABUSE_VERDICT = {
	decision: {
		decision: "flag",
		severity: "high",
		category: "harassment",
		reported_or_quoted: true,
		explanation: "The author reports abuse by a staff member.",
	},
};

const ASSERTS_ABUSE = {
	decision: {
		decision: "flag",
		severity: "high",
		category: "harassment",
		reported_or_quoted: false,
		explanation: "The author is insulting a teacher.",
	},
};

describe("isStaffComplaint — reads the text, not the prose", () => {
	it("recognises an opinion complaint about a teacher", () => {
		expect(isStaffComplaint("Kakuli mam is a horrible teacher")).toBe(true);
		expect(isStaffComplaint("This teacher is so rude and never explains anything")).toBe(true);
		expect(isStaffComplaint("Sir keeps shouting at us for no reason")).toBe(true);
	});

	it("does not swallow a first-person threat that names a teacher", () => {
		expect(isStaffComplaint("I will hurt you after class, teacher")).toBe(false);
		expect(isStaffComplaint("I am going to beat up that teacher")).toBe(false);
	});

	it("does not swallow a genuine report about a student", () => {
		expect(isStaffComplaint("A boy in my class keeps threatening me every day")).toBe(false);
	});
});

describe("contextualFlags — staff complaint never becomes an abuse report", () => {
	it("returns no flags for a teacher complaint, even if the model calls it abuse", () => {
		const text = "Kakuli mam is a horrible teacher";
		expect(contextualFlags(ABUSE_VERDICT, text)).toEqual([]);
		expect(contextualFlags(ASSERTS_ABUSE, text)).toEqual([]);
	});

	it("still flags genuine harassment of a student", () => {
		const text = "Rahul, I hate you and everyone knows you are worthless";
		const flags = contextualFlags(ABUSE_VERDICT, text);
		expect(flags.length).toBeGreaterThan(0);
		// `contextualFlags` returns bare flag types; the caller normalises them.
		expect(typeof flags[0]).toBe("string");
		expect(isStaffComplaint(text)).toBe(false);
	});

	it("still flags veiled intimidation — it is not a staff opinion", () => {
		const text =
			"You seem pretty comfortable with the way things are right now. I wonder if you'll feel the same way a little later.";
		expect(isStaffComplaint(text)).toBe(false);
		expect(contextualFlags(ABUSE_VERDICT, text).length).toBeGreaterThan(0);
	});
});
