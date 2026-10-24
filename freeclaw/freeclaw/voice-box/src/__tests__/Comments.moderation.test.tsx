// Comments admin hide/unhide — admins can hide an abusive comment directly
// in the thread (previously only unlock existed in Reports; hide had no UI).
// Locks:
//   1. Admin sees Hide on a visible comment; click → PUT hidden:true → fresh
//      re-read proves it → honest success toast.
//   2. Admin sees Unhide + "Hidden from users" badge on a hidden comment.
//   3. A failed hide reports honestly and changes nothing.
//   4. Non-admins never see Hide/Unhide.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
	admin: false,
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getFresh: mocks.getFresh,
		post: mocks.post,
		put: mocks.put,
		del: mocks.del,
	},
	hasAdminSession: () => mocks.admin,
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

function comment(over: Record<string, unknown> = {}) {
	return {
		id: "c-1",
		post_id: "p-1",
		parent_id: null,
		body: "reported comment body",
		author_id: "anon-other",
		is_admin: false,
		is_mine: false,
		hidden: false,
		deleted: false,
		created_at: "2026-09-01T00:00:00.000Z",
		...over,
	};
}

function renderThread() {
	return render(<Comments postId="p-1" />);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.admin = false;
	mocks.queuedCount.mockReturnValue(0);
	mocks.get.mockResolvedValue([comment()]);
	mocks.getFresh.mockResolvedValue([comment()]);
	mocks.put.mockResolvedValue({ ok: true });
});

describe("Comments admin hide/unhide", () => {
	it("hides a comment and proves it with a fresh re-read", async () => {
		mocks.admin = true;
		mocks.get.mockResolvedValue([comment()]);
		mocks.getFresh.mockResolvedValue([comment({ hidden: true })]);
		const user = userEvent.setup();
		renderThread();
		await user.click(await screen.findByRole("button", { name: "Hide comment" }));
		await waitFor(() => {
			expect(mocks.put).toHaveBeenCalledWith("/api/comments", {
				id: "c-1",
				hidden: true,
			});
		});
		// Verify-after-write: fresh list fetched, success claimed only when proven.
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Comment hidden — visible to admins only",
				"ok",
			);
		});
	});

	it("shows Unhide plus a hidden badge on hidden comments", async () => {
		mocks.admin = true;
		mocks.get.mockResolvedValue([comment({ hidden: true })]);
		renderThread();
		expect(
			await screen.findByRole("button", { name: "Unhide comment" }),
		).toBeInTheDocument();
		expect(screen.getByText("Hidden from users")).toBeInTheDocument();
	});

	it("reports a failed hide honestly", async () => {
		mocks.admin = true;
		mocks.getFresh.mockResolvedValue([comment({ hidden: false })]);
		const user = userEvent.setup();
		renderThread();
		await user.click(await screen.findByRole("button", { name: "Hide comment" }));
		await waitFor(() => {
			expect(mocks.toast).toHaveBeenCalledWith(
				"Hide failed — the comment is still visible",
				"err",
			);
		});
	});

	it("never offers Hide/Unhide to non-admins", async () => {
		mocks.admin = false;
		renderThread();
		await screen.findByText("reported comment body");
		expect(screen.queryByRole("button", { name: "Hide comment" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Unhide comment" })).toBeNull();
		expect(screen.queryByText("Hidden from users")).toBeNull();
	});
});
