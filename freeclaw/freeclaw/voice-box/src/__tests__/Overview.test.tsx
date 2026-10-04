// ═══════════════════════════════════════════════════════════════════
// Overview — the admin's production Dashboard, exactly
// ═══════════════════════════════════════════════════════════════════
// Explicit user override 2026-09-26: this tab matches the production
// /admin dashboard panel-for-panel (order, copy, classes, charts), with
// every figure computed from the already-loaded snapshot — never a
// fabricated number. These tests pin that contract, and they pin the
// things that stay absent: the AI-suggestions strip, agent-activity /
// health / performance furniture, status dialogs. (Production queue
// filter pills are covered by their own live-count tests below.)
//
//   • header (Dashboard + SNAPSHOT counts) + Refresh (explicit, never passive)
//   • health ring, urgency bar, pipeline bar, stat tiles — all from real data
//   • broadcast composer wired to /api/announcements; triage Verify/Start
//     wired to real status PUTs
//   • activity bars, category bars, submission heatmap — real daily counts
//   • trending issues ranked by live engagement, Start/Solve wired to PUTs
//   • the six work sections render INSIDE the dashboard, from real data
//   • every work item carries the same nine facts
//   • bucketing is honest: no duplicates, no invented work, empty states
//     that say so
//   • jump row targets only ACTIVE tab keys and dispatches vb:admin-tab
//   • critical alert is never hidden; acknowledge + open-work are wired
//   • Action Center is a secondary panel, off by default
//   • exports contain real records, and partial failures name the source
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
const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	getSlow: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
	toast: vi.fn(),
	downloadFile: vi.fn(),
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

// downloadFile is spied (it touches the DOM), everything else stays real so
// the CSV builders and timeAgo still run the production code path.
vi.mock("../lib/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/utils")>();
	return { ...actual, downloadFile: mocks.downloadFile };
});

// ActionCenter has its own dedicated suite — keep Overview focused on the
// dashboard. The import must stay (the page owns a toggle for it).
vi.mock("../pages/admin/ActionCenter", () => ({
	default: () => <div data-testid="action-center-stub" />,
}));

// ── Fixtures ───────────────────────────────────────────────────────
const now = () => new Date().toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * A timestamp `ms` in the past that is still inside today (local time).
 *
 * Plain `ago()` drifts across the midnight boundary: at 00:12 a "30 minutes
 * ago" report is actually *yesterday*, so a section that keys off "is this new
 * today" would file it under WAITING and the test would only fail near
 * midnight. Clamping to just after local midnight keeps the fixture's intent
 * ("arrived today") true at every hour of the day.
 */
const todayAgo = (ms: number) => {
	const midnight = new Date();
	midnight.setHours(0, 0, 0, 0);
	const t = Math.max(Date.now() - ms, midnight.getTime() + 30_000);
	return new Date(t).toISOString();
};

// Field names must match PostData: the compliance CSV reads `title`,
// `description`, `status` and `priority`, not `body`.
const PROBLEM = {
	id: "post-1",
	type: "problem",
	title: "Common room heater is broken",
	description: "The common room heater is broken again",
	category: "Facilities",
	status: "open",
	priority: "high",
	author_id: "anon_student_1",
	deleted: false,
	created_at: ago(2 * HOUR),
};

const SOLVED = {
	id: "post-2",
	type: "solved",
	title: "Lab 3 projector replaced",
	description: "Lab 3 projector replaced",
	category: "Facilities",
	status: "solved",
	priority: "medium",
	author_id: "anon_student_2",
	deleted: false,
	created_at: ago(DAY),
};

const COMMENT = {
	id: "c1",
	post_id: "post-1",
	body: "Happening again today",
	author_id: "anon_a",
	created_at: ago(5 * MIN),
};

const REPORT = {
	id: 7,
	target_type: "post",
	target_id: "post_9",
	reason: "spam",
	status: "pending",
	author_id: "anon_reporter_1",
	target_author_id: "anon_author_2",
	created_at: todayAgo(30 * MIN),
};

const USER = {
	id: "anon_test",
	name: "Anonymous user",
	email: "anon@voicebox",
	role: "student",
	total: 1042,
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
	created_at: ago(HOUR),
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
	created_at: ago(5 * MIN),
	last_at: ago(2 * MIN),
};

const SUMMARY = {
	generated_at: now(),
	total: 3,
	open: 2,
	critical: 1,
	by_category: [],
	recent: [
		{
			id: "ACT-1",
			status: "OPEN",
			category: "CRITICAL_MODERATION",
			title: "Security review required",
			created_at: todayAgo(90 * MIN),
			resolved_at: null,
			resolution: null,
		},
		{
			id: "ACT-2",
			status: "IN_REVIEW",
			category: "RECOVERY",
			title: "Feed recovery pass",
			created_at: todayAgo(40 * MIN),
			resolved_at: null,
			resolution: null,
		},
		{
			id: "ACT-0",
			status: "RESOLVED",
			category: "PROTECTED_OPERATION",
			title: "Protected action verified",
			created_at: ago(3 * HOUR),
			resolved_at: ago(2 * HOUR),
			resolution: "Outcome confirmed",
		},
	],
};

const ERRORS = {
	errors: [
		{
			id: "e1",
			message: "TypeError: undefined is not an object",
			source: "feed",
			count: 4,
			first: ago(3 * HOUR),
			last: now(),
		},
	],
};

