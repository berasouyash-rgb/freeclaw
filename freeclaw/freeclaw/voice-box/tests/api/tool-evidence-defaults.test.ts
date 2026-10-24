// ═══════════════════════════════════════════════════════════════════
// storeToolEvidence — audit-attribution defaults
// ═══════════════════════════════════════════════════════════════════
// The evidence trail must never claim an admin did work that executeTool
// authorised as a student. `executeTool` defaults the role to "student",
// so this writer must default the same way and fall back to the "unknown"
// actor convention (as api/_audit.js does) rather than inventing "admin".
// Also locks the `ip` / `ipAddress` alias: v3/_tools.js passes `ip`, and a
// dropped source IP makes a denial un-traceable.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	rows: [] as Record<string, unknown>[],
	error: null as { message: string } | null,
}));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: () => ({
			insert: async (row: Record<string, unknown>) => {
				db.rows.push(row);
				return { error: db.error };
			},
		}),
	},
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	maskProfanity: (s: unknown) => String(s ?? ""),
	checkUser: vi.fn(async () => ({ ok: true })),
	rateLimited: vi.fn(async () => false),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));
vi.mock("../../api/_providers.js", () => ({
	callLLMChain: vi.fn(async () => null),
	callNvidiaFast: vi.fn(async () => null),
}));

import { storeToolEvidence } from "../../api/_agent-tool-registry.js";

const EVIDENCE = {
	toolName: "get_posts",
	params: { limit: 5 },
	result: { ok: true },
	latencyMs: 12,
	conversationId: "conv-1",
};

function onlyRow(): Record<string, unknown> {
	expect(db.rows).toHaveLength(1);
	return db.rows[0]!;
}

beforeEach(() => {
	db.rows.length = 0;
	db.error = null;
});

describe("storeToolEvidence attribution", () => {
	it("defaults an unidentified actor to 'unknown' / user — never 'admin'", async () => {
		const out = await storeToolEvidence("call-1", EVIDENCE);

		expect(out).toEqual({ stored: true });
		const row = onlyRow();
		expect(row.actor_id).toBe("unknown");
		expect(row.actor_type).toBe("user");
		expect(row.tool_call_id).toBe("call-1");
		expect(row.conversation_id).toBe("conv-1");
		expect(row.tool_name).toBe("get_posts");
	});

	it("keeps an explicit actor id and role", async () => {
		await storeToolEvidence("call-2", EVIDENCE, {
			role: "student",
			actorId: "anon_abc123",
		});

		const row = onlyRow();
		expect(row.actor_id).toBe("anon_abc123");
		expect(row.actor_type).toBe("user");
	});

	it("records a genuine admin as admin", async () => {
		await storeToolEvidence("call-3", EVIDENCE, { role: "admin" });

		const row = onlyRow();
		expect(row.actor_id).toBe("admin");
		expect(row.actor_type).toBe("admin");
	});

	it("accepts `ip` as an alias for `ipAddress`", async () => {
		await storeToolEvidence("call-4", EVIDENCE, { ip: "10.0.0.9" });
		expect(onlyRow().ip_address).toBe("10.0.0.9");
	});

	it("prefers `ipAddress` when both spellings are supplied", async () => {
		await storeToolEvidence("call-5", EVIDENCE, {
			ipAddress: "10.0.0.1",
			ip: "10.0.0.9",
		});
		expect(onlyRow().ip_address).toBe("10.0.0.1");
	});

	it("writes null (not 'undefined') when no ip is supplied", async () => {
		await storeToolEvidence("call-6", EVIDENCE);
		expect(onlyRow().ip_address).toBeNull();
	});

	it("reports the insert error instead of throwing", async () => {
		db.error = { message: "permission denied" };

		const out = await storeToolEvidence("call-7", EVIDENCE);

		expect(out).toEqual({ stored: false, error: "permission denied" });
	});
});
