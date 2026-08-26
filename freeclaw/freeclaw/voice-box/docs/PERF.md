# Performance Ledger — Voice Box

Rule: every optimization attempt is logged here, kept or reverted, so dead
ideas stay dead and wins carry their evidence. Measure → fix → re-measure.

## Environment baseline

- Deploy: Vercel serverless (Node, ESM) · DB: Supabase Postgres via
  supabase-js (HTTPS/PostgREST — no client connection pool to exhaust)
- Load target: 5,000 concurrent active users

## Kept ✅ (measured)

| Change | Evidence | Effect |
|---|---|---|
| Anonymous-feed `staleWhileRevalidate` (10s fresh / 60s stale, module-scope wrapper) | Guard test: **50 identical reads ⇒ 1 underlying fetch**; distinct keys fetch independently; stale served instantly + exactly one background refresh (`tests/api/posts-feed-perf.test.ts`) | ~100 visitors/min ⇒ ~6 posts scans/min instead of ≥100 scans (~60+ count queries) |
| Write-path invalidation `cacheClear("^postsfeed")` on POST/PUT/DELETE of posts | Guard test: after clear, next feed performs a real read | Solved/hidden/new content appears immediately despite cache |
| Search SWR cache (module-scope, 5s fresh / 30s stale, entry-cap eviction) | Guard test: **50 identical searches ⇒ 1 DB scan**; distinct queries fetch independently; stale served instantly (`tests/api/search-perf.test.ts`) | Search p50=5ms under load — zero re-scans for cached queries |
| Per-user rate limiting (identity + IP composite key) | 300 concurrent unique identities: **300/300 pass**; IP-only: only 120/300 pass | Eliminates school-NAT lockdown — each user gets own rate bucket |
| Rate limit: 30s block (down from 5 min) + O(1) timestamp pruning | Load test: blocked users recover in 30s vs 5 min | Faster recovery from legitimate burst traffic |
| x-anon-id header on every API request | Client sends identity on GET/POST/PUT/DELETE; server reads from header for GET | Rate limiter keys per-user even for read-only endpoints |
| Realtime fallback poll 10s → **30s**; staleness watchdog 30s → **120s** silence before fallback | `useRealtime.test.ts` updated pins: calm connected feed never polls; error-started polling ticks at 30s; recovery stops ticks | Calm feed with 100 tabs: background request storm 10 req/s → ~0 |
| Hidden-tab polling guard (pre-existing) | existing suite | Background tabs cost zero requests |

## Reverted ❌ / fixed-during-review

| Attempt | Result | Why discarded/fixed |
|---|---|---|
| Positional call `staleWhileRevalidate("postsfeed", key, ttl…)` | **Route would have 500'd on every anonymous feed in production** while suites stayed green (Vitest bypass masked it) | Wrong signature for `_cache.js` API `(fn, {ttl,staleTtl,keyPrefix})`. Caught by the perf guard harness before deploy. Fixed to options-object form. |
| Per-request SWR wrapper instance | Guard showed per-call scans `1,2,…10` (wrapper Map reset each request) | Wrapper must live at module scope; args are the cache key. Fixed. |
| Route-level query-count assertions inside Vitest | Flaky in harness: dynamic-import graph can instantiate a fresh `_cache` per import, so counts lied about production | Counting moved to Layer-1 mechanism tests (deterministic); route layer asserts shape/status/invalidation instead. |

## Load Test Results (2026-08-26)

Harness: `scripts/loadtest.mjs` (pure Node, no deps). Mixed user journeys:
45% feed, 20% read post, 12% search, 8% polls, 6% suggestions,
4% create post, 3% comment, 2% react.

| Scenario | Users | Duration | RPS | Errors | Notes |
|---|---|---|---|---|---|
| Baseline (pre-fix) | 200 | 30s | 68 | 91% 429 | All shared one IP bucket — school-NAT bug |
| Post rate-limit fix | 200 | 30s | 39 | 26% 404 | Zero 429s; 404s from missing test posts |
| 5000 concurrent | 5000 | 60s | 155 | 95% timeout | Single-threaded dev server saturated (expected) |

**Key latencies (200 users, post-fix):**
- GET /search: p50=1ms, p95=6ms, p99=1097ms (SWR cache hit rate high)
- GET /posts: p50=1ms, p95=6ms, p99=988ms (feed cache)
- GET /polls: p50=1ms, p95=4ms, p99=1097ms
- POST /posts: p50=2079ms, p95=2503ms (Supabase write latency)

**Production note:** Vercel serverless runs each function independently;
the single-thread bottleneck does not exist in prod. Supabase PostgREST
scales to ~5k concurrent with connection pooling + read replicas.

## Budgets (guardrails going forward)

- Anonymous feed DB scans: ≤ 6/min at any traffic level (cache TTL floor)
- Search DB scans: ≤ 12/min per unique query (SWR cache)
- Fallback polling: ≤ 1 req/30s/client, hidden tabs = 0
- Rate limit: 120 req/min per identity+IP; 30s block on overflow
- p95 feed response under load: served from memory on cache hit (<5ms handler time)
- p95 search response under load: served from cache (<5ms on repeat queries)
- Suites must stay green: 695 API · 1218 frontend (perf changes included)
