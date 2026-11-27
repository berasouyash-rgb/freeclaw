# Feed API and Database Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home and poll reads bounded, aggregate, cache-coalesced, side-effect free, and independently scalable while adding only database indexes whose exact plans prove they are needed.

**Architecture:** Add service-role-only PostgreSQL read functions that return one cursor page plus reaction, comment, poll, vote, and viewer-state aggregates. Make the API map those rows into the existing response envelopes, cache the complete shaped response with cold-request single-flight, and have Home consume 20-row pages with embedded poll state. Move every content mutation performed by a public read into an authenticated cron route protected by a database lease, then isolate proven hot routes and add stream-size, map-size, and edge rate bounds. Index creation remains a final evidence-gated operation: no candidate migration is created unless the live catalog and exact `EXPLAIN (ANALYZE, BUFFERS)` output pass the stated gates.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, Node.js 22.22+, Supabase JavaScript 2.x, PostgreSQL, Vercel serverless functions and Firewall, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md`  
**Surface Inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`  
**Parent Program:** `docs/superpowers/plans/2026-09-24-10k-smooth-platform-program.md`

**Execution Preconditions:**

- Complete parent Tasks 2 and 3, or otherwise record an approved, contiguous migration ledger through `026`, before applying this plan’s `027`–`031` migrations. In particular, Home must already have no passive full-feed reload, no visibility reload, and no Realtime-driven request storm. This plan must not preserve those noncompliant behaviors.
- Every command that applies a migration, runs a write probe, or uses a service-role key must first validate the target project/host against the approved staging allowlist; a generic `DATABASE_URL` or key is not sufficient authorization.
- Re-read both spec files immediately before implementation because the working tree contains shared user changes.
- Stage and commit only the exact files named by each task. Never run `git add .`, `git clean`, `git reset`, or include unrelated working-tree changes.
- Run all test, lint, typecheck, and build commands sequentially.

## Global Constraints

- Keep Vercel + Supabase. Do not add Redis, a queue service, or another proxy unless a later measured gate proves the current stack insufficient.
- Home requests exactly 20 rows on its first feed read. The server clamps every paginated list request to `1..100` rows.
- Every list cursor uses a stable unique tie-breaker; the feed order is `pinned DESC, created_at DESC, id DESC` and the poll order is `created_at DESC, id DESC`.
- On the new bounded aggregate feed/poll read paths, reactions, comments, linked poll metadata, vote totals, vote counts, and viewer choices are computed in PostgreSQL. Node.js does not fetch child rows to count them; the only raw child-row compatibility exception in this slice is the explicitly bounded, private `voter` response described in Task 4.
- Page one does not run or return an exact total unless the caller explicitly sends `include_total=1`; admin-only list branches must additionally pass `isAdmin(req)`, while the public aggregate branch may compute the explicitly requested public total.
- A 20-row Home feed page is at most 262,144 serialized UTF-8 bytes. A poll batch is at most 100 deduplicated IDs and 262,144 serialized UTF-8 bytes.
- Repeated public reads cache the complete shaped response, not only parent rows. Cache keys include normalized route/query, locale, viewer, and permission context.
- Viewer-specific responses are always `private, no-cache`; only a response with no viewer and no admin permission may be publicly cached.
- Identical cold-cache requests share one in-process loader per complete-response cache key. Cache storage and in-flight maps are bounded.
- Public GET/HEAD handlers perform no Supabase insert, update, upsert, delete, RPC that writes, archive, repair, purge, enqueue, or durable telemetry write. Structured logs and process-local request metrics remain allowed.
- Maintenance runs only from an authenticated cron/admin path and obtains a database-backed singleton lease before work starts. The automation registry’s `poll-sweep` entry is an execution surface, not an exception: it must call the leased `poll-expiry` adapter and must never call `_poll-sweeper.js` directly.
- `Content-Length` is only an early rejection hint. The request reader enforces the same byte cap incrementally for chunked, web-stream, Node-stream, Buffer, string, and pre-parsed bodies.
- Local rate maps have deterministic expiry cleanup and hard entry caps. Vercel Firewall supplies coarse IP-level protection; local identity limits are not described as globally exact quotas.
- No index is added because its columns “sound useful.” Every index requires a live catalog check, table statistics, five measured exact-query runs, a before plan, an after plan, a write-cost check, and a concurrent rollback statement.
- Do not add the `chat_threads(thread_id)` unique index in this plan; it requires separate duplicate reconciliation.
- Do not add unrestricted admin timestamp indexes in this plan; add one only if its own exact admin plan passes the same evidence gate.
- Production load testing remains out of scope. Staging micro-benchmarks are read-only; the only staging write smokes are Task 6’s disposable `lease-*` claim/renew/release verifier and Task 9’s rollback-only table-specific write probes. Both are forbidden in production, use unique disposable identifiers, and clean up in `finally`/`ROLLBACK`.
- No source edit is authorized by this planning pass. Implementation starts only after the plan is approved.

## Review Focus

1. **Cursor collisions:** Two rows with the same `created_at` must appear exactly once across adjacent pages; the `id` tie-breaker must be present in both SQL ordering and cursor validation.
2. **Viewer cache isolation:** Two anonymous identities using the same feed query must never share reactions, poll choices, masked-author behavior, or cache entries.
3. **Oversized or sparse pages:** A page with 21 eligible rows must return 20 plus a cursor; a page with fewer than 20 must not claim more exist; artifact rows must not consume page slots.
4. **Concurrent cold reads:** Fifty identical simultaneous cache misses must execute one loader, not fifty aggregate computations.
5. **Read-side mutations:** A public feed/poll GET must not archive, repair, purge, or update any row, even when rows are expired, orphaned, stale, or deleted.
6. **Lease failure:** Two concurrent maintenance invocations must produce at most one real run; losing callers must release only their own token and report a skip.
7. **Registry bypass:** A manual Run button or agent-cron invocation of `poll-sweep` must use the same `poll-expiry` database lease as `/api/maintenance`; a direct sweeper call would allow overlapping expiry writes.
8. **Index evidence:** A candidate whose plan does not materially improve, whose write cost is disproportionate, or whose size is excessive must not ship.

---

## Source-Proven Baseline

The plan is based on the current working tree, not assumptions:

- `src/pages/Home.tsx:74-117` requests `/api/posts?type=problem` without pagination and can receive up to 300 rows.
- `src/pages/Home.tsx:121-173` starts one `/api/polls?id=...` request per linked poll plus one all-history `/api/polls?voter=...` request.
- `src/pages/Home.tsx:179-182` repeats poll loading whenever the post list changes; `src/pages/Home.tsx:327-355` adds a targeted per-poll Realtime refetch.
- `api/_posts.js:136-153` caches up to 2,000 raw parent rows with `staleWhileRevalidate`; it does not cache the complete response.
- `api/_posts.js:212-304` transfers reaction, comment, poll, and poll-vote rows to Node.js for counting.
- `api/_posts.js:514-559` runs an exact count on every paginated request, including page one.
- `api/_polls.js:20-43` transfers every selected vote row to Node.js and tallies choices there.
- `api/_polls.js:108-183` fetches up to 2,000 polls, writes stale archive flags, repairs orphan links, and only then returns at most 200.
- `api/_posts.js:169-210` starts a purge from every GET.
- `api/_cleanup.js:446-485` and `api/index.js:191-196` start content cleanup on cold import.
- `api/_cache.js:178-255` deduplicates stale revalidation but not a cold miss; the first caller performs the fetch while other cold callers can also fetch.
- `api/index.js:16-117` statically imports the entire platform for every consolidated API invocation.
- `api/index.js:119-189` buffers request bodies without an incremental byte boundary.
- `api/_security.js:324-375` trusts `Content-Length`; `api/_security.js:108-232` has no hard cap on `_abuseTracker`; `api/_auth.js:489-516` can remain above its intended map cap.
- `api/migrations/009_private_posts_integrity_indexes.sql` and later migrations prove the source query shapes, but they do not prove that any new index is currently needed.
- `src/lib/api.ts:450-476`, `src/hooks/useInfiniteScroll.ts:12-37`, and existing admin consumers currently model `total` as a required number. This plan changes the wire/client type to `number | null` and changes admin consumers that display exact totals to request `include_total=1`.

## Target File Map

### Create

- `api/_read-cursor.js` — encode/decode versioned feed and poll cursors; build bounded canonical cache-key digests.
- `api/_response-budget.js` — enforce the serialized-byte limit and reject an oversized page rather than silently hiding rows; row caps are applied before shaping.
- `api/_posts-read.js` — paginated public-feed RPC adapter, masking, cache composition, and response headers.
- `api/_polls-read.js` — aggregate poll list/batch/result adapter used by GET and post-vote responses.
- `api/_request-limits.js` — streaming body reader, measured-byte result, identity extraction, and bounded counter primitive.
- `api/_gateway.js` — shared request parsing, security check, request ID, query normalization, and response timing used by consolidated and extracted routes.
- `api/posts.js` — independently deployable `/api/posts` function using the read-only graph for GET and a dynamic import for legacy/write paths.
- `api/polls.js` — independently deployable `/api/polls` function using the aggregate read graph for GET and a dynamic import for write paths.
- `api/_maintenance-lease.js` — shared claim/renew/release wrappers and the leased job runner used by cron and manual cleanup.
- `api/_poll-expiry-registry.js` — zero-argument registry adapter that claims the shared `poll-expiry` lease, delegates to the bounded expiry runner, and releases only its own owner token.
- `api/maintenance.js` — authenticated cron entry for leased content maintenance and poll expiry work.
- `api/migrations/027_feed_poll_read_functions.sql` — additive service-role-only artifact predicate, feed page function, and poll page function.
- `api/migrations/028_maintenance_leases.sql` — lease table plus claim, renew, and release functions.
- `api/migrations/029_polls_post_id_idx.sql` — create only if Task 9’s poll-link plan gate passes.
- `api/migrations/030_poll_votes_author_poll_idx.sql` — create only if Task 9’s viewer-vote plan gate passes.
- `api/migrations/031_posts_problem_feed_cursor_idx.sql` — create only if Task 9’s Home cursor plan gate passes.
- `scripts/verify-read-rpcs.mjs` — read-only staging smoke/contract runner for the two RPCs.
- `scripts/verify-maintenance-lease.mjs` — staging-only concurrent lease smoke runner.
- `scripts/bench-feed-reads.mjs` — read-only staging micro-benchmark for rows, bytes, cache status, and latency; not a capacity claim.
- `scripts/feed-index-write.sql` — rollback-only write probe for `posts` index cost.
- `scripts/poll-index-write.sql` — rollback-only write probe for `polls` index cost.
- `scripts/poll-vote-index-write.sql` — rollback-only write probe for `poll_votes` index cost.
- `tests/api/posts-feed-rpc.test.ts` — RPC shape, page-one count, cursor, cache, and response-budget tests.
- `tests/api/polls-read-rpc.test.ts` — aggregate list/batch/result and no-child-row tests.
- `tests/api/read-cache.test.ts` — complete-response cache, cold coalescing, stale revalidation, and memory-bound tests.
- `tests/api/read-side-effects.test.ts` — public GET mutation and cold-import maintenance tests.
- `tests/api/agent-cron-registry.test.ts` — prove the registry loop and named `poll-sweep` handle use the leased adapter rather than the unleased sweeper.
- `tests/api/maintenance-lease.test.ts` — claim/renew/release, contention, failure release, and auth tests.
- `tests/api/poll-expiry-registry.test.ts` — leased registry adapter contract, lease-held skip, renewal callback, and failure-release tests.
- `tests/api/request-body-limit.test.ts` — chunked and pre-parsed incremental body-limit tests.
- `tests/api/hot-route-entrypoints.test.ts` — route wrapper and Vercel configuration tests.
- `src/__tests__/Home.pagination.test.tsx` — 20 rows, explicit Load more, embedded poll, no N+1, and manual refresh tests.
- `docs/performance/evidence/2026-09-24-feed-api-database-scaling.md` — before/after measurements, cache/query counts, live plans, and deployment evidence.

### Read

- `api/_poll-sweeper.js` — reuse the existing expiry/notification implementation; do not fork its behavior.

### Modify

- `api/_automation-registry.js:5-12,404-410` — map `poll-sweep` to the leased registry adapter and make its `lease_held` deferred summary explicit while preserving the worker id/display name.
- `api/_cache.js:121-291` — add complete-response cache and named feed/poll cache instances while preserving existing search/category callers.
- `api/_posts.js:133-589,876-884,1090-1098,1239-1247` — delegate paginated GETs, remove GET-triggered purge and raw feed cache, invalidate complete caches on writes, and use aggregate poll results after writes where needed.
- `api/_polls.js:20-183` — delegate GETs, remove GET writes, use aggregate result RPC after votes, bound IDs, and invalidate caches.
- `api/_comments.js` — invalidate the feed cache after successful create/edit/delete mutations.
- `api/_reactions.js` — invalidate the feed cache after successful reaction mutations and add a bounded reaction-action budget.
- `api/_cleanup.js:77-485` — export deterministic purge/archive/orphan-repair functions and remove cold-start auto-run.
- `api/_security.js:108-400` — use bounded counters and measured request bytes.
- `api/_auth.js:37-39,489-516,545-560` — use the same bounded-counter semantics for persistent write limits and export the canonical anonymous-identity validator.
- `api/_upload.js:8` — remove the lower framework body-parser limit so the shared measured reader is the upload boundary.
- `api/index.js:16-463` — remove static posts/polls imports and cold cleanup, use the shared gateway, and lazy-load fallback handlers.
- `vercel.json:3-69` — retain the fallback rewrite, add extracted function settings, and add the maintenance cron.
- `src/types/index.ts:25-101` — add embedded poll/viewer-choice fields and permit nullable totals at the API page boundary.
- `src/lib/api.ts:450-476` — return `total: number | null`.
- `src/hooks/useInfiniteScroll.ts:12-238` — support explicit/manual loading and an optional reset key without changing existing admin defaults.
- `src/pages/Home.tsx:46-835` — replace local 300-row reveal state and poll N+1 with cursor pages and embedded poll reconciliation.
- `src/pages/PostDetail.tsx:756-773` — reconcile a linked poll from the authoritative vote response without a full-list refetch.
- `src/pages/Polls.tsx:120-145` — reconcile the matching poll row from the authoritative vote response.
- `src/components/PostCard.tsx:50-64,365-374` — accept the authoritative poll returned by a vote.
- `src/components/PollCard.tsx:19-31,160-181,367-420` — pass the authoritative poll result to `onVoted`.
- `src/pages/admin/PostsTable.tsx:122-145,229-308,360-372` — preserve admin exact totals through explicit `include_total=1` requests.
- `src/__tests__/api.test.ts:550-610` — cover the nullable paginated-total contract.
- `src/__tests__/PostsTable.test.tsx` — assert explicit admin totals.
- `src/__tests__/PollCard.test.tsx` — assert the authoritative callback payload.
- `src/__tests__/PostDetail.test.tsx` — assert local poll reconciliation without a list refetch.
- `src/__tests__/useInfiniteScroll.test.tsx` — cover manual mode and reset-key behavior.
- `tests/api/posts-full.test.ts:263-533` — replace page-one total expectations and query mocks with the paginated RPC contract.
- `tests/api/posts-feed-perf.test.ts` — replace raw-parent cache assertions with complete-response and single-flight assertions.
- `tests/api/polls-full.test.ts:276-381` — replace orphan-write expectations with read-only orphan shaping.
- `tests/api/polls-filter.test.ts` — mock aggregate RPC output rather than transferring vote rows.
- `tests/api/rate-limiter.test.ts` — prove hard caps and deterministic expiry.
- `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md` — only after implementation, record Home’s evidence and leave unrelated rows unchanged.

## Exact Public Interfaces

### Feed page wire shape

```js
// GET /api/posts?paginate=1&limit=20&type=problem&viewer=anon_abc
{
  data: PostData[],
  nextCursor: string | null,
  total: number | null
}
```

`data.length <= 20` for Home. `nextCursor` is non-null only when the database returned `limit + 1` eligible rows. `total` is `null` unless the authorized request also supplied `include_total=1`.

### Poll page/batch wire shape

The existing list response remains an array for compatibility. An `id` or `ids` request may use the same array shape, with viewer choice embedded as `my_vote` on each `PollData`. A future paginated poll-list envelope is not introduced in this slice.

The successful `POST /api/polls` vote response is one authoritative `PollData` object, not an array; it includes `total_votes`, `vote_counts`, and `my_vote`. This is the response consumed by `PollCard.vote` and the local Home reconciliation callback.

### Versioned cursor payloads

```js
// Decoded feed cursor
{
  v: 1,
  pinned: true,
  created_at: "2026-09-24T10:00:00.000Z",
  id: "post_abc"
}

// Decoded poll cursor
{
  v: 1,
  created_at: "2026-09-24T10:00:00.000Z",
  id: "poll_abc"
}
```

The wire representation is base64url. Invalid, oversized, wrong-version, or non-ISO cursors read as page one, preserving the current `validCursor` behavior rather than producing a 500.

### PostgreSQL function signatures

```sql
public.api_feed_page(
  p_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_viewer_id text DEFAULT NULL,
  p_cursor jsonb DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_include_total boolean DEFAULT false
)

public.api_poll_page(
  p_ids text[] DEFAULT NULL,
  p_id text DEFAULT NULL,
  p_post_id text DEFAULT NULL,
  p_viewer_id text DEFAULT NULL,
  p_include_deleted boolean DEFAULT false,
  p_cursor jsonb DEFAULT NULL,
  p_limit integer DEFAULT 100
)
```

Both are `STABLE`, `SECURITY INVOKER`, set `search_path = ''`, fully qualify every object, and are executable only by `service_role`.

### Complete-response cache result

```js
{
  value: {
    page: unknown,
    body: string,
    bytes: number
  },
  status: "HIT" | "MISS" | "STALE" | "COALESCED",
  age_ms: number
}
```

`createResponseCache` remains a generic primitive for unit tests; the feed and poll loaders specifically cache the `{ page, body, bytes }` envelope above so the exact serialized bytes sent to the client are replayed on a hit.

### Maintenance lease functions

```sql
public.try_claim_maintenance_lease(
  p_job_name text,
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 120
) RETURNS boolean

public.renew_maintenance_lease(
  p_job_name text,
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 120
) RETURNS boolean

public.release_maintenance_lease(
  p_job_name text,
  p_owner_token uuid
) RETURNS boolean
```

### Shared gateway

```js
export function withApiGateway(handler, routeName) {
  return async function apiGateway(req, res) {
    return handler(req, res);
  };
}
```

The returned function owns query normalization, request ID, CORS/security headers, bounded body parsing, identity extraction, abuse/size checks, response timing, normalized-route logging, and completion metrics. Route extraction must call this same helper.

## Response, Query, and Timing Budgets

| Surface | Rows | Serialized bytes | Database round trips | Timing gate |
|---|---:|---:|---:|---|
| Home first page | 20 maximum | 262,144 maximum | 1 `api_feed_page` RPC | warm API p95 < 500 ms; DB execution p95 < 150 ms |
| Home next page | 20 maximum | 262,144 maximum | 1 `api_feed_page` RPC | same cursor contract and budgets |
| Poll list/batch | 100 maximum; IDs deduplicated | 262,144 maximum | 1 `api_poll_page` RPC | warm p95 < 500 ms |
| Poll result after vote | 1 | 32,768 maximum | 1 `api_poll_page` RPC by ID | write acknowledgement p95 < 800 ms |
| Default request body | n/a | 500,000 maximum | n/a | reject incrementally at byte 500,001 |
| Upload request body | n/a | 4,500,000 maximum | n/a | preserve the existing 3 MB decoded-image contract |

These are slice budgets, not proof of 10,000-user capacity. The parent observability/load plan owns capacity claims.

---

### Task 1: Pin Cursor, Page, and Response-Budget Contracts

**Files:**
- Create: `api/_read-cursor.js`
- Create: `api/_response-budget.js`
- Create: `tests/api/posts-feed-rpc.test.ts`
- Modify: `src/types/index.ts:25-101`
- Modify: `src/lib/api.ts:450-476`
- Modify: `src/__tests__/api.test.ts:550-610`

