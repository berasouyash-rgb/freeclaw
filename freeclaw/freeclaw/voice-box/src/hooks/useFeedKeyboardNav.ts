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
				if (activeIndex >= 0 && activeIndex < items.length) {
					e.preventDefault();
					triggerHaptic("medium");
					if (onOpen) {
						onOpen(items[activeIndex]);
					} else {
						navigate(`/post/${items[activeIndex].id}`);
					}
				}
			} else if (e.key === "u") {
				if (activeIndex >= 0 && activeIndex < items.length && onUpvote) {
					e.preventDefault();
					onUpvote(items[activeIndex]);
				}
			} else if (e.key === "b") {
				if (activeIndex >= 0 && activeIndex < items.length && onBookmark) {
					e.preventDefault();
					onBookmark(items[activeIndex]);
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
