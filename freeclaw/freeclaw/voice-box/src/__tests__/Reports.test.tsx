// ═══════════════════════════════════════════════════════════════════
// Reports — combined classic Report queue + Content Review + Approvals
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • renders the three desk sections (reports / review /
//     approvals — resolved merged into Reports) from REAL API data
//   • lists open reports with moderate-author actions
//   • lists blocked approval tasks with WHY + Approve/Reject wiring
//   • lists pre-publish review items with Publish/Private/Reject/Ban
//   • escalate-report / escalate-post buttons call the real command
//   • "Unlock comment" renders only for actually-hidden comments (a lazy
//     /api/comments?all=1 index); deleted rows show "Removed", missing rows
//     show "Target not found", visible rows show no button at all
//   • unlock unhides via PUT /api/comments and re-read-verifies;
//     a still-hidden row reports honestly instead of claiming ok
//   • AI review tab lists flagged posts (search + filter present)
//   • empty states are truthful (no fabricated rows)
// ═══════════════════════════════════════════════════════════════════

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Reports from "../pages/admin/Reports";
import { resetQuoteCacheForTests } from "../components/admin/ReportTargetQuote";

// ── Mocks ──────────────────────────────────────────────────────────
const realtimeState = vi.hoisted(() => ({
	callback: null as null | ((table: string, payload: unknown) => void),
}));
const mockToast = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({
	api: {
		post: vi.fn(),
		get: vi.fn(),
		getSlow: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mockToast }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: vi.fn(
		(_tables: string[], callback: (table: string, payload: unknown) => void) => {
			realtimeState.callback = callback;
		},
	),
}));

// PostPreviewCard is heavy — stub it so pre-publish items render lightly
vi.mock("../components/PostPreviewCard", () => ({
	default: () => <div data-testid="post-preview-card" />,
}));

import { api } from "../lib/api";

const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedGetSlow = api.getSlow as ReturnType<typeof vi.fn>;
const mockedPut = api.put as ReturnType<typeof vi.fn>;

const APPROVAL = {
	id: "task-123",
	title: "Approval required: hide reported post",
	description:
		"2 users reported this post within the review window. High-risk moderation decision.",
	source: "report",
	priority: "critical",
	risk_level: "high",
	verification_status: "awaiting_approval",
	input: { target_id: "post_x", report_ids: ["1", "2"] },
	created_by: "discovery",
	created_at: new Date().toISOString(),
};

const REVIEW_ITEM = {
	key: "pre_publish_review:abc",
	title: "A held submission",
	description: "Blocked by AI pre-publish check",
	content_type: "post",
	risk_score: 82,
	author_id: "anon_1",
	created_at: new Date().toISOString(),
};

const REPORT = {
	id: 42,
	target_id: "post_x",
	target_type: "post",
	reason: "Harassment",
	status: null,
	author_id: "anon_reporter",
	target_author_id: "anon_abuser",
	created_at: new Date().toISOString(),
};

const FLAGGED_POST = {
	id: "post_y",
	title: "Flagged title",
	description: "A flagged description",
	type: "post",
	category: "general",
	priority: "medium",
	status: "pending_review",
	author_id: "anon_2",
	created_at: new Date().toISOString(),
};

const APPEAL = {
	id: "apl_1",
	surface: "post",
	author_id: "anon_9",
	title: "Canteen appeal",
	body: "The canteen food sucks",
	reason: "honest food complaint",
	flags: ["profanity"],
	status: "open",
	created_at: new Date().toISOString(),
};

function seedData(
	overrides: Partial<
		Record<
			| "approvals"
			| "reviewQueue"
			| "reports"
			| "posts"
			| "appeals"
			| "comments",
			unknown[]
		>
	> = {},
) {
	// URL-routing mock — robust to call order, no cross-test Once-queue leaks.
	mockedPost.mockResolvedValue({
		approvals: overrides.approvals ?? [APPROVAL],
	}); // /api/workforce pending-approvals
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/reports")) return overrides.reports ?? [REPORT];
		if (path.startsWith("/api/pre-review"))
			return { items: overrides.reviewQueue ?? [REVIEW_ITEM] };
		if (path.startsWith("/api/appeals"))
			return { items: overrides.appeals ?? [] };
		if (path.startsWith("/api/comments"))
			return overrides.comments ?? [];
		return [];
	});
	mockedGetSlow.mockResolvedValue(overrides.posts ?? [FLAGGED_POST]); // /api/posts?all=1
}

