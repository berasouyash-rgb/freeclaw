// ═══════════════════════════════════════════════════════════════════
// Pre-Publish / PII Detection Tests
// ═══════════════════════════════════════════════════════════════════
// Tests the emergencyRegex() PII detection patterns from _pre-publish.js
// These regexes are the last-resort fallback when the NVIDIA LLM is down.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// PII Detection — matches the emergencyRegex() implementation
// ═══════════════════════════════════════════════════════════════════

interface PIICheckResult {
	phoneDetected: boolean;
	emailDetected: boolean;
	addressDetected: boolean;
	nameLocationDetected: boolean;
	nameIdentityDetected: boolean;
	nameAddressDetected: boolean;
	totalFlags: number;
	riskScore: number;
}

function checkPII(text: string): PIICheckResult {
	const MAX_LEN = 10000;
	const lowerSlice = text.slice(0, MAX_LEN);

	let riskScore = 0;
	const flags: string[] = [];

	// ── Phone number ────────────────────────────────────────────
	// Strip date-like strings (2026-07-30, 07/30/2026) AND academic-year ranges
	// (2026-2027, 2026-27) BEFORE the loose scan so legitimate exam/deadline dates
	// and school years are never flagged as PII — mirrors production._pre-publish.js
	const textNoDates = lowerSlice.replace(
		/\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s*[-/]\s*(?:19|20)?\d{2}\b/g,
		" ",
	);
	if (/\+?\d[\d\s\-()]{7,}/.test(textNoDates)) {
		flags.push("Phone number");
		riskScore += 25;
	}

	// ── Email ──────────────────────────────────────────────────
	if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(lowerSlice)) {
		flags.push("Email");
		riskScore += 25;
	}

	// ── Address: number BEFORE street (123 Main Street) ────────
	// ── Address: number AFTER street (Bally Street 123) ─────────
	// \b guard before the group: prevents embedded-suffix false positives ("best 5", "highway 12")
	// Strict whitelist mirrors production STREET_TYPES_AFTER — common English words (place, way, park,
	// block, phase, lane, drive, court, building, city, town, village, etc.) are excluded to avoid
	// false positives like "Grade 5 went to the park" or "the exam is in building 5".
	const addressBefore =
		/\b\d{1,5}\s+[a-zA-Z\s']+\b(?:street|st|stree|strret|sreet|stre|avenue|avenu|avnue|ave|road|rd|roed|boulevard|blvd|ln|dr|ct|pl|colony|nagar|howrag|howrah|bally)\b/i.test(
			lowerSlice,
		);
	const addressAfter =
		/\b[a-zA-Z\s']+\b(?:street|st|stree|strret|sreet|stre|avenue|avenu|avnue|ave|road|rd|roed|boulevard|blvd|ln|dr|ct|pl|colony|nagar|howrag|howrah|bally)\s+\d{1,5}\b/i.test(
			lowerSlice,
		);
	const addressDetected = addressBefore || addressAfter;
	if (addressDetected) {
		flags.push("Address");
		riskScore += 30;
	}

	// ── Person name + location context ──────────────────────────
	// Pattern 1: "lives at/in/on/near/by X" (location word before name)
	// Handles verb forms: live(s), stay(s), reside(s), home(s)
	const nameLocPattern1 =
		/(?:lives?|stays?|resides?|homes?|house|flat|apartment|room|door|block)\s+(?:at|in|on|near|by)\s+[A-Z][a-z]+/i.test(
			lowerSlice,
		);
	// Pattern 2: "X lives/stays/resides at/in/on" (name before location word)
	const nameLocPattern2 =
		/\b[A-Z][a-z]+\s+(?:lives?|stays?|resides?|homes?)\s+(?:at|in|on)\s+/i.test(
			lowerSlice,
		);
	const nameLocationDetected = nameLocPattern1 || nameLocPattern2;
	if (nameLocationDetected) {
		flags.push("Name+location");
		riskScore += 35;
	}

	// ── Name + identity info (requires "name is/of" prefix) ─────
	const nameIdentityDetected =
		/name\s+(?:is|of)\s+[A-Z][a-z]+(?:[\s'][A-Z][a-z]+)?\s+\(?(?:age|years?\s+old|class|grade|student|section|roll)\b/i.test(
			lowerSlice,
		);
	if (nameIdentityDetected) {
		flags.push("Name+identity");
		riskScore += 35;
	}

	// ── Generic name+address: "X lives in Y street" ────────────
	// Verb forms: live(s), stay(s), reside(s). Multi-word names ("MAAM KAULI")
	// + digits in location ("STREE 123") — mirrors the fixed production regex.
	// STRICT whitelist mirrors production STREET_TYPES_AFTER — generic words (park, block,
	// city, town, village, area, place, way, lane, drive, building, phase) are excluded so
	// legit sentences like "Students live in hostel block 3" or "Kids play in the park"
	// are never hard-blocked. The reported case (STREE 123 ... HOWRAG) is still caught.
	const nameAddressDetected =
		/\b(?:[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\s+(?:lives?|stays?|resides?|resid|living)\s+(?:at|in|on|near)\s+[A-Za-z0-9\s']+\b(?:street|st|stree|strret|sreet|stre|avenue|avenu|avnue|ave|road|rd|roed|boulevard|blvd|ln|dr|ct|pl|colony|nagar|howrag|howrah|bally)\b/i.test(
			lowerSlice,
		);
	if (nameAddressDetected) {
		flags.push("Name+address");
		riskScore += 40;
	}

	return {
		phoneDetected: /\+?\d[\d\s\-()]{7,}/.test(textNoDates),
		emailDetected: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(
			lowerSlice,
		),
		addressDetected,
		nameLocationDetected,
		nameIdentityDetected,
		nameAddressDetected,
		totalFlags: flags.length,
		riskScore: Math.min(100, riskScore),
	};
}

// ═══════════════════════════════════════════════════════════════════
// TESTS: Address Detection
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Addresses", () => {
	it("detects address with number BEFORE street name (123 Main Street)", () => {
		const result = checkPII("123 Main Street");
		expect(result.addressDetected).toBe(true);
		expect(result.totalFlags).toBeGreaterThanOrEqual(1);
	});

	it("detects address with number AFTER street name (Bally Street 123)", () => {
		const result = checkPII("Bally Street 123");
		expect(result.addressDetected).toBe(true);
	});

	it('detects address with "st" abbreviation', () => {
		expect(checkPII("456 Oak St").addressDetected).toBe(true);
		expect(checkPII("Elm St 789").addressDetected).toBe(true);
	});

	it('detects address with "ave" abbreviation', () => {
		expect(checkPII("789 Park Ave").addressDetected).toBe(true);
		expect(checkPII("Broadway Ave 101").addressDetected).toBe(true);
	});

	it('detects address with "rd" abbreviation', () => {
		expect(checkPII("321 Lake Rd").addressDetected).toBe(true);
		expect(checkPII("Country Rd 555").addressDetected).toBe(true);
	});

	it('detects address with "ln" abbreviation', () => {
		expect(checkPII("42 Maple Ln").addressDetected).toBe(true);
		expect(checkPII("Pine Ln 88").addressDetected).toBe(true);
	});

	it('detects address with "dr" abbreviation', () => {
		expect(checkPII("100 Sunset Dr").addressDetected).toBe(true);
		expect(checkPII("Ocean Dr 2020").addressDetected).toBe(true);
	});

	it('detects address with "blvd" abbreviation', () => {
		expect(checkPII("1 Hollywood Blvd").addressDetected).toBe(true);
		expect(checkPII("Sunset Blvd 900").addressDetected).toBe(true);
	});

	it("detects address with extended street types", () => {
		expect(checkPII("10 Park Colony").addressDetected).toBe(true);
		expect(checkPII("49 Lake Nagar").addressDetected).toBe(true);
		expect(checkPII("15 Bally Howrag").addressDetected).toBe(true);
		expect(checkPII("543 Hill Park Boulevard").addressDetected).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Phone & Email
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Phone & Email", () => {
	it("detects phone numbers", () => {
		expect(checkPII("Call me at 555-123-4567").phoneDetected).toBe(true);
		expect(checkPII("My phone is +1 555 123 4567").phoneDetected).toBe(true);
		expect(checkPII("Contact: (555) 123-4567").phoneDetected).toBe(true);
	});

	it("detects email addresses", () => {
		expect(checkPII("Email me at test@example.com").emailDetected).toBe(true);
		expect(checkPII("user.name+tag@school.edu").emailDetected).toBe(true);
		expect(checkPII("admin@my-school.org").emailDetected).toBe(true);
	});

	it("detects both phone and email together", () => {
		const result = checkPII("Call 555-123-4567 or email me@test.com");
		expect(result.phoneDetected).toBe(true);
		expect(result.emailDetected).toBe(true);
		expect(result.totalFlags).toBeGreaterThanOrEqual(2);
	});

	it("does NOT flag dates or academic-year ranges as phone numbers", () => {
		expect(checkPII("The exam is on 2026-07-30").phoneDetected).toBe(false);
		expect(checkPII("The event is 07/30/2026").phoneDetected).toBe(false);
		expect(checkPII("Fee payment for the 2026-2027 year").phoneDetected).toBe(
			false,
		);
		expect(checkPII("Class of 2026-27 picnic").phoneDetected).toBe(false);
	});

	it("does NOT flag a date as an address", () => {
		expect(
			checkPII("The deadline is 2026-07-30 for submissions").addressDetected,
		).toBe(false);
	});

	it("still flags a real phone number next to a date", () => {
		const result = checkPII(
			"The event is on 07/30/2026, call 555-123-4567 for details",
		);
		expect(result.phoneDetected).toBe(true);
		expect(result.addressDetected).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Person Name + Location
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Name + Location", () => {
	it('detects "X lives in Y" pattern (lowercase name via /i flag)', () => {
		// The /i flag makes [A-Z][a-z]+ case-insensitive in JS
		const result = checkPII("kaku live in bally street 123");
		expect(result.nameLocationDetected).toBe(true);
		expect(result.nameAddressDetected).toBe(true);
		expect(result.addressDetected).toBe(true);
		expect(result.totalFlags).toBeGreaterThanOrEqual(3);
		expect(result.riskScore).toBeGreaterThanOrEqual(100); // 35+40+30 = 105
	});

	it('detects "X lives at Y" pattern (capitalized name)', () => {
		expect(checkPII("John lives at 123 Main St").nameLocationDetected).toBe(
			true,
		);
		expect(checkPII("Mary stays at Park Avenue").nameLocationDetected).toBe(
			true,
		);
	});

	it('detects "X resides in Y" pattern', () => {
		expect(checkPII("Sarah resides in Oak Lane").nameLocationDetected).toBe(
			true,
		);
	});

	it('detects "X lives near Y" pattern', () => {
		expect(checkPII("Tommy lives near the school").nameLocationDetected).toBe(
			true,
		);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Name + Identity (requires "name is/of" prefix)
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Name + Identity", () => {
	it('detects "name is X age Y"', () => {
		expect(checkPII("name is John and age 15").nameIdentityDetected).toBe(true);
	});

	it('detects "name is X grade Y"', () => {
		expect(checkPII("name is Sarah grade 10").nameIdentityDetected).toBe(true);
	});

	it('detects "name of X age Y"', () => {
		expect(checkPII("Name of Raj age 15").nameIdentityDetected).toBe(true);
	});

	it('detects "name is X class Y"', () => {
		expect(checkPII("name is Alex class 12").nameIdentityDetected).toBe(true);
	});

	it('detects "name is X years old"', () => {
		expect(checkPII("name is Emily years old").nameIdentityDetected).toBe(true);
	});

	it('does NOT trigger on "Today class" (false positive guard)', () => {
		// The "name is/of" prefix is required, so this won't trigger
		expect(checkPII("Today class was cancelled").nameIdentityDetected).toBe(
			false,
		);
	});

	it('does NOT trigger on "Next grade" (false positive guard)', () => {
		expect(checkPII("Next grade students are loud").nameIdentityDetected).toBe(
			false,
		);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Combined Name + Address
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Name + Address Combined", () => {
	it('detects "kaku lives in bally street" (user reported example)', () => {
		const result = checkPII("kaku lives in bally street");
		expect(result.nameAddressDetected).toBe(true);
		expect(result.nameLocationDetected).toBe(true);
	});

	it('detects "X lives in Y street"', () => {
		expect(checkPII("Raju lives in MG Road").nameAddressDetected).toBe(true);
		expect(checkPII("Priya stays at Gandhi Street").nameAddressDetected).toBe(
			true,
		);
	});

	it('detects "X lives on Y road"', () => {
		expect(checkPII("Vijay lives on Church Road").nameAddressDetected).toBe(
			true,
		);
	});

	it('detects "X lives near Y road"', () => {
		expect(checkPII("Anita lives near Market Road").nameAddressDetected).toBe(
			true,
		);
	});

	it("detects ALL-CAPS multi-word name with misspelled street (user reported case)", () => {
		const result = checkPII("MAAM KAULI LIVES IN STREE 123 AND BALLY HOWRAG");
		expect(result.nameAddressDetected).toBe(true);
		expect(result.addressDetected).toBe(true);
	});

	it("detects multi-word name without a street number", () => {
		const result = checkPII("Rahul Sharma lives in Bally Howrag");
		expect(result.nameAddressDetected).toBe(true);
		expect(result.nameLocationDetected).toBe(true);
	});

	it('detects correctly-spelled locality "howrah" (live production leak case)', () => {
		const result = checkPII("souaysh live in bally howrah");
		expect(result.nameAddressDetected).toBe(true);
		expect(result.totalFlags).toBeGreaterThanOrEqual(1);
	});

	it('detects gerund form "living" with locality "howrah"', () => {
		const result = checkPII("souaysh is living in bally howrah");
		expect(result.nameAddressDetected).toBe(true);
		expect(result.totalFlags).toBeGreaterThanOrEqual(1);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Full realistic examples (user scenarios)
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Realistic Scenarios", () => {
	it('flags the exact user example: "kaku live in bally street 123 he is a bad boy"', () => {
		const text = "kaku live in bally street 123 he is a bad boy";
		const result = checkPII(text);
		// Should trigger: name+location (35) + name+address (40) + address (30) = 105 risk
		expect(result.nameLocationDetected).toBe(true);
		expect(result.nameAddressDetected).toBe(true);
		expect(result.addressDetected).toBe(true);
		expect(result.totalFlags).toBeGreaterThanOrEqual(3);
		expect(result.riskScore).toBeGreaterThanOrEqual(100);
	});

	it("flags personal info in a complaint context", () => {
		const result = checkPII("name is Raj age 15 he lives at 42 Gandhi Street");
		expect(result.nameIdentityDetected).toBe(true);
		expect(result.nameLocationDetected).toBe(true);
		expect(result.addressDetected).toBe(true);
	});

	it("flags address with number after street", () => {
		const result = checkPII("kaku lives in bally street 123");
		expect(result.addressDetected).toBe(true);
		expect(result.nameLocationDetected).toBe(true);
		expect(result.nameAddressDetected).toBe(true);
	});

	it("flags a full address with phone", () => {
		const result = checkPII("Contact me at 555-1234, I live at 123 Main St");
		expect(result.phoneDetected).toBe(true);
		expect(result.addressDetected).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Safe content that should NOT flag
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Safe Content (No False Positives)", () => {
	it("allows clean complaints about school food", () => {
		const result = checkPII(
			"The canteen food is terrible and the portions are too small",
		);
		expect(result.totalFlags).toBe(0);
		expect(result.riskScore).toBe(0);
	});

	it("allows clean report about bullying (no PII)", () => {
		const result = checkPII(
			"There is bullying in the hallways during lunch break",
		);
		expect(result.totalFlags).toBe(0);
	});

	it("allows complaints about wifi", () => {
		const result = checkPII("The school wifi is too slow, please fix it");
		expect(result.totalFlags).toBe(0);
	});

	it("allows general feedback without names or addresses", () => {
		const result = checkPII(
			"The teachers are helpful but the homework is too much",
		);
		expect(result.totalFlags).toBe(0);
	});

	it("allows empty text", () => {
		const result = checkPII("");
		expect(result.totalFlags).toBe(0);
		expect(result.riskScore).toBe(0);
	});

	it("allows text with only special characters", () => {
		const result = checkPII("!@#$%^&*()_+");
		expect(result.totalFlags).toBe(0);
	});

	it("does not flag a name alone without location context", () => {
		// Just a name without location shouldn't trigger
		const result = checkPII("Kaku is a bad boy");
		expect(result.totalFlags).toBe(0);
	});

	it("does not flag generic street mention without address", () => {
		const result = checkPII("I crossed the street to get to school");
		expect(result.totalFlags).toBe(0);
	});

	it('does not flag "highway" or "road" in non-address context', () => {
		const result = checkPII("The road to school is bumpy");
		expect(result.addressDetected).toBe(false);
	});

	it('does NOT flag "the best 5 students" (embedded st false positive)', () => {
		expect(checkPII("The best 5 students in class").addressDetected).toBe(
			false,
		);
	});

	it('does NOT flag "first place 5 times" (place is a common English word)', () => {
		expect(
			checkPII("I got first place 5 times in the race").addressDetected,
		).toBe(false);
	});

	it('does NOT flag "phase 2" or "highway 12"', () => {
		expect(
			checkPII("We are starting phase 2 of the project").addressDetected,
		).toBe(false);
		expect(checkPII("Take highway 12 to school").addressDetected).toBe(false);
	});

	it('does NOT flag "block 3" without street context', () => {
		expect(checkPII("The exam is in block 3").addressDetected).toBe(false);
	});

	it('does NOT flag "Grade 5 went to the park" (park is a common noun)', () => {
		expect(checkPII("Grade 5 went to the park today").addressDetected).toBe(
			false,
		);
	});

	it('does NOT flag "bus 12 to the city" (city is a common noun)', () => {
		expect(checkPII("We took bus 12 to the city").addressDetected).toBe(false);
	});

	it('does NOT flag "the exam is in building 5" (building is a common noun)', () => {
		expect(checkPII("The exam is in building 5 today").addressDetected).toBe(
			false,
		);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Risk Score Calculation
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Risk Score", () => {
	it("calculates cumulative risk score for multiple PII flags", () => {
		const result = checkPII(
			"kaku live in bally street 123, call 555-1234, email kaku@test.com",
		);
		// Address: +30, Name+location: +35, Name+address: +40, Phone: +25, Email: +25 = 155 → capped at 100
		expect(result.riskScore).toBe(100);
		expect(result.totalFlags).toBeGreaterThanOrEqual(4);
	});

	it("caps risk score at 100", () => {
		const result = checkPII(
			"John lives at 123 Main St, phone 555-123-4567, email john@test.com",
		);
		expect(result.riskScore).toBeLessThanOrEqual(100);
	});

	it("address-only has moderate risk score", () => {
		const result = checkPII("123 Main Street");
		expect(result.riskScore).toBeGreaterThanOrEqual(30);
		expect(result.riskScore).toBeLessThanOrEqual(30);
	});

	it("name+address has high risk score", () => {
		const result = checkPII("John lives in Main Street");
		// name+address: 40 + name+location: at least 35 = 75
		expect(result.riskScore).toBeGreaterThanOrEqual(70);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("PII Detection - Edge Cases", () => {
	it("handles extra long text without crashing", () => {
		const long = "A".repeat(50000);
		expect(() => checkPII(long)).not.toThrow();
	});

	it("detects PII in the middle of a long paragraph", () => {
		const prefix = "i think the food is bad and the wifi is slow ".repeat(40);
		const text = `${prefix}kaku lives in bally street 123 some more text${prefix}`;
		const result = checkPII(text);
		expect(result.nameAddressDetected).toBe(true);
		expect(result.addressDetected).toBe(true);
	});

	it("handles unicode characters", () => {
		const result = checkPII("José lives at 123 Main St");
		expect(result.addressDetected).toBe(true);
	});

	it("detects addresses with apostrophes", () => {
		const result = checkPII("O'Brien Street 45");
		expect(result.addressDetected).toBe(true);
	});
});
