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
// empty, never filler. Charts are static SVG with the app's own
// entrance language (vb-pop / vb-draw — both no-op under
// prefers-reduced-motion). Print CSS puts one slide per page.
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

function maxOf(values: number[]): number {
	return Math.max(1, ...values);
}

function CatBars({ spec }: { spec: DeckSpec }) {
	const max = maxOf(spec.by_category.map((c) => c.total));
	return (
		<svg
			viewBox={`0 0 100 ${spec.by_category.length * 12}`}
			className="w-full"
			role="img"
			aria-label={`Posts by category, top ${spec.by_category[0]?.category ?? "none"}`}
		>
			{spec.by_category.slice(0, 8).map((c, i) => (
				<g key={c.category}>
					<text x="0" y={i * 12 + 8} fontSize="5" fill="var(--vb-ink2)">
						{(c.category ?? "Other").slice(0, 18)}
					</text>
					<rect
						x="32"
						y={i * 12 + 2}
						width={((c.total / max) * 60).toFixed(1)}
						height="7"
						rx="2"
						fill="var(--vb-accent)"
						className="vb-bar-anim"
					/>
					<text x="94" y={i * 12 + 8} fontSize="5" fill="var(--vb-ink3)">
						{c.total}
					</text>
				</g>
			))}
		</svg>
	);
}

function StatusDonut({ spec }: { spec: DeckSpec }) {
	const total = maxOf(spec.by_status.map((s) => s.count));
	const solved = spec.by_status.find((s) => s.status === "solved")?.count ?? 0;
	const pct = Math.round((solved / total) * 100);
	const r = 26;
	const c = 2 * Math.PI * r;
	return (
		<svg
			viewBox="0 0 64 64"
			className="h-28 w-28 shrink-0"
			role="img"
			aria-label={`Solved ${pct} percent`}
		>
			<circle cx="32" cy="32" r={r} fill="none" strokeWidth="8" className="stroke-surface2" />
			<circle
				cx="32"
				cy="32"
				r={r}
				fill="none"
				strokeWidth="8"
				strokeLinecap="round"
				stroke="var(--vb-accent)"
				className="vb-draw"
				strokeDasharray={`${((pct / 100) * c).toFixed(1)} ${c.toFixed(1)}`}
				transform="rotate(-90 32 32)"
			/>
		</svg>
	);
}

function PollBars({ spec }: { spec: DeckSpec }) {
	const max = maxOf(spec.top_polls.map((p) => p.total));
	return (
		<svg
			viewBox={`0 0 100 ${spec.top_polls.length * 12}`}
			className="w-full"
			role="img"
			aria-label={`Top poll: ${spec.top_polls[0]?.title ?? "none"}`}
		>
			{spec.top_polls.slice(0, 5).map((p, i) => (
				<g key={p.id}>
					<text x="0" y={i * 12 + 8} fontSize="5" fill="var(--vb-ink2)">
						{(p.title ?? "(untitled)").slice(0, 18)}
					</text>
					<rect
						x="32"
						y={i * 12 + 2}
						width={((p.total / max) * 60).toFixed(1)}
						height="7"
						rx="2"
						fill="var(--vb-accent2)"
						className="vb-bar-anim"
					/>
					<text x="94" y={i * 12 + 8} fontSize="5" fill="var(--vb-ink3)">
						{p.total}
					</text>
				</g>
			))}
		</svg>
	);
}

