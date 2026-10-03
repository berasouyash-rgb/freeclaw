// -------------------------------------------------------------------
// UserChat � duplicate message prevention
// -------------------------------------------------------------------
// Regression: the optimistic user bubble (id "user-<ts>") was never
// replaced when the server confirmed the message, so every send rendered
// the user's message TWICE (optimistic copy + DB copy with a different id).
// Locks: server-confirmed message replaces the optimistic bubble, so the
// rendered bubble count for the user text is exactly 1.
// -------------------------------------------------------------------

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserChat from "../pages/UserChat";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	setChatUnread: vi.fn(),
	postInbox: vi.fn(),
	post: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	uploadImage: vi.fn(),
	postSlow: vi.fn(),
	useRealtime: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		put: mocks.put,
		post: mocks.post,
		postInbox: mocks.postInbox,
		uploadImage: mocks.uploadImage,
		postSlow: mocks.postSlow,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		setChatUnread: mocks.setChatUnread,
	}),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: mocks.useRealtime,
}));

vi.mock("../lib/utils", () => ({
	fmtDate: () => "now",
	sanitize: (s: string) => s,
}));

vi.mock("../components/TypingIndicator", () => ({
	default: () => <div data-testid="typing" />,
}));

vi.mock("../components/ErrorBoundary", () => ({
	LoadingSpinner: () => <div data-testid="ai-loader" />,
	// Real page imports — mirrored values so the loader gate logic runs.
	prefersReducedMotion: () => false,
	VB_FULL_CYCLE_MS: 16000,
}));

const SERVER_MESSAGES = [
	{
		id: "m1",
		sender: "ai",
		body: "Hello! How can I help?",
		created_at: "2026-08-01T10:00:00.000Z",
		read: false,
	},
];

function renderPage() {
	const utils = render(
		<MemoryRouter>
			<UserChat />
		</MemoryRouter>,
	);
	return {
		...utils,
		fileInput: () =>
			utils.container.querySelector('input[type="file"]') as HTMLInputElement,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	Element.prototype.scrollIntoView = vi.fn();
	mocks.get.mockResolvedValue({
		messages: [...SERVER_MESSAGES],
		thread: { thread_id: "anon-test", status: "open" },
	});
	mocks.put.mockResolvedValue({ ok: true });
});

// Fake FileReader so attach() can be driven synchronously in tests.
class FakeFileReader {
	result = "data:image/png;base64,QUJDRA==";
	onload: (() => void) | null = null;
	readAsDataURL() {
		setTimeout(() => this.onload?.(), 0);
	}
}

