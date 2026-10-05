// ═══════════════════════════════════════════════════════════════════
// Communities page — list rendering, create dialog, empty state
// ═══════════════════════════════════════════════════════════════════
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Communities from "../pages/Communities";

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	hasAdminSession: vi.fn(() => false),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, post: mocks.post },
	hasAdminSession: mocks.hasAdminSession,
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		anonId: "anon-test",
		toast: vi.fn(),
		displayName: "Test User",
	}),
}));

vi.mock("react-router", () => ({
	Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const listRes = {
	communities: [
		{
			slug: "study-gang",
			name: "Study Gang",
			description: "Cram together",
			avatar: "📚",
			created_by: "anon_a",
			created_at: new Date().toISOString(),
			hidden: false,
			member_count: 3,
			post_count: 5,
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.get.mockResolvedValue(listRes);
});

describe("Communities page", () => {
	it("picks up a community created elsewhere, with no clicks (evolution 2026-10-05)", async () => {
		render(<Communities />);
		await screen.findByText("Study Gang");
		// Another device creates a community after this screen loaded.
		mocks.get.mockResolvedValue({
			communities: [
				...listRes.communities,
				{
					slug: "night-owls",
					name: "Night Owls",
					description: "Late study",
					avatar: "🌙",
					created_by: "anon_b",
					created_at: new Date().toISOString(),
					hidden: false,
					member_count: 1,
					post_count: 0,
				},
			],
		});
		// No Refresh click — the background tick merges it on its own.
		await screen.findByText("Night Owls", undefined, { timeout: 15000 });
	});

	it("renders the community list from the API", async () => {
		render(<Communities />);
		expect(await screen.findByText("Study Gang")).toBeInTheDocument();
		expect(screen.getByText("Cram together")).toBeInTheDocument();
		expect(screen.getByText("New community")).toBeInTheDocument();
	});

	it("shows member and post counts", async () => {
		render(<Communities />);
		await screen.findByText("Study Gang");
		expect(screen.getByText("3")).toBeInTheDocument();
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("opens the create dialog and shows the form", async () => {
		render(<Communities />);
		await screen.findByText("Study Gang");
		// create button is inside the empty/normal header
		await screen.getByRole("button", { name: "New community" }).click();
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByLabelText("Name")).toBeInTheDocument();
		expect(screen.getByText("Create community")).toBeInTheDocument();
	});

	it("shows an honest empty state when no communities exist", async () => {
		mocks.get.mockResolvedValue({ communities: [] });
		render(<Communities />);
		expect(
			await screen.findByText("No communities yet"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Create your community" })).toBeInTheDocument();
	});

	it("surfaces a load error instead of crashing", async () => {
		mocks.get.mockRejectedValue(new Error("network down"));
		render(<Communities />);
		expect(await screen.findByText("network down")).toBeInTheDocument();
	});

	it("owns exactly one visibility-guarded background timer", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/pages/Communities.tsx"),
			"utf8",
		);
		const timers = source.match(/setInterval\s*\(/g) || [];
		expect(timers.length).toBe(1);
		expect(source).toContain('document.visibilityState === "hidden"');
	});
});
