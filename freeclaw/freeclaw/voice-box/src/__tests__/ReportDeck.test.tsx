// ═══════════════════════════════════════════════════════════════════
// ReportDeck — the admin presentation surface
// ═══════════════════════════════════════════════════════════════════
// One click from the admin desk → animated slide deck from LIVE data
// (GET /api/report-deck, the same spec the PPT export renders). The admin
// ticks which pages go in (Complaints / Feed / Reports / Polls / Trends /
// Actions, or All); the viewer AND the PPT honour exactly that pick.
// Anonymity-safe by construction: the spec carries no identities —
// titles, categories, counts only. Empty DB → honest empty, never filler.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportDeck from "../pages/admin/ReportDeck";
import { cannedSpec, emptySpec } from "./deckSpecFixture";

const mocks = vi.hoisted(() => ({
	getSlow: vi.fn(),
	post: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	toast: vi.fn(),
	buildPptx: vi.fn(async () => {}),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getSlow: mocks.getSlow,
		post: mocks.post,
		put: mocks.put,
		del: mocks.del,
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/deckExport", () => ({
	buildPptx: mocks.buildPptx,
}));

beforeEach(() => {
	vi.clearAllMocks();
});

function renderDeck() {
	return render(<ReportDeck />);
}

describe("ReportDeck section selection", () => {
	it("offers every page with All selected by default", async () => {
		mocks.getSlow.mockResolvedValueOnce(cannedSpec());
		renderDeck();
		for (const label of [
			/Complaints/,
			/Feed/,
			/Reports/,
			/Polls/,
			/Trends/,
			/Actions/,
		]) {
			expect(await screen.findByRole("checkbox", { name: label })).toBeChecked();
		}
	});

	it("unticking Polls removes the polls slide from the viewer", async () => {
		mocks.getSlow.mockResolvedValueOnce(cannedSpec());
		renderDeck();
		await screen.findByRole("checkbox", { name: /Polls/ });
		fireEvent.click(screen.getByRole("checkbox", { name: /Polls/ }));
		await waitFor(() => {
			expect(
				screen.queryByText(/Sports day/),
			).not.toBeInTheDocument();
		});
		// The kept sections still render from live rows.
		expect(screen.getByText(/Fix the lab taps/)).toBeInTheDocument();
	});

	it("Export PPT sends ONLY the ticked sections", async () => {
		mocks.getSlow.mockResolvedValueOnce(cannedSpec());
		renderDeck();
		await screen.findByRole("checkbox", { name: /Polls/ });
		fireEvent.click(screen.getByRole("checkbox", { name: /Complaints/ }));
		fireEvent.click(screen.getByRole("checkbox", { name: /Feed/ }));
		fireEvent.click(screen.getByRole("checkbox", { name: /Reports/ }));
		fireEvent.click(screen.getByRole("checkbox", { name: /Trends/ }));
		fireEvent.click(screen.getByRole("checkbox", { name: /Actions/ }));
		fireEvent.click(screen.getByRole("button", { name: /Export PPT/ }));
		await waitFor(() => {
			expect(mocks.buildPptx).toHaveBeenCalledTimes(1);
		});
		const [, sections] = mocks.buildPptx.mock.calls[0] as [
			unknown,
			string[],
		];
		expect(sections).toEqual(["polls"]);
	});

	it("Select all restores the full deck after clearing", async () => {
		mocks.getSlow.mockResolvedValueOnce(cannedSpec());
		renderDeck();
		await screen.findByRole("checkbox", { name: /Polls/ });
		fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
		expect(screen.getByRole("checkbox", { name: /Polls/ })).not.toBeChecked();
		fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
		for (const label of [/Complaints/, /Feed/, /Reports/, /Polls/, /Trends/, /Actions/]) {
			expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
		}
	});
});

describe("ReportDeck honesty", () => {
	it("renders an honest empty on an empty database — no fabricated numbers", async () => {
		mocks.getSlow.mockResolvedValueOnce(emptySpec());
		renderDeck();
		expect(await screen.findByText(/No data yet/i)).toBeInTheDocument();
		expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
	});

	it("names the source when the deck endpoint fails", async () => {
		mocks.getSlow.mockRejectedValueOnce(new Error("boom"));
		renderDeck();
		expect(await screen.findByText(/report-deck/i)).toBeInTheDocument();
	});

	it("navigates slides with arrows and dots", async () => {
		mocks.getSlow.mockResolvedValueOnce(cannedSpec());
		renderDeck();
		await screen.findByText(/Fix the lab taps/);
		const next = screen.getByRole("button", { name: /Next slide/i });
		fireEvent.click(next);
		expect(
			screen.getByRole("button", { name: /Previous slide/i }),
		).toBeInTheDocument();
	});
});
