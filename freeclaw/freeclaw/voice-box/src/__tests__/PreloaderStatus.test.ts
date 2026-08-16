// ═══════════════════════════════════════════════════════════════════
// PreloaderStatus — state machine unit tests
// ═══════════════════════════════════════════════════════════════════
// Proves the boot machine is deterministic and REAL-readiness-driven:
//   • INITIALIZING before the shell commits
//   • LOADING until all critical flags are green
//   • VERIFYING while the anti-flash floor elapses
//   • READY only when critical + elapsed
//   • REVEAL / ERROR override everything
//   • progress is honest (failed tasks count, never fabricated)
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import {
	MIN_DISPLAY_MS,
	STATUS_LABELS,
	progressFromTasks,
	statusFromFlags,
	type LoadTask,
} from "../components/preloader/PreloaderStatus";

const flags = { shellReady: true, fontsReady: true, dataReady: true };

describe("statusFromFlags — real readiness gating", () => {
	it("is INITIALIZING before the shell mounts", () => {
		expect(
			statusFromFlags({ shellReady: false, fontsReady: false, dataReady: false }),
		).toBe("INITIALIZING");
	});

	it("is LOADING while any critical flag is not green", () => {
		expect(
			statusFromFlags({ shellReady: true, fontsReady: false, dataReady: true }),
		).toBe("LOADING");
		expect(
			statusFromFlags({ shellReady: true, fontsReady: true, dataReady: false }),
		).toBe("LOADING");
	});

	it("plays INITIALIZING first even when everything is already ready (scene floor)", () => {
		expect(statusFromFlags(flags, { elapsedMs: 0 })).toBe("INITIALIZING");
		expect(
			statusFromFlags(flags, { elapsedMs: MIN_DISPLAY_MS - 1 }),
		).toBe("INITIALIZING");
	});

	it("advances scene-by-scene: LOADING → VERIFYING → READY at each floor", () => {
		// Scene 2 (LOADING) starts at the first floor
		expect(statusFromFlags(flags, { elapsedMs: MIN_DISPLAY_MS })).toBe("LOADING");
		expect(
			statusFromFlags(flags, { elapsedMs: 2 * MIN_DISPLAY_MS - 1 }),
		).toBe("LOADING");
		// Scene 3 (VERIFYING) starts at the second floor
		expect(
			statusFromFlags(flags, { elapsedMs: 2 * MIN_DISPLAY_MS }),
		).toBe("VERIFYING");
		expect(
			statusFromFlags(flags, { elapsedMs: 3 * MIN_DISPLAY_MS - 1 }),
		).toBe("VERIFYING");
		// READY after the third floor
		expect(
			statusFromFlags(flags, { elapsedMs: 3 * MIN_DISPLAY_MS }),
		).toBe("READY");
		expect(statusFromFlags(flags, { elapsedMs: 10_000 })).toBe("READY");
	});

	it("readiness never skips ahead of the scene schedule but blocks it when slow", () => {
		// All green but the LOADING scene is still playing
		expect(statusFromFlags(flags, { elapsedMs: MIN_DISPLAY_MS })).toBe("LOADING");
		// Probe still pending long after the schedule says READY → held at LOADING
		expect(
			statusFromFlags(
				{ shellReady: true, fontsReady: true, dataReady: false },
				{ elapsedMs: 3 * MIN_DISPLAY_MS + 1 },
			),
		).toBe("LOADING");
	});

	it("elapsed is not required to reach READY (defaults to past the schedule)", () => {
		// default elapsedMs = Infinity → past all three floors
		expect(statusFromFlags(flags)).toBe("READY");
	});

	it("REVEAL overrides every other state", () => {
		expect(
			statusFromFlags(flags, { elapsedMs: 0, revealing: true }),
		).toBe("REVEAL");
		expect(
			statusFromFlags(
				{ shellReady: false, fontsReady: false, dataReady: false },
				{ revealing: true },
			),
		).toBe("REVEAL");
	});

	it("ERROR overrides every other state", () => {
		expect(statusFromFlags(flags, { errored: true })).toBe("ERROR");
		expect(
			statusFromFlags(
				{ shellReady: false, fontsReady: false, dataReady: false },
				{ errored: true },
			),
		).toBe("ERROR");
	});
});

describe("STATUS_LABELS — human, calm, non-technical", () => {
	it("covers every machine state", () => {
		for (const s of [
			"INITIALIZING",
			"LOADING",
			"VERIFYING",
			"READY",
			"REVEAL",
			"ERROR",
		] as const) {
			expect(STATUS_LABELS[s]).toBeTruthy();
		}
	});

	it("never exposes internal tech jargon", () => {
		const labels = Object.values(STATUS_LABELS).join(" ").toLowerCase();
		expect(labels).not.toMatch(/agent|percent|\d+%|neural|quantum|ai\b/);
	});

	it("reads calm and human (no exclamation, no all-caps shouting)", () => {
		const joined = Object.values(STATUS_LABELS).join(" ");
		expect(joined).not.toMatch(/!/);
		expect(joined).not.toMatch(/(^|\s)[A-Z]{3,}(\s|$)/);
	});
});

describe("progressFromTasks — honest progress", () => {
	it("is 0 with no tasks", () => {
		expect(progressFromTasks([])).toBe(0);
	});

	it("counts done + failed tasks (failures are real outcomes, not hidden)", () => {
		const tasks: LoadTask[] = [
			{ id: "a", label: "A", priority: "CRITICAL", done: true, failed: false },
			{ id: "b", label: "B", priority: "CRITICAL", done: false, failed: true },
			{ id: "c", label: "C", priority: "OPTIONAL", done: false, failed: false },
		];
		expect(progressFromTasks(tasks)).toBeCloseTo(2 / 3);
	});

	it("never exceeds 1 or drops below 0", () => {
		const allDone: LoadTask[] = Array.from({ length: 3 }, (_, i) => ({
			id: `t${i}`,
			label: "x",
			priority: "CRITICAL",
			done: true,
			failed: false,
		}));
		expect(progressFromTasks(allDone)).toBe(1);
		const none: LoadTask[] = Array.from({ length: 3 }, (_, i) => ({
			id: `t${i}`,
			label: "x",
			priority: "CRITICAL",
			done: false,
			failed: false,
		}));
		expect(progressFromTasks(none)).toBe(0);
	});
});
