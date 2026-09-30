// ─── api wrapper tests ────────────────────────────────────────────
// Locks in the fetch wrapper behavior:
//   1. Admin session helpers (set / has / clear / expired / malformed)
//   2. GET cache + noCache bypass
//   3. GET in-flight deduplication
//   4. GET transient-error retry (once) and no-retry for AbortError
//   5. Timeout → abort → friendly error; POST timeouts get offline-queued
//   6. Offline queueing for transient POST/PUT/DELETE failures, never for
//      chat/inbox/reactions (non-replayable) or 4xx responses
//   7. uploadImage server path + data-URL fallback
//   8. paginated / postPaginated URL and body shaping
//   9. Module-load flush when a previous session left queued writes
//  10. ApiError carries the HTTP status so callers can tell a real 404 from
//      a failed request (pages used to render "not found" for both)
//  11. Retry-After handling: 429s carry the server's backoff hint, GETs
//      auto-retry only when the wait is short, writes are never queued past
//      a throttle, and the surfaced message is honest about the wait

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApiError,
	api,
	clearAdminSession,
	hasAdminSession,
	isNotFound,
	resetConcurrencyForTests,
	setAdminSession,
} from "../lib/api";
import { queuedCount } from "../lib/offline";

beforeEach(() => {
	resetConcurrencyForTests();
});

