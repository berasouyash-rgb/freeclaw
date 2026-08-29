import {
	Archive,
	BarChart3,
	CheckCircle2,
	Clock,
	Lock,
	RotateCcw,
	ShieldCheck,
	Sparkles,
	Trash2,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../contexts/AppContext";
import { api, hasAdminSession } from "../lib/api";
import type { PollData } from "../types";
import { ConfirmDialog } from "./ui";

interface PollCardProps {
	poll: PollData;
	myVote?: number[];
	onVoted?: () => void;
	onDeleted?: () => void;
}

const PollCard = memo(function PollCard({
	poll,
	myVote,
	onVoted,
	onDeleted,
}: PollCardProps) {
	const { anonId, toast } = useApp();
	const [selected, setSelected] = useState<number[]>(myVote || []);
	const [voted, setVoted] = useState((myVote || []).length > 0);
	const [changingVote, setChangingVote] = useState(false);
	const [local, setLocal] = useState<PollData | null>(null);
	const [busy, setBusy] = useState(false);
	const [showDelete, setShowDelete] = useState(false);
	const p = local || poll;
	const isOwner = p.is_mine === true || p.author_id === anonId;

	const deleteOwn = async () => {
		try {
			await api.put("/api/polls", {
				id: p.id,
				author_id: anonId,
				deleted: true,
			});
			toast("Poll deleted", "info", {
				label: "Undo (30s)",
				fn: async () => {
					await api.put("/api/polls", {
						id: p.id,
						author_id: anonId,
						deleted: false,
					});
					toast("Poll restored", "ok");
					onDeleted?.();
				},
			});
			onDeleted?.();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to delete poll", "err");
		}
	};
	const expired = p.expires_at && new Date(p.expires_at) < new Date();
	const closed = expired || p.archived;
	const total = p.total_votes || 0;
	const showResults = (voted && !changingVote) || closed;

	// Live countdown — tick every second so the timer updates in real time
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!p.expires_at || expired) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [p.expires_at, expired]);
	const countdown = useMemo(() => {
		if (!p.expires_at) return null;
		const diff = +new Date(p.expires_at) - now;
		if (diff <= 0) return null;
		const d = Math.floor(diff / 86400000);
		const h = Math.floor((diff % 86400000) / 3600000);
		const m = Math.floor((diff % 3600000) / 60000);
		const s = Math.floor((diff % 60000) / 1000);
		if (d > 0) return `${d}d ${h}h ${m}m`;
		if (h > 0) return `${h}h ${m}m ${s}s`;
		return `${m}m ${s}s`;
	}, [p.expires_at, now]);

	// Feed "liked" state sync — the card is memoized and often reused without a
	// remount (route reuse, realtime refetch, PostDetail fetch cycles), so the
	// init-only useState(myVote || []) above goes stale. Two effects keep the
	// vote UI aligned with the source of truth:
	//
	// 1. A DIFFERENT poll arriving on the same component instance (route/memo
	//    reuse without a key) resets all vote UI. Deliberately keyed only on
	//    poll.id so a realtime refetch of the SAME poll does not wipe the
	//    in-progress state or the just-confirmed server response.
	const pollId = p.id;
	/* eslint-disable react-hooks/exhaustive-deps -- myVote is intentionally excluded: resetting on every refetch would clobber in-progress selections */
	useEffect(() => {
		setLocal(null);
		setSelected(myVote || []);
		setVoted((myVote || []).length > 0);
		setChangingVote(false);
	}, [pollId]);
	/* eslint-enable react-hooks/exhaustive-deps */

	// 2. The same poll's myVote arriving late (first fetch) or changing via
	//    realtime (another tab's vote) flips the card into the voted state.
	//    Also handles myVote going from voted → empty (admin removed vote,
	//    or the 'no vote' confirmation arrived late from the server).
	//    Never clobbers a vote change the user is still mid-making.
	useEffect(() => {
		if (changingVote) return;
		const hasVote = (myVote || []).length > 0;
		setVoted(hasVote);
		if (hasVote) {
			setSelected(myVote || []);
		}
	}, [myVote, changingVote]);

	// Poll-close notification — tell the author their poll has closed ONCE
	// per browser, not on every visit to a page containing the expired poll.
	const notifiedClose = useRef(false);
	useEffect(() => {
		if (closed && isOwner && !notifiedClose.current) {
			notifiedClose.current = true;
			// Session-level dedupe: the ref above only survives this mount.
			const dedupeKey = `vb:pollclosed:${p.id}`;
			try {
				if (sessionStorage.getItem(dedupeKey)) return;
				sessionStorage.setItem(dedupeKey, "1");
			} catch {
				/* storage unavailable — ref guard still prevents same-mount spam */
			}
			api
				.post("/api/polls", {
					action: "closed",
					poll_id: p.id,
					author_id: anonId,
				})
				.catch(() => {});
		}
	}, [closed, isOwner, p.id, anonId]);

	const toggle = (i: number) => {
		// Option buttons are disabled while closed (unless changing a vote), so
		// this guard is unreachable through the UI — kept as defense-in-depth.
		/* v8 ignore next -- @preserve */
		if (closed && !changingVote) return;
		if (p.ptype === "multi")
			setSelected((s) =>
				s.includes(i) ? s.filter((x) => x !== i) : [...s, i],
			);
		else setSelected((s) => (s.includes(i) ? [] : [i])); // tap again to deselect in single-choice
	};

	const vote = async () => {
		// Vote / Submit-new-vote buttons are disabled while nothing is selected,
		// so this guard is unreachable through the UI — kept as defense-in-depth.
		/* v8 ignore start -- @preserve */
		if (!selected.length) {
			toast("Select an option first", "err");
			return;
		}
		/* v8 ignore stop -- @preserve */
		setBusy(true);
		try {
			const res = await api.post<PollData>("/api/polls", {
				action: "vote",
				poll_id: p.id,
				author_id: anonId,
				choices: selected,
			});
			setLocal(res);
			setVoted(true);
			setChangingVote(false);
			onVoted?.();
			toast(
				voted
					? "Vote updated — anonymously 🔒"
					: "Vote recorded — anonymously 🔒",
				"ok",
			);
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to record vote", "err");
		}
		setBusy(false);
	};

	const startChangeVote = () => {
		setChangingVote(true);
	};

	const cancelChangeVote = () => {
		setChangingVote(false);
		setSelected(myVote || []);
	};

	return (
		<div className="card p-4 sm:p-5 vb-rise">
			<div className="flex items-start justify-between gap-2 mb-3">
				<h3 className="font-display font-semibold text-[15px] leading-snug flex items-center gap-2">
					<BarChart3 size={16} className="text-accent shrink-0" />
					{p.title}
				</h3>
				<div className="flex flex-col items-end gap-1 shrink-0">
					{p.archived && (
						<span className="chip">
							<Archive size={11} /> Archived
						</span>
					)}
					{expired && !p.archived && (
						<span className="chip !text-warn">
							<Clock size={11} /> Ended{p.expires_at ? (() => {
								const daysLeft = Math.max(0, Math.ceil((7 * 86400000 - (Date.now() - new Date(p.expires_at).getTime())) / 86400000));
								return daysLeft > 0 ? ` · results ${daysLeft}d` : '';
							})() : ''}
						</span>
					)}
					{p.expires_at && !expired && countdown && (
						<span className="chip">
							<Clock size={11} /> ends in {countdown}
						</span>
					)}
				</div>
			</div>
			{changingVote && (
				<p className="text-xs font-semibold text-accent mb-2 flex items-center gap-1.5">
					<RotateCcw size={12} /> Pick your new choice — then submit below
				</p>
			)}
			<div
				className="space-y-2"
				role={p.ptype === "multi" ? "group" : "radiogroup"}
				aria-label={p.title}
			>
				{(p.options || []).map((opt: string, i: number) => {
					const n = p.vote_counts?.[i] || 0;
					const pct = total ? Math.round((n / total) * 100) : 0;
					const isMine = selected.includes(i);
					const wasOriginal = (myVote || []).includes(i);
					return (
						<button
							key={i}
							onClick={() => toggle(i)}
							disabled={closed && !changingVote}
							role={p.ptype === "multi" ? "checkbox" : "radio"}
							aria-checked={isMine}
							className={`relative w-full text-left rounded-xl border overflow-hidden transition-all ${isMine && (!showResults || changingVote) ? "border-accent bg-accent-soft" : "border-border hover:border-accent/50"} ${closed && !changingVote ? "cursor-default" : ""}`}
						>
							{showResults && !changingVote && (
								<span
									className="absolute inset-y-0 left-0 bg-accent-soft vb-bar-anim"
									style={{ width: `${pct}%` }}
									aria-hidden
								/>
							)}
							<span className="relative flex items-center justify-between px-3.5 py-2.5 text-sm">
								<span className="flex items-center gap-2 font-medium">
									{isMine && showResults && !changingVote && (
										<CheckCircle2 size={14} className="text-accent" />
									)}
									{changingVote && isMine && (
										<RotateCcw size={13} className="text-accent" />
									)}
									{opt}
									{changingVote && wasOriginal && !isMine && (
										<span className="text-[10px] text-ink3">
											(your previous pick)
										</span>
									)}
								</span>
								{showResults && !changingVote && (
									<span className="font-mono text-xs font-semibold text-accent">
										{pct}% · {n}
									</span>
								)}
							</span>
						</button>
					);
				})}
			</div>
			<div className="flex items-center justify-between mt-3">
				<div className="flex items-center gap-2">
					<span className="text-xs text-ink3">
						{total} vote{total !== 1 ? "s" : ""} ·{" "}
						{p.ptype === "multi"
							? "multiple choice"
							: p.ptype === "yesno"
								? "yes / no"
								: "single choice"}
					</span>
					{!closed && !voted && (
						<span className="text-[10px] text-ink3 italic">Not voted yet</span>
					)}
					{!closed && voted && !changingVote && (
						<span className="text-[10px] text-accent font-medium">You voted</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					{isOwner && (
						<button
							className="btn btn-danger !p-1.5"
							onClick={() => setShowDelete(true)}
							aria-label="Delete my poll"
							title="Delete my poll"
						>
							<Trash2 size={13} />
						</button>
					)}
					{!closed && !voted && (
						<button
							className="btn btn-primary !py-1.5 !px-4 !text-xs"
							onClick={vote}
							disabled={busy || !selected.length}
						>
							{busy ? "Voting…" : "Vote"}
						</button>
					)}
					{!closed && voted && !changingVote && (
						<button
							className="btn btn-ghost !py-1.5 !px-3 !text-xs transition-all duration-200 hover:shadow-sm"
							onClick={startChangeVote}
							disabled={busy}
						>
							<RotateCcw
								size={12}
								className="transition-transform duration-200 hover:rotate-[-45deg]"
							/>{" "}
							Change vote
						</button>
					)}
					{!closed && changingVote && (
						<>
							<button
								className="btn btn-ghost !py-1.5 !px-3 !text-xs"
								onClick={cancelChangeVote}
								disabled={busy}
							>
								Cancel
							</button>
							<button
								className="btn btn-primary !py-1.5 !px-4 !text-xs"
								onClick={vote}
								disabled={busy || !selected.length}
							>
								{busy ? "Updating…" : "Submit new vote"}
							</button>
						</>
					)}
				</div>
			</div>
			{/* Admin controls — archive, stop voting, delete */}
			{hasAdminSession() && (
				<div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
					<span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-accent mr-1">
						<ShieldCheck size={12} aria-hidden /> Admin
					</span>
					{!p.archived && !expired && (
						<button
							type="button"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								try {
									await api.put("/api/polls", { id: p.id, archived: true });
									toast("Poll archived", "ok");
									onVoted?.();
								} catch (e: unknown) {
									toast(e instanceof Error ? e.message : "Failed", "err");
								}
								setBusy(false);
							}}
						className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-warn bg-warn/10 border border-warn/25 transition-colors disabled:opacity-40"
						>
							<Archive size={12} /> Archive
						</button>
					)}
					{p.archived && (
						<button
							type="button"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								try {
									await api.put("/api/polls", { id: p.id, archived: false });
									toast("Poll restored", "ok");
									onVoted?.();
								} catch (e: unknown) {
									toast(e instanceof Error ? e.message : "Failed", "err");
								}
								setBusy(false);
							}}
						className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-good bg-good/10 border border-good/25 transition-colors disabled:opacity-40"
						>
							<Lock size={12} /> Restore
						</button>
					)}
					{!expired && (
						<button
							type="button"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								try {
									await api.put("/api/polls", {
										id: p.id,
										expires_at: new Date().toISOString(),
									});
									toast("Voting stopped", "ok");
									onVoted?.();
								} catch (e: unknown) {
									toast(e instanceof Error ? e.message : "Failed", "err");
								}
								setBusy(false);
							}}
						className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-blue-400 bg-blue-500/10 border border-blue-500/25 transition-colors disabled:opacity-40"
						>
							<Lock size={12} /> Stop voting
						</button>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={() => setShowDelete(true)}
						className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-400 bg-red-500/10 border border-red-500/25 transition-colors disabled:opacity-40"
					>
						<Trash2 size={12} /> Delete
					</button>
				</div>
			)}

			{/* AI insight on results */}
			{showResults && total > 0 && <PollInsight poll={p} />}

			<ConfirmDialog
				open={showDelete}
				onClose={() => setShowDelete(false)}
				onConfirm={deleteOwn}
				title="Delete your poll?"
				message="Your poll will be removed. You can undo within 30 seconds using the toast at the bottom of the screen."
				confirmLabel="Delete poll"
				danger
			/>
		</div>
	);
});

