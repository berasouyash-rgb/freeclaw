// ═══════════════════════════════════════════════════════════════════
// useCategories — dynamic category list contract
// ═══════════════════════════════════════════════════════════════════
// Locks the hook contract:
//   1. Falls back to the static CATEGORIES when the API is unavailable
//   2. Uses the server-provided list when available
//   3. Ignores malformed/empty server lists (keeps defaults)
// This keeps every category dropdown safe even if /api/categories 500s.
// ═══════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCategories } from "../hooks/useCategories";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../lib/api", () => ({ api: { get: mocks.get } }));
vi.mock("../lib/utils", () => ({
	CATEGORIES: ["Default1", "Default2", "Default3"],
}));

function Probe() {
	const cats = useCategories();
	return (
		<ul>
			{cats.map((c) => (
				<li key={c}>{c}</li>
			))}
		</ul>
	);
}

describe("useCategories", () => {
	beforeEach(() => {
		mocks.get.mockReset();
		mocks.get.mockResolvedValue(undefined);
	});

	it("falls back to the static CATEGORIES when the API returns nothing", async () => {
		render(<Probe />);
		expect(await screen.findByText("Default1")).toBeTruthy();
		expect(screen.getByText("Default2")).toBeTruthy();
		expect(screen.getByText("Default3")).toBeTruthy();
	});

	it("uses the server-provided list when available", async () => {
		mocks.get.mockResolvedValue({
			categories: ["Server A", "Server B", "Server C"],
		});
		render(<Probe />);
		expect(await screen.findByText("Server A")).toBeTruthy();
		expect(screen.getByText("Server B")).toBeTruthy();
		expect(screen.queryByText("Default1")).toBeNull();
	});

	it("ignores an empty server list and keeps defaults", async () => {
		mocks.get.mockResolvedValue({ categories: [] });
		render(<Probe />);
		expect(await screen.findByText("Default1")).toBeTruthy();
		expect(screen.queryByText("Server A")).toBeNull();
	});
});
