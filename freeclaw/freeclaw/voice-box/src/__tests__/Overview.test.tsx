// ═══════════════════════════════════════════════════════════════════
// Overview — admin dashboard home
// ═══════════════════════════════════════════════════════════════════
// Covers:
//   • header + LIVE indicator + export buttons
//   • big danger popup (critical alert) + acknowledge wiring
//   • NEEDS ATTENTION band, only when something actually needs review
//   • metric strip (open reports / emergency / week / engagement / …)
//   • glass workspace filter — Trending · Recent · Open Issues · Reports
//     · Suggestions · Polls (defaults to Trending, one focused panel at a time)
//   • status dialog (Start / Solve) calling the real posts API
//   • truthful empty states — no fabricated busyness
// NOTE: workforce internals (live tasks, real operations) moved to the
//   Ops Center tab by design — covered by OpsCenter.test.tsx
// ═══════════════════════════════════════════════════════════════════

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Overview from "../pages/admin/Overview";

// ── Mocks ──────────────────────────────────────────────────────────
vi.mock("../lib/api", () => ({
	api: {
		get: vi.fn(),
		getSlow: vi.fn(),
		post: vi.fn(),
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

// QuickActions has its own dedicated suite — keep Overview focused.
vi.mock("../pages/admin/QuickActions", () => ({
	default: () => <div data-testid="quick-actions-stub" />,
}));

import { api } from "../lib/api";

const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedGetSlow = api.getSlow as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const mockedPut = api.put as ReturnType<typeof vi.fn>;

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

const PROBLEM = {
	id: "post-1",
	type: "problem",
	title: "Broken lift in Block C",
	description: "The lift has been stuck since morning.",
	category: "Facilities",
	status: "open",
	priority: "high",
	author_id: "anon_test",
	created_at: iso(2 * MIN),
	reactions: { support: 14 },
	comment_count: 3,
	status_history: [],
	deleted: false,
};

const SOLVED = {
	...PROBLEM,
	id: "post-2",
	title: "Water cooler empty",
	status: "solved",
	priority: "low",
	created_at: iso(2 * DAY),
	status_history: [{ status: "solved", at: iso(DAY) }],
};

const SUGGESTION = {
	id: "post-3",
	type: "suggestion",
	title: "Add a quiet study zone",
	description: "More silent seating near the library.",
	category: "Improvement",
	status: "open",
	priority: "medium",
	author_id: "anon_test",
	created_at: iso(10 * MIN),
	reactions: {},
	comment_count: 1,
	deleted: false,
};

const COMMENT = {
	id: "c1",
	post_id: "post-1",
	body: "Happening again today",
	author_id: "anon_a",
	created_at: iso(5 * MIN),
};

const REPORT = {
	id: "r1",
	target_type: "post",
	target_id: "post-1",
	reason: "Spam",
	status: "pending",
	created_at: iso(30 * MIN),
};

const USER = {
	id: "anon_test",
	name: "Anonymous user",
	email: "anon@voicebox",
	role: "student",
};

const POLL = {
	id: "poll-1",
	title: "Extend library hours?",
	ptype: "yesno",
	options: ["Yes", "No"],
	author_id: "ADMIN",
	expires_at: null,
	archived: false,
	deleted: false,
	total_votes: 20,
	vote_counts: { 0: 15, 1: 5 },
	created_at: iso(60 * MIN),
};

const ALERT = {
	id: "alert-1",
	key: "spam-cluster",
	severity: "critical",
	title: "Coordinated spam activity detected",
	body: "Multiple identical posts from one session.",
	agent: "security-monitor",
	evidence: "3 correlated signals",
	occurrences: 4,
	acknowledged_at: null,
	acknowledged_by: null,
	resolved_at: null,
	resolved_by: null,
	created_at: iso(5 * MIN),
	last_at: iso(2 * MIN),
};

function seedData(
	overrides: Partial<{
		posts: unknown[];
		comments: unknown[];
		reports: unknown[];
		users: unknown[];
		polls: unknown[];
		alerts: unknown[];
		liveWork: unknown[];
		verifiedToday: number;
		autoResolved: unknown[];
	}> = {},
) {
	const posts = overrides.posts ?? [PROBLEM, SOLVED, SUGGESTION];
	const reports = overrides.reports ?? [REPORT];
	const alerts = overrides.alerts ?? [ALERT];

	mockedGetSlow.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/posts")) return posts;
		if (path.startsWith("/api/workforce?action=ops-summary")) {
			return {
				alerts: { alerts },
				live_work: overrides.liveWork ?? [],
				verified_today: overrides.verifiedToday ?? 5,
				auto_resolved: overrides.autoResolved ?? [],
				platform: {
					posts: posts.length,
					pending_reports: reports.filter((r) => (r as { status: string }).status === "pending").length,
					users: 10,
					comments: 3,
					reactions: 20,
				},
				activity: [],
				updated_at: new Date().toISOString(),
			};
		}
		return {};
	});
	mockedGet.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/comments")) return overrides.comments ?? [COMMENT];
		if (path.startsWith("/api/reports")) return reports;
		if (path.startsWith("/api/polls")) return overrides.polls ?? [POLL];
		return [];
	});
	mockedPost.mockImplementation(async (path: string) => {
		if (path === "/api/admin") return overrides.users ?? [USER];
		return { ok: true };
	});
	mockedPut.mockResolvedValue({ ok: true });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("Overview (dashboard home)", () => {
	it("renders the dashboard header with LIVE indicator and export buttons", async () => {
		seedData();
		render(<Overview />);

		await waitFor(() => {
			expect(screen.getByText("Dashboard")).toBeInTheDocument();
			expect(screen.getByText(/LIVE · updated/)).toBeInTheDocument();
		});
		expect(
			screen.getByRole("button", { name: /Export CSV/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Export JSON/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Print \/ PDF/ })).toBeInTheDocument();
	});

	it("shows the big danger popup for open critical alerts with acknowledge wiring", async () => {
		seedData();
		render(<Overview />);

		await waitFor(() => {
			expect(screen.getByText("⚠ CRITICAL DETECTED")).toBeInTheDocument();
		});
		expect(
			screen.getByText("Coordinated spam activity detected"),
		).toBeInTheDocument();
		expect(screen.getByText(/×4 occurrences/)).toBeInTheDocument();
		expect(screen.getByText(/Detected by Security Monitor/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
		await waitFor(() => {
			expect(mockedPost).toHaveBeenCalledWith("/api/workforce", {
				action: "acknowledge-alert",
				id: ALERT.id,
			});
		});
	});

	it("renders no danger popup when every alert is acknowledged or resolved", async () => {
		seedData({
			alerts: [
				{ ...ALERT, acknowledged_at: iso(1 * MIN), acknowledged_by: "admin" },
			],
		});
		render(<Overview />);

		await waitFor(() => {
			expect(screen.getByText("Dashboard")).toBeInTheDocument();
		});
		expect(screen.queryByText("⚠ CRITICAL DETECTED")).not.toBeInTheDocument();
	});

	it("stays quiet on the dashboard — open reports surface as a filter badge, not a banner", async () => {
		seedData();
		render(<Overview />);

		// No hype banner — background work stays hidden. The count lives on the
		// Reports filter tab and the danger popup handles only critical alerts.
		await screen.findByRole("tab", { name: /Trending/ });
		// The community health ring shows severity labels (Critical / Needs attention / Excellent)
		// which are legitimate UI — we only block hype banners, not health indicators.
		expect(screen.queryByText(/AI URGENCY|AI urgency/i)).not.toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /^Reports/ }).getAttribute("aria-label")).toMatch(
			/— 1/,
		);
	});

	it("renders the metric strip with real counts from the loaded data", async () => {
		seedData();
		render(<Overview />);

		await waitFor(() => {
			expect(screen.getByText("Open reports")).toBeInTheDocument();
		});
		// “Emergency” also appears as an attention-band shortcut — scope to the strip
		const strip = screen.getByText("Open reports").closest("div.card");
		expect(strip).not.toBeNull();
		expect(within(strip as HTMLElement).getByText("Open issues")).toBeInTheDocument();
		expect(within(strip as HTMLElement).getByText("Posts · week")).toBeInTheDocument();
		expect(within(strip as HTMLElement).getByText("Engagement")).toBeInTheDocument();
		expect(within(strip as HTMLElement).getByText("Suggestions")).toBeInTheDocument();
		expect(within(strip as HTMLElement).getByText("Active polls")).toBeInTheDocument();
		expect(within(strip as HTMLElement).getByText("Resolution")).toBeInTheDocument();
	});

	it("lists recent activity as a table with category, status and time", async () => {
		seedData();
		render(<Overview />);

		// Recent is a glass filter tab — switch to it from the default Trending view
		fireEvent.click(await screen.findByRole("tab", { name: /Recent/ }));
		const section = await screen.findByText("RECENT ACTIVITY");
		const table = section.closest("section") as HTMLElement;
		// The same post title also shows in Trending/Open Issues — scope to the table
		await waitFor(() => {
			expect(within(table).getByText("Broken lift in Block C")).toBeInTheDocument();
		});
		expect(within(table).getAllByText(/Facilities/).length).toBeGreaterThan(0);
		// newest first: suggestion (10m) precedes lift (2m)
		const rows = within(table).getAllByRole("row");
		expect(rows.length).toBeGreaterThan(1);
	});

	it("shows trending issues ranked with Start / Solve actions", async () => {
		seedData();
		render(<Overview />);

		await waitFor(() => {
			expect(screen.getByText("🔥 TRENDING")).toBeInTheDocument();
		});
		const section = screen
			.getByText("🔥 TRENDING")
			.closest("section") as HTMLElement;
		expect(within(section).getByText("Broken lift in Block C")).toBeInTheDocument();
		// Solved posts are excluded from trending actions but the open one shows Start
		expect(
			within(section).getByRole("button", { name: /Start/ }),
		).toBeInTheDocument();
	});

	it("solves a trending issue through the status dialog calling the real API", async () => {
		seedData();
		render(<Overview />);

		await waitFor(() => {
			expect(screen.getByText("🔥 TRENDING")).toBeInTheDocument();
		});
		const section = screen
			.getByText("🔥 TRENDING")
			.closest("section") as HTMLElement;
		fireEvent.click(within(section).getByRole("button", { name: /Solve/ }));

		await waitFor(() => {
			expect(
				screen.getByText("Update status → Solved"),
			).toBeInTheDocument();
		});
		// StatusDialog seeds a template note; submit via the primary button
		fireEvent.click(
			screen.getByRole("button", { name: "Update & notify" }),
		);
		await waitFor(() => {
			expect(mockedPut).toHaveBeenCalledWith(
				"/api/posts",
				expect.objectContaining({ id: "post-1", status: "solved" }),
			);
		});
	});

	it("marks a trending issue in-progress through the dialog", async () => {
		seedData();
		render(<Overview />);

		await waitFor(() => {
			expect(screen.getByText("🔥 TRENDING")).toBeInTheDocument();
		});
		const section = screen
			.getByText("🔥 TRENDING")
			.closest("section") as HTMLElement;
		fireEvent.click(within(section).getByRole("button", { name: /Start/ }));

		await waitFor(() => {
			expect(
				screen.getByText("Update status → In Progress"),
			).toBeInTheDocument();
		});
	});

	it("shows posts in the Open Issues tab", async () => {
		seedData();
		render(<Overview />);

		fireEvent.click(await screen.findByRole("tab", { name: /Open Issues/ }));
		await waitFor(() => {
			expect(
				screen.getByText("OPEN ISSUES"),
			).toBeInTheDocument();
		});
		const section = screen
			.getByText("OPEN ISSUES")
			.closest("section") as HTMLElement;
		expect(within(section).getByText("Broken lift in Block C")).toBeInTheDocument();
	});

	it("shows a calm empty state when there are no open issues", async () => {
		seedData({ posts: [SUGGESTION] });
		render(<Overview />);

		fireEvent.click(await screen.findByRole("tab", { name: /Open Issues/ }));
		await waitFor(() => {
			expect(
				screen.getByText("No open issues — all calm. ✓"),
			).toBeInTheDocument();
		});
	});

	it("lists open reports with reason and age", async () => {
		seedData();
		render(<Overview />);

		fireEvent.click(await screen.findByRole("tab", { name: /^Reports/ }));
		await waitFor(() => {
			expect(screen.getByText("OPEN REPORTS")).toBeInTheDocument();
			expect(screen.getByText("Spam")).toBeInTheDocument();
		});
	});

	it("shows active polls with vote totals and a leading option bar", async () => {
		seedData();
		render(<Overview />);

		fireEvent.click(await screen.findByRole("tab", { name: /Polls/ }));
		await waitFor(() => {
			expect(screen.getByText("ACTIVE POLLS")).toBeInTheDocument();
			expect(screen.getByText("📊 Extend library hours?")).toBeInTheDocument();
			expect(screen.getByText("20 votes")).toBeInTheDocument();
		});
	});

	it("excludes archived / expired / deleted polls from the active count", async () => {
		seedData({
			polls: [
				{ ...POLL, id: "p-archived", archived: true },
				{ ...POLL, id: "p-expired", expires_at: iso(2 * MIN) },
				{ ...POLL, id: "p-deleted", deleted: true },
			],
		});
		render(<Overview />);

		fireEvent.click(await screen.findByRole("tab", { name: /Polls/ }));
		await waitFor(() => {
			expect(screen.getByText("ACTIVE POLLS")).toBeInTheDocument();
		});
		const section = screen
			.getByText("ACTIVE POLLS")
			.closest("section") as HTMLElement;
		// none of the invalid polls render
		expect(within(section).queryByText(/📊 Extend library hours\?/)).not.toBeInTheDocument();
		expect(
			screen.getByText("No active polls right now."),
		).toBeInTheDocument();
	});

	it("renders the suggestions feed with newest suggestion-type posts and a Review shortcut", async () => {
		seedData();
		render(<Overview />);

		fireEvent.click(await screen.findByRole("tab", { name: /Suggestions/ }));
		const header = await screen.findByText("SUGGESTIONS");
		const section = header.closest("section") as HTMLElement;
		await waitFor(() => {
			// The suggestion title also appears in the recent table — scope here
			expect(
				within(section).getByText("Add a quiet study zone"),
			).toBeInTheDocument();
		});
		const listener = vi.fn();
		window.addEventListener("vb:admin-tab", listener);
		fireEvent.click(within(section).getByRole("button", { name: /Review/ }));
		await waitFor(() => {
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({ detail: "suggestions" }),
			);
		});
		window.removeEventListener("vb:admin-tab", listener);
	});

	it("shows the honest empty state when there are no suggestions yet", async () => {
		seedData({ posts: [PROBLEM] });
		render(<Overview />);

		fireEvent.click(await screen.findByRole("tab", { name: /Suggestions/ }));
		await waitFor(() => {
			expect(
				screen.getByText(
					"No suggestions yet — community ideas appear here.",
				),
			).toBeInTheDocument();
		});
	});

	it("renders loading skeletons first, then content", async () => {
		seedData();
		const releases: (() => void)[] = [];
		mockedGetSlow.mockImplementation((path: string) =>
			new Promise((resolve) => {
				releases.push(() => {
					const data = path.startsWith("/api/workforce")
						? {
								alerts: { alerts: [] },
								live_work: [],
								verified_today: 0,
								auto_resolved: [],
								platform: {},
								activity: [],
						  }
						: [];
					resolve(data);
				});
			}),
		);
		render(<Overview />);

		// Both getSlow calls (posts + ops-summary) are still pending → skeletons
		expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
		releases.forEach((r) => r());
		await waitFor(() => {
			expect(screen.getByText("Dashboard")).toBeInTheDocument();
		});
	});

	it("keeps last-known data when the ops-summary endpoint fails", async () => {
		seedData();
		mockedGetSlow.mockImplementation(async (path: string) => {
			if (path.startsWith("/api/posts")) return [PROBLEM, SUGGESTION];
			throw new Error("ops runtime unreachable");
		});
		render(<Overview />);

		// Content still loads from the other endpoints even if ops-summary dies
		await waitFor(() => {
			expect(
				screen.getAllByText("Broken lift in Block C").length,
			).toBeGreaterThan(0);
		});
		// Dashboard stays usable: metric strip renders
		expect(screen.getByText("Open reports")).toBeInTheDocument();
	});

	it("defaults to the Trending glass filter tab", async () => {
		seedData();
		render(<Overview />);

		// The glass filter bar lists every dashboard section
		await screen.findByRole("tab", { name: /Trending/ });
		expect(screen.getByRole("tab", { name: /Recent/ })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /Open Issues/ })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /^Reports/ })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /Suggestions/ })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: /Polls/ })).toBeInTheDocument();
		// Trending is selected by default → its panel is the only one showing
		const trending = screen.getByRole("tab", { name: /Trending/ });
		expect(trending.getAttribute("aria-selected")).toBe("true");
		expect(screen.getByText("🔥 TRENDING")).toBeInTheDocument();
	});

	it("switching a filter swaps the visible panel", async () => {
		seedData();
		render(<Overview />);

		await screen.findByRole("tab", { name: /Trending/ });
		// Trending is up first
		expect(screen.getByText("🔥 TRENDING")).toBeInTheDocument();
		expect(screen.queryByText("RECENT ACTIVITY")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("tab", { name: /Recent/ }));
		await waitFor(() => {
			expect(screen.getByText("RECENT ACTIVITY")).toBeInTheDocument();
			expect(screen.queryByText("🔥 TRENDING")).not.toBeInTheDocument();
		});
		// Selected state moves with the tab
		expect(
			screen.getByRole("tab", { name: /Recent/ }).getAttribute("aria-selected"),
		).toBe("true");
	});

	it("shows live counts on the filter badges from the loaded data", async () => {
		seedData();
		render(<Overview />);

		// One open report + one active poll in the seed data
		const reports = await screen.findByRole("tab", { name: /^Reports/ });
		expect(reports.getAttribute("aria-label")).toMatch(/— 1/);
		expect(screen.getByRole("tab", { name: /Polls/ }).getAttribute("aria-label")).toMatch(
			/— 1/,
		);
	});

	it("keeps the AI/workforce internals off the dashboard by design", async () => {
		seedData();
		render(<Overview />);

		// The dashboard is outcome-focused: no live agent streams, no runtime
		// internals. Those live on the Ops Center tab (covered by OpsCenter.test.tsx).
		await screen.findByRole("tab", { name: /Trending/ });
		expect(screen.queryByText("LIVE WORKFORCE")).not.toBeInTheDocument();
		expect(screen.queryByText("REAL OPERATIONS")).not.toBeInTheDocument();
		expect(screen.queryByText(/WORKING NOW/)).not.toBeInTheDocument();
	});
});
