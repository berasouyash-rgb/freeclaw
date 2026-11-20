// ═══════════════════════════════════════════════════════════════════
// ADMIN ACTIVITY REPORT — what administrators actually did
// ═══════════════════════════════════════════════════════════════════
// Every row is a real audit entry from `activity_logs`. Nothing here is
// inferred: the summary is a count over the rows returned by the same
// request that fills the full view, so the two can never disagree.
//
// Two views over one dataset:
//   Summary — totals, breakdown per action, breakdown per operator.
//   Full    — the chronological rows, newest first, with exact timestamps.
// The period control is the "age" axis: today / 3 days / week / month.

import {
	ClipboardList,
	Download,
	Loader2,
	Printer,
	RefreshCw,
	Search,
	Users as UsersIcon,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { tablistKeyDown } from "../../lib/tablist";
import { downloadFile, fmtDate, timeAgo } from "../../lib/utils";

interface ActivityRow {
	id: string;
	actor: string;
	action: string;
	detail: string;
	created_at: string;
}

interface ReportResponse {
	logs?: ActivityRow[];
	period?: string;
	since?: string;
	to?: string | null;
	total?: number;
	returned?: number;
	truncated?: boolean;
	limit?: number;
	filters?: {
		actor: string | null;
		action: string | null;
		q: string | null;
		from: string | null;
		to: string | null;
	};
}

type Period = "today" | "3days" | "week" | "month";
type View = "summary" | "full";

const PERIODS: Array<{ key: Period; label: string; days: number }> = [
	{ key: "today", label: "Today", days: 1 },
	{ key: "3days", label: "3 days", days: 3 },
	{ key: "week", label: "This week", days: 7 },
	{ key: "month", label: "30 days", days: 30 },
];

/** Rows requested per period. The server clamps this to its own ceiling. */
const ROW_DEPTH = 500;

/**
 * Actions are stored as stable machine keys (`update_user`,
 * `revoke_all_sessions`). The report shows them as words, but never loses the
 * key: unknown actions fall back to a de-underscored title rather than being
 * dropped, so a new audit action appears without a code change here.
 */
export function humanizeAction(action: string): string {
	const key = String(action ?? "").trim();
	if (!key) return "Unlabelled action";
	const words = key.replace(/[_-]+/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Short operator label: audit actors are role names, not user ids. */
function actorLabel(actor: string): string {
	const value = String(actor ?? "").trim();
	return value || "unknown";
}

interface Tally {
	key: string;
	count: number;
}

/** Deterministic tallies — sorted by count, then key, so the report is stable. */
export function tally(rows: ActivityRow[], field: "action" | "actor"): Tally[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const key = String(row?.[field] ?? "").trim() || "unknown";
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export default function ActivityReport() {
	const { toast } = useApp();
	const [period, setPeriod] = useState<Period>("week");
	const [rows, setRows] = useState<ActivityRow[]>([]);
	const [view, setView] = useState<View>("summary");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [truncated, setTruncated] = useState(false);
	const [total, setTotal] = useState(0);
	const [actorFilter, setActorFilter] = useState("");
	const [actionFilter, setActionFilter] = useState("");
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [fromDate, setFromDate] = useState("");
	const [toDate, setToDate] = useState("");
	// Options accumulate across loads, so picking one filter never removes the
	// other choices from the dropdowns.
	const [actorOptions, setActorOptions] = useState<string[]>([]);
	const [actionOptions, setActionOptions] = useState<string[]>([]);

	// Typing should not fire one audited query per keystroke.
	useEffect(() => {
		const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
		return () => window.clearTimeout(t);
	}, [search]);

	const filters = useMemo(
		() => ({
			period,
			limit: ROW_DEPTH,
			...(actorFilter ? { actor: actorFilter } : {}),
			...(actionFilter ? { action: actionFilter } : {}),
			...(debouncedSearch ? { q: debouncedSearch } : {}),
			...(fromDate ? { from: new Date(`${fromDate}T00:00:00`).toISOString() } : {}),
			...(toDate ? { to: new Date(`${toDate}T23:59:59.999`).toISOString() } : {}),
		}),
		[period, actorFilter, actionFilter, debouncedSearch, fromDate, toDate],
	);

	const load = useCallback(
		async (extra?: Record<string, unknown>) => {
			setLoading(true);
			setError("");
			try {
				const res = await api.post<ReportResponse>("/api/admin", {
					action: "admin_accountability",
					...filters,
					...extra,
				});
				const nextRows = Array.isArray(res?.logs) ? res.logs : [];
				setRows(nextRows);
				setTruncated(Boolean(res?.truncated));
				setTotal(
					typeof res?.total === "number" ? res.total : nextRows.length,
				);
				setActorOptions((prev) =>
					[...new Set([...prev, ...nextRows.map((r) => r.actor).filter(Boolean)])].sort(),
				);
				setActionOptions((prev) =>
					[...new Set([...prev, ...nextRows.map((r) => r.action).filter(Boolean)])].sort(),
				);
			} catch (err: unknown) {
				setRows([]);
				setTruncated(false);
				setTotal(0);
				setError(
					err instanceof Error
						? err.message
						: "Could not load the activity log. Retry when the connection is back.",
				);
			} finally {
				setLoading(false);
			}
		},
		[filters],
	);

	useEffect(() => {
		void load();
	}, [load]);

	const byAction = useMemo(() => tally(rows, "action"), [rows]);
	const byActor = useMemo(() => tally(rows, "actor"), [rows]);
	const returned = rows.length;
	const hasFilters = Boolean(
		actorFilter || actionFilter || debouncedSearch || fromDate || toDate,
	);
	const periodLabel = hasFilters
		? "the selected range"
		: PERIODS.find((p) => p.key === period)?.label.toLowerCase() ?? period;

	const auditExport = (kind: "csv" | "print") => {
		// Fire-and-forget: a failed audit write must not block the download.
		void api
			.post("/api/admin", {
				action: "log_report_export",
				report: "activity_log",
				kind,
				rows: returned,
				filters,
			})
			.catch(() => {});
	};

	const exportCsv = () => {
		if (rows.length === 0) {
			toast("Nothing to export in this period", "err");
			return;
		}
		const header = "created_at,actor,action,detail\n";
		const body = rows
			.map((r) =>
				[r.created_at, r.actor, r.action, r.detail]
					.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
					.join(","),
			)
			.join("\n");
		downloadFile(
			`admin-activity-${period}-${new Date().toISOString().slice(0, 10)}.csv`,
			header + body,
			"text/csv;charset=utf-8",
		);
		auditExport("csv");
		toast(`Exported ${returned} action${returned === 1 ? "" : "s"}`, "ok");
	};

	const printReport = () => {
		if (rows.length === 0) {
			toast("Nothing to print in this range", "err");
			return;
		}
		auditExport("print");
		window.print();
	};

	const clearFilters = () => {
		setActorFilter("");
		setActionFilter("");
		setSearch("");
		setFromDate("");
		setToDate("");
	};

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-3" data-print-hide>
				<div>
					<h1 className="font-display font-bold text-xl text-ink flex items-center gap-2">
						<ClipboardList size={18} className="text-accent" /> Activity report
					</h1>
					<p className="text-xs text-ink3 mt-1">
						What administrators did, newest first. Counts below are computed
						from these exact audit rows — not a separate estimate.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="chip cursor-pointer"
						onClick={printReport}
						disabled={loading || rows.length === 0}
						title="Print or save as PDF — the browser dialog offers both"
					>
						<Printer size={13} /> Print / PDF
					</button>
					<button
						type="button"
						className="chip cursor-pointer"
						onClick={exportCsv}
						disabled={loading || rows.length === 0}
					>
						<Download size={13} /> CSV
					</button>
					<button
						type="button"
						className="chip cursor-pointer"
						onClick={() => void load()}
						disabled={loading}
					>
						<RefreshCw
							size={13}
							className={loading ? "animate-spin" : undefined}
						/>{" "}
						Refresh
					</button>
				</div>
			</div>

			{/* Controls */}
			<div
				className="flex flex-wrap items-center justify-between gap-3"
				data-print-hide
			>
				<div className="flex gap-1" role="tablist" aria-label="Report period" onKeyDown={tablistKeyDown}>
					{PERIODS.map((p) => (
						<button
							key={p.key}
							type="button"
							role="tab"
							aria-selected={period === p.key}
							className={`chip cursor-pointer transition-all ${
								period === p.key
									? "border-accent bg-accent/15 text-accent font-semibold"
									: "hover:border-accent/40"
							}`}
							onClick={() => setPeriod(p.key)}
						>
							{p.label}
						</button>
					))}
				</div>
				<div className="flex gap-1" role="tablist" aria-label="Report view" onKeyDown={tablistKeyDown}>
					{(["summary", "full"] as View[]).map((v) => (
						<button
							key={v}
							type="button"
							role="tab"
							aria-selected={view === v}
							className={`chip cursor-pointer transition-all ${
								view === v
									? "border-accent bg-accent/15 text-accent font-semibold"
									: "hover:border-accent/40"
							}`}
							onClick={() => setView(v)}
						>
							{v === "summary" ? "Summary" : "Full log"}
						</button>
					))}
				</div>
			</div>

			{/* Filters — applied server-side so the view, counts and export agree */}
			<div
				className="card p-3 flex flex-wrap items-end gap-2.5"
				data-print-hide
			>
				<label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-ink3">
					Search
					<span className="relative block">
						<Search
							size={13}
							className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3"
						/>
						<input
							className="input !pl-8 !py-2 !text-xs w-56"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Detail, action or actor…"
							aria-label="Search audit log"
						/>
					</span>
				</label>
				<label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-ink3">
					Operator
					<select
						className="input !py-2 !text-xs"
						value={actorFilter}
						onChange={(e) => setActorFilter(e.target.value)}
						aria-label="Filter by operator"
					>
						<option value="">All operators</option>
						{actorOptions.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-ink3">
					Action
					<select
						className="input !py-2 !text-xs"
						value={actionFilter}
						onChange={(e) => setActionFilter(e.target.value)}
						aria-label="Filter by action"
					>
						<option value="">All actions</option>
						{actionOptions.map((a) => (
							<option key={a} value={a}>
								{humanizeAction(a)}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-ink3">
					From
					<input
						type="date"
						className="input !py-2 !text-xs"
						value={fromDate}
						onChange={(e) => setFromDate(e.target.value)}
						aria-label="Audit start date"
					/>
				</label>
				<label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-ink3">
					To
					<input
						type="date"
						className="input !py-2 !text-xs"
						value={toDate}
						onChange={(e) => setToDate(e.target.value)}
						aria-label="Audit end date"
					/>
				</label>
				{hasFilters && (
					<button
						type="button"
						className="chip cursor-pointer self-end"
						onClick={clearFilters}
					>
						<X size={13} /> Clear
					</button>
				)}
			</div>

			{/* Error */}
			{error && (
				<div className="card p-5 border-bad/30 bg-bad/5" role="alert">
					<p className="text-sm text-ink2">{error}</p>
					<button
						type="button"
						className="chip mt-3 cursor-pointer"
						onClick={() => void load()}
					>
						<RefreshCw size={13} /> Retry
					</button>
				</div>
			)}

			{/* Loading */}
			{loading && !error && (
				<div className="card p-10 grid place-items-center text-ink3">
					<Loader2 className="animate-spin" size={20} />
					<p className="text-xs mt-2">Loading activity…</p>
				</div>
			)}

			{/* Empty */}
			{!loading && !error && rows.length === 0 && (
				<div className="card p-8 text-center">
					<p className="text-sm text-ink2">
						No administrative actions recorded in the last {periodLabel}.
					</p>
					<p className="text-xs text-ink3 mt-1">
						Audit rows appear the moment an action is taken.
					</p>
				</div>
			)}

			{!loading && !error && rows.length > 0 && view === "summary" && (
				<>
					{/* KPI row */}
					<div className="grid gap-3 sm:grid-cols-3">
						<div className="card p-4">
							<p className="text-[10px] uppercase tracking-wide text-ink3">
								Actions recorded
							</p>
							<p className="font-display font-bold text-2xl text-ink mt-1">
								{total}
							</p>
							<p className="text-[11px] text-ink3 mt-0.5">
								in {periodLabel}
								{truncated ? ` — first ${returned} loaded` : ""}
							</p>
						</div>
						<div className="card p-4">
							<p className="text-[10px] uppercase tracking-wide text-ink3">
								Operators
							</p>
							<p className="font-display font-bold text-2xl text-ink mt-1 flex items-center gap-1.5">
								<UsersIcon size={16} className="text-accent" /> {byActor.length}
							</p>
							<p className="text-[11px] text-ink3 mt-0.5">
								distinct audit actors
							</p>
						</div>
						<div className="card p-4">
							<p className="text-[10px] uppercase tracking-wide text-ink3">
								Most frequent
							</p>
							<p className="font-semibold text-sm text-ink mt-1.5 truncate">
								{byAction[0] ? humanizeAction(byAction[0].key) : "—"}
							</p>
							<p className="text-[11px] text-ink3 mt-0.5">
								{byAction[0]
									? `${byAction[0].count}× (${Math.round((byAction[0].count / returned) * 100)}% of loaded actions)`
									: "no actions"}
							</p>
						</div>
					</div>

					{/* By action */}
					<div className="card p-4">
						<h2 className="text-xs font-semibold text-ink mb-3">
							Breakdown by action
						</h2>
						<ul className="space-y-2">
							{byAction.map(({ key, count }) => {
								const pct = Math.round((count / returned) * 100);
								return (
									<li key={key}>
										<div className="flex items-center justify-between text-xs">
											<span className="text-ink2 truncate pr-2">
												{humanizeAction(key)}
												<span className="text-ink3 ml-1.5 font-mono text-[10px]">
													{key}
												</span>
											</span>
											<span className="text-ink font-semibold tabular-nums">
												{count}
												<span className="text-ink3 font-normal ml-1">
													({pct}%)
												</span>
											</span>
										</div>
										<div className="h-1.5 rounded-full bg-surface2 mt-1 overflow-hidden">
											<div
												className="h-full bg-accent rounded-full transition-[width] duration-500"
												style={{ width: `${Math.max(pct, 2)}%` }}
											/>
										</div>
									</li>
								);
							})}
						</ul>
					</div>

					{/* By actor */}
					<div className="card p-4">
						<h2 className="text-xs font-semibold text-ink mb-3">
							Breakdown by operator
						</h2>
						<ul className="divide-y divide-border">
							{byActor.map(({ key, count }) => (
								<li
									key={key}
									className="flex items-center justify-between py-2 text-xs"
								>
									<span className="text-ink2 font-mono text-[11px] truncate pr-2">
										{actorLabel(key)}
									</span>
									<span className="text-ink font-semibold tabular-nums">
										{count}
									</span>
								</li>
							))}
						</ul>
					</div>
				</>
			)}

			{!loading && !error && rows.length > 0 && view === "full" && (
				<div className="card divide-y divide-border">
					{rows.map((row) => (
						<article key={row.id} className="p-3 flex gap-3">
							<div className="text-[10px] text-ink3 w-16 shrink-0 pt-0.5">
								{timeAgo(row.created_at)}
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="chip !text-[10px]">
										{actorLabel(row.actor)}
									</span>
									<span className="text-xs font-semibold text-ink">
										{humanizeAction(row.action)}
									</span>
									<span className="text-[10px] text-ink3 font-mono">
										{row.action}
									</span>
								</div>
								{row.detail && (
									<p className="text-xs text-ink2 mt-1 break-words">
										{row.detail}
									</p>
								)}
								<p className="text-[10px] text-ink3 mt-1">
									{fmtDate(row.created_at)}
								</p>
							</div>
						</article>
					))}
				</div>
			)}

			{/* Honest coverage note */}
			{!loading && !error && rows.length > 0 && (
				<p className="text-[11px] text-ink3 text-center">
					{truncated
						? `Showing the ${returned} most recent of ${total} matching action${total === 1 ? "" : "s"} in ${periodLabel} — the breakdown above counts only the loaded rows.`
						: `${total} matching action${total === 1 ? "" : "s"} in ${periodLabel}.`}
				</p>
			)}
		</div>
	);
}
