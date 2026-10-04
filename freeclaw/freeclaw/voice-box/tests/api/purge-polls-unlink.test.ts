// ═══════════════════════════════════════════════════════════════════
// purgeExpired — unlink linked polls before deleting purged posts
// ══════════════════════════════════════════════════════ regression
// The admin hard-delete route nulls polls.post_id first (preserving the
// poll, dropping the link), but both purgeExpired sweeps deleted the post
// without unlinking — leaving polls.post_id dangling at a row the next
// read denies. The unlink must also land BEFORE the post delete: once the
// parent row is gone the sweep can never re-select it, so a failed unlink
// must abort the batch (throw) rather than orphan the link.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Filter = [string, unknown];
interface DbOp {
	table: string;
	op: string;
	patch?: unknown;
	filters: Filter[];
}
interface DbControls {
	purgeState: null | { value?: Record<string, unknown> };
	retention: { value: { user_delete_hours: number; auto_delete_enabled: boolean } };
	expiredSolved: Array<{ id: string }>;
	expiredUserDeleted: Array<{ id: string }>;
	pollsUpdateError: null | Error;
}

const db = vi.hoisted(() => ({
	ops: [] as DbOp[],
	controls: {
		purgeState: null,
		retention: { value: { user_delete_hours: 5, auto_delete_enabled: true } },
		expiredSolved: [{ id: "px-old" }],
		expiredUserDeleted: [{ id: "ux-old" }],
		pollsUpdateError: null,
	} as DbControls,
}));

function chainFor(table: string) {
	const state = { op: "select", patch: undefined as unknown, filters: [] as Filter[] };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const chain: any = {
		select() {
			return chain;
		},
		eq(col: unknown, val: unknown) {
			if (typeof col === "string") state.filters.push([col, val]);
			return chain;
		},
		in(col: unknown, val: unknown) {
			if (typeof col === "string") state.filters.push([col, val]);
			return chain;
		},
		lt(col: unknown, val: unknown) {
			if (typeof col === "string") state.filters.push([col, val]);
			return chain;
		},
		order() {
			return chain;
		},
		limit() {
			return chain;
		},
		maybeSingle() {
			state.op = "maybeSingle";
			return chain;
		},
		update(patch: unknown) {
			state.op = "update";
			state.patch = patch;
			return chain;
		},
		delete() {
			state.op = "delete";
			return chain;
		},
		upsert() {
			state.op = "upsert";
			return chain;
		},
		then(resolve: (value: unknown) => void) {
			if (state.op === "maybeSingle") {
				const key = state.filters.find(([c]) => c === "key")?.[1];
				const row =
					key === "purge_state"
						? db.controls.purgeState
						: key === "retention_config"
							? db.controls.retention
							: null;
				resolve({ data: row, error: null });
				return;
			}
			if (state.op === "update") {
				db.ops.push({
					table,
					op: "update",
					patch: state.patch,
					filters: [...state.filters],
				});
				resolve({
					data: null,
					error: table === "polls" ? db.controls.pollsUpdateError : null,
				});
				return;
			}
			if (state.op === "delete") {
				db.ops.push({ table, op: "delete", filters: [...state.filters] });
				resolve({ data: [], error: null });
				return;
			}
			if (state.op === "upsert") {
				resolve({ data: null, error: null });
				return;
			}
			if (table === "posts") {
				const rows = state.filters.some(([c]) => c === "deleted")
					? db.controls.expiredUserDeleted
					: db.controls.expiredSolved;
				resolve({ data: rows, error: null });
				return;
			}
			resolve({ data: [], error: null });
		},
	};
	return chain;
}

