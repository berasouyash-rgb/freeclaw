// ═══════════════════════════════════════════════════════════════════
// Comments — reader-visible state distinction
// ═══════════════════════════════════════════════════════════════════
// Two silent-degradation paths are pinned here:
//
// 1. THE VANISHING AUTHOR. The API now lets an author see their OWN
//    moderation-hidden comment (self-view), but the UI rendered it as if
//    nothing happened — the reader could not tell the comment was held.
//    An admin hide must be EXPLAINED to its author, not silent.
//
// 2. THE PROMOTED ORPHAN. buildTree promotes a reply whose parent fell
//    outside the fetched window (500-row slice, hidden/deleted parent) to
//    a root — it then impersonated a brand-new top-level comment with no
//    hint that it answers something the reader cannot see.
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
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

const base = {
	post_id: "p-1",
	parent_id: null,
	is_admin: false,
	created_at: new Date().toISOString(),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.queuedCount.mockReturnValue(0);
	mocks.get.mockResolvedValue([]);
	mocks.getFresh.mockResolvedValue([]);
	mocks.post.mockResolvedValue({ ok: true });
	mocks.put.mockResolvedValue({ ok: true });
});

describe("Comments — reader-visible state distinction", () => {
	it("tells the author their own hidden comment is held for review", async () => {
		mocks.get.mockResolvedValue([
			{
				...base,
				id: "c-h",
				body: "held words",
				author_id: "anon-test",
				is_mine: true,
				hidden: true,
			},
		]);
		render(<Comments postId="p-1" />);

		expect(await screen.findByText("held words")).toBeInTheDocument();
		// The comment must stay visible to its author (API self-view) AND
		// carry an explanation — never a silent normal-looking row.
		expect(screen.getByText(/held for review/i)).toBeInTheDocument();
	});

	it("shows no state badge on a live comment", async () => {
		mocks.get.mockResolvedValue([
			{ ...base, id: "c-live", body: "live words", author_id: "anon-9" },
		]);
		render(<Comments postId="p-1" />);

		expect(await screen.findByText("live words")).toBeInTheDocument();
		expect(screen.queryByText(/held for review/i)).toBeNull();
		expect(screen.queryByText(/hidden from users/i)).toBeNull();
		expect(screen.queryByText(/reply to an earlier comment/i)).toBeNull();
	});

	it("marks an orphaned reply instead of presenting it as a new top-level comment", async () => {
		mocks.get.mockResolvedValue([
			{
				...base,
				id: "c-orphan",
				parent_id: "c-gone",
				body: "orphan words",
				author_id: "anon-9",
			},
		]);
		render(<Comments postId="p-1" />);

		expect(await screen.findByText("orphan words")).toBeInTheDocument();
		expect(
			screen.getByText(/reply to an earlier comment/i),
		).toBeInTheDocument();
	});

	it("does not mark a reply whose parent is present in the thread", async () => {
		mocks.get.mockResolvedValue([
			{ ...base, id: "c-parent", body: "parent words", author_id: "anon-9" },
			{
				...base,
				id: "c-child",
				parent_id: "c-parent",
				body: "child words",
				author_id: "anon-2",
			},
		]);
		render(<Comments postId="p-1" />);

		expect(await screen.findByText("child words")).toBeInTheDocument();
		expect(screen.queryByText(/reply to an earlier comment/i)).toBeNull();
	});
});
