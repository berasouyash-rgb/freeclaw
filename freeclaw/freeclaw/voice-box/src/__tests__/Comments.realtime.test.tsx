// ═══════════════════════════════════════════════════════════════════
// Comment thread — realtime freshness and honest send outcomes
// ═══════════════════════════════════════════════════════════════════
// Two user-visible bugs are pinned here.
//
// 1. THE FROZEN THREAD. `load()` read through the client's 5s GET cache, so a
//    realtime `comments` event triggered a re-read that returned the body from
//    before the change. The database had changed and the UI had not — the
//    thread only updated on a manual refresh. Every non-first-mount read must
//    therefore go through getFresh.
//
// 2. THE PHANTOM FAILURE. A comment POST that times out is auto-queued for
//    replay AND re-thrown. The UI reported "Failed to post comment" while the
//    queue went on to post it, so the comment appeared later (after a refresh or
//    the next flush) and a user who retyped it produced a duplicate.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Comments from "../components/Comments";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	pushNotif: vi.fn(),
	get: vi.fn(),
	getFresh: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	queuedCount: vi.fn(),
	// Captured so a test can fire a realtime event by hand.
	realtimeCallback: null as null | ((table: string, payload: unknown) => void),
	moderate: vi.fn(),
	blocked: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getFresh: mocks.getFresh,
		post: mocks.post,
		put: mocks.put,
		del: mocks.del,
	},
	hasAdminSession: () => false,
	queuedCount: mocks.queuedCount,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		accountStatus: null,
		pushNotif: mocks.pushNotif,
	}),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (
		_tables: string[],
		cb: (table: string, payload: unknown) => void,
	) => {
		mocks.realtimeCallback = cb;
	},
}));

vi.mock("../lib/identity", () => ({
	checkCooldown: () => 0,
	stampCooldown: vi.fn(),
	lsGet: (_k: string, fallback: unknown) => fallback,
	lsSet: vi.fn(),
}));

vi.mock("../lib/moderation", () => ({
	moderateContent: (t: string) => ({
		maskedText: t,
		blocked: false,
		flags: [],
	}),
	isBlocked: () => false,
	isBlockedByServer: () => false,
	commentBlockMessage: () => "blocked",
}));

vi.mock("../lib/utils", () => ({
	sanitize: (s: string, n: number) => s.slice(0, n).trim(),
	timeAgo: () => "just now",
}));

vi.mock("../components/ui", () => ({
	ReportDialog: () => null,
}));

const SERVER_COMMENT = {
	id: "c-1",
	post_id: "p-1",
	parent_id: null,
	body: "existing comment",
	author_id: "anon-other",
	is_admin: false,
	created_at: new Date().toISOString(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.realtimeCallback = null;
	mocks.queuedCount.mockReturnValue(0);
	mocks.get.mockResolvedValue([SERVER_COMMENT]);
	mocks.getFresh.mockResolvedValue([SERVER_COMMENT]);
	mocks.post.mockResolvedValue({ ok: true });
});

