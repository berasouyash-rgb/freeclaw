// OpsCenter extra — header/pause, live workforce, health panels,
// incident verification chips, platform pulse, automation states,
// ask-agent input wiring and patrol-paused honesty.
// Supplements OpsCenter.test.tsx (scorecard, KPIs, alerts, kill switch).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpsCenter from "../pages/admin/OpsCenter";

const mocks = vi.hoisted(() => ({
	toast: vi.fn(),
	get: vi.fn(),
	getSlow: vi.fn(),
	post: vi.fn(),
	postAgent: vi.fn(),
}));

vi.mock("../lib/api", () => ({
	api: {
		get: mocks.get,
		getSlow: mocks.getSlow,
		post: mocks.post,
		postAgent: mocks.postAgent,
		put: vi.fn(),
		del: vi.fn(),
	},
}));

vi.mock("../contexts/AppContext", () => ({
	useApp: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/useRealtime", () => ({
	useRealtime: () => undefined,
}));

const nowIso = () => new Date().toISOString();
const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();
const twoMinAgo = () => new Date(Date.now() - 120_000).toISOString();

interface SeedOpts {
	paused?: boolean;
	providerOk?: boolean;
	incidents?: unknown[];
	attention?: unknown[];
	autoResolved?: unknown[];
	alerts?: unknown[];
	activity?: unknown[];
	liveWork?: unknown[];
	platform?: Record<string, unknown> | null;
	metrics?: Record<string, unknown>;
	taskQueue?: Record<string, number>;
	report?: Record<string, unknown> | null;
	automationWorkers?: unknown[] | "unavailable";
	briefing?: unknown;
	failOps?: boolean;
}

function baseOps(opts: SeedOpts = {}) {
	const liveWork = opts.liveWork ?? [];
	const pulse =
		opts.platform === null
			? undefined
			: ((opts.platform as Record<string, unknown> | undefined) ?? {
					posts: 120,
					pending_reports: 3,
					users: 45,
					comments: 300,
					reactions: 900,
				});
	return {
		ok: true,
		employees: [],
		task_queue: opts.taskQueue ?? {
			queued: 2,
			working: 1,
			verifying: 0,
			blocked: 1,
			failed: 1,
		},
		metrics: opts.metrics ?? {
			working: 1,
			verifying: 0,
			total_employees: 111,
			utilized: 40,
			underutilized: 71,
			verified_outcomes: 12,
			success_rate: 92,
			avg_duration_ms: 9000,
		},
		ai_provider: {
			ok: opts.providerOk ?? true,
			status: opts.providerOk === false ? "degraded" : "ready",
			note: "provider",
		},
		config: { paused: opts.paused ?? false },
		incidents: opts.incidents ?? [],
		attention: opts.attention ?? [],
		auto_resolved: opts.autoResolved ?? [],
		verified_today: 5,
		alerts: {
			ok: true,
			alerts: opts.alerts ?? [],
			open: 0,
			critical_open: 0,
			acknowledged_open: 0,
			resolved: 0,
		},
		report: opts.report === null ? undefined : (opts.report ?? {
			tasks_created_24h: 12,
			tasks_completed_24h: 9,
			tasks_failed_24h: 1,
			verified_outcomes_24h: 5,
			auto_resolved_24h: 6,
			incidents_open: 0,
			attention_open: 0,
			alerts_open: 0,
			top_risks: [],
		}),
		platform: pulse,
		live_work: liveWork,
		last_patrol_at: twoMinAgo(),
		activity: opts.activity ?? [],
		updated_at: nowIso(),
	};
}

function seed(opts: SeedOpts = {}) {
	if (opts.failOps) {
		mocks.getSlow.mockRejectedValue(new Error("network down"));
	} else {
		mocks.getSlow.mockImplementation(async (path: string) => {
			if (String(path).includes("/api/workforce?action=ops-summary"))
				return baseOps(opts);
			return {};
		});
	}
	mocks.get.mockImplementation(async (path: string) => {
		if (String(path).includes("/api/agent-executions?action=scorecard"))
			return null;
		if (String(path).includes("/api/workforce?action=automation-status")) {
			if (opts.automationWorkers === "unavailable")
				return Promise.reject(new Error("registry down"));
			return {
				ok: true,
				workers: opts.automationWorkers ?? [],
			};
		}
		if (String(path).includes("/api/workforce?action=overnight-briefing")) {
			if (opts.briefing) return opts.briefing;
			return Promise.reject(new Error("no briefing"));
		}
		return {};
	});
	mocks.post.mockImplementation(async (url: string, body?: Record<string, unknown>) => {
		if (String(url).includes("/api/workforce")) {
			if (body?.action === "patrol") return { executed: 2, failed: 0 };
			if (body?.action === "pause" || body?.action === "resume")
				return { ok: true };
			return { ok: true, approvals: [] };
		}
		return { ok: true };
	});
	mocks.postAgent.mockResolvedValue({ ok: true, status: "succeeded", response: "ok" });
}