const from = vi.fn((table: string) => chainFor(table));

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => true),
	checkUser: vi.fn(async () => ({ ok: true })),
	clean: (s: unknown) => String(s ?? ""),
	clientIp: () => "test",
	cors: vi.fn(),
	ensureUser: vi.fn(),
	isAdmin: vi.fn(async () => false),
	maskProfanity: (s: unknown) => String(s ?? ""),
	notifyUser: vi.fn(),
	rateLimited: vi.fn(async () => false),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: () => false,
}));
vi.mock("../../api/_cache.js", () => ({
	staleWhileRevalidate: (fn: unknown) => fn,
}));
vi.mock("../../api/_counts.js", () => ({
	getRawCounts: vi.fn(async () => ({})),
	invalidateCounts: vi.fn(),
}));
vi.mock("../../api/_safety-pipeline.js", () => ({
	evaluateContentDeep: vi.fn(),
	messageFor: vi.fn(),
}));
vi.mock("../../api/_reports.js", () => ({
	strikeSlangAbuse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_events.js", () => ({
	EVENT_TYPES: {},
	emitEventAndBridge: vi.fn(async () => {}),
}));
vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(async () => {}),
}));
vi.mock("../../api/_email.js", () => ({
	sendPostSolvedEmail: vi.fn(async () => {}),
}));
vi.mock("../../api/_moderation.js", () => ({
	getLearnedWeakStats: vi.fn(),
	recordModerationDecision: vi.fn(),
	recordSafetyRepost: vi.fn(),
	checkSafetyRepost: vi.fn(),
	spamAnalyze: vi.fn(),
	getSpamConfig: vi.fn(),
}));

let consoleSpy: ReturnType<typeof vi.spyOn>;

async function loadPurgeExpired() {
	vi.resetModules();
	const mod = await import("../../api/_posts.js");
	return mod.purgeExpired as () => Promise<{ purged: number; skipped: boolean }>;
}

beforeEach(async () => {
	consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	db.ops.length = 0;
	db.controls.purgeState = null;
	db.controls.retention = {
		value: { user_delete_hours: 5, auto_delete_enabled: true },
	};
	db.controls.expiredSolved = [{ id: "px-old" }];
	db.controls.expiredUserDeleted = [{ id: "ux-old" }];
	db.controls.pollsUpdateError = null;
});

afterEach(() => {
	consoleSpy.mockRestore();
});

describe("purgeExpired — linked polls are unlinked before the post delete", () => {
	it("nulls polls.post_id for both sweeps before deleting the parent posts", async () => {
		const purgeExpired = await loadPurgeExpired();
		const result = await purgeExpired();

		expect(result).toEqual({ purged: 2, skipped: false });
		const unlinks = db.ops.filter(
			(o) =>
				o.table === "polls" &&
				o.op === "update" &&
				(o.patch as { post_id?: unknown } | undefined)?.post_id === null,
		);
		expect(
			unlinks.map((o) => o.filters),
			"both sweeps must unlink their ids",
		).toEqual([[["post_id", ["px-old"]]], [["post_id", ["ux-old"]]]]);

		const postDeletes = db.ops
			.map((o, i) => ({ o, i }))
			.filter(({ o }) => o.table === "posts" && o.op === "delete")
			.map(({ i }) => i);
		const unlinkIdx = db.ops
			.map((o, i) => ({ o, i }))
			.filter(({ o }) => unlinks.includes(o))
			.map(({ i }) => i);
		expect(postDeletes.length).toBe(2);
		expect(
			unlinkIdx[0] < postDeletes[0] && unlinkIdx[1] < postDeletes[1],
			"each unlink must precede its sweep's post delete",
		).toBe(true);
	});

	it("aborts the batch when the unlink fails so the link can never orphan", async () => {
		db.controls.expiredSolved = [{ id: "px-fail" }];
		db.controls.expiredUserDeleted = [];
		db.controls.pollsUpdateError = new Error("polls unlink failed");
		const purgeExpired = await loadPurgeExpired();

		await expect(purgeExpired()).rejects.toThrow("polls unlink failed");
		expect(
			db.ops.some((o) => o.table === "posts" && o.op === "delete"),
			"no parent row may be removed after a failed unlink",
		).toBe(false);
	});
});
