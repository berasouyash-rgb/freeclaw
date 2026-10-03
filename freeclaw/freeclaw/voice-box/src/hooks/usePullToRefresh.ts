import { useCallback, useRef, useState } from "react";

/**
 * Pull-to-refresh gesture hook for mobile devices.
 *
 * Detects a downward swipe from the top of the page and triggers a refresh
 * callback when the user pulls past the threshold.
 *
 * Usage:
 *   const { pulling, pullDistance, onTouchStart, onTouchMove, onTouchEnd } = usePullToRefresh(onRefresh);
 *   <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
 *     {pulling && <div style={{ height: pullDistance }}>Pull to refresh…</div>}
 *     {/* content *\/}
 *   </div>
 */

/** Finger travel is halved before it moves the indicator, so the pull feels
 *  weighted rather than 1:1 with the finger. */
const RESISTANCE = 0.5;

interface UsePullToRefreshOptions {
	/** Raw finger travel (px) that commits the refresh. Default: 80 */
	threshold?: number;
	/** Maximum indicator travel, in px. Default: 120 */
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

/**
 * Is the page actually at its top?
 *
 * The element the handlers are attached to is usually a full-height wrapper,
 * NOT the scrolling element — the document scrolls. Reading only
 * `element.scrollTop` therefore always saw 0, so the gesture armed mid-page and
 * a downward drag while reading the feed could fire a refresh instead of
 * scrolling. Every plausible scroller is checked: the element itself (nested
 * `overflow-y-auto` regions), the window, and the document's scrolling element.
 */
function isAtTop(el: HTMLElement): boolean {
	if (el.scrollTop > 5) return false;
	const doc = el.ownerDocument;
	const scroller = doc?.scrollingElement;
	if (scroller && scroller.scrollTop > 5) return false;
	const win = doc?.defaultView;
	if (win && win.scrollY > 5) return false;
	return true;
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
	const pullDistanceRef = useRef(0);
	/**
	 * Whether the CURRENT gesture is being measured. A touchstart that bails
	 * (not at the top, no touch point) must stop the matching touchmove from
	 * measuring against the previous gesture's startY, which is a large
	 * arbitrary delta that commits a refresh on the first move.
	 */
	const trackingRef = useRef(false);

	const onTouchStart = useCallback(
		(e: React.TouchEvent) => {
			// Any new touch invalidates the previous measurement, whatever the
			// outcome of the checks below.
			trackingRef.current = false;
			pullingRef.current = false;
			if (!enabled || refreshingRef.current) return;
			if (!isAtTop(e.currentTarget as HTMLElement)) return;
			const touch = e.touches[0];
			if (!touch) return;
			startYRef.current = touch.clientY;
			trackingRef.current = true;
		},
		[enabled],
	);

	const onTouchMove = useCallback(
		(e: React.TouchEvent) => {
			if (!enabled || refreshingRef.current) return;
			// Not measured from a valid start (mid-page, or no start at all):
			// the movement belongs to the page's own scrolling, not the pull.
			if (!trackingRef.current) return;
			const touch = e.touches[0];
			if (!touch) return;
			const delta = touch.clientY - startYRef.current;
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
			const distance = Math.min(delta * RESISTANCE, maxPull);
			pullingRef.current = true;
			setPulling(true);
			pullDistanceRef.current = distance;
			setPullDistance(distance);
		},
		[enabled, maxPull],
	);

	const onTouchEnd = useCallback(async () => {
		trackingRef.current = false;
		if (!pullingRef.current || refreshingRef.current) {
			setPulling(false);
			pullDistanceRef.current = 0;
			setPullDistance(0);
			return;
		}
		// Read from ref to avoid stale closure — setPullDistance batches may
		// not have flushed by the time touchend fires. `pullDistance` is the
		// resisted distance, so the threshold's raw finger travel converts to
		// the same scale before comparing.
		const shouldRefresh = pullDistanceRef.current >= threshold * RESISTANCE;
		setPulling(false);

		if (shouldRefresh) {
			refreshingRef.current = true;
			setRefreshing(true);
			pullDistanceRef.current = threshold * 0.6;
			setPullDistance(threshold * 0.6); // Hold at visual indicator height
			try {
				await onRefresh();
			} finally {
				refreshingRef.current = false;
				setRefreshing(false);
				pullDistanceRef.current = 0;
				setPullDistance(0);
			}
		} else {
			pullDistanceRef.current = 0;
			setPullDistance(0);
		}
	}, [threshold, onRefresh]);

	return { pulling, pullDistance, refreshing, onTouchStart, onTouchMove, onTouchEnd };
}
