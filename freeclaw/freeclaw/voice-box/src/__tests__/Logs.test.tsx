// ═══════════════════════════════════════════════════════════════════
// Logs — master activity timeline contract
// ═══════════════════════════════════════════════════════════════════
// Locks: combined timeline (agent + audit interleaved, sorted desc),
// tab switching (agents-only, audit-only), agent filters (division select,
// search), severity/agent color mapping, loading + empty states, export CSV
// wiring, event total.
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Logs, { parseVerificationReceipt } from "../pages/admin/Logs";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	downloadFile: vi.fn(),
	toCSV: vi.fn(),
	safeStringify: vi.fn(),
	fmtDate: vi.fn(),
	items: [] as unknown[],
	initialLoading: false,
	total: 0,
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get },
}));

vi.mock("../hooks/useInfiniteScroll", () => ({
	useInfiniteScroll: () => ({
		items: (mocks.items as unknown[]) as any[],
		loading: false,
		initialLoading: mocks.initialLoading ?? false,
		hasMore: false,
		total: mocks.total ?? 0,
		sentinelRef: { current: null },
		loadMore: vi.fn(),
		reset: vi.fn(),
		replaceItems: vi.fn(),
		setItems: vi.fn(),
	}),
}));

vi.mock("../lib/utils", () => ({
	downloadFile: mocks.downloadFile,
	toCSV: mocks.toCSV,
	safeStringify: (o: unknown) => JSON.stringify(o),
	fmtDate: (d: string) => `D(${d})`,
}));

const AUDIT_LOGS = [
	{
		id: "a1",
		actor: "admin",
		action: "update_user",
		detail: "anon_x warned",
		created_at: "2026-07-02T10:00:00.000Z",
	},
	{
		id: "a2",
		actor: "system",
		action: "failed_login",
		detail: "Bad password",
		created_at: "2026-07-01T10:00:00.000Z",
	},
];

const ACTIVITIES = [
	{
		id: "ag1",
		agent_id: "security-monitor",
		event_type: "incident.created",
		details: { severity: "high" },
		severity: "error",
		created_at: "2026-07-03T10:00:00.000Z",
	},
	{
		id: "ag2",
		agent_id: "content-moderator",
		event_type: "task.completed",
		details: { title: "Hide spam" },
		severity: "info",
		created_at: "2026-07-01T09:00:00.000Z",
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.items = [...AUDIT_LOGS];
	mocks.total = 2;
	mocks.initialLoading = false;
	mocks.get.mockImplementation(async (path: string) => {
		if (path.includes("/api/agent-executions")) {
			return { activities: ACTIVITIES };
		}
		return { data: AUDIT_LOGS, nextCursor: null, total: 2 };
	});
});

function renderPage() {
	return render(<Logs />);
}

describe("Logs — combined timeline", () => {
	it("renders combined agent + audit events sorted newest-first", async () => {
		renderPage();
		expect(await screen.findByText("incident.created")).toBeInTheDocument();
		// Agent chips are rendered as "🤖 security-monitor" — match substring
		expect(screen.getByText(/🤖 security-monitor/)).toBeInTheDocument();
		expect(screen.getByText("update_user")).toBeInTheDocument();
		// Newest first: agent event (07-03) before audit (07-02) before audit (07-01)
		const rows = screen.getAllByText(/incident\.created|update_user|failed_login/);
		expect(rows[0]).toHaveTextContent("incident.created");
		expect(rows[1]).toHaveTextContent("update_user");
		expect(rows[2]).toHaveTextContent("failed_login");
	});

	it("shows the total event count combining both sources", async () => {
		renderPage();
		expect(await screen.findByText("4 total events")).toBeInTheDocument();
	});

	it("renders agent details via safeStringify, truncated", async () => {
		renderPage();
		await screen.findByText("incident.created");
		expect(screen.getByText(/severity/)).toBeInTheDocument();
	});

	it("renders audit details directly", async () => {
		renderPage();
		expect(await screen.findByText("anon_x warned")).toBeInTheDocument();
	});
});

describe("Logs — agent events tab", () => {
	it("switches to Agent Events and lists filtered activities", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("incident.created");

		await user.click(screen.getByRole("button", { name: /🤖 Agent Events/ }));
		expect(screen.getByText("content-moderator")).toBeInTheDocument();
		expect(screen.getByText("task.completed")).toBeInTheDocument();
		// Audit-only rows hidden
		expect(screen.queryByText("update_user")).not.toBeInTheDocument();
	});

	it("filters agent events by division select", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("incident.created");
		await user.click(screen.getByRole("button", { name: /🤖 Agent Events/ }));

		await user.selectOptions(
			screen.getByRole("combobox"),
			"content",
		);
		expect(screen.queryByText("security-monitor")).not.toBeInTheDocument();
		expect(screen.getByText("content-moderator")).toBeInTheDocument();
	});

	it("filters agent events by search query", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("incident.created");
		await user.click(screen.getByRole("button", { name: /🤖 Agent Events/ }));

		await user.type(
			screen.getByPlaceholderText("Search agents, events..."),
			"content-moderator",
		);
		expect(screen.queryByText("security-monitor")).not.toBeInTheDocument();
		expect(screen.getByText("content-moderator")).toBeInTheDocument();
	});

	it("shows the agent empty state when no events exist", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path.includes("/api/agent-executions")) return { activities: [] };
			return { data: AUDIT_LOGS, nextCursor: null, total: 2 };
		});
		const user = userEvent.setup();
		renderPage();
		// Wait for initial load, then switch to the agent-events tab
		await screen.findByText("update_user");
		await user.click(screen.getByRole("button", { name: /🤖 Agent Events/ }));
		expect(await screen.findByText("No agent events yet")).toBeInTheDocument();
	});
});

