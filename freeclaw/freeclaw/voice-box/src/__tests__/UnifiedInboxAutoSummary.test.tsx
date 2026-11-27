// ═══════════════════════════════════════════════════════════════════
// UnifiedInbox auto-summary (spec §11/§51)
// ═══════════════════════════════════════════════════════════════════
// Locks: opening a substantive thread (4+ messages) with no cached summary
// briefs the admin automatically — no click needed. Short threads stay
// manual-only (no wasted LLM calls), failures stay silent (the manual
// Summarize button reports them).
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnifiedInbox from "../pages/admin/UnifiedInbox";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	post: vi.fn(),
	del: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		put: mocks.put,
		post: mocks.post,
		postLong: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		del: mocks.del,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/markdown", () => ({
	renderMarkdown: (s: string) => s.replace(/\n/g, "<br/>"),
}));

vi.mock("../lib/utils", () => ({
	fmtDate: (d: string) => `D(${d})`,
	timeAgo: () => "2m ago",
}));

vi.mock("../components/ui", () => ({
	PromptDialog: () => null,
}));

const LONG_THREAD = [
	{ id: "m1", sender: "user", body: "The projector failed again", created_at: "2026-07-02T09:00:00.000Z" },
	{ id: "m2", sender: "ai", body: "Sorry to hear that — which classroom?", created_at: "2026-07-02T09:01:00.000Z" },
	{ id: "m3", sender: "user", body: "Room 2B, third time this week, HDMI", created_at: "2026-07-02T09:02:00.000Z" },
	{ id: "m4", sender: "user", body: "It stopped during class today", created_at: "2026-07-02T09:03:00.000Z" },
];

beforeEach(() => {
	vi.clearAllMocks();
	if (!Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
	}
	mocks.get.mockImplementation(async (path: string) => {
		if (path === "/api/inbox?threads=1")
			return [
				{
					thread_id: "thread_long_1",
					source: "inbox",
					last_message: "It stopped during class today",
					updated_at: "2026-07-02T10:00:00.000Z",
					unread: 1,
				},
			];
		if (path === "/api/chat?threads=1") return [];
		if (path.startsWith("/api/inbox?thread_id="))
			return { messages: LONG_THREAD, state: { agent: "ai", source: "inbox" } };
		return [];
	});
	mocks.put.mockResolvedValue({ ok: true });
	mocks.del.mockResolvedValue({ ok: true });
	vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("UnifiedInbox auto-summary", () => {
	it("briefs a 4+ message thread on open without a click", async () => {
		mocks.post.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
			if (body?.action === "summary")
				return {
					ok: true,
					summary: "Student reports repeated projector failure in Room 2B.",
					entities: ["projector", "Room 2B"],
					resolution_state: "in_progress",
				};
			return { ok: true };
		});
		const user = userEvent.setup();
		render(
			<MemoryRouter initialEntries={["/admin?tab=inbox"]}>
				<UnifiedInbox />
			</MemoryRouter>,
		);
		await screen.findByText("thread_long_1");
		await user.click(screen.getByText("thread_long_1"));
		expect(
			await screen.findByText("Student reports repeated projector failure in Room 2B."),
		).toBeInTheDocument();
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/inbox", {
				thread_id: "thread_long_1",
				action: "summary",
			});
		});
	});

	it("stays manual-only for short threads (no wasted call)", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1")
				return [
					{
						thread_id: "thread_short_1",
						source: "inbox",
						last_message: "Hi",
						updated_at: "2026-07-02T10:00:00.000Z",
						unread: 1,
					},
				];
			if (path === "/api/chat?threads=1") return [];
			if (path.startsWith("/api/inbox?thread_id="))
				return {
					messages: [{ id: "m1", sender: "user", body: "Hi", created_at: "2026-07-02T09:00:00.000Z" }],
					state: { agent: "ai", source: "inbox" },
				};
			return [];
		});
		const user = userEvent.setup();
		render(
			<MemoryRouter initialEntries={["/admin?tab=inbox"]}>
				<UnifiedInbox />
			</MemoryRouter>,
		);
		await screen.findByText("thread_short_1");
		await user.click(screen.getByText("thread_short_1"));
		expect((await screen.findAllByText("Hi")).length).toBeGreaterThanOrEqual(1);
		// Let any auto effect settle — summary must NOT fire for 1 message
		await new Promise((r) => setTimeout(r, 300));
		expect(mocks.post).not.toHaveBeenCalledWith("/api/inbox", {
			thread_id: "thread_short_1",
			action: "summary",
		});
	});

	it("fails silently on auto (manual Summarize still reports)", async () => {
		mocks.post.mockRejectedValue(new Error("backend down"));
		const user = userEvent.setup();
		render(
			<MemoryRouter initialEntries={["/admin?tab=inbox"]}>
				<UnifiedInbox />
			</MemoryRouter>,
		);
		await screen.findByText("thread_long_1");
		await user.click(screen.getByText("thread_long_1"));
		expect((await screen.findAllByText("It stopped during class today")).length).toBeGreaterThanOrEqual(1);
		// Auto failure → no toast, no fabricated panel
		await new Promise((r) => setTimeout(r, 300));
		expect(mocks.toast).not.toHaveBeenCalledWith("backend down", "err");
		expect(screen.queryByText(/AI summary · status/)).not.toBeInTheDocument();
	});
});
