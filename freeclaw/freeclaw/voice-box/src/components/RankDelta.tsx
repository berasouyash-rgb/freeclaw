import { ArrowDown, ArrowUp } from "lucide-react";

/**
 * The "↑ +2 / ↓ -1" chip a card wears for three seconds after a vote reordered
 * the feed. Purely visual confirmation of the glide — the vote count and its
 * `aria-pressed` state are the accessible result, so this is aria-hidden and
 * never steals a screen reader's turn.
 */
export default function RankDelta({ move }: { move: number }) {
	if (!move) return null;
	const up = move > 0;
	const places = Math.abs(move);
	return (
		<span
			className={`vb-rank-delta ${up ? "vb-rank-delta-up" : "vb-rank-delta-down"}`}
			data-testid="rank-delta"
			data-direction={up ? "up" : "down"}
			title={up ? `Moved up ${places} place${places > 1 ? "s" : ""}` : `Moved down ${places} place${places > 1 ? "s" : ""}`}
			aria-hidden
		>
			{up ? (
				<ArrowUp size={13} strokeWidth={3} className="vb-rank-arrow shrink-0" />
			) : (
				<ArrowDown size={13} strokeWidth={3} className="vb-rank-arrow shrink-0" />
			)}
			<span>{up ? `+${places}` : `-${places}`}</span>
		</span>
	);
}
