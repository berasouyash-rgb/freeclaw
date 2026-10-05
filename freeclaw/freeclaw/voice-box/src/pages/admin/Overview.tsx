// ═══════════════════════════════════════════════════════════════════
// COMMAND CENTER — the admin's work center
// ═══════════════════════════════════════════════════════════════════
// This is the admin's default screen and it answers two questions:
// what needs a human right now, and how is the platform doing?
//
// The six work sections themselves —
//   Urgent · Today · In progress · Waiting · Recently completed · Failed
// — live in WorkSections.tsx and are shared with the Work tab, so the
// dashboard and the Work tab can never drift apart. This file keeps
// what wraps them:
//
//   • the critical-alert banner (a real open alert must never hide)
//   • the snapshot header with an explicit Refresh
//   • CSV / JSON / print export of the underlying records
//   • dashboard visuals computed ONLY from the already-loaded snapshot:
//     health ring, urgency bar, pipeline bar, stat tiles, activity bars,
//     category bars, posting rhythm, triage queue, broadcast composer
//   • the Action Center as a secondary panel
//   • a jump row into the real queues
//
// Deliberately absent: the "AI management suggestions" strip (the work
// sections answer that instead), agent activity, and system-health
// furniture. Nothing here invents a number or a status — every figure
// derives from posts/comments/reports/users/polls below, an empty source
// renders an honest empty (never a fabricated chart), and a failed source
// is named rather than papered over. Loads once per visit; charts are
// static SVG from the snapshot, never a refetch.
// ═══════════════════════════════════════════════════════════════════

import {
	ArrowDown,
	ArrowUp,
	BarChart3,
	Bug,
	CheckCircle2,
	Clock,
	Command,
	Flag,
	GripVertical,
	Info,
	Lightbulb,
	Mail,
	Megaphone,
	MessageSquare,
	Play,
	RefreshCw,
	Send,
	Sparkles,
	Table2,
	TrendingUp,
	Users,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	buildComplianceCSV,
	buildPollCSV,
	buildReportCSV,
	type DateRange,
} from "../../lib/complianceCSV";
import {
	CriticalAlertBanner,
	type AlertRow,
} from "../../components/admin/CriticalAlertBanner";
import UpdateNotice from "../../components/admin/UpdateNotice";
import ErrorBoundary from "../../components/ErrorBoundary";
import ActionCenter from "./ActionCenter";
import ThreadDrawer from "../../components/admin/ThreadDrawer";
import WorkSections from "./WorkSections";
import { useApp } from "../../contexts/AppContext";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import {
	CAT_EMOJI,
	STATUS_META,
	downloadFile,
	errorText,
	safeStringify,
	timeAgo,
} from "../../lib/utils";
import type { CommentData, PollData, PostData } from "../../types";

interface ReportRow {
	id: string;
	target_type: string;
	reason: string;
	status?: string;
	created_at: string;
	[k: string]: unknown;
}

// Inbox thread rows for the emergency digest: the fields the digest
// actually reads (server sends more; the digest never invents rows).
interface InboxThread {
	thread_id: string;
	status?: string;
	handoff?: boolean;
	last_sender?: string;
	unread?: number;
	last_at?: string;
	last_message?: string;
	emotion?: { level?: string } | null;
}

// The users action returns display rows; the first row also carries the
// real population size in `total` (the list itself is capped).
interface UserRow {
	id: string;
	name: string;
	total?: number;
	[k: string]: unknown;
}

interface Announcement {
	text: string;
	kind: string;
	at?: string;
}

// ── Dashboard layout — admin-reorderable section stack ─────
// Order state only; every section renders from the same loaded snapshot.
// Persisted per device (localStorage), never invented: unknown keys drop,
// missing keys append in default order. Reset restores the default.
const LAYOUT_KEY = "vb:admin-layout";
const DEFAULT_LAYOUT = ["inbox", "trio", "stats", "explain", "insight", "queues", "jump", "action", "work"] as const;
type LayoutUnit = (typeof DEFAULT_LAYOUT)[number];
const LAYOUT_LABELS: Record<LayoutUnit, string> = {
	inbox: "Emergency inbox",
	trio: "Health and pipeline",
	stats: "Platform totals",
	explain: "Broadcast and triage",
	insight: "Activity and categories",
	queues: "Queues",
	jump: "Queue shortcuts",
	action: "Action Center",
	work: "Work sections",
};
function loadLayout(): LayoutUnit[] {
	try {
		const raw = localStorage.getItem(LAYOUT_KEY);
		const arr: unknown = raw ? JSON.parse(raw) : null;
		if (Array.isArray(arr)) {
			const known = arr.filter((k): k is LayoutUnit =>
				(DEFAULT_LAYOUT as readonly string[]).includes(String(k)),
			);
			return [...known, ...DEFAULT_LAYOUT.filter((k) => !known.includes(k))];
		}
	} catch {
		/* corrupted value → default order */
	}
	return [...DEFAULT_LAYOUT];
}

function DigestThreadRow({ t, tone, onOpen, askedHuman }: { t: InboxThread; tone: "emergency" | "waiting" | "ai"; onOpen: (id: string) => void; askedHuman?: boolean }) {
	const level = t.emotion?.level;
	return (
		<button
			key={t.thread_id}
			type="button"
			onClick={() => onOpen(t.thread_id)}
			className="w-full text-left flex items-start gap-3 text-sm py-2.5 border-b border-border last:border-0 group"
			aria-label={(tone === "emergency" ? "Open emergency thread " : tone === "waiting" ? "Open waiting thread " : "Open AI-handled thread ") + t.thread_id}
		>
			<span className="flex flex-col gap-1 shrink-0 pt-0.5">
				{tone === "emergency" && (
					// Show the ACTUAL level. A hardcoded "CRITICAL" badge on a
					// merely-high thread is a lie an admin acts on, and it is why
					// high-stress threads read as critical once they do surface.
					<span
						className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
							level === "critical" ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn"
						}`}
					>
						{level === "critical" ? "CRITICAL" : "HIGH"}
					</span>
				)}
				{tone === "waiting" && (<span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warn/10 text-warn">WAITING</span>)}
				{tone === "ai" && (<span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">AI</span>)}
				<span className="font-mono text-[10px] text-ink3">{t.thread_id.slice(0, 8)}</span>
			</span>
			<span className="flex-1 min-w-0">
				<span className="block text-[13px] leading-snug break-words group-hover:text-accent transition-colors">{t.last_message || "(no message text)"}</span>
				<span className="block text-[10px] text-ink3 mt-0.5">{t.handoff ? "Admin handling" : tone === "ai" ? "AI holding — no takeover" : level && level !== "none" ? "Emotion: " + level : "Needs a human"}</span>
			</span>
			{askedHuman && (
				<span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent shrink-0">
					Asked for human
				</span>
			)}
			{(t.unread ?? 0) > 0 && (<span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-bad/10 text-bad shrink-0">{t.unread} unread</span>)}
			<span className="text-[11px] text-ink3 shrink-0">{t.last_at ? timeAgo(t.last_at) : ""}</span>
		</button>
	);
}
function LayoutGrip({ unit, onMove, onPickUp, onDrop }: {
	unit: LayoutUnit;
	onMove: (unit: LayoutUnit, dir: -1 | 1) => void;
	onPickUp: (unit: LayoutUnit | null) => void;
	onDrop: (unit: LayoutUnit) => void;
}) {
	return (
		<button
			type="button"
			draggable
			aria-label={`Reorder ${LAYOUT_LABELS[unit]} section`}
			title={`Drag to reorder ${LAYOUT_LABELS[unit]} — or press arrow up / down`}
			onDragStart={(e) => {
				onPickUp(unit);
				e.dataTransfer.effectAllowed = "move";
				try {
					e.dataTransfer.setData("text/plain", unit);
				} catch {
					/* clipboard types unsupported — the ref carries it */
				}
			}}
			onDragEnd={() => onPickUp(null)}
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault();
				onDrop(unit);
			}}
			onKeyDown={(e) => {
				if (e.key === "ArrowUp") {
					e.preventDefault();
					onMove(unit, -1);
				} else if (e.key === "ArrowDown") {
					e.preventDefault();
					onMove(unit, 1);
				}
			}}
			className="absolute right-2 top-2 z-10 p-1 rounded-md text-ink3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface2 hover:text-ink transition-opacity cursor-grab active:cursor-grabbing"
		>
			<GripVertical size={13} aria-hidden />
		</button>
	);
}

function gotoThread(threadId: string) {
	window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: { tab: "inbox", thread: threadId } }));
}

function goto(tab: string) {
	window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: tab }));
}

// ─── Jump row → the real queues ─────────────────────────────────
// Only ACTIVE tab keys appear here. A retired key would render a
// button that looks live and silently does nothing, which is worse
// than not offering it.
const JUMP_TABS = [
	{ key: "reports", label: "Reports", icon: Flag },
	{ key: "posts", label: "Feed", icon: Table2 },
	{ key: "users", label: "Users", icon: Users },
	{ key: "polls", label: "Polls", icon: Command },
	{ key: "errors", label: "Errors", icon: Bug },
	{ key: "logs", label: "Logs", icon: Mail },
] as const;

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
	const c = new Date(d);
	c.setHours(0, 0, 0, 0);
	return c;
}

function shortDay(d: Date): string {
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Week-over-week trend chip. Divide-by-zero renders "new", never ∞%.
 * An upward move is good unless `invert` (e.g. open reports). */
function ChangeChip({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
	if (prev <= 0) {
		if (cur <= 0) return null;
		return (
			<span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full vb-pop bg-accent/10 text-accent">
				new
			</span>
		);
	}
	const pct = Math.round(((cur - prev) / prev) * 100);
	if (pct === 0) return null;
	const up = pct > 0;
	const good = invert ? !up : up;
	const Icon = up ? ArrowUp : ArrowDown;
	return (
		<span
			className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full vb-pop ${good ? "bg-good/12 text-good" : "bg-bad/12 text-bad"}`}
			aria-label={`Trend ${up ? "up" : "down"} ${Math.abs(pct)} percent`}
			title={`vs previous period: ${up ? "+" : "−"}${Math.abs(cur - prev)}`}
		>
			<Icon size={10} className="vb-trend-bounce" aria-hidden />
			{Math.abs(pct)}%
		</span>
	);
}

