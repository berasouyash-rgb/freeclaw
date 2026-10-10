// ═══════════════════════════════════════════════════════════════════
// ReportDeck — the admin presentation surface ("better than Gamma")
// ═══════════════════════════════════════════════════════════════════
// One click from the admin desk → animated slide deck rendered from the
// LIVE deck spec (GET /api/report-deck — the same spec the PPT export
// renders, so the screen and the file can never disagree).
//
// The admin ticks which pages go in — Complaints / Feed / Reports /
// Polls / Trends / Actions, or All — and the viewer AND the PPT honour
// exactly that pick. Anonymity-safe by construction: the spec carries
// no identities (titles, categories, counts only). Empty DB → honest
// empty, never filler.
//
// Visual language: editorial serif headlines (Fraunces), tabular
// numerals, gradient hero figures, staggered fade-scale entrances and
// count-up figures — all transform/opacity only (GPU), all gated behind
// prefers-reduced-motion. Every slide carries a one-line explainer
// derived from the same live numbers, so the deck reads aloud.
// Print CSS puts one slide per page.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";
import { buildPptx } from "../../lib/deckExport";
import {
	DECK_SECTIONS,
	DEFAULT_SECTIONS,
	buildSlides,
	filterSections,
	isEmptySpec,
	type DeckSpec,
	type SectionKey,
} from "../../lib/reportDeck";
import { errorText } from "../../lib/utils";

function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		const onChange = () => setReduced(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return reduced;
}

/** Animated figure: counts 0 → value on mount, instantly under reduced motion. */
function CountUp({ value, className }: { value: number; className?: string }) {
	const reduced = useReducedMotion();
	const [shown, setShown] = useState(reduced ? value : 0);
	useEffect(() => {
		if (reduced) {
			setShown(value);
			return;
		}
		let raf = 0;
		const start = performance.now();
		const dur = 650;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / dur);
			const eased = 1 - (1 - t) * (1 - t) * (1 - t);
			setShown(Math.round(eased * value));
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [value, reduced]);
	return (
		<span className={`tabular-nums ${className ?? ""}`}>
			{shown.toLocaleString()}
		</span>
	);
}

/** Gradient bar row: label · growing track · mono value. */
function Bar({
	label,
	value,
	max,
	tone = "accent",
	delay = 0,
}: {
	label: string;
	value: number;
	max: number;
	tone?: "accent" | "green";
	delay?: number;
}) {
	const reduced = useReducedMotion();
	const [on, setOn] = useState(reduced);
	useEffect(() => {
		if (reduced) return;
		const id = requestAnimationFrame(() => setOn(true));
		return () => cancelAnimationFrame(id);
	}, [reduced]);
	const pct = Math.max(2, Math.round((value / Math.max(1, max)) * 100));
	return (
		<div className="deck-enter" style={{ animationDelay: `${delay}ms` }}>
			<div className="flex items-baseline justify-between gap-3 mb-1">
				<span className="text-[13px] font-medium text-ink truncate">{label}</span>
				<span className="font-mono text-xs text-ink2 tabular-nums shrink-0">
					{value.toLocaleString()}
				</span>
			</div>
			<div
				className="h-2.5 rounded-full bg-surface2 overflow-hidden"
				role="presentation"
			>
				<div
					className={`h-full rounded-full ${
						tone === "green"
							? "bg-gradient-to-r from-emerald-500 to-teal-300"
							: "bg-gradient-to-r from-[var(--vb-accent)] to-[var(--vb-accent2)]"
					}`}
					style={{
						width: on ? `${pct}%` : "0%",
						transition: reduced ? "none" : "width .7s cubic-bezier(.22,.9,.3,1)",
					}}
				/>
			</div>
		</div>
	);
}

