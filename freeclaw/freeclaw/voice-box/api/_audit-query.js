// Audit-log filter builder.
//
// The admin Logs view used to paginate the entire activity stream with no
// server-side filtering; its search box only filtered agent events. These
// helpers are shared by the API so actor/action/date/search narrowing happens
// in Postgres (and so the `total` count reflects the same filter set).
//
// PostgREST's `or` expression treats comma/parentheses as syntax and `% _ *`
// as pattern characters, so free text is reduced to plain words before it is
// interpolated.

const MAX_FILTER_LEN = 80;
const MAX_SEARCH_LEN = 60;

function text(value, max) {
	return String(value ?? "")
		.replace(/[\u0000-\u001F\u007F]/g, " ")
		.trim()
		.slice(0, max);
}

export function sanitizeAuditSearch(value) {
	return text(value, MAX_SEARCH_LEN)
		.replace(/[%,()*_\\"]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function isoDate(value) {
	const raw = String(value ?? "").trim();
	if (!raw) return null;
	const ms = Date.parse(raw);
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function parseAuditFilters(params = {}) {
	return {
		actor: text(params.actor, MAX_FILTER_LEN) || null,
		action: text(params.logAction, MAX_FILTER_LEN) || null,
		since: isoDate(params.since),
		until: isoDate(params.until),
		search: sanitizeAuditSearch(params.q) || null,
	};
}

/**
 * Apply filters to a Supabase query builder. Pure with respect to the
 * builder passed in: returns the same (thenable) builder with predicates
 * queued, so the caller keeps `.order()` / `.limit()` control.
 */
export function applyAuditFilters(query, filters) {
	let out = query;
	if (!filters) return out;
	if (filters.actor) out = out.eq("actor", filters.actor);
	if (filters.action) out = out.eq("action", filters.action);
	if (filters.since) out = out.gte("created_at", filters.since);
	if (filters.until) out = out.lte("created_at", filters.until);
	if (filters.search) {
		const pattern = `%${filters.search}%`;
		out = out.or(
			`actor.ilike.${pattern},action.ilike.${pattern},detail.ilike.${pattern}`,
		);
	}
	return out;
}