function WeekLine({ spec }: { spec: DeckSpec }) {
	const pts = spec.solved_by_week.slice(-8);
	const max = maxOf(pts.map((w) => w.solved));
	const w = 100;
	const h = 30;
	const step = pts.length > 1 ? w / (pts.length - 1) : 0;
	const line = pts
		.map((p, i) => `${(i * step).toFixed(1)},${(26 - (p.solved / max) * 22).toFixed(1)}`)
		.join(" L");
	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			className="w-full"
			role="img"
			aria-label={`Solved per week, last ${pts.length} weeks`}
		>
			<path d={`M${line} L${w},${h} L0,${h} Z`} fill="var(--vb-accent)" opacity="0.25" />
			<path
				d={`M${line}`}
				className="vb-draw"
				fill="none"
				stroke="var(--vb-accent)"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function Stat({ value, label }: { value: number; label: string }) {
	return (
		<div className="glass-card rounded-xl px-4 py-3 text-center vb-pop">
			<p className="font-display font-bold text-2xl tabular-nums">{value}</p>
			<p className="text-[11px] text-ink3">{label}</p>
		</div>
	);
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

	return (
		<div>
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
			<div className="glass-card rounded-xl p-3.5 mb-4 print:hidden">
				<div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
					<p className="text-xs font-semibold text-ink2">
						Pages in this deck
					</p>
					<div className="flex gap-2">
						<button
							type="button"
							className="btn btn-ghost !text-[11px] !py-1 !px-2 rounded-lg"
							onClick={() => {
								setSelected([...DEFAULT_SECTIONS]);
								setIndex(0);
							}}
						>
							Select all
						</button>
						<button
							type="button"
							className="btn btn-ghost !text-[11px] !py-1 !px-2 rounded-lg"
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
					{DECK_SECTIONS.map((s) => (
						<label
							key={s.key}
							className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-2 cursor-pointer hover:bg-surface2 transition-colors"
						>
							<input
								type="checkbox"
								checked={selected.includes(s.key)}
								onChange={() => toggle(s.key)}
								className="mt-0.5 accent-[var(--vb-accent)]"
								aria-label={s.label}
							/>
							<span>
								<span className="block text-xs font-semibold">{s.label}</span>
								<span className="block text-[10px] text-ink3">{s.hint}</span>
							</span>
						</label>
					))}
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
				<div className="glass-card rounded-xl p-8 text-center">
					<p className="font-display font-bold text-lg">No data yet</p>
					<p className="text-xs text-ink3 mt-1">
						The school has not produced reportable rows — this deck stays
						empty rather than inventing numbers. It fills itself as
						posts, votes, and reports arrive.
					</p>
				</div>
			) : (
				spec && (
					<>
						{/* ── Slides: one visible on screen, all print ── */}
						<div className="space-y-4">
							{slides.map((slide, i) => (
								<section
									key={slide.key}
									aria-label={`Slide ${i + 1} of ${slides.length}: ${slide.title}`}
									className={
										i === index
											? "glass-card rounded-2xl p-5 sm:p-8 vb-pop print:border-0 print:shadow-none print:p-0 print:break-after-page"
											: "hidden print:block print:break-after-page"
									}
								>
									<p className="text-[10px] font-bold tracking-widest text-ink3 uppercase mb-1">
										Slide {i + 1} / {slides.length}
									</p>
									<h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight mb-4">
										{slide.title}
									</h2>

									{slide.key === "cover" && (
										<div>
											<p className="text-xs text-ink3 mb-4">
												Generated {spec.generated_at.slice(0, 10)} · report-deck
												v{spec.version} · live data, no identities
											</p>
											<div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
												<Stat value={spec.totals.posts} label="Posts" />
												<Stat value={spec.totals.open} label="Open" />
												<Stat value={spec.totals.solved} label="Solved" />
												<Stat value={spec.totals.votes} label="Votes" />
												<Stat value={spec.totals.reports_open} label="Reports pending" />
												<Stat value={spec.totals.reports_resolved} label="Reports resolved" />
												<Stat value={spec.totals.polls} label="Polls" />
											</div>
										</div>
									)}

									{slide.key === "complaints" && (
										<div className="grid sm:grid-cols-2 gap-4">
											<div>
												<CatBars spec={spec} />
											</div>
											<ol className="space-y-2">
												{spec.top_supported.slice(0, 8).map((p, rank) => (
													<li key={p.id} className="text-xs flex gap-2 items-baseline">
														<span className="font-bold text-ink3 tabular-nums">
															{rank + 1}.
														</span>
														<span className="flex-1">
															{p.title}
															<span className="text-ink3">
																{" "}
																· {p.category} · {p.status}
															</span>
														</span>
														<span className="font-bold tabular-nums">{p.score}</span>
													</li>
												))}
											</ol>
										</div>
									)}

									{slide.key === "feed" && (
										<div className="flex flex-col sm:flex-row gap-4 items-center">
											<StatusDonut spec={spec} />
											<ul className="space-y-1.5 flex-1 w-full">
												{spec.by_status.map((s) => (
													<li key={s.status} className="text-xs flex justify-between">
														<span className="capitalize">{s.status}</span>
														<span className="font-bold tabular-nums">{s.count}</span>
													</li>
												))}
											</ul>
										</div>
									)}

									{slide.key === "reports" && (
										<div className="grid grid-cols-2 gap-2.5 max-w-md">
											<Stat value={spec.totals.reports_open} label="Need review" />
											<Stat value={spec.totals.reports_resolved} label="Resolved" />
										</div>
									)}

									{slide.key === "polls" && (
										<div>
											<PollBars spec={spec} />
											<ul className="mt-3 space-y-1.5">
												{spec.top_polls.map((p) => (
													<li key={p.id} className="text-xs flex justify-between gap-3">
														<span className="truncate">{p.title}</span>
														<span className="font-bold tabular-nums shrink-0">
															{p.total} votes
														</span>
													</li>
												))}
											</ul>
										</div>
									)}

									{slide.key === "trends" && (
										<div>
											<WeekLine spec={spec} />
											<ul className="mt-3 space-y-1.5">
												{spec.solved_by_week.slice(-8).map((wk) => (
													<li key={wk.week} className="text-xs flex justify-between">
														<span>Week of {wk.week}</span>
														<span className="font-bold tabular-nums">
															{wk.solved} solved
														</span>
													</li>
												))}
											</ul>
										</div>
									)}

									{slide.key === "actions" && (
										<ul className="space-y-2.5">
											{spec.recommendations.map((r, ri) => (
												<li
													key={`${r.rule}-${ri}`}
													className="text-xs flex gap-2 items-start vb-pop"
												>
													<span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
														{r.rule}
													</span>
													<span>{r.text}</span>
												</li>
											))}
										</ul>
									)}
								</section>
							))}
						</div>

						{/* ── Slide nav ── */}
						<div className="flex items-center justify-between mt-4 print:hidden">
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