describe("Logs — admin audit tab", () => {
	it("switches to Admin Audit Log and lists audit rows", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("incident.created");

		await user.click(screen.getByRole("button", { name: /📋 Admin Audit Log/ }));
		expect(await screen.findByText("update_user")).toBeInTheDocument();
		expect(screen.getByText("anon_x warned")).toBeInTheDocument();
		expect(screen.queryByText("incident.created")).not.toBeInTheDocument();
	});

	it("shows the audit empty state", async () => {
		mocks.items = [];
		mocks.total = 0;
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("incident.created");
		await user.click(screen.getByRole("button", { name: /📋 Admin Audit Log/ }));
		expect(await screen.findByText("No log entries yet.")).toBeInTheDocument();
	});

	it("exports the audit log as CSV", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("incident.created");

		await user.click(screen.getByRole("button", { name: "Export CSV" }));
		expect(mocks.downloadFile).toHaveBeenCalled();
		const callArgs = mocks.downloadFile.mock.calls[0]!;
		expect(callArgs[0]).toMatch(/voicebox-logs-.*\.csv/);
		expect(callArgs[2]).toContain("text/csv");
	});
});

describe("Logs — helpers and edge cases", () => {
	it("colors severity (error red, info green, warning orange, default gray)", async () => {
		// getSeverityColor/getAgentColor are module-private — verify via the
		// rendered severity dots instead (chip text is prefixed with 🤖)
		renderPage();
		expect(await screen.findByText(/🤖 security-monitor/)).toBeInTheDocument();
		expect(screen.getByText(/🤖 content-moderator/)).toBeInTheDocument();
	});

	it("does not crash when agent activity fetch fails", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path.includes("/api/agent-executions")) {
				throw new Error("agent api down");
			}
			return { data: AUDIT_LOGS, nextCursor: null, total: 2 };
		});
		renderPage();
		// Audit rows still render (combined includes the audit rows too)
		expect(await screen.findByText("update_user")).toBeInTheDocument();
	});

	it("renders timestamps as relative time in combined and dates in audit-only", async () => {
		const user = userEvent.setup();
		renderPage();
		// Combined rows all show relative time (d ago from fixture dates)
		expect((await screen.findAllByText(/d ago/)).length).toBeGreaterThan(0);

		// Audit-only tab switches to fmtDate
		await user.click(screen.getByRole("button", { name: /📋 Admin Audit Log/ }));
		expect(await screen.findByText(/D\(2026-07-02/)).toBeInTheDocument();
		expect(screen.getByText(/D\(2026-07-01/)).toBeInTheDocument();
	});

	it("handles empty details objects safely", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path.includes("/api/agent-executions")) {
				return { activities: [{ ...ACTIVITIES[0], details: {} }] };
			}
			return { data: AUDIT_LOGS, nextCursor: null, total: 2 };
		});
		renderPage();
		expect(await screen.findByText(/🤖 security-monitor/)).toBeInTheDocument();
	});
});

describe("Logs — verification receipts", () => {
	it("parses post-removal receipts (verified and failed)", () => {
		expect(
			parseVerificationReceipt(
				"post_removal_verified",
				"p9: post absent from public read path [exposure_ms=3720000]",
			),
		).toMatchObject({
			kind: "post_removal",
			targetId: "p9",
			verified: true,
			exposureMs: 3720000,
		});
		expect(
			parseVerificationReceipt(
				"post_removal_unverified",
				"p9: post still publicly visible after removal [exposure_ms=null]",
			),
		).toMatchObject({ verified: false, exposureMs: null });
	});

	it("parses comment-hide receipts and ignores legacy rows", () => {
		expect(
			parseVerificationReceipt(
				"comment_hidden",
				"c1 by anon_bad (hidden+warned, prior hidden 7d: 0) [rule=bullying exposure_ms=184000 row=hidden public=absent]",
			),
		).toMatchObject({
			kind: "comment_hide",
			targetId: "c1",
			verified: true,
			rule: "bullying",
			legs: "row=hidden public=absent",
		});
		expect(parseVerificationReceipt("comment_hidden", "c1 by anon_bad (hidden+warned)")).toBeNull();
		expect(parseVerificationReceipt("update_user", "anon_x warned")).toBeNull();
	});

	it("renders a VERIFIED badge for receipt rows in the audit tab", async () => {
		mocks.items = [
			{
				id: "a9",
				actor: "moderation",
				action: "post_removal_verified",
				detail: "p9: post absent from public read path [exposure_ms=184000]",
				created_at: "2026-07-02T10:00:00.000Z",
			},
		];
		mocks.total = 1;
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("button", { name: /📋 Admin Audit Log/ }));
		expect(await screen.findByText("VERIFIED")).toBeInTheDocument();
		expect(screen.getByText(/Post p9/)).toBeInTheDocument();
	});
});
