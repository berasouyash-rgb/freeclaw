// ═══════════════════════════════════════════════════════════════════
// WORK SECTIONS — one shared six-section work list
// ═══════════════════════════════════════════════════════════════════
// URGENT · TODAY · IN PROGRESS · WAITING · RECENTLY COMPLETED · FAILED
//
// Every row is normalized to the SAME shape, so the admin always reads
// the same nine facts no matter which queue produced the item:
//   Title · Reason · Source · Status · Started · Last update
//   Action · Verification · View evidence
//
// Nothing here simulates work. Items come only from existing endpoints:
//   • /api/action-center?action=summary  → open + resolved work tasks
//   • /api/reports                        → open user reports
//   • /api/errors                         → real frontend error rows
// Known gap, stated rather than hidden: ActionCenterTask carries no
// `updated_at`, so "Last update" falls back to created_at while a task
// is still open, and to resolved_at once it closes.
// Sections render collapsed (glass card + live count in the header); one
// tap on a header expands its individuals. Nothing fetches on expand —
// the rows are already loaded.
// ═══════════════════════════════════════════════════════════════════

import {
	AlertTriangle,
	ArrowUpRight,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	FileText,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/utils";
import type {
	ActionCenterSummary,
	ActionCenterTask,
} from "./ActionCenter";

export interface WorkReport {
	id: number;
	target_type: string;
	target_id: string;
	reason: string;
	status?: string;
	author_id?: string;
	target_author_id?: string | null;
	created_at: string;
}

export interface WorkErrorRow {
	id: string;
	message: string;
	source: string;
	count: number;
	first: string;
	last: string;
}

export type WorkTone = "urgent" | "open" | "progress" | "wait" | "done" | "error";

/** One normalized work item. Every section renders this and only this. */
export interface WorkItem {
	key: string;
	tone: WorkTone;
	title: string;
	reason: string;
	source: string;
	status: string;
	startedAt: string;
	updatedAt: string;
	actionLabel: string;
	actionTab: string;
	verification: string;
	evidence: Array<[string, string]>;
}

export interface WorkBuckets {
	urgent: WorkItem[];
	today: WorkItem[];
	inProgress: WorkItem[];
	waiting: WorkItem[];
	done: WorkItem[];
	failed: WorkItem[];
}

export const EMPTY_BUCKETS: WorkBuckets = {
	urgent: [],
	today: [],
	inProgress: [],
	waiting: [],
	done: [],
	failed: [],
};

function openAdminTab(tab: string) {
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: tab }));
	}
}

function isOpenTask(t: ActionCenterTask): boolean {
	return !t.resolved_at && !/^(RESOLVED|DISMISSED|CLOSED)$/i.test(t.status || "");
}

function isToday(iso: string): boolean {
	try {
		const d = new Date(iso);
		const now = new Date();
		return (
			d.getFullYear() === now.getFullYear() &&
			d.getMonth() === now.getMonth() &&
			d.getDate() === now.getDate()
		);
	} catch {
		return false;
	}
}

function readable(value: string | null | undefined, fallback = "not recorded") {
	return value && String(value).trim() ? String(value) : fallback;
}

function humanStatus(status: string | undefined) {
	return readable(status, "open").replaceAll("_", " ").toLowerCase();
}

const TERMINAL = /^(RESOLVED|DISMISSED|CLOSED)$/i;

/** Which real queue holds the working material for a work task. */
function taskQueue(task: ActionCenterTask): string {
	const category = (task.category || "").toUpperCase();
	if (category.includes("MODERATION")) return "reports";
	if (category.includes("RECOVERY") || category.includes("PERFORMANCE") || category.includes("DATA"))
		return "errors";
	return "logs";
}

