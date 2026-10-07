// ═══════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD WIDGETS — the catalog
// ═══════════════════════════════════════════════════════════════════
// Every widget here reads a REAL endpoint and renders a REAL field. There
// are no placeholder numbers: if a field is missing the widget says so
// rather than inventing a value, because a dashboard that prints confident
// numbers from nowhere is worse than one that admits it has no data.
//
// Rendering is compositional. Most widgets come from a handful of generic
// renderers (stat / list / bars / series / gauge / status), parameterised by
// a source and a field path. That keeps the catalog cheap to extend without
// every entry hand-rolling its own component.
// ═══════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import {
	Activity,
	AlertTriangle,
	BarChart3,
	Bell,
	Bug,
	CheckCircle2,
	ClipboardList,
	Database,
	Eye,
	FileWarning,
	Flame,
	Gauge,
	GitMerge,
	MessageSquare,
	Percent,
	Server,
	ShieldCheck,
	Sparkles,
	ThumbsUp,
	TrendingUp,
	Trophy,
	Users,
	Vote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Categories ───────────────────────────────────────────────────

export type WidgetCategory =
	| "pulse"
	| "content"
	| "people"
	| "system"
	| "intelligence";

export const CATEGORY_META: Record<
	WidgetCategory,
	{ label: string; hint: string }
> = {
	pulse: { label: "Platform pulse", hint: "Snapshot of current activity" },
	content: { label: "Content", hint: "Posts, comments, polls, votes" },
	people: { label: "People", hint: "Users, contributors, communities" },
	system: { label: "System", hint: "Health, database, reliability" },
	intelligence: { label: "Intelligence", hint: "Trends, signals, follow-up" },
};

// ─── Data sources ─────────────────────────────────────────────────
// One entry per endpoint. Widgets reference a source by key; the dashboard
// fetches each DISTINCT key once no matter how many widgets use it.

export interface DataSource {
	key: string;
	path: string;
	/** Ops-style endpoints do real scans — they need the long timeout. */
	slow?: boolean;
	/** Admin endpoints are not safe to poll aggressively. */
	pollMs?: number;
}

export const SOURCES = {
	postsProblems: {
		key: "postsProblems",
		path: "/api/posts?all=1&type=problem&paginate=1&limit=1",
	},
	postsSuggestions: {
		key: "postsSuggestions",
		path: "/api/posts?all=1&type=suggestion&paginate=1&limit=1",
	},
	trends7: { key: "trends7", path: "/api/trends?period=7d" },
	trends30: { key: "trends30", path: "/api/trends?period=30d" },
	leaderboard: { key: "leaderboard", path: "/api/leaderboard" },
	dbStats: { key: "dbStats", path: "/api/db_stats", slow: true, pollMs: 120_000 },
	health: { key: "health", path: "/api/health", slow: true, pollMs: 60_000 },
	vitals: { key: "vitals", path: "/api/vitals" },
	auditStats: { key: "auditStats", path: "/api/audit-trail?action=stats" },
	security: { key: "security", path: "/api/security?action=events" },
	// Verified against scripts/endpoint-shapes.mjs: this GET returns
	// { ok, summary, errors, recent }.
	errors: { key: "errors", path: "/api/errors" },
	incidents: { key: "incidents", path: "/api/incidents" },
	polls: { key: "polls", path: "/api/polls" },
	communities: { key: "communities", path: "/api/communities" },

	// ── Added from the verified shape sweep ──────────────────────
	// Each path below was read out of its handler and its top-level keys
	// recorded before a widget was written against it.
	performance: {
		key: "performance",
		path: "/api/performance",
		slow: true,
		pollMs: 60_000,
	},
	insights: { key: "insights", path: "/api/insights" },
	routingStats: {
		key: "routingStats",
		path: "/api/routing?action=stats",
		slow: true,
		pollMs: 120_000,
	},
	spam: { key: "spam", path: "/api/spam" },
	duplicates: { key: "duplicates", path: "/api/duplicates" },
	actionCenter: {
		key: "actionCenter",
		path: "/api/action-center?action=summary",
	},
	notifications: { key: "notifications", path: "/api/notifications" },
	comments: { key: "comments", path: "/api/comments?paginate=1&limit=1" },
	categoriesList: { key: "categoriesList", path: "/api/categories" },
	featureHealth: {
		key: "featureHealth",
		path: "/api/feature-health",
		slow: true,
		pollMs: 120_000,
	},
	agentDashboard: {
		key: "agentDashboard",
		path: "/api/agent-team?action=dashboard",
		slow: true,
		pollMs: 120_000,
	},
	// Shape verified against the Ops Center contract in OpsCenter.test.tsx:
	// { employees, task_queue, metrics, ai_provider, config, incidents,
	//   attention, auto_resolved, verified_today, alerts, report, platform,
	//   last_patrol_at, activity }
	workforce: {
		key: "workforce",
		path: "/api/workforce?action=ops-summary",
		slow: true,
		pollMs: 60_000,
	},
	providers: {
		key: "providers",
		path: "/api/providers?action=list",
		slow: true,
		pollMs: 300_000,
	},
	metaAgent: {
		key: "metaAgent",
		path: "/api/meta-agent?action=registry",
		slow: true,
		pollMs: 300_000,
	},
	eventAgents: { key: "eventAgents", path: "/api/event-agents" },
	auditLogs: {
		key: "auditLogs",
		path: "/api/audit-trail?action=list",
		slow: true,
		pollMs: 120_000,
	},
} satisfies Record<string, DataSource>;

// ─── Render context ───────────────────────────────────────────────

export interface WidgetCtx {
	data: Record<string, unknown>;
	loading: Record<string, boolean>;
	failed: Record<string, boolean>;
	/** Wall-clock ms of the last successful refresh, or null before first load. */
	refreshedAt: number | null;
}

// ─── Persisted instance ───────────────────────────────────────────

export interface WidgetInstance {
	/** Instance id — distinct from widgetId so a widget can appear twice. */
	iid: string;
	widgetId: string;
	/** Grid columns consumed out of 12. */
	span: number;
	/** Content height in px. */
	height: number;
	/** Card opacity, 0.35–1. */
	opacity: number;
	accent: AccentKey;
	glass: boolean;
}

export type WidgetKind =
	| "stat"
	| "count"
	| "bars"
	| "list"
	| "series"
	| "gauge"
	| "status";

