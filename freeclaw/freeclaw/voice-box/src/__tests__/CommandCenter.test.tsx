// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Command Center â€” error surfacing (no silent failures)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// All five async failure paths must surface a visible error via toast
// (and keep the user's optimistic message on send failure):
//   1. agent-office load
//   2. conversation-messages load
//   3. admin-tabs save
//   4. conversation-create (open chat)
//   5. conversation-send
// Currently all five only log to console (RED).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import CommandCenter from "../pages/admin/CommandCenter";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: mocks.post },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

const AGENT = {
	agent_id: "agent-1",
	role: "Research Agent",
	status: "idle",
	total_executions: 5,
	completed: 4,
	failed: 1,
	last_activity: "2026-07-01T10:00:00.000Z",
};

const EXISTING_TAB = {
	id: "t1",
	conversation_id: "c1",
	conversations: { agent_id: "agent-1", title: "Existing chat" },
};

/** Happy-path API: agents + optional tabs/messages; conversation-create succeeds. */
function mockApiOk(tabs: unknown[] = [], messages: unknown[] = []) {
	mocks.get.mockImplementation((url: string) => {
		if (url.includes("agent-office"))
			return Promise.resolve({ agents: [AGENT] });
		if (url.includes("admin-tabs")) return Promise.resolve({ tabs });
		if (url.includes("conversation-messages"))
			return Promise.resolve({ messages });
		return Promise.resolve({});
	});
	mocks.post.mockImplementation((url: string, body: { action?: string }) => {
		if (body?.action === "conversation-create") {
			return Promise.resolve({
				conversation: {
					id: "c1",
					title: "Chat with Research Agent",
					agent_id: "agent-1",
					status: "open",
					last_message_at: "2026-07-01T10:00:00.000Z",
					created_at: "2026-07-01T10:00:00.000Z",
				},
			});
		}
		return Promise.resolve({});
	});
}

beforeAll(() => {
	// jsdom has no scrollIntoView; the chat view calls it after messages render.
	Element.prototype.scrollIntoView =
		Element.prototype.scrollIntoView || (() => {});
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe("CommandCenter â€” agent office load failure", () => {
	it("toasts when the agent office fails to load", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("agent-office"))
				return Promise.reject(new Error("agent office down"));
			if (url.includes("admin-tabs")) return Promise.resolve({ tabs: [] });
			return Promise.resolve({});
		});
		mocks.post.mockResolvedValue({});

		render(<CommandCenter />);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("agent office down"),
				"err",
			);
		});
	});
});

describe("CommandCenter â€” conversation messages load failure", () => {
	it("toasts when conversation messages fail to load", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("agent-office"))
				return Promise.resolve({ agents: [AGENT] });
			if (url.includes("admin-tabs"))
				return Promise.resolve({ tabs: [EXISTING_TAB] });
			if (url.includes("conversation-messages"))
				return Promise.reject(new Error("messages failed"));
			return Promise.resolve({});
		});
		mocks.post.mockResolvedValue({});

		render(<CommandCenter />);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("messages failed"),
				"err",
			);
		});
	});
});

describe("CommandCenter â€” tab save failure", () => {
	it("toasts when saving tabs fails", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("agent-office"))
				return Promise.resolve({ agents: [AGENT] });
			if (url.includes("admin-tabs"))
				return Promise.resolve({ tabs: [EXISTING_TAB] });
			if (url.includes("conversation-messages"))
				return Promise.resolve({ messages: [] });
			return Promise.resolve({});
		});
		mocks.post.mockRejectedValue(new Error("tab save failed"));

		render(<CommandCenter />);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("tab save failed"),
				"err",
			);
		});
	});
});

describe("CommandCenter â€” conversation create failure", () => {
	it("toasts when creating a conversation fails", async () => {
		mockApiOk();
		mocks.post.mockImplementation((url: string, body: { action?: string }) => {
			if (body?.action === "conversation-create")
				return Promise.reject(new Error("create failed"));
			return Promise.resolve({});
		});

		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText("Research Agent");
		await user.click(screen.getByRole("button", { name: /^Chat$/ }));

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("create failed"),
				"err",
			);
		});
	});
});

