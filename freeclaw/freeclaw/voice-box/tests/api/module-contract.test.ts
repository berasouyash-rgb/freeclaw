// ═══════════════════════════════════════════════════════════════════
// API MODULE CONTRACT — every local named import must exist
// ═══════════════════════════════════════════════════════════════════
// Regression guard for a real P0: `api/_posts.js` and `api/_admin.js`
// imported `getSpamConfig` / `normalizeSpamConfig` / `recordSafetyRepost`
// from `api/_moderation.js`, which never exported them. Under Vite's SSR
// runner a missing named export resolves to `undefined` (not a link-time
// error), so every handler that imported the module graph silently returned
// 500 for EVERY route — and `tsc`/`eslint` could not see it because `api/`
// is plain JS outside the type-checked program.
//
// This test reads the source instead of importing it, so it fails on the
// missing export itself rather than on whatever undefined-typed crash
// happens first at runtime.
// ═══════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../api");

function jsFilesUnder(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
		else if (entry.endsWith(".js")) out.push(full);
	}
	return out;
}

/**
 * Drop whole-line comments before scanning.
 *
 * Two false-positive sources lived here. (1) The import regex used a lazy
 * `[\s\S]*?`, so an `import {` followed by a NON-local `from "node:crypto"`
 * ran past that statement and captured every binding up to the next
 * `} from "./local.js"` — reporting bindings against the wrong module.
 * (2) Doc comments contain usage examples like
 * `//   import { registry } from './_agent-tool-registry.js';` — commented-out
 * code that is not an import at all.
 *
 * Stripping whole-line comments is safe because a real import is never
 * preceded by `//`, and the regex is tightened to `[^{}]*?` so it cannot span
 * a brace from a neighbouring statement. Both behaviours are proven by the
 * probe at the bottom of this file.
 */
function stripLineComments(src: string): string {
	return src
		.split("\n")
		.map((line) => (/^\s*\/\//.test(line) ? "" : line))
		.join("\n");
}

/** Names a module makes importable, from its export syntax (no execution). */
function declaredExports(src: string): { names: Set<string>; wildcard: boolean } {
	const names = new Set<string>();
	const wildcard = /export\s*\*\s*from/.test(src);
	for (const m of src.matchAll(
		/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g,
	)) {
		names.add(m[1]);
	}
	for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
		for (const part of m[1].split(",")) {
			const cleaned = part.trim();
			if (!cleaned) continue;
			// `export { local as public }` — the public name is what importers bind.
			const alias = cleaned.match(/\bas\s+([A-Za-z0-9_$]+)/);
			if (alias) names.add(alias[1]);
			else {
				const plain = cleaned.match(/^([A-Za-z0-9_$]+)/);
				if (plain) names.add(plain[1]);
			}
		}
	}
	if (/export\s+default\b/.test(src)) names.add("default");
	return { names, wildcard };
}

describe("api module contract", () => {
	it("every named import from a local api module is a declared export", () => {
		const files = jsFilesUnder(API_DIR);
		const exportsByFile = new Map<string, { names: Set<string>; wildcard: boolean }>();
		for (const file of files) {
			exportsByFile.set(file, declaredExports(readFileSync(file, "utf8")));
		}

		const violations: string[] = [];
		for (const file of files) {
			const src = stripLineComments(readFileSync(file, "utf8"));
			for (const m of src.matchAll(
				/import\s*\{([^{}]*?)\}\s*from\s*["'](\.[^"']+)["']/g,
			)) {
				const target = resolve(dirname(file), m[2]);
				const targetEntry = exportsByFile.get(target);
				if (!targetEntry || targetEntry.wildcard) continue;
				for (const part of m[1].split(",")) {
					const cleaned = part.trim().replace(/^type\s+/, "");
					if (!cleaned) continue;
					const binding = cleaned.split(/\s+as\s+/)[0].trim();
					if (!binding || binding === "default") continue;
					if (!targetEntry.names.has(binding)) {
						violations.push(
							`${file.slice(API_DIR.length + 1)} imports { ${binding} } from "${m[2]}" but that module does not export it`,
						);
					}
				}
			}
		}

		expect(violations, violations.join("\n")).toEqual([]);
	});

	// The guard above only means something if it can still FAIL. A regex that
	// silently stopped matching would report zero violations forever and look
	// perfectly green. These two probes pin both directions: a genuinely
	// absent export is caught, and the two historical false-positive shapes
	// (a neighbouring non-local import, and a commented-out usage example) are
	// not.
	const IMPORT_RE = /import\s*\{([^{}]*?)\}\s*from\s*["'](\.[^"']+)["']/g;

	function bindingsOf(source: string): string[] {
		const out: string[] = [];
		for (const m of stripLineComments(source).matchAll(IMPORT_RE)) {
			for (const part of m[1].split(",")) {
				const b = part.trim().split(/\s+as\s+/)[0].trim();
				if (b && b !== "default") out.push(b);
			}
		}
		return out;
	}

	it("still catches a genuinely missing export", () => {
		const target = declaredExports("export const present = 1;");
		const source = 'import { missingThing } from "./somewhere.js";';
		const caught = bindingsOf(source).filter((b) => !target.names.has(b));
		expect(caught).toEqual(["missingThing"]);
	});

	it("does not report a neighbouring non-local import as a local one", () => {
		// The exact shape that produced the false positive: a braced import
		// from node:crypto followed by a local import. Only the local binding
		// may be considered, and it must be checked against its own module.
		const source = [
			'import { timingSafeEqual } from "node:crypto";',
			'import { isAdmin } from "./_auth.js";',
		].join("\n");
		expect(bindingsOf(source)).toEqual(["isAdmin"]);
	});

	it("ignores commented-out usage examples", () => {
		const source = [
			"//   import { registry } from './_agent-tool-registry.js';",
			'import { realThing } from "./_auth.js";',
		].join("\n");
		expect(bindingsOf(source)).toEqual(["realThing"]);
	});
});
