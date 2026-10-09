import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Migration 022 merges duplicate poll rows (same post/question/options) with
// votes split between them. It is DBA-gated (never auto-applied): these
// contracts pin its safety properties so a future edit cannot silently turn
// a conservative merge into data loss.
const migration = readFileSync(
	"api/migrations/022_merge_duplicate_polls.sql",
	"utf8",
);

describe("022 duplicate-poll merge contract", () => {
	it("is marked DBA-gated and requires migration 009 first", () => {
		expect(migration).toMatch(/do NOT apply without DBA approval/i);
		expect(migration).toContain("poll_votes_poll_author_uidx");
		expect(migration).toMatch(
			/RAISE EXCEPTION[^;]*apply 009 first/is,
		);
	});

	it("soft-deletes losers and never hard-deletes polls", () => {
		expect(migration).toContain("SET deleted = true");
		expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.polls/i);
	});

	it("never reassigns ballot authorship", () => {
		expect(migration).not.toMatch(/SET\s+author_id/i);
	});

	it("keeps latest voter intent with a deterministic tie-break", () => {
		expect(migration).toMatch(/created_at DESC NULLS LAST/i);
		expect(migration).toMatch(/COUNT\(v\.id\) DESC/i);
	});

	it("only ever touches live rows (idempotent re-runs change nothing)", () => {
		expect(migration).toContain("deleted = false");
	});

	it("guards the liveness touch on the 021 column instead of assuming it", () => {
		expect(migration).toContain("updated_at");
		expect(migration).toContain("information_schema");
	});

	it("fails closed when duplicates remain afterwards", () => {
		expect(migration).toMatch(
			/RAISE EXCEPTION[^;]*duplicate poll groups remain/is,
		);
	});
});
