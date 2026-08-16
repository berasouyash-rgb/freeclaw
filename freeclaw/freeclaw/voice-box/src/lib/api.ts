/** Thin fetch wrapper for Voice Box API routes with offline queue for failed writes. */

import { flushQueue, queueAction, queuedCount } from "./offline";

function adminToken(): string | null {
	try {
		const raw = sessionStorage.getItem("vb:adminAuth");
		if (!raw) return null;
		const { token, exp } = JSON.parse(raw);
		if (exp && exp < Date.now()) {
			sessionStorage.removeItem("vb:adminAuth");
			return null;
		}
		return token;
	} catch {
		return null;
	}
}

export function hasAdminSession(): boolean {
	return !!adminToken();
}

export function setAdminSession(token: string, exp: string | number) {
	sessionStorage.setItem("vb:adminAuth", JSON.stringify({ token, exp }));
}

export function clearAdminSession() {
	sessionStorage.removeItem("vb:adminAuth");
}

export { queuedCount } from "./offline";

const TIMEOUT_MS = 8000; // hard ceiling — no request may hang forever
const UPLOAD_TIMEOUT_MS = 30000; // uploads need more time
const AGENT_TIMEOUT_MS = 28000; // agent chat does multiple DB queries + intent matching
const LLM_TIMEOUT_MS = 28000; // LLM analysis calls (near Vercel's 30s max)
const INBOX_TIMEOUT_MS = 45000; // inbox AI generates a reply server-side (up to 35s) — must NOT use the 8s default

/** Flush offline queue on startup and after successful writes. */
let flushScheduled = false;
function scheduleFlush() {
	if (flushScheduled) return;
	flushScheduled = true;
	setTimeout(async () => {
		flushScheduled = false;
		try {
			await flushQueue();
		} catch {
			/* best effort */
		}
	}, 500);
}

// Flush on page load (if there are queued items from a previous session)
if (typeof window !== "undefined" && queuedCount() > 0) {
	scheduleFlush();
}

// ---- GET request deduplication + short-lived cache ----
// Prevents duplicate in-flight requests (e.g. React double-render) and
// caches GET responses for 5s to avoid redundant fetches within a single
// page lifecycle (e.g. mount → realtime → re-render).
const inflight = new Map<string, Promise<unknown>>();
const getCache = new Map<string, { data: unknown; expiresAt: number }>();
const GET_CACHE_TTL_MS = 5000;

function cacheKey(method: string, path: string): string {
	return `${method}:${path}`;
}

/* Retry up to 1 time for transient network errors on GET requests */
const MAX_GET_RETRIES = 1;
const GET_RETRY_DELAY_MS = 1000;

function isTransientError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return (
		err.name === "AbortError" ||
		err.message.includes("Failed to fetch") ||
		err.message.includes("NetworkError") ||
		err.message.includes("network") ||
		err.message.includes("timed out")
	);
}

/**
 * Chat message sends are never offline-queued: the server stores the message
 * (and generates the AI reply) before responding, so a timed-out request must
 * not be replayed — it would duplicate the message. The chat UI re-syncs and
 * falls back client-side on its own.
 *
 * Reaction toggles are also never offline-queued: a timed-out like may have
 * actually been applied server-side, and replaying it later would flip the
 * like BACK OFF (double toggle). The UI reconciles via the server's response
 * and realtime refresh instead.
 */
function isNonReplayable(path: string): boolean {
	return (
		path.startsWith("/api/inbox") ||
		path.startsWith("/api/chat") ||
		path.startsWith("/api/reactions")
	);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
	timeoutMs = TIMEOUT_MS,
	opts: { noCache?: boolean } = {},
): Promise<T> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const t = adminToken();
	if (t) headers["X-Admin-Token"] = t;

	// For GET requests: check cache, deduplicate in-flight
	if (method === "GET") {
		const key = cacheKey(method, path);
		if (!opts.noCache) {
			const cached = getCache.get(key);
			if (cached && cached.expiresAt > Date.now()) return cached.data as T;
		}
		const pending = inflight.get(key);
		if (pending) return pending as Promise<T>;
	}

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);

	/** Inner fetch with optional retry for transient errors */
	const doFetch = async (attempt: number): Promise<T> => {
		try {
			// noCache fetches (realtime-triggered refreshes) must bypass the browser
			// HTTP cache too — otherwise a `public, max-age` response served from the
			// HTTP/CDN cache re-applies stale state (e.g. toggled-off reactions
			// coming back) until the max-age window expires.
			const res = await fetch(path, {
				method,
				headers,
				body: body != null ? JSON.stringify(body) : null,
				signal: ctrl.signal,
				cache: opts.noCache ? "no-store" : "default",
			});

			// Parse the body WITHOUT silently swallowing a wrong-shape response:
			// - empty body (204/205-style) → treat as {}
			// - !ok → throw with the server's error message when present
			// - ok but not JSON (SPA fallback, misconfigured proxy, HTML error page)
			//   → THROW instead of returning {} — returning {} used to crash pages
			//   that read nested fields (e.g. Insights: `data.trend.map`).
			const text = await res.text();
			let data: unknown = {};
			if (text) {
				try {
					data = JSON.parse(text);
				} catch {
					data = undefined;
				}
			}
			if (!res.ok) {
				throw new Error(
					(data as { error?: string } | undefined)?.error ||
						`Request failed (${res.status})`,
				);
			}
			if (data === undefined) {
				throw new Error("Unexpected response from server — please try again.");
			}
			// After successful write, flush any queued offline actions
			if (method !== "GET") scheduleFlush();
			// Cache successful GET responses briefly (unless the caller asked for fresh data)
			if (method === "GET" && !opts.noCache) {
				getCache.set(cacheKey(method, path), {
					data,
					expiresAt: Date.now() + GET_CACHE_TTL_MS,
				});
			}
			return data as T;
		} catch (err: unknown) {
			// Auto-queue failed writes (POST/PUT/DELETE) on network/timeout errors.
			// EXCEPT chat sends and reaction toggles: chat saves the message and
			// generates the AI reply server-side before responding (replaying would
			// duplicate it), and a reaction toggle that timed out may already be
			// applied server-side (replaying would flip it back). Both surfaces
			// recover via realtime + server response, so they are never queued.
			const transient = isTransientError(err);
			if (transient && method !== "GET" && body && !isNonReplayable(path)) {
				queueAction(method, path, body);
			}
			// Retry once for GET requests on transient errors (but NOT AbortError — signal is dead)
			if (
				transient &&
				method === "GET" &&
				attempt < MAX_GET_RETRIES &&
				!(err instanceof Error && err.name === "AbortError")
			) {
				console.warn(
					`[api] GET ${path} failed (attempt ${attempt + 1}), retrying in ${GET_RETRY_DELAY_MS}ms…`,
				);
				await delay(GET_RETRY_DELAY_MS);
				return doFetch(attempt + 1);
			}
			if (err instanceof Error && err.name === "AbortError") {
				throw new Error("Request timed out — check your connection and retry.");
			}
			throw err;
		}
	};

	const reqPromise = doFetch(0).finally(() => {
		clearTimeout(timer);
		if (method === "GET") inflight.delete(cacheKey(method, path));
	});

	// Track in-flight GET requests for deduplication
	if (method === "GET") inflight.set(cacheKey(method, path), reqPromise);
	return reqPromise;
}

