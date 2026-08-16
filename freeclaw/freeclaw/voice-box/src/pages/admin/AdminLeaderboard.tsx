import {
	ArrowUpRight,
	BadgeCheck,
	BarChart3,
	Bot,
	CheckCircle2,
	ExternalLink,
	Flag,
	Lightbulb,
	Megaphone,
	Play,
	RefreshCcw,
	Settings2,
	Sparkles,
	Trophy,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ReportDialog, StatusDialog } from "../../components/ui";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { STATUS_META, timeAgo } from "../../lib/utils";

interface RankedItem {
	id: string;
	title: string;
	category?: string;
	status?: string;
	support?: number;
	votes?: number;
	score?: number;
	created_at?: string;
	type?: string;
	archived?: boolean;
	ptype?: string;
	at?: string;
}
interface AiActivityItem {
	kind: string;
	label: string;
	detail: string;
	at?: string;
}
interface LeaderboardData {
	problems: RankedItem[];
	suggestions: RankedItem[];
	polls: RankedItem[];
	leaderboard: RankedItem[];
	ai_activity: AiActivityItem[];
	generated_at?: string;
}

const RANK_MEDALS = ["🥇", "🥈", "🥉"];
const TYPE_META: Record<
	string,
	{
		label: string;
		icon: typeof Megaphone;
		color: string;
		to: (id: string) => string;
	}
> = {
	problem: {
		label: "Problem",
		icon: Megaphone,
		color: "var(--vb-accent)",
		to: (id) => `/post/${id}`,
	},
	suggestion: {
		label: "Suggestion",
		icon: Lightbulb,
		color: "var(--vb-warn)",
		to: (id) => `/post/${id}`,
	},
	poll: {
		label: "Poll",
		icon: BarChart3,
		color: "var(--vb-good)",
		to: () => "/polls",
	},
};

