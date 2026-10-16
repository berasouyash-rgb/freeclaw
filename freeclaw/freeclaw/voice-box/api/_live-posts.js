// Dual-source live-post reader — the shared read path for the case-handling
// workforce workers (roster #7–#10).
//
// The workforce runs inside serverless functions that may reach the data two
// ways: directly through the Supabase client, or through this app's own public
// feed endpoint (`GET /api/posts`). A worker must not break just because one
// of those paths is unavailable, so this helper hides the choice:
//
//   1. Try the direct table read (fast, complete, no self-HTTP hop).
//   2. Only when that path is unavailable (client unconfigured, query error),
//      fall back to the server feed.
//
// It NEVER throws. An unreachable backend yields `{ ok: false, posts: [] }`
// so a worker can stand down honestly instead of failing the whole tick.
import supabase from "./_db-client.js";

export const DEFAULT_POST_COLUMNS =
	"id, title, description, category, status, priority, tags, created_at, updated_at";
export const DEFAULT_SCAN_LIMIT = 300;
const SERVER_PAGE_LIMIT = 100;

/** Base URL of this deployment, or "" when unknown (local/dev). */
export function resolveBaseUrl() {
	if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
	return process.env.APP_BASE_URL || "";
}

async function readFromSupabase({ columns, limit }) {
	try {
		const { data, error } = await supabase
			.from("posts")
			.select(columns)
			.eq("deleted", false)
			.eq("hidden", false)
			.limit(limit);
		if (error) throw error;
		return { ok: true, posts: Array.isArray(data) ? data : [] };
	} catch (err) {
		return { ok: false, posts: [], error: err?.message || String(err) };
	}
}

async function readFromServer({ limit }) {
	const base = resolveBaseUrl();
	if (!base) return { ok: false, posts: [], error: "no base URL configured" };
	try {
		const res = await fetch(`${base}/api/posts?limit=${SERVER_PAGE_LIMIT}`, {
			headers: { accept: "application/json" },
		});
		if (!res.ok) throw new Error(`posts feed responded ${res.status}`);
		const body = await res.json();
		// The feed returns a bare array; tolerate `{ posts }` / `{ data }` too.
		const rows = Array.isArray(body) ? body : body?.posts || body?.data || [];
		return { ok: true, posts: rows.slice(0, limit) };
	} catch (err) {
		return { ok: false, posts: [], error: err?.message || String(err) };
	}
}

/**
 * Read live (non-deleted, non-hidden) posts from the best available backend.
 *
 * @returns {Promise<{ ok: boolean, source: "supabase"|"server"|null, posts: object[], error?: string }>}
 */
export async function readLivePosts({
	columns = DEFAULT_POST_COLUMNS,
	limit = DEFAULT_SCAN_LIMIT,
} = {}) {
	const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_SCAN_LIMIT, 500));
	const direct = await readFromSupabase({ columns, limit: capped });
	// A successful direct read wins even when it is empty — falling through to
	// the server on an empty result would make the two backends disagree.
	if (direct.ok) return { ok: true, source: "supabase", posts: direct.posts };
	const server = await readFromServer({ limit: capped });
	if (server.ok) return { ok: true, source: "server", posts: server.posts };
	return { ok: false, source: null, posts: [], error: server.error || direct.error };
}