describe("UserChat � duplicate prevention", () => {
	it("renders the confirmed server message exactly once after send", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		mocks.postInbox.mockResolvedValue({
			message: {
				id: "db-user-1",
				sender: "user",
				body: "I need help",
				created_at: "2026-08-01T10:01:00.000Z",
				read: true,
			},
			auto_reply: {
				id: "db-ai-1",
				sender: "ai",
				body: "Sure, tell me more",
				created_at: "2026-08-01T10:01:01.000Z",
				read: false,
			},
			emotion: { level: "none", emotion: "none" },
		});

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "I need help");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() =>
			expect(screen.getByText("Sure, tell me more")).toBeTruthy(),
		);

		// The user message must appear exactly once (optimistic bubble replaced,
		// not duplicated).
		const matches = screen.queryAllByText("I need help");
		expect(matches.length).toBe(1);
	});

	it("restores the draft when the send provably never landed server-side", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		// Hard failure AND the follow-up sync has no trace of the message —
		// the words must come back instead of being eaten.
		mocks.postInbox.mockRejectedValue(new Error("Failed to fetch"));
		const input = screen.getByLabelText("Chat message");
		await user.type(input, "my lost words");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => expect(input).toHaveValue("my lost words"));
	});

	it("does not restore the draft when the sync confirms the save", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		// The POST failed but the message WAS saved — sync proves it, so the
		// input stays clear (restoring would invite a double-send).
		mocks.postInbox.mockRejectedValue(new Error("network"));
		mocks.get.mockResolvedValueOnce({
			messages: [
				...SERVER_MESSAGES,
				{
					id: "db-user-1",
					sender: "user",
					body: "hello again",
					created_at: "2026-08-01T10:02:00.000Z",
					read: true,
				},
			],
			thread: { thread_id: "anon-test", status: "open" },
		});

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "hello again");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			const matches = screen.queryAllByText("hello again");
			expect(matches.length).toBeLessThanOrEqual(1);
		});
		expect(input).toHaveValue("");
	});

	it("replaces an existing optimistic bubble when a realtime sync confirms it", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		// Server rejects the send (network error) but the message WAS saved,
		// then a later sync returns it � no duplicate should appear.
		mocks.postInbox.mockRejectedValue(new Error("network"));
		mocks.get.mockResolvedValueOnce({
			messages: [
				...SERVER_MESSAGES,
				{
					id: "db-user-1",
					sender: "user",
					body: "hello again",
					created_at: "2026-08-01T10:02:00.000Z",
					read: true,
				},
			],
			thread: { thread_id: "anon-test", status: "open" },
		});

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "hello again");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			const matches = screen.queryAllByText("hello again");
			expect(matches.length).toBeLessThanOrEqual(1);
		});
	});

	it("does not duplicate the user message when the server confirm arrives late (slow AI reply)", async () => {
		// Regression: the server generates the AI reply inline and can take up to
		// 35s. The optimistic bubble was created at send time; the confirmation
		// arriving 40s later must STILL replace it. An age-based window (<15s)
		// let the old bubble survive ? the message rendered twice.
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const sentAt = new Date();
		const confirmedAt = new Date(sentAt.getTime() + 40000).toISOString();
		mocks.postInbox.mockResolvedValue({
			message: {
				id: "db-user-slow",
				sender: "user",
				body: "late confirm",
				created_at: confirmedAt,
				read: true,
			},
			auto_reply: {
				id: "db-ai-slow",
				sender: "ai",
				body: "Sorry for the wait",
				created_at: confirmedAt,
				read: false,
			},
			emotion: { level: "none", emotion: "none" },
		});

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "late confirm");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() =>
			expect(screen.getByText("Sorry for the wait")).toBeTruthy(),
		);
		const matches = screen.queryAllByText("late confirm");
		expect(matches.length).toBe(1);
	});

	it("renders a thread whose DB messages have numeric ids (production crash: g.startsWith is not a function)", async () => {
		// chat_messages uses integer identity ids (e.g. 265, 266), not uuids.
		// mergeMessages previously called x.id?.startsWith('user-') on every user
		// message � a numeric id made the whole /chat page throw inside
		// useState's eager evaluation and the ErrorBoundary caught it.
		mocks.get.mockResolvedValue({
			messages: [
				{
					id: 265,
					sender: "user",
					body: "is admin available",
					created_at: "2026-08-02T09:00:00.000Z",
					read: false,
				},
				{
					id: 266,
					sender: "ai",
					body: "Hi! Admins review all submissions regularly.",
					created_at: "2026-08-02T09:00:05.000Z",
					read: false,
				},
				{
					id: 292,
					sender: "user",
					body: "HI",
					created_at: "2026-08-02T10:00:00.000Z",
					read: false,
				},
				{
					id: 293,
					sender: "ai",
					body: "Hi there! How can I help you today?",
					created_at: "2026-08-02T10:00:03.000Z",
					read: false,
				},
			],
			thread: { thread_id: "anon-test", status: "open" },
		});

		renderPage();
		await waitFor(() =>
			expect(screen.getByText("is admin available")).toBeTruthy(),
		);
		expect(
			screen.getByText("Hi! Admins review all submissions regularly."),
		).toBeTruthy();
		expect(screen.getByText("HI")).toBeTruthy();
		expect(
			screen.getByText("Hi there! How can I help you today?"),
		).toBeTruthy();
	});

	it("replaces the optimistic bubble when the confirmed copy has a numeric id", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		// Realistic confirmation: DB-generated integer id, same body as the
		// optimistic bubble � must replace it, not append a duplicate.
		mocks.postInbox.mockResolvedValue({
			message: {
				id: 300,
				sender: "user",
				body: "I need help",
				created_at: "2026-08-01T10:01:00.000Z",
				read: true,
			},
			auto_reply: {
				id: 301,
				sender: "ai",
				body: "Sure, tell me more",
				created_at: "2026-08-01T10:01:01.000Z",
				read: false,
			},
			emotion: { level: "none", emotion: "none" },
		});

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "I need help");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() =>
			expect(screen.getByText("Sure, tell me more")).toBeTruthy(),
		);
		const matches = screen.queryAllByText("I need help");
		expect(matches.length).toBe(1);
	});
});

