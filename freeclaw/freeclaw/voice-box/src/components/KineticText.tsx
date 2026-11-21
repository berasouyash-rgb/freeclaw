import { createElement, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "../lib/utils";

gsap.registerPlugin(ScrollTrigger);

type Tag = "h1" | "h2" | "p" | "blockquote" | "span" | "div";
type Variant = "display" | "role" | "body" | "quote" | "eyebrow";

interface KineticTextProps {
	text: string;
	as?: Tag;
	variant?: Variant;
	className?: string;
	wordClassName?: string;
	/** Art-directed words that receive the animated gradient fill. */
	gradientWords?: string[];
	/** Words that are pushed toward the accent palette / larger scale. */
	highlightWords?: string[];
}

/** Deterministic per-word personality — stable across reloads and SSR. */
function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function unit(seed: number, salt: number): number {
	let x = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0;
	x ^= x >>> 16;
	x = Math.imul(x, 2246822519) >>> 0;
	x ^= x >>> 13;
	return (x >>> 0) / 4294967296;
}
const clean = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Static fallback (tests / reduced motion): semantic text, no GSAP. */
function renderWords(
	tokens: string[],
	gradientSet: Set<string> | null,
	wordClassName?: string,
) {
	let wordIndex = -1;
	return tokens.map((token, i) => {
		// Explicit space elements guarantee stable gap width even while words
		// are scaled / translated — raw whitespace text nodes can visually
		// collapse and make adjacent words touch.
		if (/^\s+$/.test(token)) {
			return <span key={`space-${i}`} className="kt-space" aria-hidden="true"> </span>;
		}
		wordIndex += 1;
		const h = hash(token.toLowerCase());
		const gradient = gradientSet
			? gradientSet.has(clean(token))
			: unit(h, 7) > 0.84;
		return (
			<span
				key={`${token}-${i}`}
				className={cn("kt-word", gradient && "kt-word--gradient", wordClassName)}
				data-kt-word=""
				data-kt-seed={h}
				style={{ "--i": wordIndex } as CSSProperties}
			>
				{token}
			</span>
		);
	});
}

/**
 * Studio-grade word engine: every word is its own GSAP object with a
 * scroll-scrubbed A→B→D lifecycle (small/muted → expanding → oversized,
 * elastic settle), distinct scale/colour/rotation/letter-spacing per word.
 * Reduced-motion users and unit tests get untouched semantic text.
 */
export default function KineticText({
	text,
	as = "p",
	variant = "body",
	className,
	wordClassName,
	gradientWords,
	highlightWords,
}: KineticTextProps) {
	const ref = useRef<HTMLElement>(null);
	const tokens = useMemo(() => text.split(/(\s+)/).filter((t) => t.length > 0), [text]);
	const gradientSet = useMemo(
		() => (gradientWords ? new Set(gradientWords.map(clean)) : null),
		[gradientWords],
	);
	const highlightSet = useMemo(
		() => (highlightWords ? new Set(highlightWords.map(clean)) : new Set<string>()),
		[highlightWords],
	);

	useEffect(() => {
		const root = ref.current;
		if (!root) return;
		// Unit tests assert content, not motion; keep the semantic DOM static.
		if (import.meta.env.MODE === "test") return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		const words = Array.from(root.querySelectorAll<HTMLElement>("[data-kt-word]"));
		if (!words.length) return;
		const variantName = root.getAttribute("data-kinetic-variant") ?? "body";

		const mm = gsap.matchMedia();
		const build = (mobile: boolean) => {
			const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
			const activePalette = {
				ink: isDark ? "#f8fafc" : "#0f172a",
				slate: isDark ? "#cbd5e1" : "#334155",
				graphite: isDark ? "#94a3b8" : "#475569",
				grey: isDark ? "#64748b" : "#475569",
				blue: isDark ? "#60a5fa" : "#2563eb",
				violet: isDark ? "#a78bfa" : "#7c3aed",
				purple: isDark ? "#c084fc" : "#5652d6",
			};

			const maxScale =
				variantName === "display" ? (mobile ? 1.06 : 1.12)
				: variantName === "quote" ? (mobile ? 1.04 : 1.1)
				: variantName === "eyebrow" ? (mobile ? 1.04 : 1.08)
				: 1; // body copy never scales past its natural width — no collisions
			const minScale = mobile ? 0.9 : variantName === "body" ? 0.86 : 0.88;
			// Words keep their line grid: scale / colour / gradient carry the
			// drama, drift is deliberately tiny so nothing collides or clips.
			const xRange = mobile ? 0 : variantName === "body" ? 0 : 2;
			const yRange = mobile ? 2 : variantName === "body" ? 2 : 4;
			const rotation = mobile ? 0 : variantName === "body" ? 0.3 : 1.2;

			const timeline = gsap.timeline({
				defaults: { overwrite: "auto" },
				scrollTrigger: {
					trigger: root,
					start: "top 88%",
					end: "bottom 24%",
					scrub: 1,
					invalidateOnRefresh: true,
				},
			});

			words.forEach((word, i) => {
				const seed = Number(word.dataset.ktSeed) || hash(word.textContent ?? "");
				const hero = unit(seed, 11) > 0.72;
				const gradient = word.classList.contains("kt-word--gradient");
				const highlighted = highlightSet.has(clean(word.textContent ?? ""));
				const a = unit(seed, 13);
				const b = unit(seed, 17);
				const c = unit(seed, 23);
				const targetScale = hero || highlighted
					? maxScale
					: minScale + (maxScale - minScale) * (0.22 + b * 0.4);
				const midScale = minScale + (targetScale - minScale) * 0.55;
				const targetColor = gradient
					? activePalette.purple
					: highlighted
						? activePalette.purple
						: c > 0.88
							? activePalette.blue
							: c > 0.7
								? activePalette.violet
								: c > 0.48
									? activePalette.ink
									: activePalette.slate;
				const x = (a - 0.5) * 2 * xRange * (hero ? 1 : 0.5);
				const y = (b - 0.5) * 2 * yRange * (hero ? 0.7 : 0.3) - (hero ? (variantName === "body" ? 2 : 6) : 0);
				const rotate = (c - 0.5) * 2 * rotation * (hero ? 1 : 0.4);
				const skew = (a - 0.5) * (mobile ? 0 : variantName === "body" ? 0.5 : 1.5);

				gsap.set(word, {
					transformOrigin: hero ? "50% 100%" : "50% 70%",
					color: gradient ? "transparent" : activePalette.graphite,
					opacity: 0.76,
					scale: minScale * (0.92 + a * 0.12),
					x: 0,
					y: mobile ? 4 : 8,
					rotation: 0,
					skewX: 0,
				});
				if (gradient) {
					const gradStr = isDark
						? `linear-gradient(100deg, ${activePalette.blue} 0%, ${activePalette.violet} 35%, ${activePalette.purple} 65%, ${activePalette.blue} 100%)`
						: `linear-gradient(100deg, #2563eb 0%, #7c3aed 35%, #5652d6 65%, #2563eb 100%)`;
					gsap.set(word, {
						backgroundImage: gradStr,
						backgroundSize: "240% 100%",
						backgroundPosition: "0% 0%",
						WebkitBackgroundClip: "text",
						backgroundClip: "text",
					});
				}

				const keyframes: gsap.TweenVars[] = [
					{
						scale: midScale,
						...(gradient ? {} : { color: activePalette.slate }),
						y: -yRange * 0.18 * (0.5 + b),
						opacity: 0.92,
						ease: "power2.out",
						duration: 0.42,
					},
					{
						scale: targetScale,
						x,
						y,
						rotation: rotate,
						skewX: skew,
						...(gradient ? {} : { color: targetColor }),
						letterSpacing:
							variantName === "body" ? "0em" : hero ? (mobile ? "-0.01em" : "-0.028em") : "0em",
						opacity: 1,
						ease: "elastic.out(1, 0.7)",
						duration: 0.58,
					},
				];
				timeline.to(word, { keyframes }, i * (mobile ? 0.03 : 0.05));
				if (gradient) {
					timeline.to(
						word,
						{ backgroundPosition: "100% 0%", ease: "none", duration: 1 },
						i * 0.05,
					);
				}
			});
		};

		mm.add("(min-width: 768px)", () => build(false));
		mm.add("(max-width: 767px)", () => build(true));
		document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);

		return () => mm.revert();
	}, [tokens, gradientSet, highlightSet, variant]);

	return createElement(
		as,
		{
			ref: ref as never,
			className: cn("kt-text", className),
			"data-kinetic-variant": variant,
		},
		renderWords(tokens, gradientSet, wordClassName),
	);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SIGNATURE NAME — character-level entrance + cursor / scroll response.
 * The name is the visual signature: letters rise, stretch and settle with
 * elastic physics, the gradient travels, and the whole word group tilts
 * gently toward the pointer and recedes on scroll.
 * ───────────────────────────────────────────────────────────────────────────── */
interface SignatureNameProps {
	className?: string;
}

export function SignatureName({ className }: SignatureNameProps) {
	const scrollRef = useRef<HTMLSpanElement>(null);
	const tiltRef = useRef<HTMLSpanElement>(null);
	const letters = useMemo(() => ["SOUYASH", "BERA"], []);

	useEffect(() => {
		const scrollEl = scrollRef.current;
		const tiltEl = tiltRef.current;
		if (!scrollEl || !tiltEl) return;
		if (import.meta.env.MODE === "test") return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

		const all = Array.from(tiltEl.querySelectorAll<HTMLElement>("[data-sig-letter]"));
		const gradientLetters = Array.from(
			tiltEl.querySelectorAll<HTMLElement>("[data-sig-gradient] [data-sig-letter]"),
		);

		const ctx = gsap.context(() => {
			gsap.set(all, {
				display: "inline-block",
				transformOrigin: "50% 100%",
				yPercent: 68,
				scaleY: 0.4,
				rotateX: -82,
				opacity: 0,
				filter: "blur(10px)",
			});
			gsap.timeline({ delay: 0.12 }).to(all, {
				yPercent: 0,
				scaleY: 1,
				rotateX: 0,
				opacity: 1,
				filter: "blur(0px)",
				duration: 1.2,
				ease: "elastic.out(1, 0.62)",
				stagger: { each: 0.055, from: "start" },
			});
			if (gradientLetters.length) {
				gsap.to(gradientLetters, {
					backgroundPosition: "100% 0%",
					ease: "none",
					duration: 6,
					repeat: -1,
					yoyo: true,
				});
			}

			// Scroll response: the signature recedes as the hero leaves.
			gsap.to(scrollEl, {
				yPercent: -18,
				scale: 0.9,
				ease: "none",
				scrollTrigger: {
					trigger: scrollEl,
					start: "top top",
					end: "bottom top+=320",
					scrub: 1,
				},
			});
		}, scrollEl);

		const rx = gsap.quickTo(tiltEl, "rotationX", { duration: 0.6, ease: "power3.out" });
		const ry = gsap.quickTo(tiltEl, "rotationY", { duration: 0.6, ease: "power3.out" });
		const onPointer = (e: PointerEvent) => {
			const nx = e.clientX / window.innerWidth - 0.5;
			const ny = e.clientY / window.innerHeight - 0.5;
			ry(nx * 8);
			rx(-ny * 6);
		};
		window.addEventListener("pointermove", onPointer, { passive: true });
		document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);

		return () => {
			window.removeEventListener("pointermove", onPointer);
			ctx.revert();
		};
	}, []);

	return (
		<span ref={scrollRef} className={cn("signature-scroll", className)} aria-label="Souyash Bera">
			<span ref={tiltRef} className="signature-tilt" aria-hidden="true">
				{letters.map((word, wi) => (
					<span
						key={word}
						data-sig-gradient={wi === 1 ? "" : undefined}
						className={cn(
							"signature-line",
							wi === 1 ? "signature-line--gradient" : "signature-line--solid",
						)}
					>
						{word.split("").map((letter, i) => (
							<span key={`${letter}-${i}`} data-sig-letter="" style={{ "--li": i } as CSSProperties}>
								{letter}
							</span>
						))}
					</span>
				))}
			</span>
		</span>
	);
}
