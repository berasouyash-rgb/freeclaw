// ═══════════════════════════════════════════════════════════════════
// Customisable admin dashboard — catalog, layout and page contract
// ═══════════════════════════════════════════════════════════════════
// The dashboard is only trustworthy if two things hold:
//   1. every widget reads a REAL, routable source (a widget pointing at a
//      dead endpoint would render as a permanent empty box), and
//   2. a saved layout can never break the page — unknown widgets are
//      dropped, spans are clamped, corrupt JSON falls back to defaults.
// Both are asserted here, along with the page's add/remove/persist flow.
// ═══════════════════════════════════════════════════════════════════

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PulseStrip from "../components/admin/PulseStrip";
import {
	ACCENTS,
	CATEGORY_META,
	clampSpan,
	SOURCES,
	sourcesFor,
	WIDGET_BY_ID,
	WIDGETS,
	type WidgetInstance,
} from "../lib/dashboard/widgets";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	getSlow: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, getSlow: mocks.getSlow },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/useRealtime", () => ({ useRealtime: () => undefined }));

vi.mock("../lib/useSmartPoll", () => ({
	useSmartPoll: () => ({ forceRefresh: vi.fn() }),
}));

beforeEach(() => {
	vi.clearAllMocks();
	window.localStorage.clear();
	mocks.get.mockResolvedValue({
		total: 42,
		total_posts: 7,
		resolution_rate: 63,
		health_score: 91,
		status: "healthy",
		daily_frequency: [
			{ date: "2026-09-01", count: 3 },
			{ date: "2026-09-02", count: 5 },
		],
		category_distribution: { Facilities: 4, Academics: 2 },
		problems: [{ title: "Broken lift", support: 12 }],
		leaderboard: [{ name: "anon_a", score: 30 }],
		emerging_topics: [],
		priority_trends: {},
		top_categories: [],
		checks: { api: { status: "ok", response_time_ms: 12 } },
	});
	mocks.getSlow.mockResolvedValue({
		health_score: 91,
		total_rows: 1000,
		total_stale: 0,
		response_time_ms: 20,
		status: "healthy",
		checks: { api: { status: "ok", response_time_ms: 12 } },
		circuits: {},
	});
});

