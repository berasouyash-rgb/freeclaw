/**
 * Infinite scroll hook using IntersectionObserver.
 * No "Next Page" buttons — seamless auto-load when sentinel enters viewport.
 *
 * Usage:
 *   const { items, loading, sentinelRef, loadMore, hasMore, reset } = useInfiniteScroll(fetchFn);
 *
 * fetchFn receives { cursor, limit } and returns { data: T[], nextCursor: string | null, total: number }
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface PageResult<T> {
	data: T[];
	nextCursor: string | null;
	total: number;
}

interface UseInfiniteScrollOptions {
	limit?: number;
	threshold?: number;
	rootMargin?: string;
}

interface UseInfiniteScrollReturn<T> {
	items: T[];
	loading: boolean;
	initialLoading: boolean;
	hasMore: boolean;
	total: number;
	sentinelRef: React.RefObject<HTMLDivElement | null>;
	loadMore: () => void;
	reset: () => void;
	/** Reload from page one while keeping the current rows (stale-while-revalidate). */
	softReset: () => void;
	replaceItems: (items: T[]) => void;
	setItems: React.Dispatch<React.SetStateAction<T[]>>;
}

/** Stable identity for dedupe: prefer a real `id`, else the row's own JSON. */
function keyOf<T>(item: T): string {
	return (item as unknown as { id?: string }).id || JSON.stringify(item);
}