describe("Comments — realtime must not read through the cache", () => {
	it("loads the thread through the cache on first mount", async () => {
		render(<Comments postId="p-1" />);
		await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
		// First mount is the one read where nothing can be stale yet.
		expect(mocks.getFresh).not.toHaveBeenCalled();
	});

	it("re-reads with getFresh when a realtime comment event arrives", async () => {
		render(<Comments postId="p-1" />);
		await screen.findByText("existing comment");

		// The database changed; the event is the signal to re-read.
		expect(mocks.realtimeCallback).toBeTypeOf("function");
		mocks.getFresh.mockResolvedValue([
			SERVER_COMMENT,
			{
				...SERVER_COMMENT,
				id: "c-2",
				body: "brand new comment",
				author_id: "anon-other",
			},
		]);
		mocks.realtimeCallback!("comments", {
			eventType: "INSERT",
			new: { ...SERVER_COMMENT, id: "c-2" },
		});

		// It must appear WITHOUT a manual refresh. Reading via api.get here
		// would return the cached pre-insert body and this would time out.
		await screen.findByText("brand new comment");
		expect(mocks.getFresh).toHaveBeenCalled();
	});

	it("does not refetch this thread for a comment on another post", async () => {
		render(<Comments postId="p-1" />);
		await screen.findByText("existing comment");
		expect(mocks.realtimeCallback).toBeTypeOf("function");
		expect(mocks.getFresh).not.toHaveBeenCalled();

		// The comments realtime channel is global. An event for p-2 must not
		// make every open p-1 thread issue an unrelated request.
		mocks.realtimeCallback!("comments", {
			eventType: "INSERT",
			new: { ...SERVER_COMMENT, id: "c-other", post_id: "p-2" },
		});

		expect(mocks.getFresh).not.toHaveBeenCalled();
	});

	it("shows a comment optimistically before the server responds", async () => {
		// Hold the POST open so the optimistic state is observable.
		let release: (v: unknown) => void = () => {};
		mocks.post.mockReturnValue(
			new Promise((resolve) => {
				release = resolve;
			}),
		);

		render(<Comments postId="p-1" />);
		await screen.findByText("existing comment");

		fireEvent.change(screen.getByPlaceholderText(/comment/i), {
			target: { value: "hello from mobile" },
		});
		fireEvent.click(screen.getByRole("button", { name: /post|send/i }));

		// Visible immediately, while the request is still in flight.
		await screen.findByText("hello from mobile");

		release({ ok: true });
	});
});

describe("Comments — a queued write is not a failure", () => {
	it("reports an offline save instead of a failure when the write was queued", async () => {
		// The api layer queues transient write failures for replay and then
		// rethrows. The queue growing is how the component can tell the two
		// cases apart.
		mocks.queuedCount.mockReturnValueOnce(0).mockReturnValue(1);
		mocks.post.mockRejectedValue(new Error("Request timed out"));

		render(<Comments postId="p-1" />);
		await screen.findByText("existing comment");

		fireEvent.change(screen.getByPlaceholderText(/comment/i), {
			target: { value: "queued comment" },
		});
		fireEvent.click(screen.getByRole("button", { name: /post|send/i }));

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringMatching(/saved offline|reconnect/i),
				"info",
			),
		);
		// Never claim failure — the queue is going to post it.
		expect(mocks.toast).not.toHaveBeenCalledWith(
			expect.stringMatching(/failed/i),
			"err",
		);
		// And the comment stays on screen rather than vanishing.
		expect(screen.getByText("queued comment")).toBeInTheDocument();
	});

	it("removes the optimistic comment and reports failure when nothing was queued", async () => {
		// A real failure (bad input, 4xx) is NOT queued, so the optimistic row
		// must be withdrawn or the user believes a comment exists that does not.
		mocks.queuedCount.mockReturnValue(0);
		mocks.post.mockRejectedValue(new Error("Content rejected"));

		render(<Comments postId="p-1" />);
		await screen.findByText("existing comment");

		fireEvent.change(screen.getByPlaceholderText(/comment/i), {
			target: { value: "rejected comment" },
		});
		fireEvent.click(screen.getByRole("button", { name: /post|send/i }));

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith("Content rejected", "err"),
		);
		await waitFor(() =>
			expect(screen.queryByText("rejected comment")).not.toBeInTheDocument(),
		);
	});

	it("replaces the optimistic row with the server copy on success", async () => {
		mocks.post.mockResolvedValue({ ok: true });
		mocks.getFresh.mockResolvedValue([
			SERVER_COMMENT,
			{
				...SERVER_COMMENT,
				id: "c-3",
				body: "confirmed comment",
				author_id: "anon-test",
			},
		]);

		render(<Comments postId="p-1" />);
		await screen.findByText("existing comment");

		fireEvent.change(screen.getByPlaceholderText(/comment/i), {
			target: { value: "confirmed comment" },
		});
		fireEvent.click(screen.getByRole("button", { name: /post|send/i }));

		// Exactly one copy: the server's. The optimistic duplicate must be gone.
		await waitFor(() =>
			expect(screen.getAllByText("confirmed comment")).toHaveLength(1),
		);
		// The post-send read bypasses the cache, or the new row would not be in it.
		expect(mocks.getFresh).toHaveBeenCalled();
	});
});
