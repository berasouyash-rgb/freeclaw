// ═══════════════════════════════════════════════════════════════════
// Agent Real-Action Layer Tests (api/_agent-actions.js)
// ═══════════════════════════════════════════════════════════════════
// Covers: action budget caps, kill switch, hide/flag/resolve/pin/
// feature/priority/comment-reply primitives, idempotent dedupe, and
// summary accounting. All DB access is faked; no network involved.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";

// Mock the DB client BEFORE importing the module under test so the
// supabase createClient call in _db-client.js never runs.
vi.mock("../../api/_db-client.js", () => ({ default: {} }));

import {
	ACTION_BUDGET_MAX,
	agentActionsEnabled,
	agentCommentReply,
	agentFeaturePost,
	agentFlagTarget,
	agentHidePost,
	agentPinPost,
	agentResolveReports,
	agentSetPriority,
	budgetLeft,
	createActionBudget,
	summarizeActions,
} from "../../api/_agent-actions.js";

const AGENT = { id: "test-agent" };

interface ScriptedResponse {
	data?: unknown;
	error?: string | Error | null;
	throw?: boolean;
}

interface CallState {
	table: string;
	op?: string;
	patch?: Record<string, unknown>;
	row?: Record<string, unknown>;
}

// Fluent thenable fake. Responses are consumed from `script` in call
// order; calls past the end of the script resolve cleanly (no error,
// null data). Scripted `throw` entries make the promise reject so the
// module's error paths can be exercised.
function fakeDb(script: ScriptedResponse[] = []) {
	const calls: CallState[] = [];
	let idx = 0;
	const from = (name: string) => {
		const state: CallState = { table: name };
		const chain: Record<string, unknown> = {};
		chain.then = (
			resolve: (v: unknown) => void,
			reject: (e: Error) => void,
		) => {
			const s = script[idx++];
			if (s?.throw) reject(new Error(String(s.error ?? "boom")));
			else
				resolve({
					data: s && "data" in s ? s.data : null,
					error: s?.error ?? null,
				});
			return undefined;
		};
		chain.select = (cols?: string) => {
			state.op = `select:${cols ?? "*"}`;
			return chain;
		};
		chain.eq = (k: string) => {
			state.op = `eq:${k}`;
			return chain;
		};
		chain.limit = (n: number) => {
			state.op = `limit:${n}`;
			return chain;
		};
		chain.single = () => {
			state.op = "single";
			return chain;
		};
		chain.in = (k: string, v: unknown[]) => {
			state.op = `in:${k}:${(v || []).length}`;
			return chain;
		};
		chain.update = (patch: Record<string, unknown>) => {
			state.op = "update";
			state.patch = patch;
			return chain;
		};
		chain.insert = (row: Record<string, unknown>) => {
			state.op = "insert";
			state.row = row;
			return chain;
		};
		calls.push(state);
		return chain;
	};
	return { from, calls };
}

function freshBudget() {
	return createActionBudget();
}

describe("action budget", () => {
	it("defaults to ACTION_BUDGET_MAX = 12 and reports headroom", () => {
		expect(ACTION_BUDGET_MAX).toBe(12);
		const b = freshBudget();
		expect(b).toEqual({ used: 0, max: 12 });
		expect(budgetLeft(b)).toBe(true);
		b.used = 12;
		expect(budgetLeft(b)).toBe(false);
	});

	it("returns null (no entry, no write) when the budget is exhausted", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const b = { used: 12, max: 12 };
		const rec = await agentHidePost(
			db as never,
			b,
			actions,
			AGENT,
			"p1",
			"test",
		);
		expect(rec).toBeNull();
		expect(actions).toHaveLength(0);
		expect(db.calls).toHaveLength(0);
	});

	it("stops recording after max successful actions in one run", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const b = freshBudget();
		for (let i = 0; i < 14; i += 1) {
			const rec = await agentHidePost(
				db as never,
				b,
				actions,
				AGENT,
				`p${i}`,
				"test",
			);
			if (i < 12) expect(rec).toBeTruthy();
			else expect(rec).toBeNull();
		}
		expect(actions).toHaveLength(12);
		expect(b.used).toBe(12);
		expect(actions.every((a) => (a as { ok: boolean }).ok)).toBe(true);
	});
});

