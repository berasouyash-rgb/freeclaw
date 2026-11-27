// ═══════════════════════════════════════════════════════════════════
// Admin Users presence ordering — most-recently-ACTIVE first (regression).
// The Users desk answers "who is using the platform NOW", but the endpoint
// ordered by created_at DESC: page 1 held the 30 most recently CREATED
// accounts (usually idle test residue), so live users sat hundreds of
// pages deep, the Now pill read 0, and no one could find their own id.
// The client already re-sorts by last_seen (proving the server order was
// useless to it) — the server must return most-recently-active first,
// cursor on the same column, nulls last.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAdmin = vi.fn();
const from = vi.fn();

vi.mock("../../api/_auth.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../../api/_auth.js")>();
	return { ...mod, cors: vi.fn(), isAdmin, auditLog: vi.fn() };
});

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

type Row = Record<string, unknown>;
const store = { users: [] as Array<Row> };

function chain(table: string) {
	const eqs: Array<[string, unknown]> = [];
	const orders: Array<{ col: string; opts: unknown }> = [];
	let limitN: number | null = null;
	let countHead = false;
	const self = {
		select(...args: unknown[]) {
			if (
				args.length > 1 &&
				typeof args[1] === "object" &&
				args[1] !== null &&
				"count" in (args[1] as Record<string, unknown>)
			)
				countHead = true;
			return self;
		},
		eq(col: string, val: unknown) {
			eqs.push([col, val]);
			return self;
		},
		ilike(col: string, pattern: unknown) {
			eqs.push([`ilike:${col}`, pattern]);
			return self;
		},
		lt(col: string, val: unknown) {
			eqs.push([`lt:${col}`, val]);
			return self;
		},
		in() {
			return self;
		},
		order(col: string, opts: unknown) {
			orders.push({ col, opts });
			return self;
		},
		limit(n: number) {
			limitN = n;
			return self;
		},
		async then(fn: (v: unknown) => void) {
			if (table !== "users_meta") {
				fn({ data: [], error: null, count: 0 });
				return;
			}
			let rows = [...store.users];
			for (const [col, val] of eqs) {
				if (col.startsWith("ilike:")) {
					const c = col.slice("ilike:".length);
					const needle = String(val).replace(/%/g, "").toLowerCase();
					rows = rows.filter((r) =>
						String(r[c] ?? "").toLowerCase().includes(needle),
					);
				} else if (col.startsWith("lt:")) {
					const c = col.slice("lt:".length);
					rows = rows.filter(
						(r) => r[c] !== null && r[c] !== undefined && String(r[c]) < String(val),
					);
				} else {
					rows = rows.filter((r) => r[col] === val);
				}
			}
			if (orders.length) {
				const { col, opts } = orders[orders.length - 1] as {
					col: string;
					opts: { ascending?: boolean; nullsFirst?: boolean };
				};
				const asc = opts?.ascending !== false;
				const nullsFirst = opts?.nullsFirst === true;
				rows.sort((a, b) => {
					const av = a[col] as string | null;
					const bv = b[col] as string | null;
					const aNull = av === null || av === undefined;
					const bNull = bv === null || bv === undefined;
					if (aNull && bNull) return 0;
					if (aNull) return nullsFirst ? -1 : 1;
					if (bNull) return nullsFirst ? 1 : -1;
					if (String(av) === String(bv)) return 0;
					const ahead = String(av) > String(bv);
					return asc !== ahead ? -1 : 1;
				});
			}
			if (countHead) {
				fn({ data: [], error: null, count: rows.length });
				return;
			}
			if (limitN !== null) rows = rows.slice(0, limitN);
			fn({ data: rows, error: null });
		},
	};
	return self;
}

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

const OLD_ACTIVE = {
	anon_id: "anon_oldactive1",
	created_at: "2026-07-01T10:00:00.000Z",
	last_seen: new Date().toISOString(),
	banned: false,
};
const NEW_IDLE = {
	anon_id: "anon_newidle1",
	created_at: new Date().toISOString(),
	last_seen: "2026-07-01T10:00:00.000Z",
	banned: false,
};
const NULL_SEEN = {
	anon_id: "anon_nullseen1",
	created_at: new Date(Date.now() - 3600_000).toISOString(),
	last_seen: null,
	banned: false,
};

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	isAdmin.mockResolvedValue(true);
	from.mockImplementation((t: string) => chain(t));
	store.users = [OLD_ACTIVE, NEW_IDLE, NULL_SEEN];
});

async function listUsers(body: Record<string, unknown> = {}) {
	const { default: handler } = await import("../../api/_admin.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body: { action: "users", paginate: true, limit: 30, ...body },
			headers: { "x-admin-token": "tok" },
		},
		res,
	);
	return res;
}

describe("POST /api/admin users — presence ordering", () => {
	it("returns most-recently-active first, not most-recently-created", async () => {
		const res = await listUsers();
		expect(res.statusCode).toBe(200);
		const ids = (res.body as { data: Array<{ anon_id: string }> }).data.map(
			(r) => r.anon_id,
		);
		expect(ids).toEqual(["anon_oldactive1", "anon_newidle1", "anon_nullseen1"]);
	});

	it("advances the cursor on last_seen, matching the order", async () => {
		const first = await listUsers({ limit: 2 });
		expect(first.statusCode).toBe(200);
		const page1 = (
			first.body as { data: Array<{ anon_id: string }>; nextCursor: string | null }
		);
		expect(page1.data.map((r) => r.anon_id)).toEqual([
			"anon_oldactive1",
			"anon_newidle1",
		]);
		// Cursor rides the order column: the next page continues where the
		// visible order left off (the last row's last_seen), not where
		// creation order would resume.
		expect(page1.nextCursor).toBe(NEW_IDLE.last_seen);
	});
});