/**
 * Upload image with automatic retry and fallback.
 * Strategy: try server upload → if fails, return data URL (works everywhere, no storage needed).
 */
async function uploadImage(
	fileBase64: string,
	contentType: string,
	author_id: string,
): Promise<string> {
	// Attempt 1: server-side storage upload
	try {
		const up = await request<{ url?: string }>(
			"POST",
			"/api/upload",
			{ fileBase64, contentType, author_id },
			UPLOAD_TIMEOUT_MS,
		);
		if (up.url) return up.url;
	} catch (e: unknown) {
		console.warn(
			"Upload to storage failed, using data URL fallback:",
			e instanceof Error ? e.message : "unknown error",
		);
	}
	// Fallback: inline data URL — works without any storage
	return `data:${contentType};base64,${fileBase64}`;
}

export const api = {
	get: <T = unknown>(path: string) => request<T>("GET", path),
	/** Bypass the 5s GET cache — for realtime-triggered refreshes that must show live data. */
	getFresh: <T = unknown>(path: string) =>
		request<T>("GET", path, undefined, TIMEOUT_MS, { noCache: true }),
	/** Slow GET with generous timeout — for endpoints that make multiple sequential DB queries (e.g. leaderboard). */
	getSlow: <T = unknown>(path: string) =>
		request<T>("GET", path, undefined, AGENT_TIMEOUT_MS),
	/** Slow GET + bypass 5s cache — for realtime-triggered refreshes on slow endpoints (e.g. feed). */
	getSlowFresh: <T = unknown>(path: string) =>
		request<T>("GET", path, undefined, AGENT_TIMEOUT_MS, { noCache: true }),
	post: <T = unknown>(path: string, body: unknown) =>
		request<T>("POST", path, body),
	postLong: <T = unknown>(path: string, body: unknown) =>
		request<T>("POST", path, body, AGENT_TIMEOUT_MS),
	postSlow: <T = unknown>(path: string, body: unknown) =>
		request<T>("POST", path, body, LLM_TIMEOUT_MS), // for LLM analysis
	/** Inbox AI sends: server generates an AI reply in up to 35s, so use a generous timeout */
	postInbox: <T = unknown>(path: string, body: unknown) =>
		request<T>("POST", path, body, INBOX_TIMEOUT_MS),
	put: <T = unknown>(path: string, body: unknown) =>
		request<T>("PUT", path, body),
	del: <T = unknown>(path: string, body: unknown) =>
		request<T>("DELETE", path, body),
	uploadImage,
	/**
	 * Cursor-based paginated request.
	 * Returns { data: T[], nextCursor: string | null, total: number }
	 */
	paginated: <T = unknown>(
		path: string,
		params: { cursor?: string | null; limit?: number } = {},
	): Promise<{ data: T[]; nextCursor: string | null; total: number }> => {
		const url = new URL(path, window.location.origin);
		url.searchParams.set("paginate", "1");
		if (params.cursor) url.searchParams.set("cursor", params.cursor);
		if (params.limit) url.searchParams.set("limit", String(params.limit));
		return request<{ data: T[]; nextCursor: string | null; total: number }>(
			"GET",
			url.pathname + url.search,
		);
	},
	/**
	 * Paginated POST request (for admin actions like users).
	 */
	postPaginated: <T = unknown>(
		path: string,
		body: unknown,
	): Promise<{ data: T[]; nextCursor: string | null; total: number }> => {
		return request<{ data: T[]; nextCursor: string | null; total: number }>(
			"POST",
			path,
			{ ...(body as object), paginate: true },
		);
	},
};
