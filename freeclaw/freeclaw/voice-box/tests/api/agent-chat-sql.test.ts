// ═══════════════════════════════════════════════════════════════════
// Agent-chat SQL tools — execute_sql really queries (no dead rpc)
// ═══════════════════════════════════════════════════════════════════
// Locks the spec §9 data-investigation contract: execute_sql returns real
// rows through the built-in SELECT interpreter when the deployment never
// created the exec_sql RPC, and rejects non-SELECT / multi-statement /
// unknown-table / function queries with honest errors.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const ROWS = [
	{ id: "p1", title: "Broken projector", status: "open" },
	{ id: "p2", title: "Canteen food", status: "open" },
];

function mockClient(rows = ROWS) {
	const calls: Array<[string, unknown[]]> = [];
	const q: Record<string, unknown> = {};
	const handler: ProxyHandler<Record<string, unknown>> = {
		get(_t, p) {
			if (p === "then")
				return (res: (v: unknown) => unknown) =>
					Promise.resolve({ data: rows, error: null }).then(res);
			return (...a: unknown[]) => {
				calls.push([String(p), a]);
				return new Proxy(q, handler);
			};
		},
	};
	const proxy = new Proxy(q, handler);
	return { calls, client: { from: (t: string) => {
		calls.push(["from", [t]]);
		return proxy;
	} } };
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (...a: unknown[]) => (dbMock.from as (...x: unknown[]) => unknown)(...a),
		rpc: (...a: unknown[]) => (dbMock.rpc as (...x: unknown[]) => unknown)(...a),
	},
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));
vi.mock("../../api/_providers.js", () => ({
	callLLMChain: vi.fn(async () => null),
}));

const dbMock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

import { runSelectQuery } from "../../api/_agent-chat.js";
import handler from "../../api/_agent-chat.js";

describe("runSelectQuery interpreter", () => {
	it("runs SELECT cols FROM table with WHERE/ORDER/LIMIT", async () => {
		const { calls, client } = mockClient();
		const rows = await runSelectQuery(
			"SELECT id, title FROM posts WHERE status = 'open' ORDER BY created_at DESC LIMIT 5",
			client as never,
		);
		expect(rows).toEqual(ROWS);
		expect(calls).toContainEqual(["from", ["posts"]]);
		expect(calls).toContainEqual(["eq", ["status", "open"]]);
		expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
		expect(calls).toContainEqual(["limit", [5]]);
	});

	it("supports numbers, booleans and ILIKE", async () => {
		const { calls, client } = mockClient();
		await runSelectQuery(
			"SELECT * FROM polls WHERE votes > 10 AND closed = false AND title ILIKE '%water%'",
			client as never,
		);
		expect(calls).toContainEqual(["from", ["polls"]]);
		expect(calls).toContainEqual(["gt", ["votes", 10]]);
		expect(calls).toContainEqual(["eq", ["closed", false]]);
		expect(calls).toContainEqual(["ilike", ["title", "%water%"]]);
	});

	it("rejects non-SELECT, stacked, unknown-table and function queries", async () => {
		const { client } = mockClient();
		await expect(runSelectQuery("DELETE FROM posts", client as never)).rejects.toThrow(
			/Only SELECT/,
		);
		await expect(
			runSelectQuery("SELECT * FROM posts; DROP TABLE posts", client as never),
		).rejects.toThrow(/Multiple statements/);
		await expect(runSelectQuery("SELECT * FROM users", client as never)).rejects.toThrow(
			/Unknown table/,
		);
		await expect(
			runSelectQuery("SELECT count(*) FROM posts", client as never),
		).rejects.toThrow(/Functions/);
		await expect(
			runSelectQuery("SELECT * FROM posts WHERE a = 1 OR b = 2", client as never),
		).rejects.toThrow(/ANDed/);
		await expect(
			runSelectQuery("SELECT * FROM posts -- sneak", client as never),
		).rejects.toThrow(/Comments/);
	});

	it("clamps LIMIT to 100", async () => {
		const { calls, client } = mockClient();
		await runSelectQuery("SELECT * FROM posts LIMIT 5000", client as never);
		expect(calls).toContainEqual(["limit", [100]]);
	});
});

describe("execute_sql through the handler execute path", () => {
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

	function chain(data: unknown = ROWS) {
		const q: Record<string, unknown> = {};
		const h: ProxyHandler<Record<string, unknown>> = {
			get(_t, p) {
				if (p === "then")
					return (res: (v: unknown) => unknown) =>
						Promise.resolve({ data, error: null }).then(res);
				if (p === "maybeSingle" || p === "single")
					return async () => ({ data: null, error: null });
				if (p === "upsert" || p === "insert" || p === "update" || p === "delete")
					return async () => ({ data: null, error: null });
				return (..._a: unknown[]) => new Proxy(q, h);
			},
		};
		return new Proxy(q, h);
	}

	it("returns real rows when the rpc is missing (interpreter fallback)", async () => {
		dbMock.rpc.mockReturnValue({
			maybeSingle: async () => {
				throw { message: "function public.exec_sql does not exist" };
			},
		});
		dbMock.from.mockReturnValue(chain(ROWS));
		const res = response();
		await handler(
			{
				method: "POST",
				headers: {},
				body: {
					action: "execute",
					actions: [
						{ id: "a1", tool: "execute_sql", args: { query: "SELECT id FROM posts LIMIT 2" } },
					],
				},
				query: {},
				socket: {},
			} as never,
			res as never,
		);
	 expect(res.statusCode).toBe(200);
		const body = res.body as { results: Array<{ id: string; success: boolean; result?: unknown; error?: string }> };
		expect(body.results).toHaveLength(1);
		expect(body.results[0].id).toBe("a1");
		expect(body.results[0].success).toBe(true);
		expect(body.results[0].result).toEqual(ROWS);
	});

	it("reports destructive SQL as a failed result, not a crash", async () => {
		dbMock.rpc.mockReturnValue({ maybeSingle: async () => ({ data: null, error: null }) });
		const res = response();
		await handler(
			{
				method: "POST",
				headers: {},
				body: {
					action: "execute",
					actions: [{ id: "a2", tool: "execute_sql", args: { query: "DROP TABLE posts" } }],
				},
				query: {},
				socket: {},
			} as never,
			res as never,
		);
		const body = res.body as { results: Array<{ success: boolean; error?: string }> };
		expect(body.results[0].success).toBe(false);
		expect(body.results[0].error).toMatch(/Only SELECT/);
	});
});

