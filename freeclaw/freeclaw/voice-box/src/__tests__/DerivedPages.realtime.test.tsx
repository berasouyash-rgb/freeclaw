// Derived pages — live without a refresh click (evolution 2026-10-09)
// Leaderboard, Saved, Insights, MyActivity and Communities derive their
// numbers from tables in the public realtime contract (posts/comments/polls).
// Locks two invariants per page:
//   1. The page subscribes to exactly the tables its data comes from — a
//      write on another device moves the numbers with no manual reload.
//   2. The background refetch is SILENT: a transient failure never raises
//      an error banner, never wipes last-known content, and never flips a
//      section back to a skeleton. Only explicit loads report errors.

import { act, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Insights from "../pages/Insights";
import Leaderboard from "../pages/Leaderboard";
import MyActivity from "../pages/MyActivity";
import Saved from "../pages/Saved";
import Communities from "../pages/Communities";

// The public realtime contract: anon channels may only be opened for these
// tables. Anything else silently receives no events (a dead channel that
// reads as "realtime is broken").
const CONTRACT = JSON.parse(
	readFileSync(resolve(process.cwd(), "src/lib/realtimeContract.json"), "utf-8"),
) as { anonSelectTables: string[] };

// When true, every api GET rejects — simulates a transient network blip
// DURING a background refresh. Flipped only after the initial load has
// settled, so mount-time requests always succeed.
let backgroundFail = false;

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	getSlow: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	toast: vi.fn(),
	hasAdminSession: vi.fn(),
	bookmarks: ["p1", "p2"] as string[],
	toggleBookmark: vi.fn(),
	refreshIdentity: vi.fn(),
	retireNotifsForLink: vi.fn(),
	lsGet: vi.fn(),
	resetAnonId: vi.fn(),
	clearAllLocalData: vi.fn(),
	resetTutorial: vi.fn(),
	downloadFile: vi.fn(),
	realtimeSubs: [] as Array<{
		tables: string[];
		cb: (table: string, payload: unknown) => void;
		debounceMs: number;
	}>,
}));

// ── Fixtures ────────────────────────────────────────────────────────────

const COMMUNITY = {
	slug: "study-gang",
	name: "Study Gang",
	description: "Cram together",
	avatar: "📚",
	created_by: "anon_a",
	created_at: "2026-07-01T10:00:00.000Z",
	hidden: false,
	member_count: 3,
	post_count: 5,
};

const COMMUNITY_LIST = { communities: [COMMUNITY] };

const SAVED_POSTS = [
	{
		id: "p1",
		type: "problem",
		title: "Broken projector",
		description: "Needs fixing",
		category: "Facilities",
		priority: "medium",
		status: "reported",
		reactions: {},
		comment_count: 0,
		created_at: "2026-07-01T10:00:00.000Z",
	},
	{
		id: "p2",
		type: "suggestion",
		title: "Cafeteria menus online",
		description: "Post the menu early",
		category: "Canteen",
		priority: "low",
		status: "reported",
		reactions: {},
		comment_count: 0,
		created_at: "2026-07-02T10:00:00.000Z",
	},
];

const EMPTY_LEADERBOARD = {
	problems: [],
	suggestions: [],
	polls: [],
	leaderboard: [],
	ai_activity: [],
};

const INSIGHTS_PAYLOAD = {
	totals: {
		posts: 120,
		comments: 340,
		reactions: 890,
		polls: 14,
		poll_votes: 520,
		open: 30,
		solved: 90,
		participants: 76,
	},
	by_category: [
		{ category: "Academics", count: 40, solved: 30 },
		{ category: "Facilities", count: 25, solved: 10 },
	],
	by_status: [
		{ status: "reported", count: 15 },
		{ status: "solved", count: 90 },
		{ status: "in_progress", count: 15 },
	],
	trend: Array.from({ length: 15 }, (_, i) => ({
		date: `2026-07-${String(i + 1).padStart(2, "0")}`,
		posts: i,
		comments: i * 2,
	})),
	top_categories: [{ category: "Academics", count: 40 }],
	generated_at: "2026-08-01T00:00:00.000Z",
};

const POST = {
	id: "p1",
	title: "Broken projector",
	type: "problem",
	category: "Facilities",
	status: "reported",
	created_at: "2026-07-01T10:00:00.000Z",
};

const COMMENT = {
	id: "c1",
	body: "Thanks for reporting!",
	post_id: "p1",
	created_at: "2026-07-01T11:00:00.000Z",
};

