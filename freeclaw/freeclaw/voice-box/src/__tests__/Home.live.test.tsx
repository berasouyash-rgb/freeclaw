// ─── Home live feed — auto-merge on realtime events ──────────────
// The feed used to badge every realtime event ("New posts" pill / update
// notice) and never merge content on its own, so scrolling readers saw a
// frozen list until they tapped. Contract pinned here:
//   1. posts INSERT near the top → quiet silent merge, newcomers prepended,
//      no pill, no reorder of rows being read.
//   2. posts INSERT while scrolled down → newcomers park behind the pill,
//      visible rows untouched.
//   3. polls INSERT/UPDATE → targeted single-poll GET merged into pollsMap,
//      never a full feed reload.
//   4. comments INSERT → comment count bumps, but NO feed refetch (the open
//      thread live-refetches itself; a feed GET per comment would rebuild
//      the list under every busy minute — the old reload storm).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home, { __resetHomeSnapshot } from "../pages/Home";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	pushNotif: vi.fn(),
	confetti: vi.fn(),
	realtimeCb: null as null | ((table: string, payload: unknown) => void),
	getSlow: vi.fn(),
	getSlowFresh: vi.fn(),
	getFresh: vi.fn(),
	get: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/api")>();
	return {
		...actual,
		api: {
			get: mocks.get,
			getSlow: mocks.getSlow,
			getSlowFresh: mocks.getSlowFresh,
			getFresh: mocks.getFresh,
			post: vi.fn(async () => ({})),
			put: vi.fn(async () => ({})),
		},
	};
});

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		pushNotif: mocks.pushNotif,
		accountStatus: null,
		bookmarks: [],
		toggleBookmark: vi.fn(),
	}),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (
		_tables: string[],
		cb: (table: string, payload: unknown) => void,
	) => {
		mocks.realtimeCb = cb;
	},
}));

vi.mock("../hooks/useCategories", () => ({
	useCategories: () => ["All", "Academics", "Facilities"],
}));

function post(id: string, title: string) {
	return {
		id,
		type: "problem",
		title,
		description: `${title} body`,
		category: "Academics",
		priority: "low",
		tags: [],
		image_url: null,
		author_id: "anon-x",
		status: "reported",
		progress: 0,
		deleted: false,
		hidden: false,
		visibility: "public",
		reactions: {},
		comment_count: 0,
		linked_poll: null,
		created_at: "2026-09-01T00:00:00Z",
		updated_at: "2026-09-01T00:00:00Z",
	};
}

function feedGetImpl(posts: unknown[]) {
	mocks.getSlow.mockResolvedValue(posts);
	mocks.getSlowFresh.mockResolvedValue(posts);
	mocks.get.mockResolvedValue([]);
	mocks.getFresh.mockResolvedValue([]);
}

function setScrollY(y: number) {
	Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

async function renderHome(initialPosts: unknown[]) {
	feedGetImpl(initialPosts);
	mocks.get.mockResolvedValue([]);
	mocks.getFresh.mockResolvedValue([]);
	let tree: ReturnType<typeof render>;
	await act(async () => {
		tree = render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);
	});
	// Initial bounded load settles here.
	await waitFor(() => {
		expect(mocks.getSlow.mock.calls.length + mocks.getSlowFresh.mock.calls.length).toBeGreaterThan(0);
	});
	await act(async () => {});
	return tree!;
}

