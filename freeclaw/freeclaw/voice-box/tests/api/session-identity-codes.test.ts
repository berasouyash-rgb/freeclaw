// ═══════════════════════════════════════════════════════════════════
// Session identity 403s carry machine-readable codes.
// ═══════════════════════════════════════════════════════════════════
// A 403 from verifyCallerIdentity is (almost) never fixed by retrying:
// sessions do NOT self-heal by minting on claim (that would hand the identity
// so a 403 means retry will fail identically — typically a live server
// record with no browser cookie (cookies cleared) or a stale cookie from
// a rotated mint. Clients must tell "reload and retry" apart from "this
// browser needs a fresh anonymous ID", and only a `code` lets them.
//
// Contract:
//   - malformed id / header mismatch → 403 code "invalid_identity"
//   - live record + no cookie, minted over 20s ago → 403 code
//     "session_unrecoverable" (stolen-ID denial; retry is futile)
//   - live record + no cookie, minted within 20s → ok:true WITHOUT minting
//     (boot-race grace: parallel first-load requests fire before the
//     minter's Set-Cookie lands; no new cookie is issued so the in-flight
//     mint stays authoritative)
//   - expired record + no cookie → 403 "session_unrecoverable", record
//     untouched. Expired sessions stay dead; the owner starts fresh
//     client-side while old content stays published.
//   - NO record row + no cookie → ok:true with a fresh Set-Cookie
//     (first-visit onboarding; safe — session rows are never deleted, so
//     "no record" means first contact, and ids are unpredictable).
//   - wrong cookie → 403, EXCEPT a previously-minted token (th_prev, the
//     losing side of a concurrent double-mint) which rotates once to fresh.
//   - valid cookie → ok:true
// ═══════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  setCookies: [] as Array<string>,
}));

function chainFor(table: string) {
  const eqs: Array<[string, unknown]> = [];
  let op: "select" | "upsert" = "select";
  let patch: Record<string, unknown> = {};
  const self = {
    then(fn: (v: unknown) => void) {
      if (op === "upsert") {
        if (table === "settings")
          state.settings[String(patch.key)] = patch.value;
        fn({ data: null, error: null });
        return;
      }
      const key = eqs.find(([c]) => c === "key")?.[1];
      const value =
        key !== undefined ? state.settings[String(key)] : undefined;
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
    eq(col: string, val: unknown) {
      eqs.push([col, val]);
      return self;
    },
  };
  return self;
}

const from = vi.fn((table: string) => chainFor(table));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));
vi.mock("../../api/_notification-delivery.js", () => ({
  recordPendingDelivery: vi.fn(async () => {}),
}));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ID = "anon_testid1";
const COOKIE = "vb_session=good-token";

function req(cookie?: string) {
  return {
    headers: {
      "x-anon-id": ID,
      ...(cookie ? { cookie } : {}),
    },
    socket: { remoteAddress: "203.0.113.9" },
  };
}

function res() {
  return { setHeader: vi.fn() };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.settings = {};
  state.setCookies = [];
});

async function verify(
  r: ReturnType<typeof req>,
  id: string = ID,
): Promise<{ ok?: boolean; status?: number; code?: string }> {
  const { verifyCallerIdentity } = await import("../../api/_auth.js");
  const response = res();
  const out = (await (
    verifyCallerIdentity as (
      q: unknown,
      s: unknown,
      i: string,
    ) => Promise<unknown>
  )(r, response, id)) as { ok?: boolean; status?: number; code?: string };
  for (const c of (response.setHeader as ReturnType<typeof vi.fn>).mock.calls)
    if (c[0] === "Set-Cookie") state.setCookies.push(String(c[1]));
  return out;
}

function seedLive(tokenHash: string, createdAt: string) {
  state.settings[`session:${ID}`] = {
    th: tokenHash,
    exp: Date.now() + 29 * 86400 * 1000,
    created_at: createdAt,
  };
}

