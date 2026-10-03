import { PlusCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PollCard from "../components/PollCard";
import { Segmented } from "../components/ui";
import { useApp } from "../contexts/AppContext";
import { api } from "../lib/api";
import type { PollData, PollVote } from "../types";

/**
 * Collapse exact-duplicate poll rows (double-submit / retry creating two DB
 * rows with the same question + options). Keeps the canonical row — highest
 * vote total, oldest first on ties — so the list never shows the same
 * question twice with split results (e.g. "2 votes" above "1 vote").
 */
export function normalizePollQuestion(text: unknown): string {
	return String(text ?? "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export function collapseDuplicatePolls(polls: PollData[]): PollData[] {
	const byId = new Map<string, PollData>();
	for (const p of polls) {
		if (!p || !p.id || byId.has(p.id)) continue;
		byId.set(p.id, p);
	}
	const groups = new Map<string, PollData[]>();
	for (const p of byId.values()) {
		const opts = Array.isArray(p.options)
			? p.options.map((o) => normalizePollQuestion(o)).join("\u0000")
			: "";
		const key = `${normalizePollQuestion(p.title)}\u0001${opts}`;
		const g = groups.get(key);
		if (g) g.push(p);
		else groups.set(key, [p]);
	}
	const out: PollData[] = [];
	for (const g of groups.values()) {
		const first = g[0] as PollData;
		if (g.length === 1) {
			out.push(first);
			continue;
		}
		let best: PollData = first;
		for (const p of g.slice(1)) {
			const v = p.total_votes ?? 0;
			const bv = best.total_votes ?? 0;
			if (v !== bv ? v > bv : String(p.created_at || "") < String(best.created_at || "")) {
				best = p;
			}
		}
		out.push(best);
	}
	return out;
}

export default function Polls() {
	const { anonId } = useApp();
	const [polls, setPolls] = useState<PollData[]>([]);
	const [votes, setVotes] = useState<Record<string, number[]>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [tab, setTab] = useState<"active" | "ended">("active");

	const load = useCallback(
		async (opts?: { fresh?: boolean }) => {
			try {
				setError("");
				// fresh bypasses the 5s GET cache — required for realtime-triggered
				// reloads, where the DB has already changed and a cached read shows
				// pre-vote results.
				const fetcher = opts?.fresh ? api.getFresh : api.get;
				const [data, myVotes] = await Promise.all([
					fetcher<PollData[]>(`/api/polls?viewer=${anonId}`),
					fetcher<PollVote[]>(`/api/polls?voter=${anonId}`),
				]);
				setPolls(collapseDuplicatePolls((data || []).filter((p) => !p.deleted)));
				const map: Record<string, number[]> = {};
				myVotes.forEach((v) => {
					map[v.poll_id] = v.choices;
				});
				setVotes(map);
			} catch (e: unknown) {
				setError(e instanceof Error ? e.message : "Failed to load polls");
			}
			setLoading(false);
		},
		[anonId],
	);

	useEffect(() => {
		load();
	}, [load]);

	// Poll results are reconciled after this user's vote/delete action or via
	// the explicit Refresh control. Do not refetch the entire list for every
	// unrelated vote event elsewhere in the product.

	// Poll results are reconciled after this user's vote/delete action or via
	// the explicit Refresh control. Do not refetch the entire list for every
	// unrelated vote event elsewhere in the product.

	const isEnded = (p: PollData) =>
		p.archived || (p.expires_at && new Date(p.expires_at) < new Date());
	// Ended polls stay permanently readable in the "Ended & archived" tab.
	// They used to disappear entirely 7 days after expiry, which quietly
	// deleted the community's voting history and made old polls unreachable.
	const shown = polls.filter((p) => (tab === "ended" ? isEnded(p) : !isEnded(p)));

	return (
		<div className="max-w-3xl mx-auto">
			<div className="flex items-center justify-between mb-1">
				<h1 className="font-display font-bold text-2xl">Polls</h1>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="btn btn-ghost !py-2"
						onClick={() => {
							setLoading(true);
							void load({ fresh: true });
						}}
						disabled={loading}
						aria-label="Refresh polls"
					>
						<RefreshCw size={14} /> Refresh
					</button>
					<Link to="/submit?type=poll" className="btn btn-primary !py-2">
						<PlusCircle size={15} /> New poll
					</Link>
				</div>
			</div>
			<p className="text-sm text-ink3 mb-5">
				Vote anonymously. Your vote updates the results immediately; use Refresh
				to check for changes from other people. Every poll stays readable after it
				closes.
			</p>

			<div className="mb-4">
				<Segmented<"active" | "ended">
					value={tab}
					onChange={setTab}
					options={[
						{
							value: "active",
							label: `Active (${polls.filter((p) => !isEnded(p)).length})`,
						},
						{
							value: "ended",
							label: `Ended & archived (${polls.filter(isEnded).length})`,
						},
					]}
				/>
			</div>

			{error && (
				<div className="card p-6 text-center">
					<p className="text-bad text-sm">{error}</p>
					<button
						className="btn btn-soft mt-3"
						onClick={() => {
							setLoading(true);
							void load({ fresh: true });
						}}
					>
						Retry
					</button>
				</div>
			)}
			{loading && (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-44" />
					))}
				</div>
			)}
			{!loading && !error && shown.length === 0 && (
				<div className="card p-10 text-center">
					<p className="text-3xl mb-2">📊</p>
					<p className="font-display font-semibold">No {tab} polls</p>
					{tab === "active" && (
						<Link
							to="/submit?type=poll"
							className="btn btn-primary mt-4 inline-flex"
						>
							Create the first poll
						</Link>
					)}
				</div>
			)}
			<div className="space-y-3">
				<h2 className="sr-only">Poll List</h2>
				{shown.map((p) => (
					<div key={p.id}>
						<PollCard
							poll={p}
							myVote={votes[p.id]}
							onVoted={() => void load({ fresh: true })}
							onDeleted={() => void load({ fresh: true })}
						/>
						{p.post_id && (
							<Link
								to={`/post/${p.post_id}`}
								className="flex items-center gap-2 -mt-1.5 mx-3 px-3.5 py-2.5 rounded-b-xl text-xs font-semibold text-accent transition-colors hover:brightness-95"
								style={{
									background: "var(--vb-accent-soft)",
									border: "1px solid rgba(86,82,214,0.15)",
									borderTop: "none",
								}}
							>
								🔗 This poll is linked to a complaint — view the full issue &
								discussion →
							</Link>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
