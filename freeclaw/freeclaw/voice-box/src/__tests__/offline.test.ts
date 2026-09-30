// ─── offline queue tests ─────────────────────────────────────────
// Locks in the offline-queue behavior used by the api wrapper:
//   1. queueAction persists writes to localStorage (capped at 20)
//   2. queuedCount reflects the persisted queue length
//   3. flushQueue replays writes, attaches admin tokens to admin-only
//      endpoints, drops 4xx, and re-queues 5xx / network failures
//   4. flushQueue with an empty queue is a no-op returning 0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushQueue, queueAction, queuedCount } from "../lib/offline";

const KEY = "vb:offlineQueue";

function readQueue(): Array<{
	id: string;
	method: string;
	path: string;
	body: unknown;
	queuedAt: string;
}> {
	return JSON.parse(localStorage.getItem(KEY) ?? "[]");
}

function okResponse(body: unknown = {}) {
	return { ok: true, status: 200, json: async () => body };
}

function statusResponse(status: number, body: unknown = {}) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("offline queue", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		localStorage.clear();
		sessionStorage.clear();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("queueAction persists an action with id/queuedAt and is countable", () => {
		queueAction("POST", "/api/anything", { hello: "world" });
		expect(queuedCount()).toBe(1);

		const item = readQueue()[0]!;
		expect(item.method).toBe("POST");
		expect(item.path).toBe("/api/anything");
		expect(item.body).toEqual({ hello: "world" });
		expect(item.id).toMatch(/^q_/);
		expect(new Date(item.queuedAt).getTime()).not.toBeNaN();
	});

	it("caps the queue at 20 items (drops oldest)", () => {
		for (let i = 0; i < 25; i++) queueAction("POST", `/api/item/${i}`, { i });
		expect(queuedCount()).toBe(20);
		const q = readQueue();
		// oldest 5 dropped — first remaining is item 5
		expect(q[0]?.path).toBe("/api/item/5");
		expect(q[q.length - 1]?.path).toBe("/api/item/24");
	});

	it("flushQueue returns 0 and stays empty for an empty queue", async () => {
		await expect(flushQueue()).resolves.toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not replay a write queued for a different anonymous identity", async () => {
		localStorage.setItem("vb:anonId", "anon_first");
		queueAction("POST", "/api/posts", { title: "belongs to first identity" });
		localStorage.setItem("vb:anonId", "anon_second");
		fetchMock.mockResolvedValue(okResponse({}));

		await expect(flushQueue()).resolves.toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(queuedCount()).toBe(0);
	});

	it("flushQueue replays successful writes and clears the queue", async () => {
		queueAction("POST", "/api/posts", { title: "x" });
		queueAction("DELETE", "/api/posts/1", null);
		fetchMock.mockResolvedValue(okResponse({ ok: true }));

		await expect(flushQueue()).resolves.toBe(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/posts",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ title: "x" }),
			}),
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/posts/1",
			expect.objectContaining({ method: "DELETE", body: null }),
		);
		expect(queuedCount()).toBe(0);
	});

	it.each([
		"/api/admin/users",
		"/api/cleanup",
		"/api/chat?threads=1",
		"/api/posts?action=read",
		"/api/posts?action=list",
		"/api/posts?action=stats",
		"/api/posts?action=pending",
		"/api/posts?action=audit",
	])("attaches the admin token for admin-only endpoint %s", async (path) => {
		sessionStorage.setItem(
			"vb:adminAuth",
			JSON.stringify({ token: "tok-123", exp: Date.now() + 60_000 }),
		);
		queueAction("POST", path, { data: 1 });
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			expect((init.headers as Record<string, string>)["x-admin-token"]).toBe(
				"tok-123",
			);
			return Promise.resolve(okResponse({}));
		});

		await expect(flushQueue()).resolves.toBe(1);
	});

	it("does not attach the admin token when the session is expired", async () => {
		sessionStorage.setItem(
			"vb:adminAuth",
			JSON.stringify({ token: "tok-123", exp: Date.now() - 1000 }),
		);
		queueAction("POST", "/api/admin/users", {});
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			expect(
				(init.headers as Record<string, string>)["x-admin-token"],
			).toBeUndefined();
			return Promise.resolve(okResponse({}));
		});

		await expect(flushQueue()).resolves.toBe(1);
	});

	it("does not attach the admin token when the stored session is malformed", async () => {
		sessionStorage.setItem("vb:adminAuth", "not-json{");
		queueAction("POST", "/api/admin/users", {});
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			expect(
				(init.headers as Record<string, string>)["x-admin-token"],
			).toBeUndefined();
			return Promise.resolve(okResponse({}));
		});

		await expect(flushQueue()).resolves.toBe(1);
	});

	it("does not attach the admin token when the stored session is an empty string", async () => {
		sessionStorage.setItem("vb:adminAuth", "");
		queueAction("POST", "/api/admin/users", {});
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			expect(
				(init.headers as Record<string, string>)["x-admin-token"],
			).toBeUndefined();
			return Promise.resolve(okResponse({}));
		});

		await expect(flushQueue()).resolves.toBe(1);
	});

	it("attaches the admin token when the session has no exp (never expires)", async () => {
		sessionStorage.setItem(
			"vb:adminAuth",
			JSON.stringify({ token: "no-exp-token" }),
		);
		queueAction("POST", "/api/admin/users", {});
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			expect((init.headers as Record<string, string>)["x-admin-token"]).toBe(
				"no-exp-token",
			);
			return Promise.resolve(okResponse({}));
		});

		await expect(flushQueue()).resolves.toBe(1);
	});

	it("does not attach the admin token for non-admin endpoints", async () => {
		queueAction("POST", "/api/posts", {});
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			expect(
				(init.headers as Record<string, string>)["x-admin-token"],
			).toBeUndefined();
			return Promise.resolve(okResponse({}));
		});

		await expect(flushQueue()).resolves.toBe(1);
	});

	it("re-queues 5xx server errors for a later retry", async () => {
		queueAction("POST", "/api/posts", {});
		fetchMock.mockResolvedValue(statusResponse(503));

		await expect(flushQueue()).resolves.toBe(0);
		expect(queuedCount()).toBe(1); // still queued
	});

	it("drops 4xx client errors — they would never succeed", async () => {
		queueAction("POST", "/api/posts", {});
		fetchMock.mockResolvedValue(statusResponse(400, { error: "bad" }));

		await expect(flushQueue()).resolves.toBe(0);
		expect(queuedCount()).toBe(0); // dropped
	});

	it("re-queues actions whose request throws (offline)", async () => {
		queueAction("POST", "/api/posts", {});
		fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

		await expect(flushQueue()).resolves.toBe(0);
		expect(queuedCount()).toBe(1);
	});

	it("mixes outcomes: success flushed, 5xx kept, 4xx dropped, throw kept", async () => {
		queueAction("POST", "/api/ok", {});
		queueAction("POST", "/api/server-error", {});
		queueAction("POST", "/api/client-error", {});
		queueAction("POST", "/api/network-error", {});
		fetchMock
			.mockResolvedValueOnce(okResponse({}))
			.mockResolvedValueOnce(statusResponse(500))
			.mockResolvedValueOnce(statusResponse(404))
			.mockRejectedValueOnce(new TypeError("Failed to fetch"));

		await expect(flushQueue()).resolves.toBe(1);
		expect(queuedCount()).toBe(2);
		const remaining = readQueue()
			.map((a) => a.path)
			.sort();
		expect(remaining).toEqual(["/api/network-error", "/api/server-error"]);
	});
});
