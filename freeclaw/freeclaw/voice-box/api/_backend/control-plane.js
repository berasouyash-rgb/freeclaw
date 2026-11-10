// ─── Independent control plane ──────────────────────────────────
// Failover authority must NOT live inside Supabase: during a full Supabase
// outage the authority itself would be unavailable. It must also not live in
// localStorage or Android preferences, where any client could forge it.
//
// This module provides a small, pluggable key/value store with an atomic
// compare-and-set, used for:
//   - the failover lease (owner + expiry + monotonic fencing token)
//   - health snapshots shared between serverless instances
//   - replication watermarks
//   - idempotency records
//
// Backends, in preference order:
//   1. Redis over REST (Upstash-compatible) — durable, atomic, cross-instance.
//   2. In-memory — process-local only. Correct for tests and for a single
//      long-lived host, but NOT a production control plane on Vercel, where
//      instances are ephemeral and multiple instances coexist.
//
// The in-memory fallback is deliberately loud about its limitation so the
// reliability dashboard can report `control_plane.durable = false`.

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Lua: atomic versioned compare-and-set on a JSON envelope. */
const CAS_LUA = `
local cur = redis.call('GET', KEYS[1])
local ver = 0
if cur then
  local ok, obj = pcall(cjson.decode, cur)
  if ok and obj and obj.v then ver = tonumber(obj.v) or 0 end
end
local expected = tonumber(ARGV[1])
if expected ~= -1 and ver ~= expected then
  return {0, ver}
end
local nv = ver + 1
local payload = cjson.encode({v = nv, d = cjson.decode(ARGV[2])})
local ttl = tonumber(ARGV[3])
if ttl > 0 then
  redis.call('SET', KEYS[1], payload, 'PX', ttl)
else
  redis.call('SET', KEYS[1], payload)
end
return {1, nv}
`;

export class MemoryControlPlane {
	constructor() {
		this.durable = false;
		this.backend = "memory";
		/** @type {Map<string, {value: unknown, version: number, expiresAt: number}>} */
		this._map = new Map();
	}

	_prune(key) {
		const rec = this._map.get(key);
		if (rec && rec.expiresAt > 0 && rec.expiresAt <= Date.now()) {
			this._map.delete(key);
			return null;
		}
		return rec || null;
	}

	async get(key) {
		const rec = this._prune(key);
		return rec ? { value: rec.value, version: rec.version } : null;
	}

	/**
	 * @param {string} key
	 * @param {number|null} expectedVersion  null = must not exist; number = must match
	 * @param {unknown} value
	 * @param {{ ttlMs?: number }} [opts]
	 */
	async compareAndSet(key, expectedVersion, value, opts = {}) {
		const rec = this._prune(key);
		const current = rec ? rec.version : 0;
		const expected = expectedVersion === null ? 0 : expectedVersion;
		if (expected !== -1 && current !== expected) {
			return { ok: false, version: current };
		}
		const next = current + 1;
		const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		this._map.set(key, {
			value,
			version: next,
			expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
		});
		return { ok: true, version: next };
	}

	async set(key, value, opts = {}) {
		return this.compareAndSet(key, -1, value, opts);
	}

	async delete(key) {
		this._map.delete(key);
		return true;
	}

	async close() {
		this._map.clear();
	}
}

export class RedisRestControlPlane {
	/**
	 * @param {{ url: string, token: string }} config
	 */
	constructor(config) {
		this.durable = true;
		this.backend = "redis-rest";
		this.url = config.url.replace(/\/+$/, "");
		this.token = config.token;
	}

	async _command(args) {
		const res = await fetch(this.url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(args),
		});
		if (!res.ok) {
			throw new Error(`control-plane redis HTTP ${res.status}`);
		}
		const body = await res.json();
		if (body && body.error) throw new Error(`control-plane redis: ${body.error}`);
		return body?.result;
	}

	async get(key) {
		const raw = await this._command(["GET", key]);
		if (raw == null) return null;
		try {
			const parsed = JSON.parse(raw);
			return { value: parsed.d, version: Number(parsed.v) || 0 };
		} catch {
			return null;
		}
	}

	async compareAndSet(key, expectedVersion, value, opts = {}) {
		const expected = expectedVersion === null ? 0 : expectedVersion;
		const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		const result = await this._command([
			"EVAL",
			CAS_LUA,
			"1",
			key,
			String(expected),
			JSON.stringify(value),
			String(ttlMs),
		]);
		if (!Array.isArray(result) || result.length < 2) {
			throw new Error("control-plane redis: malformed CAS reply");
		}
		return { ok: Number(result[0]) === 1, version: Number(result[1]) };
	}

	async set(key, value, opts = {}) {
		return this.compareAndSet(key, -1, value, opts);
	}

	async delete(key) {
		await this._command(["DEL", key]);
		return true;
	}

	async close() {
		/* stateless HTTP client */
	}
}

/** @type {MemoryControlPlane | RedisRestControlPlane | null} */
let _instance = null;

/**
 * Returns the process-wide control plane, selecting the most durable
 * backend the environment permits.
 */
export function getControlPlane(env = process.env) {
	if (_instance) return _instance;
	const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || env.REDIS_REST_URL;
	const token =
		env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || env.REDIS_REST_TOKEN;
	if (url && token) {
		_instance = new RedisRestControlPlane({ url, token });
		return _instance;
	}
	_instance = new MemoryControlPlane();
	if (env.NODE_ENV === "production" && !env.VITEST) {
		console.warn(
			"[control-plane] No Redis REST credentials found — using process-local memory. " +
				"Failover leases will not be shared across serverless instances. " +
				"Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for a production-grade control plane.",
		);
	}
	return _instance;
}

/** Test seam: drop the singleton so a fresh backend can be injected. */
export function resetControlPlane(next = null) {
	_instance = next;
}
