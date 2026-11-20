// Slang escalation + restriction scopes — regression tests.
//
// Contract under test:
//   * violations ACCUMULATE across submissions (settings KV persists);
//   * at ESCALATE_AT=3 the user is escalated — an admin is notified through
//     the `escalated_users` poll, and NOTHING is blocked automatically;
//   * the admin then chooses a scope (full_block / browse_only / feed_only)
//     or dismisses the escalation;
//   * scope is an ALLOWLIST: unknown surfaces and unknown scopes FAIL CLOSED;
//   * report_create / notification_read / restriction_read / presence stay
//     available at every scope (a sanctioned user must still be able to
//     report the content that got them sanctioned);
//   * `checkUser` (the real one) enforces the restriction per surface.
//
// `_auth.js` is partially mocked: auditLog/notifyUser are captured, but
// checkUser stays REAL so the enforcement path is genuinely exercised.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	users: {} as Record<string, Record<string, unknown>>,
	settings: {} as Record<string, { key: string; value: unknown }>,
	/** When set, every `settings` read/write fails — exercises fail-closed. */
	settingsError: null as string | null,
}));

type Chain = Record<string, unknown> & {
	then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
	const eqs: Array<[string, unknown]> = [];
	let op = "select";
	let patch: Record<string, unknown> = {};
	let single = false;
	const rows = (): Array<Record<string, unknown>> => {
		if (table === "users_meta") return Object.values(state.users);
		// Real object references so `update()` patches actually persist.
		if (table === "settings") return Object.values(state.settings);
		return [];
	};
	const matches = (r: Record<string, unknown>) => eqs.every(([c, v]) => r[c] === v);
	const fail = () =>
		state.settingsError && table === "settings"
			? { data: null, error: { message: state.settingsError } }
			: null;

	const self: Chain = {
		then(fn) {
			const failure = fail();
			if (failure) {
				fn(failure);
				return;
			}
			if (op === "update") {
				for (const r of rows()) if (matches(r)) Object.assign(r, patch);
				fn({ data: null, error: null });
				return;
			}
			const out = rows().filter(matches);
			fn({ data: single ? (out[0] ?? null) : out, error: null });
		},
		select() {
			return self;
		},
		eq(c: string, v: unknown) {
			eqs.push([c, v]);
			return self;
		},
		order() {
			return self;
		},
		limit() {
			return self;
		},
		gte() {
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
		insert(row: Record<string, unknown>) {
			op = "insert";
			// A simulated failure is surfaced by `then()` (it checks fail()
			// first), so we simply skip persisting here.
			if (!fail()) {
				if (table === "users_meta" && row?.anon_id)
					state.users[String(row.anon_id)] = { ...(row as Record<string, unknown>) };
				if (table === "settings" && row?.key)
					state.settings[String(row.key)] = {
						key: String(row.key),
						value: (row as { value?: unknown }).value,
					};
			}
			return self;
		},
		update(p: Record<string, unknown>) {
			op = "update";
			patch = p;
			return self;
		},
		upsert() {
			return self;
		},
		delete() {
			return self;
		},
	};
	return self;
}

const from = vi.fn((t: string) => chainFor(t));
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = vi.hoisted(() => ({
	auditLog: vi.fn(),
	notifyUser: vi.fn(),
}));
vi.mock("../../api/_auth.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("../../api/_auth.js")>();
	return { ...mod, auditLog: authMocks.auditLog, notifyUser: authMocks.notifyUser };
});

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state.users = {};
	state.settings = {};
	state.settingsError = null;
});

const ID = "anon_esc_1";

function seedUser(extra: Record<string, unknown> = {}) {
	state.users[ID] = { anon_id: ID, warnings: [], strikes: 0, ...extra };
}

// ── scope matrix ────────────────────────────────────────────────