describe("UserChat � fallbacks, banners and attachments", () => {
	it("does not send an empty message (Enter with blank input)", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const input = screen.getByLabelText("Chat message");
		await user.click(input);
		await user.keyboard("{Enter}");

		expect(mocks.postInbox).not.toHaveBeenCalled();
	});

	it("falls back to the legacy /api/chat endpoint when /api/inbox fails", async () => {
		mocks.get.mockRejectedValueOnce(new Error("inbox down"));
		mocks.get.mockResolvedValueOnce({
			messages: [
				{
					id: "legacy-1",
					sender: "ai",
					body: "Legacy fallback reply",
					created_at: "2026-08-01T09:00:00.000Z",
					read: false,
				},
			],
			thread: { thread_id: "anon-test", status: "open" },
		});

		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Legacy fallback reply")).toBeTruthy(),
		);
	});

	it("renders the empty state when every API is unreachable", async () => {
		vi.useFakeTimers();
		mocks.get.mockRejectedValue(new Error("offline"));

		renderPage();
		// Flush the rejected fetch + catch, which schedules the loader release.
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});
		// The loader holds for the full motive story, so the empty state can only
		// appear after the gate releases.
		act(() => {
			vi.advanceTimersByTime(16100);
		});
		expect(screen.getByText("No messages yet")).toBeTruthy();
		vi.useRealTimers();
	});

	it("shows the agent banner from the inbox state payload", async () => {
		mocks.get.mockResolvedValue({
			messages: [...SERVER_MESSAGES],
			thread: { thread_id: "anon-test", status: "open" },
			state: { agent: "emotional" },
		});

		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/Emotional Support Agent/)).toBeTruthy(),
		);
	});

	it("shows the Admin banner when an admin agent is active", async () => {
		mocks.get.mockResolvedValue({
			messages: [...SERVER_MESSAGES],
			thread: { thread_id: "anon-test", status: "open" },
			state: { agent: "admin" },
		});

		renderPage();
		await waitFor(() => expect(screen.getByText("👤 Admin")).toBeTruthy());
	});

	it("shows the crisis banner when the emotion level is critical", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		mocks.postInbox.mockResolvedValue({
			message: {
				id: 400,
				sender: "user",
				body: "I am not okay",
				created_at: "2026-08-01T10:01:00.000Z",
				read: true,
			},
			auto_reply: {
				id: 401,
				sender: "ai",
				body: "Let us talk",
				created_at: "2026-08-01T10:01:01.000Z",
				read: false,
			},
			emotion: { level: "critical", emotion: "distress" },
		});

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "I am not okay");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() =>
			expect(screen.getByText(/Crisis Support Agent activated/)).toBeTruthy(),
		);
	});

	it("shows an unknown-emotion agent as the plain AI assistant", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		mocks.postInbox.mockResolvedValue({
			message: {
				id: 402,
				sender: "user",
				body: "hello?",
				created_at: "2026-08-01T10:02:00.000Z",
				read: true,
			},
			auto_reply: undefined,
			emotion: { level: "mystery", emotion: "weird" },
		});

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "hello?");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => expect(screen.getByText(/AI Assistant/)).toBeTruthy());
	});

	it("renders a freshly-synced AI reply after a failed send (no duplicate)", async () => {
		mocks.postInbox.mockRejectedValue(new Error("boom"));
		// Initial load returns the greeting; the post-send sync (second call)
		// returns a fresh AI reply generated AFTER the send timestamp.
		mocks.get.mockImplementationOnce(() =>
			Promise.resolve({
				messages: [...SERVER_MESSAGES],
				thread: { thread_id: "anon-test", status: "open" },
			}),
		);
		mocks.get.mockImplementationOnce(() =>
			Promise.resolve({
				messages: [
					...SERVER_MESSAGES,
					{
						id: 500,
						sender: "ai",
						body: "Synced AI reply",
						created_at: new Date().toISOString(),
						read: false,
					},
				],
				thread: { thread_id: "anon-test", status: "open" },
			}),
		);

		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "dup check");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() =>
			expect(screen.getByText("Synced AI reply")).toBeTruthy(),
		);
	});

	it("toasts a transient message when the network send fails", async () => {
		mocks.postInbox.mockRejectedValue(new Error("network error"));

		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "offline test");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringMatching(/Message sent/),
				"info",
			),
		);
	});

	it("toasts the raw error for non-transient send failures", async () => {
		mocks.postInbox.mockRejectedValue(new Error("Internal server error"));

		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const input = screen.getByLabelText("Chat message");
		await user.type(input, "real error");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith("Internal server error", "err"),
		);
	});

	it("rejects attachments larger than 3 MB", async () => {
		const user = userEvent.setup();
		const { fileInput } = renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const bigFile = new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.png", {
			type: "image/png",
		});
		await user.upload(fileInput(), bigFile);

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				"Image must be under 3 MB",
				"err",
			),
		);
		expect(mocks.uploadImage).not.toHaveBeenCalled();
	});

	it("uploads an image attachment and sends it as a message", async () => {
		vi.stubGlobal("FileReader", FakeFileReader);
		mocks.uploadImage.mockResolvedValue("https://img.example/photo.png");
		mocks.postInbox.mockResolvedValue({
			message: {
				id: 600,
				sender: "user",
				body: "",
				attachment_url: "https://img.example/photo.png",
				created_at: "2026-08-01T10:04:00.000Z",
				read: true,
			},
			auto_reply: {
				id: 601,
				sender: "ai",
				body: "Photo received!",
				created_at: "2026-08-01T10:04:01.000Z",
				read: false,
			},
			emotion: { level: "none", emotion: "none" },
		});

		const user = userEvent.setup();
		const { fileInput } = renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const file = new File([new Uint8Array(64)], "photo.png", {
			type: "image/png",
		});
		await user.upload(fileInput(), file);

		await waitFor(() =>
			expect(mocks.uploadImage).toHaveBeenCalledWith(
				"QUJDRA==",
				"image/png",
				"anon-test",
			),
		);
		await waitFor(() =>
			expect(screen.getByText("Photo received!")).toBeTruthy(),
		);
		vi.unstubAllGlobals();
	});

	it("toasts an error when the image upload itself fails", async () => {
		vi.stubGlobal("FileReader", FakeFileReader);
		mocks.uploadImage.mockRejectedValue(new Error("Upload failed"));

		const user = userEvent.setup();
		const { fileInput } = renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const file = new File([new Uint8Array(64)], "photo.png", {
			type: "image/png",
		});
		await user.upload(fileInput(), file);

		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith("Upload failed", "err"),
		);
		vi.unstubAllGlobals();
	});

	it("marks the header when the thread was closed by an admin", async () => {
		mocks.get.mockResolvedValue({
			messages: [...SERVER_MESSAGES],
			thread: { thread_id: "anon-test", status: "closed" },
		});

		renderPage();
		await waitFor(() =>
			expect(screen.getByText(/closed by admin/i)).toBeTruthy(),
		);
	});

	it("renders an ADMIN badge on admin-sent messages", async () => {
		mocks.get.mockResolvedValue({
			messages: [
				{
					id: "adm-1",
					sender: "admin",
					body: "We are reviewing this.",
					created_at: "2026-08-01T09:30:00.000Z",
					read: false,
				},
			],
			thread: { thread_id: "anon-test", status: "open" },
		});

		renderPage();
		await waitFor(() => expect(screen.getByText("ADMIN")).toBeTruthy());
		expect(screen.getByText("We are reviewing this.")).toBeTruthy();
	});

	it("renders an image attachment inside a message bubble", async () => {
		mocks.get.mockResolvedValue({
			messages: [
				{
					id: "img-1",
					sender: "user",
					body: "",
					attachment_url: "https://img.example/receipt.png",
					created_at: "2026-08-01T09:45:00.000Z",
					read: true,
				},
			],
			thread: { thread_id: "anon-test", status: "open" },
		});

		renderPage();
		const img = await screen.findByAltText("attachment");
		expect(img).toBeTruthy();
		expect(img.getAttribute("src")).toBe("https://img.example/receipt.png");
	});

	it("opens the file picker when the attach button is clicked", async () => {
		const user = userEvent.setup();
		const { fileInput } = renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const clickSpy = vi
			.spyOn(fileInput(), "click")
			.mockImplementation(() => {});
		await user.click(screen.getByLabelText("Attach image"));
		expect(clickSpy).toHaveBeenCalled();
		clickSpy.mockRestore();
	});

	it("does not refetch this chat for another user's message", async () => {
		let push: ((table: string, payload: unknown) => void) | null = null;
		mocks.useRealtime.mockImplementation(
			(_events: string[], cb: (table: string, payload: unknown) => void) => {
				push = cb;
			},
		);

		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);
		expect(push).toBeTruthy();
		const initialReads = mocks.get.mock.calls.length;

		// chat_messages is a global table. A message in somebody else's thread
		// must not make every open user chat issue a full-thread request.
		push!("chat_messages", {
			eventType: "INSERT",
			new: { thread_id: "anon-someone-else" },
		});

		expect(mocks.get).toHaveBeenCalledTimes(initialReads);
	});

	it("raises a badge instead of reloading when a realtime event fires", async () => {
		let push: ((table: string, payload: unknown) => void) | null = null;
		mocks.useRealtime.mockImplementation(
			(_events: string[], cb: (table: string, payload: unknown) => void) => {
				push = cb;
			},
		);
		mocks.get.mockImplementation(() =>
			Promise.resolve({
				messages: [
					{
						id: "rt-1",
						sender: "ai",
						body: "Realtime fresh reply",
						created_at: "2026-08-01T11:00:00.000Z",
						read: false,
					},
				],
				thread: { thread_id: "anon-test", status: "open" },
			}),
		);

		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Realtime fresh reply")).toBeTruthy(),
		);
		expect(push).toBeTruthy();
		const readsBefore = mocks.get.mock.calls.length;

		// A realtime push for our own thread must NOT refetch — only the
		// badge appears. The thread reloads on one explicit tap.
		await act(async () => {
			push!("chat_messages", {
				eventType: "INSERT",
				new: { thread_id: "anon-test" },
			});
		});
		expect(mocks.get.mock.calls.length).toBe(readsBefore);
		expect(
			await screen.findByRole("button", { name: /View 1 new update/ }),
		).toBeInTheDocument();

		mocks.get.mockImplementation(() =>
			Promise.resolve({
				messages: [
					{
						id: "rt-1",
						sender: "ai",
						body: "Realtime fresh reply",
						created_at: "2026-08-01T11:00:00.000Z",
						read: false,
					},
					{
						id: "rt-2",
						sender: "ai",
						body: "Pushed update",
						created_at: "2026-08-01T11:01:00.000Z",
						read: false,
					},
				],
				thread: { thread_id: "anon-test", status: "open" },
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: /View 1 new update/ }));
		await waitFor(() => expect(screen.getByText("Pushed update")).toBeTruthy());
		expect(
			screen.queryByRole("button", { name: /View \d+ new update/ }),
		).toBeNull();
	});

	it("suppresses an attachment send while a message send is already in flight", async () => {
		// Regression: the sendingRef guard must drop a second send() while the
		// first request is in flight (the AI-reply window is up to 35s). The send
		// button is disabled while busy, but the attach flow calls send() directly
		// with only an attachment_url — Enter + attach in quick succession must
		// not produce a duplicate post.
		vi.stubGlobal("FileReader", FakeFileReader);
		mocks.uploadImage.mockResolvedValue(
			"https://img.example/while-sending.png",
		);
		mocks.postInbox.mockReturnValue(new Promise(() => {})); // first send never resolves
		mocks.get.mockImplementation(() =>
			Promise.resolve({
				messages: [...SERVER_MESSAGES],
				thread: { thread_id: "anon-test", status: "open" },
			}),
		);

		const user = userEvent.setup();
		const { fileInput } = renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);

		const input = screen.getByLabelText("Chat message");
		// Kick off the first send (Enter), then attach an image while it is still
		// pending — the attachment send must be suppressed by the guard.
		fireEvent.change(input, { target: { value: "rapid fire" } });
		fireEvent.keyDown(input, { key: "Enter" });

		const file = new File([new Uint8Array(64)], "photo.png", {
			type: "image/png",
		});
		await user.upload(fileInput(), file);
		await new Promise((r) => setTimeout(r, 50)); // let the FileReader onload run

		expect(mocks.postInbox).toHaveBeenCalledTimes(1);
		expect(mocks.uploadImage).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
// ─── Loader reflects real load state ─────────────────────────────
//
// The loader used to be held for VB_FULL_CYCLE_MS — 16000ms (5 motives
// x 3200ms) — UNCONDITIONALLY, even when the inbox had already answered.
// That turned a ~50ms response into a 16s wait, and made a genuine load
// failure indistinguishable from a slow network: the "cover the problem
// with a spinner" antipattern. The previous test asserted that behaviour
// as if it were a requirement, which is exactly how it survived.
//
// The only defensible hold is a tiny anti-flicker floor (~250ms): a loader
// that appears for 30ms and vanishes reads as a rendering glitch.

describe("UserChat loader minimum display time", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("releases the loader as soon as data is ready, with only a brief anti-flicker floor", async () => {
		vi.useFakeTimers();
		mocks.get.mockResolvedValue({
			messages: [...SERVER_MESSAGES],
			thread: { thread_id: "anon-test", status: "open" },
		});

		renderPage();
		// Flush the mount fetch (microtasks don't advance under fake timers).
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		// Data rendered.
		expect(screen.getByText("Hello! How can I help?")).toBeTruthy();

		// Far short of the old 16s story cycle the loader is gone. If this
		// regresses, a fast inbox looks like a 16s stall to a real user.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(screen.queryByTestId("ai-loader")).not.toBeInTheDocument();
	});

	it("keeps the loader up while the request is genuinely still in flight", async () => {
		vi.useFakeTimers();
		// Never resolves: the request is hung, not slow-but-arriving.
		mocks.get.mockImplementation(() => new Promise(() => {}));

		renderPage();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		// A hung request must stay visibly loading rather than resolve to an
		// empty thread that reads as "you have no messages".
		expect(screen.getByTestId("ai-loader")).toBeTruthy();
	});
});

