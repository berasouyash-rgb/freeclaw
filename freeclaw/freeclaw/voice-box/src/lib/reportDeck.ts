// ═══════════════════════════════════════════════════════════════════
// reportDeck — the ONE section model for the admin presentation
// ═══════════════════════════════════════════════════════════════════
// The deck viewer (ReportDeck.tsx) and the PPT export (deckExport.ts)
// share this registry: the admin ticks Complaints / Feed / Reports /
// Polls / Trends / Actions (or All) and BOTH surfaces render exactly
// that set. A section picked here can never leak out of one surface,
// and a new section added here appears in both — no drift by design.
//
// Pure in → data out: no fetch, no DOM, unit-testable in isolation.
// ═══════════════════════════════════════════════════════════════════

export type SectionKey =
	| "complaints"
	| "feed"
	| "reports"
	| "polls"
	| "trends"
	| "actions";

export type SlideKey = "cover" | SectionKey;

export interface DeckSectionMeta {
	key: SectionKey;
	label: string;
	hint: string;
}

// Admin-language labels, stable order (viewer dots + PPT order follow it).
export const DECK_SECTIONS: DeckSectionMeta[] = [
	{ key: "complaints", label: "Complaints", hint: "Top-supported posts + category mix" },
	{ key: "feed", label: "Feed", hint: "Open / solved / status mix" },
	{ key: "reports", label: "Reports", hint: "Open vs resolved moderation queue" },
	{ key: "polls", label: "Polls", hint: "Top polls by votes" },
	{ key: "trends", label: "Trends", hint: "Solved per week" },
	{ key: "actions", label: "Actions", hint: "Rule-labeled recommendations" },
];

export const DEFAULT_SECTIONS: SectionKey[] = DECK_SECTIONS.map((s) => s.key);

const KNOWN = new Set<string>(DECK_SECTIONS.map((s) => s.key));

/**
 * Normalise a raw selection: drop unknown keys, dedupe (registry order),
 * and fall back to the full deck on an empty pick so an export can never
 * produce a blank file.
 */
export function filterSections(input: readonly string[]): SectionKey[] {
	const seen = new Set<SectionKey>();
	for (const meta of DECK_SECTIONS) {
		if (input.includes(meta.key)) seen.add(meta.key);
	}
	if (seen.size === 0) return [...DEFAULT_SECTIONS];
	return [...seen];
}

export function isSectionKey(value: string): value is SectionKey {
	return KNOWN.has(value);
}

// ─── Spec shape (mirrors GET /api/report-deck) ─────────────────────
// Duplicated here (not imported from the API) so the client bundle never
// pulls server modules. Field-for-field with api/_report-deck.js.
export interface DeckSpec {
	version: number;
	generated_at: string;
	window: number;
	totals: {
		posts: number;
		open: number;
		solved: number;
		reports_open: number;
		reports_resolved: number;
		polls: number;
		votes: number;
	};
	by_category: { category: string; open: number; solved: number; total: number }[];
	by_status: { status: string; count: number }[];
	top_supported: {
		id: string;
		title: string;
		category: string;
		status: string;
		support: number;
		upvote: number;
		score: number;
	}[];
	top_polls: { id: string; title: string; total: number }[];
	solved_by_week: { week: string; solved: number }[];
	recommendations: { rule: string; text: string }[];
}

export interface SlideDef {
	key: SlideKey;
	title: string;
}

/** Slide titles derive from live counts — a title is never blank. */
export function buildSlides(
	spec: DeckSpec,
	selected: readonly SectionKey[],
): SlideDef[] {
	const t = spec.totals;
	const day = spec.generated_at.slice(0, 10);
	const slides: SlideDef[] = [
		{ key: "cover", title: `School report — ${day}` },
	];
	const want = new Set<SectionKey>(selected);
	if (want.has("complaints"))
		slides.push({ key: "complaints", title: `Top complaints (${t.open} open)` });
	if (want.has("feed"))
		slides.push({
			key: "feed",
			title: `Feed status — ${t.solved} of ${t.posts} solved`,
		});
	if (want.has("reports"))
		slides.push({
			key: "reports",
			title: `Reports — ${t.reports_open} need review`,
		});
	if (want.has("polls"))
		slides.push({ key: "polls", title: `Polls — ${t.votes} votes` });
	if (want.has("trends")) slides.push({ key: "trends", title: "Resolution trend" });
	if (want.has("actions"))
		slides.push({
			key: "actions",
			title: `Recommended actions (${spec.recommendations.length})`,
		});
	return slides;
}

/** True when every counter is zero — the honest-empty gate. */
export function isEmptySpec(spec: DeckSpec): boolean {
	const t = spec.totals;
	return (
		t.posts === 0 &&
		t.open === 0 &&
		t.solved === 0 &&
		t.reports_open === 0 &&
		t.reports_resolved === 0 &&
		t.polls === 0 &&
		t.votes === 0
	);
}
