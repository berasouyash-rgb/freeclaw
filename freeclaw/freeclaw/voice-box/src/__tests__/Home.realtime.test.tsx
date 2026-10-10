// ═══════════════════════════════════════════════════════════════════
// Home feed — live merge near the top, badge when scrolled, never a storm
// ═══════════════════════════════════════════════════════ realtime block
// The feed loads exactly once per visit. Realtime events do one of three
// things, nothing else:
//   • reaction/comment payloads apply exact local deltas instantly
//     (bumps below — zero network);
//   • posts INSERTs quiet-merge through the silent path (newcomers prepend
//     near the top; parked behind the pill when scrolled down);
//   • polls INSERTs/UPDATEs refresh just that poll row (one small GET).
//   • everything else raises the update badge. No fetch fires until the
//     reader taps it (or the pill, or pull-to-refresh).
//
// Pinned:
//   1. A reaction INSERT from another user bumps that post's count NOW.
//   2. A reaction DELETE decrements NOW (e.g. un-like).
//   3. A comment INSERT bumps comment_count NOW (mirrors the server's
//      deleted/hidden counting rule).
//   4. A posts INSERT near the top merges silently (quiet refresh, no badge).
//   5. A posts INSERT while scrolled parks behind the pill (badge path).
//   6. Tapping the badge pulls one fresh snapshot and clears the badge.
//   7. A burst of votes fires zero feed GETs (targeted poll refresh only).
// ═══════════════════════════════════════════════════════════════════

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetHomeSnapshot } from "../pages/Home";

const mocks = vi.hoisted(() => ({
	get: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
	getSlow: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
	getSlowFresh: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
	getFresh: vi.fn(async (..._args: unknown[]): Promise<unknown> => []),
	post: vi.fn(async () => ({})),
	// Captured so tests can fire realtime events by hand. The callback
	// routes by table to whichever subscription actually listens for it —
	// the way production delivers — so the zero-debounce vote lane and the
	// batched feed lane never receive each other's events.
	realtimeCallback: null as null | ((table: string, payload: unknown) => void),
	realtimeSubs: [] as Array<{
		tables: string[];
		cb: (table: string, payload: unknown) => void;
		debounceMs: number;
	}>,
}));

vi.mock("../lib/api", () => ({ api: mocks }));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "test-anon",
		bookmarks: [],
		toggleBookmark: vi.fn(),
		toast: vi.fn(),
		theme: "dark",
	}),
}));

vi.mock("../hooks/useCategories", () => ({
	useCategories: () => ["Facilities", "Academics"],
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (
		tables: string[],
		cb: (table: string, payload: unknown) => void,
		debounceMs = 1500,
	) => {
		// React re-renders call this again on every pass. A subscription is
		// identified by its lane (tables + debounce), so re-registering a
		// lane replaces it — otherwise each render would stack another
		// delivery of the same event and double every delta.
		const lane = `${tables.join(",")}|${debounceMs}`;
		const existing = mocks.realtimeSubs.findIndex(
			(s) => `${s.tables.join(",")}|${s.debounceMs}` === lane,
		);
		const sub = { tables, cb, debounceMs };
		if (existing === -1) mocks.realtimeSubs.push(sub);
		else mocks.realtimeSubs[existing] = sub;
		mocks.realtimeCallback = (table, payload) => {
			for (const s of mocks.realtimeSubs) {
				if (s.tables.includes(table)) s.cb(table, payload);
			}
		};
	},
}));

// Lazy-loaded components that need mocking
vi.mock("../components/CountUp", () => ({
	default: ({ children }: { children: number }) => <span>{children}</span>,
}));
vi.mock("../components/GlowButton", () => ({
	default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
		<button {...props}>{children}</button>
	),
}));
vi.mock("../components/PostCard", () => ({
	default: ({ post }: { post: { title: string; reactions?: Record<string, number>; comment_count?: number } }) => (
		<article data-testid="post-card">
			<span data-testid="card-title">{post.title}</span>
			<span data-testid="card-support">{post.reactions?.support ?? 0}</span>
			<span data-testid="card-comments">{post.comment_count ?? 0}</span>
		</article>
	),
}));
vi.mock("../components/RecapCard", () => ({
	default: () => <div data-testid="recap-card" />,
}));
vi.mock("../components/Trend", () => ({
	default: () => <div />,
	Sparkline: () => <div />,
}));
vi.mock("../components/WordCloud", () => ({
	default: () => <div />,
}));

