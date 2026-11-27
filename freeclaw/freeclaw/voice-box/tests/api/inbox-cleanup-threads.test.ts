// ═══════════════════════════════════════════════════════════════════
// Inbox cleanup_threads — honest bulk delete contract
// ═══════════════════════════════════════════════════════════════════
// REGRESSION: the cleanup action deleted chat_messages, then chat_threads,
// then the thread's state row — with NO error check on any of the three —
// and then reported `{ ok: true, deleted }` with `deleted++` applied
// unconditionally. So a failed thread delete was announced to the admin as
// "Cleaned up N test threads" while the thread stayed in the inbox (the same
// "says OK but it comes back" class already fixed in _posts and _polls), and
// a failed thread delete after a successful message delete destroyed a live
// thread's history.
//
// Contract now:
//   1. The thread row is deleted FIRST and PROVED (0 rows => not counted).
//   2. Child rows are only wiped after the parent is gone.
//   3. Any delete error is surfaced — never swallowed into ok:true.
//   4. `deleted` counts only threads actually removed.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	threads: [] as Array<Record<string, unknown>>,
	messages: [] as Array<Record<string, unknown>>,
	deleteErrors: {} as Record<string, Error | undefined>,
	deleteCalls: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
	// Simulates a row vanishing server-side between the list read and the
	// delete: the delete succeeds but removes 0 rows.
	deleteReturnsEmpty: new Set<string>(),
}));

type Chain = {
	then: (fn: (v: unknown) => void) => void;
	select: (cols?: string) => Chain;
	eq: (col: string, val: unknown) => Chain;
	delete: () => Chain;
};

function chainFor(table: string): Chain {
	const filters: Array<[string, unknown]> = [];
	let selected = false;
	let isDelete = false;
	const self: Chain = {
		then(fn) {
			// A delete-chain failure must surface; the same table's plain
			// SELECT must still return rows (the handler lists threads first).
			if (isDelete) {
				const err = state.deleteErrors[table];
				if (err) {
					fn({ data: null, error: err });
					return;
				}
			}
			const rows =
				table === "chat_threads"
					? state.threads
					: table === "chat_messages"
						? state.messages
						: [];
			if (selected) {
				// Only a DELETE chain can legitimately return "0 rows removed";
				// a plain select() must still see the rows.
				if (isDelete && state.deleteReturnsEmpty.has(table)) {
					fn({ data: [], error: null });
					return;
				}
				// PostgREST select() on a delete returns the removed rows.
				const matched = rows.filter((r) =>
					filters.every(([c, v]) => r[c] === v),
				);
				fn({ data: matched, error: null });
				return;
			}
			fn({ data: rows, error: null });
		},
		select() {
			selected = true;
			return self;
		},
		eq(col: string, val: unknown) {
			filters.push([col, val]);
			return self;
		},
		delete() {
			isDelete = true;
			state.deleteCalls.push({ table, filters: [...filters] });
			return self;
		},
	};
	return self;
}

// Thread delete must be able to fail; message delete succeeds so the test can
// prove ordering (messages must NOT be touched when the thread delete fails).
const from = vi.fn((table: string) => chainFor(table));

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
}));
vi.mock("../../api/_auth.js", () => ({
	...authMocks,
	cors: vi.fn(),
	clean: (s: unknown) => String(s ?? ""),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn((res: unknown) => res),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

function response() {
	const res = {
		statusCode: 200,
		body: undefined as unknown,
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
		setHeader() {
			return res;
		},
	};
	return res;
}

const THREAD = { thread_id: "e2e-thread-1", status: "open" };
const MSG = { thread_id: "e2e-thread-1", sender: "user", body: "hello" };

beforeEach(() => {
	vi.clearAllMocks();
	state.threads = [{ ...THREAD }];
	state.messages = [{ ...MSG }];
	state.deleteErrors = {};
	state.deleteCalls = [];
	state.deleteReturnsEmpty = new Set();
	authMocks.isAdmin.mockResolvedValue(true);
	authMocks.auditLog.mockResolvedValue(undefined);
});

async function callCleanup() {
	const { default: handler } = await import("../../api/_inbox.js");
	const res = response();
	await handler(
		{
			method: "POST",
			query: {},
			headers: { "x-anon-id": "anon-1" },
			body: { action: "cleanup_threads", patterns: ["e2e-"] },
		},
		res,
	);
	return res;
}

describe("POST /api/inbox cleanup_threads", () => {
	it("deletes the thread row first, then its messages and state", async () => {
		const res = await callCleanup();
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, deleted: 1 });
		// Parent before children — a failed parent delete must never have
		// already erased the thread's history.
		const order = state.deleteCalls.map((c) => c.table);
		expect(order[0]).toBe("chat_threads");
		expect(order).toContain("chat_messages");
		expect(order).toContain("settings");
	});

	it("surfaces a thread delete failure instead of reporting ok:true", async () => {
		state.deleteErrors.chat_threads = new Error("thread delete failed");
		await expect(callCleanup()).rejects.toThrow("thread delete failed");
		// The messages must be untouched — the thread still exists.
		expect(state.deleteCalls.some((c) => c.table === "chat_messages")).toBe(
			false,
		);
	});

	it("surfaces a message wipe failure instead of reporting ok:true", async () => {
		state.deleteErrors.chat_messages = new Error("message wipe failed");
		await expect(callCleanup()).rejects.toThrow("message wipe failed");
	});

	it("does not count a thread as deleted when 0 rows were removed", async () => {
		// The row vanished server-side between the list read and the delete:
		// the delete succeeds but removes nothing. Reporting it as "deleted"
		// is the same lie as a swallowed error.
		state.deleteReturnsEmpty.add("chat_threads");
		const res = await callCleanup();
		expect(res.statusCode).toBe(200);
		expect((res.body as { deleted: number }).deleted).toBe(0);
	});
});
