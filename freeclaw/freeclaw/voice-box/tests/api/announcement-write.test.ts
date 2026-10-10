// ═══════════════════════════════════════════════════════════════════
// Announcement banner — the write must be PROVEN before claiming success
// ═══════════════════════════════════════════════════════════════════
// REGRESSION: `POST /api/announcement` awaited its `settings` delete /
// update / insert WITHOUT checking `error`, then answered
// `200 { ok: true, value }` with the text the admin had just typed.
//
// This is the platform-wide banner every user sees — the surface you would
// use for an urgent notice ("lift out of service", "security incident",
// "campus closed"). A failed write meant:
//
//   1. The admin saw "published" with their own text echoed back.
//   2. Every user still saw the PREVIOUS announcement.
//   3. The audit log recorded `set_announcement` for a write that never landed.
//
// So the exact case where the banner matters most is the case that failed
// silently. Same class as BUG-011/012/013/014/015/018.
//
// Contract:
//   1. A failed write surfaces loudly — never ok:true.
//   2. No `set_announcement` audit entry unless the row actually changed.
//   3. The admin path stays gated.
//   4. A successful write still echoes the persisted value.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	row: null as { key: string; value: unknown } | null,
	writeErrors: {} as Record<string, Error | undefined>,
	writes: [] as Array<{ op: string; value: unknown }>,
}));

const from = vi.fn((table: string) => {
	if (table !== "settings") {
		const q: Record<string, unknown> = {};
		return new Proxy(q, {
			get: (_t, p) => (p === "then" ? (fn: (v: unknown) => void) => fn({ data: null, error: null }) : () => q),
		});
	}
	let op: "select" | "update" | "insert" | "delete" = "select";
	let payload: Record<string, unknown> | null = null;
	const self: Record<string, unknown> = {
		then(fn: (v: unknown) => void) {
			const err = state.writeErrors[op];
			if (err) {
				fn({ data: null, error: err });
				return;
			}
			if (op === "select") {
				fn({ data: state.row, error: null });
				return;
			}
			if (op === "delete") {
				state.writes.push({ op, value: null });
				state.row = null;
				fn({ data: null, error: null });
				return;
			}
			state.writes.push({ op, value: payload?.value });
			state.row = { key: "announcement", value: payload?.value };
			fn({ data: null, error: null });
		},
		select: () => self,
		eq: () => self,
		maybeSingle: () => self,
		single: () => self,
		update: (v: Record<string, unknown>) => {
			op = "update";
			payload = v;
			return self;
		},
		insert: (v: Record<string, unknown>) => {
			op = "insert";
			payload = v;
			return self;
		},
		delete: () => {
			op = "delete";
			return self;
		},
	};
	return self;
});

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

const authMocks = vi.hoisted(() => ({ isAdmin: vi.fn(), auditLog: vi.fn() }));
vi.mock("../../api/_auth.js", () => ({
	...authMocks,
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
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
		headers: {} as Record<string, string>,
		setHeader(k: string, v: string) {
			res.headers[k] = v;
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
	const { default: handler } = await import("../../api/_announcement.js");
	const res = response();
	await handler(
		{ method: "GET", query: {}, body: {}, headers: {}, ...req },
		res,
	);
	return res;
}

const LIVE = { key: "announcement", value: { text: "Old notice", kind: "info" } };

beforeEach(() => {
	vi.clearAllMocks();
	state.row = { ...LIVE };
	state.writeErrors = {};
	state.writes = [];
	authMocks.isAdmin.mockResolvedValue(true);
	authMocks.auditLog.mockResolvedValue(undefined);
});

describe("POST /api/announcement — publishing", () => {
	it("persists and echoes the announcement", async () => {
		const res = await call({
			method: "POST",
			headers: { "x-admin-token": "tok" },
			body: { text: "Lift out of service", kind: "warning" },
		});
		expect(res.statusCode).toBe(200);
		expect((res.body as { value: { text: string } }).value.text).toBe(
			"Lift out of service",
		);
		expect(authMocks.auditLog).toHaveBeenCalledWith(
			"admin",
			"set_announcement",
			expect.anything(),
		);
	});

	it("fails loudly when the UPDATE fails — no fake publish", async () => {
		state.writeErrors.update = new Error("announcement write failed");
		await expect(
			call({
				method: "POST",
				headers: { "x-admin-token": "tok" },
				body: { text: "Lift out of service" },
			}),
		).rejects.toThrow("announcement write failed");
	});

	it("does not audit a publish that never landed", async () => {
		state.writeErrors.update = new Error("announcement write failed");
		await expect(
			call({
				method: "POST",
				headers: { "x-admin-token": "tok" },
				body: { text: "Lift out of service" },
			}),
		).rejects.toThrow();
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"set_announcement",
			expect.anything(),
		);
		// And the live banner is genuinely unchanged.
		expect((state.row?.value as { text: string }).text).toBe("Old notice");
	});

	it("fails loudly when the INSERT fails (no existing row)", async () => {
		state.row = null;
		state.writeErrors.insert = new Error("announcement insert failed");
		await expect(
			call({
				method: "POST",
				headers: { "x-admin-token": "tok" },
				body: { text: "Campus closed" },
			}),
		).rejects.toThrow("announcement insert failed");
	});
});

describe("POST /api/announcement — clearing", () => {
	it("clears the banner", async () => {
		const res = await call({
			method: "POST",
			headers: { "x-admin-token": "tok" },
			body: { clear: true },
		});
		expect(res.statusCode).toBe(200);
		expect((res.body as { value: unknown }).value).toBeNull();
		expect(state.row).toBeNull();
	});

	it("fails loudly when the clear DELETE fails", async () => {
		state.writeErrors.delete = new Error("announcement delete failed");
		await expect(
			call({
				method: "POST",
				headers: { "x-admin-token": "tok" },
				body: { clear: true },
			}),
		).rejects.toThrow("announcement delete failed");
		// The old banner is still live — and the admin must be told so.
		expect((state.row?.value as { text: string }).text).toBe("Old notice");
		expect(authMocks.auditLog).not.toHaveBeenCalledWith(
			"admin",
			"clear_announcement",
			expect.anything(),
		);
	});
});

describe("authorization", () => {
	it("refuses a non-admin publishing", async () => {
		authMocks.isAdmin.mockResolvedValue(false);
		const res = await call({
			method: "POST",
			body: { text: "Not allowed" },
		});
		expect(res.statusCode).toBe(403);
		expect(state.writes).toHaveLength(0);
	});
});
