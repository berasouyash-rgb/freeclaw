// ═══════════════════════════════════════════════════════════════════
// PostCard — admin moderation directly in the feed
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • admin bar hidden for regular users (no session)
//   • admin bar visible with an active admin session
//   • In progress / Solve / Verify / Official / Hide → real /api/posts PUT
//   • Official reply form (open, validation, submit, success toast)
//   • failure toasts on API errors
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostCard from "../components/PostCard";
import type { PostData } from "../types";

// Keep the real hasAdminSession() (reads sessionStorage) but stub the api.
vi.mock("../lib/api", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../lib/api")>();
	return {
		...mod,
		api: {
			get: vi.fn(async () => []),
			getSlow: vi.fn(async () => []),
			post: vi.fn(async () => ({})),
			put: vi.fn(async () => ({})),
			del: vi.fn(async () => ({})),
			getLong: vi.fn(async () => []),
			postLong: vi.fn(async () => []),
		},
	};
});

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon_test",
		bookmarks: [],
		toggleBookmark: vi.fn(),
		toast: toastMock,
		theme: "light",
	}),
}));

import { api } from "../lib/api";
const mockedPut = api.put as ReturnType<typeof vi.fn>;

const toastMock = vi.fn();

const POST: PostData = {
	id: "post-1",
	type: "problem",
	title: "Broken lift in Block C",
	description: "The lift has been stuck since morning.",
	category: "Facilities",
	status: "open",
	priority: "high",
	author_id: "anon_test",
	created_at: new Date(Date.now() - 120_000).toISOString(),
	reactions: { support: 14 },
	comment_count: 3,
	status_history: [],
	deleted: false,
} as unknown as PostData;

const FUTURE = String(Date.now() + 3600_000);
function asAdmin() {
	sessionStorage.setItem(
		"vb:adminAuth",
		JSON.stringify({ token: "t", exp: FUTURE }),
	);
}
function asUser() {
	sessionStorage.removeItem("vb:adminAuth");
}

function renderCard(overrides: Partial<PostData> = {}) {
	return render(
		<MemoryRouter>
			<PostCard post={{ ...POST, ...overrides }} />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	asUser();
});

describe("PostCard admin moderation bar", () => {
	it("is hidden for regular users with no admin session", () => {
		renderCard();
		expect(screen.queryByText("Moderation")).not.toBeInTheDocument();
		expect(screen.queryByTitle("Mark solved")).not.toBeInTheDocument();
		expect(screen.queryByText("Solve")).not.toBeInTheDocument();
	});

	it("is visible when an admin session is active", () => {
		asAdmin();
		renderCard();
		expect(screen.getByText("Moderation")).toBeInTheDocument();
		expect(screen.getByTitle("Mark solved")).toBeInTheDocument();
		expect(screen.getByTitle("Mark as official")).toBeInTheDocument();
		expect(screen.getByTitle("Hide post")).toBeInTheDocument();
	});

	it("marks a post in progress through the real posts API", async () => {
		asAdmin();
		renderCard();
		fireEvent.click(screen.getByTitle("Mark in progress"));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				status: "in_progress",
			});
		});
		expect(toastMock).toHaveBeenCalledWith("Marked in progress", "ok");
	});

	it("marks a post solved through the real posts API", async () => {
		asAdmin();
		renderCard();
		fireEvent.click(screen.getByTitle("Mark solved"));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				status: "solved",
			});
		});
		expect(toastMock).toHaveBeenCalledWith(
			"Issue marked solved — community notified",
			"ok",
		);
	});

	it("marks a post verified through the real posts API", async () => {
		asAdmin();
		renderCard();
		fireEvent.click(screen.getByTitle("Verify this post"));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				status: "verified",
			});
		});
		expect(toastMock).toHaveBeenCalledWith("Marked verified", "ok");
	});

	it("toggles the official badge", async () => {
		asAdmin();
		renderCard();
		fireEvent.click(screen.getByTitle("Mark as official"));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				official: true,
			});
		});
		expect(toastMock).toHaveBeenCalledWith("Marked official", "ok");
	});

	it("hides a post (and can unhide when already hidden)", async () => {
		asAdmin();
		renderCard();
		fireEvent.click(screen.getByTitle("Hide post"));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				hidden: true,
			});
		});
		expect(toastMock).toHaveBeenCalledWith("Post hidden", "ok");
	});

	it("hides the solve/in-progress/verify buttons once a post is solved", () => {
		asAdmin();
		renderCard({ status: "solved" });
		expect(screen.queryByTitle("Mark solved")).not.toBeInTheDocument();
		expect(screen.queryByTitle("Mark in progress")).not.toBeInTheDocument();
		expect(screen.queryByTitle("Verify this post")).not.toBeInTheDocument();
		// Official / Hide / Reply remain available for solved posts
		expect(screen.getByTitle("Mark as official")).toBeInTheDocument();
	});

	it("opens an official reply form and submits via the API", async () => {
		asAdmin();
		renderCard();
		fireEvent.click(screen.getByTitle("Post an official admin reply on this post"));
		const input = screen.getByLabelText("Official admin reply");
		fireEvent.change(input, { target: { value: "We are fixing this today." } });
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith("/api/posts", {
				id: "post-1",
				admin_reply: "We are fixing this today.",
			});
		});
		expect(toastMock).toHaveBeenCalledWith(
			"Official reply posted — visible on the post",
			"ok",
		);
		// form closes after a successful send
		expect(screen.queryByLabelText("Official admin reply")).not.toBeInTheDocument();
	});

	it("keeps the reply send button disabled while the message is empty", () => {
		asAdmin();
		renderCard();
		fireEvent.click(screen.getByTitle("Post an official admin reply on this post"));
		const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
		expect(send.disabled).toBe(true);
	});

	it("toasts an error when an admin action fails", async () => {
		asAdmin();
		mockedPut.mockRejectedValueOnce(new Error("403 Admin only"));
		renderCard();
		fireEvent.click(screen.getByTitle("Mark solved"));
		await waitFor(() => {
			expect(toastMock).toHaveBeenCalledWith("403 Admin only", "err");
		});
	});

	it("does not double-fire while a previous admin action is in flight", async () => {
		asAdmin();
		let resolve!: (v: unknown) => void;
		mockedPut.mockImplementationOnce(
			() => new Promise((r) => (resolve = r)),
		);
		renderCard();
		const btn = screen.getByTitle("Mark solved");
		fireEvent.click(btn);
		fireEvent.click(btn);
		expect(mockedPut).toHaveBeenCalledTimes(1);
		resolve({});
	});
});
