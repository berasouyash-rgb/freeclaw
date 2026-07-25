// ─── V3 Enterprise Caching ──────────────────────────────────────
// In-memory cache with TTL, LRU eviction, cache warming,
// and stale-while-revalidate patterns for serverless.
import { logger } from './_observability.js';

// ─── Cache Store ────────────────────────────────────────────────
const _store = new Map(); // key → { value, expiresAt, createdAt, accessCount, lastAccess }

const DEFAULT_TTL = 60_000; // 1 minute
const MAX_ENTRIES = 1000;
const MAX_ENTRY_SIZE = 100_000; // 100KB per entry

/**
 * Get a cached value. Returns null if expired or missing.
 */
export function cacheGet(key) {
  const entry = _store.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expiresAt < now) {
    _store.delete(key);
    return null;
  }

  entry.accessCount++;
  entry.lastAccess = now;
  return entry.value;
}

/**
 * Set a cached value with TTL.
 */
export function cacheSet(key, value, ttlMs = DEFAULT_TTL) {
  // Check entry size (approximate)
  const size = JSON.stringify(value)?.length || 0;
  if (size > MAX_ENTRY_SIZE) {
    logger.warn('cache', 'entry_too_large', { key, size });
    return false;
  }

  // Evict if at capacity (LRU by lastAccess)
  if (_store.size >= MAX_ENTRIES) {
    const sorted = [..._store.entries()]
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
      .slice(0, Math.floor(MAX_ENTRIES * 0.2)); // Remove oldest 20%
    for (const [k] of sorted) _store.delete(k);
  }

  _store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    createdAt: Date.now(),
    accessCount: 0,
    lastAccess: Date.now(),
    size,
  });

  return true;
}

/**
 * Delete a cached value.
 */
export function cacheDelete(key) {
  return _store.delete(key);
}

/**
 * Clear all cached values.
 */
export function cacheClear(pattern = null) {
  if (!pattern) {
    _store.clear();
    return;
  }
  const regex = new RegExp(pattern);
  for (const key of _store.keys()) {
    if (regex.test(key)) _store.delete(key);
  }
}

/**
 * Get cache statistics.
 */
export function cacheStats() {
  let totalSize = 0;
  let totalAccess = 0;
  let hits = 0;
  let misses = 0;

  for (const [, entry] of _store) {
    totalSize += entry.size || 0;
    totalAccess += entry.accessCount;
    if (entry.accessCount > 0) hits++;
    else misses++;
  }

  return {
    entries: _store.size,
    max_entries: MAX_ENTRIES,
    total_size_kb: Math.round(totalSize / 1024),
    total_access_count: totalAccess,
    hit_rate: hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : '0%',
    hits,
    misses,
  };
}

// ─── Cached Function Wrapper ────────────────────────────────────
/**
 * Wrap a function with caching. Results are cached by argument hash.
 * @param {Function} fn - Async function to cache
 * @param {Object} options - { ttl, keyPrefix, keyFn, maxSize }
 */
export function cached(fn, options = {}) {
  const {
    ttl = DEFAULT_TTL,
    keyPrefix = fn.name || 'cached',
    keyFn = null,
    maxSize = MAX_ENTRIES,
  } = options;

  const _fnCache = new Map();

  return async function cachedFn(...args) {
    const cacheKey = keyFn
      ? keyFn(...args)
      : `${keyPrefix}:${JSON.stringify(args).slice(0, 200)}`;

    // Check cache
    const cached = _fnCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      cached.accessCount++;
      return cached.value;
    }

    // Execute and cache
    const start = Date.now();
    const result = await fn(...args);
    const duration = Date.now() - start;

    // Evict if needed
    if (_fnCache.size >= maxSize) {
      const sorted = [..._fnCache.entries()]
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
        .slice(0, Math.floor(maxSize * 0.2));
      for (const [k] of sorted) _fnCache.delete(k);
    }

    _fnCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + ttl,
      accessCount: 0,
      lastAccess: Date.now(),
    });

    return result;
  };
}

// ─── Stale-While-Revalidate ─────────────────────────────────────
/**
 * Serve stale content while revalidating in background.
 * Great for read-heavy endpoints.
 */
export function staleWhileRevalidate(fn, options = {}) {
  const {
    ttl = DEFAULT_TTL,
    staleTtl = ttl * 5, // Serve stale for 5x the normal TTL
    keyPrefix = fn.name || 'swr',
  } = options;

  const _swrCache = new Map();

  return async function swrFn(...args) {
    const cacheKey = `${keyPrefix}:${JSON.stringify(args).slice(0, 200)}`;
    const entry = _swrCache.get(cacheKey);
    const now = Date.now();

    // Fresh cache hit
    if (entry && entry.expiresAt > now) {
      return entry.value;
    }

    // Stale but usable — return stale, revalidate in background
    if (entry && entry.staleExpiresAt > now) {
      // Background revalidation (fire and forget)
      fn(...args).then((fresh) => {
        _swrCache.set(cacheKey, {
          value: fresh,
          expiresAt: now + ttl,
          staleExpiresAt: now + staleTtl,
        });
      }).catch(() => {}); // Ignore background errors
      return entry.value;
    }

    // Cache miss or fully expired — must fetch
    const result = await fn(...args);
    _swrCache.set(cacheKey, {
      value: result,
      expiresAt: now + ttl,
      staleExpiresAt: now + staleTtl,
    });

    return result;
  };
}

// ─── Cleanup ────────────────────────────────────────────────────
let _lastCleanup = Date.now();

export function cleanupCache() {
  const now = Date.now();
  if (now - _lastCleanup < 60000) return; // Run every minute
  _lastCleanup = now;

  let removed = 0;
  for (const [key, entry] of _store) {
    if (entry.expiresAt < now) {
      _store.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    logger.debug('cache', 'cleanup', { removed, remaining: _store.size });
  }
}

// Run cleanup on module load
cleanupCache();

export default {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheClear,
  cacheStats,
  cached,
  staleWhileRevalidate,
  cleanupCache,
};
