// ════════════════════════════════════════════════════════════════════
// searchKnowledgeBase must escape its query before interpolating it
// into a PostgREST `.or()` filter.
//
// Why this matters: `.or()` takes a raw filter string, so anything the
// user types is parsed as filter SYNTAX, not as a search term. A `,`
// ends the current condition and starts a new one — a user searching
// for "a,deleted.eq.false" would otherwise be able to append filter
// conditions of their own choosing to the query.
//
// This is currently a LATENT defect: nothing in api/ imports
// `_agent-verification.js`, so `verifyAnswer` → `searchKnowledgeBase`
// is not yet reachable from a request. It is fixed and pinned now so
// that wiring the module up later cannot silently reintroduce it.
// ════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ or: [] as string[] }));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (_table: string) => {
			const builder: Record<string, unknown> = {};
			builder.select = () => builder;
			builder.eq = () => builder;
			builder.or = (s: string) => {
				db.or.push(s);
				return builder;
			};
			builder.order = () => builder;
			builder.limit = () => builder;
			builder.ilike = () => builder;
			// Not awaited directly — the module also uses it as a
			// per-column filter on the fallback path.
			builder.textSearch = () => builder;
			// The builder is awaited as a promise by the caller.
			builder.then = (resolve: (v: unknown) => void) =>
				resolve({ data: [], error: null });
			return builder;
		},
	},
}));

const { searchKnowledgeBase } = await import("../../api/_agent-verification.js");

describe("searchKnowledgeBase query escaping", () => {
	it("does not let a comma in the query append a new filter condition", async () => {
		db.or = [];
		await searchKnowledgeBase("canteen,deleted.eq.false");

		expect(db.or).toHaveLength(1);
		const filter = db.or[0];
		// The comma must be escaped, so it stays part of the search term.
		expect(filter).toContain("\\,");
		// Splitting on UNESCAPED commas is exactly how PostgREST parses this
		// string. If the attacker's condition had become its own clause, there
		// would be a third clause here — and one that is not an ilike().
		const clauses = filter.split(/(?<!\\),/);
		expect(clauses).toHaveLength(2);
		for (const clause of clauses) {
			expect(clause).toMatch(/^(title|content)\.ilike\./);
		}
	});

	it("does not let parentheses break out of the ilike() call", async () => {
		db.or = [];
		await searchKnowledgeBase("x) OR (1=1");

		expect(db.or[0]).toContain("\\)");
		expect(db.or[0]).toContain("\\(");
	});

	it("escapes LIKE wildcards so a literal % searches for a literal %", async () => {
		db.or = [];
		await searchKnowledgeBase("100%");

		// Unescaped, "%" is a LIKE wildcard and would match every row.
		expect(db.or[0]).toContain("100\\%");
	});

	it("escapes underscores, which are single-character LIKE wildcards", async () => {
		db.or = [];
		await searchKnowledgeBase("room_a");

		expect(db.or[0]).toContain("room\\_a");
	});

	it("leaves an ordinary search term untouched", async () => {
		db.or = [];
		await searchKnowledgeBase("broken fan");

		expect(db.or[0]).toBe("title.ilike.%broken fan%,content.ilike.%broken fan%");
	});

	it("renders a null/undefined query as empty rather than the string 'null'", async () => {
		db.or = [];
		await searchKnowledgeBase(null);

		expect(db.or[0]).not.toContain("null");
	});
});