function taskItem(task: ActionCenterTask): WorkItem {
	const open = isOpenTask(task);
	const updatedAt = task.resolved_at || task.created_at;
	const stale = updatedAt === task.created_at;
	return {
		key: `t-${task.id}`,
		tone: open ? "open" : "done",
		title: readable(task.title, "Untitled work task"),
		reason: open
			? `Work · ${readable(task.category, "uncategorised")} · ${humanStatus(task.status)} — needs a human decision.`
			: `Work · ${readable(task.category, "uncategorised")} · ${humanStatus(task.status)} — no longer waiting.`,
		source: "Action Center",
		status: readable(task.status, "OPEN"),
		startedAt: task.created_at,
		updatedAt,
		actionLabel: "Open",
		actionTab: taskQueue(task),
		verification: open
			? stale
				? "Awaiting admin action — no newer update has been recorded."
				: "Awaiting admin action."
			: readable(task.resolution, "Outcome recorded."),
		evidence: [
			["Task id", readable(task.id)],
			["Category", readable(task.category)],
			["Status", readable(task.status, "OPEN")],
			["Opened", readable(task.created_at)],
			["Resolved", readable(task.resolved_at, "not resolved")],
			["Resolution", readable(task.resolution, "not recorded")],
		],
	};
}

function reportItem(report: WorkReport): WorkItem {
	const reporter = report.author_id ? `${report.author_id.slice(0, 12)}` : "unknown";
	const author = report.target_author_id
		? ` · author ${report.target_author_id.slice(0, 12)}`
		: "";
	const open = !TERMINAL.test(String(report.status || "pending"));
	// The verdict and the target are split across two elements on purpose:
	// repeating either one in both lines would make the row read twice.
	return {
		key: `r-${report.id}`,
		tone: "urgent",
		title: `Report: ${readable(report.reason, report.target_type)}`,
		reason: `Reported on ${readable(report.target_type, "item")} ${readable(report.target_id, "unknown")} · reported by ${reporter}${author}`,
		source: "Reports queue",
		status: readable(report.status, "pending"),
		startedAt: report.created_at,
		updatedAt: report.created_at,
		actionLabel: "Review",
		actionTab: "reports",
		verification: open ? "Awaiting a decision — no moderator verdict recorded." : "Decision recorded.",
		evidence: [
			["Report id", String(report.id)],
			["Target", `${readable(report.target_type, "item")} ${readable(report.target_id, "")}`.trim()],
			["Reason", readable(report.reason, report.target_type)],
			["Status", readable(report.status, "pending")],
			["Reported by", reporter],
			["Target author", readable(report.target_author_id, "unknown")],
			["Filed", readable(report.created_at)],
		],
	};
}

function errorItem(row: WorkErrorRow): WorkItem {
	return {
		key: `e-${row.id}`,
		tone: "error",
		title: readable(row.message, "Unknown error"),
		reason: "Unresolved frontend error — this row is still on the error queue.",
		source: `Frontend errors · ${row.count} reports`,
		status: "unresolved",
		startedAt: row.first,
		updatedAt: row.last,
		actionLabel: "Inspect",
		actionTab: "errors",
		verification: "Unresolved — fix the cause and watch the report count fall.",
		evidence: [
			["Error id", readable(row.id)],
			["Message", readable(row.message, "Unknown error")],
			["Source", readable(row.source, "unknown")],
			["Reports", String(row.count)],
			["First seen", readable(row.first)],
			["Last seen", readable(row.last)],
		],
	};
}

/**
 * Bucket work into the six sections. No item ever appears twice:
 * urgent is surfaced once at the top, today holds the rest of what is
 * new, in-progress holds work that is being worked, waiting holds the
 * remainder that still needs a decision.
 */
export function buildBuckets(
	summary: ActionCenterSummary | null,
	reports: WorkReport[],
	errors: WorkErrorRow[],
): WorkBuckets {
	const all = summary?.recent ?? [];
	const openRaw = all.filter(isOpenTask);
	const doneRaw = all.filter((t) => !isOpenTask(t));
	const openTasks = openRaw.map(taskItem);
	const doneTasks = doneRaw.map(taskItem);

	// Reports are urgent by nature: a user asked for help and nobody answered.
	const openReports = reports.filter((r) => !TERMINAL.test(String(r.status || "pending")));

	const urgentKeys = new Set(
		openRaw
			.filter((t) => (t.category || "").toUpperCase() === "CRITICAL_MODERATION")
			.map((t) => `t-${t.id}`),
	);
	const urgent = openTasks.filter((t) => urgentKeys.has(t.key));

	const inProgressRaw = openRaw.filter((t) => /progress|in[_ ]?review/i.test(t.status || ""));
	const inProgressKeys = new Set(inProgressRaw.map((t) => `t-${t.id}`));
	const inProgress = openTasks.filter((t) => inProgressKeys.has(t.key));

	const todayRaw = openRaw.filter(
		(t) =>
			!urgentKeys.has(`t-${t.id}`) &&
			!inProgressKeys.has(`t-${t.id}`) &&
			isToday(t.created_at),
	);
	const todayKeys = new Set(todayRaw.map((t) => `t-${t.id}`));
	const today = [
		...openTasks.filter((t) => todayKeys.has(t.key)),
		...openReports.filter((r) => isToday(r.created_at)).map(reportItem),
	];
	const todayKeysAll = new Set(today.map((t) => t.key));

	const waiting = [
		...openTasks.filter(
			(t) =>
				!urgentKeys.has(t.key) &&
				!inProgressKeys.has(t.key) &&
				!todayKeysAll.has(t.key),
		),
		...openReports.filter((r) => !isToday(r.created_at)).map(reportItem),
	];

	return {
		urgent,
		today,
		inProgress,
		waiting,
		done: doneTasks,
		failed: errors.map(errorItem),
	};
}

