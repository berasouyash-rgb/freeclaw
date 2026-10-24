// CommunityDetail — membership, composer, feed actions, poll toggles,
// empty and error states.
//
// Companion to CommunityDetail.realtime.test.tsx (which owns the
// visible-only background-tick behaviour). These tests pin the
// user-visible contract: join/leave, posting + poll validation, reactions,
// votes, comments, report/delete/solve, and the not-found / load-error /
// empty-feed branches.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommunityDetail from "../pages/CommunityDetail";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	navigate: vi.fn(),
	hasAdmin: vi.fn(() => false),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		displayName: "Tester",
	}),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: mocks.post },
	hasAdminSession: mocks.hasAdmin,
	isNotFound: (err: unknown) =>
		!!err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404,
}));

vi.mock("react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-router")>();
	return {
		...actual,
		useParams: () => ({ slug: "study-gang" }),
		useNavigate: () => mocks.navigate,
		Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
			<a href={to}>{children}</a>
		),
	};
});

function basePost(id = "p1", text = "Welcome thread") {
	return {
		id,
		anon_id: "anon-x",
		author: "anon-x",
		text,
		created_at: "2026-09-01T00:00:00Z",
		reactions: {},
		reaction_counts: {},
		mine_reactions: {},
		poll: null,
		comments: [],
	};
}

function pollPost() {
	return {
		...basePost("pp1", "Vote on lunch"),
		poll: {
			id: "poll1",
			question: "Lunch?",
			options: [
				{ id: "o1", text: "Pizza", votes: 2 },
				{ id: "o2", text: "Sushi", votes: 1 },
			],
			created_by: "anon-x",
			my_vote: null,
			total_votes: 3,
		},
	};
}

function community(posts: unknown[], overrides: Record<string, unknown> = {}) {
	return {
		slug: "study-gang",
		name: "Study Gang",
		description: "Cram together",
		avatar: "📚",
		created_by: "anon-x",
		created_at: "2026-09-01T00:00:00Z",
		hidden: false,
		member_count: 3,
		post_count: posts.length,
		members: ["anon-x"],
		is_member: true,
		is_creator: false,
		posts,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.hasAdmin.mockReturnValue(false);
	window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
	mocks.get.mockResolvedValue(community([basePost()]));
	mocks.post.mockResolvedValue({ ok: true });
});

async function renderLoaded(data: Record<string, unknown> = community([basePost()])) {
	mocks.get.mockResolvedValue(data);
	render(
		<MemoryRouter>
			<CommunityDetail />
		</MemoryRouter>,
	);
	await screen.findByText("Study Gang");
}

function commentToggle() {
	const btn = screen
		.getAllByRole("button")
		.find((b) => /^\d+$/.test((b.textContent || "").trim()));
	expect(btn).toBeTruthy();
	return btn!;
}