describe("CommandCenter â€” send message failure", () => {
	it("toasts AND keeps the optimistic message when sending fails", async () => {
		mockApiOk();
		mocks.post.mockImplementation((url: string, body: { action?: string }) => {
			if (body?.action === "conversation-create") {
				return Promise.resolve({
					conversation: {
						id: "c1",
						title: "Chat with Research Agent",
						agent_id: "agent-1",
						status: "open",
						last_message_at: "2026-07-01T10:00:00.000Z",
						created_at: "2026-07-01T10:00:00.000Z",
					},
				});
			}
			if (body?.action === "conversation-send")
				return Promise.reject(new Error("send failed"));
			return Promise.resolve({});
		});

		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText("Research Agent");
		await user.click(screen.getByRole("button", { name: /^Chat$/ }));

		// Chat view is now open
		await screen.findByText(/send a message to start/i);

		await user.type(
			screen.getByPlaceholderText(/type a message/i),
			"hello agent{Enter}",
		);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("send failed"),
				"err",
			);
		});
		// The user's message must NOT be silently removed on failure
		expect(screen.getByText("hello agent")).toBeInTheDocument();
	});
});

describe("CommandCenter â€” message bubble variants", () => {
	const NO_AGENT_TAB = { id: "t1", conversation_id: "c1", conversations: {} };

	it("renders system, tool, and assistant messages and toggles expansions", async () => {
		const messages = [
			{
				id: "m1",
				conversation_id: "c1",
				role: "system",
				content: "Session started",
				created_at: "2026-07-01T10:00:00.000Z",
			},
			{
				id: "m2",
				conversation_id: "c1",
				role: "tool",
				content: "tool result",
				created_at: "2026-07-01T10:00:00.000Z",
			},
			{
				id: "m3",
				conversation_id: "c1",
				role: "assistant",
				agent_id: "agent-1",
				content: "Hello there",
				tool_calls: [{ name: "search" }],
				created_at: "2026-07-01T10:00:00.000Z",
			},
		];
		mockApiOk([NO_AGENT_TAB], messages);

		const user = userEvent.setup();
		render(<CommandCenter />);

		// System message renders as a centered pill
		await screen.findByText("Session started");
		// Tool message renders a collapsible chip
		await user.click(await screen.findByRole("button", { name: /^Tool/ }));
		// Assistant content + tool-call toggle
		await screen.findByText("Hello there");
		await user.click(screen.getByRole("button", { name: /1 tool call/i }));
		await screen.findByText(/"name": "search"/);
	});
});

describe("CommandCenter â€” agent card time formatting", () => {
	it("formats never / seconds / minutes since last activity", async () => {
		const agents = [
			{ ...AGENT, agent_id: "agent-never", last_activity: "" },
			{
				...AGENT,
				agent_id: "agent-secs",
				last_activity: new Date(Date.now() - 30 * 1000).toISOString(),
			},
			{
				...AGENT,
				agent_id: "agent-mins",
				last_activity: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
			},
		];
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("agent-office")) return Promise.resolve({ agents });
			if (url.includes("admin-tabs")) return Promise.resolve({ tabs: [] });
			return Promise.resolve({});
		});
		mocks.post.mockResolvedValue({});

		render(<CommandCenter />);

		await screen.findByText("never");
		expect(screen.getByText("30s ago")).toBeInTheDocument();
		expect(screen.getByText("5m ago")).toBeInTheDocument();
	});
});

describe("CommandCenter â€” saved tabs failure and existing chat reopen", () => {
	it("logs a console warning when saved tabs fail to load", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("agent-office"))
				return Promise.resolve({ agents: [AGENT] });
			if (url.includes("admin-tabs"))
				return Promise.reject(new Error("tabs down"));
			return Promise.resolve({});
		});
		mocks.post.mockResolvedValue({});

		render(<CommandCenter />);

		await waitFor(() => expect(warn).toHaveBeenCalled());
		warn.mockRestore();
	});

	it("reopens the existing tab instead of creating a new conversation", async () => {
		mockApiOk([EXISTING_TAB], []);
		const user = userEvent.setup();
		render(<CommandCenter />);

		// Agent card is visible (tab bar also shows the role name)
		await screen.findByRole("button", { name: /^Chat$/ });
		await user.click(screen.getByRole("button", { name: /^Chat$/ }));

		// No conversation-create call, and the chat view is open
		await screen.findByText(/send a message to start/i);
		expect(mocks.post).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: "conversation-create" }),
		);
	});
});