describe("scopeBlocks / surfaceCapability", () => {
	it("maps surfaces to always / feed / app capabilities", async () => {
		const { surfaceCapability } = await import("../../api/_restrictions.js");
		for (const s of ["report_create", "notification_read", "restriction_read", "presence"])
			expect(surfaceCapability(s)).toBe("always");
		for (const s of ["post_write", "comment_write", "reaction_write"])
			expect(surfaceCapability(s)).toBe("feed");
		expect(surfaceCapability("app_write")).toBe("app");
		expect(surfaceCapability("poll_write")).toBe("app");
	});

	it("full_block blocks every write surface but never the always-on set", async () => {
		const { scopeBlocks } = await import("../../api/_restrictions.js");
		for (const s of ["post_write", "comment_write", "reaction_write", "app_write", "poll_write"])
			expect(scopeBlocks("full_block", s)).toBe(true);
		for (const s of ["report_create", "notification_read", "restriction_read", "presence"])
			expect(scopeBlocks("full_block", s)).toBe(false);
	});

	it("browse_only behaves like full_block for writes (reads are ungated anyway)", async () => {
		const { scopeBlocks } = await import("../../api/_restrictions.js");
		for (const s of ["post_write", "comment_write", "reaction_write", "app_write"])
			expect(scopeBlocks("browse_only", s)).toBe(true);
		expect(scopeBlocks("browse_only", "report_create")).toBe(false);
		expect(scopeBlocks("browse_only", "presence")).toBe(false);
	});

	it("feed_only keeps the feed alive but blocks every other write", async () => {
		const { scopeBlocks } = await import("../../api/_restrictions.js");
		for (const s of ["post_write", "comment_write", "reaction_write"])
			expect(scopeBlocks("feed_only", s)).toBe(false);
		for (const s of ["app_write", "poll_write", "upload", "community_write"])
			expect(scopeBlocks("feed_only", s)).toBe(true);
		expect(scopeBlocks("feed_only", "report_create")).toBe(false);
	});

	it("FAILS CLOSED on an unknown surface at every scope", async () => {
		const { scopeBlocks } = await import("../../api/_restrictions.js");
		for (const scope of ["full_block", "browse_only", "feed_only"])
			expect(scopeBlocks(scope, "brand_new_write")).toBe(true);
		// Even a surface we forgot to tag, at the most permissive scope.
		expect(scopeBlocks("feed_only", "some_future_surface")).toBe(true);
	});

	it("FAILS CLOSED on an unknown scope for writes (always-on still allowed)", async () => {
		const { scopeBlocks } = await import("../../api/_restrictions.js");
		expect(scopeBlocks("weird_scope", "post_write")).toBe(true);
		expect(scopeBlocks("weird_scope", "app_write")).toBe(true);
		// The always-on set is scope-independent by design.
		expect(scopeBlocks("weird_scope", "report_create")).toBe(false);
	});

	it("empty / missing scope blocks writes", async () => {
		const { scopeBlocks } = await import("../../api/_restrictions.js");
		expect(scopeBlocks("", "post_write")).toBe(true);
		expect(scopeBlocks(undefined as unknown as string, "post_write")).toBe(true);
	});
});

// ── accumulation + threshold ────────────────────────────────────

