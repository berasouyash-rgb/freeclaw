// ═══════════════════════════════════════════════════════════════════
// MyActivity — full activity hub contract
// ═══════════════════════════════════════════════════════════════════
// Locks: tab rendering & switching across all 8 tabs, post/poll delete
// with undo toasts, reset-anonymous-ID, clear-local-data, replay
// tutorial, drafts (local), bookmarks fetch, notifications, viewed.
// ═══════════════════════════════════════════════════════════════════

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MyActivity from "../pages/MyActivity";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	navigate: vi.fn(),
	refreshIdentity: vi.fn(),
	resetAnonId: vi.fn(),
	clearAllLocalData: vi.fn(),
	resetTutorial: vi.fn(),
	downloadFile: vi.fn(),
	lsGet: vi.fn((_k: string): unknown => null),
	useAppState: {			anonId: "anon-test",
			displayName: "",
			profile: { avatar: "", bio: "" },
			notifications: [] as any[],
		bookmarks: [] as string[],
		recentlyViewed: [] as string[],
	},
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, put: mocks.put },
}));	vi.mock("../contexts/AppContext", () => ({
		useApp: () => ({
			anonId: mocks.useAppState.anonId,
			displayName: mocks.useAppState.displayName,
			toast: mocks.toast,
			refreshIdentity: mocks.refreshIdentity,
			notifications: mocks.useAppState.notifications,
			bookmarks: mocks.useAppState.bookmarks,
			recentlyViewed: mocks.useAppState.recentlyViewed,
			profile: mocks.useAppState.profile,
		}),
	}));

vi.mock("react-router", () => ({
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
	useNavigate: () => mocks.navigate,
}));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "2d ago",
	downloadFile: mocks.downloadFile,
	safeStringify: (obj: unknown) => JSON.stringify(obj, null, 2),
}));

vi.mock("../lib/identity", () => ({
	resetAnonId: mocks.resetAnonId,
	clearAllLocalData: mocks.clearAllLocalData,
	anonCreatedAt: () => "2026-07-01T10:00:00.000Z",
	lsGet: mocks.lsGet,
}));

vi.mock("../components/Tutorial", () => ({
	resetTutorial: mocks.resetTutorial,
}));

vi.mock("../components/ui", () => ({
	ConfirmDialog: ({ open, onClose, onConfirm, confirmLabel }: any) =>
		open ? (
			<div role="dialog">
				<button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
				<button onClick={onClose}>Cancel</button>
			</div>
		) : null,
}));

const POST = {
	id: "p1",
	title: "Broken projector",
	type: "problem",
	category: "Facilities",
	status: "reported",
	created_at: "2026-07-01T10:00:00.000Z",
};
const POLL = {
	id: "pl1",
	title: "Coffee brand?",
	total_votes: 3,
	ptype: "yesno",
	archived: false,
	created_at: "2026-07-01T10:00:00.000Z",
	is_mine: true,
	deleted: false,
};
const COMMENT = {
	id: "c1",
	body: "Thanks for reporting!",
	post_id: "p1",
	created_at: "2026-07-01T10:00:00.000Z",
};
const REACTION = {
	id: "r1",
	kind: "like",
	target_id: "p1",
	target_type: "post",
};
const VOTE = { choices: ["Option A", "Option B"] };

function defaultGet(url: string) {
	if (url.includes("/api/comments")) return Promise.resolve([COMMENT]);
	if (url.includes("/api/reactions")) return Promise.resolve([REACTION]);
	if (url.includes("voter=")) return Promise.resolve([VOTE]);
	if (url.includes("author=")) return Promise.resolve([POST]);
	if (url.includes("/api/polls")) return Promise.resolve([POLL]);
	if (url.includes("ids=")) return Promise.resolve([POST]);
	return Promise.resolve([]);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.useAppState.anonId = "anon-test";
	mocks.useAppState.notifications = [];
	mocks.useAppState.bookmarks = [];
	mocks.useAppState.recentlyViewed = [];
	mocks.lsGet.mockReturnValue(null);
	mocks.get.mockImplementation(defaultGet);
	mocks.put.mockResolvedValue({ success: true });
});

function renderPage() {
	return render(<MyActivity />);
}

