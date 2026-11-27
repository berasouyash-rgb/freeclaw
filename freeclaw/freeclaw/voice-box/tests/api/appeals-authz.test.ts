// ═══════════════════════════════════════════════════════════════════
// Appeals API — authorization contract (the surface that lifts bans)
// ═══════════════════════════════════════════════════════════════════
// Appeals decide whether a ban/suspension is overturned. `_appeals.js` had
// no 403/401 authorization test at all, so its gates were unverified at
// runtime even though a static read showed them to be in the right places.
//
// Contract locked here:
//   1. PUT (uphold | overturn) is admin-only — a user cannot lift their own
//      ban by calling the review endpoint directly.
//   2. GET without an admin token returns ONLY the caller's own appeals —
//      no cross-user leak of another person's case.
//   3. GET with neither an admin token nor an anon id is refused.
//   4. POST can only FILE an appeal (it must never resolve one) and only for
//      the caller's own author_id.
//   5. An admin review still succeeds (the gate is not a blanket deny).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	appeals: [] as Array<Record<string, unknown>>,
	writes: [] as Array<Record<string, unknown>>,
	listArgs: [] as Array<Record<string, unknown>>,
}));

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	notifyUser: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	cors: vi.fn(),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
	ensureUser: vi.fn(async () => undefined),
}));
vi.mock("../../api/_auth.js", () => authMocks);

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

// Appeals are stored as settings-KV rows `appeal:<id>`. The mock below is a
// faithful stand-in for that store: select/eq/maybeSingle, like(prefix), and
// upsert. Writes are recorded so a test can prove nothing was mutated.
const PREFIX = "appeal:";
const kv = vi.hoisted(() => new Map<string, unknown>());
// publishOverturn writes the vindicated content and then RE-READS it to
// verify (it fails closed if the row is not readable). The stand-in must
// therefore actually persist non-settings inserts, or the handler correctly
// reports "not readable after insert".
const tables = vi.hoisted(() => new Map<string, Map<string, unknown>>());

const from = vi.fn((table: string) => {
	const filters: Array<[string, unknown]> = [];
	let likePrefix: string | null = null;
	let op: "select" | "upsert" | "insert" = "select";
	let row: Record<string, unknown> | null = null;
	const store = () => {
		let s = tables.get(table);
		if (!s) {
			s = new Map();
			tables.set(table, s);
		}
		return s;
	};
	const self: Record<string, unknown> = {
		then(fn: (v: unknown) => void) {
			if (op === "upsert" || op === "insert") {
				const id = String(row?.id ?? row?.key);
				store().set(id, row);
				if (table === "settings") kv.set(String(row?.key), row?.value);
				fn({ data: null, error: null });
				return;
			}
			if (table === "settings") {
				if (likePrefix) {
					const prefix = likePrefix.replace(/%$/, "");
					const data = [...kv.entries()]
						.filter(([k]) => k.startsWith(prefix))
						.map(([key, value]) => ({ key, value }));
					fn({ data, error: null });
					return;
				}
				const key = filters.find(([c]) => c === "key")?.[1] as
					| string
					| undefined;
				fn({
					data: key === undefined ? null : { key, value: kv.get(key) },
					error: null,
				});
				return;
			}
			// Read-back for the post/comment that was just published.
			const id = filters.find(([c]) => c === "id")?.[1] as string | undefined;
			const found = id !== undefined ? store().get(id) : undefined;
			fn({ data: found ?? null, error: null });
		},
		select: () => self,
		like: (_col: string, pattern: string) => {
			likePrefix = pattern;
			return self;
		},
		upsert: (r: Record<string, unknown>) => {
			op = "upsert";
			row = r;
			return self;
		},
		insert: (r: Record<string, unknown>) => {
			op = "insert";
			row = r;
			return self;
		},
		eq: (col: string, val: unknown) => {
			filters.push([col, val]);
			return self;
		},
		maybeSingle: () => self,
		single: () => self,
	};
	return self;
});
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContent: vi.fn(() => ({ flags: [] })),
}));
vi.mock("../../api/_moderation.js", () => ({
	checkSafetyRepost: vi.fn(async () => ({ blocked: false })),
	clearSafetyRepost: vi.fn(async () => undefined),
	fingerprintSafetyText: (s: string) => `fp:${String(s ?? "").trim()}`,
	recordModerationDecision: vi.fn(async () => undefined),
}));
vi.mock("../../api/_polls.js", () => ({ createPoll: vi.fn(async () => ({ id: "p1" })) }));

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
		setHeader() {
			return res;
		},
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
	};
	return res;
}

