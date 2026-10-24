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
	RefreshCw,
	RotateCcw,
	Search,
	ShieldCheck,
	Sparkles,
	Trash2,
	Unlock,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fireConfetti } from "../../components/Confetti";
import UpdateNotice from "../../components/admin/UpdateNotice";
import {
	buildComplianceCSV,
	filterByDateRange,
	getDateRange,
	type DateRange,
	type DateRangePreset,
} from "../../lib/complianceCSV";
import { ConfirmDialog, PromptDialog, StatusDialog } from "../../components/ui";
import { useApp } from "../../contexts/AppContext";
import { useCategories } from "../../hooks/useCategories";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { BULK_CONCURRENCY, mapWithConcurrency } from "../../lib/async";
import { api } from "../../lib/api";
import { applyOptimistic, revertOptimistic } from "../../lib/optimistic";
import { useRealtime } from "../../lib/useRealtime";
import { useUpdateSignal } from "../../hooks/useUpdateSignal";
import { useAdminStream } from "../../hooks/useAdminStream";
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
	/** Exact-duplicate spam candidates for the open drawer post. */
	const [dupes, setDupes] = useState<
		{ id: string; title: string; category: string; status: string; similarity: number }[] | null
	>(null);
	const [dupBusy, setDupBusy] = useState(false);
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
	// Parked newcomers: count shown in the "N new posts" pill while the
	// admin is scrolled deep (see refresh).
	const [pendingNew, setPendingNew] = useState(0);
	// Tombstones: ids hard-deleted this session. Page loads and realtime
	// merges filter them, so a locally-removed row can never pop back into
	// the list (server lag, stale read, or a delete that never landed).
	const tombstonesRef = useRef<Set<string>>(new Set());
	// Parked rows: realtime newcomers held back while scrolled deep, so the
	// list never shifts under the cursor. Flushed via the pill or on the
	// next near-top refresh.
	const parkedRef = useRef<Map<string, PostData>>(new Map());
	// Below what scroll offset a refresh may prepend. Deeper than this, new
	// rows park behind the pill instead of yanking the list.
	const SCROLLED_DEEP_PX = 600;
	// True when two row lists carry identical content in identical order.
	// Refresh skips setItems then, so a no-change tick never re-renders the
	// table (this is what made the feed feel like it "reloads constantly").
	const sameRows = (a: PostData[], b: PostData[]) =>
		a.length === b.length &&
		a.every(
			(p, i) => p.id === b[i]?.id && JSON.stringify(p) === JSON.stringify(b[i]),
		);

	// ─── Server-side filter chain ─────────────────────────────────
	// Every filter runs in SQL. The table pages 30 rows at a time, so doing
	// this in the browser only ever filtered the rows that happened to be
	// loaded — the date filter in particular searched the 30 most recent
	// posts of all time rather than the dataset, which is why it looked
	// broken. The row total now describes the filtered set too.
	//
	// Search is debounced so typing does not fire a request per keystroke.
	const [serverQuery, setServerQuery] = useState(query);
	useEffect(() => {
		const t = setTimeout(() => setServerQuery(query), 300);
		return () => clearTimeout(t);
	}, [query]);

	const serverFilters = useMemo(() => {
		const range = getDateRange(dateRangePreset);
		const allTime = dateRangePreset === "all";
		return {
			status: statusF !== "all" ? statusF : null,
			category: catF !== "All" ? catF : null,
			priority: priorityF !== "all" ? priorityF : null,
			q: serverQuery.trim() || null,
			from: allTime ? null : range.from.toISOString(),
			to: allTime ? null : range.to.toISOString(),
		};
	}, [statusF, catF, priorityF, serverQuery, dateRangePreset]);

	const fetchPosts = useCallback(
		async ({ cursor, limit }: { cursor: string | null; limit: number }) => {
			const result = await api.paginated<PostData>(
				`/api/posts?all=1&type=${type}`,
				{ cursor, limit, query: serverFilters },
			);
			// Never page a tombstoned row back in.
			const data = (result.data || []).filter(
				(p) => !tombstonesRef.current.has(p.id),
			);
			return {
				data,
				nextCursor: result.nextCursor,
				total: result.total || 0,
			};
		},
		[type, serverFilters],
	);

	const PAGE_SIZE = 100;
	const {
		items: posts,
		loading,
		initialLoading,
		hasMore,
		total,
		sentinelRef,
		setItems,
		softReset,
		loadMore,
	} = useInfiniteScroll<PostData>(fetchPosts, { limit: PAGE_SIZE });

	// Refetch from the first page whenever the filter chain changes, so the
	// rows on screen always belong to the current filters. Skips the first
	// run — the hook already performs the initial load on mount.
	//
	// softReset (not reset) keeps the current rows mounted while the new first
	// page loads: a hard reset blanked the whole table to skeletons on every
	// filter change — including every 300ms debounce pause while typing in the
	// search box — which read as the table glitching and popping back in.
	const filtersMountedRef = useRef(false);
	useEffect(() => {
		if (!filtersMountedRef.current) {
			filtersMountedRef.current = true;
			return;
		}
		softReset();
	}, [serverFilters, softReset]);

	// Load-all: the admin feed shows posts matching the filters without
	// requiring the admin to scroll to an unfired sentinel. After each page
	// lands, the next is fetched automatically.
	//
	// BOUNDED, though: a school-sized dataset is thousands of posts, and
	// pulling every one meant (a) dozens of back-to-back requests on mount and
	// (b) thousands of live <tr> nodes, which is its own kind of lag. So the
	// auto-drain stops at AUTO_LOAD_PAGES and the pager offers an explicit
	// "Load all remaining" — still one click to the full set, but the default
	// view stays responsive.
	const AUTO_LOAD_PAGES = 10;
	const [loadAllWanted, setLoadAllWanted] = useState(false);
	const autoDrainDone =
		loadAllWanted || posts.length >= AUTO_LOAD_PAGES * PAGE_SIZE;
	useEffect(() => {
		if (autoDrainDone) return;
		if (!initialLoading && hasMore && !loading) loadMore();
	}, [autoDrainDone, initialLoading, hasMore, loading, loadMore]);

	// A filter change re-opens the bounded window.
	useEffect(() => {
		setLoadAllWanted(false);
	}, [serverFilters]);

	// Lock background scroll while the detail drawer is open — without
	// this, scrolling the drawer chains into the page behind it.
	// (overscroll-contain on the panel stops wheel chaining; the lock
	// covers touch dragging and restores on close/unmount.)
	useEffect(() => {
		if (!selected) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, [selected]);

	// Serialized filter chain for the realtime refresh below, so a refresh
	// refetches exactly what the admin is looking at.
	const filterQuery = useMemo(() => {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(serverFilters)) {
			if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
		}
		return p.toString();
	}, [serverFilters]);

	// ─── Live updates ─────────────────────────────────────────────
	// Mirrors the ContentReview/Home realtime idiom: new submissions and
	// status edits appear in the table without a manual refresh. The merge is
	// silent (no skeleton flash), keeps scroll position, and dedupes by id.
	// getFresh bypasses the 5s GET cache so realtime events show live data.
	const [liveTotal, setLiveTotal] = useState(total);
	useEffect(() => {
		setLiveTotal(total);
	}, [total]);

	// Mirror of the loaded rows for refresh() reads (refresh must not close
	// over `posts` or every realtime event would re-subscribe the timer).
	const itemsRef = useRef<PostData[]>([]);
	useEffect(() => {
		itemsRef.current = posts;
	}, [posts]);

	const refresh = useCallback(async () => {
		// Never refresh a hidden tab — the user can't see updates anyway,
		// and background ticks were a steady source of "it keeps reloading".
		if (typeof document !== "undefined" && document.hidden) return;
		try {
			// The active filter chain MUST ride along: refreshing the
			// unfiltered newest page injected off-filter rows and overwrote
			// the header total with the whole-dataset count, so both the rows
			// and the "N total" figure jumped on every realtime event.
			const r = await api.getFresh<{ data: PostData[]; total: number }>(
				`/api/posts?all=1&type=${type}&paginate=1&limit=30${filterQuery ? `&${filterQuery}` : ""}`,
			);
			const tomb = tombstonesRef.current;
			const fresh = (Array.isArray(r?.data) ? r.data : []).filter(
				(p) => !tomb.has(p.id),
			);
			const freshById = new Map(fresh.map((p) => [p.id, p]));
			const base = itemsRef.current;
			const known = new Set(base.map((p) => p.id));
			// "Unknown to this list" is NOT the same as "brand new". Deleting a
			// row shifts the server's page-1 boundary up by one, so the refreshed
			// page contains an OLDER post nobody has seen yet. Treating that as
			// a newcomer is what made a random old row teleport in from the top
			// after every delete. Server order decides: an unknown row that
			// outranks the head we already show is genuinely new (top); any
			// unknown row behind the head is backfill (bottom). Falls back to
			// timestamps only when the head row is not in this response.
			const headId = base[0]?.id;
			const headIndex = headId
				? fresh.findIndex((p) => p.id === headId)
				: -1;
			const headAt = base[0]?.created_at
				? Date.parse(base[0].created_at)
				: Number.NaN;
			const unknown = fresh.filter((p) => !known.has(p.id));
			const headlineIds = new Set(
				headIndex >= 0
					? fresh.slice(0, headIndex).map((p) => p.id)
					: unknown
							.filter(
								(p) =>
									Number.isNaN(headAt) ||
									Date.parse(p.created_at) > headAt,
							)
							.map((p) => p.id),
			);
			const isHeadline = (p: PostData) => headlineIds.has(p.id);
			const scrolledDeep =
				typeof window !== "undefined" &&
				window.scrollY > SCROLLED_DEEP_PX;
			// Backfill fills the gap the delete left BELOW the fold — appending
			// never shifts what the admin is looking at, in either scroll state.
			const backfill = unknown.filter((p) => !isHeadline(p));
			if (scrolledDeep) {
				// Scrolled deep: update rows in place, park newcomers behind
				// the pill — prepending here would yank the list under the
				// cursor and read as rows "coming from anywhere".
				for (const p of unknown) {
					if (isHeadline(p) && !parkedRef.current.has(p.id)) {
						parkedRef.current.set(p.id, p);
					}
				}
				if (parkedRef.current.size > 0)
					setPendingNew(parkedRef.current.size);
				const merged = [
					...base.map((p) => freshById.get(p.id) ?? p),
					...backfill,
				];
				if (!sameRows(merged, base)) setItems(merged);
			} else {
				// Near the top: flush parked rows and prepend only the genuinely
				// new posts in a single merge; backfill lands at the bottom.
				const parked = [...parkedRef.current.values()].filter(
					(p) => !tomb.has(p.id) && isHeadline(p),
				);
				parkedRef.current.clear();
				setPendingNew(0);
				const newcomers = [
					...parked.filter((p) => !known.has(p.id) && !freshById.has(p.id)),
					...unknown.filter(isHeadline),
				];
				const merged = [
					...base.map((p) => freshById.get(p.id) ?? p),
					...backfill,
				];
				if (newcomers.length > 0 || !sameRows(merged, base))
					setItems([...newcomers, ...merged]);
			}
			setLiveTotal(typeof r?.total === "number" ? r.total : 0);
		} catch {
			// Transient failure — keep current rows; the next event will retry.
		}
	}, [type, setItems, filterQuery]);

	// ─── Freshness signal, not a refetch ──────────────────────────
	// Realtime covers the post rows themselves — NOT reactions, poll votes
	// or comments. Those are the high-frequency tables, and every single
	// vote/reaction used to refetch the whole feed.
	//
	// The old wiring called `refresh()` on every event (debounced 2.5s).
	// That is what produced the "it keeps reloading" storm: `api.ts` clears
	// the entire GET cache on every non-GET, so a burst of agent writes
	// guaranteed a full refetch per event, and a refetch that finds nothing
	// new still rebuilt every row.
	//
	// Realtime now only RAISES A BADGE. The admin sees "N new posts" and
	// chooses to pull the new snapshot — an explicit Refresh, or the
	// UpdateNotice "View updates" button. Cost is O(1) per event instead of
	// O(rows), and the list is still exactly one click from current.
	const { updatesAvailable, markUpdatesAvailable, clearUpdates } =
		useUpdateSignal();
	const [refreshing, setRefreshing] = useState(false);

	const handleRefresh = useCallback(async () => {
		setRefreshing(true);
		try {
			await refresh();
			clearUpdates();
		} finally {
			setRefreshing(false);
		}
	}, [refresh, clearUpdates]);

	useRealtime(
		["posts"],
		markUpdatesAvailable,
		1_000,
	);
	// Admin stream is a no-op extra here (posts are already live on the
	// anon channel) — kept for uniformity so every admin surface shares
	// the same two-leg freshness story.
	useAdminStream(markUpdatesAvailable);

	// Flush parked newcomers to the top of the list (pill click).
	const showParked = useCallback(() => {
		const parked = [...parkedRef.current.values()].filter(
			(p) => !tombstonesRef.current.has(p.id),
		);
		parkedRef.current.clear();
		setPendingNew(0);
		if (parked.length) {
			setItems((prev) => {
				const known = new Set(prev.map((p) => p.id));
				const fresh = parked.filter((p) => !known.has(p.id));
				return [...fresh, ...prev];
			});
		}
		if (typeof window !== "undefined")
			window.scrollTo({ top: 0, behavior: "smooth" });
	}, [setItems]);

	/**
	 * Page through EVERY row matching the active filters.
	 *
	 * The table auto-loads all pages on screen, but export must not depend
	 * on what happens to be loaded (tombstoned/deleted rows, realtime
	 * merges mid-download). This walks the server cursor with the same
	 * filter params until the filtered set is exhausted.
	 */
	const exportRows = async () => {
		const all: PostData[] = [];
		const seen = new Set<string>();
		let cursor: string | null = null;
		let guard = 0;
		do {
			const r: { data: PostData[]; nextCursor: string | null; total: number } =
				await api.paginated<PostData>(`/api/posts?all=1&type=${type}`, {
				cursor,
				limit: 100,
				query: serverFilters,
			});
			for (const row of r.data || []) {
				if (row?.id && !seen.has(row.id)) {
					seen.add(row.id);
					all.push(row);
				}
			}
			cursor = r.nextCursor ?? null;
			// Hard stop: a cursor that stops advancing must not loop forever.
			if (++guard > 200) break;
		} while (cursor);
		return all;
	};

	const [exporting, setExporting] = useState(false);

	/**
	 * Export exactly what the admin is looking at.
	 *
	 * The exported rows are the SAME rows the table renders (`filtered`), so
	 * every active filter — status, category, priority, search and the date
	 * range — carries through. Previously the export re-derived its own list
	 * and silently dropped filters, which is why downloads contained the whole
	 * dataset instead of the filtered selection.
	 */
	const exportComplianceCSV = async () => {
		setExporting(true);
		try {
			const range: DateRange = { preset: dateRangePreset };
			// Export the whole filtered set from the server, not just the page on
			// screen — an admin exporting "last 30 days" expects every matching
			// report, not the 30 that happen to be loaded.
			const rows = await exportRows();
			const csv = buildComplianceCSV(rows, range, type);
			const label =
				dateRangePreset === "all"
					? "all-time"
					: dateRangePreset.replace(/_/g, "-");
			const parts = [
				statusF !== "all" ? statusF : null,
				catF !== "All" ? catF.toLowerCase().replace(/\s+/g, "-") : null,
				priorityF !== "all" ? priorityF : null,
			].filter(Boolean);
			const filterLabel = parts.length ? `-${parts.join("-")}` : "";
			const filename = `voicebox-${type === "problem" ? "complaints" : "suggestions"}${filterLabel}-${label}.csv`;
			downloadFile(filename, csv, "text/csv;charset=utf-8");
			toast(
				`Exported ${rows.length} filtered row${rows.length === 1 ? "" : "s"} (${label}${parts.length ? `, ${parts.join(", ")}` : ""})`,
				"ok",
			);
		} catch (e: unknown) {
			toast(
				e instanceof Error ? e.message : "Export failed — please retry",
				"err",
			);
		}
		setExporting(false);
	};

	const update = async (
		id: string,
		patch: Partial<PostData>,
		options?: { silent?: boolean },
	): Promise<boolean> => {
		// Optimistic: reflect the tap instantly (slow school Wi-Fi used to
		// leave hide/pin/verify feeling dead for 1-3s). The exact previous
		// row is snapshotted so a failed request rolls back precisely.
		const { prev } = applyOptimistic(posts, id, patch);
		const prevSelected = selected?.id === id ? selected : null;
		setItems((prevItems) =>
			prevItems.map((p) => (p.id === id ? { ...p, ...patch } : p)),
		);
		if (prevSelected)
			setSelected({ ...prevSelected, ...patch });
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
			if (!options?.silent) {
				if (patch.status === "solved") {
					fireConfetti();
					toast("Issue solved — the community will be notified!", "ok");
				} else toast("Updated", "ok");
			}
			return true;
		} catch (e: unknown) {
			setItems((prevItems) => revertOptimistic(prevItems, prev));
			if (prevSelected) setSelected(prevSelected);
			if (!options?.silent) {
				toast(
					e instanceof Error
						? e.message
						: "Operation failed - check console for details",
					"err",
				);
			}
			return false;
		}
	};

	const hardDelete = async (id: string) => {
		// Tombstone BEFORE the network call and drop the row locally at
		// once: our own delete fires a realtime event, and a refresh already
		// in flight while the request is pending would otherwise re-add the
		// row — popping back in from the top — after we remove it.
		tombstonesRef.current.add(id);
		setItems((p) => p.filter((x) => x.id !== id));
		try {
			await api.del(`/api/posts?id=${encodeURIComponent(id)}`, { id });
			setSelected(null);
			toast("Permanently deleted", "ok");
		} catch (e: unknown) {
			// The row still exists on the server — release the tombstone so
			// the next refresh brings it back instead of hiding it forever.
			tombstonesRef.current.delete(id);
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

	/** Spam cleanup: find posts saying exactly the same thing as the open one. */
	const findDupes = async (postId: string) => {
		setDupBusy(true);
		try {
			const r = await api.post<{
				duplicates?: { id: string; title: string; category: string; status: string; similarity: number }[];
			}>("/api/duplicates", { post_id: postId });
			setDupes(r.duplicates || []);
			if (!(r.duplicates || []).length) toast("No duplicates found", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Duplicate check failed", "err");
		}
		setDupBusy(false);
	};

	/** Merge an exact-duplicate spam post into the open one (moves its comments, hides it). */
	const mergeDupe = async (keepId: string, dupeId: string) => {
		try {
			await api.post("/api/duplicates", {
				action: "merge",
				keep_post_id: keepId,
				merge_ids: [dupeId],
			});
			await update(dupeId, { hidden: true, status_note: `Merged into ${keepId}` });
			setDupes((p) => (p || []).filter((d) => d.id !== dupeId));
			toast("Spam merged — comments moved to the kept post", "ok");
		} catch (e: unknown) {
			toast(e instanceof Error ? e.message : "Merge failed", "err");
		}
	};

	/** Remove an exact-duplicate spam post (soft delete — restorable). */
	const removeDupe = async (dupeId: string) => {
		if (await update(dupeId, { deleted: true })) {
			setDupes((p) => (p || []).filter((d) => d.id !== dupeId));
			toast("Spam post removed", "ok");
		}
	};

	const messageAuthor = (authorId: string) => {
		sessionStorage.setItem("vb:adminChatTarget", authorId);
		window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "inbox" }));
	};

	/** Jump to the Users tab with this author preselected (suspend / warn / ban). */
	const openAuthorControls = (authorId: string) => {
		sessionStorage.setItem("vb:adminUserTarget", authorId);
		window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "users" }));
	};/** Post ids with a "convert to poll" request already in flight. */
	const pollBusyRef = useRef<Set<string>>(new Set());

	const convertToPoll = async (p: PostData) => {
		// Server already refuses a second poll on one post, but an admin
		// double-clicking the row button used to fire two requests and see
		// one of them bounce back as a confusing "already has a poll" error.
		// Guard here so the click is simply ignored while one is in flight.
		if (pollBusyRef.current.has(p.id)) return;
		pollBusyRef.current.add(p.id);
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
		} finally {
			pollBusyRef.current.delete(p.id);
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
		// Date range is part of the filter chain — the table and the export
		// must agree, otherwise the admin filters, exports, and gets the wrong
		// records.
		list = filterByDateRange(list, { preset: dateRangePreset });
		return list;
	}, [posts, statusF, catF, priorityF, query, dateRangePreset]);

	// Clear selection when filters change
	useEffect(
		() => setSelectedIds(new Set()),
		[statusF, catF, priorityF, query, dateRangePreset],
	);

	// Count of rows currently visible after every filter is applied. Shown in
	// the header so the admin can see the filter chain working before export.
	const rangeCount = useMemo(
		() => (posts.length > 0 ? filtered.length : null),
		[posts.length, filtered],
	);

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

	const bulkRunningRef = useRef(false);
	const bulkDelete = async () => {
		// Re-entry guard: the confirm stays mounted while the work is in
		// flight, so a double-click would otherwise fire the whole batch twice.
		if (bulkRunningRef.current) return;
		bulkRunningRef.current = true;
		const ids = [...selectedIds];
		// Only rows whose DELETE actually succeeded leave the list.
		// Removing failed ones too made them "come back" on refresh.
		const removed = new Set<string>();
		// Tombstone each id BEFORE its request (same race as single delete:
		// our own deletes fire realtime events, and an in-flight refresh
		// would otherwise re-add a row deleted earlier in this batch).
		for (const id of ids) tombstonesRef.current.add(id);

		// Bounded-parallel, not sequential. The old `for … await` loop issued
		// one round-trip at a time, so deleting N rows cost N × latency — the
		// bulk-delete "takes forever" complaint. 8 at a time keeps a 100-row
		// delete ~8x faster while never flooding the connection pool with
		// thousands of simultaneous requests on a large selection.
		const outcomes = await mapWithConcurrency(
			ids,
			BULK_CONCURRENCY,
			async (id) => {
				await api.del(`/api/posts?id=${encodeURIComponent(id)}`, { id });
				return id;
			},
		);
		for (const [i, outcome] of outcomes.entries()) {
			const id = ids[i] as string;
			if (outcome.status === "fulfilled") {
				removed.add(id);
			} else {
				// Some may be protected — release the tombstone so a failed row
				// returns on the next refresh instead of hiding forever.
				tombstonesRef.current.delete(id);
			}
		}
		const deleted = removed.size;
		setItems((prev) => prev.filter((p) => !removed.has(p.id)));
		setSelectedIds(new Set());
		// The detail drawer must not linger on a row that no longer exists.
		setSelected((s) => (s && removed.has(s.id) ? null : s));
		setBulkDeleteOpen(false);
		bulkRunningRef.current = false;
		toast(`Deleted ${deleted} of ${ids.length} posts`, deleted === ids.length ? "ok" : "err");
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-4 vb-tab-enter">
				<h1 className="flex items-center gap-2 font-display font-bold text-2xl tracking-tight">
					<span className="vb-gradient-text">{type === "problem" ? "Complaint Management" : "Suggestions"}</span>
				</h1>
				<div className="flex items-center gap-3 flex-wrap">
					<select
						className="input !py-1.5 !px-2.5 !text-xs !w-auto"
						aria-label="Filter by date range"
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
						disabled={exporting}
					>
						<Download size={13} /> {exporting ? "Exporting…" : "Export Report"}
					</button>
					<button
						className="btn btn-soft !py-1.5 !px-3 text-xs flex items-center gap-1.5"
						onClick={() => void handleRefresh()}
						disabled={refreshing}
						aria-label="Refresh list"
					>
						<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
						{refreshing ? "Refreshing…" : "Refresh"}
					</button>
					<span className="text-xs text-ink3">
						{rangeCount !== null ? `${rangeCount} filtered` : ""}
						{rangeCount !== null ? " / " : ""}{liveTotal} total
					</span>
				</div>
			</div>
			<UpdateNotice
				count={updatesAvailable}
				onViewUpdates={() => void handleRefresh()}
				refreshing={refreshing}
			/>

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
					aria-label="Filter by status"
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
					aria-label="Filter by category"
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
					aria-label="Filter by priority"
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

			{/* Skeletons only while there is genuinely nothing on screen. A
			    reload (filter change) keeps the current rows mounted, so the
			    table never blanks and pops back in. */}
			{initialLoading && posts.length === 0 ? (
				<div className="space-y-2">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="skeleton h-14" />
					))}
				</div>
			) : (
				<div>
					{pendingNew > 0 && (
						<button
							type="button"
							className="btn btn-soft !text-xs mb-3"
							onClick={showParked}
						>
							↑ {pendingNew} new {pendingNew === 1 ? "post" : "posts"} —
							show
						</button>
					)}
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
									onClick={() => {
									setDupes(null);
									setSelected(p);
								}}
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
										{p.deleted && (<span className="ml-1.5 text-[10px] text-ink3 font-semibold" title={`Deleted by ${p.author_id ?? "user"} · ${p.updated_at ?? p.created_at ?? "unknown time"} · auto-removes 5h after deletion`}>🗑 Deleted by user</span>)}
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
					{/* One always-present pager slot with reserved height:
					    the spinner and the "all loaded" note swap INSIDE it, so
					    paging never changes the page height under the reader. */}
					<div
						data-testid="pager-slot"
						className="min-h-11 flex items-center justify-center"
					>
						{loading && !initialLoading ? (
							<span className="flex items-center justify-center py-3 gap-2 text-ink3 text-xs">
								<Loader2 size={14} className="animate-spin" /> Loading more posts…
							</span>
						) : hasMore ? (
							<div className="flex flex-col items-center gap-1 py-2">
								<button
									type="button"
									className="btn btn-soft !py-1.5 !px-3 text-xs"
									onClick={() => setLoadAllWanted(true)}
								>
									Load all {total} posts
								</button>
								<span className="text-[11px] text-ink3">
									Showing {posts.length} of {total}
								</span>
							</div>
						) : posts.length > 0 ? (
							<p className="text-center text-[11px] text-ink3 py-2">
								All {total} posts loaded
							</p>
						) : null}
					</div>
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
					<div className="relative w-full max-w-lg bg-surface h-full overflow-y-auto overscroll-contain p-5 vb-rise">
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
									<button
										className="btn btn-ghost !py-1 !px-2.5 !text-[11px]"
										onClick={() => openAuthorControls(selected.author_id)}
										title="Warn, suspend or ban this author"
									>
										<ShieldCheck size={11} /> Author controls
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
										onClick={() =>
											setStatusDialog({ id: selected.id, status: "archived" })
										}
										title="Reject with a public reason"
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
								className="btn btn-ghost !text-xs col-span-2"
								onClick={() => void findDupes(selected.id)}
								disabled={dupBusy}
								title="Find posts saying exactly the same thing"
							>
								<Search size={13} /> {dupBusy ? "Checking…" : "Find duplicates"}
							</button>
							{dupes !== null && (
								<div className="col-span-2 rounded-lg border border-border p-2.5 space-y-2">
									<p className="text-[11px] font-semibold text-ink2">
										{dupes.length
											? `${dupes.length} exact-duplicate${dupes.length === 1 ? "" : "s"} — merge or remove`
											: "No exact duplicates — this post is unique."}
									</p>
									{dupes.map((d) => (
										<div key={d.id} className="flex items-center gap-2 text-[11px]">
											<span className="font-mono text-ink3">{d.id}</span>
											<span className="flex-1 min-w-0 truncate text-ink2">
												{d.title}
											</span>
											<span className="font-mono text-accent shrink-0">
												{d.similarity}%
											</span>
											<button
												className="btn btn-soft !py-1 !px-2 !text-[10px] shrink-0"
												onClick={() => void mergeDupe(selected.id, d.id)}
												aria-label={`Merge ${d.id} into this post`}
											>
												Merge {d.id}
											</button>
											<button
												className="btn btn-danger !py-1 !px-2 !text-[10px] shrink-0"
												onClick={() => void removeDupe(d.id)}
												aria-label={`Remove ${d.id}`}
											>
												Remove {d.id}
											</button>
										</div>
									))}
								</div>
							)}
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
				title={
					selected?.title
						? `Permanently delete "${selected.title.slice(0, 80)}"?`
						: "Permanently delete?"
				}
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
				onSubmit={async (note) => {
					if (!statusDialog) return;
					// Bulk status change: apply to all selected posts
					if (statusDialog.id === "BULK") {
						const ids = [...selectedIds];
						const results = await mapWithConcurrency(
							ids,
							BULK_CONCURRENCY,
							(id) =>
								update(
									id,
									{
										status: statusDialog.status as PostStatus,
										status_note: note || undefined,
									},
									{ silent: true },
								),
						);
						const succeeded = results.filter(
							(result) => result.status === "fulfilled" && result.value,
						).length;
						const failedIds = ids.filter(
							(_, index) => results[index]?.status !== "fulfilled" || !results[index]?.value,
						);
						setSelectedIds(new Set(failedIds));
						if (failedIds.length) {
							toast(`Updated ${succeeded} of ${ids.length} posts`, "err");
						} else {
							toast(`Updated ${succeeded} posts`, "ok");
						}
					} else {
						// Archiving removes the post from public lists, so hiding
						// rides along — previously the review Reject button hid
						// in one call while the status dialog left archived rows
						// visible. Restoring (any other status) never unhides.
						await update(statusDialog.id, {
							status: statusDialog.status as PostStatus,
							status_note: note || undefined,
							...(statusDialog.status === "archived" ? { hidden: true } : {}),
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
