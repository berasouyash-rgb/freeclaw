// ═══════════════════════════════════════════════════════════════════
// AI Coworker response contract — the "works like ChatGPT" slice
// ═══════════════════════════════════════════════════════════════════
// Locks three behaviors that made the Coworker unusable ("dumped
// responses, SQL errors, every type of errors"):
//   1. parseAgentResponse NEVER returns raw JSON as the reply — it
//      recovers {reply, actions} from fenced/bare JSON and degrades to
//      "" (intent/fallback chain) when structure is unrecoverable.
//   2. The in-turn tool loop executes read-only tools immediately,
//      feeds REAL results back to the model (grounding pass), and only
//      returns the grounded reply + remaining approval cards.
//   3. Raw SQL/provider error text never reaches the UI: execute
//      results and intent failures go through friendlyError(), while
//      honest allowlisted guard messages pass through unchanged.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
	// Permissive thenable Supabase chain: method calls return the chain,
	// awaiting it resolves { data: null, error: null, count: 0 }.
	const calls: Array<[string, unknown[]]> = [];
	const q: Record<string, unknown> = {};
	const handler: ProxyHandler<Record<string, unknown>> = {
		get(_t, p) {
			if (p === "then")
				return (
					res: (v: unknown) => unknown,
					rej?: (e: unknown) => unknown,
				) =>
					Promise.resolve({ data: null, error: null, count: 0 }).then(
						res,
						rej,
					);
			return (...a: unknown[]) => {
				calls.push([String(p), a]);
				return new Proxy(q, handler);
			};
		},
	};
	const proxy = new Proxy(q, handler);
	return {
		dbCalls: calls,
		from: (table: string) => {
			calls.push(["from", [table]]);
			return proxy;
		},
		rpc: (...a: unknown[]) => {
			calls.push(["rpc", a]);
			return proxy;
		},
		callLLMChain: vi.fn(),
		auditLog: vi.fn(async () => {}),
	};
});

vi.mock("../../api/_db-client.js", () => ({
	default: { from: h.from, rpc: h.rpc },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: h.auditLog,
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
	maskProfanity: (s: unknown) => String(s ?? ""),
}));
vi.mock("../../api/_error.js", () => ({ sanitizeError: vi.fn() }));
vi.mock("../../api/_providers.js", () => ({ callLLMChain: h.callLLMChain }));

import handler, {
	friendlyError,
	parseAgentResponse,
} from "../../api/_agent-chat.js";

function mockRes() {
	const res: {
		statusCode: number;
		body: Record<string, unknown> | undefined;
		status: (c: number) => typeof res;
		json: (p: unknown) => typeof res;
		end: () => typeof res;
		setHeader: () => void;
	} = {
		statusCode: 200,
		body: undefined,
		status(c: number) {
			this.statusCode = c;
			return this;
		},
		json(p: unknown) {
			this.body = p as Record<string, unknown>;
			return this;
		},
		end() {
			return this;
		},
		setHeader() {},
	};
	return res;
}

function makeReq(body: Record<string, unknown>) {
	return {
		method: "POST",
		headers: { origin: "http://localhost:5173" },
		query: {},
		body,
	} as never;
}

describe("parseAgentResponse — never dumps raw JSON", () => {
	it("extracts reply and actions from a fenced JSON block", () => {
		const r = parseAgentResponse(
			'Here you go:\n```json\n{"reply":"32 posts this week.","actions":[{"tool":"get_posts","args":{}}]}\n```',
		);
		expect(r.reply).toBe("32 posts this week.");
		expect(r.actions).toEqual([{ tool: "get_posts", args: {} }]);
	});

	it("extracts a reply-only fenced object without leaking the JSON (the dump bug)", () => {
		const r = parseAgentResponse(
			'```json\n{"reply":"The platform is healthy."}\n```',
		);
		expect(r.reply).toBe("The platform is healthy.");
		expect(r.actions).toEqual([]);
		expect(r.reply).not.toContain("```");
		expect(r.reply).not.toContain("{");
	});

	it("parses bare JSON with reply and actions", () => {
		const r = parseAgentResponse(
			'{"reply":"Found 2 reports.","actions":[{"tool":"get_reports","args":{}}]}',
		);
		expect(r.reply).toBe("Found 2 reports.");
		expect(r.actions).toHaveLength(1);
	});

	it("keeps surrounding prose when the JSON only carries actions", () => {
		const r = parseAgentResponse(
			'Sure — preparing that now.\n```json\n{"actions":[{"tool":"get_analytics","args":{}}]}\n```',
		);
		expect(r.reply).toContain("preparing that now");
		expect(r.reply).not.toContain("```");
		expect(r.actions).toEqual([{ tool: "get_analytics", args: {} }]);
	});

	it("returns empty reply (not a dump) for unrecoverable JSON", () => {
		const r = parseAgentResponse('{"reply": "half a respons');
		expect(r.reply).toBe("");
		expect(r.actions).toEqual([]);
	});

	it("returns empty reply when the whole message is a JSON blob", () => {
		const r = parseAgentResponse('{"status":"completed","rows":[{"a":1}]}');
		expect(r.reply).toBe("");
	});

	it("passes plain prose through untouched", () => {
		const r = parseAgentResponse("All 3 reports were resolved yesterday.");
		expect(r.reply).toBe("All 3 reports were resolved yesterday.");
		expect(r.actions).toEqual([]);
	});

	it("drops malformed action entries and caps the action list", () => {
		const actions = Array.from({ length: 20 }, (_, i) => ({
			tool: "get_posts",
			args: { i },
		}));
		const r = parseAgentResponse(
			JSON.stringify({ reply: "done", actions: [...actions, { nope: 1 }] }),
		);
		expect(r.actions).toHaveLength(8);
		expect(r.actions.every((a) => a && a.tool === "get_posts")).toBe(true);
	});
});

