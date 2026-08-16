// ═══════════════════════════════════════════════════════════════════
// Admin Leaderboard — per-entry admin actions
// ═══════════════════════════════════════════════════════════════════
// Locks the admin quick-action contract:
//   1. Verify → PUT /api/posts { id, status: 'verified', status_note }
//   2. Report → POST /api/reports { target_id, target_type, reason, author_id }
//   3. Solve  → PUT /api/posts { id, status: 'solved', status_note }
// Verify and Report are currently MISSING from the UI (RED).
// ═══════════════════════════════════════════════════════════════════

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminLeaderboard from "../pages/admin/AdminLeaderboard";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	getFresh: vi.fn(),
	getSlow: vi.fn(),
	put: vi.fn(),
	post: vi.fn(),
	useRealtime: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getFresh: mocks.getFresh,
		getSlow: mocks.getSlow,
		put: mocks.put,
		post: mocks.post,
	},
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: mocks.useRealtime,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast, anonId: "anon-test" }),
}));

const LEADERBOARD = {
	problems: [
		{
			id: "p1",
			title: "Broken projector in Room 204",
			category: "Facilities",
			status: "reported",
			support: 12,
			score: 12,
			created_at: "2026-07-01T10:00:00.000Z",
		},
	],
	suggestions: [
		{
			id: "s1",
			title: "Add solar panels",
			category: "Green",
			status: "reported",
			support: 7,
			score: 7,
			created_at: "2026-07-01T11:00:00.000Z",
		},
	],
	polls: [
		{
			id: "po1",
			title: "Longer lunch break?",
			votes: 30,
			score: 30,
			created_at: "2026-07-01T12:00:00.000Z",
		},
	],
	leaderboard: [
		{
			id: "p1",
			title: "Broken projector in Room 204",
			type: "problem",
			category: "Facilities",
			status: "reported",
			support: 12,
			score: 12,
			created_at: "2026-07-01T10:00:00.000Z",
		},
		{
			id: "s1",
			title: "Add solar panels",
			type: "suggestion",
			category: "Green",
			status: "reported",
			support: 7,
			score: 7,
			created_at: "2026-07-01T11:00:00.000Z",
		},
		{
			id: "po1",
			title: "Longer lunch break?",
			type: "poll",
			votes: 30,
			score: 30,
			created_at: "2026-07-01T12:00:00.000Z",
		},
	],
	ai_activity: [
		{
			kind: "analysis",
			label: "Scanned new report",
			detail: "Flagged as duplicate",
			at: "2026-07-01T13:00:00.000Z",
		},
	],
};

function renderPage() {
	return render(
		<MemoryRouter>
			<AdminLeaderboard />
		</MemoryRouter>,
	);
}

/** Scopes a query to the leaderboard row that contains the given title. */
function rowOf(title: string) {
	const heading = screen.getByText(title);
	const card = heading.closest(".card") as HTMLElement;
	if (!card) throw new Error(`No .card row found for title: ${title}`);
	return within(card);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSlow.mockResolvedValue(LEADERBOARD);
	// The mount-time admin-config fetch must resolve (or the component's
	// effect throws on `.then` of undefined). Tests that exercise admin
	// actions override this for their own calls.
	mocks.post.mockResolvedValue({});
});

describe("AdminLeaderboard — verify action", () => {
	it('opens the status dialog and submits status "verified"', async () => {
		const user = userEvent.setup();
		renderPage();

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /verify/i }));

		await screen.findByRole("dialog");
		await user.click(screen.getByRole("button", { name: /update & notify/i }));

		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith(
				"/api/posts",
				expect.objectContaining({ id: "p1", status: "verified" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.stringContaining("notified"),
			"ok",
		);
	});
});

describe("AdminLeaderboard — report action", () => {
	it("posts a report with target id, type, reason and anonymous author", async () => {
		const user = userEvent.setup();
		mocks.post.mockResolvedValue({ ok: true });
		renderPage();

		await screen.findByText("Broken projector in Room 204");
		await user.click(
			rowOf("Broken projector in Room 204").getByRole("button", {
				name: /report/i,
			}),
		);

		await screen.findByRole("dialog");
		await user.click(screen.getByRole("button", { name: /submit report/i }));

		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/reports",
				expect.objectContaining({
					target_id: "p1",
					target_type: "post",
					reason: expect.any(String),
					author_id: "anon-test",
				}),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.stringContaining("Report"),
			"ok",
		);
	});
});