/** Seed every endpoint Overview and WorkSections read. */
function seedData(
	overrides: Partial<{
		posts: unknown[];
		comments: unknown[];
		reports: unknown[];
		users: unknown[];
		polls: unknown[];
		threads: unknown[];
		alerts: unknown[];
		summary: unknown;
		errors: unknown;
		announcement: unknown;
		/** Sources that should reject instead of resolving. */
		fail: string[];
		/** Sources that never settle, holding the loading gate open. */
		hang: string[];
	}> = {},
) {
	const fail = new Set(overrides.fail ?? []);
	const hang = new Set(overrides.hang ?? []);

	const posts = overrides.posts ?? [PROBLEM, SOLVED];
	const reports = overrides.reports ?? [REPORT];
	const alerts = overrides.alerts ?? [];
	const summary = overrides.summary ?? SUMMARY;
	const errors = overrides.errors ?? ERRORS;

	const reject = (name: string) => () =>
		Promise.reject(new Error(`${name} unavailable`));
	/** Never settles — used to prove a surface is not behind the loading gate. */
	const stall = () => new Promise<never>(() => {});

	mocks.getSlow.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/workforce"))
			return fail.has("alerts")
				? reject("workforce")()
				: { alerts: { alerts }, updated_at: now() };
		if (hang.has("posts")) return stall();
		if (fail.has("posts")) return reject("posts")();
		return posts;
	});

	mocks.get.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/comments"))
			return fail.has("comments") ? reject("comments")() : (overrides.comments ?? [COMMENT]);
		if (path.startsWith("/api/polls"))
			return hang.has("polls")
				? stall()
				: fail.has("polls")
					? reject("polls")()
					: (overrides.polls ?? [POLL]);
		if (path.startsWith("/api/reports"))
			return fail.has("reports") ? reject("reports")() : reports;
		if (path.startsWith("/api/inbox"))
			return fail.has("inbox")
				? reject("inbox")()
				: path.includes("thread_id=")
					? {
							messages: [
								{
									id: "m1",
									sender: "user",
									body: "Drawer hello",
									created_at: "2026-07-02T09:00:00.000Z",
								},
							],
						}
					: (overrides.threads ?? []);
		if (path.startsWith("/api/action-center"))
			return fail.has("action-center")
				? reject("action-center")()
				: summary;
		if (path.startsWith("/api/errors"))
			return fail.has("errors")
				? reject("errors")()
				: { errors: Array.isArray(errors) ? errors : (errors as { errors: unknown[] }).errors };
		if (path.startsWith("/api/announce"))
			return fail.has("announcements")
				? reject("announcements")()
				: (overrides.announcement ?? null);
		return [];
	});

	mocks.post.mockImplementation(async (path: string, body?: unknown) => {
		if (path === "/api/admin" && (body as { action?: string })?.action === "users") {
			if (fail.has("users")) return reject("users")();
			return overrides.users ?? [USER];
		}
		if (path === "/api/workforce") return { ok: true };
		return { ok: true };
	});
}

async function renderDashboard() {
	render(<Overview />);
	// Past the loading gate.
	await waitFor(() =>
		expect(screen.getByTestId("admin-dashboard")).toBeTruthy(),
	);
	// Work sections arrive with the slowest section query — under full-shard
	// load that lands past the default 1s waitFor budget (flaked 4× in CI
	// style runs, always green solo). Same assertion, patient budget: this
	// waits for rendering, never invents it.
	await waitFor(() => expect(screen.getByTestId("work-sections")).toBeTruthy(), {
		timeout: 10_000,
	});
}

/** Sections render collapsed (glass card + live count in the header);
 * expand one by tapping its header button. */
function expandWorkSection(title: RegExp) {
	fireEvent.click(screen.getByRole("button", { name: title }));
}
async function expandAllWorkSections() {
	for (const title of [
		/^Urgent\s*\d+$/,
		/^Today\s*\d+$/,
		/^In progress\s*\d+$/,
		/^Waiting\s*\d+$/,
		/^Recently completed\s*\d+$/,
		/^Failed\s*\d+$/,
	]) {
		expandWorkSection(title);
	}
}

/** Every vb:admin-tab dispatch made during `fn`, in order. */
function captureTabEvents(fn: () => void): string[] {
	const seen: string[] = [];
	const handler = (e: Event) => seen.push((e as CustomEvent).detail);
	window.addEventListener("vb:admin-tab", handler);
	try {
		fn();
	} finally {
		window.removeEventListener("vb:admin-tab", handler);
	}
	return seen;
}

beforeEach(() => {
	vi.clearAllMocks();
	seedData();
	// The dashboard must not shout on every deliberate failure test.
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Overview — header and snapshot", () => {
	it("renders the production Dashboard inside the admin dashboard testid", async () => {
		await renderDashboard();
		expect(screen.getByTestId("admin-dashboard")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Dashboard" }),
		).toBeTruthy();
	});

	it("states the real counts it was given, not invented ones", async () => {
		await renderDashboard();
		expect(screen.getByText("SNAPSHOT")).toBeTruthy();
		// 2 posts · 1 comment · 1042 users (the row total is the population)
		expect(
			screen.getByText(/2 posts · 1 comments · 1042 users/),
		).toBeTruthy();
	});

	it("refreshes only when asked — no passive refetch", async () => {
		await renderDashboard();
		const before = mocks.getSlow.mock.calls.length;
		expect(
			screen.queryByText("Loading the latest records…"),
		).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
		await waitFor(() =>
			expect(mocks.getSlow.mock.calls.length).toBeGreaterThan(before),
		);
	});
});