const POLL = {
	id: "pl1",
	title: "Coffee brand?",
	options: ["Yes", "No"],
	author_id: "anon-test",
	total_votes: 3,
	ptype: "yesno",
	archived: false,
	created_at: "2026-07-01T12:00:00.000Z",
	is_mine: true,
	deleted: false,
};

const REACTION = { id: "r1", kind: "like", target_id: "p1", target_type: "post" };
const VOTE = { choices: ["Option A", "Option B"] };
const APPEAL = {
	id: "a1",
	surface: "Canteen",
	title: "Canteen appeal",
	body: "Please reconsider",
	status: "open",
	created_at: "2026-07-01T13:00:00.000Z",
};

// ── URL dispatch (MyActivity/Saved/Communities share one GET mock) ─────

function dispatchGet(url: string): Promise<unknown> {
	if (backgroundFail) return Promise.reject(new Error("network blip"));
	if (url.includes("/api/communities")) return Promise.resolve(COMMUNITY_LIST);
	if (url.includes("/api/comments")) return Promise.resolve([COMMENT]);
	if (url.includes("/api/reactions")) return Promise.resolve([REACTION]);
	if (url.includes("voter=")) return Promise.resolve([VOTE]);
	if (url.includes("author=")) return Promise.resolve([POST]);
	if (url.includes("/api/polls")) return Promise.resolve([POLL]);
	if (url.includes("/api/appeals")) return Promise.resolve([APPEAL]);
	if (url.includes("ids=")) return Promise.resolve(SAVED_POSTS);
	return Promise.resolve([]);
}

function dispatchGetSlow(url: string): Promise<unknown> {
	if (backgroundFail) return Promise.reject(new Error("network blip"));
	if (url.includes("/api/insights")) return Promise.resolve(INSIGHTS_PAYLOAD);
	return Promise.resolve(EMPTY_LEADERBOARD);
}

// ── Mocks ───────────────────────────────────────────────────────────────

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getSlow: mocks.getSlow,
		post: mocks.post,
		put: mocks.put,
	},
	hasAdminSession: mocks.hasAdminSession,
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (
		tables: string[],
		cb: (table: string, payload: unknown) => void,
		debounceMs = 1000,
	) => {
		mocks.realtimeSubs.push({ tables, cb, debounceMs });
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		// Empty on purpose: MyActivity's heading falls back to
		// "Anonymous profile" — a stable anchor that survives a
		// background refresh (a set name would render instead).
		displayName: "",
		profile: { avatar: "", bio: "" },
		notifications: [],
		bookmarks: mocks.bookmarks,
		recentlyViewed: [],
		toast: mocks.toast,
		refreshIdentity: mocks.refreshIdentity,
		retireNotifsForLink: mocks.retireNotifsForLink,
		toggleBookmark: mocks.toggleBookmark,
	}),
}));

vi.mock("react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-router")>();
	return {
		...actual,
		Link: ({
			to,
			children,
			...rest
		}: {
			to: string;
			children: React.ReactNode;
		}) => (
			<a href={to} {...rest}>
				{children}
			</a>
		),
	};
});

vi.mock("../lib/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/utils")>();
	return {
		...actual,
		timeAgo: () => "2d ago",
		downloadFile: mocks.downloadFile,
	};
});

vi.mock("../lib/identity", () => ({
	resetAnonId: mocks.resetAnonId,
	clearAllLocalData: mocks.clearAllLocalData,
	anonCreatedAt: () => "2026-07-01T10:00:00.000Z",
	lsGet: mocks.lsGet,
}));

vi.mock("../components/Tutorial", () => ({
	resetTutorial: mocks.resetTutorial,
}));

