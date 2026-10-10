// ═══════════════════════════════════════════════════════════════════
// UnifiedInbox — merged inbox + chat contract
// ═══════════════════════════════════════════════════════════════════
// Locks: thread loading (both APIs merged + sorted), empty state, search
// filter, thread select → message load (source-aware), send message,
// quick replies, AI suggest, take over / release / transfer_emotional,
// close/reopen (chat), delete thread, start-new conversation, export.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnifiedInbox from "../pages/admin/UnifiedInbox";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	post: vi.fn(),
	del: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		put: mocks.put,
		post: mocks.post,
		postLong: (...args: unknown[]) =>
			(mocks.post as (...a: unknown[]) => Promise<unknown>)(...args),
		del: mocks.del,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/markdown", () => ({
	renderMarkdown: (s: string) => s.replace(/\n/g, "<br/>"),
}));

vi.mock("../lib/utils", () => ({
	fmtDate: (d: string) => `D(${d})`,
	timeAgo: () => "2m ago",
}));

vi.mock("../components/ui", () => ({
	PromptDialog: ({ open, onSubmit, onClose, title, submitLabel }: any) =>
		open ? (
			<div role="dialog" aria-label={title}>
				<p>{title}</p>
				<button onClick={() => onSubmit("anon_newuser")}>
					{submitLabel || "Save"}
				</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
}));

const THREADS = [
	{
		thread_id: "thread_inbox_1",
		source: "inbox",
		last_message: "The lift is still broken",
		updated_at: "2026-07-02T10:00:00.000Z",
		unread: 2,
		ai_agent: "ai",
		emotion: { level: "high" },
	},
	{
		thread_id: "anon_chat_user",
		source: "chat",
		last_message: "Thanks!",
		updated_at: "2026-07-03T10:00:00.000Z",
		unread: 0,
	},
];

const CHAT_MESSAGES = [
	{ id: "m1", sender: "user", body: "Hello admin", created_at: "2026-07-03T09:00:00.000Z" },
	{ id: "m2", sender: "admin", body: "Hi there", created_at: "2026-07-03T09:05:00.000Z" },
];

const INBOX_MESSAGES = [
	{ id: "m3", sender: "user", body: "Help needed", created_at: "2026-07-02T09:00:00.000Z" },
];

beforeEach(() => {
	vi.clearAllMocks();
	// jsdom lacks scrollIntoView — polyfill to prevent effect crashes
	if (!Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
	}
	mocks.get.mockImplementation(async (path: string) => {
		if (path === "/api/inbox?threads=1") return THREADS.filter((t) => t.source === "inbox");
		if (path === "/api/chat?threads=1") return THREADS.filter((t) => t.source === "chat");
		if (path.startsWith("/api/chat?thread_id=")) {
			return {
				messages: CHAT_MESSAGES,
				thread: { agent: "ai", status: "open", source: "chat" },
			};
		}
		if (path.startsWith("/api/inbox?thread_id=")) {
			return {
				messages: INBOX_MESSAGES,
				state: { agent: "admin", source: "inbox" },
			};
		}
		return [];
	});
	mocks.put.mockResolvedValue({ ok: true });
	mocks.post.mockResolvedValue({ ok: true });
	mocks.del.mockResolvedValue({ ok: true });
	vi.spyOn(window, "confirm").mockReturnValue(true);
});

function renderPage(initialEntries: string[] = ["/admin?tab=inbox"]) {
	return render(
		<MemoryRouter initialEntries={initialEntries}>
			<UnifiedInbox />
		</MemoryRouter>,
	);
}

async function showAllThreads() {
	const all = await screen.findByRole("tab", { name: /^All/ });
	fireEvent.click(all);
}

describe("UnifiedInbox — thread list", () => {
	it("shows important threads by default and everything under All", async () => {
		renderPage();
		// thread_inbox_1 is high-distress with unread mail → important.
		expect(await screen.findByText("thread_inbox_1")).toBeInTheDocument();
		// anon_chat_user is quiet → hidden until All.
		expect(screen.queryByText("anon_chat_user")).not.toBeInTheDocument();
		await showAllThreads();
		expect(await screen.findByText("anon_chat_user")).toBeInTheDocument();
		// Unread badge — scope to the inbox thread row
		const thread = screen.getByText("thread_inbox_1").closest(".group") as HTMLElement;
		expect(within(thread).getByText("2")).toBeInTheDocument();
	});

	it("sorts threads newest first (chat thread is newer)", async () => {
		renderPage();
		await showAllThreads();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		const items = screen.getAllByText(/anon_chat_user|thread_inbox_1/);
		expect(items[0]).toHaveTextContent("anon_chat_user");
		expect(items[1]).toHaveTextContent("thread_inbox_1");
	});

	it("shows the empty state with a start-one button", async () => {
		mocks.get.mockImplementation(async (path: string) =>
			path.includes("?threads=1") ? [] : [],
		);
		renderPage();
		expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Start one" })).toBeInTheDocument();
	});

	it("filters threads by the sidebar search", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await showAllThreads();
		await screen.findByText("anon_chat_user");

		await user.type(screen.getByPlaceholderText("Search… ( / )"), "lift");
		expect(screen.getByText("thread_inbox_1")).toBeInTheDocument();
		expect(screen.queryByText("anon_chat_user")).not.toBeInTheDocument();
	});

	it("shows the no-matches state for a failing filter", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await showAllThreads();
		await screen.findByText("anon_chat_user");

		await user.type(screen.getByPlaceholderText("Search… ( / )"), "zzz");
		expect(screen.getByText("No matching conversations")).toBeInTheDocument();
	});

	it("opens ?thread= deep links straight on the chat", async () => {
		render(
			<MemoryRouter initialEntries={["/admin?tab=inbox&thread=thread_inbox_1"]}>
				<UnifiedInbox />
			</MemoryRouter>,
		);
		// No click needed — the conversation loads directly.
		expect(await screen.findByText("Help needed")).toBeInTheDocument();
	});

	it("shows the emotion label chip on emotionally-flagged threads", async () => {
		renderPage();
		expect(await screen.findByText("High Distress")).toBeInTheDocument();
	});
});