const POST = {
	id: "p1",
	type: "problem",
	title: "Broken projector in Room 7",
	description: "It does not turn on.",
	category: "Facilities",
	status: "reported",
	priority: "medium",
	author_id: "someone-else",
	created_at: new Date().toISOString(),
	reactions: { support: 2 },
	comment_count: 1,
};

beforeEach(() => {
	vi.clearAllMocks();
	// Module-level feed snapshot must not leak between cases.
	__resetHomeSnapshot();
	mocks.realtimeCallback = null;
	mocks.realtimeSubs = [];
	mocks.getSlow.mockResolvedValue([POST]);
	mocks.getSlowFresh.mockResolvedValue([POST]);
	mocks.get.mockResolvedValue([]);
	// Reactions for viewer "test-anon": none — so all deltas come from others.
	mocks.getFresh.mockResolvedValue([]);
});

async function renderFeed() {
	const { default: Home } = await import("../pages/Home");
	render(
		<MemoryRouter>
			<Home />
		</MemoryRouter>,
	);
	// Wait for the feed to load the seeded post.
	await waitFor(() => {
		expect(screen.getByTestId("card-support")).toHaveTextContent("2");
	});
}

describe("Home — realtime deltas from other users", () => {
	it("bumps a post's support count instantly on a reaction INSERT", async () => {
		await renderFeed();
		expect(mocks.realtimeCallback).toBeTruthy();

		await act(async () => {
			mocks.realtimeCallback!("reactions", {
				eventType: "INSERT",
				new: { target_id: "p1", target_type: "post", kind: "support" },
				old: {},
			});
		});

		await waitFor(() => {
			expect(screen.getByTestId("card-support")).toHaveTextContent("3");
		});
	});

	it("decrements instantly on a reaction DELETE (un-like)", async () => {
		await renderFeed();

		await act(async () => {
			mocks.realtimeCallback!("reactions", {
				eventType: "DELETE",
				new: {},
				old: { target_id: "p1", target_type: "post", kind: "support" },
			});
		});

		await waitFor(() => {
			expect(screen.getByTestId("card-support")).toHaveTextContent("1");
		});
	});

	it("bumps comment_count on a comment INSERT and mirrors the deleted/hidden rule", async () => {
		await renderFeed();

		await act(async () => {
			mocks.realtimeCallback!("comments", {
				eventType: "INSERT",
				new: { post_id: "p1", deleted: false, hidden: false },
				old: {},
			});
		});
		await waitFor(() => {
			expect(screen.getByTestId("card-comments")).toHaveTextContent("2");
		});

		// A deleted comment must NOT bump the count (server never counts it).
		await act(async () => {
			mocks.realtimeCallback!("comments", {
				eventType: "INSERT",
				new: { post_id: "p1", deleted: true, hidden: false },
				old: {},
			});
		});
		await waitFor(async () => {
			expect(screen.getByTestId("card-comments")).toHaveTextContent("2");
		});
	});

	it("ignores reaction events for non-post targets", async () => {
		await renderFeed();

		await act(async () => {
			mocks.realtimeCallback!("reactions", {
				eventType: "INSERT",
				new: { target_id: "c9", target_type: "comment", kind: "like" },
				old: {},
			});
		});

		// No change, no crash.
		expect(screen.getByTestId("card-support")).toHaveTextContent("2");
	});

	it("quiet-merges new posts near the top instead of badging", async () => {
		await renderFeed();
		expect(mocks.realtimeCallback).toBeTruthy();
		mocks.getSlow.mockClear();
		mocks.getSlowFresh.mockClear();
		mocks.getFresh.mockClear();
		const NEWER = { ...POST, id: "new-9", title: "Just arrived" };
		mocks.getFresh.mockImplementation(async (url: unknown) => {
			if (typeof url === "string" && url.includes("/api/posts?id=new-9"))
				return { post: NEWER, counts: {}, mine: [] };
			return [];
		});

		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "INSERT",
				new: { id: "new-9" },
				old: {},
			});
		});

		// Single-row merge path: one small GET, no badge, no pill, and no
		// whole-list silent reload.
		await waitFor(() => {
			expect(screen.getByText("Just arrived")).toBeInTheDocument();
		});
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
		expect(mocks.getSlow).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("button", { name: /View \d+ new updates?/ }),
		).toBeNull();
	});

	it("parks newcomers behind the pill when scrolled down", async () => {
		await renderFeed();
		Object.defineProperty(window, "scrollY", {
			value: 1200,
			configurable: true,
		});
		mocks.getSlow.mockClear();
		mocks.getSlowFresh.mockClear();
		mocks.getFresh.mockClear();
		const NEWER = { ...POST, id: "new-9", title: "Just arrived" };
		mocks.getFresh.mockImplementation(async (url: unknown) => {
			if (typeof url === "string" && url.includes("/api/posts?id=new-9"))
				return { post: NEWER, counts: {}, mine: [] };
			return [];
		});

		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "INSERT",
				new: { id: "new-9" },
				old: {},
			});
		});

		// Parked, not merged: the pill owns scrolled reads (the update badge
		// stays down — one prompt, not two).
		const pill = await screen.findByRole("button", { name: /1 new post/ });
		expect(pill).toBeInTheDocument();
		// …but the visible list is untouched until the pill is tapped.
		expect(screen.queryByText("Fresh broken bench")).toBeNull();
		Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
	});

	it("pulls one fresh snapshot when the pill is tapped", async () => {
		mocks.getSlow.mockImplementation(async () => [POST]);
		mocks.getSlowFresh.mockImplementation(async () => [POST]);
		mocks.getFresh.mockImplementation(async (url: unknown) => {
			if (typeof url === "string" && url.includes("/api/posts?id=new-9"))
				return { post: { ...POST, id: "new-9", title: "Just arrived" }, counts: {}, mine: [] };
			return [];
		});
		await renderFeed();
		// Pill only rises while scrolled — the near-top path merges quietly.
		Object.defineProperty(window, "scrollY", {
			value: 1200,
			configurable: true,
		});
		const NEWER = { ...POST, id: "new-9", title: "Just arrived" };
		mocks.getSlowFresh.mockResolvedValue([NEWER, POST]);
		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "INSERT",
				new: { id: "new-9" },
				old: {},
			});
		});
		// The pill must rise while still scrolled: the 400ms merge flush
		// reads scrollY when it fires, so reset only after it appears (the
		// honest flow — the reader scrolls up, then taps).
		const pillButton = await screen.findByRole("button", { name: /1 new post/ });
		Object.defineProperty(window, "scrollY", { value: 0, configurable: true });

		mocks.getSlowFresh.mockImplementation(async () => [NEWER, POST]);
		fireEvent.click(pillButton);

		// Explicit pulls demand a fully fresh read (never the shared snapshot).
		await waitFor(() => {
			expect(mocks.getSlowFresh).toHaveBeenCalledWith("/api/posts?type=problem&fresh=1");
		});
		expect(await screen.findByText("Just arrived")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /new posts?/ }),
		).toBeNull();
	});

	it("fires zero GETs for a burst of votes — one badge, nothing else", async () => {
		await renderFeed();
		expect(mocks.realtimeCallback).toBeTruthy();
		mocks.getFresh.mockClear();

		// Five votes land synchronously — previously each one refetched the
		// poll (coalesced to one GET). Now none of them fetches at all.
		await act(async () => {
			for (let i = 0; i < 5; i++) {
				mocks.realtimeCallback!("poll_votes", {
					eventType: "INSERT",
					new: { poll_id: "poll1" },
					old: {},
				});
			}
		});

		expect(mocks.getFresh).not.toHaveBeenCalled();
		expect(
			await screen.findByRole("button", { name: /View \d+ new updates?/ }),
		).toBeInTheDocument();
	});

	it("registers exactly one zero-debounce vote lane, separate from the batched feed lane", async () => {
		await renderFeed();

		// A vote's only liveness signal is the `polls` updated_at touch, so it
		// cannot wait out the 1500ms feed batch and still meet ~100ms.
		const pollSubs = mocks.realtimeSubs.filter((s) => s.tables.includes("polls"));
		expect(
			pollSubs,
			"one lane owns polls — a second would double-fetch every vote",
		).toHaveLength(1);
		expect(
			pollSubs[0]?.debounceMs,
			"the vote lane must register with no debounce",
		).toBe(0);

		// The batched lane must leave polls alone rather than fetch them twice.
		const feedSubs = mocks.realtimeSubs.filter((s) => !s.tables.includes("polls"));
		expect(feedSubs.length).toBeGreaterThan(0);

		mocks.getFresh.mockClear();
		mocks.getSlow.mockClear();
		mocks.getSlowFresh.mockClear();
		await act(async () => {
			mocks.realtimeCallback!("polls", {
				eventType: "UPDATE",
				new: { id: "poll9" },
				old: {},
			});
			mocks.realtimeCallback!("polls", {
				eventType: "UPDATE",
				new: { id: "poll10" },
				old: {},
			});
		});

		// Both rows refetched — one small targeted GET each, never the feed.
		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalledWith(
				expect.stringContaining("ids=poll9"),
			);
			expect(mocks.getFresh).toHaveBeenCalledWith(
				expect.stringContaining("ids=poll10"),
			);
		});
		expect(
			mocks.getSlow.mock.calls.length + mocks.getSlowFresh.mock.calls.length,
		).toBe(0);
	});
});

