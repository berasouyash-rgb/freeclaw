// Suggestions — live ideas without a refresh click (evolution 2026-10-05)
// A new suggestion or an upvote/status change on another device must land
// in the list on its own: one small row GET per changed id, never a
// whole-list reload (the old wiring rebuilt the page under the reader).

import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Suggestions from "../pages/Suggestions";

const mocks = vi.hoisted(() => ({
	getSlow: vi.fn(),
	getSlowFresh: vi.fn(),
	getFresh: vi.fn(async (_url: unknown): Promise<unknown> => null),
	get: vi.fn(async () => []),
	realtimeSubs: [] as Array<{
		tables: string[];
		cb: (table: string, payload: unknown) => void;
		debounceMs: number;
	}>,
}));

vi.mock("../lib/api", () => ({
	api: {
		getSlow: mocks.getSlow,
		getSlowFresh: mocks.getSlowFresh,
		getFresh: mocks.getFresh,
		get: mocks.get,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		bookmarks: [],
		toggleBookmark: vi.fn(),
		toast: vi.fn(),
	}),
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
	const actual = await importOriginal<typeof import("react-router")>();
	return {
		...actual,
		Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
			<a href={to}>{children}</a>
		),
	};
});

const S1 = {
	id: "s1",
	type: "suggestion",
	title: "Longer library hours",
	description: "Open till 10pm.",
	category: "Academics",
	status: "reported",
	priority: "medium",
	author_id: "anon-x",
	created_at: "2026-09-01T00:00:00Z",
	updated_at: "2026-09-01T00:00:00Z",
	reactions: { upvote: 4 },
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
	mocks.getSlow.mockResolvedValue([S1]);
	mocks.getSlowFresh.mockResolvedValue([S1]);
});

async function renderSuggestions() {
	render(
		<MemoryRouter>
			<Suggestions />
		</MemoryRouter>,
	);
	await waitFor(() => {
		expect(screen.getAllByText("Longer library hours").length).toBeGreaterThan(0);
	});
	mocks.getSlow.mockClear();
	mocks.getSlowFresh.mockClear();
}

describe("Suggestions — live ideas", () => {
	it("adds another device's new idea to the list, with no clicks", async () => {
		await renderSuggestions();
		const S2 = { ...S1, id: "s2", title: "Water coolers on floor 3" };
		mocks.getFresh.mockImplementation(async (url: unknown) =>
			typeof url === "string" && url.includes("/api/posts?id=s2")
				? { post: S2 }
				: null,
		);

		fireRealtime("posts", {
			eventType: "INSERT",
			new: { id: "s2" },
			old: {},
		});

		await waitFor(() => {
			expect(screen.getAllByText("Water coolers on floor 3").length).toBeGreaterThan(0);
		});
		// One small row GET — the whole-list reload never fires, and no
		// update notice asks for a click.
		expect(mocks.getSlow).not.toHaveBeenCalled();
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: /view .* updates?/i })).toBeNull();
	});

	it("refreshes counts when an upvote lands elsewhere, without rebuilding", async () => {
		await renderSuggestions();
		mocks.getFresh.mockImplementation(async (url: unknown) =>
			typeof url === "string" && url.includes("/api/posts?id=s1")
				? { post: { ...S1, reactions: { upvote: 5 } } }
				: null,
		);

		fireRealtime("posts", {
			eventType: "UPDATE",
			new: { id: "s1" },
			old: { id: "s1" },
		});

		await waitFor(() => {
			expect(mocks.getFresh).toHaveBeenCalledWith(
				expect.stringContaining("/api/posts?id=s1"),
			);
		});
		expect(mocks.getSlow).not.toHaveBeenCalled();
		expect(mocks.getSlowFresh).not.toHaveBeenCalled();
	});
});
