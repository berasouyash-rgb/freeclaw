#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(root, "tests", "api");

function findTestFiles(dir) {
	let results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results = results.concat(findTestFiles(full));
		} else if (/\.test\.[jt]sx?$/.test(entry.name)) {
			results.push(path.relative(root, full).replace(/\\/g, "/"));
		}
	}
	return results.sort();
}

const files = findTestFiles(testsDir);
const BATCH_SIZE = 10;
const total = files.length;
let passed = 0;
let failed = 0;
const failedFiles = [];

console.log(`Running ${total} API test files in batches of ${BATCH_SIZE}...\n`);

for (let i = 0; i < total; i += BATCH_SIZE) {
	const batch = files.slice(i, i + BATCH_SIZE);
	const batchNum = Math.floor(i / BATCH_SIZE) + 1;
	console.log(`═══ Batch ${batchNum} (${batch.length} files) ═══`);

	const env = {
		...process.env,
		NODE_OPTIONS: "--max-old-space-size=4096",
	};

	const args = ["./scripts/vitest-run.mjs", "run", "--config", "vitest.config.api.ts", ...batch, "--reporter=dot"];
	const proc = spawnSync(process.execPath, args, {
		cwd: root,
		env,
		encoding: "utf-8",
		stdio: "inherit",
	});

	if (proc.status === 0) {
		passed += batch.length;
		console.log(`\n  ✅ Batch ${batchNum} passed`);
	} else {
		failed += batch.length;
		failedFiles.push(...batch);
		console.log(`\n  ❌ Batch ${batchNum} had failures`);
	}
	console.log("");
}

console.log("═══════════════════════════════════════════════════════════");
console.log(`Total: ${total} files | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
	console.log("Failed files:");
	failedFiles.forEach((f) => console.log(`  - ${f}`));
	process.exit(1);
} else {
	console.log("All API test batches passed successfully! 🎉");
	process.exit(0);
}