vi.mock("../components/ui", () => ({
	ConfirmDialog: ({ open, onClose, onConfirm, confirmLabel }: any) =>
		open ? (
			<div role="dialog">
				<button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
	Modal: ({ open, onClose, children }: any) =>
		open ? (
			<div role="dialog">
				<button onClick={onClose}>Close</button>
				{children}
			</div>
		) : null,
}));

vi.mock("../components/PostCard", () => ({
	__esModule: true,
	default: ({ post, onReacted }: any) => (
		<article>
			<h3>{post.title}</h3>
			<p>{post.description}</p>
			<button onClick={onReacted}>react</button>
		</article>
	),
}));

// ── Helpers ─────────────────────────────────────────────────────────────

function renderPage(ui: React.ReactElement) {
	return render(
		<MemoryRouter>
			{ui}
		</MemoryRouter>,
	);
}

function findSub(tables: string[]) {
	return mocks.realtimeSubs.find(
		(s) => s.tables.length === tables.length && tables.every((t) => s.tables.includes(t)),
	);
}

// Fire the freshest subscription for a table and let the whole async chain
// (refetch → setState → render) settle inside act.
async function fireRealtime(tables: string[], table: string) {
	const subs = mocks.realtimeSubs.filter((s) => s.tables.join() === tables.join());
	const sub = subs[subs.length - 1];
	if (!sub) throw new Error(`no subscription for [${tables.join(", ")}]`);
	await act(async () => {
		sub.cb(table, {});
		await new Promise((r) => setTimeout(r, 0));
	});
}

function expectInContract(tables: string[]) {
	for (const t of tables) {
		expect(CONTRACT.anonSelectTables).toContain(t);
	}
}

beforeEach(() => {
	vi.restoreAllMocks();
	mocks.realtimeSubs = [];
	backgroundFail = false;
	mocks.get.mockReset();
	mocks.getSlow.mockReset();
	mocks.post.mockReset();
	mocks.put.mockReset();
	mocks.toast.mockReset();
	mocks.lsGet.mockReset();
	mocks.hasAdminSession.mockReset();
	mocks.hasAdminSession.mockReturnValue(false);
	mocks.get.mockImplementation(dispatchGet);
	mocks.getSlow.mockImplementation(dispatchGetSlow);
	mocks.bookmarks = ["p1", "p2"];
});

// ── Leaderboard ─────────────────────────────────────────────────────────

describe("Leaderboard realtime", () => {
	it("subscribes to posts/polls/comments within the contract and refetches on a change", async () => {
		renderPage(<Leaderboard />);
		await screen.findByText("Nothing ranked yet");

		const sub = findSub(["posts", "polls", "comments"]);
		expect(sub).toBeTruthy();
		expect(sub?.debounceMs).toBe(2_000);
		expectInContract(sub!.tables);

		const before = mocks.getSlow.mock.calls.length;
		await fireRealtime(["posts", "polls", "comments"], "posts");
		await waitFor(() => expect(mocks.getSlow.mock.calls.length).toBeGreaterThan(before));
		expect(screen.getByText("Nothing ranked yet")).toBeInTheDocument();
	});

	it("keeps the last board and raises no banner when the background refetch fails", async () => {
		renderPage(<Leaderboard />);
		await screen.findByText("Nothing ranked yet");

		backgroundFail = true;
		const before = mocks.getSlow.mock.calls.length;
		await fireRealtime(["posts", "polls", "comments"], "polls");
		await waitFor(() => expect(mocks.getSlow.mock.calls.length).toBeGreaterThan(before));

		expect(screen.getByText("Nothing ranked yet")).toBeInTheDocument();
		expect(screen.queryByText("network blip")).not.toBeInTheDocument();
		expect(screen.queryByText("Failed to load leaderboard")).not.toBeInTheDocument();
	});
});

// ── Saved ───────────────────────────────────────────────────────────────

describe("Saved realtime", () => {
	it("subscribes to posts within the contract and refetches on a change", async () => {
		renderPage(<Saved />);
		await screen.findByText("Broken projector");

		const sub = findSub(["posts"]);
		expect(sub).toBeTruthy();
		expect(sub?.debounceMs).toBe(2_000);
		expectInContract(sub!.tables);

		const before = mocks.get.mock.calls.length;
		await fireRealtime(["posts"], "posts");
		await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(before));

		expect(screen.getByText("Broken projector")).toBeInTheDocument();
		expect(screen.getByText("Cafeteria menus online")).toBeInTheDocument();
	});

	it("keeps saved posts and raises no banner when the background refetch fails", async () => {
		renderPage(<Saved />);
		await screen.findByText("Broken projector");

		backgroundFail = true;
		const before = mocks.get.mock.calls.length;
		await fireRealtime(["posts"], "posts");
		await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(before));

		expect(screen.getByText("Broken projector")).toBeInTheDocument();
		expect(screen.getByText("Cafeteria menus online")).toBeInTheDocument();
		expect(screen.queryByText("network blip")).not.toBeInTheDocument();
		expect(screen.queryByText("Could not load saved posts")).not.toBeInTheDocument();
	});
});

// ── Insights ────────────────────────────────────────────────────────────