beforeEach(() => {
	vi.clearAllMocks();
	realtimeState.callback = null;
});

describe("Reports (combined queue + content review + approvals)", () => {
	it("renders live stats for all desk sections (pre-publish merged into Review)", async () => {
		seedData();
		render(<Reports />);

		await waitFor(() => {
			expect(screen.getByText(/Report Queue/i)).toBeInTheDocument();
			// "Reports" appears in both stat cards and tab buttons — use getAllByText
			expect(screen.getAllByText("Reports").length).toBeGreaterThanOrEqual(1);
			// Tab labels appear in both stat cards and tab buttons — use getAllByText
			expect(screen.getAllByText("Review").length).toBeGreaterThanOrEqual(1);
			expect(screen.getAllByText("Approvals").length).toBeGreaterThanOrEqual(1);
		});
	});

	it("marks realtime changes without refetching the report desk", async () => {
		seedData();
		render(<Reports />);
		await waitFor(() => expect(screen.getByText(/Harassment/)).toBeInTheDocument());
		const callsBeforeEvent = mockedGet.mock.calls.length;

		act(() => {
			realtimeState.callback?.("reports", { eventType: "INSERT" });
		});

		expect(await screen.findByText(/1 new update available/i)).toBeInTheDocument();
		expect(mockedGet.mock.calls).toHaveLength(callsBeforeEvent);
	});

	it("lists open reports with the report reason and escalation wiring", async () => {
		seedData();
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Escalate report 42" }));
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "escalate-report",
				id: "42",
			});
		});
	});

	it("resolves a report through the real endpoint", async () => {
		seedData();
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Resolve report 42" }));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/reports", {
				id: 42,
				status: "resolved",
			});
		});
	});

	it("unlocks a blocked comment through the unhide endpoint and verifies", async () => {
		const commentReport = {
			...REPORT,
			target_id: "c_1",
			target_type: "comment",
			reason: "Spammy comment",
		};
		// Index read (mount): the comment is hidden, so Unlock renders.
		// Verify read (after PUT): it is unhidden, so the unlock claims ok.
		seedData({
			reports: [commentReport],
			comments: [{ id: "c_1", hidden: true }],
		});
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Spammy comment/)).toBeInTheDocument(),
		);
		// Flush passive effects FIRST: the index fetch must dispatch while
		// the first mock (hidden) is still installed. Without this, the
		// text wait can win the race, the re-mock below lands first, and
		// the index resolves unhidden so no button ever renders.
		await act(async () => {});
		expect(
			screen.getByRole("button", { name: "Unlock comment c_1" }),
		).toBeInTheDocument();

		seedData({
			reports: [commentReport],
			comments: [{ id: "c_1", hidden: false }],
		});
		fireEvent.click(
			await screen.findByRole("button", { name: "Unlock comment c_1" }),
		);
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/comments", {
				id: "c_1",
				hidden: false,
			});
		});
		await waitFor(() => {
			expect(mockToast).toHaveBeenCalledWith(
				"Comment unlocked — visible to everyone again",
				"ok",
			);
		});
	});

	it("colors each target type distinctly and links to its valid page", async () => {
		seedData({
			reports: [
				{ ...REPORT, id: 51, target_id: "post_x", target_type: "post", reason: "Bad post" },
				{ ...REPORT, id: 52, target_id: "c_9", target_type: "comment", reason: "Bad comment" },
				{ ...REPORT, id: 53, target_id: "poll_9", target_type: "poll", reason: "Bad poll" },
			],
			comments: [{ id: "c_9", hidden: false, post_id: "post_parent_9" }],
		});
		render(<Reports />);
		await waitFor(() => expect(screen.getByText(/Bad post/)).toBeInTheDocument());
		// Post chip links straight to the complaint detail page.
		expect(screen.getByRole("link", { name: "Open reported post post_x" })).toHaveAttribute("href", "/post/post_x");
		// Comment chip links to the parent post, never to the bare comment id.
		// (findBy: the chip needs the comments fetch, which lands after the
		// reports fetch — a sync getBy races it under parallel-suite load.)
		expect(await screen.findByRole("link", { name: "Open parent post of comment c_9" })).toHaveAttribute("href", "/post/post_parent_9");
		// Poll chip links to polls; each type carries its own color.
		expect(screen.getByRole("link", { name: "Open polls" })).toHaveAttribute("href", "/polls");
		const postChip = screen.getByRole("link", { name: "Open reported post post_x" });
		const commentChip = screen.getByRole("link", { name: "Open parent post of comment c_9" });
		expect(postChip.getAttribute("style")).not.toBe(commentChip.getAttribute("style"));
	});

	it("shows Removed — never Unlock — for a deleted comment", async () => {
		seedData({
			reports: [
				{
					...REPORT,
					target_id: "c_del",
					target_type: "comment",
					reason: "Gone comment",
				},
			],
			comments: [{ id: "c_del", hidden: false, deleted: true }],
		});
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Gone comment/)).toBeInTheDocument(),
		);
		expect(await screen.findByText("Removed")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Unlock comment c_del" }),
		).toBeNull();
	});

	it("shows Target not found — never Unlock — for a missing comment", async () => {
		seedData({
			reports: [
				{
					...REPORT,
					target_id: "c_gone",
					target_type: "comment",
					reason: "Vanished comment",
				},
			],
			comments: [{ id: "c_other", hidden: true }],
		});
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Vanished comment/)).toBeInTheDocument(),
		);
		expect(await screen.findByText("Target not found")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Unlock comment c_gone" }),
		).toBeNull();
	});

	it("offers no Unlock for a comment that is already visible", async () => {
		// A second, still-hidden report proves the index actually ran —
		// otherwise the absence below would prove nothing.
		seedData({
			reports: [
				{
					...REPORT,
					target_id: "c_vis",
					target_type: "comment",
					reason: "Visible comment",
				},
				{
					...REPORT,
					id: 43,
					target_id: "c_hid",
					target_type: "comment",
					reason: "Hidden comment",
				},
			],
			comments: [
				{ id: "c_vis", hidden: false },
				{ id: "c_hid", hidden: true },
			],
		});
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Visible comment/)).toBeInTheDocument(),
		);
		// The hidden sibling's button proves the index loaded…
		expect(
			await screen.findByRole("button", { name: "Unlock comment c_hid" }),
		).toBeInTheDocument();
		// …while the visible comment gets no button.
		expect(
			screen.queryByRole("button", { name: "Unlock comment c_vis" }),
		).toBeNull();
	});

	it("reports honestly when the comment stays hidden after unlock", async () => {
		const commentReport = {
			...REPORT,
			target_id: "c_9",
			target_type: "comment",
			reason: "Abusive comment",
		};
		seedData({ reports: [commentReport] });
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/reports")) return [commentReport];
			if (path.startsWith("/api/pre-review")) return { items: [REVIEW_ITEM] };
			if (path.startsWith("/api/appeals")) return { items: [] };
			if (path.startsWith("/api/comments"))
				return [{ id: "c_9", hidden: true }];
			return [];
		});
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Abusive comment/)).toBeInTheDocument(),
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Unlock comment c_9" }),
		);
		await waitFor(() => {
			expect(mockToast).toHaveBeenCalledWith(
				"Unlock failed — the comment is still hidden",
				"err",
			);
		});
	});

	it("shows blocked approval tasks with WHY and Approve/Reject wiring", async () => {
		seedData();
		render(<Reports />);

		// Tab count updates once data lands — click by label, wait for content
		fireEvent.click(screen.getByRole("button", { name: /^Approvals/ }));
		await waitFor(() => {
			expect(screen.getByText(APPROVAL.title)).toBeInTheDocument();
		});
		expect(
			screen.getByText(/High-risk moderation decision/i),
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", { name: "Approve task task-123" }),
		);
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "approve-task",
				id: "task-123",
			});
		});
	});

	it("rejects a blocked task with a recorded reason", async () => {
		seedData();
		render(<Reports />);

		fireEvent.click(screen.getByRole("button", { name: /^Approvals/ }));
		await waitFor(() =>
			expect(screen.getByText(APPROVAL.title)).toBeInTheDocument(),
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Reject task task-123" }),
		);
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "reject-task",
				id: "task-123",
				reason: "Rejected in Reports & Review",
			});
		});
	});

	it("lists pre-publish review items with publish action (merged into Review)", async () => {
		seedData();
		render(<Reports />);

		// Pre-publish items live inside the Review (content review) tab
		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() =>
			expect(screen.getByText(REVIEW_ITEM.title)).toBeInTheDocument(),
		);
		expect(screen.getByText(/risk 82\/100/i)).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", { name: `Publish review ${REVIEW_ITEM.key}` }),
		);
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/pre-review", {
				key: REVIEW_ITEM.key,
				action: "approve",
			});
		});
	});

	it("says rejected (not rejectd) when a review item is rejected", async () => {
		mockToast.mockClear();
		seedData();
		render(<Reports />);

		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() =>
			expect(screen.getByText(REVIEW_ITEM.title)).toBeInTheDocument(),
		);
		fireEvent.click(
			screen.getByRole("button", { name: `Reject review ${REVIEW_ITEM.key}` }),
		);
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/pre-review", {
				key: REVIEW_ITEM.key,
				action: "reject",
			});
		});
		expect(mockToast).toHaveBeenCalledWith("Review rejected", "ok");
	});

	it("lists worker-reviewed posts with search and escalate-post wiring", async () => {
		seedData();
		render(<Reports />);

		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() =>
			expect(screen.getByText(FLAGGED_POST.title)).toBeInTheDocument(),
		);
		expect(
			screen.getByPlaceholderText(/Search title, description, or author ID/),
		).toBeInTheDocument();

		// Expand the post — the action bar (incl. Escalate) lives in the detail
		fireEvent.click(screen.getByText(FLAGGED_POST.title));
		const escBtn = await screen.findByRole("button", {
			name: "Escalate post post_y",
		});
		fireEvent.click(escBtn);
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "escalate-post",
				id: "post_y",
			});
		});
	});

	it("shows truthful empty states when nothing is waiting", async () => {
		seedData({ approvals: [], reviewQueue: [], reports: [], posts: [], appeals: [] });
		render(<Reports />);

		await waitFor(() => {
			expect(
				screen.getByText("No reports yet."),
			).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() => {
			expect(
				screen.getByText("No flagged or pending posts right now"),
			).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /^Approvals/ }));
		await waitFor(() => {
			expect(
				screen.getByText("No high-risk tasks awaiting approval"),
			).toBeInTheDocument();
		});
	});

	it("lists open appeals with the author's case and uphold/overturn wiring", async () => {
		seedData({ appeals: [APPEAL] });
		render(<Reports />);

		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() => {
			expect(screen.getByText("Canteen appeal")).toBeInTheDocument();
		});
		expect(screen.getByText(/honest food complaint/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Uphold block" }));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/appeals", {
				id: "apl_1",
				decision: "uphold",
				note: "",
			});
		});
	});

	it("overturns an appeal through the real endpoint", async () => {
		seedData({ appeals: [APPEAL] });
		render(<Reports />);

		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() => {
			expect(screen.getByText("Canteen appeal")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Overturn & publish/ }));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/appeals", {
				id: "apl_1",
				decision: "overturn",
				note: "",
			});
		});
	});

	// ── Workforce evidence (the AI's real work, not a status field) ──────
	it("renders what the workforce did per report, with its audit evidence", async () => {
		seedData({
			reports: [
				{
					...REPORT,
					status: "resolved",
					worker_action: {
						worker: "report-disposition",
						action: "report_dispositioned",
						disposition: "enforced",
						enforced: true,
						evidence: "public + violating (harassment)",
						target: "post:post_x",
						at: new Date().toISOString(),
					},
				},
			],
		});
		render(<Reports />);

		await waitFor(() => {
			expect(screen.getByText(/Auto-dispositioned/)).toBeInTheDocument();
			expect(screen.getByText(/Violation removed/)).toBeInTheDocument();
			expect(
				screen.getByText(/public \+ violating \(harassment\)/),
			).toBeInTheDocument();
			expect(
				screen.getByText(/removal re-read verified/),
			).toBeInTheDocument();
		});
	});

	it("shows the workforce ledger counts derived from joined evidence", async () => {
		seedData({
			reports: [
				{
					...REPORT,
					status: "resolved",
					worker_action: {
						worker: "report-disposition",
						action: "report_dispositioned",
						disposition: "already_handled",
						enforced: false,
						evidence: "target already non-public",
						target: "post:post_x",
						at: new Date().toISOString(),
					},
				},
			],
		});
		render(<Reports />);

		await waitFor(() => {
			expect(screen.getByText(/Worker ledger/)).toBeInTheDocument();
			expect(screen.getByText(/dispositioned by AI/)).toBeInTheDocument();
		});
	});

	it("does not invent AI evidence for a report no worker touched", async () => {
		seedData({ reports: [{ ...REPORT, status: "resolved" }] });
		render(<Reports />);

		await waitFor(() =>
			expect(screen.getByText(/Report Queue/i)).toBeInTheDocument(),
		);
		expect(screen.queryByText(/Auto-dispositioned/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Violation removed/)).not.toBeInTheDocument();
	});
});