describe("Overview — the six work sections", () => {
	it("shows all six sections inside the dashboard", async () => {
		await renderDashboard();
		const dash = screen.getByTestId("admin-dashboard");
		for (const id of [
			"work-urgent",
			"work-today",
			"work-progress",
			"work-waiting",
			"work-done",
			"work-failed",
		]) {
			expect(within(dash).getByTestId(`work-section-${id}`)).toBeTruthy();
		}
	});

	it("gives every item the same nine facts", async () => {
		await renderDashboard();
		await expandAllWorkSections();
		const item = screen.getAllByTestId("work-item")[0]!;
		for (const fact of [
			"Source",
			"Status",
			"Started",
			"Last update",
			"Verification",
		]) {
			expect(within(item).getByText(fact)).toBeTruthy();
		}
		// Title + reason
		expect(within(item).getByRole("heading", { level: 3 })).toBeTruthy();
		// Action + evidence disclosure
		expect(within(item).getByText("View evidence")).toBeTruthy();
		expect(within(item).getAllByRole("button").length).toBeGreaterThan(1);
	});

	it("routes the critical task to URGENT and a fresh report to TODAY", async () => {
		await renderDashboard();
		expandWorkSection(/^Urgent\s*\d+$/);
		expandWorkSection(/^Today\s*\d+$/);
		// URGENT holds only open CRITICAL_MODERATION work — a report that
		// arrived an hour ago is new work, not a critical failure.
		const urgent = within(screen.getByTestId("work-section-work-urgent"));
		expect(urgent.getByText("Security review required")).toBeTruthy();
		expect(urgent.queryByText(/^Report: /)).toBeNull();

		const today = within(screen.getByTestId("work-section-work-today"));
		expect(today.getByText(/^Report: /)).toBeTruthy();
	});

	it("routes an in-review task to IN PROGRESS", async () => {
		await renderDashboard();
		expandWorkSection(/^In progress\s*\d+$/);
		expect(
			within(screen.getByTestId("work-section-work-progress")).getByText(
				"Feed recovery pass",
			),
		).toBeTruthy();
	});

	it("routes a resolved task to RECENTLY COMPLETED with its resolution", async () => {
		await renderDashboard();
		expandWorkSection(/^Recently completed\s*\d+$/);
		const done = within(screen.getByTestId("work-section-work-done"));
		expect(done.getByText("Protected action verified")).toBeTruthy();
		expect(done.getByText(/Outcome confirmed/)).toBeTruthy();
	});

	it("routes a real error row to FAILED", async () => {
		await renderDashboard();
		expandWorkSection(/^Failed\s*\d+$/);
		const failed = within(screen.getByTestId("work-section-work-failed"));
		expect(
			failed.getByText("TypeError: undefined is not an object"),
		).toBeTruthy();
		expect(failed.getByText(/Frontend errors · 4 reports/)).toBeTruthy();
	});

	it("never places the same work in two sections", async () => {
		await renderDashboard();
		await expandAllWorkSections();
		const titles = screen
			.getAllByTestId("work-item")
			.map((el) => el.querySelector("h3")?.textContent ?? "");
		expect(new Set(titles).size).toBe(titles.length);
	});

	it("keeps the source record out of the collapsed DOM, then discloses it", async () => {
		await renderDashboard();
		expandWorkSection(/^Recently completed\s*\d+$/);
		const done = within(screen.getByTestId("work-section-work-done"));
		expect(done.queryByTestId("work-evidence")).toBeNull();

		fireEvent.click(done.getByText("View evidence"));
		const evidence = done.getByTestId("work-evidence");
		expect(within(evidence).getByText("Task id")).toBeTruthy();
		expect(within(evidence).getByText("ACT-0")).toBeTruthy();
	});

	it("sends the primary action to the real queue", async () => {
		await renderDashboard();
		expandWorkSection(/^Failed\s*\d+$/);
		const failed = within(screen.getByTestId("work-section-work-failed"));
		const dispatched = captureTabEvents(() => {
			fireEvent.click(failed.getByRole("button", { name: /Inspect/ }));
		});
		expect(dispatched).toEqual(["errors"]);
	});

	it("says so honestly when there is no work at all", async () => {
		seedData({
			summary: {
				generated_at: now(),
				total: 0,
				open: 0,
				critical: 0,
				by_category: [],
				recent: [],
			},
			reports: [],
			errors: [],
		});
		await renderDashboard();

		expect(screen.queryAllByTestId("work-item")).toHaveLength(0);
		await expandAllWorkSections();
		expect(screen.getByText("Nothing urgent — no critical work is waiting.")).toBeTruthy();
		expect(screen.getByText("Nothing new today.")).toBeTruthy();
		expect(screen.getByText("No recent errors.")).toBeTruthy();
		expect(screen.getByText("No verified outcomes yet.")).toBeTruthy();
	});

	it("names the source that failed and keeps the data that did load", async () => {
		seedData({ fail: ["errors"] });
		await renderDashboard();
		expandWorkSection(/^Urgent\s*\d+$/);
		expect(screen.getByText(/Some sources failed: errors/)).toBeTruthy();
		// Everything else still renders.
		expect(screen.getByText("Security review required")).toBeTruthy();
		expect(screen.getByTestId("work-section-work-failed")).toBeTruthy();
	});
});

describe("Overview — collapsible glass work sections", () => {
	it("renders collapsed glass sections with live counts, items hidden", async () => {
		await renderDashboard();
		expect(screen.queryAllByTestId("work-item")).toHaveLength(0);
		for (const name of [
			/^Urgent\s*\d+$/,
			/^Today\s*\d+$/,
			/^In progress\s*\d+$/,
			/^Waiting\s*\d+$/,
			/^Recently completed\s*\d+$/,
			/^Failed\s*\d+$/,
		]) {
			const btn = screen.getByRole("button", { name });
			expect(btn.getAttribute("aria-expanded")).toBe("false");
		}
		const urgent = screen.getByTestId("work-section-work-urgent");
		expect(urgent.className).toContain("glass-card");
		expect(screen.getByRole("button", { name: /^Today\s*\d+$/ })).toHaveTextContent(
			/1/,
		);
	});

	it("expands a section on header tap and collapses it again", async () => {
		await renderDashboard();
		const btn = screen.getByRole("button", { name: /^Today\s*\d+$/ });
		fireEvent.click(btn);
		expect(btn.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText(/^Report: /)).toBeTruthy();
		fireEvent.click(btn);
		expect(btn.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText(/^Report: /)).toBeNull();
	});

	it("expanding one section leaves the others collapsed", async () => {
		await renderDashboard();
		expandWorkSection(/^Waiting\s*\d+$/);
		expect(
			screen.getByRole("button", { name: /^Urgent\s*\d+$/ }).getAttribute("aria-expanded"),
		).toBe("false");
		expect(screen.queryByText("Security review required")).toBeNull();
	});
});