export default function AdminLeaderboard() {
	const { toast, anonId } = useApp();
	const [data, setData] = useState<LeaderboardData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [tab, setTab] = useState<
		"all" | "problems" | "suggestions" | "polls" | "ai"
	>("all");
	const [statusDialog, setStatusDialog] = useState<{
		id: string;
		status: string;
	} | null>(null);
	const [reportDialog, setReportDialog] = useState<{ id: string } | null>(null);
	const [cfg, setCfg] = useState<{
		enabled: boolean;
		hide_empty: boolean;
		page_size: number;
		pinned_ids: string[];
	}>({ enabled: true, hide_empty: false, page_size: 25, pinned_ids: [] });
	const [cfgOpen, setCfgOpen] = useState(false);
	const [cfgSaving, setCfgSaving] = useState(false);
	const [pinDraft, setPinDraft] = useState("");

	// Load the admin customization for the leaderboard.
	useEffect(() => {
		api
			.post<{ enabled?: boolean; hide_empty?: boolean; page_size?: number; pinned_ids?: string[] }>(
				"/api/admin",
				{ action: "get_leaderboard_config" },
			)
			.then((c) => {
				if (c && typeof c === "object") {
					setCfg({
						enabled: c.enabled !== false,
						hide_empty: !!c.hide_empty,
						page_size: Number(c.page_size) || 25,
						pinned_ids: Array.isArray(c.pinned_ids) ? c.pinned_ids : [],
					});
					setPinDraft((Array.isArray(c.pinned_ids) ? c.pinned_ids : []).join(", "));
				}
			})
			.catch(() => {
				/* config optional — defaults are fine */
			});
	}, []);

	const saveConfig = async () => {
		setCfgSaving(true);
		try {
			const next = {
				...cfg,
				pinned_ids: pinDraft
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
					.slice(0, 10),
			};
			const saved = await api.post<{
				enabled?: boolean;
				hide_empty?: boolean;
				page_size?: number;
				pinned_ids?: string[];
			}>("/api/admin", {
				action: "set_leaderboard_config",
				config: next,
			});
			setCfg({
				enabled: saved.enabled !== false,
				hide_empty: !!saved.hide_empty,
				page_size: Number(saved.page_size) || 25,
				pinned_ids: Array.isArray(saved.pinned_ids) ? saved.pinned_ids : [],
			});
			setPinDraft((Array.isArray(saved.pinned_ids) ? saved.pinned_ids : []).join(", "));
			setCfgOpen(false);
			toast("Leaderboard settings saved", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to save settings", "err");
		} finally {
			setCfgSaving(false);
		}
	};

	const load = useCallback(async (silent = false) => {
		try {
			setError("");
			// Realtime-triggered refreshes bypass the 5s GET cache so live supports/votes show instantly.
			const d = await (silent
				? api.getFresh<LeaderboardData>("/api/leaderboard")
				: api.getSlow<LeaderboardData>("/api/leaderboard"));
			setData(d);
		} catch (e: unknown) {
			if (!silent)
				setError(e instanceof Error ? e.message : "Failed to load leaderboard");
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	// 🔴 Live: new supports, votes and posts update the board in real time
	useRealtime(["posts", "reactions", "poll_votes"], () => load(true), 1200);

	const applyStatus = async (note: string) => {
		// Defense-in-depth: StatusDialog renders its submit controls only while
		// `open` (statusDialog truthy), so this guard can never be hit from the UI.
		/* v8 ignore next -- @preserve */
		if (!statusDialog) return;
		try {
			await api.put("/api/posts", {
				id: statusDialog.id,
				status: statusDialog.status,
				status_note: note || undefined,
			});
			toast(
				statusDialog.status === "solved"
					? "✅ Marked solved — students notified"
					: "🔧 Status updated — students notified",
				"ok",
			);
			load(true);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to update status", "err");
		}
	};

	const submitReport = async (reason: string) => {
		// Defense-in-depth: ReportDialog renders its submit controls only while
		// `open` (reportDialog truthy), so this guard can never be hit from the UI.
		/* v8 ignore next -- @preserve */
		if (!reportDialog) return;
		try {
			await api.post("/api/reports", {
				target_id: reportDialog.id,
				target_type: "post",
				reason,
				author_id: anonId,
			});
			toast("Report submitted", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to submit report", "err");
		}
	};

	const shown: RankedItem[] = useMemo(() => {
		if (!data) return [];
		let list: RankedItem[];
		if (tab === "problems")
			list = data.problems.map((p) => ({ ...p, type: "problem" }));
		else if (tab === "suggestions")
			list = data.suggestions.map((s) => ({ ...s, type: "suggestion" }));
		else if (tab === "polls") list = data.polls.map((p) => ({ ...p, type: "poll" }));
		else list = data.leaderboard || [];

		// Admin customization: pinned ids float to the top, empty rows can be
		// hidden, and the board length is capped by the configured page size.
		if (cfg.hide_empty)
			list = list.filter((i) => (i.score ?? i.support ?? i.votes ?? 0) > 0);
		const pinned = new Set(cfg.pinned_ids);
		if (pinned.size > 0) {
			const pinnedItems = list.filter((i) => pinned.has(i.id));
			const rest = list.filter((i) => !pinned.has(i.id));
			list = [...pinnedItems, ...rest];
		}
		return list.slice(0, cfg.page_size);
	}, [data, tab, cfg.hide_empty, cfg.pinned_ids, cfg.page_size]);

	const maxScore = Math.max(
		1,
		...shown.map((i) => i.score ?? i.support ?? i.votes ?? 0),
	);

	const stats = useMemo(
		() => ({
			problems: data?.problems?.length || 0,
			suggestions: data?.suggestions?.length || 0,
			polls: data?.polls?.length || 0,
			ai: data?.ai_activity?.length || 0,
			totalSupport: (data?.leaderboard || []).reduce(
				(a, i) => a + (i.score ?? 0),
				0,
			),
		}),
		[data],
	);

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between flex-wrap gap-2">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-xl bg-warn/10 flex items-center justify-center">
						<Trophy size={18} className="text-warn" />
					</div>
					<div>
						<h1 className="font-display font-bold text-xl">
							Community Leaderboard
						</h1>
						<p className="text-[11px] text-ink3">
							Top problems, suggestions and polls ranked by support — live.
						</p>
					</div>
				</div>					<button
						className="btn btn-ghost !text-xs"
						onClick={() => {
							setLoading(true);
							load();
						}}
						disabled={loading}
					>
						<RefreshCcw
							size={12}
							className={`mr-1 ${loading ? "animate-spin" : ""}`}
						/>{" "}
						Refresh
					</button>
					<button
						className="btn btn-ghost !text-xs !text-accent !border-accent/25 hover:!bg-accent/10"
						onClick={() => setCfgOpen((o) => !o)}
						aria-expanded={cfgOpen}
					>
						<Settings2 size={12} /> Customize
					</button>
				</div>

				{/* ── Leaderboard customization panel (admin-only) ── */}
				{cfgOpen && (
					<div className="card p-4 space-y-3">
						<p className="text-xs font-semibold text-ink">
							Customize the leaderboard
						</p>
						<label className="flex items-center gap-2 text-xs text-ink2 cursor-pointer">
							<input
								type="checkbox"
								checked={cfg.enabled}
								onChange={(e) =>
									setCfg((c) => ({ ...c, enabled: e.target.checked }))
								}
								className="accent-accent"
							/>
							Show the leaderboard
						</label>
						<label className="flex items-center gap-2 text-xs text-ink2 cursor-pointer">
							<input
								type="checkbox"
								checked={cfg.hide_empty}
								onChange={(e) =>
									setCfg((c) => ({ ...c, hide_empty: e.target.checked }))
								}
								className="accent-accent"
							/>
							Hide items with zero support
						</label>
						<label className="flex flex-col gap-1 text-xs text-ink2">
							<span>Rows shown per section</span>
							<select
								value={cfg.page_size}
								onChange={(e) =>
									setCfg((c) => ({ ...c, page_size: Number(e.target.value) }))
								}
								className="input !py-1.5 !text-xs"
							>
								{[10, 25, 50, 100].map((n) => (
									<option key={n} value={n}>
										{n}
									</option>
								))}
							</select>
						</label>
						<label className="flex flex-col gap-1 text-xs text-ink2">
							<span>Pinned posts (ids, comma separated)</span>
							<input
								type="text"
								value={pinDraft}
								onChange={(e) => setPinDraft(e.target.value)}
								placeholder="post_abc, poll_xyz"
								className="input !py-1.5 !text-xs font-mono"
								aria-label="Pinned post ids"
							/>
						</label>
						<div className="flex gap-2">
							<button
								className="btn btn-primary !py-1.5 !px-3 !text-xs"
								onClick={saveConfig}
								disabled={cfgSaving}
							>
								{cfgSaving ? "Saving…" : "Save settings"}
							</button>
							<button
								className="btn btn-ghost !py-1.5 !px-3 !text-xs"
								onClick={() => setCfgOpen(false)}
							>
								Cancel
							</button>
						</div>
					</div>
				)}

			{/* Summary cards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
				{[
					{
						label: "Ranked problems",
						value: stats.problems,
						icon: Megaphone,
						color: "text-accent",
						bg: "bg-accent/10",
					},
					{
						label: "Ranked suggestions",
						value: stats.suggestions,
						icon: Lightbulb,
						color: "text-warn",
						bg: "bg-warn/10",
					},
					{
						label: "Active polls",
						value: stats.polls,
						icon: BarChart3,
						color: "text-good",
						bg: "bg-good/10",
					},
					{
						label: "AI activity events",
						value: stats.ai,
						icon: Bot,
						color: "text-purple-400",
						bg: "bg-purple-500/10",
					},
				].map(({ label, value, icon: Icon, color, bg }, i) => (
					<div
						key={label}
						className="card p-4 vb-rise"
						style={{ animationDelay: `${i * 50}ms` }}
					>
						<div className="flex items-center justify-between">
							<span
								className={`w-8 h-8 rounded-lg grid place-items-center ${bg}`}
							>
								<Icon size={15} className={color} />
							</span>
							<span className="text-[9px] text-ink3 uppercase tracking-wider">
								live
							</span>
						</div>
						<p className="font-display font-bold text-2xl mt-2">{value}</p>
						<p className="text-xs text-ink3">{label}</p>
					</div>
				))}
			</div>

			{/* Tabs */}
			<div className="flex flex-wrap gap-2">
				{(
					[
						{ key: "all", label: `🏆 All (${data?.leaderboard?.length || 0})` },
						{
							key: "problems",
							label: `📢 Problems (${data?.problems?.length || 0})`,
						},
						{
							key: "suggestions",
							label: `💡 Suggestions (${data?.suggestions?.length || 0})`,
						},
						{ key: "polls", label: `📊 Polls (${data?.polls?.length || 0})` },
						{
							key: "ai",
							label: `🤖 AI activity (${data?.ai_activity?.length || 0})`,
						},
					] as const
				).map((t) => (
					<button
						key={t.key}
						onClick={() => setTab(t.key)}
						className={`chip cursor-pointer transition-all ${tab === t.key ? "!border-accent !text-accent" : "hover:!border-border"}`}
					>
						{t.label}
					</button>
				))}
			</div>

			{error && (
				<div className="card p-6 text-center">
					<p className="text-bad text-sm">{error}</p>
					<button
						className="btn btn-soft mt-3"
						onClick={() => {
							setLoading(true);
							load();
						}}
					>
						Retry
					</button>
				</div>
			)}
			{loading && (
				<div className="space-y-3">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="skeleton h-16" />
					))}
				</div>
			)}

			{/* ── AI activity tab ── */}
			{!loading && tab === "ai" && (
				<div className="space-y-2">
					<div className="card p-4 border-l-4 border-l-purple-500">
						<p className="text-xs font-semibold flex items-center gap-2">
							<Bot size={14} className="text-purple-400" /> AI agents are
							working in real time
						</p>
						<p className="text-[11px] text-ink3 mt-1">
							Every AI analysis, moderation pass, and learning record counts —
							automatically tracked from agent_executions and agent_insights.
						</p>
					</div>
					{(!data?.ai_activity || data.ai_activity.length === 0) && (
						<div className="card p-10 text-center">
							<p className="text-3xl mb-2">🤖</p>
							<p className="font-display font-semibold text-sm">
								No AI activity yet
							</p>
							<p className="text-xs text-ink3 mt-1">
								Agents become active once the platform processes content.
							</p>
						</div>
					)}
					{(data?.ai_activity || []).map((a, i) => (
						<div key={i} className="card p-3 flex items-center gap-3 vb-rise">
							<span
								className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${a.kind === "learning" ? "text-purple-400 bg-purple-400/10" : "text-accent bg-accent/10"}`}
							>
								{a.kind === "learning" ? (
									<Sparkles size={14} />
								) : (
									<Bot size={14} />
								)}
							</span>
							<div className="min-w-0 flex-1">
								<p className="text-xs font-semibold truncate">{a.label}</p>
								<p className="text-[10px] text-ink3 line-clamp-2">{a.detail}</p>
							</div>
							{a.at && (
								<span className="text-[9px] text-ink3 shrink-0">
									{timeAgo(a.at)}
								</span>
							)}
						</div>
					))}
				</div>
			)}

			{/* ── Ranked lists ── */}
			{!loading && tab !== "ai" && (
				<div className="space-y-2.5">
					{shown.length === 0 && (
						<div className="card p-10 text-center">
							<p className="text-3xl mb-2">🏆</p>
							<p className="font-display font-semibold">Nothing ranked yet</p>
							<p className="text-xs text-ink3 mt-1">
								Items appear here once the community supports them.
							</p>
						</div>
					)}
					{shown.map((item, i) => {
						const meta = TYPE_META[item.type || "problem"]!;
						const Icon = meta.icon;
						const score = item.score ?? item.support ?? item.votes ?? 0;
						const isClosed =
							item.status === "solved" ||
							item.status === "archived" ||
							!!item.archived;
						const timestamp = item.created_at ?? item.at;
						return (
							<div
								key={`${item.type}-${item.id}`}
								className="card card-hover p-3 flex items-center gap-3 vb-rise"
							>
								<span className="text-lg w-7 text-center shrink-0">
									{RANK_MEDALS[i] || (
										<span className="text-xs font-bold text-ink3">{i + 1}</span>
									)}
								</span>
								<span
									className="shrink-0 w-8 h-8 rounded-lg grid place-items-center"
									style={{ background: `${meta.color}14`, color: meta.color }}
								>
									<Icon size={15} />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-semibold truncate">{item.title}</p>
									<p className="text-[10px] text-ink3 flex items-center gap-1.5 mt-0.5">
										<span className="capitalize">{item.type}</span>
										{item.category && <span>· {item.category}</span>}
										{item.status && (
											<span>
												·{" "}
												{STATUS_META[item.status]?.label ||
													item.status.replace("_", " ")}
											</span>
										)}
										{timestamp && <span>· {timeAgo(timestamp)}</span>}
									</p>
									{/* Score bar */}
									<div
										className="h-0.5 rounded-full overflow-hidden mt-1.5"
										style={{ background: "var(--vb-border)" }}
									>
										<div
											className="h-full rounded-full transition-all duration-700"
											style={{
												width: `${Math.max(4, Math.round((score / maxScore) * 100))}%`,
												background: meta.color,
											}}
										/>
									</div>
								</div>
								<div className="text-right shrink-0">
									<p
										className="font-display font-bold text-lg leading-none"
										style={{ color: meta.color }}
									>
										{score}
									</p>
									<p className="text-[9px] text-ink3 uppercase tracking-wider">
										{isClosed
											? "final"
											: item.type === "poll"
												? "votes"
												: "supports"}
									</p>
								</div>
								{/* Admin quick actions */}
								<div className="flex flex-col gap-1 shrink-0">
									{item.type === "problem" && !isClosed && (
										<>
											{item.status !== "verified" && (
												<button
													className="btn btn-soft !py-1 !px-2 !text-[10px] !text-accent"
													onClick={() =>
														setStatusDialog({ id: item.id, status: "verified" })
													}
												>
													<BadgeCheck size={10} /> Verify
												</button>
											)}
											{item.status !== "in_progress" && (
												<button
													className="btn btn-soft !py-1 !px-2 !text-[10px]"
													onClick={() =>
														setStatusDialog({
															id: item.id,
															status: "in_progress",
														})
													}
												>
													<Play size={10} /> Start
												</button>
											)}
											{item.status !== "solved" && (
												<button
													className="btn !py-1 !px-2 !text-[10px] !bg-good/12 !text-good hover:!bg-good/20"
													onClick={() =>
														setStatusDialog({ id: item.id, status: "solved" })
													}
												>
													<CheckCircle2 size={10} /> Solve
												</button>
											)}
										</>
									)}
									{item.type !== "poll" && (
										<button
											className="btn btn-ghost !py-1 !px-2 !text-[10px]"
											onClick={() => setReportDialog({ id: item.id })}
										>
											<Flag size={10} /> Report
										</button>
									)}
									<Link
										to={meta.to(item.id)}
										className="btn btn-ghost !py-1 !px-2 !text-[10px] flex items-center gap-1"
										title="Open"
									>
										<ExternalLink size={10} /> Open
									</Link>
								</div>
								<ArrowUpRight
									size={14}
									className="text-ink3/40 shrink-0 hidden sm:block"
								/>
							</div>
						);
					})}
				</div>
			)}

			<p className="text-center text-[10px] text-ink3 flex items-center justify-center gap-1.5">
				<Users size={10} /> Every anonymous support counts · <Bot size={10} />{" "}
				AI agents moderate automatically · updates live
			</p>

			<StatusDialog
				open={!!statusDialog}
				onClose={() => setStatusDialog(null)}
				status={statusDialog?.status || ""}
				statusLabel={
					(STATUS_META[statusDialog?.status || ""] || { label: "" }).label
				}
				onSubmit={applyStatus}
			/>
			<ReportDialog
				open={!!reportDialog}
				onClose={() => setReportDialog(null)}
				onSubmit={submitReport}
			/>
		</div>
	);
}