describe("CommunityDetail — membership", () => {
	it("shows Join and the join prompt for non-members, with no composer", async () => {
		await renderLoaded(community([basePost()], { is_member: false }));
		expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
		expect(
			screen.getByText("Join this community to join the discussion."),
		).toBeInTheDocument();
		expect(screen.queryByPlaceholderText(/Share something with/)).toBeNull();
	});

	it("joins the community, toasts, and reloads", async () => {
		await renderLoaded(community([basePost()], { is_member: false }));
		fireEvent.click(screen.getByRole("button", { name: "Join" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "join", slug: "study-gang" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith("Joined community", "ok");
	});

	it("shows Leave and the composer for members", async () => {
		await renderLoaded();
		expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
		expect(screen.getByPlaceholderText(/Share something with/)).toBeInTheDocument();
	});

	it("leaves the community when Leave is clicked", async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole("button", { name: "Leave" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "leave" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith("Left community", "ok");
	});

	it("toasts the error when joining fails", async () => {
		mocks.post.mockRejectedValueOnce(new Error("nope"));
		await renderLoaded(community([basePost()], { is_member: false }));
		fireEvent.click(screen.getByRole("button", { name: "Join" }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("nope", "err");
		});
	});
});

describe("CommunityDetail — posts and empty states", () => {
	it("renders feed post text", async () => {
		await renderLoaded();
		expect(screen.getByText("Welcome thread")).toBeInTheDocument();
	});

	it("shows the member empty-feed prompt when there are no posts", async () => {
		await renderLoaded(community([]));
		expect(screen.getByText(/No posts yet/)).toBeInTheDocument();
		expect(screen.getByText(/start the conversation above/)).toBeInTheDocument();
	});

	it("shows the non-member empty-feed prompt when there are no posts", async () => {
		await renderLoaded(community([], { is_member: false }));
		expect(screen.getByText(/be the first member to post/)).toBeInTheDocument();
	});

	it("disables Post with an empty draft, then posts and clears the draft", async () => {
		await renderLoaded();
		const postBtn = screen.getByRole("button", { name: "Post" });
		expect(postBtn).toBeDisabled();
		fireEvent.change(screen.getByPlaceholderText(/Share something with/), {
			target: { value: "Hello group" },
		});
		expect(postBtn).not.toBeDisabled();
		fireEvent.click(postBtn);
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "post", text: "Hello group" }),
			);
		});
		await waitFor(() => {
			expect(
				(screen.getByPlaceholderText(/Share something with/) as HTMLTextAreaElement).value,
			).toBe("");
		});
	});

	it("requires a poll question before posting a poll", async () => {
		await renderLoaded();
		fireEvent.change(screen.getByPlaceholderText(/Share something with/), {
			target: { value: "poll post" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Poll" }));
		fireEvent.click(screen.getByRole("button", { name: "Post" }));
		expect(mocks.toast).toHaveBeenCalledWith("Add a question for your poll", "err");
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it("requires at least 2 poll options before posting a poll", async () => {
		await renderLoaded();
		fireEvent.change(screen.getByPlaceholderText(/Share something with/), {
			target: { value: "poll post" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Poll" }));
		fireEvent.change(screen.getByLabelText("Poll question"), {
			target: { value: "Lunch?" },
		});
		fireEvent.change(screen.getByLabelText("Poll option 1"), {
			target: { value: "Pizza" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Post" }));
		expect(mocks.toast).toHaveBeenCalledWith("A poll needs at least 2 options", "err");
		expect(mocks.post).not.toHaveBeenCalled();
	});
});

describe("CommunityDetail — poll composer toggles", () => {
	it("opens the poll fields, adds an option, and removes the poll", async () => {
		await renderLoaded();
		expect(screen.queryByLabelText("Poll question")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Poll" }));
		expect(screen.getByLabelText("Poll question")).toBeInTheDocument();
		expect(screen.getByLabelText("Poll option 2")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Add option" }));
		expect(screen.getByLabelText("Poll option 3")).toBeInTheDocument();
		fireEvent.click(screen.getByTitle("Remove poll"));
		expect(screen.queryByLabelText("Poll question")).toBeNull();
	});
});

describe("CommunityDetail — feed interactions", () => {
	it("votes for a poll option", async () => {
		await renderLoaded(community([pollPost()]));
		fireEvent.click(screen.getByText("Pizza"));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "vote", post_id: "pp1", option_id: "o1" }),
			);
		});
	});

	it("sends a reaction for a post", async () => {
		await renderLoaded();
		fireEvent.click(screen.getByTitle("Support"));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "react", post_id: "p1", kind: "support" }),
			);
		});
	});

	it("opens comments, shows existing replies, and sends a new reply", async () => {
		const withComment = {
			...basePost(),
			comments: [
				{
					id: "c1",
					anon_id: "anon-y",
					author: "anon-y",
					text: "Nice thread",
					created_at: "2026-09-01T00:00:00Z",
				},
			],
		};
		await renderLoaded(community([withComment]));
		expect(screen.queryByText("Nice thread")).toBeNull();
		fireEvent.click(commentToggle());
		expect(screen.getByText("Nice thread")).toBeInTheDocument();
		fireEvent.change(screen.getByPlaceholderText("Reply…"), {
			target: { value: "agreed" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "comment", post_id: "p1", text: "agreed" }),
			);
		});
	});

	it("reports a post and toasts confirmation", async () => {
		await renderLoaded();
		fireEvent.click(screen.getByTitle("Report post"));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "report", post_id: "p1" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Reported — moderators will review it",
			"ok",
		);
	});

	it("deletes your own post after confirming", async () => {
		const mine = { ...basePost(), anon_id: "anon-test", author: "Tester" };
		await renderLoaded(community([mine]));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(window.confirm).toHaveBeenCalled();
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "delete_post", post_id: "p1" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith("Post deleted", "ok");
	});

	it("marks your poll post solved after confirming", async () => {
		const mine = { ...pollPost(), anon_id: "anon-test", author: "Tester" };
		await renderLoaded(community([mine]));
		fireEvent.click(screen.getByRole("button", { name: "Solve poll" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "solve_poll", post_id: "pp1" }),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith("Poll solved — post removed", "ok");
	});
});

describe("CommunityDetail — error and admin states", () => {
	it("shows the not-found view for a 404", async () => {
		mocks.get.mockRejectedValue(Object.assign(new Error("gone"), { status: 404 }));
		render(
			<MemoryRouter>
				<CommunityDetail />
			</MemoryRouter>,
		);
		expect(await screen.findByText("Community not found")).toBeInTheDocument();
		expect(screen.getByText("Back to communities")).toBeInTheDocument();
	});

	it("shows the retry view for a non-404 failure and recovers on Retry", async () => {
		mocks.get.mockRejectedValueOnce(new Error("boom 500"));
		render(
			<MemoryRouter>
				<CommunityDetail />
			</MemoryRouter>,
		);
		expect(await screen.findByText("Couldn't load this community")).toBeInTheDocument();
		mocks.get.mockResolvedValue(community([basePost()]));
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("Welcome thread");
	});

	it("marks hidden communities and exposes admin hide and delete", async () => {
		mocks.hasAdmin.mockReturnValue(true);
		await renderLoaded(community([], { hidden: true }));
		expect(screen.getByText("HIDDEN")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Unhide" }));
		await waitFor(() => {
			expect(mocks.post).toHaveBeenCalledWith(
				"/api/communities",
				expect.objectContaining({ action: "admin", op: "unhide" }),
			);
		});
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => {
			expect(mocks.navigate).toHaveBeenCalledWith("/communities");
		});
	});
});
