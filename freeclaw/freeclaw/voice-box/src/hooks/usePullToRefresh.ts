import { useCallback, useRef, useState } from "react";

/**
 * Pull-to-refresh gesture hook for mobile devices.
 *
 * Detects a downward swipe from the top of a scrollable container
 * and triggers a refresh callback when the user pulls past the threshold.
 *
 * Usage:
 *   const { pulling, pullDistance, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(onRefresh);
 *   <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
 *     {pulling && <div style={{ height: pullDistance }}>Pull to refresh…</div>}
 *     {/* content *\/}
 *   </div>
 */

interface UsePullToRefreshOptions {
	/** Pull distance in px to trigger refresh. Default: 80 */
	threshold?: number;
	/** Maximum pull resistance (px). Default: 120 */
	maxPull?: number;
	/** Whether the gesture is enabled. Default: true (auto-detects touch) */
	enabled?: boolean;
}

interface UsePullToRefreshReturn {
	/** Whether the user is currently pulling */
	pulling: boolean;
	/** Current pull distance in px */
	pullDistance: number;
	/** Whether a refresh is in progress */
	refreshing: boolean;
	/** Touch event handlers to attach to the scroll container */
	onTouchStart: (e: React.TouchEvent) => void;
	onTouchMove: (e: React.TouchEvent) => void;
	onTouchEnd: () => void;
}

export function usePullToRefresh(
	onRefresh: () => Promise<void> | void,
	options: UsePullToRefreshOptions = {},
): UsePullToRefreshReturn {
	const { threshold = 80, maxPull = 120, enabled = true } = options;

	const [pulling, setPulling] = useState(false);
	const [pullDistance, setPullDistance] = useState(0);
	const [refreshing, setRefreshing] = useState(false);

	const startYRef = useRef(0);
	const pullingRef = useRef(false);
	const refreshingRef = useRef(false);

	const onTouchStart = useCallback(
		(e: React.TouchEvent) => {
			if (!enabled || refreshingRef.current) return;
			// Only start if scrolled to the very top
			const scrollEl = e.currentTarget;
			if (scrollEl.scrollTop > 5) return;
			startYRef.current = e.touches[0].clientY;
			pullingRef.current = false;
		},
		[enabled],
	);

	const onTouchMove = useCallback(
		(e: React.TouchEvent) => {
			if (!enabled || refreshingRef.current) return;
			const delta = e.touches[0].clientY - startYRef.current;
			if (delta <= 0) {
				// Swiping up — cancel
				if (pullingRef.current) {
					pullingRef.current = false;
					setPulling(false);
					setPullDistance(0);
				}
				return;
			}
			// Apply resistance: diminishing returns past threshold
			const distance = Math.min(delta * 0.5, maxPull);
			pullingRef.current = true;
			setPulling(true);
			setPullDistance(distance);
		},
		[enabled, maxPull],
	);

	const onTouchEnd = useCallback(async () => {
		if (!pullingRef.current || refreshingRef.current) {
			setPulling(false);
			setPullDistance(0);
			return;
		}
		const shouldRefresh = pullDistance >= threshold * 0.5;
		setPulling(false);

		if (shouldRefresh) {
			refreshingRef.current = true;
			setRefreshing(true);
			setPullDistance(threshold * 0.6); // Hold at visual indicator height
			try {
				await onRefresh();
			} finally {
				refreshingRef.current = false;
				setRefreshing(false);
				setPullDistance(0);
			}
		} else {
			setPullDistance(0);
		}
	}, [pullDistance, threshold, onRefresh]);

	return { pulling, pullDistance, refreshing, onTouchStart, onTouchMove, onTouchEnd };
}
