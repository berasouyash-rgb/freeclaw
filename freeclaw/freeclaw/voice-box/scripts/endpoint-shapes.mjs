// ═══════════════════════════════════════════════════════════════════
// ENDPOINT SHAPE EXTRACTOR
// ═══════════════════════════════════════════════════════════════════
// Widgets must read fields that actually exist. Guessing a field path
// produces a widget that is silently empty forever — the exact "technically
// wired, practically useless" failure.
//
// This walks every API handler, finds each `res.status(200).json({ ... })`
// object literal, and prints its TOP-LEVEL keys. Those keys are the only
// field names a widget may safely reference.
//
//   node scripts/endpoint-shapes.mjs            # all handlers
//   node scripts/endpoint-shapes.mjs _trends    # one handler
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = path.join(ROOT, "api");

/** Find the index just past the `}` matching the `{` at `open`. */
function matchBrace(src, open) {
	let depth = 0;
	let i = open;
	let inStr = null;
	while (i < src.length) {
		const ch = src[i];
		if (inStr) {
			if (ch === "\\") i += 2;
			else if (ch === inStr) {
				inStr = null;
				i += 1;
			} else i += 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inStr = ch;
			i += 1;
			continue;
		}
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) return i;
		}
		i += 1;
	}
	return -1;
}

/** Top-level keys of an object literal body, plus 1 level of nesting info. */
function topLevelKeys(body) {
	const keys = [];
	let depth = 0;
	let inStr = null;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (inStr) {
			if (ch === "\\") i += 1;
			else if (ch === inStr) inStr = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inStr = ch;
			continue;
		}
		if (ch === "{" || ch === "[" || ch === "(") depth += 1;
		else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
		else if (depth === 0) {
			// Bare identifier or quoted key followed by ':'
			const rest = body.slice(i);
			const m = rest.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
			const q = rest.match(/^\s*["']([\w$]+)["']\s*:/);
			if (m) {
				keys.push(m[1]);
				i += m[0].length - 1;
			} else if (q) {
				keys.push(q[1]);
				i += q[0].length - 1;
			}
		}
	}
	return [...new Set(keys)];
}

function main() {
	const filter = process.argv[2];
	const files = fs
		.readdirSync(API)
		.filter((f) => f.endsWith(".js") && f.startsWith("_"))
		.filter((f) => !filter || f.includes(filter));

	const report = {};

	for (const file of files.sort()) {
		const src = fs.readFileSync(path.join(API, file), "utf8");
		const shapes = [];

		// 200-success responses only. 4xx/405 bodies are error envelopes.
		const re = /res\s*\.\s*status\s*\(\s*(200|201)\s*\)\s*\.\s*json\s*\(/g;
		let m;
		while ((m = re.exec(src))) {
			// Index of the '(' we just matched.
			const parenIdx = re.lastIndex - 1;
			const braceIdx = src.indexOf("{", parenIdx);
			if (braceIdx === -1) continue;
			const end = matchBrace(src, braceIdx);
			if (end === -1) continue;
			const body = src.slice(braceIdx + 1, end);
			const keys = topLevelKeys(body);
			if (keys.length) {
				const line = src.slice(0, braceIdx).split("\n").length;
				shapes.push({ line, keys });
			}
			re.lastIndex = end;
		}

		if (shapes.length) {
			report[file.replace(/^_/, "").replace(/\.js$/, "")] = shapes;
		}
	}

	// Print one compact line per endpoint, so it can be diffed and checked
	// against a widget's declared field path.
	for (const [name, shapes] of Object.entries(report)) {
		for (const { line, keys } of shapes) {
			console.log(`${name}  L${line}  ${keys.join(", ")}`);
		}
	}
	console.log(
		`\n${Object.keys(report).length} handlers, ` +
			`${Object.values(report).reduce((a, s) => a + s.length, 0)} 200-responses`,
	);
}

main();
