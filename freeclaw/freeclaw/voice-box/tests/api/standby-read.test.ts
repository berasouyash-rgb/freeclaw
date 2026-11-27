// ═══════════════════════════════════════════════════════════════════
// Automatic read switch — Supabase outage, Firebase answers
// ═══════════════════════════════════════════════════════════════════
// The behaviour being pinned:
//   1. A read that fails for an INFRASTRUCTURE/QUOTA reason is answered from
//      the standby copy, so the user sees their data instead of a 500.
//   2. Application/auth errors (400/401/403/404/422) never move traffic.
//   3. An empty standby never impersonates an empty database.
//   4. A query shape the standby cannot reproduce returns the real error.
//   5. Writes never take this path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	__resetMirrorForTests,
	fromFields,
	mirrorStats,
	readStandby,
} from "../../api/_mirror.js";
import {
	parsePostgrestRead,
	shouldFallbackRead,
	standbyResponse,
} from "../../api/_standby-read.js";

const POST = { id: "post_1", school_id: "school_9", title: "Leak on floor 2" };

/** Encode a plain row the way the mirror stored it in Firestore. */
function typedFields(row: Record<string, unknown>) {
	const fields: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		if (typeof value === "number") fields[key] = { integerValue: String(value) };
		else if (typeof value === "boolean") fields[key] = { booleanValue: value };
		else if (value === null) fields[key] = { nullValue: null };
		else fields[key] = { stringValue: String(value) };
	}
	// The mirror stamps bookkeeping onto every document.
	fields.__mirror = {
		mapValue: { fields: { entity: { stringValue: "posts" } } },
	};
	return fields;
}

function runQueryBody(rows: unknown[]) {
	return rows.map((row) => ({
		document: { name: "projects/voicelflow/databases/(default)/documents/posts/x", fields: typedFields(row as Record<string, unknown>) },
	}));
}

function jsonFetch(body: unknown, status = 200) {
	return vi.fn(async () => ({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	}));
}

beforeEach(() => {
	__resetMirrorForTests();
	process.env.FIREBASE_ID_TOKEN = "test-id-token";
	process.env.FIREBASE_PROJECT_ID = "voicelflow";
	delete process.env.MIRROR_TABLES;
});

afterEach(() => {
	delete process.env.FIREBASE_ID_TOKEN;
	vi.restoreAllMocks();
});

describe("shouldFallbackRead — only availability failures move traffic", () => {
	it("accepts infrastructure, quota, timeout and transport failures", () => {
		expect(shouldFallbackRead("GET", 500)).toBe(true);
		expect(shouldFallbackRead("GET", 503)).toBe(true);
		expect(shouldFallbackRead("GET", 402)).toBe(true); // egress/quota limit
		expect(shouldFallbackRead("GET", 429)).toBe(true);
		expect(shouldFallbackRead("GET", 408)).toBe(true);
		expect(shouldFallbackRead("GET", 0)).toBe(true); // transport failure
	});

	it("never moves traffic for an application or auth error", () => {
		for (const status of [400, 401, 403, 404, 409, 422]) {
			expect(shouldFallbackRead("GET", status)).toBe(false);
		}
	});

	it("never moves a write", () => {
		expect(shouldFallbackRead("POST", 503)).toBe(false);
		expect(shouldFallbackRead("PATCH", 500)).toBe(false);
		expect(shouldFallbackRead("DELETE", 429)).toBe(false);
	});
});

describe("parsePostgrestRead", () => {
	it("reads the table, equality filters, limit and ordering", () => {
		const parsed = parsePostgrestRead(
			"https://p.supabase.co/rest/v1/posts?select=*&school_id=eq.school_9&limit=5&order=created_at.desc",
		);
		expect(parsed).toMatchObject({
			table: "posts",
			filters: [{ field: "school_id", value: "school_9" }],
			limit: 5,
			orderBy: { field: "created_at", direction: "DESCENDING" },
			unsupported: false,
		});
	});

	it("flags a filter it cannot reproduce instead of ignoring it", () => {
		const parsed = parsePostgrestRead(
			"https://p.supabase.co/rest/v1/posts?created_at=gt.2026-01-01",
		);
		expect(parsed?.unsupported).toBe(true);
	});

	it("returns null when there is no recognisable table", () => {
		expect(parsePostgrestRead("not a url")).toBeNull();
		expect(parsePostgrestRead("https://p.supabase.co/auth/v1/user")).toBeNull();
	});
});