function okResponse(body: unknown = {}) {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

function errResponse(status: number, body: unknown = {}, headers?: Record<string, string>) {
	// Header keys are case-insensitive in HTTP but case-sensitive in JS objects,
	// so normalize to lowercase for lookup.
	const h = new Map(
		Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
	);
	return {
		ok: false,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
		headers: { get: (name: string) => h.get(name.toLowerCase()) ?? null },
	};
}

describe("api admin session helpers", () => {
	beforeEach(() => sessionStorage.clear());
	afterEach(() => sessionStorage.clear());

	it("setAdminSession stores token+exp, hasAdminSession reads it", () => {
		expect(hasAdminSession()).toBe(false);
		setAdminSession("tok-1", Date.now() + 60_000);
		expect(hasAdminSession()).toBe(true);
		clearAdminSession();
		expect(hasAdminSession()).toBe(false);
	});

	it("hasAdminSession treats an expired session as absent and removes it", () => {
		setAdminSession("tok-1", Date.now() - 1000);
		expect(hasAdminSession()).toBe(false);
		expect(sessionStorage.getItem("vb:adminAuth")).toBeNull();
	});

	it("hasAdminSession treats malformed stored JSON as absent", () => {
		sessionStorage.setItem("vb:adminAuth", "{nope");
		expect(hasAdminSession()).toBe(false);
	});

	it("accepts a numeric exp", () => {
		setAdminSession("tok-1", 9_999_999_999_999);
		expect(hasAdminSession()).toBe(true);
	});
});

describe("api request behavior", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("adds the X-Admin-Token header when an admin session exists", async () => {
		setAdminSession("tok-abc", Date.now() + 60_000);
		fetchMock.mockResolvedValue(okResponse({ fine: true }));
		await api.get("/api/settings");

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.headers).toEqual(
			expect.objectContaining({ "X-Admin-Token": "tok-abc" }),
		);
	});

	it("sends JSON body for POST and parses the response", async () => {
		fetchMock.mockResolvedValue(okResponse({ id: 7 }));
		await expect(api.post("/api/posts", { title: "hi" })).resolves.toEqual({
			id: 7,
		});

		const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(path).toBe("/api/posts");
		expect(init.method).toBe("POST");
		expect(init.body).toBe(JSON.stringify({ title: "hi" }));
		expect(init.headers).toEqual(
			expect.objectContaining({ "Content-Type": "application/json" }),
		);
	});

	it("postLong, postSlow, and postInbox POST with extended timeouts", async () => {
		fetchMock.mockResolvedValue(okResponse({ ok: true }));
		await expect(api.postLong("/api/agent/chat", { q: "x" })).resolves.toEqual({
			ok: true,
		});
		await expect(api.postSlow("/api/analyze", { q: "x" })).resolves.toEqual({
			ok: true,
		});
		await expect(api.postInbox("/api/inbox/send", { q: "x" })).resolves.toEqual(
			{ ok: true },
		);

		expect(fetchMock).toHaveBeenCalledTimes(3);
		for (const [path, init] of fetchMock.mock.calls as [
			string,
			RequestInit,
		][]) {
			expect(init.method).toBe("POST");
			expect(init.body).toBe(JSON.stringify({ q: "x" }));
			expect(path.startsWith("/api/")).toBe(true);
		}
	});

	it("rejects with the server error message on a failed response", async () => {
		fetchMock.mockResolvedValue(errResponse(500, { error: "boom" }));
		await expect(api.post("/api/posts", {})).rejects.toThrow("boom");
	});

	it("rejects with a fallback message when the error payload has no message", async () => {
		fetchMock.mockResolvedValue(errResponse(500, {}));
		await expect(api.post("/api/posts", {})).rejects.toThrow(
			"Request failed (500)",
		);
	});

	it("throws a clear error when a 200 response is not JSON (SPA fallback / misconfigured proxy)", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => {
				throw new SyntaxError("bad json");
			},
			text: async () => "<!doctype html><html><body>Not the API</body></html>",
		});
		await expect(api.get("/api/empty")).rejects.toThrow(
			"Unexpected response from server",
		);
	});

	it("tolerates an empty 200 response body (204-style endpoints)", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 204,
			json: async () => ({}),
			text: async () => "",
		});
		await expect(api.get("/api/empty")).resolves.toEqual({});
	});

	describe("GET cache and dedupe", () => {
		it("serves the second identical GET from cache without fetching", async () => {
			fetchMock.mockResolvedValue(okResponse({ n: 1 }));
			await api.get("/api/cached");
			await api.get("/api/cached");
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("getFresh bypasses the cache", async () => {
			fetchMock.mockResolvedValue(okResponse({ n: 1 }));
			await api.get("/api/fresh");
			await api.getFresh("/api/fresh");
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("does not share a cached response across admin and public viewers", async () => {
			fetchMock
				.mockResolvedValueOnce(okResponse({ scope: "admin" }))
				.mockResolvedValueOnce(okResponse({ scope: "public" }));

			setAdminSession("admin-token-a", Date.now() + 60_000);
			await expect(api.get("/api/private-context-7f31")).resolves.toEqual({
				scope: "admin",
			});

			clearAdminSession();
			await expect(api.get("/api/private-context-7f31")).resolves.toEqual({
				scope: "public",
			});
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("does not share an in-flight response across admin and public viewers", async () => {
			let resolveFirst!: (value: unknown) => void;
			fetchMock
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							resolveFirst = resolve;
						}),
				)
				.mockResolvedValueOnce(okResponse({ scope: "public" }));

			setAdminSession("admin-token-b", Date.now() + 60_000);
			const adminRead = api.get("/api/private-inflight-4a92");
			clearAdminSession();
			const publicRead = api.get("/api/private-inflight-4a92");

			expect(fetchMock).toHaveBeenCalledTimes(2);
			resolveFirst(okResponse({ scope: "admin" }));
			await expect(adminRead).resolves.toEqual({ scope: "admin" });
			await expect(publicRead).resolves.toEqual({ scope: "public" });
		});

		it("deduplicates two simultaneous in-flight GETs", async () => {
			let resolveFetch!: (v: unknown) => void;
			fetchMock.mockImplementation(
				() =>
					new Promise((res) => {
						resolveFetch = res;
					}),
			);

			const p1 = api.get("/api/dup");
			const p2 = api.get("/api/dup");
			expect(fetchMock).toHaveBeenCalledTimes(1);

			resolveFetch(okResponse({ done: true }));
			await expect(p1).resolves.toEqual({ done: true });
			await expect(p2).resolves.toEqual({ done: true });
		});

		it("treats GET and POST to the same path as different cache keys", async () => {
			fetchMock.mockResolvedValue(okResponse({ n: 1 }));
			await api.get("/api/same");
			await api.post("/api/same", {});
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});
	});

	describe("GET transient-error retry", () => {
		it("retries once after a network failure and succeeds", async () => {
			vi.useFakeTimers();
			fetchMock
				.mockRejectedValueOnce(new TypeError("Failed to fetch"))
				.mockResolvedValueOnce(okResponse({ recovered: true }));

			const p = api.get("/api/retry");
			await vi.advanceTimersByTimeAsync(1000);
			await expect(p).resolves.toEqual({ recovered: true });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("retries once after a timeout-style error and succeeds", async () => {
			vi.useFakeTimers();
			fetchMock
				.mockRejectedValueOnce(new Error("network timeout"))
				.mockResolvedValueOnce(okResponse({ recovered: true }));

			const p = api.get("/api/retry2");
			await vi.advanceTimersByTimeAsync(1000);
			await expect(p).resolves.toEqual({ recovered: true });
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("rejects after retrying once when both attempts fail", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

			const p = api.get("/api/retry3");
			// Attach the handler BEFORE advancing timers so the second failure
			// (fired inside advanceTimersByTimeAsync) is never "unhandled".
			const rejection = expect(p).rejects.toThrow("Failed to fetch");
			await vi.advanceTimersByTimeAsync(1000);
			await rejection;
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it("does NOT retry an AbortError and surfaces the timeout message", async () => {
			vi.useFakeTimers();
			const abortError = (): Error =>
				Object.assign(new Error("Aborted"), { name: "AbortError" });
			fetchMock.mockImplementation(
				(_url: string, init: RequestInit) =>
					new Promise((_res, rej) => {
						init.signal?.addEventListener("abort", () => rej(abortError()));
					}),
			);

			const p = api.get("/api/slow");
			const rejection = expect(p).rejects.toThrow(
				"Server is taking too long",
			);
			await vi.advanceTimersByTimeAsync(15000);
			await rejection;
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	describe("offline queueing on write failures", () => {
		it("queues a POST that fails with a transient error", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(api.post("/api/posts", { title: "x" })).rejects.toThrow(
				"Failed to fetch",
			);
			expect(queuedCount()).toBe(1);
		});

		it("queues a PUT that fails with a transient error", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(api.put("/api/posts/1", {})).rejects.toThrow(
				"Failed to fetch",
			);
			expect(queuedCount()).toBe(1);
		});

		it("queues a DELETE that fails with a transient error", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(api.del("/api/posts/1", {})).rejects.toThrow(
				"Failed to fetch",
			);
			expect(queuedCount()).toBe(1);
		});

		it("never queues a write that times out (AbortError) — ambiguous outcome", async () => {
			vi.useFakeTimers();
			const abortError = (): Error =>
				Object.assign(new Error("Aborted"), { name: "AbortError" });
			fetchMock.mockImplementation(
				(_url: string, init: RequestInit) =>
					new Promise((_res, rej) => {
						init.signal?.addEventListener("abort", () => rej(abortError()));
					}),
			);

			const p = api.post("/api/posts", { title: "slow" });
			const rejection = expect(p).rejects.toThrow(
				"Server is taking too long",
			);
			await vi.advanceTimersByTimeAsync(15000);
			await rejection;
			// The write may already be applied server-side — replaying it
			// later would double-apply, so it must NOT enter the queue.
			expect(queuedCount()).toBe(0);
		});

		it("never queues GET requests", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

			const p = api.get("/api/posts");
			const rejection = expect(p).rejects.toThrow("Failed to fetch");
			// GETs retry once (1000ms delay) — advance so the promise settles
			await vi.advanceTimersByTimeAsync(1000);
			await rejection;
			expect(queuedCount()).toBe(0);
		});

		it("never queues non-replayable chat sends", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(api.post("/api/chat", { text: "hi" })).rejects.toThrow(
				"Failed to fetch",
			);
			expect(queuedCount()).toBe(0);
		});

		it("never queues non-replayable reaction toggles", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(
				api.post("/api/reactions", { kind: "like" }),
			).rejects.toThrow("Failed to fetch");
			expect(queuedCount()).toBe(0);
		});

		it("never queues non-replayable inbox sends", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(api.post("/api/inbox/send", {})).rejects.toThrow(
				"Failed to fetch",
			);
			expect(queuedCount()).toBe(0);
		});

		it("never queues poll votes or poll creates — replay would duplicate polls and split vote totals", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(
				api.post("/api/polls", {
					action: "vote",
					poll_id: "poll_1",
					choices: [0],
				}),
			).rejects.toThrow("Failed to fetch");
			await expect(
				api.post("/api/polls", { title: "Should we fix the lift?" }),
			).rejects.toThrow("Failed to fetch");
			expect(queuedCount()).toBe(0);
		});

		it("never queues pre-publish analysis calls", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(
				api.post("/api/pre-publish", { title: "safe report" }),
			).rejects.toThrow("Failed to fetch");
			expect(queuedCount()).toBe(0);
		});

		it("never offline-queues an admin write", async () => {
			vi.useFakeTimers();
			setAdminSession("admin-token-queue", Date.now() + 60_000);
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(
				api.post("/api/admin", { action: "bulk_update" }),
			).rejects.toThrow("Failed to fetch");
			expect(queuedCount()).toBe(0);
		});

		it("does not queue a 4xx response (not transient)", async () => {
			vi.useFakeTimers();
			fetchMock.mockResolvedValue(errResponse(422, { error: "validation" }));
			await expect(api.post("/api/posts", {})).rejects.toThrow("validation");
			expect(queuedCount()).toBe(0);
		});

		it("does not queue when no body was sent", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
			await expect(
				api.del("/api/posts/1", undefined as unknown as object),
			).rejects.toThrow("Failed to fetch");
			expect(queuedCount()).toBe(0);
		});

		it("does not queue non-Error rejections", async () => {
			vi.useFakeTimers();
			fetchMock.mockRejectedValue("raw string rejection");
			await expect(api.post("/api/posts", {})).rejects.toBe(
				"raw string rejection",
			);
			expect(queuedCount()).toBe(0);
		});
	});

	describe("flush scheduling after successful writes", () => {
		it("flushes queued actions shortly after a successful write", async () => {
			vi.useFakeTimers();
			// Fresh module instance: the shared `flushScheduled` flag may already be
			// true from earlier successful writes in this file (their 500ms real
			// timers may still be pending), which would make scheduleFlush() no-op.
			vi.resetModules();
			const { api: freshApi } = await import("../lib/api");
			const { queueAction: freshQueueAction } = await import("../lib/offline");

			freshQueueAction("POST", "/api/queued-item", { queued: true });

			// Successful POST schedules the 500ms flush
			fetchMock
				.mockResolvedValueOnce(okResponse({ id: 1 })) // the POST itself
				.mockResolvedValueOnce(okResponse({})); // the flush replay
			await freshApi.post("/api/posts", { title: "triggers flush" });

			await vi.advanceTimersByTimeAsync(500);
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/queued-item",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ queued: true }),
				}),
			);
			expect(queuedCount()).toBe(0);
		});
	});
});

