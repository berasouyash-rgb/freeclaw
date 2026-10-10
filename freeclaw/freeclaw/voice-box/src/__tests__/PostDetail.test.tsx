// ═══════════════════════════════════════════════════════════════════
// PostDetail — full page contract
// ═══════════════════════════════════════════════════════════════════
// Locks: follow toggling, reactions (optimistic + rollback), delete
// (confirm/cancel), read-aloud, copy-link, bookmark, report, follow
// state, loading skeleton, error states, and rich-post rendering.
// ═══════════════════════════════════════════════════════════════════

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostDetail, { pickCanonicalLinkedPoll } from "../pages/PostDetail";

const mocks = vi.hoisted(() => ({
	anonId: "anon-test",
	toast: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	navigate: vi.fn(),
	toggleBookmark: vi.fn(),	retireNotifsForLink: vi.fn(),
	addRecentlyViewed: vi.fn(),
	readAloud: vi.fn(),
	stopReading: vi.fn(),
	writeText: vi.fn(),
	rtSubs: [] as Array<{
		tables: string[];
		cb: (table: string, payload: unknown) => void;
		ms: number;
	}>,
	icon: () => null,
	hasAdminSession: vi.fn(() => false),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getFresh: mocks.get,
		post: mocks.post,
		put: mocks.put,
	},
	// Most tests exercise the public (non-admin) experience; admin-only
	// actions are covered by the admin describe block below, which flips
	// this flag. Without this export the mock proxy throws when PostDetail
	// renders its admin action bar.
	hasAdminSession: mocks.hasAdminSession,
	// Mirrors the real contract in src/lib/api.ts (which api.test.ts covers
	// directly): only a 404 means the resource is genuinely absent.
	isNotFound: (err: unknown) =>
		!!err && typeof err === "object" && "status" in err && err.status === 404,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: mocks.anonId,
		toast: mocks.toast,
		bookmarks: [],
		toggleBookmark: mocks.toggleBookmark,
		retireNotifsForLink: mocks.retireNotifsForLink,
		addRecentlyViewed: mocks.addRecentlyViewed,
	}),
}));

vi.mock("react-router", () => ({
	useParams: () => ({ id: "p1" }),
	useNavigate: () => mocks.navigate,
	Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (tables: string[], cb: (table: string, payload: unknown) => void, ms = 250) => {
		mocks.rtSubs.push({ tables, cb, ms });
	},
}));

vi.mock("../lib/utils", () => ({
	CAT_EMOJI: { Facilities: "🏫" },
	timeAgo: () => "2d ago",
	PRIORITY_META: { medium: { label: "Medium", color: "#888" } },
}));

vi.mock("../lib/speech", () => ({
	readAloud: mocks.readAloud,
	stopReading: mocks.stopReading,
	speechOutputSupported: true,
}));

vi.mock("../components/PostCard", () => ({
	REACTION_META: [
		{ kind: "like", label: "Like", icon: mocks.icon, color: "#f43f5e" },
	],
	getReactionMeta: () => [
		{ kind: "like", label: "Like", icon: mocks.icon, color: "#f43f5e" },
	],
	ReactionButton: ({
		label,
		count,
		active,
		disabled,
		onReact,
		kind,
	}: {
		label: string;
		count: number;
		active: boolean;
		disabled: boolean;
		onReact: (kind: string) => void;
		kind: string;
	}) => (
		<button
			aria-label={`${label} (${count})`}
			aria-pressed={active}
			disabled={disabled}
			onClick={() => onReact(kind)}
		>
			{label} {count}
		</button>
	),
}));

