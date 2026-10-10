// ═══════════════════════════════════════════════════════════════════
// Comment composer gate — pre-submit verdict must equal the server's
// (api/_comments.js POST/PUT → serverModerate on the RAW body)
// ═══════════════════════════════════════════════════════════════════
// Three failure modes are pinned here:
//
// 1. THE MASKED-GATE HOLE. The composer used to send the pre-masked string,
//    so the server's gate saw "f***" instead of what was typed. Masking
//    happens at INSERT time on the server — the request body must be raw.
//
// 2. THE PII MISS. `isBlocked` only checks critical severity; the server
//    403s ANY privacy flag on comments (no review queue exists for them).
//    The client must hard-block PII before the optimistic "sent" row appears.
//
// 3. THE UNGATED EDIT. saveEdit posted with no gate at all, so an edit with
//    PII was rejected after Save with an unexplained failure.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Comments from "../components/Comments";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	pushNotif: vi.fn(),
	get: vi.fn(),
	getFresh: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	queuedCount: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getFresh: mocks.getFresh,
		post: mocks.post,
		put: mocks.put,
		del: mocks.del,
	},
	hasAdminSession: () => false,
	queuedCount: mocks.queuedCount,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		accountStatus: null,
		pushNotif: mocks.pushNotif,
	}),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => {},
}));

vi.mock("../lib/identity", () => ({
	checkCooldown: () => 0,
	stampCooldown: vi.fn(),
	lsGet: (_k: string, fallback: unknown) => fallback,
	lsSet: vi.fn(),
}));

vi.mock("../components/ui", () => ({
	ReportDialog: () => null,
}));

// REAL moderation is deliberately NOT mocked — this test is about the exact
// verdict the real detectors produce.

const SERVER_COMMENT = {
	id: "c-1",
	post_id: "p-1",
	parent_id: null,
	body: "existing comment",
	author_id: "anon-other",
	is_admin: false,
	created_at: new Date().toISOString(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.queuedCount.mockReturnValue(0);
	mocks.get.mockResolvedValue([SERVER_COMMENT]);
	mocks.getFresh.mockResolvedValue([SERVER_COMMENT]);
	mocks.post.mockResolvedValue({ ok: true });
	mocks.put.mockResolvedValue({ ok: true });
});

const typeAndSend = async (value: string) => {
	render(<Comments postId="p-1" />);
	// Wait for the initial load — otherwise its setComments lands AFTER the
	// optimistic row and silently wipes it.
	await screen.findByText("existing comment");
	const input = screen.getByLabelText("Comment text");
	fireEvent.change(input, { target: { value } });
	fireEvent.click(screen.getByLabelText("Send comment"));
};

describe("Comment composer gate", () => {
	it("shows a recoverable error when the initial comment read fails", async () => {
		mocks.get.mockRejectedValueOnce(new Error("comments are temporarily unavailable"));
		render(<Comments postId="p-1" />);

		await waitFor(() =>
			expect(screen.getByRole("alert")).toHaveTextContent(
				/comments are temporarily unavailable/i,
			),
		);
		expect(screen.getByRole("button", { name: /retry comments/i })).toBeInTheDocument();

		mocks.get.mockResolvedValue([SERVER_COMMENT]);
		fireEvent.click(screen.getByRole("button", { name: /retry comments/i }));
		expect(await screen.findByText("existing comment")).toBeInTheDocument();
	});

	it("blocks PII before sending — no request, server-verbatim PII message", async () => {
		await typeAndSend("email me at john.doe@example.com");
		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("Personal information detected"),
				"err",
			),
		);
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("blocks critical content before sending — no request", async () => {
		await typeAndSend("I will kill you right now");
		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("safety guidelines"),
				"err",
			),
		);
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("blocks slang before sending — no stars are published, no request", async () => {
		await typeAndSend("this assignment really sucks");
		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("safety guidelines"),
				"err",
			),
		);
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("blocks profanity before sending — remove the word and resubmit", async () => {
		await typeAndSend("This is fucking ridiculous");
		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				expect.stringContaining("safety guidelines"),
				"err",
			),
		);
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("sends the RAW body while the optimistic row shows the masked text", async () => {
		// Never resolve: keeps the optimistic row on screen so we can inspect it
		// before the authoritative list replaces it. Clean text (no blockable
		// words) proves the raw-body path; profanity never reaches the wire now.
		mocks.post.mockReturnValue(new Promise(() => {}));
		await typeAndSend("The water cooler on Block B is broken again");
		await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
		const payload = mocks.post.mock.calls[0]?.[1] as { body: string };
		// The server gate must see what was actually typed...
		expect(payload.body).toBe("The water cooler on Block B is broken again");
		// ...and the optimistic row echoes it back verbatim.
		await waitFor(() =>
			expect(screen.getByText(/water cooler on Block B/i)).toBeInTheDocument(),
		);
	});

	it("gates the edit path — PII in an edit blocks Save with no request", async () => {
		mocks.get.mockResolvedValue([
			{ ...SERVER_COMMENT, author_id: "anon-test", is_mine: true },
		]);
		render(<Comments postId="p-1" />);
		fireEvent.click(await screen.findByText("Edit"));
		const editInput = screen.getByLabelText("Edit comment");
		fireEvent.change(editInput, {
			target: { value: "my address is 123 Main Street" },
		});
		// Debounced verdict (200ms) must disable Save.
		await waitFor(
			() => expect(screen.getByLabelText("Save edit")).toBeDisabled(),
			{ timeout: 2000 },
		);
		fireEvent.click(screen.getByLabelText("Save edit"));
		expect(mocks.put).not.toHaveBeenCalled();
	});
});