function findUndoToast(title: string) {
	const call = mocks.toast.mock.calls.find((c) => c[0] === title);
	return call ? call[2] : undefined;
}

describe("MyActivity — profile card and tabs", () => {
	it("renders the anonymous profile card with the anon ID", async () => {
		renderPage();
		expect(await screen.findByText("Anonymous profile")).toBeInTheDocument();
		expect(screen.getByText(/anon-test/)).toBeInTheDocument();
	});

	it("renders all tab buttons with counts", async () => {
		renderPage();
		await screen.findByText("Anonymous profile");

		expect(screen.getByRole("button", { name: /Posts/ })).toHaveTextContent(
			"(1)",
		);
		expect(screen.getByRole("button", { name: /My Polls/ })).toHaveTextContent(
			"(1)",
		);
		expect(screen.getByRole("button", { name: /Comments/ })).toHaveTextContent(
			"(1)",
		);
		expect(screen.getByRole("button", { name: /Votes/ })).toHaveTextContent(
			"(2)",
		);
		expect(screen.getByRole("button", { name: /Bookmarks/ })).toHaveTextContent(
			"(0)",
		);
		expect(screen.getByRole("button", { name: /Drafts/ })).toHaveTextContent(
			"(0)",
		);
		expect(
			screen.getByRole("button", { name: /Notifications/ }),
		).toHaveTextContent("(0)");
		expect(
			screen.getByRole("button", { name: /Recently viewed/ }),
		).toHaveTextContent("(0)");
	});
});

describe("MyActivity — posts tab", () => {
	it("lists my posts with a link to the detail page", async () => {
		renderPage();
		expect(await screen.findByText("Broken projector")).toBeInTheDocument();
		expect(
			screen.getByText("problem · Facilities · reported · 2d ago"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Broken projector" }),
		).toHaveAttribute("href", "/post/p1");
	});

	it("shows the empty state when there are no posts", async () => {
		mocks.get.mockImplementation((url: string) =>
			url.includes("author=") ? Promise.resolve([]) : defaultGet(url),
		);
		renderPage();
		expect(
			await screen.findByText("You haven't posted anything yet."),
		).toBeInTheDocument();
	});

	it("deletes a post after confirmation and offers undo", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector");

		await user.click(screen.getByRole("button", { name: "Delete post" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);

		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				author_id: "anon-test",
				deleted: true,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Deleted",
			"info",
			expect.objectContaining({ label: "Undo (30s)" }),
		);
		expect(screen.queryByText("Broken projector")).not.toBeInTheDocument();

		// run the undo action
		const undo = findUndoToast("Deleted");
		await act(async () => {
			await undo.fn();
		});
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				author_id: "anon-test",
				deleted: false,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Restored", "ok");
	});

	it("does not delete when the dialog is cancelled", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector");

		await user.click(screen.getByRole("button", { name: "Delete post" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Cancel",
			}),
		);

		expect(mocks.put).not.toHaveBeenCalled();
		expect(screen.getByText("Broken projector")).toBeInTheDocument();
	});

	it("toasts an error when the post delete fails", async () => {
		mocks.put.mockRejectedValue(new Error("delete failed"));
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector");

		await user.click(screen.getByRole("button", { name: "Delete post" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("delete failed", "err");
		});
	});

	it("toasts a generic message when the post delete fails without an Error", async () => {
		mocks.put.mockRejectedValue("boom");
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Broken projector");

		await user.click(screen.getByRole("button", { name: "Delete post" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete",
			}),
		);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Delete failed", "err");
		});
	});
});

