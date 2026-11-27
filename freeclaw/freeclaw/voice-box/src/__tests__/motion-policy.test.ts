// ═══════════════════════════════════════════════════════════════════
// Platform motion policy — no left-to-right sweeps
// ═══════════════════════════════════════════════════════════════════
// The admin feed felt like it was constantly reloading because every
// loading surface swept a highlight left-to-right on an infinite loop
// (skeletons, loading labels, hero gradient) while the realtime refresh
// refetched. Ambient motion that travels across content reads as a
// reload/glitch, so the platform policy is: nothing may animate a
// horizontal background sweep, and the shimmer button's sheen must stay
// parked off-screen.
//
// State-conveying motion (error shake, drawer open, orbit, spinner
// rotation) is deliberately NOT covered — it communicates a state change
// and is allowed.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");

/** Every `@keyframes name { … }` body in the stylesheet. */
function keyframes(css: string): { name: string; body: string }[] {
	const out: { name: string; body: string }[] = [];
	const re = /@keyframes\s+([\w-]+)\s*\{/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(css))) {
		// Walk to the matching close brace (these blocks contain no nested
		// braces, but count anyway so the parser cannot run away).
		let depth = 1;
		let i = re.lastIndex;
		while (i < css.length && depth > 0) {
			if (css[i] === "{") depth++;
			else if (css[i] === "}") depth--;
			i++;
		}
		const name = m[1];
		if (name) out.push({ name, body: css.slice(re.lastIndex, i - 1) });
		re.lastIndex = i;
	}
	return out;
}
describe("platform motion policy", () => {
	const css = src("index.css");

	it("defines keyframes (sanity: the parser sees the real file)", () => {
		expect(keyframes(css).length).toBeGreaterThan(20);
	});

	it("has no keyframe that sweeps a highlight left-to-right", () => {
		const sweeping = keyframes(css)
			.filter((k) => k.body.includes("background-position"))
			.map((k) => k.name);
		expect(sweeping).toEqual([]);
	});

	it("keeps the shimmer-button sheen parked instead of animating it", () => {
		const button = src("components/ui/shimmer-button.tsx");
		expect(button).not.toMatch(/animate-shimmer-slide/);
	});

	it("does not drive skeleton/loading classes with a sweep animation", () => {
		// The premium dashboard skeletons and the loading label must not carry
		// an infinite background-position animation.
		expect(css).not.toMatch(
			/\.vb-skeleton-prem\s*\{[^}]*animation:\s*vb-sk-shimmer/,
		);
		expect(css).not.toMatch(
			/\.vb-loading-label\s*\{[^}]*animation:\s*vb-loading-shimmer/,
		);
	});
});
