import { useRef } from "react";
import {
	AnimatePresence,
	motion,
	useInView,
	useReducedMotion,
	type Variants,
} from "framer-motion";

interface BlurFadeProps {
	children: React.ReactNode;
	className?: string;
	variant?: {
		hidden: { y: number };
		visible: { y: number };
	};
	duration?: number;
	delay?: number;
	yOffset?: number;
	inView?: boolean;
	inViewMargin?: string;
	blur?: string;
}

export function BlurFade({
	children,
	className,
	variant,
	duration = 0.45,
	delay = 0,
	yOffset = 12,
	inView = false,
	inViewMargin = "-40px",
	blur = "8px",
}: BlurFadeProps) {
	const ref = useRef<HTMLDivElement>(null);
	const inViewResult = useInView(ref, {
		once: true,
		margin: inViewMargin as unknown as undefined,
	});
	const isInView = !inView || inViewResult;
	const shouldReduceMotion = useReducedMotion();

	const defaultVariants: Variants = {
		hidden: {
			y: shouldReduceMotion ? 0 : yOffset,
			opacity: 0,
			filter: shouldReduceMotion ? "none" : `blur(${blur})`,
		},
		visible: {
			y: 0,
			opacity: 1,
			filter: "blur(0px)",
		},
	};
	const combinedVariants = variant || defaultVariants;

	return (
		<AnimatePresence>
			<motion.div
				ref={ref}
				initial="hidden"
				animate={isInView ? "visible" : "hidden"}
				exit="hidden"
				variants={combinedVariants}
				transition={{
					delay: 0.04 + delay,
					duration: shouldReduceMotion ? 0.01 : duration,
					ease: [0.21, 0.47, 0.32, 0.98],
				}}
				className={className}
			>
				{children}
			</motion.div>
		</AnimatePresence>
	);
}

export default BlurFade;