describe("readStandby — the transport", () => {
	it("queries Firestore and strips mirror bookkeeping", async () => {
		const fetchMock = jsonFetch(runQueryBody([POST]));
		vi.stubGlobal("fetch", fetchMock);

		const result = await readStandby("posts", {
			filters: [{ field: "id", value: "post_1" }],
			limit: 1,
		});

		expect(result.ok).toBe(true);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toEqual(POST);
		expect(result.rows[0]).not.toHaveProperty("__mirror");

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toContain("/projects/voicelflow/databases/(default)/documents:runQuery");
		expect(init.method).toBe("POST");
		const body = JSON.parse(String(init.body));
		expect(body.structuredQuery.from).toEqual([{ collectionId: "posts" }]);
		expect(body.structuredQuery.limit).toBe(1);
	});

	it("reports not_configured rather than an empty result", async () => {
		delete process.env.FIREBASE_ID_TOKEN;
		const fetchMock = jsonFetch([]);
		vi.stubGlobal("fetch", fetchMock);
		const result = await readStandby("posts", {});
		expect(result).toEqual({ ok: false, reason: "not_configured" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reports a transport failure instead of throwing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("ECONNRESET");
			}),
		);
		const result = await readStandby("posts", {});
		expect(result).toMatchObject({ ok: false, reason: "transport_error" });
	});

	it("decodes typed Firestore values", () => {
		expect(
			fromFields({
				id: { stringValue: "p1" },
				count: { integerValue: "3" },
				ok: { booleanValue: true },
				gone: { nullValue: null },
				tags: { arrayValue: { values: [{ stringValue: "a" }] } },
				meta: { mapValue: { fields: { floor: { integerValue: "2" } } } },
			}),
		).toEqual({ id: "p1", count: 3, ok: true, gone: null, tags: ["a"], meta: { floor: 2 } });
	});
});

describe("standbyResponse — what the route layer receives", () => {
	it("answers a filtered read from the standby and marks the response", async () => {
		vi.stubGlobal("fetch", jsonFetch(runQueryBody([POST])));
		const res = await standbyResponse(
			"https://p.supabase.co/rest/v1/posts?id=eq.post_1&select=*",
			{ method: "GET", headers: { Accept: "application/json" } },
		);
		expect(res).not.toBeNull();
		expect(res!.status).toBe(200);
		expect(res!.headers.get("X-Standby-Read")).toBe("firebase");
		expect(await res!.json()).toEqual([POST]);
		expect(mirrorStats().standbyReads).toBe(1);
	});

	it("refuses an unmirrored table without touching Firebase", async () => {
		const fetchMock = jsonFetch(runQueryBody([{ id: "m" }]));
		vi.stubGlobal("fetch", fetchMock);
		const res = await standbyResponse("https://p.supabase.co/rest/v1/system_metrics", {
			method: "GET",
		});
		expect(res).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refuses a query shape it cannot reproduce", async () => {
		const fetchMock = jsonFetch(runQueryBody([POST]));
		vi.stubGlobal("fetch", fetchMock);
		const res = await standbyResponse(
			"https://p.supabase.co/rest/v1/posts?created_at=gt.2026-01-01",
			{ method: "GET" },
		);
		expect(res).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not let an empty standby impersonate an empty feed", async () => {
		vi.stubGlobal("fetch", jsonFetch([]));
		const res = await standbyResponse("https://p.supabase.co/rest/v1/posts?select=*", {
			method: "GET",
		});
		expect(res).toBeNull();
	});

	it("treats an empty FILTERED result as a real 'not found'", async () => {
		vi.stubGlobal("fetch", jsonFetch([]));
		const res = await standbyResponse(
			"https://p.supabase.co/rest/v1/posts?id=eq.missing&select=*",
			{ method: "GET" },
		);
		expect(res).not.toBeNull();
		expect(await res!.json()).toEqual([]);
	});

	it("returns a single object for .single() requests", async () => {
		vi.stubGlobal("fetch", jsonFetch(runQueryBody([POST])));
		const res = await standbyResponse("https://p.supabase.co/rest/v1/posts?id=eq.post_1", {
			method: "GET",
			headers: { Accept: "application/vnd.pgrst.object+json" },
		});
		expect(res).not.toBeNull();
		expect(await res!.json()).toEqual(POST);
	});

	it("stays out of the way when the standby is unconfigured", async () => {
		delete process.env.FIREBASE_ID_TOKEN;
		const res = await standbyResponse("https://p.supabase.co/rest/v1/posts?id=eq.post_1", {
			method: "GET",
		});
		expect(res).toBeNull();
	});
});