vi.mock("../components/Comments", () => ({ default: () => null }));
vi.mock("../components/StatusTimeline", () => ({
	default: () => <div>STATUS-TIMELINE</div>,
}));
vi.mock("../components/PollCard", () => ({
	default: ({ onVoted, myVote }: any) => (
		<div>
			LINKED-POLL
			<span>MYVOTE:{(myVote || []).join(",")}</span>
			<button onClick={onVoted}>Vote</button>
		</div>
	),
}));
vi.mock("../components/ui", () => ({
	ConfirmDialog: ({ open, onClose, onConfirm, confirmLabel }: any) =>
		open ? (
			<div role="dialog">
				<button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
	ReportDialog: ({ open, onClose, onSubmit }: any) =>
		open ? (
			<div>
				<button onClick={() => onSubmit("spam")}>Submit Report</button>
				<button onClick={onClose}>Close Report</button>
			</div>
		) : null,
}));

const POST: any = {
	id: "p1",
	type: "problem",
	title: "Broken projector in Room 204",
	description: "The projector is broken and needs fixing.",
	category: "Facilities",
	priority: "medium",
	tags: [],
	author_id: "anon_author",
	status: "reported",
	progress: 0,
	status_history: [],
	created_at: "2026-07-01T10:00:00.000Z",
	is_mine: false,
	locked: false,
	deleted: false,
	hidden: false,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.rtSubs.length = 0;
	mocks.hasAdminSession.mockReturnValue(false);
	mocks.writeText.mockResolvedValue(undefined);
	mocks.get.mockImplementation((url: string) => {
		if (url.includes("/api/posts"))
			return Promise.resolve({ post: POST, counts: {}, mine: [] });
		if (url.includes("/api/follows"))
			return Promise.resolve({ follows: [], count: 0 });
		return Promise.resolve({});
	});
});

describe("PostDetail — recently viewed", () => {
	it("records the opened post as recently viewed once it loads", async () => {
		render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
		await waitFor(() => {
			expect(mocks.addRecentlyViewed).toHaveBeenCalledWith("p1");
		});
		expect(mocks.addRecentlyViewed).toHaveBeenCalledTimes(1);
	});

	it("does not record a post that failed to load", async () => {
		const notFound = Object.assign(new Error("Post not found"), {
			status: 404,
		});
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts")) return Promise.reject(notFound);
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		render(<PostDetail />);
		await waitFor(() => {
			expect(screen.getByText(/no longer available|not found/i)).toBeTruthy();
		});
		expect(mocks.addRecentlyViewed).not.toHaveBeenCalled();
	});
});