describe("Overview — jump row to the real queues", () => {
	it("offers exactly the active queues", async () => {
		await renderDashboard();
		const nav = within(screen.getByRole("navigation", { name: "Admin queues" }));
		for (const label of [
			"Reports",
			"Feed",
			"Users",
			"Polls",
			"Errors",
			"Logs",
		]) {
			expect(nav.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
		}
	});

	it("dispatches vb:admin-tab with the real key", async () => {
		await renderDashboard();
		const nav = within(screen.getByRole("navigation", { name: "Admin queues" }));
		const dispatched = captureTabEvents(() => {
			fireEvent.click(nav.getByRole("button", { name: /Reports/ }));
			fireEvent.click(nav.getByRole("button", { name: /Polls/ }));
		});
		expect(dispatched).toEqual(["reports", "polls"]);
	});

	it("has no button for a retired tab — a dead link would look live", async () => {
		await renderDashboard();
		const nav = within(screen.getByRole("navigation", { name: "Admin queues" }));
		for (const retired of [
			/Agent Chat/,
			/Ops Center/,
			/System Health/,
			/Performance/,
			/Security/,
			/Activity Stream/,
			/^Work$/,
		]) {
			expect(nav.queryByRole("button", { name: retired })).toBeNull();
		}
	});
});

describe("Overview — critical alerts are never hidden", () => {
	// The banner sits outside the loading gate, but it can only appear once
	// the real /api/workforce fetch has resolved. It is never suppressed by a
	// slow or failing page load — the gate is the one thing it ignores.
	async function renderWithAlert(hang: string[] = []) {
		seedData({ alerts: [ALERT], hang });
		render(<Overview />);
		await waitFor(() =>
			expect(screen.getByTestId("critical-overlay")).toBeTruthy(),
		);
	}

	it("shows a real open critical alert even before the rest of the page finishes loading", async () => {
		// One dashboard source never settles, so the page's own loading gate
		// is provably still closed. The critical banner must not be trapped
		// behind it — hiding an active critical alert is the one thing this
		// dashboard may never do.
		await renderWithAlert(["polls"]);
		expect(screen.getByText("Loading the latest records…")).toBeTruthy();
		expect(screen.queryByTestId("work-sections")).toBeNull();
		expect(screen.getByText("⚠ CRITICAL DETECTED")).toBeTruthy();
		expect(
			screen.getByText("Coordinated spam activity detected"),
		).toBeTruthy();
	});

	it("acknowledges through the real workforce endpoint", async () => {
		seedData({ alerts: [ALERT] });
		await renderWithAlert();
		fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
		await waitFor(() =>
			expect(mocks.post).toHaveBeenCalledWith("/api/workforce", {
				action: "acknowledge-alert",
				id: "alert-1",
			}),
		);
		await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
			"Alert acknowledged",
			"ok",
		));
	});

	it("sends the alert to the inline work sections, not a retired tab", async () => {
		seedData({ alerts: [ALERT] });
		await renderWithAlert();
		// "View work" scrolls to the dashboard work card and dispatches
		// no tab event — the standalone Work tab is retired.
		const dispatched = captureTabEvents(() => {
			fireEvent.click(screen.getByRole("button", { name: /View work/ }));
		});
		expect(dispatched).toEqual([]);
		expect(screen.queryByRole("button", { name: /Open console/ })).toBeNull();
	});

	it("stays usable when the ops runtime is unreachable", async () => {
		seedData({ alerts: [ALERT], fail: ["alerts"] });
		await renderDashboard();
		expect(screen.queryByTestId("critical-overlay")).toBeNull();
		expect(
			screen.getByRole("heading", { name: "Dashboard" }),
		).toBeTruthy();
	});
});

