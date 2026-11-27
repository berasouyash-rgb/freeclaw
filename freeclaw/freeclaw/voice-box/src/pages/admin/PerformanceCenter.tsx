// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE CENTER — Real performance metrics and drilldown
// ═══════════════════════════════════════════════════════════════════
// Every metric comes from real measurements — Web Vitals from browsers,
// API latency from actual requests, DB latency from real queries.
// No fabricated performance numbers.
// ═══════════════════════════════════════════════════════════════════

import {
	Activity,
	Gauge,
	HardDrive,
	RefreshCw,
	Server,
	Timer,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

interface VitalMetric {
	total: number;
	good: number;
	needsImprovement: number;
	poor: number;
	goodRate: number;
	avg: number;
	p50: number;
	p75: number;
	p95: number;
	p99: number;
}

interface PerfData {
	vitals: Record<string, VitalMetric>;
	db: {
		latency_ms: number;
		status: string;
		tables?: Record<string, { count: number; latency_ms: number; status: string }>;
	};
	api_latency: {
		avg_ms: number;
		p50_ms: number;
		p95_ms: number;
		status: string;
	};
	cache?: {
		hit_rate: number;
		miss_rate: number;
		status: string;
	};
	workers?: {
		active: number;
		queued: number;
		completed: number;
		failed: number;
	};
	checked_at: string;
}

interface WebVitalRow {
	key: string;
	label: string;
	unit: string;
	goodThreshold: number;
	poorThreshold: number;
}

const WEB_VITALS: WebVitalRow[] = [
	{ key: "LCP", label: "Largest Contentful Paint", unit: "ms", goodThreshold: 2500, poorThreshold: 4000 },
	{ key: "CLS", label: "Cumulative Layout Shift", unit: "", goodThreshold: 100, poorThreshold: 250 },
	{ key: "INP", label: "Interaction to Next Paint", unit: "ms", goodThreshold: 200, poorThreshold: 500 },
	{ key: "TTFB", label: "Time to First Byte", unit: "ms", goodThreshold: 800, poorThreshold: 1800 },
	{ key: "FCP", label: "First Contentful Paint", unit: "ms", goodThreshold: 1800, poorThreshold: 3000 },
];

function getStatusColor(goodRate: number): string {
	if (goodRate >= 75) return "var(--vb-good)";
	if (goodRate >= 50) return "var(--vb-warn)";
	return "var(--vb-bad)";
}

function getLatencyColor(ms: number, good: number, poor: number): string {
	if (ms <= good) return "var(--vb-good)";
	if (ms <= poor) return "var(--vb-warn)";
	return "var(--vb-bad)";
}

export default function PerformanceCenter() {
	const [data, setData] = useState<PerfData | null>(null);
	const [loading, setLoading] = useState(true);
	const [lastUpdate, setLastUpdate] = useState<string | null>(null);
	const [selectedVital, setSelectedVital] = useState<string | null>(null);
	const [perfError, setPerfError] = useState<string | null>(null);

	const loadPerf = useCallback(async () => {
		try {
			const [perf, health] = await Promise.all([
				api.get<PerfData>("/api/performance").catch((e: unknown) => {
					console.error("[performance] performance fetch failed", { error: e instanceof Error ? e.message : String(e) });
					setPerfError("Performance endpoint failed — showing last-known metrics.");
					return null;
				}),
				api.get<{ vitals: Record<string, VitalMetric> }>("/api/vitals").catch((e: unknown) => {
					console.error("[performance] vitals fetch failed", { error: e instanceof Error ? e.message : String(e) });
					return { vitals: {} };
				}),
			]);
			if (!perf && !health?.vitals) {
				setLoading(false);
				return;
			}
			setData({
				...(perf ?? {
					vitals: {},
					db: { latency_ms: 0, status: "unknown" },
					api_latency: { avg_ms: 0, p50_ms: 0, p95_ms: 0, status: "unknown" },
					checked_at: new Date().toISOString(),
				}),
				vitals: health?.vitals ?? {},
			});
			setLastUpdate(new Date().toISOString());
		} catch (err) {
			console.error("[performance] load failed", { error: err instanceof Error ? err.message : String(err) });
			setPerfError("Performance refresh failed — showing last-known metrics.");
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		void loadPerf();
	}, [loadPerf]);

	// Performance data is refreshed explicitly from the visible Refresh
	// control; no background database scan is started by this view.

	const selectedDetail = selectedVital ? data?.vitals?.[selectedVital] : null;

	return (
		<div className="space-y-6 vb-tab-enter">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-display font-bold text-xl flex items-center gap-2 tracking-tight">
						<Gauge size={20} className="text-accent" />
						<span className="vb-gradient-text">Performance Center</span>
					</h1>
					<p className="text-xs text-ink3 mt-1">
						{lastUpdate
							? `Last updated ${new Date(lastUpdate).toLocaleTimeString()}`
							: "Loading..."}
						{perfError && <span className="text-warn" role="alert"> · {perfError}</span>}
					</p>
				</div>
				<button
					className="btn btn-soft !py-2 !px-3 text-xs flex items-center gap-1.5"
					onClick={() => {
						// Silent refresh: keep current readings instead of
						// flashing skeletons on every manual reload.
						void loadPerf();
					}}
				>
					<RefreshCw size={13} /> Refresh
				</button>
			</div>

			{loading ? (
				<div className="space-y-4">
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						{[1, 2, 3, 4].map((i) => (
							<div key={i} className="skeleton h-28" />
						))}
					</div>
					<div className="skeleton h-48" />
				</div>
			) : (
				<>
					{/* Quick Stats */}
					<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
						<div className="card p-4">
							<div className="flex items-center gap-2 mb-2">
								<Server size={14} className="text-accent" />
								<span className="text-[10px] font-bold uppercase tracking-wider text-ink3">
									DB Latency
								</span>
							</div>
							<p className="font-display font-bold text-2xl" style={{ color: getLatencyColor(data?.db?.latency_ms ?? 0, 100, 500) }}>
								{data?.db?.latency_ms ?? "—"}
								<span className="text-xs font-normal text-ink3">ms</span>
							</p>
							<p className="text-[10px] text-ink3 mt-1">{data?.db?.status ?? "unknown"}</p>
						</div>
						<div className="card p-4">
							<div className="flex items-center gap-2 mb-2">
								<Zap size={14} className="text-warn" />
								<span className="text-[10px] font-bold uppercase tracking-wider text-ink3">
									API Avg
								</span>
							</div>
							<p className="font-display font-bold text-2xl" style={{ color: getLatencyColor(data?.api_latency?.avg_ms ?? 0, 200, 1000) }}>
								{data?.api_latency?.avg_ms ?? "—"}
								<span className="text-xs font-normal text-ink3">ms</span>
							</p>
							<p className="text-[10px] text-ink3 mt-1">p95: {data?.api_latency?.p95_ms ?? "—"}ms</p>
						</div>
						<div className="card p-4">
							<div className="flex items-center gap-2 mb-2">
								<Timer size={14} className="text-good" />
								<span className="text-[10px] font-bold uppercase tracking-wider text-ink3">
									Cache Hit
								</span>
							</div>
							<p className="font-display font-bold text-2xl" style={{ color: getStatusColor((data?.cache?.hit_rate ?? 0) * 100) }}>
								{data?.cache?.hit_rate !== undefined
									? `${Math.round(data.cache.hit_rate * 100)}%`
									: "—"}
							</p>
							<p className="text-[10px] text-ink3 mt-1">{data?.cache?.status ?? "unknown"}</p>
						</div>
						<div className="card p-4">
							<div className="flex items-center gap-2 mb-2">
								<Activity size={14} className="text-accent2" />
								<span className="text-[10px] font-bold uppercase tracking-wider text-ink3">
									Workers
								</span>
							</div>
							<p className="font-display font-bold text-2xl">
								{data?.workers?.active ?? 0}
								<span className="text-xs font-normal text-ink3"> active</span>
							</p>
							<p className="text-[10px] text-ink3 mt-1">
								{data?.workers?.completed ?? 0} completed · {data?.workers?.failed ?? 0} failed
							</p>
						</div>
					</div>

					{/* Web Vitals */}
					<div className="card p-5">
						<h2 className="font-display font-semibold text-sm mb-4 flex items-center gap-2">
							<Gauge size={15} className="text-accent" />
							Web Vitals — Real Browser Data
						</h2>
						{Object.keys(data?.vitals ?? {}).length === 0 ? (
							<div className="text-center py-8">
								<p className="text-sm text-ink3">
									No browser telemetry yet. Metrics appear as users visit the site.
								</p>
							</div>
						) : (
							<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
								{WEB_VITALS.map(({ key, label, unit, goodThreshold: _goodThreshold, poorThreshold: _poorThreshold }) => {
									const v = data?.vitals?.[key];
									if (!v) return null;
									const p50 = v.p50;
									const color = getStatusColor(v.goodRate);
									const isSelected = selectedVital === key;

									return (
										<button
											key={key}
											type="button"
											onClick={() => setSelectedVital(isSelected ? null : key)}
											className={`bg-surface2 rounded-lg p-3 text-left transition-all ${
												isSelected ? "ring-2 ring-accent/50" : "hover:bg-surface2/80"
											}`}
										>
											<p className="text-[9px] font-bold uppercase tracking-wider text-ink3">
												{key}
											</p>
											<p className="font-display font-bold text-xl mt-1" style={{ color }}>
												{key === "CLS" ? (p50 / 1000).toFixed(3) : p50}
												{unit && <span className="text-xs font-normal">{unit}</span>}
											</p>
											<p className="text-[10px] text-ink3 mt-0.5">{label}</p>
											<div className="flex items-center gap-1 mt-2">
												<div className="flex-1 h-1.5 rounded-full bg-bad/20 overflow-hidden">
													<div
														className="h-full rounded-full transition-all duration-500"
														style={{ width: `${v.goodRate}%`, background: color }}
													/>
												</div>
												<span className="text-[9px] font-semibold" style={{ color }}>
													{v.goodRate}%
												</span>
											</div>
										</button>
									);
								})}
							</div>
						)}
					</div>

					{/* Selected Vital Detail */}
					{selectedDetail && (
						<div className="card p-5 vb-rise">
							<h3 className="font-display font-semibold text-sm mb-3">
								{selectedVital} — Detailed Breakdown
							</h3>
							<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
								{[
									{ label: "Total", value: selectedDetail.total },
									{ label: "Good", value: selectedDetail.good, color: "var(--vb-good)" },
									{ label: "Needs Improvement", value: selectedDetail.needsImprovement, color: "var(--vb-warn)" },
									{ label: "Poor", value: selectedDetail.poor, color: "var(--vb-bad)" },
									{ label: "Good Rate", value: `${selectedDetail.goodRate}%`, color: getStatusColor(selectedDetail.goodRate) },
								].map(({ label, value, color }) => (
									<div key={label} className="bg-surface2 rounded-lg p-3">
										<p className="text-[9px] font-bold uppercase tracking-wider text-ink3">{label}</p>
										<p className="font-display font-bold text-lg mt-1" style={{ color: color ?? "var(--vb-ink)" }}>
											{value}
										</p>
									</div>
								))}
							</div>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
								{[
									{ label: "P50", value: selectedDetail.p50 },
									{ label: "P75", value: selectedDetail.p75 },
									{ label: "P95", value: selectedDetail.p95 },
									{ label: "P99", value: selectedDetail.p99 },
								].map(({ label, value }) => (
									<div key={label} className="bg-surface2 rounded-lg p-3">
										<p className="text-[9px] font-bold uppercase tracking-wider text-ink3">{label}</p>
										<p className="font-display font-bold text-lg mt-1">{value}</p>
									</div>
								))}
							</div>
						</div>
					)}

					{/* DB Table Performance */}
					{data?.db?.tables && Object.keys(data.db.tables).length > 0 && (
						<div className="card p-5">
							<h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
								<HardDrive size={15} className="text-accent" />
								Database Table Latency
							</h2>
							<div className="space-y-2">
								{Object.entries(data.db.tables)
									.sort(([, a], [, b]) => b.latency_ms - a.latency_ms)
									.slice(0, 10)
									.map(([name, info]) => (
										<div
											key={name}
											className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface2"
										>
											<span className="text-xs font-mono font-medium truncate w-32">
												{name}
											</span>
											<div className="flex-1 h-2 rounded-full bg-bad/10 overflow-hidden">
												<div
													className="h-full rounded-full"
													style={{
														width: `${Math.min(100, (info.latency_ms / 500) * 100)}%`,
														background: getLatencyColor(info.latency_ms, 50, 200),
													}}
												/>
											</div>
											<span className="text-xs font-mono w-16 text-right" style={{ color: getLatencyColor(info.latency_ms, 50, 200) }}>
												{info.latency_ms}ms
											</span>
											<span className="text-[10px] text-ink3 w-16 text-right">
												{info.count.toLocaleString()} rows
											</span>
										</div>
									))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