describe("AdminLeaderboard — solve action (existing contract)", () => {
	it('opens the status dialog and submits status "solved"', async () => {
		const user = userEvent.setup();
		renderPage();

		await screen.findByText("Broken projector in Room 204");
		await user.click(screen.getByRole("button", { name: /solve/i }));

		await screen.findByRole("dialog");
		await user.click(screen.getByRole("button", { name: /update & notify/i }));

		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith(
				"/api/posts",
				expect.objectContaining({ id: "p1", status: "solved" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			expect.stringContaining("solved"),
			"ok",
		);
	});
});

describe("AdminLeaderboard — tabs and lists", () => {
	it("switches to the problems tab and filters the list", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /problems/i }));
		expect(screen.getByText("Broken projector in Room 204")).toBeTruthy();
		// Suggestion must not be in the filtered problems list
		expect(screen.queryByText("Add solar panels")).toBeNull();
	});

	it("switches to the suggestions tab and shows suggestion items", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /suggestions/i }));
		expect(screen.getByText("Add solar panels")).toBeTruthy();
	});

	it("switches to the polls tab and shows poll items", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /polls/i }));
		expect(screen.getByText("Longer lunch break?")).toBeTruthy();
		expect(screen.getByText("votes", { exact: false })).toBeTruthy();
	});

	it("shows the empty state on a tab with no items", async () => {
		const user = userEvent.setup();
		mocks.getSlow.mockResolvedValue({ ...LEADERBOARD, suggestions: [] });
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /suggestions/i }));
		await screen.findByText("Nothing ranked yet");
	});

	it("ranks items without a medal past the top three", async () => {
		const many = {
			...LEADERBOARD,
			leaderboard: [
				{ id: "a", title: "Item A", type: "problem", score: 10 },
				{ id: "b", title: "Item B", type: "problem", score: 9 },
				{ id: "c", title: "Item C", type: "problem", score: 8 },
				{ id: "d", title: "Item D", type: "problem", score: 7 },
			],
		};
		mocks.getSlow.mockResolvedValue(many);
		renderPage();
		await screen.findByText("Item D");
		expect(screen.getByText("4")).toBeTruthy();
	});
});

describe("AdminLeaderboard — AI activity tab", () => {
	it("renders AI activity entries with kind badge and time", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /ai activity/i }));
		expect(screen.getByText("Scanned new report")).toBeTruthy();
		expect(screen.getByText("Flagged as duplicate")).toBeTruthy();
	});

	it("shows the empty AI state when no activity exists", async () => {
		const user = userEvent.setup();
		mocks.getSlow.mockResolvedValue({ ...LEADERBOARD, ai_activity: [] });
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /ai activity/i }));
		await screen.findByText("No AI activity yet");
	});
});

describe("AdminLeaderboard — refresh, errors and realtime", () => {
	it("reloads data when the Refresh button is clicked", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		mocks.getSlow.mockClear();
		await user.click(screen.getByRole("button", { name: /refresh/i }));
		await waitFor(() => expect(mocks.getSlow).toHaveBeenCalledTimes(1));
	});

	it("shows an error card and retries when loading fails", async () => {
		const user = userEvent.setup();
		mocks.getSlow.mockRejectedValueOnce(new Error("Server down"));
		renderPage();

		await screen.findByText("Server down");
		expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();

		mocks.getSlow.mockResolvedValueOnce(LEADERBOARD);
		await user.click(screen.getByRole("button", { name: /retry/i }));
		await screen.findByText("Broken projector in Room 204");
	});

	it("refreshes via getFresh when a realtime event fires", async () => {
		let cb: () => void = () => {};
		mocks.useRealtime.mockImplementation(
			(_events: string[], handler: () => void) => {
				cb = handler;
			},
		);
		mocks.getFresh.mockResolvedValue(LEADERBOARD);
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await act(async () => {
			cb();
		});
		await waitFor(() =>
			expect(mocks.getFresh).toHaveBeenCalledWith("/api/leaderboard"),
		);
	});

	it("toasts an error when the status update fails", async () => {
		const user = userEvent.setup();
		mocks.put.mockRejectedValue(new Error("Update rejected"));
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /verify/i }));
		await screen.findByRole("dialog");
		await user.click(screen.getByRole("button", { name: /update & notify/i }));

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith("Update rejected", "err"),
		);
	});

	it("toasts an error when the report submission fails", async () => {
		const user = userEvent.setup();
		mocks.post.mockRejectedValue(new Error("Report rejected"));
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(
			rowOf("Broken projector in Room 204").getByRole("button", {
				name: /report/i,
			}),
		);
		await screen.findByRole("dialog");
		await user.click(screen.getByRole("button", { name: /submit report/i }));

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith("Report rejected", "err"),
		);
	});
});

describe("AdminLeaderboard — in-progress start action", () => {
	it('opens the status dialog and submits status "in_progress"', async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector in Room 204");

		await user.click(screen.getByRole("button", { name: /start/i }));
		await screen.findByRole("dialog");
		await user.click(screen.getByRole("button", { name: /update & notify/i }));

		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith(
				"/api/posts",
				expect.objectContaining({ id: "p1", status: "in_progress" }),
			);
		});
	});
});