function StatusDonut({ spec }: { spec: DeckSpec }) {
	const total = Math.max(
		1,
		spec.by_status.reduce((n, s) => n + (s.count ?? 0), 0),
	);
	const solved = spec.by_status.find((s) => s.status === "solved")?.count ?? 0;
	const pct = Math.round((solved / total) * 100);
	const r = 52;
	const c = 2 * Math.PI * r;
	return (
		<div className="flex items-center gap-5">
			<svg
				viewBox="0 0 128 128"
				className="h-36 w-36 shrink-0"
				role="img"
				aria-label={`Solved ${pct} percent`}
			>
				<circle cx="64" cy="64" r={r} fill="none" strokeWidth="14" className="stroke-surface2" />
				<circle
					cx="64"
					cy="64"
					r={r}
					fill="none"
					strokeWidth="14"
					strokeLinecap="round"
					stroke="url(#deckDonutGrad)"
					className="vb-draw"
					strokeDasharray={`${((pct / 100) * c).toFixed(1)} ${c.toFixed(1)}`}
					transform="rotate(-90 64 64)"
				/>
				<defs>
					<linearGradient id="deckDonutGrad" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stopColor="var(--vb-accent)" />
						<stop offset="100%" stopColor="var(--vb-accent2)" />
					</linearGradient>
				</defs>
			</svg>
			<div>
				<p className="font-display font-bold text-5xl tracking-tight">
					<CountUp value={pct} />
					<span className="text-2xl text-ink3">%</span>
				</p>
				<p className="text-[13px] text-ink2 mt-1">
					of {total.toLocaleString()} posts resolved
				</p>
			</div>
		</div>
	);
}

function WeekLine({ spec }: { spec: DeckSpec }) {
	const pts = spec.solved_by_week.slice(-8);
	const max = Math.max(1, ...pts.map((w) => w.solved ?? 0));
	const w = 100;
	const h = 30;
	const step = pts.length > 1 ? w / (pts.length - 1) : 0;
	const line = pts
		.map((p, i) => `${(i * step).toFixed(1)},${(26 - ((p.solved ?? 0) / max) * 22).toFixed(1)}`)
		.join(" L");
	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			className="w-full h-28"
			preserveAspectRatio="none"
			role="img"
			aria-label={`Solved per week, last ${pts.length} weeks`}
		>
			<path d={`M${line} L${w},${h} L0,${h} Z`} fill="var(--vb-accent)" opacity="0.22" />
			<path
				d={`M${line}`}
				className="vb-draw"
				fill="none"
				stroke="var(--vb-accent)"
				strokeWidth="2"
				strokeLinecap="round"
				vectorEffect="non-scaling-stroke"
			/>
			{pts.map((p, i) => (
				<circle
					key={p.week}
					cx={(i * step).toFixed(1)}
					cy={(26 - ((p.solved ?? 0) / max) * 22).toFixed(1)}
					r="1.6"
					fill="var(--vb-accent2)"
					className="vb-pop"
				/>
			))}
		</svg>
	);
}

/** Hero figure: giant gradient numeral + small-caps label. */
function Hero({ value, label, delay = 0 }: { value: number; label: string; delay?: number }) {
	return (
		<div className="deck-enter text-center px-2 py-4" style={{ animationDelay: `${delay}ms` }}>
			<p className="font-display font-bold text-5xl sm:text-6xl tracking-tight vb-gradient-text leading-none">
				<CountUp value={value} />
			</p>
			<p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink3">
				{label}
			</p>
		</div>
	);
}