/** Area sparkline — static SVG from already-loaded counts, no library:
 * filled shape + drawn stroke + end dot, exactly the dashboard language. */
function AreaSpark({ data, label }: { data: number[]; label: string }) {
	const w = 64;
	const h = 22;
	const max = Math.max(1, ...data);
	const step = data.length > 1 ? w / (data.length - 1) : 0;
	const line = data
		.map((v, i) => `${(i * step).toFixed(1)},${(19 - (v / max) * 16).toFixed(1)}`)
		.join(" L");
	return (
		<svg
			width={w}
			height={h}
			viewBox={`0 0 ${w} ${h}`}
			aria-hidden
			className="overflow-visible shrink-0"
		>
			<title>{label}</title>
			<path d={`M${line} L${w},${h} L0,${h} Z`} fill="var(--vb-accent)" opacity="0.25" />
			<path
				d={`M${line}`}
				className="vb-draw"
				fill="none"
				stroke="var(--vb-accent)"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<circle
				className="vb-pop"
				cx={w.toFixed(1)}
				cy={(19 - ((data[data.length - 1] ?? 0) / max) * 16).toFixed(1)}
				r="2.5"
				fill="var(--vb-accent)"
			/>
		</svg>
	);
}

function dashDaySeries(
	items: Array<{ created_at?: string }>,
	days: Date[],
): number[] {
	return days.map((d) => {
		const key = d.toDateString();
		let n = 0;
		for (const it of items) {
			if (!it.created_at) continue;
			if (new Date(it.created_at).toDateString() === key) n++;
		}
		return n;
	});
}

