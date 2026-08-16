// ═══════════════════════════════════════════════════════════════════
// useReducedMotion — prefers-reduced-motion support.
// ═══════════════════════════════════════════════════════════════════
// Defaults to false (full motion) when matchMedia is unavailable (SSR,
// jsdom without the polyfill) and re-checks on change. Never throws.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState<boolean>(() => {
		try {
			return window.matchMedia?.(QUERY)?.matches ?? false;
		} catch {
			return false;
		}
	});

	useEffect(() => {
		let mql: MediaQueryList | null = null;
		try {
			mql = window.matchMedia(QUERY);
		} catch {
			return;
		}
		if (!mql) return;
		const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
		mql.addEventListener?.("change", onChange);
		return () => mql?.removeEventListener?.("change", onChange);
	}, []);

	return reduced;
}

/** One-shot, non-hook variant for module-level or imperative use. */
export function reducedMotionNow(): boolean {
	try {
		return window.matchMedia?.(QUERY)?.matches ?? false;
	} catch {
		return false;
	}
}