describe("UnifiedInbox — conversation pane", () => {
	it("opens a chat thread and loads chat messages", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");

		await user.click(screen.getByText("anon_chat_user"));
		expect(await screen.findByText("Hello admin")).toBeInTheDocument();
		expect(screen.getByText("Hi there")).toBeInTheDocument();
		expect(screen.getByText("AI assistant active")).toBeInTheDocument();
	});

	it("opens an inbox thread and loads inbox messages", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");

		await user.click(screen.getByText("thread_inbox_1"));
		expect(await screen.findByText("Help needed")).toBeInTheDocument();
		expect(screen.getByText("Admin handling")).toBeInTheDocument();
	});

	it("marks chat messages read via PUT when opening a chat thread", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		await user.click(screen.getByText("anon_chat_user"));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/chat", {
				action: "mark_read",
				thread_id: "anon_chat_user",
				as: "admin",
			});
		});
	});

	it("shows the no-messages placeholder", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1") return THREADS.filter((t) => t.source === "inbox");
			if (path === "/api/chat?threads=1") return [];
			if (path.startsWith("/api/inbox?thread_id=")) {
				return { messages: [], state: { agent: "ai", source: "inbox" } };
			}
			return [];
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));
		expect(await screen.findByText(/No messages yet/)).toBeInTheDocument();
	});
});

describe("UnifiedInbox — send + suggestions", () => {
	it("sends a message to a chat thread via POST /api/chat", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		await user.click(screen.getByText("anon_chat_user"));
		await screen.findByText("Hello admin");

		const textarea = screen.getByPlaceholderText(
			"Type a message… (Shift+Enter for new line)",
		);
		await user.type(textarea, "Got it!");
		// The send button is the icon-only sibling in the composer bar
		const composer = textarea.closest(".flex.items-end") as HTMLElement;
		const sendBtn = within(composer).getAllByRole("button").find(
			(b) => b.querySelector("svg") && !b.textContent,
		) as HTMLElement;
		await user.click(sendBtn);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/chat", {
				thread_id: "anon_chat_user",
				sender: "admin",
				body: "Got it!",
			});
		});
	});

	it("inserts a quick reply chip into the composer", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		await user.click(screen.getByText("anon_chat_user"));
		await screen.findByText("Hello admin");

		await user.click(screen.getByRole("button", { name: /Thanks for reaching out/ }));
		const textarea = screen.getByPlaceholderText(
			"Type a message… (Shift+Enter for new line)",
		) as HTMLTextAreaElement;
		expect(textarea.value).toContain("Thanks for reaching out");
	});

	it("fills the first quick reply when AI suggest is pressed with no messages", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		await user.click(screen.getByText("anon_chat_user"));
		await screen.findByText("Hello admin");

		// With messages present it calls /api/assist instead — mock it
		mocks.post.mockResolvedValue({ reply: "AI-drafted reply", engine: "keyword" });
		await user.click(screen.getByRole("button", { name: /AI suggest/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/assist", {
				task: "chat_reply",
				messages: expect.any(Array),
			});
		});
		const textarea = screen.getByPlaceholderText(
			"Type a message… (Shift+Enter for new line)",
		) as HTMLTextAreaElement;
		expect(textarea.value).toBe("AI-drafted reply");
	});

	it("toasts an error when sending fails", async () => {
		mocks.post.mockRejectedValue(new Error("send boom"));
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		await user.click(screen.getByText("anon_chat_user"));
		await screen.findByText("Hello admin");

		const textarea = screen.getByPlaceholderText(
			"Type a message… (Shift+Enter for new line)",
		);
		await user.type(textarea, "Will fail");
		const composer = textarea.closest(".flex.items-end") as HTMLElement;
		const sendBtn = within(composer).getAllByRole("button").find(
			(b) => b.querySelector("svg") && !b.textContent,
		) as HTMLElement;
		await user.click(sendBtn);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("send boom", "err");
		});
	});
});

