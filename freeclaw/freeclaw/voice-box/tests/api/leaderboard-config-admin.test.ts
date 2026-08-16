// ═══════════════════════════════════════════════════════════════════
// Admin leaderboard-config actions — get/set the public board's
// customization (enabled / hide_empty / page_size / pinned_ids).
// ═══════════════════════════════════════════════════════════════════
// Contract:
//   • both actions sit behind the isAdmin gate (403 for anonymous users)
//   • get returns the stored config (or {} when unset)
//   • set validates + clamps every field, persists it, and returns it
//   • the saved value is exactly what the public /api/leaderboard reads
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const isAdmin = vi.fn();
const from = vi.fn();
const auditLog = vi.fn();

vi.mock("../../api/_auth.js", () => ({ cors: vi.fn(), isAdmin }));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

// _admin.js imports `auditLog` from ./_auth.js — re-export the mock under
// both names so the import resolves to the same function.
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
			// find by the eq("key", …) value — the mock records the last eq col
			const key = q.eq.mock.calls.find(([c]) => c === "key")?.[1];
			const row = key !== undefined ? settings.get(String(key)) : undefined;
			if (single) return onResolve({ data: row ?? null, error: null });
			return onResolve({ data: row ? [row] : [], error: null });
		},
		update: vi.fn().mockImplementation(function (patch: unknown) {
			// this = the chain; find the key from the recorded eq call
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
	isAdmin.mockResolvedValue(false);
	from.mockImplementation((t: string) => chain(t));
});

async function post(action: string, config?: unknown) {
	const { default: handler } = await import("../../api/_admin.js");
	const res = response();
	await handler(
		{ method: "POST", query: {}, body: { action, ...(config !== undefined ? { config } : {}) }, headers: { "x-admin-token": "tok" } },
		res,
	);
	return res;
}

describe("POST /api/admin leaderboard_config — authorization", () => {
	it("rejects non-admin users with 403 (both actions)", async () => {
		let res = await post("get_leaderboard_config");
		expect(res.statusCode).toBe(403);
		res = await post("set_leaderboard_config", { enabled: false });
		expect(res.statusCode).toBe(403);
	});
});

describe("POST /api/admin leaderboard_config — admin get/set", () => {
	beforeEach(() => {
		isAdmin.mockResolvedValue(true);
	});

	it("returns an empty object when no config is stored", async () => {
		const res = await post("get_leaderboard_config");
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({});
	});

	it("returns the stored config verbatim", async () => {
		settings.set("leaderboard_config", {
			value: { enabled: true, hide_empty: true, page_size: 18, pinned_ids: ["a", "b"] },
		});
		const res = await post("get_leaderboard_config");
		expect(res.body).toEqual({
			enabled: true,
			hide_empty: true,
			page_size: 18,
			pinned_ids: ["a", "b"],
		});
	});

	it("persists a valid config and returns it", async () => {
		const res = await post("set_leaderboard_config", {
			enabled: false,
			hide_empty: true,
			page_size: 30,
			pinned_ids: ["post_1", "post_2"],
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({
			enabled: false,
			hide_empty: true,
			page_size: 30,
			pinned_ids: ["post_1", "post_2"],
		});
		expect(settings.get("leaderboard_config")?.value).toEqual(res.body);
	});

	it("clamps page_size to [5, 100]", async () => {
		let res = await post("set_leaderboard_config", { page_size: 1 });
		expect(res.body.page_size).toBe(5);
		res = await post("set_leaderboard_config", { page_size: 9999 });
		expect(res.body.page_size).toBe(100);
	});

	it("defaults missing fields safely", async () => {
		const res = await post("set_leaderboard_config", {});
		expect(res.body).toEqual({
			enabled: true,
			hide_empty: false,
			page_size: 25,
			pinned_ids: [],
		});
	});

	it("caps pinned_ids at 10 and drops invalid entries", async () => {
		const ids = Array.from({ length: 15 }, (_, i) => `p_${i}`);
		const res = await post("set_leaderboard_config", { pinned_ids: ids });
		expect(res.body.pinned_ids.length).toBe(10);
		expect(res.body.pinned_ids[0]).toBe("p_0");
	});

	it("rejects a non-object config with 400", async () => {
		const res = await post("set_leaderboard_config", "nope");
		expect(res.statusCode).toBe(400);
	});

	it("rejects an array config with 400", async () => {
		const res = await post("set_leaderboard_config", [1, 2]);
		expect(res.statusCode).toBe(400);
	});

	it("audit-logs the saved config", async () => {
		await post("set_leaderboard_config", { enabled: false });
		expect(auditLog).toHaveBeenCalledWith(
			"admin",
			"leaderboard_config",
			expect.any(String),
		);
	});

	it("the saved value is exactly what the public leaderboard reads", async () => {
		await post("set_leaderboard_config", {
			enabled: true,
			hide_empty: true,
			page_size: 12,
			pinned_ids: ["pin_me"],
		});
		const { data: row } = await from("settings").select("value").eq("key", "leaderboard_config").maybeSingle().then((v: unknown) => v as { data: { value: unknown } | null });
		expect(row?.value).toEqual({
			enabled: true,
			hide_empty: true,
			page_size: 12,
			pinned_ids: ["pin_me"],
		});
	});
});