describe("recordSlangViolation accumulation", () => {
	it("starts below the threshold and warns the user with the counter", async () => {
		const { recordSlangViolation, ESCALATE_AT } = await import("../../api/_escalation.js");
		expect(ESCALATE_AT).toBe(3);
		const out = await recordSlangViolation(ID, 1, { terms: ["dumb"] });
		expect(out).toMatchObject({ violations: 1, escalated: false, already_escalated: false });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"slang_violation",
			expect.stringContaining(`${ID} now at 1/3`),
		);
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			ID,
			"warning",
			expect.stringContaining("1/3"),
			expect.any(String),
		);
		// No pending escalation yet — nothing for an admin to act on.
		const { getPendingEscalations } = await import("../../api/_escalation.js");
		expect(await getPendingEscalations()).toHaveLength(0);
	});

	it("ACCUMULATES across submissions (1 → 2 → 3) and escalates on the 3rd", async () => {
		const { recordSlangViolation, getPendingEscalations, getEscalation } = await import(
			"../../api/_escalation.js"
		);

		await recordSlangViolation(ID, 1, { terms: ["dumb"] });
		await recordSlangViolation(ID, 1, { terms: ["sucks"] });
		expect(authMocks.auditLog).toHaveBeenLastCalledWith(
			"moderation",
			"slang_violation",
			expect.stringContaining("2/3"),
		);

		const third = await recordSlangViolation(ID, 1, { terms: ["bakwas"] });
		expect(third).toMatchObject({ violations: 3, escalated: true, already_escalated: false });

		// The threshold crossing is audited for the admin trail…
		expect(authMocks.auditLog).toHaveBeenLastCalledWith(
			"moderation",
			"slang_escalated",
			expect.stringContaining(ID),
		);
		// …and the USER is told a moderator is reviewing (no silent punishment).
		expect(authMocks.notifyUser).toHaveBeenLastCalledWith(
			ID,
			"warning",
			expect.stringContaining("moderator is reviewing"),
			expect.any(String),
		);

		const pending = await getPendingEscalations();
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({ anon_id: ID, violations: 3, status: "escalated" });

		const esc = await getEscalation(ID);
		expect(esc).toMatchObject({ violations: 3, status: "escalated" });
		// Terms are de-duplicated and retained for the admin's context.
		expect(esc?.terms).toEqual(expect.arrayContaining(["dumb", "sucks", "bakwas"]));
	});

	it("keeps accumulating past the threshold but does NOT re-notify the admin", async () => {
		const { recordSlangViolation, getPendingEscalations } = await import(
			"../../api/_escalation.js"
		);
		await recordSlangViolation(ID, 1, { terms: ["dumb"] });
		await recordSlangViolation(ID, 1, { terms: ["dumb"] });
		await recordSlangViolation(ID, 1, { terms: ["dumb"] }); // crossing
		authMocks.auditLog.mockClear();

		const fourth = await recordSlangViolation(ID, 1, { terms: ["dumb"] });
		expect(fourth).toMatchObject({ violations: 4, escalated: false, already_escalated: true });

		// Exactly one pending row, and no second `slang_escalated` audit.
		expect(await getPendingEscalations()).toHaveLength(1);
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"moderation",
			"slang_escalated",
			expect.any(String),
		);
		// The counter is capped so a fuzzed caller cannot inflate it.
		expect(fourth.violations).toBeLessThanOrEqual(999);
	});

	it("ignores non-anon, empty, and ADMIN ids", async () => {
		const { recordSlangViolation } = await import("../../api/_escalation.js");
		for (const id of ["", null, undefined, "ADMIN", "admin", "anonymous", "not_anon"]) {
			const out = await recordSlangViolation(id as unknown as string, 5, {});
			expect(out).toMatchObject({ violations: 0, escalated: false });
		}
		expect(authMocks.auditLog).not.toHaveBeenCalled();
	});

	it("never throws when the settings KV is down (best-effort by contract)", async () => {
		state.settingsError = "relation \"settings\" is not accessible";
		const { recordSlangViolation } = await import("../../api/_escalation.js");
		const out = await recordSlangViolation(ID, 1, { terms: ["dumb"] });
		expect(out).toMatchObject({ violations: 0, escalated: false });
	});
});

// ── admin resolution ────────────────────────────────────────────

