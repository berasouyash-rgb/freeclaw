import { ArrowDown, ArrowUp } from "lucide-react";

/**
 * The "↑ 2 / ↓ 1" chip a card wears for three seconds after a vote reordered
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
			title={up ? `Moved up ${places}` : `Moved down ${places}`}
			aria-hidden
		>
			{up ? (
				<ArrowUp size={10} strokeWidth={3} />
			) : (
				<ArrowDown size={10} strokeWidth={3} />
			)}
			{places}
		</span>
	);
}
