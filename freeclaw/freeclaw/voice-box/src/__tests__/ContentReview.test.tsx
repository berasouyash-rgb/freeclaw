// ═══════════════════════════════════════════════════════════════════
// ContentReview — AI pre-publish review + flagged content contract
// ═══════════════════════════════════════════════════════════════════
// Locks: load (posts filtered to AI-reviewed), stats bar, review queue
// (approve/reject/keep_private/ban), filters (search/status/category),
// expand/collapse posts, image reveal, comments load + delete, status
// transitions (approve/hide/in_progress/solved/archive), delete post,
// queue error banner, empty state, loading skeletons.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContentReview from "../pages/admin/ContentReview";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	getSlow: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	post: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getSlow: mocks.getSlow,
		put: mocks.put,
		del: mocks.del,
		post: mocks.post,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/utils", () => ({
	CAT_EMOJI: { Facilities: "🏢", Academics: "🎓" },
	CATEGORIES: ["Facilities", "Academics"],
}));

// PostPreviewCard renders the full snapshot in the queue
vi.mock("../components/PostPreviewCard", () => ({
	default: ({ title, blocked }: any) => (
		<div data-testid="post-preview-card" data-blocked={blocked ? "1" : "0"}>
			{title}
		</div>
	),
}));

const REVIEWED_POST = {
	id: "post-1",
	type: "problem",
	title: "Broken lift in block C",
	description: "Stuck for two hours",
	category: "Facilities",
	priority: "high",
	status: "pending_review",
	author_id: "anon_xyz",
	image_url: null,
	created_at: "2026-07-01T10:00:00.000Z",
	tags: ["safety"],
	reactions: {},
	moderation_flags: { risky: true },
};

const REPORTED_POST = {
	id: "post-2",
	type: "problem",
	title: "Spam giveaway",
	description: "Free money click here",
	category: "Facilities",
	priority: "low",
	status: "reported",
	author_id: "anon_spam",
	image_url: "https://example.com/img.png",
	created_at: "2026-07-02T10:00:00.000Z",
	ai_analysis: { risk: 0.9 },
};

const QUEUE_ITEM = {
	key: "review-1",
	title: "Blocked post title",
	description: "Blocked description",
	category: "Facilities",
	priority: "high",
	risk_score: 0.9,
	content_type: "post",
	author_id: "anon_blocked",
	created_at: "2026-07-01T10:00:00.000Z",
	checks: {
		privacy: { pass: false, issues: ["Phone number"] },
		safety: { pass: true, issues: [] },
		spam: { pass: true, issues: [] },
		quality: { pass: false, issues: ["Too short"] },
	},
};

const COMMENT = {
	id: "c1",
	post_id: "post-1",
	body: "Same thing happened to me",
	author_id: "anon_aaa",
	created_at: "2026-07-01T12:00:00.000Z",
	flagged: false,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSlow.mockResolvedValue([]);
	mocks.get.mockResolvedValue([]);
	mocks.put.mockResolvedValue({ ok: true });
	mocks.del.mockResolvedValue({ ok: true });
	mocks.post.mockResolvedValue({ ok: true });
	vi.spyOn(window, "confirm").mockReturnValue(true);
});

function seedData(opts: {
	posts?: unknown[];
	comments?: unknown[];
	queue?: unknown[];
} = {}) {
	mocks.getSlow.mockResolvedValue(opts.posts ?? [REVIEWED_POST, REPORTED_POST]);
	mocks.get.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/pre-review")) return { items: opts.queue ?? [] };
		if (path.startsWith("/api/comments?post_id=")) return opts.comments ?? [];
		return opts.comments ?? [];
	});
}

function renderPage() {
	return render(<ContentReview />);
}

describe("ContentReview — load + stats", () => {
	it("loads AI-reviewed posts and shows the stats bar", async () => {
		seedData();
		renderPage();
		expect(await screen.findByText("Broken lift in block C")).toBeInTheDocument();
		// Stats bar labels — 'Reported' also exists as a filter <option>, so
		// scope to the stats grid (3 cols on mobile / 6 on sm+)
		const statsBar = screen.getByText("AI-Reviewed").closest(".grid") as HTMLElement;
		expect(within(statsBar).getByText("AI-Reviewed")).toBeInTheDocument();
		expect(within(statsBar).getByText("2")).toBeInTheDocument(); // total
		expect(within(statsBar).getByText("Pending")).toBeInTheDocument();
		expect(within(statsBar).getByText("Reported")).toBeInTheDocument();
	});

	it("shows the empty state when no posts match", async () => {
		seedData({ posts: [] });
		renderPage();
		expect(
			await screen.findByText("No AI-reviewed posts match your filters"),
		).toBeInTheDocument();
	});

	it("shows skeleton loading while fetching", () => {
		mocks.getSlow.mockImplementation(() => new Promise(() => {}));
		renderPage();
		expect(document.querySelectorAll(".card.animate-pulse").length).toBeGreaterThan(0);
	});

	it("toasts an error when the main load fails", async () => {
		mocks.getSlow.mockRejectedValue(new Error("load boom"));
		renderPage();
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Failed to load content", "err");
		});
	});

	it("surfaces a queue error banner when /api/pre-review 403s", async () => {
		seedData({ posts: [], queue: [] });
		mocks.get.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/pre-review")) {
				throw new Error("403 Admin only");
			}
			return [];
		});
		renderPage();
		expect(
			await screen.findByText(/Admin session expired/),
		).toBeInTheDocument();
	});
});