describe("PostDetail — attach a poll", () => {
	it("lets the author create a poll under a post without one", async () => {
		mocks.post.mockResolvedValue({ id: "poll_9" });
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({
					post: { ...POST, author_id: "anon-test", linked_poll: null },
					counts: {},
					mine: [],
				});
			if (url.includes("/api/follows")) return Promise.resolve({ follows: [], count: 0 });
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
		fireEvent.click(screen.getByRole("button", { name: "Attach a poll" }));
		fireEvent.change(screen.getByLabelText("Attached poll question"), {
			target: { value: "Fix it this week?" },
		});
		fireEvent.change(screen.getByLabelText("Attached poll option 1"), {
			target: { value: "Yes" },
		});
		fireEvent.change(screen.getByLabelText("Attached poll option 2"), {
			target: { value: "No" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create poll" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/polls",
				expect.objectContaining({ title: "Fix it this week?", post_id: "p1" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith("Poll attached to this post", "ok");
	});

	it("hides the poll builder from other viewers", async () => {
		render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
		expect(screen.queryByRole("button", { name: "Attach a poll" })).toBeNull();
	});
});

describe("PostDetail — resolution evidence", () => {
	function solvedWith(evidence: unknown) {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/resolution-evidence")) return Promise.resolve(evidence);
			if (url.includes("/api/posts"))
				return Promise.resolve({
					post: { ...POST, status: "solved" },
					counts: {},
					mine: [],
				});
			if (url.includes("/api/follows")) return Promise.resolve({ follows: [], count: 0 });
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
	}

	it("shows supported verdict with before/after counts on solved posts", async () => {
		solvedWith({
			complaints_before: 38,
			complaints_after: 3,
			change_pct: 92,
			verdict: "supported",
			related_open: [],
			comments_after: 1,
		});
		render(<PostDetail />);
		expect(
			await screen.findByText("Resolution supported by current evidence"),
		).toBeInTheDocument();
		expect(screen.getByText(/38 similar complaints.*3 after/)).toBeInTheDocument();
	});

	it("warns with links on possible recurrence", async () => {
		solvedWith({
			complaints_before: 5,
			complaints_after: 6,
			change_pct: -20,
			verdict: "recurrence",
			related_open: [{ id: "p9", title: "Cooler broken again", status: "reported" }],
			comments_after: 0,
		});
		render(<PostDetail />);
		expect(await screen.findByText("Possible recurrence detected")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Cooler broken again" })).toHaveAttribute(
			"href",
			"/post/p9",
		);
	});

	it("stays silent when evidence is unavailable", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/resolution-evidence"))
				return Promise.reject(new Error("down"));
			if (url.includes("/api/posts"))
				return Promise.resolve({
					post: { ...POST, status: "solved" },
					counts: {},
					mine: [],
				});
			if (url.includes("/api/follows")) return Promise.resolve({ follows: [], count: 0 });
			if (url.includes("/api/polls")) return Promise.resolve([]);
			return Promise.resolve({});
		});
		render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
		expect(screen.queryByLabelText("Resolution evidence")).toBeNull();
	});

	it("shows no evidence card on unsolved posts", async () => {
		render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
		expect(screen.queryByLabelText("Resolution evidence")).toBeNull();
		expect(
			mocks.get.mock.calls.some(([u]) =>
				String(u).includes("/api/resolution-evidence"),
			),
		).toBe(false);
	});
});

describe("PostDetail — follow button", () => {
	it("renders a Follow button and follows the post on click", async () => {
		mocks.post.mockResolvedValue({
			success: true,
			following: true,
			follows: ["p1"],
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		const follow = screen.getByRole("button", { name: /follow/i });
		expect(follow).toBeInTheDocument();

		await user.click(follow);

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/follows",
				expect.objectContaining({
					user_id: "anon-test",
					post_id: "p1",
					following: true,
				}),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.stringContaining("Following"),
			"ok",
		);
	});

	it('starts as "Following" when the post is already in the stored follows list', async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: POST, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: ["p1"], count: 1 });
			return Promise.resolve({});
		});
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		expect(
			screen.getByRole("button", { name: /following/i }),
		).toBeInTheDocument();
	});

	it("unfollows when already following", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: POST, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: ["p1"], count: 1 });
			return Promise.resolve({});
		});
		mocks.post.mockResolvedValue({
			success: true,
			following: false,
			follows: [],
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /following/i }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/follows",
				expect.objectContaining({
					user_id: "anon-test",
					post_id: "p1",
					following: false,
				}),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.stringContaining("Unfollowed"),
			"ok",
		);
	});

	it("toasts an error when the follow request fails", async () => {
		mocks.post.mockRejectedValue(new Error("follow failed"));
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /follow/i }));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("follow failed"),
				"err",
			);
		});
	});
});