describe("CommandCenter â€” successful send replaces optimistic message", () => {
	it("renders the AI reply after the server responds", async () => {
		mockApiOk();
		mocks.post.mockImplementation((url: string, body: { action?: string }) => {
			if (body?.action === "conversation-create") {
				return Promise.resolve({
					conversation: {
						id: "c1",
						title: "Chat with Research Agent",
						agent_id: "agent-1",
						status: "open",
						last_message_at: "2026-07-01T10:00:00.000Z",
						created_at: "2026-07-01T10:00:00.000Z",
					},
				});
			}
			if (body?.action === "conversation-send") {
				return Promise.resolve({
					user_message: {
						id: "u1",
						conversation_id: "c1",
						role: "user",
						content: "hi",
						created_at: "2026-07-01T10:00:00.000Z",
					},
					ai_message: {
						id: "a1",
						conversation_id: "c1",
						role: "assistant",
						agent_id: "agent-1",
						content: "Hello from the agent",
						created_at: "2026-07-01T10:00:00.000Z",
					},
				});
			}
			return Promise.resolve({});
		});

		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText("Research Agent");
		await user.click(screen.getByRole("button", { name: /^Chat$/ }));
		await screen.findByText(/send a message to start/i);

		await user.type(
			screen.getByPlaceholderText(/type a message/i),
			"hi{Enter}",
		);

		await screen.findByText("Hello from the agent");
		expect(screen.getByText("hi")).toBeInTheDocument();
	});

	it("does not send when the active tab has no conversation id", async () => {
		mockApiOk([{ id: "t1", conversation_id: null, conversations: {} }], []);
		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText(/send a message to start/i);
		await user.type(
			screen.getByPlaceholderText(/type a message/i),
			"hi{Enter}",
		);

		await waitFor(() => {
			expect(mocks.post).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ action: "conversation-send" }),
			);
		});
	});

	it("ignores send with empty text", async () => {
		mockApiOk();
		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText("Research Agent");
		await user.click(screen.getByRole("button", { name: /^Chat$/ }));
		await screen.findByText(/send a message to start/i);

		await user.type(screen.getByPlaceholderText(/type a message/i), "{Enter}");

		await waitFor(() => {
			expect(mocks.post).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ action: "conversation-send" }),
			);
		});
	});
});

