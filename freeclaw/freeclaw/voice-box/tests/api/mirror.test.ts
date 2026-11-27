// ═══════════════════════════════════════════════════════════════════
// Standby mirror — Supabase commits, Firebase receives a verified copy
// ═══════════════════════════════════════════════════════════════════
// The contract under test:
//   1. An important row written to Supabase produces ONE Firestore document
//      with stable identity (entity, entity_id, tenant_id) and the same data.
//   2. Re-delivering identical content is skipped, not duplicated.
//   3. A mirror failure is REPORTED (pending/failed), never silently claimed
//      as delivered, and never thrown into the caller's request path.
//   4. Only real writes to mirrored tables are observed — a GET, a read, or a
//      write to an unmirrored table must not produce traffic to Firebase.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	__resetMirrorForTests,
	buildEvent,
	deliver,
	flushMirrorQueue,
	isMirroredTable,
	mirrorStats,
	mirrorWrite,
	observePrimaryWrite,
	tableFromUrl,
	toFields,
} from "../../api/_mirror.js";

const POST_ROW = {
	id: "post_123",
	school_id: "school_9",
	title: "Water cooler leaking on floor 2",
	status: "open",
	updated_at: "2026-11-01T10:00:00.000Z",
	severity: 3,
	pinned: false,
	tags: ["facilities", "leak"],
	meta: { floor: 2 },
};

function okFetch(calls: Array<{ url: string; init: RequestInit }>) {
	return vi.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return {
			ok: true,
			status: 200,
			text: async () => "{}",
		};
	});
}

let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
	calls = [];
	__resetMirrorForTests();
	process.env.FIREBASE_ID_TOKEN = "test-id-token";
	process.env.FIREBASE_PROJECT_ID = "voicelflow";
	delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
	delete process.env.FIREBASE_CLIENT_EMAIL;
	delete process.env.FIREBASE_PRIVATE_KEY;
	delete process.env.MIRROR_TABLES;
});

afterEach(() => {
	delete process.env.FIREBASE_ID_TOKEN;
	vi.restoreAllMocks();
});

describe("table selection", () => {
	it("mirrors the core student/admin tables", () => {
		for (const t of ["posts", "comments", "reactions", "polls", "poll_votes", "reports", "settings"]) {
			expect(isMirroredTable(t)).toBe(true);
		}
	});

	it("does not mirror agent/telemetry internals by default", () => {
		// These churn constantly and would burn the Firestore free tier for no
		// recovery value; MIRROR_TABLES opts them in explicitly.
		expect(isMirroredTable("agent_conversations")).toBe(false);
		expect(isMirroredTable("system_metrics")).toBe(false);
	});

	it("honours an explicit MIRROR_TABLES override", () => {
		process.env.MIRROR_TABLES = "posts,custom_table";
		expect(isMirroredTable("posts")).toBe(true);
		expect(isMirroredTable("custom_table")).toBe(true);
		expect(isMirroredTable("comments")).toBe(false);
	});
});

