// ═══════════════════════════════════════════════════════════════════
// deckExport — client-side PPTX from the live deck spec
// ═══════════════════════════════════════════════════════════════════
// "Full PPT features" on real numbers: title slide, per-section slides
// with tables (top complaints) and charts (bar / pie / line via
// pptxgenjs), footers stamping generation time + spec version. Runs
// entirely on-device — complaint data never leaves the admin's browser
// for export. The pptxgenjs class is injected (default: dynamic import,
// so the heavy lib never touches the initial bundle) and every number
// is null-guarded: an empty DB exports an honest empty deck, never NaN.
// ═══════════════════════════════════════════════════════════════════

import type PptxGenJS from "pptxgenjs";
import {
	DEFAULT_SECTIONS,
	filterSections,
	type DeckSpec,
	type SectionKey,
} from "./reportDeck";

type Pres = InstanceType<typeof PptxGenJS>;
type Slide = ReturnType<Pres["addSlide"]>;

export type PresFactory = () => Promise<Pres>;

async function defaultFactory(): Promise<Pres> {
	const mod = await import("pptxgenjs");
	return new mod.default();
}

const BG = "111827";
const INK = "F3F4F6";
const MUTED = "9CA3AF";
const ACCENT = "8B85F5";
const ACCENT2 = "34D399";

function stamp(spec: DeckSpec): string {
	return `Generated ${spec.generated_at} · report-deck v${spec.version} · live data, no identities`;
}

function footer(slide: Slide, spec: DeckSpec): void {
	slide.addText(stamp(spec), {
		x: 0.5,
		y: 7.05,
		w: 12.33,
		h: 0.3,
		fontSize: 8,
		color: MUTED,
		align: "right",
	});
}

function title(slide: Slide, text: string): void {
	slide.addText(text, {
		x: 0.5,
		y: 0.25,
		w: 12.33,
		h: 0.9,
		fontSize: 30,
		bold: true,
		color: INK,
	});
}

function noData(slide: Slide): void {
	slide.addText("No data yet — the school has not produced these rows.", {
		x: 0.5,
		y: 1.6,
		w: 12.33,
		h: 0.6,
		fontSize: 14,
		color: MUTED,
	});
}

function chartOf(pres: Pres): {
	bar: never;
	pie: never;
	line: never;
} {
	// ChartType lives on the instance; the stub factory in tests has none —
	// fall through to the string enum values pptxgenjs accepts.
	const ct = (pres as unknown as { ChartType?: Record<string, never> })
		.ChartType;
	return {
		bar: ct?.["bar"] ?? ("bar" as never),
		pie: ct?.["pie"] ?? ("pie" as never),
		line: ct?.["line"] ?? ("line" as never),
	};
}

function coverSlide(pres: Pres, spec: DeckSpec): void {
	const t = spec.totals;
	const slide = pres.addSlide();
	slide.background = { color: BG };
	slide.addText("School activity report", {
		x: 0.5,
		y: 1.8,
		w: 12.33,
		h: 1.2,
		fontSize: 44,
		bold: true,
		color: INK,
	});
	slide.addText(
		`Live school data · ${spec.generated_at.slice(0, 10)} · report-deck v${spec.version}`,
		{ x: 0.5, y: 3.1, w: 12.33, h: 0.5, fontSize: 16, color: ACCENT },
	);
	slide.addText(
		`${t.posts ?? 0} posts · ${t.open ?? 0} open · ${t.solved ?? 0} solved · ` +
			`${t.reports_open ?? 0} reports pending · ${t.polls ?? 0} polls · ${t.votes ?? 0} votes`,
		{ x: 0.5, y: 3.9, w: 12.33, h: 0.5, fontSize: 14, color: MUTED },
	);
	footer(slide, spec);
}

function complaintsSlide(pres: Pres, spec: DeckSpec): void {
	const slide = pres.addSlide();
	slide.background = { color: BG };
	title(slide, `Top complaints (${spec.totals.open ?? 0} open)`);
	if (spec.top_supported.length === 0 && spec.by_category.length === 0) {
		noData(slide);
	} else {
		if (spec.top_supported.length > 0) {
			slide.addTable(
				[
					[{ text: "Title" }, { text: "Category" }, { text: "Status" }, { text: "Score" }],
					...spec.top_supported.slice(0, 8).map((p) => [
						{ text: p.title ?? "(untitled)" },
						{ text: p.category ?? "Other" },
						{ text: p.status ?? "open" },
						{ text: String(p.score ?? 0) },
					]),
				],
				{ x: 0.5, y: 1.4, w: 7.4, fontSize: 10, color: INK },
			);
		}
		if (spec.by_category.length > 0) {
			slide.addChart(chartOf(pres).bar,
				[
					{
						name: "Posts by category",
						labels: spec.by_category.map((c) => c.category),
						values: spec.by_category.map((c) => c.total ?? 0),
					},
				],
				{ x: 8.2, y: 1.4, w: 4.6, h: 4.4 },
			);
		}
	}
	footer(slide, spec);
}

