import { createClient } from "@supabase/supabase-js";
import { triggerRestore } from "./_db-wake.js";
import { observePrimaryWrite } from "./_mirror.js";
import { shouldFallbackRead, standbyResponse } from "./_standby-read.js";

/**
 * Answer a failed primary read from the standby copy.
 *
 * Never throws: a standby problem must not replace the primary's error with a
 * less informative one, and it must never turn into a 200 with no data.
 */
async function readFromStandby(url, options) {
	try {
		return await standbyResponse(url, options);
	} catch {
		return null;
	}
}

// Connection pooling: reuse client across warm invocations (Vercel keeps instances alive)
let _client = null;

// ─── Bounded outbound concurrency ────────────────────────────────
// Every route is I/O-bound on Supabase HTTP round-trips. Without a bound, a
// burst of admitted requests fans out one outbound socket each and PostgREST
// saturates: measured at 1000 readers, 239 server 500s whose duration was
// 15002–15016ms — i.e. requests that had already spent the whole 15s timeout
// waiting on a queue at the far end. The fix is to make the wait explicit and
// bounded HERE, where the socket is cheap, instead of letting it happen
// inside a TCP connect we cannot see.
//
// This is a backstop, not a throughput target: at ~200ms per round-trip,
// 32 slots ≈ 160 queries/s per worker, which is far above the ~24 qps a
// 5000-reader feed generates once cold-miss coalescing is in place. Raise it
// only with a measured p95, exactly like MAX_INFLIGHT.
const DB_MAX_CONCURRENCY = (() => {
	const raw = Number.parseInt(process.env.DB_MAX_CONCURRENCY || "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : 32;
})();

// A stuck query must free its slot, but a cold Supabase project legitimately
// needs several seconds to wake. 15s is the historic value; keep it tunable so
// capacity runs can prove a tighter number before changing the default.
const DB_TIMEOUT_MS = (() => {
	const raw = Number.parseInt(process.env.DB_TIMEOUT_MS || "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : 15000;
})();

let _dbActive = 0;
const _dbWaiters = [];

/** Take a slot, waiting in FIFO order when saturated. */
function _dbAcquire() {
	if (_dbActive < DB_MAX_CONCURRENCY) {
		_dbActive += 1;
		return Promise.resolve();
	}
	return new Promise((resolve) => _dbWaiters.push(resolve));
}

/** Release a slot, handing it directly to the next waiter when present. */
function _dbRelease() {
	const next = _dbWaiters.shift();
	if (next) {
		// The slot is transferred, not freed — _dbActive is unchanged.
		next();
	} else {
		_dbActive = Math.max(0, _dbActive - 1);
	}
}

/** Live counters for /api/health and tests. */
export function getDbPoolStats() {
	return {
		active: _dbActive,
		queued: _dbWaiters.length,
		max_concurrency: DB_MAX_CONCURRENCY,
	};
}

/**
 * Server-side Supabase client.
 * Uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS (API routes handle auth themselves).
 * Falls back to VITE_SUPABASE_ANON_KEY if service role key is not set (with RLS).
 */
function getClient() {
	if (_client) return _client;

	const url =
		process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
	// Prefer service role key (bypasses RLS) — required for server-side operations
	const key =
		process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

	if (!url || !key) {
		const msg =
			"CRITICAL: Missing Supabase config. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env";
		console.error(msg);
		throw new Error(msg);
	}

	const isServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
	const isProd =
		process.env.VERCEL_ENV === "production" ||
		process.env.NODE_ENV === "production";

	// Fail closed: in production the server MUST run with the service role key.
	// Falling back to the anon key is a security regression — anon is now
	// deny-by-default in the database (migration 005), so it would silently
	// break every API route while looking like a config omission.
	if (!isServiceRole && isProd) {
		const msg =
			"SECURITY FAIL-CLOSED: production is missing SUPABASE_SERVICE_ROLE_KEY; refusing to run with the anon key.";
		console.error(msg);
		throw new Error(msg);
	}

	_client = createClient(url, key, {
		global: {
			fetch: async (url, options) => {
				await _dbAcquire();
				try {
					// Add request timeout to prevent hung connections
					const controller = new AbortController();
					const timeout = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);
					try {
						const res = await fetch(url, {
							...options,
							signal: controller.signal,
						});
						clearTimeout(timeout);
						// Standby mirror. Every Supabase call in the app passes through
						// this one fetch, so observing committed writes HERE means a new
						// endpoint cannot forget to replicate. Fire-and-forget: a mirror
						// failure never fails the write Supabase already accepted.
						if (res.ok) {
							try {
								observePrimaryWrite(url, options, res);
							} catch {
								/* replication must never affect the request it observes */
							}
						}
						if (!res.ok && res.status >= 500) {
							triggerRestore();
							const ct = res.headers.get("content-type") || "";
							if (!ct.includes("json")) {
								console.warn(
									"[db-client] Non-JSON response from Supabase (cold start?), retrying...",
								);
								const retryController = new AbortController();
								const retryTimeout = setTimeout(
									() => retryController.abort(),
									30000,
								);
								try {
									const retryRes = await fetch(url, {
										...options,
										signal: retryController.signal,
									});
									clearTimeout(retryTimeout);
									if (retryRes.ok) {
										try {
											observePrimaryWrite(url, options, retryRes);
										} catch {
											/* ignore */
										}
									}
									if (
										!retryRes.ok &&
										shouldFallbackRead(options?.method, retryRes.status)
									) {
										const standby = await readFromStandby(url, options);
										if (standby) return standby;
									}
									return retryRes;
								} catch (retryErr) {
									clearTimeout(retryTimeout);
									throw retryErr;
								}
							}
						}
						// Automatic switch: the primary failed for an infrastructure or
						// quota reason (internal error, egress limit, rate limit) and this
						// read targets a mirrored table, so answer from the Firebase
						// standby instead of surfacing an outage the copy can cover.
						if (!res.ok && shouldFallbackRead(options?.method, res.status)) {
							const standby = await readFromStandby(url, options);
							if (standby) return standby;
						}
						return res;
					} catch (err) {
						clearTimeout(timeout);
						if (err.name === "AbortError") triggerRestore();
						// Transport failure (timeout, reset, DNS) is precisely the case
						// the standby exists for: try it before failing the read.
						const standby = await readFromStandby(url, options);
						if (standby) return standby;
						throw err;
					}
				} finally {
					// Always hand the slot back — including on abort/timeout, so a
					// single hung query can never permanently shrink the pool.
					_dbRelease();
				}
			},
		},
		db: {
			schema: "public",
		},
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	if (!isServiceRole) {
		console.warn(
			"⚠️ Using anon key for server-side client — RLS policies will be enforced. Set SUPABASE_SERVICE_ROLE_KEY for full access.",
		);
	}

	return _client;
}

const supabase = new Proxy(
	{},
	{
		get(_, prop) {
			// Lazy: the client is built on first USE, not on import — so a
			// missing env var fails only the routes that need the DB (with a
			// clear error), instead of crashing every route at cold start.
			const client = getClient();
			const value = client[prop];
			return typeof value === "function" ? value.bind(client) : value;
		},
	},
);
export default supabase;
