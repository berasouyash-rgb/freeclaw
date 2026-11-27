// ═══════════════════════════════════════════════════════════════════
// Admin live wake-ups — /api/admin-events (SSE, ticket-authed)
// ═══════════════════════════════════════════════════════════════════
// Locks the admin stream contract:
//   1. POST issues a ticket ONLY for a live admin session (x-admin-token);
//      otherwise 403, never a ticket. Issuance is throttled.
//   2. GET opens the stream ONLY for a well-formed ticket whose record
//      exists, is fresh (<5min), and is still bound to a LIVE admin
//      session. Anything else → uniform 403 (no oracle).
//   3. On success: hello + ONE channel with bindings for published admin
//      workload tables ONLY (reports/comments/polls/votes/posts/chat) —
//      agent_tasks / agent_executions / settings are NOT in the shared
//      publication, so no dead bindings are opened for them. Wake-ups
//      carry kinds only.
//   4. Dead channel closes instead of faking liveness; disconnect
//      removes the channel exactly once.
// ───────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const channelMock = vi.fn();
const removeChannelMock = vi.fn();
const fromMock = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from: fromMock, channel: channelMock, removeChannel: removeChannelMock },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((res) =>
		res.status(500).json({ error: "Internal error" }),
	),
}));

import { isAdmin } from "../../api/_auth.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ADMIN_TOKEN = "admin-secret-token";
const TICKET = "a".repeat(64);

let kv: Record<string, unknown>;
let adminTokens: Array<{ t: string; exp: number }>;

function settingsChain() {
	return {
		select: () => ({
			eq: (_col: string, val: unknown) => ({
				maybeSingle: async () => {
					if (String(val) === "admin_sessions")
						return { data: { value: { tokens: adminTokens } }, error: null };
					const v = kv[String(val)] ?? null;
					return { data: v === null ? null : { value: v }, error: null };
				},
			}),
		}),
		upsert: (row: { key: string; value: unknown }) => {
			kv[row.key] = row.value;
			return Promise.resolve({ data: null, error: null });
		},
	};
}

function response() {
	const res = { statusCode: 200, body: undefined as unknown, writes: [] as string[] };
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
		write(chunk: string) {
			res.writes.push(String(chunk));
			return true;
		},
		end: vi.fn(),
	});
}

function request(over: Record<string, unknown> = {}) {
	const listeners: Record<string, () => void> = {};
	return {
		listeners,
		req: {
			method: "GET",
			query: {},
			headers: {},
			on: vi.fn((ev: string, cb: () => void) => {
				listeners[ev] = cb;
			}),
			...over,
		},
	};
}

function channelObject() {
	let subCb: ((status: string) => void) | null = null;
	const bindings: Array<{ filter: Record<string, unknown>; cb: () => void }> = [];
	const chan = {
		on: vi.fn((_ev: string, filter: Record<string, unknown>, cb: () => void) => {
			bindings.push({ filter, cb });
			return chan;
		}),
		subscribe: vi.fn((cb: (status: string) => void) => {
			subCb = cb;
			return chan;
		}),
	};
	return { chan, bindings, getSubCb: () => subCb };
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useRealTimers();
	(channelMock as ReturnType<typeof vi.fn>).mockReset();
	(removeChannelMock as ReturnType<typeof vi.fn>).mockReset();
	(isAdmin as ReturnType<typeof vi.fn>).mockReset();
	(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(true);
	kv = {};
	adminTokens = [{ t: ADMIN_TOKEN, exp: Date.now() + 3600_000 }];
	(fromMock as ReturnType<typeof vi.fn>).mockReset();
	(fromMock as ReturnType<typeof vi.fn>).mockImplementation(() => settingsChain());
});

function adminPost() {
	return request({
		method: "POST",
		headers: { "x-admin-token": ADMIN_TOKEN },
	});
}

describe("POST /api/admin-events (ticket issue)", () => {
	it("403s without a live admin session and stores nothing", async () => {
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
		const { default: handler } = await import("../../api/_admin-events.js");
		const { req } = adminPost();
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(403);
		expect(Object.keys(kv)).toHaveLength(0);
	});

	it("issues a ticket bound to the admin session", async () => {
		const { default: handler } = await import("../../api/_admin-events.js");
		const { req } = adminPost();
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(200);
		const ticket = (res.body as { ticket: string }).ticket;
		expect(ticket).toMatch(/^[0-9a-f]{64}$/);
		const row = kv[`adminticket:${sha(ticket)}`] as {
			admin_th: string;
			created_at: string;
		};
		expect(row.admin_th).toBe(sha(ADMIN_TOKEN));
		expect(typeof row.created_at).toBe("string");
	});
});

describe("GET /api/admin-events (stream open)", () => {
	function seedTicket(ageMs = 0) {
		kv[`adminticket:${sha(TICKET)}`] = {
			admin_th: sha(ADMIN_TOKEN),
			created_at: new Date(Date.now() - ageMs).toISOString(),
		};
	}

	it("403s a malformed ticket without touching realtime", async () => {
		const { default: handler } = await import("../../api/_admin-events.js");
		const { req } = request({ query: { ticket: "nope" } });
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(403);
		expect(channelMock).not.toHaveBeenCalled();
	});

	it("403s an unknown ticket", async () => {
		const { default: handler } = await import("../../api/_admin-events.js");
		const { req } = request({ query: { ticket: TICKET } });
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(403);
		expect(channelMock).not.toHaveBeenCalled();
	});

	it("403s a stale ticket (older than 5 minutes)", async () => {
		seedTicket(6 * 60_000);
		const { default: handler } = await import("../../api/_admin-events.js");
		const { req } = request({ query: { ticket: TICKET } });
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(403);
		expect(channelMock).not.toHaveBeenCalled();
	});

	it("403s when the bound admin session died (logout kills streams)", async () => {
		seedTicket();
		adminTokens = [];
		const { default: handler } = await import("../../api/_admin-events.js");
		const { req } = request({ query: { ticket: TICKET } });
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(403);
		expect(channelMock).not.toHaveBeenCalled();
	});

	it("opens the stream with published-table bindings only, then wakes on report", async () => {
		vi.useFakeTimers();
		try {
			seedTicket();
			const { chan, bindings, getSubCb } = channelObject();
			(channelMock as ReturnType<typeof vi.fn>).mockReturnValue(chan);
			const { default: handler } = await import("../../api/_admin-events.js");
			const { listeners, req } = request({ query: { ticket: TICKET } });
			const res = response();
			const p = handler(req as never, res as never);
			await vi.advanceTimersByTimeAsync(0);
			getSubCb()!("SUBSCRIBED");

			expect(res.writes.some((w) => w.startsWith("event: hello"))).toBe(true);
			const tables = bindings.map((b) => b.filter.table).sort();
			expect(tables).toEqual([
				"chat_messages",
				"chat_threads",
				"comments",
				"poll_votes",
				"polls",
				"posts",
				"reports",
			]);
			// No dead bindings for unpublished tables.
			expect(tables).not.toContain("agent_tasks");
			expect(tables).not.toContain("agent_executions");
			expect(tables).not.toContain("settings");

			const report = bindings.find((b) => b.filter.table === "reports");
			report!.cb();
			await vi.advanceTimersByTimeAsync(1_100);
			const updates = res.writes.filter((w) => w.startsWith("event: update"));
			expect(updates).toHaveLength(1);
			expect(updates[0]).toContain('"report"');

			listeners.close();
			await p;
			expect(removeChannelMock).toHaveBeenCalledWith(chan);
		} finally {
			vi.useRealTimers();
		}
	});
});
