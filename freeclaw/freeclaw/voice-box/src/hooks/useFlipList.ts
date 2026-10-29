import { useLayoutEffect, useRef } from "react";

/**
 * FLIP list motion — First, Last, Invert, Play.
 *
 * A sorted feed reorders whenever a vote lands (Top / Trending / Supported).
 * Without this, the vote you just cast teleports every card below it: the
 * number moves, the page jumps, and the tap feels like a glitch instead of
 * a result. Here every `[data-flip-id]` child is measured before the commit
 * and, when its position changed, played back from where it used to be so it
 * glides into its new slot (380ms, decelerating).
 *
 * Rules this hook keeps:
 *  - First paint never animates (there is no "before" to invert from).
 *  - Only position changes animate; a new/removed card never fakes a slide.
 *  - `offsetTop` is read instead of `getBoundingClientRect()` because a
 *    still-running transform would otherwise be measured as the element's
 *    resting place and compound on the next reorder.
 *  - prefers-reduced-motion skips the motion entirely but still reports rank
 *    moves, so the static UI can state what changed in words.
 *  - Missing Web Animations API (older WebViews, jsdom) is a no-op.
 */

const DURATION_MS = 380;
const EASING = "cubic-bezier(0.2, 0.9, 0.3, 1)";

/** Safe reduced-motion probe — browsers without matchMedia answer false. */
export function prefersReducedMotion(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		);
	} catch {
		return false;
	}
}

interface Snapshot {
	index: number;
	top: number;
}

export function useFlipList<T extends HTMLElement = HTMLDivElement>({
	order,
	onMoved,
}: {
	/** The rendered order — the hook re-measures when this sequence changes. */
	order: string[];
	/** Called with id → rank delta (positive moved up, negative moved down). */
	onMoved?: (moves: Map<string, number>) => void;
}) {
	const containerRef = useRef<T | null>(null);
	const previous = useRef<Map<string, Snapshot> | null>(null);
	// Latest callback without making it an effect dependency: a fresh arrow
	// function every render would otherwise re-run the measurement.
	const onMovedRef = useRef(onMoved);
	onMovedRef.current = onMoved;

	const orderKey = order.join("\u0000");

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const nodes = Array.from(
			container.querySelectorAll<HTMLElement>("[data-flip-id]"),
		);
		const next = new Map<string, Snapshot>();
		nodes.forEach((node, index) => {
			const id = node.dataset.flipId;
			if (id) next.set(id, { index, top: node.offsetTop });
		});
		const before = previous.current;
		previous.current = next;
		if (!before) return; // first paint — nothing has moved yet
		// A pure reorder only. An arrival or removal (a new post, a filter, a
		// deletion) makes every card shift by one, and animating that would
		// glide the whole feed and label ten cards "↓1" for one new post.
		// Insertions already have their own signal — the "New posts ↑" pill.
		if (before.size !== next.size) return;
		for (const id of next.keys()) if (!before.has(id)) return;

		const moves = new Map<string, number>();
		const reduce = prefersReducedMotion();
		nodes.forEach((node) => {
			const id = node.dataset.flipId;
			if (!id) return;
			const from = before.get(id);
			const to = next.get(id);
			if (!from || !to || from.index === to.index) return;
			moves.set(id, from.index - to.index);
			if (reduce) return;
			const dy = from.top - to.top;
			if (!dy || typeof node.animate !== "function") return;
			node.animate(
				[
					{ transform: `translateY(${dy}px)` },
					{ transform: "translateY(0px)" },
				],
				{ duration: DURATION_MS, easing: EASING },
			);
		});
		if (moves.size) onMovedRef.current?.(moves);
	}, [orderKey]);

	return containerRef;
}