export default function Overview() {
	const { toast } = useApp();

	// Loaded once on route entry and only re-read when the admin asks
	// for it. No passive refetch can reorder the page under a cursor.
	const [posts, setPosts] = useState<PostData[]>([]);
	const [comments, setComments] = useState<CommentData[]>([]);
	const [reports, setReports] = useState<ReportRow[]>([]);
	const [users, setUsers] = useState<UserRow[]>([]);
	// Real account population from the server (the list itself is capped
	// for display). null = server didn't send a count.
	const [usersTotal, setUsersTotal] = useState<number | null>(null);
	const [polls, setPolls] = useState<PollData[]>([]);
	const [alerts, setAlerts] = useState<AlertRow[]>([]);
	const [threads, setThreads] = useState<InboxThread[]>([]);
	const [announce, setAnnounce] = useState<Announcement | null>(null);
	const [annText, setAnnText] = useState("");
	const [annKind, setAnnKind] = useState<"info" | "success" | "warning">("info");
	const [annBusy, setAnnBusy] = useState(false);
	const [triageBusy, setTriageBusy] = useState<string | null>(null);

	const [loading, setLoading] = useState(true);
	const [lastUpdate, setLastUpdate] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [showActionCenter, setShowActionCenter] = useState(false);
	// Queue filter pill state lives here — above the loading early-return.
	// Hooks must run in identical order on every render; a useState placed
	// past the `if (loading) return` crashed with "rendered more hooks".
	type QueueKey = "trending" | "recent" | "open" | "reports" | "suggestions" | "polls";
	const [queue, setQueue] = useState<QueueKey>("trending");
	const [digestOpen, setDigestOpen] = useState(true);
	const [digestFilter, setDigestFilter] = useState<"all" | "emergencies" | "waiting">("all");
	const [drawerThread, setDrawerThread] = useState<string | null>(null);
	const [layout, setLayout] = useState<LayoutUnit[]>(loadLayout);
	const dragUnit = useRef<LayoutUnit | null>(null);
	const persistLayout = (next: LayoutUnit[]) => {
		setLayout(next);
		try {
			localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
		} catch {
			/* private mode — the order still applies for this visit */
		}
	};
	const orderOf = (unit: LayoutUnit): number => {
		const i = layout.indexOf(unit);
		return i < 0 ? layout.length : i;
	};
	const moveUnit = (unit: LayoutUnit, dir: -1 | 1) => {
		const i = layout.indexOf(unit);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= layout.length) return;
		const next = [...layout];
		const a = next[i] as LayoutUnit;
		const b = next[j] as LayoutUnit;
		next[i] = b;
		next[j] = a;
		persistLayout(next);
	};
	const dropUnitOn = (unit: LayoutUnit) => {
		const drag = dragUnit.current;
		dragUnit.current = null;
		if (!drag || drag === unit) return;
		const next = layout.filter((k) => k !== drag);
		const i = next.indexOf(unit);
		next.splice(i < 0 ? next.length : i, 0, drag);
		persistLayout(next);
	};

	const loadAll = useCallback(async (silent = false) => {
		if (!silent) setLoading(true);
		try {
			// Each source settles independently: a failed source keeps its
			// last-known rows and is reported via loadError instead of
			// masquerading as empty.
			const settled = await Promise.allSettled([
				api.getSlow<PostData[]>("/api/posts?all=1&filter_artifacts=1"),
				api.get<CommentData[]>("/api/comments?all=1"),
				api.get<ReportRow[]>("/api/reports"),
				api.post<UserRow[]>("/api/admin", { action: "users" }),
				api.get<PollData[]>("/api/polls"),
			api.get<InboxThread[] | { threads: InboxThread[] }>("/api/inbox?threads=1"),
			]);
			const names = [
				"posts",
				"comments",
				"reports",
				"users",
				"polls",
			"inbox",
			] as const;
			const failed: string[] = [];
			settled.forEach((s, i) => {
				if (s.status === "rejected") {
					const name = names[i] ?? `source-${i}`;
					failed.push(name);
					console.error("[overview] source fetch failed", {
						source: name,
						error:
							s.reason instanceof Error ? s.reason.message : String(s.reason),
					});
				}
			});
			const [p, c, r, u, pl, ib] = settled;
			if (p.status === "fulfilled") setPosts(p.value);
			if (c.status === "fulfilled") setComments(c.value);
			if (r.status === "fulfilled") setReports(r.value);
			if (u.status === "fulfilled") {
				// The users action returns an array; a per-row `total` (added to
				// every row server-side) carries the real population size.
				const list = Array.isArray(u.value) ? u.value : [];
				setUsers(list);
				const first = list[0] as { total?: number } | undefined;
				if (first && typeof first.total === "number")
					setUsersTotal(first.total);
			}
			if (pl.status === "fulfilled") setPolls(pl.value);
			if (ib.status === "fulfilled") setThreads(Array.isArray(ib.value) ? ib.value : ((ib.value as { threads?: InboxThread[] })?.threads ?? []));
			setLoadError(
				failed.length
					? `Some sources failed: ${failed.join(", ")} — showing last-known data.`
					: null,
			);
			if (!failed.length) setLastUpdate(new Date().toISOString());
		} catch (err) {
			console.error("[overview] loadAll failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			setLoadError("Dashboard refresh failed — showing last-known data.");
		}
		setLoading(false);
	}, []);

	const alertsInFlight = useRef(false);

	const loadAlerts = useCallback(async () => {
		// ops-summary is a heavy endpoint (~3.6s) — never let overlapping
		// calls stack up if the DB is briefly slow.
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

	// The live banner reads on its own track: it must not hold the
	// dashboard loading gate, and a failure here hides nothing else.
	useEffect(() => {
		let on = true;
		api
			.get("/api/announcements")
			.then((r: unknown) => {
				if (!on) return;
				setAnnounce(
					r && typeof r === "object" && !Array.isArray(r)
						? (r as Announcement)
						: null,
				);
			})
			.catch(() => {
				/* composer still works; it just shows no current banner */
			});
		return () => {
			on = false;
		};
	}, []);

	useEffect(() => {
		void loadAll();
		void loadAlerts();
	}, [loadAll, loadAlerts]);

	// ─── Freshness signal, not a refetch ──────────────────────────
	// Adds/deletes land as a badge like the admin feed (PostsTable):
	// realtime raises "N new updates", the admin pulls with Refresh or
	// View updates. No auto-refetch, no timer, no visibility reload —
	// the dashboard keeps its bounded snapshot until an explicit pull.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();
	const [dashRefreshing, setDashRefreshing] = useState(false);

	const handleDashboardRefresh = useCallback(async () => {
		setDashRefreshing(true);
		try {
			await loadAll(true);
			await loadAlerts();
			clearUpdates();
		} finally {
			setDashRefreshing(false);
		}
	}, [loadAll, loadAlerts, clearUpdates]);

	useRealtime(
		["posts", "reports", "comments", "polls", "chat_threads", "chat_messages"],
		markUpdatesAvailable,
		1_000,
	);

	// ── Visible-only silent revalidation (contract evolution 2026-10-05) ──
	// Adds/deletes still land as a badge for an explicit pull, but a wall
	// of numbers that never moves until clicked reads as a dead dashboard.
	// Every 30s while mounted AND visible (plus on focus/return), silently
	// re-run the same snapshot load the Refresh button uses — no loaders
	// (silent), no badge clearing (the admin still pulls formally when the
	// notice matters). Dashboards conventionally revalidate at this
	// cadence; the heavy alerts lane keeps its own overlap guard.
	useEffect(() => {
		const tick = () => {
			if (
				typeof document !== "undefined" &&
				document.visibilityState === "hidden"
			)
				return;
			void loadAll(true);
			void loadAlerts();
		};
		const id = window.setInterval(tick, 30_000);
		window.addEventListener("focus", tick);
		document.addEventListener("visibilitychange", tick);
		return () => {
			window.clearInterval(id);
			window.removeEventListener("focus", tick);
			document.removeEventListener("visibilitychange", tick);
		};
	}, [loadAll, loadAlerts]);

	const publishAnnouncement = async () => {
		const text = annText.trim().slice(0, 300);
		if (!text || annBusy) return;
		setAnnBusy(true);
		try {
			const r = await api.post<{ ok?: boolean; value?: Announcement }>(
				"/api/announcements",
				{ text, kind: annKind },
			);
			if (r?.value) setAnnounce(r.value);
			setAnnText("");
			toast("Announcement published — visible to every visitor", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Publish failed", "err");
		}
		setAnnBusy(false);
	};

	const clearAnnouncement = async () => {
		if (annBusy) return;
		setAnnBusy(true);
		try {
			await api.post("/api/announcements", { clear: true });
			setAnnounce(null);
			toast("Announcement removed", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Remove failed", "err");
		}
		setAnnBusy(false);
	};

	// Direct status change without a report (trending rows). Same real
	// endpoint, same silent re-read so every number below stays honest.
	const setPostStatus = async (
		postId: string,
		status: "in_progress" | "solved",
	) => {
		const key = `${status}:${postId}`;
		if (triageBusy) return;
		setTriageBusy(key);
		const prev = posts.find((p) => p.id === postId)?.status;
		// Optimistic: the row reflects the tap instantly; the silent
		// re-read behind it converges every figure. A failed write rolls
		// the row back instead of lying about it.
		setPosts((rows) => rows.map((p) => (p.id === postId ? { ...p, status } : p)));
		try {
			await api.put("/api/posts", { id: postId, status });
			toast(
				status === "solved" ? "Marked solved" : "Marked in progress",
				"ok",
			);
			void loadAll(true);
		} catch (e: unknown) {
			if (prev) setPosts((rows) => rows.map((p) => (p.id === postId ? { ...p, status: prev } : p)));
			toast(e instanceof Error ? e.message : "Action failed", "err");
		}
		setTriageBusy(null);
	};

	// Triage acts on the reported POST itself (Verify → verified,
	// Start → in_progress). Verifying also resolves the report — its job
	// is done. Starting leaves the report open: work began, outcome
	// pending. Numbers below re-read silently so the tiles stay honest.
	const triagePost = async (
		reportId: string,
		postId: string,
		status: "verified" | "in_progress",
	) => {
		const key = `${status}:${postId}`;
		if (triageBusy) return;
		setTriageBusy(key);
		const prevPost = posts.find((p) => p.id === postId)?.status;
		const prevReport = reports.find((r) => r.id === reportId)?.status;
		setPosts((rows) => rows.map((p) => (p.id === postId ? { ...p, status } : p)));
		if (status === "verified") {
			setReports((rows) => rows.map((r) => (r.id === reportId ? { ...r, status: "resolved" } : r)));
		}
		try {
			await api.put("/api/posts", { id: postId, status });
			if (status === "verified") {
				await api.put("/api/reports", { id: reportId, status: "resolved" });
				toast("Verified — report closed", "ok");
			} else {
				toast("Marked in progress", "ok");
			}
			void loadAll(true);
		} catch (e: unknown) {
			if (prevPost) setPosts((rows) => rows.map((p) => (p.id === postId ? { ...p, status: prevPost } : p)));
			if (prevReport) setReports((rows) => rows.map((r) => (r.id === reportId ? { ...r, status: prevReport } : r)));
			toast(e instanceof Error ? e.message : "Action failed", "err");
		}
		setTriageBusy(null);
	};

	// A real open critical/high alert must never hide behind a content
	// loading gate, so the banner is built before the early return.
	const dangerBanner = (
		<CriticalAlertBanner
			alerts={alerts}
			onAcknowledge={async (id) => {
				try {
					await api.post("/api/workforce", {
						action: "acknowledge-alert",
						id,
					});
					toast("Alert acknowledged", "ok");
					await loadAlerts();
				} catch (e: unknown) {
					toast(
						`Acknowledge failed: ${errorText(e) || "no details — please retry"}`,
						"err",
					);
				}
			}}
			// The standalone Work tab is retired (it duplicated these
			// sections). Jump to the inline work sections on this dashboard;
			// missing element (loading gate) is a safe no-op.
			onOpenWorkforce={() =>
				document
					.querySelector('[data-unit="work"]')
					// scrollIntoView is absent in some embedded webviews — the
					// dashboard already shows the sections, so skip silently.
					?.scrollIntoView?.({ behavior: "smooth", block: "start" })
			}
		/>
	);

	if (loading)
		return (
			<div className="flex flex-col gap-6 min-w-0" data-testid="admin-dashboard">
				{dangerBanner}
				<p className="text-sm text-ink3" role="status">
					Loading the latest records…
				</p>
			</div>
		);

	const problems = posts.filter((p) => p.type === "problem" && !p.deleted);
	const range: DateRange = { preset: "all" };
	const stamp = new Date().toISOString().slice(0, 10);

	// ── Everything below derives from the loaded snapshot. No new fetch,
	// no invented numbers. ──────────────────────────────────────────
	const live = posts.filter((p) => !p.deleted);
	const postById = new Map(live.map((p) => [p.id, p]));
	const openPosts = live.filter(
		(p) => p.status !== "solved" && p.status !== "archived",
	);
	const nowMs = Date.now();
	const since = (days: number) => nowMs - days * DAY_MS;
	const inDays = <T extends { created_at?: string }>(
		items: Array<T>,
		days: number,
	): Array<T> =>
		items.filter(
			(i) => i.created_at && new Date(i.created_at).getTime() >= since(days),
		);
	const postsWeek = inDays(live, 7);
	const postsPrevWeek = live.filter((p) => {
		if (!p.created_at) return false;
		const t = new Date(p.created_at).getTime();
		return t >= since(14) && t < since(7);
	});
	const postsToday = inDays(live, 1);
	const postsMonth = inDays(live, 30);
	const commentsWeek = inDays(comments, 7);
	const commentsPrevWeek = comments.filter((c) => {
		if (!c.created_at) return false;
		const t = new Date(c.created_at).getTime();
		return t >= since(14) && t < since(7);
	});
	const reportsWeek = inDays(reports, 7);
	const reportsPrevWeek = reports.filter((r) => {
		if (!r.created_at) return false;
		const t = new Date(r.created_at).getTime();
		return t >= since(14) && t < since(7);
	});
	const suggestions = live.filter((p) => p.type === "suggestion");
	const solvedPosts = live.filter((p) => p.status === "solved");
	const solvesWeek = inDays(solvedPosts, 7);
	const solvesPrevWeek = solvedPosts.filter((p) => {
		if (!p.created_at) return false;
		const t = new Date(p.created_at).getTime();
		return t >= since(14) && t < since(7);
	});
	const resolvedCount = live.filter(
		(p) => p.status === "solved" || p.status === "archived",
	).length;
	const resolutionRate =
		live.length > 0 ? Math.round((resolvedCount / live.length) * 100) : 0;
	const solveDays = solvedPosts
		.map((p) => {
			if (!p.created_at || !p.updated_at) return null;
			const d =
				(new Date(p.updated_at).getTime() - new Date(p.created_at).getTime()) /
				DAY_MS;
			return d >= 0 && Number.isFinite(d) ? d : null;
		})
		.filter((d): d is number => d !== null);
	const avgSolve =
		solveDays.length > 0
			? solveDays.reduce((a, b) => a + b, 0) / solveDays.length
			: null;
	const reactionTotal = live.reduce(
		(sum, p) =>
			sum +
			Object.values(p.reactions ?? {}).reduce(
				(a, b) => a + (typeof b === "number" ? b : 0),
				0,
			),
		0,
	);
	const engagement = reactionTotal + comments.length;
	const openReports = reports.filter((r) => r.status !== "resolved");
	const usersCount = usersTotal ?? users.length;

	// Urgency: weighted open work, capped at 100. Bands are fixed and
	// documented so the number always means the same thing.
	const URGENCY_W: Record<string, number> = {
		critical: 25,
		high: 10,
		medium: 4,
		low: 1,
	};
	const urgency = Math.min(
		100,
		Math.round(
			openPosts.reduce(
				(sum, p) => sum + (URGENCY_W[p.priority] ?? 2),
				0,
			),
		),
	);
	// One vocabulary everywhere: the urgency scale is expressed in the SAME
	// four priority words posts use (Critical / High / Medium / Low), so an
	// admin never has to learn two scales for one idea. Bands are fixed and
	// documented so the number always means the same thing.
	const urgencyBand =
		urgency >= 60
			? { label: "Critical", text: "text-bad", bg: "bg-bad" }
			: urgency >= 25
				? { label: "High", text: "text-warn", bg: "bg-warn" }
				: { label: "Low", text: "text-good", bg: "bg-good" };

	// Community health: v1 composite of resolution share, engagement
	// density (5 interactions/post = full marks), and weekly throughput
	// (10 posts/week = full marks). Each leg is capped so one wild week
	// cannot fake a healthy community.
	const health = Math.round(
		0.5 * resolutionRate +
			0.25 *
				Math.min(
					100,
					live.length > 0 ? (engagement / live.length / 5) * 100 : 0,
				) +
			0.25 * Math.min(100, (postsWeek.length / 10) * 100),
	);
	const RING_C = 2 * Math.PI * 34;

	// Pipeline: every known status gets a segment; anything the status
	// map has never seen lands in Other instead of vanishing.
	const pipeBuckets = [...Object.keys(STATUS_META), "other"];
	const pipeCounts = pipeBuckets.map((s) =>
		s === "other"
			? live.filter((p) => !(p.status in STATUS_META)).length
			: live.filter((p) => p.status === s).length,
	);

	// Last 14 days, oldest first, for bars and sparklines.
	const last14 = Array.from({ length: 14 }, (_, i) =>
		startOfDay(new Date(nowMs - (13 - i) * DAY_MS)),
	);
	const postsByDay = dashDaySeries(live, last14);
	const commentsByDay = dashDaySeries(comments, last14);
	const solvesByDay = dashDaySeries(solvedPosts, last14);
	const reportsByDay = dashDaySeries(reports, last14);
	const suggByDay = dashDaySeries(suggestions, last14);
	const maxActivity = Math.max(1, ...postsByDay, ...commentsByDay);

	const catCounts = new Map<string, number>();
	for (const p of live) catCounts.set(p.category, (catCounts.get(p.category) ?? 0) + 1);
	const topCats = [...catCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);
	const maxCat = Math.max(1, ...topCats.map(([, n]) => n));

	// Posting rhythm: last 4 full weeks, Monday-first columns.
	const rhythm: number[][] = Array.from({ length: 4 }, () => Array(7).fill(0));
	{
		const monday = startOfDay(new Date(nowMs));
		const dow = (monday.getDay() + 6) % 7; // Monday = 0
		monday.setDate(monday.getDate() - dow - 21); // 3 weeks back + this week
		for (const p of live) {
			if (!p.created_at) continue;
			const t = startOfDay(new Date(p.created_at)).getTime();
			const wi = Math.floor((t - monday.getTime()) / (7 * DAY_MS));
			if (wi < 0 || wi > 3) continue;
			const di = Math.round((t - (monday.getTime() + wi * 7 * DAY_MS)) / DAY_MS);
			if (di < 0 || di > 6) continue;
			rhythm[wi]![di]! += 1;
		}
	}
	const maxRhythm = Math.max(1, ...rhythm.flat());

	// Triage: open reports against posts that are still sitting at
	// `reported` — the exact queue the reference calls "needs triage".
	const triage = openReports
		.filter((r) => r.target_type === "post")
		.map((r) => ({ report: r, post: postById.get(String(r.target_id)) }))
		.filter(
			(x): x is { report: ReportRow; post: PostData } =>
				!!x.post && x.post.status === "reported",
		)
		.slice(0, 4);

	// Trending right now: open posts ranked by live engagement
	// (reactions + comments), top 5. Same real snapshot, no new fetch.
	// Net engagement: up-votes (support/upvote + legacy positives) minus
	// down-votes (disagree/downvote), floored at zero — a heavily
	// down-voted post must not top "Trending issues" as if the pile-on
	// were endorsement. Matches trendingScore's binary-vote rule.
	const engagementOf = (p: PostData) => {
		let up = 0;
		let down = 0;
		for (const [k, v] of Object.entries(p.reactions ?? {})) {
			if (typeof v !== "number") continue;
			if (k === "disagree" || k === "downvote") down += v;
			else up += v;
		}
		return Math.max(0, up - down) + (p.comment_count ?? 0);
	};
	const trending = openPosts
		.map((p) => ({ post: p, score: engagementOf(p) }))
		.filter((t) => t.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				+new Date(b.post.created_at || 0) - +new Date(a.post.created_at || 0),
		)
		.slice(0, 5);

	// Queue filter pills: the production workspace tabs over the live
	// snapshot. Each pill carries a live count; tapping filters the ranked
	// list below. Every query derives from the already-loaded snapshot —
	// no new fetch, no invented rows.
	// (The `queue` state itself lives with the other useState calls above
	// the loading early-return; only derivations stay down here.)
	const byCreatedDesc = (a: PostData, b: PostData) =>
		+new Date(b.created_at || 0) - +new Date(a.created_at || 0);
	const recentRanked = [...postsWeek].sort(byCreatedDesc);
	const openRanked = [...openPosts].sort(
		(a, b) =>
			(URGENCY_W[b.priority] ?? 2) - (URGENCY_W[a.priority] ?? 2) ||
			byCreatedDesc(a, b),
	);
	const reportCountByPost = new Map<string, number>();
	for (const r of openReports) {
		if (r.target_type !== "post") continue;
		const id = String(r.target_id);
		if (!postById.get(id)) continue;
		reportCountByPost.set(id, (reportCountByPost.get(id) ?? 0) + 1);
	}
	const reportedRanked = [...reportCountByPost.entries()]
		.map(([id, n]) => ({ post: postById.get(id)!, reports: n }))
		.sort(
			(a, b) =>
				b.reports - a.reports || byCreatedDesc(a.post, b.post),
		)
		.map(({ post, reports }) => ({ post, score: reports }));
	const suggRanked = [...suggestions].sort(byCreatedDesc);
	const pollRows = Array.isArray(polls) ? polls : [];
	const pollsById = new Map(pollRows.map((pl) => [pl.id, pl]));
	const pollPostRanked = openPosts
		.filter((p) => p.linked_poll)
		.map((p) => ({
			post: p,
			// Live poll fetch wins: `linked_poll_votes` is the feed snapshot
			// taken when the posts query ran, so preferring it ranks stale counts.
			score:
				pollsById.get(p.linked_poll!)?.total_votes ??
				p.linked_poll_votes ??
				0,
		}))
		.sort((a, b) => b.score - a.score || byCreatedDesc(a.post, b.post));
	const queueLists: Record<
		QueueKey,
		{ title: string; empty: string; rows: Array<{ post: PostData; score: number }> }
	> = {
		trending: {
			title: "🔥 Trending issues right now",
			empty: "No trending issues right now.",
			rows: trending,
		},
		recent: {
			title: "🕐 Recent posts",
			empty: "No recent posts.",
			rows: recentRanked.map((post) => ({ post, score: engagementOf(post) })),
		},
		open: {
			title: "⚠ Open issues",
			empty: "No open issues.",
			rows: openRanked.map((post) => ({ post, score: engagementOf(post) })),
		},
		reports: {
			title: "🚩 Reported posts",
			empty: "No reported posts right now.",
			rows: reportedRanked,
		},
		suggestions: {
			title: "💡 Suggestions",
			empty: "No suggestions yet.",
			rows: suggRanked.map((post) => ({ post, score: engagementOf(post) })),
		},
		polls: {
			title: "📊 Posts with polls",
			empty: "No posts with polls right now.",
			rows: pollPostRanked,
		},
	};
	const activeQueue = queueLists[queue];
	const queueRows = activeQueue.rows.slice(0, 5);
	const queueMax = Math.max(1, ...queueRows.map((r) => r.score));
		// Emergency inbox digest: open threads at critical emotion need a human
	// now; threads the AI answered last with no takeover are holding without
	// the admin. Same loaded snapshot — no new fetch.
	const openThreads = threads.filter((t) => (t.status ?? "open") !== "closed");
	// Emotion levels are the full vocabulary from the contextual classifier
	// (none | mild | moderate | high | critical). "high" is a person in
	// distress and MUST be actionable: filtering on "critical" alone made a
	// high-stress thread fall through to neither list and vanish from the
	// dashboard while still reading "high stress" in the inbox.
	const URGENT = new Set(["high", "critical"]);
	const isUrgent = (t: InboxThread) => URGENT.has(String(t.emotion?.level ?? ""));
	const emergencies = openThreads
		.filter(isUrgent)
		.sort((a, b) => {
			// Most severe first, then most recent. A critical thread must never
			// be pushed below a high one just because it is a few seconds older.
			const rank = (t: InboxThread) => (t.emotion?.level === "critical" ? 0 : 1);
			return rank(a) - rank(b) || +new Date(b.last_at || 0) - +new Date(a.last_at || 0);
		});
	// Words by which a student explicitly asks for a person. Tight on
	// purpose: "help" alone fires on ordinary chat and would page for noise.
	const ASK_HUMAN_RE = /\b(admin|human|real person|someone real)\b/i;
	const askedForHuman = (t: InboxThread) =>
		!t.handoff && ASK_HUMAN_RE.test(t.last_message || "");
	// Waiting: unread user mail with no takeover — plus any thread where
	// the student explicitly asked for a human while no admin was there,
	// even if the AI answered last. Critical rows live under emergencies.
	const waiting = openThreads
		.filter(
			(t) =>
				!isUrgent(t) &&
				((!t.handoff && t.last_sender === "user" && (t.unread ?? 0) > 0) ||
					askedForHuman(t)),
		)
		.sort((a, b) => +new Date(b.last_at || 0) - +new Date(a.last_at || 0));
	const digestTotal = emergencies.length + waiting.length;
	const criticalCount = emergencies.filter((t) => t.emotion?.level === "critical").length;
	const highCount = emergencies.length - criticalCount;

const queueCounts: Record<QueueKey, number> = {
		trending: trending.length,
		recent: recentRanked.length,
		open: openRanked.length,
		reports: reportedRanked.length,
		suggestions: suggRanked.length,
		polls: pollPostRanked.length,
	};

	return (
		<div className="flex flex-col gap-6 min-w-0" data-testid="admin-dashboard">
			{dangerBanner}
			<ThreadDrawer
				threadId={drawerThread}
				onClose={() => setDrawerThread(null)}
				onOpenInbox={(id) => {
					setDrawerThread(null);
					gotoThread(id);
				}}
			/>

			{/* ── Hero header ───────────────────────────────────────── */}
			<header>
				<div className="flex items-center justify-between flex-wrap gap-2">
					<div>
						<h1 className="font-display font-bold text-xl">Dashboard</h1>
						<p className="text-[11px] text-ink3 mt-0.5 flex flex-wrap items-center gap-1.5">
							<span
								className="inline-block h-2 w-2 rounded-full bg-good"
								aria-hidden
							/>
							<span className="font-medium">SNAPSHOT</span>
							<span className="opacity-40">·</span>
							<span>
								{posts.length} posts · {comments.length} comments ·{" "}
								{usersTotal ?? users.length} users
							</span>
							{lastUpdate && (
								<>
									<span className="opacity-40">·</span>
									<span>updated {timeAgo(lastUpdate)}</span>
								</>
							)}
							{loadError && (
								<>
									<span className="opacity-40">·</span>
									<span className="text-warn" role="alert">
										{loadError}
									</span>
								</>
							)}
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() => void handleDashboardRefresh()}
						aria-label="Refresh dashboard"
						title="Refresh dashboard"
					>
						<RefreshCw size={13} /> Refresh
					</button>
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() => persistLayout([...DEFAULT_LAYOUT])}
						aria-label="Reset dashboard layout"
						title="Reset dashboard layout"
					>
						Reset layout
					</button>
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() =>
							downloadFile(
								`voicebox-reports-${stamp}.csv`,
								buildReportCSV(reports),
								"text/csv;charset=utf-8",
							)
						}
					>
						Reports CSV
					</button>
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() =>
							downloadFile(
								`voicebox-complaints-${stamp}.csv`,
								buildComplianceCSV(problems, range, "problem"),
								"text/csv;charset=utf-8",
							)
						}
					>
						Complaints CSV
					</button>
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() =>
							downloadFile(
								`voicebox-polls-${stamp}.csv`,
								buildPollCSV(polls),
								"text/csv;charset=utf-8",
							)
						}
					>
						Polls CSV
					</button>
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() =>
							downloadFile(
								`voicebox-export-${stamp}.json`,
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
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() => window.print()}
					>
						Print / PDF
					</button>
					</div>
				</div>
			</header>

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleDashboardRefresh()}
				refreshing={dashRefreshing}
			/>

			<section
				aria-label="Emergency inbox digest"
				data-testid="dash-inbox-digest"
				data-unit="inbox"
				style={{ order: orderOf("inbox") }}
				onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("inbox")}
				className="card p-5 relative group"
			>
				<LayoutGrip unit="inbox" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
				<div className="flex items-center justify-between gap-2 mb-1">
					<h2 className="font-display font-semibold text-sm">
						🚨 Emergency inbox
					</h2>
					<button
						type="button"
						className="btn btn-ghost !text-[11px] !py-1 !px-2 rounded-lg"
						onClick={() => goto("inbox")}
						aria-label="Open inbox"
					>
						Open inbox
					</button>
				</div>
								<p className="text-xs text-ink2 mb-3">
					{criticalCount} critical · {highCount} high · {waiting.length} waiting
					<button type="button" className="ml-2 underline text-ink3 hover:text-accent" onClick={() => setDigestOpen((v) => !v)} aria-expanded={digestOpen} aria-label={digestOpen ? "Collapse emergency inbox" : "Expand emergency inbox"}>{digestOpen ? "Show less" : "Show all"}</button>
				</p>
				{digestOpen && digestTotal > 0 && (
					<div className="inline-flex rounded-xl bg-surface2 p-1 gap-0.5 mb-2" role="tablist" aria-label="Digest filter">
						{(["all", "emergencies", "waiting"] as const).map((f) => (
							<button
								key={f}
								role="tab"
								aria-selected={digestFilter === f}
								onClick={() => setDigestFilter(f)}
								className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${digestFilter === f ? "bg-surface shadow-sm text-accent" : "text-ink3 hover:text-ink2"}`}
							>
								{f}
							</button>
						))}
					</div>
				)}
				{digestOpen && (digestTotal === 0 ? (
					<p className="text-xs text-ink3">No open distress signals — nothing is waiting on an admin.</p>
				) : (
					<div className="space-y-3">
						{digestFilter !== "waiting" && emergencies.length > 0 && (
						<div>
							<h3 className="text-[11px] font-bold uppercase tracking-wider text-bad mb-1">
								Distress signals — needs a human now
							</h3>
							<div className="space-y-1">
								{emergencies.map((t) => (
									<DigestThreadRow key={t.thread_id} t={t} tone="emergency" onOpen={(id) => setDrawerThread(id)} askedHuman={askedForHuman(t)} />
								))}
							</div>
						</div>
					)}
					{digestFilter !== "emergencies" && waiting.length > 0 && (
						<div>
							<h3 className="text-[11px] font-bold uppercase tracking-wider text-warn mb-1">
								Waiting for an admin
							</h3>
							<div className="space-y-1">
								{waiting.map((t) => (
									<DigestThreadRow key={t.thread_id} t={t} tone="waiting" onOpen={(id) => setDrawerThread(id)} askedHuman={askedForHuman(t)} />
								))}
							</div>
						</div>
					)}					</div>
				))}
			</section>


			{/* ── Health · urgency · pipeline ───────────────────────── */}
			<div data-unit="trio" style={{ order: orderOf("trio") }} onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("trio")} className="grid gap-3 md:grid-cols-3 relative group">
				<LayoutGrip unit="trio" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
				<section
					aria-label="Community health"
					data-testid="dash-health"
					className="card p-5 flex items-center gap-5 vb-rise"
				>
					<div className="relative shrink-0" style={{ width: 84, height: 84 }}>
						<svg width="84" height="84" aria-hidden>
							<circle
								cx="42"
								cy="42"
								r="34"
								fill="none"
								stroke="var(--vb-surface2)"
								strokeWidth="9"
							/>
							<circle
								className="vb-ring"
								cx="42"
								cy="42"
								r="34"
								fill="none"
								stroke="var(--vb-warn)"
								strokeWidth="9"
								strokeLinecap="round"
								strokeDasharray={`${((health / 100) * RING_C).toFixed(1)} ${RING_C.toFixed(1)}`}
								transform="rotate(-90 42 42)"
								style={{ "--ring-circ": RING_C.toFixed(1) } as React.CSSProperties}
							/>
						</svg>
						<span className="absolute inset-0 grid place-items-center font-display font-bold text-xl">
							<span className="tabular-nums">{health}</span>
						</span>
					</div>
					<div className="min-w-0">
						<p className="font-semibold text-sm">Community health</p>
						<p className="text-[11px] text-ink3 mt-0.5 leading-snug">
							Resolution {resolutionRate}% · engagement & weekly activity.
						</p>
						<p className="mt-1.5">
							<ChangeChip
								cur={postsWeek.length}
								prev={postsPrevWeek.length}
							/>
						</p>
					</div>
				</section>

				<section
					aria-label="AI urgency score"
					data-testid="dash-urgency"
					className="card p-5 vb-rise"
					style={{ animationDelay: "60ms" }}
				>
					<div className="flex items-center justify-between">
						<p className="font-display font-semibold text-sm">AI urgency score (Critical / High / Medium / Low)</p>
						<span
							className={`font-display font-bold text-2xl tabular-nums ${urgencyBand.text}`}
						>
							<span>{urgency}</span>
						</span>
					</div>
					<div
						className="h-2.5 rounded-full bg-surface2 overflow-hidden mt-3"
						role="img"
						aria-label={`Urgency ${urgency} of 100, ${urgencyBand.label}`}
					>
						<div
							className={`h-full rounded-full vb-bar-anim ${urgencyBand.bg}`}
							style={{ width: `${urgency}%` }}
						/>
					</div>
					<div className="flex justify-between text-[9px] text-ink3 mt-1">
						<span>Low</span>
						<span>High</span>
						<span>Critical</span>
					</div>
					<p className="text-[11px] text-ink3 mt-2">
						Weighted by priority across {openPosts.length} open{" "}
						{openPosts.length === 1 ? "issue" : "issues"}.
					</p>
				</section>

				<section
					aria-label="Pipeline distribution"
					data-testid="dash-pipeline"
					className="card p-5 vb-rise"
					style={{ animationDelay: "120ms" }}
				>
					<p className="font-display font-semibold text-sm mb-3">Pipeline distribution</p>
					{live.length === 0 ? (
						<p className="text-[11px] text-ink3 mt-2">No posts yet.</p>
					) : (
						<>
							<div
								className="flex h-3 rounded-full overflow-hidden bg-surface2"
								role="img"
								aria-label={`Pipeline across ${live.length} posts`}
							>
								{pipeBuckets.map((s) => {
									const n = pipeCounts[pipeBuckets.indexOf(s)] ?? 0;
									if (n === 0) return null;
									const label =
										s === "other" ? "Other" : (STATUS_META[s]?.label ?? s);
									const color =
										s === "other"
											? "var(--vb-ink3)"
											: (STATUS_META[s]?.color ?? "var(--vb-ink3)");
									return (
										<div
											key={s}
											className="h-full vb-bar-anim first:rounded-l-full last:rounded-r-full"
											title={`${label}: ${n}`}
											style={{
												width: `${(n / live.length) * 100}%`,
												background: color,
											}}
										/>
									);
								})}
							</div>
							<div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
								{pipeBuckets
									.map((s, i) => ({ s, n: pipeCounts[i] ?? 0 }))
									.filter((b) => b.n > 0)
									.map(({ s, n }) => {
										const label =
											s === "other"
												? "Other"
												: (STATUS_META[s]?.label ?? s);
										const color =
											s === "other"
												? "var(--vb-ink3)"
												: (STATUS_META[s]?.color ?? "var(--vb-ink3)");
										return (
											<span
												key={s}
												className="flex items-center gap-1 text-[10px] text-ink2"
											>
												<span
													className="w-2 h-2 rounded-full"
													style={{ background: color }}
													aria-hidden
												/>
												{label} · {n}
											</span>
										);
									})}
							</div>
						</>
					)}
				</section>
			</div>

			{/* ── Stat tiles ────────────────────────────────────────── */}
			<section
				aria-label="Platform totals"
				data-testid="dash-stats"
				data-unit="stats"
				style={{ order: orderOf("stats") }}
				onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("stats")}
				className="grid grid-cols-2 lg:grid-cols-4 gap-3 relative group"
				>
				<LayoutGrip unit="stats" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
				{[
					{
						icon: <Megaphone size={16} className="text-accent" />,
						value: String(postsWeek.length),
						label: "Posts this week",
						sub: `${postsToday.length} today · ${postsMonth.length} this month`,
						spark: postsByDay,
						chip: (
							<ChangeChip cur={postsWeek.length} prev={postsPrevWeek.length} />
						),
					},
					{
						icon: <CheckCircle2 size={16} className="text-good" />,
						value: `${resolutionRate}%`,
						label: "Resolution rate",
						sub:
							avgSolve === null
								? "no solves yet"
								: `avg solve ${avgSolve.toFixed(1)} days`,
						spark: solvesByDay,
						chip: (
							<ChangeChip cur={solvesWeek.length} prev={solvesPrevWeek.length} />
						),
					},
					{
						icon: <TrendingUp size={16} className="text-accent" />,
						value: String(engagement),
						label: "Engagement",
						sub: `${reactionTotal} reactions · ${comments.length} comments`,
						spark: postsByDay.map((v, i) => v + (commentsByDay[i] ?? 0)),
						chip: null,
					},
					{
						icon: <MessageSquare size={16} className="text-ink2" />,
						value: String(commentsWeek.length),
						label: "Comments this week",
						sub: "community discussion",
						spark: commentsByDay,
						chip: (
							<ChangeChip
								cur={commentsWeek.length}
								prev={commentsPrevWeek.length}
							/>
						),
					},
					{
						icon: <Users size={16} className="text-ink2" />,
						value: String(usersCount),
						label: "Anonymous users",
						sub: "known anonymous IDs",
						spark: [],
						chip: null,
					},
					{
						icon: <Flag size={16} className="text-bad" />,
						value: String(openReports.length),
						label: "Open reports",
						sub: "moderation queue",
						spark: reportsByDay,
						chip: (
							<ChangeChip
								cur={reportsWeek.length}
								prev={reportsPrevWeek.length}
								invert
							/>
						),
					},
					{
						icon: <Sparkles size={16} className="text-warn" />,
						value: String(suggestions.length),
						label: "Suggestions",
						sub: "improvement ideas",
						spark: suggByDay,
						chip: null,
					},
					{
						icon: <Table2 size={16} className="text-ink2" />,
						value: String(problems.length + suggestions.length),
						label: "Total content",
						sub: "problems + ideas",
						spark: [],
						chip: null,
					},
				].map((t, i) => (
					<div
						key={t.label}
						className="card card-hover p-4 vb-rise"
						style={{ animationDelay: `${i * 40}ms` }}
					>
						<div className="flex items-center justify-between">
							{t.icon}
							{t.chip}
						</div>
						<p className="font-display font-bold text-2xl mt-1.5">
							<span className="tabular-nums">{t.value}</span>
						</p>
						<p className="text-xs font-semibold">{t.label}</p>
						<div className="flex items-end justify-between gap-2">
							<p className="text-[10px] text-ink3 leading-tight">{t.sub}</p>
							{t.spark.length > 0 && (
								<AreaSpark data={t.spark} label={`${t.label}, last 14 days`} />
							)}
						</div>
					</div>
				))}
			</section>

			{/* ── Broadcast + triage ──────────────────────────────── */}
			<div data-unit="explain" style={{ order: orderOf("explain") }} onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("explain")} className="grid gap-3 lg:grid-cols-2 relative group">
				<LayoutGrip unit="explain" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
				<section
					aria-label="Broadcast announcement"
					data-testid="dash-broadcast"
					className="card p-4 vb-rise"
				>
					<h2 className="font-display font-semibold text-sm flex items-center gap-1.5 mb-3">
						<Megaphone size={14} className="text-accent" aria-hidden />
						Broadcast announcement
					</h2>
					<textarea
						value={annText}
						onChange={(e) => setAnnText(e.target.value.slice(0, 300))}
						maxLength={300}
						placeholder="e.g. Library hours extended to 18:00 during exam weeks 🎉"
						className="input min-h-16 text-sm"
						aria-label="Announcement text"
					/>
					<div className="flex items-center gap-2 mt-2">
						<div className="inline-flex rounded-lg bg-surface2 p-0.5 gap-0.5">
							{(["info", "success", "warning"] as const).map((k) => (
								<button
									key={k}
									type="button"
									onClick={() => setAnnKind(k)}
									aria-pressed={annKind === k}
									className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-all ${
										annKind === k
											? "bg-surface shadow-sm text-accent"
											: "text-ink3"
									}`}
								>
									{k}
								</button>
							))}
						</div>
						<button
							type="button"
							className="btn btn-primary !py-1.5 !px-3 !text-xs ml-auto"
							onClick={() => void publishAnnouncement()}
							disabled={annBusy || annText.trim().length === 0}
							aria-label="Publish announcement"
						>
							<Send size={12} aria-hidden /> Publish
						</button>
						{announce && (
							<button
								type="button"
								className="btn btn-ghost !py-1.5 !px-3 !text-xs"
								onClick={() => void clearAnnouncement()}
								disabled={annBusy}
								aria-label="Remove announcement"
							>
								Remove
							</button>
						)}
					</div>
					<p className="text-[10px] text-ink3 mt-2">
						{announce
							? `Live now (${announce.kind}): ${announce.text}`
							: "Shown as a banner to every visitor until removed."}
					</p>
				</section>

				<section
					aria-label="Needs triage"
					data-testid="dash-triage"
					className="card p-4 vb-rise"
					style={{ animationDelay: "60ms" }}
				>
					<h2 className="font-display font-semibold text-sm flex items-center gap-1.5 mb-3">
						<Zap size={14} className="text-warn" aria-hidden />
						Needs triage
						<span className="chip !text-[10px] ml-1">
							{triage.length} waiting
						</span>
					</h2>
					{triage.length === 0 ? (
						<p className="text-xs text-ink3 mt-3">
							Nothing waiting for triage.
						</p>
					) : (
						<div className="space-y-1.5">
							{triage.map(({ report, post }) => {
								const busyKey = (s: string) => `${s}:${post.id}`;
								return (
									<div
										key={String(report.id)}
										className="flex items-center gap-2 py-1.5 border-b border-border last:border-0"
									>
										<span className="text-sm font-medium truncate flex-1">
											{post.title}
										</span>
										<button
											type="button"
											className="btn btn-soft !py-1 !px-2 !text-[10px] shrink-0"
											onClick={() =>
												void triagePost(report.id, post.id, "verified")
											}
											disabled={triageBusy === busyKey("verified")}
											aria-label={`Verify post ${post.id}`}
										>
											<CheckCircle2 size={11} aria-hidden /> Verify
										</button>
										<button
											type="button"
											className="btn !py-1 !px-2 !text-[10px] !bg-warn/12 !text-warn hover:!bg-warn/20 shrink-0"
											onClick={() =>
												void triagePost(report.id, post.id, "in_progress")
											}
											disabled={triageBusy === busyKey("in_progress")}
											aria-label={`Start post ${post.id}`}
										>
											<Play size={11} aria-hidden /> Start
										</button>
									</div>
								);
							})}
						</div>
					)}
				</section>
			</div>

			{/* ── Activity + categories ───────────────────────────── */}
			<div data-unit="insight" style={{ order: orderOf("insight") }} onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("insight")} className="grid gap-3 lg:grid-cols-2 relative group">
				<LayoutGrip unit="insight" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
				<section
					aria-label="Activity, last 14 days"
					data-testid="dash-activity"
					className="card p-5"
				>
					<div className="flex items-center justify-between mb-4">
						<h2 className="font-display font-semibold text-sm">
							Activity — last 14 days
						</h2>
						<div className="flex gap-3 text-[10px] text-ink3">
							<span className="flex items-center gap-1">
								<span
									className="w-2 h-2 rounded-sm bg-accent"
									aria-hidden
								/>
								posts
							</span>
							<span className="flex items-center gap-1">
								<span
									className="w-2 h-2 rounded-sm bg-accent2 opacity-60"
									aria-hidden
								/>
								comments
							</span>
						</div>
					</div>
					<div
						className="flex items-end gap-1 h-36"
						role="img"
						aria-label="Activity timeline chart"
					>
						{last14.map((d, i) => {
							const pv = postsByDay[i] ?? 0;
							const cv = commentsByDay[i] ?? 0;
							return (
								<div
									key={d.toISOString()}
									className="flex-1 flex flex-col items-center justify-end gap-px group h-full"
								>
									<span className="text-[9px] font-mono text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">
										{pv + cv}
									</span>
									<div
										className="w-full rounded-t bg-accent2 opacity-60 vb-bar-anim"
										title={`${shortDay(d)}: ${cv} comments`}
										style={{
											height: `${(cv / maxActivity) * 100}%`,
											animationDelay: `${i * 30}ms`,
										}}
									/>
									<div
										className="w-full rounded-b-sm bg-accent vb-bar-anim group-hover:brightness-110"
										title={`${shortDay(d)}: ${pv} posts`}
										style={{
											height: `${pv > 0 ? ((pv / maxActivity) * 100).toFixed(4) : 2}%`,
											animationDelay: `${i * 30}ms`,
										}}
									/>
								</div>
							);
						})}
					</div>
					<div className="flex justify-between text-[9px] text-ink3 mt-1">
						<span>{shortDay(last14[0]!)}</span>
						<span>{shortDay(last14[13]!)}</span>
					</div>
				</section>

				<section
					aria-label="Active categories"
					data-testid="dash-categories"
					className="card p-5"
				>
					<h2 className="font-display font-semibold text-sm mb-4">
						Active categories
					</h2>
					{topCats.length === 0 ? (
						<p className="text-xs text-ink3 mt-3">No posts yet.</p>
					) : (
						<div className="space-y-2">
							{topCats.map(([cat, n], i) => (
								<div key={cat} className="flex items-center gap-2 text-xs">
									<span className="w-28 shrink-0 font-medium truncate">
										{CAT_EMOJI[cat] ?? "📌"} {cat}
									</span>
									<div
										className="flex-1 h-4 rounded bg-surface2 overflow-hidden"
										role="img"
										aria-label={`${cat}: ${n} posts`}
									>
										<div
											className="h-full rounded vb-bar-anim"
											style={{
												width: `${(n / maxCat) * 100}%`,
												animationDelay: `${i * 60}ms`,
												background:
													"linear-gradient(90deg,var(--vb-accent),var(--vb-accent2))",
											}}
										/>
									</div>
									<span className="font-mono w-6 text-right">
										{n}
									</span>
								</div>
							))}
							{catCounts.size > topCats.length && (
								<p className="text-[11px] text-ink3 mt-2">Top {topCats.length} of {catCounts.size} categories</p>
							)}
						</div>
											)}
				</section>
			</div>

			<div data-unit="queues" style={{ order: orderOf("queues") }} onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("queues")} className="flex flex-col gap-6 relative group">
				<LayoutGrip unit="queues" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
			{/* ── Submission heatmap + trending ─────────────────────── */}
			<div className="grid lg:grid-cols-2 gap-4">
				<section
					aria-label="Submission heatmap, last 4 weeks"
					data-testid="dash-rhythm"
					className="card p-5"
				>
					<h2 className="font-display font-semibold text-sm mb-4">
						Submission heatmap — last 4 weeks
					</h2>
					<div className="grid grid-cols-[auto_repeat(7,1fr)] gap-1.5 text-[9px] text-ink3">
						<span />
						{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
							<span key={d} className="text-center">
								{d}
							</span>
						))}
						{rhythm.map((week, wi) => (
							<div key={`w${wi}`} className="contents">
								<span className="self-center pr-1">W{wi + 1}</span>
								{week.map((n, di) => {
									const alpha =
										n === 0 ? 0 : 0.25 + (0.75 * n) / maxRhythm;
									return (
										<div
											key={di}
											className="aspect-square rounded-md vb-pop transition-transform hover:scale-110"
											title={
												n === 1 ? "1 submission" : `${n} submissions`
											}
											style={{
												animationDelay: `${(wi * 7 + di) * 20}ms`,
												background:
													n === 0
														? "var(--vb-surface2)"
														: alpha >= 1
															? "rgb(86,82,214)"
															: `rgba(86,82,214,${alpha.toFixed(2)})`,
											}}
										/>
									);
								})}
							</div>
						))}
					</div>
					<div className="flex items-center gap-1.5 mt-3 text-[9px] text-ink3">
						<span>less</span>
						{[0, 0.5, 0.74, 1].map((a, i) => (
							<span
								key={i}
								className="w-3 h-3 rounded"
								style={{
									background:
										a === 0
											? "var(--vb-surface2)"
											: a >= 1
												? "rgb(86,82,214)"
												: `rgba(86,82,214,${a})`,
								}}
								aria-hidden
							/>
						))}
						<span>more</span>
					</div>
				</section>

				<section
					aria-label={activeQueue.title}
					data-testid="dash-trending"
					className="card p-5"
				>
					<div className="flex items-center justify-between gap-2 mb-3">
						<h2 className="font-display font-semibold text-sm">
							{activeQueue.title}
						</h2>
					</div>
					<div
						role="group"
						aria-label="Queue filters"
						data-testid="dash-queues"
						className="flex flex-wrap items-center gap-1 border-b border-border pb-3 mb-1"
					>
				{(
					[
						{ key: "trending", label: "Trending", Icon: TrendingUp },
						{ key: "recent", label: "Recent", Icon: Clock },
						{ key: "open", label: "Open Issues", Icon: Info },
						{ key: "reports", label: "Reports", Icon: Flag },
						{ key: "suggestions", label: "Suggestions", Icon: Lightbulb },
						{ key: "polls", label: "Polls", Icon: BarChart3 },
					] as const
				).map(({ key, label, Icon }) => {
					const active = queue === key;
					const count = queueCounts[key];
					return (
						<button
							key={key}
							type="button"
							onClick={() => setQueue(key)}
							aria-pressed={active}
							aria-label={`${label} queue, ${count} item${count === 1 ? "" : "s"}`}
							className={`btn !text-xs !py-1.5 !px-3 rounded-lg flex items-center gap-1.5 ${active ? "btn-soft" : "btn-ghost"}`}
						>
							<Icon size={13} aria-hidden />
							{label}
							<span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-surface2 text-ink2">
								{count}
							</span>
						</button>
					);
				})}
					</div>
					{queueRows.length === 0 ? (
						<p className="text-xs text-ink3 mt-3">
							{activeQueue.empty}
						</p>
					) : (
						<div className="space-y-1">
							{queueRows.map(({ post, score }, i) => {
								const reactions = Object.values(post.reactions ?? {}).reduce(
									(a, b) => a + (typeof b === "number" ? b : 0),
									0,
								);
								const commentsN = post.comment_count ?? 0;
								return (
									<div
										key={post.id}
										className="flex items-center gap-3 text-sm py-2 border-b border-border last:border-0 group"
									>
										<span
											className={`font-display font-bold w-5 ${i === 0 ? "text-accent" : "text-ink3"}`}
										>
											{i + 1}
										</span>
										<div className="flex-1 min-w-0">
											<span className="font-medium truncate block group-hover:text-accent transition-colors">
												{post.title}
											</span>
											<div className="h-1 rounded-full bg-surface2 overflow-hidden mt-1">
												<div
													className="h-full rounded-full vb-bar-anim"
													style={{
														width: `${(score / queueMax) * 100}%`,
														animationDelay: `${i * 80}ms`,
														background:
															"linear-gradient(90deg,var(--vb-accent),var(--vb-accent2))",
													}}
												/>
											</div>
										</div>
										<span className="chip !text-[10px] shrink-0 hidden sm:inline-flex">
											{post.category}
										</span>
										<span className="text-xs text-ink3 font-mono shrink-0 hidden sm:inline">
											↑{reactions} 💬{commentsN}
										</span>
										<div className="flex gap-1 shrink-0">
											<button
												type="button"
												className="btn btn-soft !py-1 !px-2 !text-[10px]"
												title="Mark in progress"
												aria-label={`Start trending ${post.id}`}
												onClick={() => void setPostStatus(post.id, "in_progress")}
												disabled={triageBusy === `in_progress:${post.id}`}
											>
												<Play size={11} aria-hidden /> Start
											</button>
											<button
												type="button"
												className="btn !py-1 !px-2 !text-[10px] !bg-good/12 !text-good hover:!bg-good/20"
												title="Mark solved"
												aria-label={`Solve trending ${post.id}`}
												onClick={() => void setPostStatus(post.id, "solved")}
												disabled={triageBusy === `solved:${post.id}`}
											>
												<CheckCircle2 size={11} aria-hidden /> Solve
											</button>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</section>
			</div>

			{/* ── Jump row → the real queues ─────────────────────────── */}
			</div>
			<nav data-unit="jump" style={{ order: orderOf("jump") }} onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("jump")}
				aria-label="Admin queues"
				className="flex flex-wrap items-center gap-1.5 relative group"
			>
				<LayoutGrip unit="jump" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
				{JUMP_TABS.map(({ key, label, icon: Icon }) => (
					<button
						key={key}
						type="button"
						className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
						onClick={() => goto(key)}
					>
						<Icon size={13} /> {label}
					</button>
				))}
				<button
					type="button"
					className="btn btn-ghost !text-[11px] !py-1.5 !px-2.5 rounded-lg"
					onClick={() => setShowActionCenter((v) => !v)}
					aria-expanded={showActionCenter}
					aria-controls="dashboard-action-center"
				>
					Action Center
				</button>
			</nav>

			{/* ── Action Center — secondary panel, off by default ────── */}
			{showActionCenter && (
				<section
					id="dashboard-action-center"
					aria-label="Action Center"
					data-unit="action"
				style={{ order: orderOf("action") }}
				onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("action")}
				className="rounded-xl border border-border bg-surface p-4 relative group"
				>
				<LayoutGrip unit="action" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
					<ErrorBoundary>
						<ActionCenter />
					</ErrorBoundary>
				</section>
			)}

			{/* ── The six work sections ─────────────────────────────── */}
			<div data-unit="work" style={{ order: orderOf("work") }} onDragOver={(e) => e.preventDefault()}
				onDrop={() => dropUnitOn("work")} className="relative group">
				<LayoutGrip unit="work" onMove={moveUnit} onPickUp={(k) => { dragUnit.current = k; }} onDrop={dropUnitOn} />
			<ErrorBoundary>
				<WorkSections />
			</ErrorBoundary>
			</div>
		</div>
	);
}