describe("Overview — Action Center is secondary", () => {
	it("stays hidden until the admin asks for it", async () => {
		await renderDashboard();
		expect(screen.queryByTestId("action-center-stub")).toBeNull();
		const toggle = screen.getByRole("button", { name: "Action Center" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(toggle);
		expect(screen.getByTestId("action-center-stub")).toBeTruthy();
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		fireEvent.click(toggle);
		expect(screen.queryByTestId("action-center-stub")).toBeNull();
	});
});

describe("Overview — exports carry the real records", () => {
	it("exports reports as CSV", async () => {
		await renderDashboard();
		fireEvent.click(screen.getByRole("button", { name: "Reports CSV" }));
		const [name, body, type] = mocks.downloadFile.mock.calls[0]!;
		expect(String(name)).toMatch(/^voicebox-reports-\d{4}-\d{2}-\d{2}\.csv$/);
		expect(String(body)).toContain("spam");
		expect(type).toBe("text/csv;charset=utf-8");
	});

	it("exports student complaints — the 'problem' post type", async () => {
		await renderDashboard();
		fireEvent.click(screen.getByRole("button", { name: "Complaints CSV" }));
		const [, body] = mocks.downloadFile.mock.calls[0]!;
		expect(String(body)).toContain("common room heater");
	});

	it("exports polls with the canonical total", async () => {
		await renderDashboard();
		fireEvent.click(screen.getByRole("button", { name: "Polls CSV" }));
		const [, body] = mocks.downloadFile.mock.calls[0]!;
		expect(String(body)).toContain("Extend library hours?");
	});

	it("exports the underlying records as JSON", async () => {
		await renderDashboard();
		fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
		const [name, body] = mocks.downloadFile.mock.calls[0]!;
		expect(String(name)).toMatch(/^voicebox-export-\d{4}-\d{2}-\d{2}\.json$/);
		const parsed = JSON.parse(String(body));
		expect(parsed.posts).toHaveLength(2);
		expect(parsed.reports).toHaveLength(1);
		expect(parsed.polls).toHaveLength(1);
		expect(typeof parsed.exported).toBe("string");
	});

	it("offers a print path for a paper copy", async () => {
		const print = vi
			.spyOn(window, "print")
			.mockImplementation(() => undefined);
		await renderDashboard();
		fireEvent.click(screen.getByRole("button", { name: "Print / PDF" }));
		expect(print).toHaveBeenCalled();
		print.mockRestore();
	});
});

describe("Overview — a source failure is named, not hidden", () => {
	it("reports which source failed and still shows the rest", async () => {
		seedData({ fail: ["users"] });
		await renderDashboard();
		expect(screen.getByText(/Some sources failed: users/)).toBeTruthy();
		expect(screen.getByText(/2 posts · 1 comments/)).toBeTruthy();
	});
});

describe("Overview — the rejected design stays gone", () => {
	it("has no AI-suggestions strip (the Suggestions tile counts real suggestion posts)", async () => {
		await renderDashboard();
		// Explicit user override 2026-09-26: the production dashboard names
		// its content-count tile "Suggestions". What stays banned is any
		// AI-generated suggestion strip — assert on that, not the word.
		expect(screen.queryByText(/Lightbulb|AI suggestion/i)).toBeNull();
		expect(screen.queryByText(/Generate suggestions/i)).toBeNull();
		expect(
			within(screen.getByTestId("dash-stats")).getByText("Suggestions"),
		).toBeTruthy();
	});

	it("has no agent-activity, health or performance furniture", async () => {
		await renderDashboard();
		for (const gone of [
			/Agent Activity/i,
			/System Health/i,
			/Performance/i,
			/Web Vitals/i,
		]) {
			expect(screen.queryByText(gone)).toBeNull();
		}
	});

	it("filters the ranked list through production queue pills with live counts", async () => {
		// Explicit user override 2026-09-26: the production workspace pills
		// (Trending / Recent / Open Issues / Reports / Suggestions / Polls)
		// filter the ranked list below, each carrying a live count from the
		// loaded snapshot — never a hardcoded number.
		seedData({
			posts: [
				{
					...PROBLEM,
					id: "hot-1",
					title: "Hot issue",
					status: "reported",
					priority: "high",
					reactions: { support: 3 },
					comment_count: 2,
					linked_poll: "poll-1",
					created_at: ago(2 * HOUR),
				},
				{
					...PROBLEM,
					id: "rep-1",
					title: "Reported issue",
					status: "reported",
					priority: "medium",
					created_at: ago(3 * HOUR),
				},
				{
					...PROBLEM,
					id: "sug-1",
					type: "suggestion",
					title: "Fresh idea",
					status: "reported",
					created_at: ago(HOUR),
				},
			],
			reports: [{ ...REPORT, target_id: "rep-1" }],
			polls: [POLL],
		});
		await renderDashboard();
		const dash = screen.getByTestId("admin-dashboard");
		const pills = within(dash).getByRole("group", { name: "Queue filters" });
		// Live counts: 1 engaged, 3 recent, 3 open, 1 reported post,
		// 1 suggestion, 1 post with a poll.
		expect(
			within(pills).getByRole("button", { name: "Trending queue, 1 item" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(
			within(pills).getByRole("button", { name: "Recent queue, 3 items" }),
		).toBeTruthy();
		expect(
			within(pills).getByRole("button", { name: "Open Issues queue, 3 items" }),
		).toBeTruthy();
		expect(
			within(pills).getByRole("button", { name: "Reports queue, 1 item" }),
		).toBeTruthy();
		expect(
			within(pills).getByRole("button", { name: "Suggestions queue, 1 item" }),
		).toBeTruthy();
		expect(
			within(pills).getByRole("button", { name: "Polls queue, 1 item" }),
		).toBeTruthy();

		// Default queue shows the engaged post only.
		const trend = within(screen.getByTestId("dash-trending"));
		expect(trend.getByText("Hot issue")).toBeTruthy();
		expect(trend.queryByText("Reported issue")).toBeNull();

		// Switching pills re-ranks the same real rows, no refetch.
		fireEvent.click(
			within(pills).getByRole("button", { name: "Reports queue, 1 item" }),
		);
		expect(trend.getByText("Reported issue")).toBeTruthy();
		expect(trend.queryByText("Hot issue")).toBeNull();
		expect(
			within(pills).getByRole("button", { name: "Reports queue, 1 item" }),
		).toHaveAttribute("aria-pressed", "true");

		fireEvent.click(
			within(pills).getByRole("button", { name: "Suggestions queue, 1 item" }),
		);
		expect(trend.getByText("Fresh idea")).toBeTruthy();

		fireEvent.click(
			within(pills).getByRole("button", { name: "Polls queue, 1 item" }),
		);
		expect(trend.getByText("Hot issue")).toBeTruthy();

		fireEvent.click(
			within(pills).getByRole("button", { name: "Open Issues queue, 3 items" }),
		);
		expect(trend.getByText("Hot issue")).toBeTruthy();
		expect(trend.getByText("Reported issue")).toBeTruthy();
	});

	it("shows the emergency inbox digest from real threads", async () => {
		seedData({
			threads: [
				{
					thread_id: "thr_crit_1",
					status: "open",
					handoff: false,
					last_sender: "user",
					unread: 2,
					last_at: ago(10 * MIN),
					last_message: "I need help right now",
					emotion: { level: "critical" },
				},
				{
					thread_id: "thr_ai_1",
					status: "open",
					handoff: false,
					last_sender: "ai",
					unread: 0,
					last_at: ago(HOUR),
					last_message: "Take care, write anytime",
					emotion: { level: "mild" },
				},
				{
					thread_id: "thr_closed",
					status: "closed",
					handoff: false,
					last_sender: "ai",
					unread: 0,
					last_at: ago(HOUR),
					last_message: "Old chat",
					emotion: { level: "critical" },
				},
			],
		});
		await renderDashboard();
		const digest = within(screen.getByTestId("dash-inbox-digest"));
		// Only the open critical thread counts as an emergency; closed
		// critical threads never page the admin.
		expect(digest.getByText(/1 critical/)).toBeTruthy();
		expect(digest.getByText(/0 high/)).toBeTruthy();
		expect(digest.getByText(/0 waiting/)).toBeTruthy();
		expect(digest.queryByText(/AI-handled/)).toBeNull();
		expect(digest.getByText("I need help right now")).toBeTruthy();
		expect(digest.queryByText("Old chat")).toBeNull();
		const dispatched = captureTabEvents(() => {
			fireEvent.click(digest.getByRole("button", { name: "Open inbox" }));
		});
		expect(dispatched).toEqual(["inbox"]);
	});

	// REGRESSION: a thread at emotion level "high" is a person in distress and
	// must be actionable. The digest filtered on "critical" alone, so a high
	// thread the AI had already answered (unread 0, no explicit "get me an
	// admin") matched NEITHER list and vanished from the dashboard while the
	// inbox still showed it as high stress.
	it("surfaces a high-stress thread, not only critical ones", async () => {
		seedData({
			threads: [
				{
					thread_id: "thr_high_1",
					status: "open",
					handoff: false,
					// The AI already replied and there is nothing unread, so no
					// "waiting" rule would ever pick this thread up.
					last_sender: "ai",
					unread: 0,
					last_at: ago(5 * MIN),
					last_message: "nobody is helping me",
					emotion: { level: "high" },
				},
			],
		});
		await renderDashboard();
		const digest = within(screen.getByTestId("dash-inbox-digest"));

		// It is counted as a high-priority signal...
		expect(digest.getByText(/0 critical/)).toBeTruthy();
		expect(digest.getByText(/1 high/)).toBeTruthy();
		// ...and it is actually listed, with an honest label rather than a
		// hardcoded CRITICAL badge the admin would misread as severity.
		expect(digest.getByText("nobody is helping me")).toBeTruthy();
		expect(digest.getByText("HIGH")).toBeTruthy();
		expect(digest.queryByText("CRITICAL")).toBeNull();
	});

	it("lists waiting chats and collapses the full section", async () => {
		seedData({
			threads: [
				{
					thread_id: "thr_wait_1",
					status: "open",
					handoff: false,
					last_sender: "user",
					unread: 3,
					last_at: ago(5 * MIN),
					last_message: "Nobody answered me yet",
					// Non-urgent on purpose: this test is about the WAITING rule
					// (unread user mail, no takeover). Urgent levels are covered by the
					// high-stress test above.
					emotion: { level: "moderate" },
				},
				{
					thread_id: "thr_ai_2",
					status: "open",
					handoff: false,
					last_sender: "ai",
					unread: 0,
					last_at: ago(HOUR),
					last_message: "I am here for you",
					emotion: { level: "mild" },
				},
			],
		});
		await renderDashboard();
		const digest = within(screen.getByTestId("dash-inbox-digest"));
		expect(digest.getByText(/1 waiting/)).toBeTruthy();
		expect(digest.getByText("Waiting for an admin")).toBeTruthy();
		expect(digest.getByText("Nobody answered me yet")).toBeTruthy();
		expect(digest.queryByText(/AI-handled/)).toBeNull();
		expect(digest.queryByText("I am here for you")).toBeNull();
		// Collapse hides rows but keeps the counts visible.
		fireEvent.click(digest.getByRole("button", { name: "Collapse emergency inbox" }));
		expect(digest.queryByText("Nobody answered me yet")).toBeNull();
		expect(digest.getByText(/1 waiting/)).toBeTruthy();
		fireEvent.click(digest.getByRole("button", { name: "Expand emergency inbox" }));
		expect(digest.getByText("Nobody answered me yet")).toBeTruthy();
	});

	it("lists chats that asked for a human and filters the digest", async () => {
		seedData({
			threads: [
				{
					thread_id: "thr_ask_1",
					status: "open",
					handoff: false,
					last_sender: "ai",
					unread: 0,
					last_at: ago(5 * MIN),
					last_message: "Can I please talk to a real admin?",
					emotion: { level: "mild" },
				},
				{
					thread_id: "thr_quiet_1",
					status: "open",
					handoff: false,
					last_sender: "ai",
					unread: 0,
					last_at: ago(HOUR),
					last_message: "Take care, write anytime",
					emotion: { level: "mild" },
				},
			],
		});
		await renderDashboard();
		const digest = within(screen.getByTestId("dash-inbox-digest"));
		// The explicit human request pages even though the AI answered last;
		// the quiet thread stays out of the admin section.
		expect(digest.getByText("Can I please talk to a real admin?")).toBeTruthy();
		expect(digest.getByText("Asked for human")).toBeTruthy();
		expect(digest.queryByText("Take care, write anytime")).toBeNull();
		// Filter to emergencies hides the waiting row; All restores it.
		fireEvent.click(digest.getByRole("tab", { name: "emergencies" }));
		expect(digest.queryByText("Can I please talk to a real admin?")).toBeNull();
		fireEvent.click(digest.getByRole("tab", { name: "all" }));
		expect(digest.getByText("Can I please talk to a real admin?")).toBeTruthy();
	});

	it("opens a digest chat directly on the dashboard, without navigating", async () => {
		seedData({
			threads: [
				{
					thread_id: "thr_drawer_1",
					status: "open",
					handoff: false,
					last_sender: "user",
					unread: 1,
					last_at: ago(5 * MIN),
					last_message: "Drawer row hello",
					emotion: { level: "critical" },
				},
			],
		});
		await renderDashboard();
		const digest = within(screen.getByTestId("dash-inbox-digest"));
		const dispatched = captureTabEvents(() => {
			fireEvent.click(digest.getByRole("button", { name: "Open emergency thread thr_drawer_1" }));
		});
		// No navigation: the chat opens in place.
		expect(dispatched).toEqual([]);
		expect(await screen.findByText("Drawer hello")).toBeInTheDocument();
		// Reply hands off to the full inbox with the thread preselected.
		const dispatched2 = captureTabEvents(() => {
			fireEvent.click(screen.getByRole("button", { name: "Reply in inbox to thr_drawer_1" }));
		});
		expect(dispatched2).toHaveLength(1);
		expect(dispatched2[0]).toEqual({ tab: "inbox", thread: "thr_drawer_1" });
	});

	it("says honestly when no inbox emergency exists", async () => {
		seedData({ threads: [] });
		await renderDashboard();
		const digest = within(screen.getByTestId("dash-inbox-digest"));
		expect(digest.getByText(/0 critical/)).toBeTruthy();
		expect(digest.getByText(/0 high/)).toBeTruthy();
		expect(
			digest.getByText("No open distress signals — nothing is waiting on an admin."),
		).toBeTruthy();
	});

	it("names the inbox source when its fetch fails", async () => {
		seedData({ threads: [], fail: ["inbox"] });
		await renderDashboard();
		expect(screen.getByText(/Some sources failed: inbox/)).toBeTruthy();
	});

	it("keeps the default card order and lets the admin reorder it", async () => {
		localStorage.removeItem("vb:admin-layout");
		await renderDashboard();
		const dash = screen.getByTestId("admin-dashboard");
		// CSS order drives the visual sequence (DOM order never moves).
		const order = () => {
			const m = new Map<string, number>();
			for (const el of [...dash.querySelectorAll(":scope > [data-unit]")] as HTMLElement[]) {
				m.set(el.getAttribute("data-unit") || "", Number(el.style.order || 0));
			}
			return m;
		};
		// Default sequence matches the shipped visual order.
		const o1 = order();
		expect(o1.get("inbox")).toBeLessThan(o1.get("stats") ?? 99);
		expect(o1.get("stats")).toBeLessThan(o1.get("queues") ?? 99);

		// Arrow keys on the grip move the card and persist per device.
		const grip = screen.getByRole("button", { name: "Reorder Emergency inbox section" });
		fireEvent.keyDown(grip, { key: "ArrowDown" });
		const o2 = order();
		expect(o2.get("trio")).toBeLessThan(o2.get("inbox") ?? 99);
		expect(JSON.parse(localStorage.getItem("vb:admin-layout") || "[]")[1]).toBe("inbox");

		// Reset restores the shipped order.
		fireEvent.click(screen.getByRole("button", { name: "Reset dashboard layout" }));
		expect(order().get("inbox")).toBeLessThan(order().get("stats") ?? 99);
		localStorage.removeItem("vb:admin-layout");
	});

	it("restores a saved card order on load", async () => {
		localStorage.setItem(
			"vb:admin-layout",
			JSON.stringify(["stats", "inbox", "trio", "explain", "insight", "queues", "jump", "action", "work"]),
		);
		await renderDashboard();
		const dash = screen.getByTestId("admin-dashboard");
		const o = new Map<string, number>();
		for (const el of [...dash.querySelectorAll(":scope > [data-unit]")] as HTMLElement[]) {
			o.set(el.getAttribute("data-unit") || "", Number(el.style.order || 0));
		}
		expect(o.get("stats")).toBeLessThan(o.get("inbox") ?? 99);
		localStorage.removeItem("vb:admin-layout");
	});

	it("renders pills and ranked list as one queue card", async () => {
		await renderDashboard();
		const trend = within(screen.getByTestId("dash-trending"));
		// One component: the filter strip lives inside the ranked-list card,
		// not as a disconnected card above it.
		expect(trend.getByRole("group", { name: "Queue filters" })).toBeTruthy();
		expect(trend.getByText(/Trending issues right now/)).toBeTruthy();
	});

	it("needs no View-all button — the work queues render inline", async () => {
		await renderDashboard();
		const trend = within(screen.getByTestId("dash-trending"));
		expect(trend.queryByRole("button", { name: "View all queues" })).toBeNull();
		expect(trend.getByRole("group", { name: "Queue filters" })).toBeTruthy();
	});

	it("has no status dialog on the dashboard — status lives on the queues", async () => {
		await renderDashboard();
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});

describe("Overview — dashboard visuals derive from the snapshot", () => {
	it("renders health, urgency, pipeline and tiles from real records", async () => {
		await renderDashboard();
		// PROBLEM (open, high) + SOLVED (solved, medium): resolution 50%,
		// urgency 10 (Low band, 1 open issue), health 33 by the v1 formula.
		const health = within(screen.getByTestId("dash-health"));
		expect(health.getByText("Community health")).toBeTruthy();
		expect(health.getByText("33")).toBeTruthy();
		expect(health.getByText(/Resolution 50%/)).toBeTruthy();

		const urgency = within(screen.getByTestId("dash-urgency"));
		// The urgency scale speaks the SAME vocabulary as post priority
		// (Critical / High / Medium / Low) — one scale, not two.
		expect(
			urgency.getByText("AI urgency score (Critical / High / Medium / Low)"),
		).toBeTruthy();
		expect(urgency.getByText("10")).toBeTruthy();
		expect(urgency.getByText(/1 open issue/)).toBeTruthy();
		// Band axis + badge use the shared words, never calm/elevated.
		expect(urgency.getByText("Low")).toBeTruthy();
		expect(urgency.getByText("High")).toBeTruthy();
		expect(urgency.getByText("Critical")).toBeTruthy();
		expect(urgency.queryByText("calm")).toBeNull();
		expect(urgency.queryByText("elevated")).toBeNull();

		const pipe = within(screen.getByTestId("dash-pipeline"));
		expect(pipe.getByText("Pipeline distribution")).toBeTruthy();
		expect(
			pipe.getByRole("img", { name: "Pipeline across 2 posts" }),
		).toBeTruthy();
		// "open" is not a known status — it lands in Other, never vanishes
		// (legend text shares its node with the separator, so match loosely).
		expect(pipe.getByText(/Solved/)).toBeTruthy();
		expect(pipe.getByText(/Other/)).toBeTruthy();

		const stats = within(screen.getByTestId("dash-stats"));
		for (const label of [
			"Posts this week",
			"Resolution rate",
			"Engagement",
			"Comments this week",
			"Anonymous users",
			"Open reports",
			"Suggestions",
			"Total content",
		]) {
			expect(stats.getByText(label)).toBeTruthy();
		}
		expect(stats.getByText("50%")).toBeTruthy();
		expect(stats.getByText("no solves yet")).toBeTruthy();

		expect(screen.getByTestId("dash-activity")).toBeTruthy();
		expect(screen.getByTestId("dash-categories")).toBeTruthy();
		expect(screen.getByTestId("dash-rhythm")).toBeTruthy();
	});

	it("shows an empty triage queue honestly when nothing waits", async () => {
		await renderDashboard();
		const triage = within(screen.getByTestId("dash-triage"));
		expect(triage.getByText("0 waiting")).toBeTruthy();
		expect(triage.getByText("Nothing waiting for triage.")).toBeTruthy();
	});

	it("verifies and starts triage posts through the real endpoints", async () => {
		seedData({
			posts: [
				{
					...PROBLEM,
					id: "post-9",
					title: "Triage me",
					status: "reported",
				},
			],
			// REPORT targets "post_9" (underscore) — nothing by that id
			// exists, so retarget it at the hyphenated fixture post.
			reports: [{ ...REPORT, target_id: "post-9" }],
		});
		await renderDashboard();
		const triage = within(screen.getByTestId("dash-triage"));
		expect(triage.getByText("1 waiting")).toBeTruthy();
		expect(triage.getByText("Triage me")).toBeTruthy();

		fireEvent.click(triage.getByRole("button", { name: "Start post post-9" }));
		await waitFor(() =>
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post-9",
				status: "in_progress",
			}),
		);

		fireEvent.click(triage.getByRole("button", { name: "Verify post post-9" }));
		await waitFor(() =>
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "post-9",
				status: "verified",
			}),
		);
		// Verifying closes the report; starting leaves it open.
		await waitFor(() =>
			expect(mocks.put).toHaveBeenCalledWith("/api/reports", {
				id: 7,
				status: "resolved",
			}),
		);
	});

	it("publishes a broadcast through the real announcements endpoint", async () => {
		await renderDashboard();
		const band = within(screen.getByTestId("dash-broadcast"));
		expect(
			band.getByText("Shown as a banner to every visitor until removed."),
		).toBeTruthy();

		fireEvent.change(band.getByLabelText("Announcement text"), {
			target: { value: "Library hours extended" },
		});
		fireEvent.click(band.getByRole("button", { name: "Publish announcement" }));
		await waitFor(() =>
			expect(mocks.post).toHaveBeenCalledWith("/api/announcements", {
				text: "Library hours extended",
				kind: "info",
			}),
		);
		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				"Announcement published — visible to every visitor",
				"ok",
			),
		);
	});

	it("shows the live banner text when one is active", async () => {
		seedData({
			announcement: { text: "Exam week hours", kind: "warning", at: now() },
		});
		await renderDashboard();
		const band = within(screen.getByTestId("dash-broadcast"));
		expect(band.getByText(/Live now \(warning\): Exam week hours/)).toBeTruthy();
		expect(
			band.getByRole("button", { name: "Remove announcement" }),
		).toBeTruthy();
	});

	it("ranks open posts by live engagement with working Start/Solve", async () => {
		seedData({
			posts: [
				{
					...PROBLEM,
					id: "hot-1",
					title: "Hot issue",
					status: "reported",
					reactions: { support: 3 },
					comment_count: 2,
				},
				{ ...PROBLEM, id: "cold-1", title: "Cold issue", status: "reported" },
			],
		});
		await renderDashboard();
		const trend = within(screen.getByTestId("dash-trending"));
		expect(trend.getByText(/Trending issues right now/)).toBeTruthy();
		expect(trend.getByText("Hot issue")).toBeTruthy();
		// Score 0 is honestly excluded, never padded with filler rows.
		expect(trend.queryByText("Cold issue")).toBeNull();

		fireEvent.click(
			trend.getByRole("button", { name: "Start trending hot-1" }),
		);
		await waitFor(() =>
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "hot-1",
				status: "in_progress",
			}),
		);
		fireEvent.click(
			trend.getByRole("button", { name: "Solve trending hot-1" }),
		);
		await waitFor(() =>
			expect(mocks.put).toHaveBeenCalledWith("/api/posts", {
				id: "hot-1",
				status: "solved",
			}),
		);
	});

	it("excludes a down-voted pile-on from trending issues", async () => {
		seedData({
			posts: [
				{
					...PROBLEM,
					id: "pile-on",
					title: "Pile-on post",
					status: "reported",
					reactions: { support: 6, disagree: 8 },
					comment_count: 0,
				},
			],
		});
		await renderDashboard();
		const trend = within(screen.getByTestId("dash-trending"));
		// Net engagement floors at zero: down-votes are not endorsement.
		expect(trend.queryByText("Pile-on post")).toBeNull();
	});

	it("says so honestly when nothing trends", async () => {
		// Default fixtures carry no reactions or comment counts.
		await renderDashboard();
		expect(
			screen.getByText("No trending issues right now."),
		).toBeTruthy();
	});
});
