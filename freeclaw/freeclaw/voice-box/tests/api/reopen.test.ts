// Reopening worker — a solved case with a matching fresh report reopens
// exactly once, and ONLY counts as reopened when an independent read-back
// confirms the status change landed. A failed or swallowed write is reported
// as unverified (never as success) and left retryable (no seen marker).
//
// The fake below is a small in-memory table: `posts` supports the filtered
// selects and the `.update().eq()` the worker issues, and `settings` backs the
// seen/alerts ledger. Read-back therefore observes the real mutation, so a
// swallowed write genuinely fails verification.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAudit } = vi.hoisted(() => ({
	mockAudit: vi.fn(async () => {}),
}));

vi.mock("../../api/_db-client.js", () => ({ default: {} }));

vi.mock("../../api/_auth.js", () => ({
	auditLog: mockAudit,
}));

import { checkReopen, verifyReopen } from "../../api/_reopen.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();

type Row = Record<string, unknown>;

interface FakeState {
	posts: Row[];
	settings: Map<string, unknown>;
	failPostsWrite?: boolean;
	swallowPostsWrite?: boolean;
}

function makeClient(state: FakeState) {
	const postsQuery = () => {
		const filters: Array<(r: Row) => boolean> = [];
		let mode: "select" | "update" = "select";
		let patch: Row | null = null;
		let limitN = Infinity;
		const match = () => state.posts.filter((r) => filters.every((f) => f(r)));
		const q: Record<string, unknown> = {};
		q.select = () => q;
		q.update = (p: Row) => {
			mode = "update";
			patch = p;
			return q;
		};
		q.eq = (col: string, val: unknown) => {
			filters.push((r) => r[col] === val);
			return q;
		};
		q.neq = (col: string, val: unknown) => {
			filters.push((r) => r[col] !== val);
			return q;
		};
		q.in = (col: string, arr: unknown[]) => {
			filters.push((r) => arr.includes(r[col]));
			return q;
		};
		q.gte = (col: string, val: unknown) => {
			filters.push((r) => (r[col] as string) >= (val as string));
			return q;
		};
		q.lt = (col: string, val: unknown) => {
			filters.push((r) => (r[col] as string) < (val as string));
			return q;
		};
		q.not = () => q;
		q.order = () => q;
		q.limit = (n: number) => {
			limitN = n;
			return q;
		};
		q.maybeSingle = async () => ({ data: match()[0] ?? null, error: null });
		q.then = (
			resolve: (v: unknown) => void,
			reject?: (e: unknown) => void,
		) => {
			const run = () => {
				if (mode === "update") {
					if (state.failPostsWrite) {
						return { error: { message: "write failed" }, data: null };
					}
					if (!state.swallowPostsWrite && patch) {
						for (const r of match()) Object.assign(r, patch);
					}
					return { error: null, data: null };
				}
				return {
					error: null,
					data: limitN === Infinity ? match() : match().slice(0, limitN),
				};
			};
			return Promise.resolve(run()).then(resolve, reject);
		};
		return q;
	};

	const settingsQuery = () => {
		let key: string | null = null;
		const q: Record<string, unknown> = {};
		q.select = () => q;
		q.eq = (col: string, val: string) => {
			if (col === "key") key = val;
			return q;
		};
		q.maybeSingle = async () => ({
			data:
				key !== null && state.settings.has(key)
					? { value: state.settings.get(key) }
					: null,
		});
		q.upsert = async (row: { key: string; value: unknown }) => {
			state.settings.set(row.key, row.value);
			return { error: null };
		};
		return q;
	};

	return {
		from: (name: string) =>
			name === "settings" ? settingsQuery() : postsQuery(),
	};
}

const freshRow = (over: Row = {}): Row => ({
	id: "new1",
	title: "Canteen food has insects",
	description: "Found insects in the rice today in canteen lunch",
	category: "Food",
	status: "reported",
	created_at: new Date(NOW - 3600 * 1000).toISOString(),
	deleted: false,
	hidden: false,
	archived: false,
	...over,
});

const solvedRow = (over: Row = {}): Row => ({
	id: "old9",
	title: "Insects in canteen food",
	description: "Insects found in canteen rice served at lunch",
	category: "Food",
	status: "solved",
	created_at: new Date(NOW - 10 * 24 * 3600 * 1000).toISOString(),
	status_history: [],
	deleted: false,
	...over,
});

