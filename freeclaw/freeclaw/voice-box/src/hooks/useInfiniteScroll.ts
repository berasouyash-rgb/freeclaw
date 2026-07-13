/**
 * Infinite scroll hook using IntersectionObserver.
 * No "Next Page" buttons — seamless auto-load when sentinel enters viewport.
 *
 * Usage:
 *   const { items, loading, sentinelRef, loadMore, hasMore, reset } = useInfiniteScroll(fetchFn);
 *
 * fetchFn receives { cursor, limit } and returns { data: T[], nextCursor: string | null, total: number }
 */
import { useState, useRef, useCallback, useEffect } from 'react';

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
  replaceItems: (items: T[]) => void;
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
}

export function useInfiniteScroll<T>(
  fetchFn: (params: { cursor: string | null; limit: number }) => Promise<PageResult<T>>,
  options: UseInfiniteScrollOptions = {}
): UseInfiniteScrollReturn<T> {
  const { limit = 30, threshold = 0.1, rootMargin = '200px' } = options;

  const [items, setItems] = useState<T[]>([]);
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

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    fetchFnRef.current({ cursor: cursorRef.current, limit })
      .then((result) => {
        if (!mountedRef.current) return;
        setItems((prev) => {
          const existing = new Set(prev.map((p: any) => p.id || JSON.stringify(p)));
          const newItems = (result.data || []).filter((p: any) => !existing.has(p.id || JSON.stringify(p)));
          return [...prev, ...newItems];
        });
        cursorRef.current = result.nextCursor;
        hasMoreRef.current = !!result.nextCursor;
        setHasMore(!!result.nextCursor);
        setTotal(result.total);
      })
      .catch(() => {
        hasMoreRef.current = false;
        setHasMore(false);
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setInitialLoading(false);
      });
  }, [limit]);

  const reset = useCallback(() => {
    cursorRef.current = null;
    hasMoreRef.current = true;
    mountedRef.current = true;
    loadingRef.current = false;
    setItems([]);
    setHasMore(true);
    setTotal(0);
    setLoading(false);
    setInitialLoading(true);
    setTrigger((n) => n + 1);
  }, []);

  const replaceItems = useCallback((newItems: T[]) => {
    setItems(newItems);
  }, []);

  // Initial load + trigger-based reload
  useEffect(() => {
    mountedRef.current = true;
    cursorRef.current = null;
    hasMoreRef.current = true;
    loadingRef.current = true;
    setItems([]);
    setHasMore(true);
    setTotal(0);
    setInitialLoading(true);
    setLoading(true);

    fetchFnRef.current({ cursor: null, limit })
      .then((result) => {
        if (!mountedRef.current) return;
        setItems(result.data || []);
        cursorRef.current = result.nextCursor;
        hasMoreRef.current = !!result.nextCursor;
        setHasMore(!!result.nextCursor);
        setTotal(result.total);
      })
      .catch(() => {
        hasMoreRef.current = false;
        setHasMore(false);
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
        setInitialLoading(false);
      });

    return () => { mountedRef.current = false; };
  }, [limit, trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver for auto-loading
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMoreRef.current && !loadingRef.current) {
          loadMore();
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, threshold, rootMargin, items.length]);

  return { items, loading, initialLoading, hasMore, total, sentinelRef, loadMore, reset, replaceItems, setItems };
}