beforeEach(() => {
	vi.clearAllMocks();
	seed();
});

describe("OpsCenter extra — header, provider and pause state", () => {
	it("should show PAUSED chip and Resume workforce when the workforce is paused", async () => {
		seed({ paused: true });
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("AI Operations")).toBeInTheDocument(),
		);
		expect(screen.getByText("PAUSED")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /Resume workforce/ }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /Pause workforce/ }),
		).not.toBeInTheDocument();
	});

	it("should show AI PROVIDER DEGRADED when the provider is not ok", async () => {
		seed({ providerOk: false });
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("AI PROVIDER DEGRADED")).toBeInTheDocument(),
		);
		expect(screen.queryByText("AI PROVIDER READY")).not.toBeInTheDocument();
	});

	it("should refetch ops data when Refresh is clicked", async () => {
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("AI Operations")).toBeInTheDocument(),
		);
		const before = mocks.getSlow.mock.calls.length;
		fireEvent.click(screen.getByRole("button", { name: "Refresh ops data" }));
		await waitFor(() =>
			expect(mocks.getSlow.mock.calls.length).toBeGreaterThan(before),
		);
	});

	it("should offer Retry that reloads when the runtime is unreachable", async () => {
		mocks.getSlow.mockRejectedValue(new Error("network down"));
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("OPS DATA UNAVAILABLE")).toBeInTheDocument(),
		);
		const retry = screen.getByRole("button", { name: /Retry/ });
		seed();
		fireEvent.click(retry);
		await waitFor(() =>
			expect(screen.getByText("AI Operations")).toBeInTheDocument(),
		);
	});
});

describe("OpsCenter extra — live workforce and health panels", () => {
	it("should say the workforce is idle when nothing is in progress", async () => {
		seed({ liveWork: [] });
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText(/LIVE WORKFORCE/)).toBeInTheDocument(),
		);
		expect(
			screen.getByText(/NO TASKS IN PROGRESS — the workforce is idle/i),
		).toBeInTheDocument();
	});

	it("should label live, waiting and stale heartbeats honestly", async () => {
		seed({
			liveWork: [
				{ id: "w-live", title: "Live triage run", agent: "report-handler", status: "working", started_at: minuteAgo(), heartbeat_at: nowIso(), priority: "high" },
				{ id: "w-wait", title: "Queued moderation run", agent: "content-moderator", status: "claimed", started_at: null, heartbeat_at: null, priority: "medium" },
				{ id: "w-stale", title: "Stale patrol run", agent: "security-monitor", status: "working", started_at: twoMinAgo(), heartbeat_at: twoMinAgo(), priority: "low" },
			],
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("Live triage run")).toBeInTheDocument(),
		);
		expect(screen.getByText("● live")).toBeInTheDocument();
		expect(screen.getByText("○ waiting to start")).toBeInTheDocument();
		expect(screen.getByText("● heartbeat stale")).toBeInTheDocument();
	});

	it("should show database, provider, patrol and user counts in system health", async () => {
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("SYSTEM HEALTH")).toBeInTheDocument(),
		);
		const section = screen
			.getByText("SYSTEM HEALTH")
			.closest("section") as HTMLElement;
		expect(within(section).getByText(/120 posts/)).toBeInTheDocument();
		expect(within(section).getByText(/3 pending reports/)).toBeInTheDocument();
		expect(within(section).getByText("READY")).toBeInTheDocument();
		expect(within(section).getByText(/45 · 300\s*comments/)).toBeInTheDocument();
	});

	it("should show no verified data and a dash when success metrics are missing", async () => {
		seed({
			metrics: {
				working: 0,
				verifying: 0,
				total_employees: 10,
				utilized: 0,
				underutilized: 10,
				verified_outcomes: 0,
				success_rate: null,
				avg_duration_ms: null,
			},
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("WORKFORCE HEALTH")).toBeInTheDocument(),
		);
		expect(screen.getByText("no verified data")).toBeInTheDocument();
		expect(screen.getByText("—")).toBeInTheDocument();
	});
});

