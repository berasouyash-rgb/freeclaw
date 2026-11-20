import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	Gavel,
	Loader2,
	RefreshCw,
	RotateCcw,
	Search,
	ShieldAlert,
	ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/utils";
import { getSlangDraftCount } from "../../lib/schoolIssueAI";

interface StrikeRecord {
	id: string;
	author_id: string;
	reason: string;
	severity: "warning" | "strike" | "ban";
	source: "ai_moderation" | "admin_manual" | "report_escalation" | "draft_slang";
	created_at: string;
	status: "active" | "appealed" | "pardoned" | "expired";
	admin_notes?: string;
	target_title?: string;
}

interface ReportFallbackRecord {
	id?: string;
	target_author_id?: string;
	author_id?: string;
	reason?: string;
	resolved?: boolean;
	source?: "ai_moderation" | "admin_manual" | "report_escalation" | "draft_slang";
	created_at?: string;
	target_title?: string;
}

export default function Strikes() {
	const { toast } = useApp();
	const [strikes, setStrikes] = useState<StrikeRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [actionBusy, setActionBusy] = useState<string | null>(null);

	const loadStrikes = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			// Query admin reports and moderation logs
			const res = await api.get<{ strikes?: StrikeRecord[]; items?: StrikeRecord[] }>(
				"/api/admin?action=strikes",
			).catch(async (): Promise<{ strikes?: StrikeRecord[]; items?: StrikeRecord[] }> => {
				// Fallback to reports endpoint if specialized strikes endpoint is mock/standby
				const rep = await api.get<ReportFallbackRecord[]>("/api/reports?resolved=all").catch(() => []);
				const mapped: StrikeRecord[] = (Array.isArray(rep) ? rep : []).map((r, i) => ({
					id: r.id || `strike_${i}`,
					author_id: r.target_author_id || r.author_id || "anon_student",
					reason: r.reason || "Community standards violation flagged by moderation",
					severity: r.resolved ? "warning" : "strike",
					source: r.source || "ai_moderation",
					created_at: r.created_at || new Date().toISOString(),
					status: r.resolved ? "pardoned" : "active",
					target_title: r.target_title || "Reported submission",
				}));
				return { strikes: mapped, items: mapped };
			});

			const list = res.strikes || res.items || [];
			setStrikes(list);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load strikes");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadStrikes();
	}, [loadStrikes]);

	const handlePardon = async (id: string) => {
		if (actionBusy) return;
		setActionBusy(id);
		try {
			await api.put("/api/admin", { action: "pardon_strike", strike_id: id });
			setStrikes((prev) =>
				prev.map((s) => (s.id === id ? { ...s, status: "pardoned" } : s)),
			);
			toast("Strike pardoned — student standing restored", "ok");
		} catch (e) {
			toast(e instanceof Error ? e.message : "Failed to pardon strike", "err");
		} finally {
			setActionBusy(null);
		}
	};

	const filteredStrikes = useMemo(() => {
		return strikes.filter((s) => {
			if (statusFilter !== "all" && s.status !== statusFilter) return false;
			if (search) {
				const q = search.toLowerCase();
				return (
					s.author_id.toLowerCase().includes(q) ||
					s.reason.toLowerCase().includes(q) ||
					(s.target_title && s.target_title.toLowerCase().includes(q))
				);
			}
			return true;
		});
	}, [strikes, statusFilter, search]);

	const totalActive = useMemo(() => strikes.filter((s) => s.status === "active").length, [strikes]);
	const totalAppealed = useMemo(() => strikes.filter((s) => s.status === "appealed").length, [strikes]);
	const totalPardoned = useMemo(() => strikes.filter((s) => s.status === "pardoned").length, [strikes]);
	const draftSlangs = useMemo(() => getSlangDraftCount(), []);

	return (
		<div className="space-y-6 vb-page-enter">
			{/* ── Top Header ── */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<h2 className="text-xl font-display font-bold text-ink flex items-center gap-2">
						<Gavel size={22} className="text-rose-800 dark:text-rose-300" />
						Strikes & Student Standing
					</h2>
					<p className="text-xs text-ink3 mt-1">
						Isolated compliance hub for student warnings, moderation strikes, appeals, and draft language health.
					</p>
				</div>
				<button
					type="button"
					onClick={loadStrikes}
					disabled={loading}
					className="btn btn-ghost !text-xs flex items-center gap-1.5 self-start sm:self-auto"
				>
					<RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
				</button>
			</div>

			{/* ── Metric Summary Tiles ── */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div className="card p-4 border border-rose-500/20 bg-rose-500/5">
					<div className="flex items-center justify-between text-xs text-rose-800 dark:text-rose-300 font-semibold mb-1">
						<span>Active Strikes</span>
						<ShieldAlert size={14} />
					</div>
					<p className="text-2xl font-bold font-display text-ink">{totalActive}</p>
					<p className="text-[10px] text-ink3 mt-0.5">Enforced across campus</p>
				</div>

				<div className="card p-4 border border-amber-500/20 bg-amber-500/5">
					<div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 font-semibold mb-1">
						<span>Pending Appeals</span>
						<Clock size={14} />
					</div>
					<p className="text-2xl font-bold font-display text-ink">{totalAppealed}</p>
					<p className="text-[10px] text-ink3 mt-0.5">Awaiting staff review</p>
				</div>

				<div className="card p-4 border border-emerald-500/20 bg-emerald-500/5">
					<div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-semibold mb-1">
						<span>Pardoned / Cleared</span>
						<CheckCircle2 size={14} />
					</div>
					<p className="text-2xl font-bold font-display text-ink">{totalPardoned}</p>
					<p className="text-[10px] text-ink3 mt-0.5">Restored standing</p>
				</div>

				<div className="card p-4 border border-accent/20 bg-accent/5">
					<div className="flex items-center justify-between text-xs text-accent font-semibold mb-1">
						<span>Draft Slang Intercepts</span>
						<AlertTriangle size={14} />
					</div>
					<p className="text-2xl font-bold font-display text-ink">{draftSlangs}</p>
					<p className="text-[10px] text-ink3 mt-0.5">Stopped pre-publication</p>
				</div>
			</div>

			{/* ── Filter Bar ── */}
			<div className="card p-3 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
				<div className="relative flex-1">
					<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
					<input
						type="text"
						placeholder="Search by student anonymous ID, reason, or content..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="input !pl-9 !py-1.5 text-xs w-full"
					/>
				</div>
				<div className="flex items-center gap-1.5">
					{(["all", "active", "appealed", "pardoned"] as const).map((st) => (
						<button
							key={st}
							type="button"
							onClick={() => setStatusFilter(st)}
							className={`btn !py-1 !px-2.5 !text-xs capitalize ${
								statusFilter === st ? "btn-primary font-bold" : "btn-ghost text-ink3"
							}`}
						>
							{st}
						</button>
					))}
				</div>
			</div>

			{/* ── Strikes Table / List ── */}
			{loading ? (
				<div className="card p-12 text-center flex flex-col items-center justify-center space-y-3">
					<Loader2 size={24} className="animate-spin text-accent" />
					<p className="text-xs text-ink3">Loading student moderation records...</p>
				</div>
			) : error ? (
				<div className="card p-8 text-center text-bad text-xs">
					<p className="font-bold">Error loading strikes</p>
					<p className="mt-1 text-ink3">{error}</p>
				</div>
			) : filteredStrikes.length === 0 ? (
				<div className="card p-12 text-center space-y-2">
					<ShieldCheck size={32} className="text-emerald-500 mx-auto" />
					<h3 className="font-bold text-sm text-ink">No Strikes Found</h3>
					<p className="text-xs text-ink3 max-w-sm mx-auto">
						Campus student discipline is currently clean with zero matching moderation records.
					</p>
				</div>
			) : (
				<div className="card overflow-hidden border border-border">
					<div className="overflow-x-auto">
						<table className="w-full text-xs text-left">
							<thead className="bg-surface2/60 border-b border-border text-[11px] font-semibold text-ink3 uppercase">
								<tr>
									<th className="py-3 px-4">Student ID</th>
									<th className="py-3 px-4">Violation & Reason</th>
									<th className="py-3 px-4">Severity</th>
									<th className="py-3 px-4">Status</th>
									<th className="py-3 px-4">Date</th>
									<th className="py-3 px-4 text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border/60">
								{filteredStrikes.map((s, i) => (
									<tr key={s.id ? `${s.id}-${i}` : `strike-${i}`} className="hover:bg-surface2/30 transition-colors">
										<td className="py-3 px-4 font-mono font-medium text-ink">
											@{s.author_id.slice(0, 12)}
										</td>
										<td className="py-3 px-4 max-w-xs">
											<p className="font-semibold text-ink truncate">{s.reason}</p>
											{s.target_title && (
												<p className="text-[11px] text-ink3 truncate mt-0.5">
													Context: {s.target_title}
												</p>
											)}
										</td>
										<td className="py-3 px-4">
											<span
												className={`chip !text-[10px] !py-0.2 capitalize ${
													s.severity === "ban"
														? "!bg-rose-500/15 !text-rose-600 !border-rose-500/30"
														: s.severity === "strike"
															? "!bg-amber-500/15 !text-amber-600 !border-amber-500/30"
															: "!bg-blue-500/15 !text-blue-600 !border-blue-500/30"
												}`}
											>
												{s.severity}
											</span>
										</td>
										<td className="py-3 px-4">
											<span
												className={`chip !text-[10px] !py-0.2 capitalize ${
													s.status === "active"
														? "!bg-rose-500/10 !text-rose-600"
														: s.status === "appealed"
															? "!bg-amber-500/10 !text-amber-600"
															: "!bg-emerald-500/10 !text-emerald-600"
												}`}
											>
												{s.status}
											</span>
										</td>
										<td className="py-3 px-4 text-ink3">
											{timeAgo(s.created_at)}
										</td>
										<td className="py-3 px-4 text-right">
											{s.status === "active" && (
												<button
													type="button"
													onClick={() => handlePardon(s.id)}
													disabled={actionBusy === s.id}
													className="btn btn-ghost !py-1 !px-2.5 !text-[11px] text-emerald-600 hover:bg-emerald-500/10"
													title="Pardon strike and restore student standing"
												>
													<RotateCcw size={12} className="inline mr-1" />
													Pardon
												</button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}
