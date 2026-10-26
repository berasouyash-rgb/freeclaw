#!/usr/bin/env node
// ─── Vitest launcher with a project-local temp root ─────────────
// Vitest's forks pool copies every transformed module to
//   join(os.tmpdir(), nanoid())/<environment>/<sha1(moduleId)>
// and the fork workers read those files back off disk. On this machine
// os.tmpdir() is D:\temp — a shared folder that system cleaners and other
// apps sweep. When it is wiped mid-run, module collection dies with
//   ENOENT: no such file or directory, open
//   'D:\temp\<runId>\client\<sha1>'
// and every remaining file is reported as failed even though all executed
// tests passed. That is an environment fault, not a code defect.
//
// Pinning the temp root inside node_modules keeps those files on the project
// volume: out of reach of temp sweeps, out of git, and ignored by the
// watcher. os.tmpdir() resolves TMPDIR/TMP/TEMP at call time, so setting them
// before Vitest boots is enough — no config or dependency changes required.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Derive the project root from this file (scripts/..) rather than cwd, so the
// launcher behaves identically when invoked from a subdirectory. cwd is left
// untouched because Vitest resolves its config and test globs from it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = process.env.VB_VITEST_TMPDIR
	? path.resolve(process.env.VB_VITEST_TMPDIR)
	: path.join(root, "node_modules", ".vitest-tmp");

fs.mkdirSync(tmpRoot, { recursive: true });

// Probe writability up front so a broken or read-only temp root fails loudly
// here, instead of surfacing as 90+ opaque ENOENT collection errors mid-run.
const probe = path.join(tmpRoot, `.probe-${process.pid}`);
try {
	fs.writeFileSync(probe, "ok");
	fs.rmSync(probe, { force: true });
} catch (err) {
	console.error(`[vitest-run] temp root is not writable: ${tmpRoot}`);
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
}

for (const key of ["TMPDIR", "TMP", "TEMP"]) process.env[key] = tmpRoot;

// Clear run directories left behind by killed runs so the pinned root cannot
// grow without bound. The age gate matters: a concurrent run (frontend suite +
// API suite, or a CI matrix) owns a live directory, and deleting it would
// recreate the very ENOENT this launcher exists to prevent. A run takes
// minutes, so anything untouched for hours is definitively dead.
const STALE_MS = 6 * 60 * 60 * 1000;
const cutoff = Date.now() - STALE_MS;
for (const entry of fs.readdirSync(tmpRoot, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const full = path.join(tmpRoot, entry.name);
	try {
		if (fs.statSync(full).mtimeMs < cutoff) {
			fs.rmSync(full, { recursive: true, force: true });
		}
	} catch {
		// Raced with another run's cleanup; harmless either way.
	}
}

const cli = pathToFileURL(path.join(root, "node_modules", "vitest", "dist", "cli.js")).href;
await import(cli);
