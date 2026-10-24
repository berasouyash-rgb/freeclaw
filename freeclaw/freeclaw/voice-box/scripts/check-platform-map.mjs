#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// check-platform-map.mjs — validates docs/platform-map.json.
// ═══════════════════════════════════════════════════════════════════
// FAILS on broken references (missing page/api/test files). WARNS on
// routed-but-unmapped API modules (the map grows over time; warnings keep
// it honest without boiling the ocean). Run in CI and via the contract
// test tests/api/platform-map.test.ts.
// Usage: node scripts/check-platform-map.mjs [--strict]
//   --strict turns unmapped-module warnings into failures.
// ═══════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const strict = process.argv.includes("--strict");

const map = JSON.parse(
  fs.readFileSync(path.join(root, "docs", "platform-map.json"), "utf8"),
);

const errors = [];
const warnings = [];
const mappedApis = new Set();

// ── 1. Entry references must resolve ─────────────────────────────
for (const flow of map.flows ?? []) {
  const pagePath = path.join(root, flow.page);
  let pageOk = false;
  try {
    const stat = fs.statSync(pagePath);
    pageOk =
      stat.isFile() || (stat.isDirectory() && flow.page.endsWith("/"));
  } catch {
    pageOk = false;
  }
  if (!pageOk) errors.push(`flow ${flow.route}: missing page ${flow.page}`);
  for (const api of flow.apis ?? []) {
    mappedApis.add(api);
    if (!fs.existsSync(path.join(root, api)))
      errors.push(`flow ${flow.route}: missing api module ${api}`);
  }
  if (!Array.isArray(flow.tables) || flow.tables.length === 0)
    warnings.push(`flow ${flow.route}: no tables listed`);
  if (!Array.isArray(flow.tests) || flow.tests.length === 0) {
    errors.push(`flow ${flow.route}: no tests listed`);
  } else {
    for (const t of flow.tests) {
      if (!fs.existsSync(path.join(root, t)))
        errors.push(`flow ${flow.route}: missing test ${t}`);
    }
  }
}

// ── 2. Routed API modules should be mapped (warn only) ────────────
const indexJs = fs.readFileSync(path.join(root, "api", "index.js"), "utf8");
const routedKeys = new Set();
for (const m of indexJs.matchAll(/^\s*([a-z][a-z0-9_-]*):\s*protect\(/gm)) {
  routedKeys.add(m[1]);
}
for (const key of [...routedKeys].sort()) {
  const mod = `api/_${key}.js`;
  if (mappedApis.has(mod)) continue;
  if (!fs.existsSync(path.join(root, mod))) {
    // Route key with no same-named module (alias or differently-named file):
    // informational only, resolved by hand when curating.
    warnings.push(`route key '${key}' has no api/_${key}.js module file`);
    continue;
  }
  warnings.push(`api module mapped by no flow (coverage gap): ${mod}`);
}

if (warnings.length) {
  console.log("platform-map warnings:");
  for (const w of warnings) console.log("  warn  " + w);
}
if (errors.length) {
  console.log("platform-map ERRORS:");
  for (const e of errors) console.log("  FAIL  " + e);
  process.exit(1);
}
if (strict && warnings.length) {
  console.log("strict mode: warnings fail the run");
  process.exit(1);
}
console.log(
  `platform-map OK — ${map.flows.length} flows, ${mappedApis.size} api modules mapped.`,
);