describe("UserChat — draft note", () => {
	it("tells the student a draft went to admin review without overwriting triage", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			expect(screen.getByText("Hello! How can I help?")).toBeTruthy(),
		);
		mocks.postInbox.mockResolvedValue({
			message: { id: "db-u-9", sender: "user", body: "post this please", created_at: "2026-08-01T10:01:00.000Z", read: true },
			auto_reply: null,
			emotion: { level: "none" },
			triage: { reported: true, urgency: "normal", private: true },
			draft_proposed: true,
		});
		await user.type(screen.getByLabelText("Chat message"), "post this please");
		await user.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => expect(screen.getByText(/Filed as a private report/)).toBeTruthy());
		expect(screen.getByText(/drafted a post from what you asked/)).toBeTruthy();
	});
});

describe("UserChat — in-chat draft card", () => {
	const DRAFT = {
		title: "Broken lift in Block C",
		description: "The lift has been broken for two days.",
		category: "Facilities",
		private: true,
	};

	async function sendWithDraft(user: unknown) {
		(mocks.postInbox as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
			message: { id: "db-u-7", sender: "user", body: "post this please", created_at: "2026-08-01T10:01:00.000Z", read: true },
			auto_reply: null,
			emotion: { level: "none" },
			triage: { reported: false, urgency: "none", private: false },
			draft_proposed: true,
			draft: DRAFT,
		});
		const u = user as { type: (el: Element, text: string) => Promise<void>; click: (el: Element) => Promise<void> };
		await u.type(screen.getByLabelText("Chat message"), "post this please");
		await u.click(screen.getByRole("button", { name: /send/i }));
		await screen.findByTestId("draft-card");
	}

	it("shows the draft with a visibility choice and dismiss", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() => expect(screen.getByText("Hello! How can I help?")).toBeTruthy());
		await sendWithDraft(user);

		expect(screen.getByText("Broken lift in Block C")).toBeInTheDocument();
		expect(screen.getByText("Facilities")).toBeInTheDocument();
		expect(screen.getByText("Suggested post — your call")).toBeInTheDocument();
		// Private is the default.
		expect(screen.getByRole("radio", { name: /private/i })).toHaveAttribute("aria-checked", "true");

		await user.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByTestId("draft-card")).not.toBeInTheDocument();
		// Dismissing posts nothing.
		expect(mocks.postInbox).not.toHaveBeenCalledWith(
			"/api/inbox",
			expect.objectContaining({ action: "accept_own_draft" }),
		);
	});

	it("accept publishes privately through the owner endpoint", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() => expect(screen.getByText("Hello! How can I help?")).toBeTruthy());
		await sendWithDraft(user);

		(mocks.postInbox as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
		await user.click(screen.getByRole("button", { name: "Post privately" }));
		await waitFor(() => {
			expect(mocks.postInbox).toHaveBeenCalledWith("/api/inbox", {
				thread_id: "anon-test",
				action: "accept_own_draft",
				visibility: "private",
			});
		});
		expect(screen.queryByTestId("draft-card")).not.toBeInTheDocument();
		expect(screen.getByText(/private post is live/)).toBeInTheDocument();
	});

	it("accept as public sends for review instead of publishing", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() => expect(screen.getByText("Hello! How can I help?")).toBeTruthy());
		await sendWithDraft(user);

		await user.click(screen.getByRole("radio", { name: /public/i }));
		expect(screen.getByText(/reviewed by an admin before anyone sees them/)).toBeInTheDocument();
		(mocks.postInbox as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: "pending_review" });
		await user.click(screen.getByRole("button", { name: "Send for review" }));
		await waitFor(() => {
			expect(mocks.postInbox).toHaveBeenCalledWith("/api/inbox", {
				thread_id: "anon-test",
				action: "accept_own_draft",
				visibility: "public",
			});
		});
		expect(screen.queryByTestId("draft-card")).not.toBeInTheDocument();
		expect(screen.getByText(/goes public once approved/)).toBeInTheDocument();
	});
});

