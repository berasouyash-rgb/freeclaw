import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { triggerHaptic } from "../lib/haptics";

export default function BackToTop() {
	const [visible, setVisible] = useState(false);
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		const onScroll = () => {
			const scrollY = window.scrollY;
			const docHeight = document.documentElement.scrollHeight - window.innerHeight;
			setVisible(scrollY > 350);
			if (docHeight > 0) {
				const pct = Math.min(100, Math.max(0, Math.round((scrollY / docHeight) * 100)));
				setProgress(pct);
			}
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		onScroll();
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	const scrollToTop = () => {
		triggerHaptic("selection");
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			// Press 't' to scroll to top (when not typing in an input/textarea)
			if (
				e.key === "t" &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.altKey &&
				!(
					e.target instanceof HTMLInputElement ||
					e.target instanceof HTMLTextAreaElement ||
					(e.target instanceof HTMLElement && e.target.isContentEditable)
				)
			) {
				scrollToTop();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	if (!visible) return null;

	return (
		<button
			onClick={scrollToTop}
			aria-label={`Scroll back to top (${progress}%) (t)`}
			title={`Back to top (${progress}%) — Press 't'`}
			style={{
				background: `conic-gradient(var(--vb-accent) ${progress * 3.6}deg, color-mix(in srgb, var(--vb-border) 70%, transparent) ${progress * 3.6}deg 360deg)`,
			}}
			className="fixed bottom-20 lg:bottom-8 right-5 z-40 w-11 h-11 rounded-full p-[2.5px] flex items-center justify-center cursor-pointer vb-rise group select-none shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:shadow-[0_12px_28px_rgba(118,87,255,0.25)] backdrop-blur-md transition-all duration-200 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
		>
			<div className="w-full h-full rounded-full bg-surface/95 dark:bg-[#121422]/95 flex items-center justify-center text-ink2 group-hover:text-accent transition-colors">
				<ArrowUp
					size={16}
					strokeWidth={2.5}
					className="group-hover:-translate-y-0.5 transition-transform duration-200"
				/>
			</div>
		</button>
	);
}