describe("Home — withdrawn posts leave the feed immediately", () => {
	// The quiet merge updates rows in place and never drops one, and a
	// hard DELETE never reached a loader at all — so a post the server had
	// stopped serving (moderated, soft-deleted, hard-deleted) stayed on
	// screen behind a badge whose own refresh could not remove it. These
	// cases pin the withdrawal path: the row goes NOW, with no fetch and
	// no badge, because dropping the row IS the refresh.
	beforeEach(() => {
		mocks.getSlow.mockClear();
		mocks.getSlowFresh.mockClear();
	});

	it("removes a post from the feed on a moderation UPDATE (hidden: true), no fetch", async () => {
		await renderFeed();
		expect(screen.getByTestId("post-card")).toBeInTheDocument();
		// Clear the initial load's calls so only the event's own effect counts.
		mocks.getSlow.mockClear();
		mocks.getSlowFresh.mockClear();

		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "UPDATE",
				new: { id: "p1", hidden: true, deleted: false },
				old: { id: "p1" },
			});
		});

		await waitFor(() => {
			expect(screen.queryByTestId("post-card")).toBeNull();
		});
		// No fetch — the reload could not drop it anyway (the quiet merge
		// keeps rows absent from the response).
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
		expect(mocks.getSlow).not.toHaveBeenCalled();
		// No badge either: there is nothing left to refresh into view.
		expect(
			screen.queryByRole("button", { name: /View \d+ new updates?/ }),
		).toBeNull();
	});

	it("removes a post from the feed on a soft-delete UPDATE (deleted: true)", async () => {
		await renderFeed();

		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "UPDATE",
				new: { id: "p1", hidden: false, deleted: true },
				old: { id: "p1" },
			});
		});

		await waitFor(() => {
			expect(screen.queryByTestId("post-card")).toBeNull();
		});
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
	});

	it("removes a post from the feed on a hard DELETE", async () => {
		await renderFeed();

		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "DELETE",
				new: {},
				old: { id: "p1" },
			});
		});

		await waitFor(() => {
			expect(screen.queryByTestId("post-card")).toBeNull();
		});
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("button", { name: /View \d+ new updates?/ }),
		).toBeNull();
	});

	it("keeps a live post and refreshes just that row on an ordinary UPDATE", async () => {
		// The predicate must not swallow the normal liveness path: a status
		// change or an edit refreshes the one row in place — never a full
		// silent reload.
		await renderFeed();
		mocks.getSlow.mockClear();
		mocks.getSlowFresh.mockClear();
		mocks.getFresh.mockClear();
		const EDITED = { ...POST, status: "solved" };
		mocks.getFresh.mockImplementation(async (url: unknown) => {
			if (typeof url === "string" && url.includes("/api/posts?id=p1"))
				return { post: EDITED, counts: {}, mine: [] };
			return [];
		});

		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "UPDATE",
				new: { id: "p1", hidden: false, deleted: false, status: "solved" },
				old: { id: "p1" },
			});
		});

		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalledWith(
				expect.stringContaining("/api/posts?id=p1"),
			);
		});
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
		expect(mocks.getSlow).not.toHaveBeenCalled();
		expect(screen.getByTestId("post-card")).toBeInTheDocument();
	});

	it("still raises the badge for a posts DELETE with no resolvable id", async () => {
		// The page must degrade to the badge rather than silently ignoring
		// an event it could not resolve to a row.
		await renderFeed();

		await act(async () => {
			mocks.realtimeCallback!("posts", {
				eventType: "DELETE",
				new: {},
				old: {},
			});
		});

		expect(
			await screen.findByRole("button", { name: /View \d+ new updates?/ }),
		).toBeInTheDocument();
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
	});
});
