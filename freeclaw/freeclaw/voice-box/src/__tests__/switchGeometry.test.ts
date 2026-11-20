import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the reported bug: "on mobile the toggle is vertical /
 * circular, on desktop it is horizontal".
 *
 * Cause: the switch track is 44x24 and the knob travels horizontally. Touch
 * device rules elsewhere raise buttons to a 44x44 minimum. When such a rule
 * wins, the track squares off and the knob stays pinned top-left, so the
 * control reads as a *vertical* switch. The geometry therefore cannot live
 * only inside a media query — it must be asserted unconditionally, with
 * min AND max, so no later min-size rule can stretch it.
 *
 * These are CSS-source invariants, not computed styles: a headless DOM does
 * not evaluate `@media (pointer: coarse)` or cascade Tailwind utilities, so
 * asserting on the stylesheet text is the strongest check available without
 * a real device viewport.
 */

const CSS_PATH = resolve(__dirname, "..", "index.css");

/** Drop CSS block comments comments so prose mentioning `@media` is not parsed as a rule. */
function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Remove every `@media ... { ... }` block so what remains is top-level CSS. */
function stripMediaBlocks(css: string): string {
	let out = "";
	let i = 0;
	while (i < css.length) {
		const at = css.indexOf("@media", i);
		if (at === -1) {
			out += css.slice(i);
			break;
		}
		out += css.slice(i, at);
		// Walk to the block's opening brace, then to its matching close.
		let depth = 0;
		let j = at;
		for (; j < css.length; j++) {
			const ch = css[j];
			if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) {
					j++;
					break;
				}
			}
		}
		i = j;
	}
	return out;
}

/** Pull the declaration body of the top-level rule whose selector contains `needle`. */
function findRuleBody(css: string, needle: string): string | null {
	const ruleStart = css.indexOf(needle);
	if (ruleStart === -1) return null;
	const open = css.indexOf("{", ruleStart);
	const close = css.indexOf("}", open);
	if (open === -1 || close === -1) return null;
	return css.slice(open + 1, close);
}

function listTsxFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) found.push(...listTsxFiles(full));
		else if (full.endsWith(".tsx")) found.push(full);
	}
	return found;
}

describe("switch track geometry", () => {
	// Normalize CRLF: the selector needles below span lines, and a checkout on
	// Windows would otherwise never match a Unix-style `\n` needle.
	const css = stripComments(
		readFileSync(CSS_PATH, "utf8").replace(/\r\n/g, "\n"),
	);
	const topLevel = stripMediaBlocks(css);

	it("declares the 44x24 track outside every media query", () => {
		// If this is missing from top-level CSS, the track's size depends on
		// which media queries happen to fire — the original bug.
		const body = findRuleBody(topLevel, ".switch,\nbutton.switch");
		expect(body).not.toBeNull();
		expect(body).toContain("width: 2.75rem");
		expect(body).toContain("height: 1.5rem");
	});

	it("pins min and max so a touch-target rule cannot square the track", () => {
		const body = findRuleBody(topLevel, ".switch,\nbutton.switch");
		expect(body).toBeTruthy();
		// min-height alone is not enough: a later `min-height: 44px` on a bare
		// `button` selector would still win at equal specificity. Both bounds
		// are asserted so the track stays 44x24 no matter what comes after.
		expect(body).toMatch(/min-width:\s*2\.75rem/);
		expect(body).toMatch(/max-width:\s*2\.75rem/);
		expect(body).toMatch(/min-height:\s*1\.5rem/);
		expect(body).toMatch(/max-height:\s*1\.5rem/);
	});

	it("keeps a >=44px tap target without distorting the visible track", () => {
		// The fix must not regress the accessibility floor: the shape stays
		// 44x24, and the thumb target is grown by a transparent overlay.
		expect(css).toMatch(/button\.switch::after[\s\S]{0,200}inset:\s*-10px/);
	});

	it("every sliding-knob toggle uses the switch class the geometry targets", () => {
		// A toggle added later with only Tailwind's `w-11 h-6` would be sized by
		// utilities and re-square on touch. The class is the contract.
		const srcDir = resolve(__dirname, "..");
		const files = listTsxFiles(srcDir).filter(
			(file) => !file.includes("__tests__"),
		);
		const withKnob = files.filter((file) =>
			readFileSync(file, "utf8").includes("translate-x-5"),
		);
		expect(withKnob.length).toBeGreaterThan(0);
		for (const file of withKnob) {
			const source = readFileSync(file, "utf8");
			expect(source, `${file} renders a sliding knob without the switch class`).toContain(
				"switch",
			);
		}
	});
});
