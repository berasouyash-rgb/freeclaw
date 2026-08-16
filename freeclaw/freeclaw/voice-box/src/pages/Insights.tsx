// Community Insights — how the whole board is trending, at a glance.

import {
	Activity,
	CheckCircle2,
	Megaphone,
	MessageCircle,
	ThumbsUp,
	TrendingUp,
	Users,
	Vote,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { STATUS_META } from "../lib/utils";

type InsightsData = {
	totals: {
		posts: number;
		comments: number;
		reactions: number;
		polls: number;
		poll_votes: number;
		open: number;
		solved: number;
		participants: number;
	};
	by_category: { category: string; count: number; solved: number }[];
	by_status: { status: string; count: number }[];
	trend: { date: string; posts: number; comments: number }[];
	top_categories: { category: string; count: number }[];
};

function dayLabel(date: string) {
	const d = new Date(date);
	if (Number.isNaN(+d)) return date;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Validate + normalize the raw API payload so a wrong-shaped response can never crash the render. */
function normalizeInsights(raw: unknown): InsightsData | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Partial<InsightsData>;
	const totals = r.totals;
	if (!totals || typeof totals !== "object" || !Array.isArray(r.by_category))
		return null;
	return {
		totals: {
			posts: totals.posts ?? 0,
			comments: totals.comments ?? 0,
			reactions: totals.reactions ?? 0,
			polls: totals.polls ?? 0,
			poll_votes: totals.poll_votes ?? 0,
			open: totals.open ?? 0,
			solved: totals.solved ?? 0,
			participants: totals.participants ?? 0,
		},
		by_category: r.by_category,
		by_status: Array.isArray(r.by_status) ? r.by_status : [],
		trend: Array.isArray(r.trend) ? r.trend : [],
		top_categories: Array.isArray(r.top_categories) ? r.top_categories : [],
	};
}

export default function Insights() {
	const [data, setData] = useState<InsightsData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		try {
			setError("");
			setLoading(true);
			const norm = normalizeInsights(
				await api.getSlow<unknown>("/api/insights"),
			);
			if (!norm) {
				setError("Could not load insights — unexpected response.");
				setData(null);
			} else {
				setData(norm);
			}
		} catch (e: unknown) {
			setError(e instanceof Error ? e.message : "Could not load insights");
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const maxDay = data
		? Math.max(1, ...data.trend.map((t) => t.posts + t.comments))
		: 1;
	const totalPosts = data?.totals.posts || 0;

	const tiles = data
		? [
				{
					label: "Posts",
					value: data.totals.posts,
					icon: Megaphone,
					sub: `${data.totals.open} open · ${data.totals.solved} solved`,
				},
				{
					label: "Comments",
					value: data.totals.comments,
					icon: MessageCircle,
					sub: "on the board",
				},
				{
					label: "Reactions",
					value: data.totals.reactions,
					icon: ThumbsUp,
					sub: "supports given",
				},
				{
					label: "Participants",
					value: data.totals.participants,
					icon: Users,
					sub: "unique voices",
				},
			]
		: [];

	return (
		<div className="max-w-3xl mx-auto px-4 py-6 vb-page-enter">
			<div className="flex items-center gap-2.5 mb-5">
				<span className="vb-empty-icon !w-9 !h-9">
					<Activity size={17} />
				</span>
				<div>
					<h1 className="font-display font-bold text-xl sm:text-2xl leading-tight">
						Community insights
					</h1>
					<p className="text-xs text-ink3">
						How the board is moving — live aggregates, no admin required.
					</p>
				</div>
			</div>

			{error && (
				<div className="card p-6 text-center">
					<p className="text-bad font-medium text-sm">{error}</p>
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
				<div className="space-y-4">
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
						{[1, 2, 3, 4].map((i) => (
							<div key={i} className="skeleton h-24" />
						))}
					</div>
					<div className="skeleton h-40" />
				</div>
			)}

			{data && (
				<div className="space-y-4">
					{/* Stat tiles */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
						{tiles.map(({ label, value, icon: Icon, sub }) => (
							<div key={label} className="card p-4 vb-rise">
								<div className="flex items-center gap-1.5 text-ink3 mb-2">
									<Icon size={13} />
									<span className="text-[10px] font-bold uppercase tracking-wider">
										{label}
									</span>
								</div>
								<p className="font-display font-bold text-2xl leading-none">
									{value.toLocaleString()}
								</p>
								<p className="text-[11px] text-ink3 mt-1.5">{sub}</p>
							</div>
						))}
					</div>

					<div className="grid sm:grid-cols-2 gap-4">
						{/* Category breakdown */}
						<div className="card p-4">
							<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-3 flex items-center gap-1.5">
								<TrendingUp size={11} /> By category
							</p>
							<div className="space-y-2.5">
								{data.by_category.map((c) => {
									const pct = totalPosts
										? Math.round((c.count / totalPosts) * 100)
										: 0;
									return (
										<div key={c.category}>
											<div className="flex items-center justify-between text-xs mb-1">
												<span className="font-semibold">{c.category}</span>
												<span className="text-ink3">
													{c.count} · {c.solved} solved
												</span>
											</div>
											<div className="h-2 rounded-full bg-surface2 overflow-hidden">
												<div
													className="h-full rounded-full"
													style={{
														width: `${pct}%`,
														background: "var(--vb-accent)",
													}}
												/>
											</div>
										</div>
									);
								})}
								{data.by_category.length === 0 && (
									<p className="text-sm text-ink3">No posts yet.</p>
								)}
							</div>
						</div>

						{/* Status mix */}
						<div className="card p-4">
							<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-3 flex items-center gap-1.5">
								<CheckCircle2 size={11} /> Status mix
							</p>
							<div className="space-y-2.5">
								{data.by_status.map((s) => {
									const meta = STATUS_META[s.status] || {
										label: s.status,
										color: "#888",
									};
									const pct = totalPosts
										? Math.round((s.count / totalPosts) * 100)
										: 0;
									return (
										<div key={s.status}>
											<div className="flex items-center justify-between text-xs mb-1">
												<span className="font-semibold">{meta.label}</span>
												<span className="text-ink3">{s.count}</span>
											</div>
											<div className="h-2 rounded-full bg-surface2 overflow-hidden">
												<div
													className="h-full rounded-full"
													style={{ width: `${pct}%`, background: meta.color }}
												/>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					</div>

					{/* 14-day trend */}
					<div className="card p-4">
						<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-3 flex items-center gap-1.5">
							<Vote size={11} /> Activity · last 14 days
						</p>
						<div className="flex items-end justify-between gap-1 h-28">
							{data.trend.map((t) => {
								const height = Math.round(
									((t.posts + t.comments) / maxDay) * 100,
								);
								return (
									<div
										key={t.date}
										className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
										title={`${dayLabel(t.date)} · ${t.posts} posts, ${t.comments} comments`}
									>
										<div
											className="w-full rounded-t-sm transition-all"
											style={{
												height: `${Math.max(3, height)}%`,
												background: "var(--vb-accent)",
											}}
										/>
									</div>
								);
							})}
						</div>
						<div className="flex justify-between gap-1 mt-1.5">
							{data.trend.map((t) => (
								<span
									key={t.date}
									className="flex-1 text-center text-[8px] text-ink3 whitespace-nowrap"
								>
									{dayLabel(t.date)}
								</span>
							))}
						</div>
					</div>

					{/* Top categories */}
					<div className="card p-4">
						<p className="text-[10px] font-bold uppercase tracking-wider text-ink3 mb-2 flex items-center gap-1.5">
							<ThumbsUp size={11} /> Top categories
						</p>
						<div className="flex flex-wrap gap-2">
							{data.top_categories.map((c) => (
								<span key={c.category} className="chip">
									{c.category} · {c.count}
								</span>
							))}
							{data.top_categories.length === 0 && (
								<span className="text-sm text-ink3">No data yet.</span>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
