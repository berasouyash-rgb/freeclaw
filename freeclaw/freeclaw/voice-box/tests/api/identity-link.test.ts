// ═══════════════════════════════════════════════════════════════════
// Cross-surface pairing — one id, many live sessions, concurrent action
// ═══════════════════════════════════════════════════════════════════
// Locks:
//   A. Multi-token verify: every hash listed in record.tokens proves
//      possession equally (web + app open together, same id).
//   B. Issue needs a LIVE session; otherwise 403 and nothing stored.
//   C. Redeem needs only the code: returns the id AND sets a live
//      session cookie (appended token — nobody rotates, nobody locks
//      out). Ticket burns on success.
//   D. Stale (>5min), unknown, over-attempted, or issuer-dead tickets
//      fail closed with uniform 403s and burn.
//   E. notifyUser survives concurrent-append clobbering: re-read proof,
//      exactly one retry, then the pending ledger (never a silent drop).
// ───────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
	setCookies: [] as Array<string>,
	pending: [] as Array<{ anonId: string; reason: string }>,
	dropUpserts: 0,
}));

function chainFor() {
	const eqs: Array<[string, unknown]> = [];
	let op = "select";
	let patch: Record<string, unknown> = {};
	const self = {
		then(fn: (v: unknown) => void) {
			if (op === "upsert") {
				if (state.dropUpserts > 0) {
					state.dropUpserts -= 1;
					fn({ data: null, error: null });
					return;
				}
				state.settings[String(patch.key)] = patch.value;
				fn({ data: null, error: null });
				return;
			}
			if (op === "delete") {
				const key = eqs.find(([c]) => c === "key")?.[1];
				if (key !== undefined) delete state.settings[String(key)];
				fn({ data: null, error: null });
				return;
			}
			const key = eqs.find(([c]) => c === "key")?.[1];
			const value = key !== undefined ? state.settings[String(key)] : undefined;
			fn({ data: value === undefined ? null : { value }, error: null });
		},
		select() {
			return self;
		},
		maybeSingle() {
			return self;
		},
		single() {
			return self;
		},
		upsert(row: Record<string, unknown>) {
			op = "upsert";
			patch = row;
			return self;
		},
		delete() {
			op = "delete";
			return self;
		},
		eq(col: string, val: unknown) {
			eqs.push([col, val]);
			return self;
		},
	};
	return self;
}

const from = vi.fn(() => chainFor());
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));
vi.mock("../../api/_notification-delivery.js", () => ({
	recordPendingDelivery: vi.fn(async (anonId: string, _e: unknown, reason: string) => {
		state.pending.push({ anonId, reason });
	}),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((res) =>
		res.status(500).json({ error: "Internal error" }),
	),
}));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ID = "anon_pair1";
const COOKIE_A = "vb_session=device-a-token";

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn((k: string, v: string) => {
			if (k === "Set-Cookie") state.setCookies.push(String(v));
		}),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

function seedSession(value: Record<string, unknown>) {
	state.settings[`session:${ID}`] = value;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state.settings = {};
	state.setCookies = [];
	state.pending = [];
	state.dropUpserts = 0;
});

describe("multi-token sessions (concurrent surfaces, one id)", () => {
	it("accepts any listed token — web + app stay live together", async () => {
		seedSession({
			th: sha("device-a-token"),
			tokens: [{ h: sha("device-b-token"), created_at: new Date().toISOString() }],
			created_at: new Date().toISOString(),
		});
		const { verifyCallerIdentity } = await import("../../api/_auth.js");
		const res = response();
		const out = (await (
			verifyCallerIdentity as (q: unknown, s: unknown, i: string) => Promise<unknown>
		)(
			{ headers: { "x-anon-id": ID, cookie: "vb_session=device-b-token" } },
			res,
			ID,
		)) as { ok?: boolean };
		expect(out.ok).toBe(true);
		// Cookie re-issued (Max-Age slides), nothing rotated.
		expect(state.setCookies.some((c) => c.startsWith("vb_session="))).toBe(true);
		const row = state.settings[`session:${ID}`] as { th: string };
		expect(row.th).toBe(sha("device-a-token"));
	});

	it("still denies an unlisted token without touching the record", async () => {
		const before = {
			th: sha("device-a-token"),
			tokens: [{ h: sha("device-b-token"), created_at: new Date().toISOString() }],
			created_at: new Date().toISOString(),
		};
		seedSession({ ...before });
		const { verifyCallerIdentity } = await import("../../api/_auth.js");
		const out = (await (
			verifyCallerIdentity as (q: unknown, s: unknown, i: string) => Promise<unknown>
		)(
			{ headers: { "x-anon-id": ID, cookie: "vb_session=stranger" } },
			response(),
			ID,
		)) as { ok?: boolean; code?: string };
		expect(out.ok).not.toBe(true);
		expect(out.code).toBe("session_unrecoverable");
		expect(state.settings[`session:${ID}`]).toEqual(before);
	});
});

