// ═══════════════════════════════════════════════════════════════════
// Home feed — default behavior regression tests
// ═══════════════════════════════════════════════════════════════════
// Verifies:
//   • Default sort is "newest" (not trending)
//   • No "open" status filter tab exists
//   • Status filter tabs are "all" and "solved" only
// ═══════════════════════════════════════════════════════════════════

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetHomeSnapshot,
	clearPersistedSnapshot,
	isHomeSnapshotFresh,
} from "../pages/Home";

const mocks = vi.hoisted(() => ({
	get: vi.fn(async (_path: string): Promise<unknown> => []),
	getSlow: vi.fn(async (_path: string): Promise<unknown> => []),
	getSlowFresh: vi.fn(async (_path: string): Promise<unknown> => []),
	getFresh: vi.fn(async (_path: string): Promise<unknown> => []),
	post: vi.fn(async (_path: string, _body?: unknown) => ({})),
}));

vi.mock("../lib/api", () => ({
	api: mocks,
}));

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
	useRealtime: () => {},
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
	default: ({ post }: { post: { title: string } }) => (
		<article data-testid="post-card">{post.title}</article>
	),
	PostCard: ({ post }: { post: { title: string } }) => (
		<article data-testid="post-card">{post.title}</article>
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

beforeEach(() => {
	vi.clearAllMocks();
	// Module-level feed snapshot must not leak between cases.
	__resetHomeSnapshot();
	mocks.getSlow.mockResolvedValue([]);
	mocks.getSlowFresh.mockResolvedValue([]);
	mocks.get.mockResolvedValue([]);
	mocks.getFresh.mockResolvedValue([]);
});

// We can't easily render the full Home page with all its lazy imports,
// so we test the behavior by examining the module's exported defaults.
// Instead, we import the component and check its initial state via rendering.

describe("Home — default feed behavior", () => {
	it("renders without crashing", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		// Should render the hero section at minimum
		expect(screen.getByText(/speak up/i)).toBeInTheDocument();
	});

	it("requests linked polls in one bounded batch", async () => {
		mocks.getSlow.mockResolvedValue({
			data: [
				{
					id: "post-1",
					type: "problem",
					title: "Poll-linked problem",
					description: "A linked poll",
					category: "Facilities",
					status: "reported",
					author_id: "someone",
					created_at: new Date().toISOString(),
					linked_poll: "poll-1",
				},
				{
					id: "post-2",
					type: "problem",
					title: "Another linked problem",
					description: "Another linked poll",
					category: "Facilities",
					status: "reported",
					author_id: "someone",
					created_at: new Date().toISOString(),
					linked_poll: "poll-2",
				},
			],
			nextCursor: null,
			total: 2,
		});
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalledWith(
				"/api/polls?ids=poll-1%2Cpoll-2&viewer=test-anon",
			);
		});
		const pollListCalls = mocks.getFresh.mock.calls.filter(([url]) =>
			String(url).includes("/api/polls?ids="),
		);
		expect(pollListCalls).toHaveLength(1);
	});

	it("loads the whole bounded feed in one request with no paging controls", async () => {
		// Normal feed behavior: every visible post (new, old, and pinned)
		// arrives in a single bounded load. No cursor pages, no Load more
		// button, no sentinel fetching — scrolling just reveals rows.
		const rows = [
			{
				id: "pinned-1",
				type: "problem",
				title: "Pinned newcomer",
				description: "Pinned posts stay on top",
				category: "Facilities",
				status: "reported",
				author_id: "someone",
				pinned: true,
				created_at: new Date().toISOString(),
			},
			...Array.from({ length: 20 }, (_, index) => ({
				id: `new-${index}`,
				type: "problem",
				title: `Newer post ${index + 1}`,
				description: "A newer public problem",
				category: "Facilities",
				status: "reported",
				author_id: "someone",
				created_at: new Date(Date.now() - index * 60_000).toISOString(),
			})),
			{
				id: "older-target",
				type: "problem",
				title: "Older target post",
				description: "The post the admin can see",
				category: "Facilities",
				status: "reported",
				author_id: "someone",
				created_at: "2026-09-01T00:00:00.000Z",
			},
		];
		mocks.getSlow.mockImplementation(async () => rows);
		mocks.getSlowFresh.mockImplementation(async () => rows);

		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);

		// New, old, and pinned rows all render from the single load, pinned first.
		await screen.findByText("Older target post");
		expect(screen.getByText("Newer post 1")).toBeInTheDocument();
		const cards = screen.getAllByTestId("post-card");
		expect(cards[0]).toHaveTextContent("Pinned newcomer");
		expect(
			screen.queryByRole("button", { name: /Load more/i }),
		).toBeNull();

		// Exactly one bounded posts request — no paginate, cursor, or limit params.
		const postPaths = [
			...mocks.getSlow.mock.calls,
			...mocks.getSlowFresh.mock.calls,
		].map(([path]) => String(path));
		expect(postPaths).toHaveLength(1);
		expect(postPaths[0]).toBe("/api/posts?type=problem");
		expect(postPaths[0]).not.toContain("paginate");
		expect(postPaths[0]).not.toContain("cursor");
	});

	it("does not show 'Open' in the status filter tabs", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		// The status filter should only have "all" and "solved" — no "open"
		const allTabs = screen.getAllByRole("tab");
		const tabLabels = allTabs.map((t) => t.textContent?.toLowerCase().trim());
		expect(tabLabels).not.toContain("open");
	});

	it("shows 'All' and 'Solved' as status filter options", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		expect(screen.getByRole("tab", { name: /all/i })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /solved/i })).toBeInTheDocument();
	});

	it("defaults to 'newest' sort (newest button is selected)", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		// The sort segmented control should have "Newest" selected
		const newestBtn = screen.getByRole("tab", { name: /newest/i });
		expect(newestBtn).toHaveAttribute("aria-selected", "true");
	});

	it("defaults the user feed to complaints only, with suggestions one filter tap away", async () => {
		const suggestion = {
			id: "suggestion-1",
			type: "suggestion",
			title: "A public suggestion",
			description: "A suggestion that stays behind its filter",
			category: "Academics",
			status: "reported",
			priority: "medium",
			author_id: "someone",
			created_at: "2026-09-20T00:00:00.000Z",
			hidden: false,
			deleted: false,
		};
		const problem = {
			id: "problem-1",
			type: "problem",
			title: "A public complaint",
			description: "The default feed shows complaints",
			category: "Facilities",
			status: "reported",
			priority: "medium",
			author_id: "someone",
			created_at: "2026-09-20T00:00:00.000Z",
			hidden: false,
			deleted: false,
		};
		const respond = async (path: unknown) => {
			if (String(path).includes("type=suggestion")) {
				return { data: [suggestion], nextCursor: null, total: 1 };
			}
			return { data: [problem], nextCursor: null, total: 1 };
		};
		mocks.getSlow.mockImplementation(respond);
		mocks.getSlowFresh.mockImplementation(respond);

		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);

		// Default feed: complaints only, never mixed.
		expect(await screen.findByText("A public complaint")).toBeInTheDocument();
		expect(screen.queryByText("A public suggestion")).toBeNull();
		const requestedPaths = [
			...mocks.getSlow.mock.calls,
			...mocks.getSlowFresh.mock.calls,
		].map(([path]) => String(path));
		expect(requestedPaths[0]).toContain("type=problem");

		// One dropdown tap reaches suggestions.
		fireEvent.change(screen.getByLabelText("Filter by content type"), {
			target: { value: "suggestion" },
		});
		expect(await screen.findByText("A public suggestion")).toBeInTheDocument();
	});

	it("searches the full public post set instead of only the loaded first page", async () => {
		const firstPagePost = {
			id: "newer-1",
			type: "problem",
			title: "Newest visible problem",
			description: "The first page contains a newer problem",
			category: "Facilities",
			status: "reported",
			priority: "medium",
			author_id: "someone",
			created_at: "2026-09-24T00:00:00.000Z",
		};
		const olderTarget = {
			id: "older-target",
			type: "problem",
			title: "Older target problem",
			description: "This post is below the first page",
			category: "Facilities",
			status: "reported",
			priority: "medium",
			author_id: "someone",
			created_at: "2026-09-01T00:00:00.000Z",
		};
		const respond = async (path: string) => {
			if (String(path).includes("q=older%20target")) {
				return { data: [olderTarget], nextCursor: null, total: 1 };
			}
			return { data: [firstPagePost], nextCursor: "2026-09-23T00:00:00.000Z", total: 2 };
		};
		mocks.getSlow.mockImplementation(respond);
		mocks.getSlowFresh.mockImplementation(respond);

		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);

		expect(await screen.findByText("Newest visible problem")).toBeInTheDocument();
		fireEvent.change(screen.getByRole("textbox", { name: /search/i }), {
			target: { value: "older target" },
		});

		expect(await screen.findByText("Older target problem")).toBeInTheDocument();
		const requestedPaths = [
			...mocks.getSlow.mock.calls,
			...mocks.getSlowFresh.mock.calls,
		].map(([path]) => String(path));
		expect(requestedPaths.some((path) => path.includes("q=older%20target"))).toBe(true);
	});

	it("bypasses the five-second GET cache for an explicit feed retry", async () => {
		mocks.getSlow.mockRejectedValueOnce(new Error("temporary feed failure"));
		mocks.getSlow.mockResolvedValue({ data: [], nextCursor: null, total: 0 });
		mocks.getSlowFresh.mockResolvedValue({ data: [], nextCursor: null, total: 0 });

		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);

		expect(await screen.findByText("temporary feed failure")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() => {
			expect(mocks.getSlowFresh).toHaveBeenCalledWith("/api/posts?type=problem&fresh=1");
		});
	});

	it("applies category filters before the first page is loaded", async () => {
		const firstPagePost = {
			id: "academics-1",
			type: "problem",
			title: "Academics page post",
			description: "The first page is from another category",
			category: "Academics",
			status: "reported",
			priority: "medium",
			author_id: "someone",
			created_at: "2026-09-24T00:00:00.000Z",
		};
		const facilitiesTarget = {
			id: "facilities-target",
			type: "problem",
			title: "Facilities target post",
			description: "The matching post is outside the first page",
			category: "Facilities",
			status: "reported",
			priority: "medium",
			author_id: "someone",
			created_at: "2026-09-01T00:00:00.000Z",
		};
		const respond = async (path: string) => {
			if (String(path).includes("category=Facilities")) {
				return { data: [facilitiesTarget], nextCursor: null, total: 1 };
			}
			return { data: [firstPagePost], nextCursor: null, total: 1 };
		};
		mocks.getSlow.mockImplementation(respond);
		mocks.getSlowFresh.mockImplementation(respond);

		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);

		expect(await screen.findByText("Academics page post")).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Filter by category"), {
			target: { value: "Facilities" },
		});

		expect(await screen.findByText("Facilities target post")).toBeInTheDocument();
		const requestedPaths = [
			...mocks.getSlow.mock.calls,
			...mocks.getSlowFresh.mock.calls,
		].map(([path]) => String(path));
		expect(requestedPaths.some((path) => path.includes("category=Facilities"))).toBe(true);
	});

	it("keeps the pull-to-refresh indicator out of document flow", async () => {
		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		await screen.findByText(/speak up/i);

		const zone = document.querySelector(".min-h-dvh") as HTMLElement;
		fireEvent.touchStart(zone, { touches: [{ clientY: 0 }] });
		fireEvent.touchMove(zone, { touches: [{ clientY: 90 }] });

		expect(screen.getByText("Pull to refresh")).toHaveClass("fixed");
		fireEvent.touchEnd(zone);
	});

	it("keeps last-known posts visible without a red page-level refresh error", async () => {
		mocks.getSlow.mockResolvedValue({
			data: [
				{
					id: "known-post",
					type: "problem",
					title: "Known post remains visible",
					description: "A previous successful snapshot",
					category: "Facilities",
					status: "reported",
					author_id: "someone",
					created_at: "2026-09-24T00:00:00.000Z",
				},
			],
			nextCursor: null,
			total: 1,
		});
		mocks.getSlowFresh.mockRejectedValue(new Error("refresh failed"));

		const { default: Home } = await import("../pages/Home");
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		expect(await screen.findByText("Known post remains visible")).toBeInTheDocument();

		const zone = document.querySelector(".min-h-dvh") as HTMLElement;
		fireEvent.touchStart(zone, { touches: [{ clientY: 0 }] });
		fireEvent.touchMove(zone, { touches: [{ clientY: 90 }] });
		fireEvent.touchEnd(zone);

		const notice = await screen.findByText(/showing the last available posts/i);
		expect(notice).not.toHaveClass("text-bad");
		expect(screen.getByText("Known post remains visible")).toBeInTheDocument();
	});
});