describe("resolveEscalation", () => {
	async function escalate() {
		const { recordSlangViolation } = await import("../../api/_escalation.js");
		await recordSlangViolation(ID, 1, { terms: ["dumb"] });
		await recordSlangViolation(ID, 1, { terms: ["sucks"] });
		await recordSlangViolation(ID, 1, { terms: ["bakwas"] });
	}

	it("apply → full_block restricts the user, clears pending, audits", async () => {
		await escalate();
		const { resolveEscalation, getPendingEscalations, getEscalation } = await import(
			"../../api/_escalation.js"
		);
		const out = await resolveEscalation(ID, "apply", { scope: "full_block", by: "admin" });
		expect(out.ok).toBe(true);
		expect(out.restriction).toMatchObject({ anon_id: ID, scope: "full_block", active: true });

		expect(await getPendingEscalations()).toHaveLength(0);
		expect(await getEscalation(ID)).toMatchObject({
			status: "resolved",
			resolution: "restricted:full_block",
		});
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"escalation_applied",
			expect.stringContaining(ID),
		);
		// The user learns what happened and that they can still report.
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			ID,
			"warning",
			expect.stringContaining("restricted"),
			expect.stringContaining("report"),
		);
	});

	it("apply → feed_only keeps posting but blocks other writes", async () => {
		await escalate();
		const { resolveEscalation } = await import("../../api/_escalation.js");
		const out = await resolveEscalation(ID, "apply", { scope: "feed_only", by: "admin" });
		expect(out.restriction).toMatchObject({ scope: "feed_only", active: true });

		const { getRestriction, scopeBlocks } = await import("../../api/_restrictions.js");
		const row = await getRestriction(ID);
		expect(row?.scope).toBe("feed_only");
		expect(scopeBlocks(row!.scope, "post_write")).toBe(false);
		expect(scopeBlocks(row!.scope, "app_write")).toBe(true);
	});

	it("apply → browse_only blocks posting but keeps reporting", async () => {
		await escalate();
		const { resolveEscalation } = await import("../../api/_escalation.js");
		const out = await resolveEscalation(ID, "apply", { scope: "browse_only", by: "admin" });
		expect(out.restriction).toMatchObject({ scope: "browse_only", active: true });

		const { getRestriction, scopeBlocks } = await import("../../api/_restrictions.js");
		const row = await getRestriction(ID);
		expect(scopeBlocks(row!.scope, "comment_write")).toBe(true);
		expect(scopeBlocks(row!.scope, "report_create")).toBe(false);
	});

	it("apply defaults to full_block when the scope is bogus (fail closed)", async () => {
		await escalate();
		const { resolveEscalation } = await import("../../api/_escalation.js");
		const out = await resolveEscalation(ID, "apply", {
			scope: "not_a_scope",
			by: "admin",
		});
		expect(out.restriction).toMatchObject({ scope: "full_block" });
	});

	it("dismiss → lifts any restriction, closes pending, audits", async () => {
		await escalate();
		const { resolveEscalation, getPendingEscalations, getEscalation } = await import(
			"../../api/_escalation.js"
		);
		// Restrict first, then the admin changes their mind.
		await resolveEscalation(ID, "apply", { scope: "full_block", by: "admin" });
		authMocks.auditLog.mockClear();

		const out = await resolveEscalation(ID, "dismiss", { by: "admin" });
		expect(out).toMatchObject({ ok: true, dismissed: true });

		const { getRestriction } = await import("../../api/_restrictions.js");
		expect(await getRestriction(ID)).toBeNull();
		expect(await getPendingEscalations()).toHaveLength(0);
		expect(await getEscalation(ID)).toMatchObject({ status: "dismissed" });
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"moderation",
			"escalation_dismissed",
			expect.stringContaining(ID),
		);
		expect(authMocks.notifyUser).toHaveBeenCalledWith(
			ID,
			"info",
			expect.stringContaining("reviewed"),
			expect.any(String),
		);
	});

	it("dismiss works with no prior restriction and no escalation row", async () => {
		const { resolveEscalation } = await import("../../api/_escalation.js");
		const out = await resolveEscalation(ID, "dismiss", { by: "admin" });
		expect(out.ok).toBe(true);
	});

	it("rejects unknown actions and malformed ids", async () => {
		const { resolveEscalation } = await import("../../api/_escalation.js");
		expect((await resolveEscalation(ID, "nuke", {})).ok).toBe(false);
		expect((await resolveEscalation("", "apply", { scope: "full_block" })).ok).toBe(false);
		expect((await resolveEscalation("nope", "apply", { scope: "full_block" })).ok).toBe(false);
	});
});

// ── restriction storage helpers ─────────────────────────────────

describe("restriction storage", () => {
	it("set → list → clear round-trips, and the index never reports a lifted row", async () => {
		const { setRestriction, clearRestriction, listActiveRestrictions, getRestriction } =
			await import("../../api/_restrictions.js");

		await setRestriction("anon_a", "feed_only", { by: "admin", violations: 3 });
		await setRestriction("anon_b", "full_block", { by: "admin", violations: 5 });

		let list = await listActiveRestrictions();
		expect(list.map((r) => r.anon_id).sort()).toEqual(["anon_a", "anon_b"]);

		await clearRestriction("anon_a");
		// Stale index entry must not resurrect a cleared restriction.
		list = await listActiveRestrictions();
		expect(list.map((r) => r.anon_id)).toEqual(["anon_b"]);
		expect(await getRestriction("anon_a")).toBeNull();
		expect(await getRestriction("anon_b")).toMatchObject({ scope: "full_block" });

		await clearRestriction("anon_b");
		expect(await listActiveRestrictions()).toHaveLength(0);
	});

	it("clear returns false when there was nothing to clear", async () => {
		const { clearRestriction } = await import("../../api/_restrictions.js");
		expect(await clearRestriction("anon_never")).toBe(false);
	});

	it("normalizes the id to lowercase and rejects non-anon ids on read", async () => {
		const { setRestriction, getRestriction } = await import("../../api/_restrictions.js");
		await setRestriction("ANON_MixedCase", "feed_only", {});
		expect(await getRestriction("anon_mixedcase")).toMatchObject({ scope: "feed_only" });
		expect(await getRestriction("not_anon")).toBeNull();
	});

	it("treats an expired restriction as lifted", async () => {
		const { getRestriction } = await import("../../api/_restrictions.js");
		// Seed an already-active row whose expiry has passed — setRestriction
		// rejects past dates on write, but rows can expire while stored.
		state.settings["restriction:anon_exp"] = {
			key: "restriction:anon_exp",
			value: {
				anon_id: "anon_exp",
				level: "full_ban",
				scope: "full_block",
				active: true,
				expires_at: new Date(Date.now() - 60_000).toISOString(),
			},
		};
		expect(await getRestriction("anon_exp")).toBeNull();
	});

	it("refuses to store an expiry that is already in the past", async () => {
		const { setRestriction } = await import("../../api/_restrictions.js");
		await expect(
			setRestriction("anon_exp", "full_block", {
				expires_at: new Date(Date.now() - 60_000).toISOString(),
			}),
		).rejects.toThrow(/future/i);
	});
});