const unrelatedRow = (over: Row = {}): Row => ({
	id: "old8",
	title: "Broken library chairs",
	description: "Chairs in the reading room need repair",
	category: "Facilities",
	status: "solved",
	created_at: new Date(NOW - 9 * 24 * 3600 * 1000).toISOString(),
	status_history: [],
	deleted: false,
	...over,
});

let state: FakeState;
let client: ReturnType<typeof makeClient>;

beforeEach(() => {
	vi.clearAllMocks();
	state = { posts: [], settings: new Map() };
	client = makeClient(state);
});

describe("checkReopen — verified reopen", () => {
	it("reopens the best matching solved case only after read-back confirms it", async () => {
		state.posts = [freshRow(), solvedRow(), unrelatedRow()];
		const r = await checkReopen(client as never, NOW);
		expect(r.ok).toBe(true);
		expect(r.reopened).toHaveLength(1);
		expect(r.reopened[0].reopened_id).toBe("old9");
		expect(r.reopened[0].similarity).toBeGreaterThanOrEqual(60);
		expect(r.unverified).toHaveLength(0);
		// independent fact: the target row actually changed in the store
		expect(state.posts.find((p) => p.id === "old9")?.status).toBe(
			"in_progress",
		);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		expect(state.settings.get("reopen_seen:new1")).toBeTruthy();
	});

	it("never re-triggers for an already evaluated post", async () => {
		state.posts = [freshRow(), solvedRow()];
		state.settings.set("reopen_seen:new1", {
			matched: "old9",
			similarity: 80,
		});
		const r = await checkReopen(client as never, NOW);
		expect(r.reopened).toHaveLength(0);
		expect(state.posts.find((p) => p.id === "old9")?.status).toBe("solved");
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("leaves closed cases alone on weak similarity", async () => {
		state.posts = [
			freshRow({
				id: "new2",
				title: "Library timing query",
				description: "When does the library open on Sundays",
				category: "Library",
			}),
			solvedRow(),
		];
		const r = await checkReopen(client as never, NOW);
		expect(r.reopened).toHaveLength(0);
		expect(state.posts.find((p) => p.id === "old9")?.status).toBe("solved");
		expect(state.settings.get("reopen_seen:new2")).toBeTruthy();
	});
});

describe("checkReopen — refuses to claim an unverified reopen", () => {
	it("reports unverified, writes no audit, and stays retryable when the update errors", async () => {
		state.posts = [freshRow(), solvedRow()];
		state.failPostsWrite = true;
		const r = await checkReopen(client as never, NOW);
		expect(r.reopened).toHaveLength(0);
		expect(r.unverified).toHaveLength(1);
		expect(r.unverified[0].reopened_id).toBe("old9");
		expect(state.posts.find((p) => p.id === "old9")?.status).toBe("solved");
		expect(mockAudit).not.toHaveBeenCalled();
		// retryable: the seen marker was NOT written
		expect(state.settings.has("reopen_seen:new1")).toBe(false);
	});

	it("reports unverified when the write is swallowed (read-back shows no change)", async () => {
		state.posts = [freshRow(), solvedRow()];
		state.swallowPostsWrite = true;
		const r = await checkReopen(client as never, NOW);
		expect(r.reopened).toHaveLength(0);
		expect(r.unverified).toHaveLength(1);
		expect(String(r.unverified[0].reason)).toMatch(/read-back/);
		expect(mockAudit).not.toHaveBeenCalled();
		expect(state.settings.has("reopen_seen:new1")).toBe(false);
	});
});

describe("verifyReopen", () => {
	it("is true only when status is in_progress and history names the new report", async () => {
		state.posts = [
			solvedRow({
				status: "in_progress",
				status_history: [
					{
						status: "in_progress",
						note: "Auto-reopened: matching new report new1 (80% similar)",
					},
				],
			}),
		];
		await expect(verifyReopen(client as never, "old9", "new1")).resolves.toBe(
			true,
		);
	});

	it("is false when the status did not change", async () => {
		state.posts = [solvedRow()];
		await expect(verifyReopen(client as never, "old9", "new1")).resolves.toBe(
			false,
		);
	});

	it("is false when the row is missing", async () => {
		state.posts = [];
		await expect(verifyReopen(client as never, "old9", "new1")).resolves.toBe(
			false,
		);
	});
});