describe("Home — cross-visit snapshot", () => {
	const SNAP_POST = {
		id: "snap-1",
		type: "problem",
		title: "Snapshotted post paints instantly",
		description: "Saved from the previous visit",
		category: "Facilities",
		status: "reported",
		author_id: "someone",
		created_at: new Date().toISOString(),
	};

	it("revisit within TTL paints instantly without waiting for network", async () => {
		mocks.getSlow.mockResolvedValue([SNAP_POST]);
		const { default: Home } = await import("../pages/Home");
		const first = render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		await screen.findByText("Snapshotted post paints instantly");
		first.unmount();

		// The revisit revalidates silently — hang it forever to prove the
		// paint does not wait for the network.
		mocks.getSlow.mockClear();
		mocks.getSlowFresh.mockImplementation(() => new Promise<never>(() => {}));
		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
		await act(async () => {});
		expect(
			screen.getByText("Snapshotted post paints instantly"),
		).toBeInTheDocument();
		// No fresh mount fetch — only the silent revalidate fired.
		expect(mocks.getSlow).not.toHaveBeenCalled();
		expect(mocks.getSlowFresh).toHaveBeenCalledTimes(1);
	});

	it("treats snapshots older than 60s as stale", () => {
		const now = Date.now();
		expect(isHomeSnapshotFresh(now, now)).toBe(true);
		expect(isHomeSnapshotFresh(now - 59_000, now)).toBe(true);
		expect(isHomeSnapshotFresh(now - 60_000, now)).toBe(false);
		expect(isHomeSnapshotFresh(now - 61_000, now)).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════
// The in-memory snapshot above only survives in-app navigation. A real
// RELOAD threw it away, so a cold entry had nothing to paint and showed an
// empty feed until the network answered (the reported "posts show up ~5s
// late"). These pin the persisted half: cold paint, the freshness and shape
// guards, and the reconciliation rule.
// ═══════════════════════════════════════════════════════════════════
describe("Home — persisted snapshot on a cold page load", () => {
	const KEY = "voicebox:home-snapshot:v1";
	type SnapPost = {
		id: string;
		type: string;
		title: string;
		description: string;
		category: string;
		status: string;
		author_id: string;
		created_at: string;
	};
	const mkPost = (id: string, title: string): SnapPost => ({
		id,
		type: "problem",
		title,
		description: "body",
		category: "Facilities",
		status: "reported",
		author_id: "someone",
		created_at: new Date().toISOString(),
	});

	/** Simulates a real reload: storage populated, module state empty. */
	const seed = (over: Record<string, unknown> = {}) => {
		sessionStorage.setItem(
			KEY,
			JSON.stringify({
				v: 1,
				posts: [mkPost("s1", "Persisted post paints on reload")],
				myReactions: {},
				pollsMap: {},
				myPollVotes: {},
				knownIds: ["s1"],
				at: Date.now(),
				...over,
			}),
		);
	};

	const mount = async () => {
		const { default: Home } = await import("../pages/Home");
		return render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
	};

	it("paints the last-known feed before the network answers", async () => {
		seed();
		// Hang the revalidate forever: a paint that waits on it must fail here.
		mocks.getSlow.mockReturnValue(new Promise<never>(() => {}));
		await mount();
		await act(async () => {});
		expect(
			screen.getByText("Persisted post paints on reload"),
		).toBeInTheDocument();
		// A RESTORED snapshot reconciles with a full replace, which reads the
		// non-fresh path — NOT the in-session getSlowFresh quiet merge.
		expect(mocks.getSlow).toHaveBeenCalledTimes(1);
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
	});

	it("ignores an expired snapshot and loads from the network", async () => {
		seed({ at: Date.now() - 61_000 });
		mocks.getSlow.mockResolvedValue([mkPost("f1", "Server post wins")]);
		await mount();
		await screen.findByText("Server post wins");
		expect(
			screen.queryByText("Persisted post paints on reload"),
		).not.toBeInTheDocument();
	});

	it.each([
		["malformed JSON", "{"],
		[
			"an unknown schema version",
			JSON.stringify({ v: 2, posts: [mkPost("x", "nope")], knownIds: ["x"], at: Date.now() }),
		],
		[
			"a non-array posts field",
			JSON.stringify({ v: 1, posts: "nope", knownIds: [], at: Date.now() }),
		],
		[
			"a missing timestamp",
			JSON.stringify({ v: 1, posts: [mkPost("x", "nope")], knownIds: ["x"] }),
		],
	])(
		"survives %s and falls back to the network",
		async (_label, raw) => {
			sessionStorage.setItem(KEY, raw);
			mocks.getSlow.mockResolvedValue([mkPost("f2", "Fallback post")]);
			await mount();
			await screen.findByText("Fallback post");
			expect(screen.queryByText("nope")).not.toBeInTheDocument();
		},
	);

	it("drops a row the server no longer has instead of merging it back", async () => {
		const live = mkPost("live-1", "Still on the server");
		const gone = mkPost("gone-1", "Deleted while the tab was closed");
		seed({ posts: [live, gone], knownIds: ["live-1", "gone-1"] });
		// Hold the response open so the painted state can be asserted first.
		let release: (v: SnapPost[]) => void = () => {};
		mocks.getSlow.mockReturnValue(
			new Promise<SnapPost[]>((resolve) => {
				release = resolve;
			}),
		);
		await mount();
		// Painted from storage first — including the stale row.
		await screen.findByText("Deleted while the tab was closed");
		await act(async () => {
			release([live]);
		});
		// Server truth replaces the painted list wholesale.
		await waitFor(() =>
			expect(
				screen.queryByText("Deleted while the tab was closed"),
			).not.toBeInTheDocument(),
		);
		expect(screen.getByText("Still on the server")).toBeInTheDocument();
	});

	it("__resetHomeSnapshot clears the persisted copy as well", () => {
		seed();
		expect(sessionStorage.getItem(KEY)).not.toBeNull();
		__resetHomeSnapshot();
		expect(sessionStorage.getItem(KEY)).toBeNull();
	});

	it("clearPersistedSnapshot is safe when nothing was stored", () => {
		expect(() => clearPersistedSnapshot()).not.toThrow();
	});
});
