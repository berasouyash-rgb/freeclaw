import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// User report: after a vote reorders Suggestions, the rank arrows overlap the
// card content and the up/down movement is impossible to see — it reads as if
// the arrows are hidden rather than moving.
const read = (rel: string) =>
	readFileSync(resolve(process.cwd(), rel), "utf8");

const delta = read("src/components/RankDelta.tsx");
const css = read("src/index.css");
const suggestions = read("src/pages/Suggestions.tsx");

describe("Suggestions — visible, non-overlapping rank arrows", () => {
	it("does not use the fast repeating bounce for the direction cue", () => {
		expect(delta).not.toMatch(/animate-bounce/);
	});

	it("has one directional arrow animation per direction", () => {
		expect(css).toMatch(/@keyframes vb-rank-arrow-up/);
		expect(css).toMatch(/@keyframes vb-rank-arrow-down/);
	});

	it("times the arrow nudge to match the FLIP glide", () => {
		// Suggestions deliberately passes 900ms so the reorder is legible.
		const duration = suggestions.match(/durationMs:\s*(\d+)/)?.[1];
		expect(duration).toBe("900");
		expect(css).toMatch(/vb-rank-delta-up svg[^}]*animation:[^;]*900ms/);
		expect(css).toMatch(/vb-rank-delta-down svg[^}]*animation:[^;]*900ms/);
	});

	it("reserves horizontal space so the chip never sits on top of the text", () => {
		expect(suggestions).toMatch(/rankMoves\.has\(s\.id\)[\s\S]{0,400}pr-24|pr-24[\s\S]{0,400}rankMoves\.has\(s\.id\)/);
	});

	it("drops the motion under reduced-motion", () => {
		expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,600}vb-rank-delta/);
	});
});