describe("UserChat — typewriter reveal and read-aloud toggle", () => {
	it("reveals the fresh AI reply with the typewriter, history stays plain", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() => expect(screen.getByText("Hello! How can I help?")).toBeTruthy());
		mocks.postInbox.mockResolvedValue({
			message: { id: "db-u-8", sender: "user", body: "hi again", created_at: "2026-08-01T10:02:00.000Z", read: true },
			auto_reply: { id: "db-ai-8", sender: "ai", body: "Fresh streamed reply here", created_at: "2026-08-01T10:02:01.000Z", read: false },
			emotion: { level: "none" },
			triage: { reported: false, urgency: "none", private: false },
		});
		await user.type(screen.getByLabelText("Chat message"), "hi again");
		await user.click(screen.getByRole("button", { name: /send/i }));

		// The fresh bubble carries the typewriter caret; the older AI bubble does not stream.
		await waitFor(() => expect(document.querySelector(".vb-caret")).toBeTruthy());
		expect(screen.getByLabelText("AI reply")).toBeInTheDocument();
	});

	it("toggles read-aloud and persists the choice", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() => expect(screen.getByLabelText("Chat message")).toBeInTheDocument());
		const toggle = screen.getByRole("button", { name: "Read AI replies aloud" });
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		await user.click(toggle);
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		expect(localStorage.getItem("vb:readaloud")).toBe("false");
	});
});

