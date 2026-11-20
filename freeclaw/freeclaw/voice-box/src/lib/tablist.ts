import type { KeyboardEvent } from "react";

/**
 * Roving focus for `role="tab"` controls.
 *
 * WAI-ARIA tabs must be reachable and switchable from the keyboard. The app
 * has several hand-built tab strips (report periods, admin sections, feed
 * filters), so this helper keeps the behaviour identical everywhere:
 *
 *   ArrowLeft / ArrowRight — move focus between tabs (wrapping)
 *   Home / End              — first / last tab
 *
 * Activation stays with the focused button's native Enter/Space handling.
 * We deliberately do NOT click on focus: some tab strips trigger an audited
 * query when selected, and arrow-key browsing must not fire a request per
 * step. (This is the "manual activation" variant of the ARIA tabs pattern.)
 */
export function tablistKeyDown(e: KeyboardEvent<HTMLElement>) {
	const key = e.key;
	if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") {
		return;
	}
	const tabs = Array.from(
		e.currentTarget.querySelectorAll<HTMLElement>(
			'[role="tab"]:not([disabled]):not([aria-disabled="true"])',
		),
	);
	if (tabs.length === 0) return;

	const active = document.activeElement as HTMLElement | null;
	const current = active ? tabs.indexOf(active) : -1;
	if (current === -1) {
		// Focus is on the tablist container itself — enter at the first tab.
		e.preventDefault();
		tabs[0]?.focus();
		return;
	}

	let next = current;
	if (key === "ArrowRight") next = (current + 1) % tabs.length;
	else if (key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
	else if (key === "Home") next = 0;
	else next = tabs.length - 1;

	e.preventDefault();
	tabs[next]?.focus();
}
