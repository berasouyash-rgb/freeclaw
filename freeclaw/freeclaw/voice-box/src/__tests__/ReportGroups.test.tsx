// ═══════════════════════════════════════════════════════════════════
// Report root-issue grouping (spec §24)
// ═══════════════════════════════════════════════════════════════════
// Locks: repeated reports about the SAME target collapse into one root
// issue with impact (count/reporters/first/latest), singletons stay out,
// and "Resolve root issue" verifies every member through the real PUT.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { groupReports } from "../lib/report-groups";

vi.mock("../lib/api", () => ({
	api: {
		post: vi.fn(),
		get: vi.fn(),
		getSlow: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: vi.fn() }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../components/PostPreviewCard", () => ({
	default: () => <div data-testid="post-preview-card" />,
}));

import { api } from "../lib/api";
import Reports from "../pages/admin/Reports";

const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedGetSlow = api.getSlow as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedPut = api.put as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-09-22T10:00:00Z").toISOString();
const EARLIER = new Date("2026-09-20T10:00:00Z").toISOString();

describe("groupReports (pure)", () => {
	it("collapses repeats on the same target, omits singletons", () => {
		const groups = groupReports([
			{ id: 1, target_id: "post_x", target_type: "post", reason: "Water cooler broken", author_id: "a1", created_at: EARLIER },
			{ id: 2, target_id: "post_x", target_type: "post", reason: "Water cooler broken", author_id: "a2", created_at: NOW },
			{ id: 3, target_id: "post_y", target_type: "post", reason: "Other", author_id: "a3", created_at: NOW },
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			key: "post:post_x",
			count: 2,
			reporters: 2,
			first_at: EARLIER,
			latest_at: NOW,
		});
		expect(groups[0]?.report_ids).toEqual([1, 2]);
	});

	it("sorts by impact (count desc, latest desc) and caps reasons at 3", () => {
		const groups = groupReports([
			{ id: 1, target_id: "t1", target_type: "post", reason: "r1", created_at: EARLIER },
			{ id: 2, target_id: "t1", target_type: "post", reason: "r2", created_at: EARLIER },
			{ id: 3, target_id: "t2", target_type: "post", reason: "r1", created_at: NOW },
			{ id: 4, target_id: "t2", target_type: "post", reason: "r2", created_at: NOW },
			{ id: 5, target_id: "t2", target_type: "post", reason: "r3", created_at: NOW },
			{ id: 6, target_id: "t2", target_type: "post", reason: "r4", created_at: NOW },
		]);
		expect(groups[0]?.key).toBe("post:t2");
		expect(groups[0]?.reasons).toEqual(["r1", "r2", "r3"]);
	});

	it("flags urgent inbox groups and enforced removals", () => {
		const groups = groupReports([
			{ id: 1, target_id: "th1", target_type: "inbox", reason: "[INBOX-URGENT] help", created_at: NOW, worker_action: { enforced: true } },
			{ id: 2, target_id: "th1", target_type: "inbox", reason: "[INBOX] help", created_at: NOW },
		]);
		expect(groups[0]?.urgent).toBe(true);
		expect(groups[0]?.enforced).toBe(true);
	});

	it("returns [] for empty / singleton-only queues (never invents groups)", () => {
		expect(groupReports([])).toEqual([]);
		expect(
			groupReports([{ id: 1, target_id: "a", target_type: "post", reason: "x", created_at: NOW }]),
		).toEqual([]);
	});
});

describe("Reports root-issue UI", () => {
	function seed() {
		mockedPost.mockResolvedValue({ approvals: [] });
		mockedGet.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/reports"))
				return [
					{ id: 1, target_id: "post_x", target_type: "post", reason: "Water cooler broken", status: "open", author_id: "a1", created_at: EARLIER },
					{ id: 2, target_id: "post_x", target_type: "post", reason: "Water cooler still broken", status: "open", author_id: "a2", created_at: NOW },
					{ id: 3, target_id: "post_y", target_type: "post", reason: "Other issue", status: "open", author_id: "a3", created_at: NOW },
				];
			if (path.startsWith("/api/pre-review")) return { items: [] };
			if (path.startsWith("/api/comments")) return [];
			return [];
		});
		mockedGetSlow.mockResolvedValue([]);
		mockedPut.mockResolvedValue({ verification: { verified: true, detail: "ok" } });
	}

	it("shows one root issue for the repeated target with impact", async () => {
		seed();
		render(<Reports />);
		await waitFor(() => expect(screen.getByText(/Root issues/)).toBeInTheDocument());
		expect(screen.getByText(/2 reports · 2 reporter\(s\)/)).toBeInTheDocument();
		// Singletons still render in the normal queue below
		expect(screen.getByText(/Other issue/)).toBeInTheDocument();
	});

	it("resolve root issue verifies every member through the real PUT", async () => {
		seed();
		render(<Reports />);
		const btn = await screen.findByRole("button", { name: /Resolve root issue post_x \(2 reports\)/ });
		fireEvent.click(btn);
		await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(2));
		expect(mockedPut).toHaveBeenCalledWith("/api/reports", { id: 1, status: "resolved" });
		expect(mockedPut).toHaveBeenCalledWith("/api/reports", { id: 2, status: "resolved" });
	});
});