describe("UserChat — derived title + owner delete", () => {
	function mockThread(title?: string) {
		mocks.get.mockResolvedValue({
			messages: [...SERVER_MESSAGES],
			thread: { thread_id: "anon-test", status: "open" },
			...(title !== undefined ? { title } : {}),
		});
		mocks.put.mockResolvedValue({ ok: true });
	}

	it("shows the server-derived title, never an invented one", async () => {
		mockThread("my canteen complaint");
		renderPage();
		expect(await screen.findByTestId("chat-title")).toHaveTextContent(
			"my canteen complaint",
		);
	});

	it("hides the title line when the server sends none", async () => {
		mockThread(undefined);
		renderPage();
		await waitFor(() => expect(screen.getByText("Hello! How can I help?")).toBeTruthy());
		expect(screen.queryByTestId("chat-title")).toBeNull();
	});

	it("deletes the conversation after confirm and clears the view", async () => {
		mockThread("my canteen complaint");
		mocks.post.mockResolvedValue({ ok: true });
		const user = userEvent.setup();
		renderPage();
		await screen.findByTestId("chat-title");
		await user.click(screen.getByRole("button", { name: "Delete conversation" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() =>
		expect(mocks.post).toHaveBeenCalledWith("/api/inbox", {
			action: "delete_thread",
			thread_id: "anon-test",
		}),
		);
		expect(mocks.toast).toHaveBeenCalledWith("Conversation deleted", "ok");
		expect(screen.queryByTestId("chat-title")).toBeNull();
	});

	it("reports a failed delete honestly and keeps the conversation", async () => {
		mockThread("my canteen complaint");
		mocks.post.mockRejectedValueOnce(new Error("You can only delete your own conversation"));
		const user = userEvent.setup();
		renderPage();
		await screen.findByTestId("chat-title");
		await user.click(screen.getByRole("button", { name: "Delete conversation" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() =>
		expect(mocks.toast).toHaveBeenCalledWith("You can only delete your own conversation", "err"),
		);
		expect(screen.getByTestId("chat-title")).toBeInTheDocument();
	});
});