describe("MyActivity — polls tab", () => {
	it("lists my polls and offers a view link", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /My Polls/ }));
		expect(await screen.findByText("Coffee brand?")).toBeInTheDocument();
		expect(
			screen.getByText("3 votes · yesno · active · 2d ago"),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
			"href",
			"/polls",
		);
	});

	it("deletes a poll after confirmation and offers undo", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /My Polls/ }));
		await screen.findByText("Coffee brand?");
		await user.click(screen.getByRole("button", { name: "Delete poll" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete poll",
			}),
		);

		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/polls", {
				id: "pl1",
				author_id: "anon-test",
				deleted: true,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Poll deleted",
			"info",
			expect.objectContaining({ label: "Undo (30s)" }),
		);
		expect(screen.queryByText("Coffee brand?")).not.toBeInTheDocument();

		const undo = findUndoToast("Poll deleted");
		await act(async () => {
			await undo.fn();
		});
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/polls", {
				id: "pl1",
				author_id: "anon-test",
				deleted: false,
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Poll restored", "ok");
	});

	it("does not delete a poll when the dialog is cancelled", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /My Polls/ }));
		await screen.findByText("Coffee brand?");
		await user.click(screen.getByRole("button", { name: "Delete poll" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Cancel",
			}),
		);

		expect(mocks.put).not.toHaveBeenCalled();
		expect(screen.getByText("Coffee brand?")).toBeInTheDocument();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("toasts an error when the poll delete fails", async () => {
		mocks.put.mockRejectedValue(new Error("poll delete failed"));
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /My Polls/ }));
		await screen.findByText("Coffee brand?");
		await user.click(screen.getByRole("button", { name: "Delete poll" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete poll",
			}),
		);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("poll delete failed", "err");
		});
		expect(screen.getByText("Coffee brand?")).toBeInTheDocument();
	});

	it("toasts a generic message when the poll delete fails without an Error", async () => {
		mocks.put.mockRejectedValue("boom");
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /My Polls/ }));
		await screen.findByText("Coffee brand?");
		await user.click(screen.getByRole("button", { name: "Delete poll" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete poll",
			}),
		);

		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("Delete failed", "err");
		});
	});
});

describe("MyActivity — poll display branches", () => {
	it("renders an archived poll with zero votes and no created date", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/polls") && url.includes("viewer=")) {
				return Promise.resolve([
					{ ...POLL, total_votes: 0, archived: true, created_at: undefined },
				]);
			}
			return defaultGet(url);
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /My Polls/ }));
		expect(
			await screen.findByText("0 votes · yesno · archived · 2d ago"),
		).toBeInTheDocument();
	});
});

describe("MyActivity — comments, votes, bookmarks, drafts", () => {
	it("shows my comments with a link to the thread", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Comments/ }));
		expect(
			await screen.findByText("Thanks for reporting!"),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /View thread/ })).toHaveAttribute(
			"href",
			"/post/p1",
		);
	});

	it("shows the comments empty state", async () => {
		mocks.get.mockImplementation((url: string) =>
			url.includes("/api/comments") ? Promise.resolve([]) : defaultGet(url),
		);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Comments/ }));
		expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
	});

	it("shows reactions and poll votes on the votes tab", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Votes/ }));
		expect(await screen.findByText("like")).toBeInTheDocument();
		expect(screen.getByText("on post p1…")).toBeInTheDocument();
		expect(screen.getByText("choices: Option A, Option B")).toBeInTheDocument();
	});

	it("shows the votes empty state", async () => {
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("/api/reactions")) return Promise.resolve([]);
			if (url.includes("voter=")) return Promise.resolve([]);
			return defaultGet(url);
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Votes/ }));
		expect(
			await screen.findByText("No votes or reactions yet."),
		).toBeInTheDocument();
	});

	it("fetches and lists bookmarked posts when bookmarks exist", async () => {
		mocks.useAppState.bookmarks = ["p1", "p2"];
		mocks.get.mockImplementation((url: string) => {
			if (url.includes("ids=")) return Promise.resolve([POST]);
			return defaultGet(url);
		});
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Bookmarks/ }));
		expect(await screen.findByText("Broken projector")).toBeInTheDocument();
		expect(mocks.get).toHaveBeenCalledWith("/api/posts?ids=p1,p2");
	});

	it("shows the bookmarks empty state", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Bookmarks/ }));
		expect(await screen.findByText(/No bookmarks yet/)).toBeInTheDocument();
	});

	it("shows a saved draft with a continue-editing link", async () => {
		mocks.lsGet.mockImplementation((key: string) =>
			key === "vb:drafts"
				? {
						title: "WIP report",
						desc: "Half written…",
						savedAt: "2026-07-01T10:00:00.000Z",
					}
				: null,
		);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Drafts/ }));
		expect(await screen.findByText("WIP report")).toBeInTheDocument();
		expect(screen.getByText("Half written…")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /Continue editing/ }),
		).toHaveAttribute("href", "/submit");
	});

	it("shows an untitled draft when only the description exists", async () => {
		mocks.lsGet.mockImplementation((key: string) =>
			key === "vb:drafts" ? { desc: "Just a description" } : null,
		);
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Drafts/ }));
		expect(await screen.findByText("(untitled draft)")).toBeInTheDocument();
	});

	it("shows the drafts empty state", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Drafts/ }));
		expect(
			await screen.findByText("No drafts. Drafts autosave while you write."),
		).toBeInTheDocument();
	});
});