// ── checkUser enforcement (REAL _auth.js) ───────────────────────

describe("checkUser enforces restriction per surface", () => {
	async function restrict(scope: string) {
		const { setRestriction } = await import("../../api/_restrictions.js");
		await setRestriction(ID, scope, { by: "admin", violations: 3 });
	}

	it("lets an unrestricted user through every surface", async () => {
		seedUser();
		const { checkUser } = await import("../../api/_auth.js");
		for (const s of ["post_write", "comment_write", "app_write", "report_create"])
			expect((await checkUser(ID, s)).ok).toBe(true);
	});

	it("full_block → 403 with code `restricted` on writes, ok on always-on", async () => {
		seedUser();
		await restrict("full_block");
		const { checkUser } = await import("../../api/_auth.js");

		const write = await checkUser(ID, "post_write");
		expect(write.ok).toBe(false);
		expect(write.code).toBe("restricted");
		expect(write.error).toMatch(/restricted/i);

		// A sanctioned user must still be able to report and read notices.
		for (const s of ["report_create", "notification_read", "restriction_read", "presence"])
			expect((await checkUser(ID, s)).ok).toBe(true);
	});

	it("browse_only → the browsing-specific message", async () => {
		seedUser();
		await restrict("browse_only");
		const { checkUser } = await import("../../api/_auth.js");
		const out = await checkUser(ID, "comment_write");
		expect(out.ok).toBe(false);
		expect(out.error).toMatch(/browsing/i);
	});

	it("feed_only → posting allowed, other writes blocked", async () => {
		seedUser();
		await restrict("feed_only");
		const { checkUser } = await import("../../api/_auth.js");

		expect((await checkUser(ID, "post_write")).ok).toBe(true);
		expect((await checkUser(ID, "comment_write")).ok).toBe(true);
		expect((await checkUser(ID, "reaction_write")).ok).toBe(true);

		const other = await checkUser(ID, "poll_write");
		expect(other.ok).toBe(false);
		expect(other.code).toBe("restricted");
		// Untagged call sites keep the default and fail closed too.
		expect((await checkUser(ID)).ok).toBe(false);
	});

	it("unknown surface fails closed ONLY when a restriction exists", async () => {
		seedUser();
		const { checkUser } = await import("../../api/_auth.js");
		// No restriction → an untagged surface is simply ungated.
		expect((await checkUser(ID, "brand_new_write")).ok).toBe(true);

		await restrict("feed_only");
		expect((await checkUser(ID, "brand_new_write")).ok).toBe(false);
	});

	it("still enforces ban and suspension alongside a restriction", async () => {
		seedUser({ banned: true });
		await restrict("feed_only");
		const { checkUser } = await import("../../api/_auth.js");
		const out = await checkUser(ID, "report_create");
		expect(out.ok).toBe(false);
		expect(out.error).toMatch(/permanently banned/i);
	});

	it("FAILS CLOSED when the settings KV cannot be read", async () => {
		seedUser();
		await restrict("full_block");
		state.settingsError = "connection terminated";
		const { checkUser } = await import("../../api/_auth.js");
		const out = await checkUser(ID, "post_write");
		expect(out.ok).toBe(false);
		expect(out.error).toMatch(/temporarily unavailable/i);
	});

	it("skips the restriction read entirely for always-on surfaces", async () => {
		seedUser();
		await restrict("full_block");
		state.settingsError = "should not be consulted";
		const { checkUser } = await import("../../api/_auth.js");
		// The KV is broken, but always-on surfaces never touch it.
		expect((await checkUser(ID, "report_create")).ok).toBe(true);
		expect((await checkUser(ID, "presence")).ok).toBe(true);
	});

	it("rejects malformed ids before touching the database", async () => {
		const { checkUser } = await import("../../api/_auth.js");
		expect((await checkUser("")).ok).toBe(false);
		expect((await checkUser(null as unknown as string)).ok).toBe(false);
		expect((await checkUser("x".repeat(80))).ok).toBe(false);
	});
});
