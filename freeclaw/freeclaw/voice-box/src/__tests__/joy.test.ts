import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fireConfetti: vi.fn(),
	triggerHaptic: vi.fn(),
}));

vi.mock("../components/Confetti", () => ({ fireConfetti: mocks.fireConfetti }));
vi.mock("../lib/haptics", () => ({ triggerHaptic: mocks.triggerHaptic }));

import { celebrate, JOY_COPY, type JoyMoment } from "../lib/joy";

beforeEach(() => {
	mocks.fireConfetti.mockClear();
	mocks.triggerHaptic.mockClear();
});

describe("joy moments", () => {
	it("pairs a confirmed publish with a full celebration and success haptic", () => {
		celebrate("publish");
		expect(mocks.triggerHaptic).toHaveBeenCalledWith("success");
		expect(mocks.fireConfetti).toHaveBeenCalledWith("full");
	});

	it("uses a smaller celebration for everyday wins", () => {
		celebrate("vote");
		expect(mocks.triggerHaptic).toHaveBeenCalledWith("medium");
		expect(mocks.fireConfetti).toHaveBeenCalledWith("small");
		celebrate("support");
		expect(mocks.fireConfetti).toHaveBeenCalledTimes(2);
	});

	it("has warm, non-empty copy for every real success", () => {
		const moments: JoyMoment[] = ["publish", "poll_publish", "vote", "support"];
		for (const m of moments) {
			expect(typeof JOY_COPY[m]).toBe("string");
			expect(JOY_COPY[m].length).toBeGreaterThan(8);
		}
	});
});