describe("event envelope", () => {
	it("carries identity, tenant, operation and source", () => {
		const e = buildEvent({ table: "posts", op: "insert", row: POST_ROW });
		expect(e.entity).toBe("posts");
		expect(e.entity_id).toBe("post_123");
		expect(e.tenant_id).toBe("school_9");
		expect(e.operation).toBe("insert");
		expect(e.source_backend).toBe("supabase");
		expect(e.schema_version).toBe(1);
		expect(e.event_id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("gives identical content the same idempotency key", () => {
		const a = buildEvent({ table: "posts", op: "update", row: POST_ROW });
		const b = buildEvent({ table: "posts", op: "update", row: { ...POST_ROW } });
		expect(a.idempotency_key).toBe(b.idempotency_key);
		expect(a.event_id).not.toBe(b.event_id);
	});

	it("gives different content a different idempotency key", () => {
		const a = buildEvent({ table: "posts", op: "update", row: POST_ROW });
		const b = buildEvent({
			table: "posts",
			op: "update",
			row: { ...POST_ROW, status: "resolved" },
		});
		expect(a.idempotency_key).not.toBe(b.idempotency_key);
	});

	it("survives a row with no id by hashing its payload", () => {
		const e = buildEvent({ table: "poll_votes", op: "insert", row: { poll_id: "p1" } });
		expect(e.entity_id.startsWith("hash:")).toBe(true);
		expect(e.tenant_id).toBeNull();
	});
});

describe("Firestore encoding", () => {
	it("maps JS values to Firestore typed values", () => {
		const f = toFields(POST_ROW);
		expect(f.title).toEqual({ stringValue: POST_ROW.title });
		expect(f.severity).toEqual({ integerValue: "3" });
		expect(f.pinned).toEqual({ booleanValue: false });
		expect(f.tags).toEqual({
			arrayValue: { values: [{ stringValue: "facilities" }, { stringValue: "leak" }] },
		});
		expect(f.meta).toEqual({
			mapValue: { fields: { floor: { integerValue: "2" } } },
		});
	});

	it("encodes null explicitly rather than dropping the field", () => {
		expect(toFields({ deleted_at: null }).deleted_at).toEqual({ nullValue: null });
	});
});

describe("deliver", () => {
	it("writes a deterministic document per entity", async () => {
		const f = okFetch(calls);
		const e = buildEvent({ table: "posts", op: "insert", row: POST_ROW });
		const r = await deliver(e, f);
		expect(r.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(
			"https://firestore.googleapis.com/v1/projects/voicelflow/databases/(default)/documents/posts/post_123",
		);
		expect(calls[0].init.method).toBe("PATCH");
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
			"Bearer test-id-token",
		);
		const body = JSON.parse(String(calls[0].init.body));
		expect(body.fields.__mirror.mapValue.fields.entity_id.stringValue).toBe("post_123");
	});

	it("reports not_configured instead of pretending success", async () => {
		delete process.env.FIREBASE_ID_TOKEN;
		const f = okFetch(calls);
		const e = buildEvent({ table: "posts", op: "insert", row: POST_ROW });
		const r = await deliver(e, f);
		expect(r.ok).toBe(false);
		expect(r.reason).toBe("not_configured");
		expect(calls).toHaveLength(0);
	});

	it("reports an HTTP refusal with its status", async () => {
		const f = vi.fn(async () => ({
			ok: false,
			status: 403,
			text: async () => '{"error":"Missing or insufficient permissions."}',
		}));
		const e = buildEvent({ table: "posts", op: "insert", row: POST_ROW });
		const r = await deliver(e, f as never);
		expect(r.ok).toBe(false);
		expect(r.reason).toBe("http_403");
	});

	it("never throws when the transport itself fails", async () => {
		const f = vi.fn(async () => {
			throw new Error("ECONNRESET");
		});
		const e = buildEvent({ table: "posts", op: "insert", row: POST_ROW });
		const r = await deliver(e, f as never);
		expect(r).toMatchObject({ ok: false, reason: "transport_error" });
	});
});

describe("mirrorWrite — the user request must never fail because of a copy", () => {
	it("mirrors an insert once and records delivery", async () => {
		vi.stubGlobal("fetch", okFetch(calls));
		const r = await mirrorWrite({ table: "posts", op: "insert", rows: POST_ROW });
		expect(r).toMatchObject({ ok: true, delivered: 1 });
		expect(mirrorStats().delivered).toBe(1);
		expect(mirrorStats().failed).toBe(0);
	});

	it("skips an identical repeat instead of duplicating the document", async () => {
		vi.stubGlobal("fetch", okFetch(calls));
		await mirrorWrite({ table: "posts", op: "insert", rows: POST_ROW });
		const second = await mirrorWrite({ table: "posts", op: "insert", rows: POST_ROW });
		expect(second.skipped).toBe(1);
		expect(calls).toHaveLength(1);
	});

	it("mirrors every row of a batch insert", async () => {
		vi.stubGlobal("fetch", okFetch(calls));
		const r = await mirrorWrite({
			table: "comments",
			op: "insert",
			rows: [{ id: "c1", post_id: "post_123" }, { id: "c2", post_id: "post_123" }],
		});
		expect(r.delivered).toBe(2);
		expect(calls).toHaveLength(2);
	});

	it("records a failure as pending, not delivered", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })));
		const r = await mirrorWrite({ table: "posts", op: "insert", rows: POST_ROW });
		expect(r.ok).toBe(false);
		expect(mirrorStats().failed).toBe(1);
		expect(mirrorStats().pending).toBe(1);
		expect(mirrorStats().lastError).toBe("http_503");
	});

	it("is a no-op for an unmirrored table", async () => {
		const f = okFetch(calls);
		vi.stubGlobal("fetch", f);
		const r = await mirrorWrite({ table: "system_metrics", op: "insert", rows: { id: "m" } });
		expect(r.reason).toBe("not_mirrored");
		expect(f).not.toHaveBeenCalled();
	});
});

