// Poll sweeper — expired polls notify exactly once, live polls untouched,
// one bad row never aborts the sweep.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockSend } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockSend: vi.fn(async () => ({ queued: true })),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));

vi.mock("../../api/_email.js", () => ({
	sendPollClosedEmail: mockSend,
}));

import { sweepExpiredPolls } from "../../api/_poll-sweeper.js";

function chain(result: Record<string, unknown>) {
	const q: Record<string, unknown> = { ...result };
	for (const m of [
		"select",
		"eq",
		"not",
		"lt",
		"limit",
		"maybeSingle",
		"upsert",
		"order",
	]) {
		(q as Record<string, unknown>)[m] = vi.fn(() => q);
	}
	return q;
}

const EXPIRED = {
	id: "poll_1",
	title: "Best canteen dish?",
	author_id: "anon_1",
	post_id: null,
	expires_at: "2020-01-01T00:00:00.000Z",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("sweepExpiredPolls", () => {
	it("notifies an expired poll exactly once", async () => {
		mockFrom.mockImplementation((table: string) => {
			if (table === "polls") {
				const q = chain({ data: [EXPIRED], error: null });
				(q.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({});
				return q;
			}
			const q = chain({});
			(q.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({
				data: { value: { notifications: [] } },
			});
			(q.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
			return q;
		});
		const r = await sweepExpiredPolls();
		expect(r.ok).toBe(true);
		expect(r.checked).toBe(1);
		expect(r.notified).toBe(1);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it("skips polls that already notified", async () => {
		mockFrom.mockImplementation((table: string) => {
			if (table === "polls") return chain({ data: [EXPIRED], error: null });
			const q = chain({});
			(q.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({
				data: {
					value: {
						notifications: [{ type: "poll_closed", poll_id: "poll_1" }],
					},
				},
			});
			return q;
		});
		const r = await sweepExpiredPolls();
		expect(r.notified).toBe(0);
		expect(r.skipped).toBe(1);
		expect(mockSend).not.toHaveBeenCalled();
	});

	it("does not touch live polls and survives bad rows", async () => {
		mockFrom.mockImplementation((table: string) => {
			if (table === "polls") return chain({ data: [], error: null });
			return chain({});
		});
		const r = await sweepExpiredPolls();
		expect(r.ok).toBe(true);
		expect(r.checked).toBe(0);
		expect(r.notified).toBe(0);
	});
});