describe("PostDetail — loading and error states", () => {
	it("shows a shimmer skeleton while the post loads", async () => {
		let resolvePost!: (v: unknown) => void;
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return new Promise((res) => {
					resolvePost = res;
				});
			return Promise.resolve({});
		});
		render(<PostDetail />);

		expect(document.querySelector(".skeleton")).toBeTruthy();
		resolvePost({ post: POST, counts: {}, mine: [] });
		await screen.findByText("Broken projector in Room 204");
	});

	// REGRESSION: a failed request is NOT a missing post. These used to render
	// "Post not found", which told users their content had been deleted when
	// the API was merely busy (429/timeout) — the reported "Not found" storm.
	it("says the post failed to load, not that it is missing, on a network error", async () => {
		mocks.get.mockImplementation(() =>
			Promise.reject(new Error("network down")),
		);
		render(<PostDetail />);

		await screen.findByText("Couldn't load this post");
		expect(screen.queryByText("Post not found")).toBeNull();
		expect(
			screen.getByText(/network down/),
		).toBeInTheDocument();
		// The post still exists, so retrying must be offered.
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
	});

	it("falls back to a generic message when the error is not an Error", async () => {
		mocks.get.mockImplementation(() => Promise.reject("boom"));
		render(<PostDetail />);

		await screen.findByText("Couldn't load this post");
		expect(screen.getByText(/Failed to load post/)).toBeInTheDocument();
	});

	it('says "Post not found" only when the server reports 404', async () => {
		const notFound = Object.assign(new Error("Not found"), { status: 404 });
		mocks.get.mockImplementation(() => Promise.reject(notFound));
		render(<PostDetail />);

		await screen.findByText("Post not found");
		expect(screen.queryByText(/Couldn't load this post/)).toBeNull();
		// Nothing to retry — it really is gone.
		expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
	});
});

describe("PostDetail — reactions", () => {
	it("flips the count optimistically, then reconciles with the server", async () => {
		let resolveReact!: (v: unknown) => void;
		mocks.post.mockImplementation((url: string) => {
			if (url === "/api/reactions")
				return new Promise((res) => {
					resolveReact = res;
				});
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /like/i }));

		// optimistic: 0 → 1
		expect(
			screen.getByRole("button", { name: "Like (1)" }),
		).toBeInTheDocument();

		resolveReact({ counts: { like: 2 }, mine: ["like"], toggled: true });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Like (2)" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
		});
	});

	it("rolls the count back and toasts when the reaction fails", async () => {
		mocks.post.mockImplementation((url: string) => {
			if (url === "/api/reactions")
				return Promise.reject(new Error("react failed"));
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /like/i }));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("react failed", "err");
		});
		expect(
			screen.getByRole("button", { name: "Like (0)" }),
		).toBeInTheDocument();
	});

	it("toggles a reaction off when it was already active", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({
					post: POST,
					counts: { like: 1 },
					mine: ["like"],
				});
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		mocks.post.mockResolvedValue({ counts: {}, mine: [], toggled: false });
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /like/i }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Like (0)" })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		});
	});
});

describe("PostDetail — delete", () => {
	const MINE = { ...POST, is_mine: true };

	it("deletes the post after confirmation and navigates home", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: MINE, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		mocks.put.mockResolvedValue({ success: true });
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Delete"));

		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);

		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				author_id: "anon-test",
				deleted: true,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Post deleted", "ok");
		expect(mocks.navigate).toHaveBeenCalledWith("/");
	});

	it("does not delete when the confirmation is cancelled", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: MINE, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Delete"));
		await user.click(screen.getByRole("button", { name: "Cancel" }));

		expect(mocks.put).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("toasts an error when the delete request fails", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: MINE, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		mocks.put.mockRejectedValue(new Error("delete failed"));
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Delete"));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("delete failed", "err");
		});
	});
});

describe("PostDetail — read aloud", () => {
	it("starts reading and shows the stop control", async () => {
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: "Read aloud" }));

		expect(mocks.readAloud).toHaveBeenCalledWith(
			"Broken projector in Room 204. The projector is broken and needs fixing.",
			expect.any(Function),
		);
		expect(
			screen.getByRole("button", { name: "Stop reading" }),
		).toBeInTheDocument();
	});

	it("stops reading when the stop control is clicked", async () => {
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: "Read aloud" }));
		await user.click(screen.getByRole("button", { name: "Stop reading" }));

		expect(mocks.stopReading).toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Read aloud" }),
		).toBeInTheDocument();
	});

	it("resets the reading state when the TTS callback fires", async () => {
		mocks.readAloud.mockImplementation((_text: string, cb: () => void) => {
			cb();
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: "Read aloud" }));

		expect(
			screen.getByRole("button", { name: "Read aloud" }),
		).toBeInTheDocument();
	});

	it("stops speech synthesis on unmount", async () => {
		const { unmount } = render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
		unmount();
		expect(mocks.stopReading).toHaveBeenCalled();
	});
});

