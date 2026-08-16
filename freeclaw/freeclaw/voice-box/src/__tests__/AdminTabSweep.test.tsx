// ═══════════════════════════════════════════════════════════════════
// ADMIN TAB SWEEP — mounts every admin tab with a mocked API to find
// which one crashes on render (regression for the "Something went wrong"
// ErrorBoundary panel with EMPTY error details — i.e. a non-Error thrown).
// ═══════════════════════════════════════════════════════════════════

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
	api: {
		post: vi.fn(async () => ({})),
		get: vi.fn(async () => []),
		getSlow: vi.fn(async () => []),
		postLong: vi.fn(async () => []),
		getLong: vi.fn(async () => []),
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
vi.mock("../pages/admin/agent-office/Office3D", () => ({
	default: () => <div data-testid="office-3d" />,
}));

// ── Candidate tabs (lazy modules) ──────────────────────────────────
// default: unknown — modules have heterogeneous props (e.g. PostsTable
// needs { type }); the test only needs the default export to render.
const tabs: [string, () => Promise<{ default: unknown }>][] = [
	["Overview", () => import("../pages/admin/Overview")],
	["AdminAI", () => import("../pages/admin/AdminAI")],
	["AIOperations", () => import("../pages/admin/AIOperations")],
	["CommandCenter", () => import("../pages/admin/CommandCenter")],
	["UnifiedInbox", () => import("../pages/admin/UnifiedInbox")],
	["AiPanel", () => import("../pages/admin/AiPanel")],
	["PostsTable", () => import("../pages/admin/PostsTable")],
	["SuggestionsTable", () => import("../pages/admin/SuggestionsTable")],
	["PollManager", () => import("../pages/admin/PollManager")],
	["CommentMod", () => import("../pages/admin/CommentMod")],
	["UserManager", () => import("../pages/admin/UserManager")],
	["Logs", () => import("../pages/admin/Logs")],
	["Categories", () => import("../pages/admin/Categories")],
	["AdminSettings", () => import("../pages/admin/AdminSettings")],
	["ErrorTracking", () => import("../pages/admin/ErrorTracking")],
	["AdminLeaderboard", () => import("../pages/admin/AdminLeaderboard")],
	["WorkforceConsole", () => import("../pages/admin/WorkforceConsole")],
	["AgentOutputPage", () => import("../pages/admin/AgentOutputPage")],
	["AgentDashboard", () => import("../pages/admin/AgentDashboard")],
	["AgentTeamPanel", () => import("../pages/admin/AgentTeamPanel")],
	["ContentReview", () => import("../pages/admin/ContentReview")],
	["ProviderSettings", () => import("../pages/admin/ProviderSettings")],
	["AdminChat", () => import("../pages/admin/AdminChat")],
];	describe("Admin tab render sweep — no tab may crash on mount", () => {
		for (const [name, importFn] of tabs) {
			// Heavy dynamic imports (chart/animation libs in Overview, AIOperations,
			// AdminAI) can exceed the 5s default under full-suite load. Give each
			// mount 30s — we're testing for crashes, not timing.
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
				render(<Comp />);
			} catch (e) {
				threw = e;
			}
			expect(threw).toBeNull();
		}, 30_000);
	}
});
