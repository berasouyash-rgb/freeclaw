// ═══════════════════════════════════════════════════════════════════
// Session concurrent-mint storm — ONE mint, every winner usable.
// First-load storms fire 4-6 session-establishing requests together
// (users/me/saved/notifications/chat). Without single-flight, each mints
// its own token and all but the last two orphan past the single th_prev
// slot (proven by E2E trace: 4 distinct vb_session tokens inside ~1s,
// then a 403 presenting an evicted one) — and under total pile-up even
// th_prev never forms. The fix: concurrent first-visit mints for one id
// join a single flight and share its token (each response still carries
// its own Set-Cookie), so no sibling can orphan another. The bounded
// token-list preservation stays as defense for staggered/cross-instance
// races. The mock store answers reads from live state, so the natural
// microtask lockstep reproduces the storm shape deterministically: all
// initial reads land before any write (all see nothing), then round-trips
// serialize — exactly the production interleave, with zero timers.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
	// Storm script: concurrent first-visit mints arrive lockstepped
	// (load,load… then prev,prev… then save,save…), which piles every read
	// ahead of every write — nothing ever chains. Production round-trips
	// serialize instead, so each mint after the first sees a sibling save.
	// The gate below reproduces exactly that: the first N+1 selects pass
	// immediately (N initial loads + first prev-load), prev-loads after that
	// wait for the matching save to land, everything else passes through.
	// Set stormSize before Promise.all; beforeEach resets it.
	stormSize: 0,
	selectsSeen: 0,
	savesDone: 0,
	saveWaiters: [] as Array<{ need: number; resolve: () => void }>,
}));

function noteSave() {
	state.savesDone++;
	const ready = state.saveWaiters.filter((w) => w.need <= state.savesDone);
	state.saveWaiters = state.saveWaiters.filter((w) => w.need > state.savesDone);
	for (const w of ready) w.resolve();
}

function chainFor(table: string) {
	const eqs: Array<[string, unknown]> = [];
	let op: "select" | "upsert" = "select";
	let patch: Record<string, unknown> = {};
	const self = {
		async then(fn: (v: unknown) => void) {
			if (op === "upsert") {
				if (table === "settings")
					state.settings[String(patch.key)] = patch.value;
				noteSave();
				fn({ data: null, error: null });
				return;
			}
			state.selectsSeen++;
			const s = state.selectsSeen;
			const n = state.stormSize;
			if (n > 0 && s >= n + 2 && s <= 2 * n) {
				const need = s - n - 1;
				if (state.savesDone < need) {
					await new Promise<void>((resolve) => {
						state.saveWaiters.push({ need, resolve });
					});
				}
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

function req(id: string, cookie?: string) {
	return {
		method: "POST",
		query: {},
		body: {},
		headers: {
			"x-anon-id": id,
			...(cookie ? { cookie } : {}),
		},
		socket: { remoteAddress: "203.0.113.9" },
	};
}

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

function tokenOf(
	res: ReturnType<typeof response>,
): string | undefined {
	for (const c of (
		res.setHeader as ReturnType<typeof vi.fn>
	).mock.calls) {
		if (c[0] === "Set-Cookie") {
			const m = String(c[1]).match(/vb_session=([^;]+)/);
			if (m) return m[1];
		}
	}
	return undefined;
}

async function mint(id: string) {
	const { verifyCallerIdentity } = await import("../../api/_auth.js");
	const res = response();
	const out = (await (
		verifyCallerIdentity as (
			q: unknown,
			s: unknown,
			i: string,
		) => Promise<{ ok?: boolean; status?: number }>
	)(req(id), res, id)) as { ok?: boolean; status?: number };
	return { out, token: tokenOf(res) };
}

async function present(id: string, token: string) {
	const { verifyCallerIdentity } = await import("../../api/_auth.js");
	const res = response();
	return (await (
		verifyCallerIdentity as (
			q: unknown,
			s: unknown,
			i: string,
		) => Promise<{ ok?: boolean; status?: number }>
	)(req(id, `vb_session=${token}`), res, id)) as {
		ok?: boolean;
		status?: number;
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state.settings = {};
	state.stormSize = 0;
	state.selectsSeen = 0;
	state.savesDone = 0;
	state.saveWaiters = [];
});

describe("verifyCallerIdentity — concurrent first-visit mint storm", () => {
	it("keeps every winner usable in a 3-way storm", async () => {
		const id = "anon_qastorm3";
		state.stormSize = 3;
		const mints = await Promise.all([mint(id), mint(id), mint(id)]);
		expect(mints.every((m) => m.out.ok === true)).toBe(true);
		// Storm over: stop scripting round-trips so the verification reads
		// see live store state like production would after the burst.
		state.stormSize = 0;
		const tokens = mints.map((m) => m.token);
		expect(tokens.every(Boolean)).toBe(true);
		// Single flight: one mint total, so every sibling holds the SAME
		// token — nothing exists to orphan. (Pre-fix: 3 distinct tokens.)
		expect(new Set(tokens).size).toBe(1);
		for (const t of tokens) {
			const v = await present(id, t as string);
			expect(v.ok).toBe(true);
		}
	});

	it("keeps every winner usable in a 5-way storm", async () => {
		const id = "anon_qastorm5";
		state.stormSize = 5;
		const mints = await Promise.all([
			mint(id),
			mint(id),
			mint(id),
			mint(id),
			mint(id),
		]);
		expect(mints.every((m) => m.out.ok === true)).toBe(true);
		state.stormSize = 0;
		const tokens = mints.map((m) => m.token);
		expect(tokens.every(Boolean)).toBe(true);
		// Five-way pile-up is where th_prev alone provably orphans two
		// winners; single-flight leaves exactly one token behind.
		expect(new Set(tokens).size).toBe(1);
		for (const t of tokens) {
			const v = await present(id, t as string);
			expect(v.ok).toBe(true);
		}
	});
});
