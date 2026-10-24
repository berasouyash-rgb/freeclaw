// ═══════════════════════════════════════════════════════════════════
// No raw window.location.href navigation outside the platform helper
// ═══════════════════════════════════════════════════════ guard block
// Every programmatic navigation must route through navigateTo()
// (src/lib/platform.ts): hash assignment inside the native shells
// (APK/EXE run HashRouter) and href on web. A raw
// `window.location.href = "/…"` anywhere else loads file:///… inside
// the app shells and strands the reader on a blank screen — this guard
// pins the whole bug class, not just the three sites fixed so far
// (AppContext toast action, ErrorBoundary Go Home, CommunityDetail
// admin delete). `window.location.reload()` is unaffected: only
// *assignments to href* navigate.
//
// The helper's own web branch (platform.ts) is the single sanctioned
// exception.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");
const SANCTIONED = new Set(["src/lib/platform.ts"]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.[jt]sx?$/.test(entry)) out.push(full);
	}
	return out;
}

describe("no raw window.location.href navigation outside the platform helper", () => {
	it("routes every programmatic navigation through navigateTo()", () => {
		const offenders: string[] = [];
		for (const full of walk(SRC)) {
			const rel = relative(process.cwd(), full).replace(/\\/g, "/");
			// Tests never ship inside the APK/EXE — and this guard's own
			// pattern literal would otherwise match itself.
			if (rel.includes("__tests__")) continue;
			if (SANCTIONED.has(rel)) continue;
			const text = readFileSync(full, "utf8");
			if (/window\.location\.href\s*=/.test(text)) offenders.push(rel);
		}
		expect(
			offenders,
			`raw href navigation breaks the APK/EXE shells (HashRouter) — route through navigateTo() instead: ${offenders.join(", ")}`,
		).toEqual([]);
	});
});