export default PollCard;

/** One-line AI insight, fetched lazily on demand — memoized to avoid
    re-fetching the AI endpoint on every parent render (the feed polls
    on realtime events). */
const PollInsight = memo(function PollInsight({ poll }: { poll: PollData }) {
	const [insight, setInsight] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const fetchInsight = async () => {
		setLoading(true);
		try {
			const r = await api.post<{ insight?: string }>("/api/ai", {
				task: "poll_insight",
				poll: {
					title: poll.title,
					options: poll.options,
					vote_counts: poll.vote_counts,
					total_votes: poll.total_votes,
				},
			});
			setInsight(r.insight ?? null);
		} catch {
			setInsight("Insight unavailable right now.");
		}
		setLoading(false);
	};

	if (insight) {
		return (
			<p
				className="text-xs mt-3 px-3 py-2 rounded-xl vb-rise flex items-start gap-2"
				style={{
					background: "var(--vb-accent-soft)",
					color: "var(--vb-accent)",
				}}
			>
				<Sparkles size={14} className="shrink-0 mt-0.5" />
				<span>{insight}</span>
			</p>
		);
	}
	return (
		<button
			className="flex items-center gap-1.5 text-[11px] font-semibold text-accent mt-3 hover:underline disabled:opacity-50 transition-colors"
			onClick={fetchInsight}
			disabled={loading}
		>
			<Sparkles size={12} />{" "}
			{loading ? "Analyzing results…" : "Get AI insight on results"}
		</button>
	);
});