async function call(req: Record<string, unknown>) {
	const { default: handler } = await import("../../api/_appeals.js");
	const res = response();
	await handler(
		{ method: "GET", query: {}, body: {}, headers: {}, ...req },
		res,
	);
	return res;
}

const OPEN_APPEAL = {
	id: "apl_1",
	author_id: "anon_victim",
	surface: "post",
	title: "Please review",
	body: "I did not do this",
	status: "open",
	created_at: "2026-09-01T00:00:00.000Z",
};

function seed(...appeals: Array<Record<string, unknown>>) {
	kv.clear();
	tables.clear();
	for (const a of appeals) kv.set(`${PREFIX}${String(a.id)}`, a);
}

beforeEach(() => {
	vi.clearAllMocks();
	state.writes = [];
	seed({ ...OPEN_APPEAL });
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.auditLog.mockResolvedValue(undefined);
	authMocks.notifyUser.mockResolvedValue(undefined);
});

/** Current stored status of an appeal id. */
const statusOf = (id: string) =>
	(kv.get(`${PREFIX}${id}`) as { status?: string } | undefined)?.status;

describe("PUT /api/appeals — only an admin may resolve an appeal", () => {
	it("refuses a non-admin overturn (a user must not lift their own ban)", async () => {
		const res = await call({
			method: "PUT",
			headers: { "x-anon-id": "anon_victim" },
			body: { id: "apl_1", decision: "overturn" },
		});
		expect([401, 403]).toContain(res.statusCode);
		// Untouched: the appeal is still open.
		expect(statusOf("apl_1")).toBe("open");
	});

	it("refuses a caller with no token at all", async () => {
		const res = await call({
			method: "PUT",
			body: { id: "apl_1", decision: "overturn" },
		});
		expect([401, 403]).toContain(res.statusCode);
		expect(statusOf("apl_1")).toBe("open");
	});

	it("lets an admin overturn", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const res = await call({
			method: "PUT",
			headers: { "x-admin-token": "tok" },
			body: { id: "apl_1", decision: "overturn" },
		});
		expect(res.statusCode).toBe(200);
		expect(statusOf("apl_1")).toBe("overturned");
	});
});

describe("GET /api/appeals — a user sees only their own cases", () => {
	it("scopes a non-admin read to the caller's own author_id", async () => {
		seed(
			{ ...OPEN_APPEAL, id: "apl_mine", author_id: "anon_me" },
			{ ...OPEN_APPEAL, id: "apl_theirs", author_id: "anon_someone_else" },
		);
		const res = await call({
			method: "GET",
			headers: { "x-anon-id": "anon_me" },
		});
		expect(res.statusCode).toBe(200);
		const ids = (res.body as { items: Array<{ id: string }> }).items.map(
			(i) => i.id,
		);
		expect(ids).toEqual(["apl_mine"]);
	});

	it("refuses a read with neither an admin token nor an anon id", async () => {
		const res = await call({ method: "GET", headers: {} });
		expect([401, 403]).toContain(res.statusCode);
	});
});

describe("POST /api/appeals — filing only", () => {
	it("refuses filing an appeal on behalf of another user", async () => {
		const res = await call({
			method: "POST",
			headers: { "x-anon-id": "anon_me" },
			body: {
				author_id: "anon_someone_else",
				surface: "post",
				title: "not mine",
				body: "please help",
			},
		});
		expect(res.statusCode).toBe(403);
		expect(kv.size).toBe(1); // no new appeal row was created
	});

	it("never resolves an appeal through POST", async () => {
		const res = await call({
			method: "POST",
			headers: { "x-anon-id": "anon_victim" },
			body: {
				author_id: "anon_victim",
				surface: "post",
				title: "bump",
				body: "please review",
				status: "overturned",
			},
		});
		// Filed at most — and never with a caller-chosen resolved status.
		if (res.statusCode === 201) {
			expect(statusOf(String((res.body as { id: string }).id))).toBe("open");
		} else {
			expect([200, 429]).toContain(res.statusCode);
		}
	});
});