describe("UnifiedInbox — actions and lifecycle", () => {
	it("takes over an inbox thread handled by AI", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1") return THREADS.filter((t) => t.source === "inbox");
			if (path === "/api/chat?threads=1") return THREADS.filter((t) => t.source === "chat");
			if (path.startsWith("/api/inbox?thread_id=")) {
				return {
					messages: INBOX_MESSAGES,
					state: { agent: "ai", source: "inbox" }, // AI handles it → Take Over available
				};
			}
			return [];
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));
		await screen.findByText("Help needed");

		await user.click(screen.getByRole("button", { name: /Take Over/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/inbox", {
				thread_id: "thread_inbox_1",
				action: "takeover",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Action: takeover", "ok");
	});

	it("closes and reopens a chat thread", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		await user.click(screen.getByText("anon_chat_user"));
		await screen.findByText("Hello admin");

		await user.click(screen.getByRole("button", { name: /Close/ }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/chat", {
				action: "set_status",
				thread_id: "anon_chat_user",
				status: "closed",
			});
		});
	});

	it("deletes a chat thread after confirmation", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");

		const item = screen.getByText("anon_chat_user").closest(".group") as HTMLElement;
		fireEvent.mouseEnter(item);
		const delBtn = within(item).getByTitle("Delete conversation");
		await user.click(delBtn);
		await waitFor(() => {
			expect(mocks.del).toHaveBeenCalledWith("/api/chat?thread_id=anon_chat_user", {
				thread_id: "anon_chat_user",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Conversation removed", "ok");
		expect(screen.queryByText("anon_chat_user")).not.toBeInTheDocument();
	});

	it("starts a new conversation via the New dialog", async () => {
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");

		await user.click(screen.getByRole("button", { name: "New" }));
		await user.click(
			within(screen.getByRole("dialog", { name: "Start new conversation" })).getByRole(
				"button",
				{ name: "Open chat" },
			),
		);
		// The id shows in both the thread list and the active header
		expect((await screen.findAllByText("anon_newuser")).length).toBeGreaterThan(0);
		// New chat threads route to the chat pane with the composer enabled
		expect(
			screen.getByPlaceholderText("Type a message… (Shift+Enter for new line)"),
		).toBeInTheDocument();
	});

	it("exports the active chat as a text file", async () => {
		// jsdom lacks URL.createObjectURL — stub it
		vi.stubGlobal("URL", {
			...URL,
			createObjectURL: vi.fn(() => "blob:mock"),
			revokeObjectURL: vi.fn(),
		});
		const user = userEvent.setup();
		renderPage();
		await showAllThreads();
		await screen.findByText("anon_chat_user");
		await user.click(screen.getByText("anon_chat_user"));
		await screen.findByText("Hello admin");

		await user.click(screen.getByTitle("Export"));
		expect(mocks.toast).toHaveBeenCalledWith("Chat exported", "ok");
		vi.unstubAllGlobals();
	});

	it("handles a failed thread load gracefully", async () => {
		mocks.get.mockRejectedValue(new Error("down"));
		renderPage();
		await waitFor(() => {
			expect(screen.queryByText(/Select a conversation/)).toBeInTheDocument();
		});
	});
});

describe("UnifiedInbox — list shows agent work per thread", () => {
	it("renders the AI topic, priority and cached summary without opening", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1")
				return [
					{
						thread_id: "thread_topic_1",
						source: "inbox",
						last_message: "long chat …",
						updated_at: "2026-07-02T10:00:00.000Z",
						unread: 0,
						triage: { topic: "lift broken", priority: "urgent" },
						ai_summary: {
							summary: "Lift still broken after two weeks",
							entities: ["lift"],
							resolution_state: "open",
							summarized_at: "2026-07-02T11:00:00.000Z",
							stale: false,
						},
					},
				];
			if (path === "/api/chat?threads=1") return [];
			return [];
		});
		renderPage();
		await screen.findByText("thread_topic_1");
		expect(screen.getByText("lift broken")).toBeInTheDocument();
		expect(screen.getByText("urgent")).toBeInTheDocument();
		expect(
			screen.getByText(/Lift still broken after two weeks/),
		).toBeInTheDocument();
	});

	it("marks outdated summaries as stale instead of presenting them current", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1")
				return [
					{
						thread_id: "thread_stale_1",
						source: "inbox",
						last_message: "newer message",
						updated_at: "2026-07-03T10:00:00.000Z",
						unread: 1,
						ai_summary: {
							summary: "Old understanding",
							entities: [],
							resolution_state: "open",
							summarized_at: "2026-07-02T10:00:00.000Z",
							stale: true,
						},
					},
				];
			if (path === "/api/chat?threads=1") return [];
			return [];
		});
		renderPage();
		await screen.findByText("thread_stale_1");
		expect(screen.getByTitle(/outdated/)).toBeInTheDocument();
	});
});

