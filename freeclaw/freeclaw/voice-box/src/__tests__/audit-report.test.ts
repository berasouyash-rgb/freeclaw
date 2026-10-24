// ═══════════════════════════════════════════════════════════════════
// Audit report persistence — must never fail or corrupt on a bad disk
// ═══════════════════════════════════════════════════════════════════
// REGRESSION GUARD: the audit wrote its report with a bare `writeFileSync`,
// which truncates the target *before* writing. When the disk filled up
// (ENOSPC) that left a 0-byte, unparseable report — every finding silently
// discarded — and the throw failed the sweep on top of it.
//
// These tests pin the two properties that prevent a repeat:
//   1. the write fails soft (returns null, never throws);
//   2. a failed write leaves the previous report completely intact.
// ═══════════════════════════════════════════════════════════════════

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistReport } from "../../tests/e2e/audit-report";

const dirs: string[] = [];

/** A scratch directory that is always cleaned up. */
function scratch(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "vb-audit-"));
	dirs.push(dir);
	return dir;
}

/** A path whose parent is a *file*, so it can never be written. */
function unwritableUnder(container: string, name = "nested/report.json"): string {
	const blocker = path.join(container, "blocker");
	writeFileSync(blocker, "not a directory");
	return path.join(blocker, name);
}

afterEach(() => {
	while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("persistReport", () => {
	it("writes the payload to the first writable target and cleans up its temp file", () => {
		const dir = scratch();
		const target = path.join(dir, ".audit-report.json");

		const result = persistReport('{"findings":[]}', [target]);

		expect(result.path).toBe(target);
		expect(result.errors).toEqual([]);
		expect(readFileSync(target, "utf8")).toBe('{"findings":[]}');
		// No stray `<target>.<pid>.tmp` left behind after the rename.
		expect(readdirSync(dir)).toEqual([".audit-report.json"]);
	});

	it("falls back to the next target when the primary path is unwritable", () => {
		const dir = scratch();
		const bad = unwritableUnder(dir);
		const good = path.join(dir, "fallback", ".audit-report.json");

		const result = persistReport("payload", [bad, good]);

		expect(result.path).toBe(good);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("blocker");
		expect(readFileSync(good, "utf8")).toBe("payload");
	});

	it("returns null instead of throwing when no target is writable", () => {
		const dir = scratch();
		const bad = unwritableUnder(dir);

		// The whole point: a report artifact must not fail the caller.
		expect(() => persistReport("payload", [bad])).not.toThrow();
		const result = persistReport("payload", [bad]);
		expect(result.path).toBeNull();
		expect(result.errors).toHaveLength(1);
	});

	it("leaves the previous report untouched when the atomic swap fails", () => {
		const dir = scratch();
		// A non-empty directory where a file is expected: the temp write succeeds
		// but the rename cannot, which is exactly the "disk/FS rejected the swap"
		// case the atomic write exists to survive.
		const target = path.join(dir, ".audit-report.json");
		mkdirSync(target);
		writeFileSync(path.join(target, "previous.json"), "ORIGINAL");

		const result = persistReport("NEW REPORT", [target]);

		expect(result.path).toBeNull();
		expect(statSync(target).isDirectory()).toBe(true);
		expect(readFileSync(path.join(target, "previous.json"), "utf8")).toBe(
			"ORIGINAL",
		);
		// The failed swap must not litter the directory with a temp file.
		expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
	});
});
