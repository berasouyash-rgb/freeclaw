// ═══════════════════════════════════════════════════════════════════
// /api/me — account status contract
// ═══════════════════════════════════════════════════════════════════
// Locks the identity gate (FIX-#3):
//   1. A caller with NO identity (no x-anon-id header) must NOT be able to
//      read any user's moderation summary (banned / suspended / strikes /
//      warnings). Before the fix, the no-identity path fell back to gating
//      the QUERIED id, so anyone could enumerate anon_ids and read their
//      strikes + warning texts.
//   2. A matching x-anon-id header still returns the caller's own status.
//   3. Admins bypass the gate.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const verifyCallerIdentity = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn((res, retry) =>
		res.status(429).json({ error: "Too many requests", retry }),
	),
	isAdmin: vi.fn(async () => false),
	checkUser: vi.fn(async () => ({ ok: true, meta: null })),
	verifyCallerIdentity,
	clientIp: vi.fn(() => "test-ip"),
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

const VICTIM_META = {
	anon_id: "anon-victim",
	banned: false,
	suspended_until: null,
	strikes: 2,
	warnings: [{ text: "Be civil", at: "2026-08-01T00:00:00.000Z" }],
};

function mockSingle(row: unknown) {
	from.mockImplementation(() => ({
		select: () => ({
			eq: () =>
				Object.assign(Promise.resolve({ data: row, error: null }), {
					maybeSingle: async () => ({ data: row, error: null }),
				}),
		}),
	}));
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSingle(null);
});

describe("GET /api/me identity gate (FIX-#3)", () => {
	it("REFUSES a headerless caller instead of leaking the queried user's moderation data", async () => {
		verifyCallerIdentity.mockResolvedValue({
			ok: false,
			status: 403,
			error: "Missing session identity (x-anon-id header)",
		});
		mockSingle(VICTIM_META);
		const { default: handler } = await import("../../api/_me.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-victim" },
				body: {},
				headers: { "x-forwarded-for": "3.3.3.3" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		// Nothing about the victim leaked — not even a status object.
		expect(res.body).not.toHaveProperty("strikes");
		expect(res.body).not.toHaveProperty("warnings");
	});

	it("calls the identity gate with the QUERIED anon_id, never a spoofable caller_id", async () => {
		verifyCallerIdentity.mockResolvedValue({
			ok: false,
			status: 403,
			error: "Cannot operate on another user's data",
		});
		const { default: handler } = await import("../../api/_me.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-victim", caller_id: "anon-attacker" },
				body: {},
				headers: { "x-forwarded-for": "3.3.3.4" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect(verifyCallerIdentity).toHaveBeenCalledWith(
			expect.objectContaining({ query: { anon_id: "anon-victim", caller_id: "anon-attacker" } }),
			expect.anything(),
			"anon-victim",
		);
	});

	it("still returns the caller's own status when identity matches", async () => {
		verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon-me" });
		mockSingle(VICTIM_META);
		const { default: handler } = await import("../../api/_me.js");
		const res = response();
		await handler(
			{
				method: "GET",
				query: { anon_id: "anon-me" },
				body: {},
				headers: {
					"x-forwarded-for": "3.3.3.5",
					"x-anon-id": "anon-me",
				},
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ strikes: 2, warnings: VICTIM_META.warnings });
	});
});

describe("POST /api/me heartbeat (presence)", () => {
	function mockUpsert() {
		const upsert = vi.fn(async () => ({ data: null, error: null }));
		from.mockImplementation(() => ({
			select: () => ({
				eq: () => Promise.resolve({ data: null, error: null }),
			}),
			upsert,
		}));
		return upsert;
	}

	it("touches last_seen for the caller's own id", async () => {
		verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon-hb-1" });
		const upsert = mockUpsert();
		const { default: handler } = await import("../../api/_me.js");
		const res = response();
		await handler(
			{
				method: "POST",
				query: {},
				body: { action: "heartbeat" },
				headers: { "x-anon-id": "anon-hb-1", "x-forwarded-for": "9.9.9.1" },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true });
		expect(upsert).toHaveBeenCalledTimes(1);
		const [row, opts] = upsert.mock.calls[0];
		expect(row.anon_id).toBe("anon-hb-1");
		expect(typeof row.last_seen).toBe("string");
		expect(opts).toMatchObject({ onConflict: "anon_id" });
	});

	it("throttles a second immediate beat to zero writes", async () => {
		verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon-hb-2" });
		const upsert = mockUpsert();
		const { default: handler } = await import("../../api/_me.js");
		const req = {
			method: "POST",
			query: {},
			body: { action: "heartbeat" },
			headers: { "x-anon-id": "anon-hb-2", "x-forwarded-for": "9.9.9.2" },
		};
		const r1 = response();
		await handler(req, r1);
		expect(r1.body).toMatchObject({ ok: true });
		const r2 = response();
		await handler(req, r2);
		expect(r2.body).toMatchObject({ ok: true, throttled: true });
		expect(upsert).toHaveBeenCalledTimes(1);
	});

	it("rejects unknown actions and missing identity", async () => {
		verifyCallerIdentity.mockResolvedValue({ ok: true });
		mockUpsert();
		const { default: handler } = await import("../../api/_me.js");
		const bad = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "nope" }, headers: {} },
			bad,
		);
		expect(bad.statusCode).toBe(400);

		verifyCallerIdentity.mockResolvedValue({
			ok: false,
			status: 403,
			error: "Missing session identity (x-anon-id header)",
		});
		const anon = response();
		await handler(
			{ method: "POST", query: {}, body: { action: "heartbeat" }, headers: {} },
			anon,
		);
		expect(anon.statusCode).toBe(403);
	});
});

describe("POST /api/me heartbeat moderation gate", () => {
  it("refuses banned ids with no write and no throttle slot", async () => {
    verifyCallerIdentity.mockResolvedValue({ ok: true, callerId: "anon-banned" });
    const { checkUser } = await import("../../api/_auth.js");
    (checkUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "This anonymous ID has been permanently banned.",
    });
    const upsert = vi.fn(async () => ({ data: null, error: null }));
    from.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      upsert,
    }));
    const { default: handler } = await import("../../api/_me.js");
    const res = response();
    await handler(
      {
        method: "POST",
        query: {},
        body: { action: "heartbeat" },
        headers: { "x-anon-id": "anon-banned", "x-forwarded-for": "9.9.9.9" },
      },
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ heartbeat: "refused" });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/me heartbeat flood guard", () => {
  it("429s past 30 beats/min per IP", async () => {
    verifyCallerIdentity.mockResolvedValue({ ok: true });
    const { checkUser } = await import("../../api/_auth.js");
    (checkUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const upsert = vi.fn(async () => ({ data: null, error: null }));
    from.mockImplementation(() => ({
      select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      upsert,
    }));
    const { default: handler } = await import("../../api/_me.js");
    let last = response();
    for (let i = 0; i < 31; i++) {
      last = response();
      await handler(
        {
          method: "POST",
          query: {},
          body: { action: "heartbeat" },
          headers: { "x-anon-id": "anon-flood-" + i, "x-forwarded-for": "9.9.9.200" },
        },
        last,
      );
    }
    expect(last.statusCode).toBe(429);
  });
});