describe("POST /api/identity-link", () => {
	function issueReq(headers: Record<string, string> = {}) {
		return {
			method: "POST",
			query: {},
			body: { action: "issue" },
			headers: { "x-anon-id": ID, ...headers },
		};
	}

	it("403s ticket issue on an existing record without proof, stores no ticket", async () => {
		// Stolen-id scenario: the record exists, the caller knows the id,
		// but presents no session cookie — verify denies before minting.
		seedSession({ th: sha("owner-token"), created_at: new Date().toISOString() });
		const { default: handler } = await import("../../api/_identity-link.js");
		const res = response();
		await handler(issueReq() as never, res as never);
		expect(res.statusCode).toBe(403);
		expect(
			Object.keys(state.settings).filter((k) => k.startsWith("claimticket:")),
		).toHaveLength(0);
		// Record untouched — no overwrite, no lockout of the owner.
		const row = state.settings[`session:${ID}`] as { th: string };
		expect(row.th).toBe(sha("owner-token"));
	});

	it("onboards a brand-new id: mints the session and issues its first code", async () => {
		// No record at all — first contact mints transparently (no prior
		// session to steal), and the freshly minted token proves possession,
		// so the same request can issue its own pairing code.
		const { default: handler } = await import("../../api/_identity-link.js");
		const res = response();
		await handler(issueReq() as never, res as never);
		expect(res.statusCode).toBe(200);
		const code = (res.body as { code: string }).code;
		expect(code).toMatch(/^\d{6}$/);
		expect(state.settings[`session:${ID}`]).toBeDefined();
		const ticket = state.settings[`claimticket:${code}`] as {
			anon_id: string;
			issuer_th: string;
		};
		expect(ticket.anon_id).toBe(ID);
		// Bound to the token minted in THIS request.
		const rec = state.settings[`session:${ID}`] as { th: string };
		expect(ticket.issuer_th).toBe(rec.th);
	});

	it("issues a 6-digit code bound to the proven session", async () => {
		seedSession({ th: sha("device-a-token"), created_at: new Date().toISOString() });
		const { default: handler } = await import("../../api/_identity-link.js");
		const res = response();
		await handler(issueReq({ cookie: COOKIE_A }) as never, res as never);
		expect(res.statusCode).toBe(200);
		const code = (res.body as { code: string }).code;
		expect(code).toMatch(/^\d{6}$/);
		const row = state.settings[`claimticket:${code}`] as {
			anon_id: string;
			issuer_th: string;
		};
		expect(row.anon_id).toBe(ID);
		expect(row.issuer_th).toBe(sha("device-a-token"));
	});

	it("redeems a code into a live second session — nobody rotates", async () => {
		seedSession({ th: sha("device-a-token"), created_at: new Date().toISOString() });
		const { default: handler } = await import("../../api/_identity-link.js");
		const issue = response();
		await handler(issueReq({ cookie: COOKIE_A }) as never, issue as never);
		const code = (issue.body as { code: string }).code;

		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "redeem", code }, headers: {} } as never,
			res as never,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, anon_id: ID });
		// Redeemer holds a working cookie now…
		expect(state.setCookies.some((c) => c.startsWith("vb_session="))).toBe(true);
		// …appended to the token list, issuer untouched…
		const row = state.settings[`session:${ID}`] as {
			th: string;
			tokens: Array<{ h: string }>;
		};
		expect(row.th).toBe(sha("device-a-token"));
		expect(row.tokens).toHaveLength(1);
		// …and the ticket burned (second redeem fails).
		const again = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "redeem", code }, headers: {} } as never,
			again as never,
		);
		expect(again.statusCode).toBe(403);
	});

	it("rejects stale codes and burns them", async () => {
		state.settings["claimticket:123456"] = {
			anon_id: ID,
			issuer_th: sha("device-a-token"),
			created_at: new Date(Date.now() - 6 * 60_000).toISOString(),
			attempts: 0,
		};
		seedSession({ th: sha("device-a-token"), created_at: new Date().toISOString() });
		const { default: handler } = await import("../../api/_identity-link.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "redeem", code: "123456" }, headers: {} } as never,
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(state.settings["claimticket:123456"]).toBeUndefined();
	});

	it("rejects when the issuer session died (code cannot outlive logout)", async () => {
		state.settings["claimticket:123456"] = {
			anon_id: ID,
			issuer_th: sha("device-a-token"),
			created_at: new Date().toISOString(),
			attempts: 0,
		};
		seedSession({ th: sha("rotated-token"), created_at: new Date().toISOString() });
		const { default: handler } = await import("../../api/_identity-link.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "redeem", code: "123456" }, headers: {} } as never,
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(state.setCookies).toHaveLength(0);
	});

	it("burns a code after too many wrong shapes… (attempt cap)", async () => {
		state.settings["claimticket:123456"] = {
			anon_id: ID,
			issuer_th: sha("device-a-token"),
			created_at: new Date().toISOString(),
			attempts: 10,
		};
		seedSession({ th: sha("device-a-token"), created_at: new Date().toISOString() });
		const { default: handler } = await import("../../api/_identity-link.js");
		const res = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "redeem", code: "123456" }, headers: {} } as never,
			res as never,
		);
		expect(res.statusCode).toBe(403);
		expect(state.settings["claimticket:123456"]).toBeUndefined();
	});
});

describe("notifyUser under concurrent appends", () => {
	it("retries once on a clobbered write instead of dropping it", async () => {
		state.dropUpserts = 1; // first upsert vanishes (mid-flight overwrite)
		const { notifyUser } = await import("../../api/_auth.js");
		const ok = await notifyUser(ID, "info", "Hello", "body");
		expect(ok).toBe(true);
		const row = state.settings[`notifications:${ID}`] as {
			notifications: Array<{ title: string }>;
		};
		expect(row.notifications.some((n) => n.title === "Hello")).toBe(true);
		expect(state.pending).toHaveLength(0);
	});

	it("hands to the pending ledger (never silent) when the write keeps losing", async () => {
		state.dropUpserts = 99; // every upsert vanishes
		const { notifyUser } = await import("../../api/_auth.js");
		const ok = await notifyUser(ID, "info", "Hello", "body");
		expect(ok).toBe(false);
		expect(state.pending).toEqual([{ anonId: ID, reason: "notifyUser_lost_update" }]);
	});
});