**Interfaces:**
- Consumes: current `api.paginated` response and `PostData`/`PollData` types.
- Produces: `encodeFeedCursor`, `decodeFeedCursor`, `encodePollCursor`, `decodePollCursor`, `canonicalReadKey`, `assertPageWithinByteBudget`, and `PaginatedResult.total: number | null` for Tasks 2, 4, and 5.

- [ ] **Step 1: Write failing cursor and budget tests**

Add these exact cases to `tests/api/posts-feed-rpc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalReadKey,
  decodeFeedCursor,
  decodePollCursor,
  encodeFeedCursor,
  encodePollCursor,
} from "../../api/_read-cursor.js";
import { assertPageWithinByteBudget } from "../../api/_response-budget.js";

const FEED_ROW = {
  pinned: false,
  created_at: "2026-09-24T10:00:00.000Z",
  id: "post_1",
};

describe("read cursor contract", () => {
  it("round-trips the feed tie-breaker", () => {
    expect(decodeFeedCursor(encodeFeedCursor(FEED_ROW))).toEqual({
      v: 1,
      pinned: false,
      created_at: "2026-09-24T10:00:00.000Z",
      id: "post_1",
    });
  });

  it("rejects malformed cursors as page one", () => {
    for (const value of ["0", "not-base64", Buffer.from("{}").toString("base64url"), "x".repeat(513)]) {
      expect(decodeFeedCursor(value)).toBeNull();
    }
    expect(decodePollCursor(encodePollCursor({ created_at: FEED_ROW.created_at, id: "poll_1" }))).toEqual({
      v: 1,
      created_at: FEED_ROW.created_at,
      id: "poll_1",
    });
  });

  it("keys viewer and permission context separately", () => {
    const base = { route: "/api/posts", query: { type: "problem", limit: "20" }, locale: "en-IN" };
    expect(canonicalReadKey({ ...base, viewer: null, permission: "public" })).not.toBe(
      canonicalReadKey({ ...base, viewer: "anon_a", permission: "public" }),
    );
    expect(canonicalReadKey({ ...base, viewer: "anon_a", permission: "public" })).not.toBe(
      canonicalReadKey({ ...base, viewer: "anon_a", permission: "admin" }),
    );
    expect(canonicalReadKey({ ...base, query: { cursor: "AbC" }, viewer: null, permission: "public" })).not.toBe(
      canonicalReadKey({ ...base, query: { cursor: "abc" }, viewer: null, permission: "public" }),
    );
  });

  it("does not collide case-sensitive identifiers or exact-match filters", () => {
    const base = { route: "/api/polls", query: {}, locale: "en-IN", viewer: null, permission: "public" };
    expect(canonicalReadKey({ ...base, query: { id: "Poll_A" } })).not.toBe(
      canonicalReadKey({ ...base, query: { id: "poll_a" } }),
    );
    expect(canonicalReadKey({ ...base, query: { category: "Voice" } })).not.toBe(
      canonicalReadKey({ ...base, query: { category: "voice" } }),
    );
  });
});

describe("response budget contract", () => {
  it("returns the exact page and byte count when it fits", () => {
    const page = {
      data: [{ id: "p1", description: "a".repeat(40) }],
      nextCursor: "cursor:p1",
      total: null,
    };
    const result = assertPageWithinByteBudget(page, 1024);
    expect(result.page).toBe(page);
    expect(result.body).toBe(JSON.stringify(page));
    expect(result.bytes).toBe(Buffer.byteLength(result.body, "utf8"));
  });

  it("rejects the whole page rather than hiding rows", () => {
    expect(() =>
      assertPageWithinByteBudget(
        { data: [{ id: "p1", description: "x".repeat(500) }], nextCursor: "cursor:p1", total: null },
        128,
      ),
    ).toThrow(/response budget/i);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run test:api -- tests/api/posts-feed-rpc.test.ts
```

Expected: FAIL because `api/_read-cursor.js` and `api/_response-budget.js` do not exist.

- [ ] **Step 3: Implement the exact cursor/key interface**

Create `api/_read-cursor.js`:

```js
import { createHash } from "node:crypto";

const MAX_CURSOR_CHARS = 512;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode(value) {
  if (typeof value !== "string" || !value || value.length > MAX_CURSOR_CHARS) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || parsed.v !== 1) return null;
    if (typeof parsed.id !== "string" || !parsed.id || parsed.id.length > 80) return null;
    if (typeof parsed.created_at !== "string" || !ISO_TIMESTAMP.test(parsed.created_at)) return null;
    if (Number.isNaN(Date.parse(parsed.created_at))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodeFeedCursor(row) {
  return encode({
    v: 1,
    pinned: row.pinned === true,
    created_at: new Date(row.created_at).toISOString(),
    id: row.id,
  });
}

export function decodeFeedCursor(value) {
  const parsed = decode(value);
  return parsed && typeof parsed.pinned === "boolean" ? parsed : null;
}

export function encodePollCursor(row) {
  return encode({ v: 1, created_at: new Date(row.created_at).toISOString(), id: row.id });
}

export function decodePollCursor(value) {
  return decode(value);
}

function normalizeReadQueryValue(key, value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim());
  const normalized = String(value).trim();
  return key === "q" || key === "query" ? normalized.toLowerCase() : normalized;
}

export function canonicalReadKey({ route, query, locale, viewer, permission }) {
  const normalizedQuery = Object.fromEntries(
    Object.entries(query || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, normalizeReadQueryValue(key, value)])
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  const canonical = JSON.stringify({
    route,
    query: normalizedQuery,
    locale: String(locale || "en").trim().toLowerCase().slice(0, 16),
    viewer: viewer ? String(viewer).trim().toLowerCase() : null,
    permission: String(permission || "public").trim().toLowerCase(),
  });
  return createHash("sha256").update(canonical).digest("base64url");
}
```

`normalizeReadQueryValue` trims values but preserves case for opaque IDs and exact-match filters (`id`, `ids`, `post_id`, `author`, and `voter`); only the case-insensitive search text is lowercased. The key uses a code-point-independent lexical comparator rather than locale-sensitive collation. The poll adapter must pass its sorted, deduplicated ID set before hashing so equivalent batches still share one key.

- [ ] **Step 4: Implement the response budget guard**

Create `api/_response-budget.js`:

```js
export class ResponseBudgetError extends Error {
  constructor(maxBytes, actualBytes) {
    super(`Response budget exceeded ${maxBytes} bytes (${actualBytes} measured)`);
    this.name = "ResponseBudgetError";
    this.status = 503;
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }
}

export function assertPageWithinByteBudget(page, maxBytes) {
  const body = JSON.stringify(page);
  if (typeof body !== "string") throw new ResponseBudgetError(maxBytes, 0);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > maxBytes) throw new ResponseBudgetError(maxBytes, bytes);
  return { page, body, bytes };
}
```

- [ ] **Step 5: Make page totals explicitly nullable without changing existing endpoints**

Update the client contract in `src/lib/api.ts` and `src/__tests__/api.test.ts`:

```ts
export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  total: number | null;
}
```

Make `api.paginated<T>` return `Promise<PaginatedResult<T>>`, make `api.postPaginated<T>` use the same `PaginatedResult<T>` return type, and export `PaginatedResult` so `useInfiniteScroll` imports it instead of declaring a second `PageResult` interface. Existing server routes that still send a number remain assignable; a missing total is represented as `null`, never as `0`.

Insert these fields into the existing `PostData` interface:

```ts
my_reactions?: string[];
linked_poll_data?: PollData | null;
my_poll_vote?: number[] | null;
```

Insert this field into the existing `PollData` interface:

```ts
my_vote?: number[] | null;
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run sequentially:

```powershell
npm run test:api -- tests/api/posts-feed-rpc.test.ts
npm test -- src/__tests__/api.test.ts
npm run typecheck
npm run lint
```

Expected: all pass; no production handler uses the new cursor helper yet.

- [ ] **Step 7: Commit only Task 1 files**

```powershell
git add api/_read-cursor.js api/_response-budget.js tests/api/posts-feed-rpc.test.ts src/types/index.ts src/lib/api.ts src/__tests__/api.test.ts
git commit -m "feat(api): define bounded read cursor contracts"
```

### Task 2: Add Complete-Response Cache and Cold Single-Flight

**Files:**
- Create: `tests/api/read-cache.test.ts`
- Modify: `api/_cache.js:121-291`
- Modify: `tests/api/posts-feed-perf.test.ts`

**Interfaces:**
- Consumes: `canonicalReadKey` and shaped page objects from Task 1.
- Produces: `createResponseCache`, `ResponseCacheCapacityError`, `feedResponseCache`, `pollResponseCache`, and cache-status headers for Tasks 4 and 6.

- [ ] **Step 1: Write failing complete-response cache tests**

Create `tests/api/read-cache.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResponseCache, ResponseCacheCapacityError } from "../../api/_cache.js";

beforeEach(() => vi.useRealTimers());

