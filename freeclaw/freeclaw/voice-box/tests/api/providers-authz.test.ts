// ═══════════════════════════════════════════════════════════════════
// Provider API — authorization contract for the SECRET surface
// ═══════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS: `providers.test.ts` exercises a REIMPLEMENTATION of
// the provider chain defined inside that test file. It never imports
// `api/_providers.js`, so the real handler's admin gate had zero coverage —
// the exact "tests pass while the real product is untested" trap.
//
// The provider store holds API keys. `GET ?action=list` returns the config
// (masked keys), and every POST mutates it. This file exercises the REAL
// handler with a non-admin caller to prove neither is reachable.
//
// Contract:
//   1. `GET ?action=list`      → 403 for a non-admin (no config, no keys).
//   2. EVERY POST action      → 403 for a non-admin, before any dispatch.
//   3. `GET ?action=categories`→ 200 (public by design; carries no secrets).
//   4. The gate is not a blanket deny: an admin gets through.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
	isAdmin: vi.fn(),
	auditLog: vi.fn(),
	cors: vi.fn(),
}));
vi.mock("../../api/_auth.js", () => authMocks);

const from = vi.fn(() => {
	const q: Record<string, unknown> = {};
	const h: ProxyHandler<Record<string, unknown>> = {
		get(_t, prop) {
			if (prop === "then")
				return (fn: (v: unknown) => void) => fn({ data: null, error: null });
			if (prop === "maybeSingle" || prop === "single")
				return () => q;
			return () => new Proxy(q, h);
		},
	};
	return new Proxy(q, h);
});
vi.mock("../../api/_db-client.js", () => ({ default: { from } }));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));
vi.mock("../../api/_observability.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../api/_moderation.js", () => ({ maskPII: (s: unknown) => String(s ?? "") }));

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
	const { default: handler } = await import("../../api/_providers.js");
	const res = response();
	await handler(
		{
			method: "GET",
			query: {},
			body: {},
			headers: {},
			...req,
		},
		res,
	);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(false);
	authMocks.auditLog.mockResolvedValue(undefined);
});

describe("GET /api/providers — authorization", () => {
	it("refuses the provider config (masked keys) to a non-admin", async () => {
		const res = await call({ method: "GET", query: { action: "list" } });
		expect(res.statusCode).toBe(403);
		// The refusal must not carry provider data.
		expect(JSON.stringify(res.body)).not.toMatch(/apiKey|api_key|sk-/i);
	});

	it("keeps the public category catalogue reachable (it holds no secrets)", async () => {
		const res = await call({ method: "GET", query: { action: "categories" } });
		expect(res.statusCode).toBe(200);
		expect((res.body as { categories?: unknown }).categories).toBeDefined();
	});
});

describe("POST /api/providers — every mutating action is admin-only", () => {
	const actions = [
		"set_default",
		"set_key",
		"enable",
		"disable",
		"set_priority",
		"test",
		"reset",
		"delete",
	];

	for (const action of actions) {
		it(`403s a non-admin for action=${action}`, async () => {
			const res = await call({
				method: "POST",
				body: { action, provider: "openai", key: "sk-should-never-apply" },
			});
			expect(res.statusCode).toBe(403);
			expect(JSON.stringify(res.body)).not.toMatch(/sk-should-never-apply/);
		});
	}

	it("does not even reach the action dispatch for a non-admin", async () => {
		await call({
			method: "POST",
			body: { action: "set_key", provider: "openai", key: "sk-leak" },
		});
		// No provider write may be attempted before the gate.
		expect(from).not.toHaveBeenCalled();
	});
});

describe("admin path still works (the gate is not a blanket deny)", () => {
	it("lets an admin past the gate on the list action", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const res = await call({ method: "GET", query: { action: "list" } });
		expect(res.statusCode).not.toBe(403);
	});
});