describe("Reports — story cards (evolution 2026-10-06)", () => {
	beforeEach(() => {
		// The quote component memoizes per target across mounts: a stale
		// entry from an earlier case would make later cases assert on
		// another test's rows.
		resetQuoteCacheForTests();
	});

	it("states who reported what and whom in plain language on the row", async () => {
		seedData({
			reports: [{ ...REPORT, id: 70, reason: "Harassment here" }],
		});
		render(<Reports />);

		// One plain sentence, not truncated IDs in a mono footnote: the
		// reporter, the reason, and the reported author must all read
		// directly on the queue row.
		const story = await screen.findByTestId("report-story-70");
		expect(story.textContent).toContain("anon_reporter");
		expect(story.textContent).toContain("Harassment here");
		expect(story.textContent).toContain("anon_abuser");
	});

	it("opens the full detail on double-click as well as single click", async () => {
		seedData({
			reports: [{ ...REPORT, id: 71, reason: "Double-click me" }],
		});
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/posts?id=")) return { post: FLAGGED_POST };
			if (path.startsWith("/api/reports"))
				return [{ ...REPORT, id: 71, reason: "Double-click me" }];
			if (path.startsWith("/api/comments")) return [];
			return [];
		});
		render(<Reports />);

		const story = await screen.findByTestId("report-story-71");
		fireEvent.doubleClick(story);
		// Same destination as the single-click path: the full detail view.
		expect(await screen.findByText("RELATED CONTENT")).toBeInTheDocument();
		expect(screen.getByText("Flagged title")).toBeInTheDocument();
	});

	it("opens the detail on Enter for keyboard admins", async () => {
		seedData({
			reports: [{ ...REPORT, id: 72, reason: "Keyboard open" }],
		});
		render(<Reports />);

		const story = await screen.findByTestId("report-story-72");
		fireEvent.keyDown(story, { key: "Enter" });
		expect(await screen.findByText("RELATED CONTENT")).toBeInTheDocument();
	});

	it("quotes the reported post's content inline on the row", async () => {
		seedData({
			reports: [{ ...REPORT, id: 73, reason: "Quote me" }],
		});
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/posts?id=post_x"))
				return { post: { id: "post_x", title: "Quoted post title", description: "Quoted body words" } };
			if (path.startsWith("/api/reports"))
				return [{ ...REPORT, id: 73, reason: "Quote me" }];
			if (path.startsWith("/api/comments")) return [];
			return [];
		});
		render(<Reports />);

		const quote = await screen.findByTestId("report-quote-73");
		// The quote element mounts in its loading state; the mocked post
		// GET commits a tick later — wait for the loaded content instead of
		// racing it (CI load exposed this class of race).
		await waitFor(() => {
			expect(quote.textContent).toContain("Quoted post title");
			expect(quote.textContent).toContain("Quoted body words");
		});
	});

	it("quotes the reported comment's body inline on the row", async () => {
		seedData({
			reports: [{ ...REPORT, id: 74, target_id: "c9", target_type: "comment", reason: "Bad comment" }],
		});
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/comments"))
				return [{ id: "c9", body: "The offending comment text", author_id: "anon_abuser" }];
			if (path.startsWith("/api/reports"))
				return [{ ...REPORT, id: 74, target_id: "c9", target_type: "comment", reason: "Bad comment" }];
			return [];
		});
		render(<Reports />);

		const quote = await screen.findByTestId("report-quote-74");
		await waitFor(() => expect(quote.textContent).toContain("The offending comment text"));
	});

	it("says honestly when the reported content is gone", async () => {
		seedData({
			reports: [{ ...REPORT, id: 75, reason: "Gone content" }],
		});
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/posts?id=")) return { post: null };
			if (path.startsWith("/api/reports"))
				return [{ ...REPORT, id: 75, reason: "Gone content" }];
			if (path.startsWith("/api/comments")) return [];
			return [];
		});
		render(<Reports />);

		const quote = await screen.findByTestId("report-quote-75");
		// findByTestId only guarantees the quote exists — it exists first
		// with "Loading reported content…"; the {post: null} response flips
		// it to the honest gone-state asynchronously (CI run 37423726953
		// caught this assertion mid-load).
		await waitFor(() => expect(quote.textContent).toMatch(/no longer available/i));
	});

	it("states who flagged a review post and why, in plain language", async () => {
		seedData({
			reviewQueue: [],
			posts: [{ ...FLAGGED_POST, id: "post_r1", status: "pending_review" }],
		});
		render(<Reports />);
		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));

		const story = await screen.findByTestId("review-story-post_r1");
		expect(story.textContent).toContain("pre-publish gate");
		expect(story.textContent).toContain("pending_review");
		expect(story.textContent).toContain("anon_2");
	});

	it("opens a review post on double-click as well as single click", async () => {
		seedData({
			reviewQueue: [],
			posts: [{ ...FLAGGED_POST, id: "post_r2" }],
		});
		render(<Reports />);
		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));

		const card = await screen.findByTestId("review-story-post_r2");
		fireEvent.doubleClick(card);
		expect(await screen.findByText("Full Description")).toBeInTheDocument();
	});

	it("states who requested an approval and about what, in plain language", async () => {
		seedData({ approvals: [APPROVAL] });
		render(<Reports />);
		fireEvent.click(screen.getByRole("button", { name: /^Approvals/ }));

		const story = await screen.findByTestId("approval-story-task-123");
		expect(story.textContent).toContain("discovery");
		expect(story.textContent).toContain("post_x");
	});
});

