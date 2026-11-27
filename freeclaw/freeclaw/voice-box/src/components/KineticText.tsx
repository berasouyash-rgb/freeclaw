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
const clean = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Static fallback (tests / reduced motion): semantic text, no GSAP. */
function renderWords(
	words: string[],
	gradientSet: Set<string> | null,
	highlightSet: Set<string>,
	wordClassName?: string,
) {
	return words.map((word, i) => {
		const h = hash(word.toLowerCase());
		const cleaned = clean(word);
		const gradient = gradientSet ? gradientSet.has(cleaned) : false;
		const highlighted = highlightSet.has(cleaned);
		return (
			<span
				key={`${word}-${i}`}
				className={cn(
					"kt-word",
					gradient && "kt-word--gradient",
					highlighted && !gradient && "kt-word--highlight",
					wordClassName,
				)}
				data-kt-word=""
				data-kt-seed={h}
				style={{ "--i": i } as CSSProperties}
			>
				{word}
			</span>
		);
	});
}

/**
 * Studio-grade word engine: every word is its own GSAP object with a
 * scroll-scrubbed physical emergence (opacity + vertical rise + subtle 3D flip).
 * Strictly immune to word overlap via deterministic CSS margin boxes.
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
	// Clean whitespace tokenization — guaranteed non-empty words
	const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean), [text]);
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
		const wordElements = Array.from(root.querySelectorAll<HTMLElement>("[data-kt-word]"));
		if (!wordElements.length) return;

		const mm = gsap.matchMedia();
		const build = (mobile: boolean) => {
			const timeline = gsap.timeline({
				defaults: { overwrite: "auto" },
				scrollTrigger: {
					trigger: root,
					start: "top 88%",
					end: "bottom 30%",
					scrub: 0.7,
					invalidateOnRefresh: true,
				},
			});

			wordElements.forEach((word, i) => {
				// 3D physical rise: emerges from subtle perspective depth, zero horizontal collision
				gsap.set(word, {
					opacity: 0.25,
					y: mobile ? 10 : 16,
					rotateX: mobile ? -10 : -16,
					transformPerspective: 800,
					transformOrigin: "50% 100%",
				});

				const pos = (i / Math.max(wordElements.length - 1, 1)) * 0.85;

				timeline.to(
					word,
					{
						opacity: 1,
						y: 0,
						rotateX: 0,
						duration: 0.45,
						ease: "power2.out",
					},
					pos,
				);
			});
		};

		mm.add("(min-width: 768px)", () => build(false));
		mm.add("(max-width: 767px)", () => build(true));
		document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);

		return () => mm.revert();
	}, [words, gradientSet, highlightSet, variant]);

	return createElement(
		as,
		{
			ref: ref as never,
			className: cn("kt-text", className),
			"data-kinetic-variant": variant,
		},
		renderWords(words, gradientSet, highlightSet, wordClassName),
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

		const ctx = gsap.context(() => {
			gsap.set(all, {
				display: "inline-block",
				transformOrigin: "50% 100%",
				y: 36,
				rotateX: -40,
				opacity: 0,
				scale: 0.88,
			});
			gsap.timeline({ delay: 0.08 }).to(all, {
				y: 0,
				rotateX: 0,
				opacity: 1,
				scale: 1,
				duration: 0.8,
				ease: "back.out(2)",
				stagger: { each: 0.035, from: "start" },
			});
		}, scrollEl);

		// Dynamic 3D perspective response on cursor movement
		const onMouseMove = (e: MouseEvent) => {
			const rect = scrollEl.getBoundingClientRect();
			const px = (e.clientX - rect.left) / rect.width - 0.5;
			const py = (e.clientY - rect.top) / rect.height - 0.5;
			gsap.to(tiltEl, {
				rotateY: px * 12,
				rotateX: -py * 12,
				duration: 0.35,
				ease: "power2.out",
				overwrite: "auto",
			});
		};
		const onMouseLeave = () => {
			gsap.to(tiltEl, {
				rotateY: 0,
				rotateX: 0,
				duration: 0.7,
				ease: "elastic.out(1, 0.6)",
				overwrite: "auto",
			});
		};
		scrollEl.addEventListener("mousemove", onMouseMove);
		scrollEl.addEventListener("mouseleave", onMouseLeave);

		// Individual character tactile elastic reaction on hover
		const cleanups: (() => void)[] = [];
		all.forEach((letterEl) => {
			const onEnter = () => {
				gsap.to(letterEl, {
					y: -10,
					scaleY: 1.16,
					scaleX: 1.08,
					duration: 0.2,
					ease: "elastic.out(1.2, 0.4)",
					overwrite: "auto",
				});
			};
			const onLeave = () => {
				gsap.to(letterEl, {
					y: 0,
					scaleY: 1,
					scaleX: 1,
					duration: 0.45,
					ease: "elastic.out(1, 0.5)",
					overwrite: "auto",
				});
			};
			letterEl.addEventListener("mouseenter", onEnter);
			letterEl.addEventListener("mouseleave", onLeave);
			cleanups.push(() => {
				letterEl.removeEventListener("mouseenter", onEnter);
				letterEl.removeEventListener("mouseleave", onLeave);
			});
		});

		document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);

		return () => {
			ctx.revert();
			scrollEl.removeEventListener("mousemove", onMouseMove);
			scrollEl.removeEventListener("mouseleave", onMouseLeave);
			cleanups.forEach((c) => c());
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
