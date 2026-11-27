import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import KineticText from "./KineticText";

gsap.registerPlugin(ScrollTrigger);

export interface StoryAct {
	id: string;
	number: string;
	year: string;
	label: string;
	title: string;
	summary: string;
	quote?: string;
	details: string[];
	tags: string[];
}

const THEMES = [
	{ name: "Violet", accent: "#8B7CFF", rgb: "139,124,255" },
	{ name: "Cyan", accent: "#4FD8FF", rgb: "79,216,255" },
	{ name: "Amber", accent: "#FFB45B", rgb: "255,180,91" },
] as const;

interface ScrollStoryProps {
	acts: StoryAct[];
}

/**
 * Pinned, scroll-scrubbed story. Each act is a full-viewport layer with a
 * ghost numeral, kinetic headline, narrative, quote and tags. The accent
 * theme changes per act and can also be overridden by the visitor.
 * Reduced-motion / test mode renders a plain, readable stacked story.
 */
export default function ScrollStory({ acts }: ScrollStoryProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const activeRef = useRef(0);
	const [active, setActive] = useState(0);
	const [themeIdx, setThemeIdx] = useState(0);
	const theme = THEMES[themeIdx] ?? THEMES[0];

	const actsList = useMemo(() => acts, [acts]);

	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;
		stage.style.setProperty("--story-accent", theme.accent);
		stage.style.setProperty("--story-rgb", theme.rgb);
	}, [theme]);

	useEffect(() => {
		const root = rootRef.current;
		const stage = stageRef.current;
		if (!root || !stage) return;
		if (import.meta.env.MODE === "test") return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

		const els = Array.from(root.querySelectorAll<HTMLElement>("[data-story-act]"));
		if (els.length < 2) return;
		const first = els[0];
		if (!first) return;

		const ctx = gsap.context(() => {
			gsap.set(els, { opacity: 0, yPercent: 14, scale: 0.95, pointerEvents: "none" });
			gsap.set(first, { opacity: 1, yPercent: 0, scale: 1, pointerEvents: "auto" });

			const tl = gsap.timeline({
				defaults: { ease: "power2.inOut" },
				scrollTrigger: {
					trigger: root,
					start: "top top",
					end: () => `+=${els.length * window.innerHeight}`,
					pin: stage,
					pinSpacing: true,
					scrub: 1,
					anticipatePin: 1,
					invalidateOnRefresh: true,
					onUpdate: (self) => {
						const next = Math.min(els.length - 1, Math.round(self.progress * (els.length - 1)));
						if (next !== activeRef.current) {
							activeRef.current = next;
							setActive(next);
						}
					},
				},
			});

			for (let i = 1; i < els.length; i++) {
				const prev = els[i - 1];
				const cur = els[i];
				if (!prev || !cur) continue;
				tl.to(prev, { opacity: 0, yPercent: -12, scale: 0.94, duration: 0.6 }, i - 1)
					.fromTo(
						cur,
						{ opacity: 0, yPercent: 14, scale: 0.95 },
						{
							opacity: 1,
							yPercent: 0,
							scale: 1,
							duration: 0.6,
							onStart: () => {
								cur.style.pointerEvents = "auto";
							},
							onReverseComplete: () => {
								cur.style.pointerEvents = "none";
							},
						},
						i - 0.8, // overlap: incoming act rises while outgoing fades
					);
			}
			tl.to({}, { duration: 0.2 });

			// Layered parallax: ghost numeral drifts opposite to the content.
			els.forEach((el) => {
				const ghost = el.querySelector("[data-story-ghost]");
				if (!ghost) return;
				gsap.fromTo(
					ghost,
					{ yPercent: -18, rotate: -4 },
					{
						yPercent: 18,
						rotate: 4,
						ease: "none",
						scrollTrigger: {
							trigger: root,
							start: "top top",
							end: () => `+=${els.length * window.innerHeight}`,
							scrub: 2,
						},
					},
				);
			});
		}, root);

		document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);
		return () => ctx.revert();
	}, [actsList]);

	return (
		<div ref={rootRef} className="story-root relative" data-story-root>
			<div
				ref={stageRef}
				className="story-stage relative h-[100svh] min-h-[620px] w-full overflow-hidden city-shell"
				style={
					{
						"--story-accent": theme.accent,
						"--story-rgb": theme.rgb,
					} as React.CSSProperties
				}
			>
				{/* Ambient overlay wash + light field */}
				<div className="pointer-events-none absolute inset-0 z-0 story-wash" aria-hidden="true" />
				<div className="pointer-events-none absolute -top-1/3 left-1/2 h-[70vw] w-[70vw] -translate-x-1/2 rounded-full opacity-40 blur-[120px] story-orb" aria-hidden="true" />

				{/* Theme control — visitor can change the whole story palette */}
				<div className="absolute right-4 top-6 z-30 flex items-center gap-2 sm:right-8">
					<span className="city-eyebrow hidden text-[9px] text-[#A2ACC9] sm:inline">Theme</span>
					{THEMES.map((t, i) => (
						<button
							key={t.name}
							type="button"
							onClick={() => setThemeIdx(i)}
							aria-label={`Use ${t.name} story theme`}
							aria-pressed={i === themeIdx}
							className={`h-5 w-5 rounded-full border transition-all duration-300 ${
								i === themeIdx ? "scale-125 border-white/70" : "border-white/20 hover:border-white/50"
							}`}
							style={{ background: t.accent, boxShadow: i === themeIdx ? `0 0 18px ${t.accent}` : "none" }}
						/>
					))}
				</div>

				{/* Progress rail */}
				<div className="absolute left-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 sm:left-8 sm:flex" aria-hidden="true">
					{actsList.map((act, i) => (
						<span
							key={act.id}
							className={`block h-1.5 rounded-full transition-all duration-500 ${
								i === active ? "w-10" : "w-2.5 opacity-40"
							}`}
							style={{ background: i === active ? theme.accent : "#A2ACC9" }}
						/>
					))}
				</div>

				{/* Layered acts */}
				{actsList.map((act, i) => (
					<article
						key={act.id}
						data-story-act
						className="absolute inset-0 z-10 flex items-center px-6 sm:px-12 lg:px-20"
						style={{ transformOrigin: "50% 50%" }}
					>
						<span
							data-story-ghost
							className="pointer-events-none absolute -left-4 top-1/2 -translate-y-1/2 select-none font-city-display text-[34vw] leading-none opacity-[0.055] sm:text-[26vw]"
							aria-hidden="true"
						>
							{act.number}
						</span>

						<div className="relative z-10 mx-auto w-full max-w-5xl space-y-5">
							<div className="flex items-center gap-3 city-eyebrow text-[10px]" style={{ color: theme.accent }}>
								<span className="h-px w-8" style={{ background: theme.accent }} />
								<span>{act.year} — {act.label}</span>
								<span className="ml-auto tabular-nums text-[#A2ACC9]">{act.number} / 0{actsList.length}</span>
							</div>

							<KineticText
								as="h2"
								variant="display"
								text={act.title}
								highlightWords={act.tags}
								gradientWords={act.tags.slice(0, 2)}
								className="font-city-display max-w-4xl text-4xl leading-[1.02] text-[#EEF2FF] sm:text-6xl lg:text-7xl"
							/>

							<KineticText
								text={act.summary}
								highlightWords={act.tags}
								gradientWords={act.tags.slice(0, 1)}
								className="max-w-2xl text-sm leading-relaxed text-[#C7CEE5] sm:text-lg"
							/>

							{act.quote && (
								<blockquote
									className="city-glass max-w-2xl rounded-2xl px-5 py-4 text-sm italic text-[#EEF2FF] sm:text-base"
									style={{ borderLeft: `2px solid ${theme.accent}` }}
								>
									{act.quote}
								</blockquote>
							)}

							<div className="flex flex-wrap gap-2 pt-1">
								{act.tags.map((tag) => (
									<span
										key={tag}
										className="city-glass rounded-full px-3 py-1.5 text-[10px] font-semibold text-[#D9DEF2]"
									>
										{tag}
									</span>
								))}
							</div>

							<div className="pt-2 text-[10px] text-[#8E98B8] sm:hidden">
								Scroll to continue · {i + 1} of {actsList.length}
							</div>
						</div>
					</article>
				))}
			</div>

			<style>{`
				.story-wash {
					background:
						linear-gradient(90deg, rgba(var(--story-rgb), .10), transparent 45%),
						radial-gradient(60% 60% at 50% 120%, rgba(var(--story-rgb), .16), transparent 70%);
				}
				.story-orb { background: radial-gradient(circle, rgba(var(--story-rgb), .45), transparent 68%); }
			`}</style>
		</div>
	);
}
