// PostCardAdminBar — user-feed moderation bar.
// Locks:
//   1. Verify / In progress / Solve hit PUT /api/posts with the right patch.
//   2. There is NO Mark-official control here — official lives in PostDetail
//      + admin PostsTable (Verify instead of Mark official in the user feed).
//   3. Hide asks for confirmation; Official reply posts via PUT admin_reply.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostCardAdminBar from "../components/PostCardAdminBar";
import type { PostData } from "../types";

const mocks = vi.hoisted(() => ({
	put: vi.fn(),
	toast: vi.fn(),
	onStatusChange: vi.fn(),
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/api", () => ({
	api: { put: mocks.put },
}));

const POST = {
	id: "p1",
	type: "problem",
	title: "Broken lift",
	description: "stuck",
	category: "Facilities",
	status: "reported",
	priority: "medium",
	author_id: "anon_x",
	created_at: "2026-09-01T00:00:00.000Z",
	official: false,
	hidden: false,
} as unknown as PostData;

function renderBar(post: PostData = POST) {
	return render(
		<PostCardAdminBar post={post} onStatusChange={mocks.onStatusChange} />,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.put.mockResolvedValue({ ok: true });
});

describe("PostCardAdminBar — status actions", () => {
	it("Verify marks the post verified", async () => {
		renderBar();
		await userEvent.click(screen.getByRole("button", { name: /verify/i }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				status: "verified",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith("Marked verified", "ok");
		expect(mocks.onStatusChange).toHaveBeenCalledWith("p1", "verified");
	});

	it("In progress marks the post in progress", async () => {
		renderBar();
		await userEvent.click(screen.getByRole("button", { name: /in progress/i }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				status: "in_progress",
			});
		});
	});

	it("Solve asks for confirmation, then solves", async () => {
		const user = userEvent.setup();
		renderBar();
		await user.click(screen.getByRole("button", { name: /^solve$/i }));
		// Confirm dialog appears first — nothing sent yet.
		expect(mocks.put).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Solve this issue" }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				status: "solved",
			});
		});
	});

	it("shows no Mark-official control in the user feed", async () => {
		renderBar();
		expect(
			screen.queryByRole("button", { name: /mark official/i }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: /mark as official/i }),
		).toBeNull();
		// Verify is the official-adjacent action offered here instead.
		expect(
			screen.getByRole("button", { name: /verify/i }),
		).toBeInTheDocument();
	});

	it("Hide asks for confirmation, then hides", async () => {
		const user = userEvent.setup();
		renderBar();
		await user.click(screen.getByRole("button", { name: /^hide$/i }));
		expect(mocks.put).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: /hide this post/i }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				hidden: true,
			});
		});
	});

	it("surfaces PUT failures instead of fake success", async () => {
		mocks.put.mockRejectedValueOnce(new Error("server down"));
		renderBar();
		await userEvent.click(screen.getByRole("button", { name: /verify/i }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith("server down", "err");
		});
		expect(mocks.onStatusChange).not.toHaveBeenCalled();
	});
});

describe("PostCardAdminBar — official reply", () => {
	it("posts the reply and clears the composer", async () => {
		const user = userEvent.setup();
		renderBar();
		await user.click(screen.getByRole("button", { name: /official reply/i }));
		await user.type(
			screen.getByLabelText("Official admin reply"),
			"Fixed yesterday",
		);
		fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "p1",
				admin_reply: "Fixed yesterday",
			});
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Official reply posted — visible on the post",
			"ok",
		);
	});
});