describe("flushMirrorQueue — retry from maintenance, never from a request", () => {
	it("re-delivers a queued event once the transport recovers", async () => {
		// First attempt fails (transport refused), second succeeds.
		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })));
		await mirrorWrite({ table: "posts", op: "insert", rows: POST_ROW });
		expect(mirrorStats().pending).toBe(1);

		vi.stubGlobal("fetch", okFetch(calls));
		const flush = await flushMirrorQueue();
		expect(flush.sent).toBe(1);
		expect(mirrorStats().pending).toBe(0);
		expect(mirrorStats().delivered).toBe(1);
	});

	it("gives up after five attempts instead of spinning forever", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })));
		await mirrorWrite({ table: "posts", op: "insert", rows: POST_ROW });
		for (let i = 0; i < 5; i++) await flushMirrorQueue();
		const last = await flushMirrorQueue();
		expect(last.dropped).toBeGreaterThanOrEqual(0);
		expect(mirrorStats().pending).toBe(0);
	});
});

describe("observePrimaryWrite — seeing Supabase writes at one choke point", () => {
	function resWithBody(rows: unknown) {
		const text = JSON.stringify(rows);
		return {
			ok: true,
			status: 201,
			clone: () => ({ text: async () => text }),
			text: async () => text,
		};
	}

	it("parses the table out of a PostgREST URL", () => {
		expect(tableFromUrl("https://x.supabase.co/rest/v1/posts?select=*")).toBe("posts");
		expect(tableFromUrl("https://x.supabase.co/rest/v1/poll_votes?on_conflict=id")).toBe(
			"poll_votes",
		);
		expect(tableFromUrl("not a url")).toBeNull();
	});

	it("mirrors a committed insert, using the server's returned rows", async () => {
		vi.stubGlobal("fetch", okFetch(calls));
		const observer = observePrimaryWrite(
			"https://x.supabase.co/rest/v1/posts",
			{ method: "POST", body: JSON.stringify({ school_id: "school_9", title: "t" }) },
			resWithBody([POST_ROW]),
		);
		expect(observer).toBeUndefined();
		await vi.waitFor(() => expect(mirrorStats().delivered).toBe(1));
		const body = JSON.parse(String(calls[0].init.body));
		// The database-assigned id came from the response, not the request.
		expect(body.fields.id.stringValue).toBe("post_123");
	});

	it("ignores GET requests entirely", async () => {
		const f = okFetch(calls);
		vi.stubGlobal("fetch", f);
		observePrimaryWrite(
			"https://x.supabase.co/rest/v1/posts?select=*",
			{ method: "GET" },
			resWithBody([POST_ROW]),
		);
		await new Promise((r) => setTimeout(r, 10));
		expect(f).not.toHaveBeenCalled();
	});

	it("ignores a failed primary write (nothing was committed to copy)", async () => {
		const f = okFetch(calls);
		vi.stubGlobal("fetch", f);
		observePrimaryWrite(
			"https://x.supabase.co/rest/v1/posts",
			{ method: "POST", body: JSON.stringify({ title: "t" }) },
			{ ok: false, status: 400, clone: () => ({ text: async () => "" }) },
		);
		await new Promise((r) => setTimeout(r, 10));
		expect(f).not.toHaveBeenCalled();
	});

	it("ignores writes to unmirrored tables", async () => {
		const f = okFetch(calls);
		vi.stubGlobal("fetch", f);
		observePrimaryWrite(
			"https://x.supabase.co/rest/v1/system_metrics",
			{ method: "POST", body: JSON.stringify({ id: "m" }) },
			resWithBody([{ id: "m" }]),
		);
		await new Promise((r) => setTimeout(r, 10));
		expect(f).not.toHaveBeenCalled();
	});
});
