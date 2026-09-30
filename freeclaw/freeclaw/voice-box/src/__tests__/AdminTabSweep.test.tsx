// ═══════════════════════════════════════════════════════════════════
// ADMIN TAB SWEEP — mounts every admin tab with a mocked API to find
// which one crashes on render (regression for the "Something went wrong"
// ErrorBoundary panel with EMPTY error details — i.e. a non-Error thrown).
// ═══════════════════════════════════════════════════════════════════

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
	api: {
		post: vi.fn(async () => ({})),
		get: vi.fn(async () => []),
		getSlow: vi.fn(async () => []),
		postLong: vi.fn(async () => []),
		getLong: vi.fn(async () => []),
		postAgent: vi.fn(async () => ({})),
		put: vi.fn(async () => ({})),
		del: vi.fn(async () => ({})),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({
		toast: vi.fn(),
		anonId: "anon_test",
		theme: "light",
		toggleTheme: vi.fn(),
		pushNotif: vi.fn(),
		accountStatus: null,
	}),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

vi.mock("../lib/useSmartPoll", () => ({
	useSmartPoll: () => ({
		forceRefresh: vi.fn(),
		isPolling: false,
		lastError: null,
	}),
}));

vi.mock("../lib/supabase", () => ({ default: null }));

// Heavy child components — stub so page internals are what we're testing
vi.mock("../components/PostPreviewCard", () => ({
	default: () => <div data-testid="post-preview-card" />,
}));

// ── Candidate tabs (lazy modules) ──────────────────────────────────
// default: unknown — modules have heterogeneous props (e.g. PostsTable
// needs { type }); the test only needs the default export to render.
const tabs: [string, () => Promise<{ default: unknown }>][] = [
	["ActionCenter", () => import("../pages/admin/ActionCenter")],
	["AgentChat", () => import("../pages/admin/AgentChat")],
	["OpsCenter", () => import("../pages/admin/OpsCenter")],
	["SystemHealth", () => import("../pages/admin/SystemHealth")],
	["PerformanceCenter", () => import("../pages/admin/PerformanceCenter")],
	["SecurityCenter", () => import("../pages/admin/SecurityCenter")],
	["ActivityStream", () => import("../pages/admin/ActivityStream")],
	["Reports", () => import("../pages/admin/Reports")],
	["UnifiedInbox", () => import("../pages/admin/UnifiedInbox")],
	["ErrorTracking", () => import("../pages/admin/ErrorTracking")],
	["Logs", () => import("../pages/admin/Logs")],
	["PostsTable", () => import("../pages/admin/PostsTable")],
	["PollManager", () => import("../pages/admin/PollManager")],
	["SlangLeaders", () => import("../pages/admin/SlangLeaders")],
	["UserManager", () => import("../pages/admin/UserManager")],
	["Categories", () => import("../pages/admin/Categories")],
	["EmailTemplates", () => import("../pages/admin/EmailTemplates")],
	["AiSystems", () => import("../pages/admin/AiSystems")],
	["AdminSettings", () => import("../pages/admin/AdminSettings")],
];	describe("Admin tab render sweep — no tab may crash on mount", () => {
		// Some tabs do parallel data loads (health, chunks, errors, telemetry) plus
		// heavy dynamic imports. Under full-suite parallel-worker contention these
		// mounts are far slower than in isolation — the sweep asserts "no crash on
		// mount", not mount latency, so the budget is deliberately generous.
		const heavyMounts = new Set(["ActionCenter", "Reports"]);
		for (const [name, importFn] of tabs) {
			const timeout = heavyMounts.has(name) ? 90_000 : 30_000;
			it(`renders ${name} without throwing`, async () => {
			let Comp: any = null;
			try {
				const mod = await importFn();
				Comp = mod.default;
			} catch (e) {
				// Some modules may have import-time side effects; log and skip is
				// NOT acceptable — a failed import means a broken tab.
				throw new Error(`Module import failed for ${name}: ${String(e)}`);
			}
			expect(Comp).toBeTruthy();
			// Wrap in try/catch so a throw surfaces as a clear assertion failure
			let threw: unknown = null;
			try {
				render(
					<MemoryRouter initialEntries={["/admin"]}>
						<Comp />
					</MemoryRouter>,
				);
			} catch (e) {
				threw = e;
			}
			expect(threw).toBeNull();
		}, timeout);
	}
});
