// ═══════════════════════════════════════════════════════════════════
// Admin platform-settings actions — agent-actions kill switch +
// spam sensitivity config (get/set behind the isAdmin gate).
// ═══════════════════════════════════AdminSettings.tsx contract:
//   • both action pairs sit behind the isAdmin gate (403 for anonymous)
//   • get_agent_actions returns { enabled: true } when unset (fail-open,
//     matching agentActionsEnabled() in _agent-actions.js)
//   • set_agent_actions rejects non-boolean `enabled` with 400
//   • get/set_spam_config normalize through normalizeSpamConfig (clamped,
//     ordered), and the saved value is exactly what /api/posts reads
// ═══════════════════════════════════════════════════════════════════

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
	isAdmin.mockResolvedValue(false);
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

describe("POST /api/admin platform settings — authorization", () => {
	it("rejects non-admin users with 403 (all eight actions)", async () => {
		let res = await post("get_agent_actions");
		expect(res.statusCode).toBe(403);
		res = await post("set_agent_actions", { enabled: false });
		expect(res.statusCode).toBe(403);
		res = await post("get_spam_config");
		expect(res.statusCode).toBe(403);
		res = await post("set_spam_config", { config: { flag: 50 } });
		expect(res.statusCode).toBe(403);
		res = await post("get_retention_config");
		expect(res.statusCode).toBe(403);
		res = await post("set_retention_config", { user_delete_hours: 5 });
		expect(res.statusCode).toBe(403);
		res = await post("get_cleanup_stats");
		expect(res.statusCode).toBe(403);
	});
});

describe("POST /api/admin agent actions kill switch", () => {
	beforeEach(() => {
		isAdmin.mockResolvedValue(true);
	});

	it("returns enabled=true when the settings key is unset (fail-open default)", async () => {
		const res = await post("get_agent_actions");
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ enabled: true });
	});

	it("persists { enabled: false } and reads it back", async () => {
		const set = await post("set_agent_actions", { enabled: false });
		expect(set.statusCode).toBe(200);
		expect(set.body).toEqual({ enabled: false });

		const get = await post("get_agent_actions");
		expect(get.body).toEqual({ enabled: false });
	});

	it("rejects a non-boolean enabled with 400", async () => {
		const res = await post("set_agent_actions", { enabled: "yes" });
		expect(res.statusCode).toBe(400);
	});

	it("audit-logs the kill switch change", async () => {
		await post("set_agent_actions", { enabled: false });
		expect(auditLog).toHaveBeenCalledWith(
			"admin",
			"agent_actions_kill_switch",
			expect.stringContaining("KILLED"),
		);
	});

	it("the stored key matches the one agentActionsEnabled() reads", async () => {
		await post("set_agent_actions", { enabled: false });
		const row = settings.get("agent_actions_enabled");
		expect(row?.value).toEqual({ enabled: false });
	});
});

describe("POST /api/admin spam sensitivity config", () => {
	beforeEach(() => {
		isAdmin.mockResolvedValue(true);
	});

	it("returns defaults when nothing is stored", async () => {
		const res = await post("get_spam_config");
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ flag: 40, review: 60, quarantine: 80 });
	});

	it("persists a valid config and returns it normalized", async () => {
		const res = await post("set_spam_config", { config: { flag: 30, review: 55, quarantine: 75 } });
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ flag: 30, review: 55, quarantine: 75 });

		const get = await post("get_spam_config");
		expect(get.body).toEqual({ flag: 30, review: 55, quarantine: 75 });
	});

	it("clamps invalid values to defaults", async () => {
		const res = await post("set_spam_config", { config: { flag: 999, review: -5, quarantine: "abc" } });
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ flag: 40, review: 60, quarantine: 80 });
	});

	it("enforces flag < review < quarantine ordering", async () => {
		const res = await post("set_spam_config", { config: { flag: 70, review: 20, quarantine: 10 } });
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ flag: 70, review: 75, quarantine: 80 });
	});

	it("audit-logs the saved config", async () => {
		await post("set_spam_config", { config: { flag: 50 } });
		expect(auditLog).toHaveBeenCalledWith(
			"admin",
			"spam_config",
			expect.any(String),
		);
	});