describe("complete response cache", () => {
  it("coalesces 50 cold misses into one loader", async () => {
    const cache = createResponseCache({ namespace: "test", ttlMs: 10_000, staleTtlMs: 60_000 });
    const loader = vi.fn(async () => ({ data: [{ id: "p1" }], nextCursor: null, total: null }));
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get("same", loader)));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === "MISS")).toHaveLength(1);
    expect(results.filter((result) => result.status === "COALESCED")).toHaveLength(49);
  });

  it("caches the complete value and serves a fresh hit", async () => {
    const cache = createResponseCache({ namespace: "test", ttlMs: 10_000, staleTtlMs: 60_000 });
    const loader = vi.fn(async () => ({ data: [{ id: "p1" }], nextCursor: "c2", total: null }));
    expect((await cache.get("key", loader)).status).toBe("MISS");
    expect((await cache.get("key", loader)).status).toBe("HIT");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves stale and starts one background refresh", async () => {
    vi.useFakeTimers();
    const cache = createResponseCache({ namespace: "test", ttlMs: 100, staleTtlMs: 10_000 });
    let version = 1;
    const loader = vi.fn(async () => ({ version }));
    expect((await cache.get("key", loader)).value.version).toBe(1);
    await vi.advanceTimersByTimeAsync(101);
    version = 2;
    const stale = await Promise.all(Array.from({ length: 20 }, () => cache.get("key", loader)));
    expect(stale.every((result) => result.status === "STALE" && result.value.version === 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("bounds entries and refuses values over the byte budget", async () => {
    const cache = createResponseCache({ namespace: "test", maxEntries: 2, maxEntryBytes: 128 });
    await cache.get("a", async () => ({ value: "a" }));
    await cache.get("b", async () => ({ value: "b" }));
    await cache.get("c", async () => ({ value: "c" }));
    expect(cache.stats().entries).toBeLessThanOrEqual(2);
    const accepted = await cache.get("large", async () => ({ value: "x".repeat(256) }));
    expect(accepted.value).toEqual({ value: "x".repeat(256) });
    expect(cache.stats().rejected_too_large).toBe(1);
  });

  it("does not let an older cold load repopulate after invalidation", async () => {
    const cache = createResponseCache({ namespace: "test", ttlMs: 10_000, staleTtlMs: 60_000 });
    let resolveOld;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const first = cache.get("key", () => old);
    await Promise.resolve();
    cache.invalidate();
    const second = await cache.get("key", async () => ({ version: 2 }));
    expect(second.value).toEqual({ version: 2 });
    resolveOld({ version: 1 });
    await first;
    expect((await cache.get("key", async () => ({ version: 3 }))).value).toEqual({ version: 2 });
  });

  it("bounds the in-flight map and fails new cold keys honestly", async () => {
    const cache = createResponseCache({ namespace: "test", maxInflight: 1 });
    let resolveFirst;
    const first = cache.get("first", () => new Promise((resolve) => { resolveFirst = resolve; }));
    await expect(cache.get("second", async () => ({ value: 2 }))).rejects.toBeInstanceOf(ResponseCacheCapacityError);
    expect(cache.stats().inflight).toBeLessThanOrEqual(1);
    resolveFirst({ value: 1 });
    await first;
  });
});
```

- [ ] **Step 2: Run the cache test and verify RED**

```powershell
npm run test:api -- tests/api/read-cache.test.ts
```

Expected: FAIL because `createResponseCache` is not exported.

- [ ] **Step 3: Implement the bounded complete-response cache**

Add to `api/_cache.js` without changing existing `cached` or `staleWhileRevalidate` semantics:

```js
export class ResponseCacheCapacityError extends Error {
  constructor(maxInflight) {
    super(`Response cache is at its ${maxInflight}-request in-flight limit`);
    this.name = "ResponseCacheCapacityError";
    this.status = 503;
    this.maxInflight = maxInflight;
  }
}

export function createResponseCache({
  namespace,
  ttlMs = 10_000,
  staleTtlMs = 60_000,
  maxEntries = 200,
  maxEntryBytes = 262_144,
  maxInflight = 64,
} = {}) {
  const entries = new Map();
  const inflight = new Map();
  let generation = 0;
  const counters = {
    hits: 0,
    misses: 0,
    stale: 0,
    coalesced: 0,
    rejected_too_large: 0,
    capacity_rejected: 0,
    refresh_deferred: 0,
  };
  const boundedMaxInflight = Math.max(1, maxInflight);

  function remember(key, value, now) {
    const serialized = value && typeof value.body === "string" ? value.body : JSON.stringify(value);
    const size = Buffer.byteLength(serialized, "utf8");
    if (size > maxEntryBytes) {
      counters.rejected_too_large += 1;
      return;
    }
    if (!entries.has(key) && entries.size >= maxEntries) {
      const removable = [...entries.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
      for (const [oldKey] of removable.slice(0, Math.max(1, Math.floor(maxEntries * 0.2)))) {
        entries.delete(oldKey);
      }
    }
    entries.set(key, {
      value,
      size,
      createdAt: now,
      expiresAt: now + ttlMs,
      staleExpiresAt: now + staleTtlMs,
      lastAccess: now,
    });
  }

  function startLoad(key, loader) {
    if (inflight.size >= boundedMaxInflight) {
      counters.capacity_rejected += 1;
      throw new ResponseCacheCapacityError(boundedMaxInflight);
    }
    const token = { generation };
    const promise = Promise.resolve().then(loader);
    inflight.set(key, { token, promise });
    void promise
      .then((value) => {
        if (inflight.get(key)?.token === token && token.generation === generation) {
          remember(key, value, Date.now());
        }
        return value;
      })
      .catch(() => undefined)
      .finally(() => {
        if (inflight.get(key)?.token === token) inflight.delete(key);
      });
    return promise;
  }

  return {
    async get(key, loader) {
      const now = Date.now();
      const entry = entries.get(key);
      if (entry && entry.expiresAt > now) {
        entry.lastAccess = now;
        counters.hits += 1;
        return { value: entry.value, status: "HIT", age_ms: now - entry.createdAt };
      }
      if (entry && entry.staleExpiresAt > now) {
        entry.lastAccess = now;
        counters.stale += 1;
        if (!inflight.has(key)) {
          if (inflight.size < boundedMaxInflight) startLoad(key, loader);
          else counters.refresh_deferred += 1;
        }
        return { value: entry.value, status: "STALE", age_ms: now - entry.createdAt };
      }

      const pending = inflight.get(key);
      if (pending) {
        counters.coalesced += 1;
        const value = await pending.promise;
        return { value, status: "COALESCED", age_ms: 0 };
      }

      counters.misses += 1;
      const promise = startLoad(key, loader);
      const value = await promise;
      return { value, status: "MISS", age_ms: 0 };
    },
    invalidate() {
      generation += 1;
      entries.clear();
      // Do not let a request started before a mutation coalesce into the next
      // request or repopulate the cache after the mutation.
      inflight.clear();
    },
    stats() {
      return {
        namespace,
        entries: entries.size,
        inflight: inflight.size,
        max_entries: maxEntries,
        max_inflight: boundedMaxInflight,
        ...counters,
      };
    },
  };
}

export const feedResponseCache = createResponseCache({ namespace: "feed", maxEntries: 300 });
export const pollResponseCache = createResponseCache({ namespace: "polls", maxEntries: 200 });
```

Extend the existing default export from `api/_cache.js` with `createResponseCache`, `ResponseCacheCapacityError`, `feedResponseCache`, and `pollResponseCache` so both named imports used by the new read modules and the legacy default-import callers resolve the same instances.

- [ ] **Step 4: Replace raw-parent cache assertions**

In `tests/api/posts-feed-perf.test.ts`, keep the existing write invalidation test but change the route-level tests to assert complete-response behavior: first request returns `MISS`, a concurrent cold burst produces one loader, a warm request returns `HIT`, an in-flight invalidation cannot repopulate an older value, and no `reactions`, `comments`, `polls`, or `poll_votes` parent scan runs on a warm response.

- [ ] **Step 5: Run focused cache tests**

```powershell
npm run test:api -- tests/api/read-cache.test.ts tests/api/posts-feed-perf.test.ts
```

Expected: PASS. Existing search/category callers of `staleWhileRevalidate` retain their current behavior.

- [ ] **Step 6: Commit only cache files**

```powershell
git add api/_cache.js tests/api/read-cache.test.ts tests/api/posts-feed-perf.test.ts
git commit -m "perf(api): cache complete read responses"
```

### Task 3: Add Service-Role-Only Feed and Poll Read Functions

**Files:**
- Create: `api/migrations/027_feed_poll_read_functions.sql`
- Create: `scripts/verify-read-rpcs.mjs`
- Modify: `tests/api/posts-feed-rpc.test.ts`

**Interfaces:**
- Consumes: current `posts`, `polls`, `poll_votes`, `reactions`, and `comments` schema; migration `015` supplies `poll_votes.created_at` but the read functions do not depend on it.
- Produces: `public.is_test_artifact_text(text)`, `public.api_feed_page(...)`, and `public.api_poll_page(...)` for Task 4.

- [ ] **Step 1: Add a failing SQL contract test**

Add to `tests/api/posts-feed-rpc.test.ts`:

```ts
import { readFileSync } from "node:fs";

it("keeps read RPCs invoker-only and service-role-only", () => {
  const sql = readFileSync(
    new URL("../../api/migrations/027_feed_poll_read_functions.sql", import.meta.url),
    "utf8",
  );
  expect(sql).toContain("CREATE OR REPLACE FUNCTION public.api_feed_page");
  expect(sql).toContain("p_priority text DEFAULT NULL");
  expect(sql).toContain("p_from timestamptz DEFAULT NULL");
  expect(sql).toContain("p_to timestamptz DEFAULT NULL");
  expect(sql).toContain("CREATE OR REPLACE FUNCTION public.api_poll_page");
  expect(sql.match(/SECURITY INVOKER/g)?.length).toBeGreaterThanOrEqual(3);
  expect(sql).toContain("SET search_path = ''");
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.api_feed_page");
  expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.api_feed_page");
  expect(sql).toContain("TO service_role");
  expect(sql).not.toMatch(/GRANT EXECUTE[^;]+TO (?:anon|authenticated|PUBLIC)/i);
});
```

- [ ] **Step 2: Run the SQL contract test and verify RED**

```powershell
npm run test:api -- tests/api/posts-feed-rpc.test.ts
```

Expected: FAIL because migration `027` does not exist.

- [ ] **Step 3: Create the artifact predicate and feed function**

Create `api/migrations/027_feed_poll_read_functions.sql` with this complete security/artifact foundation and feed function:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.is_test_artifact_text(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      btrim(value) ~* '^[a-z][bcdfghjklmnpqrstvwxz]{4,5}[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+'
      AND btrim(value) ~ '[[:digit:]]'
    )
    OR btrim(value) ~* '^qa[[:space:]]+test([^[:alnum:]_]|$)'
    OR btrim(value) ~* '^test[[:space:]]+(post|poll|question|problem|suggestion)([^[:alnum:]_]|$)'
    OR btrim(value) ~* '^do you agree:[[:space:]]*test([^[:alnum:]_]|$)'
    OR btrim(value) ~* '^(this is a test comment|test body text)$'
    OR btrim(value) ~* '^(content type|full crud|final workflow|workflow|fv|reaction comment)[[:space:]]+test([[:space:]]+(post|poll|question|problem|suggestion))?([[:space:]]+[0-9]+)?$'
    , false
  );
$$;

CREATE OR REPLACE FUNCTION public.api_feed_page(
  p_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_viewer_id text DEFAULT NULL,
  p_cursor jsonb DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_include_total boolean DEFAULT false
)
RETURNS TABLE (
  post jsonb,
  reactions jsonb,
  comment_count bigint,
  ready_for_decision boolean,
  ready_threshold integer,
  purge_at timestamptz,
  linked_poll jsonb,
  linked_poll_votes bigint,
  my_reactions jsonb,
  my_poll_vote jsonb,
  cursor_created_at timestamptz,
  cursor_id text,
  cursor_pinned boolean,
  total bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_cursor_pinned boolean := coalesce((p_cursor ->> 'pinned')::boolean, false);
  v_cursor_created_at timestamptz := nullif(p_cursor ->> 'created_at', '')::timestamptz;
  v_cursor_id text := nullif(p_cursor ->> 'id', '');
  v_total bigint := NULL;
BEGIN
  IF p_cursor IS NOT NULL
     AND (p_cursor ->> 'pinned' IS NULL
          OR (p_cursor ->> 'pinned') NOT IN ('true', 'false')
          OR v_cursor_created_at IS NULL
          OR v_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid feed cursor' USING ERRCODE = '22023';
  END IF;

  IF p_include_total THEN
    SELECT count(*)::bigint
      INTO v_total
      FROM public.posts p
     WHERE p.deleted = false
       AND p.hidden = false
       AND p.status <> 'pending_review'
       AND coalesce(p.visibility, 'public') = 'public'
       AND NOT coalesce(public.is_test_artifact_text(p.title), false)
       AND (p_type IS NULL OR p.type = p_type)
       AND (p_status IS NULL OR p.status = p_status)
       AND (p_category IS NULL OR p.category = p_category)
       AND (p_priority IS NULL OR p.priority = p_priority)
       AND (p_from IS NULL OR p.created_at >= p_from)
       AND (p_to IS NULL OR p.created_at < p_to)
       AND (
         p_query IS NULL
         OR p.title ILIKE '%' || p_query || '%'
         OR p.description ILIKE '%' || p_query || '%'
         OR p.category ILIKE '%' || p_query || '%'
         OR p.id ILIKE '%' || p_query || '%'
         OR p.author_id ILIKE '%' || p_query || '%'
         OR EXISTS (
          SELECT 1
            FROM unnest(coalesce(p.tags, ARRAY[]::text[])) AS tag(value)
           WHERE tag.value ILIKE '%' || p_query || '%'
        )
       );
  END IF;

  RETURN QUERY
  WITH page AS (
    SELECT p.*
      FROM public.posts p
     WHERE p.deleted = false
       AND p.hidden = false
       AND p.status <> 'pending_review'
       AND coalesce(p.visibility, 'public') = 'public'
       AND NOT coalesce(public.is_test_artifact_text(p.title), false)
       AND (p_type IS NULL OR p.type = p_type)
       AND (p_status IS NULL OR p.status = p_status)
       AND (p_category IS NULL OR p.category = p_category)
       AND (p_priority IS NULL OR p.priority = p_priority)
       AND (p_from IS NULL OR p.created_at >= p_from)
       AND (p_to IS NULL OR p.created_at < p_to)
       AND (
         p_query IS NULL
         OR p.title ILIKE '%' || p_query || '%'
         OR p.description ILIKE '%' || p_query || '%'
         OR p.category ILIKE '%' || p_query || '%'
         OR p.id ILIKE '%' || p_query || '%'
         OR p.author_id ILIKE '%' || p_query || '%'
         OR EXISTS (
          SELECT 1
            FROM unnest(coalesce(p.tags, ARRAY[]::text[])) AS tag(value)
           WHERE tag.value ILIKE '%' || p_query || '%'
        )
       )
       AND (
         p_cursor IS NULL
         OR (coalesce(p.pinned, false), coalesce(p.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00'), p.id)
              < (v_cursor_pinned, v_cursor_created_at, v_cursor_id)
       )
     ORDER BY coalesce(p.pinned, false) DESC, coalesce(p.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC, p.id DESC
     LIMIT v_limit + 1
  )
  SELECT (to_jsonb(page_row) - 'admin_notes') || jsonb_build_object(
           'created_at', coalesce(page_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00')
         ),
         coalesce(rc.reactions, '{}'::jsonb),
         coalesce(cc.n, 0)::bigint,
         NOT (coalesce(page_row.status, '') IN ('solved', 'archived'))
           AND coalesce((rc.reactions ->> 'support')::bigint, 0) >= 10,
         10,
         CASE WHEN page_row.status IN ('solved', 'archived')
              THEN page_row.updated_at + interval '5 days'
              ELSE NULL END,
         CASE WHEN lp.id IS NULL THEN NULL
              ELSE to_jsonb(lp) || jsonb_build_object(
                'created_at', coalesce(lp.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
                'total_votes', coalesce(vt.total_votes, 0),
                'vote_counts', coalesce(vc.vote_counts, '{}'::jsonb)
              )
         END,
         CASE WHEN lp.id IS NULL THEN NULL ELSE coalesce(vt.total_votes, 0) END,
         CASE WHEN p_viewer_id IS NULL THEN '[]'::jsonb
              ELSE coalesce((
                SELECT jsonb_agg(mr.kind ORDER BY mr.kind)
                  FROM public.reactions mr
                 WHERE mr.target_id = page_row.id
                   AND mr.target_type = 'post'
                   AND mr.author_id = p_viewer_id
              ), '[]'::jsonb)
         END,
         CASE WHEN p_viewer_id IS NULL OR lp.id IS NULL THEN NULL
              ELSE (
                SELECT mv.choices
                  FROM public.poll_votes mv
                 WHERE mv.poll_id = lp.id
                   AND mv.author_id = p_viewer_id
                 LIMIT 1
              )
         END,
         coalesce(page_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
         page_row.id,
         coalesce(page_row.pinned, false),
         v_total
    FROM page page_row
    LEFT JOIN LATERAL (
      SELECT coalesce(jsonb_object_agg(grouped.kind, grouped.n), '{}'::jsonb) AS reactions
        FROM (
          SELECT r.kind, count(*)::bigint AS n
            FROM public.reactions r
           WHERE r.target_id = page_row.id
             AND r.target_type = 'post'
           GROUP BY r.kind
        ) grouped
    ) rc ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint AS n
        FROM public.comments c
       WHERE c.post_id = page_row.id
         AND c.deleted = false
         AND c.hidden = false
    ) cc ON true
    LEFT JOIN LATERAL (
      SELECT candidate.*
        FROM public.polls candidate
       WHERE candidate.post_id = page_row.id
         AND candidate.deleted = false
         AND NOT coalesce(public.is_test_artifact_text(candidate.title), false)
       ORDER BY coalesce(candidate.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC, candidate.id DESC
       LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint AS total_votes
        FROM public.poll_votes pv
       WHERE pv.poll_id = lp.id
    ) vt ON lp.id IS NOT NULL
    LEFT JOIN LATERAL (
      SELECT coalesce(jsonb_object_agg(grouped.choice_key, grouped.choice_count), '{}'::jsonb) AS vote_counts
        FROM (
          SELECT choice.value::text AS choice_key, count(*)::bigint AS choice_count
            FROM public.poll_votes pv
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(pv.choices, '[]'::jsonb)) AS choice(value)
           WHERE pv.poll_id = lp.id
           GROUP BY choice.value
        ) grouped
    ) vc ON lp.id IS NOT NULL
   UNION ALL
   SELECT NULL::jsonb, NULL::jsonb, NULL::bigint, NULL::boolean, NULL::integer,
          NULL::timestamptz, NULL::jsonb, NULL::bigint, NULL::jsonb, NULL::jsonb,
          NULL::timestamptz, NULL::text, NULL::boolean, v_total
    WHERE p_include_total
      AND NOT EXISTS (SELECT 1 FROM page)
   ORDER BY 13 DESC NULLS LAST, 11 DESC NULLS LAST, 12 DESC NULLS LAST;
END;
$$;
```

The handler must discard the single metadata row whose `post` is `NULL`; that row exists only so an explicitly requested exact total remains available for an empty page. When `p_include_total` is false, an empty page returns no RPC rows and the API still returns `total: null`. The API must derive the next feed/poll cursor from the RPC’s `cursor_created_at`, `cursor_id`, and `cursor_pinned` fields, not from the nullable display field inside the JSON row. Legacy rows with a null `created_at` sort at the documented epoch sentinel and remain cursorable.

- [ ] **Step 4: Add the poll aggregate function and grants**

Append the poll function with this exact aggregate return contract:

```sql
CREATE OR REPLACE FUNCTION public.api_poll_page(
  p_ids text[] DEFAULT NULL,
  p_id text DEFAULT NULL,
  p_post_id text DEFAULT NULL,
  p_viewer_id text DEFAULT NULL,
  p_include_deleted boolean DEFAULT false,
  p_cursor jsonb DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  poll jsonb,
  total_votes bigint,
  vote_counts jsonb,
  my_vote jsonb,
  cursor_created_at timestamptz,
  cursor_id text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 100));
  v_cursor_created_at timestamptz := nullif(p_cursor ->> 'created_at', '')::timestamptz;
  v_cursor_id text := nullif(p_cursor ->> 'id', '');
BEGIN
  IF p_cursor IS NOT NULL AND (v_cursor_created_at IS NULL OR v_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid poll cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH page AS (
    SELECT poll_row.*
      FROM public.polls poll_row
     WHERE (p_include_deleted = true OR poll_row.deleted = false)
       AND NOT coalesce(public.is_test_artifact_text(poll_row.title), false)
       AND (p_ids IS NULL OR poll_row.id = ANY(p_ids))
       AND (p_id IS NULL OR poll_row.id = p_id)
       AND (p_post_id IS NULL OR poll_row.post_id = p_post_id)
       AND (
         p_cursor IS NULL
         OR (coalesce(poll_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00'), poll_row.id) < (v_cursor_created_at, v_cursor_id)
       )
     ORDER BY coalesce(poll_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC, poll_row.id DESC
     LIMIT v_limit + 1
  )
  SELECT (
           CASE WHEN linked_post.id IS NULL THEN (to_jsonb(page_row) - 'post_id')
                ELSE to_jsonb(page_row)
           END
         ) || jsonb_build_object(
           'created_at', coalesce(page_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00')
         ),
         coalesce(vt.total_votes, 0)::bigint,
         coalesce(vc.counts, '{}'::jsonb),
         CASE WHEN p_viewer_id IS NULL THEN NULL
              ELSE (
                SELECT mv.choices
                  FROM public.poll_votes mv
                 WHERE mv.poll_id = page_row.id
                   AND mv.author_id = p_viewer_id
                 LIMIT 1
              )
         END,
         coalesce(page_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
         page_row.id
    FROM page page_row
    LEFT JOIN public.posts linked_post
     ON linked_post.id = page_row.post_id
    AND (
      p_include_deleted = true
      OR (
        linked_post.deleted = false
        AND linked_post.hidden = false
        AND (
          coalesce(linked_post.visibility, 'public') = 'public'
          OR linked_post.author_id = p_viewer_id
        )
      )
    )
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint AS total_votes
        FROM public.poll_votes pv
       WHERE pv.poll_id = page_row.id
    ) vt ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(jsonb_object_agg(grouped.choice_key, grouped.choice_count), '{}'::jsonb) AS counts
        FROM (
          SELECT choice.value::text AS choice_key, count(*)::bigint AS choice_count
            FROM public.poll_votes pv
            CROSS JOIN LATERAL jsonb_array_elements(coalesce(pv.choices, '[]'::jsonb)) AS choice(value)
           WHERE pv.poll_id = page_row.id
           GROUP BY choice.value
        ) grouped
    ) vc ON true
   ORDER BY coalesce(page_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC, page_row.id DESC;
END;
$$;
```

Finish the migration with explicit least privilege:

```sql
REVOKE ALL ON FUNCTION public.is_test_artifact_text(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_feed_page(text, text, text, text, text, timestamptz, timestamptz, text, jsonb, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_poll_page(text[], text, text, text, boolean, jsonb, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_test_artifact_text(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_feed_page(text, text, text, text, text, timestamptz, timestamptz, text, jsonb, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_poll_page(text[], text, text, text, boolean, jsonb, integer) TO service_role;

COMMIT;
```

- [ ] **Step 5: Create the read-only staging verifier**

`scripts/verify-read-rpcs.mjs` must:

- require `VITE_SUPABASE_URL` or `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`;
- call only `api_feed_page` and `api_poll_page` with limit values `1`, `20`, `100`, and `101` to prove clamping; the SQL page functions intentionally return at most `clamped_limit + 1` rows for the API’s sentinel cursor, so the verifier must assert that direct-RPC bound; the shaped HTTP response cap is covered by the focused handler tests and Task 10 benchmark;
- verify 20-row page-one behavior, priority/date filter fixtures, and an opaque cursor round trip;
- verify artifact fixtures are absent;
- verify a multi-choice vote yields correct total and per-choice counts;
- print response byte sizes and function names only, never service credentials or raw post bodies;
- the staging `psql` privilege gate (run beside this script, not through PostgREST) must query `has_function_privilege` for `service_role`, `anon`, and `authenticated` and require execute only for `service_role`;
- exit nonzero on any RPC error, over-limit row count, artifact leak, privilege mismatch, or shaped HTTP response above 262,144 bytes; the direct `p_limit=101` sentinel check is row-bounded only because the API discards that sentinel before shaping.

Use this command in staging:

```powershell
if (-not $env:VITE_SUPABASE_URL -and -not $env:SUPABASE_URL) { throw "Set VITE_SUPABASE_URL or SUPABASE_URL to the approved staging project URL" }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) { throw "Set SUPABASE_SERVICE_ROLE_KEY from the approved staging environment" }
node scripts/verify-read-rpcs.mjs
```

The executor obtains secrets from the approved environment; never writes them to source or evidence.

- [ ] **Step 6: Apply and verify migration 027 in staging only**

Before applying, inspect any pre-existing function definitions and stop on signature/return-type drift rather than asking `CREATE OR REPLACE` to change an incompatible object:

```sql
SELECT p.oid::regprocedure AS signature,
       pg_get_function_result(p.oid) AS result_type,
       p.prosecdef,
       p.proconfig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('is_test_artifact_text', 'api_feed_page', 'api_poll_page')
 ORDER BY 1;
```

Then apply and verify:

```powershell
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL to the approved staging PostgreSQL URL" }
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f api/migrations/027_feed_poll_read_functions.sql
$privilegeSql = @'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('anon', 'public.is_test_artifact_text(text)'),
        ('anon', 'public.api_feed_page(text,text,text,text,text,timestamptz,timestamptz,text,jsonb,integer,boolean)'),
        ('anon', 'public.api_poll_page(text[],text,text,text,boolean,jsonb,integer)'),
        ('authenticated', 'public.is_test_artifact_text(text)'),
        ('authenticated', 'public.api_feed_page(text,text,text,text,text,timestamptz,timestamptz,text,jsonb,integer,boolean)'),
        ('authenticated', 'public.api_poll_page(text[],text,text,text,boolean,jsonb,integer)')
      ) AS denied(role_name, function_signature)
     WHERE has_function_privilege(denied.role_name::name, denied.function_signature::text, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'read RPC execute privilege leaked to anon/authenticated';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('service_role', 'public.is_test_artifact_text(text)'),
        ('service_role', 'public.api_feed_page(text,text,text,text,text,timestamptz,timestamptz,text,jsonb,integer,boolean)'),
        ('service_role', 'public.api_poll_page(text[],text,text,text,boolean,jsonb,integer)')
      ) AS required(role_name, function_signature)
     WHERE NOT has_function_privilege(required.role_name::name, required.function_signature::text, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'service_role is missing read RPC execute privilege';
  END IF;
END
$$;
'@
$privilegeSql | psql $env:DATABASE_URL -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw "Read RPC privilege gate failed" }
node scripts/verify-read-rpcs.mjs
```

Expected: both functions exist, are invoker-only, reject direct anon/authenticated execution, and return correct aggregate fixtures.

- [ ] **Step 7: Run focused tests**

```powershell
npm run test:api -- tests/api/posts-feed-rpc.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 8: Commit the additive migration and verifier**

```powershell
git add api/migrations/027_feed_poll_read_functions.sql scripts/verify-read-rpcs.mjs tests/api/posts-feed-rpc.test.ts
git commit -m "feat(db): add aggregate feed and poll read functions"
```

### Task 4: Switch Paginated Feed and Poll Reads to Aggregate RPCs

**Files:**
- Create: `api/_posts-read.js`
- Create: `api/_polls-read.js`
- Create: `tests/api/polls-read-rpc.test.ts`
- Modify: `api/_posts.js:133-589,876-884,1090-1098,1239-1247`
- Modify: `api/_polls.js:20-183,256-340,427-490`
- Modify: `api/_auth.js:37-39,545-560` — export the canonical anonymous-identity validator for the new read adapters.
- Modify: `api/_comments.js`
- Modify: `api/_reactions.js`
- Modify: `src/pages/admin/PostsTable.tsx:122-145,229-308,360-372` so admin surfaces that display an exact total explicitly request `include_total=1`
- Modify: `src/__tests__/PostsTable.test.tsx`
- Modify: `tests/api/posts-full.test.ts:263-533`
- Modify: `tests/api/posts-feed-perf.test.ts`
- Modify: `tests/api/polls-full.test.ts:276-381`
- Modify: `tests/api/polls-filter.test.ts`

**Interfaces:**
- Consumes: Task 1 cursor/budget helpers, Task 2 named caches, Task 3 RPCs, and the canonical `validAnonId` identity validator.
- Produces: `handlePaginatedPostsGet(req, res)`, `handlePollsRead(req, res)`, `getPollResult(pollId, viewerId)`, one-call aggregate responses, page-one `total: null`, and complete cache invalidation.

- [ ] **Step 1: Write failing feed RPC tests**

Create focused tests that mock `supabase.rpc` and fail if `supabase.from` is called:

```ts
const makeRpcRow = (overrides: Record<string, unknown> = {}) => ({
  post: { id: "p1", title: "Problem", created_at: "2026-09-24T10:00:00.000Z", author_id: "anon_owner" },
  reactions: {},
  comment_count: 0,
  ready_for_decision: false,
  ready_threshold: 10,
  purge_at: null,
  linked_poll: null,
  linked_poll_votes: null,
  my_reactions: [],
  my_poll_vote: null,
  cursor_created_at: "2026-09-24T10:00:00.000Z",
  cursor_id: "p1",
  cursor_pinned: false,
  total: null,
  ...overrides,
});

it("uses one aggregate RPC for a 20-row page and omits page-one total", async () => {
  rpc.mockResolvedValue({
    data: Array.from({ length: 21 }, (_, index) => ({
      post: makePost({ id: `p${index}` }),
      reactions: { support: index },
      comment_count: index,
      ready_for_decision: false,
      ready_threshold: 10,
      purge_at: null,
      linked_poll: null,
      linked_poll_votes: null,
      my_reactions: [],
      my_poll_vote: null,
      cursor_created_at: `2026-09-24T10:${String(20 - index).padStart(2, "0")}:00.000Z`,
      cursor_id: `p${index}`,
      cursor_pinned: false,
      total: null,
    })),
    error: null,
  });

  await handler({ method: "GET", query: { paginate: "1", limit: "20", type: "problem", viewer: "anon_a" }, headers: { "x-anon-id": "anon_a" } }, response());

  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("api_feed_page", expect.objectContaining({
    p_type: "problem",
    p_limit: 20,
    p_include_total: false,
    p_viewer_id: "anon_a",
  }));
  expect(from).not.toHaveBeenCalled();
  expect((responseBody().data as unknown[]).length).toBe(20);
  expect(responseBody().total).toBeNull();
  expect(responseBody().nextCursor).toBeTruthy();
});

it("calculates a total only for include_total=1", async () => {
  rpc.mockResolvedValue({
    data: [{ ...makeRpcRow(), total: 73 }],
    error: null,
  });
  await handler({ method: "GET", query: { paginate: "1", limit: "20", include_total: "1" }, headers: {} }, response());
  expect(rpc).toHaveBeenCalledWith("api_feed_page", expect.objectContaining({ p_include_total: true }));
  expect(responseBody().total).toBe(73);
});

it("preserves an explicit zero total", async () => {
  rpc.mockResolvedValue({ data: [{ post: null, total: 0 }], error: null });
  await handler({ method: "GET", query: { paginate: "1", include_total: "1" }, headers: {} }, response());
  expect(responseBody().total).toBe(0);
  expect(responseBody().data).toEqual([]);
});
```

Also add tests for:

- equal timestamps ordered by `id DESC`, and a legacy null `created_at` sorts at the epoch sentinel without breaking the next cursor;
- priority and `from`/`to` filters are passed to the RPC and produce the same bounded page/total set, with malformed date filters rejected before any RPC call;
- a 20-row response with no 21st row returns `nextCursor: null`;
- anonymous public cache control and viewer private cache control;
- foreign post and linked-poll `author_id` values are masked, while the viewer’s own values remain intact;
- a mismatched `viewer` query versus `x-anon-id` is rejected and public `include_deleted=1` is rejected without an RPC call;
- a poll linked to a private/hidden post exposes `post_id: null` to an unrelated public viewer, while the owner or an authorized admin retains the link;
- the `voter` compatibility branch returns at most 100 `{ poll_id, choices }` rows for the validated caller, rejects a mismatched `voter` value, and is private/no-cache; ordinary aggregate list tests still prove no `poll_votes` child-row query is made;
- `X-Cache-Status` equals the cache result;
- serialized response remains at or below 262,144 bytes;
- duplicate linked-poll fixtures deterministically expose only the newest poll by `created_at DESC, id DESC`;
- 20 maximum-size fixture rows stay within 262,144 bytes; an over-budget fixture returns a bounded 503 and never drops or hides a row;
- write methods call `feedResponseCache.invalidate()` after success; post visibility/identity writes also invalidate `pollResponseCache` because poll responses can expose or mask `post_id`.

- [ ] **Step 2: Write failing poll aggregate tests**

Create `tests/api/polls-read-rpc.test.ts` with exact cases:

```ts
it("deduplicates ids, caps at 100, and makes one aggregate RPC call", async () => {
  const ids = Array.from({ length: 105 }, (_, index) => `poll_${index}`);
  await handler({
    method: "GET",
    query: { ids: [...ids, "poll_0", "poll_1"].join(","), viewer: "anon_a" },
    headers: { "x-anon-id": "anon_a" },
  }, response());

  const call = rpc.mock.calls[0];
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(call[0]).toBe("api_poll_page");
  expect(call[1].p_ids).toHaveLength(100);
  expect(new Set(call[1].p_ids).size).toBe(100);
  expect(from).not.toHaveBeenCalled();
});

it("masks a foreign poll author while preserving viewer ownership", async () => {
  rpc.mockResolvedValue({
    data: [{
      poll: { ...makePoll({ author_id: "anon_owner" }) },
      total_votes: 0,
      vote_counts: {},
      my_vote: null,
      cursor_created_at: "2026-09-24T10:00:00.000Z",
      cursor_id: "poll-1",
    }],
    error: null,
  });
  const foreign = response();
  await handler({ method: "GET", query: { id: "poll-1", viewer: "anon_other" }, headers: { "x-anon-id": "anon_other" } }, foreign);
  expect(foreign.body[0]).toMatchObject({ author_id: "anon_own...", is_mine: false });

  const owner = response();
  await handler({ method: "GET", query: { id: "poll-1", viewer: "anon_owner" }, headers: { "x-anon-id": "anon_owner" } }, owner);
  expect(owner.body[0]).toMatchObject({ author_id: "anon_owner", is_mine: true });
});

it("returns aggregate choices without transferring vote rows", () => {
  rpc.mockResolvedValue({
    data: [{
      poll: makePoll(),
      total_votes: 3,
      vote_counts: { "0": 2, "1": 1 },
      my_vote: [0],
      cursor_created_at: "2026-09-24T10:00:00.000Z",
      cursor_id: "poll_1",
    }],
    error: null,
  });
  // Assert body[0].total_votes, vote_counts, and my_vote.
});

it("does not archive or repair orphan links during GET", async () => {
  await handler({ method: "GET", query: {}, headers: {} }, response());
  expect(from).not.toHaveBeenCalledWith(expect.any(Function));
  expect(rpc).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run both focused suites and verify RED**

```powershell
npm run test:api -- tests/api/posts-feed-rpc.test.ts tests/api/polls-read-rpc.test.ts
```

Expected: FAIL because handlers still use parent/child PostgREST queries.

- [ ] **Step 4: Implement `api/_posts-read.js`**

The module must:

1. accept only the paginated public-list branch (`paginate=1`, no `id`, `ids`, `author`, or `all=1`);
2. clamp `limit` to `1..100`;
3. normalize `status=all` to `null`;
4. clean `type`, `status`, `category`, `priority`, and `q`; validate `from`/`to` as bounded date filters, reject an inverted range, and pass them as ISO `timestamptz` values (or `null`); strip `%`, `_`, and backslash characters from `q` before passing it to the SQL `ILIKE` predicates;
5. derive viewer state from the validated `x-anon-id` header using the exported `validAnonId` helper; never derive viewer identity from a body field; if a `viewer` query value is present and differs, reject the request rather than returning another identity’s choices;
6. include total only when `include_total=1` and the request is public or admin-authorized;
7. decode the cursor, returning page one for malformed cursors;
8. build the complete-response cache key with route, normalized query, `Accept-Language`, viewer, and `public|admin` permission;
9. call `supabase.rpc("api_feed_page", namedArgs)` once with `p_type`, `p_status`, `p_category`, `p_priority`, `p_query`, `p_from`, `p_to`, `p_viewer_id`, `p_cursor`, `p_limit`, and `p_include_total`;
10. slice `limit` rows, set `hasMore` from row `limit + 1`, derive `nextCursor` from the last returned row, set `total` with a nullish check so an explicit zero remains `0` and an absent total is `null`, normalize PostgreSQL bigint fields to finite numbers, mask foreign author IDs, merge embedded poll/viewer fields, and call `assertPageWithinByteBudget`;
11. return that fully shaped, byte-bounded page from the cache loader so the cache stores the complete response that will be sent;
12. store `{ page, body, bytes }` from `assertPageWithinByteBudget` in the cache envelope, set `Content-Type: application/json; charset=utf-8`, send `body` with `res.status(200).send(...)`, and set `Content-Length` from the same UTF-8 byte count;
13. use `Cache-Control: public, max-age=0, s-maxage=10, stale-while-revalidate=60` only for a request with no viewer/admin, otherwise use `Cache-Control: private, no-cache`;
14. append `Accept-Language` and `X-Anon-Id` to the existing `Vary` value (preserving `Origin` from CORS) and set `X-Cache-Status` without exposing the raw cache key.

Catch `ResponseBudgetError.status === 503` at the handler boundary, set `Cache-Control: no-store`, and return only `{ error: "Feed response exceeded its size budget", code: "RESPONSE_BUDGET_EXCEEDED" }`; never return a partial page. Apply the same no-store rule to poll-budget and cache-capacity errors.

Use this row mapper:

```js
function mapFeedRow(row, viewerId) {
  const post = { ...row.post, is_mine: !!viewerId && row.post.author_id === viewerId };
  if (!post.is_mine && post.author_id !== "ADMIN") {
    post.author_id = `${String(post.author_id || "").slice(0, 9)}...`;
  }
  const linkedPoll = row.linked_poll ? { ...row.linked_poll } : null;
  if (linkedPoll) {
    linkedPoll.is_mine = !!viewerId && linkedPoll.author_id === viewerId;
    linkedPoll.my_vote = row.my_poll_vote || null;
    if (!linkedPoll.is_mine && linkedPoll.author_id !== "ADMIN") {
      linkedPoll.author_id = `${String(linkedPoll.author_id || "").slice(0, 9)}...`;
    }
  }
  return {
    ...post,
    reactions: row.reactions || {},
    comment_count: Number(row.comment_count || 0),
    ready_for_decision: row.ready_for_decision === true,
    ready_threshold: Number(row.ready_threshold || 10),
    purge_at: row.purge_at,
    linked_poll: linkedPoll?.id || null,
    linked_poll_votes: row.linked_poll_votes ?? null,
    linked_poll_data: linkedPoll,
    my_poll_vote: row.my_poll_vote || null,
    my_reactions: row.my_reactions || [],
  };
}
```

The handler must compare against the original unmasked author ID before masking. Use a small `appendVary(res, values)` helper that splits the current header on commas, trims/deduplicates case-insensitively, and writes the merged list; never replace `Vary: Origin` with a narrower value.

- [ ] **Step 5: Implement `api/_polls-read.js`**

The module must:

- parse and deduplicate `ids`, cap at 100, and reject/trim invalid IDs; use the sorted, deduplicated ID set in the normalized cache-key query so equivalent batches share one response;
- preserve `id`, `post_id`, and `voter` compatibility;
- call `api_poll_page` for list/id/ids/post-id reads;
- derive viewer state from the validated `x-anon-id` header using `validAnonId`, and reject a mismatched `viewer` query value; never use a body identity for a GET;
- set `p_include_deleted=true` only after `isAdmin(req)` succeeds; a public `include_deleted=1` request must be rejected rather than passed to the service-role RPC;
- return `my_vote` on each aggregate poll and normalize `total_votes` to a finite number;
- return at most 100 rows and at most 262,144 bytes; when the SQL function returns its `limit + 1` sentinel row for a direct/internal cursor read, discard that sentinel before shaping the compatibility array;
- treat a missing linked post as `post_id: null` in the response without writing;
- use `pollResponseCache` only for viewer-free public reads;
- export `getPollResult(pollId, viewerId)` for the vote response path; it calls the same RPC by `p_id`, returns one `PollData`, masks the author, and enforces the 32,768-byte result budget. An internal admin vote may pass the sentinel `ADMIN` to preserve the existing write path, but request-derived `x-anon-id` values must still pass `validAnonId` and can never become `ADMIN`;
- keep the specialized `voter` branch bounded to 100 rows, require its `voter` value to equal the validated caller identity, and return the existing `{ poll_id, choices }[]` compatibility shape. It is the sole child-row compatibility read: issue exactly one service-role query selecting only `poll_id,choices` filtered by `author_id = viewerId`, ordered by `poll_id`, and `.limit(100)`; it must not be publicly cached and must never be used to calculate public aggregate totals. All ordinary list/id/ids/post-id reads use `api_poll_page` and return aggregate polls;
- apply `assertPageWithinByteBudget(page, 262_144)` to poll lists and `assertPageWithinByteBudget(result, 32_768)` to `getPollResult` before caching/sending; set the same JSON/content-length and public/private cache headers as the feed path; return the bounded 503 contract instead of a partial poll list.

- [ ] **Step 6: Delegate existing handlers and remove page-one counting**

In `api/_posts.js`, import `handlePaginatedPostsGet` and route the paginated public-list GET to it before the legacy query builder. Preserve direct-by-id, ids, author, non-paginated compatibility, and mutation paths. In the legacy `all=1` admin pagination branch, remove the unconditional exact count; return `total: null` unless `include_total=1` is present. This keeps the admin compatibility path bounded without making page one pay for a count by default.

The admin compatibility branch must also stop using a timestamp-only cursor. After `isAdmin(req)` succeeds, decode the versioned feed cursor, exclude null `created_at` rows, apply the same lexicographic `created_at DESC, id DESC` boundary with `q.or(\`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})\`)`, and issue the next cursor with `encodeFeedCursor({ pinned: false, created_at: row.created_at, id: row.id })`. A malformed admin cursor is page one. This branch remains uncached and is not presented as the public aggregate path.

Remove the old `fetchFeedRows`/`feedSWR` raw-row cache and replace every later `feedSWR.invalidate()` call (including the post-create/update/delete paths) with `feedResponseCache.invalidate()` after persistence. Keep legacy direct/id/author/non-paginated reads uncached until separately measured; they are an explicit compatibility exception to this slice’s aggregate list path and must not be represented as evidence that every legacy read has been migrated. Do not silently route them through the public cache.

In `api/_polls.js`, route every GET/HEAD to `handlePollsRead`; preserve POST/PUT/DELETE behavior. After a successful vote, invalidate `feedResponseCache` and `pollResponseCache` immediately after persistence, then call `getPollResult(b.poll_id, author_id)` instead of `attachResults([poll], true)`; a failed aggregate read must not leave a stale cache entry.

- [ ] **Step 7: Invalidate complete caches on every successful mutation**

Add these exact invalidations after successful persistence, before returning:

```js
// _posts.js POST/PUT/DELETE
feedResponseCache.invalidate();
pollResponseCache.invalidate();

// _comments.js successful POST/PUT/DELETE
feedResponseCache.invalidate();

// _reactions.js successful POST
feedResponseCache.invalidate();

// _polls.js vote/create/update/delete
feedResponseCache.invalidate();
pollResponseCache.invalidate();
```

Invalidation is process-local. Cross-instance freshness is bounded by the 10-second cache TTL; do not add a database version read to every feed request without measurement.

- [ ] **Step 8: Preserve explicit admin totals**

In every `PostsTable` request path that displays `liveTotal`, `total`, “Showing X of Y,” or “Load all Y posts,” add `include_total: "1"` to the `api.paginated` query object. Keep ordinary feed/Home requests without that flag. Add a `PostsTable` test proving the URL/query contains `include_total=1` and the displayed total remains numeric.

- [ ] **Step 9: Update legacy tests to the new contract**

Required replacements:

- page-one `total` changes from the observed/overfetched row count to `null`;
- exact total test adds `include_total=1`;
- an empty page plus `include_total=1` consumes the SQL metadata row, returns `data: []`, and preserves the numeric total;
- raw poll-vote fixtures become aggregate RPC fixtures;
- orphan cleanup write test becomes “orphan is null in read output, no mutation builder called”;
- cache tests assert the complete response, not only `posts` scans.

- [ ] **Step 10: Run focused tests and verify GREEN**

```powershell
npm run test:api -- tests/api/posts-feed-rpc.test.ts tests/api/polls-read-rpc.test.ts tests/api/posts-full.test.ts tests/api/posts-feed-perf.test.ts tests/api/polls-full.test.ts tests/api/polls-filter.test.ts
npm test -- src/__tests__/PostsTable.test.tsx
npm run typecheck
npm run lint
```

Expected: PASS; no public read test invokes a mutation builder.

- [ ] **Step 11: Commit the API read slice**

```powershell
git add api/_posts-read.js api/_polls-read.js api/_posts.js api/_polls.js api/_auth.js api/_comments.js api/_reactions.js src/pages/admin/PostsTable.tsx src/__tests__/PostsTable.test.tsx tests/api/posts-feed-rpc.test.ts tests/api/polls-read-rpc.test.ts tests/api/posts-full.test.ts tests/api/posts-feed-perf.test.ts tests/api/polls-full.test.ts tests/api/polls-filter.test.ts
git commit -m "perf(api): serve aggregate cursor feed pages"
```

### Task 5: Make Home a 20-Row Cursor Client with Embedded Poll State

**Files:**
- Create: `src/__tests__/Home.pagination.test.tsx`
- Modify: `src/hooks/useInfiniteScroll.ts:12-238`
- Modify: `src/hooks/useInfiniteScroll.ts` tests in `src/__tests__/useInfiniteScroll.test.tsx`
- Modify: `src/pages/Home.tsx:46-835`
- Modify: `src/components/PostCard.tsx:50-64,365-374`
- Modify: `src/components/PollCard.tsx:19-31,160-181,367-420`
- Modify: `src/pages/PostDetail.tsx:756-773` and `src/pages/Polls.tsx:120-145` to consume the authoritative poll object without a full-list refetch
- Modify: `src/__tests__/PollCard.test.tsx`
- Modify: `src/__tests__/PostDetail.test.tsx`

**Interfaces:**
- Consumes: Task 4 `{ data, nextCursor, total: null }` feed page and embedded `linked_poll_data`/`my_poll_vote`.
- Produces: one first-page request of 20 rows, one explicit Load more request per additional 20 rows, no Home poll/reaction N+1, and local poll reconciliation after voting.

- [ ] **Step 1: Write failing Home pagination tests**

Create `src/__tests__/Home.pagination.test.tsx` with these behavior tests:

```ts
it("requests exactly 20 feed rows on mount", async () => {
  mocks.paginated.mockResolvedValue({ data: makePosts(20), nextCursor: "cursor_2", total: null });
  await renderHome();
  await waitFor(() => expect(screen.getAllByTestId("post-card")).toHaveLength(20));
  expect(mocks.paginated).toHaveBeenCalledTimes(1);
  expect(mocks.paginated).toHaveBeenCalledWith("/api/posts", {
    cursor: null,
    limit: 20,
    query: { type: "problem", viewer: "anon_test" },
  });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.getFresh).not.toHaveBeenCalled();
});

it("loads the next cursor only after the user presses Load more", async () => {
  mocks.paginated
    .mockResolvedValueOnce({ data: makePosts(20), nextCursor: "cursor_2", total: null })
    .mockResolvedValueOnce({ data: makePosts(20, 20), nextCursor: null, total: null });
  await renderHome();
  await user.click(screen.getByRole("button", { name: /load more/i }));
  await waitFor(() => expect(screen.getAllByTestId("post-card")).toHaveLength(40));
  expect(mocks.paginated).toHaveBeenLastCalledWith("/api/posts", {
    cursor: "cursor_2",
    limit: 20,
    query: { type: "problem", viewer: "anon_test" },
  });
});

it("never calls the observer to auto-load the next page", async () => {
  await renderHome();
  expect(observe).not.toHaveBeenCalled();
});

it("uses embedded poll data and patches the authoritative vote without a refetch", async () => {
  mocks.paginated.mockResolvedValue({
    data: [{ ...makePost(), linked_poll: "poll_1", linked_poll_data: makePoll(), my_poll_vote: [0] }],
    nextCursor: null,
    total: null,
  });
  await renderHome();
  mocks.paginated.mockClear();
  await user.click(screen.getByRole("button", { name: /submit vote/i }));
  await waitFor(() => expect(screen.getByTestId("poll-total")).toHaveTextContent("1"));
  expect(mocks.paginated).not.toHaveBeenCalled();
  expect(mocks.post).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Add failing manual/reset hook tests**

Add to `src/__tests__/useInfiniteScroll.test.tsx`:

```ts
it("does not register an observer when autoLoad=false", async () => {
  const fetcher = vi.fn().mockResolvedValue({ data: [{ id: "a" }], nextCursor: "c2", total: null });
  renderHook(() => useInfiniteScroll(fetcher, { limit: 20, autoLoad: false }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(MockIntersectionObserver.observe).not.toHaveBeenCalled();
});

it("reloads page one when resetKey changes", async () => {
  const fetcher = vi.fn().mockResolvedValue({ data: [], nextCursor: null, total: null });
  const { rerender } = renderHook(({ resetKey }) => useInfiniteScroll(fetcher, { resetKey }), {
    initialProps: { resetKey: "newest" },
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  rerender({ resetKey: "supported" });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher).toHaveBeenLastCalledWith({ cursor: null, limit: 30 });
});

it("ignores a stale page-one response after reset", async () => {
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const fetcher = vi.fn()
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce({ data: [{ id: "new" }], nextCursor: null, total: null });
  const { result, rerender } = renderHook(({ resetKey }) => useInfiniteScroll(fetcher, { resetKey }), {
    initialProps: { resetKey: "old" },
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  rerender({ resetKey: "new" });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  resolveFirst({ data: [{ id: "stale" }], nextCursor: "stale-cursor", total: null });
  await waitFor(() => expect(result.current.items).toEqual([{ id: "new" }]));
  expect(result.current.items).not.toContainEqual({ id: "stale" });
});

it("exposes an honest error and retries without converting failure to empty data", async () => {
  const fetcher = vi.fn()
    .mockRejectedValueOnce(new Error("Feed unavailable"))
    .mockResolvedValueOnce({ data: [{ id: "recovered" }], nextCursor: null, total: null });
  const { result } = renderHook(() => useInfiniteScroll(fetcher));
  await waitFor(() => expect(result.current.error).toMatch(/Feed unavailable/));
  expect(result.current.items).toEqual([]);
  result.current.retry();
  await waitFor(() => expect(result.current.items).toEqual([{ id: "recovered" }]));
  expect(result.current.error).toBeNull();
});
```

- [ ] **Step 3: Run focused unit tests and verify RED**

```powershell
npm test -- src/__tests__/Home.pagination.test.tsx src/__tests__/useInfiniteScroll.test.tsx
```

Expected: FAIL because Home still reveals a local array and starts poll N+1 requests; the hook has no `autoLoad` or `resetKey` options.

- [ ] **Step 4: Extend `useInfiniteScroll` without changing existing admin behavior**

Add these options:

```ts
interface UseInfiniteScrollOptions {
  limit?: number;
  threshold?: number;
  rootMargin?: string;
  autoLoad?: boolean;
  resetKey?: string;
}

interface UseInfiniteScrollReturn<T> {
  items: T[];
  loading: boolean;
  initialLoading: boolean;
  hasMore: boolean;
  total: number | null;
  error: string | null;
  retry: () => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  loadMore: () => void;
  reset: () => void;
  softReset: () => void;
  replaceItems: (items: T[]) => void;
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
}
```

Default `autoLoad` to `true` so existing admin consumers are unchanged in this slice; Home passes `false`. Import the exported `PaginatedResult<T>` from `src/lib/api.ts`, remove the duplicate `PageResult<T>` interface, initialize `total` to `null`, and reset it to `null` on hard/soft reset. Add an `error: string | null` state and a `retry()` action; initial and subsequent failures preserve the last-known-good items, set an honest error, and never turn a failed refresh into an authoritative empty list. Add `resetKey` to the initial/reload effect dependency list. When it changes, clear cursor/dedupe state and request page one. Keep stale-result protection with a monotonically increasing request-generation ref captured by every page-one/page-N promise; a response from an older generation must be ignored after reset, even when the older promise resolves after the new one. Change `PostCardProps.myPollVote` and `PollCardProps.myVote` to `number[] | null | undefined` so the nullable embedded choice can be passed without a cast.

- [ ] **Step 5: Replace Home’s local load/reveal/poll state with the hook**

Use this page fetcher:

```ts
const fetchFeedPage = useCallback(
  ({ cursor, limit }: { cursor: string | null; limit: number }) =>
    api.paginated<PostData>("/api/posts", {
      cursor,
      limit,
      query: { type: "problem", viewer: anonId || undefined },
    }),
  [anonId],
);
const feed = useInfiniteScroll<PostData>(fetchFeedPage, {
  limit: PAGE_SIZE,
  autoLoad: false,
  resetKey: "home-problem-feed",
});
```

Then:

- replace `posts`, `loading`, `error`, and local `visible` with the hook values (`feed.items`, `feed.initialLoading`, `feed.loading`, `feed.error`, and `feed.retry`);
- remove `pendingNew`, `showPending`, `knownIdsRef`, and the “new posts” pill; no passive event may mutate or refetch the accumulated list;
- remove `load`, `fetchPolls`, `pollsMap`, `myPollVotes`, poll refs, sequence refs, and all `/api/polls` calls;
- remove the local IntersectionObserver;
- remove the Home `useRealtime` subscription and its full-feed, reaction-map, or targeted poll refetch callbacks; the parent one-load task must leave no passive or visibility-triggered Home reload path;
- render every item in `feed.items`, not `filtered.slice(0, visible)`;
- show a Load more button only when `feed.hasMore`; its click calls `feed.loadMore()` and labels the remaining loaded/unknown count honestly without claiming a database total;
- pull-to-refresh calls `feed.reset()`;
- keep the existing `filtered` useMemo after pagination because this slice preserves Home’s client-side category/status/search/sort controls over the accumulated cursor pages; do not add a network request on each filter change. The stable `resetKey="home-problem-feed"` prevents accidental fetcher-identity reloads, while pull-to-refresh explicitly calls `feed.reset()`.
- relabel page-derived stats as `Loaded reports`, `Loaded active`, and `Loaded solved`; do not present 20 loaded rows as an exact platform total.
- pass `myReactions={post.my_reactions}`, `pollData={post.linked_poll_data}`, and `myPollVote={post.my_poll_vote}` directly to `PostCard`; keep no separate Home reaction map.

- [ ] **Step 6: Reconcile a vote locally with the authoritative response**

Change the callback types:

```ts
interface PollCardProps {
  onVoted?: (poll: PollData) => void;
}

interface PostCardProps {
  onPollVoted?: (poll: PollData) => void;
}
```

In `PollCard.vote`, call:

```ts
setLocal(res);
onVoted?.(res);
```

For the admin archive, restore, and stop-voting buttons, capture the authoritative `PollData` returned by `api.put`, call `setLocal(updated)`, and call `onVoted?.(updated)`; do not call the callback with no argument and do not force a full parent list reload. Existing zero-argument callbacks in other surfaces remain assignable, but their tests must cover the new authoritative object contract where they consume a vote response.

In Home:

```ts
const applyPollResult = useCallback((postId: string, poll: PollData) => {
  feed.setItems((current) => current.map((post) =>
    post.id === postId
      ? {
          ...post,
          linked_poll_data: poll,
          linked_poll_votes: poll.total_votes ?? 0,
          my_poll_vote: poll.my_vote ?? [],
        }
      : post,
  ));
}, [feed.setItems]);
```

Pass `onPollVoted={(poll) => applyPollResult(p.id, poll)}`. No `/api/polls` or full feed read follows the successful vote. Apply the same authoritative-object reconciliation to the standalone Polls page and PostDetail linked poll: replace only the matching poll row and `my_vote` entry; do not call `load`, `fetchPost`, `fetchPoll`, or `fetchMyVotes` after a successful vote.

- [ ] **Step 7: Run focused tests and verify GREEN**

```powershell
npm test -- src/__tests__/Home.pagination.test.tsx src/__tests__/useInfiniteScroll.test.tsx src/__tests__/PollCard.test.tsx
npm run typecheck
npm run lint
```

Expected: PASS; first page has at most 20 cards, explicit Load more appends one page, and no page-specific `/api/polls` or `/api/reactions` request occurs.

- [ ] **Step 8: Commit the Home integration**

```powershell
git add src/pages/Home.tsx src/hooks/useInfiniteScroll.ts src/__tests__/useInfiniteScroll.test.tsx src/__tests__/Home.pagination.test.tsx src/components/PostCard.tsx src/components/PollCard.tsx src/pages/PostDetail.tsx src/pages/Polls.tsx src/__tests__/PollCard.test.tsx src/__tests__/PostDetail.test.tsx src/types/index.ts
git commit -m "feat(home): paginate feed and embed poll state"
```

### Task 6: Move Read Side Effects into a Singleton Leased Maintenance Route

**Files:**
- Create: `api/migrations/028_maintenance_leases.sql`
- Create: `api/_maintenance-lease.js`
- Create: `api/_poll-expiry-registry.js`
- Create: `api/maintenance.js`
- Read: `api/_poll-sweeper.js` (reuse `sweepExpiredPolls`; do not fork its notification logic)
- Create: `scripts/verify-maintenance-lease.mjs`
- Create: `tests/api/read-side-effects.test.ts`
- Create: `tests/api/maintenance-lease.test.ts`
- Create: `tests/api/poll-expiry-registry.test.ts`
- Modify: `api/_automation-registry.js:5-12`
- Modify: `tests/api/agent-cron-registry.test.ts:128-178`
- Modify: `api/_posts.js:169-210,306-313`
- Modify: `api/_polls.js:108-167`
- Modify: `api/_cleanup.js:77-485`
- Modify: `api/index.js:30-35,191-196`
- Modify: `vercel.json:51-69`

**Interfaces:**
- Consumes: current `runCleanup`, `purgeExpired`, poll archive/orphan repair, and `isCronAuthorized`.
- Produces: side-effect-free public reads, `runContentMaintenance`, `runPollExpiryMaintenance`, `runLeasedPollExpiryMaintenance`, shared `claimLease`, `renewLease`, `releaseLease`, `runMaintenanceJobs`, and a cron route protected by `content-maintenance`/`poll-expiry` leases. The `poll-sweep` registry entry is a leased adapter, never a direct sweeper.

- [ ] **Step 1: Write failing public-read side-effect tests**

Create `tests/api/read-side-effects.test.ts`:

```ts
it("GET /api/posts performs no insert, update, upsert, delete, or write RPC", async () => {
  await postsHandler({ method: "GET", query: { paginate: "1", limit: "20" }, headers: {} }, response());
  expect(mutations).toEqual([]);
  expect(rpc.mock.calls.filter(([name]) => name === "api_feed_page")).toHaveLength(1);
});

it("GET /api/polls performs no archive or orphan repair", async () => {
  await pollsHandler({ method: "GET", query: { ids: "poll_orphan" }, headers: {} }, response());
  expect(mutations).toEqual([]);
  expect(body[0].post_id).toBeNull();
});

it("importing the consolidated API does not trigger cleanup", async () => {
  await import("../../api/index.js");
  expect(triggerAutoCleanup).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing lease and registry-route tests**

Create `tests/api/maintenance-lease.test.ts` with mocked `claim`, `renew`, and `release` RPC functions plus the shared `claimLease`, `renewLease`, and `releaseLease` wrappers. The tests must cover:

```ts
it("runs maintenance once when two invocations contend", async () => {
  claim
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: false, error: null });
  const [first, second] = await Promise.all([
    maintenanceHandler(cronRequest(), response()),
    maintenanceHandler(cronRequest(), response()),
  ]);
  expect(runContentMaintenance).toHaveBeenCalledTimes(1);
  expect(first.statusCode).toBe(200);
  expect(second.statusCode).toBe(200);
  expect(JSON.stringify(second.body)).toMatch(/lease_held/);
});

it("unauthorized maintenance reads cause zero claims and zero work", async () => {
  await maintenanceHandler({ method: "GET", headers: {} }, response());
  expect(claim).not.toHaveBeenCalled();
  expect(runContentMaintenance).not.toHaveBeenCalled();
});

it("keeps the manual cleanup route POST-only", async () => {
  const res = response();
  await cleanupHandler({ method: "GET", headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(claim).not.toHaveBeenCalled();
});

it("releases only the owner token after a job failure", async () => {
  claim.mockResolvedValue({ data: true, error: null });
  runContentMaintenance.mockRejectedValue(new Error("cleanup failed"));
  const res = response();
  await maintenanceHandler(cronRequest(), res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toMatchObject({
    ok: false,
    errors: expect.arrayContaining(["content-maintenance-failed"]),
  });
  expect(release).toHaveBeenCalledWith(expect.objectContaining({
    p_job_name: "content-maintenance",
    p_owner_token: expect.any(String),
  }));
});

it("returns false when a lease cannot be renewed", async () => {
  renew.mockResolvedValue({ data: false, error: null });
  expect(await renewLease("content-maintenance", "owner-token", 120)).toBe(false);
});
```

Add `tests/api/poll-expiry-registry.test.ts` as a narrow adapter contract. Mock only the lease wrappers and the bounded cleanup runner; do not mock the registry adapter itself:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimLease: vi.fn(),
  renewLease: vi.fn(),
  releaseLease: vi.fn(),
  runPollExpiryMaintenance: vi.fn(),
}));

vi.mock("../../api/_maintenance-lease.js", () => ({
  claimLease: mocks.claimLease,
  renewLease: mocks.renewLease,
  releaseLease: mocks.releaseLease,
}));
vi.mock("../../api/_cleanup.js", () => ({
  runPollExpiryMaintenance: mocks.runPollExpiryMaintenance,
}));

import { runLeasedPollExpiryMaintenance } from "../../api/_poll-expiry-registry.js";

const ownerToken = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimLease.mockResolvedValue(true);
  mocks.renewLease.mockResolvedValue(true);
  mocks.releaseLease.mockResolvedValue(true);
  mocks.runPollExpiryMaintenance.mockResolvedValue({
    ok: true,
    checked: 2,
    notified: 1,
    skipped: 1,
    errors: [],
  });
});

describe("runLeasedPollExpiryMaintenance", () => {
  it("claims the shared lease, renews through the bounded runner, and releases", async () => {
    const result = await runLeasedPollExpiryMaintenance({
      client: {},
      ownerToken,
      deadline: 1234,
      leaseSeconds: 120,
    });
    expect(mocks.claimLease).toHaveBeenCalledWith("poll-expiry", ownerToken, 120);
    expect(mocks.runPollExpiryMaintenance).toHaveBeenCalledWith(
      expect.objectContaining({ client: {}, deadline: 1234, renewLease: expect.any(Function) }),
    );
    await mocks.runPollExpiryMaintenance.mock.calls[0][0].renewLease();
    expect(mocks.renewLease).toHaveBeenCalledWith("poll-expiry", ownerToken, 120);
    expect(mocks.releaseLease).toHaveBeenCalledWith("poll-expiry", ownerToken);
    expect(result).toMatchObject({ ok: true, checked: 2, notified: 1, skipped: 1 });
  });

  it("returns an honest deferred result and does no work when the lease is held", async () => {
    mocks.claimLease.mockResolvedValue(false);
    const result = await runLeasedPollExpiryMaintenance({ client: {}, ownerToken });
    expect(result).toEqual({
      ok: true,
      deferred: true,
      reason: "lease_held",
      checked: 0,
      notified: 0,
      skipped: 0,
      errors: [],
    });
    expect(mocks.runPollExpiryMaintenance).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();
  });

  it("releases only its owner token when the bounded runner throws", async () => {
    mocks.runPollExpiryMaintenance.mockRejectedValue(new Error("poll read failed"));
    await expect(runLeasedPollExpiryMaintenance({ client: {}, ownerToken })).rejects.toThrow(
      "poll read failed",
    );
    expect(mocks.releaseLease).toHaveBeenCalledWith("poll-expiry", ownerToken);
  });

  it("does not replace a completed result with a release error", async () => {
    mocks.releaseLease.mockRejectedValue(new Error("release unavailable"));
    const result = await runLeasedPollExpiryMaintenance({ client: {}, ownerToken });
    expect(result).toMatchObject({ ok: true, notified: 1 });
  });
});
```

In `tests/api/agent-cron-registry.test.ts`, add hoisted lease mocks before importing `agentCron` and mock the same two seams so the registry tick remains deterministic:

```ts
const pollLeaseMocks = vi.hoisted(() => ({
  claimLease: vi.fn(),
  renewLease: vi.fn(),
  releaseLease: vi.fn(),
  runPollExpiryMaintenance: vi.fn(),
}));
vi.mock("../../api/_maintenance-lease.js", () => ({
  claimLease: pollLeaseMocks.claimLease,
  renewLease: pollLeaseMocks.renewLease,
  releaseLease: pollLeaseMocks.releaseLease,
}));
vi.mock("../../api/_cleanup.js", () => ({
  runPollExpiryMaintenance: pollLeaseMocks.runPollExpiryMaintenance,
}));
```

Set the four mocks to successful values in the existing `beforeEach` with these exact lines:

```ts
pollLeaseMocks.claimLease.mockResolvedValue(true);
pollLeaseMocks.renewLease.mockResolvedValue(true);
pollLeaseMocks.releaseLease.mockResolvedValue(true);
pollLeaseMocks.runPollExpiryMaintenance.mockResolvedValue({
  ok: true,
  checked: 0,
  notified: 0,
  skipped: 0,
  errors: [],
});
```

Then add this assertion to the registry contract test:

```ts
it("routes poll-sweep through the shared poll-expiry lease", async () => {
  const entry = WORKERS.find((worker) => worker.id === "poll-sweep");
  expect(entry).toMatchObject({
    module: "./_poll-expiry-registry.js",
    run: "runLeasedPollExpiryMaintenance",
  });
  expect(entry?.module).not.toBe("./_poll-sweeper.js");

  const res = response();
  await agentCron(tick(), res as never);
  const body = res.body as { poll_sweep?: Record<string, unknown> };
  expect(pollLeaseMocks.claimLease).toHaveBeenCalledWith(
    "poll-expiry",
    expect.any(String),
    120,
  );
  expect(pollLeaseMocks.runPollExpiryMaintenance).toHaveBeenCalled();
  expect(body.poll_sweep).toMatchObject({ ok: true, checked: 0, notified: 0, skipped: 0 });
});

it("does not label a poll-expiry lease skip as a tick-budget deferral", async () => {
  const { summarize } = await import("../../api/_automation-registry.js");
  expect(
    summarize("poll-sweep", { ok: true, deferred: true, reason: "lease_held" }),
  ).toBe("deferred — poll-expiry lease held");
});
```

The test must prove both the registry mapping and the real registry loop; a source-string check alone is insufficient. The existing manual `automation-run` path consumes the same `WORKERS` entry, so it inherits this lease without a second sweeper implementation.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm run test:api -- tests/api/read-side-effects.test.ts tests/api/maintenance-lease.test.ts tests/api/poll-expiry-registry.test.ts tests/api/agent-cron-registry.test.ts
```

Expected: FAIL because public reads still write, maintenance is not leased, and the registry still points at the unleased sweeper.

- [ ] **Step 4: Create the lease migration**

Create `api/migrations/028_maintenance_leases.sql`:

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.maintenance_leases (
  job_name text PRIMARY KEY,
  owner_token uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_leases_job_name_check
    CHECK (job_name ~ '^[a-z0-9][a-z0-9_-]{2,63}$')
);

ALTER TABLE public.maintenance_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.maintenance_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_leases TO service_role;
DROP POLICY IF EXISTS maintenance_leases_service_role_all ON public.maintenance_leases;
CREATE POLICY maintenance_leases_service_role_all
  ON public.maintenance_leases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.try_claim_maintenance_lease(
  p_job_name text,
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  IF p_job_name IS NULL
     OR p_owner_token IS NULL
     OR p_lease_seconds IS NULL
     OR p_job_name !~ '^[a-z0-9][a-z0-9_-]{2,63}$'
     OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'invalid maintenance lease request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.maintenance_leases(job_name, owner_token, lease_until, updated_at)
  VALUES (p_job_name, p_owner_token, now() + make_interval(secs => p_lease_seconds), now())
  ON CONFLICT (job_name) DO UPDATE
     SET owner_token = EXCLUDED.owner_token,
         lease_until = EXCLUDED.lease_until,
         updated_at = now()
   WHERE public.maintenance_leases.lease_until <= now()
      OR public.maintenance_leases.owner_token = EXCLUDED.owner_token
  RETURNING true INTO v_claimed;

  RETURN coalesce(v_claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_maintenance_lease(
  p_job_name text,
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_job_name IS NULL
     OR p_owner_token IS NULL
     OR p_lease_seconds IS NULL
     OR p_job_name !~ '^[a-z0-9][a-z0-9_-]{2,63}$'
     OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'invalid maintenance lease request' USING ERRCODE = '22023';
  END IF;

  UPDATE public.maintenance_leases
     SET lease_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   WHERE job_name = p_job_name
     AND owner_token = p_owner_token
     AND lease_until > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_maintenance_lease(
  p_job_name text,
  p_owner_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_job_name IS NULL
     OR p_owner_token IS NULL
     OR p_job_name !~ '^[a-z0-9][a-z0-9_-]{2,63}$' THEN
    RAISE EXCEPTION 'invalid maintenance lease request' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.maintenance_leases
   WHERE job_name = p_job_name
     AND owner_token = p_owner_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.try_claim_maintenance_lease(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_maintenance_lease(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_maintenance_lease(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_maintenance_lease(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_maintenance_lease(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_maintenance_lease(text, uuid) TO service_role;

COMMIT;
```

- [ ] **Step 5: Move deterministic jobs out of request modules**

In `api/_cleanup.js`:

- export the current cleanup body as `runCleanup`;
- add `purgeExpiredPosts(client, now)` with a 50-row batch;
- add `archiveExpiredPolls(client, now)` for unarchived, undeleted polls more than seven days past expiry;
- add `repairOrphanPollLinks(client)` with a 100-row scan and bounded update;
- export `runContentMaintenance({ client, jobName, ownerToken, deadline, renewLease })`; it renews the named lease between stages, treats a `false` renewal as a lost lease and stops before the next stage, and stops before the deadline;
- export `runPollExpiryMaintenance({ client, deadline, renewLease })` as a bounded wrapper around the existing `sweepExpiredPolls(client)` implementation; it stops before the deadline and does not continue after a `false` renewal;
- after any successful post/poll maintenance mutation, invalidate the process-local `feedResponseCache` and `pollResponseCache`; maintenance must not be the only stale-cache invalidation path;
- remove `triggerAutoCleanup` and module-load cleanup invocation.

Create `api/_poll-expiry-registry.js` with this exact zero-argument-compatible adapter. It is the only registry execution path for poll expiry; it does not import or call `sweepExpiredPolls` directly:

```js
import { randomUUID } from "node:crypto";
import supabase from "./_db-client.js";
import { runPollExpiryMaintenance } from "./_cleanup.js";
import { claimLease, releaseLease, renewLease } from "./_maintenance-lease.js";

const POLL_EXPIRY_JOB = "poll-expiry";
const DEFAULT_DEADLINE_MS = 50_000;

export async function runLeasedPollExpiryMaintenance({
  client = supabase,
  deadline = Date.now() + DEFAULT_DEADLINE_MS,
  leaseSeconds = 120,
  ownerToken = randomUUID(),
} = {}) {
  const claimed = await claimLease(POLL_EXPIRY_JOB, ownerToken, leaseSeconds);
  if (!claimed) {
    return {
      ok: true,
      deferred: true,
      reason: "lease_held",
      checked: 0,
      notified: 0,
      skipped: 0,
      errors: [],
    };
  }

  try {
    return await runPollExpiryMaintenance({
      client,
      deadline,
      renewLease: () => renewLease(POLL_EXPIRY_JOB, ownerToken, leaseSeconds),
    });
  } finally {
    try {
      await releaseLease(POLL_EXPIRY_JOB, ownerToken);
    } catch (error) {
      console.error(
        "[poll-expiry-registry] lease release failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
}
```

The `finally` block must swallow only the release error so a completed result is preserved; the underlying runner error still propagates to the existing manual/cron error funnel. A false claim is represented as `{ ok: true, deferred: true, reason: "lease_held", ... }`, so the registry summary remains honest and the manual Run button does not report a second real run.

Change only the `poll-sweep` registry entry in `api/_automation-registry.js` to:

```js
{
  id: "poll-sweep",
  name: "Poll Closer",
  description: "Notifies authors of expired polls nobody opened.",
  module: "./_poll-expiry-registry.js",
  run: "runLeasedPollExpiryMaintenance",
},
```

Keep the existing `poll-sweep` result fields and stable `poll_sweep` response handle, but update the generic deferred summary so a lease-held skip is not mislabeled as a tick-budget deferral:

```js
if (r.deferred) {
  return id === "poll-sweep" && r.reason === "lease_held"
    ? "deferred — poll-expiry lease held"
    : "deferred — tick budget spent";
}
```

The registry’s zero-argument invocation therefore works for both agent-cron and `automation-run`; both use the same `poll-expiry` lease as `/api/maintenance`.

In `api/_posts.js`, delete `purgeExpired` and its GET call.

In `api/_polls.js`, delete GET archive updates and orphan update promises. The aggregate function already shapes an orphan as `post_id: null` without mutation.

In `api/index.js`, remove the `triggerAutoCleanup` import and invocation. Keep the manual `cleanupHandler` reachable; if the static `_cleanup.js` import is removed with the cold-start cleanup, add a lazy `cleanup` entry to Task 8’s `lazyRoutes` before removing it so `/api/cleanup` cannot regress to 404.

- [ ] **Step 6: Create the authenticated maintenance route**

Use these exact lease-wrapper signatures in `api/_maintenance-lease.js` (each calls the corresponding service-role RPC and converts a null/false result to a boolean):

```js
claimLease(jobName, ownerToken, leaseSeconds = 120): Promise<boolean>
renewLease(jobName, ownerToken, leaseSeconds = 120): Promise<boolean>
releaseLease(jobName, ownerToken): Promise<boolean>
runMaintenanceJobs({ ownerToken, deadline, jobs }): Promise<{ ok: boolean; ran: string[]; skipped: string[]; errors: string[]; duration_ms: number }>
```

All three wrappers validate `jobName` against the migration’s `^[a-z0-9][a-z0-9_-]{2,63}$` rule, require a canonical UUID `ownerToken`, and reject invalid `leaseSeconds` before making an RPC call; database errors are logged without credentials and converted to `false` only where the caller can safely treat a lost lease as a skip.

`api/maintenance.js` and the admin `/api/cleanup` handler must both call `runMaintenanceJobs`; neither may call the underlying cleanup stages directly without a lease. `api/maintenance.js` must:

- export `config = { runtime: "nodejs" }`;
- return `405` for methods other than `GET`; the scheduled endpoint is GET-only, while the manual cleanup route remains POST-only;
- use `isCronAuthorized` before any claim and return `401` with `CRON_UNAUTHORIZED_BODY` when it is false;
- use `randomUUID()` as owner token;
- claim `content-maintenance` and `poll-expiry` independently;
- pass the same owner token, wall-clock deadline, and `renewLease` callback into each claimed runner;
- run `runContentMaintenance` and `runPollExpiryMaintenance` only for claimed jobs;
- enforce a 50-second wall-clock deadline;
- release each lease in `finally`; a release RPC error is logged and does not replace the job’s original result, while the lease naturally expires if release is unavailable;
- return honest JSON: `{ ok, ran, skipped, errors, duration_ms }`; a claimed job that throws contributes a stable code (`content-maintenance-failed` or `poll-expiry-failed`) and makes `ok:false`, returns HTTP 500 without leaking the raw exception, while the other claimed job is still released in `finally`;
- never accept an admin/browser GET as an unauthenticated maintenance trigger.

The registry is a separate caller of the same `poll-expiry` lease: its `poll-sweep` entry must invoke `runLeasedPollExpiryMaintenance`, which claims before delegating and releases only its own owner token. No agent-cron/manual path may call `sweepExpiredPolls` directly.

Add this exact Vercel cron entry:

```json
{
  "path": "/api/maintenance",
  "schedule": "*/15 * * * *"
}
```

Keep `/api/cleanup` as an admin-authenticated manual POST only: return `405` for GET/HEAD/other methods before authorization or lease work, and have it call the same leased runner so manual and scheduled maintenance cannot overlap.

- [ ] **Step 7: Add the staging lease verifier**

`scripts/verify-maintenance-lease.mjs` claims the same test-only job name with two UUIDs in `Promise.all`, asserts exactly one `true`, renews with the winner, proves the loser cannot release the winner’s lease, and releases the winner. Wrap all claims/releases and the exact-row cleanup in `try/finally`; use `lease-${Date.now()}` as the job name and delete only that exact row afterward.

- [ ] **Step 8: Apply and verify migration 028 in staging**

```powershell
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL to the approved staging PostgreSQL URL" }
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f api/migrations/028_maintenance_leases.sql
node scripts/verify-maintenance-lease.mjs
```

- [ ] **Step 9: Run focused tests and verify GREEN**

```powershell
npm run test:api -- tests/api/read-side-effects.test.ts tests/api/maintenance-lease.test.ts tests/api/poll-expiry-registry.test.ts tests/api/agent-cron-registry.test.ts tests/api/cleanup-duplicate-reports.test.ts tests/api/poll-sweeper.test.ts
npm run typecheck
npm run lint
```

Expected: PASS; a contended `poll-sweep` invocation reports `lease_held` without touching the sweeper, while the winning invocation runs the bounded expiry runner and releases its own token.

- [ ] **Step 10: Commit the maintenance slice**

```powershell
git add api/migrations/028_maintenance_leases.sql api/_maintenance-lease.js api/_poll-expiry-registry.js api/maintenance.js api/_automation-registry.js api/_cleanup.js api/_posts.js api/_polls.js api/index.js vercel.json scripts/verify-maintenance-lease.mjs tests/api/read-side-effects.test.ts tests/api/maintenance-lease.test.ts tests/api/poll-expiry-registry.test.ts tests/api/agent-cron-registry.test.ts
git commit -m "perf(api): move feed maintenance behind singleton lease"
```

### Task 7: Enforce Streaming Request Limits and Bounded Rate State

**Files:**
- Create: `api/_request-limits.js`
- Create: `api/_gateway.js`
- Create: `tests/api/request-body-limit.test.ts`
- Modify: `api/index.js:119-189,295-370`
- Modify: `api/maintenance.js`
- Modify: `api/_security.js:108-400`
- Modify: `api/_auth.js:37-39,489-516`
- Modify: `api/_upload.js:8`
- Modify: `api/_polls.js:256-340`
- Modify: `api/_reactions.js:60-155`
- Modify: `tests/api/rate-limiter.test.ts`

**Interfaces:**
- Consumes: current `parseBody`, `peekBodyIdentity`, `securityCheck`, global abuse state, and write rate state.
- Produces: `readJsonBody`, `RequestBodyTooLargeError`, `requestBodyLimit`, `extractHeaderIdentity`, `extractIdentity`, `evictBoundedMap`, `consumeBoundedCounter`, `withApiGateway`, measured-byte security checks, and route-class action budgets.

- [ ] **Step 1: Write failing chunked body tests**

Create `tests/api/request-body-limit.test.ts`:

```ts
it("rejects a web stream above the limit without trusting content-length", async () => {
  const req = {
    method: "POST",
    headers: {},
    url: "/api/polls",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(400_000));
        controller.enqueue(new Uint8Array(200_000));
        controller.close();
      },
    }),
  };
  await expect(readJsonBody(req, 500_000)).rejects.toMatchObject({
    status: 413,
    limit: 500_000,
  });
});

it("counts bytes incrementally for a Node stream", async () => {
  const req = {
    method: "POST",
    headers: {},
    url: "/api/posts",
    body: Readable.from([Buffer.alloc(300_000), Buffer.alloc(300_000)]),
  };
  await expect(readJsonBody(req, 500_000)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
});

it("rejects pre-parsed, Buffer, typed-array, ArrayBuffer, and string bodies above the limit", async () => {
  for (const body of [
    { value: "x".repeat(500_001) },
    Buffer.alloc(500_001),
    new Uint8Array(500_001),
    new ArrayBuffer(500_001),
    "x".repeat(500_001),
  ]) {
    await expect(readJsonBody({ method: "POST", headers: {}, body }, 500_000)).rejects.toMatchObject({
      status: 413,
      limit: 500_000,
    });
  }
});

it("enforces the cap even when a GET/HEAD request carries a body", async () => {
  const req = {
    method: "GET",
    headers: {},
    url: "/api/posts",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(500_001));
        controller.close();
      },
    }),
  };
  await expect(readJsonBody(req, 500_000)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
});

it("does not trust identity fields in a GET body", async () => {
  const parsed = await readJsonBody({
    method: "GET",
    headers: { "x-anon-id": "anon_header" },
    body: { author_id: "anon_spoofed" },
  }, 500_000);
  expect(parsed.body).toEqual({});
  expect(parsed.identity).toBe("anon_header");
});

it("uses the larger upload budget only for /api/upload", async () => {
  expect(requestBodyLimit("/api/upload")).toBe(4_500_000);
  expect(requestBodyLimit("/api/polls")).toBe(500_000);
});
```

- [ ] **Step 2: Write failing bounded-counter tests**

Add to `tests/api/rate-limiter.test.ts`:

```ts
it("never exceeds the hard abuse-map cap", () => {
  for (let index = 0; index < 10_050; index += 1) checkAbuse(`203.0.113.${index % 250}:${index}`, `id-${index}`);
  expect(securityRateStateSize()).toBeLessThanOrEqual(10_000);
});

it("expires entries deterministically and preserves the newest window", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T00:00:00Z"));
  expect(consumeBoundedCounter(new Map(), "old", 2, 60_000, Date.now())).toEqual({ allowed: true, count: 1 });
  vi.advanceTimersByTime(60_001);
  expect(consumeBoundedCounter(new Map(), "fresh", 1, 60_000, Date.now())).toEqual({ allowed: true, count: 1 });
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm run test:api -- tests/api/request-body-limit.test.ts tests/api/rate-limiter.test.ts
```

Expected: FAIL because the current parser has no measured boundary and the abuse map has no hard cap.

- [ ] **Step 4: Implement `api/_request-limits.js`**

Use this public interface:

```js
export const DEFAULT_MAX_BODY_BYTES = 500_000;
export const UPLOAD_MAX_BODY_BYTES = 4_500_000;
export const RATE_LIMIT_MAX_ENTRIES = 10_000;

export class RequestBodyTooLargeError extends Error {
  constructor(limit, received) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
    this.status = 413;
    this.limit = limit;
    this.received = received;
  }
}

export function requestBodyLimit(pathname) {
  return pathname === "/api/upload" ? UPLOAD_MAX_BODY_BYTES : DEFAULT_MAX_BODY_BYTES;
}

export function extractHeaderIdentity(req) {
  return String(req.headers?.["x-anon-id"] || "").trim().toLowerCase() || null;
}

export function extractIdentity(req) {
  const header = extractHeaderIdentity(req);
  if (header) return header;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return String(body.anon_id || body.author_id || body.user_id || "").trim().toLowerCase() || null;
}

export function evictBoundedMap(map, now, windowMs, maxEntries) {
  for (const [key, entry] of map) {
    const startedAt = Number(entry.startedAt ?? entry.windowStart ?? 0);
    if (now - startedAt >= windowMs) map.delete(key);
  }
  while (map.size >= maxEntries) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export function consumeBoundedCounter(map, key, limit, windowMs, now = Date.now(), maxEntries = RATE_LIMIT_MAX_ENTRIES) {
  const current = map.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    const next = { count: 1, startedAt: now };
    evictBoundedMap(map, now, windowMs, maxEntries);
    map.set(key, next);
    return { allowed: true, count: 1 };
  }
  current.count += 1;
  return { allowed: current.count <= limit, count: current.count };
}

function parseBodyBytes(bytes) {
  const raw = bytes.toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return Object.fromEntries(new URLSearchParams(raw));
    } catch {
      return {};
    }
  }
}

export async function readJsonBody(req, limit) {
  const methodWithoutBody = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  const declared = Number.parseInt(req.headers?.["content-length"] || "0", 10);
  const current = req.body;
  if (methodWithoutBody && current == null && !(Number.isFinite(declared) && declared > 0)) {
    return { body: {}, bytes: 0, identity: extractHeaderIdentity(req) };
  }
  if (Number.isFinite(declared) && declared > limit) {
    throw new RequestBodyTooLargeError(limit, declared);
  }
  if (
    current &&
    typeof current === "object" &&
    !Buffer.isBuffer(current) &&
    !ArrayBuffer.isView(current) &&
    !(current instanceof ArrayBuffer) &&
    typeof current.getReader !== "function" &&
    typeof current.pipe !== "function" &&
    typeof current[Symbol.asyncIterator] !== "function"
  ) {
    const bytes = Buffer.byteLength(JSON.stringify(current), "utf8");
    if (bytes > limit) throw new RequestBodyTooLargeError(limit, bytes);
    if (methodWithoutBody) {
      req.body = {};
      return { body: {}, bytes, identity: extractHeaderIdentity(req) };
    }
    req.body = current;
    return { body: current, bytes, identity: extractIdentity(req) };
  }

  let buffer;
  if (Buffer.isBuffer(current)) {
    buffer = current;
  } else if (ArrayBuffer.isView(current)) {
    buffer = Buffer.from(current.buffer, current.byteOffset, current.byteLength);
  } else if (current instanceof ArrayBuffer) {
    buffer = Buffer.from(current);
  } else if (typeof current === "string") {
    buffer = Buffer.from(current, "utf8");
  } else if (current && typeof current.getReader === "function") {
    const reader = current.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        bytes += chunk.length;
        if (bytes > limit) {
          await reader.cancel("request body too large");
          throw new RequestBodyTooLargeError(limit, bytes);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    buffer = Buffer.concat(chunks, bytes);
  } else if (current && (typeof current.pipe === "function" || typeof current[Symbol.asyncIterator] === "function")) {
    const chunks = [];
    let bytes = 0;
    for await (const value of current) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > limit) {
        current.destroy?.();
        throw new RequestBodyTooLargeError(limit, bytes);
      }
      chunks.push(chunk);
    }
    buffer = Buffer.concat(chunks, bytes);
  } else {
    buffer = Buffer.alloc(0);
  }

  const bytes = buffer.length;
  if (bytes > limit) throw new RequestBodyTooLargeError(limit, bytes);
  req.body = parseBodyBytes(buffer);
  if (methodWithoutBody) {
    req.body = {};
    return { body: {}, bytes, identity: extractHeaderIdentity(req) };
  }
  return { body: req.body, bytes, identity: extractIdentity(req) };
}
```

The implementation enforces the limit before concatenation, parses JSON first and URL-encoded form second, and returns the measured byte count and identity.

- [ ] **Step 5: Extract the common gateway**

Move query normalization, security headers, request ID, `readJsonBody`, `securityCheck`, CORS, completion timing, and `Server-Timing: app;dur=<ms>` from `api/index.js` into `withApiGateway(handler, routeName)`.

Change the security helper signatures to accept measured bytes and the route-selected maximum. Remove `api/_upload.js`’s lower `config.api.bodyParser.sizeLimit` (or raise it above 4,500,000) so the shared incremental reader, not a framework parser, is the single upload boundary; retain the decoded-image check in the upload handler.

```js
export function validateRequestSize(req, measuredBytes = 0, maxBytes = ABUSE_LIMITS.maxRequestSize) {
  const declared = Number.parseInt(req.headers?.["content-length"] || "0", 10);
  const bytes = Math.max(Number.isFinite(declared) ? declared : 0, measuredBytes);
  if (bytes > maxBytes) {
    return { valid: false, error: `Request too large (${bytes} bytes, max ${maxBytes})` };
  }
  return { valid: true, bytes };
}

export function securityCheck(req, identity = null, measuredBytes = 0, maxBytes = ABUSE_LIMITS.maxRequestSize) {
  const abuseCheck = checkAbuse(req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown", identity);
  if (!abuseCheck.allowed) {
    return { ok: false, status: 429, error: abuseCheck.reason, retryAfter: abuseCheck.retryAfter };
  }
  const sizeCheck = validateRequestSize(req, measuredBytes, maxBytes);
  if (!sizeCheck.valid) return { ok: false, status: 413, error: sizeCheck.error };
  return { ok: true, bytes: sizeCheck.bytes };
}
```

Use this gateway shape:

```js
import { cors } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import { generateRequestId, logger } from "./_observability.js";
import { readJsonBody, requestBodyLimit } from "./_request-limits.js";
import { securityCheck, setSecurityHeaders } from "./_security.js";
import { recordRequest } from "./v3/_monitoring.js";

export function withApiGateway(handler, routeName) {
  return async function apiGateway(req, res) {
    const pathname = String(req.url || "/").split("?")[0];
    if (!req.query) {
      const url = new URL(req.url || "/", "http://localhost");
      const query = {};
      for (const key of url.searchParams.keys()) {
        const values = url.searchParams.getAll(key);
        query[key] = values.length > 1 ? values : values[0];
      }
      req.query = query;
    }
    const requestId = generateRequestId();
    req.requestId = requestId;
    req.headers = req.headers || {};
    req.headers["x-request-id"] = requestId;
    setSecurityHeaders(res);
    cors(res, req);
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const declaredOptionBytes = Number.parseInt(req.headers["content-length"] || "0", 10);
    if (
      req.method === "OPTIONS" &&
      !req.body &&
      !(Number.isFinite(declaredOptionBytes) && declaredOptionBytes > 0)
    ) return res.status(204).end();

    try {
      const maxBytes = requestBodyLimit(pathname);
      const parsed = await readJsonBody(req, maxBytes);
      req.body = parsed.body;
      const check = securityCheck(req, parsed.identity, parsed.bytes, maxBytes);
      if (!check.ok) {
        res.setHeader("Cache-Control", "no-store");
        if (check.retryAfter) res.setHeader("Retry-After", String(check.retryAfter));
        return res.status(check.status).json({ error: check.error, requestId });
      }
    } catch (error) {
      if (error?.status === 413) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(413).json({ error: error.message, requestId });
      }
      if (error?.status === 503) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(503).json({ error: "Read capacity temporarily unavailable", code: "READ_CAPACITY_EXCEEDED", requestId });
      }
      return sanitizeError(res, error, routeName);
    }

    const start = Date.now();
    const originalEnd = res.end;
    res.end = function timedEnd(...args) {
      const duration = Date.now() - start;
      res.setHeader("Server-Timing", `app;dur=${duration}`);
      recordRequest(duration, res.statusCode, routeName);
      logger.info(routeName, `${req.method} ${pathname} ${res.statusCode}`, {
        request_id: requestId,
        route: routeName,
        method: req.method,
        status: res.statusCode,
        duration_ms: duration,
        cache_status: res.getHeader?.("X-Cache-Status") || "BYPASS",
      });
      return originalEnd.apply(this, args);
    };
    try {
      const result = await handler(req, res);
      if (result === undefined && !res.writableEnded) return res.status(200).json({ ok: true });
      return result;
    } catch (error) {
      if (res.writableEnded) return;
      if (error?.status === 503) {
        res.setHeader("Cache-Control", "no-store");
        return res.status(503).json({ error: "Read capacity temporarily unavailable", code: "READ_CAPACITY_EXCEEDED", requestId });
      }
      return sanitizeError(res, error, routeName);
    }
  };
}
```

`api/maintenance.js` must import `withApiGateway`, export the raw function as named `maintenanceHandler` for unit tests, and export `withApiGateway(maintenanceHandler, "maintenance")` as its default after the raw handler is defined; keep its `config` and cron authorization/method checks inside the raw handler, and do not add a second `protect` wrapper. This makes the maintenance activation safe even if the later hot-route extraction is reverted.

Keep `cleanupMetrics()` and `cleanupCache()` process-local cleanup calls in the consolidated entry if needed, but do not call any database maintenance from module load.

Order must be:

```text
normalize route/query
→ set security/request/JSON headers
→ answer bodyless OPTIONS with 204
→ read bounded body and identity
→ 413 immediately on overflow
→ 429/413 from securityCheck
→ invoke protected route handler
→ close an omitted response as `{ ok: true }`
→ record normalized route/status/duration/cache status
```

Do not log raw query strings, bodies, or cache keys. The response-end hook may call only process-local counters/loggers; it must not call a Supabase-backed feature-health writer, durable telemetry flush, or any other database mutation on a public GET/HEAD.

- [ ] **Step 6: Bound global and write counters**

Keep `_abuseTracker`’s existing minute/hour/error/blocked decision fields, but bound the map before creating a new abuse key and filter its timestamp/error arrays to the one-hour window. Use `consumeBoundedCounter` for the separate simple request/write/action counters; do not replace the tracker’s sliding-window fields with a count-only shape. Use this bounded-map helper before creating a new abuse key:

```js
import { evictBoundedMap, RATE_LIMIT_MAX_ENTRIES } from "./_request-limits.js";

function boundAbuseMap(now) {
  evictBoundedMap(_abuseTracker, now, 3_600_000, RATE_LIMIT_MAX_ENTRIES);
}
```

Call `boundAbuseMap(now)` before `_abuseTracker.set`, and after every mutation filter each entry’s `timestamps` and `errors` arrays to the one-hour window. `consumeBoundedCounter` remains the shared primitive for the simple request, write, and action counters. Export this exact test-only accessor:

```js
export function securityRateStateSize() {
  return _abuseTracker.size;
}
```

For `_auth.js` `rateLimited`, import `evictBoundedMap` and `RATE_LIMIT_MAX_ENTRIES` from `./_request-limits.js`; keep the existing database count on a cold window, but before `_rateLimitState.set` call the shared helper with the current window and cap. The helper accepts both `startedAt` and `windowStart`; when the map is full, remove expired entries first and then the oldest insertion-order key until one slot remains. A denied request increments the in-memory count but never runs the database count query. Export and use this exact test reset:

```js
export function resetRateLimitStateForTests() {
  _rateLimitState.clear();
}
```

Add per-action warm-instance budgets before the corresponding database write:

```js
const _pollActionBudget = new Map();
const _reactionActionBudget = new Map();

const pollAttempt = consumeBoundedCounter(
  _pollActionBudget,
  author_id,
  10,
  60_000,
);
if (!pollAttempt.allowed) return rateLimitResponse(res, 60, "Please wait before voting again.");

const reactionAttempt = consumeBoundedCounter(
  _reactionActionBudget,
  author_id,
  30,
  60_000,
);
if (!reactionAttempt.allowed) return rateLimitResponse(res, 60, "Please wait before trying another reaction.");
```

Export `resetActionBudgetsForTests()` to clear both maps, and assert in `tests/api/rate-limiter.test.ts` that the 11th poll vote and 31st reaction toggle receive the existing bounded 429 contract. These are explicitly per-instance complements, not global quotas.

- [ ] **Step 7: Add coarse Vercel Firewall rules in staging**

Run against the approved staging project only:

```powershell
vercel firewall rules add "API read flood baseline" --condition '{"type":"path","op":"pre","value":"/api/"}' --condition '{"type":"method","op":"eq","value":"GET"}' --action rate_limit --rate-limit-algo fixed_window --rate-limit-requests 600 --rate-limit-window 60 --rate-limit-keys ip --yes

vercel firewall rules add "Poll write flood baseline" --condition '{"type":"path","op":"eq","value":"/api/polls"}' --condition '{"type":"method","op":"eq","value":"POST"}' --action rate_limit --rate-limit-algo fixed_window --rate-limit-requests 120 --rate-limit-window 60 --rate-limit-keys ip --yes

vercel firewall diff
```

Do not run `vercel firewall publish` without explicit approval. Do not use the client-controlled `x-anon-id` header as a supposedly unforgeable global rate-limit key. Add a Supabase-backed exact global counter only if a later measured endpoint still requires one.

- [ ] **Step 8: Run focused tests and verify GREEN**

```powershell
npm run test:api -- tests/api/request-body-limit.test.ts tests/api/rate-limiter.test.ts tests/api/polls-read-rpc.test.ts tests/api/posts-feed-rpc.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 9: Commit source and tests; do not pretend Firewall state is in Git**

```powershell
git add api/_request-limits.js api/_gateway.js api/index.js api/maintenance.js api/_security.js api/_auth.js api/_upload.js api/_polls.js api/_reactions.js tests/api/request-body-limit.test.ts tests/api/rate-limiter.test.ts
git commit -m "fix(api): enforce streamed request and memory bounds"
```

### Task 8: Extract Proven Hot Routes Without Duplicating Gateway Logic

**Files:**
- Create: `api/posts.js`
- Create: `api/polls.js`
- Create: `tests/api/hot-route-entrypoints.test.ts`
- Modify: `api/index.js:76-77,198-293`
- Modify: `vercel.json:51-55`

**Interfaces:**
- Consumes: shared gateway from Task 7 and read modules from Task 4.
- Produces: independently bundled `/api/posts` and `/api/polls` Vercel functions while preserving the consolidated rewrite as fallback.

- [ ] **Step 1: Write failing route-entry tests**

Create `tests/api/hot-route-entrypoints.test.ts`:

```ts
import { readFileSync } from "node:fs";

it("keeps filesystem hot routes and the consolidated fallback", () => {
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  expect(vercel.rewrites).toContainEqual({ source: "/api/(.*)", destination: "/api/index.js" });
  expect(vercel.functions["api/posts.js"].maxDuration).toBe(10);
  expect(vercel.functions["api/polls.js"].maxDuration).toBe(10);
  expect(vercel.functions["api/maintenance.js"].maxDuration).toBe(60);
  expect(vercel.crons).toContainEqual({ path: "/api/maintenance", schedule: "*/15 * * * *" });
});

it("removes static hot-route imports from the consolidated fallback", () => {
  const indexSource = readFileSync(new URL("../../api/index.js", import.meta.url), "utf8");
  expect(indexSource).not.toMatch(/import\s+\w+\s+from\s+["']\.\/_posts\.js["']/);
  expect(indexSource).not.toMatch(/import\s+\w+\s+from\s+["']\.\/_polls\.js["']/);
  expect(indexSource).not.toContain("triggerAutoCleanup");
});

it("uses the same gateway in all extracted route entries", async () => {
  const postsSource = readFileSync(new URL("../../api/posts.js", import.meta.url), "utf8");
  const pollsSource = readFileSync(new URL("../../api/polls.js", import.meta.url), "utf8");
  const maintenanceSource = readFileSync(new URL("../../api/maintenance.js", import.meta.url), "utf8");
  expect(postsSource).toContain('from "./_gateway.js"');
  expect(pollsSource).toContain('from "./_gateway.js"');
  expect(maintenanceSource).toContain('from "./_gateway.js"');
  expect(postsSource).not.toContain('from "./_production-error.js"');
  expect(pollsSource).not.toContain('from "./_production-error.js"');
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm run test:api -- tests/api/hot-route-entrypoints.test.ts
```

Expected: FAIL because the route entries do not exist.

- [ ] **Step 3: Create the route entries**

`api/posts.js`:

```js
import { withApiGateway } from "./_gateway.js";
import { handlePaginatedPostsGet } from "./_posts-read.js";

export const config = { runtime: "nodejs" };

const route = async (req, res) => {
  const query = req.query || {};
  const isBoundedFeed =
    (req.method === "GET" || req.method === "HEAD") &&
    (query.paginate === "1" || query.paginate === "true") &&
    !query.id &&
    !query.ids &&
    !query.author &&
    query.all !== "1";
  if (isBoundedFeed) return handlePaginatedPostsGet(req, res);
  const module = await import("./_posts.js");
  return module.default(req, res);
};

export default withApiGateway(route, "posts");
```

`api/polls.js`:

```js
import { withApiGateway } from "./_gateway.js";
import { handlePollsRead } from "./_polls-read.js";

export const config = { runtime: "nodejs" };

const route = async (req, res) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return handlePollsRead(req, res);
  }
  const module = await import("./_polls.js");
  return module.default(req, res);
};

export default withApiGateway(route, "polls");
```

The compatibility branches are explicit in the wrapper: only the bounded public feed avoids `_posts.js`; direct-by-id, ids, author, non-paginated, and all write methods dynamically load the legacy module.

- [ ] **Step 4: Remove static hot imports from the consolidated entry**

Delete static `posts` and `polls` imports. Refactor the consolidated dispatcher so its final export is `withApiGateway(dispatch, "api")`, change the `routes` map entries to raw handlers rather than `protect(...)` wrappers, and let the one gateway perform the outer CORS, body-limit, error, timing, and logging work. Add a small lazy fallback loader:

```js
const lazyHandlers = new Map();
const lazyRoutes = {
  posts: () => import("./_posts.js").then((module) => module.default),
  polls: () => import("./_polls.js").then((module) => module.default),
  cleanup: () => import("./_cleanup.js").then((module) => module.cleanupHandler),
};

async function resolveRouteHandler(endpoint) {
  if (routes[endpoint]) return routes[endpoint];
  const loader = lazyRoutes[endpoint];
  if (!loader) return null;
  if (!lazyHandlers.has(endpoint)) {
    lazyHandlers.set(endpoint, loader());
  }
  return lazyHandlers.get(endpoint);
}
```

Before appending the export, remove the dispatch-local `setSecurityHeaders`, `cors`, request-ID generation, identity peek, `securityCheck`, body parsing, and response-end timing wrapper; those responsibilities now live only in `withApiGateway`. Keep route lookup, debug gating, 404 handling, and feature-event process-local recording in `dispatch`. Rename the existing consolidated `handler` function to `dispatch` and append this exact export after the dispatch body:

```js
export default withApiGateway(dispatch, "api");
```

The filesystem entries take precedence over the existing rewrite; the lazy map is a fallback for `/api/index` and local API development. The shared gateway is the sole outer error/CORS/observability wrapper for both extracted entries; do not wrap them in `protect` a second time.

- [ ] **Step 5: Configure extracted functions**

Add:

```json
"api/posts.js": { "maxDuration": 10 },
"api/polls.js": { "maxDuration": 10 },
"api/maintenance.js": { "maxDuration": 60 }
```

Keep `api/index.js.maxDuration = 60`.

- [ ] **Step 6: Build and run focused/full regression gates**

```powershell
npm run test:api -- tests/api/hot-route-entrypoints.test.ts tests/api/posts-feed-rpc.test.ts tests/api/polls-read-rpc.test.ts
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run build
npx vercel build --yes
```

Expected: Vercel build emits separate `api/posts` and `api/polls` functions and the SPA/API rewrites validate.

- [ ] **Step 7: Measure before keeping route extraction**

On two fresh staging deployments, wait at least five minutes, then issue 30 read-only requests to each route on both the preserved pre-extraction deployment and the candidate deployment. Record the first sample separately as cold, use samples 2–30 for warm p50/p95, record HTTP status, response bytes, and `X-Cache-Status`, and measure the built function package sizes from the corresponding preserved and candidate builds. Use HTTPS URLs, curl with header-write-out support, and the exact environment-based command:

```powershell
if (-not $env:VOICE_BOX_HOT_ROUTE_BASELINE_URL) { throw "Set VOICE_BOX_HOT_ROUTE_BASELINE_URL to the preserved pre-extraction HTTPS deployment" }
if (-not $env:VOICE_BOX_HOT_ROUTE_CANDIDATE_URL) { throw "Set VOICE_BOX_HOT_ROUTE_CANDIDATE_URL to the candidate HTTPS deployment" }
$routes = @(
  "/api/posts?paginate=1&limit=20&type=problem",
  "/api/polls?limit=100"
)
$urls = @{
  baseline = $env:VOICE_BOX_HOT_ROUTE_BASELINE_URL.TrimEnd("/")
  candidate = $env:VOICE_BOX_HOT_ROUTE_CANDIDATE_URL.TrimEnd("/")
}
$results = foreach ($label in $urls.Keys) {
  foreach ($route in $routes) {
    $samples = 1..30 | ForEach-Object {
      $raw = curl.exe --silent --show-error --connect-timeout 10 --max-time 20 --output NUL `
        --write-out "%{http_code}|%{time_total}|%{size_download}|%header{x-cache-status}" `
        "$($urls[$label])$route"
      $parts = $raw -split "\|", 4
      [pscustomobject]@{
        status = [int]$parts[0]
        seconds = [double]$parts[1]
        bytes = [int64]$parts[2]
        cache_status = if ($parts.Count -ge 4) { $parts[3] } else { "" }
      }
    }
    $warm = @($samples | Select-Object -Skip 1 | Sort-Object seconds | Select-Object -ExpandProperty seconds)
    $p50 = $warm[[Math]::Ceiling(0.50 * $warm.Count) - 1]
    $p95 = $warm[[Math]::Ceiling(0.95 * $warm.Count) - 1]
    [pscustomobject]@{
      deployment = $label
      route = $route
      cold_seconds = $samples[0].seconds
      cold_bytes = $samples[0].bytes
      warm_p50_seconds = $p50
      warm_p95_seconds = $p95
      warm_bytes_max = ($samples | Select-Object -Skip 1 | Measure-Object bytes -Maximum).Maximum
      cache_statuses = (($samples | Select-Object -Skip 1 | Select-Object -ExpandProperty cache_status | Sort-Object -Unique) -join ",")
      errors = @($samples | Where-Object status -ge 400).Count
    }
  }
}
$results | Format-Table -AutoSize
```

After `npx vercel build --yes`, measure both extracted functions in the preserved and candidate builds:

```powershell
$functionPaths = @{
  baseline_posts = $env:VOICE_BOX_BASELINE_POSTS_FUNCTION_PATH
  candidate_posts = $env:VOICE_BOX_CANDIDATE_POSTS_FUNCTION_PATH
  baseline_polls = $env:VOICE_BOX_BASELINE_POLLS_FUNCTION_PATH
  candidate_polls = $env:VOICE_BOX_CANDIDATE_POLLS_FUNCTION_PATH
}
if (@($functionPaths.Values | Where-Object { -not $_ }).Count -gt 0) { throw "Set all four VOICE_BOX_*_FUNCTION_PATH variables to preserved/candidate function directories" }
function Get-FunctionBytes([string]$path) {
  if (-not (Test-Path $path)) { throw "Missing function output: $path" }
  [int64](Get-ChildItem -LiteralPath $path -Recurse -File | Measure-Object Length -Sum).Sum
}
$functionPaths.GetEnumerator() | ForEach-Object {
  [pscustomobject]@{ function = $_.Key; bytes = Get-FunctionBytes $_.Value }
} | Format-Table -AutoSize
```

Run the bundle-size command once in a preserved baseline checkout and once in the candidate checkout; do not compare values read from the same directory. Repeat the timing script twice per deployment and use the worse p95 for the keep/revert decision.

Keep the extraction only if either:

- `candidate_worst_warm_p95 <= baseline_best_warm_p95 * 0.80` (at least 20% faster than even the baseline’s better run, so the result survives the two-run variance), or
- the hot function package/import graph is at least 30% smaller and `candidate_worst_warm_p95 <= baseline_best_warm_p95 * 1.10`.

If neither gate passes, revert only Task 8’s posts/polls extraction files and their function-config hunks, while preserving Task 6’s maintenance function and cron entries; record the neutral result. Do not keep operational complexity for noise.

- [ ] **Step 8: Commit only a passing extraction**

```powershell
git add api/posts.js api/polls.js api/index.js vercel.json tests/api/hot-route-entrypoints.test.ts
git commit -m "perf(api): isolate feed and poll functions"
```

### Task 9: Add Indexes Only When Live Exact Plans Prove Value

**Files:**
- Conditionally create: `api/migrations/029_polls_post_id_idx.sql`
- Conditionally create: `api/migrations/030_poll_votes_author_poll_idx.sql`
- Conditionally create: `api/migrations/031_posts_problem_feed_cursor_idx.sql`
- Create: `docs/performance/evidence/2026-09-24-feed-api-database-scaling.md`
- Create: `scripts/feed-index-write.sql`
- Create: `scripts/poll-index-write.sql`
- Create: `scripts/poll-vote-index-write.sql`

**Interfaces:**
- Consumes: deployed aggregate RPCs, live table statistics, exact query plans, and staging write benchmarks.
- Produces: zero to three one-statement concurrent index migrations, each with a measured reason and rollback; no other indexes.

- [ ] **Step 1: Capture the live index catalog**

Run read-only catalog inspection against staging first and production only with explicit read approval:

```sql
SELECT n.nspname AS schema_name,
       t.relname AS table_name,
       i.relname AS index_name,
       pg_get_indexdef(x.indexrelid) AS definition,
       x.indisvalid,
       x.indisready
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class t ON t.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public'
   AND t.relname IN ('posts', 'polls', 'poll_votes', 'reactions', 'comments')
 ORDER BY t.relname, i.relname;
```

Record existing definitions. An index name match with a different definition is drift and blocks this task until reconciled.

- [ ] **Step 2: Capture table selectivity and sizes**

```sql
SELECT relname,
       n_live_tup,
       n_dead_tup,
       last_analyze,
       last_autoanalyze,
       pg_size_pretty(pg_relation_size(relid)) AS heap_size,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
  FROM pg_stat_user_tables
 WHERE relname IN ('posts', 'polls', 'poll_votes', 'reactions', 'comments')
 ORDER BY relname;
```

Record the fraction of rows satisfying the public feed predicate, linked-poll rows per post, and poll-vote rows per poll.

- [ ] **Step 3: Capture exact before plans with bounded runtime**

Use `SET LOCAL statement_timeout = '5s'` in a read-only transaction and run each query five times after one warm-up. Preserve the full `FORMAT JSON` output.

Poll-link plan:

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON)
SELECT parent.id,
       linked_poll.id,
       linked_poll.post_id,
       linked_poll.created_at
  FROM public.posts parent
  LEFT JOIN LATERAL (
    SELECT poll_row.id, poll_row.post_id, poll_row.created_at
      FROM public.polls poll_row
     WHERE poll_row.post_id = parent.id
       AND poll_row.deleted = false
       AND NOT coalesce(public.is_test_artifact_text(poll_row.title), false)
     ORDER BY coalesce(poll_row.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC, poll_row.id DESC
     LIMIT 1
  ) linked_poll ON true
 WHERE parent.type = 'problem'
   AND parent.deleted = false
   AND parent.hidden = false
   AND parent.status <> 'pending_review'
   AND coalesce(parent.visibility, 'public') = 'public'
   AND NOT coalesce(public.is_test_artifact_text(parent.title), false)
 ORDER BY coalesce(parent.pinned, false) DESC,
          coalesce(parent.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC,
          parent.id DESC
 LIMIT 21;
```

Viewer-vote plan:

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON)
WITH sample_author AS (
  SELECT author_id,
         (array_agg(poll_id ORDER BY poll_id))[1:2] AS poll_ids
    FROM public.poll_votes
   WHERE author_id IS NOT NULL
   GROUP BY author_id
  HAVING count(*) >= 2
  ORDER BY count(*) DESC, author_id
  LIMIT 1
)
SELECT pv.poll_id, pv.choices
  FROM sample_author sample
  JOIN public.poll_votes pv
    ON pv.author_id = sample.author_id
   AND pv.poll_id = ANY(sample.poll_ids)
 ORDER BY pv.poll_id;
```

Home cursor plan (run all statements in one read-only `psql` session):

```sql
BEGIN;
SET LOCAL statement_timeout = '5s';

SELECT coalesce(pinned, false) AS cursor_pinned,
       coalesce(created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS cursor_created_at,
       id AS cursor_id
  FROM public.posts
 WHERE type = 'problem'
   AND deleted = false
   AND hidden = false
   AND status <> 'pending_review'
   AND coalesce(visibility, 'public') = 'public'
   AND NOT coalesce(public.is_test_artifact_text(title), false)
 ORDER BY coalesce(pinned, false) DESC,
          coalesce(created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC,
          id DESC
 OFFSET 19
 LIMIT 1
\gset

EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON)
SELECT p.id, p.pinned, p.created_at
  FROM public.posts p
 WHERE p.type = 'problem'
   AND p.deleted = false
   AND p.hidden = false
   AND p.status <> 'pending_review'
   AND coalesce(p.visibility, 'public') = 'public'
   AND NOT coalesce(public.is_test_artifact_text(p.title), false)
   AND (coalesce(p.pinned, false),
        coalesce(p.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
        p.id)
       < (:'cursor_pinned'::boolean,
           :'cursor_created_at'::timestamptz,
           :'cursor_id')
 ORDER BY coalesce(p.pinned, false) DESC,
          coalesce(p.created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') DESC,
          p.id DESC
 LIMIT 21;
ROLLBACK;
```

Use real existing staging rows: the viewer-vote query must find a staging author with at least two votes, and the Home `\gset` query must resolve the 20th eligible row into `cursor_pinned`, `cursor_created_at`, and `cursor_id`. If either sample is empty, stop the candidate gate rather than reporting a fabricated empty plan. Do not report a plan taken with fabricated empty parameters. The Home `EXPLAIN` uses the deployed function’s tuple boundary and `LIMIT 21` sentinel with real constants; it is not a `row_number()` approximation.

Create three rollback-only staging write probes, one for each candidate table. The probe must exercise both an insert and an update in the same transaction so the measured write amplification matches the application path; do not measure a posts-only probe for a polls or poll_votes index.

`scripts/feed-index-write.sql`:

```sql
\set suffix random(1, 999999999)
BEGIN;
INSERT INTO public.posts (
  id, type, title, description, category, priority, author_id, status,
  progress, deleted, hidden, pinned, featured, locked, visibility
) VALUES (
  'perf_:suffix', 'problem', 'Feed index write probe',
  'Disposable staging transaction for index write-cost measurement.',
  'Other', 'medium', 'anon_index_probe', 'reported', 0,
  false, false, false, false, false, 'public'
);
UPDATE public.posts
   SET updated_at = clock_timestamp()
 WHERE id = 'perf_:suffix';
ROLLBACK;
```

`scripts/poll-index-write.sql`:

```sql
\set suffix random(1, 999999999)
BEGIN;
INSERT INTO public.polls (
  id, post_id, title, ptype, options, author_id, expires_at,
  archived, deleted, created_at
) VALUES (
  'perf_poll_:suffix', 'perf_missing_post_:suffix', 'Poll index write probe', 'yesno',
  '["Yes", "No"]'::jsonb, 'anon_index_probe', now() + interval '1 day',
  false, false, now()
);
UPDATE public.polls
   SET archived = NOT archived
 WHERE id = 'perf_poll_:suffix';
ROLLBACK;
```

`scripts/poll-vote-index-write.sql`:

```sql
\set suffix random(1, 999999999)
BEGIN;
INSERT INTO public.poll_votes (id, poll_id, author_id, choices)
VALUES (
  9000000000000000000::bigint + :suffix,
  'perf_missing_poll_:suffix',
  'anon_index_probe',
  '[0]'::jsonb
);
UPDATE public.poll_votes
   SET choices = '[1]'::jsonb
 WHERE id = 9000000000000000000::bigint + :suffix;
ROLLBACK;
```

Run the probe for the candidate’s affected table before and after the candidate with the same connection settings:

```powershell
if (-not $env:DATABASE_URL) { throw "Set DATABASE_URL to the approved staging PostgreSQL URL" }

function Get-PgbenchP95Ms([string]$Prefix) {
  $parent = Split-Path -Parent $Prefix
  $leaf = Split-Path -Leaf $Prefix
  $files = @(Get-ChildItem -LiteralPath $parent -Filter "$leaf.*" -File)
  if ($files.Count -eq 0) { throw "pgbench produced no transaction log for $Prefix" }
  $samples = @(
    foreach ($file in $files) {
      foreach ($line in Get-Content -LiteralPath $file.FullName) {
        if ($line -match '^\d+\s+\d+\s+([0-9]+(?:\.[0-9]+)?)') {
          [double]$Matches[1] / 1000
        } elseif ($line -match '\s(?:failed|deadlock|serialization)\s') {
          throw "pgbench reported a failed transaction in $Prefix"
        }
      }
    }
  ) | Sort-Object
  if ($samples.Count -eq 0) { throw "pgbench log has no numeric samples for $Prefix" }
  $index = [Math]::Ceiling(0.95 * $samples.Count) - 1
  return [pscustomobject]@{ p95_ms = [double]$samples[$index]; samples = $samples.Count }
}

function Invoke-PgbenchProbe([string]$Table, [string]$Script, [string]$Phase) {
  $prefix = Join-Path $env:TEMP ("voice-box-{0}-{1}-{2}" -f $Table, $Phase, [guid]::NewGuid().ToString("N"))
  & pgbench --random-seed=424242 $env:DATABASE_URL --no-vacuum --client=1 --jobs=1 --transactions=1000 --log --log-prefix $prefix --file $Script | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "pgbench failed for $Table ($Phase)" }
  $measurement = Get-PgbenchP95Ms $prefix
  Write-Host "$Phase $Table p95_ms=$($measurement.p95_ms) samples=$($measurement.samples)"
  Get-ChildItem -LiteralPath (Split-Path -Parent $prefix) -Filter "$(Split-Path -Leaf $prefix).*" -File | Remove-Item
  return $measurement
}

$probes = @{
  posts = "scripts/feed-index-write.sql"
  polls = "scripts/poll-index-write.sql"
  poll_votes = "scripts/poll-vote-index-write.sql"
}
$before = @{}
foreach ($table in @("posts", "polls", "poll_votes")) {
  $before[$table] = Invoke-PgbenchProbe $table $probes[$table] "before"
}
$before | ConvertTo-Json | Write-Output
```

Run `Invoke-PgbenchProbe` again with the same table/script and phase `after` after each selected candidate. The helper computes p95 from pgbench’s per-transaction log rather than treating its average as p95; preserve the JSON output and the corresponding log sample count in the evidence file. Do not attribute a posts probe result to a polls or poll_votes candidate. Each script rolls back its probe row, so no synthetic content persists.

Repeat the same three commands after each selected index, record the table-specific p95, and do not attribute a posts probe result to a polls or poll_votes candidate. Each script rolls back its probe row, so no synthetic content persists.

- [ ] **Step 4: Apply the index acceptance gate**

A candidate is eligible only when all are true:

- the exact before plan shows a Seq Scan, large rows-removed count, repeated nested-loop work, or external sort for the targeted predicate/order;
- median exact execution time is above 50 ms or the plan reads at least 10 times more shared buffers than returned rows;
- an index-only or index-assisted plan is plausible for the same query without disabling sequential scans;
- projected index size is below 25% of its table’s total size;
- a staging benchmark of 1,000 representative inserts/updates on the candidate’s affected table shows p95 write regression no greater than 20%;
- the after plan uses the candidate and improves median execution time by at least 30% or lowers targeted buffers by at least 50%;
- no 30-second window or error-rate acceptance target worsens.

If a candidate fails any line, do not retain or apply its migration. When the size or after-plan gate can only be measured after creation, create the index ephemerally in approved staging, measure it, then drop it with the recorded concurrent recovery statement; leave no failed migration file. Record the failed gate and measured reason.

- [ ] **Step 5: Create only passing one-statement migrations**

`029_polls_post_id_idx.sql`:

```sql
CREATE INDEX CONCURRENTLY polls_post_id_idx
  ON public.polls (post_id);
```

`030_poll_votes_author_poll_idx.sql`:

```sql
CREATE INDEX CONCURRENTLY poll_votes_author_poll_idx
  ON public.poll_votes (author_id, poll_id);
```

`031_posts_problem_feed_cursor_idx.sql`:

```sql
CREATE INDEX CONCURRENTLY posts_problem_feed_cursor_idx
  ON public.posts (
    (coalesce(pinned, false)) DESC,
    (coalesce(created_at, TIMESTAMPTZ '1970-01-01 00:00:00+00')) DESC,
    id DESC
  )
 WHERE type = 'problem'
   AND deleted = false
   AND hidden = false
   AND status <> 'pending_review'
   AND coalesce(visibility, 'public') = 'public';
```

Do not wrap `CREATE INDEX CONCURRENTLY` in `BEGIN/COMMIT`. Do not use `IF NOT EXISTS`; a same-name/different-definition condition is drift, not success.

- [ ] **Step 6: Capture after plans and write/storage evidence**

Repeat Step 3 exactly. Record:

- before/after median execution time;
- shared read/hit buffers;
- index scan node and estimated/actual rows;
- sort method;
- index size;
- table size;
- write p95 before/after for the affected table (posts, polls, or poll_votes);
- cache hit rate and response-size effect, including an explicit zero-effect result when the candidate does not change either measure.

Check validity immediately:

```sql
SELECT c.relname, x.indisvalid, x.indisready
  FROM pg_index x
  JOIN pg_class c ON c.oid = x.indexrelid
 WHERE c.relname IN (
   'polls_post_id_idx',
   'poll_votes_author_poll_idx',
   'posts_problem_feed_cursor_idx'
 );
```

Every selected index must show `indisvalid = true` and `indisready = true`.

- [ ] **Step 7: Document exact rollback/recovery**

For each passing index, record this forward rollback statement:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.polls_post_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.poll_votes_author_poll_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.posts_problem_feed_cursor_idx;
```

Execute only the selected statement in a new forward recovery migration. If `CREATE INDEX CONCURRENTLY` fails, first run `DROP INDEX CONCURRENTLY IF EXISTS` for the invalid index, then rerun the original one-statement migration; never edit a migration already recorded as applied.

- [ ] **Step 8: Commit evidence and each passing index separately**

Evidence-only outcome:

```powershell
git add scripts/feed-index-write.sql scripts/poll-index-write.sql scripts/poll-vote-index-write.sql docs/performance/evidence/2026-09-24-feed-api-database-scaling.md
git commit -m "docs(perf): record feed index decision gates"
```

For each passing index, use its own scoped commit:

```powershell
git add api/migrations/029_polls_post_id_idx.sql docs/performance/evidence/2026-09-24-feed-api-database-scaling.md
git commit -m "perf(db): index poll post lookup"

git add api/migrations/030_poll_votes_author_poll_idx.sql docs/performance/evidence/2026-09-24-feed-api-database-scaling.md
git commit -m "perf(db): index viewer poll votes"

git add api/migrations/031_posts_problem_feed_cursor_idx.sql docs/performance/evidence/2026-09-24-feed-api-database-scaling.md
git commit -m "perf(db): index problem feed cursor"
```

Run only the commit commands for migrations that actually exist and passed.

### Task 10: Run the Focused Staging Gate and Record Honest Evidence

**Files:**
- Create: `scripts/bench-feed-reads.mjs`
- Modify: `docs/performance/evidence/2026-09-24-feed-api-database-scaling.md`
- Modify only the Home and feed/poll API rows in `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

**Interfaces:**
- Consumes: all prior tasks and the approved validation ladder.
- Produces: reproducible slice evidence and a precise inventory status; no unsupported 10,000-user claim.

- [ ] **Step 1: Create a read-only micro-benchmark**

`scripts/bench-feed-reads.mjs` must:

- require HTTPS outside localhost;
- require an explicit hostname allowlist argument;
- reject any method other than GET/HEAD;
- reject a Supabase project ref different from the approved staging ref;
- accept no write credential;
- request only `/api/posts?paginate=1&limit=20&type=problem` and a read-only poll batch;
- report rows, serialized response bytes, `X-Cache-Status`, p50/p95/p99, 4xx/5xx/429 counts, and Supabase query amplification only when supplied by staging observability;
- state clearly that 100 iterations are a slice benchmark, not a 10,000-session capacity test.

- [ ] **Step 2: Run local verification sequentially**

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run build
```

Expected: all commands exit 0. Record actual file/test counts rather than forcing the old baseline counts.

- [ ] **Step 3: Run the staging functional gate**

```powershell
if (-not $env:VOICE_BOX_STAGING_API_BASE) { throw "Set VOICE_BOX_STAGING_API_BASE to the approved HTTPS staging API base" }
if (-not $env:VOICE_BOX_STAGING_ALLOWED_HOST) { throw "Set VOICE_BOX_STAGING_ALLOWED_HOST to the exact staging hostname" }
if (-not $env:VOICE_BOX_STAGING_EXPECTED_SUPABASE_REF) { throw "Set VOICE_BOX_STAGING_EXPECTED_SUPABASE_REF to the approved staging project ref" }
node scripts/verify-read-rpcs.mjs
node scripts/verify-maintenance-lease.mjs
node scripts/bench-feed-reads.mjs --url $env:VOICE_BOX_STAGING_API_BASE --allowed-host $env:VOICE_BOX_STAGING_ALLOWED_HOST --expected-supabase-ref $env:VOICE_BOX_STAGING_EXPECTED_SUPABASE_REF --iterations 100 --yes
```

Required outcomes:

- Home first page returns at most 20 rows and no page-one exact total;
- a 21-row fixture yields a next cursor;
- 50 identical cold requests produce one origin loader per warm process;
- poll aggregates return counts/choices without child-row transfer;
- public GET mutation count is zero;
- two concurrent maintenance calls produce one run;
- two concurrent `poll-sweep` registry calls produce one leased expiry run and one explicit `lease_held` skip;
- every feed response is at most 262,144 bytes;
- feed/poll warm API p95 is below 500 ms;
- 5xx/timeouts are 0 for the slice run;
- 429s remain 0 under the non-abusive micro-benchmark;
- no unplanned Supabase/Postgres/function error appears in logs.

- [ ] **Step 4: Record before/after evidence**

The evidence file must include:

```text
UTC timestamps and deployment IDs
Old and new request URLs
Old and new row counts and serialized bytes
Old and new Supabase request count per Home page
Old and new child-row transfer counts
Cache HIT/MISS/STALE/COALESCED counts
Warm/cold p50/p95/p99
Maintained plan before/after for every exact query
Index catalog/cardinality/size/write-cost result for every candidate, including the affected-table probe name and p95 before/after
Index migration applied or explicit not-created decision
Maintenance contention result, including the registry/manual `poll-sweep` lease-held result
Public GET mutation counter
Full sequential command exit codes
Any unmet budget or limitation
```

- [ ] **Step 5: Update the inventory honestly**

Mark Home feed evidence only if all of these pass:

- initial request is `paginate=1&limit=20`;
- no Home `/api/polls?id=...` or `/api/reactions?author=...` request;
- explicit Load more uses the returned cursor;
- vote updates locally from the authoritative poll response;
- no page-one exact count;
- no recurring or passive reload after the parent one-load task.

Leave any unproven item `Partial` or `Noncompliant`; do not delete or silently narrow the inventory row.

- [ ] **Step 6: Commit evidence and inventory update**

```powershell
git add scripts/bench-feed-reads.mjs docs/performance/evidence/2026-09-24-feed-api-database-scaling.md docs/superpowers/specs/2026-09-24-platform-surface-inventory.md
git commit -m "docs(perf): record feed scaling evidence"
```

- [ ] **Step 7: Fresh database/API review gate**

A fresh reviewer verifies:

- all aggregate results match fixtures under empty, duplicate, multi-choice, orphan, deleted, expired, and high-cardinality data;
- no viewer/admin data crosses cache keys;
- `poll-sweep` manual and agent-cron runs use the same `poll-expiry` lease and never import the unleased sweeper directly;
- malformed cursors fail safely to page one;
- page-one totals are absent unless explicitly authorized;
- public reads write nothing;
- lease contention, expiry, and release are correct;
- every index has live before/after evidence and a concurrent rollback;
- extracted routes use the shared gateway and do not regress p95;
- no 10,000-user claim is made by this slice.

## Migration Ordering, Activation, and Rollback

### Required order

1. Apply `027_feed_poll_read_functions.sql` to staging.
2. Verify functions and deploy API code with the new read path available.
3. Run focused API tests and staging RPC verification.
4. Apply `028_maintenance_leases.sql` to staging.
5. Deploy the maintenance route and remove request-triggered writes only after its shared gateway wrapper is present (Task 7); deploy the `poll-sweep` registry adapter in the same slice so agent-cron/manual runs cannot bypass the `poll-expiry` lease. Do not expose an unwrapped cron handler.
6. Run the public-read and lease contention gates.
7. Run exact live plans against the final RPC/query shapes.
8. Create and apply only the passing concurrent index migrations, one per file and one per commit.
9. Run the full sequential regression and read-only staging benchmark.

### Application rollback

- Before migration 027, the previous code path remains available behind deployment rollback.
- After activation, set the read-pipeline deployment flag to its previous value or redeploy the previous Vercel deployment. Do not silently fall back to the old 2,000-row query when the new RPC fails; return an honest 503 and roll back deliberately.
- After maintenance activation, redeploying the previous app is not required for data correctness because lease functions/table are inert. Disable the `/api/maintenance` cron first if maintenance must stop, then roll back app code.

### Database forward recovery

RPC functions are additive and hold no user data. If they must be removed, first deploy app code that no longer calls them, then create a new forward migration:

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.api_poll_page(text[], text, text, text, boolean, jsonb, integer);
DROP FUNCTION IF EXISTS public.api_feed_page(text, text, text, text, text, timestamptz, timestamptz, text, jsonb, integer, boolean);
DROP FUNCTION IF EXISTS public.is_test_artifact_text(text);
COMMIT;
```

Maintenance recovery, only after all callers are removed:

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.release_maintenance_lease(text, uuid);
DROP FUNCTION IF EXISTS public.renew_maintenance_lease(text, uuid, integer);
DROP FUNCTION IF EXISTS public.try_claim_maintenance_lease(text, uuid, integer);
DROP TABLE IF EXISTS public.maintenance_leases;
COMMIT;
```

Index rollback uses one forward recovery statement per selected index:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.polls_post_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.poll_votes_author_poll_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.posts_problem_feed_cursor_idx;
```

Never edit an already-applied migration. Never use a transactional block around `CREATE/DROP INDEX CONCURRENTLY`.

## Completion Checklist

- [ ] Home first page requests 20 rows and renders at most 20 cards.
- [ ] Home Load more is explicit, cursor-based, bounded, and stale-result safe.
- [ ] Home makes no per-post poll request and no all-history poll-vote request.
- [ ] Feed reaction/comment/poll/vote aggregates come from PostgreSQL.
- [ ] Poll list/batch/result aggregates come from PostgreSQL.
- [ ] Page one performs no exact count unless explicitly requested and authorized.
- [ ] Complete responses, not raw parent rows, are cached.
- [ ] Fifty cold identical reads share one loader.
- [ ] Public cache keys include viewer/permission/locale; private data is never publicly cached.
- [ ] Feed/poll responses stay within row and byte budgets.
- [ ] Public GET/HEAD handlers perform zero database mutations.
- [ ] Content maintenance runs only through the authenticated leased route.
- [ ] `poll-sweep` manual and agent-cron runs use the shared `poll-expiry` lease; no registry path calls the sweeper directly.
- [ ] Concurrent maintenance invocations perform at most one real run.
- [ ] Chunked and pre-parsed bodies enforce the same byte cap.
- [ ] Local rate maps are bounded with deterministic cleanup.
- [ ] Staging Vercel Firewall rules are reviewed but not published without approval.
- [ ] `/api/posts` and `/api/polls` are independently deployable and pass the cold-start/import-size keep gate.
- [ ] Every index has live catalog/cardinality/before/after/write-cost evidence or is explicitly not created.
- [ ] Every migration has forward recovery instructions.
- [ ] Typecheck, lint, unit tests, API tests, build, and Vercel build pass sequentially.
- [ ] Evidence records actual measurements and makes no unsupported capacity claim.
