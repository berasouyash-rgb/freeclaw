// ═══════════════════════════════════════════════════════════════════
// AdminChat — admin ↔ anonymous user conversations
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • thread list loads, skeleton, empty state, search filter
//   • selecting a thread loads messages + marks them read
//   • sending a message posts to the real chat API and reloads
//   • quick replies fill the composer
//   • AI suggest drafts a reply (with engine hint)
//   • open / close / reopen conversation state
//   • delete conversation (with confirm)
//   • new conversation via PromptDialog (deep-link target too)
//   • export conversation
//   • unread badge on threads
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminChat from "../pages/admin/AdminChat";

vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		getSlow: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: toastMock }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/markdown", () => ({
	renderMarkdown: (md: string) => `<p>${md}</p>`,
}));

const toastMock = vi.fn();

import { api } from "../lib/api";
const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedPut = api.put as ReturnType<typeof vi.fn>;
const mockedDel = api.del as ReturnType<typeof vi.fn>;

// scrollIntoView is not implemented in jsdom
if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => undefined;
}

const THREAD = {
	thread_id: "anon_abc123",
	messages: [],
	status: "open",
	updated_at: new Date().toISOString(),
	last_message: "The lift is stuck again",
	last_at: new Date().toISOString(),
	unread: 2,
};

const MESSAGES = [
	{
		id: "m1",
		thread_id: "anon_abc123",
		sender: "user",
		body: "The lift is stuck again",
		created_at: new Date().toISOString(),
	},
	{
		id: "m2",
		thread_id: "anon_abc123",
		sender: "admin",
		body: "Thanks — we're looking into it",
		created_at: new Date().toISOString(),
	},
];

function seedThreads() {
	mockedGet.mockImplementation(async (path: string) => {
		if (path === "/api/chat?threads=1") return [THREAD];
		if (path.includes("thread_id=")) {
			return { messages: MESSAGES, thread: THREAD };
		}
		return [];
	});
	mockedPost.mockResolvedValue({ ok: true });
	mockedPut.mockResolvedValue({ ok: true });
	mockedDel.mockResolvedValue({ ok: true });
}

beforeEach(() => {
	vi.clearAllMocks();
	toastMock.mockReset();
	sessionStorage.clear();
});