describe("CommandCenter â€” tab management", () => {
	it("closes the active tab and falls back to the remaining tab", async () => {
		const t2 = {
			id: "t2",
			conversation_id: "c2",
			conversations: { agent_id: "agent-2", title: "Second" },
		};
		mockApiOk([EXISTING_TAB, t2], []);
		const user = userEvent.setup();
		const { container } = render(<CommandCenter />);

		// Both tabs visible; first is active
		await screen.findByText("agent-2");
		await screen.findByRole("button", { name: /^Chat$/ });

		// Close the active tab via its X button
		const xButtons = container.querySelectorAll("svg.lucide-x");
		const firstX = xButtons[0]!;
		await user.click(firstX.closest("button")!);

		// Only one tab remains (one X in the tab bar); the other tab still renders
		await waitFor(() => {
			expect(container.querySelectorAll("svg.lucide-x").length).toBe(1);
		});
		expect(screen.getByText("agent-2")).toBeInTheDocument();
	});

	it("switches the active tab when its header is clicked", async () => {
		const t2 = {
			id: "t2",
			conversation_id: "c2",
			conversations: { agent_id: "agent-2", title: "Second" },
		};
		const t2Messages = [
			{
				id: "m1",
				conversation_id: "c2",
				role: "user",
				content: "Second chat message",
				created_at: "2026-07-01T10:00:00.000Z",
			},
		];
		// URL-aware mock: c1 has no messages, c2 does â€” proves the tab switch refetches
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("agent-office"))
				return Promise.resolve({ agents: [AGENT] });
			if (url.includes("admin-tabs"))
				return Promise.resolve({ tabs: [EXISTING_TAB, t2] });
			if (url.includes("conversation-messages")) {
				return Promise.resolve({
					messages: url.includes("c2") ? t2Messages : [],
				});
			}
			return Promise.resolve({});
		});
		mocks.post.mockResolvedValue({});
		const user = userEvent.setup();
		render(<CommandCenter />);

		// First tab is active by default: empty chat state
		await screen.findByText(/send a message to start/i);

		// Click the second tab's header label (not its close button)
		await user.click(screen.getByText("agent-2"));

		// The second conversation's messages now render
		await screen.findByText("Second chat message");
	});
});
describe("CommandCenter â€” sidebar and filters", () => {
	it("collapses and expands the sidebar", async () => {
		mockApiOk();
		const user = userEvent.setup();
		const { container } = render(<CommandCenter />);

		await screen.findByText("Agent Office");
		await user.click(
			container
				.querySelector("svg.lucide-panel-left-close")!
				.closest("button")!,
		);
		expect(screen.queryByText("Agent Office")).toBeNull();

		await user.click(
			container.querySelector("svg.lucide-panel-left-open")!.closest("button")!,
		);
		expect(screen.getByText("Agent Office")).toBeInTheDocument();
	});

	it("filters agents by search text and status", async () => {
		mockApiOk();
		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText("Research Agent");

		// Search filters out the agent
		await user.type(screen.getByPlaceholderText("Search agents..."), "zzz");
		await screen.findByText("No agents found");
		await user.clear(screen.getByPlaceholderText("Search agents..."));
		expect(screen.getByText("Research Agent")).toBeInTheDocument();

		// Status filter: agent is idle, so "Working" hides it
		await user.click(screen.getByRole("button", { name: "Working" }));
		await screen.findByText("No agents found");
	});
});

describe("CommandCenter â€” new chat modal", () => {
	it("opens the modal, searches, and starts a chat with an agent", async () => {
		mockApiOk();
		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText("Research Agent");
		await user.click(screen.getByTitle("New Chat"));

		await screen.findByText("Start Chat with Agent");
		const modal = screen
			.getByText("Start Chat with Agent")
			.closest(".bg-gray-900") as HTMLElement;
		await user.type(
			within(modal).getByPlaceholderText("Search agents..."),
			"agent-1",
		);
		expect(within(modal).getByText("5 runs")).toBeInTheDocument();

		// Click the agent row -> conversation created, modal closes
		await user.click(within(modal).getByRole("button", { name: /agent-1/ }));
		await waitFor(() =>
			expect(screen.queryByText("Start Chat with Agent")).toBeNull(),
		);
		await screen.findByText(/send a message to start/i);
		expect(mocks.post).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				action: "conversation-create",
				agent_id: "agent-1",
			}),
		);
	});

	it("closes the modal when the backdrop is clicked", async () => {
		mockApiOk();
		const user = userEvent.setup();
		const { container } = render(<CommandCenter />);

		await screen.findByText("Research Agent");
		await user.click(screen.getByTitle("New Chat"));
		await screen.findByText("Start Chat with Agent");

		const backdrop = container.querySelector('[class*="bg-black/60"]')!;
		await user.click(backdrop as HTMLElement);
		await waitFor(() =>
			expect(screen.queryByText("Start Chat with Agent")).toBeNull(),
		);
	});

	it('shows "No agents found" when the search matches nothing', async () => {
		mockApiOk();
		const user = userEvent.setup();
		render(<CommandCenter />);

		await screen.findByText("Research Agent");
		await user.click(screen.getByTitle("New Chat"));
		await screen.findByText("Start Chat with Agent");

		const modal = screen
			.getByText("Start Chat with Agent")
			.closest(".bg-gray-900") as HTMLElement;
		await user.type(
			within(modal).getByPlaceholderText("Search agents..."),
			"nope",
		);
		await within(modal).findByText("No agents found");
	});
});
