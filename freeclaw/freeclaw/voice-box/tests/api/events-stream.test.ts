// ═══════════════════════════════════════════════════════════════════
// Live inbox wake-ups — GET /api/events?user_id=anon_x (SSE)
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/events contract:
//   1. user_id must be a well-formed anon id; anything else → 400, and no
//      realtime channel is ever opened for a rejected caller.
//   2. EventSource cannot send x-anon-id, so the query value is bridged
//      into the header as the CLAIM — the session cookie stays the PROOF.
//      A failing verifyCallerIdentity → JSON denial with its status+code,
//      never a stream.
//   3. On success the handler emits `hello`, opens ONE realtime channel
//      with three bindings filtered to this user's rows only, and writes
//      coalesced `update` wake-ups (never notification content).
//   4. A dead realtime channel closes the stream instead of faking
//      liveness; client disconnect removes the channel exactly once.
// ───────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

const channelMock = vi.fn();
const removeChannelMock = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn(), channel: channelMock, removeChannel: removeChannelMock },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	clean: (s: unknown, max = 2000) =>
		String(s ?? "")
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
			.trim()
			.slice(0, max),
	rateLimitResponse: vi.fn((res) =>
		res.status(429).json({ error: "rate limited" }),
	),
	verifyCallerIdentity: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((res) =>
		res.status(500).json({ error: "Internal error" }),
	),
}));

import { verifyCallerIdentity } from "../../api/_auth.js";

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
			query: { user_id: "anon_owner" },
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
	(verifyCallerIdentity as ReturnType<typeof vi.fn>).mockReset();
	(verifyCallerIdentity as ReturnType<typeof vi.fn>).mockResolvedValue({
		ok: true,
		callerId: "anon_owner",
	});
});

describe("GET /api/events", () => {
	it("400s a malformed user_id and opens no channel", async () => {
		const { default: handler } = await import("../../api/_events-stream.js");
		const { req } = request({ query: { user_id: "admin:1" } });
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(400);
		expect(channelMock).not.toHaveBeenCalled();
	});

	it("405s non-GET methods", async () => {
		const { default: handler } = await import("../../api/_events-stream.js");
		const { req } = request({ method: "POST" });
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(405);
	});

	it("answers OPTIONS without touching auth or realtime", async () => {
		const { default: handler } = await import("../../api/_events-stream.js");
		const { req } = request({ method: "OPTIONS" });
		const res = response();
		await handler(req as never, res as never);
		expect(res.statusCode).toBe(204);
		expect(verifyCallerIdentity).not.toHaveBeenCalled();
		expect(channelMock).not.toHaveBeenCalled();
	});

	it("bridges the query id into x-anon-id and denies with the verifier verdict", async () => {
		(verifyCallerIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: "Invalid session identity",
			code: "session_unrecoverable",
		});
		const { default: handler } = await import("../../api/_events-stream.js");
		const { req } = request();
		const res = response();
		await handler(req as never, res as never);
		// The claim reached the verifier through the header bridge…
		expect((req.headers as Record<string, string>)["x-anon-id"]).toBe("anon_owner");
		// …and the denial is plain JSON, never a stream.
		expect(res.statusCode).toBe(403);
		expect(res.body).toEqual({
			error: "Invalid session identity",
			code: "session_unrecoverable",
		});
		expect(channelMock).not.toHaveBeenCalled();
	});

	it("says hello and subscribes three user-filtered bindings", async () => {
		const { chan, bindings } = channelObject();
		(channelMock as ReturnType<typeof vi.fn>).mockReturnValue(chan);
		const { default: handler } = await import("../../api/_events-stream.js");
		const { listeners, req } = request();
		const res = response();
		const p = handler(req as never, res as never);
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));

		expect(res.statusCode).toBe(200);
		expect(res.writes.some((w) => w.startsWith("retry: "))).toBe(true);
		expect(res.writes.some((w) => w.startsWith("event: hello"))).toBe(true);
		expect(channelMock).toHaveBeenCalledOnce();
		expect(bindings).toHaveLength(3);
		const byTable = new Map(bindings.map((b) => [b.filter.table, b.filter]));
		expect(byTable.get("posts")).toMatchObject({
			event: "*",
			schema: "public",
			filter: "author_id=eq.anon_owner",
		});
		expect(byTable.get("chat_messages")).toMatchObject({
			event: "*",
			schema: "public",
			filter: "thread_id=eq.anon_owner",
		});
		expect(byTable.get("settings")).toMatchObject({
			event: "*",
			schema: "public",
			filter: "key=eq.notifications:anon_owner",
		});

		listeners.close();
		await p;
	});

	it("emits one coalesced update wake-up per burst (kinds only, no content)", async () => {
		vi.useFakeTimers();
		try {
			const { chan, bindings } = channelObject();
			(channelMock as ReturnType<typeof vi.fn>).mockReturnValue(chan);
			const { default: handler } = await import("../../api/_events-stream.js");
			const { listeners, req } = request();
			const res = response();
			const p = handler(req as never, res as never);
			await vi.advanceTimersByTimeAsync(0);

			const chat = bindings.find((b) => b.filter.table === "chat_messages");
			const post = bindings.find((b) => b.filter.table === "posts");
			expect(chat).toBeTruthy();
			expect(post).toBeTruthy();
			// A burst on two bindings collapses into ONE write…
			chat!.cb();
			post!.cb();
			chat!.cb();
			await vi.advanceTimersByTimeAsync(1_100);
			const updates = res.writes.filter((w) => w.startsWith("event: update"));
			expect(updates).toHaveLength(1);
			// …carrying kinds only — never notification content.
			expect(updates[0]).toContain('"chat"');
			expect(updates[0]).toContain('"post"');
			expect(updates[0]).not.toContain("notif_");

			listeners.close();
			await p;
		} finally {
			vi.useRealTimers();
		}
	});

	it("closes (never fakes liveness) when the channel errors", async () => {
		const { chan, getSubCb } = channelObject();
		(channelMock as ReturnType<typeof vi.fn>).mockReturnValue(chan);
		const { default: handler } = await import("../../api/_events-stream.js");
		const { req } = request();
		const res = response();
		const p = handler(req as never, res as never);
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));

		getSubCb()!("CHANNEL_ERROR");
		await p;
		expect(res.writes.some((w) => w.startsWith("event: error"))).toBe(true);
		expect(removeChannelMock).toHaveBeenCalledWith(chan);
		expect(res.end).toHaveBeenCalled();
	});

	it("removes the channel exactly once on client disconnect", async () => {
		const { chan } = channelObject();
		(channelMock as ReturnType<typeof vi.fn>).mockReturnValue(chan);
		const { default: handler } = await import("../../api/_events-stream.js");
		const { listeners, req } = request();
		const res = response();
		const p = handler(req as never, res as never);
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));

		listeners.close();
		listeners.close();
		await p;
		expect(removeChannelMock).toHaveBeenCalledTimes(1);
		expect(res.end).toHaveBeenCalledTimes(1);
	});
});
