// ═══════════════════════════════════════════════════════════════════
// LIVE PULSE — the widget strip that lives on the main dashboard
// ═══════════════════════════════════════════════════════════════════
// Five curated, decision-first workforce widgets (research: max ~6 per
// group, one verdict each, drill-down on demand, freshness stamped).
// Reuses the tested widget catalog (WIDGET_BY_ID renderers + sourcesFor
// fetching) — no second data layer, no invented numbers. Each widget
// drills into the tab where its workflow lives.
// ═══════════════════════════════════════════════════════════════════

import { ArrowUpRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
	sourcesFor,
	WIDGET_BY_ID,
	type AccentKey,
	type DataSource,
	type WidgetCtx,
	type WidgetInstance,
} from "../../lib/dashboard/widgets";

const PULSE: Array<{ id: string; tab: string }> = [
	{ id: "alerts-open", tab: "ops-center" },
	{ id: "verified-today", tab: "ops-center" },
	{ id: "queue-open", tab: "ops-center" },
	{ id: "worker-success-rate", tab: "ops-center" },
	{ id: "volume-trend-7d", tab: "posts" },
];

function synthInstances(): WidgetInstance[] {
	const out: WidgetInstance[] = [];
	for (const p of PULSE) {
		if (!WIDGET_BY_ID[p.id]) continue;
		out.push({
			iid: `pulse-${p.id}`,
			widgetId: p.id,
			span: 3,
			height: 0,
			opacity: 1,
			accent: "accent" as AccentKey,
			glass: false,
		});
	}
	return out;
}

function ageAgo(at: number | null): string {
	if (!at) return "";
	const s = Math.max(0, Math.round((Date.now() - at) / 1000));
	if (s < 10) return "updated just now";
	if (s < 60) return `updated ${s}s ago`;
	return `updated ${Math.round(s / 60)}m ago`;
}

export default function PulseStrip({
	onDrill,
}: {
	onDrill: (tab: string) => void;
}) {
	const [data, setData] = useState<Record<string, unknown>>({});
	const [loading, setLoading] = useState<Record<string, boolean>>({});
	const [failed, setFailed] = useState<Record<string, boolean>>({});
	const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

	const load = useCallback(async (targets: DataSource[]) => {
		if (!targets.length) return;
		await Promise.all(
			targets.map(async (s) => {
				try {
					const r = s.slow ? await api.getSlow(s.path) : await api.get(s.path);
					setData((prev) => ({ ...prev, [s.key]: r }));
					setFailed((prev) => ({ ...prev, [s.key]: false }));
				} catch {
					setFailed((prev) => ({ ...prev, [s.key]: true }));
				} finally {
					setLoading((prev) => ({ ...prev, [s.key]: false }));
				}
			}),
		);
		setRefreshedAt(Date.now());
	}, []);

	const refresh = useCallback(async () => {
		const instances = synthInstances();
		const targets = sourcesFor(instances);
		setLoading((prev) => {
			const next = { ...prev };
			for (const s of targets) if (!(s.key in (prev as object))) next[s.key] = true;
			return next;
		});
		await load(targets);
	}, [load]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const ctx: WidgetCtx = { data, loading, failed, refreshedAt };

	return (
		<section className="card p-4" aria-label="Live workforce pulse">
			<div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
				<h2 className="flex items-center gap-2 font-display font-semibold text-sm">
					<span className="inline-block w-1 h-4 rounded-full bg-accent" />
					Live pulse
				</h2>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="text-[10px] font-semibold text-accent hover:underline"
						onClick={() => void refresh()}
						aria-label="Refresh live pulse"
					>
						<RefreshCw size={11} className="inline mr-1" /> Refresh
					</button>
					<span className="text-[10px] text-ink3" aria-live="polite">
						{refreshedAt ? ageAgo(refreshedAt) : "loading…"}
					</span>
				</div>
			</div>
			<div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
				{PULSE.map((p) => {
					const def = WIDGET_BY_ID[p.id];
					if (!def) return null;
					const Icon = def.icon;
					const isFailed = def.source ? failed[def.source.key] : false;
					return (
						<div
							key={p.id}
							className="rounded-xl border border-border/60 bg-surface2/40 p-3 min-w-0"
						>
							<div className="flex items-center gap-1.5 mb-1.5">
								<Icon size={12} className="text-accent shrink-0" aria-hidden />
								<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 truncate">
									{def.name}
								</p>
							</div>
							<div className="min-h-12">{def.render(ctx)}</div>
							<div className="flex items-center justify-between mt-1.5">
								<span className="text-[9px] text-ink3">
									{isFailed ? "unavailable — retrying" : ageAgo(refreshedAt)}
								</span>
								<button
									type="button"
									onClick={() => onDrill(p.tab)}
									className="text-[10px] font-semibold text-accent hover:underline flex items-center gap-0.5"
									aria-label={`Open ${def.name} details`}
								>
									View <ArrowUpRight size={10} />
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
