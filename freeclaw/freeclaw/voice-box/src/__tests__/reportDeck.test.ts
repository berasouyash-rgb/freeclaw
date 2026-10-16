// ═══════════════════════════════════════════════════════════════════
// reportDeck pure helpers — section registry + slide filtering
// ═══════════════════════════════════════════════════════════════════
// The deck viewer and the PPT export share one section model: the admin
// ticks Complaints / Feed / Reports / Polls / Trends / Actions (or All)
// and BOTH surfaces render exactly that set. These tests pin the registry
// and the filter so a new section can never silently vanish from one
// surface, and an unticked section can never leak into the export.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import {
	DECK_SECTIONS,
	DEFAULT_SECTIONS,
	buildSlides,
	filterSections,
} from "../lib/reportDeck";
import { cannedSpec } from "./deckSpecFixture";

describe("deck section registry", () => {
	it("exposes the six admin-language sections in stable order", () => {
		expect(DECK_SECTIONS.map((s) => s.key)).toEqual([
			"complaints",
			"feed",
			"reports",
			"polls",
			"trends",
			"actions",
		]);
	});

	it("labels every section in the admin's own words", () => {
		const labels = Object.fromEntries(
			DECK_SECTIONS.map((s) => [s.key, s.label]),
		);
		expect(labels.complaints).toMatch(/complaint/i);
		expect(labels.feed).toMatch(/feed/i);
		expect(labels.reports).toMatch(/report/i);
		expect(labels.polls).toMatch(/poll/i);
		expect(labels.trends).toMatch(/trend/i);
		expect(labels.actions).toMatch(/action|recommend/i);
	});

	it("selects everything by default (All = the whole deck)", () => {
		expect([...DEFAULT_SECTIONS].sort()).toEqual(
			DECK_SECTIONS.map((s) => s.key).sort(),
		);
	});
});

describe("buildSlides", () => {
	it("builds one slide per selected section plus the cover", () => {
		const slides = buildSlides(cannedSpec(), DEFAULT_SECTIONS);
		expect(slides.map((s) => s.key)).toEqual([
			"cover",
			"complaints",
			"feed",
			"reports",
			"polls",
			"trends",
			"actions",
		]);
	});

	it("omits unticked sections from both viewer and export", () => {
		const slides = buildSlides(cannedSpec(), ["polls", "reports"]);
		expect(slides.map((s) => s.key)).toEqual(["cover", "reports", "polls"]);
	});

	it("keeps the cover even when a single section is picked", () => {
		const slides = buildSlides(cannedSpec(), ["polls"]);
		expect(slides[0]!.key).toBe("cover");
		expect(slides).toHaveLength(2);
	});

	it("titles every slide from live data, never blank", () => {
		for (const s of buildSlides(cannedSpec(), DEFAULT_SECTIONS)) {
			expect(s.title.trim().length).toBeGreaterThan(0);
		}
	});
});

describe("filterSections", () => {
	it("normalises unknown keys away and dedupes", () => {
		expect(filterSections(["polls", "nope", "polls"])).toEqual(["polls"]);
	});

	it("falls back to the full deck on an empty pick (never a blank deck)", () => {
		expect(filterSections([])).toEqual([...DEFAULT_SECTIONS]);
	});
});
