// Admin Communities — admins can identify and view every community,
// including hidden ones (the list endpoint hides them from non-admins
// server-side; this panel is admin-only by route).
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Communities from "../pages/admin/Communities";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: { get: mocks.get } }));

vi.mock("../lib/utils", () => ({
	timeAgo: () => "2d ago",
}));

const ROWS = [
	{
		slug: "hostel-a",
		name: "Hostel A",
		avatar: "🏠",
		hidden: false,
		member_count: 12,
		post_count: 5,
		created_at: "2026-09-01T00:00:00.000Z",
	},
	{
		slug: "secret-club",
		name: "Secret Club",
		avatar: "🤫",
		hidden: true,
		member_count: 3,
		post_count: 1,
		created_at: "2026-09-02T00:00:00.000Z",
	},
];

function renderPage() {
	return render(
		<MemoryRouter>
			<Communities />
		</MemoryRouter>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue({ communities: ROWS });
});

describe("Admin Communities", () => {
	it("lists every community with a visible Hidden badge on hidden ones", async () => {
		renderPage();
		expect(await screen.findByText("Hostel A")).toBeInTheDocument();
		expect(screen.getByText("Secret Club")).toBeInTheDocument();
		expect(screen.getByText("Hidden")).toBeInTheDocument();
		expect(screen.getByText(/2 total/)).toBeInTheDocument();
	});

	it("links each community to its page for moderation", async () => {
		renderPage();
		const open = await screen.findByRole("link", { name: "Open Secret Club" });
		expect(open.getAttribute("href")).toBe("/communities/secret-club");
	});

	it("stays honest when the list is empty", async () => {
		mocks.get.mockResolvedValue({ communities: [] });
		renderPage();
		expect(await screen.findByText("No communities yet")).toBeInTheDocument();
	});
});
