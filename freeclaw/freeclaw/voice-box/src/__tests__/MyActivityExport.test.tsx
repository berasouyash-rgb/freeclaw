// ═══════════════════════════════════════════════════════════════════
// MyActivity export — "export my data" contract
// ═══════════════════════════════════════════════════════════════════
// Locks the export-all-data button:
//   1. Click fetches /api/data-export and downloads the merged bundle.
//   2. On network failure it falls back to on-device activity.
// ═══════════════════════════════════════════════════════════════════

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MyActivity from "../pages/MyActivity";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	downloadFile: vi.fn(),
	lsGet: vi.fn(() => null),
}));

// The page subscribes for realtime updates; without this mock jsdom would
// open a real production supabase WebSocket. Wiring assertions live in
// DerivedPages.realtime.test.tsx.
vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => {},
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, put: vi.fn() },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: mocks.toast,
		refreshIdentity: vi.fn(),
		notifications: [],
		bookmarks: [] as string[],
		recentlyViewed: [],
		displayName: "",
		profile: { avatar: "", bio: "" },
	}),
}));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "2d ago",
	downloadFile: mocks.downloadFile,
	safeStringify: (obj: unknown) => JSON.stringify(obj, null, 2),
}));

vi.mock("../lib/identity", () => ({
	resetAnonId: vi.fn(),
	clearAllLocalData: vi.fn(),
	anonCreatedAt: () => Date.now(),
	lsGet: mocks.lsGet,
}));

vi.mock("../components/Tutorial", () => ({
	resetTutorial: vi.fn(),
}));

vi.mock("../components/ui", () => ({
	ConfirmDialog: () => null,
}));

const SERVER_BUNDLE = {
	anon_id: "anon-test",
	exported_at: "2026-07-01T10:00:00.000Z",
	profile: { strikes: 0 },
	posts: [{ id: "p1" }],
	comments: [],
	reactions: [],
	poll_votes: [],
	saved: ["p1"],
	follows: [],
	notifications: [],
};

function renderPage() {
	return render(
		<MemoryRouter>
			<MyActivity />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.lsGet.mockReturnValue(null);
	mocks.get.mockImplementation(async (url: string) => {
		if (url.includes("data-export")) return SERVER_BUNDLE;
		return [];
	});
});

describe("MyActivity — export my data", () => {
	it("renders the export button", async () => {
		renderPage();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /export my data/i }),
			).toBeTruthy(),
		);
	});

	it("downloads the server bundle merged with local fields", async () => {
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			screen.getByRole("button", { name: /export my data/i }),
		);
		await user.click(screen.getByRole("button", { name: /export my data/i }));
		await waitFor(() => {
			expect(mocks.get).toHaveBeenCalledWith(
				"/api/data-export?anon_id=anon-test",
			);
			expect(mocks.downloadFile).toHaveBeenCalledWith(
				"voicebox-data-anon-test.json",
				expect.stringContaining('"posts"'),
			);
		});
		const [, content] = mocks.downloadFile.mock.calls[0] ?? [];
		expect(JSON.parse(content as string)).toMatchObject({
			anon_id: "anon-test",
			posts: [{ id: "p1" }],
			saved: ["p1"],
			draft: null,
			bookmarks: [],
		});
		expect(mocks.toast).toHaveBeenCalledWith("All your data exported", "ok");
	});

	it("falls back to on-device activity when the network fails", async () => {
		mocks.get.mockRejectedValue(new Error("offline"));
		const user = userEvent.setup();
		renderPage();
		await waitFor(() =>
			screen.getByRole("button", { name: /export my data/i }),
		);
		await user.click(screen.getByRole("button", { name: /export my data/i }));
		await waitFor(() => {
			expect(mocks.downloadFile).toHaveBeenCalledWith(
				"voicebox-activity-anon-test.json",
				expect.stringContaining('"anon_id"'),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Offline — exported your on-device activity",
			"ok",
		);
	});
});