export interface WidgetDef {
	id: string;
	name: string;
	description: string;
	category: WidgetCategory;
	icon: LucideIcon;
	/** Visual family of the widget — surfaced as a chip in the widget gallery. */
	kind: WidgetKind;
	/** [min, default, max] grid columns out of 12. */
	spans: [number, number, number];
	defaultHeight: number;
	source?: DataSource;
	render: (ctx: WidgetCtx) => ReactNode;
}

// ─── Accents (drive the glass tint + value colour) ────────────────

export type AccentKey =
	| "accent"
	| "cyan"
	| "good"
	| "warn"
	| "bad"
	| "violet"
	| "neutral";

export const ACCENTS: Record<
	AccentKey,
	{ label: string; text: string; ring: string; wash: string; swatch: string }
> = {
	accent: {
		label: "Accent",
		text: "text-accent",
		ring: "border-accent/25",
		wash: "bg-accent/[0.06]",
		swatch: "bg-accent",
	},
	cyan: {
		label: "Cyan",
		text: "text-cyan-400",
		ring: "border-cyan-400/25",
		wash: "bg-cyan-400/[0.06]",
		swatch: "bg-cyan-400",
	},
	good: {
		label: "Green",
		text: "text-good",
		ring: "border-good/25",
		wash: "bg-good/[0.06]",
		swatch: "bg-good",
	},
	warn: {
		label: "Amber",
		text: "text-warn",
		ring: "border-warn/25",
		wash: "bg-warn/[0.06]",
		swatch: "bg-warn",
	},
	bad: {
		label: "Red",
		text: "text-bad",
		ring: "border-bad/25",
		wash: "bg-bad/[0.06]",
		swatch: "bg-bad",
	},
	violet: {
		label: "Violet",
		text: "text-violet-400",
		ring: "border-violet-400/25",
		wash: "bg-violet-400/[0.06]",
		swatch: "bg-violet-400",
	},
	neutral: {
		label: "Ink",
		text: "text-ink2",
		ring: "border-border",
		wash: "bg-surface2/40",
		swatch: "bg-ink3",
	},
};

// ─── Small helpers ────────────────────────────────────────────────

/** Walk a dotted path. Returns undefined rather than throwing. */
function at(obj: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((acc, key) => {
		if (acc === null || acc === undefined) return undefined;
		if (Array.isArray(acc)) {
			const i = Number(key);
			return Number.isInteger(i) ? acc[i] : undefined;
		}
		if (typeof acc !== "object") return undefined;
		return (acc as Record<string, unknown>)[key];
	}, obj);
}

function num(ctx: WidgetCtx, src: string, path: string): number | null {
	const v = at(ctx.data[src], path);
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
		return Number(v);
	return null;
}

function rows(ctx: WidgetCtx, src: string, path?: string): unknown[] {
	const v = path ? at(ctx.data[src], path) : ctx.data[src];
	return Array.isArray(v) ? v : [];
}

function fmt(n: number | null): string {
	if (n === null) return "—";
	return n.toLocaleString();
}

/** True when the widget's source loaded successfully. */
function ok(ctx: WidgetCtx, src: string): boolean {
	return !!ctx.data[src] && !ctx.failed[src];
}

function waiting(ctx: WidgetCtx, src: string): boolean {
	return !!ctx.loading[src] && !ctx.data[src];
}

// ─── Generic renderers ────────────────────────────────────────────

/** Big number + label. The workhorse. */
function statWidget(
	id: string,
	name: string,
	description: string,
	category: WidgetCategory,
	icon: LucideIcon,
	source: DataSource,
	path: string,
	valueLabel: string,
	suffix = "",
	accent: AccentKey = "accent",
): WidgetDef {
	return {
		id,
		name,
		description,
		category,
		icon,
		kind: "stat",
		spans: [2, 3, 4],
		defaultHeight: 108,
		source,
		render: (ctx) => {
			if (waiting(ctx, source.key)) return <Skeleton />;
			if (!ok(ctx, source.key)) return <NoData />;
			const n = num(ctx, source.key, path);
			return (
				<Stat
					value={n === null ? "—" : `${n.toLocaleString()}${suffix}`}
					label={valueLabel}
					accent={accent}
				/>
			);
		},
	};
}

/** Count of rows in an array payload. */
function countWidget(
	id: string,
	name: string,
	description: string,
	category: WidgetCategory,
	icon: LucideIcon,
	source: DataSource,
	arrayPath: string,
	valueLabel: string,
	accent: AccentKey = "accent",
): WidgetDef {
	return {
		id,
		name,
		description,
		category,
		icon,
		kind: "count",
		spans: [2, 3, 4],
		defaultHeight: 108,
		source,
		render: (ctx) => {
			if (waiting(ctx, source.key)) return <Skeleton />;
			if (!ok(ctx, source.key)) return <NoData />;
			const list = rows(ctx, source.key, arrayPath);
			return (
				<Stat
					value={list.length.toLocaleString()}
					label={valueLabel}
					accent={accent}
				/>
			);
		},
	};
}

/** Horizontal bars from a `{ name, count }` array or a record. */
function barsWidget(
	id: string,
	name: string,
	description: string,
	category: WidgetCategory,
	icon: LucideIcon,
	source: DataSource,
	path: string,
	accent: AccentKey = "accent",
	max = 6,
): WidgetDef {
	return {
		id,
		name,
		description,
		category,
		icon,
		kind: "bars",
		spans: [3, 4, 6],
		defaultHeight: 200,
		source,
		render: (ctx) => {
			if (waiting(ctx, source.key)) return <Skeleton />;
			if (!ok(ctx, source.key)) return <NoData />;
			const raw = at(ctx.data[source.key], path);
			const items = normaliseBars(raw, max);
			if (!items.length) return <NoData />;
			return <Bars items={items} accent={accent} />;
		},
	};
}

