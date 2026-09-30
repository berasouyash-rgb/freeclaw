// ═══════════════════════════════════════════════════════════════════
// complianceCSV — presentation-quality CSV export for compliance
// ═══════════════════════════════════════════════════════════════════
// Generates a well-organized CSV with:
//   • Summary header (status counts, category breakdown, date range)
//   • Human-readable column names
//   • Properly formatted dates
//   • Flattened reactions (no JSON blobs)
//   • Date range filtering
//   • Clean layout for Excel / Google Sheets / presentation
// ═══════════════════════════════════════════════════════════════════

import type { PostData } from "../types";
import { STATUS_META } from "./utils";

// ── Date range presets ──────────────────────────────────────────

export type DateRangePreset =
	| "all"
	| "today"
	| "this_week"
	| "this_month"
	| "last_30_days"
	| "last_90_days"
	| "custom";

export interface DateRange {
	preset: DateRangePreset;
	start?: Date; // used when preset === "custom"
	end?: Date;
}

const MS_PER_DAY = 86_400_000;

export function getDateRange(preset: DateRangePreset): { from: Date; to: Date } {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	switch (preset) {
		case "today":
			return { from: today, to: new Date(today.getTime() + MS_PER_DAY) };
		case "this_week": {
			const day = today.getDay(); // 0=Sun
			const monday = new Date(today.getTime() - ((day + 6) % 7) * MS_PER_DAY);
			return { from: monday, to: new Date(monday.getTime() + 7 * MS_PER_DAY) };
		}
		case "this_month": {
			const first = new Date(now.getFullYear(), now.getMonth(), 1);
			const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
			return { from: first, to: next };
		}
		case "last_30_days":
			return { from: new Date(now.getTime() - 30 * MS_PER_DAY), to: new Date(now.getTime() + MS_PER_DAY) };
		case "last_90_days":
			return { from: new Date(now.getTime() - 90 * MS_PER_DAY), to: new Date(now.getTime() + MS_PER_DAY) };
		case "all":
		default:
			return { from: new Date(0), to: new Date(now.getTime() + MS_PER_DAY) };
	}
}

export function filterByDateRange(posts: PostData[], range: DateRange): PostData[] {
	if (range.preset === "custom" && range.start && range.end) {
		const from = range.start.getTime();
		const to = range.end.getTime();
		return posts.filter((p) => {
			const t = new Date(p.created_at).getTime();
			return t >= from && t < to;
		});
	}
	const { from, to } = getDateRange(range.preset);
	const fromMs = from.getTime();
	const toMs = to.getTime();
	return posts.filter((p) => {
		const t = new Date(p.created_at).getTime();
		return t >= fromMs && t < toMs;
	});
}

// ── CSV helpers ─────────────────────────────────────────────────

