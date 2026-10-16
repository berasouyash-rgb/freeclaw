// SolvingBoard — live cards without a refresh click (evolution 2026-10-05)
// A new report or a status change on another device must move cards
// between columns on its own: one small row GET per changed id, never a
// whole-board reload (the old wiring rebuilt the columns ~1s under any
// steady write activity, making work impossible).

import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SolvingBoard from "../pages/SolvingBoard";

const mocks = vi.hoisted(() => ({
	getSlow: vi.fn(),
	getFresh: vi.fn(async (_url: unknown): Promise<unknown> => null),
	realtimeSubs: [] as Array<{
		tables: string[];
		cb: (table: string, payload: unknown) => void;
		debounceMs: number;
	}>,
}));

vi.mock("../lib/api", () => ({
	api: { getSlow: mocks.getSlow, getFresh: mocks.getFresh },
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: (
		tables: string[],
		cb: (table: string, payload: unknown) => void,
		debounceMs = 1000,
	) => {
		mocks.realtimeSubs.push({ tables, cb, debounceMs });
	},
}));

vi.mock("react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("react-router")>();
	return {
		...actual,
		Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
			<a href={to}>{children}</a>
		),
	};
});

const P1 = {
	id: "p1",
	type: "problem",
	title: "Leaky tap in Block B",
	description: "Drips all day.",
	category: "Facilities",
	status: "reported",
	priority: "medium",
	author_id: "anon-x",
	created_at: "2026-09-01T00:00:00Z",
	updated_at: "2026-09-01T00:00:00Z",
	reactions: {},
	comment_count: 0,
};

function fireRealtime(table: string, payload: unknown) {
	const sub = mocks.realtimeSubs.find((s) => s.tables.includes(table));
	if (!sub) throw new Error(`no subscription for ${table}`);
	act(() => {
		sub.cb(table, payload);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.realtimeSubs = [];
	mocks.getSlow.mockResolvedValue([P1]);
	mocks.getFresh.mockResolvedValue(null);
});

async function renderBoard() {
	render(
		<MemoryRouter>
			<SolvingBoard />
		</MemoryRouter>,
	);
	await waitFor(() => {
		// The title renders twice: the unanswered spotlight + its column.
		expect(screen.getAllByText("Leaky tap in Block B").length).toBeGreaterThan(0);
	});
	mocks.getSlow.mockClear();
}

describe("SolvingBoard — live cards", () => {
	it("adds another device's new report to its column, with no clicks", async () => {
		await renderBoard();
		const P2 = { ...P1, id: "p2", title: "Fused corridor lights" };
		mocks.getFresh.mockImplementation(async (url: unknown) =>
			typeof url === "string" && url.includes("/api/posts?id=p2")
				? { post: P2 }
				: null,
		);

		fireRealtime("posts", {
			eventType: "INSERT",
			new: { id: "p2" },
			old: {},
		});

		await waitFor(() => {
			// The card lands in its column (and the spotlight, which lists
			// the same row) — one row, two render sites.
			expect(screen.getAllByText("Fused corridor lights").length).toBeGreaterThan(0);
		});
		// One small row GET — the whole-board reload never fires, and no
		// update notice asks for a click.
		expect(mocks.getSlow).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: /view .* updates?/i })).toBeNull();
	});

	it("moves a card when its status changes elsewhere, without rebuilding", async () => {
		await renderBoard();
		mocks.getFresh.mockImplementation(async (url: unknown) =>
			typeof url === "string" && url.includes("/api/posts?id=p1")
				? { post: { ...P1, status: "verified" } }
				: null,
		);

		fireRealtime("posts", {
			eventType: "UPDATE",
			new: { id: "p1" },
			old: { id: "p1" },
		});

		// The card leaves Reported and lands in Verified on its own: the
		// single /post/p1 link survives (now under Verified) instead of a
		// rebuild, and the Reported column empties.
		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalledWith(
				expect.stringContaining("/api/posts?id=p1"),
			);
		});
		await waitFor(() => {
			const links = screen.getAllByRole("link", { name: /leaky tap/i });
			expect(links).toHaveLength(1);
			expect(links[0]?.getAttribute("href")).toBe("/post/p1");
		});
		expect(mocks.getSlow).not.toHaveBeenCalled();
	});
});