/** Rows from an array payload — top N by a numeric field, or as-is. */
function listWidget(
	id: string,
	name: string,
	description: string,
	category: WidgetCategory,
	icon: LucideIcon,
	source: DataSource,
	arrayPath: string,
	labelField: string,
	valueField: string | null,
	accent: AccentKey = "accent",
	max = 6,
): WidgetDef {
	return {
		id,
		name,
		description,
		category,
		icon,
		kind: "list",
		spans: [3, 4, 6],
		defaultHeight: 210,
		source,
		render: (ctx) => {
			if (waiting(ctx, source.key)) return <Skeleton />;
			if (!ok(ctx, source.key)) return <NoData />;
			const list = rows(ctx, source.key, arrayPath);
			if (!list.length) return <NoData />;
			const items = list
				.map((r) => ({
					label: String(at(r, labelField) ?? "—"),
					value:
						valueField === null ? "" : String(at(r, valueField) ?? "—"),
					sort:
						valueField === null ? 0 : Number(at(r, valueField) ?? 0) || 0,
				}))
				.sort((a, b) => b.sort - a.sort)
				.slice(0, max);
			return <List items={items} accent={accent} />;
		},
	};
}

/** Sparkline over a `{ date, count }` series. */
function seriesWidget(
	id: string,
	name: string,
	description: string,
	category: WidgetCategory,
	icon: LucideIcon,
	source: DataSource,
	path: string,
	valueLabel: string,
	accent: AccentKey = "accent",
): WidgetDef {
	return {
		id,
		name,
		description,
		category,
		icon,
		kind: "series",
		spans: [3, 4, 6],
		defaultHeight: 150,
		source,
		render: (ctx) => {
			if (waiting(ctx, source.key)) return <Skeleton />;
			if (!ok(ctx, source.key)) return <NoData />;
			const raw = at(ctx.data[source.key], path);
			const points = Array.isArray(raw)
				? raw
						.map((p) => Number(at(p, "count") ?? 0))
						.filter((n) => Number.isFinite(n))
				: [];
			if (points.length < 2) return <NoData />;
			return <Spark points={points} label={valueLabel} accent={accent} />;
		},
	};
}

/** 0–100 ring. */
function gaugeWidget(
	id: string,
	name: string,
	description: string,
	category: WidgetCategory,
	icon: LucideIcon,
	source: DataSource,
	path: string,
	valueLabel: string,
	accent: AccentKey = "good",
): WidgetDef {
	return {
		id,
		name,
		description,
		category,
		icon,
		kind: "gauge",
		spans: [2, 3, 4],
		defaultHeight: 140,
		source,
		render: (ctx) => {
			if (waiting(ctx, source.key)) return <Skeleton />;
			if (!ok(ctx, source.key)) return <NoData />;
			const n = num(ctx, source.key, path);
			if (n === null) return <NoData />;
			return <Ring value={n} label={valueLabel} accent={accent} />;
		},
	};
}

/** Service status rows from a `checks` map or array. */
function statusWidget(
	id: string,
	name: string,
	description: string,
	category: WidgetCategory,
	icon: LucideIcon,
	source: DataSource,
	path: string,
): WidgetDef {
	return {
		id,
		name,
		description,
		category,
		icon,
		kind: "status",
		spans: [3, 4, 6],
		defaultHeight: 200,
		source,
		render: (ctx) => {
			if (waiting(ctx, source.key)) return <Skeleton />;
			if (!ok(ctx, source.key)) return <NoData />;
			const raw = at(ctx.data[source.key], path) ?? ctx.data[source.key];
			const items = normaliseStatus(raw);
			if (!items.length) return <NoData />;
			return <StatusList items={items} />;
		},
	};
}

/** Render a value the widget cannot derive, so the gap is visible. */
function NoData() {
	return (
		<div className="flex h-full items-center justify-center text-center">
			<p className="text-[11px] text-ink3 leading-snug">
				No data available yet.
				<br />
				<span className="text-[10px]">
					This widget reports only what the API actually returns.
				</span>
			</p>
		</div>
	);
}

function Skeleton() {
	return (
		<div className="flex h-full flex-col justify-center gap-2">
			<div className="skeleton h-7 w-20 rounded" />
			<div className="skeleton h-3 w-28 rounded" />
		</div>
	);
}

// ─── Presentation primitives ──────────────────────────────────────

function Stat({
	value,
	label,
	accent,
}: {
	value: string;
	label: string;
	accent: AccentKey;
}) {
	return (
		<div className="flex h-full flex-col justify-center">
			<p
				className={`font-display font-bold text-3xl tracking-tight tabular-nums ${ACCENTS[accent].text}`}
			>
				{value}
			</p>
			<p className="mt-0.5 text-[11px] text-ink3">{label}</p>
		</div>
	);
}

function Bars({
	items,
	accent,
}: {
	items: { label: string; value: number }[];
	accent: AccentKey;
}) {
	const max = Math.max(...items.map((i) => i.value), 1);
	return (
		<div className="flex h-full flex-col justify-center gap-1.5">
			{items.map((i) => (
				<div key={i.label} className="flex items-center gap-2">
					<span className="w-[38%] shrink-0 truncate text-[11px] text-ink2">
						{i.label}
					</span>
					<span className="h-2 flex-1 overflow-hidden rounded-full bg-surface2/60">
						<span
							className={`block h-full rounded-full ${ACCENTS[accent].swatch}`}
							style={{ width: `${Math.round((i.value / max) * 100)}%` }}
						/>
					</span>
					<span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink3">
						{i.value.toLocaleString()}
					</span>
				</div>
			))}
		</div>
	);
}

function List({
	items,
	accent,
}: {
	items: { label: string; value: string }[];
	accent: AccentKey;
}) {
	return (
		<ul className="flex h-full flex-col justify-center gap-1">
			{items.map((i, idx) => (
				<li key={`${i.label}-${idx}`} className="flex items-center gap-2">
					<span className="w-4 shrink-0 text-[10px] tabular-nums text-ink3">
						{idx + 1}
					</span>
					<span className="flex-1 truncate text-[11px] text-ink2">
						{i.label}
					</span>
					<span
						className={`shrink-0 text-[11px] font-semibold tabular-nums ${ACCENTS[accent].text}`}
					>
						{i.value}
					</span>
				</li>
			))}
		</ul>
	);
}

