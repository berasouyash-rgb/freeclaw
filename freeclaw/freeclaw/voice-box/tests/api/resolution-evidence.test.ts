// Resolution evidence — GET /api/resolution-evidence?post_id=X answers
// "did the fix actually work?" from database rows, never from a story.
// Locks:
//   1. Supported: nothing open resembling it, no new complaints after.
//   2. Recurrence: an open lookalike exists (with links), or complaints kept pace.
//   3. Watch: some new complaints, fewer than before.
//   4. Open (unsolved) posts report state "open", never a verdict.
//   5. Private / hidden / pending neighbours never leak into evidence.
//   6. Missing id → 400; unknown post → 404.
import { beforeEach, describe, expect, it, vi } from "vitest";

const SOLVED_AT = "2026-09-10T00:00:00.000Z";

function postRow(over: Record<string, unknown> = {}) {
	return {
		id: "p-solved",
		title: "Water cooler broken second floor",
		category: "Facilities",
		status: "solved",
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: SOLVED_AT,
		status_history: [
			{ status: "reported", at: "2026-09-01T00:00:00.000Z" },
			{ status: "solved", at: SOLVED_AT },
		],
		deleted: false,
		hidden: false,
		visibility: "public",
		...over,
	};
}

const state = vi.hoisted(() => ({
	post: null as Record<string, unknown> | null,
	neighbours: [] as Array<Record<string, unknown>>,
	comments: [] as Array<Record<string, unknown>>,
	postsCalls: 0,
}));

function chainFor(rows: Array<Record<string, unknown>>) {
	let out = [...rows];
	let single = false;
	const self: Record<string, (...a: never[]) => unknown> = {};
	self.select = () => self;
	self.select = () => self;
	self.eq = ((col: string, val: unknown) => {
		out = out.filter((r) => r[col] === val);
		return self;
	}) as (...a: never[]) => unknown;
	self.neq = ((col: string, val: unknown) => {
		out = out.filter((r) => r[col] !== val);
		return self;
	}) as (...a: never[]) => unknown;
	self.gte = ((col: string, val: unknown) => {
		out = out.filter((r) => String(r[col]) >= String(val));
		return self;
	}) as (...a: never[]) => unknown;
	self.order = () => self;
	self.limit = ((n: number) => {
		out = out.slice(0, n);
		return self;
	}) as (...a: never[]) => unknown;
	self.maybeSingle = () => {
		single = true;
		return self;
	};
	self.single = () => {
		single = true;
		return self;
	};
	self.then = (resolve: (v: unknown) => void) => {
		resolve({ data: single ? (out[0] ?? null) : out, error: null });
	};
	return self;
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			// Call order in the handler: post (single), neighbours, comments.
			if (table === "posts") {
				state.postsCalls++;
				if (state.postsCalls === 1)
					return chainFor(state.post ? [state.post] : []);
				return chainFor(state.neighbours);
			}
			if (table === "comments") return chainFor(state.comments);
			return chainFor([]);
		},
	},
}));

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
		setHeader: vi.fn(),
	});
}

async function get(postId: string | undefined) {
	vi.resetModules();
	state.postsCalls = 0;
	const { default: handler } = await import("../../api/_resolution-evidence.js");
	const res = response();
	await handler(
		{ method: "GET", query: postId === undefined ? {} : { post_id: postId }, headers: {} },
		res as never,
	);
	return res;
}

beforeEach(() => {
	state.postsCalls = 0;
	state.post = postRow();
	state.neighbours = [];
	state.comments = [];
});

describe("GET /api/resolution-evidence", () => {
	it("reports supported when nothing followed the fix", async () => {
		const res = await get("p-solved");
		expect(res.statusCode).toBe(200);
		const b = res.body as Record<string, unknown>;
		expect(b.verdict).toBe("supported");
		expect(b.complaints_before).toBe(0);
		expect(b.complaints_after).toBe(0);
		expect(b.related_open).toEqual([]);
	});

	it("reports recurrence when an open lookalike exists, with links", async () => {
		state.neighbours = [
			{
				id: "p-new",
				category: "Facilities",
				title: "Water cooler second floor still broken",
				status: "reported",
				created_at: "2026-09-12T00:00:00.000Z",
				deleted: false,
				hidden: false,
				visibility: "public",
			},
		];
		const res = await get("p-solved");
		const b = res.body as Record<string, unknown>;
		expect(b.verdict).toBe("recurrence");
		expect(
			(b.related_open as Array<{ id: string }>).map((r) => r.id),
		).toContain("p-new");
	});

	it("reports watch when a few new complaints trail off", async () => {
		state.neighbours = [
			{
				id: "old-1",
				category: "Facilities",
				title: "Older facilities issue one",
				status: "solved",
				created_at: "2026-09-02T00:00:00.000Z",
				deleted: false,
				hidden: false,
				visibility: "public",
			},
			{
				id: "old-2",
				category: "Facilities",
				title: "Older facilities issue two",
				status: "solved",
				created_at: "2026-09-03T00:00:00.000Z",
				deleted: false,
				hidden: false,
				visibility: "public",
			},
			{
				id: "new-1",
				category: "Facilities",
				title: "Newer facilities issue three",
				status: "reported",
				created_at: "2026-09-12T00:00:00.000Z",
				deleted: false,
				hidden: false,
				visibility: "public",
			},
		];
		const res = await get("p-solved");
		const b = res.body as Record<string, unknown>;
		// 2 before, 1 after, no lookalike → watch.
		expect(b.complaints_before).toBe(2);
		expect(b.complaints_after).toBe(1);
		expect(b.verdict).toBe("watch");
	});

	it("reports state open for unsolved posts, never a verdict", async () => {
		state.post = postRow({ id: "p-open", status: "reported", status_history: [] });
		const res = await get("p-open");
		const b = res.body as Record<string, unknown>;
		expect(b.verdict).toBe("open");
		expect(b.solved_at).toBeNull();
	});

	it("never counts private, hidden, or pending neighbours", async () => {
		state.neighbours = [
			{ id: "x-priv", category: "Facilities", title: "Water cooler broken second floor", status: "reported", created_at: "2026-09-12T00:00:00.000Z", visibility: "private", deleted: false, hidden: false },
			{ id: "x-hid", category: "Facilities", title: "Water cooler broken second floor", status: "reported", created_at: "2026-09-12T00:00:00.000Z", visibility: "public", deleted: false, hidden: true },
			{ id: "x-pend", category: "Facilities", title: "Water cooler broken second floor", status: "pending_review", created_at: "2026-09-12T00:00:00.000Z", visibility: "public", deleted: false, hidden: false },
		];
		const res = await get("p-solved");
		const b = res.body as Record<string, unknown>;
		expect(b.complaints_after).toBe(0);
		expect(b.verdict).toBe("supported");
	});

	it("400s without an id and 404s on unknown posts", async () => {
		expect((await get(undefined)).statusCode).toBe(400);
		state.post = null;
		expect((await get("nope")).statusCode).toBe(404);
	});
});