const ALL_ON = {
	comments: true,
	reactions: true,
	chat_messages: true,
	activity_logs: true,
	agent_conversations: true,
	archived_polls: true,
	agent_history: true,
};
describe("POST /api/admin user-deleted retention", () => {
	beforeEach(() => {
		isAdmin.mockResolvedValue(true);
	});

	it("returns the 5h default when nothing is stored", async () => {
		const res = await post("get_retention_config");
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ user_delete_hours: 5, auto_delete_enabled: true, classes: ALL_ON });
	});

	it("persists a valid value and reads it back", async () => {
		const set = await post("set_retention_config", { user_delete_hours: 24 });
		expect(set.statusCode).toBe(200);
		expect(set.body).toEqual({ user_delete_hours: 24, auto_delete_enabled: true, classes: ALL_ON });

		const get = await post("get_retention_config");
		expect(get.body).toEqual({ user_delete_hours: 24, auto_delete_enabled: true, classes: ALL_ON });
	});

	it("rejects out-of-range and non-integer values with 400", async () => {
		for (const v of [0, -1, 169, 2.5, "soon", null]) {
			const res = await post("set_retention_config", { user_delete_hours: v });
			expect(res.statusCode).toBe(400);
		}
	});

	it("persists auto-delete off and reads it back", async () => {
		const set = await post("set_retention_config", { user_delete_hours: 5, auto_delete_enabled: false });
		expect(set.statusCode).toBe(200);
		expect(set.body).toEqual({ user_delete_hours: 5, auto_delete_enabled: false, classes: ALL_ON });

		const get = await post("get_retention_config");
		expect(get.body).toEqual({ user_delete_hours: 5, auto_delete_enabled: false, classes: ALL_ON });
	});

	it("rejects a non-boolean auto_delete_enabled with 400", async () => {
		const res = await post("set_retention_config", { user_delete_hours: 5, auto_delete_enabled: "yes" });
		expect(res.statusCode).toBe(400);
	});

	it("returns stored cleanup and purge run stats", async () => {
		const res = await post("get_cleanup_stats");
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ cleanup: null, purge: null });
	});

	it("persists a single class toggle without wiping the rest", async () => {
		const set = await post("set_retention_config", { user_delete_hours: 5, classes: { comments: false } });
		expect(set.statusCode).toBe(200);
		expect(set.body.classes.comments).toBe(false);
		expect(set.body.classes.reactions).toBe(true);
		const get = await post("get_retention_config");
		expect(get.body.classes.comments).toBe(false);
		expect(get.body.classes.chat_messages).toBe(true);
		const set2 = await post("set_retention_config", { user_delete_hours: 5, classes: { reactions: false } });
		expect(set2.body.classes.comments).toBe(false);
		expect(set2.body.classes.reactions).toBe(false);
	});

	it("rejects non-object and non-boolean classes with 400", async () => {
		for (const v of ["off", 0, ["comments"]]) {
			const res = await post("set_retention_config", { user_delete_hours: 5, classes: v });
			expect(res.statusCode).toBe(400);
		}
		const res = await post("set_retention_config", { user_delete_hours: 5, classes: { comments: "no" } });
		expect(res.statusCode).toBe(400);
	});

	it("drops unknown class keys instead of storing them", async () => {
		const set = await post("set_retention_config", { user_delete_hours: 5, classes: { comments: false, not_a_class: false } });
		expect(set.statusCode).toBe(200);
		expect(set.body.classes).not.toHaveProperty("not_a_class");
	});

	it("audit-logs the saved retention", async () => {
		await post("set_retention_config", { user_delete_hours: 12 });
		expect(auditLog).toHaveBeenCalledWith(
			"admin",
			"retention_config",
			expect.stringContaining("12"),
		);
	});
});

	it("the saved value is exactly what /api/posts reads via getSpamConfig", async () => {
		await post("set_spam_config", { config: { flag: 35, review: 65, quarantine: 85 } });
		const { getSpamConfig } = await import("../../api/_moderation.js");
		const cfg = await getSpamConfig({ from });
		expect(cfg).toEqual({ flag: 35, review: 65, quarantine: 85 });
	});
});