/** Plain-language explainer lines, computed from the same live numbers. */
function explainers(spec: DeckSpec) {
	const t = spec.totals;
	const topCat = spec.by_category[0];
	const topPoll = spec.top_polls[0];
	const weeks = spec.solved_by_week.slice(-8);
	const lastW = weeks[weeks.length - 1];
	const prevW = weeks[weeks.length - 2];
	const rate = t.posts > 0 ? Math.round((t.solved / t.posts) * 100) : 0;
	return {
		cover: `${t.posts} posts in scope, ${t.open} still open. Resolution rate ${rate}%.`,
		complaints:
			topCat && t.open > 0
				? `${topCat.category} holds ${topCat.open} of ${t.open} open items (${Math.round((topCat.open / t.open) * 100)}%) — fix this category first.`
				: "No open complaints right now.",
		feed: `${t.solved} of ${t.posts} posts resolved (${rate}%). The ring is the share done.`,
		reports:
			t.reports_open > 0
				? `${t.reports_open} report${t.reports_open === 1 ? " needs" : "s need"} a human decision; ${t.reports_resolved} already resolved.`
				: "The moderation queue is clear.",
		polls:
			topPoll && t.votes > 0
				? `“${topPoll.title}” leads with ${topPoll.total} of ${t.votes} votes (${Math.round((topPoll.total / t.votes) * 100)}%).`
				: "No votes cast yet — feature the polls to start participation.",
		trends:
			lastW && prevW
				? `Last week: ${lastW.solved} solved vs ${prevW.solved} the week before.`
				: lastW
					? `Last week: ${lastW.solved} solved.`
					: "No resolutions recorded yet.",
		actions: `${spec.recommendations.length} recommended move${spec.recommendations.length === 1 ? "" : "s"}, each labeled with the rule that fired.`,
	};
}

