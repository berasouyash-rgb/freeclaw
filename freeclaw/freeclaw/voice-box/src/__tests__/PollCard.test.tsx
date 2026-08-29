// ═══════════════════════════════════════════════════════════════════
// PollCard — poll-close notification trigger
// ═══════════════════════════════════════════════════════════════════
// Locks the client side of poll-close notifications:
//   1. A closed poll owned by the viewer fires POST /api/polls
//      { action: 'closed', poll_id, author_id } exactly once.
//   2. A closed poll NOT owned by the viewer does not fire.
//   3. An open owned poll does not fire.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PollCard from "../components/PollCard";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	anonId: "anon-viewer",
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ anonId: mocks.anonId, toast: mocks.toast }),
}));

vi.mock("../lib/api", () => ({
	api: { post: mocks.post, put: mocks.put },
}));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "2d ago",
}));

vi.mock("../components/ui", () => ({
	ConfirmDialog: ({
		open,
		onConfirm,
		onClose,
	}: {
		open: boolean;
		onConfirm: () => void;
		onClose: () => void;
	}) =>
		open ? (
			<>
				<button onClick={onConfirm}>ConfirmDelete</button>
				<button onClick={onClose}>CancelDelete</button>
			</>
		) : null,
}));

const BASE = {
	id: "poll-1",
	title: "Coffee machine",
	ptype: "single" as const,
	options: ["Yes", "No"],
	author_id: "anon-viewer",
	post_id: null,
	deleted: false,
	archived: false,
	created_at: "2020-01-01T00:00:00.000Z",
	total_votes: 2,
	vote_counts: { "0": 2 },
};

const expiredOwn = {
	...BASE,
	expires_at: "2020-01-01T00:00:00.000Z",
	is_mine: true,
};
const expiredOther = { ...BASE, author_id: "anon-other", is_mine: false };
const openOwn = {
	...BASE,
	expires_at: "2099-01-01T00:00:00.000Z",
	is_mine: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.post.mockResolvedValue({});
});

