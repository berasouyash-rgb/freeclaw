// Typewriter — ChatGPT-style progressive reveal for AI messages.
//
// Honesty note: the server returns the COMPLETE text; this only reveals it
// progressively as presentation (no fake streaming, no invented words).
// Reduced-motion users get the full text instantly. Once finished it holds
// the exact server text — pausing mid-way never shows partial content as
// final because the bubble keeps its "thinking" state until done.
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./ErrorBoundary";

export default function Typewriter({
	text,
	cps = 120,
	label,
}: {
	text: string;
	cps?: number;
	label: string;
}) {
	const [n, setN] = useState(() =>
		prefersReducedMotion() ? text.length : 0,
	);
	useEffect(() => {
		if (prefersReducedMotion()) {
			setN(text.length);
			return;
		}
		setN(0);
		if (!text) return;
		const per = Math.max(8, Math.round(1000 / Math.max(1, cps)));
		const iv = window.setInterval(() => {
			setN((v) => {
				if (v >= text.length) {
					window.clearInterval(iv);
					return v;
				}
				return Math.min(text.length, v + 3);
			});
		}, per);
		return () => window.clearInterval(iv);
	}, [text, cps]);
	const done = n >= text.length;
	return (
		<span aria-label={label}>
			<span aria-hidden={done ? undefined : true}>{text.slice(0, n)}</span>
			{!done && <span className="vb-caret" aria-hidden="true" />}
		</span>
	);
}
