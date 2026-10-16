/** Offline queue: failed writes are stored locally and retried when back online. */
import { lsGet, lsSet, getAnonId } from "./identity";
import { apiBase } from "./platform";

interface QueuedAction {
	id: string;
	method: string;
	path: string;
	body: unknown;
	queuedAt: string;
	/** Anonymous identity that created the write. */
	ownerId: string;
}

const KEY = "vb:offlineQueue";
/** Canonical admin token key — must match api.ts (sessionStorage, JSON {token, exp}) */
const ADMIN_AUTH_KEY = "vb:adminAuth";
/** Per-item ceiling for flush requests — see flushQueue. */
const FLUSH_TIMEOUT_MS = 15_000;

export function queueAction(method: string, path: string, body: unknown) {
	const q = lsGet<QueuedAction[]>(KEY, []);
	let ownerId = "";
	try {
		ownerId = getAnonId();
	} catch {
		/* identity unavailable; flush will refuse to replay without an owner */
	}
	q.push({
		id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		method,
		path,
		body,
		queuedAt: new Date().toISOString(),
		ownerId,
	});
	lsSet(KEY, q.slice(-20)); // cap queue size
}

export function queuedCount(): number {
	return lsGet<QueuedAction[]>(KEY, []).length;
}

/** Check if a path requires admin authentication */
function isAdminEndpoint(path: string): boolean {
	return (
		path.startsWith("/api/admin") ||
		path.startsWith("/api/cleanup") ||
		path.startsWith("/api/chat?threads=1") ||
		path.includes("action=read") ||
		path.includes("action=list") ||
		path.includes("action=stats") ||
		path.includes("action=pending") ||
		path.includes("action=audit")
	);
}

/** Max age for queued items — discard after 24h to avoid replaying against
 *  a potentially changed API schema after a redeploy. */
const QUEUE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Server twin-scan window mirror (api/_posts.js IDEMPOTENCY_MS): the server
 * dedupes a same-author/same-title/same-category repost within 90s of the
 * original. A queued post-create OLDER than this that replays blindly can
 * land as a twin — the exact duplicate-post bug the scan prevents for fast
 * retries. Stale creates get a client-side twin check first instead.
 */
export const POST_TWIN_WINDOW_MS = 90_000;

function normalizeForCompare(s: unknown): string {
	return String(s ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** True when a queued action is a post-create (not an update, vote, or admin read). */
function isPostCreate(a: QueuedAction): a is QueuedAction & { body: Record<string, unknown> } {
	return (
		a.method === "POST" &&
		a.path === "/api/posts" &&
		!!a.body &&
		typeof a.body === "object" &&
		typeof (a.body as Record<string, unknown>).title === "string"
	);
}

/**
 * Stale-create twin check: does the owner already have a live post with the
 * same normalized title + category? Mirrors the server predicate
 * (same author, same category, non-empty normalized title). Fail-open:
 * any fetch/parse problem returns false so the write replays normally —
 * a possible twin beats silently dropping the user's post.
 */
export async function isStalePostTwin(
	a: QueuedAction,
	ownerId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	try {
		const body = a.body as Record<string, unknown>;
		const title = normalizeForCompare(body.title);
		if (!title) return false;
		const category =
			typeof body.category === "string" && body.category ? body.category : "Other";
		const res = await fetchImpl(
			`${apiBase()}/api/posts?author=${encodeURIComponent(ownerId)}&viewer=${encodeURIComponent(ownerId)}`,
			{ headers: { "x-anon-id": ownerId } },
		);
		if (!res.ok) return false;
		const rows = (await res.json()) as Array<{
			title?: unknown;
			category?: unknown;
			deleted?: unknown;
			hidden?: unknown;
		}>;
		if (!Array.isArray(rows)) return false;
		return rows.some(
			(p) =>
				!p.deleted &&
				!p.hidden &&
				(p.category || "Other") === category &&
				normalizeForCompare(p.title) === title,
		);
	} catch {
		return false;
	}
}

export async function flushQueue(): Promise<number> {
	let q = lsGet<QueuedAction[]>(KEY, []);
	if (!q.length) return 0;
	// Discard items older than 24h — stale writes may hit a changed API.
	// Also discard actions created by a different anonymous identity. A
	// browser can be handed to another person or log out before the queue
	// drains; replaying the old person's write under the new identity is a
	// data-integrity and privacy bug. Legacy entries without an owner are
	// intentionally dropped rather than guessed.
	const cutoff = Date.now() - QUEUE_TTL_MS;
	let currentOwnerId = "";
	try {
		currentOwnerId = getAnonId();
	} catch {
		/* identity unavailable; no queued write is safe to replay */
	}
	const before = q.length;
	q = q.filter(
		(a) =>
			a.ownerId === currentOwnerId && new Date(a.queuedAt).getTime() > cutoff,
	);
	if (q.length < before) lsSet(KEY, q);
	if (!q.length) return 0;
	let flushed = 0;
	const remaining: QueuedAction[] = [];
	for (const a of q) {
		// Stale post-create twin guard: the server dedupes reposts within
		// 90s, but an offline queue can replay hours later. If the owner
		// already has the post live, drop the replay and count it resolved
		// (the content exists — sending it again would only twin).
		if (
			isPostCreate(a) &&
			Date.now() - new Date(a.queuedAt).getTime() > POST_TWIN_WINDOW_MS &&
			a.ownerId === currentOwnerId
		) {
			let twin = false;
			try {
				twin = await isStalePostTwin(a, currentOwnerId);
			} catch {
				twin = false;
			}
			if (twin) {
				flushed++;
				continue;
			}
		}
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			try {
				const aid = getAnonId();
				if (aid) headers["x-anon-id"] = aid;
			} catch {
				/* identity not ready */
			}
			// Attach admin token for admin-only endpoints — read from canonical sessionStorage key
			if (isAdminEndpoint(a.path)) {
				try {
					const raw = sessionStorage.getItem(ADMIN_AUTH_KEY);
					if (raw) {
						const { token, exp } = JSON.parse(raw);
						if (token && (!exp || exp > Date.now()))
							headers["x-admin-token"] = token;
					}
				} catch {
					/* no valid session */
				}
			}
			// Hard per-item ceiling: a hung request used to stall the entire
			// sequential flush loop forever (scheduleFlush would keep re-entering
			// but never make progress past the stuck item).
			const ctrl = new AbortController();
			const kill = setTimeout(() => ctrl.abort(), FLUSH_TIMEOUT_MS);
			let res: Response;
			try {
				res = await fetch(apiBase() + a.path, {
					method: a.method,
					headers,
					body: a.body != null ? JSON.stringify(a.body) : null,
					signal: ctrl.signal,
					credentials: "include",
				});
			} finally {
				clearTimeout(kill);
			}
			if (res.ok) flushed++;
			else if (res.status >= 500 || res.status === 429) remaining.push(a); // retry server errors and throttle later
			// other 4xx / abort: drop or retry below — aborted requests land in catch
		} catch {
			remaining.push(a);
		}
	}
	lsSet(KEY, remaining);
	return flushed;
}
