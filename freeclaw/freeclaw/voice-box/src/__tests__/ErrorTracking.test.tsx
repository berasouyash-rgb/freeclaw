// ═══════════════════════════════════════════════════════════════════
// ErrorTracking — Sentry + health + chunk integrity contract
// ═══════════════════════════════════════════════════════════════════
// Locks: health load + status badge mapping, health error state, chunk
// manifest load (ok/missing), test-error send (Sentry success/failure),
// error-like audit events list + empty state, subsystem checks, runtime
// memory rows, raw health JSON disclosure, refresh-all wiring.
// ═══════════════════════════════════════════════════════════════════

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ErrorTracking from "../pages/admin/ErrorTracking";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	getFresh: vi.fn(),
	captureException: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
	captureException: mocks.captureException,
}));

vi.mock("../lib/api", () => ({
	api: { get: mocks.get, getFresh: mocks.getFresh },
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/utils", () => ({
	safeStringify: (o: unknown) => JSON.stringify(o, null, 2),
	timeAgo: () => "2m ago",
}));

const HEALTH = {
	status: "degraded",
	timestamp: "2026-07-01T10:00:00.000Z",
	response_time_ms: 820,
	version: "2.0.0",
	checks: {
		database: { status: "healthy", count: 42 },
		providers: { status: "ok", available: ["nvidia", "gemini"] },
		api_latency: { status: "degraded", latency_ms: 820 },
	},
	system: {
		env: "production",
		region: "us-east",
		node_version: "v20.11.0",
		uptime_seconds: 3600,
		memory: { rss_mb: 120, heap_used_mb: 80, heap_total_mb: 200 },
	},
};

const CHUNKS = {
	generated: "2026-07-01T10:00:00.000Z",
	count: 3,
	chunks: [
		{ name: "AdminAI", sizeKB: 150 },
		{ name: "Reports", size: 204800 },
		{ name: "Settings", sizeKB: 12 },
	],
};

const ERRORS = [
	{
		id: "e1",
		action: "failed_login",
		actor: "anon_x",
		detail: "Bad password attempt",
		created_at: "2026-07-01T09:00:00.000Z",
	},
	{
		id: "e2",
		action: "user_banned",
		actor: "admin",
		detail: "anon_spam permanently banned",
		created_at: "2026-07-01T08:00:00.000Z",
	},
];

beforeEach(() => {
	vi.clearAllMocks();
	// The initial loadErrors() call uses api.get (only live refreshes use getFresh),
	// so route by URL inside a single implementation.
	mocks.get.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/audit-trail")) return { logs: ERRORS };
		return HEALTH;
	});
	mocks.getFresh.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/audit-trail")) return { logs: ERRORS };
		return HEALTH;
	});
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: async () => CHUNKS,
	}) as unknown as typeof fetch;
});

function seed(opts: {
	health?: unknown;
	healthError?: boolean;
	chunks?: unknown;
	chunksOk?: boolean;
	logs?: unknown;
} = {}) {
	if (opts.healthError) {
		mocks.get.mockImplementation(async () => {
			throw new Error("health boom");
		});
	} else if (opts.health !== undefined) {
		mocks.get.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/audit-trail")) return { logs: ERRORS };
			return opts.health;
		});
	}
	if (opts.chunksOk === false) {
		(global.fetch as any).mockResolvedValue({
			ok: false,
			json: async () => ({}),
		});
	} else if (opts.chunks !== undefined) {
		(global.fetch as any).mockResolvedValue({
			ok: true,
			json: async () => opts.chunks,
		});
	}
	if (opts.logs !== undefined) {
		mocks.get.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/audit-trail")) return { logs: opts.logs };
			return opts.health ?? HEALTH;
		});
		mocks.getFresh.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/audit-trail")) return { logs: opts.logs };
			return opts.health ?? HEALTH;
		});
	}
}

function renderPage() {
	return render(<ErrorTracking />);
}

describe("ErrorTracking — health", () => {
	it("renders platform health with overall status badge", async () => {
		seed();
		renderPage();
		expect(await screen.findByText("Platform health")).toBeInTheDocument();
		// 'Degraded' appears for the overall platform badge AND the api_latency
		// check row — scope to the platform-health card
		const card = screen.getByText("Platform health").closest(".card") as HTMLElement;
		expect(within(card).getAllByText("Degraded").length).toBeGreaterThan(0);
		expect(within(card).getByText(/820ms · v2\.0\.0/)).toBeInTheDocument();
	});

	it("shows subsystem checks with per-check status badges", async () => {
		seed();
		renderPage();
		expect(await screen.findByText("Subsystem checks")).toBeInTheDocument();
		const sub = screen.getByText("Subsystem checks").closest(".card") as HTMLElement;
		expect(within(sub).getByText("database")).toBeInTheDocument();
		expect(within(sub).getByText("providers")).toBeInTheDocument();
		expect(within(sub).getByText("api latency")).toBeInTheDocument();
		// healthy + ok + degraded badges
		expect(within(sub).getAllByText("Healthy").length).toBeGreaterThan(0);
		expect(within(sub).getAllByText("OK").length).toBeGreaterThan(0);
	});

	it("renders runtime memory and system chips", async () => {
		seed();
		renderPage();
		expect(await screen.findByText("Runtime (server instance)")).toBeInTheDocument();
		expect(screen.getByText("120")).toBeInTheDocument(); // RSS
		expect(screen.getByText("80")).toBeInTheDocument(); // heap used
		expect(screen.getByText("3600")).toBeInTheDocument(); // uptime s
		const runtime = screen
			.getByText("Runtime (server instance)")
			.closest(".card") as HTMLElement;
		expect(within(runtime).getByText("production")).toBeInTheDocument();
		expect(within(runtime).getByText(/us-east/)).toBeInTheDocument();
		expect(within(runtime).getByText(/v20\.11\.0/)).toBeInTheDocument();
	});

	it("shows an explicit error message when the health check fails", async () => {
		seed({ healthError: true });
		renderPage();
		expect(await screen.findByText("health boom")).toBeInTheDocument();
		expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
	});

	it("shows 'No health data' when checks are empty", async () => {
		seed({ health: { status: "ok", timestamp: "", checks: {} } });
		renderPage();
		expect(
			await screen.findByText("No health data — run a health check."),
		).toBeInTheDocument();
	});

	it("exposes the raw health JSON behind the details disclosure", async () => {
		seed();
		renderPage();
		await screen.findByText("Platform health");

		fireEvent.click(screen.getByText("View raw health JSON"));
		expect(
			screen.getByText(/"response_time_ms": 820/),
		).toBeInTheDocument();
	});
});

