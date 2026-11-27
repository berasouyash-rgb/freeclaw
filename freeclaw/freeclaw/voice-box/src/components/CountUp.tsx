import { memo, useEffect, useRef, useState } from "react";

/**
 * The site's motion contract is "prefers-reduced-motion kills animation".
 * A requestAnimationFrame counter is invisible to the CSS media query, so it
 * has to honour the preference itself — otherwise the KPI numbers keep
 * ticking for users who asked motion to stop.
 */
function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/** Animated number that counts up smoothly when the value changes */
const CountUp = memo(function CountUp({
	value,
	suffix = "",
	duration = 900,
}: {
	value: number;
	suffix?: string;
	duration?: number;
}) {
	// Reduced motion renders the final value immediately, with no 0 flash.
	const [display, setDisplay] = useState(() =>
		prefersReducedMotion() ? value : 0,
	);
	const fromRef = useRef(0);
	const rafRef = useRef(0);

	useEffect(() => {
		if (prefersReducedMotion()) {
			fromRef.current = value;
			setDisplay(value);
			return;
		}
		const from = fromRef.current;
		const start = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			const eased = 1 - (1 - t) ** 3; // easeOutCubic
			setDisplay(Math.round(from + (value - from) * eased));
			if (t < 1) rafRef.current = requestAnimationFrame(tick);
			else fromRef.current = value;
		};
		rafRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafRef.current);
	}, [value, duration]);

	return (
		<span>
			{display.toLocaleString()}
			{suffix}
		</span>
	);
});

export default CountUp;
