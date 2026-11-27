// ═══════════════════════════════════════════════════════════════════
// Suggestion Board — Top ranked live reordering
// ═══════════════════════════════════════════════════════════════════
// A vote changes the ranking. The cards must not teleport: the voted card
// climbs into its new slot and both it and the card it passed wear an
// ↑/↓ chip for three seconds. The same glide runs when someone else's
// vote arrives over realtime. Re-sorting by hand is not a vote, so it must
// re-order silently — no chips, no motion.
// ═══════════════════════════════════════════════════════════════════

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Suggestions from "../pages/Suggestions";

const mocks = vi.hoisted(() => ({
	getSlow: vi.fn(),
	getSlowFresh: vi.fn(),
	getFresh: vi.fn(async (): Promise<unknown> => null),
	get: vi.fn(async () => []),
	post: vi.fn(),
	realtimeSubs: [] as Array<{
		tables: string[];
		cb: (table: string, payload: unknown) => void;
	}>,
}));

vi.mock("../lib/api", () => ({
	api: {
		getSlow: mocks.getSlow,
		getSlowFresh: mocks.getSlowFresh,
		getFresh: mocks.getFresh,
		get: mocks.get,
		post: mocks.post,
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
	) => {
		mocks.realtimeSubs.push({ tables, cb });
	},
}));

function idea(
	id: string,
	title: string,
	upvotes: number,
	createdAt: string,
) {
	return {
		id,
		type: "suggestion",
		title,
		description: "Why this matters.",
		category: "Academics",
		status: "reported",
		priority: "medium",
		author_id: "anon-x",
		created_at: createdAt,
		updated_at: createdAt,
		reactions: { upvote: upvotes },
		comment_count: 0,
	};
}

const bySupport = [
	idea("a", "Dark mode", 5, "2026-02-02T00:00:00Z"),
	idea("b", "Keyboard shortcuts", 5, "2026-02-01T00:00:00Z"),
];

function headings() {
	return screen
		.getAllByRole("heading", { level: 3 })
		.map((h) => h.textContent);
}

async function renderBoard() {
	render(
		<MemoryRouter>
			<Suggestions />
		</MemoryRouter>,
	);
	await waitFor(() =>
		expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(
			0,
		),
	);
}

function chooseTopRanked() {
	fireEvent.click(screen.getByRole("tab", { name: /top ranked/i }));
}

function cardFor(title: string) {
	const heading = screen.getByRole("heading", { level: 3, name: title });
	const article = heading.closest("article");
	if (!article) throw new Error(`no card for ${title}`);
	return article;
}

function fireRealtime(payload: unknown) {
	const sub = mocks.realtimeSubs.find((s) => s.tables.includes("posts"));
	if (!sub) throw new Error("no posts subscription");
	act(() => {
		sub.cb("posts", payload);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.realtimeSubs = [];
	mocks.getSlow.mockResolvedValue(bySupport);
	mocks.get.mockResolvedValue([]);
});

describe("Suggestion Board — Top ranked lives", () => {
	it("glides a voted idea into place and labels both rank moves", async () => {
		mocks.post.mockResolvedValue({
			counts: { upvote: 6 },
			mine: ["upvote"],
			toggled: true,
		});
		await renderBoard();
		chooseTopRanked();
		expect(headings()).toEqual(["Dark mode", "Keyboard shortcuts"]);

		// One vote breaks the tie: the second card takes the top slot.
		await act(async () => {
			fireEvent.click(
				within(cardFor("Keyboard shortcuts")).getByRole("button", {
					name: /support this idea/i,
				}),
			);
		});

		await waitFor(() =>
			expect(headings()).toEqual(["Keyboard shortcuts", "Dark mode"]),
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("rank-delta")).toHaveLength(2),
		);
		const directions = screen
			.getAllByTestId("rank-delta")
			.map((chip) => chip.getAttribute("data-direction"))
			.sort();
		expect(directions).toEqual(["down", "up"]);
	});

	it("re-orders on another device's vote without the reader clicking anything", async () => {
		await renderBoard();
		chooseTopRanked();
		expect(headings()).toEqual(["Dark mode", "Keyboard shortcuts"]);

		mocks.getFresh.mockResolvedValue({
			post: { ...bySupport[1], reactions: { upvote: 6 } },
		});
		fireRealtime({
			eventType: "UPDATE",
			new: { id: "b" },
			old: { id: "b" },
		});

		// The row merge is coalesced behind a 400ms timer; let it fire inside
		// act so its state update is attributed to the test.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 450));
		});

		await waitFor(
			() => expect(headings()).toEqual(["Keyboard shortcuts", "Dark mode"]),
			{ timeout: 2000 },
		);
		expect(screen.getAllByTestId("rank-delta").length).toBeGreaterThan(0);
	});

	it("does not label a reorder the reader caused by switching sort", async () => {
		mocks.getSlow.mockResolvedValue([
			idea("a", "Newer idea", 1, "2026-02-02T00:00:00Z"),
			idea("b", "Most supported", 9, "2026-02-01T00:00:00Z"),
		]);
		await renderBoard();
		expect(headings()).toEqual(["Newer idea", "Most supported"]);

		chooseTopRanked();
		await waitFor(() =>
			expect(headings()).toEqual(["Most supported", "Newer idea"]),
		);
		expect(screen.queryAllByTestId("rank-delta")).toHaveLength(0);
	});
});
