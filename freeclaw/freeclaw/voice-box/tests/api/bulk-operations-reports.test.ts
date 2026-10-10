// ═══════════════════════════════════════════════════════════════════
// Bulk operations — report status vocabulary contract
// ═══════════════════════════════════════════════════════════════════
// REGRESSION (user-reported): "Where the admin reject the approval … showing
// it is the problem is solved Why?"
//
// `api/_bulk-operations.js` defined `reports.resolve` as
// `update({ status: "solved" })` — a POST status written into the REPORTS
// table. Reports use a different vocabulary everywhere else:
//
//   api/_reports.js:533   update({ status: … || "resolved" })
//   api/_reports.js:544   if ((data?.status || "resolved") === "resolved")
//   src/.../Reports.tsx   openReports  = status !== "resolved"
//                         resolvedReports = status === "resolved"
//
// `reports.status` is a free-text column, so "solved" is accepted silently.
// Consequences of the bug:
//   1. A bulk-resolved report never reaches the Resolved section — it stays in
//      `openReports` because its status is not "resolved", so the admin
//      resolves reports in bulk and they appear to come back.
//   2. Anywhere a status→label map is used it renders as "Solved" (green),
//      which is exactly the "why is this problem Sololed?" confusion reported.
//   3. `reports.status` validated the POST vocabulary
//      ["reported","in_progress","solved","archived"], letting an admin write
//      statuses that do not exist for a report ("in_progress", "reported").
//
// Contract:
//   1. `reports.resolve` writes "resolved" — the one status the platform reads.
//   2. `reports.status` only accepts the REPORT vocabulary.
//   3. A rejected/invalid status is refused rather than written.
//   4. The POST vocabulary must never be written to the reports table.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
}));

const from = vi.fn((table: string) => {
	let patch: Record<string, unknown> | null = null;
	const self: Record<string, unknown> = {
		then(fn: (v: unknown) => void) {
			if (patch) state.updates.push({ table, patch: { ...patch } });
			fn({ data: [{ id: "r1" }], error: null });
		},
		update: (p: Record<string, unknown>) => {
			patch = p;
			return self;
		},
		in: () => self,
		select: () => self,
	};
	return self;
});

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../api/_events.js", () => ({ emitEvent: vi.fn(async () => undefined) }));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

async function call(body: Record<string, unknown>) {
	const { default: handler } = await import("../../api/_bulk-operations.js");
	const res = response();
	await handler(
		{ method: "POST", query: {}, body, headers: { "x-admin-token": "tok" } },
		res,
	);
	return res;
}

const lastReportUpdate = () =>
	state.updates.filter((u) => u.table === "reports").at(-1);

beforeEach(() => {
	vi.clearAllMocks();
	state.updates = [];
});

describe("POST /api/bulk-operations — reports.resolve", () => {
	it("writes the report status the platform actually reads: resolved", async () => {
		await call({
			resource: "reports",
			ids: ["r1"],
			action: "resolve",
			params: { reason: "verified fixed" },
		});
		const update = lastReportUpdate();
		expect(update?.patch.status).toBe("resolved");
	});

	it("never writes a post status into the reports table", async () => {
		await call({
			resource: "reports",
			ids: ["r1"],
			action: "resolve",
			params: { reason: "verified fixed" },
		});
		const status = lastReportUpdate()?.patch.status;
		expect(["reported", "in_progress", "solved"]).not.toContain(status);
	});
});

describe("POST /api/bulk-operations — users.status vocabulary", () => {
	it("refuses an unknown status instead of writing an empty patch", async () => {
		const res = await call({
			resource: "users",
			ids: ["anon_1"],
			action: "status",
			params: { status: "banned" },
		});
		expect(res.statusCode).toBe(400);
		// No write at all — previously an empty-patch update reported success.
		expect(
			state.updates.filter((u) => u.table === "users_meta"),
		).toHaveLength(0);
	});

	// The dangerous one: a "suspended" with no date wrote
	// suspended_until = null, which LIFTS an existing suspension (checkUser
	// only blocks when suspended_until > now) while reporting the user as
	// processed. A bulk "suspend" silently un-suspended banned-by-date users.
	it("refuses to suspend without an end date rather than clearing it", async () => {
		const res = await call({
			resource: "users",
			ids: ["anon_1"],
			action: "status",
			params: { status: "suspended" },
		});
		expect(res.statusCode).toBe(400);
		const writes = state.updates.filter((u) => u.table === "users_meta");
		expect(writes).toHaveLength(0);
		// Specifically: it must never write a null suspension.
		expect(
			writes.some((w) => w.patch.suspended_until === null),
		).toBe(false);
	});

	it("refuses a suspension date in the past", async () => {
		const res = await call({
			resource: "users",
			ids: ["anon_1"],
			action: "status",
			params: { status: "suspended", until: "2000-01-01T00:00:00.000Z" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("suspends with a real end date", async () => {
		const until = new Date(Date.now() + 7 * 864e5).toISOString();
		const res = await call({
			resource: "users",
			ids: ["anon_1"],
			action: "status",
			params: { status: "suspended", until },
		});
		expect(res.statusCode).toBe(200);
		const write = state.updates
			.filter((u) => u.table === "users_meta")
			.at(-1);
		expect(write?.patch.suspended_until).toBe(until);
	});

	it("unsuspends with status=active", async () => {
		const res = await call({
			resource: "users",
			ids: ["anon_1"],
			action: "status",
			params: { status: "active" },
		});
		expect(res.statusCode).toBe(200);
		const write = state.updates
			.filter((u) => u.table === "users_meta")
			.at(-1);
		expect(write?.patch.suspended_until).toBeNull();
	});
});

describe("POST /api/bulk-operations — reports.status vocabulary", () => {
	it("accepts resolved", async () => {
		const res = await call({
			resource: "reports",
			ids: ["r1"],
			action: "status",
			params: { status: "resolved" },
		});
		expect(res.statusCode).toBe(200);
		expect(lastReportUpdate()?.patch.status).toBe("resolved");
	});

	it("refuses a post-only status (in_progress) on a report", async () => {
		const res = await call({
			resource: "reports",
			ids: ["r1"],
			action: "status",
			params: { status: "in_progress" },
		});
		expect(res.statusCode).toBe(400);
		expect(lastReportUpdate()).toBeUndefined();
	});

	it("refuses 'solved' on a report — that is the bug this locks", async () => {
		const res = await call({
			resource: "reports",
			ids: ["r1"],
			action: "status",
			params: { status: "solved" },
		});
		expect(res.statusCode).toBe(400);
		expect(lastReportUpdate()).toBeUndefined();
	});
});