export default function ReportDeck() {
	const { toast } = useApp();
	const [spec, setSpec] = useState<DeckSpec | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [selected, setSelected] = useState<SectionKey[]>([...DEFAULT_SECTIONS]);
	const [index, setIndex] = useState(0);
	const [exporting, setExporting] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setLoadError(null);
		try {
			const r = await api.getSlow<DeckSpec>("/api/report-deck");
			setSpec(r);
		} catch (e: unknown) {
			setLoadError(`Failed to load the presentation (report-deck): ${errorText(e)}`);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const slides = useMemo(
		() => (spec ? buildSlides(spec, selected) : []),
		[spec, selected],
	);

	// A shrink (untick) must never strand the cursor past the last slide.
	useEffect(() => {
		if (index > slides.length - 1) setIndex(Math.max(0, slides.length - 1));
	}, [index, slides.length]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, slides.length - 1));
			if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [slides.length]);

	const toggle = useCallback((key: SectionKey) => {
		setSelected((prev) => {
			if (prev.includes(key)) return prev.filter((k) => k !== key);
			return DECK_SECTIONS.map((s) => s.key).filter(
				(k) => k === key || prev.includes(k),
			);
		});
	}, []);

	const doExport = useCallback(async () => {
		if (!spec || exporting) return;
		setExporting(true);
		try {
			await buildPptx(spec, filterSections(selected));
			toast("Presentation downloaded — exactly the pages you ticked", "ok");
		} catch (e: unknown) {
			toast(`PPT export failed: ${errorText(e)}`, "err");
		}
		setExporting(false);
	}, [spec, selected, exporting, toast]);

	const expl = spec ? explainers(spec) : null;

	return (
		<div>
			<style>{`@media (prefers-reduced-motion: no-preference) {
				.deck-enter { animation: deck-in .5s cubic-bezier(.22,.9,.3,1) both; }
				@keyframes deck-in { from { opacity: 0; transform: scale(.982); } to { opacity: 1; transform: none; } }
			}`}</style>

			<div className="flex items-center justify-between gap-3 mb-4 flex-wrap print:hidden">
				<div>
					<h1 className="font-display font-bold text-xl tracking-tight">
						<span className="vb-gradient-text">Presentation</span>
					</h1>
					<p className="text-xs text-ink3 mt-1">
						Live school data · no identities · what you tick is what exports
					</p>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						className="btn btn-soft !text-xs"
						onClick={() => void load()}
						disabled={loading}
					>
						Refresh
					</button>
					<button
						type="button"
						className="btn btn-soft !text-xs"
						onClick={() => window.print()}
						disabled={!spec}
					>
						Print / PDF
					</button>
					<button
						type="button"
						className="btn btn-primary !text-xs"
						onClick={() => void doExport()}
						disabled={!spec || exporting}
					>
						{exporting ? "Building PPT…" : "Export PPT"}
					</button>
				</div>
			</div>

			{/* ── Page picker ── */}
			<div className="glass-card rounded-2xl p-4 mb-5 print:hidden">
				<div className="flex items-center justify-between mb-3 flex-wrap gap-2">
					<p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink3">
						Pages in this deck
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							className="btn btn-ghost !text-[11px] !py-1 !px-2.5 rounded-lg"
							onClick={() => {
								setSelected([...DEFAULT_SECTIONS]);
								setIndex(0);
							}}
						>
							Select all
						</button>
						<button
							type="button"
							className="btn btn-ghost !text-[11px] !py-1 !px-2.5 rounded-lg"
							onClick={() => {
								setSelected([]);
								setIndex(0);
							}}
						>
							Clear
						</button>
					</div>
				</div>
				<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
					{DECK_SECTIONS.map((s) => {
						const active = selected.includes(s.key);
						return (
							<label
								key={s.key}
								className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-all ${
									active
										? "border-accent bg-accent-soft shadow-sm"
										: "border-border hover:bg-surface2"
								}`}
							>
								<input
									type="checkbox"
									checked={active}
									onChange={() => toggle(s.key)}
									className="mt-1 accent-[var(--vb-accent)]"
									aria-label={s.label}
								/>
								<span>
									<span className="block text-[13px] font-semibold leading-tight">{s.label}</span>
									<span className="block text-[11px] text-ink3 mt-0.5">{s.hint}</span>
								</span>
							</label>
						);
					})}
				</div>
			</div>

			{loadError && (
				<div className="rounded-xl p-3 border-l-4 border-l-bad bg-bad/[0.06] mb-4 print:hidden">
					<p className="text-xs text-bad font-semibold">⚠️ {loadError}</p>
				</div>
			)}

			{loading ? (
				<div className="space-y-2 print:hidden">
					{[1, 2, 3].map((i) => (
						<div key={i} className="skeleton h-24" />
					))}
				</div>
			) : spec && isEmptySpec(spec) ? (
				<div className="glass-card rounded-3xl p-10 text-center overflow-hidden relative">
					<div
						aria-hidden
						className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[var(--vb-accent)] to-transparent"
					/>
					<p className="font-display font-bold text-3xl tracking-tight">No data yet</p>
					<p className="text-sm text-ink2 mt-2 max-w-md mx-auto">
						The school has not produced reportable rows — this deck stays
						empty rather than inventing numbers. It fills itself as
						posts, votes, and reports arrive.
					</p>
				</div>
			) : (
				spec &&
				expl && (
					<>
						{/* ── Slides: one alive on screen, all print ── */}
						<div className="space-y-4">
							{slides.map((slide, i) => {
								const active = i === index;
								return (
									<section
										key={`${slide.key}-${active ? "on" : "off"}`}
										aria-label={`Slide ${i + 1} of ${slides.length}: ${slide.title}`}
										className={
											active
												? "glass-card rounded-3xl overflow-hidden relative print:border-0 print:shadow-none print:rounded-none print:break-after-page"
												: "hidden print:block print:break-after-page"
										}
									>
										<div
											aria-hidden
											className="h-1 bg-gradient-to-r from-[var(--vb-accent)] via-[var(--vb-accent2)] to-transparent"
										/>
										<div className="p-6 sm:p-10">
											<p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-accent mb-2">
												Slide {i + 1} / {slides.length}
											</p>
											<h2 className="font-display font-bold text-3xl sm:text-[2.6rem] sm:leading-[1.05] tracking-tight">
												{slide.title}
											</h2>

											{slide.key === "cover" && (
												<div>
													<p className="mt-3 text-[15px] text-ink2 max-w-prose deck-enter">
														{expl.cover} Generated {spec.generated_at.slice(0, 10)} ·
														report-deck v{spec.version} · live data, no identities.
													</p>
													<div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-1">
														<Hero value={spec.totals.posts} label="Posts" delay={60} />
														<Hero value={spec.totals.open} label="Open" delay={120} />
														<Hero value={spec.totals.solved} label="Solved" delay={180} />
														<Hero value={spec.totals.votes} label="Votes" delay={240} />
														<Hero value={spec.totals.reports_open} label="Reports pending" delay={300} />
														<Hero value={spec.totals.reports_resolved} label="Reports resolved" delay={360} />
														<Hero value={spec.totals.polls} label="Polls" delay={420} />
													</div>
												</div>
											)}

											{slide.key === "complaints" && (
												<div>
													<p className="mt-3 text-[15px] text-ink2 max-w-prose deck-enter">
														{expl.complaints}
													</p>
													<div className="mt-6 grid sm:grid-cols-2 gap-8">
														<div className="space-y-3.5" role="img" aria-label={`Posts by category, top ${spec.by_category[0]?.category ?? "none"}`}>
															{spec.by_category.slice(0, 8).map((c, bi) => (
																<Bar
																	key={c.category}
																	label={c.category ?? "Other"}
																	value={c.total}
																	max={Math.max(...spec.by_category.map((x) => x.total))}
																	delay={bi * 70}
																/>
															))}
														</div>
														<ol className="space-y-1">
															{spec.top_supported.slice(0, 8).map((p, rank) => (
																<li
																	key={p.id}
																	className="deck-enter flex gap-3 items-baseline py-2 border-b border-border last:border-0"
																	style={{ animationDelay: `${rank * 70}ms` }}
																>
																	<span className="font-display italic font-semibold text-lg text-accent w-7 shrink-0 tabular-nums">
																		{rank + 1}
																	</span>
																	<span className="flex-1 min-w-0">
																		<span className="block text-[14px] font-medium leading-snug">
																			{p.title}
																		</span>
																		<span className="block text-[11px] text-ink3 mt-0.5">
																			{p.category} · {p.status}
																		</span>
																	</span>
																	<span className="font-mono text-sm font-semibold tabular-nums shrink-0">
																		{p.score}
																	</span>
																</li>
															))}
														</ol>
													</div>
												</div>
											)}

											{slide.key === "feed" && (
												<div>
													<p className="mt-3 text-[15px] text-ink2 max-w-prose deck-enter">
														{expl.feed}
													</p>
													<div className="mt-6 flex flex-col sm:flex-row gap-8 sm:items-center">
														<StatusDonut spec={spec} />
														<ul className="space-y-2.5 flex-1 w-full">
															{spec.by_status.map((s, bi) => (
																<li key={s.status} className="deck-enter" style={{ animationDelay: `${bi * 70}ms` }}>
																	<Bar
																		label={s.status.charAt(0).toUpperCase() + s.status.slice(1)}
																		value={s.count}
																		max={Math.max(...spec.by_status.map((x) => x.count))}
																	/>
																</li>
															))}
														</ul>
													</div>
												</div>
											)}

											{slide.key === "reports" && (
												<div>
													<p className="mt-3 text-[15px] text-ink2 max-w-prose deck-enter">
														{expl.reports}
													</p>
													<div className="mt-6 grid grid-cols-2 gap-3 max-w-lg">
														<div className="deck-enter rounded-2xl border border-accent bg-accent-soft p-6 text-center" style={{ animationDelay: "60ms" }}>
															<p className="font-display font-bold text-5xl tracking-tight">
																<CountUp value={spec.totals.reports_open} />
															</p>
															<p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink2">
																Need review
															</p>
														</div>
														<div className="deck-enter rounded-2xl border border-border p-6 text-center" style={{ animationDelay: "140ms" }}>
															<p className="font-display font-bold text-5xl tracking-tight text-ink2">
																<CountUp value={spec.totals.reports_resolved} />
															</p>
															<p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink3">
																Resolved
															</p>
														</div>
													</div>
												</div>
											)}

											{slide.key === "polls" && (
												<div>
													<p className="mt-3 text-[15px] text-ink2 max-w-prose deck-enter">
														{expl.polls}
													</p>
													<div className="mt-6 space-y-3.5 max-w-2xl" role="img" aria-label={`Top poll: ${spec.top_polls[0]?.title ?? "none"}`}>
														{spec.top_polls.map((p, bi) => (
															<Bar
																key={p.id}
																label={p.title ?? "(untitled)"}
																value={p.total}
																max={Math.max(...spec.top_polls.map((x) => x.total))}
																tone="green"
																delay={bi * 70}
															/>
														))}
													</div>
													<ul className="mt-5 space-y-1.5 max-w-2xl">
														{spec.top_polls.map((p) => (
															<li key={p.id} className="text-[13px] flex justify-between gap-3">
																<span className="truncate text-ink2">{p.title}</span>
																<span className="font-mono font-semibold tabular-nums shrink-0">
																	{p.total} votes
																</span>
															</li>
														))}
													</ul>
												</div>
											)}

											{slide.key === "trends" && (
												<div>
													<p className="mt-3 text-[15px] text-ink2 max-w-prose deck-enter">
														{expl.trends}
													</p>
													<div className="mt-6 max-w-2xl deck-enter" style={{ animationDelay: "80ms" }}>
														<WeekLine spec={spec} />
													</div>
													<ul className="mt-4 grid sm:grid-cols-2 gap-x-8">
														{spec.solved_by_week.slice(-8).map((wk, bi) => (
															<li
																key={wk.week}
																className="deck-enter text-[13px] flex justify-between py-1.5 border-b border-border last:border-0"
																style={{ animationDelay: `${bi * 60}ms` }}
															>
																<span className="text-ink2">Week of {wk.week}</span>
																<span className="font-mono font-semibold tabular-nums">
																	{wk.solved} solved
																</span>
															</li>
														))}
													</ul>
												</div>
											)}

											{slide.key === "actions" && (
												<div>
													<p className="mt-3 text-[15px] text-ink2 max-w-prose deck-enter">
														{expl.actions}
													</p>
													<ul className="mt-6 space-y-3 max-w-3xl">
														{spec.recommendations.map((r, ri) => (
															<li
																key={`${r.rule}-${ri}`}
																className="deck-enter flex gap-3 items-start rounded-2xl border border-border p-4"
																style={{ animationDelay: `${ri * 80}ms` }}
															>
																<span className="font-display italic font-semibold text-lg text-accent w-7 shrink-0 tabular-nums">
																	{ri + 1}
																</span>
																<span>
																	<span className="inline-block text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-accent/10 text-accent mb-1">
																		{r.rule}
																	</span>
																	<span className="block text-[14px] leading-relaxed">{r.text}</span>
																</span>
															</li>
														))}
													</ul>
												</div>
											)}
										</div>
									</section>
								);
							})}
						</div>

						{/* ── Slide nav ── */}
						<div className="flex items-center justify-between mt-5 print:hidden">
							<button
								type="button"
								className="btn btn-soft !text-xs"
								aria-label="Previous slide"
								disabled={index === 0}
								onClick={() => setIndex((i) => Math.max(0, i - 1))}
							>
								← Prev
							</button>
							<div className="flex gap-1.5" role="tablist" aria-label="Slides">
								{slides.map((s, i) => (
									<button
										key={s.key}
										type="button"
										role="tab"
										aria-selected={i === index}
										aria-label={`Go to slide ${i + 1}: ${s.title}`}
										onClick={() => setIndex(i)}
										className={`h-2 rounded-full transition-all ${
											i === index ? "w-6 bg-accent" : "w-2 bg-border hover:bg-ink3"
										}`}
									/>
								))}
							</div>
							<button
								type="button"
								className="btn btn-soft !text-xs"
								aria-label="Next slide"
								disabled={index >= slides.length - 1}
								onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
							>
								Next →
							</button>
						</div>
					</>
				)
			)}
		</div>
	);
}
