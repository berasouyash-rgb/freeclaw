// ═══════════════════════════════════════════════════════════════════
// PreloaderStatus — state machine unit tests
// ═══════════════════════════════════════════════════════════════════
// Proves the boot machine is deterministic and REAL-readiness-driven:
//   • INITIALIZING before the shell commits
//   • Stages advance only when real readiness flags are green
//   • READY only when all critical flags are green
//   • REVEAL / ERROR override everything
//   • progress is honest (failed tasks count, never fabricated)
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import {
	STATUS_LABELS,
	progressFromTasks,
	statusFromFlags,
	type LoadTask,
} from "../components/preloader/PreloaderStatus";

const allReady = {
	shellReady: true,
	envReady: true,
	fontsReady: true,
	authReady: true,
	dbReady: true,
	realtimeReady: true,
	dataReady: true,
};

describe("statusFromFlags — real readiness gating", () => {
	it("is INITIALIZING before the shell mounts", () => {
		expect(
			statusFromFlags({ shellReady: false, envReady: false, fontsReady: false, authReady: false, dbReady: false, realtimeReady: false, dataReady: false }),
		).toBe("INITIALIZING");
	});

	it("is ENVIRONMENT when shell is ready but env is not", () => {
		expect(
			statusFromFlags({ shellReady: true, envReady: false, fontsReady: false, authReady: false, dbReady: false, realtimeReady: false, dataReady: false }),
		).toBe("ENVIRONMENT");
	});

	it("is AUTHENTICATION when env is ready but auth is not", () => {
		expect(
			statusFromFlags({ shellReady: true, envReady: true, fontsReady: true, authReady: false, dbReady: false, realtimeReady: false, dataReady: false }),
		).toBe("AUTHENTICATION");
	});

	it("is DATABASE when auth is ready but db is not", () => {
		expect(
			statusFromFlags({ shellReady: true, envReady: true, fontsReady: true, authReady: true, dbReady: false, realtimeReady: false, dataReady: false }),
		).toBe("DATABASE");
	});

	it("is REALTIME when db is ready but realtime is not", () => {
		expect(
			statusFromFlags({ shellReady: true, envReady: true, fontsReady: true, authReady: true, dbReady: true, realtimeReady: false, dataReady: false }),
		).toBe("REALTIME");
	});

	it("is RESOURCES when realtime is ready but data is not", () => {
		expect(
			statusFromFlags({ shellReady: true, envReady: true, fontsReady: true, authReady: true, dbReady: true, realtimeReady: true, dataReady: false }),
		).toBe("RESOURCES");
	});

	it("is READY when all critical flags are green", () => {
		expect(statusFromFlags(allReady)).toBe("READY");
	});

	it("REVEAL overrides every other state", () => {
		expect(statusFromFlags(allReady, { revealing: true })).toBe("REVEAL");
		expect(
			statusFromFlags({ shellReady: false, envReady: false, fontsReady: false, authReady: false, dbReady: false, realtimeReady: false, dataReady: false }, { revealing: true }),
		).toBe("REVEAL");
	});

	it("ERROR overrides every other state", () => {
		expect(statusFromFlags(allReady, { errored: true })).toBe("ERROR");
		expect(
			statusFromFlags({ shellReady: false, envReady: false, fontsReady: false, authReady: false, dbReady: false, realtimeReady: false, dataReady: false }, { errored: true }),
		).toBe("ERROR");
	});
});

describe("STATUS_LABELS — human, calm, non-technical", () => {
	it("covers every machine state", () => {
		for (const s of [
			"INITIALIZING",
			"ENVIRONMENT",
			"AUTHENTICATION",
			"DATABASE",
			"REALTIME",
			"PERMISSIONS",
			"RESOURCES",
			"SERVICES",
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
			priority: "CRITICAL" as const,
			done: true,
			failed: false,
		}));
		expect(progressFromTasks(allDone)).toBe(1);
		const none: LoadTask[] = Array.from({ length: 3 }, (_, i) => ({
			id: `t${i}`,
			label: "x",
			priority: "CRITICAL" as const,
			done: false,
			failed: false,
		}));
		expect(progressFromTasks(none)).toBe(0);
	});
});
