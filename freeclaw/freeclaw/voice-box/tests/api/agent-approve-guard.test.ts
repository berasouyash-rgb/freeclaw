// ═══════════════════════════════════════════════════════════════════
// Agent approve-guard tests (api/_agent.js)
// ═══════════════════════════════════════════════════════════════════
// Locks the POST /api/agent approve contract:
//   - Executable kinds (escalation/merge/user_warn/…) apply their real action.
//   - Advisory kinds (free-text LLM kinds like 'enforcement'/'policy') have
//     NO approve action — approving them must return a clear 4xx and NEVER
//     write to the posts table (no silent empty-patch no-op / fake completion).

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mocks.from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));

import agentHandler, { KEEP_KINDS } from "../../api/_agent.js";

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

/** A chain builder for supabase.from('agent_suggestions').select('*')
 *  .eq('id', X).maybeSingle() — the one call the approve path makes before
 *  dispatching on kind. */
function suggestStore(row: unknown) {
	mocks.from.mockImplementation((table: string) => {
		if (table === "agent_suggestions") {
			return {
				select: () => ({
					eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
				}),
				// Reaching the approve-completion update would mean the guard failed
				// to short-circuit — fail loudly.
				update: vi.fn(() => {
					throw new Error("advisory suggestion was marked approved!");
				}),
			};
		}
		// Any OTHER table (posts, users_meta, comments, reports, settings) must
		// never be reached for advisory kinds — fail loudly if it is.
		return {
			select: vi.fn(() => {
				throw new Error(`unexpected select on ${table}`);
			}),
			update: vi.fn(() => {
				throw new Error(`unexpected update on ${table}`);
			}),
		};
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("/api/agent GET — advisory auto-expiry", () => {
	it("runs the 48h expiry AND the 24h advisory expiry on every list load", async () => {
		// Build a chain spy: update(...) → eq(status) → lt(created_at) → [not(kind)]
		// NOTE: a thenable passed to `await` must call resolve() itself — an async
		// arrow silently ignores the resolve/reject args and hangs the await.
		const calls: string[] = [];
		const ok = () => ({ data: [], error: null });
		const thenable = {
			then(resolve: (v: unknown) => void) {
				resolve(ok());
				return undefined;
			},
			not: (_c: string, _o: string, v: string) => {
				calls.push(`not:${v}`);
				return {
					then(resolve: (v: unknown) => void) {
						resolve(ok());
						return undefined;
					},
				};
			},
		};
		const ltChain = { lt: () => thenable };
		const eqChain = {
			eq: (_c: string, v: string) => {
				calls.push(`eq:${v}`);
				return ltChain;
			},
		};
		const updateChain = { update: () => eqChain };

		mocks.from.mockImplementation((table: string) => {
			if (table === "agent_suggestions") {
				return {
					...updateChain,
					select: () => ({
						order: () => ({ limit: () => Promise.resolve(ok()) }),
					}),
				};
			}
			return { select: vi.fn(), update: vi.fn() };
		});

		const res = response();
		await agentHandler({ method: "GET", headers: {} } as never, res as never);
		expect(res.statusCode).toBe(200);
		// First expiry pass: the global 48h cutoff
		expect(
			calls.filter((c) => c.startsWith("eq:")).length,
		).toBeGreaterThanOrEqual(2);
		// Second pass must scope its NOT to KEEP_KINDS (executable + proactive)
		expect(
			calls.some(
				(c) =>
					c.startsWith("not:") &&
					c.includes(KEEP_KINDS[0]) &&
					c.includes("stale_report"),
			),
		).toBe(true);
	});
});

describe("/api/agent approve — executable vs advisory kinds", () => {
	it("rejects an advisory kind with a clear 400 and touches NO table", async () => {
		suggestStore({
			id: 41,
			kind: "enforcement",
			target_id: null,
			target_type: "general",
			title: "Verify Enforcement for Banned User",
			content: { text: "advice" },
			critical: false,
			status: "pending",
			confidence: 0.7,
		});
		const res = response();
		await agentHandler(
			{
				method: "PUT",
				body: { id: 41, action: "approve", confirmed: true },
				headers: {},
			} as never,
			res as never,
		);
		expect(res.statusCode).toBe(400);
		expect((res.body as { error: string }).error).toMatch(
			/advisory suggestion with no executable action/i,
		);
		// The posts table must NEVER be touched for advisory kinds.
		expect(mocks.from).not.toHaveBeenCalledWith("posts");
		// And the suggestion must not be marked approved — an update on
		// agent_suggestions would throw (see suggestStore), so reaching 400
		// without an exception proves the approve path short-circuited.
	});

	it("rejects the generic recommendation fallback kind too", async () => {
		suggestStore({
			id: 42,
			kind: "recommendation",
			target_id: null,
			content: {},
			critical: false,
			status: "pending",
		});
		const res = response();
		await agentHandler(
			{
				method: "PUT",
				body: { id: 42, action: "approve", confirmed: true },
				headers: {},
			} as never,
			res as never,
		);
		expect(res.statusCode).toBe(400);
		expect(mocks.from).not.toHaveBeenCalledWith("posts");
	});

	it("still approves an executable kind end-to-end (escalation → posts.update)", async () => {
		let postsUpdateCalled = false;
		mocks.from.mockImplementation((table: string) => {
			if (table === "agent_suggestions") {
				return {
					select: () => ({
						eq: () => ({
							maybeSingle: async () => ({
								data: {
									id: 43,
									kind: "escalation",
									target_id: "p-1",
									content: {
										field: "priority",
										from: "medium",
										to: "critical",
									},
									critical: false,
									status: "pending",
									title: "Escalate p-1",
								},
								error: null,
							}),
						}),
					}),
					update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
				};
			}
			if (table === "posts") {
				postsUpdateCalled = true;
				return {
					select: vi.fn(async () => ({
						data: { status_history: [] },
						error: null,
					})),
					update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
				};
			}
			return {
				select: vi.fn(),
				update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
			};
		});

		const res = response();
		await agentHandler(
			{
				method: "PUT",
				body: { id: 43, action: "approve", confirmed: true },
				headers: {},
			} as never,
			res as never,
		);
		expect(res.statusCode).toBe(200);
		expect(postsUpdateCalled).toBe(true);
	});
});