describe("verifyCallerIdentity — 403 codes", () => {
  it("marks a live record with no cookie as unrecoverable", async () => {
    // Established record (minted an hour ago): no grace window applies.
    seedLive(sha("good-token"), new Date(Date.now() - 3600 * 1000).toISOString());
    const out = await verify(req());
    expect(out.ok).not.toBe(true);
    expect(out.status).toBe(403);
    expect(out.code).toBe("session_unrecoverable");
    // No fresh cookie is issued — retrying is futile by design.
    expect(state.setCookies).toHaveLength(0);
  });

  it("allows a freshly minted record with no cookie (boot-race grace)", async () => {
    // Parallel first-load requests can arrive after the minter's commit
    // but before its Set-Cookie lands in the browser. created_at within
    // 20s proves this is that window — allow without re-minting so the
    // in-flight mint stays authoritative (no cookie issued here).
    seedLive(sha("good-token"), new Date(Date.now() - 5000).toISOString());
    const out = await verify(req());
    expect(out.ok).toBe(true);
    expect(state.setCookies).toHaveLength(0);
  });

  it("marks a stale cookie outside the mint grace window as unrecoverable", async () => {
    seedLive(
      sha("rotated-token"),
      new Date(Date.now() - 3600 * 1000).toISOString(),
    );
    const out = await verify(req(COOKIE));
    expect(out.status).toBe(403);
    expect(out.code).toBe("session_unrecoverable");
  });

  it("marks a malformed id as invalid_identity", async () => {
    const out = await verify(req(), "not an id!!");
    expect(out.status).toBe(403);
    expect(out.code).toBe("invalid_identity");
  });

  it("marks a header/claim mismatch as invalid_identity", async () => {
    const { verifyCallerIdentity } = await import("../../api/_auth.js");
    const out = (await (
      verifyCallerIdentity as (
        q: unknown,
        s: unknown,
        i: string,
      ) => Promise<unknown>
    )(req(COOKIE), res(), "anon_otherid1")) as {
      status?: number;
      code?: string;
    };
    expect(out.status).toBe(403);
    expect(out.code).toBe("invalid_identity");
  });

  it("refuses an expired record with no cookie and never overwrites it", async () => {
    // THE FIX for transparent takeover: an expired session used to be
    // silently re-minted to whoever claimed the id — handing the identity
    // over AND locking the real owner out (their valid cookie would then
    // mismatch the attacker's hash). Now the record is left byte-identical
    // and no cookie is issued.
    const before = {
      th: sha("old-token"),
      exp: Date.now() - 1000,
      created_at: new Date(Date.now() - 40 * 86400 * 1000).toISOString(),
    };
    state.settings[`session:${ID}`] = { ...before };
    const out = await verify(req());
    expect(out.ok).not.toBe(true);
    expect(out.status).toBe(403);
    expect(out.code).toBe("session_unrecoverable");
    expect(state.settings[`session:${ID}`]).toEqual(before);
    expect(state.setCookies).toHaveLength(0);
  });

  it("accepts a valid cookie", async () => {
    seedLive(sha("good-token"), new Date().toISOString());
    const out = await verify(req(COOKIE));
    expect(out.ok).toBe(true);
  });
});

describe("verifyCallerIdentity — takeover resistance (P0)", () => {
  it("denies a claim on a live record without touching it", async () => {
    // Attacker sends x-anon-id: <victim> with no cookie. Must 403 AND leave
    // the victim's record (and therefore their working cookie) intact.
    const before = {
      th: sha("victim-token"),
      exp: Date.now() + 29 * 86400 * 1000,
      created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
    };
    state.settings[`session:${ID}`] = { ...before };
    const out = await verify(req());
    expect(out.ok).not.toBe(true);
    expect(out.code).toBe("session_unrecoverable");
    expect(state.settings[`session:${ID}`]).toEqual(before);
    expect(state.setCookies).toHaveLength(0);
    // And the victim's own cookie still works afterwards (no lockout).
    const victim = await verify(req("vb_session=victim-token"));
    expect(victim.ok).toBe(true);
  });

  it("denies a random wrong cookie without rotating the stored hash", async () => {
    seedLive(sha("good-token"), new Date(Date.now() - 3600 * 1000).toISOString());
    const before = { ...state.settings[`session:${ID}`] } as Record<string, unknown>;
    const out = await verify(req("vb_session=attacker-guess"));
    expect(out.ok).not.toBe(true);
    expect(out.code).toBe("session_unrecoverable");
    // No rotation, no cookie: the attack changed nothing server-side.
    expect(state.settings[`session:${ID}`]).toEqual(before);
    expect(state.setCookies).toHaveLength(0);
  });

  it("recovers the losing side of a concurrent double-mint via th_prev", async () => {
    // Two parallel first-loads both mint; the second preserves the first
    // hash as th_prev. The loser presents the old token and is re-issued
    // fresh — once. A random cookie still fails (covered above).
    state.settings[`session:${ID}`] = {
      th: sha("second-token"),
      th_prev: sha("first-token"),
      exp: Date.now() + 29 * 86400 * 1000,
      created_at: new Date().toISOString(),
    };
    const out = await verify(req("vb_session=first-token"));
    expect(out.ok).toBe(true);
    // Fresh cookie issued, hash rotated forward, history preserved.
    expect(state.setCookies.some((c) => c.startsWith("vb_session="))).toBe(true);
    const after = state.settings[`session:${ID}`] as Record<string, unknown>;
    expect(after.th).not.toBe(sha("second-token"));
    expect(after.th_prev).toBe(sha("second-token"));
  });

  it("mints a brand-new id with no record (onboarding still works)", async () => {
    expect(state.settings[`session:${ID}`]).toBeUndefined();
    const out = await verify(req());
    expect(out.ok).toBe(true);
    expect(state.setCookies.some((c) => c.startsWith("vb_session="))).toBe(true);
    const row = state.settings[`session:${ID}`] as Record<string, unknown>;
    expect(typeof row.th).toBe("string");
  });
});