describe("create_tool least-privilege gate (spec §6)", () => {
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

	function execAction(actions: unknown[]) {
		const res = response();
		return handler(
			{
				method: "POST",
				headers: {},
				body: { action: "execute", actions },
				query: {},
				socket: {},
			} as never,
			res as never,
		).then(() => res.body as { results: Array<{ success: boolean; error?: string; result?: unknown }> });
	}

	beforeEach(() => {
		// settings KV for the custom-tools registry; everything else empty rows
		const store = new Map<string, unknown>();
		dbMock.from.mockImplementation((table: string) => {
			if (table === "settings") {
				return {
					select: () => ({
						eq: (_c: string, key: string) => ({
							maybeSingle: async () => ({
								data: store.has(key) ? { value: store.get(key) } : null,
								error: null,
							}),
						}),
					}),
					insert: async (row: { key: string; value: unknown }) => {
						store.set(row.key, row.value);
						return { data: null, error: null };
					},
					update: async (row: { value: unknown }) => {
						store.set("custom_tools", (row as { value: unknown }).value);
						return { data: null, error: null };
					},
				};
			}
			return chain(ROWS);
		});
		dbMock.rpc.mockReturnValue({
			maybeSingle: async () => {
				throw { message: "function public.exec_sql does not exist" };
			},
		});
	});

	it("rejects a non-SELECT template at registration", async () => {
		const out = await execAction([
			{ id: "c1", tool: "create_tool", args: { name: "evil_tool", sql_template: "DROP TABLE posts" } },
		]);
		expect(out.results[0].success).toBe(false);
		expect(out.results[0].error).toMatch(/Only SELECT/);
	});

	it("rejects a name colliding with a built-in tool", async () => {
		const out = await execAction([
			{ id: "c2", tool: "create_tool", args: { name: "execute_sql", sql_template: "SELECT * FROM posts" } },
		]);
		expect(out.results[0].success).toBe(false);
		expect(out.results[0].error).toMatch(/built-in/);
	});

	it("rejects bad names", async () => {
		const out = await execAction([
			{ id: "c3", tool: "create_tool", args: { name: "x", sql_template: "SELECT * FROM posts" } },
		]);
		expect(out.results[0].success).toBe(false);
		expect(out.results[0].error).toMatch(/3-40 chars/);
	});

	it("neutralizes arg injection: values stay literals even when the rpc exists", async () => {
		// rpc present and willing — capture what it receives
		const seen = [];
		dbMock.rpc.mockImplementation((fn, params) => {
			seen.push(params?.sql);
			return { maybeSingle: async () => ({ data: [{ ok: 1 }], error: null }) };
		});
		const created = await execAction([
			{ id: "c4", tool: "create_tool", args: { name: "open_by_status", sql_template: "SELECT * FROM posts WHERE status = '${s}'" } },
		]);
		expect(created.results[0].success).toBe(true);
		const out = await execAction([
			{ id: "c5", tool: "open_by_status", args: { s: "x' OR '1'='1" } },
		]);
		expect(out.results[0].success).toBe(true);
		// the breakout attempt arrived as ONE escaped literal — the statement
		// structure is byte-identical to the safe template shape
		expect(seen[seen.length - 1]).toBe(
			"SELECT * FROM posts WHERE status = 'x'' OR ''1''=''1'",
		);
	});

	it("rejects stacked statements smuggled through args", async () => {
		dbMock.rpc.mockReturnValue({
			maybeSingle: async () => ({ data: [{ hacked: true }], error: null }),
		});
		await execAction([
			{ id: "c6", tool: "create_tool", args: { name: "by_status2", sql_template: "SELECT * FROM posts WHERE status = '${s}'" } },
		]);
		const rpcCalls = (dbMock.rpc as ReturnType<typeof vi.fn>).mock.calls.length;
		const out = await execAction([
			{ id: "c7", tool: "by_status2", args: { s: "x'; DROP TABLE posts" } },
		]);
		expect(out.results[0].success).toBe(false);
		expect(out.results[0].error).toMatch(/Custom tool.*SQL error/);
		// gate fired before the rpc was ever touched for the attack
		expect((dbMock.rpc as ReturnType<typeof vi.fn>).mock.calls.length).toBe(rpcCalls);
	});
});