/** Escape a cell value for CSV (formula-injection safe). */
function cell(v: unknown): string {
	let s = String(v ?? "").replace(/"/g, '""');
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return `"${s}"`;
}

/** Format a date as YYYY-MM-DD HH:MM for clean presentation. */
function fmtDate(d: string): string {
	const dt = new Date(d);
	if (Number.isNaN(dt.getTime())) return "";
	return (
		dt.getFullYear() +
		"-" +
		String(dt.getMonth() + 1).padStart(2, "0") +
		"-" +
		String(dt.getDate()).padStart(2, "0") +
		" " +
		String(dt.getHours()).padStart(2, "0") +
		":" +
		String(dt.getMinutes()).padStart(2, "0")
	);
}

// ── Column definitions ──────────────────────────────────────────

interface Column {
	key: string;
	label: string;
	extract: (p: PostData) => string | number;
}

const COLUMNS: Column[] = [
	{ key: "title", label: "Title", extract: (p) => p.title || "" },
	{ key: "category", label: "Category", extract: (p) => p.category || "" },
	{ key: "status", label: "Status", extract: (p) => STATUS_META[p.status]?.label || p.status },
	{ key: "priority", label: "Priority", extract: (p) => (p.priority || "").charAt(0).toUpperCase() + (p.priority || "").slice(1) },
	{ key: "type", label: "Type", extract: (p) => (p.type || "").charAt(0).toUpperCase() + (p.type || "").slice(1) },
	{ key: "description", label: "Description", extract: (p) => p.description || "" },
	{ key: "author_id", label: "Author ID", extract: (p) => p.author_id || "" },
	{ key: "created_at", label: "Created", extract: (p) => fmtDate(p.created_at) },
	{ key: "updated_at", label: "Updated", extract: (p) => (p.updated_at ? fmtDate(p.updated_at) : "") },
	{ key: "support", label: "Supports", extract: (p) => p.reactions?.support ?? 0 },
	{ key: "heart", label: "Hearts", extract: (p) => p.reactions?.heart ?? 0 },
	{ key: "comments", label: "Comments", extract: (p) => p.comment_count ?? 0 },
	{ key: "status_label", label: "Status Note", extract: (p) => p.status_note || "" },
	{ key: "assigned_to", label: "Assigned To", extract: (p) => p.assigned_to || "" },
	{ key: "eta", label: "ETA", extract: (p) => p.eta || "" },
	{ key: "admin_reply", label: "Admin Reply", extract: (p) => p.admin_reply || "" },
	{ key: "pinned", label: "Pinned", extract: (p) => (p.pinned ? "Yes" : "No") },
	{ key: "official", label: "Official", extract: (p) => (p.official ? "Yes" : "No") },
	{ key: "hidden", label: "Hidden", extract: (p) => (p.hidden ? "Yes" : "No") },
	{ key: "tags", label: "Tags", extract: (p) => (p.tags || []).join(", ") },
	{ key: "id", label: "Post ID", extract: (p) => p.id || "" },
];

export function buildComplianceCSV(
	posts: PostData[],
	range: DateRange,
	type: "problem" | "suggestion",
): string {
	const filtered = filterByDateRange(posts, range);
	const lines: string[] = [];
	lines.push(COLUMNS.map((c) => cell(c.label)).join(","));
	for (const p of filtered) {
		lines.push(COLUMNS.map((c) => cell(c.extract({ ...p, type }))).join(","));
	}
	return "\uFEFF" + lines.join("\r\n");
}

// ═══════════════════════════════════════════════════════════════════
// Reports CSV — presentation-quality export for compliance reports
// ═══════════════════════════════════════════════════════════════════

interface ReportRow {
	id: string | number;
	target_type?: string;
	target_id?: string;
	reason?: string;
	details?: string;
	status?: string;
	author_id?: string;
	target_author_id?: string;
	category?: string;
	created_at: string;
	[k: string]: unknown;
}

const REPORT_COLUMNS: { label: string; extract: (r: ReportRow) => string }[] = [
	{ label: "Report ID", extract: (r) => String(r.id).slice(0, 12) },
	{ label: "Status", extract: (r) => (r.status || "pending").charAt(0).toUpperCase() + (r.status || "pending").slice(1) },
	{ label: "Reason", extract: (r) => r.reason || "" },
	{ label: "Category", extract: (r) => r.category || "Uncategorized" },
	{ label: "Details", extract: (r) => r.details || "" },
	{ label: "Target Type", extract: (r) => r.target_type || "" },
	{ label: "Target ID", extract: (r) => String(r.target_id || "").slice(0, 12) },
	{ label: "Reporter ID", extract: (r) => String(r.author_id || "").slice(0, 12) },
	{ label: "Reported User", extract: (r) => String(r.target_author_id || "").slice(0, 12) },
	{ label: "Submitted", extract: (r) => fmtDate(r.created_at) },
];

export function buildReportCSV(reports: ReportRow[]): string {
	const lines: string[] = [];
	lines.push(cell("Voice Box — Reports Export"));
	lines.push(cell(`Generated: ${new Date().toLocaleString()}`));
	lines.push(cell(`Total Reports: ${reports.length}`));
	lines.push("");

	// Status breakdown
	lines.push(cell("— Status Breakdown —"));
	const statusCounts: Record<string, number> = {};
	for (const r of reports) {
		const label = (r.status || "pending").charAt(0).toUpperCase() + (r.status || "pending").slice(1);
		statusCounts[label] = (statusCounts[label] || 0) + 1;
	}
	for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
		const pct = reports.length > 0 ? ((count / reports.length) * 100).toFixed(1) : "0.0";
		lines.push([cell(status), cell(count), cell(`${pct}%`)].join(","));
	}
	lines.push("");
	lines.push(cell("═══════════════════════════════════════════════════"));

	// Header + rows
	lines.push(REPORT_COLUMNS.map((c) => cell(c.label)).join(","));
	for (const r of reports) {
		lines.push(REPORT_COLUMNS.map((c) => cell(c.extract(r))).join(","));
	}

	return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// Polls CSV — presentation-quality export for poll data
// ═══════════════════════════════════════════════════════════════════

import type { PollData } from "../types";

export function buildPollCSV(polls: PollData[]): string {
	const lines: string[] = [];
	lines.push(cell("Voice Box — Polls Export"));
	lines.push(cell(`Generated: ${new Date().toLocaleString()}`));
	lines.push(cell(`Total Polls: ${polls.length}`));
	lines.push("");

	// Status breakdown
	lines.push(cell("— Status Breakdown —"));
	const active = polls.filter((p) => !p.deleted && !p.archived).length;
	const closed = polls.length - active;
	lines.push([cell("Active"), cell(active)].join(","));
	lines.push([cell("Closed / Archived"), cell(closed)].join(","));
	lines.push("");

	// Participation summary
	const totalVotes = polls.reduce((sum, p) => sum + (p.total_votes ?? 0), 0);
	lines.push([cell("Total votes cast"), cell(totalVotes)].join(","));
	lines.push("");
	lines.push(cell("═══════════════════════════════════════════════════"));

	// Header + rows
	const cols = [
		{ label: "Poll ID", extract: (p: PollData) => String(p.id).slice(0, 12) },
		{ label: "Question", extract: (p: PollData) => p.title || "" },
		{ label: "Options", extract: (p: PollData) => (p.options || []).join(" | ") },
		{ label: "Total Votes", extract: (p: PollData) => String(p.total_votes ?? 0) },
		{ label: "Vote Counts", extract: (p: PollData) => Object.entries(p.vote_counts || {}).map(([k, v]) => `${k}:${v}`).join(", ") },
		{ label: "Status", extract: (p: PollData) => (p.deleted || p.archived) ? "Closed" : "Active" },
		{ label: "Expires", extract: (p: PollData) => p.expires_at ? fmtDate(p.expires_at) : "Never" },
		{ label: "Created", extract: (p: PollData) => p.created_at ? fmtDate(p.created_at) : "" },
	];

	lines.push(cols.map((c) => cell(c.label)).join(","));
	for (const p of polls) {
		lines.push(cols.map((c) => cell(c.extract(p))).join(","));
	}

	return lines.join("\n");
}