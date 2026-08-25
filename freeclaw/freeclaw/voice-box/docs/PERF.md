# Performance Ledger — Voice Box

Rule: every optimization attempt is logged here, kept or reverted, so dead
ideas stay dead and wins carry their evidence. Measure → fix → re-measure.

## Environment baseline

- Deploy: Vercel serverless (Node, ESM) · DB: Supabase Postgres via
  supabase-js (HTTPS/PostgREST — no client connection pool to exhaust)
- Load target: 100 concurrent users / minute

## Kept ✅ (measured)

| Change | Evidence | Effect |
|---|---|---|
| Anonymous-feed `staleWhileRevalidate` (10s fresh / 60s stale, module-scope wrapper) | Guard test: **50 identical reads ⇒ 1 underlying fetch**; distinct keys fetch independently; stale served instantly + exactly one background refresh (`tests/api/posts-feed-perf.test.ts`) | ~100 visitors/min ⇒ ~6 posts scans/min instead of ≥100 scans (~60+ count queries) |
| Write-path invalidation `cacheClear("^postsfeed")` on POST/PUT/DELETE of posts | Guard test: after clear, next feed performs a real read | Solved/hidden/new content appears immediately despite cache |
| Realtime fallback poll 10s → **30s**; staleness watchdog 30s → **120s** silence before fallback | `useRealtime.test.ts` updated pins: calm connected feed never polls; error-started polling ticks at 30s; recovery stops ticks | Calm feed with 100 tabs: background request storm 10 req/s → ~0 |
| Hidden-tab polling guard (pre-existing) | existing suite | Background tabs cost zero requests |

## Reverted ❌ / fixed-during-review

| Attempt | Result | Why discarded/fixed |
|---|---|---|
| Positional call `staleWhileRevalidate("postsfeed", key, ttl…)` | **Route would have 500'd on every anonymous feed in production** while suites stayed green (Vitest bypass masked it) | Wrong signature for `_cache.js` API `(fn, {ttl,staleTtl,keyPrefix})`. Caught by the perf guard harness before deploy. Fixed to options-object form. |
| Per-request SWR wrapper instance | Guard showed per-call scans `1,2,…10` (wrapper Map reset each request) | Wrapper must live at module scope; args are the cache key. Fixed. |
| Route-level query-count assertions inside Vitest | Flaky in harness: dynamic-import graph can instantiate a fresh `_cache` per import, so counts lied about production | Counting moved to Layer-1 mechanism tests (deterministic); route layer asserts shape/status/invalidation instead. |

## Budgets (guardrails going forward)

- Anonymous feed DB scans: ≤ 6/min at any traffic level (cache TTL floor)
- Fallback polling: ≤ 1 req/30s/client, hidden tabs = 0
- p95 feed response under load: served from memory on cache hit (<5ms handler time)
- Suites must stay green: 679 API · 1219 frontend (perf changes included)