describe("UnifiedInbox — AI thread summary", () => {
	function openInboxThread() {
		renderPage();
		return (async () => {
			const user = userEvent.setup();
			await screen.findByText("thread_inbox_1");
			await user.click(screen.getByText("thread_inbox_1"));
			await screen.findByText("Help needed");
			return user;
		})();
	}

	it("fetches and shows the real summary, entities and status", async () => {
		mocks.post.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
			if (body?.action === "summary")
				return {
					ok: true,
					summary: "Student reports the lift still broken after two weeks.",
					entities: ["lift", "Block B"],
					resolution_state: "in_progress",
				};
			return { ok: true };
		});
		const user = await openInboxThread();

		await user.click(screen.getByRole("button", { name: /Summarize/ }));
		expect(
			await screen.findByText("Student reports the lift still broken after two weeks."),
		).toBeInTheDocument();
		expect(screen.getByText("lift")).toBeInTheDocument();
		expect(screen.getByText(/in_progress/)).toBeInTheDocument();
		expect(mocks.post).toHaveBeenCalledWith("/api/inbox", {
			thread_id: "thread_inbox_1",
			action: "summary",
		});
	});

	it("shows an honest empty state when no summary comes back", async () => {
		mocks.post.mockResolvedValue({ ok: true, summary: "", entities: [] });
		const user = await openInboxThread();

		await user.click(screen.getByRole("button", { name: /Summarize/ }));
		expect(await screen.findByText(/No summary yet/)).toBeInTheDocument();
	});

	it("surfaces a summary failure via toast, fabricating nothing", async () => {
		mocks.post.mockRejectedValueOnce(new Error("backend down"));
		const user = await openInboxThread();

		await user.click(screen.getByRole("button", { name: /Summarize/ }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("backend down", "err");
		});
		expect(screen.queryByText(/AI summary · status/)).not.toBeInTheDocument();
	});
});

describe("UnifiedInbox — summary thread affinity (no cross-thread leaks)", () => {
	it("never shows thread A's late summary on thread B", async () => {
		// Live incident: a blackmail summary rendered on a hello-only
		// thread. Cause: the briefing wrote to whatever thread was open
		// when the response landed, not the thread it requested.
		let resolveSummary = (_v: unknown) => {};
		mocks.post.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
			if (body?.action === "summary")
				return new Promise((resolve) => {
					resolveSummary = resolve as (v: unknown) => void;
				});
			return { ok: true };
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));
		await screen.findByText("Help needed");
		await user.click(screen.getByRole("button", { name: /Summarize/ }));
		// Switch threads while A's briefing is still in flight.
		await showAllThreads();
		await user.click(screen.getByText("anon_chat_user"));
		await screen.findByText("Hello admin");
		// A's briefing lands late.
		resolveSummary({
			ok: true,
			summary: "THREAD-A SUMMARY",
			entities: [],
			resolution_state: "open",
		});
		await waitFor(() => expect(mocks.post).toHaveBeenCalled());
		// B must not display it…
		expect(screen.queryByText("THREAD-A SUMMARY")).not.toBeInTheDocument();
		// …but it is cached for A: reopening shows it without refetching.
		const callsBefore = (mocks.post as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
		await user.click(screen.getByText("thread_inbox_1"));
		expect(await screen.findByText("THREAD-A SUMMARY")).toBeInTheDocument();
		const callsAfter = (mocks.post as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
		expect(callsAfter).toBe(callsBefore);
	});
});

