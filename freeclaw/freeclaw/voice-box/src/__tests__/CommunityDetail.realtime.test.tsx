// CommunityDetail — live discussion without a refresh click
// (evolution 2026-10-05). The discussion feed owned zero subscriptions:
// posts, reactions, comments, and poll votes from another device
// appeared only after a manual reload. A visible-only quiet tick
// revalidates the whole thread — all mutations already reload through
// load(), so there is no optimistic state a tick could clobber, and a
// failed tick never raises a banner.

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommunityDetail from "../pages/CommunityDetail";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	post: vi.fn(),
	navigate: vi.fn(),
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
	hasAdminSession: () => false,
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

function discussionPost(id: string, text: string) {
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

function community(posts: unknown[]) {
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
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue(community([discussionPost("d1", "Welcome thread")]));
	mocks.post.mockResolvedValue({ ok: true });
});

async function renderDetail() {
	render(
		<MemoryRouter>
			<CommunityDetail />
		</MemoryRouter>,
	);
	await waitFor(() => {
		expect(screen.getByText("Study Gang")).toBeTruthy();
		expect(screen.getByText("Welcome thread")).toBeTruthy();
	});
	mocks.get.mockClear();
}

describe("CommunityDetail — live discussion", () => {
	it("shows another device's discussion post, with no clicks", async () => {
		await renderDetail();

		// Another member posts after this screen loaded.
		mocks.get.mockResolvedValue(
			community([discussionPost("d2", "Exam schedule?"), discussionPost("d1", "Welcome thread")]),
		);

		// No clicks, no reload — the quiet tick merges it on its own.
		await waitFor(
			() => {
				expect(screen.getByText("Exam schedule?")).toBeTruthy();
			},
			{ timeout: 15000 },
		);
		expect(mocks.get).toHaveBeenCalled();
	});
});