describe("kill switch (agent_actions_enabled)", () => {
	it("enables actions when the settings row is absent", async () => {
		const db = fakeDb();
		await expect(agentActionsEnabled(db as never)).resolves.toBe(true);
	});

	it("disables actions when value is { enabled: false }", async () => {
		const db = fakeDb([{ data: { value: { enabled: false } } }]);
		await expect(agentActionsEnabled(db as never)).resolves.toBe(false);
	});

	it("enables actions when value is { enabled: true }", async () => {
		const db = fakeDb([{ data: { value: { enabled: true } } }]);
		await expect(agentActionsEnabled(db as never)).resolves.toBe(true);
	});

	it("parses JSON-string values", async () => {
		const db = fakeDb([{ data: { value: '{"enabled":false}' } }]);
		await expect(agentActionsEnabled(db as never)).resolves.toBe(false);
	});

	it("fails open (enabled) when the settings lookup throws", async () => {
		const db = fakeDb([{ throw: true, error: "connection refused" }]);
		await expect(agentActionsEnabled(db as never)).resolves.toBe(true);
	});
});

describe("agentHidePost", () => {
	it("records an audited entry and consumes budget on success", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const b = freshBudget();
		const rec = await agentHidePost(
			db as never,
			b,
			actions,
			AGENT,
			"p42",
			"spam confirmed",
		);
		expect(rec).toMatchObject({
			type: "hide_post",
			agent: "test-agent",
			target_id: "p42",
			reason: "spam confirmed",
			ok: true,
			skipped: false,
		});
		expect(rec?.at).toBeTruthy();
		expect(db.calls[0].patch).toMatchObject({ hidden: true });
		expect(db.calls[0].patch?.updated_at).toBeTruthy(); // touch() audit stamp
		expect(actions).toHaveLength(1);
		expect(b.used).toBe(1);
	});

	it("records ok:false with the DB error and does not consume budget", async () => {
		const db = fakeDb([{ error: new Error("row missing") }]);
		const actions: unknown[] = [];
		const b = freshBudget();
		const rec = await agentHidePost(
			db as never,
			b,
			actions,
			AGENT,
			"p42",
			"spam confirmed",
		);
		expect(rec?.ok).toBe(false);
		expect(rec?.error).toBe("row missing");
		expect(b.used).toBe(0);
	});
});

describe("agentFlagTarget", () => {
	it("skips (idempotent) when a pending report with same target+reason exists", async () => {
		const db = fakeDb([{ data: [{ id: "r1", status: "pending" }] }]);
		const actions: unknown[] = [];
		const b = freshBudget();
		const rec = await agentFlagTarget(db as never, b, actions, AGENT, {
			target_id: "p1",
			target_type: "post",
			reason: "spam",
		});
		expect(rec?.ok).toBe(true);
		expect(rec?.skipped).toBe(true);
		expect(b.used).toBe(0); // skipped actions do not consume budget
		expect(db.calls).toHaveLength(1); // no insert attempted
	});

	it("inserts a moderation flag and consumes budget when no pending exists", async () => {
		const db = fakeDb([{ data: [] }]);
		const actions: unknown[] = [];
		const b = freshBudget();
		const rec = await agentFlagTarget(db as never, b, actions, AGENT, {
			target_id: "p1",
			reason: "spam",
		});
		expect(rec?.ok).toBe(true);
		expect(rec?.skipped).toBe(false);
		expect(b.used).toBe(1);
		expect(db.calls).toHaveLength(2);
		expect(db.calls[1].row).toMatchObject({
			target_id: "p1",
			target_type: "post",
			reason: "spam",
			author_id: "agent_test-agent",
			status: "pending",
		});
	});

	it("records an error when the insert fails", async () => {
		const db = fakeDb([{ data: [] }, { error: new Error("duplicate key") }]);
		const actions: unknown[] = [];
		const b = freshBudget();
		const rec = await agentFlagTarget(db as never, b, actions, AGENT, {
			target_id: "p1",
			reason: "spam",
		});
		expect(rec?.ok).toBe(false);
		expect(rec?.error).toBe("duplicate key");
		expect(b.used).toBe(0);
	});
});

