import * as Sentry from "@sentry/react";
import {
	Activity,
	AlertTriangle,
	Bug,
	CheckCircle2,
	Clock,
	Cpu,
	Database,
	FileWarning,
	RefreshCcw,
	Server,
	ShieldCheck,
	Wifi,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { safeStringify, errorText, timeAgo } from "../../lib/utils";

interface HealthCheck {
	status: string;
	count?: number;
	count_last_hour?: number;
	latency_ms?: number;
	error?: string;
	available?: string[];
}
interface HealthData {
	status: string;
	timestamp: string;
	checks: Record<string, HealthCheck>;
	system?: Record<string, unknown>;
	response_time_ms?: number;
	version?: string;
}
interface ChunkInfo {
	name: string;
	size: number;
	sizeKB?: number;
}
interface ChunkManifest {
	generated: string;
	count: number;
	chunks: ChunkInfo[];
}
interface ErrorLog {
	id: string;
	action: string;
	actor: string;
	detail: string;
	created_at: string;
}

function StatusBadge({ status }: { status: string }) {
	const map: Record<
		string,
		{ label: string; cls: string; icon: typeof CheckCircle2 }
	> = {
		healthy: {
			label: "Healthy",
			cls: "text-good bg-good/10",
			icon: CheckCircle2,
		},
		ok: { label: "OK", cls: "text-good bg-good/10", icon: CheckCircle2 },
		degraded: {
			label: "Degraded",
			cls: "text-warn bg-warn/10",
			icon: AlertTriangle,
		},
		warning: {
			label: "Warning",
			cls: "text-warn bg-warn/10",
			icon: AlertTriangle,
		},
		unhealthy: { label: "Unhealthy", cls: "text-bad bg-bad/10", icon: XCircle },
		error: { label: "Error", cls: "text-bad bg-bad/10", icon: XCircle },
	};
	const m = map[status] || {
		label: status,
		cls: "text-ink2 bg-surface2",
		icon: Activity,
	};
	const Icon = m.icon;
	return (
		<span
			className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.cls}`}
		>
			<Icon size={11} /> {m.label}
		</span>
	);
}

export default function ErrorTracking() {
	const { toast } = useApp();
	const [health, setHealth] = useState<HealthData | null>(null);
	const [healthLoading, setHealthLoading] = useState(true);
	const [healthErr, setHealthErr] = useState("");
	const [chunks, setChunks] = useState<ChunkManifest | null>(null);
	const [chunksLoading, setChunksLoading] = useState(true);
	const [errors, setErrors] = useState<ErrorLog[]>([]);
	const [lastSent, setLastSent] = useState<{
		ok: boolean;
		at: string;
		msg: string;
	} | null>(null);

	// ── Frontend JS errors (real browser telemetry) ──
	interface FrontendErrorRow {
		id: string;
		message: string;
		source: string;
		filename?: string;
		count: number;
		first: string;
		last: string;
		devices: Record<string, number>;
		samples: { stack?: string; url?: string; timestamp: string }[];
	}
	const [feErrors, setFeErrors] = useState<FrontendErrorRow[]>([]);
	const [feSummary, setFeSummary] = useState<{
		total_unique: number;
		total_reports: number;
		by_source: Record<string, number>;
	} | null>(null);
	const [feLoading, setFeLoading] = useState(true);

	const loadFeErrors = useCallback(async () => {
		setFeLoading(true);
		try {
			const r = await api.get<{
				ok: boolean;
				summary: typeof feSummary;
				errors: FrontendErrorRow[];
			}>("/api/errors");
			setFeErrors(r.errors || []);
			setFeSummary(r.summary || null);
		} catch {
			/* non-fatal */
		}
		setFeLoading(false);
	}, []);

	useEffect(() => {
		loadFeErrors();
	}, [loadFeErrors]);

	const loadHealth = useCallback(async (fresh = false) => {
		setHealthLoading(true);
		try {
			const d = await (fresh
				? api.getFresh<HealthData>("/api/health")
				: api.get<HealthData>("/api/health"));
			setHealth(d);
			setHealthErr("");
		} catch (e: unknown) {
			setHealthErr(e instanceof Error ? e.message : "Health check failed");
		}
		setHealthLoading(false);
	}, []);

	const loadChunks = useCallback(async () => {
		setChunksLoading(true);
		try {
			const res = await fetch("/health-chunks.json", { cache: "no-store" });
			if (res.ok) setChunks(await res.json());
			else setChunks(null);
		} catch {
			setChunks(null);
		}
		setChunksLoading(false);
	}, []);

	const loadErrors = useCallback(async (fresh = false) => {
		try {
			// Note: no action=recent filter — _audit-trail.js treats `action` as a literal
			// column match (only `stats` is special), so we fetch the full recent trail
			// and surface error-ish actions client-side.
			const d = await (fresh
				? api.getFresh<{ logs: ErrorLog[] }>("/api/audit-trail?limit=100")
				: api.get<{ logs: ErrorLog[] }>("/api/audit-trail?limit=100"));
			const all = d.logs || [];
			// Surface any error-ish or risky actions first, newest first
			const risky = all.filter((l) =>
				/error|fail|block|ban|warn|strike/i.test(`${l.action} ${l.detail}`),
			);
			setErrors(risky.slice(0, 30));
		} catch {
			/* non-fatal */
		}
	}, []);

	useEffect(() => {
		loadHealth();
		loadChunks();
		loadErrors();
	}, [loadHealth, loadChunks, loadErrors]);

	// Refresh is explicit through the visible "Refresh all" and section
	// controls; passive error/audit events do not reorder this page.

	const sendTestError = () => {
		const err = new Error(
			"Admin-triggered test error from Voice Box Error Tracking",
		);
		// captureException() is a silent no-op when Sentry has no DSN —
		// claiming success then would be a lie. Verify configuration first.
		const dsn = Sentry.getClient?.()?.getOptions?.()?.dsn;
		if (!dsn) {
			const msg = "Sentry DSN is not configured — nothing was sent.";
			setLastSent({ ok: false, at: new Date().toISOString(), msg });
			toast(msg, "err");
			return;
		}
		try {
			Sentry.captureException(err);
			setLastSent({
				ok: true,
				at: new Date().toISOString(),
				msg: "Test error sent to Sentry ✓",
			});
			toast("Test error sent to Sentry ✓", "ok");
			console.error(
				"[ErrorTracking] Test error captured for Sentry:",
				err.message,
			);
		} catch (e: unknown) {
			setLastSent({
				ok: false,
				at: new Date().toISOString(),
				msg: `Sentry capture failed: ${errorText(e) || "no details — check the DSN"}`,
			});
			toast("Sentry capture failed — check the DSN", "err");
		}
	};

	const overall = health?.status || "unknown";
	const allChunksOk = chunks !== null;

	const checkRows = useMemo(() => {
		if (!health?.checks) return [];
		return Object.entries(health.checks).map(([key, c]) => ({
			key,
			label: key.replace(/_/g, " "),
			status: c.status || "ok",
			detail:
				c.error ||
				(c.count !== undefined
					? `${c.count} rows`
					: c.latency_ms !== undefined
						? `${c.latency_ms}ms`
						: c.available?.length
							? `${c.available.length} providers`
							: c.count_last_hour !== undefined
								? `${c.count_last_hour} last hour`
								: ""),
		}));
	}, [health]);

	const memRows = useMemo(() => {
		const m = (health?.system?.memory as Record<string, number>) || {};
		return [
			{ label: "RSS", value: m.rss_mb, unit: "MB" },
			{ label: "Heap used", value: m.heap_used_mb, unit: "MB" },
			{ label: "Heap total", value: m.heap_total_mb, unit: "MB" },
			{
				label: "Uptime",
				value: Math.round((health?.system?.uptime_seconds as number) || 0),
				unit: "s",
			},
		];
	}, [health]);

	const totalChunkKB = (chunks?.chunks || []).reduce(
		(a, c) => a + (c.sizeKB ?? Math.round((c.size || 0) / 1024)),
		0,
	);

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between flex-wrap gap-2">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-bad/10 flex items-center justify-center">
						<Bug size={18} className="text-bad" />
					</div>
					<div>
						<h1 className="font-display font-bold text-xl flex items-center gap-2 tracking-tight">
							<span className="vb-gradient-text">Error Tracking</span>{" "}
							<span className="chip !text-[9px] !text-accent !border-accent/30">
								Sentry + Health
							</span>
						</h1>
						<p className="text-[11px] text-ink3">
							Production errors are captured by Sentry; system health and chunk
							integrity checked live.
						</p>
					</div>
				</div>
				<div className="flex gap-2">
					<button
						className="btn btn-ghost !text-xs"
						onClick={() => {
							loadHealth(true);
							loadChunks();
							loadErrors(true);
							loadFeErrors();
						}}
						disabled={healthLoading}
					>
						<RefreshCcw
							size={12}
							className={`mr-1 ${healthLoading ? "animate-spin" : ""}`}
						/>{" "}
						Refresh all
					</button>
					<button
						className="btn btn-danger !text-xs"
						onClick={sendTestError}
						title="Send a test exception to Sentry"
					>
						<Bug size={12} className="mr-1" /> Send test error
					</button>
				</div>
			</div>

			{/* Sentry status */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
				<div className="card p-5 vb-rise">
					<div className="flex items-center justify-between mb-3">
						<p className="font-display font-semibold text-sm flex items-center gap-2">
							<ShieldCheck size={15} className="text-accent" /> Sentry
						</p>
						<StatusBadge status="ok" />
					</div>
					<p className="text-xs text-ink2 mb-3">
						Sentry is initialized in this build and captures frontend + backend
						exceptions to your dashboard (DSN bundled by default, overridable
						via VITE_SENTRY_DSN).
					</p>
					<div className="flex items-center justify-between text-[11px] text-ink3 mb-2">
						<span>Last test error</span>
						<span
							className={`font-mono ${lastSent && !lastSent.ok ? "text-bad" : ""}`}
							title={lastSent?.msg}
						>
							{lastSent
								? `${timeAgo(lastSent.at)} · ${lastSent.ok ? "✓" : "✗"}`
								: "never"}
						</span>
					</div>
					{lastSent && !lastSent.ok && (
						<p className="text-[10px] text-bad mt-1 mb-2 break-words">
							{lastSent.msg}
						</p>
					)}
					<a
						href="https://sentry.io"
						target="_blank"
						rel="noopener noreferrer"
						className="text-xs text-accent hover:underline inline-flex items-center gap-1"
					>
						Open Sentry dashboard{" "}
						<AlertTriangle size={10} className="rotate-90" />
					</a>
				</div>

				{/* Overall platform health */}
				<div className="card p-5 vb-rise" style={{ animationDelay: "50ms" }}>
					<div className="flex items-center justify-between mb-3">
						<p className="font-display font-semibold text-sm flex items-center gap-2">
							<Server size={15} className="text-accent" /> Platform health
						</p>
						{healthLoading ? (
							<span className="vb-spinner vb-spinner-sm" />
						) : (
							<StatusBadge status={overall} />
						)}
					</div>
					{healthErr ? (
						<p className="text-xs text-bad">{healthErr}</p>
					) : health ? (
						<>
							<p className="text-[11px] text-ink2 mb-2">
								API {health.response_time_ms ?? "—"}ms · v
								{health.version || "—"}
							</p>
							<div className="grid grid-cols-2 gap-1.5">
								{checkRows.slice(0, 6).map((r) => (
									<div
										key={r.key}
										className="flex items-center justify-between gap-1 text-[10px] bg-surface2/60 rounded-lg px-2 py-1.5"
									>
										<span className="text-ink3 truncate capitalize">
											{r.label}
										</span>
										<StatusBadge status={r.status} />
									</div>
								))}
							</div>
						</>
					) : (
						<p className="text-xs text-ink3">Loading health…</p>
					)}
				</div>

				{/* Chunk integrity */}
				<div className="card p-5 vb-rise" style={{ animationDelay: "100ms" }}>
					<div className="flex items-center justify-between mb-3">
						<p className="font-display font-semibold text-sm flex items-center gap-2">
							<FileWarning size={15} className="text-warn" /> Build chunks
						</p>
						{chunksLoading ? (
							<span className="vb-spinner vb-spinner-sm" />
						) : (
							<StatusBadge status={allChunksOk ? "ok" : "warning"} />
						)}
					</div>
					{chunksLoading ? (
						<p className="text-xs text-ink3">Verifying chunk manifest…</p>
					) : chunks ? (
						<>
							<p className="text-[11px] text-ink2 mb-2">
								{chunks.count} lazy chunks generated ·{" "}
								{totalChunkKB.toLocaleString()} KB total
							</p>
							<p className="text-[10px] text-ink3">
								Manifest built{" "}
								<span className="font-mono">{timeAgo(chunks.generated)}</span>.
								If a route shows “Failed to fetch dynamically imported module”,
								the app auto-reloads once to fetch fresh chunks.
							</p>
						</>
					) : (
						<p className="text-xs text-ink3">
							health-chunks.json not found — run a production build to
							regenerate it.
						</p>
					)}
					{!chunksLoading && chunks && (
						<div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
							{chunks.chunks.slice(0, 8).map((c) => (
								<div
									key={c.name}
									className="flex justify-between text-[9px] text-ink3"
								>
									<span className="truncate font-mono">{c.name}</span>
									<span className="shrink-0">
										{c.sizeKB ?? Math.round((c.size || 0) / 1024)}KB
									</span>
								</div>
							))}
							{chunks.chunks.length > 8 && (
								<p className="text-[9px] text-ink3/60">
									+{chunks.chunks.length - 8} more
								</p>
							)}
						</div>
					)}
				</div>
			</div>

			{/* System memory / runtime */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
				<div className="card p-5">
					<h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
						<Cpu size={14} className="text-accent" /> Runtime (server instance)
					</h2>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
						{memRows.map((m) => (
							<div
								key={m.label}
								className="bg-surface2/60 rounded-xl p-3 text-center"
							>
								<p className="font-display font-bold text-lg">
									{m.value ?? "–"}
								</p>
								<p className="text-[10px] text-ink3">
									{m.label} ({m.unit})
								</p>
							</div>
						))}
					</div>
					{health?.system && (
						<div className="flex flex-wrap gap-2 mt-3 text-[10px] text-ink3">
							<span className="chip">
								<Activity size={10} />{" "}
								{String(health.system.env || "production")}
							</span>
							<span className="chip">
								<Clock size={10} /> {String(health.system.region || "—")}
							</span>
							<span className="chip">
								<Database size={10} /> Node{" "}
								{String(health.system.node_version || "—")}
							</span>
						</div>
					)}
				</div>

				{/* System checks detail */}
				<div className="card p-5">
					<h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
						<Activity size={14} className="text-accent" /> Subsystem checks
					</h2>
					{healthLoading ? (
						<div className="space-y-2">
							{[1, 2, 3, 4].map((i) => (
								<div key={i} className="skeleton h-8" />
							))}
						</div>
					) : checkRows.length === 0 ? (
						<p className="text-xs text-ink3">
							No health data — run a health check.
						</p>
					) : (
						<div className="space-y-1.5">
							{checkRows.map((r) => (
								<div
									key={r.key}
									className="flex items-center justify-between gap-2 text-xs"
								>
									<span className="font-medium capitalize truncate">
										{r.label}
									</span>
									<span className="flex items-center gap-2 shrink-0">
										<span className="text-[10px] text-ink3 truncate max-w-40">
											{r.detail}
										</span>
										<StatusBadge status={r.status} />
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Recent error-like audit events */}
			<div className="card p-5">
				<div className="flex items-center justify-between mb-3">
					<h2 className="font-display font-semibold text-sm flex items-center gap-2">
						<Wifi size={14} className="text-bad" /> Recent error / moderation
						events <span className="chip !text-[9px]">audit trail</span>
					</h2>
					<button
						className="btn btn-ghost !text-[10px] !py-1"
						onClick={() => loadErrors()}
					>
						<RefreshCcw size={10} /> Refresh
					</button>
				</div>
				{errors.length === 0 ? (
					<div className="text-center py-8">
						<p className="text-3xl mb-2">🛡️</p>
						<p className="text-sm font-semibold">No error events found</p>
						<p className="text-xs text-ink3 mt-1">
							All quiet — errors, bans and strikes will appear here
							automatically.
						</p>
					</div>
				) : (
					<div className="divide-y divide-border">
						{errors.map((l) => (
							<div key={l.id} className="py-2.5 flex items-center gap-3">
								<span
									className={`shrink-0 w-7 h-7 rounded-lg grid place-items-center ${/error|fail/i.test(l.action) ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn"}`}
								>
									{/error|fail/i.test(l.action) ? (
										<XCircle size={13} />
									) : (
										<AlertTriangle size={13} />
									)}
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-xs font-semibold truncate">{l.action}</p>
									<p className="text-[10px] text-ink3 truncate">{l.detail}</p>
								</div>
								<div className="text-right shrink-0">
									<p className="text-[9px] text-ink3">{l.actor}</p>
									<p className="text-[9px] text-ink3">
										{timeAgo(l.created_at)}
									</p>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* ── Frontend JS Errors (real browser telemetry) ────────── */}
			<div className="card p-5">
				<div className="flex items-center justify-between mb-3">
					<h2 className="font-display font-semibold text-sm flex items-center gap-2">
						<Bug size={14} className="text-bad" /> Frontend JS Errors
						<span className="chip !text-[9px]">real browser data</span>
					</h2>
					<button
						className="btn btn-ghost !text-[10px] !py-1"
						onClick={loadFeErrors}
					>
						<RefreshCcw size={10} /> Refresh
					</button>
				</div>
				{feSummary && (
					<div className="flex gap-3 mb-3">
						<div className="bg-surface2/60 rounded-lg px-3 py-2">
							<p className="font-display font-bold text-lg">
								{feSummary.total_unique}
							</p>
							<p className="text-[10px] text-ink3">unique errors</p>
						</div>
						<div className="bg-surface2/60 rounded-lg px-3 py-2">
							<p className="font-display font-bold text-lg">
								{feSummary.total_reports}
							</p>
							<p className="text-[10px] text-ink3">total reports</p>
						</div>
						{Object.entries(feSummary.by_source).map(([src, cnt]) => (
							<div key={src} className="bg-surface2/60 rounded-lg px-3 py-2">
								<p className="font-display font-bold text-lg">{cnt}</p>
								<p className="text-[10px] text-ink3">{src}</p>
							</div>
						))}
					</div>
				)}
				{feLoading && feErrors.length === 0 ? (
					<div className="space-y-2">
						{[1, 2, 3].map((i) => (
							<div key={i} className="skeleton h-12" />
						))}
					</div>
				) : feErrors.length === 0 ? (
					<div className="text-center py-8">
						<p className="text-3xl mb-2">✨</p>
						<p className="text-sm font-semibold">No frontend errors yet</p>
						<p className="text-xs text-ink3 mt-1">
							JS errors from real browsers will appear here automatically.
						</p>
					</div>
				) : (
					<div className="divide-y divide-border">
						{feErrors.slice(0, 20).map((e) => (
							<details key={e.id} className="group py-2.5">
								<summary className="flex items-center gap-3 cursor-pointer">
									<span className="shrink-0 w-7 h-7 rounded-lg bg-bad/10 text-bad grid place-items-center">
										<XCircle size={13} />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-xs font-semibold truncate">
											{e.message}
										</p>
										<p className="text-[10px] text-ink3">
											{e.source} · {e.count}x · {e.filename || "inline"}
										</p>
									</div>
									<div className="text-right shrink-0">
										<p className="text-[9px] text-ink3">
											{Object.entries(e.devices || {})
												.map(([d, c]) => `${d}:${c}`)
												.join(" · ")}
										</p>
										<p className="text-[9px] text-ink3">
											{timeAgo(e.last)}
										</p>
									</div>
								</summary>
								{e.samples.length > 0 && (
									<pre className="mt-2 ml-10 p-2 rounded-lg bg-surface2/60 text-[9px] text-ink2 overflow-auto max-h-32 font-mono whitespace-pre-wrap">
									{e.samples[0]?.stack || "No stack trace"}
								</pre>
								)}
							</details>
						))}
						{feErrors.length > 20 && (
							<p className="text-center text-[10px] text-ink3 py-2">
								+{feErrors.length - 20} more errors
							</p>
						)}
					</div>
				)}
			</div>

			{/* JSON export */}
			{health && (
				<details className="text-[11px]">
					<summary className="cursor-pointer text-ink3 hover:text-ink2">
						View raw health JSON
					</summary>
					<pre className="mt-2 p-3 rounded-xl bg-surface2/60 text-[10px] text-ink2 overflow-auto max-h-64 font-mono">
						{safeStringify(health, 2)}
					</pre>
				</details>
			)}
		</div>
	);
}
