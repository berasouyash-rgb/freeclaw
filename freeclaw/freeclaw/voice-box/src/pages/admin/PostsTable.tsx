import {
	BarChart3,
	CheckCircle2,
	Download,
	Eye,
	EyeOff,
	GitMerge,
	Loader2,
	Lock,
	MessageSquare,
	Pin,
	Play,
	RotateCcw,
	Search,
	ShieldCheck,
	Sparkles,
	Trash2,
	Unlock,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fireConfetti } from "../../components/Confetti";
import {
	buildComplianceCSV,
	filterByDateRange,
	type DateRange,
	type DateRangePreset,
} from "../../lib/complianceCSV";
import { ConfirmDialog, PromptDialog, StatusDialog } from "../../components/ui";
import { useApp } from "../../contexts/AppContext";
import { useCategories } from "../../hooks/useCategories";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { api } from "../../lib/api";
import { useRealtime } from "../../lib/useRealtime";
import {
	CATEGORIES,
	PRIORITY_META,
	STATUS_META,
	downloadFile,
	sanitize,
	timeAgo,
} from "../../lib/utils";
import type { PostData, PostStatus } from "../../types";

export default function PostsTable({
	type,
}: {
	type: "problem" | "suggestion";
}) {
	const { toast } = useApp();
	const categories = useCategories();
	const [query, setQuery] = useState("");
	const [statusF, setStatusF] = useState("all");
	const [catF, setCatF] = useState("All");
	const [priorityF, setPriorityF] = useState("all");
	const [selected, setSelected] = useState<PostData | null>(null);
	const [dialog, setDialog] = useState<{
		kind: "delete" | "merge" | "poll";
		payload?: string | PostData;
	} | null>(null);
	const [statusDialog, setStatusDialog] = useState<{
		id: string;
		status: string;
	} | null>(null);
	const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("all");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

	const fetchPosts = useCallback(
		async ({ cursor, limit }: { cursor: string | null; limit: number }) => {
			const result = await api.paginated<PostData>(
				`/api/posts?all=1&type=${type}`,
				{ cursor, limit },
			);
			return {
				data: result.data || [],
				nextCursor: result.nextCursor,
				total: result.total || 0,
			};
		},
		[type],
	);

	const {
		items: posts,
		loading,
		initialLoading,
		hasMore,
		total,
		sentinelRef,
		setItems,
	} = useInfiniteScroll<PostData>(fetchPosts, { limit: 30 });

	// ─── Live updates ─────────────────────────────────────────────
	// Mirrors the ContentReview/Home realtime idiom: new submissions and
	// status edits appear in the table without a manual refresh. The merge is
	// silent (no skeleton flash), keeps scroll position, and dedupes by id.
	// getFresh bypasses the 5s GET cache so realtime events show live data.
	const [liveTotal, setLiveTotal] = useState(total);
	useEffect(() => {
		setLiveTotal(total);
	}, [total]);

	const refresh = useCallback(async () => {
		try {
			const r = await api.getFresh<{ data: PostData[]; total: number }>(
				`/api/posts?all=1&type=${type}&paginate=1&limit=30`,
			);
			const fresh = Array.isArray(r?.data) ? r.data : [];
			setItems((prev) => {
				const freshById = new Map(fresh.map((p) => [p.id, p]));
				const known = new Set(prev.map((p) => p.id));
				const merged = prev.map((p) => freshById.get(p.id) ?? p);
				return [...fresh.filter((p) => !known.has(p.id)), ...merged];
			});
			setLiveTotal(typeof r?.total === "number" ? r.total : 0);
		} catch {
			// Transient failure — keep current rows; the next event will retry.
		}
	}, [type, setItems]);

	// Realtime covers ALL engagement surfaces — not just post edits — so
	// supports/hearts/votes/comments update the admin snapshot live.
	useRealtime(
		["posts", "reactions", "poll_votes", "comments"],
		() => refresh(),
		1000,
	);

	const exportRows = async () => {
		const all: PostData[] = [];
		let cursor: string | null = null;
		do {
			const r: { data: PostData[]; nextCursor: string | null; total: number } =
				await api.paginated<PostData>(`/api/posts?all=1&type=${type}`, {
					cursor,
					limit: 100,
				});
			all.push(...(r.data || []));
			cursor = r.nextCursor ?? null;
		} while (cursor);
		return all;
	};	const exportComplianceCSV = async () => {
		const all = await exportRows();
		// Apply the same filters the table is currently showing so the
		// export matches what the admin sees (not the entire dataset).
		let list = all;
		if (statusF !== "all") list = list.filter((p) => p.status === statusF);
		if (catF !== "All") list = list.filter((p) => p.category === catF);
		if (priorityF !== "all") list = list.filter((p) => p.priority === priorityF);
		if (query.trim()) {
			const q = query.trim().toLowerCase();
			list = list.filter(
				(p) =>
					p.title.toLowerCase().includes(q) ||
					(p.description || "").toLowerCase().includes(q) ||
					p.author_id.toLowerCase().includes(q) ||
					p.id.toLowerCase().includes(q),
			);
		}
		const range: DateRange = { preset: dateRangePreset };
		const csv = buildComplianceCSV(list, range, type);
		const label =
			dateRangePreset === "all"
				? "all-time"
				: dateRangePreset.replace(/_/g, "-");
		const filterLabel = statusF !== "all" ? `-${statusF}` : "";
		const filename = `voicebox-${type === "problem" ? "complaints" : "suggestions"}${filterLabel}-${label}.csv`;
		downloadFile(filename, csv, "text/csv;charset=utf-8");
		toast(`Exported ${filterByDateRange(list, range).length} rows (${label}${statusF !== "all" ? `, status=${statusF}` : ""})`, "ok");
	};

	// How many records match the current date range
	const [rangeCount, setRangeCount] = useState<number | null>(null);
	useEffect(() => {
		// Update count when date range or posts change
		if (posts.length > 0) {
			const range: DateRange = { preset: dateRangePreset };
			setRangeCount(filterByDateRange(posts, range).length);
		} else {
			setRangeCount(null);
		}
	}, [dateRangePreset, posts]);

	const update = async (id: string, patch: Partial<PostData>) => {
		try {
			const updated = await api.put<Record<string, unknown>>("/api/posts", {
				id,
				...patch,
			});
			setItems((prev) =>
				prev.map((p) => (p.id === id ? { ...p, ...updated } : p)),
			);
			if (selected?.id === id)
				setSelected((s) => (s ? ({ ...s, ...updated } as PostData) : null));
			if (patch.status === "solved") {
				fireConfetti();
				toast("Issue solved — the community will be notified!", "ok");
			} else toast("Updated", "ok");
		} catch (e: unknown) {
			toast(
				e instanceof Error
					? e.message
					: "Operation failed - check console for details",
				"err",
			);
		}
	};

	const hardDelete = async (id: string) => {
		try {
			await api.del("/api/posts", { id });
			setItems((p) => p.filter((x) => x.id !== id));
			setSelected(null);
			toast("Permanently deleted", "ok");
		} catch (e: unknown) {
			toast(
				e instanceof Error
					? e.message
					: "Operation failed - check console for details",
				"err",
			);
		}
	};

	const merge = async (id: string, target: string) => {
		await update(id, {
			merged_into: sanitize(target, 60),
			hidden: true,
			status_note: `Merged into ${target}`,
		});
	};

	const messageAuthor = (authorId: string) => {
		sessionStorage.setItem("vb:adminChatTarget", authorId);
		window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "inbox" }));
	};

	const convertToPoll = async (p: PostData) => {
		try {
			await api.post("/api/polls", {
				title: `Do you agree: ${p.title}?`,
				ptype: "yesno",
				post_id: p.id,
				author_id: "ADMIN",
			});
			toast("Linked poll created", "ok");
		} catch (e: unknown) {
			toast(
				e instanceof Error
					? e.message
					: "Operation failed - check console for details",
				"err",
			);
		}
	};

	const filtered = useMemo(() => {
		let list = posts;
		if (statusF !== "all") list = list.filter((p) => p.status === statusF);
		if (catF !== "All") list = list.filter((p) => p.category === catF);
		if (priorityF !== "all") list = list.filter((p) => p.priority === priorityF);
		if (query.trim()) {
			const q = query.trim().toLowerCase();
			list = list.filter(
				(p) =>
					p.title.toLowerCase().includes(q) ||
					(p.description || "").toLowerCase().includes(q) ||
					p.author_id.toLowerCase().includes(q) ||
					p.id.toLowerCase().includes(q) ||
					(p.category || "").toLowerCase().includes(q),
			);
		}
		return list;
	}, [posts, statusF, catF, query]);

	// Clear selection when filters change
	useEffect(() => setSelectedIds(new Set()), [statusF, catF, priorityF, query]);

	const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

	const toggleAll = () => {
		if (allVisibleSelected) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(filtered.map((p) => p.id)));
		}
	};

	const toggleOne = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const bulkDelete = async () => {
		const ids = [...selectedIds];
		let deleted = 0;
		for (const id of ids) {
			try {
				await api.del("/api/posts", { id });
				deleted++;
			} catch {
				// continue on failure — some may be protected
			}
		}
		setItems((prev) => prev.filter((p) => !selectedIds.has(p.id)));
		setSelectedIds(new Set());
		setBulkDeleteOpen(false);
		toast(`Deleted ${deleted} of ${ids.length} posts`, deleted === ids.length ? "ok" : "err");
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<h1 className="font-display font-bold text-xl">
					{type === "problem" ? "Complaint management" : "Suggestions"}
				</h1>
				<div className="flex items-center gap-3 flex-wrap">
					<select
						className="input !py-1.5 !px-2.5 !text-xs !w-auto"
						value={dateRangePreset}
						onChange={(e) =>
							setDateRangePreset(e.target.value as DateRangePreset)
						}
					>
						<option value="all">All Time</option>
						<option value="today">Today</option>
						<option value="this_week">This Week</option>
						<option value="this_month">This Month</option>
						<option value="last_30_days">Last 30 Days</option>
						<option value="last_90_days">Last 90 Days</option>
					</select>
					<button
						className="btn btn-soft !py-1.5 !px-3 text-xs flex items-center gap-1.5"
						onClick={exportComplianceCSV}
					>
						<Download size={13} /> Export Report
					</button>
					<span className="text-xs text-ink3">
						{rangeCount !== null ? `${rangeCount} / ` : ""}{liveTotal} total
					</span>
				</div>
			</div>
			<div className="flex flex-wrap gap-2 mb-4">
				<div className="relative flex-1 min-w-48">
					<Search
						size={14}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
					/>
					<input
						className="input !pl-8 !py-2 text-sm"
						placeholder="Search title, author ID, post ID…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
				<select
					className="input !w-auto !py-2 text-sm"
					value={statusF}
					onChange={(e) => setStatusF(e.target.value)}
				>
					<option value="all">All statuses</option>
					{Object.entries(STATUS_META).map(([k, v]) => (
						<option key={k} value={k}>
							{v.label}
						</option>
					))}
				</select>
				<select
					className="input !w-auto !py-2 text-sm"
					value={catF}
					onChange={(e) => setCatF(e.target.value)}
				>
					<option>All</option>
					{categories.map((c) => (
						<option key={c}>{c}</option>
					))}
				</select>
				<select
					className="input !w-auto !py-2 text-sm"
					value={priorityF}
					onChange={(e) => setPriorityF(e.target.value)}
				>
					<option value="all">All priorities</option>
					{Object.entries(PRIORITY_META).map(([k, v]) => (
						<option key={k} value={k}>
							{v.label}
						</option>
					))}
				</select>
			</div>

			{initialLoading ? (
				<div className="space-y-2">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="skeleton h-14" />
					))}
				</div>
			) : (
				<div>
					<div className="card overflow-x-auto">
						<table className="w-full text-sm min-w-[760px]">
						<thead>
						<tr className="text-left text-[11px] uppercase tracking-wide text-ink3 border-b border-border">
							<th className="px-4 py-3 w-8">
								<input
									type="checkbox"
									checked={allVisibleSelected}
									onChange={toggleAll}
									aria-label="Select all visible posts"
									className="cursor-pointer"
								/>
							</th>
							<th className="px-4 py-3">Title</th>
								<th className="px-2 py-3">Category</th>
								<th className="px-2 py-3">Priority</th>
							<th className="px-2 py-3">Status</th>
								<th className="px-2 py-3">Author</th>
								<th className="px-2 py-3">Age</th>
								<th className="px-2 py-3" title="Supports · Comments · Poll votes — live">
									Live
								</th>
									<th className="px-2 py-3">Actions</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((p) => (
								<tr
									key={p.id}
									className={`border-b border-border last:border-0 hover:bg-surface2/60 cursor-pointer transition-colors ${selectedIds.has(p.id) ? "bg-accent/5" : ""}`}
									onClick={() => setSelected(p)}
								>
									<td className="px-4 py-3 w-8" onClick={(e) => e.stopPropagation()}>
										<input
											type="checkbox"
											checked={selectedIds.has(p.id)}
											onChange={() => toggleOne(p.id)}
											aria-label={`Select ${p.title}`}
											className="cursor-pointer"
										/>
									</td>
									<td className="px-4 py-3 font-medium max-w-64">
										<span className="line-clamp-1">{p.title}</span>
										{p.status === "pending_review" && (
											<span className="ml-1.5 text-[10px] text-warn font-semibold" title="Held for review — possible PII or quality issue">
												🔒
											</span>
										)}
									</td>
									<td className="px-2 py-3 text-xs">{p.category}</td>									<td className="px-2 py-3 text-xs" title={`Auto-assigned: ${p.priority}`}>
										<span
											className="inline-flex items-center gap-1 font-semibold"
											style={{ color: PRIORITY_META[p.priority]?.color }}
										>
											{p.priority === "critical" && "🔴"}
											{p.priority === "high" && "🟠"}
											{p.priority === "low" && "🟢"}
											{PRIORITY_META[p.priority]?.label || "Medium"}
										</span>
									</td>
									<td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
										<select
											className="input !py-1 !px-2 !text-[11px] !w-auto font-semibold !rounded-lg"
											style={{ color: STATUS_META[p.status]?.color }}
											value={p.status}
											onChange={(e) =>
												setStatusDialog({ id: p.id, status: e.target.value })
											}
											aria-label={`Status for ${p.title}`}
										>
											{Object.entries(STATUS_META).map(([k, v]) => (
												<option key={k} value={k}>
													{v.label}
												</option>
											))}
										</select>
									</td>
									<td className="px-2 py-3 font-mono text-[11px] text-ink3">
										{p.author_id?.slice(0, 10) ?? "anon"}
									</td>
								<td className="px-2 py-3 text-xs text-ink3">
									{timeAgo(p.created_at)}
								</td>
								<td
									className="px-2 py-3 text-[11px] font-mono whitespace-nowrap"
									title="Supports · Comments · Poll votes (live)"
								>
									<span className="text-good">
										▲{p.reactions?.support ?? 0}
									</span>{" "}
									<span className="text-bad">♥{p.reactions?.heart ?? 0}</span>{" "}
									<span className="text-ink2 inline-flex items-center gap-0.5">
										<MessageSquare size={10} />
										{p.comment_count ?? 0}
									</span>{" "}
									{p.linked_poll != null && (
										<span className="text-accent inline-flex items-center gap-0.5">
											<BarChart3 size={10} />
											{p.linked_poll_votes ?? 0}
										</span>
									)}
								</td>
									<td className="px-2 py-3">
										<div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
											<button
												className={`p-1 rounded transition-colors ${p.hidden ? 'text-red-400 bg-red-500/10' : 'text-ink3 hover:text-red-400 hover:bg-red-500/10'}`}
												title={p.hidden ? 'Unhide post' : 'Hide post (flag)'}
												onClick={() => update(p.id, { hidden: !p.hidden })}
											>
												{p.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
											</button>
											<button
												className={`p-1 rounded transition-colors ${p.official ? 'text-amber-400 bg-amber-500/10' : 'text-ink3 hover:text-amber-400 hover:bg-amber-500/10'}`}
												title={p.official ? 'Remove official' : 'Mark official'}
												onClick={() => update(p.id, { official: !p.official })}
											>
												<ShieldCheck size={13} />
											</button>
										</div>
									</td>
								</tr>
							))}
							{filtered.length === 0 && (
								<tr>
									<td
										colSpan={8}
										className="px-4 py-8 text-center text-ink3 text-xs"
									>
										No posts match your filters.
									</td>
								</tr>
							)}
						</tbody>
					</table>
					{/* Infinite scroll sentinel */}
					<div ref={sentinelRef} className="h-4" />
					{loading && !initialLoading && (
						<div className="flex items-center justify-center py-3 gap-2 text-ink3 text-xs">
							<Loader2 size={14} className="animate-spin" /> Loading more posts…
						</div>
					)}
					{!hasMore && posts.length > 0 && (
						<p className="text-center text-[11px] text-ink3 py-2">
							All {total} posts loaded
						</p>
					)}
					</div>

				{/* Bulk action bar */}
				{selectedIds.size > 0 && (
					<div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 card px-4 py-3 flex items-center gap-3 shadow-xl vb-rise">
						<span className="text-sm font-semibold">
							{selectedIds.size} selected
						</span>
						<select
						className="input !py-1.5 !px-2 !text-xs !w-auto"
						value=""
						onChange={(e) => {
							if (e.target.value) {
								setStatusDialog({ id: "BULK", status: e.target.value });
								e.target.value = "";
							}
						}}
						aria-label="Bulk status change"
					>
						<option value="" disabled>Change status…</option>
						{Object.entries(STATUS_META).map(([k, v]) => (
							<option key={k} value={k}>{v.label}</option>
						))}
					</select>
						<button
							className="btn btn-soft !py-1.5 !px-3 !text-xs"
							onClick={() => {
								const selectedPosts = posts.filter((p) => selectedIds.has(p.id));
								const range: DateRange = { preset: "all" };
								const csv = buildComplianceCSV(selectedPosts, range, type);
								const filename = `voicebox-selected-${selectedIds.size}-${type}s.csv`;
								downloadFile(filename, csv, "text/csv;charset=utf-8");
								toast(`Exported ${selectedIds.size} selected posts`, "ok");
							}}
						>
							<Download size={13} /> Export selected
						</button>
						<button
							className="btn btn-danger !py-1.5 !px-3 !text-xs"
							onClick={() => setBulkDeleteOpen(true)}
						>
							<Trash2 size={13} /> Delete
						</button>
						<button
							className="btn btn-ghost !p-1.5 !text-xs"
							onClick={() => setSelectedIds(new Set())}
						>
							<X size={14} />
						</button>
					</div>
				)}
			</div>
			)}

			{/* Detail drawer */}
			{selected && (
				<div className="fixed inset-0 z-50 flex justify-end">
					<div
						className="absolute inset-0 bg-black/40"
						onClick={() => setSelected(null)}
					/>
					<div className="relative w-full max-w-lg bg-surface h-full overflow-y-auto p-5 vb-rise">
						<div className="flex items-start justify-between gap-3 mb-4">
							<div>
								<h2 className="font-display font-bold leading-snug">
									{selected.title}
								</h2>
								<p className="text-[11px] text-ink3 font-mono mt-1">
									{selected.id} · by {selected.author_id}
								</p>
								<div className="flex gap-1.5 mt-2">
									{selected.status !== "in_progress" &&
										selected.status !== "solved" && (
											<button
												className="btn btn-soft !py-1 !px-2.5 !text-[11px]"
												onClick={() =>
													setStatusDialog({
														id: selected.id,
														status: "in_progress",
													})
												}
											>
												<Play size={11} /> Start progress
											</button>
										)}
									{selected.status !== "solved" && (
										<button
											className="btn !py-1 !px-2.5 !text-[11px]"
											style={{
												background: "rgba(22,160,106,0.12)",
												color: "var(--vb-good)",
											}}
											onClick={() =>
												setStatusDialog({ id: selected.id, status: "solved" })
											}
										>
											<CheckCircle2 size={11} /> Mark solved
										</button>
									)}
									<button
										className="btn btn-ghost !py-1 !px-2.5 !text-[11px]"
										onClick={() => messageAuthor(selected.author_id)}
									>
										<MessageSquare size={11} /> Message author
									</button>
								</div>
							</div>
							<button
								className="btn btn-ghost !p-2 shrink-0"
								onClick={() => setSelected(null)}
							>
								<X size={16} />
							</button>
						</div>
						<p className="text-sm text-ink2 prose-desc mb-4">
							{selected.description}
						</p>
						{selected.image_url && (
							<img
								src={selected.image_url}
								alt=""
								className="rounded-xl border border-border mb-4 max-h-56"
								loading="lazy"
							/>
						)}

						<div className="grid grid-cols-2 gap-3 mb-4">
							<label className="text-xs">
								<span className="font-semibold text-ink2">Status</span>
								<select
									className="input !py-1.5 mt-1"
									value={selected.status}
									onChange={(e) =>
										setStatusDialog({ id: selected.id, status: e.target.value })
									}
								>
									{Object.entries(STATUS_META).map(([k, v]) => (
										<option key={k} value={k}>
											{v.label}
										</option>
									))}
								</select>
							</label>

							<label className="text-xs">
								<span className="font-semibold text-ink2">Category</span>
								<select
									className="input !py-1.5 mt-1"
									value={selected.category}
									onChange={(e) =>
										update(selected.id, { category: e.target.value })
									}
								>
									{CATEGORIES.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
							<label className="text-xs">
								<span className="font-semibold text-ink2">
									Assigned moderator
								</span>
								<input
									className="input !py-1.5 mt-1"
									defaultValue={selected.assigned_to || ""}
									placeholder="e.g. Ms. Rivera"
									onBlur={(e) =>
										e.target.value !== (selected.assigned_to || "") &&
										update(selected.id, { assigned_to: e.target.value })
									}
								/>
							</label>
							<label className="text-xs col-span-2">
								<span className="font-semibold text-ink2">
									Estimated completion
								</span>
								<input
									className="input !py-1.5 mt-1"
									defaultValue={selected.eta || ""}
									placeholder="e.g. End of March"
									onBlur={(e) =>
										e.target.value !== (selected.eta || "") &&
										update(selected.id, { eta: e.target.value })
									}
								/>
							</label>
						</div>

						{/* PII Detection Detail Panel */}
						{selected.status === "pending_review" && (
							<div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 mb-4">
								<div className="flex items-center gap-2 mb-2">
									<Lock size={13} className="text-amber-400" />
									<span className="text-[11px] font-bold tracking-[0.12em] text-amber-400">
										PII / CONTENT REVIEW
									</span>
								</div>
								<p className="text-[11px] text-ink2 mb-2">
									This post was held for review. The AI content check flagged potential issues.
								</p>
								<div className="space-y-1.5">
									<div className="flex items-center gap-2 text-[11px]">
										<span className="text-amber-400">⚠</span>
										<span className="text-ink2">Status:</span>
										<span className="font-semibold text-amber-400">Held for admin review</span>
									</div>
									<div className="flex items-center gap-2 text-[11px]">
										<span className="text-ink3">📋</span>
										<span className="text-ink2">Reason:</span>
										<span className="text-ink3">Pre-publish AI check flagged this content</span>
									</div>
									<div className="flex items-center gap-2 text-[11px]">
										<span className="text-ink3">🔒</span>
										<span className="text-ink2">Action:</span>
										<span className="text-ink3">Review and approve/reject manually</span>
									</div>
								</div>
								<div className="flex gap-2 mt-3">
									<button
										className="btn btn-soft !py-1 !px-2.5 !text-[11px]"
										style={{ background: "rgba(22,160,106,0.12)", color: "var(--vb-good)" }}
										onClick={() => update(selected.id, { status: "reported" })}
									>
										<ShieldCheck size={11} /> Approve & publish
									</button>
									<button
										className="btn btn-danger !py-1 !px-2.5 !text-[11px]"
										onClick={() => update(selected.id, { status: "archived", hidden: true })}
									>
										<X size={11} /> Reject
									</button>
								</div>
							</div>
						)}

						<label className="text-xs block mb-3">
							<span className="font-semibold text-ink2">
								Official public reply
							</span>
							<textarea
								className="input mt-1 min-h-20"
								defaultValue={selected.admin_reply || ""}
								placeholder="This reply is shown publicly on the post…"
								onBlur={(e) =>
									e.target.value !== (selected.admin_reply || "") &&
									update(selected.id, { admin_reply: e.target.value })
								}
							/>
						</label>
						<label className="text-xs block mb-4">
							<span className="font-semibold text-ink2">
								Internal notes (admins only)
							</span>
							<textarea
								className="input mt-1 min-h-16"
								defaultValue={selected.admin_notes || ""}
								placeholder="Private moderator notes…"
								onBlur={(e) =>
									e.target.value !== (selected.admin_notes || "") &&
									update(selected.id, { admin_notes: e.target.value })
								}
							/>
						</label>

						<div className="grid grid-cols-2 gap-2">
							<button
								className="btn btn-ghost !text-xs"
								onClick={() =>
									update(selected.id, { pinned: !selected.pinned })
								}
							>
								<Pin size={13} /> {selected.pinned ? "Unpin" : "Pin"}
							</button>
							<button
								className="btn btn-ghost !text-xs"
								onClick={() =>
									update(selected.id, { featured: !selected.featured })
								}
							>
								<Sparkles size={13} />{" "}
								{selected.featured ? "Unfeature" : "Feature"}
							</button>
							<button
								className="btn btn-ghost !text-xs"
								onClick={() =>
									update(selected.id, { hidden: !selected.hidden })
								}
							>
								{selected.hidden ? <Eye size={13} /> : <EyeOff size={13} />}{" "}
								{selected.hidden ? "Unhide" : "Hide"}
							</button>
							<button
								className="btn btn-ghost !text-xs"
								onClick={() =>
									update(selected.id, { locked: !selected.locked })
								}
							>
								{selected.locked ? <Unlock size={13} /> : <Lock size={13} />}{" "}
								{selected.locked ? "Unlock comments" : "Lock comments"}
							</button>
							<button
								className="btn btn-ghost !text-xs"
								onClick={() =>
									setDialog({ kind: "merge", payload: selected.id })
								}
							>
								<GitMerge size={13} /> Merge duplicate
							</button>
							<button
								className="btn btn-ghost !text-xs"
								onClick={() => setDialog({ kind: "poll", payload: selected })}
							>
								<BarChart3 size={13} /> Convert to poll
							</button>
							{type === "suggestion" && (
								<button
									className="btn btn-ghost !text-xs"
									onClick={() =>
										update(selected.id, {
											type: "problem",
											status: "in_progress",
											status_note: "Accepted as project",
										})
									}
								>
									Convert to project
								</button>
							)}
							{selected.deleted ? (
								<button
									className="btn btn-soft !text-xs"
									onClick={() => update(selected.id, { deleted: false })}
								>
									<RotateCcw size={13} /> Restore
								</button>
							) : (
								<button
									className="btn btn-danger !text-xs"
									onClick={() => update(selected.id, { deleted: true })}
								>
									<Trash2 size={13} /> Soft delete
								</button>
							)}
							<button
								className="btn btn-danger !text-xs col-span-2"
								onClick={() =>
									setDialog({ kind: "delete", payload: selected.id })
								}
							>
								<Trash2 size={13} /> Permanently delete
							</button>
						</div>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={dialog?.kind === "delete"}
				onClose={() => setDialog(null)}
				onConfirm={() => hardDelete(dialog!.payload as string)}
				title="Permanently delete?"
				message="This will permanently remove the post and all of its comments. This action cannot be undone."
				confirmLabel="Delete forever"
				danger
			/>
			<ConfirmDialog
				open={dialog?.kind === "poll"}
				onClose={() => setDialog(null)}
				onConfirm={() => convertToPoll(dialog!.payload as PostData)}
				title="Convert to poll"
				message={`Create a linked Yes/No poll asking the community whether they agree with "${(dialog?.payload as PostData)?.title ?? ""}"?`}
				confirmLabel="Create poll"
			/>
			<PromptDialog
				open={dialog?.kind === "merge"}
				onClose={() => setDialog(null)}
				onSubmit={(v) => merge(dialog!.payload as string, v)}
				title="Merge duplicate"
				label="Merge into post ID"
				placeholder="post_abc123 (the canonical post)"
				submitLabel="Merge"
			/>
			<StatusDialog
				open={!!statusDialog}
				onClose={() => setStatusDialog(null)}
				status={statusDialog?.status || ""}
				statusLabel={STATUS_META[statusDialog?.status || ""]?.label || ""}
				onSubmit={(note) => {
					if (!statusDialog) return;
					// Bulk status change: apply to all selected posts
					if (statusDialog.id === "BULK") {
						const ids = [...selectedIds];
						ids.forEach((id) =>
							update(id, {
								status: statusDialog.status as PostStatus,
								status_note: note || undefined,
							}),
						);
						setSelectedIds(new Set());
					} else {
						update(statusDialog.id, {
							status: statusDialog.status as PostStatus,
							status_note: note || undefined,
						});
					}
					setStatusDialog(null);
				}}
			/>
			<ConfirmDialog
				open={bulkDeleteOpen}
				onClose={() => setBulkDeleteOpen(false)}
				onConfirm={bulkDelete}
				title={`Delete ${selectedIds.size} posts?`}
				message="This will permanently remove all selected posts and their comments. This action cannot be undone."
				confirmLabel="Delete all"
				danger
			/>
		</div>
	);
}
