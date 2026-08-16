// ═══════════════════════════════════════════════════════════════════
// Reports — combined classic Report queue + Content Review + Approvals
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • renders the five live stat cards (open / AI review / pre-publish /
//     approvals / resolved) from REAL API data
//   • lists open reports with moderate-author actions
//   • lists blocked approval tasks with WHY + Approve/Reject wiring
//   • lists pre-publish review items with Publish/Private/Reject/Ban
//   • escalate-report / escalate-post buttons call the real command
//   • AI review tab lists flagged posts (search + filter present)
//   • empty states are truthful (no fabricated rows)
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Reports from "../pages/admin/Reports";

// ── Mocks ──────────────────────────────────────────────────────────
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
	useApp: () => ({ toast: vi.fn() }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
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

function seedData(
	overrides: Partial<
		Record<"approvals" | "reviewQueue" | "reports" | "posts", unknown[]>
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
		if (path.startsWith("/api/comments")) return [];
		return [];
	});
	mockedGetSlow.mockResolvedValue(overrides.posts ?? [FLAGGED_POST]); // /api/posts?all=1
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("Reports (combined queue + content review + approvals)", () => {
	it("renders live stats for all desk sections (pre-publish merged into AI Review)", async () => {
		seedData();
		render(<Reports />);

		await waitFor(() => {
			expect(screen.getByText("Report queue")).toBeInTheDocument();
			expect(screen.getByText("Open")).toBeInTheDocument();
			expect(screen.getByText("AI Review")).toBeInTheDocument();
			expect(screen.getByText("Approvals")).toBeInTheDocument();
			expect(screen.getByText("Resolved")).toBeInTheDocument();
		});
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

	it("lists pre-publish review items with publish action (merged into AI Review)", async () => {
		seedData();
		render(<Reports />);

		// Pre-publish items live inside the AI Review (content review) tab
		fireEvent.click(screen.getByRole("button", { name: /^AI Review/ }));
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

	it("lists AI-reviewed posts with search and escalate-post wiring", async () => {
		seedData();
		render(<Reports />);

		fireEvent.click(screen.getByRole("button", { name: /^AI Review/ }));
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
		seedData({ approvals: [], reviewQueue: [], reports: [], posts: [] });
		render(<Reports />);

		await waitFor(() => {
			expect(
				screen.getByText("Queue is clear — no open reports."),
			).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /^AI Review/ }));
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
});