describe("OpsCenter extra — incident verification and impact honesty", () => {
	it("should render incident error, impact and verification chips honestly", async () => {
		seed({
			incidents: [
				{
					id: "task-err",
					title: "Flaky executor crash",
					agent: "security-monitor",
					priority: "high",
					risk_level: "high",
					status: "failed",
					verification_status: "none",
					created_at: minuteAgo(),
					completed_at: null,
					error: "timeout after 30s",
					impact: "2 reports drained",
					evidence_count: 0,
					timeline_count: 0,
					outcomes: [],
				},
				{
					id: "task-vf",
					title: "Unverified bulk action",
					agent: "content-moderator",
					priority: "medium",
					risk_level: "low",
					status: "working",
					verification_status: "failed",
					created_at: minuteAgo(),
					completed_at: null,
					error: null,
					impact: null,
					evidence_count: 1,
					timeline_count: 1,
					outcomes: [],
				},
			],
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("Flaky executor crash")).toBeInTheDocument(),
		);
		const section = screen
			.getByText("ACTIVE INCIDENTS")
			.closest("section") as HTMLElement;
		expect(within(section).getByText(/timeout after 30s/)).toBeInTheDocument();
		expect(within(section).getByText(/Impact: 2 reports drained/)).toBeInTheDocument();
		expect(within(section).getByText("NOT VERIFIED")).toBeInTheDocument();
		expect(screen.getByText("Unverified bulk action")).toBeInTheDocument();
		expect(within(section).getByText("VERIFICATION FAILED")).toBeInTheDocument();
	});

	it("should render object-form outcome impact by its summary without crashing", async () => {
		seed({
			autoResolved: [
				{
					id: "task-obj",
					title: "Auto-hide spam wave",
					agent: "content-moderator",
					priority: "medium",
					risk_level: "low",
					status: "completed",
					verification_status: "passed",
					created_at: twoMinAgo(),
					completed_at: minuteAgo(),
					error: null,
					impact: { measurable: true, summary: "4 post(s) hidden", note: "x" },
					evidence_count: 1,
					timeline_count: 2,
					outcomes: [
						{ what: "Posts hidden", impact: { measurable: true, summary: "4 post(s) hidden", note: "x" } },
					],
				},
			],
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("Auto-hide spam wave")).toBeInTheDocument(),
		);
		expect(screen.getAllByText(/4 post\(s\) hidden/).length).toBeGreaterThanOrEqual(1);
	});
});

