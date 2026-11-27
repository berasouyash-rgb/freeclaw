// Admin feed page-size config — get/set behind the isAdmin gate.
// Contract (mirrors AdminSettings.tsx + api/_admin.js):
//   • get_feed_config returns { page_size: 30 } when unset (today's default)
//   • set_feed_config persists integers 5–100, rejects 0/4/101/garbage/bool
//   • string numbers ("50") are accepted and normalized
//   • every set is audited; anonymous callers get 403
import { beforeEach, describe, expect, it, vi } from "vitest";

const isAdmin = vi.fn();
const from = vi.fn();
const auditLog = vi.fn();

vi.mock("../../api/_auth.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../../api/_auth.js")>();
	return { ...mod, cors: vi.fn(), isAdmin, auditLog };
});

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

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

// settings store: key → { value }
const settings = new Map<string, { value: unknown }>();

function chain(table: string) {
	let single = false;
	const q = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		maybeSingle() {
			single = true;
			return this;
		},
		then(onResolve: (v: unknown) => void) {
			if (table !== "settings") return onResolve({ data: [], error: null });
			const key = q.eq.mock.calls.find(([c]) => c === "key")?.[1];
			const row = key !== undefined ? settings.get(String(key)) : undefined;
			if (single) return onResolve({ data: row ?? null, error: null });
			return onResolve({ data: row ? [row] : [], error: null });
		},
		update: vi.fn().mockImplementation(function (patch: unknown) {
			const key = q.eq.mock.calls.find(([c]) => c === "key")?.[1];
			if (key !== undefined) {
				const prev = settings.get(String(key));
				settings.set(String(key), {
					key: String(key),
					value: (patch as { value?: unknown }).value ?? prev?.value,
				});
			}
			return this;
		}),
		insert: vi.fn().mockImplementation(function (row: unknown) {
			const r = row as { key: string; value?: unknown };
			if (r?.key) settings.set(r.key, { key: r.key, value: r.value });
			return this;
		}),
	};
	return q;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	settings.clear();
	isAdmin.mockResolvedValue(true);
	from.mockImplementation((t: string) => chain(t));
});

async function post(action: string, extra: Record<string, unknown> = {}) {
	const { default: handler } = await import("../../api/_admin.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			body: { action, ...extra },
			headers: { "x-admin-token": "tok" },
		},
		res,
	);
	return res;
}

describe("POST /api/admin feed page size", () => {
	it("returns the 30 default when unset", async () => {
		const res = await post("get_feed_config");
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ page_size: 30 });
	});

	it("round-trips a set value through get", async () => {
		const set = await post("set_feed_config", { page_size: 50 });
		expect(set.statusCode).toBe(200);
		expect(set.body).toEqual({ page_size: 50 });
		const get = await post("get_feed_config");
		expect(get.body).toEqual({ page_size: 50 });
		expect(auditLog).toHaveBeenCalledWith("admin", "feed_config", "page_size=50");
	});

	it("accepts string numbers and boundary values", async () => {
		expect((await post("set_feed_config", { page_size: "5" })).body).toEqual({
			page_size: 5,
		});
		expect((await post("set_feed_config", { page_size: 100 })).body).toEqual({
			page_size: 100,
		});
	});

	it("rejects out-of-range and garbage values without writing", async () => {
		for (const v of [0, 4, 101, -10, 2.5, "many", true, null, {}, []]) {
			const res = await post("set_feed_config", { page_size: v });
			expect(res.statusCode, JSON.stringify(v)).toBe(400);
		}
		expect(settings.has("feed_config")).toBe(false);
		const get = await post("get_feed_config");
		expect(get.body).toEqual({ page_size: 30 });
	});

	it("403s anonymous callers on both actions", async () => {
		isAdmin.mockResolvedValue(false);
		expect((await post("get_feed_config")).statusCode).toBe(403);
		expect((await post("set_feed_config", { page_size: 50 })).statusCode).toBe(403);
	});
});
