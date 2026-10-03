import {
	ArrowUpRight,
	BarChart3,
	Lightbulb,
	Megaphone,
	RefreshCcw,
	Trophy,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { STATUS_META, timeAgo } from "../lib/utils";

interface RankedItem {
	id: string;
	title: string;
	category?: string;
	status?: string;
	support?: number;
	votes?: number;
	score?: number;
	breakdown?: {
		support: number;
		downvotes?: number;
		comments: number;
		freshness: number;
		resolution: string;
		depth: string;
	};
	created_at?: string;
	type?: string;
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
	{ label: string; icon: typeof Megaphone; color: string }
> = {
	problem: { label: "Problem", icon: Megaphone, color: "var(--vb-accent)" },
	suggestion: { label: "Suggestion", icon: Lightbulb, color: "var(--vb-warn)" },
	poll: { label: "Poll", icon: BarChart3, color: "var(--vb-good)" },
};

function RankRow({ item, rank }: { item: RankedItem; rank: number }) {
	// Unknown future types must degrade to the problem style, never crash
	// the whole board on meta.icon.
	const meta = TYPE_META[item.type || "problem"] ?? TYPE_META.problem!;
	const Icon = meta.icon;
	// AI-enhanced score: weighted composite of support, comments, and recency
	const support = item.support ?? 0;
	const score = item.score ?? support;
	const status = item.status
		? STATUS_META[item.status]?.label || item.status.replace("_", " ")
		: null;
	const isClosed = item.status === "solved" || item.status === "archived";

	return (
		<Link
			to={item.type === "poll" ? "/polls" : `/post/${item.id}`}
			className="card card-hover p-3 flex items-center gap-3 vb-rise"
		>
			<span className="text-lg w-7 text-center shrink-0">
				{RANK_MEDALS[rank] || (
					<span className="text-xs font-bold text-ink3">{rank + 1}</span>
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
					{status && <span>· {status}</span>}
					{item.created_at && <span>· {timeAgo(item.created_at)}</span>}
				</p>
			</div>
		<div className="text-right shrink-0">
			<p
				className="font-display font-bold text-lg leading-none"
				style={{ color: meta.color }}
			>
				{score}
			</p>
			<p className="text-[9px] text-ink3 uppercase tracking-wider">
				{isClosed ? "final" : "score"}
			</p>
			{item.breakdown && (
				<div className="hidden sm:block text-[8px] text-ink3 mt-1 space-y-0.5">
					{item.breakdown.support > 0 && <div>Support: {item.breakdown.support}</div>}
					{item.breakdown.comments > 0 && <div>Comments: {item.breakdown.comments}</div>}
					{item.breakdown.resolution !== "—" && <div>Resolution: {item.breakdown.resolution}</div>}
					{item.breakdown.depth !== "—" && <div>Depth: {item.breakdown.depth}</div>}
				</div>
			)}
		</div>
			<ArrowUpRight size={14} className="text-ink3/40 shrink-0" />
		</Link>
	);
}

export default function Leaderboard() {
	const [data, setData] = useState<LeaderboardData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [tab, setTab] = useState<"all" | "problems" | "suggestions" | "polls">(
		"all",
	);

	const load = useCallback(async (silent = false) => {
		try {
			setError("");
			const d = await api.getSlow<LeaderboardData>("/api/leaderboard");
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

	const shown: RankedItem[] = (() => {
		if (!data) return [];
		// Server arrays are optional in practice — a missing/null list must
		// render empty, never throw on .map.
		if (tab === "problems")
			return (data.problems || []).map((p) => ({ ...p, type: "problem" }));
		if (tab === "suggestions")
			return (data.suggestions || []).map((s) => ({ ...s, type: "suggestion" }));
		if (tab === "polls")
			return (data.polls || []).map((p) => ({ ...p, type: "poll" }));
		return data.leaderboard || [];
	})();

	const maxScore = Math.max(
		1,
		...shown.map((i) => i.score ?? i.support ?? i.votes ?? 0),
	);

	return (
		<div className="max-w-3xl mx-auto">
			<div className="flex items-center justify-between mb-1">
				<h1 className="font-display font-bold text-2xl flex items-center gap-2">
					<Trophy className="text-warn" size={24} /> Community Leaderboard
				</h1>
				<button
					className="btn btn-ghost !text-xs"
					// Silent refresh: keep the board on screen instead of
					// flashing skeletons on every manual reload.
					onClick={() => {
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
			</div>
			<p className="text-sm text-ink3 mb-5">
				Top problems, suggestions, and polls ranked by real community
				support — every score links back to its supporters.
			</p>

			{/* Tabs */}
			<div className="mb-4 flex flex-wrap gap-2">
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
						// Silent retry: the error card stays honest without
						// blanking to skeletons first.
						onClick={() => {
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

			{/* ── Ranked lists ── */}
			{!loading && (
				<div className="space-y-2.5">
					{shown.length === 0 && !error && (
						<div className="card p-10 text-center">
							<p className="text-3xl mb-2">🏆</p>
							<p className="font-display font-semibold">Nothing ranked yet</p>
							<p className="text-xs text-ink3 mt-1">
								Items appear here once the community supports them.
							</p>
							<Link to="/submit" className="btn btn-primary mt-4 inline-flex">
								Share something
							</Link>
						</div>
					)}
					{shown.map((item, i) => (
						<div key={`${item.type}-${item.id}`} className="relative">
							{/* Rank bar */}
							<RankRow item={item} rank={i} />
							{/* Score proportion bar */}
							<div
								className="h-0.5 rounded-full overflow-hidden mx-9 -mt-1"
								style={{ background: "var(--vb-border)" }}
							>
								<div
									className="h-full rounded-full transition-all duration-700"
									style={{
										width: `${Math.max(4, Math.round(((item.score ?? item.support ?? item.votes ?? 0) / maxScore) * 100))}%`,
										background:
											TYPE_META[item.type || "problem"]?.color ||
											"var(--vb-accent)",
									}}
								/>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Footer note */}
			{!loading && (
				<p className="text-center text-[10px] text-ink3 mt-5 flex items-center justify-center gap-1.5">
					<Users size={10} /> Every anonymous support counts — scores update
					live as the community votes
				</p>
			)}
		</div>
	);
}