// ══════════════════════════════════════════════════════════════════
describe("widget catalog integrity", () => {
	it("has unique widget ids", () => {
		const ids = WIDGETS.map((w) => w.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("has no id absent from the lookup map", () => {
		expect(Object.keys(WIDGET_BY_ID).length).toBe(WIDGETS.length);
	});

	it("points every widget at a real, declared source", () => {
		// A widget whose source key is not in SOURCES can never load: it would
		// sit as a permanent empty box. This is the guard against that.
		const byKey = SOURCES as Record<string, { path: string } | undefined>;
		for (const w of WIDGETS) {
			if (!w.source) continue;
			expect(
				byKey[w.source.key],
				`${w.id} references unknown source "${w.source.key}"`,
			).toBeDefined();
			expect(w.source.path.startsWith("/api/")).toBe(true);
		}
	});

	it("uses spans in ascending min/default/max order", () => {
		for (const w of WIDGETS) {
			const [min, def, max] = w.spans;
			expect(min, w.id).toBeLessThanOrEqual(def);
			expect(def, w.id).toBeLessThanOrEqual(max);
			expect(min, w.id).toBeGreaterThanOrEqual(1);
			expect(max, w.id).toBeLessThanOrEqual(12);
		}
	});

	it("gives every widget a description and a known category", () => {
		for (const w of WIDGETS) {
			expect(w.description.length, w.id).toBeGreaterThan(10);
			expect(CATEGORY_META[w.category], w.id).toBeDefined();
		}
	});

	it("renders an honest empty state when its source has no data", () => {
		// No payload at all: the widget must say it has nothing rather than
		// print a zero or a plausible-looking number.
		const ctx = { data: {}, loading: {}, failed: {}, refreshedAt: null };
		for (const w of WIDGETS) {
			if (!w.source) continue;
			render(<div>{w.render(ctx)}</div>);
			expect(
				screen.getAllByText(/No data available yet/i).length,
				w.id,
			).toBeGreaterThan(0);
			// Clean up between widgets so queries stay unambiguous.
			document.body.innerHTML = "";
		}
	});

	it("ignores a truncated payload instead of inventing a value", () => {
		const ctx = {
			data: { trends7: { total_posts: "not-a-number" } },
			loading: {},
			failed: {},
			refreshedAt: Date.now(),
		};
		const def = WIDGET_BY_ID["posts-7d"];
		expect(def).toBeDefined();
		render(<div>{def!.render(ctx)}</div>);
		expect(screen.getByText("—")).toBeInTheDocument();
	});

	it("fetches each distinct source once, however many widgets use it", () => {
		const instances: WidgetInstance[] = [
			{ iid: "a", widgetId: "posts-7d", span: 3, height: 108, opacity: 1, accent: "accent", glass: true },
			{ iid: "b", widgetId: "volume-trend-7d", span: 3, height: 108, opacity: 1, accent: "accent", glass: true },
			{ iid: "c", widgetId: "emerging-7d", span: 3, height: 108, opacity: 1, accent: "accent", glass: true },
		];
		// All three read trends7.
		expect(sourcesFor(instances).map((s) => s.key)).toEqual(["trends7"]);
	});

	it("clamps a span to the widget's own bounds", () => {
		const def = WIDGET_BY_ID["posts-7d"];
		expect(def).toBeDefined();
		expect(clampSpan(def!, 99)).toBe(def!.spans[2]);
		expect(clampSpan(def!, 0)).toBe(def!.spans[0]);
	});

	it("offers every accent the card can apply", () => {
		expect(Object.keys(ACCENTS).length).toBeGreaterThanOrEqual(5);
	});

	it("uses every declared source", () => {
		// A declared source that no widget references is dead weight: it would
		// never be fetched and silently rots as the endpoints change.
		const used = new Set(WIDGETS.map((w) => w.source?.key).filter(Boolean));
		for (const key of Object.keys(SOURCES)) {
			expect(used.has(key), `source "${key}" is never used`).toBe(true);
		}
	});

	it("covers every category so the picker is never lopsided", () => {
		const cats = new Set(WIDGETS.map((w) => w.category));
		for (const c of Object.keys(CATEGORY_META)) {
			expect(cats.has(c as never), `no widgets in category "${c}"`).toBe(true);
		}
	});

	it("builds a large catalog without duplicating a widget id", () => {
		// The catalog is the product surface, so its size is asserted — a
		// regression that silently dropped entries would otherwise pass.
		expect(WIDGETS.length).toBeGreaterThanOrEqual(100);
	});
});
// ══════════════════════════════════════════════════════════════════
describe("PulseStrip — curated widgets on the main dashboard", () => {
	function seed() {
		mocks.get.mockImplementation(async (path) => {
			if (path.includes("trends?period=7d"))
				return {
					total_posts: 7,
					daily_frequency: [
						{ date: "2026-09-01", count: 3 },
						{ date: "2026-09-02", count: 4 },
					],
				};
			if (path.includes("trends?period=30d"))
				return { resolution_rate: 63 };
			return {};
		});
		mocks.getSlow.mockImplementation(async (path) => {
			if (path.includes("ops-summary"))
				return {
					alerts: { open: 2 },
					verified_today: 5,
					task_queue: { queued: 3 },
					metrics: { success_rate: 92 },
				};
			return {};
		});
	}

	it("renders five curated decision-first widgets with real numbers", async () => {
		seed();
		const onDrill = vi.fn();
		render(<PulseStrip onDrill={onDrill} />);
		expect(await screen.findByText("Live pulse")).toBeInTheDocument();
		expect(await screen.findByText("Open alerts")).toBeInTheDocument();
		expect(screen.getByText("Verified outcomes today")).toBeInTheDocument();
		expect(screen.getByText("Queued tasks")).toBeInTheDocument();
		expect(screen.getByText("Worker success rate")).toBeInTheDocument();
		expect(screen.getByText("Submission trend")).toBeInTheDocument();
		// Real values from the mocked endpoints, not placeholders.
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("drills into the owning tab instead of dead-ending", async () => {
		seed();
		const onDrill = vi.fn();
		render(<PulseStrip onDrill={onDrill} />);
		await screen.findByText("Live pulse");
		fireEvent.click(
			screen.getByRole("button", { name: /Open Open alerts details/i }),
		);
		expect(onDrill).toHaveBeenCalledWith("ops-center");
	});

	it("contains a failed endpoint per widget instead of blanking", async () => {
		seed();
		mocks.getSlow.mockRejectedValue(new Error("workforce down"));
		render(<PulseStrip onDrill={vi.fn()} />);
		await screen.findByText("Live pulse");
		// Workforce-backed cards report unavailability…
		await waitFor(() =>
			expect(screen.getAllByText(/unavailable — retrying/i).length).toBeGreaterThan(0),
		);
		// …while the trends-backed card still renders its real number.
		expect(await screen.findByText("7")).toBeInTheDocument();
	});

	it("shows honest emptiness, never invented numbers", async () => {
		mocks.get.mockResolvedValue({});
		mocks.getSlow.mockResolvedValue({});
		render(<PulseStrip onDrill={vi.fn()} />);
		await screen.findByText("Live pulse");
		await waitFor(() =>
			expect(screen.getAllByText(/No data available yet/i).length).toBeGreaterThan(0),
		);
	});
});
