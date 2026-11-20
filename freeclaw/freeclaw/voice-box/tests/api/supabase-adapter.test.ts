// Supabase adapter tests: query construction, versioned writes, error mapping.
// Uses a chainable fake client — no network, no credentials.

import { describe, expect, it } from "vitest";

import { SupabaseAdapter } from "../../api/_backend/adapters/supabase-adapter.js";
import { StaleWriteError } from "../../api/_backend/errors.js";

class FakeQuery {
	constructor(result) {
		this.result = result;
		this.calls = [];
	}
	_record(method, args) {
		this.calls.push([method, ...args]);
		return this;
	}
	select(...args) {
		return this._record("select", args);
	}
	eq(...args) {
		return this._record("eq", args);
	}
	gt(...args) {
		return this._record("gt", args);
	}
	order(...args) {
		return this._record("order", args);
	}
	limit(...args) {
		return this._record("limit", args);
	}
	insert(...args) {
		return this._record("insert", args);
	}
	update(...args) {
		return this._record("update", args);
	}
	upsert(...args) {
		return this._record("upsert", args);
	}
	delete(...args) {
		return this._record("delete", args);
	}
	single() {
		return Promise.resolve(this.result);
	}
	maybeSingle() {
		return Promise.resolve(this.result);
	}
	then(resolve, reject) {
		return Promise.resolve(this.result).then(resolve, reject);
	}
}

function clientReturning(...results) {
	const queries = [];
	const client = {
		from(table) {
			const q = new FakeQuery(results.shift() || { data: [], error: null });
			q.table = table;
			queries.push(q);
			return q;
		},
	};
	return { client, queries };
}

describe("SupabaseAdapter", () => {
	it("builds a filtered select", async () => {
		const { client, queries } = clientReturning({
			data: [{ id: "p1" }, { id: "p2" }],
			error: null,
		});
		const adapter = new SupabaseAdapter(client);
		const rows = await adapter.select("posts", {
			where: { author_id: "a1" },
			since: { column: "updated_at", value: "2026-01-01" },
			orderBy: "created_at",
			ascending: false,
			limit: 5,
		});
		expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
		expect(queries[0].calls).toContainEqual(["eq", "author_id", "a1"]);
		expect(queries[0].calls).toContainEqual(["gt", "updated_at", "2026-01-01"]);
		expect(queries[0].calls).toContainEqual(["order", "created_at", { ascending: false }]);
		expect(queries[0].calls).toContainEqual(["limit", 5]);
	});

	it("maps a duplicate insert to a non-retryable DUPLICATE error", async () => {
		const { client } = clientReturning({
			data: null,
			error: { code: "23505", message: "duplicate key" },
		});
		const adapter = new SupabaseAdapter(client);
		await expect(adapter.insert("posts", { id: "p1" })).rejects.toMatchObject({
			code: "DUPLICATE",
			retryable: false,
		});
	});

	it("treats zero updated rows as a stale write", async () => {
		const { client, queries } = clientReturning({ data: [], error: null });
		const adapter = new SupabaseAdapter(client);
		await expect(
			adapter.update("posts", "p1", { title: "x" }, { expectedVersion: 3 }),
		).rejects.toBeInstanceOf(StaleWriteError);
		expect(queries[0].calls).toContainEqual(["eq", "version", 3]);
	});

	it("returns the updated row", async () => {
		const { client } = clientReturning({ data: [{ id: "p1", title: "y" }], error: null });
		const adapter = new SupabaseAdapter(client);
		const row = await adapter.update("posts", "p1", { title: "y" });
		expect(row.title).toBe("y");
	});

	it("maps 5xx to a retryable backend error", async () => {
		const { client } = clientReturning({
			data: null,
			error: { status: 503, message: "service unavailable" },
		});
		const adapter = new SupabaseAdapter(client);
		await expect(adapter.select("posts")).rejects.toMatchObject({
			retryable: true,
			code: "SUPABASE_UNAVAILABLE",
		});
	});

	it("reports health from a lightweight probe", async () => {
		const { client } = clientReturning({ data: [], error: null });
		const adapter = new SupabaseAdapter(client);
		const health = await adapter.health();
		expect(health.ok).toBe(true);
		expect(typeof health.latencyMs).toBe("number");
	});

	it("rejects tables outside the replication scope", async () => {
		const { client } = clientReturning();
		const adapter = new SupabaseAdapter(client);
		await expect(adapter.select("cricket_stats")).rejects.toThrow(/outside the VoiceFlow scope/);
	});
});