function Spark({
	points,
	label,
	accent,
}: {
	points: number[];
	label: string;
	accent: AccentKey;
}) {
	const max = Math.max(...points, 1);
	const min = Math.min(...points, 0);
	const span = max - min || 1;
	const w = 100;
	const h = 28;
	const d = points
		.map((p, i) => {
			const x = (i / (points.length - 1)) * w;
			const y = h - ((p - min) / span) * h;
			return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(" ");
	const total = points.reduce((a, b) => a + b, 0);
	return (
		<div className="flex h-full flex-col justify-center gap-1">
			<div className="flex items-baseline gap-2">
				<span
					className={`font-display font-bold text-xl tabular-nums ${ACCENTS[accent].text}`}
				>
					{total.toLocaleString()}
				</span>
				<span className="text-[11px] text-ink3">{label}</span>
			</div>
			<svg
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="none"
				className="h-8 w-full"
				role="img"
				aria-label={`${label}: ${points.length} points, total ${total}`}
			>
				<path
					d={d}
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					vectorEffect="non-scaling-stroke"
					className={ACCENTS[accent].text}
				/>
			</svg>
		</div>
	);
}

function Ring({
	value,
	label,
	accent,
}: {
	value: number;
	label: string;
	accent: AccentKey;
}) {
	const pct = Math.max(0, Math.min(100, value));
	const r = 26;
	const c = 2 * Math.PI * r;
	return (
		<div className="flex h-full items-center gap-3">
			<svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0" role="img" aria-label={`${label}: ${pct}%`}>
				<circle
					cx="32"
					cy="32"
					r={r}
					fill="none"
					strokeWidth="6"
					className="stroke-surface2"
				/>
				<circle
					cx="32"
					cy="32"
					r={r}
					fill="none"
					strokeWidth="6"
					strokeLinecap="round"
					stroke="currentColor"
					className={ACCENTS[accent].text}
					strokeDasharray={`${(pct / 100) * c} ${c}`}
					transform="rotate(-90 32 32)"
				/>
			</svg>
			<div className="min-w-0">
				<p
					className={`font-display font-bold text-2xl tabular-nums ${ACCENTS[accent].text}`}
				>
					{pct}%
				</p>
				<p className="text-[11px] text-ink3">{label}</p>
			</div>
		</div>
	);
}

function StatusList({
	items,
}: {
	items: { label: string; state: string; detail: string }[];
}) {
	const tone = (s: string) => {
		const v = s.toLowerCase();
		if (/^(ok|up|healthy|pass|ready|operational)$/.test(v)) return "text-good";
		if (/^(degraded|warn|warning|slow|partial)$/.test(v)) return "text-warn";
		if (/^(down|fail|error|unhealthy|critical)$/.test(v)) return "text-bad";
		return "text-ink3";
	};
	return (
		<ul className="flex h-full flex-col justify-center gap-1">
			{items.map((i) => (
				<li key={i.label} className="flex items-center gap-2">
					<span className={`text-[11px] font-semibold uppercase ${tone(i.state)}`}>
						{i.state}
					</span>
					<span className="flex-1 truncate text-[11px] text-ink2">
						{i.label}
					</span>
					{i.detail && (
						<span className="shrink-0 text-[10px] tabular-nums text-ink3">
							{i.detail}
						</span>
					)}
				</li>
			))}
		</ul>
	);
}

// ─── Normalisers ──────────────────────────────────────────────────

function normaliseBars(
	raw: unknown,
	max: number,
): { label: string; value: number }[] {
	if (Array.isArray(raw)) {
		return raw
			.map((r) => ({
				// `name` covers trends/leaderboard, `category` covers insights.
				// Both are real field names on their respective endpoints, read
				// out of the handlers rather than assumed.
				label: String(
					at(r, "name") ?? at(r, "category") ?? at(r, "label") ?? "—",
				),
				value: Number(at(r, "count") ?? at(r, "value") ?? 0) || 0,
			}))
			.filter((r) => r.value > 0 || r.label !== "—")
			.sort((a, b) => b.value - a.value)
			.slice(0, max);
	}
	if (raw && typeof raw === "object") {
		return Object.entries(raw as Record<string, unknown>)
			.map(([label, value]) => ({ label, value: Number(value) || 0 }))
			.sort((a, b) => b.value - a.value)
			.slice(0, max);
	}
	return [];
}

function normaliseStatus(
	raw: unknown,
): { label: string; state: string; detail: string }[] {
	const one = (label: string, v: unknown) => {
		if (v && typeof v === "object") {
			const o = v as Record<string, unknown>;
			return {
				label,
				state: String(o.status ?? o.state ?? o.ok ?? "unknown"),
				detail:
					typeof o.response_time_ms === "number"
						? `${Math.round(o.response_time_ms)}ms`
						: typeof o.latencyMs === "number"
							? `${Math.round(o.latencyMs)}ms`
							: o.count !== undefined
								? String(o.count)
								: "",
			};
		}
		if (typeof v === "boolean") {
			return { label, state: v ? "ok" : "down", detail: "" };
		}
		return { label, state: String(v ?? "unknown"), detail: "" };
	};

	if (Array.isArray(raw)) {
		return raw.slice(0, 8).map((r, i) => one(`check-${i + 1}`, r));
	}
	if (raw && typeof raw === "object") {
		return Object.entries(raw as Record<string, unknown>)
			.slice(0, 8)
			.map(([k, v]) => one(k, v));
	}
	return [];
}

// ─── The catalog ──────────────────────────────────────────────────
// Grouped roughly by the question each widget answers.

export const WIDGETS: WidgetDef[] = [
	// ── Platform pulse ───────────────────────────────────────────
	statWidget(
		"complaints-total",
		"Complaints filed",
		"Total complaint reports in the system.",
		"pulse",
		FileWarning,
		SOURCES.postsProblems,
		"total",
		"All-time complaint reports",
		"",
		"accent",
	),
	statWidget(
		"suggestions-total",
		"Suggestions filed",
		"Total suggestions in the system.",
		"pulse",
		Sparkles,
		SOURCES.postsSuggestions,
		"total",
		"All-time suggestions",
		"",
		"cyan",
	),
	statWidget(
		"posts-7d",
		"Reports this week",
		"Volume over the last 7 days.",
		"pulse",
		Activity,
		SOURCES.trends7,
		"total_posts",
		"Submitted in the last 7 days",
		"",
		"accent",
	),
	statWidget(
		"posts-30d",
		"Reports this month",
		"Volume over the last 30 days.",
		"pulse",
		TrendingUp,
		SOURCES.trends30,
		"total_posts",
		"Submitted in the last 30 days",
		"",
		"accent",
	),
	gaugeWidget(
		"resolution-rate",
		"Resolution rate",
		"Share of reports that reach a resolved state.",
		"pulse",
		Percent,
		SOURCES.trends30,
		"resolution_rate",
		"Marked solved",
		"good",
	),
	statWidget(
		"avg-resolution-days",
		"Avg time to resolve",
		"Mean days from report to resolution.",
		"pulse",
		Gauge,
		SOURCES.trends30,
		"avg_resolution_time_days",
		"Days, averaged over 30 days",
		"d",
		"warn",
	),
	seriesWidget(
		"volume-trend-7d",
		"Submission trend",
		"Daily report volume over 7 days.",
		"pulse",
		BarChart3,
		SOURCES.trends7,
		"daily_frequency",
		"reports in 7 days",
		"accent",
	),
	// ── Content ──────────────────────────────────────────────────
	barsWidget(
		"categories-30d",
		"Reports by category",
		"Where reports are coming from.",
		"content",
		ClipboardList,
		SOURCES.trends30,
		"category_distribution",
		"accent",
	),
	barsWidget(
		"top-categories-30d",
		"Top categories",
		"Most reported categories over 30 days.",
		"content",
		BarChart3,
		SOURCES.trends30,
		"top_categories",
		"cyan",
	),
	barsWidget(
		"priority-mix-30d",
		"Priority mix",
		"Distribution of report priority.",
		"content",
		AlertTriangle,
		SOURCES.trends30,
		"priority_trends",
		"warn",
	),
	listWidget(
		"emerging-topics",
		"Emerging topics",
		"Terms gaining volume in recent reports.",
		"content",
		Sparkles,
		SOURCES.trends30,
		"emerging_topics",
		"name",
		"count",
		"violet",
	),
	countWidget(
		"polls-open",
		"Polls",
		"Active polls on the platform.",
		"content",
		Vote,
		SOURCES.polls,
		"polls",
		"Polls returned by the API",
		"cyan",
	),
	countWidget(
		"communities-count",
		"Communities",
		"Communities on the platform.",
		"content",
		Users,
		SOURCES.communities,
		"communities",
		"Communities returned by the API",
		"accent",
	),
	listWidget(
		"top-complaints",
		"Most-supported complaints",
		"Complaints ranked by community support.",
		"content",
		Flame,
		SOURCES.leaderboard,
		"problems",
		"title",
		"support",
		"bad",
	),
	listWidget(
		"top-suggestions",
		"Most-supported suggestions",
		"Suggestions ranked by community support.",
		"content",
		ThumbsUp,
		SOURCES.leaderboard,
		"suggestions",
		"title",
		"support",
		"good",
	),
	listWidget(
		"top-polls",
		"Most-voted polls",
		"Polls ranked by participation.",
		"content",
		Vote,
		SOURCES.leaderboard,
		"polls",
		"title",
		"votes",
		"cyan",
	),
	// ── People ───────────────────────────────────────────────────
	// NOTE: this widget reads the merged leaderboard array, which serves
	// CONTENT rows (toMerged: title/score) — the anonymous platform has no
	// person rows to rank, so the copy must not claim people/contributors.
	listWidget(
		"top-contributors",
		"Highest-scoring posts",
		"Problems, suggestions, and polls with the strongest community score.",
		"content",
		Trophy,
		SOURCES.leaderboard,
		"leaderboard",
		"title",
		"score",
		"accent",
	),
	listWidget(
		"ai-activity",
		"Recent AI activity",
		"Verified actions taken by the platform's agents.",
		"people",
		Activity,
		SOURCES.leaderboard,
		"ai_activity",
		"label",
		"kind",
		"violet",
	),
	// ── System ───────────────────────────────────────────────────
	gaugeWidget(
		"db-health",
		"Database health",
		"Composite health score from the database stats endpoint.",
		"system",
		Database,
		SOURCES.dbStats,
		"health_score",
		"Composite score",
		"good",
	),
	statWidget(
		"db-rows",
		"Rows stored",
		"Total rows across critical tables.",
		"system",
		Database,
		SOURCES.dbStats,
		"total_rows",
		"Rows across critical tables",
		"",
		"accent",
	),
	statWidget(
		"db-stale",
		"Stale records",
		"Records flagged as stale by the database check.",
		"system",
		AlertTriangle,
		SOURCES.dbStats,
		"total_stale",
		"Records needing cleanup",
		"",
		"warn",
	),
	statWidget(
		"db-latency",
		"DB response time",
		"Time to compute database statistics.",
		"system",
		Gauge,
		SOURCES.dbStats,
		"response_time_ms",
		"Milliseconds",
		"ms",
		"warn",
	),
	statusWidget(
		"health-checks",
		"Dependency checks",
		"Every service the platform depends on.",
		"system",
		ShieldCheck,
		SOURCES.health,
		"checks",
	),
	statusWidget(
		"circuit-breakers",
		"Circuit breakers",
		"Breaker state per dependency.",
		"system",
		Server,
		SOURCES.health,
		"circuits",
	),
	statWidget(
		"health-latency",
		"Health probe latency",
		"Round-trip time of the health endpoint.",
		"system",
		Gauge,
		SOURCES.health,
		"response_time_ms",
		"Milliseconds",
		"ms",
		"warn",
	),
	statusWidget(
		"vitals",
		"Web vitals",
		"Real client performance metrics.",
		"system",
		Eye,
		SOURCES.vitals,
		"vitals",
	),
	statWidget(
		"audit-entries",
		"Audit entries",
		"Actions recorded in the audit trail.",
		"system",
		ClipboardList,
		SOURCES.auditStats,
		"total_entries",
		"Recorded admin actions",
		"",
		"neutral",
	),
	barsWidget(
		"audit-by-action",
		"Audit by action",
		"What admins have been doing.",
		"system",
		ClipboardList,
		SOURCES.auditStats,
		"by_action",
		"neutral",
		5,
	),
	barsWidget(
		"audit-by-hour",
		"Audit by hour",
		"When admin work happens.",
		"system",
		Activity,
		SOURCES.auditStats,
		"by_hour",
		"cyan",
		8,
	),
	countWidget(
		"security-events",
		"Security events",
		"Recent security signals.",
		"system",
		ShieldCheck,
		SOURCES.security,
		"events",
		"Events returned by the API",
		"bad",
	),
	countWidget(
		"error-events",
		"Tracked errors",
		"Client and server errors on record.",
		"system",
		Bug,
		SOURCES.errors,
		"errors",
		"Errors returned by the API",
		"bad",
	),
	countWidget(
		"open-incidents",
		"Open incidents",
		"Incidents awaiting action.",
		"system",
		AlertTriangle,
		SOURCES.incidents,
		"incidents",
		"Incidents returned by the API",
		"bad",
	),
	// ── Intelligence ─────────────────────────────────────────────
	seriesWidget(
		"volume-trend-30d",
		"Monthly volume",
		"Daily report volume over 30 days.",
		"intelligence",
		TrendingUp,
		SOURCES.trends30,
		"daily_frequency",
		"reports in 30 days",
		"accent",
	),
	listWidget(
		"emerging-7d",
		"Emerging this week",
		"Terms gaining volume in the last 7 days.",
		"intelligence",
		Sparkles,
		SOURCES.trends7,
		"emerging_topics",
		"name",
		"count",
		"violet",
	),
	barsWidget(
		"priority-7d",
		"Priority mix this week",
		"Priority distribution over 7 days.",
		"intelligence",
		AlertTriangle,
		SOURCES.trends7,
		"priority_trends",
		"warn",
	),
	gaugeWidget(
		"resolution-7d",
		"Resolution rate this week",
		"Share of reports resolved in the last 7 days.",
		"intelligence",
		Percent,
		SOURCES.trends7,
		"resolution_rate",
		"Marked solved",
		"good",
	),
	statWidget(
		"avg-resolution-7d",
		"Avg resolve time this week",
		"Mean days to resolution over 7 days.",
		"intelligence",
		Gauge,
		SOURCES.trends7,
		"avg_resolution_time_days",
		"Days, averaged over 7 days",
		"d",
		"warn",
	),
	barsWidget(
		"categories-7d",
		"Categories this week",
		"Where this week's reports are coming from.",
		"intelligence",
		ClipboardList,
		SOURCES.trends7,
		"category_distribution",
		"cyan",
	),

	// ══════════════════════════════════════════════════════════════
	// Added from the verified shape sweep
	// (scripts/endpoint-shapes.mjs). Every field below was read out of its
	// handler's 200-response before the widget was written.
	// ══════════════════════════════════════════════════════════════

	// ── Runtime performance ──────────────────────────────────────
	statWidget(
		"active-users",
		"Active users",
		"Users active during the measurement window.",
		"system",
		Users,
		SOURCES.performance,
		"active_users",
		"Active in the window",
		"",
		"accent",
	),
	statWidget(
		"error-rate",
		"Error rate per hour",
		"Errors observed each hour.",
		"system",
		Bug,
		SOURCES.performance,
		"error_rate_per_hour",
		"Errors per hour",
		"",
		"bad",
	),
	statWidget(
		"db-latency-ms",
		"Database latency",
		"Measured database round-trip.",
		"system",
		Database,
		SOURCES.performance,
		"database_latency_ms",
		"Milliseconds",
		"ms",
		"warn",
	),
	statWidget(
		"pending-jobs",
		"Pending jobs",
		"Work queued but not yet processed.",
		"system",
		Activity,
		SOURCES.performance,
		"pending_jobs",
		"Queued jobs",
		"",
		"warn",
	),
	statWidget(
		"perf-calc-time",
		"Metrics calculation time",
		"Time the performance endpoint itself takes.",
		"system",
		Gauge,
		SOURCES.performance,
		"total_calculation_ms",
		"Milliseconds",
		"ms",
		"neutral",
	),
	barsWidget(
		"api-response-times",
		"API response times",
		"Per-surface latency breakdown.",
		"system",
		Server,
		SOURCES.performance,
		"api_response_times",
		"warn",
	),

	// ── Insights ─────────────────────────────────────────────────
	barsWidget(
		"insights-top-categories",
		"Insight top categories",
		"Categories by volume from the insights engine.",
		"intelligence",
		BarChart3,
		SOURCES.insights,
		"top_categories",
		"accent",
),
	barsWidget(
		"insights-by-category",
		"Insight category split",
		"Full category breakdown from the insights engine.",
		"intelligence",
		ClipboardList,
		SOURCES.insights,
		"by_category",
		"cyan",
	),
	barsWidget(
		"insights-by-status",
		"Insight status split",
		"Status distribution from the insights engine.",
		"intelligence",
		Activity,
		SOURCES.insights,
		"by_status",
		"good",
),

	// ── Routing ──────────────────────────────────────────────────
	statWidget(
		"routed-total",
		"Reports routed",
		"Reports assigned to a department by the router.",
		"system",
		ClipboardList,
		SOURCES.routingStats,
		"total_routed",
		"Routed to a department",
		"",
		"accent",
	),
	barsWidget(
		"routed-by-department",
		"Routing by department",
		"Which department receives the most work.",
		"system",
		Users,
		SOURCES.routingStats,
		"by_department",
		"accent",
),
	barsWidget(
		"routed-by-status",
		"Routing by status",
		"Where routed reports currently sit.",
		"system",
		Activity,
		SOURCES.routingStats,
		"by_status",
		"cyan",
),
	barsWidget(
		"routed-by-priority",
		"Routing by priority",
		"Priority mix of routed reports.",
		"system",
		AlertTriangle,
		SOURCES.routingStats,
		"by_priority",
		"warn",
),

	// ── Abuse and moderation ─────────────────────────────────────
	countWidget(
		"spam-detections",
		"Spam detections",
		"Spam signals recorded by the sentinel.",
		"content",
		ShieldCheck,
		SOURCES.spam,
		"recent_detections",
		"Detections on record",
		"bad",
	),
	countWidget(
		"spam-quarantined",
		"Quarantined posts",
		"Held for review rather than published.",
		"content",
		FileWarning,
		SOURCES.spam,
		"quarantined_posts",
		"Posts held for review",
		"warn",
	),
	statWidget(
		"spam-24h",
		"Spam detections (24h)",
		"Spam signals in the last day.",
		"content",
		ShieldCheck,
		SOURCES.spam,
		"summary.detections_24h",
		"Detections in 24 hours",
		"",
		"bad",
	),
	countWidget(
		"spam-audit-entries",
		"Spam audit entries",
		"Spam actions written to the audit trail.",
		"content",
		ClipboardList,
		SOURCES.spam,
		"audit_entries",
		"Audit rows",
		"neutral",
	),
	statWidget(
		"duplicate-groups",
		"Duplicate groups",
		"Clusters of reports describing the same issue.",
		"content",
		GitMerge,
		SOURCES.duplicates,
		"total_groups",
		"Duplicate clusters",
		"",
		"violet",
	),

	// ── Admin operations ─────────────────────────────────────────
	statWidget(
		"action-center-total",
		"Action centre items",
		"Items in the admin action centre.",
		"pulse",
		ClipboardList,
		SOURCES.actionCenter,
		"total",
		"Items awaiting or in progress",
		"",
		"accent",
	),
	countWidget(
		"action-center-tasks",
		"Action centre tasks",
		"Open admin tasks returned by the action centre.",
		"pulse",
		ClipboardList,
		SOURCES.actionCenter,
		"tasks",
		"Tasks returned",
		"warn",
	),
	statWidget(
		"notifications-unread",
		"Unread notifications",
		"Notifications not yet read.",
		"pulse",
		Bell,
		SOURCES.notifications,
		"unread_count",
		"Unread",
		"",
		"warn",
	),
	statWidget(
		"notifications-total",
		"Notifications on record",
		"Every notification stored for the admin.",
		"pulse",
		Bell,
		SOURCES.notifications,
		"total",
		"Stored notifications",
		"",
		"neutral",
	),
	countWidget(
		"tracked-errors",
		"Tracked errors",
		"Errors in the tracked-error store.",
		"system",
		Bug,
		SOURCES.errors,
		"errors",
		"Errors on record",
		"bad",
	),
	countWidget(
		"recent-errors",
		"Recent errors",
		"Most recent error entries returned.",
		"system",
		Bug,
		SOURCES.errors,
		"recent",
		"Recent entries",
		"bad",
),
	statWidget(
		"incidents-total",
		"Incidents on record",
		"Incidents the detector has recorded.",
		"system",
		AlertTriangle,
		SOURCES.incidents,
		"total",
		"Recorded incidents",
		"",
		"bad",
	),
	countWidget(
		"incidents-list",
		"Incident list size",
		"Incidents returned in the current payload.",
		"system",
		AlertTriangle,
		SOURCES.incidents,
		"incidents",
		"Returned incidents",
		"warn",
	),

	// ── People and catalogue ─────────────────────────────────────
	statWidget(
		"comments-total",
		"Comments",
		"Total comments on the platform.",
		"content",
		MessageSquare,
		SOURCES.comments,
		"total",
		"Comments posted",
		"",
		"accent",
	),
	countWidget(
		"categories-count",
		"Categories",
		"Categories configured on the platform.",
		"content",
		ClipboardList,
		SOURCES.categoriesList,
		"categories",
		"Configured categories",
		"cyan",
	),
	countWidget(
		"community-members",
		"Community memberships",
		"Members across the communities returned.",
		"people",
		Users,
		SOURCES.communities,
		"members",
		"Returned memberships",
		"accent",
),

	// ── Autonomous workforce ─────────────────────────────────────
	statWidget(
		"agents-total",
		"Agents registered",
		"Agents in the roster.",
		"people",
		Sparkles,
		SOURCES.agentDashboard,
		"total_agents",
		"Agents in the roster",
		"",
		"violet",
	),
	statWidget(
		"agents-active",
		"Agents active",
		"Agents currently enabled.",
		"people",
		Activity,
		SOURCES.agentDashboard,
		"active_agents",
		"Enabled agents",
		"",
		"good",
	),
	statWidget(
		"agent-roles",
		"Agent roles",
		"Distinct roles defined.",
		"people",
		Users,
		SOURCES.agentDashboard,
		"total_roles",
		"Roles defined",
		"",
		"neutral",
	),
	statWidget(
		"workflows-active",
		"Active workflows",
		"Workflows the agents are running.",
		"people",
		Activity,
		SOURCES.agentDashboard,
		"active_workflows",
		"Active workflows",
		"",
		"good",
	),
	barsWidget(
		"agent-divisions",
		"Agents by division",
		"How the roster splits across divisions.",
		"people",
		Users,
		SOURCES.agentDashboard,
		"division_counts",
		"violet",
),
	barsWidget(
		"agent-tiers",
		"Agents by tier",
		"Roster split by capability tier.",
		"people",
		BarChart3,
		SOURCES.agentDashboard,
		"tier_counts",
		"cyan",
),

	// ── Database and audit detail ────────────────────────────────
	countWidget(
		"db-tables",
		"Tables monitored",
		"Critical tables the database check inspects.",
		"system",
		Database,
		SOURCES.dbStats,
		"tables",
		"Monitored tables",
		"neutral",
),
	barsWidget(
		"db-stale-by-table",
		"Stale rows by table",
		"Where the stale records are accumulating.",
		"system",
		AlertTriangle,
		SOURCES.dbStats,
		"stale_data",
		"warn",
),
	barsWidget(
		"db-dry-run",
		"Rows eligible for cleanup",
		"What the janitor would delete next pass — read-only estimate.",
		"system",
		FileWarning,
		SOURCES.dbStats,
		"dry_run_counts",
		"neutral",
),
	barsWidget(
		"audit-by-actor",
		"Audit by actor",
		"Which administrator performed the actions.",
		"system",
		Users,
		SOURCES.auditStats,
		"by_actor",
		"cyan",
),	barsWidget(
		"table-sizes",
		"Table sizes",
		"Row counts per table from the health probe.",
		"system",
		Database,
		SOURCES.health,
		"table_sizes",
		"neutral",
),

	// ── Workforce queue (shape pinned by the Ops Center contract) ─	// task_queue.* are numbers, not arrays — stat, not count.
	statWidget(
		"queue-open",
		"Queued tasks",
		"Tasks waiting to be claimed.",
		"people",
		ClipboardList,
		SOURCES.workforce,
		"task_queue.queued",
		"Waiting to be claimed",
		"",
		"warn",
	),
	statWidget(
		"queue-total",
		"Tasks tracked",
		"Every task the workforce has recorded.",
		"people",
		ClipboardList,
		SOURCES.workforce,
		"task_queue.total",
		"Tasks tracked",
		"",
		"neutral",
),
	statWidget(
		"queue-working",
		"Tasks in progress",
		"Workers currently executing.",
		"people",
		Activity,
		SOURCES.workforce,
		"task_queue.working",
		"Running now",
		"",
		"accent",
	),
	statWidget(
		"queue-completed",
		"Tasks completed",
		"Tasks that finished without error.",
		"people",
		CheckCircle2,
		SOURCES.workforce,
		"task_queue.completed",
		"Finished tasks",
		"",
		"good",
	),
	statWidget(
		"queue-failed",
		"Tasks failed",
		"Tasks that ended in failure.",
		"people",
		AlertTriangle,
		SOURCES.workforce,
		"task_queue.failed",
		"Failed tasks",
		"",
		"bad",
	),
	statWidget(
		"queue-blocked",
		"Tasks blocked",
		"Tasks that need a human decision.",
		"people",
		AlertTriangle,
		SOURCES.workforce,
		"task_queue.blocked",
		"Blocked tasks",
		"",
		"warn",
	),
	statWidget(
		"verified-today",
		"Verified outcomes today",
		"Actions that were verified to have changed state.",
		"people",
		ShieldCheck,
		SOURCES.workforce,
		"verified_today",
		"Verified today",
		"",
		"good",
	),
	gaugeWidget(
		"worker-success-rate",
		"Worker success rate",
		"Share of workforce tasks that succeeded.",
		"people",
		Percent,
		SOURCES.workforce,
		"metrics.success_rate",
		"Succeeded",
		"good",
	),
	statWidget(
		"verified-outcomes",
		"Verified outcomes",
		"Total verified outcomes recorded.",
		"people",
		ShieldCheck,
		SOURCES.workforce,
		"metrics.verified_outcomes",
		"Verified outcomes",
		"",
		"good",
	),
	statWidget(
		"worker-avg-duration",
		"Average task duration",
		"Mean time to complete a workforce task.",
		"people",
		Gauge,
		SOURCES.workforce,
		"metrics.avg_duration_ms",
		"Milliseconds",
		"ms",
		"neutral",
	),
	statWidget(
		"alerts-critical",
		"Critical alerts",
		"Unresolved critical alerts.",
		"system",
		AlertTriangle,
		SOURCES.workforce,
		"alerts.critical_open",
		"Critical and open",
		"",
		"bad",
	),
	statWidget(
		"alerts-open",
		"Open alerts",
		"Alerts awaiting acknowledgement.",
		"system",
		Bell,
		SOURCES.workforce,
		"alerts.open",
		"Awaiting acknowledgement",
		"",
		"warn",
	),

	// ── Platform totals (from the workforce platform block) ──────
	statWidget(
		"platform-posts",
		"Posts",
		"Posts on the platform.",
		"pulse",
		MessageSquare,
		SOURCES.workforce,
		"platform.posts",
		"Total posts",
		"",
		"accent",
	),
	statWidget(
		"platform-comments",
		"Comments",
		"Comments on the platform.",
		"pulse",
		MessageSquare,
		SOURCES.workforce,
		"platform.comments",
		"Total comments",
		"",
		"cyan",
	),
	statWidget(
		"platform-users",
		"Users",
		"Accounts on the platform.",
		"people",
		Users,
		SOURCES.workforce,
		"platform.users",
		"Total accounts",
		"",
		"accent",
	),
	statWidget(
		"platform-reactions",
		"Reactions",
		"Supports, hearts and votes cast.",
		"pulse",
		ThumbsUp,
		SOURCES.workforce,
		"platform.reactions",
		"Total reactions",
		"",
		"good",
	),
	statWidget(
		"platform-pending-reports",
		"Pending reports",
		"Reports still awaiting a decision.",
		"pulse",
		FileWarning,
		SOURCES.workforce,
		"platform.pending_reports",
		"Awaiting decision",
		"",
		"warn",
	),

	// ── Catalogue and audit volume ───────────────────────────────
	countWidget(
		"providers-count",
		"Model providers",
		"Providers configured for the AI stack.",
		"intelligence",
		Server,
		SOURCES.providers,
		"providers",
		"Configured providers",
		"violet",
	),
	countWidget(
		"meta-tools",
		"Agent tools",
		"Tools the agents can call.",
		"intelligence",
		Sparkles,
		SOURCES.metaAgent,
		"tools",
		"Registered tools",
		"violet",
	),
	countWidget(
		"meta-subagents",
		"Subagents",
		"Subagents available to the meta agent.",
		"intelligence",
		Users,
		SOURCES.metaAgent,
		"subagents",
		"Available subagents",
		"cyan",
	),
	statWidget(
		"event-agent-count",
		"Event agents",
		"Agents wired to platform events.",
		"intelligence",
		Activity,
		SOURCES.eventAgents,
		"count",
		"Event-driven agents",
		"",
		"violet",
	),
	statWidget(
		"audit-log-total",
		"Audit log entries",
		"Rows in the audit log.",
		"system",
		ClipboardList,
		SOURCES.auditLogs,
		"total",
		"Audit rows",
		"",
		"neutral",
	),
	countWidget(
		"audit-log-page",
		"Audit entries on page",
		"Entries in the current audit page.",
		"system",
		ClipboardList,
		SOURCES.auditLogs,
		"logs",
		"Entries on this page",
		"neutral",
	),
	countWidget(
		"feature-health-features",
		"Tracked features",
		"Features the health sweep monitors.",
		"system",
		ShieldCheck,
		SOURCES.featureHealth,
		"features",
		"Monitored features",
		"good",
	),
	barsWidget(
		"health-cache",
		"Cache state",
		"Cache counters from the health probe.",
		"system",
		Server,
		SOURCES.health,
		"cache",
		"cyan",
	),
	barsWidget(
		"volume-vs-previous",
		"This period vs last",
		"Report volume compared with the previous window.",
		"intelligence",
		TrendingUp,
		SOURCES.trends30,
		"recent_vs_previous",
		"accent",
	),
];

/** Look a widget definition up by id. */
export const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(
	WIDGETS.map((w) => [w.id, w]),
);

// ─── Small exported helpers used by the grid + tests ──────────────

/** Every distinct data source the given instances need, fetched once each. */
export function sourcesFor(instances: WidgetInstance[]): DataSource[] {
	const seen = new Set<string>();
	const out: DataSource[] = [];
	for (const inst of instances) {
		const def = WIDGET_BY_ID[inst.widgetId];
		const src = def?.source;
		if (src && !seen.has(src.key)) {
			seen.add(src.key);
			out.push(src);
		}
	}
	return out;
}

/** Clamp a span to the widget's own bounds so a stale layout cannot break the grid. */
export function clampSpan(def: WidgetDef, span: number): number {
	const [min, , max] = def.spans;
	return Math.max(min, Math.min(max, span));
}

export { at as readPath, fmt as formatValue };