describe("Insights realtime", () => {
	it("subscribes to posts/comments within the contract and refetches on a change", async () => {
		renderPage(<Insights />);
		await screen.findByText("120");

		const sub = findSub(["posts", "comments"]);
		expect(sub).toBeTruthy();
		expect(sub?.debounceMs).toBe(3_000);
		expectInContract(sub!.tables);

		const before = mocks.getSlow.mock.calls.length;
		await fireRealtime(["posts", "comments"], "comments");
		await waitFor(() => expect(mocks.getSlow.mock.calls.length).toBeGreaterThan(before));

		expect(screen.getByText("120")).toBeInTheDocument();
		expect(screen.getByText("Academics")).toBeInTheDocument();
	});

	it("keeps the numbers and raises no banner when the background refetch fails", async () => {
		renderPage(<Insights />);
		await screen.findByText("120");

		backgroundFail = true;
		const before = mocks.getSlow.mock.calls.length;
		await fireRealtime(["posts", "comments"], "posts");
		await waitFor(() => expect(mocks.getSlow.mock.calls.length).toBeGreaterThan(before));

		expect(screen.getByText("120")).toBeInTheDocument();
		expect(screen.getByText("340")).toBeInTheDocument();
		expect(screen.queryByText("network blip")).not.toBeInTheDocument();
		expect(
			screen.queryByText("Could not load insights — unexpected response."),
		).not.toBeInTheDocument();
	});
});

// ── MyActivity ──────────────────────────────────────────────────────────

describe("MyActivity realtime", () => {
	it("subscribes to posts/comments/polls within the contract and quietly refetches on a change", async () => {
		renderPage(<MyActivity />);
		await screen.findByText("Anonymous profile");
		await screen.findByText("Broken projector");

		const sub = findSub(["posts", "comments", "polls"]);
		expect(sub).toBeTruthy();
		expect(sub?.debounceMs).toBe(2_000);
		expectInContract(sub!.tables);

		const before = mocks.get.mock.calls.length;
		await fireRealtime(["posts", "comments", "polls"], "posts");
		await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(before));

		// Quiet refresh: content stays, no section flips back to a skeleton.
		expect(screen.getByText("Anonymous profile")).toBeInTheDocument();
		expect(screen.getByText("Broken projector")).toBeInTheDocument();
		expect(screen.queryByLabelText(/loading /i)).not.toBeInTheDocument();
		expect(screen.queryByText("Couldn't load your activity")).not.toBeInTheDocument();
	});

	it("keeps every section and raises no alert when the quiet refresh fails", async () => {
		renderPage(<MyActivity />);
		await screen.findByText("Anonymous profile");
		await screen.findByText("Broken projector");

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		backgroundFail = true;
		const before = mocks.get.mock.calls.length;
		await fireRealtime(["posts", "comments", "polls"], "comments");
		await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(before));

		// Positive evidence the quiet failure path ran…
		expect(
			warnSpy.mock.calls.some((c) => String(c[0]).includes("quiet refresh failed")),
		).toBe(true);
		// …and the sections still show last-known-good data with no alerts.
		expect(screen.getByText("Anonymous profile")).toBeInTheDocument();
		expect(screen.getByText("Broken projector")).toBeInTheDocument();
		expect(screen.queryByText("Couldn't load your activity")).not.toBeInTheDocument();
		expect(screen.queryByText(/service did not respond/)).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		warnSpy.mockRestore();
	});
});

// ── Communities ─────────────────────────────────────────────────────────

describe("Communities realtime", () => {
	it("subscribes to posts within the contract and refetches on a change", async () => {
		renderPage(<Communities />);
		await screen.findByText("Study Gang");

		const sub = findSub(["posts"]);
		expect(sub).toBeTruthy();
		expect(sub?.debounceMs).toBe(2_000);
		expectInContract(sub!.tables);

		const before = mocks.get.mock.calls.length;
		await fireRealtime(["posts"], "posts");
		await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(before));

		expect(screen.getByText("Study Gang")).toBeInTheDocument();
	});

	it("keeps the community list and raises no banner when the quiet refresh fails", async () => {
		renderPage(<Communities />);
		await screen.findByText("Study Gang");

		backgroundFail = true;
		const before = mocks.get.mock.calls.length;
		await fireRealtime(["posts"], "posts");
		await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(before));

		expect(screen.getByText("Study Gang")).toBeInTheDocument();
		expect(screen.queryByText("network blip")).not.toBeInTheDocument();
		expect(screen.queryByText("Failed to load communities")).not.toBeInTheDocument();
	});
});
