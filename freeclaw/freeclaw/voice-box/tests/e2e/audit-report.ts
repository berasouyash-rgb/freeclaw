// ═══════════════════════════════════════════════════════════════════
// Audit report persistence
// ═══════════════════════════════════════════════════════════════════
// The mechanical audit asserts nothing — its whole value is the report it
// leaves behind. Two properties therefore matter:
//
//   1. A report write must never fail the sweep. The audit records *product*
//      defects; a full disk is not one of them, and turning a green sweep red
//      hides the findings instead of surfacing them.
//
//   2. A failed write must never destroy the previous report. `writeFileSync`
//      truncates the target *first*, so an ENOSPC run left a 0-byte file,
//      silently discarding every finding gathered. Writing to a sibling file
//      and renaming swaps it atomically: the path only ever holds the complete
//      old report or the complete new one.
//
// A fallback target is tried when the primary path is unwritable, so the run
// still produces usable output on a full or read-only working directory.
// ═══════════════════════════════════════════════════════════════════

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** ESM: no __dirname. The report always lands beside the spec directory. */
export const REPORT_PATH = path.join(
	process.cwd(),
	"tests",
	"e2e",
	".audit-report.json",
);

export type PersistResult = {
	/** Where the report actually landed, or null if nowhere could be written. */
	path: string | null;
	/** One message per target that failed, for logging. */
	errors: string[];
};

/**
 * Write `payload` to the first writable target, atomically.
 * Never throws: a report artifact must not fail the caller.
 */
export function persistReport(
	payload: string,
	targets: string[] = [REPORT_PATH, path.join(tmpdir(), ".audit-report.json")],
): PersistResult {
	const errors: string[] = [];

	for (const target of targets) {
		// Including the pid keeps concurrent runners from clobbering each other.
		const tmp = `${target}.${process.pid}.tmp`;
		try {
			mkdirSync(path.dirname(target), { recursive: true });
			writeFileSync(tmp, payload);
			renameSync(tmp, target);
			return { path: target, errors };
		} catch (err) {
			errors.push(`${target}: ${(err as Error).message}`);
			try {
				rmSync(tmp, { force: true });
			} catch {
				/* best effort — a stray temp file must not mask the real error */
			}
		}
	}

	return { path: null, errors };
}
