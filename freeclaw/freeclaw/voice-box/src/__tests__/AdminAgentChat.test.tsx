// ═══════════════════════════════════════════════════════════════════
// AI COWORKER (admin front door) — real backend contract test
// ═══════════════════════════════════════════════════════════════════
// Verifies the page talks ONLY to the real /api/agent-chat surface:
//   • send()        → POST {message, session_id?} → reply + action cards
//   • execute/reject→ POST {action, actions, session_id?} → result patch
//   • sessions/history → GET ?action=… for persisted conversations
//   • failure       → optimistic row dropped, draft restored, toast shown
// No fake activity: every assertion is driven by a mocked HTTP response.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentChat from "../pages/admin/AgentChat";

const mocks = vi.hoisted(() => ({
	postAgent: vi.fn(),
	get: vi.fn(),
	getSlow: vi.fn(),
	toast: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		postAgent: mocks.postAgent,
		get: mocks.get,
		getSlow: mocks.getSlow,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

/* Real ops-summary shape from /api/workforce?action=ops-summary */
const OPS_SUMMARY = {
	metrics: {
		working: 2,
		verifying: 1,
		total_employees: 100,
		verified_outcomes: 47,
		success_rate: 94.2,
	},
	ai_provider: { ok: true, status: "openai", note: "" },
	config: { paused: false },
};

const SEND = () => screen.getByRole("button", { name: /^send$/i });

beforeEach(() => {
	vi.resetAllMocks();
	sessionStorage.clear();
	mocks.getSlow.mockResolvedValue(OPS_SUMMARY);
	mocks.get.mockResolvedValue([]);
	mocks.postAgent.mockResolvedValue({});
});

describe("AI Coworker", () => {
	it("renders live workforce state from the real ops-summary payload", async () => {
		render(<AgentChat />);

		expect(await screen.findByText("94.2%")).toBeInTheDocument();
		expect(screen.getByText(/AI:\s*openai/i)).toBeInTheDocument();
		// quick-action prompts are present (real server-side tool prompts)
		expect(screen.getByRole("button", { name: "Health check" })).toBeInTheDocument();
	});

	it("sends a message and renders the server reply + executable action card", async () => {
		mocks.postAgent.mockResolvedValueOnce({
			reply: "Here are the 3 most recent posts.",
			actions: [
				{
					id: "act_1",
					tool: "get_posts",
					args: { limit: 3 },
					reason: "recent activity",
					destructive: false,
				},
			],
			session_id: "s_abc",
			provider: "openai/gpt-x",
		});

		render(<AgentChat />);

		fireEvent.change(screen.getByLabelText("Coworker message"), {
			target: { value: "what's new?" },
		});
		fireEvent.click(SEND());

		await waitFor(() =>
			expect(mocks.postAgent).toHaveBeenCalledWith(
				"/api/agent-chat",
				expect.objectContaining({ message: "what's new?" }),
			),
		);

		expect(
			await screen.findByText("Here are the 3 most recent posts."),
		).toBeInTheDocument();
		expect(screen.getByText("openai/gpt-x")).toBeInTheDocument();
		// "View posts" appears once in the tool rail and once on the new card
		expect(screen.getAllByText("View posts").length).toBeGreaterThanOrEqual(2);
		// the new session id is now shown in the session bar
		expect(screen.getByText("s_abc")).toBeInTheDocument();
	});

	it("executes an approved action and reflects the real result", async () => {
		mocks.postAgent
			.mockResolvedValueOnce({
				reply: "Proposed a warning.",
				actions: [
					{
						id: "act_9",
						tool: "warn_user",
						args: { user_id: "u1" },
						reason: "abusive content",
						destructive: false,
					},
				],
				session_id: "s_1",
				provider: "p",
			})
			.mockResolvedValueOnce({
				results: [{ id: "act_9", success: true, result: { warned: true } }],
			});

		render(<AgentChat />);
		fireEvent.change(screen.getByLabelText("Coworker message"), {
			target: { value: "warn the spammer" },
		});
		fireEvent.click(SEND());

		await screen.findByText("Proposed a warning.");
		fireEvent.click(screen.getByRole("button", { name: /execute/i }));

		await waitFor(() =>
			expect(mocks.postAgent).toHaveBeenLastCalledWith(
				"/api/agent-chat",
				expect.objectContaining({
					action: "execute",
					actions: [expect.objectContaining({ id: "act_9", tool: "warn_user" })],
				}),
			),
		);
		expect(
			await screen.findByText("Action completed successfully"),
		).toBeInTheDocument();
	});

	it("lists persisted sessions and loads their real history on open", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path.includes("action=sessions"))
				return [{ session_id: "s_hist", last_message: new Date().toISOString() }];
			if (path.includes("action=history"))
				return [
					{
						id: "r1",
						session_id: "s_hist",
						role: "assistant",
						content: "Restored answer",
						actions: [],
						created_at: new Date().toISOString(),
					},
				];
			return [];
		});

		render(<AgentChat />);

		const sessionBtn = await screen.findByRole("button", { name: /s_hist/i });
		fireEvent.click(sessionBtn);

		expect(await screen.findByText("Restored answer")).toBeInTheDocument();
		expect(mocks.get).toHaveBeenCalledWith(
			expect.stringContaining("action=history&session_id=s_hist"),
		);
	});

	it("restores the draft and drops the optimistic row when the backend fails", async () => {
		mocks.postAgent.mockRejectedValueOnce(new Error("network down"));

		render(<AgentChat />);
		const input = screen.getByLabelText("Coworker message") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "do the thing" } });
		fireEvent.click(SEND());

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("network down"),
				"err",
			),
		);
		// draft preserved for retry; no phantom user bubble left behind
		expect(input.value).toBe("do the thing");
		expect(screen.queryByText("do the thing")).not.toBeInTheDocument();
	});
});
