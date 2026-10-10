// Live-schema contract — workers/engines may only query columns that EXIST.
// Incident: several workers filtered/ordered by phantom columns
// (posts.archived, agent_knowledge.expires_at, ...) so every live run
// failed while permissive mocks stayed green. This mock emulates
// PostgREST: unknown columns in select/eq/order/like/gt/lt/neq throw,
// so a schema drift fails HERE instead of in production Automations.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Subset of the production schema (PostgREST definitions) needed here.
const SCHEMA: Record<string, string[]> = {
	posts: ["id", "type", "title", "description", "category", "priority", "tags", "image_url", "author_id", "status", "progress", "deleted", "hidden", "pinned", "featured", "locked", "status_history", "admin_reply", "admin_notes", "ai_summary", "eta", "assigned_to", "merged_into", "created_at", "updated_at", "visibility"],
	comments: ["id", "post_id", "parent_id", "author_id", "body", "is_admin", "edited", "deleted", "hidden", "created_at"],
	polls: ["id", "post_id", "title", "ptype", "options", "author_id", "expires_at", "archived", "deleted", "created_at"],
	poll_votes: ["id", "poll_id", "author_id", "choices"],
	settings: ["id", "key", "value", "updated_at"],
	agent_knowledge: ["id", "source_agent_id", "division", "pattern_type", "pattern_data", "success_count", "failure_count", "total_uses", "success_rate", "last_success_at", "last_failure_at", "decay_weight", "tags", "created_at", "updated_at"],
	admin_feedback: ["id", "agent_id", "report_id", "insight_id", "rating", "comment", "learning_weight", "admin_id", "created_at"],
	agent_config: ["id", "agent_id", "config_type", "config_key", "config_value", "version", "previous_value", "source", "applied", "applied_at", "created_at"],
	notifications: ["id", "notif_type", "title", "body", "is_read", "user_id", "created_at"],
	chat_threads: ["thread_id", "status", "updated_at"],
};

const state = vi.hoisted(() => ({
	posts: [] as Array<Record<string, unknown>>,
	knowledge: [] as Array<Record<string, unknown>>,
	settings: new Map<string, unknown>(),
	inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

function checkCols(table: string, cols: string[]) {
	const known = SCHEMA[table];
	if (!known) throw new Error(`relation "${table}" does not exist`);
	for (const c of cols) {
		const base = c.split(":")[0].split(" ")[0].replace(/^[*!]/, "");
		if (!base || base === "*" || base === "count") continue;
		if (!known.includes(base)) throw new Error(`column ${table}.${base} does not exist`);
	}
}

function chain(table: string, rows: () => unknown[]) {
	const q: Record<string, unknown> = {};
	const ops = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "not", "in", "order", "limit", "gte"];
	for (const op of ops) {
		q[op] = vi.fn((col?: unknown) => {
			if (typeof col === "string" && !["limit"].includes(op)) checkCols(table, [col]);
			return q;
		});
	}
	q.select = vi.fn((cols?: unknown) => {
		if (typeof cols === "string") checkCols(table, cols.split(",").map((s) => s.trim()));
		return q;
	});
	q.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
	q.single = vi.fn(async () => ({ data: null, error: null }));
	(q.then as unknown) = (resolve: (v: unknown) => void) =>
		Promise.resolve({ data: rows(), error: null }).then(resolve);
	return q;
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table === "posts") return chain(table, () => state.posts);
			if (table === "agent_knowledge") return chain(table, () => state.knowledge);
			if (table === "settings") {
				return {
					select: () => ({
						eq: (_c: string, key: string) => ({
							maybeSingle: async () => ({
								data: state.settings.has(key) ? { value: state.settings.get(key) } : null,
								error: null,
							}),
						}),
						like: (_c: string, prefix: string) => {
							const stem = prefix.replace(/%$/, "");
							const data = [...state.settings.entries()]
								.filter(([k]) => k.startsWith(stem))
								.map(([key, value]) => ({ key, value }));
							return Promise.resolve({ data, error: null });
						},
					}),
					upsert: async (row: { key: string; value: unknown }) => {
						state.settings.set(row.key, row.value);
						return { error: null };
					},
				};
			}
			if (table === "admin_feedback" || table === "agent_config") {
				return {
					select: () => chain(table, () => []),
					upsert: async (row: Record<string, unknown>) => {
						for (const k of Object.keys(row)) checkCols(table, [k]);
						state.inserts.push({ table, row });
						return { error: null };
					},
					insert: async (row: Record<string, unknown>) => {
						for (const k of Object.keys(row)) checkCols(table, [k]);
						state.inserts.push({ table, row });
						return { error: null };
					},
				};
			}
			throw new Error(`unexpected table ${table}`);
		},
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => true),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
}));

vi.mock("../../api/_providers.js", () => ({
	callLLMChain: vi.fn(async () => null),
}));

import { checkSLA } from "../../api/_sla.js";
import { checkReopen } from "../../api/_reopen.js";
import { checkFollowups } from "../../api/_followup.js";
import {
	getAgentConfig,
	queryKnowledge,
	recordAdminFeedback,
	requestAgentSpawn,
} from "../../api/_learning-engine.js";

beforeEach(() => {
	vi.clearAllMocks();
	state.posts.length = 0;
	state.knowledge.length = 0;
	state.settings.clear();
	state.inserts.length = 0;
});

describe("workers run against the real column set", () => {
	it("sla scans without the phantom posts.archived filter", async () => {
		const r = await checkSLA();
		expect(r.ok).toBe(true);
		expect(r.checked).toBe(0);
	});

	it("reopen scans without the phantom posts.archived filter", async () => {
		const r = await checkReopen();
		expect(r.ok).toBe(true);
	});

	it("followup scans without the phantom posts.archived filter", async () => {
		const r = await checkFollowups();
		expect(r.ok).toBe(true);
	});
});

describe("learning engine uses real columns", () => {
	it("queryKnowledge filters/orders only live columns", async () => {
		state.knowledge.push({ id: "k1", division: "content", success_rate: 0.9 });
		const rows = await queryKnowledge("content", null, 10);
		expect(Array.isArray(rows)).toBe(true);
	});

	it("recordAdminFeedback inserts learning_weight (not weight)", async () => {
		const ok = await recordAdminFeedback("a1", null, "thumbs_up", "", "admin");
		expect(ok).toBe(true);
		const ins = state.inserts.find((i) => i.table === "admin_feedback");
		expect(ins).toBeTruthy();
		expect(ins!.row).toHaveProperty("learning_weight");
		expect(ins!.row).not.toHaveProperty("weight");
	});

	it("getAgentConfig orders by created_at and maps config", async () => {
		const cfg = await getAgentConfig("a1");
		expect(cfg).toEqual({});
	});

	it("requestAgentSpawn inserts without updated_at", async () => {
		const r = await requestAgentSpawn("content", "test", [], "test");
		expect(r).toMatchObject({ requested: true });
		const ins = state.inserts.find((i) => i.table === "agent_config");
		expect(ins).toBeTruthy();
		expect(ins!.row).not.toHaveProperty("updated_at");
	});
});