describe("MyActivity — notifications and recently viewed", () => {
	it("lists notifications with links", async () => {
		mocks.useAppState.notifications = [
			{
				id: "n1",
				title: "New reply",
				body: "Someone replied to your post",
				at: "2026-07-01T10:00:00.000Z",
				link: "/post/p1",
			},
		];
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Notifications/ }));
		expect(await screen.findByText("New reply")).toBeInTheDocument();
		expect(
			screen.getByText("Someone replied to your post · 2d ago"),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open →" })).toHaveAttribute(
			"href",
			"/post/p1",
		);
	});

	it("shows the notifications empty state", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Notifications/ }));
		expect(
			await screen.findByText("No notifications yet."),
		).toBeInTheDocument();
	});

	it("lists recently viewed post ids", async () => {
		mocks.useAppState.recentlyViewed = ["p9"];
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Recently viewed/ }));
		expect(await screen.findByText("p9")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "p9" })).toHaveAttribute(
			"href",
			"/post/p9",
		);
	});

	it("shows the recently viewed empty state", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Recently viewed/ }));
		expect(
			await screen.findByText("Nothing viewed recently."),
		).toBeInTheDocument();
	});
});	describe("MyActivity — identity and tutorial actions", () => {
	it("no longer offers a Reset anonymous ID option (removed by design)", async () => {
		renderPage();
		await screen.findByText("Anonymous profile");

		expect(
			screen.queryByRole("button", { name: /Reset anonymous ID/ }),
		).not.toBeInTheDocument();
		expect(mocks.resetAnonId).not.toHaveBeenCalled();
	});

	it("links to Settings for profile editing", async () => {
		renderPage();
		await screen.findByText("Anonymous profile");

		const edit = screen.getByRole("link", { name: /Edit profile/ });
		expect(edit).toHaveAttribute("href", "/settings");
	});

	it("shows the custom display name when one is set", async () => {
		mocks.useAppState.displayName = "Alex";
		renderPage();
		await screen.findByText("Alex");
		expect(screen.queryByText("Anonymous profile")).not.toBeInTheDocument();
	});

	it("falls back to 'Anonymous profile' when no display name is set", async () => {
		mocks.useAppState.displayName = "";
		renderPage();
		await screen.findByText("Anonymous profile");
	});

	it("does NOT offer a destructive 'Clear local data' action (by design)", async () => {
		renderPage();
		await screen.findByText("Anonymous profile");

		// The bulk local-data wipe was removed: users can reset their ID or
		// export their data, but there is no footgun that silently nukes
		// every stored preference in one click.
		expect(screen.queryByRole("button", { name: /Clear local data/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /Clear everything/ })).not.toBeInTheDocument();
		expect(mocks.clearAllLocalData).not.toHaveBeenCalled();
	});

	it("replays the tutorial and navigates home", async () => {
		const user = userEvent.setup();
		renderPage();
		await screen.findByText("Anonymous profile");

		await user.click(screen.getByRole("button", { name: /Replay tutorial/ }));

		expect(mocks.resetTutorial).toHaveBeenCalled();
		expect(mocks.navigate).toHaveBeenCalledWith("/");
	});

	it("tolerates a failed load (offline) without crashing", async () => {
		mocks.get.mockRejectedValue(new Error("offline"));
		renderPage();
		expect(await screen.findByText("Anonymous profile")).toBeInTheDocument();
		expect(
			screen.getByText("You haven't posted anything yet."),
		).toBeInTheDocument();
	});
});
