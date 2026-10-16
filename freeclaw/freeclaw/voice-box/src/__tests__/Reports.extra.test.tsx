// Reports.extra — desk navigation, filters, moderation + review actions
// Supplements Reports.test.tsx: search/status filters, refresh control,
// moderate-author warn/suspend/ban (+ ban cancel), review keep-private/ban,
// resolve verification toast, escalate failure, status update, delete flows.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Reports from "../pages/admin/Reports";
import { resetQuoteCacheForTests } from "../components/admin/ReportTargetQuote";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	pushNotif: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	getSlow: vi.fn(),
	uploadImage: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		post: mocks.post,
		put: mocks.put,
		del: mocks.del,
		getSlow: mocks.getSlow,
		getFresh: mocks.get,
		getSlowFresh: mocks.getSlow,
		postLong: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		postSlow: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		uploadImage: mocks.uploadImage,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		pushNotif: mocks.pushNotif,
		accountStatus: null,
	}),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: vi.fn(),
}));

vi.mock("../hooks/useAdminStream", () => ({
	useAdminStream: vi.fn(),
}));

vi.mock("../components/PostPreviewCard", () => ({
	default: () => <div data-testid="post-preview-card" />,
}));

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

const SECOND_POST = {
	...FLAGGED_POST,
	id: "post_z",
	title: "Second flagged post",
	description: "Another description here",
	author_id: "anon_3",
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

const APPROVAL = {
	id: "task-123",
	title: "Approval required: hide reported post",
	description: "2 users reported this post.",
	source: "report",
	priority: "critical",
	risk_level: "high",
	verification_status: "awaiting_approval",
	input: { target_id: "post_x", report_ids: ["1", "2"] },
	created_by: "discovery",
	created_at: new Date().toISOString(),
};

interface Seed {
	reports?: Record<string, unknown>[];
	posts?: Record<string, unknown>[];
	reviewQueue?: Record<string, unknown>[];
	approvals?: Record<string, unknown>[];
	comments?: Record<string, unknown>[];
}

function seedData(s: Seed = {}) {
	const reports = s.reports ?? [REPORT];
	const posts = s.posts ?? [FLAGGED_POST];
	const reviewQueue = s.reviewQueue ?? [];
	const approvals = s.approvals ?? [];
	const comments = s.comments ?? [];
	mocks.post.mockImplementation(async (url: string) => {
		if (String(url).includes("/api/workforce")) {
			const first = (mocks.post as unknown as { __workforce?: unknown }).__workforce;
			if (first !== undefined) return first as Record<string, unknown>;
			return { approvals, ok: true };
		}
		if (String(url).includes("/api/pre-review")) return {};
		if (String(url).includes("/api/admin")) return {};
		return {};
	});
	mocks.get.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/reports")) return reports;
		if (path.startsWith("/api/pre-review")) return { items: reviewQueue };
		if (path.startsWith("/api/appeals")) return { items: [] };
		if (path.startsWith("/api/comments")) return comments;
		return [];
	});
	mocks.getSlow.mockResolvedValue(posts);
	mocks.put.mockResolvedValue({});
	mocks.del.mockResolvedValue({});
}

function renderPage() {
	return render(
		<MemoryRouter>
			<Reports />
		</MemoryRouter>,
	);
}

async function goReview() {
	fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
	await waitFor(() =>
		expect(screen.getByText(FLAGGED_POST.title)).toBeInTheDocument(),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	resetQuoteCacheForTests();
	localStorage.clear();
	const confirmMock = vi.fn(() => true);
	vi.stubGlobal("confirm", confirmMock);
	seedData();
});

describe("Reports.extra — tabs, filters, refresh", () => {
	it("should render the queue header and tab counts on mount", async () => {
		renderPage();
		await waitFor(() => {
			expect(screen.getByText(/Report Queue/i)).toBeInTheDocument();
		});
		expect(screen.getAllByText("Reports").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Review").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Approvals").length).toBeGreaterThanOrEqual(1);
	});

	it("should filter flagged posts by search text", async () => {
		seedData({ posts: [FLAGGED_POST, SECOND_POST] });
		renderPage();
		await goReview();
		expect(screen.getByText("Second flagged post")).toBeInTheDocument();
		fireEvent.change(
			screen.getByPlaceholderText(/Search title, description, or author ID/),
			{ target: { value: "flagged title" } },
		);
		await waitFor(() => {
			expect(screen.queryByText("Second flagged post")).not.toBeInTheDocument();
		});
		expect(screen.getByText(FLAGGED_POST.title)).toBeInTheDocument();
	});

	it("should hide pending posts when the status filter excludes them", async () => {
		renderPage();
		await goReview();
		const statusSelect = screen.getByDisplayValue("All statuses");
		fireEvent.change(statusSelect, { target: { value: "solved" } });
		await waitFor(() => {
			expect(
				screen.getByText("No flagged or pending posts right now"),
			).toBeInTheDocument();
		});
	});

	it("should reload queues when Refresh is clicked", async () => {
		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);
		const callsBefore = mocks.get.mock.calls.length;
		fireEvent.click(
			screen.getAllByRole("button", { name: /Refresh/ })[0],
		);
		await waitFor(() => {
			expect(mocks.get.mock.calls.length).toBeGreaterThan(callsBefore);
		});
	});
});

