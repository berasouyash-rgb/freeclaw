/**
 * REGRESSION — settings-KV event writes must not lose events.
 *
 * api/_events.js stored the event log and the agent trigger queue by
 * read-modify-write across separate round trips (read list → unshift/push
 * in JS → write whole list back). Two concurrent writers read the same
 * list and last-writer-wins dropped events and agent triggers; a write
 * error was neither checked nor thrown, so loss was silent.
 *
 * The fix: a single-statement RPC (migration 019) that serializes writers
 * on the row lock, with a legacy fallback ONLY when the function is
 * missing (pre-migration DB). Write errors now throw into the existing
 * never-throw wrappers (loud warn), never vanish.
 *
 * This file pins, with a mocked DB (no network):
 *   1. emitEvent prefers the atomic RPC and skips legacy I/O.
 *   2. Concurrent emits both land (each emit is one atomic statement).
 *   3. Legacy fallback runs ONLY on missing-function, with checked writes.
 *   4. A sick lane degrades to null, never throws (request-path contract).
 *   5. consumeAgentEvents claims via RPC exactly once (no double delivery).
 *   6. consumeAgentEvents falls back to legacy only when missing.
 *
 * NOTE: every emit uses a UNIQUE payload per test — emitEvent dedups
 * identical type+data within 5s via a module-level Map that persists
 * across tests in this file. Reusing a payload would suppress the emit
 * and fail the test for the wrong reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
	rpcMode: "ok" as "ok" | "missing" | "error",
	rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
	reads: 0,
	writes: 0,
}));

function chainFor(table: string) {
	if (table !== "settings") throw new Error(`unexpected table ${table}`);
	const state = {
		op: "select" as "select" | "update" | "insert",
		patch: {} as Record<string, unknown>,
		key: "",
	};
	const self = {
		select() {
			return self;
		},
		eq(col: string, val: unknown) {
			if (col === "key") state.key = String(val);
			return self;
		},
		maybeSingle() {
			return self;
		},
		single() {
			return self;
		},
		update(patch: Record<string, unknown>) {
			state.op = "update";
			state.patch = patch;
			return self;
		},
		insert(row: Record<string, unknown>) {
			state.op = "insert";
			state.patch = row;
			return self;
		},
		then(fn: (v: unknown) => void) {
			if (state.op === "select") {
				db.reads += 1;
				const value = db.settings[state.key];
				fn({ data: value === undefined ? null : { value }, error: null });
				return;
			}
			db.writes += 1;
			if (state.op === "update") {
				if (!(state.key in db.settings)) {
					fn({ data: null, error: { message: "row missing" } });
					return;
				}
				db.settings[state.key] = (state.patch as { value: unknown }).value;
				fn({ data: [{ key: state.key }], error: null });
				return;
			}
			db.settings[(state.patch as { key: string }).key] = (
				state.patch as { value: unknown }
			).value;
			fn({ data: null, error: null });
		},
	};
	return self;
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => chainFor(table),
		rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
			db.rpcCalls.push({ fn, args });
			if (db.rpcMode === "missing") {
				return {
					data: null,
					error: {
						message: "Could not find the function public.append_x",
						code: "PGRST202",
					},
				};
			}
			if (db.rpcMode === "error") {
				return {
					data: null,
					error: { message: "connection refused", code: "08006" },
				};
			}
			// Simulate the atomic functions against the in-memory store.
			if (fn === "append_setting_list_item") {
				const key = String(args.p_key);
				const list = String(args.p_list);
				const max = Number(args.p_max) || 100;
				const cur = (db.settings[key] as
					| { [k: string]: unknown[] }
					| undefined) ?? {};
				const arr = Array.isArray(cur[list]) ? [...(cur[list] as unknown[])] : [];
				if (args.p_prepend) arr.unshift(args.p_item);
				else arr.push(args.p_item);
				const trimmed = args.p_prepend ? arr.slice(0, max) : arr.slice(-max);
				db.settings[key] = { ...cur, [list]: trimmed };
				return { data: null, error: null };
			}
			if (fn === "claim_agent_triggers") {
				const cur = (db.settings["pending_agent_events"] as
					| { triggers?: unknown[] }
					| undefined) ?? {};
				const arr = Array.isArray(cur.triggers) ? [...cur.triggers] : [];
				const agent = String(args.p_agent);
				const limit = Number(args.p_limit) || 10;
				const idx: number[] = [];
				arr.forEach((t, i) => {
					const r = t as Record<string, unknown>;
					if (r.agent_id === agent && !r.consumed) idx.push(i);
				});
				const take = idx.slice(-limit);
				const claimed = take.map((i) => arr[i]);
				take.forEach((i) => {
					(arr[i] as Record<string, unknown>).consumed = true;
				});
				db.settings["pending_agent_events"] = {
					...cur,
					triggers: arr.slice(-100),
				};
				return { data: claimed, error: null };
			}
			return { data: null, error: { message: `unknown fn ${fn}` } };
		}),
	},
}));
vi.mock("../../api/_notification-delivery.js", () => ({
	recordPendingDelivery: vi.fn(async () => {}),
}));

import { consumeAgentEvents, emitEvent } from "../../api/_events.js";

beforeEach(() => {
	vi.resetModules();
	db.settings = {};
	db.rpcCalls = [];
	db.rpcMode = "ok";
	db.reads = 0;
	db.writes = 0;
});

describe("emitEvent — atomic RPC first", () => {
	it("stores via RPC and never touches the legacy read-modify-write path", async () => {
		const event = await emitEvent("post.created", { id: "rpc-first" });
		expect(event).not.toBeNull();
		const logCalls = db.rpcCalls.filter((c) => c.args.p_key === "event_log");
		expect(logCalls).toHaveLength(1);
		expect(logCalls[0].args.p_list).toBe("events");
		expect(logCalls[0].args.p_prepend).toBe(true);
		expect(db.reads).toBe(0);
		expect(db.writes).toBe(0);
		const stored = db.settings["event_log"] as { events: Array<{ type: string }> };
		expect(stored.events).toHaveLength(1);
		expect(stored.events[0].type).toBe("post.created");
	});

	it("two concurrent emits both land (no last-writer-wins loss)", async () => {
		const [a, b] = await Promise.all([
			emitEvent("post.created", { id: "conc-a" }),
			emitEvent("comment.created", { id: "conc-b" }),
		]);
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		const stored = db.settings["event_log"] as { events: unknown[] };
		expect(stored.events).toHaveLength(2);
	});

	it("falls back to legacy ONLY when the function is missing", async () => {
		db.rpcMode = "missing";
		const event = await emitEvent("post.created", { id: "legacy-fb" });
		expect(event).not.toBeNull();
		expect(db.rpcCalls.length).toBeGreaterThan(0);
		expect(db.reads).toBeGreaterThan(0);
		expect(db.writes).toBeGreaterThan(0);
		const stored = db.settings["event_log"] as { events: unknown[] };
		expect(stored.events).toHaveLength(1);
	});

	it("returns null (never throws) when the lane is sick", async () => {
		db.rpcMode = "error";
		const event = await emitEvent("post.created", { id: "lane-sick" });
		expect(event).toBeNull();
	});
});

describe("consumeAgentEvents — atomic claim", () => {
	function seed(...triggers: Array<Record<string, unknown>>) {
		db.settings["pending_agent_events"] = { triggers };
	}

	it("claims via RPC and never delivers twice", async () => {
		seed(
			{ agent_id: "a", event_type: "x", consumed: false, n: 1 },
			{ agent_id: "a", event_type: "x", consumed: false, n: 2 },
			{ agent_id: "b", event_type: "x", consumed: false, n: 3 },
		);
		const rows = (await consumeAgentEvents("a", 10)) as Array<
			Record<string, unknown>
		>;
		expect(rows.map((r) => r.n).sort()).toEqual([1, 2]);
		const again = (await consumeAgentEvents("a", 10)) as unknown[];
		expect(again).toEqual([]);
		const b = (await consumeAgentEvents("b", 10)) as Array<
			Record<string, unknown>
		>;
		expect(b.map((r) => r.n)).toEqual([3]);
	});

	it("falls back to legacy only when the function is missing", async () => {
		db.rpcMode = "missing";
		seed({ agent_id: "a", event_type: "x", consumed: false, n: 1 });
		const rows = (await consumeAgentEvents("a", 10)) as Array<
			Record<string, unknown>
		>;
		expect(rows.map((r) => r.n)).toEqual([1]);
		const stored = db.settings["pending_agent_events"] as {
			triggers: Array<Record<string, unknown>>;
		};
		expect(stored.triggers[0].consumed).toBe(true);
	});

	it("never throws on total failure (cron contract)", async () => {
		db.rpcMode = "error";
		const rows = await consumeAgentEvents("no-such-agent-xyz", 10);
		expect(rows).toEqual([]);
	});
});
