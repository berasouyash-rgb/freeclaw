// ═══════════════════════════════════════════════════════════════════════════
// ROUTER CONTRACT — the client→server wiring that individual handler tests
// cannot see.
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS FILE EXISTS
//
// `api/version.js` shipped for a whole release cycle with a passing unit test
// (tests/api/version.test.ts imports the handler DIRECTLY), yet `GET
// /api/version` returned 404 in production: the module was never imported by
// api/index.js and never appeared in its `routes` map. Every APK/EXE update
// check silently failed, so the in-app update dialog could never fire.
//
// A handler test proves the handler works. It does NOT prove the handler is
// reachable. This file asserts the wiring itself:
//
//   1. every `/api/<endpoint>` string the client actually calls resolves to a
//      key in the router's `routes` map (or to a pre-router special case);
//   2. every `routes` map entry points at an identifier that is really
//      imported, so a typo'd handler name cannot silently 404;
//   3. the update feed specifically is imported AND routed.
//
// All three checks are pure source inspection — no network, no mocks, no
// flakiness — so they fail for the right reason on any machine.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const API_DIR = resolve(ROOT, "api");
const SRC_DIR = resolve(ROOT, "src");

/** Endpoints index.js answers before the `routes` map lookup. */
const PRE_ROUTER_SPECIAL_CASES = new Set(["_ping", "_debug"]);

/** Source files under `api/` and `src/` that we read for endpoint strings. */
function walk(dir: string, out: string[] = []): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (
			entry === "node_modules" ||
			entry === "dist" ||
			entry === "build" ||
			entry === ".git" ||
			entry === "__tests__"
		) {
			continue;
		}
		const full = join(dir, entry);
		let stat;
		try {
			stat = statSync(full);
		} catch {
			continue;
		}
		if (stat.isDirectory()) walk(full, out);
		else if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(entry)) out.push(full);
	}
	return out;
}

function readIndex(): { source: string; routesBody: string } {
	const source = readFileSync(resolve(API_DIR, "index.js"), "utf8");
	const match = source.match(/const routes = \{([\s\S]*?)\n\};/);
	if (!match) throw new Error("api/index.js: `routes` map not found");
	return { source, routesBody: match[1] };
}

/** Route keys declared in the `routes` map. */
function routeKeys(routesBody: string): Set<string> {
	const keys = new Set<string>();
	for (const m of routesBody.matchAll(/^\s*(?:"([^"]+)"|([\w$]+))\s*:/gm)) {
		keys.add((m[1] || m[2]).trim());
	}
	return keys;
}

/** Identifiers `api/index.js` imports from anywhere. */
function importedIds(source: string): Set<string> {
	const ids = new Set<string>();
	for (const m of source.matchAll(/^import\s+(\w+)\s+from\s+"(\.[^"]+)";/gm)) {
		ids.add(m[1]);
	}
	for (const m of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+"(\.[^"]+)";/g)) {
		for (const part of m[1].split(",")) {
			const name = part.trim().split(/\s+as\s+/).pop()?.trim();
			if (name) ids.add(name);
		}
	}
	for (const m of source.matchAll(/^import\s+(\w+)\s*,/gm)) ids.add(m[1]);
	return ids;
}

/** Every endpoint base segment the client code references. */
function clientEndpoints(): Map<string, string[]> {
	const refs = new Map<string, string[]>();
	for (const file of walk(SRC_DIR)) {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const m of text.matchAll(/\/api\/([A-Za-z0-9_\-./]+)/g)) {
			const raw = m[1].replace(/[?#].*$/, "").replace(/\/+$/, "");
			if (!raw) continue;
			// `/api/v3/stream` is a two-segment key; everything else is the
			// first segment only.
			const base = raw.startsWith("v3/") ? raw : raw.split("/")[0];
			// Skip prose ("…/api/index.js") and unresolved template pieces.
			if (base.includes(".") || base.includes("$")) continue;
			const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
			const list = refs.get(base) || [];
			if (!list.includes(rel)) list.push(rel);
			refs.set(base, list);
		}
	}
	return refs;
}

describe("api router contract", () => {
	const { source, routesBody } = readIndex();
	const keys = routeKeys(routesBody);

	it("extracts a non-trivial route map", () => {
		expect(keys.size).toBeGreaterThan(50);
	});

	it("every /api endpoint the client calls is registered in the router", () => {
		const refs = clientEndpoints();
		expect(refs.size).toBeGreaterThan(30); // guard against a broken scanner
		const unreachable: string[] = [];
		for (const [seg, files] of refs) {
			if (keys.has(seg)) continue;
			if (PRE_ROUTER_SPECIAL_CASES.has(seg)) continue;
			unreachable.push(`${seg}  <- ${files.join(", ")}`);
		}
		expect(unreachable).toEqual([]);
	});

	it("every route entry dispatches to an imported handler identifier", () => {
		const imported = importedIds(source);
		const broken: string[] = [];
		for (const m of routesBody.matchAll(
			/^\s*(?:"([^"]+)"|([\w$]+))\s*:\s*(.+)$/gm,
		)) {
			const key = m[1] || m[2];
			const expr = m[3];
			const id =
				expr.match(/protect\(\s*(\w+)/)?.[1] || expr.match(/^\s*(\w+)/)?.[1];
			if (id && !imported.has(id)) broken.push(`${key} -> ${id}`);
		}
		expect(broken).toEqual([]);
	});

	it("routes the app update feed (/api/version)", () => {
		// The regression this file was written for: the module existed and its
		// own unit test passed, but index.js never imported it.
		expect({
			importsVersionModule: source.includes(
				'import version from "./version.js"',
			),
			registersVersionRoute: keys.has("version"),
		}).toEqual({ importsVersionModule: true, registersVersionRoute: true });
	});
});