describe("Reports — community targets, reporter context, related content", () => {
  it("links community reports to the community page (never a dead chip)", async () => {
    seedData({
      reports: [
        { ...REPORT, id: 60, target_id: "club::p1", target_type: "community_post", reason: "Spam commune" },
      ],
    });
    render(<Reports />);
    const chip = await screen.findByText("Community");
    const link = chip.closest("a");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/communities/club");
  });

  it("shows reporter reliability and the related post in the opened detail", async () => {    seedData({
      reports: [
        { ...REPORT, id: 61, reason: "Harassment here" },
        { ...REPORT, id: 62, status: "resolved", reason: "Old upheld report" },
      ],
    });
    // Related-post preview resolves through the real single-post fetch.
    mockedGet.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/posts?id=")) return { post: FLAGGED_POST };
      if (path.startsWith("/api/reports"))
        return [
          { ...REPORT, id: 61, reason: "Harassment here" },
          { ...REPORT, id: 62, status: "resolved", reason: "Old upheld report" },
        ];
      if (path.startsWith("/api/comments")) return [];
      return [];
    });
    render(<Reports />);
    fireEvent.click(await screen.findByText(/Harassment here/));
    // Reporter context derives from loaded rows: 2 filed, 1 upheld.
    expect(await screen.findByText(/2 reports filed/)).toBeInTheDocument();
    expect(screen.getByText(/1 upheld/)).toBeInTheDocument();
    // Related content previews the reported post.
    expect(screen.getByText("RELATED CONTENT")).toBeInTheDocument();
    expect(screen.getByText("Flagged title")).toBeInTheDocument();
  });
});