describe("friendlyError — raw SQL/provider text never reaches the UI", () => {
	it("maps SQL internals to a human message", () => {
		const msg = friendlyError(
			new Error('SQL error: relation "agent_conversations" does not exist'),
		);
		expect(msg).not.toMatch(/SQL error|relation|PGRST/i);
		expect(msg).toMatch(/database/i);
	});

	it("maps network/provider failures to a retry message", () => {
		const msg = friendlyError(
			new Error("fetch failed: ECONNREFUSED 127.0.0.1:54321"),
		);
		expect(msg).not.toMatch(/ECONNREFUSED|fetch/i);
		expect(msg).toMatch(/unavailable/i);
	});

	it("passes honest allowlisted guard messages through unchanged", () => {
		expect(friendlyError(new Error("Only SELECT queries allowed"))).toBe(
			"Only SELECT queries allowed",
		);
		expect(
			friendlyError(new Error('Unknown table "foo". Available: posts, comments')),
		).toContain('Unknown table "foo"');
	});
});

describe("chat handler — in-turn tool loop grounds the reply", () => {
	it("executes read-only tools now, grounds via a second pass, keeps destructive cards", async () => {
		h.callLLMChain
			.mockResolvedValueOnce({
				text: '```json\n{"reply":"Pulling the numbers now.","actions":[{"tool":"get_analytics","args":{}},{"tool":"delete_post","args":{"post_id":"p9"}}]}\n```',
				provider: "nvidia",
				model: "mock-1",
			})
			.mockResolvedValueOnce({
				text: '{"reply":"There are 0 posts and 0 comments right now.","actions":[]}',
				provider: "nvidia",
				model: "mock-1",
			});
		h.auditLog.mockClear();
		h.dbCalls.length = 0;

		const res = mockRes();
		await handler(
			makeReq({
				action: "chat",
				message: "how many posts do we have?",
				session_id: "s-loop",
			}),
			res as never,
		);

		expect(res.statusCode).toBe(200);
		// Exactly two model calls: proposal + grounding pass.
		expect(h.callLLMChain).toHaveBeenCalledTimes(2);
		// The second call carries the REAL tool results.
		expect(String(h.callLLMChain.mock.calls[1][0])).toContain("TOOL RESULTS");
		expect(String(h.callLLMChain.mock.calls[1][1])).toContain("get_analytics");
		// get_analytics actually queried the database in this turn.
		expect(
			h.dbCalls.some(([m, a]) => m === "from" && a[0] === "posts"),
		).toBe(true);
		// Auto-execution was audited as real evidence.
		expect(
			h.auditLog.mock.calls.some(
				(c) => c[1] === "agent_auto_get_analytics" && String(c[2]).includes("OK"),
			),
		).toBe(true);

		const body = res.body!;
		// Grounded reply from the second pass — not the speculative first one.
		expect(body.reply).toBe("There are 0 posts and 0 comments right now.");
		// The executed read tool is NOT returned as a proposal card…
		const actions = body.actions as Array<{ tool: string; destructive: boolean }>;
		expect(actions).toHaveLength(1);
		// …but the destructive tool still is, flagged for approval.
		expect(actions[0].tool).toBe("delete_post");
		expect(actions[0].destructive).toBe(true);
		expect(body.requires_approval).toBe(true);
		expect(body.provider).toBe("nvidia:mock-1");
	});

	it("keeps the first reply when the grounding pass fails", async () => {
		h.callLLMChain
			.mockResolvedValueOnce({
				text: '{"reply":"Checking the tables.","actions":[{"tool":"list_tables","args":{}}]}',
				provider: "nvidia",
				model: "mock-1",
			})
			.mockRejectedValueOnce(new Error("provider exploded"));
		const res = mockRes();
		await handler(
			makeReq({ action: "chat", message: "what tables exist", session_id: "s-g1" }),
			res as never,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body!.reply).toBe("Checking the tables.");
		// list_tables already ran — no duplicate card.
		expect(res.body!.actions).toEqual([]);
	});
});

describe("execute handler — SQL failures are friendly, guards stay honest", () => {
	it("rejects a destructive query without leaking SQL internals", async () => {
		const res = mockRes();
		await handler(
			makeReq({
				action: "execute",
				actions: [
					{ id: "a1", tool: "execute_sql", args: { query: "DROP TABLE posts;" } },
				],
			}),
			res as never,
		);
		expect(res.statusCode).toBe(200);
		const results = res.body!.results as Array<{
			success: boolean;
			error?: string;
		}>;
		expect(results[0].success).toBe(false);
		// Honest allowlisted guard message — not a stack trace or PGRST dump.
		expect(results[0].error).toBe("Only SELECT queries allowed");
		expect(results[0].error).not.toMatch(/PGRST|syntax|relation|at Object\./i);
	});
});