describe("PostDetail — copy link and bookmark", () => {
	it("copies the current URL to the clipboard and toasts", async () => {
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Copy link"));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Link copied to clipboard",
				"ok",
			);
		});
		expect(screen.getByTitle("Copied!")).toBeInTheDocument();
	});

	it("toasts when the clipboard write fails", async () => {
		const user = userEvent.setup();
		// user-event installs its own navigator.clipboard stub — make it fail for this case
		(navigator as any).clipboard.writeText = vi
			.fn()
			.mockRejectedValue(new Error("denied"));
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Copy link"));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Copy failed — check permissions",
				"err",
			);
		});
	});

	it("toggles the bookmark through context", async () => {
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: "Bookmark" }));

		expect(mocks.toggleBookmark).toHaveBeenCalledWith("p1");
	});
});

describe("PostDetail — report", () => {
	it("submits a report and toasts confirmation", async () => {
		mocks.post.mockResolvedValue({ success: true });
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Report"));
		await user.click(screen.getByRole("button", { name: "Submit Report" }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/reports", {
				target_id: "p1",
				target_type: "post",
				reason: "spam",
				author_id: "anon-test",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Report submitted — our moderators will review it",
			"ok",
		);
	});

	it("toasts an error when the report submission fails", async () => {
		mocks.post.mockRejectedValue(new Error("report failed"));
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Report"));
		await user.click(screen.getByRole("button", { name: "Submit Report" }));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("report failed", "err");
		});
	});
});

describe("PostDetail — rich post rendering", () => {
	const RICH: any = {
		...POST,
		locked: true,
		tags: ["projector", "av"],
		ai_summary: "A projector needs service.",
		admin_reply: "We have ordered a replacement bulb.",
		status_history: [{ status: "in_progress", note: "Parts ordered" }],
		linked_poll: "pl1",
	};

	it("renders locks, tags, AI summary, admin reply, timeline, and linked poll", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: RICH, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			// The post row only stores the poll id; the detail page fetches the real
			// poll row via /api/polls?post_id= so the card has options to vote on.
			if (url.includes("/api/polls"))
				return Promise.resolve([
					{
						id: "pl1",
						title: "Which fix first?",
						ptype: "multiple",
						options: [
							{ id: "a", text: "Repair" },
							{ id: "b", text: "Replace" },
						],
					},
				]);
			return Promise.resolve({});
		});
		render(<PostDetail />);

		expect(await screen.findByText("Locked")).toBeInTheDocument();
		expect(screen.getByText("#projector")).toBeInTheDocument();
		expect(screen.getByText("AI summary")).toBeInTheDocument();
		expect(screen.getByText("A projector needs service.")).toBeInTheDocument();
		expect(screen.getByText("Official admin reply")).toBeInTheDocument();
		expect(
			screen.getByText("We have ordered a replacement bulb."),
		).toBeInTheDocument();
		expect(screen.getByText("STATUS-TIMELINE")).toBeInTheDocument();
		expect(await screen.findByText("LINKED-POLL")).toBeInTheDocument();
	});

	it("passes the viewer\u2019s existing vote to the linked poll card", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: RICH, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			// The voter query returns raw poll_votes rows ({ poll_id, choices }).
			if (url.includes("/api/polls") && url.includes("voter="))
				return Promise.resolve([{ poll_id: "pl1", choices: [0] }]);
			if (url.includes("/api/polls"))
				return Promise.resolve([
					{
						id: "pl1",
						title: "Which fix first?",
						ptype: "yesno",
						options: ["Repair", "Replace"],
					},
				]);
			return Promise.resolve({});
		});
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		// The card must know the viewer already voted (feed "liked" state bug).
		expect(await screen.findByText("MYVOTE:0")).toBeInTheDocument();
	});

	it('shows the author as "You" and a delete button for owned posts', async () => {
		const MINE = { ...POST, is_mine: true };
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: MINE, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		expect(screen.getByText(/You/)).toBeInTheDocument();
		expect(screen.getByTitle("Delete")).toBeInTheDocument();
	});
});

