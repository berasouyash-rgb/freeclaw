/**
 * RelevanceNote — "is this something the school can act on?"
 *
 * Advisory only. It shows the author what we noticed and why, and makes
 * clear they can always post. It never gates the submit button and never
 * changes what is stored — see `api/_relevance.js` for the reasoning.
 *
 * Two deliberate design choices:
 *
 *  1. It shows the EXACT text it reacted to. A vague "our AI flagged this"
 *     is unarguable and feels arbitrary; quoting the real words lets a
 *     student see the mistake and correct us.
 *  2. Distress is never framed as a relevance problem. If the settlement is
 *     "support", the copy leads with that and does not mention posting rules
 *     at all — telling a struggling student their message was "off-topic"
 *     would be both wrong and cruel.
 */

import { Info, LifeBuoy, ShieldCheck } from "lucide-react";
import type { RelevanceResult } from "../lib/moderation";

interface RelevanceNoteProps {
	/** Verdict for the current text, or null when unknown/failed. */
	relevance: RelevanceResult | null;
	/** The current author text — used only to avoid showing on near-empty input. */
	text: string;
	/** True while a check is in flight; render nothing rather than a stale claim. */
	checking?: boolean;
}

/** Minimum length before a verdict is worth showing. */
const MIN_CHARS = 12;

function heading(r: RelevanceResult): string {
	if (r.route === "support") return "This sounds like it might be about you";
	if (r.verdict === "school_problem") return "Reads like a school problem";
	if (r.verdict === "not_school_related") return "We couldn't find a school issue here";
	return "We couldn't tell if this is about school";
}

export default function RelevanceNote({
	relevance,
	text,
	checking,
}: RelevanceNoteProps) {
	if (checking || !relevance) return null;
	if (text.trim().length < MIN_CHARS) return null;

	const isSupport = relevance.route === "support";
	const isProblem = relevance.verdict === "school_problem";
	const color = isSupport
		? "var(--vb-accent)"
		: isProblem
			? "var(--vb-good)"
			: "var(--vb-ink3)";
	const background = isSupport
		? "rgba(86,82,214,0.08)"
		: isProblem
			? "rgba(22,160,106,0.08)"
			: "rgba(110,110,140,0.07)";
	const border = isSupport
		? "rgba(86,82,214,0.22)"
		: isProblem
			? "rgba(22,160,106,0.2)"
			: "rgba(110,110,140,0.18)";

	const Icon = isSupport ? LifeBuoy : isProblem ? ShieldCheck : Info;

	return (
		<div
			className="rounded-xl px-3.5 py-3 text-xs vb-rise"
			style={{ background, border: `1px solid ${border}` }}
			role="status"
		>
			<p
				className="font-semibold flex items-center gap-1.5 mb-1"
				style={{ color }}
			>
				<Icon size={13} />
				<span>{heading(relevance)}</span>
			</p>

			<p className="text-ink2 leading-relaxed">{relevance.explanation}</p>

			{isSupport && (
				<p className="text-ink3 mt-1.5 leading-relaxed">
					If you are going through something, please also talk to someone you
					trust. You can still post this here.
				</p>
			)}

			{/* Transparency: show the real evidence, not a mystery score. */}
			{relevance.reasons.length > 0 && (
				<details className="mt-2">
					<summary
						className="cursor-pointer text-ink3 select-none"
						style={{ color }}
					>
						Why we said this
					</summary>
					<ul className="mt-1.5 space-y-1 list-disc pl-4 text-ink3">
						{relevance.reasons.map((reason, i) => (
							<li key={`${reason.signal}-${i}`}>
								{reason.label}
								{reason.evidence ? (
									<>
										{" — "}
										<span className="italic">&ldquo;{reason.evidence}&rdquo;</span>
									</>
								) : null}
							</li>
						))}
					</ul>
					<div className="mt-2 text-ink3">
						<p className="font-semibold">What this check cannot do</p>
						<ul className="mt-1 space-y-0.5 list-disc pl-4">
							{relevance.limits.map((limit) => (
								<li key={limit}>{limit}</li>
							))}
						</ul>
					</div>
				</details>
			)}

			{/* An invitation, never a requirement. */}
			{relevance.askUserToConfirm && !isSupport && (
				<p className="text-ink3 mt-1.5">
					This is only a suggestion — you can post it as it is.
				</p>
			)}
		</div>
	);
}
