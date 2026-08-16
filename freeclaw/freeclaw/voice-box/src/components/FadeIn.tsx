import { memo } from "react";

/**
 * FadeIn — staggered entrance animation wrapper.
 * Maps a 0–0.5 delay value to the vb-rise-delay-* CSS classes.
 */
const FadeIn = memo(function FadeIn({
	children,
	delay = 0,
	className = "",
}: {
	children: React.ReactNode;
	delay?: number;
	className?: string;
}) {
	const delayClass =
		delay <= 0
			? ""
			: delay <= 0.1
				? " vb-rise-delay-1"
				: delay <= 0.2
					? " vb-rise-delay-2"
					: delay <= 0.3
						? " vb-rise-delay-3"
						: delay <= 0.4
							? " vb-rise-delay-4"
							: " vb-rise-delay-5";
	return <div className={`vb-rise${delayClass} ${className}`}>{children}</div>;
});

export default FadeIn;