describe("PostDetail — canonical linked poll", () => {
	it("shows the highest-vote duplicate when several polls link to one post", () => {
		const dup = {
			id: "pl-new",
			title: "Do you agree?",
			ptype: "yesno",
			options: ["Yes", "No"],
			total_votes: 2,
			created_at: "2026-09-20T00:00:00.000Z",
		} as any;
		const orig = {
			id: "pl-old",
			title: "Do you agree?",
			ptype: "yesno",
			options: ["Yes", "No"],
			total_votes: 28,
			created_at: "2026-09-10T00:00:00.000Z",
		} as any;
		expect(pickCanonicalLinkedPoll([dup, orig])?.id).toBe("pl-old");
		expect(pickCanonicalLinkedPoll([])).toBeNull();
	});
});

describe("PostDetail — edge paths", () => {
	it("navigates back from the loading state", async () => {
		let resolvePost!: (v: unknown) => void;
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return new Promise((res) => {
					resolvePost = res;
				});
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await user.click(screen.getByRole("button", { name: /back/i }));
		expect(mocks.navigate).toHaveBeenCalledWith(-1);
		resolvePost({ post: POST, counts: {}, mine: [] });
		await screen.findByText("Broken projector in Room 204");
	});

	it("navigates back from the error state", async () => {
		mocks.get.mockImplementation(() => Promise.reject(new Error("down")));
		const user = userEvent.setup();
		render(<PostDetail />);

		// A plain Error is a failed load, not a missing post.
		await screen.findByText("Couldn't load this post");
		await user.click(screen.getByRole("button", { name: /back/i }));
		expect(mocks.navigate).toHaveBeenCalledWith(-1);
	});

	it("navigates back from the loaded state", async () => {
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /back/i }));
		expect(mocks.navigate).toHaveBeenCalledWith(-1);
	});

	it("skips the follows fetch when anonId is missing", async () => {
		mocks.anonId = "";
		try {
			render(<PostDetail />);
			await screen.findByText("Broken projector in Room 204");
			expect(mocks.get).not.toHaveBeenCalledWith(
				expect.stringContaining("/api/follows"),
				expect.anything(),
			);
		} finally {
			mocks.anonId = "anon-test";
		}
	});

	it("ignores a second follow click while a follow request is in flight", async () => {
		let resolveFollow!: (v: unknown) => void;
		mocks.post.mockImplementation((url: string) => {
			if (url === "/api/follows")
				return new Promise((res) => {
					resolveFollow = res;
				});
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		const follow = screen.getByRole("button", { name: /follow/i });
		await user.click(follow);
		// While busy the button is disabled, so a second interaction is blocked
		// at the DOM level — exactly one request may fire.
		fireEvent.click(follow);
		expect(mocks.post).toHaveBeenCalledTimes(1);

		resolveFollow({ following: true, follows: ["p1"] });
		await screen.findByRole("button", { name: /following/i });
	});

	it("ignores a second reaction click while a reaction is in flight", async () => {
		let resolveReact!: (v: unknown) => void;
		mocks.post.mockImplementation((url: string) => {
			if (url === "/api/reactions")
				return new Promise((res) => {
					resolveReact = res;
				});
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		const like = screen.getByRole("button", { name: /like/i });
		await user.click(like);
		// Same DOM-level guard: the reaction buttons disable while busy.
		fireEvent.click(like);
		expect(mocks.post).toHaveBeenCalledTimes(1);

		resolveReact({ counts: { like: 1 }, mine: ["like"], toggled: true });
		await screen.findByRole("button", { name: "Like (1)" });
	});

	it('clears the "Copied!" indicator after 2 seconds', async () => {
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Copy link"));
		expect(screen.getByTitle("Copied!")).toBeInTheDocument();

		await waitFor(
			() => expect(screen.queryByTitle("Copied!")).not.toBeInTheDocument(),
			{ timeout: 3000 },
		);
	});

	it("refetches the post when a vote is cast on the linked poll", async () => {
		const RICH = { ...POST, linked_poll: "pl1" };
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: RICH, counts: {}, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			if (url.includes("/api/polls"))
				return Promise.resolve([
					{
						id: "pl1",
						title: "Which fix first?",
						ptype: "multiple",
						options: [
							{ id: "a", text: "Repair" },
							{ id: "b", text: "Replace" },
						],
					},
				]);
			return Promise.resolve({});
		});
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		expect(
			mocks.get.mock.calls.filter((c) => String(c[0]).includes("/api/posts")),
		).toHaveLength(1);

		await user.click(await screen.findByRole("button", { name: "Vote" }));
		await waitFor(() => {
			expect(
				mocks.get.mock.calls.filter((c) => String(c[0]).includes("/api/posts")),
			).toHaveLength(2);
		});
	});

	it("closes the report dialog without submitting", async () => {
		const user = userEvent.setup();
		render(<PostDetail />);

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByTitle("Report"));
		await user.click(screen.getByRole("button", { name: "Close Report" }));

		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/reports",
			expect.anything(),
		);
		expect(
			screen.queryByRole("button", { name: "Close Report" }),
		).not.toBeInTheDocument();
	});
});