const TONE_STYLE: Record<WorkTone, { chip: string; icon: string }> = {
	urgent: { chip: "text-bad border-bad/40 bg-bad/10", icon: "text-bad" },
	open: { chip: "text-warn border-warn/40 bg-warn/10", icon: "text-warn" },
	progress: { chip: "text-accent border-accent/40 bg-accent/10", icon: "text-accent" },
	wait: { chip: "text-ink3 border-border bg-surface2", icon: "text-ink3" },
	done: { chip: "text-good border-good/40 bg-good/10", icon: "text-good" },
	error: { chip: "text-bad border-bad/40 bg-bad/10", icon: "text-bad" },
};

// Indexed, never built, during render: a function that *returns* a
// component is indistinguishable from creating one on every pass, which
// remounts the icon and drops its state. A lookup of stable references
// declared at module scope does not.
const TONE_ICON = {
	urgent: AlertTriangle,
	done: CheckCircle2,
	open: FileText,
	progress: Clock,
	wait: FileText,
	error: XCircle,
} as const satisfies Record<WorkTone, unknown>;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink3">
				{label}
			</dt>
			<dd className="text-xs text-ink2 mt-0.5 break-words">{children}</dd>
		</div>
	);
}

function WorkRow({ item }: { item: WorkItem }) {
	const [open, setOpen] = useState(false);
	const Icon = TONE_ICON[item.tone];
	const style = TONE_STYLE[item.tone];
	return (
		<article className="p-3.5" data-testid="work-item">
			<div className="flex items-start gap-2.5">
				<Icon size={15} className={`${style.icon} shrink-0 mt-0.5`} aria-hidden />
				<div className="min-w-0 flex-1">
					<h3 className="text-sm font-semibold text-ink">{item.title}</h3>
					<p className="text-xs text-ink3 mt-0.5">{item.reason}</p>
				</div>
				<span
					className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.chip}`}
				>
					{item.tone === "done" ? "Done" : item.tone}
				</span>
			</div>

			<dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
				<Fact label="Source">{item.source}</Fact>
				<Fact label="Status">{item.status}</Fact>
				<Fact label="Started">{timeAgo(item.startedAt)}</Fact>
				<Fact label="Last update">{timeAgo(item.updatedAt)}</Fact>
				<Fact label="Verification">{item.verification}</Fact>
			</dl>

			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<button
					type="button"
					className="btn btn-soft !text-[11px] !py-1 !px-2.5"
					onClick={() => openAdminTab(item.actionTab)}
				>
					{item.actionLabel} <ArrowUpRight size={12} aria-hidden />
				</button>
				<button
					type="button"
					className="btn btn-ghost !text-[11px] !py-1 !px-2"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
				>
					{open ? (
						<ChevronDown size={12} aria-hidden />
					) : (
						<ChevronRight size={12} aria-hidden />
					)}
					View evidence
				</button>
			</div>

			{open ? (
				<dl
					data-testid="work-evidence"
					className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-[var(--vb-border)] bg-surface2 p-2.5 sm:grid-cols-2"
				>
					{item.evidence.map(([label, value]) => (
						<div key={label} className="min-w-0">
							<dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink3">
								{label}
							</dt>
							<dd className="text-xs text-ink2 mt-0.5 break-words font-mono">{value}</dd>
						</div>
					))}
				</dl>
			) : null}
		</article>
	);
}

function Section({
	id,
	title,
	items,
	empty,
}: {
	id: string;
	title: string;
	items: WorkItem[];
	empty: string;
}) {
	// Collapsed by default: a busy queue holds dozens of rows and the
	// dashboard must stay scannable. The header always shows the live
	// count; one tap reveals the individuals. State lives per section so
	// expanding Waiting never disturbs an open Urgent row.
	const [open, setOpen] = useState(false);
	return (
		<section
			aria-labelledby={id}
			data-testid={`work-section-${id}`}
			className="glass-card rounded-xl overflow-hidden"
		>
			<h2
				id={id}
				className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-ink"
			>
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
					aria-controls={`${id}-body`}
					className="w-full flex items-center gap-2 px-4 py-3 text-left"
				>
					{open ? (
						<ChevronDown size={13} aria-hidden className="shrink-0 text-ink3" />
					) : (
						<ChevronRight size={13} aria-hidden className="shrink-0 text-ink3" />
					)}
					<span className="flex-1">{title}</span>
					<span className="chip !text-[10px]">{items.length}</span>
				</button>
			</h2>
			{open && (
				<div id={`${id}-body`} className="px-4 pb-4">
					{items.length === 0 ? (
						<p className="text-xs text-ink3">{empty}</p>
					) : (
						<div className="card divide-y divide-[var(--vb-border)]">
							{items.map((item) => (
								<WorkRow key={item.key} item={item} />
							))}
						</div>
					)}
				</div>
			)}
		</section>
	);
}

/**
 * The shared six-section work list. Fetches its own data so any admin
 * surface can drop it in without owning the fetch lifecycle.
 */
export default function WorkSections({
	showLoadError = true,
	compact = false,
}: {
	/** Render the partial-source failure banner. */
	showLoadError?: boolean;
	/** Tighten vertical rhythm when embedded in a dashboard. */
	compact?: boolean;
}) {
	const [summary, setSummary] = useState<ActionCenterSummary | null>(null);
	const [reports, setReports] = useState<WorkReport[]>([]);
	const [errors, setErrors] = useState<WorkErrorRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const [s, r, e] = await Promise.allSettled([
			api.get<ActionCenterSummary>("/api/action-center?action=summary"),
			api.get<WorkReport[]>("/api/reports"),
			api.get<{ errors?: WorkErrorRow[] }>("/api/errors"),
		]);
		if (s.status === "fulfilled") setSummary(s.value);
		if (r.status === "fulfilled" && Array.isArray(r.value)) setReports(r.value);
		if (e.status === "fulfilled" && Array.isArray(e.value.errors))
			setErrors(e.value.errors.slice(0, 5));
		const failed: string[] = [];
		if (s.status !== "fulfilled") failed.push("action-center");
		if (r.status !== "fulfilled") failed.push("reports");
		if (e.status !== "fulfilled") failed.push("errors");
		setLoadError(
			failed.length
				? `Some sources failed: ${failed.join(", ")} — showing the data that did load.`
				: null,
		);
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const buckets = useMemo(
		() => buildBuckets(summary, reports, errors),
		[summary, reports, errors],
	);

	if (loading) {
		return (
			<div className="space-y-3" aria-busy="true" aria-label="Loading work sections">
				<div className="skeleton h-24" />
				<div className="skeleton h-40" />
			</div>
		);
	}

	return (
		<div className={compact ? "space-y-4" : "space-y-6"} data-testid="work-sections">
			{showLoadError && loadError ? (
				<p role="alert" className="text-xs text-warn">
					{loadError}
				</p>
			) : null}

			<Section
				id="work-urgent"
				title="Urgent"
				items={buckets.urgent}
				empty="Nothing urgent — no critical work is waiting."
			/>
			<Section
				id="work-today"
				title="Today"
				items={buckets.today}
				empty="Nothing new today."
			/>
			<Section
				id="work-progress"
				title="In progress"
				items={buckets.inProgress}
				empty="Nothing in progress."
			/>
			<Section
				id="work-waiting"
				title="Waiting"
				items={buckets.waiting}
				empty="Nothing waiting for a decision."
			/>
			<Section
				id="work-done"
				title="Recently completed"
				items={buckets.done}
				empty="No verified outcomes yet."
			/>
			<Section
				id="work-failed"
				title="Failed"
				items={buckets.failed}
				empty="No recent errors."
			/>
		</div>
	);
}