export function useInfiniteScroll<T>(
	fetchFn: (params: {
		cursor: string | null;
		limit: number;
	}) => Promise<PageResult<T>>,
	options: UseInfiniteScrollOptions = {},
): UseInfiniteScrollReturn<T> {
	const { limit = 30, threshold = 0.1, rootMargin = "200px" } = options;

	const [items, setItemsState] = useState<T[]>([]);
	const [loading, setLoading] = useState(false);
	const [initialLoading, setInitialLoading] = useState(true);
	const [hasMore, setHasMore] = useState(true);
	const [total, setTotal] = useState(0);
	const [trigger, setTrigger] = useState(0);

	const cursorRef = useRef<string | null>(null);
	const loadingRef = useRef(false);
	const hasMoreRef = useRef(true);
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	const mountedRef = useRef(true);
	const retryCountRef = useRef(0);
	const seenIdsRef = useRef<Set<string>>(new Set());
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// softReset keeps the current rows on screen while the first page reloads.
	const keepItemsRef = useRef(false);
	/**
	 * Request generation. Bumped every time the list is re-based (reset,
	 * softReset, or the trigger effect).
	 *
	 * Both loaders capture the generation they were launched under and drop
	 * their response if it no longer matches. Without this, `mountedRef` alone
	 * was not enough: a page-N request launched for the *previous* filter set
	 * (or the previous list) resolved after the new first page and appended
	 * its rows into the new list — stale, off-filter rows appearing underneath
	 * rows that were still correct. When such a response landed before the new
	 * page instead, the list showed them from the top. Both directions are the
	 * same bug: a response from a superseded request being merged.
	 */
	const generationRef = useRef(0);

	const fetchFnRef = useRef(fetchFn);
	fetchFnRef.current = fetchFn;

	const loadMore = useCallback(() => {
		if (loadingRef.current || !hasMoreRef.current) return;
		const gen = generationRef.current;
		loadingRef.current = true;
		setLoading(true);

		fetchFnRef
			.current({ cursor: cursorRef.current, limit })
			.then((result) => {
				// Superseded request: its rows belong to a list that no longer
				// exists. Drop them rather than merging them into the new one.
				if (!mountedRef.current || gen !== generationRef.current) return;
				retryCountRef.current = 0;
				const fresh = (result.data || []).filter((p: T) => {
					const key = keyOf(p);
					if (seenIdsRef.current.has(key)) return false;
					seenIdsRef.current.add(key);
					return true;
				});
				setItemsState((prev) => [...prev, ...fresh]);
				cursorRef.current = result.nextCursor;
				hasMoreRef.current = !!result.nextCursor;
				setHasMore(!!result.nextCursor);
				setTotal(result.total);
			})
			.catch(() => {
				if (gen !== generationRef.current) return;
				// A transient network error must NOT permanently kill pagination.
				// Retry with capped backoff; only disable after repeated failures.
				retryCountRef.current += 1;
				if (retryCountRef.current >= 3) {
					hasMoreRef.current = false;
					setHasMore(false);
				} else {
					const delay = 1000 * retryCountRef.current; // 1s, 2s
					if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
					retryTimerRef.current = setTimeout(() => {
						if (mountedRef.current && !loadingRef.current) loadMore();
					}, delay);
				}
			})
			.finally(() => {
				// Only the request that still owns the list may release the
				// loading flag; a stale one would clear the flag out from
				// under the replacement request that is still in flight.
				if (gen !== generationRef.current) return;
				loadingRef.current = false;
				setLoading(false);
				setInitialLoading(false);
			});
	}, [limit]);

	const reset = useCallback(() => {
		generationRef.current += 1;
		keepItemsRef.current = false;
		cursorRef.current = null;
		hasMoreRef.current = true;
		mountedRef.current = true;
		loadingRef.current = false;
		retryCountRef.current = 0;
		if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
		seenIdsRef.current = new Set();
		setItemsState([]);
		setHasMore(true);
		setTotal(0);
		setLoading(false);
		setInitialLoading(true);
		setTrigger((n) => n + 1);
	}, []);

	/**
	 * Reload from the first page WITHOUT clearing the current rows.
	 *
	 * Stale-while-revalidate for filter changes: the list keeps rendering the
	 * previous page (so the surface never blanks to a skeleton mid-typing) and
	 * the new page swaps in atomically when it lands. `reset()` stays the hard
	 * clear for consumers that genuinely want an empty list.
	 */
	const softReset = useCallback(() => {
		generationRef.current += 1;
		cursorRef.current = null;
		hasMoreRef.current = true;
		mountedRef.current = true;
		loadingRef.current = false;
		retryCountRef.current = 0;
		if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
		keepItemsRef.current = true;
		setHasMore(true);
		setTotal(0);
		setLoading(false);
		setInitialLoading(true);
		setTrigger((n) => n + 1);
	}, []);

	/**
	 * Replacement setter — clears the list and re-seeds the dedupe set from the
	 * new rows. Consumers use this when the row list is genuinely replaced
	 * (not appended to), so keeping the old ids around would wrongly suppress
	 * rows that come back later.
	 */
	const replaceItems = useCallback((newItems: T[]) => {
		seenIdsRef.current = new Set(newItems.map(keyOf));
		setItemsState(newItems);
	}, []);

	/**
	 * Appending setter that also registers the incoming rows in the dedupe set.
	 *
	 * Consumers splice rows in directly — realtime newcomers prepended at the
	 * top, backfill appended at the bottom, optimistic edits, local deletes.
	 * Previously those rows were invisible to `seenIdsRef`, so the paginator
	 * still considered them "unseen" and appended them a second time when a
	 * later page happened to contain them: the same post rendered twice, once
	 * from the top merge and once from the bottom page. Syncing the set here
	 * closes that hole for every consumer without each of them remembering to.
	 */
	const setItems: React.Dispatch<React.SetStateAction<T[]>> = useCallback(
		(value) => {
			setItemsState((prev) => {
				const next =
					typeof value === "function"
						? (value as (p: T[]) => T[])(prev)
						: value;
				// Set.add is idempotent, so a double-invoked updater (StrictMode)
				// is harmless here.
				for (const item of next) seenIdsRef.current.add(keyOf(item));
				return next;
			});
		},
		[],
	);

	// Initial load + trigger-based reload
	useEffect(() => {
		const gen = ++generationRef.current;
		mountedRef.current = true;
		cursorRef.current = null;
		hasMoreRef.current = true;
		loadingRef.current = true;
		if (!keepItemsRef.current) setItemsState([]);
		setHasMore(true);
		setTotal(0);
		setInitialLoading(true);
		setLoading(true);

		fetchFnRef
			.current({ cursor: null, limit })
			.then((result) => {
				if (!mountedRef.current || gen !== generationRef.current) return;
				const data = result.data || [];
				keepItemsRef.current = false;
				seenIdsRef.current = new Set(data.map(keyOf));
				setItemsState(data);
				cursorRef.current = result.nextCursor;
				hasMoreRef.current = !!result.nextCursor;
				setHasMore(!!result.nextCursor);
				setTotal(result.total);
			})
			.catch(() => {
				if (gen !== generationRef.current) return;
				hasMoreRef.current = false;
				setHasMore(false);
			})
			.finally(() => {
				if (gen !== generationRef.current) return;
				loadingRef.current = false;
				setLoading(false);
				setInitialLoading(false);
			});

		return () => {
			mountedRef.current = false;
			if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
		};
	}, [limit, trigger]);

	// IntersectionObserver for auto-loading
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (
					entries[0]?.isIntersecting &&
					hasMoreRef.current &&
					!loadingRef.current
				) {
					loadMore();
				}
			},
			{ threshold, rootMargin },
		);

		observer.observe(el);
		return () => observer.disconnect();
	}, [loadMore, threshold, rootMargin]);

	return {
		items,
		loading,
		initialLoading,
		hasMore,
		total,
		sentinelRef,
		loadMore,
		reset,
		softReset,
		replaceItems,
		setItems,
	};
}