describe("ContentReview — review queue actions", () => {
	it("renders the pre-publish queue with blocked snapshot and poll options", async () => {
		seedData({
			queue: [{ ...QUEUE_ITEM, options: ["A", "B"] }],
		});
		renderPage();
		expect(
			await screen.findByText(/Pre-Publish Review Queue \(1\)/),
		).toBeInTheDocument();
		expect(screen.getByText("Blocked post title")).toBeInTheDocument();
		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("B")).toBeInTheDocument();
	});

	it("approves a queue item via POST and removes it from the queue", async () => {
		const user = userEvent.setup();
		seedData({ queue: [QUEUE_ITEM] });
		renderPage();
		await screen.findByText("Blocked post title");

		await user.click(screen.getByRole("button", { name: /✓ Approve/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/pre-review", {
				key: "review-1",
				action: "approve",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Approved & published", "ok");
		expect(screen.queryByText("Blocked post title")).not.toBeInTheDocument();
	});

	it("rejects a queue item via POST", async () => {
		const user = userEvent.setup();
		seedData({ queue: [QUEUE_ITEM] });
		renderPage();
		await screen.findByText("Blocked post title");

		await user.click(screen.getByRole("button", { name: /✗ Reject/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/pre-review", {
				key: "review-1",
				action: "reject",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Rejected", "ok");
	});

	it("keeps a queue item private via POST", async () => {
		const user = userEvent.setup();
		seedData({ queue: [QUEUE_ITEM] });
		renderPage();
		await screen.findByText("Blocked post title");

		await user.click(screen.getByRole("button", { name: /🔒 Private/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/pre-review", {
				key: "review-1",
				action: "keep_private",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Kept private", "ok");
	});

	it("bans the queue item author after confirmation", async () => {
		const user = userEvent.setup();
		seedData({ queue: [QUEUE_ITEM] });
		renderPage();
		await screen.findByText("Blocked post title");

		await user.click(screen.getByRole("button", { name: /🚫 Ban/ }));
		// confirm() was mocked to true
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/pre-review", {
				key: "review-1",
				action: "ban",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("User banned", "ok");
	});

	it("toasts an error when an approve action fails", async () => {
		mocks.post.mockRejectedValue(new Error("approve boom"));
		const user = userEvent.setup();
		seedData({ queue: [QUEUE_ITEM] });
		renderPage();
		await screen.findByText("Blocked post title");

		await user.click(screen.getByRole("button", { name: /✓ Approve/ }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("approve boom", "err");
		});
	});

	it("does not ban when the confirm dialog is cancelled", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(false);
		const user = userEvent.setup();
		seedData({ queue: [QUEUE_ITEM] });
		renderPage();
		await screen.findByText("Blocked post title");

		await user.click(screen.getByRole("button", { name: /🚫 Ban/ }));
		expect(mocks.post).not.toHaveBeenCalledWith(
			expect.objectContaining({ action: "ban" }),
		);
	});
});

describe("ContentReview — filters", () => {
	it("filters by status", async () => {
		const user = userEvent.setup();
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");

		await user.selectOptions(
			screen.getAllByRole("combobox")[0] as HTMLSelectElement,
			"reported",
		);
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
		expect(screen.getByText("Spam giveaway")).toBeInTheDocument();
	});

	it("filters by category", async () => {
		const user = userEvent.setup();
		seedData({
			posts: [
				REVIEWED_POST,
				{ ...REPORTED_POST, category: "Academics" },
			],
		});
		renderPage();
		await screen.findByText("Broken lift in block C");

		// Widen status filter first — REPORTED_POST has status 'reported', which
		// the default 'pending_review' filter would hide
		await user.selectOptions(
			screen.getAllByRole("combobox")[0] as HTMLSelectElement,
			"all",
		);
		await user.selectOptions(
			screen.getAllByRole("combobox")[1] as HTMLSelectElement,
			"Academics",
		);
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
		expect(screen.getByText("Spam giveaway")).toBeInTheDocument();
	});

	it("filters by search across title, description and author", async () => {
		const user = userEvent.setup();
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");

		// Widen status filter — the target post has status 'reported'
		await user.selectOptions(
			screen.getAllByRole("combobox")[0] as HTMLSelectElement,
			"all",
		);
		await user.type(
			screen.getByPlaceholderText("Search title, description, or author ID…"),
			"anon_spam",
		);
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
		expect(screen.getByText("Spam giveaway")).toBeInTheDocument();
	});

	it("shows the empty state when filters exclude everything", async () => {
		const user = userEvent.setup();
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");

		await user.selectOptions(
			screen.getAllByRole("combobox")[0] as HTMLSelectElement,
			"solved",
		);
		expect(
			await screen.findByText("No AI-reviewed posts match your filters"),
		).toBeInTheDocument();
	});
});

describe("ContentReview — post expand/detail", () => {
	it("expands a post to reveal admin actions", async () => {
		const user = userEvent.setup();
		seedData({ comments: [COMMENT] });
		renderPage();
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByText("Broken lift in block C"));
		expect(await screen.findByText("Full Description")).toBeInTheDocument();
		expect(screen.getByText("Author ID")).toBeInTheDocument();
	});

	it("loads and lists post comments on expand", async () => {
		const user = userEvent.setup();
		seedData({ comments: [COMMENT] });
		renderPage();
		await screen.findByText("Broken lift in block C");

		await user.click(screen.getByText("Broken lift in block C"));
		expect(await screen.findByText("Same thing happened to me")).toBeInTheDocument();
	});

	it("approves a pending_review post (status → reported)", async () => {
		const user = userEvent.setup();
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: /Approve ✓/ }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				status: "reported",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Post status → reported",
			"ok",
		);
	});

	it("hides a pending_review post after confirm", async () => {
		const user = userEvent.setup();
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: /Hide ✗/ }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				status: "hidden",
			});
		});
	});

	it("marks a post in_progress / solved / archived", async () => {
		const user = userEvent.setup();
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");

		// Status changes must not hide the post — widen the filter to all
		await user.selectOptions(
			screen.getAllByRole("combobox")[0] as HTMLSelectElement,
			"all",
		);
		await user.click(screen.getByText("Broken lift in block C"));

		await user.click(screen.getByRole("button", { name: /In Progress/ }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post-1",
			status: "in_progress",
		});

		await user.click(screen.getByRole("button", { name: /Solved/ }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post-1",
			status: "solved",
		});

		await user.click(screen.getByRole("button", { name: /Archive/ }));
		expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
			id: "post-1",
			status: "archived",
		});
	});

	it("deletes a post after confirmation and removes it from the list", async () => {
		const user = userEvent.setup();
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));

		const row = screen.getByText("Broken lift in block C").closest(".card") as HTMLElement;
		const deleteBtn = within(row)
			.getAllByRole("button")
			.find((b) => b.textContent?.trim() === "Delete") as HTMLElement;
		await user.click(deleteBtn);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/posts", { id: "post-1" });
		});
		expect(mocks.toast).toHaveBeenCalledWith("Post deleted", "ok");
		expect(screen.queryByText("Broken lift in block C")).not.toBeInTheDocument();
	});

	it("deletes a comment from the expanded thread", async () => {
		const user = userEvent.setup();
		seedData({ comments: [COMMENT] });
		renderPage();
		await screen.findByText("Broken lift in block C");
		await user.click(screen.getByText("Broken lift in block C"));
		await screen.findByText("Same thing happened to me");

		await user.click(screen.getByRole("button", { name: "Delete comment" }));
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/comments", { id: "c1" });
		});
		expect(mocks.toast).toHaveBeenCalledWith("Comment deleted", "ok");
	});

	it("reveals and hides a post image", async () => {
		const user = userEvent.setup();
		seedData({ posts: [REPORTED_POST] });
		renderPage();
		// The image post has status 'reported' — widen the filter to see it
		await user.selectOptions(
			screen.getAllByRole("combobox")[0] as HTMLSelectElement,
			"all",
		);
		await screen.findByText("Spam giveaway");
		await user.click(screen.getByText("Spam giveaway"));

		await user.click(screen.getByRole("button", { name: /Show image/ }));
		expect(screen.getByAltText("Post screenshot")).toBeInTheDocument();

		// The hide button is an icon-only button inside the image container
		const imgWrap = screen
			.getByAltText("Post screenshot")
			.closest(".relative") as HTMLElement;
		fireEvent.click(
			within(imgWrap).getAllByRole("button")[0] as HTMLElement,
		);
		expect(screen.queryByAltText("Post screenshot")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Show image/ })).toBeInTheDocument();
	});

	it("links to the live post page", async () => {
		seedData();
		renderPage();
		await screen.findByText("Broken lift in block C");
		fireEvent.click(screen.getByText("Broken lift in block C"));
		const link = screen.getByRole("link", { name: /View Live/ });
		expect(link).toHaveAttribute("href", "/post/post-1");
		expect(link).toHaveAttribute("target", "_blank");
	});
});