describe("OpsCenter extra — platform pulse and automations", () => {
	it("should render emergency strip, trending engagement and queue counts", async () => {
		seed({
			platform: {
				posts: 10,
				pending_reports: 2,
				users: 5,
				comments: 20,
				reactions: 40,
				pulse: {
					recent: [{ id: "r1", title: "Canteen food quality", category: "Food", created_at: minuteAgo() }],
					trending: [{ id: "t1", title: "Library hours", engagement: 42 }],
					emergency: [{ id: "e1", title: "Bullying report spike" }],
					emergency_count: 1,
					reports_open: 2,
					suggestions: 3,
					polls: [{ id: "p1", title: "Extend hours?" }],
					polls_active: 1,
				},
			},
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("PLATFORM PULSE · LIVE CONTENT")).toBeInTheDocument(),
		);
		expect(screen.getByText(/EMERGENCY · 1 CRITICAL\/HIGH/)).toBeInTheDocument();
		expect(screen.getByText("Bullying report spike")).toBeInTheDocument();
		expect(screen.getByText("Canteen food quality")).toBeInTheDocument();
		expect(screen.getByText("42↑")).toBeInTheDocument();
		const section = screen
			.getByText("PLATFORM PULSE · LIVE CONTENT")
			.closest("section") as HTMLElement;
		const dispatched: unknown[] = [];
		const handler = (e: Event) => dispatched.push((e as CustomEvent).detail);
		window.addEventListener("vb:admin-tab", handler);
		fireEvent.click(
			within(section).getByRole("button", { name: "Open reports2" }),
		);
		await waitFor(() => expect(dispatched).toContain("reports"));
		window.removeEventListener("vb:admin-tab", handler);
	});

	it("should keep the automations panel honest when the registry is unreachable", async () => {
		seed({ automationWorkers: "unavailable" });
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText(/AUTOMATIONS/)).toBeInTheDocument(),
		);
		expect(
			screen.getByText(/AUTOMATION STATUS UNAVAILABLE/i),
		).toBeInTheDocument();
	});

	it("should label deferred, standby, failed and never-ran workers", async () => {
		seed({
			automationWorkers: [
				{ id: "w1", name: "Trend Watch", description: "spikes", last: { at: minuteAgo(), ok: true, summary: "0 spikes" } },
				{ id: "w2", name: "Deferred Worker", description: "d", last: { at: minuteAgo(), ok: true, deferred: true, summary: "skipped" } },
				{ id: "w3", name: "Standby Worker", description: "s", last: { at: minuteAgo(), ok: true, degraded: true, summary: "standby" } },
				{ id: "w4", name: "Failed Worker", description: "f", last: { at: minuteAgo(), ok: false, summary: "boom" } },
				{ id: "w5", name: "New Worker", description: "n", last: null },
			],
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByText("Trend Watch")).toBeInTheDocument(),
		);
		const autoSection = screen
			.getByText("Trend Watch")
			.closest("section") as HTMLElement;
		expect(within(autoSection).getByText("HEALTHY")).toBeInTheDocument();
		expect(within(autoSection).getByText("DEFERRED")).toBeInTheDocument();
		expect(within(autoSection).getByText("STANDBY")).toBeInTheDocument();
		expect(within(autoSection).getByText("FAILED")).toBeInTheDocument();
		expect(within(autoSection).getByText("NEVER RAN")).toBeInTheDocument();
	});
});

describe("OpsCenter extra — ask-agent input wiring and patrol honesty", () => {
	it("should keep Ask disabled until there is a question, then submit on Enter", async () => {
		mocks.postAgent.mockResolvedValue({
			ok: true,
			status: "succeeded",
			response: "All quiet.",
			backend: "builtin",
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByPlaceholderText(/Summarize open high-priority reports/)).toBeInTheDocument(),
		);
		const input = screen.getByPlaceholderText(/Summarize open high-priority reports/);
		const ask = screen.getByRole("button", { name: /^Ask$/ });
		expect(ask).toBeDisabled();
		fireEvent.change(input, { target: { value: "anything open?" } });
		expect(ask).not.toBeDisabled();
		fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
		await waitFor(() =>
			expect(mocks.postAgent).toHaveBeenCalledWith("/api/workforce", {
				action: "ask-agent",
				input: "anything open?",
			}),
		);
	});

	it("should toast guidance when live agent runs are not configured", async () => {
		mocks.postAgent.mockResolvedValue({ ok: false, configured: false });
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByPlaceholderText(/Summarize open high-priority reports/)).toBeInTheDocument(),
		);
		fireEvent.change(screen.getByPlaceholderText(/Summarize open high-priority reports/), {
			target: { value: "status?" },
		});
		fireEvent.click(screen.getByRole("button", { name: /^Ask$/ }));
		await waitFor(() =>
			expect(screen.getByText(/optional and not configured/i)).toBeInTheDocument(),
		);
		expect(screen.getByDisplayValue("status?")).toBeInTheDocument();
	});

	it("should toast an info message when patrol finds the workforce paused", async () => {
		mocks.post.mockImplementation(async (url: string, body?: Record<string, unknown>) => {
			if (String(url).includes("/api/workforce")) {
				if (body?.action === "patrol") return { paused: true, executed: 0, failed: 0 };
				return { ok: true, approvals: [] };
			}
			return { ok: true };
		});
		render(<OpsCenter />);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /Run patrol/ })).toBeInTheDocument(),
		);
		fireEvent.click(screen.getByRole("button", { name: /Run patrol/ }));
		await waitFor(() =>
			expect(mocks.toast).toHaveBeenCalledWith(
				"Workforce is paused — resume it before patrolling",
				"info",
			),
		);
	});
});