function fireRealtime(table: string, payload: unknown) {
	if (!mocks.realtimeCb) throw new Error("realtime callback not captured");
	act(() => {
		mocks.realtimeCb!(table, payload);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.realtimeCb = null;
	setScrollY(0);
	sessionStorage.clear();
	__resetHomeSnapshot();
	try {
		delete (window as unknown as Record<string, unknown>).Capacitor;
	} catch {
		/* ignore */
	}
});

function asMobileApp() {
	(window as unknown as Record<string, unknown>).Capacitor = {
		isNativePlatform: () => true,
	};
}

describe("Home live feed — realtime auto-merge", () => {
	it("prepends a new post near the top without a pill", async () => {
		await renderHome([post("p1", "Old cafeteria issue")]);
		expect(await screen.findByText("Old cafeteria issue")).toBeTruthy();
		const callsBefore =
			mocks.getSlowFresh.mock.calls.length + mocks.getSlow.mock.calls.length;

		// A new post lands on the server; the next silent read includes it.
		feedGetImpl([post("p2", "Fresh broken bench"), post("p1", "Old cafeteria issue")]);
		fireRealtime("posts", { eventType: "INSERT", new: { id: "p2" } });

		expect(await screen.findByText("Fresh broken bench")).toBeTruthy();
		// Merged via silent path — no "new posts" pill raised.
		expect(screen.queryByText(/new posts?/i)).toBeNull();
		const callsAfter =
			mocks.getSlowFresh.mock.calls.length + mocks.getSlow.mock.calls.length;
		expect(callsAfter).toBeGreaterThan(callsBefore);
	});

	it("parks newcomers behind the pill when scrolled down", async () => {
		setScrollY(1200);
		await renderHome([post("p1", "Old cafeteria issue")]);

		feedGetImpl([post("p2", "Fresh broken bench"), post("p1", "Old cafeteria issue")]);
		fireRealtime("posts", { eventType: "INSERT", new: { id: "p2" } });

		// Pill appears…
		expect(await screen.findByText(/new posts?/i)).toBeTruthy();
		// …but the visible list is untouched until tapped.
		expect(screen.queryByText("Fresh broken bench")).toBeNull();
	});

	it("refreshes just the changed poll on vote events", async () => {
		await renderHome([post("p1", "Old cafeteria issue")]);
		mocks.getFresh.mockClear();

		fireRealtime("polls", {
			eventType: "UPDATE",
			new: { id: "poll-9", question: "Q?" },
		});
		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalledWith(
				expect.stringContaining("ids=poll-9"),
			);
		});
	});

	it("does not refetch the feed on comment events", async () => {
		await renderHome([post("p1", "Old cafeteria issue")]);
		const callsBefore =
			mocks.getSlowFresh.mock.calls.length + mocks.getSlow.mock.calls.length;

		fireRealtime("comments", {
			eventType: "INSERT",
			new: { id: "c1", post_id: "p1" },
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});
		const callsAfter =
			mocks.getSlowFresh.mock.calls.length + mocks.getSlow.mock.calls.length;
		expect(callsAfter).toBe(callsBefore);
	});
});

describe("Home APK-only layers — web and desktop unchanged", () => {
	it("pins the filter toolbar as a sticky glass header on mobile only", async () => {
		asMobileApp();
		await renderHome([post("p1", "Old cafeteria issue")]);
		const toolbar = screen
			.getByPlaceholderText(/search problems/i)
			.closest("div.card");
		expect(toolbar?.className).toContain("sticky");
		expect(toolbar?.className).toContain("backdrop-blur-md");
	});

	it("keeps the static toolbar on web", async () => {
		await renderHome([post("p1", "Old cafeteria issue")]);
		const toolbar = screen
			.getByPlaceholderText(/search problems/i)
			.closest("div.card");
		expect(toolbar?.className).not.toContain("sticky");
		expect(screen.queryByTestId("feed-skeleton")).toBeNull();
	});

	it("shows skeleton loaders on mobile while the first load settles", async () => {
		asMobileApp();
		let resolveLoad!: (v: unknown[]) => void;
		const gate = new Promise<unknown[]>((r) => {
			resolveLoad = r;
		});
		mocks.getSlow.mockReturnValue(gate);
		mocks.getSlowFresh.mockReturnValue(gate);
		mocks.get.mockResolvedValue([]);
		mocks.getFresh.mockResolvedValue([]);
		let tree: ReturnType<typeof render>;
		await act(async () => {
			tree = render(
				<MemoryRouter>
					<Home />
				</MemoryRouter>,
			);
		});
		expect(screen.getByTestId("feed-skeleton")).toBeTruthy();
		await act(async () => {
			resolveLoad([post("p1", "Old cafeteria issue")]);
		});
		expect(await screen.findByText("Old cafeteria issue")).toBeTruthy();
		expect(screen.queryByTestId("feed-skeleton")).toBeNull();
		tree!.unmount();
	});

	it("badges the mobile filter toggle with the hidden active count", async () => {
		asMobileApp();
		await renderHome([post("p1", "Old cafeteria issue")]);
		// No badge while filters sit at defaults.
		expect(
			screen.queryByLabelText(/filters active/i),
		).toBeNull();
		// "Solved" lives in the collapsible row — one active filter.
		fireEvent.click(screen.getByRole("tab", { name: /^solved$/i }));
		expect(
			await screen.findByLabelText(/1 filters active/i),
		).toBeTruthy();
	});
});
