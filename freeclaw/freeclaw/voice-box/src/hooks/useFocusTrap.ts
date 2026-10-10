import { useEffect, useRef } from "react";

/**
 * Focus trap hook for accessible modals and drawers.
 *
 * When activated:
 * - Traps Tab/Shift+Tab within the container
 * - Focuses the first focusable element on mount
 * - Restores previous focus on cleanup
 * - Closes on Escape keypress
 *
 * Follows WAI-ARIA Practices for modal dialogs:
 * https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface UseFocusTrapOptions {
	/** Whether the trap is active. Default: false */
	active?: boolean;
	/** Callback when Escape is pressed */
	onEscape?: () => void;
}

export function useFocusTrap(
	containerRef: React.RefObject<HTMLElement | null>,
	options: UseFocusTrapOptions = {},
) {
	const { active = false, onEscape } = options;
	const previousFocusRef = useRef<HTMLElement | null>(null);
	// Store callback in a ref so an inline arrow prop doesn't re-register
	// the keydown listener on every render (same pattern as useRealtime).
	const onEscapeRef = useRef(onEscape);
	onEscapeRef.current = onEscape;

	useEffect(() => {
		if (!active || !containerRef.current) return;

		const container = containerRef.current;

		// Save the element that had focus before the trap opened
		previousFocusRef.current = document.activeElement as HTMLElement;

		// Focus the first focusable element inside the container
		const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE);
		if (firstFocusable) {
			// Small delay to allow the drawer animation to start
			requestAnimationFrame(() => firstFocusable.focus());
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onEscapeRef.current?.();
				return;
			}

			if (e.key !== "Tab") return;

			const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE);
			if (focusables.length === 0) return;

			const first = focusables[0]!;
			const last = focusables[focusables.length - 1]!;

			if (e.shiftKey) {
				// Shift+Tab: if on first element, wrap to last
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				// Tab: if on last element, wrap to first
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			// Restore focus to the element that was focused before the trap
			if (previousFocusRef.current && previousFocusRef.current.isConnected) {
				previousFocusRef.current.focus();
			}
		};
	}, [active, containerRef]);
}