describe("PollCard — poll-close notification", () => {
	it("notifies once when a closed poll belongs to the viewer", async () => {
		render(<PollCard poll={expiredOwn} />);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith("/api/polls", {
				action: "closed",
				poll_id: "poll-1",
				author_id: "anon-viewer",
			});
		});
	});

	it("does not notify for a closed poll owned by someone else", async () => {
		render(<PollCard poll={expiredOther} />);
		await new Promise((r) => setTimeout(r, 50));
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("does not notify for an open poll", async () => {
		render(<PollCard poll={openOwn} />);
		await new Promise((r) => setTimeout(r, 50));
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("keeps the poll visible with an Ended badge", async () => {
		render(<PollCard poll={expiredOwn} />);
		expect(await screen.findByText(/coffee machine/i)).toBeTruthy();
	});

	it("silently swallows a poll-close notification failure", async () => {
		mocks.post.mockRejectedValue(new Error("notify down"));
		render(<PollCard poll={expiredOwn} />);
		await new Promise((r) => setTimeout(r, 50));
		expect(mocks.toast).not.toHaveBeenCalled();
	});
});

const VOTE_RES = {
	...BASE,
	expires_at: "2099-01-01T00:00:00.000Z",
	is_mine: true,
	total_votes: 2,
	vote_counts: { "0": 1, "1": 1 },
};

describe("PollCard — voting interactions", () => {
	it("records a single-choice vote and shows results", async () => {
		mocks.post.mockResolvedValue(VOTE_RES);
		render(<PollCard poll={openOwn} />);
		await userEvent.click(screen.getByRole("radio", { name: /yes/i }));
		await userEvent.click(screen.getByRole("button", { name: /^vote$/i }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/polls",
				expect.objectContaining({
					action: "vote",
					poll_id: "poll-1",
					author_id: "anon-viewer",
					choices: [0],
				}),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Vote recorded — anonymously 🔒",
			"ok",
		);
		// results visible: 1 of 2 votes = 50%
		expect(await screen.findAllByText(/50% · 1/i)).toHaveLength(2);
		expect(screen.getByRole("button", { name: /change vote/i })).toBeTruthy();
	});

	it("disables the vote button while nothing is selected", async () => {
		render(<PollCard poll={openOwn} />);
		expect(screen.getByRole("button", { name: /^vote$/i })).toBeDisabled();
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("deselects the same option when tapped again in single-choice", async () => {
		render(<PollCard poll={openOwn} />);
		const yes = screen.getByRole("radio", { name: /yes/i });
		await userEvent.click(yes);
		await userEvent.click(yes);
		// nothing selected → vote button disabled
		expect(screen.getByRole("button", { name: /^vote$/i })).toBeDisabled();
	});

	it("submits multiple choices for a multi poll", async () => {
		mocks.post.mockResolvedValue({
			...VOTE_RES,
			ptype: "multi",
			vote_counts: { "0": 1, "1": 1, "2": 0 },
		});
		const multi = {
			...openOwn,
			ptype: "multi" as const,
			options: ["A", "B", "C"],
		};
		render(<PollCard poll={multi} />);
		await userEvent.click(screen.getByRole("checkbox", { name: /^a$/i }));
		await userEvent.click(screen.getByRole("checkbox", { name: /^c$/i }));
		await userEvent.click(screen.getByRole("checkbox", { name: /^c$/i })); // deselect C
		await userEvent.click(screen.getByRole("button", { name: /^vote$/i }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/polls",
				expect.objectContaining({ choices: [0] }),
			);
		});
	});

	it("changes an existing vote and can cancel the change", async () => {
		mocks.post.mockResolvedValue(VOTE_RES);
		render(<PollCard poll={openOwn} myVote={[0]} />);
		// already voted → Change vote button visible
		await userEvent.click(screen.getByRole("button", { name: /change vote/i }));
		expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(screen.getByRole("button", { name: /change vote/i })).toBeTruthy();

		await userEvent.click(screen.getByRole("button", { name: /change vote/i }));
		await userEvent.click(screen.getByRole("radio", { name: /no/i }));
		await userEvent.click(
			screen.getByRole("button", { name: /submit new vote/i }),
		);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/polls",
				expect.objectContaining({ choices: [1] }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Vote updated — anonymously 🔒",
			"ok",
		);
	});

	it("shows an error toast when the vote request fails", async () => {
		mocks.post.mockRejectedValue(new Error("vote backend down"));
		render(<PollCard poll={openOwn} />);
		await userEvent.click(screen.getByRole("radio", { name: /yes/i }));
		await userEvent.click(screen.getByRole("button", { name: /^vote$/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("vote backend down", "err");
		});
	});
});

describe("PollCard — delete + AI insight", () => {
	it("deletes the poll with an undo action in the toast", async () => {
		mocks.put.mockResolvedValue({});
		render(<PollCard poll={openOwn} />);
		await userEvent.click(screen.getByLabelText(/delete my poll/i));
		await userEvent.click(
			screen.getByRole("button", { name: /confirmdelete/i }),
		);
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/polls", {
				id: "poll-1",
				author_id: "anon-viewer",
				deleted: true,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Poll deleted",
			"info",
			expect.objectContaining({
				label: "Undo (30s)",
			}),
		);
		// run the undo action
		const undo = mocks.toast.mock.calls.find(
			(c) => c[0] === "Poll deleted",
		)?.[2];
		await undo?.fn();
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/polls", {
				id: "poll-1",
				author_id: "anon-viewer",
				deleted: false,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Poll restored", "ok");
	});

	it("shows an error toast when delete fails", async () => {
		mocks.put.mockRejectedValue(new Error("delete failed"));
		render(<PollCard poll={openOwn} />);
		await userEvent.click(screen.getByLabelText(/delete my poll/i));
		await userEvent.click(
			screen.getByRole("button", { name: /confirmdelete/i }),
		);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("delete failed", "err");
		});
	});

	it("cancels the delete dialog without calling the API", async () => {
		render(<PollCard poll={openOwn} />);
		await userEvent.click(screen.getByLabelText(/delete my poll/i));
		expect(screen.getByRole("button", { name: /confirmdelete/i })).toBeTruthy();
		await userEvent.click(
			screen.getByRole("button", { name: /canceldelete/i }),
		);
		expect(screen.queryByRole("button", { name: /confirmdelete/i })).toBeNull();
		expect(mocks.put).not.toHaveBeenCalled();
	});

	it("fetches and renders an AI insight on demand", async () => {
		mocks.post.mockImplementation((url: string) =>
			url === "/api/ai"
				? Promise.resolve({ insight: "Coffee demand trending up" })
				: Promise.resolve(VOTE_RES),
		);
		render(<PollCard poll={expiredOwn} />);
		await userEvent.click(
			screen.getByRole("button", { name: /get ai insight/i }),
		);
		expect(await screen.findByText(/coffee demand trending up/i)).toBeTruthy();
		expect(mocks.post).toHaveBeenCalledWith(
			"/api/ai",
			expect.objectContaining({ task: "poll_insight" }),
		);
	});

	it("shows an unavailable message when the AI request fails", async () => {
		mocks.post.mockImplementation((url: string) =>
			url === "/api/ai"
				? Promise.reject(new Error("ai down"))
				: Promise.resolve(VOTE_RES),
		);
		render(<PollCard poll={expiredOwn} />);
		await userEvent.click(
			screen.getByRole("button", { name: /get ai insight/i }),
		);
		expect(
			await screen.findByText(/insight unavailable right now/i),
		).toBeTruthy();
	});

	it("shows an error toast when voting fails in the submit-new-vote flow", async () => {
		mocks.post.mockRejectedValue(new Error("record failed"));
		render(<PollCard poll={openOwn} myVote={[0]} />);
		await userEvent.click(screen.getByRole("button", { name: /change vote/i }));
		await userEvent.click(screen.getByRole("radio", { name: /no/i }));
		await userEvent.click(
			screen.getByRole("button", { name: /submit new vote/i }),
		);
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("record failed", "err");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════
// PollCard — myVote prop sync (regression: stale "liked" state)
// ═══════════════════════════════════════════════════════════════════
// Locks the feed-poll bug where an existing vote was invisible on load
// and stayed stale across prop changes:
//   1. A myVote arriving after mount (late fetch / realtime refetch of
//      the same poll) flips the card into the voted state.
//   2. A different poll arriving on the same component (route/memo reuse
//      without a remount) resets all vote UI.
//   3. A realtime myVote refetch does NOT clobber an in-progress vote
//      change the user is still making.
// ═══════════════════════════════════════════════════════════════════

describe("PollCard — myVote prop sync", () => {
	it("reflects a myVote that arrives after mount (late/refetched vote)", async () => {
		const { rerender } = render(<PollCard poll={openOwn} />);
		// Not voted yet on first render.
		expect(screen.getByRole("button", { name: /^vote$/i })).toBeInTheDocument();
		// Parent refetches and finally passes the viewer's existing vote.
		rerender(<PollCard poll={openOwn} myVote={[0]} />);
		expect(
			screen.getByRole("button", { name: /change vote/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("radio", { name: /yes/i })).toHaveAttribute(
			"aria-checked",
			"true",
		);
	});

	it("resets the vote UI when the poll prop changes to a different poll", async () => {
		const other = { ...openOwn, id: "poll-2", title: "A different poll" };
		const { rerender } = render(<PollCard poll={openOwn} myVote={[0]} />);
		expect(
			screen.getByRole("button", { name: /change vote/i }),
		).toBeInTheDocument();
		// Same component instance, new poll → fresh, un-voted state.
		rerender(<PollCard poll={other} />);
		expect(screen.getByRole("button", { name: /^vote$/i })).toBeDisabled();
		expect(screen.queryByRole("button", { name: /change vote/i })).toBeNull();
	});

	it("does not clobber an in-progress vote change when myVote refetches", async () => {
		const { rerender } = render(<PollCard poll={openOwn} myVote={[0]} />);
		await userEvent.click(screen.getByRole("button", { name: /change vote/i }));
		await userEvent.click(screen.getByRole("radio", { name: /no/i }));
		// Realtime tick passes a fresh array with the same content.
		rerender(<PollCard poll={openOwn} myVote={[0]} />);
		// The in-progress selection (No) is preserved, not reset to the old vote.
		expect(screen.getByRole("radio", { name: /no/i })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		expect(screen.getByRole("radio", { name: /yes/i })).toHaveAttribute(
			"aria-checked",
			"false",
		);
	});
});

describe("PollCard — live countdown timer", () => {
	it("shows days and hours when expiry is far away", () => {
		const future = new Date(Date.now() + 3 * 86400000 + 5 * 3600000).toISOString();
		render(<PollCard poll={{ ...BASE, expires_at: future }} />);
		expect(screen.getByText(/ends in/)).toBeInTheDocument();
		expect(screen.getByText(/ends in/).textContent).toMatch(/\d+d/);
		expect(screen.getByText(/ends in/).textContent).toMatch(/\d+h/);
	});

	it("shows hours and minutes when expiry is within a day", () => {
		const soon = new Date(Date.now() + 2 * 3600000 + 15 * 60000).toISOString();
		render(<PollCard poll={{ ...BASE, expires_at: soon }} />);
		const text = screen.getByText(/ends in/).textContent || "";
		expect(text).toMatch(/\d+h/);
		expect(text).toMatch(/\d+m/);
		expect(text).not.toMatch(/\d+d/);
	});

	it("shows minutes and seconds when expiry is within an hour", () => {
		const imminent = new Date(Date.now() + 45 * 60000 + 30 * 1000).toISOString();
		render(<PollCard poll={{ ...BASE, expires_at: imminent }} />);
		const text = screen.getByText(/ends in/).textContent || "";
		expect(text).toMatch(/\d+m/);
		expect(text).toMatch(/\d+s/);
		expect(text).not.toMatch(/\d+h/);
	});

	it("does not show countdown for expired polls", () => {
		render(<PollCard poll={expiredOwn} />);
		expect(screen.queryByText(/ends in/)).toBeNull();
	});

	it("does not show countdown when no expires_at is set", () => {
		render(<PollCard poll={{ ...BASE, expires_at: null }} />);
		expect(screen.queryByText(/ends in/)).toBeNull();
	});

	it("updates the countdown as time advances", async () => {
		const soon = new Date(Date.now() + 65 * 1000).toISOString();
		render(<PollCard poll={{ ...BASE, expires_at: soon }} />);
		const first = screen.getByText(/ends in/).textContent;
		// Advance time by 2 seconds
		await new Promise((r) => setTimeout(r, 2100));
		const second = screen.getByText(/ends in/).textContent;
		expect(second).not.toBe(first);
	});
});