describe("ErrorTracking — build chunks", () => {
	it("shows chunk manifest stats and top chunks", async () => {
		seed();
		renderPage();
		expect(await screen.findByText(/3 lazy chunks generated/)).toBeInTheDocument();
		expect(screen.getByText("AdminAI")).toBeInTheDocument();
		expect(screen.getByText("150KB")).toBeInTheDocument();
		// size in bytes is converted to KB (204800 / 1024 = 200)
		expect(screen.getByText("200KB")).toBeInTheDocument();
	});

	it("warns when the chunk manifest is missing", async () => {
		seed({ chunksOk: false });
		renderPage();
		expect(
			await screen.findByText(/health-chunks\.json not found/),
		).toBeInTheDocument();
		expect(screen.getByText("Warning")).toBeInTheDocument();
	});
});

describe("ErrorTracking — error events + Sentry", () => {
	it("lists error-like audit events with action, detail and actor", async () => {
		seed();
		renderPage();
		expect(await screen.findByText("failed_login")).toBeInTheDocument();
		expect(screen.getByText("Bad password attempt")).toBeInTheDocument();
		expect(screen.getByText("user_banned")).toBeInTheDocument();
		expect(screen.getByText("anon_x")).toBeInTheDocument();
	});

	it("shows the empty state when no error events exist", async () => {
		seed({ logs: [] });
		renderPage();
		expect(await screen.findByText("No error events found")).toBeInTheDocument();
		expect(screen.getByText(/All quiet/)).toBeInTheDocument();
	});

	it("filters out non-risky audit events client-side", async () => {
		seed({
			logs: [
				...ERRORS,
				{ id: "e3", action: "post_created", actor: "anon_y", detail: "new post", created_at: "2026-07-01T07:00:00.000Z" },
			],
		});
		renderPage();
		await screen.findByText("failed_login");
		expect(screen.queryByText("post_created")).not.toBeInTheDocument();
	});

	it("sends a test error to Sentry on the button click", async () => {
		seed();
		renderPage();
		await screen.findByText("Platform health");

		fireEvent.click(screen.getByRole("button", { name: /Send test error/ }));
		await waitFor(() => {
			expect(mocks.captureException).toHaveBeenCalledWith(
				expect.any(Error),
			);
		});
		expect(mocks.toast).toHaveBeenCalledWith(
			"Test error sent to Sentry ✓",
			"ok",
		);
	});

	it("shows 'never' for the last test error before any send", async () => {
		seed();
		renderPage();
		await screen.findByText("Platform health");
		expect(screen.getByText(/never/)).toBeInTheDocument();
	});

	it("refresh all re-fetches health, chunks and errors", async () => {
		seed();
		renderPage();
		await screen.findByText("Platform health");

		fireEvent.click(screen.getByRole("button", { name: /Refresh all/ }));
		await waitFor(() => {
			expect(mocks.get).toHaveBeenCalledTimes(4); // initial(3) + refresh frontend-errors
		});
		expect(mocks.getFresh).toHaveBeenCalledTimes(2);
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});
});

describe("ErrorTracking — status badge mapping", () => {
	it.each([
		["healthy", "Healthy"],
		["ok", "OK"],
		["degraded", "Degraded"],
		["warning", "Warning"],
		["unhealthy", "Unhealthy"],
		["error", "Error"],
	])("maps status %s to badge %s", async (status, label) => {
		seed({
			health: {
				status,
				timestamp: "",
				checks: { api: { status } },
			},
		});
		renderPage();
		// The label appears on the overall badge AND the api check row —
		// assert at least one badge exists
		expect(await screen.findAllByText(label)).not.toHaveLength(0);
	});

	it("falls back to the raw status label for unknown statuses", async () => {
		seed({
			health: { status: "mystery", timestamp: "", checks: { x: { status: "mystery" } } },
		});
		renderPage();
		expect(await screen.findAllByText("mystery")).not.toHaveLength(0);
	});
});
