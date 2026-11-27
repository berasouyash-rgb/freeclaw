import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { triggerHaptic } from "../lib/haptics";

interface FeedKeyboardNavOptions<T extends { id: string }> {
	items: T[];
	onOpen?: (item: T) => void;
	onUpvote?: (item: T) => void;
	onBookmark?: (item: T) => void;
	enabled?: boolean;
}

export function useFeedKeyboardNav<T extends { id: string }>({
	items,
	onOpen,
	onUpvote,
	onBookmark,
	enabled = true,
}: FeedKeyboardNavOptions<T>) {
	const [activeIndex, setActiveIndex] = useState<number>(-1);
	const navigate = useNavigate();

	useEffect(() => {
		if (!enabled || !items.length) {
			setActiveIndex(-1);
			return;
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;

			// Do not intercept if user is typing in an input, textarea, or contentEditable
			const target = e.target;
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement && target.isContentEditable)
			) {
				return;
			}

			// Do not intercept if a modal or dialog is open
			if (document.querySelector('[role="dialog"]')) {
				return;
			}

			if (e.key === "j") {
				e.preventDefault();
				setActiveIndex((prev) => {
					const next = prev < items.length - 1 ? prev + 1 : prev;
					triggerHaptic("selection");
					const el = document.querySelector(`[data-feed-id="${items[next]?.id}"]`);
					el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
					return next;
				});
			} else if (e.key === "k") {
				e.preventDefault();
				setActiveIndex((prev) => {
					const next = prev > 0 ? prev - 1 : 0;
					triggerHaptic("selection");
					const el = document.querySelector(`[data-feed-id="${items[next]?.id}"]`);
					el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
					return next;
				});
			} else if (e.key === "Enter") {
				// Narrow once instead of indexing twice: `noUncheckedIndexedAccess`
				// types `items[activeIndex]` as `T | undefined` even after the
				// range check, so the local is what carries the proof.
				const item = activeIndex >= 0 ? items[activeIndex] : undefined;
				if (item) {
					e.preventDefault();
					triggerHaptic("medium");
					if (onOpen) {
						onOpen(item);
					} else {
						navigate(`/post/${item.id}`);
					}
				}
			} else if (e.key === "u") {
				const item = activeIndex >= 0 ? items[activeIndex] : undefined;
				if (item && onUpvote) {
					e.preventDefault();
					onUpvote(item);
				}
			} else if (e.key === "b") {
				const item = activeIndex >= 0 ? items[activeIndex] : undefined;
				if (item && onBookmark) {
					e.preventDefault();
					onBookmark(item);
				}
			} else if (e.key === "n") {
				e.preventDefault();
				triggerHaptic("selection");
				navigate("/submit");
			} else if (e.key === "/") {
				e.preventDefault();
				triggerHaptic("selection");
				const searchInput = document.querySelector(
					'input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]'
				) as HTMLInputElement | null;
				if (searchInput) {
					searchInput.focus();
					searchInput.select();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [enabled, items, activeIndex, onOpen, onUpvote, onBookmark, navigate]);

	return {
		activeIndex,
		activeId: activeIndex >= 0 ? items[activeIndex]?.id : null,
		setActiveIndex,
	};
}