function feedSlide(pres: Pres, spec: DeckSpec): void {
	const slide = pres.addSlide();
	slide.background = { color: BG };
	title(
		slide,
		`Feed status — ${spec.totals.solved ?? 0} of ${spec.totals.posts ?? 0} solved`,
	);
	if (spec.by_status.length === 0) {
		noData(slide);
	} else {
		slide.addChart(chartOf(pres).pie,
			[
				{
					name: "Posts by status",
					labels: spec.by_status.map((s) => s.status),
					values: spec.by_status.map((s) => s.count ?? 0),
				},
			],
			{ x: 0.5, y: 1.4, w: 6.0, h: 4.4 },
		);
		slide.addText(
			spec.by_status.map((s) => `${s.status}: ${s.count ?? 0}`).join("\n"),
			{ x: 7.0, y: 1.4, w: 5.8, h: 4.4, fontSize: 14, color: INK },
		);
	}
	footer(slide, spec);
}

function reportsSlide(pres: Pres, spec: DeckSpec): void {
	const slide = pres.addSlide();
	slide.background = { color: BG };
	title(slide, `Reports — ${spec.totals.reports_open ?? 0} need review`);
	const open = spec.totals.reports_open ?? 0;
	const done = spec.totals.reports_resolved ?? 0;
	if (open === 0 && done === 0) {
		noData(slide);
	} else {
		slide.addChart(chartOf(pres).bar,
			[{ name: "Moderation queue", labels: ["Open", "Resolved"], values: [open, done] }],
			{ x: 0.5, y: 1.4, w: 6.0, h: 4.0 },
		);
		slide.addText(`${open} open · ${done} resolved`, {
			x: 7.0,
			y: 1.4,
			w: 5.8,
			h: 1.0,
			fontSize: 18,
			color: open > 0 ? ACCENT : ACCENT2,
		});
	}
	footer(slide, spec);
}

function pollsSlide(pres: Pres, spec: DeckSpec): void {
	const slide = pres.addSlide();
	slide.background = { color: BG };
	title(slide, `Polls — ${spec.totals.votes ?? 0} votes`);
	if (spec.top_polls.length === 0) {
		noData(slide);
	} else {
		slide.addChart(chartOf(pres).bar,
			[
				{
					name: "Votes by poll",
					labels: spec.top_polls.map((p) => (p.title ?? "(untitled)").slice(0, 28)),
					values: spec.top_polls.map((p) => p.total ?? 0),
				},
			],
			{ x: 0.5, y: 1.4, w: 12.33, h: 4.4 },
		);
		slide.addText(
			spec.top_polls.map((p) => ({
				text: `• ${p.title ?? "(untitled)"} — ${p.total ?? 0} votes`,
				options: { fontSize: 11, color: INK, breakLine: true, paraSpaceAfter: 4 },
			})),
			{ x: 0.5, y: 5.9, w: 12.33, h: 1.0 },
		);
	}
	footer(slide, spec);
}

function trendsSlide(pres: Pres, spec: DeckSpec): void {
	const slide = pres.addSlide();
	slide.background = { color: BG };
	title(slide, "Resolution trend");
	if (spec.solved_by_week.length === 0) {
		noData(slide);
	} else {
		slide.addChart(chartOf(pres).line,
			[
				{
					name: "Solved per week",
					labels: spec.solved_by_week.map((w) => w.week),
					values: spec.solved_by_week.map((w) => w.solved ?? 0),
				},
			],
			{ x: 0.5, y: 1.4, w: 12.33, h: 4.4 },
		);
	}
	footer(slide, spec);
}

function actionsSlide(pres: Pres, spec: DeckSpec): void {
	const slide = pres.addSlide();
	slide.background = { color: BG };
	title(slide, `Recommended actions (${spec.recommendations.length})`);
	slide.addText(
		spec.recommendations.map((r) => ({
			text: `• [${r.rule}] ${r.text}`,
			options: { fontSize: 13, color: INK, breakLine: true, paraSpaceAfter: 8 },
		})),
		{ x: 0.5, y: 1.4, w: 12.33, h: 5.2 },
	);
	footer(slide, spec);
}

/**
 * Build and save the PPTX for exactly `sections` (cover always first).
 * An empty pick falls back to the full deck — never a blank file.
 */
export async function buildPptx(
	spec: DeckSpec,
	sections: readonly string[],
	createPres: PresFactory = defaultFactory,
): Promise<void> {
	const picked = filterSections(sections);
	const pres = await createPres();
	pres.layout = "LAYOUT_WIDE";
	coverSlide(pres, spec);
	const want = new Set<SectionKey>(picked.length ? picked : [...DEFAULT_SECTIONS]);
	if (want.has("complaints")) complaintsSlide(pres, spec);
	if (want.has("feed")) feedSlide(pres, spec);
	if (want.has("reports")) reportsSlide(pres, spec);
	if (want.has("polls")) pollsSlide(pres, spec);
	if (want.has("trends")) trendsSlide(pres, spec);
	if (want.has("actions")) actionsSlide(pres, spec);
	await pres.writeFile({ fileName: `school-report-${spec.generated_at.slice(0, 10)}.pptx` });
}
