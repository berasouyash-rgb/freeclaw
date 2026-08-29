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
	{ key: "support", label: "👍 Supports", extract: (p) => p.reactions?.support ?? 0 },
	{ key: "heart", label: "❤️ Hearts", extract: (p) => p.reactions?.heart ?? 0 },
	{ key: "comments", label: "💬 Comments", extract: (p) => p.comment_count ?? 0 },
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

// ── Summary builders ────────────────────────────────────────────

function buildSummary(posts: PostData[], rangeLabel: string, type: string): string[][] {
	const lines: string[][] = [];

	// Title row
	lines.push(["Voice Box — Compliance Export"]);
	lines.push([`${type === "problem" ? "Complaints" : "Suggestions"} Report`]);
	lines.push([`Generated: ${new Date().toLocaleString()}`]);
	lines.push([`Date Range: ${rangeLabel}`]);
	lines.push([`Total Records: ${posts.length}`]);
	lines.push([]); // blank separator

	// Status breakdown
	lines.push(["— Status Breakdown —"]);
	const statusCounts: Record<string, number> = {};
	for (const p of posts) {
		const label = STATUS_META[p.status]?.label || p.status;
		statusCounts[label] = (statusCounts[label] || 0) + 1;
	}
	for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
		const pct = posts.length > 0 ? ((count / posts.length) * 100).toFixed(1) : "0.0";
		lines.push([status, String(count), `${pct}%`]);
	}
	lines.push([]); // blank separator

	// Category breakdown
	lines.push(["— Category Breakdown —"]);
	const catCounts: Record<string, number> = {};
	for (const p of posts) {
		const cat = p.category || "Uncategorized";
		catCounts[cat] = (catCounts[cat] || 0) + 1;
	}
	for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
		const pct = posts.length > 0 ? ((count / posts.length) * 100).toFixed(1) : "0.0";
		lines.push([cat, String(count), `${pct}%`]);
	}
	lines.push([]); // blank separator

	// Priority breakdown
	lines.push(["— Priority Breakdown —"]);
	const prioCounts: Record<string, number> = {};
	for (const p of posts) {
		const prio = (p.priority || "medium").charAt(0).toUpperCase() + (p.priority || "medium").slice(1);
		prioCounts[prio] = (prioCounts[prio] || 0) + 1;
	}
	const prioOrder = ["Critical", "High", "Medium", "Low"];
	for (const prio of prioOrder) {
		if (prioCounts[prio]) {
			const pct = posts.length > 0 ? ((prioCounts[prio] / posts.length) * 100).toFixed(1) : "0.0";
			lines.push([prio, String(prioCounts[prio]), `${pct}%`]);
		}
	}
	lines.push([]); // blank separator

	// Engagement summary
	const totalSupports = posts.reduce((sum, p) => sum + (p.reactions?.support ?? 0), 0);
	const totalHearts = posts.reduce((sum, p) => sum + (p.reactions?.heart ?? 0), 0);
	const totalComments = posts.reduce((sum, p) => sum + (p.comment_count ?? 0), 0);
	const solvedCount = statusCounts["Solved"] || 0;
	const activeCount = posts.length - (statusCounts["Solved"] || 0) - (statusCounts["Archived"] || 0);

	lines.push(["— Engagement Summary —"]);
	lines.push(["Total Supports", String(totalSupports)]);
	lines.push(["Total Hearts", String(totalHearts)]);
	lines.push(["Total Comments", String(totalComments)]);
	lines.push(["Active (not solved/archived)", String(activeCount)]);
	lines.push(["Solved", String(solvedCount)]);
	lines.push([]);

	return lines;
}

function formatDateRangeLabel(range: DateRange): string {
	if (range.preset === "custom" && range.start && range.end) {
		return `${range.start.toLocaleDateString()} — ${range.end.toLocaleDateString()}`;
	}
	const labels: Record<string, string> = {
		all: "All Time",
		today: "Today",
		this_week: "This Week",
		this_month: "This Month",
		last_30_days: "Last 30 Days",
		last_90_days: "Last 90 Days",
	};
	return labels[range.preset] || "All Time";
}

// ── Main builder ────────────────────────────────────────────────

export function buildComplianceCSV(
	posts: PostData[],
	range: DateRange,
	type: "problem" | "suggestion",
): string {
	const filtered = filterByDateRange(posts, range);
	const rangeLabel = formatDateRangeLabel(range);

	// 1. Summary section
	const summary = buildSummary(filtered, rangeLabel, type);

	// 2. Separator
	const separator = ["═══════════════════════════════════════════════════"];

	// 3. Data header
	const header = COLUMNS.map((c) => c.label);

	// 4. Data rows
	const rows = filtered.map((p) => COLUMNS.map((c) => String(c.extract(p))));

	// 5. Assemble
	const allLines: string[] = [];

	// Summary section (no quotes, clean for readability)
	for (const line of summary) {
		if (line.length === 0) {
			allLines.push("");
		} else {
			allLines.push(line.map(cell).join(","));
		}
	}

	// Separator
	allLines.push(separator.join(","));

	// Data header + rows using the standard CSV escaper
	allLines.push(header.map(cell).join(","));
	for (const row of rows) {
		allLines.push(row.map(cell).join(","));
	}

	return allLines.join("\n");
}
