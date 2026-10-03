// ════════════════════════════════════════════════════════════════════
// RelevanceNote — the advisory "does this look like something the
// school can act on?" panel on the submit page.
//
// The whole point of this panel is that it is NOT a gate. It must
// never disable publishing, never say "blocked", and never frame a
// distressed student as off-topic. It must also show the exact words
// it reacted to — a student who is told their message "seemed off-topic"
// with no evidence has no way to disagree with us.
//
// These tests assert on rendered text and roles only. Nothing here
// checks network behaviour; `tests/api/relevance.test.ts` owns the
// reasoning, and `src/__tests__/Submit.test.tsx` owns the wiring.
// ════════════════════════════════════════════════════════════════════

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RelevanceNote from "../components/RelevanceNote";
import type { RelevanceResult } from "../lib/moderation";

const LIMITS = [
	"It only reads the words you typed. It has not checked whether the problem is real.",
	"It cannot tell who is responsible or how urgent this is.",
];

function verdict(over: Partial<RelevanceResult> = {}): RelevanceResult {
	return {
		policyVersion: "relevance-v1",
		verdict: "school_problem",
		route: "post",
		confidence: "medium",
		reasons: [
			{
				kind: "school",
				signal: "facilities",
				label: "Mentions school facilities",
				evidence: "classroom",
			},
			{
				kind: "problem",
				signal: "malfunction",
				label: "Describes something not working",
				evidence: "not working",
			},
		],
		explanation:
			"You mention a school place and something that is not working there, so this looks like something the school could act on.",
		askUserToConfirm: false,
		limits: LIMITS,
		...over,
	};
}

const SCHOOL_TEXT = "The AC in our classroom is not working since morning";

describe("RelevanceNote", () => {
	// ── Nothing at all ─────────────────────────────────────────────

	it("renders nothing when there is no verdict yet", () => {
		const { container } = render(
			<RelevanceNote relevance={null} text={SCHOOL_TEXT} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing while a check is in flight instead of showing a stale claim", () => {
		// A verdict for the PREVIOUS text must not be displayed as if it
		// described the text on screen right now.
		const { container } = render(
			<RelevanceNote relevance={verdict()} text={SCHOOL_TEXT} checking />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("stays out of the way until the text is long enough to judge", () => {
		const { container } = render(<RelevanceNote relevance={verdict()} text="AC bad" />);
		expect(container).toBeEmptyDOMElement();
	});

	// ── The two cases the user actually named ──────────────────────

	it("confirms a real school problem without inventing doubt", () => {
		render(<RelevanceNote relevance={verdict()} text={SCHOOL_TEXT} />);
		expect(screen.getByText(/reads like a school problem/i)).toBeInTheDocument();
	});

	it("does not call a distressed student's message off-topic", () => {
		// The user asked for "fate is not coming to me" to be treated as
		// NOT a school problem. A student in distress must never be told
		// their message is off-topic — that is both wrong and cruel.
		render(
			<RelevanceNote
				relevance={verdict({
					verdict: "unclear",
					route: "support",
					reasons: [
						{
							kind: "distress",
							signal: "self_harm",
							label: "Mentions self-harm",
							evidence: "not worth living",
						},
					],
					explanation:
						"What you wrote sounds heavy, and that matters more than whether it fits a school category.",
					askUserToConfirm: false,
				})}
				text="Sometimes I feel it is not worth living"
			/>,
		);

		expect(screen.getByText(/might be about you/i)).toBeInTheDocument();
		expect(screen.queryByText(/off-topic/i)).not.toBeInTheDocument();
		expect(screen.getByText(/talk to someone you\s*trust/i)).toBeInTheDocument();
	});

	// ── Transparency ───────────────────────────────────────────────

	it("shows the exact words it reacted to, not a mystery score", () => {
		render(<RelevanceNote relevance={verdict()} text={SCHOOL_TEXT} />);
		expect(screen.getByText("Why we said this")).toBeInTheDocument();
		// Quoted, so the author can see the exact substring we reacted to
		// and disagree with it — not an unarguable mystery score.
		expect(screen.getByText("\u201cclassroom\u201d")).toBeInTheDocument();
		expect(screen.getByText("\u201cnot working\u201d")).toBeInTheDocument();
		expect(screen.getByText(/mentions school facilities/i)).toBeInTheDocument();
	});

	it("states what the check cannot do", () => {
		render(<RelevanceNote relevance={verdict()} text={SCHOOL_TEXT} />);
		expect(screen.getByText(/what this check cannot do/i)).toBeInTheDocument();
		for (const limit of LIMITS) {
			expect(screen.getByText(new RegExp(limit.slice(0, 30), "i"))).toBeInTheDocument();
		}
	});

	it("announces itself politely to a screen reader", () => {
		render(<RelevanceNote relevance={verdict()} text={SCHOOL_TEXT} />);
		// An advisory that appears unbidden mid-typing must be announced,
		// not silently inserted into the page.
		expect(screen.getByRole("status")).toBeInTheDocument();
	});

	// ── It is an invitation, never a requirement ───────────────────

	it("invites but never requires a second look before posting", () => {
		render(
			<RelevanceNote
				relevance={verdict({
					verdict: "not_school_related",
					route: "post_with_note",
					confidence: "low",
					reasons: [
						{
							kind: "off_topic",
							signal: "fatalism",
							label: "Reads as fortune or luck",
							evidence: "my fate",
						},
					],
					explanation:
						"We could not tie this to something the school controls. You can still post it.",
					askUserToConfirm: true,
				})}
				text="My fate is not coming to me this year"
			/>,
		);

		expect(screen.getByText(/only a suggestion/i)).toBeInTheDocument();
		expect(screen.getByText(/you can post it as it is/i)).toBeInTheDocument();
		// Nothing here may read as a rejection.
		expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/cannot be posted/i)).not.toBeInTheDocument();
	});

	it("does not ask for confirmation on a support verdict", () => {
		// Offering "did you mean to add a note?" to someone describing
		// self-harm is tone-deaf; the copy must stay on support.
		render(
			<RelevanceNote
				relevance={verdict({
					verdict: "unclear",
					route: "support",
					reasons: [],
					explanation: "That sounds heavy.",
					askUserToConfirm: true,
				})}
				text="I do not think anyone would notice"
			/>,
		);
		expect(screen.queryByText(/only a suggestion/i)).not.toBeInTheDocument();
	});

	it("handles a verdict with no reasons and no limits without crashing", () => {
		// A network or policy change could deliver a thinner object than
		// the current engine produces. It must render, not white-screen.
		render(
			<RelevanceNote
				relevance={verdict({ reasons: [], limits: [], askUserToConfirm: false })}
				text={SCHOOL_TEXT}
			/>,
		);
		expect(screen.getByText(/reads like a school problem/i)).toBeInTheDocument();
		expect(screen.queryByText("Why we said this")).not.toBeInTheDocument();
	});
});