describe("api module-load flush", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("schedules a flush when a previous session left queued items", async () => {
		vi.useFakeTimers();
		localStorage.setItem("vb:anonId", "anon_legacy");
		localStorage.setItem(
			"vb:offlineQueue",
			JSON.stringify([
				{
					id: "q_legacy",
					method: "POST",
					path: "/api/legacy",
					body: { old: true },
					queuedAt: new Date().toISOString(),
					ownerId: "anon_legacy",
				},
			]),
		);

		vi.resetModules();
		await import("../lib/api"); // module-level: queuedCount() > 0 → scheduleFlush

		fetchMock.mockResolvedValue(okResponse({}));
		await vi.advanceTimersByTimeAsync(500);

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/legacy",
			expect.objectContaining({ method: "POST" }),
		);
		expect(JSON.parse(localStorage.getItem("vb:offlineQueue") ?? "[]")).toEqual(
			[],
		);
	});
});

describe("api uploadImage", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => vi.unstubAllGlobals());

	it("returns the server URL when the upload succeeds", async () => {
		fetchMock.mockResolvedValue(
			okResponse({ url: "https://cdn.example/x.png" }),
		);
		await expect(
			api.uploadImage("aGVsbG8=", "image/png", "user-1"),
		).resolves.toBe("https://cdn.example/x.png");

		const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(path).toBe("/api/upload");
		expect(JSON.parse(init.body as string)).toEqual({
			fileBase64: "aGVsbG8=",
			contentType: "image/png",
			author_id: "user-1",
		});
	});

	it("throws a clear error when the server upload fails", async () => {
		fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
		await expect(
			api.uploadImage("aGVsbG8=", "image/png", "user-1"),
		).rejects.toThrow(/storage unavailable/i);
	});

	it("throws a clear error when the upload rejects with a non-Error value", async () => {
		fetchMock.mockRejectedValue("raw failure");
		await expect(
			api.uploadImage("aGVsbG8=", "image/png", "user-1"),
		).rejects.toThrow(/storage unavailable/i);
	});

	it("throws a clear error when the server returns no URL", async () => {
		fetchMock.mockResolvedValue(okResponse({}));
		await expect(
			api.uploadImage("aGVsbG8=", "image/png", "user-1"),
		).rejects.toThrow(/no URL/i);
	});

	it("rejects oversized images before any upload attempt", async () => {
		const big = "a".repeat(3 * 1024 * 1024);
		await expect(
			api.uploadImage(big, "image/png", "user-1"),
		).rejects.toThrow(/too large/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("api paginated helpers", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => vi.unstubAllGlobals());

	it("paginated builds a cursor+limit query and returns the envelope", async () => {
		fetchMock.mockResolvedValue(
			okResponse({ data: [{ id: 1 }], nextCursor: "c2", total: 3 }),
		);
		const result = await api.paginated<{ id: number }>("/api/items", {
			cursor: "c1",
			limit: 5,
		});

		expect(result).toEqual({ data: [{ id: 1 }], nextCursor: "c2", total: 3 });
		const [path] = fetchMock.mock.calls[0] as [string];
		const url = new URL(path, "http://localhost");
		expect(url.searchParams.get("paginate")).toBe("1");
		expect(url.searchParams.get("cursor")).toBe("c1");
		expect(url.searchParams.get("limit")).toBe("5");
	});

	it("paginated omits cursor/limit when not provided", async () => {
		fetchMock.mockResolvedValue(
			okResponse({ data: [], nextCursor: null, total: 0 }),
		);
		await api.paginated("/api/items");
		const [path] = fetchMock.mock.calls[0] as [string];
		const url = new URL(path, "http://localhost");
		expect(url.searchParams.get("paginate")).toBe("1");
		expect(url.searchParams.has("cursor")).toBe(false);
		expect(url.searchParams.has("limit")).toBe(false);
	});

	it("postPaginated spreads paginate:true into the POST body", async () => {
		fetchMock.mockResolvedValue(
			okResponse({ data: [], nextCursor: null, total: 0 }),
		);
		await api.postPaginated("/api/admin/users", { role: "admin" });

		const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(path).toBe("/api/admin/users");
		expect(JSON.parse(init.body as string)).toEqual({
			role: "admin",
			paginate: true,
		});
	});
});

// ═══════════════════════════════════════════════════════════════════
// HTTP status must survive the throw.
//
// REGRESSION: PostDetail / CommunityDetail / the admin report preview all
// collapsed every failure into "not found", so a 429 or a timeout told users
// their own content had been deleted. They now branch on isNotFound, which is
// only true for a genuine 404 — this suite pins that contract.
// ═══════════════════════════════════════════════════════════════════
describe("api error status", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("isNotFound is true only for an ApiError carrying 404", () => {
		expect(isNotFound(new ApiError("gone", 404))).toBe(true);
		expect(isNotFound(new ApiError("busy", 429))).toBe(false);
		expect(isNotFound(new ApiError("boom", 500))).toBe(false);
	});

	it("isNotFound rejects everything that is not an ApiError", () => {
		// A bare object with status 404 must NOT count — only the real error
		// type the wrapper throws, otherwise any thrown shape could be mistaken
		// for a missing resource.
		expect(isNotFound(Object.assign(new Error("x"), { status: 404 }))).toBe(
			false,
		);
		expect(isNotFound(new Error("network down"))).toBe(false);
		expect(isNotFound("404")).toBe(false);
		expect(isNotFound(null)).toBe(false);
		expect(isNotFound(undefined)).toBe(false);
	});

	it("a 404 response throws an ApiError whose status is 404", async () => {
		fetchMock.mockResolvedValue(errResponse(404, { error: "Post not found" }));

		await expect(api.get("/api/posts?id=nope")).rejects.toMatchObject({
			name: "ApiError",
			status: 404,
			message: "Post not found",
		});
	});

	it("a 429 response still throws, but is NOT reported as not-found", async () => {
		fetchMock.mockResolvedValue(
			errResponse(429, { error: "Too many requests" }),
		);

		let caught: unknown;
		try {
			await api.get("/api/posts?id=p1");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).status).toBe(429);
		expect(isNotFound(caught)).toBe(false);
	});

	it("falls back to a status-labelled message when the body has no error", async () => {
		fetchMock.mockResolvedValue(errResponse(500, {}));
		await expect(api.get("/api/x")).rejects.toThrow("Request failed (500)");
	});

	it("carries the Retry-After header and an honest wait message on 429", async () => {
		fetchMock.mockResolvedValue(
			errResponse(429, { error: "Rate limit exceeded" }, { "Retry-After": "25" }),
		);
		await expect(api.get("/api/throttled")).rejects.toMatchObject({
			name: "ApiError",
			status: 429,
			retryAfter: 25,
			message: "Slow down a little — try again in 25s.",
		});
	});

	it("falls back to the body's retry_after when no header is present", async () => {
		fetchMock.mockResolvedValue(
			errResponse(429, { error: "Too many requests", retry_after: 12 }),
		);
		await expect(api.get("/api/throttled2")).rejects.toMatchObject({
			status: 429,
			retryAfter: 12,
		});
	});

	it("keeps the server's message when a 429 has no backoff hint", async () => {
		fetchMock.mockResolvedValue(errResponse(429, { error: "Too many requests" }));
		await expect(api.get("/api/throttled3")).rejects.toMatchObject({
			status: 429,
			retryAfter: 0,
			message: "Too many requests",
		});
	});

	it("auto-retries a GET 429 once when the wait is short (≤3s)", async () => {
		vi.useFakeTimers();
		fetchMock
			.mockResolvedValueOnce(
				errResponse(429, { error: "Temporarily rate limited" }, { "Retry-After": "2" }),
			)
			.mockResolvedValueOnce(okResponse({ recovered: true }));

		const p = api.get("/api/throttled-retry");
		// retryAfter=2s → delay 2000ms (clamped to ≤3000ms)
		await vi.advanceTimersByTimeAsync(2000);
		await expect(p).resolves.toEqual({ recovered: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("auto-retries a GET 503 once when the shed backoff is short (≤3s)", async () => {
		vi.useFakeTimers();
		fetchMock
			.mockResolvedValueOnce(
				errResponse(503, { error: "Server busy — retry shortly." }, { "Retry-After": "2" }),
			)
			.mockResolvedValueOnce(okResponse({ recovered: true }));

		const p = api.get("/api/shed-retry");
		await vi.advanceTimersByTimeAsync(2000);
		await expect(p).resolves.toEqual({ recovered: true });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("does NOT retry a GET 503 without a backoff hint", async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValue(
			errResponse(503, { error: "Server busy — retry shortly." }),
		);

		const p = api.get("/api/shed-naked");
		const rejection = expect(p).rejects.toThrow("Server busy — retry shortly.");
		await vi.advanceTimersByTimeAsync(10000);
		await rejection;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does NOT retry a GET 429 whose wait is long (>3s)", async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValue(
			errResponse(429, { error: "Hourly rate limit exceeded" }, { "Retry-After": "30" }),
		);

		const p = api.get("/api/throttled-long");
		const rejection = expect(p).rejects.toThrow(
			"Slow down a little — try again in 30s.",
		);
		// Even after far longer than any retry delay, only ONE fetch must have
		// happened — a 30s backoff is the server demanding real backoff.
		await vi.advanceTimersByTimeAsync(10000);
		await rejection;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("never offline-queues a write that was 429'd", async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValue(
			errResponse(429, { error: "Rate limit exceeded", retry_after: 20 }),
		);
		await expect(api.post("/api/posts", { title: "x" })).rejects.toThrow(
			"Slow down a little — try again in 20s.",
		);
		// Flushing a queued write later would bypass the server's backoff.
		expect(queuedCount()).toBe(0);
	});
});
