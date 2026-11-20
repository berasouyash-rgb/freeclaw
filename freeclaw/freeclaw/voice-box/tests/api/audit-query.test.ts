// Audit-log filter builder: sanitisation + query predicates.
// Locks the fix for two real defects: the Logs view's search box only
// filtered agent events (audit rows ignored it), and the paginated `total`
// counted the whole table regardless of filters.

import { describe, expect, it } from "vitest";

import {
	applyAuditFilters,
	parseAuditFilters,
	sanitizeAuditSearch,
} from "../../api/_audit-query.js";

function recordingBuilder() {
	const calls: Array<[string, ...unknown[]]> = [];
	const builder: Record<string, unknown> = {};
	const proxy = new Proxy(builder, {
		get(_target, prop) {
			if (typeof prop !== "string") return undefined;
			return (...args: unknown[]) => {
				calls.push([prop, ...args]);
				return proxy;
			};
		},
	});
	return { builder: proxy, calls };
}

describe("parseAuditFilters", () => {
	it("trims and caps actor/action", () => {
		const f = parseAuditFilters({
			actor: "  admin:alice  ",
			logAction: "update_user",
		});
		expect(f.actor).toBe("admin:alice");
		expect(f.action).toBe("update_user");
	});

	it("normalises valid dates and drops invalid ones", () => {
		const f = parseAuditFilters({
			since: "2026-01-01",
			until: "not-a-date",
		});
		expect(f.since).toBe(new Date("2026-01-01").toISOString());
		expect(f.until).toBeNull();
	});

	it("strips PostgREST syntax and pattern characters from search", () => {
		expect(sanitizeAuditSearch("foo,bar(baz)%_*\\\"")).toBe("foo bar baz");
	});
});

describe("applyAuditFilters", () => {
	it("applies actor, action and date predicates", () => {
		const { builder, calls } = recordingBuilder();
		const filters = parseAuditFilters({
			actor: "admin",
			logAction: "delete_post",
			since: "2026-01-01",
			until: "2026-02-01",
		});
		applyAuditFilters(builder, filters);
		expect(calls).toContainEqual(["eq", "actor", "admin"]);
		expect(calls).toContainEqual(["eq", "action", "delete_post"]);
		expect(calls).toContainEqual([
			"gte",
			"created_at",
			new Date("2026-01-01").toISOString(),
		]);
		expect(calls).toContainEqual([
			"lte",
			"created_at",
			new Date("2026-02-01").toISOString(),
		]);
	});

	it("builds an OR across actor/action/detail for search", () => {
		const { builder, calls } = recordingBuilder();
		applyAuditFilters(builder, parseAuditFilters({ q: "spam wave" }));
		expect(calls).toContainEqual([
			"or",
			"actor.ilike.%spam wave%,action.ilike.%spam wave%,detail.ilike.%spam wave%",
		]);
	});

	it("does nothing for an empty filter set", () => {
		const { builder, calls } = recordingBuilder();
		const out = applyAuditFilters(builder, parseAuditFilters({}));
		expect(out).toBe(builder);
		expect(calls).toEqual([]);
	});
});
