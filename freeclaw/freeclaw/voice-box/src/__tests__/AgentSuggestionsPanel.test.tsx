// ═══════════════════════════════════════════════════════════════════
// AgentSuggestionsPanel — condition-based grouping (spec §18)
// ═══════════════════════════════════════════════════════════════════
// Related work is combined into ONE card per detected condition instead
// of a repetitive per-item list ("11 flagged posts require moderation
// triage", not 11 identical cards). Each item inside a group stays
// individually approvable/dismissable — real per-item action wiring.

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentSuggestionsPanel from "../pages/admin/AgentSuggestionsPanel";

// ── Mocks ──────────────────────────────────────────────────────────
vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		getSlow: vi.fn(),
		del: vi.fn(),
	},
}));
vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: vi.fn() }),
}));
vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

import { api } from "../lib/api";

const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPut = api.put as ReturnType<typeof vi.fn>;

const now = new Date().toISOString();
const minuteAgo = new Date(Date.now() - 60_000).toISOString();

const esc = (id: number, title: string) => ({
	id,
	kind: "escalation",
	title,
	reasoning: `Escalation reasoning for ${title}`,
	content: { field: "priority", from: "medium", to: "critical" },
	critical: false,
	status: "pending",
	confidence: 0.8,
	created_at: minuteAgo,
});
const reply = (id: number, title: string) => ({
	id,
	kind: "reply",
	title,
	reasoning: `Reply reasoning for ${title}`,
	content: {
		field: "admin_reply",
		from: "",
		to: "Thank you for reporting this.",
	},
	critical: false,
	status: "pending",
	confidence: 0.75,
	created_at: now,
});

function seed(suggestions: unknown[]) {
	mockedGet.mockResolvedValue(suggestions);
	mockedPut.mockResolvedValue({ ok: true });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("AgentSuggestionsPanel (condition-based grouping)", () => {
	it("groups related suggestions into ONE card per condition with a count-aware title", async () => {
		seed([
			esc(1, 'Escalate "Water leak at gate 3" to critical priority'),
			esc(2, 'Escalate "Broken light near cafeteria" to critical priority'),
			esc(3, 'Escalate "Unsafe stairs by building B" to critical priority'),
			reply(4, 'Post an official reply on "Gate fixed"'),
			reply(5, 'Post an official reply on "WiFi restored"'),
		]);
		render(<AgentSuggestionsPanel />);

		// Combined titles, not 5 repetitive cards
		await waitFor(() => {
			expect(
				screen.getByText("3 flagged posts require moderation triage"),
			).toBeInTheDocument();
			expect(
				screen.getByText("2 solved posts await official replies"),
			).toBeInTheDocument();
		});
		// Count chips per group
		expect(screen.getAllByText("3 items").length).toBeGreaterThan(0);
		expect(screen.getAllByText("2 items").length).toBeGreaterThan(0);
		// Every item is still listed inside its group (individually actionable)
		expect(
			screen.getByText('Escalate "Water leak at gate 3" to critical priority'),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Escalate "Unsafe stairs by building B" to critical priority',
			),
		).toBeInTheDocument();
		expect(
			screen.getByText('Post an official reply on "WiFi restored"'),
		).toBeInTheDocument();
		// Header still shows total awaiting approval
		expect(screen.getByText("5 awaiting approval")).toBeInTheDocument();
	});

	it("keeps per-item approve/dismiss wiring — actions target the exact suggestion id", async () => {
		seed([
			esc(1, 'Escalate "Water leak at gate 3" to critical priority'),
			reply(2, 'Post an official reply on "Gate fixed"'),
		]);
		render(<AgentSuggestionsPanel />);

		await waitFor(() => {
			expect(
				screen.getByText("1 flagged post requires moderation triage"),
			).toBeInTheDocument();
		});

		// Scope to the escalation row and approve it
		const escRow = screen
			.getByText('Escalate "Water leak at gate 3" to critical priority')
			.closest("div") as HTMLElement;
		fireEvent.click(
			within(escRow).getByRole("button", { name: /Approve & apply/ }),
		);
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/agent", {
				id: 1,
				action: "approve",
				confirmed: true,
				edited_text: undefined,
			});
		});

		// Scope to the reply row and dismiss it
		const replyRow = screen
			.getByText('Post an official reply on "Gate fixed"')
			.closest("div") as HTMLElement;
		fireEvent.click(within(replyRow).getByRole("button", { name: /Dismiss/ }));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/agent", {
				id: 2,
				action: "dismiss",
			});
		});
	});

	it("dismiss-all archives every item in a group with one action", async () => {
		seed([
			esc(1, 'Escalate "Water leak at gate 3" to critical priority'),
			esc(2, 'Escalate "Broken light near cafeteria" to critical priority'),
		]);
		render(<AgentSuggestionsPanel />);

		await waitFor(() => {
			expect(
				screen.getByText("2 flagged posts require moderation triage"),
			).toBeInTheDocument();
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Dismiss all 2 suggestions in this group",
			}),
		);

		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/agent", {
				id: 1,
				action: "dismiss",
			});
			expect(mockedPut).toHaveBeenCalledWith("/api/agent", {
				id: 2,
				action: "dismiss",
			});
		});
	});

	it("collapses non-executable advisory kinds into ONE group with no Approve button", async () => {
		// LLM free-text kinds (no approve action in the backend) must never offer
		// an "Approve & apply" that would silently no-op — advisory only.
		const advisoryA = {
			id: 7,
			kind: "enforcement",
			title: "Verify Enforcement for Banned User",
			reasoning: "LLM advisory note.",
			content: { text: "advice" },
			critical: false,
			status: "pending",
			confidence: 0.7,
			created_at: now,
		};
		const advisoryB = {
			id: 8,
			kind: "policy",
			title: "Review and Update Banning Policy",
			reasoning: "LLM advisory note.",
			content: { text: "advice" },
			critical: false,
			status: "pending",
			confidence: 0.6,
			created_at: now,
		};
		seed([advisoryA, advisoryB]);
		render(<AgentSuggestionsPanel />);

		// One combined advisory group, count-aware, NOT two "Unknown" cards
		const group = await screen.findByText(/2 advisory notes/i);
		expect(group).toBeTruthy();
		expect(screen.queryByText(/unknown suggestions?/i)).toBeNull();

		// Both items render inside it…
		expect(screen.getByText("Verify Enforcement for Banned User")).toBeTruthy();
		expect(screen.getByText("Review and Update Banning Policy")).toBeTruthy();
		// …with the honest advisory note instead of a fake effect…
		expect(
			screen.getAllByText(/no automatic action will be executed/i).length,
		).toBeGreaterThanOrEqual(2);
		// …and NO Approve button anywhere for them.
		expect(screen.queryAllByText(/approve & apply|review…/i)).toHaveLength(0);
	});

	it("shows the empty state when nothing is pending", async () => {
		seed([]);
		render(<AgentSuggestionsPanel />);

		await waitFor(() => {
			expect(screen.getByText(/No pending suggestions/)).toBeInTheDocument();
		});
	});
});
