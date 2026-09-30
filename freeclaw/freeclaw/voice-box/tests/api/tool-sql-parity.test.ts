// ═══════════════════════════════════════════════════════════════════
// Tool SQL parity — registry + forge share the least-privilege gate
// ═══════════════════════════════════════════════════════════════════
// Locks spec §6 across ALL SQL paths (not just _agent-chat.js):
//   - execute_sql in the central registry runs real rows via the built-in
//     SELECT interpreter when exec_sql RPC is missing (never a dead tool)
//   - forge_tool registration rejects non-SELECT templates
//   - forged-tool execution escapes args, gates substituted text, falls back
//   - substituteTemplate is regex-key safe (split/join, never RegExp)
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const ROWS = [
	{ id: "p1", title: "Broken projector", status: "open" },
	{ id: "p2", title: "Canteen food", status: "open" },
];

const dbMock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

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
	maskProfanity: (s: unknown) => String(s ?? ""),
	checkUser: vi.fn(async () => ({ ok: true })),
	rateLimited: vi.fn(async () => false),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));
vi.mock("../../api/_providers.js", () => ({
	callLLMChain: vi.fn(async () => null),
	callNvidiaFast: vi.fn(async () => null),
}));

function chain(data: unknown = ROWS) {
	const q: Record<string, unknown> = {};
	const h: ProxyHandler<Record<string, unknown>> = {
		get(_t, p) {
			if (p === "then")
				return (res: (v: unknown) => unknown) =>
					Promise.resolve({ data, error: null }).then(res);
			if (p === "maybeSingle" || p === "single")
				return async () => ({ data, error: null });
			if (p === "upsert" || p === "insert" || p === "update" || p === "delete")
				return async () => ({ data: null, error: null });
			return (..._a: unknown[]) => new Proxy(q, h);
		},
	};
	return new Proxy(q, h);
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

import { executeTool } from "../../api/_agent-tool-registry.js";
import { substituteTemplate } from "../../api/_tool-forge.js";
import forgeHandler from "../../api/_tool-forge.js";

describe("substituteTemplate", () => {
	it("escapes single quotes so values stay literals", () => {
		const out = substituteTemplate("SELECT * FROM posts WHERE status = '${s}'", {
			s: "x' OR '1'='1",
		});
		expect(out).toBe("SELECT * FROM posts WHERE status = 'x'' OR ''1''=''1'");
	});

	it("is regex-key safe: a key like .* does not act as a pattern", () => {
		const out = substituteTemplate("SELECT * FROM posts WHERE a = :x", {
			".*": "INJECTED",
			x: "open",
		});
		expect(out).toBe("SELECT * FROM posts WHERE a = open");
		expect(out).not.toContain("INJECTED");
	});

	it("supports the :key form without adding quotes", () => {
		const out = substituteTemplate("SELECT * FROM posts WHERE status = :s", {
			s: "o'clock",
		});
		expect(out).toBe("SELECT * FROM posts WHERE status = o''clock");
	});
});

describe("registry execute_sql parity", () => {
	beforeEach(() => {
		dbMock.rpc.mockReturnValue({
			maybeSingle: async () => {
				throw { message: "function public.exec_sql does not exist" };
			},
		});
		dbMock.from.mockReturnValue(chain(ROWS));
	});

	it("returns real rows when the rpc is missing (interpreter fallback)", async () => {
		const out = await executeTool(
			"execute_sql",
			{ query: "SELECT id FROM posts LIMIT 2" },
			{ role: "admin" },
		);
		expect(out.outputs?.rows ?? out.rows).toEqual(ROWS);
	});

	it("rejects non-SELECT with an honest error (never a crash)", async () => {
		const out = await executeTool(
			"execute_sql",
			{ query: "DROP TABLE posts" },
			{ role: "admin" },
		);
		const err = out.errors?.[0] ?? out.error;
		expect(String(err)).toMatch(/Only SELECT/);
	});

	it("rejects stacked statements smuggled through the query", async () => {
		const out = await executeTool(
			"execute_sql",
			{ query: "SELECT * FROM posts; DROP TABLE posts" },
			{ role: "admin" },
		);
		const err = out.errors?.[0] ?? out.error;
		expect(String(err)).toMatch(/Multiple statements/);
	});
});

describe("registry forge_tool gate", () => {
	beforeEach(() => {
		dbMock.rpc.mockReturnValue({
			maybeSingle: async () => {
				throw { message: "function public.exec_sql does not exist" };
			},
		});
		dbMock.from.mockReturnValue(chain(ROWS));
	});

	it("rejects a non-SELECT template at registration", async () => {
		const out = await executeTool(
			"forge_tool",
			{ name: "evil", description: "x", sql_template: "DROP TABLE posts" },
			{ role: "admin" },
		);
		const err = out.errors?.[0] ?? out.error;
		expect(String(err)).toMatch(/Only SELECT/);
	});
});

describe("forge handler save/execute parity", () => {
	const store = new Map<string, unknown>();
	beforeEach(() => {
		store.clear();
		dbMock.rpc.mockReturnValue({
			maybeSingle: async () => {
				throw { message: "function public.exec_sql does not exist" };
			},
		});
		dbMock.from.mockImplementation((table: string) => {
			if (table === "settings") {
				return {
					select: () => ({
						eq: (_c: string, key: string) => ({
							maybeSingle: async () => ({
								data: store.has(key) ? { value: store.get(key) } : null,
								error: null,
							}),
							single: async () => ({
								data: store.has(key) ? { value: store.get(key) } : null,
								error: store.has(key) ? null : { message: "missing" },
							}),
						}),
					}),
					upsert: async (row: { key: string; value: unknown }) => {
						store.set(row.key, row.value);
						return { data: null, error: null };
					},
					insert: async (row: { key: string; value: unknown }) => {
						store.set(row.key, row.value);
						return { data: null, error: null };
					},
					update: async (_row: { value: unknown }) => ({
						data: null,
						error: null,
					}),
					delete: async () => ({ data: null, error: null }),
				};
			}
			return chain(ROWS);
		});
	});

	it("save rejects a non-SELECT template with 400", async () => {
		const res = response();
		await forgeHandler(
			{
				method: "POST",
				headers: {},
				body: {
					action: "save",
					tool: { name: "evil_tool", description: "x", sql_template: "DELETE FROM posts" },
				},
				query: {},
			} as never,
			res as never,
		);
		expect(res.statusCode).toBe(400);
		expect(String((res.body as { error: string }).error)).toMatch(/Only SELECT/);
	});

	it("execute neutralizes arg breakout and runs real rows", async () => {
		const saveRes = response();
		await forgeHandler(
			{
				method: "POST",
				headers: {},
				body: {
					action: "save",
					tool: {
						name: "open_by_status",
						description: "open posts",
						sql_template: "SELECT * FROM posts WHERE status = '${s}'",
					},
				},
				query: {},
			} as never,
			saveRes as never,
		);
		expect(saveRes.statusCode).toBe(200);
		const execRes = response();
		await forgeHandler(
			{
				method: "POST",
				headers: {},
				body: { action: "execute", name: "open_by_status", params: { s: "x' OR '1'='1" } },
				query: {},
			} as never,
			execRes as never,
		);
		expect(execRes.statusCode).toBe(200);
		const body = execRes.body as { ok: boolean; result?: unknown; error?: string };
		expect(body.ok).toBe(true);
		expect(body.result).toEqual(ROWS);
	});

	it("execute rejects stacked statements smuggled through args", async () => {
		const saveRes = response();
		await forgeHandler(
			{
				method: "POST",
				headers: {},
				body: {
					action: "save",
					tool: {
						name: "by_status2",
						description: "x",
						sql_template: "SELECT * FROM posts WHERE status = '${s}'",
					},
				},
				query: {},
			} as never,
			saveRes as never,
		);
		expect(saveRes.statusCode).toBe(200);
		const execRes = response();
		await forgeHandler(
			{
				method: "POST",
				headers: {},
				body: { action: "execute", name: "by_status2", params: { s: "x'; DROP TABLE posts" } },
				query: {},
			} as never,
			execRes as never,
		);
		const body = execRes.body as { ok: boolean; error?: string };
		expect(body.ok).toBe(false);
		expect(String(body.error)).toMatch(/Multiple statements|SQL error|Only SELECT/);
	});
});
