/** Thin fetch wrapper for Voice Box API routes with offline queue for failed writes. */

import { getAnonId } from "./identity";
import { apiBase } from "./platform";
import { flushQueue, queueAction, queuedCount } from "./offline";
import { errorText } from "./utils";

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

/**
 * Thrown for a non-2xx API response, carrying the HTTP status.
 *
 * The status matters because "the server says this is gone" (404) and "the
 * request itself failed" (429, 500, timeout) are completely different facts.
 * Pages used to collapse both into "Post not found", so a busy API told users
 * their own content had been deleted. Use `isNotFound` to tell them apart.
 */
export class ApiError extends Error {
	readonly status: number;
	/** Seconds the server asked us to wait before retrying (429 only; from the
	 *  Retry-After header or the body's retry_after). 0 when absent. */
	readonly retryAfter: number;
	/** Machine-readable server code (e.g. "session_unrecoverable") when the
	 *  response body carried one. Lets callers tell "retry may help" apart
	 *  from "retry is futile" without parsing message text. */
	readonly code?: string;
	constructor(message: string, status: number, retryAfter = 0, code?: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.retryAfter = retryAfter;
		if (code !== undefined) this.code = code;
	}
}

/** True only when the server explicitly reports the resource as absent. */
export function isNotFound(err: unknown): boolean {
	return err instanceof ApiError && err.status === 404;
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

const TIMEOUT_MS = 15000; // hard ceiling — cold Supabase/Vercel starts need headroom; no request may hang forever
const UPLOAD_TIMEOUT_MS = 30000; // uploads need more time
const AGENT_TIMEOUT_MS = 28000; // agent chat does multiple DB queries + intent matching
const LLM_TIMEOUT_MS = 28000; // LLM analysis calls (near Vercel's 30s max)
const INBOX_TIMEOUT_MS = 45000; // inbox AI generates a reply server-side (up to 35s) — must NOT use the 8s default
const AGENT_RUN_TIMEOUT_MS = 55000; // proxied agent runs: server allows 45s, Vercel kills at 60s

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

// ---- Concurrency cap (100+ simultaneous users) ----
// At most MAX_INFLIGHT requests in flight; the rest wait FIFO. Prevents
// socket exhaustion and 429 storms when the whole room loads at once
// (feed + leaderboard + realtime refresh firing together × 100 users).
// Timer-free promise chaining — no interaction with fake-timer tests.
const MAX_INFLIGHT = 6;
let inflightCount = 0;
const waitQueue: Array<() => void> = [];

function tryAcquireSlot(): boolean {
	if (inflightCount < MAX_INFLIGHT) {
		inflightCount++;
		return true;
	}
	return false;
}

function waitForSlot(): Promise<void> {
	return new Promise<void>((resolve) => {
		waitQueue.push(() => {
			inflightCount++;
			resolve();
		});
	});
}

function releaseSlot(): void {
	inflightCount = Math.max(0, inflightCount - 1);
	const next = waitQueue.shift();
	if (next) next();
}

/** Test-only: drop all held slots and queued waiters. Module state leaks
 *  across tests in one file (a test that leaves a request unsettled would
 *  starve later tests); production always settles via timeouts. */
export function resetConcurrencyForTests(): void {
	inflightCount = 0;
	waitQueue.length = 0;
	inflight.clear();
	getCache.clear();
}

function cacheKey(method: string, path: string, viewerKey: string): string {
	return `${method}:${path}:${viewerKey}`;
}

/* Retry up to 1 time for transient network errors on GET requests */
const MAX_GET_RETRIES = 1;
const GET_RETRY_DELAY_MS = 1000;
/* A 429 — or a 503 from the load-shed guard — whose Retry-After is this
 * short is auto-retried once on GETs: a fast navigation burst occasionally
 * brushes the limiter, and waiting ≤3s is invisible. Longer waits are the
 * server asking for real backoff — those surface the honest message
 * instead of silently stalling the UI. */
const MAX_AUTO_RETRY_AFTER_SEC = 3;

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
 * like BACK OFF (double toggle). Pre-publish analysis is advisory and must
 * never be replayed either: a timed-out check can complete server-side, and
 * replaying it creates duplicate audits/rate-limit work without changing the
 * post decision. The UI reconciles via the server's response and realtime
 * refresh instead. Admin and maintenance writes are also non-replayable:
 * their authorization and target set can change before a later flush, and a
 * blind retry could repeat a destructive action under a different session.
 *
 * Poll votes and poll creates are never offline-queued either: a timed-out
 * create that actually persisted would replay into a DUPLICATE poll row,
 * splitting that question's votes across two polls so every surface shows a
 * partial total. Votes reconcile via the server response + realtime refresh.
 */
function isNonReplayable(path: string): boolean {
	return (
		path.startsWith("/api/inbox") ||
		path.startsWith("/api/chat") ||
		path.startsWith("/api/reactions") ||
		path.startsWith("/api/pre-publish") ||
		path.startsWith("/api/upload") ||
		path.startsWith("/api/admin") ||
		path.startsWith("/api/cleanup") ||
		path.startsWith("/api/polls")
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
	// Send per-user identity for rate limiting (each user gets their own bucket).
	// Keep the same identity in the cache/in-flight key: admin and public reads
	// can have different response shapes for the same path.
	let aid = "";
	try {
		aid = getAnonId() || "";
		if (aid) headers["x-anon-id"] = aid;
	} catch { /* identity module not ready */ }
	const viewerKey = JSON.stringify([t ?? "", aid]);

	// For GET requests: check cache, deduplicate in-flight
	if (method === "GET") {
		const key = cacheKey(method, path, viewerKey);
		if (!opts.noCache) {
			const cached = getCache.get(key);
			if (cached && cached.expiresAt > Date.now()) return cached.data as T;
		}
		const pending = inflight.get(key);
		if (pending) return pending as Promise<T>;
	}

	const ctrl = new AbortController();
	let timer = setTimeout(() => ctrl.abort(), timeoutMs);

	// Take a concurrency slot. Fast path stays fully synchronous (no await
	// suspends) so simultaneous GETs still dedupe against the in-flight map
	// registered below; only the contended path waits FIFO.
	if (!tryAcquireSlot()) await waitForSlot();

	/** Inner fetch with optional retry for transient errors */
	const doFetch = async (attempt: number): Promise<T> => {
		try {
			// noCache fetches (realtime-triggered refreshes) must bypass the browser
			// HTTP cache too — otherwise a `public, max-age` response served from the
			// HTTP/CDN cache re-applies stale state (e.g. toggled-off reactions
			// coming back) until the max-age window expires.
			// Native shells (Electron file://, Capacitor) have no same-origin
			// /api — prefix the baked-in production origin there. Web stays
			// same-origin (apiBase() is "").
			const res = await fetch(apiBase() + path, {
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
				// Prefer the Retry-After header (shared limiter) over the body's
				// retry_after (rateLimitResponse); both may be present.
				const retryAfter =
					Number(res.headers?.get?.("retry-after")) ||
					(data as { retry_after?: number } | undefined)?.retry_after ||
					0;
				const serverMsg =
					(data as { error?: string } | undefined)?.error ||
					`Request failed (${res.status})`;
				const serverCode =
					typeof (data as { code?: unknown } | undefined)?.code === "string"
						? (data as { code: string }).code
						: undefined;
				throw new ApiError(
					res.status === 429 && retryAfter > 0
						? `Slow down a little — try again in ${retryAfter}s.`
						: serverMsg,
					res.status,
					retryAfter,
					serverCode,
				);
			}
			if (data === undefined) {
				throw new Error("Unexpected response from server — please try again.");
			}
			// After successful write, flush any queued offline actions and
			// invalidate the 5s GET cache so the very next fetch is fresh.
			// Without this, hide/unhide/pin etc. appear to work only once
			// because the following GET returns the stale cached response.
			if (method !== "GET") {
				scheduleFlush();
				getCache.clear();
			}
			// Cache successful GET responses briefly (unless the caller asked for fresh data)
			if (method === "GET" && !opts.noCache) {
				getCache.set(cacheKey(method, path, viewerKey), {
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
			// Timeouts/AbortErrors are NEVER queued for any path: the outcome
			// is ambiguous (the write may already be applied), so replaying
			// later would double-apply (double post, double vote). Only hard
			// connection failures — where the request provably never left —
			// are safe to replay.
			const aborted =
				err instanceof Error &&
				(err.name === "AbortError" || err.message.includes("timed out"));
			const transient = !aborted && isTransientError(err);
			if (
				transient &&
				method !== "GET" &&
				body != null &&
				!isNonReplayable(path)
			) {
				queueAction(method, path, body ?? null);
			}
			// A 429'd or shed (503) WRITE is deliberately NOT offline-queued: the
			// server asked for backoff, and flushing the queue later would bypass
			// it. The thrown message tells the user exactly how long to wait.
			const throttled =
				err instanceof ApiError &&
				(err.status === 429 || err.status === 503) &&
				err.retryAfter > 0 &&
				err.retryAfter <= MAX_AUTO_RETRY_AFTER_SEC;
			// Retry once for GET requests on transient errors (but NOT AbortError —
			// signal is dead) or on a short 429/503 the user would barely notice.
			if (
				method === "GET" &&
				attempt < MAX_GET_RETRIES &&
				((transient &&
					!(err instanceof Error && err.name === "AbortError")) ||
					throttled)
			) {
				const waitMs = throttled
					? Math.min(
							Math.max((err as ApiError).retryAfter * 1000, GET_RETRY_DELAY_MS),
							MAX_AUTO_RETRY_AFTER_SEC * 1000,
					  )
					: GET_RETRY_DELAY_MS;
				console.warn(
					`[api] GET ${path} failed (attempt ${attempt + 1}), retrying in ${waitMs}ms…`,
				);
				// Give the retry a FULL timeout window: the shared countdown kept
				// running during attempt 1, so a request that failed after 7s of an
				// 8s budget used to leave its retry just 1s before the abort fired.
				// The signal has NOT been aborted here (AbortError is excluded
				// above), so restarting the countdown is safe. The delay itself runs
				// inside the fresh window, matching the original single-attempt cost.
				clearTimeout(timer);
				timer = setTimeout(() => ctrl.abort(), timeoutMs + waitMs);
				await delay(waitMs);
				return doFetch(attempt + 1);
			}
			if (err instanceof Error && err.name === "AbortError") {
				// Offline (airplane mode, dead wifi) vs slow server are different
				// facts — say which one so the user acts correctly. navigator
				// is guarded for SSR/jsdom where it may be undefined.
				const offline =
					typeof navigator !== "undefined" && navigator.onLine === false;
				throw new Error(
					offline
						? "You're offline — reconnect and retry. Nothing was sent twice."
						: `Server is taking too long (${Math.round(timeoutMs / 1000)}s) — likely a cold start. Retry in a moment; nothing was sent twice.`,
				);
			}
			throw err;
		}
	};

	const reqPromise = doFetch(0).finally(() => {
		clearTimeout(timer);
		releaseSlot();
		if (method === "GET") inflight.delete(cacheKey(method, path, viewerKey));
	});

	// Track in-flight GET requests for deduplication
	if (method === "GET") inflight.set(cacheKey(method, path, viewerKey), reqPromise);
	return reqPromise;
}

/**
 * Upload image to server-side storage.
 * Strategy: try server upload once → on failure, throw a clear
 * storage_unavailable error instead of silently inlining a base64 data URL
 * (which bloats every row that embeds it and slows all later reads).
 */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
async function uploadImage(
	fileBase64: string,
	contentType: string,
	author_id: string,
): Promise<string> {
	const approxBytes = Math.floor(fileBase64.length * 0.75);
	if (approxBytes > MAX_INLINE_IMAGE_BYTES) {
		throw new Error(
			`Image too large (${Math.round(approxBytes / 1024)}KB) — please choose a smaller file.`,
		);
	}
	try {
		const up = await request<{ url?: string }>(
			"POST",
			"/api/upload",
			{ fileBase64, contentType, author_id },
			UPLOAD_TIMEOUT_MS,
		);
		if (up.url) return up.url;
	} catch (e: unknown) {
		const msg = errorText(e) || "no details — please retry";
		console.error("[upload] storage upload failed", { error: msg });
		throw new Error(`Image storage unavailable (${msg}) — please retry shortly.`);
	}
	throw new Error("Image storage returned no URL — please retry shortly.");
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
	/** Proxied agent runs: the server allows 45s before Vercel's 60s kill */
	postAgent: <T = unknown>(path: string, body: unknown) =>
		request<T>("POST", path, body, AGENT_RUN_TIMEOUT_MS),
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
		params: {
			cursor?: string | null;
			limit?: number;
			/** Extra query params — lets list filters run server-side so they
			 *  apply to the whole dataset instead of only the loaded page. */
			query?: Record<string, string | null | undefined>;
		} = {},
	): Promise<{ data: T[]; nextCursor: string | null; total: number }> => {
		const url = new URL(path, window.location.origin);
		url.searchParams.set("paginate", "1");
		if (params.cursor) url.searchParams.set("cursor", params.cursor);
		if (params.limit) url.searchParams.set("limit", String(params.limit));
		for (const [k, v] of Object.entries(params.query || {})) {
			if (v !== null && v !== undefined && v !== "") {
				url.searchParams.set(k, v);
			}
		}
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