describe("Reports.extra — moderate author + resolve/escalate", () => {
	it("should warn the reported author with a strike", async () => {
		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByText("⚠ Warn + strike"));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/admin",
				expect.objectContaining({
					action: "update_user",
					anon_id: "anon_abuser",
				}),
			);
		});
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringMatching(/Warning issued/i),
				"ok",
			);
		});
	});

	it("should suspend the reported author for 7 days", async () => {
		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByText("⏸ Suspend 7d"));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/admin",
				expect.objectContaining({ suspend_days: 7 }),
			);
		});
	});

	it("should not ban when the confirmation is cancelled", async () => {
		(confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByText("🚫 Ban"));
		await waitFor(() => {
			expect(confirm).toHaveBeenCalled();
		});
		expect(mocks.post).not.toHaveBeenCalledWith(
			"/api/admin",
			expect.anything(),
		);
	});

	it("should toast the backend verification detail on resolve", async () => {
		mocks.put.mockResolvedValue({
			verification: { verified: true, detail: "target removed" },
		});
		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Resolve report 42" }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Resolved — target removed",
				"ok",
			);
		});
	});

	it("should surface the error when escalation is rejected", async () => {
		mocks.post.mockImplementation(async (url: string, body?: Record<string, unknown>) => {
			if (
				String(url).includes("/api/workforce") &&
				(body as Record<string, unknown> | undefined)?.action === "escalate-report"
			)
				return { ok: false, error: "needs approval" };
			if (String(url).includes("/api/workforce")) return { approvals: [APPROVAL] };
			return {};
		});
		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/Harassment/)).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Escalate report 42" }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("needs approval", "err");
		});
	});
});

describe("Reports.extra — pre-publish review actions", () => {
	it("should keep a review item private on Keep private", async () => {
		seedData({ reviewQueue: [REVIEW_ITEM] });
		renderPage();
		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() =>
			expect(screen.getByText(REVIEW_ITEM.title)).toBeInTheDocument(),
		);
		fireEvent.click(
			screen.getByRole("button", { name: `Keep private review ${REVIEW_ITEM.key}` }),
		);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/pre-review", {
				key: REVIEW_ITEM.key,
				action: "keep_private",
			});
		});
	});

	it("should ban the review author after confirmation", async () => {
		seedData({ reviewQueue: [REVIEW_ITEM] });
		renderPage();
		fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
		await waitFor(() =>
			expect(screen.getByText(REVIEW_ITEM.title)).toBeInTheDocument(),
		);
		fireEvent.click(
			screen.getByRole("button", { name: `Ban review ${REVIEW_ITEM.key}` }),
		);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/pre-review", {
				key: REVIEW_ITEM.key,
				action: "ban",
				confirm: true,
			});
		});
	});
});

describe("Reports.extra — review post detail actions", () => {
	it("should update a flagged post status to solved", async () => {
		renderPage();
		await goReview();
		fireEvent.click(screen.getByText(FLAGGED_POST.title));
		const solvedBtn = await screen.findByRole("button", { name: /Solved/ });
		fireEvent.click(solvedBtn);
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post_y",
				status: "solved",
			});
		});
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Post status → solved", "ok");
		});
	});

	it("should delete a flagged post after confirmation", async () => {
		renderPage();
		await goReview();
		fireEvent.click(screen.getByText(FLAGGED_POST.title));
		const deleteBtn = await screen.findByRole("button", { name: "Delete" });
		fireEvent.click(deleteBtn);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith(
				"/api/posts?id=post_y",
				expect.objectContaining({ id: "post_y" }),
			);
		});
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Post deleted", "ok");
		});
	});

	it("should delete a comment from the expanded post after confirmation", async () => {
		seedData({
			comments: [
				{
					id: "c_1",
					post_id: "post_y",
					body: "Rude comment body",
					author_id: "anon_4",
					created_at: new Date().toISOString(),
				},
			],
		});
		renderPage();
		await goReview();
		fireEvent.click(screen.getByText(FLAGGED_POST.title));
		const deleteCommentBtn = await screen.findByRole("button", {
			name: "Delete comment",
		});
		fireEvent.click(deleteCommentBtn);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith(
				"/api/comments?id=c_1",
				expect.objectContaining({ id: "c_1" }),
			);
		});
	});
});