describe("PostDetail — admin inline actions", () => {
	async function renderAsAdmin() {
		mocks.hasAdminSession.mockReturnValue(true);
		render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
	}

	it("hides the post and toasts on success", async () => {
		mocks.put.mockResolvedValueOnce({});
		await renderAsAdmin();

		fireEvent.click(screen.getByTitle("Hide post (flag)"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				hidden: true,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Post hidden", "ok");
	});

	it("shows an error and changes nothing when hide fails", async () => {
		mocks.put.mockRejectedValueOnce(new Error("hide boom"));
		await renderAsAdmin();

		fireEvent.click(screen.getByTitle("Hide post (flag)"));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("hide boom", "err");
		});
		// UI still offers Hide (not Hidden) — no optimistic lie applied.
		expect(screen.getByTitle("Hide post (flag)")).toBeInTheDocument();
	});

	it("shows an error when mark-solved fails", async () => {
		mocks.put.mockRejectedValueOnce(new Error("solve boom"));
		await renderAsAdmin();

		fireEvent.click(screen.getByTitle("Mark solved"));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("solve boom", "err");
		});
	});
});

describe("PostDetail — live reaction counts", () => {
	it("merges another user's like from the parent-post touch, with no clicks", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: POST, counts: { like: 1 }, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		render(<PostDetail />);
		await screen.findByText("Broken projector in Room 204");
		expect(screen.getByRole("button", { name: "Like (1)" })).toBeInTheDocument();

		// Another user likes: the server touches posts.updated_at, which
		// arrives as a posts UPDATE for this row.
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/posts"))
				return Promise.resolve({ post: POST, counts: { like: 2 }, mine: [] });
			if (url.includes("/api/follows"))
				return Promise.resolve({ follows: [], count: 0 });
			return Promise.resolve({});
		});
		const lane = mocks.rtSubs.find(
			(s) => s.tables.length === 1 && s.tables[0] === "posts",
		);
		expect(lane, "posts lane must be subscribed").toBeDefined();
		const { act } = await import("@testing-library/react");
		await act(async () => {
			lane!.cb("posts", { eventType: "UPDATE", new: { id: "p1" }, old: {} });
		});

		// No clicks, no update-notice tap — the debounced single-row
		// refresh merges the new total on its own.
		await waitFor(
			() => expect(screen.getByRole("button", { name: "Like (2)" })).toBeInTheDocument(),
			{ timeout: 15000 },
		);
	}, 20000);
});
