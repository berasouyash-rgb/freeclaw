// ─── Automatic read switch: Supabase → Firebase ────────────────────
// This is the piece that makes the standby REAL. A copy nobody reads from is
// not redundancy: when Postgres hits an internal error or the egress/quota
// limit, the user still gets a 500 while their data sits one hop away.
//
// WHERE IT RUNS
// `_db-client.js` wraps every Supabase request in one custom fetch. When that
// request fails for an INFRASTRUCTURE reason and the table is mirrored, this
// module answers the same request from Firestore and hands supabase-js a
// normal `Response`, so no route code knows a switch happened.
//
// WHAT IT REFUSES TO DO
//   • 400/401/403/404/422 are the app telling us the request was wrong. Those
//     never move traffic: failing over on an auth bug would read rows under a
//     different backend for a reason that has nothing to do with availability.
//   • An empty answer is not a substitute for an error. If the standby has no
//     rows and the caller asked for "everything", the original failure is
//     returned rather than a convincing-looking empty feed.
//   • Only EQUAL filters are translated. A query it cannot reproduce exactly
//     returns the real error instead of a different result set.
//   • Writes never take this path. Accepting an unreconciled write would be
//     the compromise this whole design exists to avoid.
import { isMirroredTable, readStandby } from "./_mirror.js";

/**
 * Should a failed primary request be retried against the standby?
 *
 * `status` 0/undefined means the transport itself failed (timeout, DNS, reset).
 */
export function shouldFallbackRead(method, status) {
	if (String(method || "GET").toUpperCase() !== "GET") return false;
	const code = Number(status) || 0;
	if (code === 0) return true; // transport failure
	// 408 request timeout, 402 payment required (quota), 429 rate limited:
	// all mean "this backend cannot serve the request right now".
	if (code === 408 || code === 402 || code === 429) return true;
	return code >= 500;
}

/**
 * Extract the table, equality filters, limit and ordering from a PostgREST
 * URL. Returns null for anything without a recognisable table.
 *
 * Supported filter form: `?field=eq.value`. Anything else (gt, in, like, or)
 * is ignored for filtering, and the caller's guard then refuses to answer from
 * the standby rather than return rows that do not match the request.
 */
export function parsePostgrestRead(url) {
	try {
		const parsed = new URL(String(url));
		const match = parsed.pathname.match(/\/rest\/v1\/([A-Za-z0-9_]+)/);
		if (!match) return null;
		const table = match[1];
		const filters = [];
		let unsupported = false;
		const reserved = new Set(["select", "order", "limit", "offset", "apikey", "on_conflict"]);
		for (const [field, raw] of parsed.searchParams.entries()) {
			if (reserved.has(field)) continue;
			const eq = /^eq\.(.*)$/.exec(raw);
			if (eq) {
				filters.push({ field, value: eq[1] });
			} else {
				// A non-equality filter: the standby query would be a superset.
				unsupported = true;
			}
		}
		const limitRaw = Number.parseInt(parsed.searchParams.get("limit") || "", 10);
		const orderRaw = String(parsed.searchParams.get("order") || "");
		let orderBy = null;
		if (orderRaw) {
			const [field, direction] = orderRaw.split(".");
			if (field) {
				orderBy = {
					field,
					direction: /^desc$/i.test(direction || "") ? "DESCENDING" : "ASCENDING",
				};
			}
		}
		return {
			table,
			filters,
			unsupported,
			limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null,
			orderBy,
		};
	} catch {
		return null;
	}
}

function headerValue(headers, name) {
	if (!headers) return "";
	if (typeof headers.get === "function") return String(headers.get(name) || "");
	const entry = Object.entries(headers).find(
		([key]) => key.toLowerCase() === name.toLowerCase(),
	);
	return entry ? String(entry[1] || "") : "";
}

function jsonResponse(body, single) {
	const payload = JSON.stringify(body);
	const headers = {
		"Content-Type": single ? "application/vnd.pgrst.object+json" : "application/json",
		// So an operator can tell a served-from-standby response from a primary
		// one in a log or a network trace.
		"X-Standby-Read": "firebase",
	};
	if (typeof Response === "function") {
		return new Response(payload, { status: 200, headers });
	}
	return {
		ok: true,
		status: 200,
		headers: { get: (key) => headers[key] || null },
		text: async () => payload,
		json: async () => JSON.parse(payload),
		clone() {
			return this;
		},
	};
}

/**
 * Build a Response for a primary read from the standby copy.
 *
 * Returns null when there is no honest answer available — unmirrored table,
 * unconfigured standby, a query shape that cannot be reproduced, a standby
 * transport error, or an empty result for an unfiltered "list everything".
 */
export async function standbyResponse(url, options = {}) {
	const parsed = parsePostgrestRead(url);
	if (!parsed || !isMirroredTable(parsed.table)) return null;
	if (parsed.unsupported) return null;

	const accept = headerValue(options?.headers, "accept");
	const single = accept.includes("pgrst.object");

	const result = await readStandby(parsed.table, parsed).catch(() => null);
	if (!result?.ok) return null;

	const rows = result.rows || [];
	if (single) {
		// ".single()" asks for exactly one row. Zero rows is a real "not found"
		// only when the query was specific enough to identify a row.
		if (!rows.length) {
			if (!parsed.filters.length) return null;
			return jsonResponse(rows[0] ?? null, true);
		}
		return jsonResponse(rows[0], true);
	}

	// An unfiltered list that comes back empty proves nothing: the standby may
	// simply never have received these rows. Return the real error instead of
	// an empty feed that looks like "there is nothing here".
	if (!rows.length && !parsed.filters.length) return null;
	if (parsed.limit) return jsonResponse(rows.slice(0, parsed.limit), false);
	return jsonResponse(rows, false);
}
