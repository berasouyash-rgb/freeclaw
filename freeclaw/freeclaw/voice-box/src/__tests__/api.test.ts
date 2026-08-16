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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	api,
	clearAdminSession,
	hasAdminSession,
	setAdminSession,
} from "../lib/api";
import { queuedCount } from "../lib/offline";

function okResponse(body: unknown = {}) {
	return {
		ok: true,
		status: 200,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

function errResponse(status: number, body: unknown = {}) {
	return {
		ok: false,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
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
				"Request timed out — check your connection and retry.",
			);
			await vi.advanceTimersByTimeAsync(8000);
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

		it("queues a write that times out (AbortError)", async () => {
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
				"Request timed out — check your connection and retry.",
			);
			await vi.advanceTimersByTimeAsync(8000);
			await rejection;
			expect(queuedCount()).toBe(1);
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
		localStorage.setItem(
			"vb:offlineQueue",
			JSON.stringify([
				{
					id: "q_legacy",
					method: "POST",
					path: "/api/legacy",
					body: { old: true },
					queuedAt: new Date().toISOString(),
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

	it("falls back to a data URL when the server upload fails", async () => {
		fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
		await expect(
			api.uploadImage("aGVsbG8=", "image/png", "user-1"),
		).resolves.toBe("data:image/png;base64,aGVsbG8=");
	});

	it("falls back to a data URL when the upload rejects with a non-Error value", async () => {
		fetchMock.mockRejectedValue("raw failure");
		await expect(
			api.uploadImage("aGVsbG8=", "image/png", "user-1"),
		).resolves.toBe("data:image/png;base64,aGVsbG8=");
	});

	it("falls back to a data URL when the server returns no URL", async () => {
		fetchMock.mockResolvedValue(okResponse({}));
		await expect(
			api.uploadImage("aGVsbG8=", "image/png", "user-1"),
		).resolves.toBe("data:image/png;base64,aGVsbG8=");
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