describe("agentResolveReports", () => {
	it("returns null for empty id lists without touching the DB", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const b = freshBudget();
		expect(
			await agentResolveReports(db as never, b, actions, AGENT, []),
		).toBeNull();
		expect(
			await agentResolveReports(
				db as never,
				b,
				actions,
				AGENT,
				undefined as never,
			),
		).toBeNull();
		expect(db.calls).toHaveLength(0);
		expect(actions).toHaveLength(0);
	});

	it("batches the update with a default status of auto_resolved", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const b = freshBudget();
		const rec = await agentResolveReports(db as never, b, actions, AGENT, [
			"r1",
			"r2",
		]);
		expect(rec).toMatchObject({
			type: "resolve_reports",
			count: 2,
			status: "auto_resolved",
			ok: true,
		});
		expect(db.calls[0].op).toBe("in:id:2");
		expect(db.calls[0].patch).toEqual({ status: "auto_resolved" });
		expect(b.used).toBe(1);
	});
});

describe("post patch primitives", () => {
	it("agentPinPost patches pinned:true", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const rec = await agentPinPost(
			db as never,
			freshBudget(),
			actions,
			AGENT,
			"p1",
		);
		expect(rec?.type).toBe("pin_post");
		expect(db.calls[0].patch).toMatchObject({ pinned: true });
	});

	it("agentFeaturePost patches featured:true", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const rec = await agentFeaturePost(
			db as never,
			freshBudget(),
			actions,
			AGENT,
			"p1",
		);
		expect(rec?.type).toBe("feature_post");
		expect(db.calls[0].patch).toMatchObject({ featured: true });
	});

	it("agentSetPriority patches the requested priority", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const rec = await agentSetPriority(
			db as never,
			freshBudget(),
			actions,
			AGENT,
			"p1",
			"high",
		);
		expect(rec).toMatchObject({ type: "set_priority", priority: "high" });
		expect(db.calls[0].patch).toMatchObject({ priority: "high" });
	});
});

describe("agentCommentReply", () => {
	it("inserts an admin comment and touches the post", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		const b = freshBudget();
		const rec = await agentCommentReply(
			db as never,
			b,
			actions,
			AGENT,
			"p1",
			"We are looking into this. Thanks.",
		);
		expect(rec?.ok).toBe(true);
		expect(db.calls).toHaveLength(2);
		expect(db.calls[0].row).toMatchObject({
			post_id: "p1",
			author_id: "agent_test-agent",
			is_admin: true,
			parent_id: null,
		});
		expect(db.calls[1].table).toBe("posts"); // touch update
		expect(b.used).toBe(1);
	});

	it("masks profanity in the public reply body", async () => {
		const db = fakeDb();
		const actions: unknown[] = [];
		await agentCommentReply(
			db as never,
			freshBudget(),
			actions,
			AGENT,
			"p1",
			"this is shit behavior",
		);
		expect((db.calls[0].row?.body as string).toLowerCase()).not.toContain(
			"shit",
		);
	});
});

describe("summarizeActions", () => {
	it("counts only real (ok, non-skipped) actions and groups by type", () => {
		const actions = [
			{ type: "hide_post", ok: true, skipped: false },
			{ type: "hide_post", ok: true, skipped: false },
			{ type: "flag_target", ok: true, skipped: true }, // dedupe -> not counted
			{ type: "resolve_reports", ok: false, error: "boom" }, // failure -> not counted
			{ type: "pin_post", ok: true, skipped: false },
		];
		expect(summarizeActions(actions)).toEqual({
			actions_taken: 3,
			action_breakdown: { hide_post: 2, pin_post: 1 },
		});
	});

	it("handles missing/empty arrays", () => {
		expect(summarizeActions(undefined as never)).toEqual({
			actions_taken: 0,
			action_breakdown: {},
		});
		expect(summarizeActions([])).toEqual({
			actions_taken: 0,
			action_breakdown: {},
		});
	});
});
