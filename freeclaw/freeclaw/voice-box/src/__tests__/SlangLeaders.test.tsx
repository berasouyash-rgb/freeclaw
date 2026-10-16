// SlangLeaders admin page — the report page for the slang strike ladder.
// Locks: ranked list from real data, honest empty state, refresh on demand,
// and the threshold in the copy always matches what the server enforces
// (never a hard-coded number that can drift from the API).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SlangLeaders from "../pages/admin/SlangLeaders";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	toast: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: { get: mocks.get } }));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

const RESPONSE = {
	leaders: [
		{
			anon_id: "anon_alpha",
			hits: 12,
			terms: ["sucks", "dumb", "bewakoof", "bakwas"],
			items: 3,
			strikes: 2,
			suspended: false,
			banned: false,
		},
		{
			anon_id: "anon_beta",
			hits: 3,
			terms: ["sucks"],
			items: 1,
			strikes: 0,
			suspended: false,
			banned: false,
		},
	],
	scanned: { posts: 400, comments: 400 },
	strike_terms_threshold: 4,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue(RESPONSE);
});

describe("SlangLeaders", () => {
	it("renders every leader from the server with real counts", async () => {
		render(<SlangLeaders />);
		await waitFor(() =>
			expect(screen.getAllByTestId("slang-leader-row")).toHaveLength(2),
		);
		expect(mocks.get).toHaveBeenCalledWith("/api/admin?action=slang_leaders");
		expect(screen.getByText("anon_alpha")).toBeTruthy();
		expect(screen.getByText("12 slang hits · 4 unique terms · 3 items")).toBeTruthy();
		expect(screen.getByText("anon_beta")).toBeTruthy();
	});

	it("states the scan coverage so the numbers are never mistaken for all-time", async () => {
		render(<SlangLeaders />);
		await waitFor(() =>
			expect(screen.getAllByTestId("slang-leader-row")).toHaveLength(2),
		);
		expect(screen.getAllByText(/Scanned 400 posts · 400 comments/).length)
			.toBeGreaterThan(0);
	});

	it("uses the server threshold in its copy rather than a hard-coded one", async () => {
		mocks.get.mockResolvedValue({ ...RESPONSE, strike_terms_threshold: 3 });
		render(<SlangLeaders />);
		await waitFor(() =>
			expect(screen.getAllByTestId("slang-leader-row")).toHaveLength(2),
		);
		expect(screen.getByText(/3\+ unique slang terms/)).toBeTruthy();
		expect(screen.queryByText(/4\+ unique slang terms/)).toBeNull();
	});

	it("shows a banned author as banned, not merely struck", async () => {
		mocks.get.mockResolvedValue({
			...RESPONSE,
			leaders: [{ ...RESPONSE.leaders[0], banned: true, strikes: 6 }],
		});
		render(<SlangLeaders />);
		await waitFor(() =>
			expect(screen.getAllByTestId("slang-leader-row")).toHaveLength(1),
		);
		expect(screen.getByText("banned")).toBeTruthy();
	});

	it("says so plainly when there is no slang to report", async () => {
		mocks.get.mockResolvedValue({
			leaders: [],
			scanned: { posts: 0, comments: 0 },
			strike_terms_threshold: 4,
		});
		render(<SlangLeaders />);
		await waitFor(() =>
			expect(screen.getByText(/No slang detected in recent content/)).toBeTruthy(),
		);
		expect(screen.queryAllByTestId("slang-leader-row")).toHaveLength(0);
	});

	it("refetches only when the admin asks for it", async () => {
		render(<SlangLeaders />);
		await waitFor(() =>
			expect(screen.getAllByTestId("slang-leader-row")).toHaveLength(2),
		);
		expect(mocks.get).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "Refresh slang leaders" }));
		await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
	});

	it("surfaces a load failure instead of rendering an empty leaderboard", async () => {
		mocks.get.mockRejectedValue(new Error("Admin session expired"));
		render(<SlangLeaders />);
		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith("Admin session expired", "err"),
		);
		expect(screen.queryAllByTestId("slang-leader-row")).toHaveLength(0);
	});
});
