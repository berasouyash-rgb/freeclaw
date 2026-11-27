import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	"api/migrations/016_realtime_rls_reconciliation.sql",
	"utf8",
);

describe("016 anonymous Realtime/RLS contract", () => {
	it("publishes only the three anonymous-readable tables", () => {
		expect(migration).toContain("supabase_realtime");
		expect(migration).toContain("posts");
		expect(migration).toContain("comments");
		expect(migration).toContain("polls");
		expect(migration).toMatch(
			/ALTER PUBLICATION supabase_realtime\s+ADD TABLE[^;]+;/is,
		);
	});

	it("revokes client writes and grants only public SELECT", () => {
		expect(migration).toMatch(
			/REVOKE ALL ON(?:.|\n)*FROM anon, authenticated;/i,
		);
		expect(migration).toMatch(
			/GRANT SELECT ON(?:.|\n)*TO anon, authenticated;/i,
		);
		expect(migration).not.toMatch(
			/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)\s+ON[\s\S]*TO\s+(anon|authenticated)/i,
		);
	});

	it("contains row-level predicates that exclude private and pending content", () => {
		for (const policy of [
			"anon_select_public_posts",
			"anon_select_public_comments",
			"anon_select_public_polls",
		]) {
			expect(migration).toContain(policy);
		}
		expect(migration).toContain("deleted = false");
		expect(migration).toContain("hidden = false");
		expect(migration).toContain("pending_review");
		expect(migration).toContain("EXISTS");
	});
});
