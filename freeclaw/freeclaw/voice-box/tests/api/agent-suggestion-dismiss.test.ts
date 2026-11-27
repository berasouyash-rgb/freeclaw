// ═══════════════════════════════════════════════════════════════════
// Agent suggestion dismiss/approve — the resolution must be PROVEN
// ═══════════════════════════════════════════════════════════════════
// REGRESSION: `PUT /api/agent` with action=dismiss updated
// `agent_suggestions.status` to "dismissed" without checking `error`, then
// wrote the `agent_dismiss` audit entry and answered `ok:true`. A failed
// update therefore left the suggestion PENDING on the server while the UI
// removed it and the audit trail claimed an admin dismissed it.
//
// Same class as BUG-009/010/011/012 (unverified write → false success).
//
// Contract:
//   1. The status update must be checked; a failure surfaces loudly.
//   2. No `agent_dismiss` audit entry unless the row is actually dismissed.
//   3. An already-resolved suggestion stays an idempotent no-op 200.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	suggestions: [] as Array<Record<string, unknown>>,
	updateErrors: {} as Record<string, Error | undefined>,
	updates: [] as Array<{ patch: Record<string, unknown> }>,
}));

type Chain = Record<string, unknown> & {
	then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
	const filters: Array<[string, unknown]> = [];
	let op: "select" | "update" = "select";
	let patch: Record<string, unknown> = {};
	let single = false;
	const self: Chain = {
		then(fn) {
			if (op === "update") {
				const err = state.updateErrors[table];
				if (err) {
					fn({ data: null, error: err });
					return;
				}
				state.updates.push({ patch: { ...patch } });
				for (const r of state.suggestions)
					if (filters.every(([c, v]) => r[c] === v)) Object.assign(r, patch);
				fn({ data: null, error: null });
				return;
			}
			const rows = table === "agent_suggestions" ? state.suggestions : [];
			const matched = rows.filter((r) =>
				filters.every(([c, v]) => r[c] === v),
			);
			fn({ data: single ? (matched[0] ?? null) : matched, error: null });
		},
		select() {
			return self;
		},
		maybeSingle() {
			single = true;
			return self;
		},
		single() {
			single = true;
			return self;
		},
		update(row: Record<string, unknown>) {
			op = "update";
			patch = row;
			return self;
		},
		eq(col: string, val: unknown) {
			filters.push([col, val]);
			return self;
		},
	};
	return self;
}

const from = vi.fn((table: string) => chainFor(table));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = vi.hoisted(() => ({ isAdmin: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../api/_auth.js", () => ({
	...authMocks,
	cors: vi.fn(),
	clean: (s: unknown) => String(s ?? ""),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(body: unknown) {
			res.body = body;
			return res;
		},
		end() {
			return res;
		},
		setHeader() {
			return res;
		},
	};
	return res;
}

const SUGGESTION = {
	id: "sug-1",
	kind: "content",
	title: "Draft a policy",
	status: "pending",
	critical: false,
	content: {},
};

beforeEach(() => {
	vi.clearAllMocks();
	state.suggestions = [{ ...SUGGESTION }];
	state.updateErrors = {};
	state.updates = [];
	authMocks.isAdmin.mockResolvedValue(true);
	authMocks.auditLog.mockResolvedValue(undefined);
});

async function callPut(body: Record<string, unknown>) {
	const { default: handler } = await import("../../api/_agent.js");
	const res = response();
	await handler(
		{
			method: "PUT",
			query: {},
			headers: { "x-anon-id": "anon-1" },
			body,
		},
		res,
	);
	return res;
}

describe("PUT /api/agent — dismiss suggestion", () => {
	it("dismisses the suggestion and audits it", async () => {
		const res = await callPut({ id: "sug-1", action: "dismiss" });
		expect(res.statusCode).toBe(200);
		expect(state.suggestions[0]?.status).toBe("dismissed");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"agent_dismiss",
			expect.stringContaining("sug-1"),
		);
	});

	it("fails loudly when the status update errors", async () => {
		state.updateErrors.agent_suggestions = new Error("dismiss failed");
		await expect(callPut({ id: "sug-1", action: "dismiss" })).rejects.toThrow(
			"dismiss failed",
		);
	});

	it("does not audit a dismissal that did not land", async () => {
		state.updateErrors.agent_suggestions = new Error("dismiss failed");
		await expect(
			callPut({ id: "sug-1", action: "dismiss" }),
		).rejects.toThrow();
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"agent_dismiss",
			expect.stringContaining("sug-1"),
		);
		// And the row must still be pending — the server is the truth.
		expect(state.suggestions[0]?.status).toBe("pending");
	});

	it("keeps an already-resolved suggestion an idempotent no-op", async () => {
		state.suggestions[0]!.status = "dismissed";
		const res = await callPut({ id: "sug-1", action: "dismiss" });
		expect(res.statusCode).toBe(200);
		expect((res.body as { already?: boolean }).already).toBe(true);
		expect(state.updates).toHaveLength(0);
	});
});

describe("PUT /api/agent — approve suggestion", () => {
	// SIBLING OF BUG-013, and more dangerous. The approve path applies the
	// real moderation action FIRST (that write IS checked), and only then
	// records the suggestion as approved. That final update was unchecked, so
	// a failure left the suggestion PENDING while the action had ALREADY been
	// applied — the admin sees "approved" in the audit, the list still offers
	// it, and re-applying it can duplicate the moderation action.
	const ACTIONABLE = {
		...SUGGESTION,
		kind: "status_change",
		target_id: "post-1",
		content: { to: "solved" },
	};

	beforeEach(() => {
		state.suggestions = [{ ...ACTIONABLE }];
	});

	it("records the approval and audits it on success", async () => {
		const res = await callPut({ id: "sug-1", action: "approve" });
		expect(res.statusCode).toBe(200);
		expect(state.suggestions[0]?.status).toBe("approved");
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"agent_approve",
			expect.stringContaining("sug-1"),
		);
	});

	it("fails loudly when the approval record cannot be written", async () => {
		state.updateErrors.agent_suggestions = new Error("approve record failed");
		await expect(
			callPut({ id: "sug-1", action: "approve" }),
		).rejects.toThrow("approve record failed");
	});

	it("does not audit an approval that was not recorded", async () => {
		state.updateErrors.agent_suggestions = new Error("approve record failed");
		await expect(
			callPut({ id: "sug-1", action: "approve" }),
		).rejects.toThrow();
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"agent_approve",
			expect.anything(),
		);
		// Still pending => the admin is not told it is done.
		expect(state.suggestions[0]?.status).toBe("pending");
	});
});
