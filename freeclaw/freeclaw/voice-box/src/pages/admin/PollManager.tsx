import { Archive, Eye, EyeOff, Plus, RefreshCw, RotateCcw, ScanSearch, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ui";
import UpdateNotice from "../../components/admin/UpdateNotice";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import { timeAgo } from "../../lib/utils";
import type { PollData } from "../../types";

export default function PollManager() {
	const { toast } = useApp();
	const [polls, setPolls] = useState<PollData[]>([]);
	const [loading, setLoading] = useState(true);
	const [showNew, setShowNew] = useState(false);
	const [title, setTitle] = useState("");
	const [ptype, setPtype] = useState<"yesno" | "single" | "multi">("yesno");
	const [opts, setOpts] = useState("");
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [scan, setScan] = useState<{ id: string; flags: string[]; message: string } | null>(null);
	const [scanBusy, setScanBusy] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setPolls(await api.get("/api/polls"));
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to load polls", "err");
		}
		setLoading(false);
	}, [toast]);
	useEffect(() => {
		load();
	}, [load]);

	// ─── Targeted live rows + badge fallback ────────────────────
	// A single busy poll fires one `polls` touch per vote. The old
	// handler refetched the WHOLE poll list on every one of them (debounced
	// 2.5s), so a popular poll made the manager visibly thrash. Changed
	// ids now merge one row at a time (see below); anything the merge
	// cannot resolve still raises the badge for an explicit pull.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();
	const [refreshing, setRefreshing] = useState(false);

	const handleRefresh = useCallback(async () => {
		setRefreshing(true);
		try {
			await load();
			clearUpdates();
		} finally {
			setRefreshing(false);
		}
	}, [load, clearUpdates]);

	// ─── Targeted live rows, not a refetch ────────────────────
	// A single busy poll fires one `polls` touch per vote (plus INSERTs for
	// new polls). Changed ids collect here and flush together: one small
	// GET for exactly those rows, merged in place, newcomers appended.
	// Per-row actions (archive/delete/hide/scan) address rows by id, so a
	// merge can never retarget a finger mid-tap — and the badge still
	// raises for anything the merge cannot resolve.
	const pendingPollIds = useRef<Set<string>>(new Set());
	const pollFlushTimer = useRef<number | null>(null);

	const flushPollRows = useCallback(async () => {
		pollFlushTimer.current = null;
		const ids = [...pendingPollIds.current].slice(0, 20);
		pendingPollIds.current.clear();
		if (ids.length === 0) return;
		try {
			const query = ids.map((id) => encodeURIComponent(id)).join(",");
			const rows = await api.getFresh<PollData[]>(
				`/api/polls?ids=${query}`,
			);
			const fresh = (Array.isArray(rows) ? rows : []).filter((r) => r?.id);
			if (!fresh.length) {
				markUpdatesAvailable();
				return;
			}
			setPolls((prev) => {
				const merged = prev.map(
					(p) => fresh.find((r) => r.id === p.id) ?? p,
				);
				for (const row of fresh) {
					if (!merged.some((p) => p.id === row.id)) merged.push(row);
				}
				return merged;
			});
		} catch {
			markUpdatesAvailable();
		}
	}, [markUpdatesAvailable]);

	const schedulePollFlush = useCallback(() => {
		if (pollFlushTimer.current !== null) return;
		pollFlushTimer.current = window.setTimeout(() => {
			void flushPollRows();
		}, 500);
	}, [flushPollRows]);

	useEffect(
		() => () => {
			if (pollFlushTimer.current !== null) {
				window.clearTimeout(pollFlushTimer.current);
				pollFlushTimer.current = null;
			}
		},
		[],
	);

	const handlePollLiveness = useCallback(
		(table: string, payload: { eventType?: string; new?: { id?: string }; old?: { id?: string } }) => {
			if (table === "polls") {
				const evt = payload.eventType;
				const rowId =
					(evt === "DELETE" ? payload.old?.id : payload.new?.id) ??
					payload.old?.id;
				if ((evt === "INSERT" || evt === "UPDATE") && rowId) {
					pendingPollIds.current.add(rowId);
					schedulePollFlush();
					return;
				}
			}
			markUpdatesAvailable();
		},
		[markUpdatesAvailable, schedulePollFlush],
	);

	useRealtime(["polls", "poll_votes"], handlePollLiveness, 1_000);

	const create = async () => {
		try {
			await api.post("/api/polls", {
				title,
				ptype,
				options: opts
					.split("\n")
					.map((o) => o.trim())
					.filter(Boolean),
				author_id: "ADMIN",
			});
			setShowNew(false);
			setTitle("");
			setOpts("");
			load();
			toast("Poll created", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to create poll", "err");
		}
	};

	const setArchived = async (id: string, archived: boolean) => {
		try {
			await api.put("/api/polls", { id, archived });
			load();
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to archive poll", "err");
		}
	};
	const del = async (id: string) => {
		try {
			await api.del(`/api/polls?id=${encodeURIComponent(id)}`, { id });
			load();
			toast("Deleted", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to delete poll", "err");
		}
	};
	const setHidden = async (id: string, hidden: boolean) => {
		try {
			await api.put("/api/polls", { id, hidden });
			load();
			toast(hidden ? "Poll blocked — hidden from public" : "Poll unblocked", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to update poll", "err");
		}
	};
	const scanPoll = async (id: string) => {
		setScanBusy(id);
		try {
			const r = await api.post<{ flags: string[]; message: string }>("/api/polls", {
				action: "scan",
				poll_id: id,
			});
			setScan({ id, flags: r.flags, message: r.message });
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Failed to scan poll", "err");
		}
		setScanBusy(null);
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<h1 className="font-display font-bold text-xl tracking-tight">
					<span className="vb-gradient-text">Poll Manager</span>
				</h1>
				<div className="flex items-center gap-2">
					<button
						className="btn btn-soft !text-xs flex items-center gap-1.5"
						onClick={() => void handleRefresh()}
						disabled={refreshing}
						aria-label="Refresh polls"
					>
						<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
						{refreshing ? "Refreshing…" : "Refresh"}
					</button>
					<button
						className="btn btn-primary !text-xs"
						onClick={() => setShowNew((s) => !s)}
					>
						<Plus size={14} /> New poll
					</button>
				</div>
			</div>

			{showNew && (
				<div className="card p-4 mb-4 space-y-3 vb-rise">
					<input
						className="input"
						placeholder="Poll question"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						maxLength={140}
					/>
					<div className="flex gap-2">
						{(
							[
								["yesno", "Yes/No"],
								["single", "Single"],
								["multi", "Multi"],
							] as const
						).map(([k, l]) => (
							<button
								key={k}
								className={`btn !text-xs flex-1 ${ptype === k ? "btn-soft" : "btn-ghost"}`}
								onClick={() => setPtype(k)}
							>
								{l}
							</button>
						))}
					</div>
					{ptype !== "yesno" && (
						<textarea
							className="input min-h-20"
							placeholder="One option per line (2–10)"
							value={opts}
							onChange={(e) => setOpts(e.target.value)}
						/>
					)}
					<button
						className="btn btn-primary !text-xs"
						onClick={create}
						disabled={title.trim().length < 5}
					>
						Publish poll
					</button>
				</div>
			)}

			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleRefresh()}
				refreshing={refreshing}
			/>

			{loading ? (
				<div className="space-y-2">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-16" />
					))}
				</div>
			) : (
				<div className="space-y-2.5">
					{polls.map((p) => (
						<div key={p.id} className="card p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="font-semibold text-sm">
										{p.title}{" "}
										{p.archived && (
											<span className="chip !text-[10px] ml-1">archived</span>
										)}
										{p.hidden && (
											<span className="chip !text-[10px] ml-1 !text-bad">blocked</span>
										)}
									</p>
									<p className="text-xs text-ink3 mt-0.5">
										{p.ptype} · {p.total_votes ?? 0} votes · created{" "}
										{timeAgo(p.created_at ?? "")}{" "}
										{p.post_id && "· linked to complaint"}
									</p>
								</div>
								<div className="flex gap-1 shrink-0">
									<button
										className="btn btn-ghost !p-2"
										onClick={() => void scanPoll(p.id)}
										disabled={scanBusy === p.id}
										title="Scan for violations"
										aria-label={`Scan poll ${p.title} for violations`}
									>
										<ScanSearch size={14} />
									</button>
									<button
										className="btn btn-ghost !p-2"
										onClick={() => void setHidden(p.id, !p.hidden)}
										title={p.hidden ? "Unblock" : "Block"}
										aria-label={p.hidden ? `Unblock poll ${p.title}` : `Block poll ${p.title}`}
									>
										{p.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
									</button>
									<button
										className="btn btn-ghost !p-2"
										onClick={() => setArchived(p.id, !p.archived)}
										title={p.archived ? "Restore" : "Archive"}
									>
										{p.archived ? (
											<RotateCcw size={14} />
										) : (
											<Archive size={14} />
										)}
									</button>
									<button
										className="btn btn-danger !p-2"
										onClick={() => setDeleteId(p.id)}
										title="Delete"
									>
										<Trash2 size={14} />
									</button>
								</div>
							</div>
							{scan?.id === p.id && (
								<p className="text-[11px] mt-2 px-2 py-1.5 rounded-lg bg-surface2 text-ink2" role="status">
									Scan: {scan.flags.length ? scan.flags.join(", ") : "clean"} — {scan.message}
								</p>
							)}
							{/* results history */}
							<div className="mt-3 space-y-1.5">
								{(p.options || []).map((o: string, i: number) => {
									const n = p.vote_counts?.[i] || 0;
									const pct = p.total_votes
										? Math.round((n / p.total_votes) * 100)
										: 0;
									return (
										<div key={i} className="flex items-center gap-2 text-xs">
											<span className="w-32 truncate">{o}</span>
											<div className="flex-1 h-2.5 rounded bg-surface2 overflow-hidden">
												<div
													className="h-full bg-accent vb-bar-anim"
													style={{ width: `${pct}%` }}
												/>
											</div>
											<span className="font-mono w-14 text-right">
												{pct}% · {n}
											</span>
										</div>
									);
								})}
							</div>
						</div>
					))}
					{polls.length === 0 && (
						<p className="card p-8 text-center text-sm text-ink3">
							No polls yet.
						</p>
					)}
				</div>
			)}
			<ConfirmDialog
				open={!!deleteId}
				onClose={() => setDeleteId(null)}
				onConfirm={() => (deleteId ? del(deleteId) : undefined)}
				title="Delete poll?"
				message="The poll and all of its votes will be permanently removed. This cannot be undone."
				confirmLabel="Delete poll"
				danger
			/>
		</div>
	);
}