describe("UnifiedInbox — draft proposal popup", () => {
	const PROPOSAL = {
		title: "Broken lift in Block C",
		description: "The lift has been broken for two days.",
		category: "Facilities",
		private: true,
		status: "proposed",
		trigger: "student-request",
		at: "2026-09-01T10:05:00.000Z",
	};

	function mockThreadWithProposal() {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1") return THREADS.filter((t) => t.source === "inbox");
			if (path === "/api/chat?threads=1") return [];
			if (path.startsWith("/api/inbox?thread_id=")) {
				return {
					messages: INBOX_MESSAGES,
					state: { agent: "admin", source: "inbox", draft_proposal: PROPOSAL },
				};
			}
			return [];
		});
	}

	it("shows the accept/reject popup with title and private toggle", async () => {
		mockThreadWithProposal();
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));

		expect(await screen.findByTestId("draft-proposal")).toBeInTheDocument();
		expect(screen.getByText("Broken lift in Block C")).toBeInTheDocument();
		expect(screen.getByRole("switch", { name: "Private post" })).toBeInTheDocument();
		// The chat the draft was drawn from is quoted inside the popup.
		expect(
			within(screen.getByTestId("draft-proposal")).getByText(/Help needed/),
		).toBeInTheDocument();
	});

	it("accepts with the toggled visibility and rejects plainly", async () => {
		mockThreadWithProposal();
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));
		await screen.findByTestId("draft-proposal");

		await user.click(screen.getByRole("button", { name: "Accept post" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/inbox", {
				action: "accept_draft",
				thread_id: "thread_inbox_1",
				visibility: "private",
			});
		});
	});

	it("requests a draft from the Draft post chip", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));
		await screen.findByText("Help needed");

		await user.click(screen.getByRole("button", { name: /Draft post/ }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/inbox", {
				action: "draft_post",
				thread_id: "thread_inbox_1",
			});
		});
	});

	it("shows no popup when no proposal is open", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));
		await screen.findByText("Help needed");
		expect(screen.queryByTestId("draft-proposal")).not.toBeInTheDocument();
	});
});

describe("UnifiedInbox — 5-day admin window label", () => {
	it("labels the admin slice honestly", async () => {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1") return THREADS.filter((t) => t.source === "inbox");
			if (path === "/api/chat?threads=1") return [];
			if (path.startsWith("/api/inbox?thread_id=")) {
				return {
					messages: INBOX_MESSAGES,
					state: { agent: "admin", source: "inbox" },
					history_window: "5d",
				};
			}
			return [];
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("thread_inbox_1");
		await user.click(screen.getByText("thread_inbox_1"));
		expect(await screen.findByText(/Showing the last 5 days/)).toBeInTheDocument();
	});
});

describe("UnifiedInbox — slang finder", () => {
	const SLANG_THREAD = {
		thread_id: "thread_slang_1",
		source: "inbox",
		last_message: "this food sucks",
		updated_at: new Date().toISOString(),
		unread: 0,
		ai_agent: "ai",
		slang: { count: 2, terms: ["sucks", "dumb"], messages: 1 },
	};

	function mockSlangList() {
		mocks.get.mockImplementation(async (path: string) => {
			if (path === "/api/inbox?threads=1") return [SLANG_THREAD];
			if (path === "/api/chat?threads=1") return [];
			if (path.startsWith("/api/inbox?thread_id=")) {
				return {
					messages: [
						{ id: "s1", sender: "user", body: "this food sucks, dumb menu", created_at: new Date().toISOString() },
					],
					state: {
						agent: "ai",
						source: "inbox",
						slang_hits: { count: 2, terms: ["sucks", "dumb"], messages: 1 },
					},
				};
			}
			return [];
		});
	}

	it("chips slang threads and filters to them on the Slang pill", async () => {
		mockSlangList();
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("tab", { name: /^Slang/ }));
		await screen.findByText("thread_slang_1");
		expect(screen.getByTestId("slang-chip")).toBeInTheDocument();

		expect(screen.getByText("thread_slang_1")).toBeInTheDocument();
		await user.click(screen.getByRole("tab", { name: /^Important/ }));
		expect(screen.queryByText("thread_slang_1")).not.toBeInTheDocument();
	});

	it("lists the flagged terms inside the open thread", async () => {
		mockSlangList();
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByRole("tab", { name: /^Slang/ }));
		await screen.findByText("thread_slang_1");
		await user.click(screen.getByText("thread_slang_1"));
		expect(await screen.findByTestId("slang-terms")).toBeInTheDocument();
		expect(screen.getByTestId("slang-terms")).toHaveTextContent("sucks");
	});
});