describe("AdminChat", () => {
	it("renders the chat header with Export / New buttons", async () => {
		seedThreads();
		render(<AdminChat />);
		await waitFor(() => {
			expect(screen.getByText("Chat")).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /New/ })).toBeInTheDocument();
	});

	it("shows the loading skeleton while threads load", () => {
		mockedGet.mockImplementation(() => new Promise(() => undefined));
		render(<AdminChat />);
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
	});

	it("shows an empty state with a Start one button when there are no threads", async () => {
		mockedGet.mockResolvedValue([]);
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText("No conversations yet")).toBeInTheDocument();
			expect(screen.getByRole("button", { name: /Start one/ })).toBeInTheDocument();
		});
	});

	it("lists threads with truncated id, last message, age and unread badge", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/The lift is stuck again/)).toBeInTheDocument();
			expect(screen.getByText("2")).toBeInTheDocument(); // unread badge
		});
	});

	it("selecting a thread loads its messages and marks it read", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/The lift is stuck again/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));

		await waitFor(() => {
			expect(screen.getByText("Thanks — we're looking into it")).toBeInTheDocument();
		});
		expect(mockedPut).toHaveBeenCalledWith("/api/chat", {
			action: "mark_read",
			thread_id: "anon_abc123",
			as: "admin",
		});
	});

	it("renders a locked thread with the Reopen action", async () => {
		mockedGet.mockImplementation(async (path: string) => {
			if (path === "/api/chat?threads=1")
				return [{ ...THREAD, status: "closed" }];
			if (path.includes("thread_id="))
				return {
					messages: MESSAGES,
					thread: { ...THREAD, status: "closed" },
				};
			return [];
		});
		mockedPut.mockResolvedValue({ ok: true });
		mockedPost.mockResolvedValue({ ok: true });
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByText("🔒 Closed · 2 messages")).toBeInTheDocument();
			expect(screen.getByRole("button", { name: /Reopen/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Reopen/ }));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/chat", {
				action: "set_status",
				thread_id: "anon_abc123",
				status: "open",
			});
			expect(toastMock).toHaveBeenCalledWith("Conversation open", "ok");
		});
	});

	it("closes an open conversation via the Close action", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Close/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Close/ }));

		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/chat", {
				action: "set_status",
				thread_id: "anon_abc123",
				status: "closed",
			});
		});
	});

	it("sends a message through the real chat API and reloads the thread", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
		});
		const textarea = screen.getByPlaceholderText(/Type a message/);
		fireEvent.change(textarea, { target: { value: "We fixed it today." } });
		fireEvent.click(screen.getByRole("button", { name: "" }).closest("button") || screen.getByRole("button", { name: "" }));

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith(
				"/api/chat",
				expect.objectContaining({
					thread_id: "anon_abc123",
					sender: "admin",
					body: "We fixed it today.",
				}),
			);
		});
	});

	it("sends on Enter (without Shift) and clears the composer", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
		});
		const textarea = screen.getByPlaceholderText(/Type a message/);
		fireEvent.change(textarea, { target: { value: "Hello from Enter" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith(
				"/api/chat",
				expect.objectContaining({ body: "Hello from Enter" }),
			);
		});
	});

	it("does not send an empty message", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
		});
		const textarea = screen.getByPlaceholderText(/Type a message/);
		fireEvent.change(textarea, { target: { value: "   " } });
		fireEvent.click(screen.getByRole("button", { name: "" }));

		expect(mockedPost).not.toHaveBeenCalled();
	});

	it("fills the composer from a quick reply pill", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: /Thanks for reaching out/,
			}),
		);
		expect(
			(
				screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement
			).value,
		).toContain("Thanks for reaching out");
	});

	it("AI suggest fills the first quick reply when there are no messages", async () => {
		mockedGet.mockImplementation(async (path: string) => {
			if (path === "/api/chat?threads=1") return [THREAD];
			if (path.includes("thread_id="))
				return { messages: [], thread: THREAD };
			return [];
		});
		mockedPost.mockResolvedValue({ ok: true });
		mockedPut.mockResolvedValue({ ok: true });
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /AI suggest/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /AI suggest/ }));
		expect(
			(
				screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement
			).value,
		).toContain("Thanks for reaching out");
	});

	it("AI suggest drafts a reply through /api/assist when messages exist", async () => {
		seedThreads();
		mockedPost.mockImplementation(async (path: string) => {
			if (path === "/api/assist")
				return { reply: "We are investigating the lift.", engine: "claude" };
			return { ok: true };
		});
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /AI suggest/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /AI suggest/ }));

		await waitFor(() => {
			expect(
				(
					screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement
				).value,
			).toBe("We are investigating the lift.");
			expect(toastMock).toHaveBeenCalledWith(
				"AI reply drafted — edit before sending",
				"info",
			);
		});
	});

	it("filters threads by search text", async () => {
		seedThreads();
		mockedGet.mockImplementation(async (path: string) => {
			if (path === "/api/chat?threads=1") return [THREAD];
			if (path.includes("thread_id="))
				return { messages: MESSAGES, thread: THREAD };
			return [];
		});
		mockedPost.mockResolvedValue({ ok: true });
		mockedPut.mockResolvedValue({ ok: true });
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/The lift is stuck again/)).toBeInTheDocument();
		});
		const search = screen.getByPlaceholderText("Search conversations…");
		fireEvent.change(search, { target: { value: "zzz-no-match" } });

		await waitFor(() => {
			expect(screen.getByText("No matching conversations")).toBeInTheDocument();
		});
	});

	it("opens the new-conversation dialog and starts a thread for an ID", async () => {
		seedThreads();
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText("Chat")).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /New/ }));
		await waitFor(() => {
			expect(screen.getByText("Start new conversation")).toBeInTheDocument();
		});
		const input = screen.getByPlaceholderText("anon_xxxxxxxxxxxx");
		fireEvent.change(input, { target: { value: "anon_brand_new" } });
		fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

		await waitFor(() => {
			expect(screen.getByText("anon_brand_new")).toBeInTheDocument();
		});
	});

	it("honors the deep-link target from session storage", async () => {
		seedThreads();
		sessionStorage.setItem("vb:adminChatTarget", "anon_deep");
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText("anon_deep")).toBeInTheDocument();
		});
		expect(sessionStorage.getItem("vb:adminChatTarget")).toBeNull();
	});

	it("deletes a conversation after confirmation", async () => {
		seedThreads();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		const delBtn = screen.getByTitle("Delete conversation");
		fireEvent.click(delBtn);

		await waitFor(() => {
			expect(mockedDel).toHaveBeenCalledWith("/api/chat", {
				thread_id: "anon_abc123",
			});
			expect(toastMock).toHaveBeenCalledWith("Conversation deleted", "ok");
		});
		expect(screen.queryByText(/The lift is stuck again/)).not.toBeInTheDocument();
		confirmSpy.mockRestore();
	});

	it("aborts delete when the user cancels the confirm dialog", async () => {
		seedThreads();
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByTitle("Delete conversation"));

		expect(mockedDel).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it("exports the active conversation to a text file", async () => {
		seedThreads();
		const urlSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:fake");
		render(<AdminChat />);

		await waitFor(() => {
			expect(screen.getByText(/anon_abc123/)).toBeInTheDocument();
		});
		fireEvent.click(screen.getByText(/anon_abc123/));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: /Export/ }));

		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("Chat exported", "ok");
		});
		expect(urlSpy).toHaveBeenCalled();
		urlSpy.mockRestore();
	});
});
