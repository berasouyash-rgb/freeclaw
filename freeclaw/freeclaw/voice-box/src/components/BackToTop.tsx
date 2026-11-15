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

	const radius = 15;
	const circumference = 2 * Math.PI * radius;
	const strokeDashoffset = circumference - (progress / 100) * circumference;

	return (
		<button
			onClick={scrollToTop}
			aria-label={`Scroll back to top (${progress}%) (t)`}
			title={`Back to top (${progress}%) — Press 't'`}
			className="fixed bottom-20 lg:bottom-8 right-6 z-40 w-11 h-11 rounded-full bg-surface/90 hover:bg-surface text-ink2 hover:text-accent border border-border shadow-xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 flex items-center justify-center cursor-pointer vb-rise group"
		>
			<svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 36 36">
				<circle
					cx="18"
					cy="18"
					r={radius}
					className="stroke-border/40"
					strokeWidth="2.5"
					fill="none"
				/>
				<circle
					cx="18"
					cy="18"
					r={radius}
					className="stroke-accent transition-all duration-75"
					strokeWidth="2.5"
					strokeDasharray={circumference}
					strokeDashoffset={strokeDashoffset}
					strokeLinecap="round"
					fill="none"
				/>
			</svg>
			<ArrowUp size={16} strokeWidth={2.4} className="group-hover:-translate-y-0.5 transition-transform duration-200" />
		</button>
	);
}
