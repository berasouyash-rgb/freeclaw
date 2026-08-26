// ═══════════════════════════════════════════════════════════════════
// DASHBOARD — Google Admin / Microsoft 365-grade platform home
// ═══════════════════════════════════════════════════════════════════
// Enterprise pattern, not a card wall:
//   1. Header      → title + live indicator + exports
//   2. Danger popup → big unmissable critical/high alert banner
//   3. Metric strip → compact label/value/trend blocks (not giant cards)
//   4. Attention    → red band, ONLY when something actually needs you
//   5. Workspace    → Recent · Trending · Emergency · Reports · Polls
//   6. AI           → live suggestions (approval flow) + quick actions
//   7. Charts       → 14-day activity · categories · heatmap
// Every number is real (posts/comments/reports/users/polls + workforce
// alerts). Nothing is simulated — empty states are honest.
// ═══════════════════════════════════════════════════════════════════

import {
	AlertOctagon,
	ArrowUpRight,
	BarChart3,
	CheckCircle2,
	Clock,
	Flag,
	Lightbulb,
	type LucideIcon,
	Megaphone,
	Play,
	TrendingUp,
	Users,
} from "lucide-react";	import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CountUp from "../../components/CountUp";
import Trend, { Sparkline } from "../../components/Trend";
import {
	CriticalAlertBanner,
	type AlertRow,
} from "../../components/admin/CriticalAlertBanner";
import { StatusDialog } from "../../components/ui";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import {
	CAT_EMOJI,
	downloadFile,
	safeStringify,
	STATUS_META,
	timeAgo,
	toCSV,
	trendingScore,
} from "../../lib/utils";
import type { CommentData, PollData, PostData } from "../../types";
import QuickActions from "./QuickActions";

const DAY = 86400000;

interface ReportRow {
	id: string;
	target_type: string;
	reason: string;
	status?: string;
	created_at: string;
	[k: string]: unknown;
}
interface UserRow {
	id: string;
	name: string;
	email: string;
	role?: string;
	[k: string]: unknown;
}
function goto(tab: string) {
	window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: tab }));
}

