// ═══════════════════════════════════════════════════════════════════
// ApprovalAlert — immediate popup when a NEW high-risk task lands in
// the Approval Center. Baseline queue on first load stays silent; only
// genuinely new blocked tasks fire a popup. Approve/Reject call the real
// approve-task / reject-task commands.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApprovalAlert from "../pages/admin/agent-office/ApprovalAlert";

const postMock = vi.fn();

vi.mock("../lib/api", () => ({
	api: {
		post: (...args: unknown[]) => postMock(...args),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: vi.fn() }),
}));

const baselineApproval = {
	id: "task-old",
	title: "Baseline approval task",
	description: "Already waiting before the admin opened the page.",
	source: "security",
	priority: "high",
	risk_level: "high",
	verification_status: "awaiting_approval",
	input: { anon_id: "anon_old" },
	created_by: "security-monitor",
	created_at: "2026-08-09T08:00:00Z",
};

const freshApproval = {
	id: "task-new",
	title: "Newly blocked: mass hide suspicious posts",
	description:
		"2+ reports on one target — coordinated abuse. Approve to execute the hide + resolve.",
	source: "report",
	priority: "critical",
	risk_level: "high",
	verification_status: "awaiting_approval",
	input: { target_id: "post_x", decision: "hide", report_ids: [1, 2] },
	created_by: "discovery",
	created_at: "2026-08-09T09:00:00Z",
};

beforeEach(() => {
	postMock.mockReset();
});

describe("ApprovalAlert", () => {
	it("stays silent for the baseline queue (existing tasks are not popups)", async () => {
		postMock.mockResolvedValue({ ok: true, approvals: [baselineApproval] });
		render(<ApprovalAlert pollMs={2000} />);
		// Give the initial poll time to run — baseline is never surfaced
		await waitFor(() => expect(postMock).toHaveBeenCalled());
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("fires an immediate popup when a NEW blocked task appears, with the WHY", async () => {
		// First poll → baseline; second poll → fresh task appears
		postMock
			.mockResolvedValueOnce({ ok: true, approvals: [baselineApproval] })
			.mockResolvedValue({
				ok: true,
				approvals: [baselineApproval, freshApproval],
			});
		render(<ApprovalAlert pollMs={500} />);

		await waitFor(
			() => {
				expect(screen.getByRole("alert")).toBeInTheDocument();
			},
			{ timeout: 4000 },
		);

		expect(screen.getByText(/mass hide suspicious posts/i)).toBeInTheDocument();
		// The WHY is visible — description + input straight from the runtime
		expect(screen.getByText(/coordinated abuse/i)).toBeInTheDocument();
		expect(screen.getByText(/post_x/)).toBeInTheDocument();
	});

	it("approve calls the real approve-task command and dismisses", async () => {
		postMock
			.mockResolvedValueOnce({ ok: true, approvals: [baselineApproval] })
			.mockResolvedValueOnce({
				ok: true,
				approvals: [baselineApproval, freshApproval],
			})
			.mockResolvedValue({ ok: true });
		render(<ApprovalAlert pollMs={500} />);

		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), {
			timeout: 4000,
		});
		await userEvent.click(
			screen.getByRole("button", { name: /approve & execute/i }),
		);

		await waitFor(() => {
			expect(postMock).toHaveBeenCalledWith("/api/workforce", {
				action: "approve-task",
				id: "task-new",
				reason: undefined,
			});
		});
		await waitFor(() => {
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		});
	});

	it("reject calls the real reject-task command with a recorded reason", async () => {
		postMock
			.mockResolvedValueOnce({ ok: true, approvals: [baselineApproval] })
			.mockResolvedValueOnce({
				ok: true,
				approvals: [baselineApproval, freshApproval],
			})
			.mockResolvedValue({ ok: true });
		render(<ApprovalAlert pollMs={500} />);

		await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), {
			timeout: 4000,
		});
		await userEvent.click(screen.getByRole("button", { name: /reject/i }));

		await waitFor(() => {
			expect(postMock).toHaveBeenCalledWith("/api/workforce", {
				action: "reject-task",
				id: "task-new",
				reason: "Rejected from approval alert",
			});
		});
	});
});