describe("Reports — root-issue bulk resolve runs bounded-parallel", () => {
  function seedSixfold() {
    seedData({
      reports: Array.from({ length: 6 }, (_, i) => ({
        ...REPORT,
        id: 200 + i,
        target_id: "post_x",
        target_type: "post",
        status: null,
        reason: "Harassment",
        created_at: new Date().toISOString(),
      })),
      reviewQueue: [],
      posts: [],
    });
  }

  it("resolves a 6-report root issue with parallel PUTs, never more than 8 in flight", async () => {
    seedSixfold();
    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockedPut.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight--;
      return {};
    });
    render(<Reports />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve root issue post_x (6 reports)" }),
    );
    // All lanes start together — sequential code would never exceed 1.
    await waitFor(() => expect(maxInFlight).toBeGreaterThan(1));
    expect(maxInFlight).toBeLessThanOrEqual(8);
    release();
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(6));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Resolved root issue — 6 report\(s\) verified/),
        "ok",
      ),
    );
  });

  it("reports honest partial counts when some resolves fail", async () => {
    seedSixfold();
    let calls = 0;
    mockedPut.mockImplementation(async () => {
      calls++;
      if (calls === 3) throw new Error("row locked");
      return {};
    });
    render(<Reports />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve root issue post_x (6 reports)" }),
    );
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(6));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Resolved 5, 1 failed/),
        "err",
      ),
    );
  });
});