// ─── Glass workspace filter — the dashboard defaults to one focused view ───
// instead of a wall of panels. AI/workforce internals live on the Ops Center
// tab; the dashboard only surfaces what needs a human eye.
const FILTERS = [
	{ key: "trending", label: "Trending", icon: TrendingUp },
	{ key: "recent", label: "Recent", icon: Clock },
	{ key: "open", label: "Open Issues", icon: AlertOctagon },
	{ key: "reports", label: "Reports", icon: Flag },
	{ key: "suggestions", label: "Suggestions", icon: Lightbulb },
	{ key: "polls", label: "Polls", icon: BarChart3 },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function Overview() {
	const { toast } = useApp();
	const [posts, setPosts] = useState<PostData[]>([]);
	const [comments, setComments] = useState<CommentData[]>([]);
	const [reports, setReports] = useState<ReportRow[]>([]);
	const [users, setUsers] = useState<UserRow[]>([]);
	const [polls, setPolls] = useState<PollData[]>([]);
	const [alerts, setAlerts] = useState<AlertRow[]>([]);
	const [lastUpdate, setLastUpdate] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	// ─── Live data ─────────────────────────────────────────────────
	// Light content on mount (skeleton), then realtime + visibility poll.
	// The ops-summary (alerts) is a heavier endpoint — polled separately.
	const loadAll = useCallback(async (silent = false) => {
		if (!silent) setLoading(true);
		try {
			const [p, c, r, u, pl] = await Promise.all([
				api
					.getSlow<PostData[]>("/api/posts?all=1&filter_artifacts=1")
					.catch(() => []),
				api.get<CommentData[]>("/api/comments?all=1").catch(() => []),
				api.get<ReportRow[]>("/api/reports").catch(() => []),
				api
					.post<UserRow[]>("/api/admin", { action: "users" })
					.catch(() => []),
				api.get<PollData[]>("/api/polls").catch(() => []),
			]);
			setPosts(p);
			setComments(c);
			setReports(r);
			setUsers(u);
			setPolls(pl);
			setLastUpdate(new Date().toISOString());
		} catch {
			// Keep last known data on transient failures.
		}
		setLoading(false);
	}, []);

	const alertsInFlight = useRef(false);

	const loadAlerts = useCallback(async () => {
		// ops-summary is a heavy endpoint (~3.6s) — never let overlapping calls
		// stack up if the DB is briefly slow.
		if (alertsInFlight.current) return;
		alertsInFlight.current = true;
		try {
			const r = await api.getSlow<{
				alerts?: { alerts?: AlertRow[] };
				updated_at?: string;
			}>(`/api/workforce?action=ops-summary&_=${Date.now()}`);
			setAlerts(r?.alerts?.alerts ?? []);
			if (r?.updated_at) setLastUpdate(r.updated_at);
		} catch {
			// Dashboard stays fully usable if the ops runtime is unreachable.
		} finally {
			alertsInFlight.current = false;
		}
	}, []);

	useEffect(() => {
		void loadAll();
		void loadAlerts();
	}, [loadAll, loadAlerts]);

	// Live updates: new posts/comments/reports/polls refresh content without
	// a manual reload (mirrors ContentReview/Home realtime idiom).
	useRealtime(
		["posts", "comments", "reports", "polls", "poll_votes"],
		() => loadAll(true),
		1500,
	);

	// Workforce events (task started / verified / alert raised) refresh the
	// danger popup INSTANTLY — no waiting for the poll.
	useRealtime(
		["agent_tasks", "agent_executions", "workforce_config"],
		() => void loadAlerts(),
		800,
	);

	// Belt-and-suspenders: poll content every 30s and alerts every 45s while
	// the tab is visible (realtime can't see the users table / disconnects).
	useEffect(() => {
		const iv = setInterval(() => {
			if (document.hidden) return;
			loadAll(true);
			loadAlerts();
		}, 30000);
		const onVis = () => {
			if (!document.hidden) {
				loadAll(true);
				loadAlerts();
			}
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			clearInterval(iv);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, [loadAll, loadAlerts]);

	/** Direct status action — opens the message dialog first so students always get an update note */
	const [statusDialog, setStatusDialog] = useState<{
		id: string;
		status: string;
	} | null>(null);
	const setStatus = (id: string, status: string) =>
		setStatusDialog({ id, status });

	// ── Glass filter state ───────────────────────────────────────────
	const [filter, setFilter] = useState<FilterKey>("trending");
	const filterBarRef = useRef<HTMLDivElement>(null);
	const filterRefs = useRef<Record<string, HTMLButtonElement | null>>({});
	const [pill, setPill] = useState({ left: 0, width: 0 });
	useEffect(() => {
		const btn = filterRefs.current[filter];
		const bar = filterBarRef.current;
		if (btn && bar) {
			const br = bar.getBoundingClientRect();
			const r = btn.getBoundingClientRect();
			if (br.width > 0 && r.width > 0)
				setPill({ left: r.left - br.left, width: r.width });
		}
	}, [filter]);

	const applyStatus = async (note: string) => {
		if (!statusDialog) return;
		try {
			const updated = await api.put<Record<string, unknown>>("/api/posts", {
				id: statusDialog.id,
				status: statusDialog.status,
				status_note: note || undefined,
			});
			setPosts((prev) =>
				prev.map((p) => (p.id === statusDialog.id ? { ...p, ...updated } : p)),
			);
			toast(
				statusDialog.status === "solved"
					? "✅ Marked as solved — students notified"
					: "🔧 Status updated — students notified",
				"ok",
			);
		} catch (e: unknown) {
			toast(
				e instanceof Error
					? e.message
					: "Failed to update - check console for details",
				"err",
			);
		}
	};

	const inWindow = (rows: { created_at: string }[], from: number, to: number) =>
		rows.filter((r) => {
			const t = +new Date(r.created_at);
			return t >= from && t < to;
		}).length;

	const stats = useMemo(() => {
		const now = Date.now();
		const problems = posts.filter((p) => p.type === "problem" && !p.deleted);
		const solved = problems.filter((p) => p.status === "solved");
		const solveTimes = solved
			.map((p) => {
				const h = (p.status_history || []).find((x) => x.status === "solved");
				return h ? (+new Date(h.at) - +new Date(p.created_at)) / DAY : null;
			})
			.filter((x): x is number => x !== null);
		const catCount: Record<string, number> = {};
		problems.forEach((p) => {
			catCount[p.category] = (catCount[p.category] || 0) + 1;
		});

		const reactionsTotal = posts.reduce(
			(a, p) =>
				a +
				Object.values(p.reactions || {}).reduce(
					(x: number, y) => x + (y as number),
					0,
				),
			0,
		);
		const engagement = reactionsTotal + comments.length;

		// this week vs previous week for trend arrows
		const wk = {
			posts: inWindow(posts, now - 7 * DAY, now),
			postsPrev: inWindow(posts, now - 14 * DAY, now - 7 * DAY),
			comments: inWindow(comments, now - 7 * DAY, now),
			commentsPrev: inWindow(comments, now - 14 * DAY, now - 7 * DAY),
			reports: inWindow(reports, now - 7 * DAY, now),
			reportsPrev: inWindow(reports, now - 14 * DAY, now - 7 * DAY),
		};
		const solvedThisWeek = solved.filter((p) =>
			(p.status_history || []).some(
				(h) => h.status === "solved" && now - +new Date(h.at) < 7 * DAY,
			),
		).length;
		const solvedPrevWeek = solved.filter((p) =>
			(p.status_history || []).some((h) => {
				const t = +new Date(h.at);
				return (
					h.status === "solved" && now - t >= 7 * DAY && now - t < 14 * DAY
				);
			}),
		).length;

		const health = Math.min(
			100,
			Math.round(
				(problems.length ? (solved.length / problems.length) * 50 : 25) +
					Math.min(25, engagement / 4) +
					Math.min(25, wk.posts * 3),
			),
		);

		// Open issues = not yet solved or archived (any status, priority ignored)
		const openIssues = problems.filter(
			(p) =>
				p.status !== "solved" &&
				p.status !== "archived",
		);

		// Active polls (not deleted/archived/expired)
		const nowIso = new Date();
		const activePolls = (polls || []).filter(
			(p) =>
				!p.deleted &&
				!p.archived &&
				(!p.expires_at || new Date(p.expires_at) > nowIso),
		);

		return {
			today: inWindow(posts, now - DAY, now),
			week: wk.posts,
			month: inWindow(posts, now - 30 * DAY, now),
			total: posts.length,
			wk,
			solvedThisWeek,
			solvedPrevWeek,
			resolution: problems.length
				? Math.round((solved.length / problems.length) * 100)
				: 0,
			avgSolve: solveTimes.length
				? (solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length).toFixed(1)
				: "–",
			// Open = still awaiting review. The reports table uses pending / reviewed /
			// dismissed / auto_resolved — "resolved" never occurs, so filtering on
			// it would count dismissed + auto-resolved rows as open (inflated).
			openReports: reports.filter((r) => !r.status || r.status === "pending").length,
			users: users.length,
			engagement,
			reactionsTotal,
			health,
			catCount,
			suggestions: posts.filter((p) => p.type === "suggestion").length,
			trending: [...problems]
				.sort((a, b) => trendingScore(b) - trendingScore(a))
				.slice(0, 5),
			recent: [...posts]
				.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
				.slice(0, 6),
			statusDist: Object.keys(STATUS_META).map((s) => ({
				s,
				n: problems.filter((p) => p.status === s).length,
			})),
			problemsCount: problems.length,
			emergency: openIssues,
			activePolls,
		};
	}, [posts, comments, reports, users, polls]);

	// daily series for sparklines + main chart (last 14 days)
	const series = useMemo(() => {
		const mk = (rows: { created_at: string }[]) => {
			const out: number[] = [];
			for (let i = 13; i >= 0; i--) {
				const d = new Date();
				d.setHours(0, 0, 0, 0);
				d.setDate(d.getDate() - i);
				out.push(inWindow(rows, +d, +d + DAY));
			}
			return out;
		};
		return { posts: mk(posts), comments: mk(comments), reports: mk(reports) };
	}, [posts, comments, reports]);

	const timeline = useMemo(() => {
		const days: { label: string; count: number; comments: number }[] = [];
		for (let i = 13; i >= 0; i--) {
			const d = new Date();
			d.setHours(0, 0, 0, 0);
			d.setDate(d.getDate() - i);
			days.push({
				label: d.toLocaleDateString(undefined, {
					day: "numeric",
					month: "short",
				}),
				count: series.posts[13 - i] ?? 0,
				comments: series.comments[13 - i] ?? 0,
			});
		}
		return days;
	}, [series]);
	const maxDay = Math.max(1, ...timeline.map((d) => d.count + d.comments));

	// weekday × 4-week heatmap
	const heatmap = useMemo(() => {
		const grid: number[][] = Array.from({ length: 4 }, () => Array(7).fill(0));
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		posts.forEach((p) => {
			const t = new Date(p.created_at);
			const daysAgo = Math.floor(
				(+now - +new Date(t.getFullYear(), t.getMonth(), t.getDate())) / DAY,
			);
			if (daysAgo < 0 || daysAgo >= 28) return;
			const week = Math.floor(daysAgo / 7);
			const row = grid[3 - week];
			if (row) {
				const col = (t.getDay() + 6) % 7;
				row[col] = (row[col] ?? 0) + 1;
			}
		});
		return grid;
	}, [posts]);
	const heatMax = Math.max(1, ...heatmap.flat());

	// Live counts for the glass filter badges — all real, from loaded data.
	const filterCounts: Record<FilterKey, number> = {
		trending: stats.trending.length,
		recent: stats.recent.length,
		open: stats.emergency.length,
		reports: stats.openReports,
		suggestions: stats.suggestions,
		polls: stats.activePolls.length,
	};

	// The danger popup must NEVER be hidden behind the content loading gate —
	// a critical alert stays visible even while the dashboard is still loading.
	const dangerBanner = (
		<CriticalAlertBanner
			alerts={alerts}
			onAcknowledge={async (id) => {
				try {
					await api.post("/api/workforce", { action: "acknowledge-alert", id });
					toast("Alert acknowledged", "ok");
					await loadAlerts();
				} catch (e: unknown) {
					toast(
						`Acknowledge failed: ${e instanceof Error ? e.message : "unknown error"}`,
						"err",
					);
				}
			}}
			onOpenWorkforce={() => goto("ai-operations")}
		/>
	);

	if (loading)
		return (
			<div className="space-y-4 min-w-0">
				{dangerBanner}
				<div className="skeleton h-10 w-56" />
				<div className="skeleton h-24" />
				<div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
					{[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
						<div key={i} className="skeleton h-20" />
					))}
				</div>
			</div>
		);

	// ── Compact metric strip (label + value + trend — Google style) ──
	const METRICS: {
		label: string;
		value: number;
		suffix?: string;
		sub: string;
		icon: LucideIcon;
		tone?: string;
		trend?: { cur: number; prev: number; invert?: boolean };
		spark?: number[];
	}[] = [
		{
			label: "Open reports",
			value: stats.openReports,
			sub: "moderation queue",
			icon: Flag,
			tone: stats.openReports > 0 ? "text-bad" : "text-good",
			trend: { cur: stats.wk.reports, prev: stats.wk.reportsPrev, invert: true },
			spark: series.reports,
		},
		{				label: "Open issues",
				value: stats.emergency.length,
				sub: "awaiting attention",
				icon: AlertOctagon,
				tone: stats.emergency.length > 0 ? "text-warn" : "text-good",
			},
		{
			label: "Posts · week",
			value: stats.week,
			sub: `${stats.today} today · ${stats.month} month`,
			icon: Megaphone,
			trend: { cur: stats.wk.posts, prev: stats.wk.postsPrev },
			spark: series.posts,
		},
		{
			label: "Engagement",
			value: stats.engagement,
			sub: `${stats.reactionsTotal} reactions · ${comments.length} comments`,
			icon: TrendingUp,
			trend: { cur: stats.wk.comments, prev: stats.wk.commentsPrev },
			spark: series.comments,
		},
		{
			label: "Users",
			value: stats.users,
			sub: "seen by platform",
			icon: Users,
		},
		{
			label: "Suggestions",
			value: stats.suggestions,
			sub: "improvement ideas",
			icon: Lightbulb,
			tone: "text-warn",
		},
		{
			label: "Active polls",
			value: stats.activePolls.length,
			sub: "live now",
			icon: BarChart3,
			tone: "text-accent",
		},
		{
			label: "Resolution",
			value: stats.resolution,
			suffix: "%",
			sub: `avg solve ${stats.avgSolve}d`,
			icon: CheckCircle2,
			tone: "text-good",
			trend: { cur: stats.solvedThisWeek, prev: stats.solvedPrevWeek },
		},
	];

	return (
		<div className="space-y-4 min-w-0" data-testid="admin-dashboard">
			{/* ── BIG DANGER POPUP — unmissable critical/high alert ─────── */}
			{dangerBanner}

			{/* ── Header ────────────────────────────────────────────────── */}
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-display font-bold text-xl leading-tight">
						Dashboard
					</h1>
					<p className="text-[11px] text-ink3 mt-0.5 flex items-center gap-1.5">
						<span className="relative flex h-2 w-2">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
							<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
						</span>
						LIVE · updated {lastUpdate ? timeAgo(lastUpdate) : "…"}
					</p>
				</div>
				<div className="flex gap-2">
					<button
						className="btn btn-ghost !text-xs"
						onClick={() =>
							downloadFile("voicebox-posts.csv", toCSV(posts), "text/csv")
						}
					>
						Export CSV
					</button>
					<button
						className="btn btn-ghost !text-xs"
						onClick={() =>
							downloadFile(
								"voicebox-export.json",
								safeStringify(
									{
										posts,
										comments,
										reports,
										polls,
										exported: new Date().toISOString(),
									},
									2,
								),
							)
						}
					>
						Export JSON
					</button>
					<button
						className="btn btn-ghost !text-xs"
						onClick={() => window.print()}
					>
						Print / PDF
					</button>
				</div>
			</header>

			{/* Background systems surface ONLY via the danger popup above — the
			    dashboard stays quiet, open counts live on the filter badges. */}

			{/* ── Metric strip ─────────────────────────────────────────── */}
			<div className="card overflow-hidden">
				<div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-px bg-border">
					{METRICS.map(({ label, value, suffix, sub, icon: Icon, tone, trend, spark }) => (
						<div key={label} className="px-3.5 py-3 min-w-0 bg-surface">
							<div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink3">
								<Icon size={11} className={tone ?? "text-ink3"} />
								<span className="truncate">{label}</span>
							</div>
							<div className="mt-1 flex items-baseline gap-1.5">
								<span
									className={`font-display font-bold text-xl leading-none ${tone ?? "text-ink"}`}
								>
									<CountUp value={value} suffix={suffix} />
								</span>
								{trend && (
									<Trend
										current={trend.cur}
										previous={trend.prev}
										invert={trend.invert}
									/>
								)}
							</div>
							<div className="mt-1 flex items-center justify-between gap-1.5">
								<span className="text-[10px] text-ink3 truncate" title={sub}>
									{sub}
								</span>
								{spark && <Sparkline data={spark} width={44} height={16} />}
							</div>
						</div>
					))}
				</div>
			</div>

			{/* ── Glass workspace filter — sliding pill ──────────────────── */}
			<section
				className="glass-card rounded-xl overflow-hidden"
				aria-label="Dashboard workspace"
			>
				<div
					ref={filterBarRef}
					className="relative flex gap-0.5 p-1.5 overflow-x-auto no-scrollbar"
					role="tablist"
					aria-label="Dashboard sections"
				>
					{/* Sliding glass pill — animates behind the active tab */}
					<div
						aria-hidden
						className="absolute top-1.5 bottom-1.5 left-0 rounded-lg glass-strong shadow-sm border border-white/10 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
						style={{
							width: pill.width || undefined,
							transform: pill.left
								? `translateX(${pill.left}px)`
								: undefined,
							opacity: pill.width ? 1 : 0,
						}}
					/>
					{FILTERS.map(({ key, label, icon: Icon }) => {
						const active = filter === key;
						const count = filterCounts[key] ?? 0;
						return (
							<button
								key={key}
								type="button"
								ref={(el) => {
									filterRefs.current[key] = el;
								}}
								role="tab"
								aria-selected={active}
								aria-label={`${label}${count > 0 ? ` — ${count}` : ""}`}
								onClick={() => setFilter(key)}
								className={`relative z-10 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
									active
										? "text-ink"
										: "text-ink3 hover:text-ink2 hover:bg-surface2/60"
								}`}
							>
								<Icon
									size={13}
									className={active ? "text-accent" : "opacity-70"}
									aria-hidden
								/>
								{label}
								{count > 0 && (
									<span
										className={`min-w-4 h-4 px-1 grid place-items-center rounded-full text-[9px] font-bold ${
											active
												? "bg-accent/15 text-accent"
												: "bg-surface2 text-ink3"
										}`}
									>
										{count}
									</span>
								)}
							</button>
						);
					})}
				</div>
			</section>

			{/* ── Panel: Trending ─────────────────────────────────────── */}
			{filter === "trending" && (
				<section className="card overflow-hidden" aria-label="Trending issues">
					<header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
						<h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink2">
							<span className="grid place-items-center w-6 h-6 rounded-md bg-orange-500/10 text-orange-400">
								<TrendingUp size={13} />
							</span>
							🔥 TRENDING
						</h2>
						<button
							className="btn btn-ghost !py-1 !px-2 !text-[11px]"
							onClick={() => goto("posts")}
						>
							View all <ArrowUpRight size={11} />
						</button>
					</header>
					{stats.trending.length === 0 ? (
						<div className="m-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-ink3">
							No problems submitted yet — trending issues appear here.
						</div>
					) : (
						<div className="divide-y divide-border">
							{stats.trending.map((p, i) => {
								const eng =
									(p.reactions?.support || 0) + (p.comment_count || 0);
								const maxEng = Math.max(
									1,
									...stats.trending.map(
										(t) =>
											(t.reactions?.support || 0) +
											(t.comment_count || 0),
									),
								);
								return (
									<div
										key={p.id}
										className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface2/60 transition-colors group"
									>
										<span
											className={`font-display font-bold w-5 text-[13px] ${
												i === 0 ? "text-accent" : "text-ink3"
											}`}
										>
											{i + 1}
										</span>
										<div className="flex-1 min-w-0">
											<span className="font-medium truncate block group-hover:text-accent transition-colors text-[13px]">
												{p.title}
											</span>
											<div className="h-1 rounded-full bg-surface2 overflow-hidden mt-1">
												<div
													className="h-full rounded-full vb-bar-anim"
													style={{
														width: `${(eng / maxEng) * 100}%`,
														animationDelay: `${i * 80}ms`,
														background:
															"linear-gradient(90deg, var(--vb-accent), var(--vb-accent2))",
													}}
												/>
											</div>
										</div>
										<span className="chip !text-[10px] shrink-0 hidden sm:inline-flex">
											{p.category}
										</span>
										<span className="text-xs text-ink3 font-mono shrink-0 hidden sm:inline">
											↑{p.reactions?.support || 0} 💬
											{p.comment_count || 0}
										</span>
										<div className="flex gap-1 shrink-0">
											{!["in_progress", "solved", "archived"].includes(
												p.status,
											) && (
												<button
													className="btn btn-soft !py-1 !px-2 !text-[10px]"
													onClick={() =>
														setStatus(p.id, "in_progress")
													}
													title="Mark in progress"
												>
													<Play size={11} /> Start
												</button>
											)}
											{p.status !== "solved" &&
												p.status !== "archived" && (
													<button
														className="btn !py-1 !px-2 !text-[10px] !bg-good/12 !text-good hover:!bg-good/20"
														onClick={() => setStatus(p.id, "solved")}
														title="Mark solved"
													>
														<CheckCircle2 size={11} /> Solve
													</button>
												)}
											{p.status === "solved" && (
												<span className="chip !text-[10px] !text-good">
													✓ Solved
												</span>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</section>
			)}

			{/* ── Panel: Recent ───────────────────────────────────────── */}
			{filter === "recent" && (
				<section className="card overflow-hidden" aria-label="Recent activity">
					<header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
						<h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink2">
							<span className="grid place-items-center w-6 h-6 rounded-md bg-accent/10 text-accent">
								<Clock size={13} />
							</span>
							RECENT ACTIVITY
						</h2>
						<button
							className="btn btn-ghost !py-1 !px-2 !text-[11px]"
							onClick={() => goto("posts")}
						>
							View all <ArrowUpRight size={11} />
						</button>
					</header>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-[10px] uppercase tracking-[0.1em] text-ink3 border-b border-border">
									<th className="px-4 py-2 font-semibold">Post</th>
									<th className="px-3 py-2 font-semibold hidden sm:table-cell">
										Category
									</th>
									<th className="px-3 py-2 font-semibold hidden md:table-cell">
										Status
									</th>
									<th className="px-3 py-2 font-semibold hidden sm:table-cell">
										Engagement
									</th>
									<th className="px-4 py-2 font-semibold text-right">
										Time
									</th>
								</tr>
							</thead>
							<tbody>
								{stats.recent.map((p) => (
									<tr
										key={p.id}
										className="border-b border-border last:border-0 hover:bg-surface2/60 transition-colors"
									>
										<td className="px-4 py-2.5">
											<span className="font-medium text-[13px] text-ink block truncate max-w-[26ch] sm:max-w-[36ch]">
												{p.title}
											</span>
											<span className="text-[10px] text-ink3 md:hidden">
												{p.category || "uncategorized"} ·{" "}
												{STATUS_META[p.status]?.label ?? p.status}
											</span>
										</td>
										<td className="px-3 py-2.5 text-[11px] text-ink2 hidden sm:table-cell">
											{CAT_EMOJI[p.category]} {p.category || "—"}
										</td>
										<td className="px-3 py-2.5 hidden md:table-cell">
											<span
												className="inline-flex items-center gap-1.5 text-[11px]"
												style={{
													color:
														STATUS_META[p.status]?.color ??
														"var(--vb-ink3)",
												}}
											>
												<span
													className="w-1.5 h-1.5 rounded-full"
													style={{
														background:
															STATUS_META[p.status]?.color ?? "#888",
													}}
												/>
												{STATUS_META[p.status]?.label ?? p.status}
											</span>
										</td>
										<td className="px-3 py-2.5 text-[11px] text-ink3 font-mono hidden sm:table-cell">
											↑{p.reactions?.support ?? 0} 💬
											{p.comment_count ?? 0}
										</td>
										<td className="px-4 py-2.5 text-[11px] text-ink3 text-right whitespace-nowrap">
											{timeAgo(p.created_at)}
										</td>
									</tr>
								))}
								{stats.recent.length === 0 && (
									<tr>
										<td
											colSpan={6}
											className="px-4 py-8 text-center text-xs text-ink3"
										>
											No posts yet — the platform is quiet right now.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</section>
			)}

			{/* ── Panel: Open issues ──────────────────────────────────── */}
			{filter === "open" && (
				<section className="card p-4" aria-label="Open issues">
					<header className="flex items-center justify-between gap-2 mb-3">
						<h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink2">
							<span className="grid place-items-center w-6 h-6 rounded-md bg-red-500/10 text-red-400">
								<AlertOctagon size={13} />
							</span>
							OPEN ISSUES
							{stats.emergency.length > 0 && (
								<span className="chip !text-[9px] !bg-red-500/10 !text-red-400 !border-red-500/25">
									{stats.emergency.length}
								</span>
							)}
						</h2>
						<button
							className="btn btn-ghost !py-1 !px-2 !text-[11px]"
							onClick={() => goto("posts")}
						>
							Manage <ArrowUpRight size={11} />
						</button>
					</header>
					{stats.emergency.length === 0 ? (
						<div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-ink3">
							No open issues — all calm. ✓
						</div>
					) : (
						<div className="space-y-1.5">
							{stats.emergency.slice(0, 8).map((p) => (
								<div
									key={p.id}
									className="rounded-lg border border-red-500/25 bg-red-500/[0.05] px-3 py-2"
								>											<div className="flex items-center gap-2">
												<span className="text-xs text-ink2 truncate">
													{p.title}
												</span>
												<div className="ml-auto flex gap-1 shrink-0">
													{p.status !== "solved" && (
														<button
															className="btn !py-1 !px-2 !text-[10px] !bg-good/12 !text-good hover:!bg-good/20"
															onClick={() => setStatus(p.id, "solved")}
															title="Mark solved"
														>
															<CheckCircle2 size={11} /> Solve
														</button>
													)}
												</div>
											</div>
											<div className="mt-1 flex items-center gap-2 text-[10px] text-ink3">
												<span>
													{CAT_EMOJI[p.category]} {p.category}
												</span>
												<span>·</span>
												<span>{timeAgo(p.created_at)}</span>
											</div>
								</div>
							))}
						</div>
					)}
				</section>
			)}

			{/* ── Panel: Reports ──────────────────────────────────────── */}
			{filter === "reports" && (
				<section className="card p-4" aria-label="Open reports">
					<header className="flex items-center justify-between gap-2 mb-3">
						<h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink2">
							<span className="grid place-items-center w-6 h-6 rounded-md bg-amber-500/10 text-amber-400">
								<Flag size={13} />
							</span>
							OPEN REPORTS
							{stats.openReports > 0 && (
								<span className="chip !text-[9px] !bg-amber-500/10 !text-amber-400 !border-amber-500/25">
									{stats.openReports}
								</span>
							)}
						</h2>
						<button
							className="btn btn-ghost !py-1 !px-2 !text-[11px]"
							onClick={() => goto("reports")}
						>
							Manage <ArrowUpRight size={11} />
						</button>
					</header>
					{stats.openReports === 0 ? (
						<div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-ink3">
							All caught up — no open reports. ✨
						</div>
					) : (
						<div className="space-y-1.5">
							{reports
								.filter((r) => !r.status || r.status === "pending")
								.slice(0, 8)
								.map((r) => (
									<div
										key={r.id}
										className="rounded-lg border border-border bg-bg/60 px-3 py-2 flex items-center gap-2 hover:border-amber-500/30 transition-colors"
									>
										<span className="text-xs text-ink2 truncate flex-1">
											{r.reason || "Report"}
										</span>
										<span className="text-[10px] text-ink3 shrink-0">
											{timeAgo(r.created_at)}
										</span>
									</div>
								))}
						</div>
					)}
				</section>
			)}

			{/* ── Panel: Suggestions ──────────────────────────────────── */}
			{filter === "suggestions" && (
				<section className="card p-4" aria-label="Suggestions">
					<header className="flex items-center justify-between gap-2 mb-3">
						<h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink2">
							<span className="grid place-items-center w-6 h-6 rounded-md bg-violet-500/10 text-violet-400">
								<Lightbulb size={13} />
							</span>
							SUGGESTIONS
							{stats.suggestions > 0 && (
								<span className="chip !text-[9px] !bg-violet-500/10 !text-violet-400 !border-violet-500/25">
									{stats.suggestions}
								</span>
							)}
						</h2>
						<button
							className="btn btn-ghost !py-1 !px-2 !text-[11px]"
							onClick={() => goto("suggestions")}
						>
							Review <ArrowUpRight size={11} />
						</button>
					</header>
					{(() => {
						const suggestions = posts
							.filter((p) => p.type === "suggestion" && !p.deleted)
							.sort(
								(a, b) => +new Date(b.created_at) - +new Date(a.created_at),
							)
							.slice(0, 8);
						if (suggestions.length === 0) {
							return (
								<div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-ink3">
									No suggestions yet — community ideas appear here.
								</div>
							);
						}
						return (
							<div className="space-y-1.5">
								{suggestions.map((s) => (
									<div
										key={s.id}
										className="rounded-lg border border-border bg-bg/60 px-3 py-2 flex items-center gap-2 hover:border-violet-500/30 transition-colors"
									>
										<span
											className="w-1.5 h-1.5 rounded-full shrink-0"
											style={{
												background:
													STATUS_META[s.status]?.color ?? "#888",
											}}
										/>
										<span
											className="text-xs text-ink2 truncate flex-1"
											title={s.title}
										>
											{s.title}
										</span>
										<span className="text-[10px] text-ink3 shrink-0">
											{timeAgo(s.created_at)}
										</span>
									</div>
								))}
							</div>
						);
					})()}
				</section>
			)}

			{/* ── Panel: Polls ────────────────────────────────────────── */}
			{filter === "polls" && (
				<section className="card p-4" aria-label="Active polls">
					<header className="flex items-center justify-between gap-2 mb-3">
						<h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink2">
							<span className="grid place-items-center w-6 h-6 rounded-md bg-blue-500/10 text-blue-400">
								<BarChart3 size={13} />
							</span>
							ACTIVE POLLS
							{stats.activePolls.length > 0 && (
								<span className="chip !text-[9px] !bg-blue-500/10 !text-blue-400 !border-blue-500/25">
									{stats.activePolls.length}
								</span>
							)}
						</h2>
						<button
							className="btn btn-ghost !py-1 !px-2 !text-[11px]"
							onClick={() => goto("polls")}
						>
							Manage <ArrowUpRight size={11} />
						</button>
					</header>
					{stats.activePolls.length === 0 ? (
						<div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-ink3">
							No active polls right now.
						</div>
					) : (
						<div className="space-y-2">
							{stats.activePolls.slice(0, 6).map((poll) => {
								const total = poll.total_votes ?? 0;
								const counts = poll.vote_counts ?? {};
								const top = Object.entries(counts).sort(
									(a, b) => (b[1] as number) - (a[1] as number),
								)[0];
								const topIdx = top ? Number(top[0]) : -1;
								const topPct = total
									? Math.round(((top?.[1] as number) / total) * 100)
									: 0;
								return (
									<div
										key={poll.id}
										className="rounded-lg border border-border bg-bg/60 px-3 py-2 hover:border-blue-500/30 transition-colors"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="text-xs text-ink2 truncate">
												📊 {poll.title}
											</span>
											<span className="text-[10px] text-ink3 font-mono shrink-0">
												{total} vote{total === 1 ? "" : "s"}
											</span>
										</div>
										{topIdx >= 0 && poll.options[topIdx] && (
											<div className="mt-1.5">
												<div className="flex justify-between text-[9px] text-ink3">
													<span className="truncate">
														{poll.options[topIdx]}
													</span>
													<span className="font-mono">{topPct}%</span>
												</div>
												<div className="h-1 rounded-full bg-surface2 overflow-hidden mt-0.5">
													<div
														className="h-full rounded-full bg-accent vb-bar-anim"
														style={{ width: `${topPct}%` }}
													/>
												</div>
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</section>
			)}

{/* ── Quick actions: broadcast + triage ────────────────────── */}
			<QuickActions posts={posts} onStatusChange={setStatus} />
			<StatusDialog
				open={!!statusDialog}
				onClose={() => setStatusDialog(null)}
				status={statusDialog?.status || ""}
				statusLabel={
					(STATUS_META[statusDialog?.status || ""] || { label: "" }).label
				}
				onSubmit={applyStatus}
			/>

			{/* ── Charts ────────────────────────────────────────────────── */}
			<div className="grid lg:grid-cols-2 gap-4">
				{/* Stacked timeline chart */}
				<section className="card p-4">
					<div className="flex items-center justify-between mb-3">
						<h2 className="font-display font-semibold text-sm">
							Activity — last 14 days
						</h2>
						<div className="flex gap-3 text-[10px] text-ink3">
							<span className="flex items-center gap-1">
								<span className="w-2 h-2 rounded-sm bg-accent" /> posts
							</span>
							<span className="flex items-center gap-1">
								<span className="w-2 h-2 rounded-sm bg-accent2 opacity-60" />{" "}
								comments
							</span>
						</div>
					</div>
					<div
						className="flex items-end gap-1 h-32"
						role="img"
						aria-label="Activity timeline chart"
					>
						{timeline.map((d, i) => (
							<div
								key={d.label}
								className="flex-1 flex flex-col items-center justify-end gap-px group h-full"
							>
								<span className="text-[9px] font-mono text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">
									{d.count + d.comments}
								</span>
								<div
									className="w-full rounded-t bg-accent2 opacity-60 vb-bar-anim"
									style={{
										height: `${(d.comments / maxDay) * 100}%`,
										animationDelay: `${i * 30}ms`,
									}}
									title={`${d.label}: ${d.comments} comments`}
								/>
								<div
									className="w-full rounded-b-sm bg-accent vb-bar-anim group-hover:brightness-110"
									style={{
										height: `${Math.max(2, (d.count / maxDay) * 100)}%`,
										animationDelay: `${i * 30}ms`,
									}}
									title={`${d.label}: ${d.count} posts`}
								/>
							</div>
						))}
					</div>
					<div className="flex justify-between text-[9px] text-ink3 mt-1">
						<span>{timeline[0]?.label ?? ""}</span>
						<span>{timeline[13]?.label ?? ""}</span>
					</div>
				</section>

				{/* Category bars */}
				<section className="card p-4">
					<h2 className="font-display font-semibold text-sm mb-3">
						Active categories
					</h2>
					<div className="space-y-2">
						{Object.entries(stats.catCount)
							.sort((a, b) => b[1] - a[1])
							.slice(0, 8)
							.map(([cat, n], i) => {
								const max = Math.max(...Object.values(stats.catCount));
								return (
									<div key={cat} className="flex items-center gap-2 text-xs">
										<span className="w-28 shrink-0 font-medium truncate">
											{CAT_EMOJI[cat]} {cat}
										</span>
										<div className="flex-1 h-3 rounded bg-surface2 overflow-hidden">
											<div
												className="h-full rounded vb-bar-anim"
												style={{
													width: `${(n / max) * 100}%`,
													animationDelay: `${i * 60}ms`,
													background:
														"linear-gradient(90deg, var(--vb-accent), var(--vb-accent2))",
												}}
											/>
										</div>
										<span className="font-mono w-6 text-right">{n}</span>
									</div>
								);
							})}
						{Object.keys(stats.catCount).length === 0 && (
							<p className="text-xs text-ink3">No data yet</p>
						)}
					</div>
				</section>
			</div>

			{/* ── Heatmap + pipeline ────────────────────────────────────── */}
			<div className="grid lg:grid-cols-2 gap-4">
				{/* Weekday heatmap */}
				<section className="card p-4">
					<h2 className="font-display font-semibold text-sm mb-3">
						Submission heatmap — last 4 weeks
					</h2>
					<div className="grid grid-cols-[auto_repeat(7,1fr)] gap-1.5 text-[9px] text-ink3">
						<span />
						{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
							<span key={d} className="text-center">
								{d}
							</span>
						))}
						{heatmap.map((week, w) => (
							<div key={w} className="contents">
								<span className="self-center pr-1">W{w + 1}</span>
								{week.map((n, d) => (
									<div
										key={d}
										className="aspect-square rounded-md vb-pop transition-transform hover:scale-110"
										style={{
											animationDelay: `${(w * 7 + d) * 20}ms`,
											background:
												n === 0
													? "var(--vb-surface2)"
													: `color-mix(in srgb, var(--vb-accent) ${Math.round((0.25 + (n / heatMax) * 0.75) * 100)}%, transparent)`,
										}}
										title={`${n} submission${n !== 1 ? "s" : ""}`}
									/>
								))}
							</div>
						))}
					</div>
					<div className="flex items-center gap-1.5 mt-3 text-[9px] text-ink3">
						less
						{[0, 0.33, 0.66, 1].map((f) => (
							<span
								key={f}
								className="w-3 h-3 rounded"
								style={{
									background:
										f === 0
											? "var(--vb-surface2)"
											: `color-mix(in srgb, var(--vb-accent) ${Math.round((0.25 + f * 0.75) * 100)}%, transparent)`,
										}}
							/>
						))}
						more
					</div>
				</section>

				{/* Pipeline distribution + health */}
				<section className="card p-4">
					<h2 className="font-display font-semibold text-sm mb-3">
						Pipeline distribution
					</h2>
					<div className="flex h-3 rounded-full overflow-hidden bg-surface2">
						{stats.statusDist
							.filter((d) => d.n > 0)
							.map((d) => (
								<div
									key={d.s}
									className="h-full vb-bar-anim first:rounded-l-full last:rounded-r-full"
									style={{
										width: `${(d.n / Math.max(1, stats.problemsCount)) * 100}%`,
										background: STATUS_META[d.s]?.color ?? "#888",
									}}
									title={`${STATUS_META[d.s]?.label ?? d.s}: ${d.n}`}
								/>
							))}
					</div>
					<div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
						{stats.statusDist
							.filter((d) => d.n > 0)
							.map((d) => (
								<span
									key={d.s}
									className="flex items-center gap-1 text-[10px] text-ink2"
								>
									<span
										className="w-2 h-2 rounded-full"
										style={{ background: STATUS_META[d.s]?.color ?? "#888" }}
									/>
									{STATUS_META[d.s]?.label ?? d.s} · {d.n}
								</span>
							))}
					</div>
					<div className="mt-4 rounded-lg border border-border bg-bg/60 p-3 text-center">
						<div className="font-display font-bold text-xl text-ink">
							<CountUp value={stats.health} />
						</div>
						<div className="text-[10px] text-ink3 font-semibold tracking-wide">
							COMMUNITY HEALTH
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}
