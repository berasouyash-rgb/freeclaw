# Voice Flow Observability and Safe Load Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trustworthy normalized request telemetry, durable latency and amplification evidence, and a fail-closed HTTPS load-validation harness that can prove the highest verified Voice Flow capacity without ever mutating production.

**Architecture:** Keep the approved Vercel + Supabase stack. Create a request-local observability context that assigns one bounded request ID, normalizes route labels, and counts origin, Supabase, and business-write activity without a database write in GET or HEAD handlers. Emit one structured metric event per API request to Vercel Log Drain; an authenticated ingest endpoint turns those events into fixed histogram buckets in the existing `system_metrics` table through an additive atomic RPC. Replace the current load script with pure, testable safety, configuration, journey, metrics, Realtime, and report modules. The production path can issue only explicitly allowlisted static or CDN `HEAD` requests; staging writes and Realtime runs are separate, operator-approved ladders.

**Tech Stack:** Node.js `22.22.0+`, Vercel Node serverless functions and Log Drain, Supabase/PostgreSQL/PostgREST, Supabase Realtime WebSockets, React 19, TypeScript 5.9, Vite 7, Vitest 4, GitHub Actions, JSON, JSONL, and Markdown evidence artifacts.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md`

**Surface Inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

**Parent Plan:** `docs/superpowers/plans/2026-09-24-10k-smooth-platform-program.md`

## Current-Session Boundary

This planning session writes exactly one file:

```text
docs/superpowers/plans/2026-09-24-observability-and-safe-load-validation.md
```

It does not edit production source, tests, configuration, migrations, `.env` files, or generated evidence. It does not apply a migration, deploy, start a remote load test, or claim that capacity has been proven. Every command below is a command for a later, human-gated implementation session.

## Global Constraints

- Target: **10,000 simultaneously active users**.
- Initial stack: **Vercel + Supabase**; add no service unless a measured result proves the current stack cannot meet the target.
- Every routed page performs one bounded initial data load per page visit; no timed full-page or full-feed refresh is introduced.
- User actions reconcile affected local records; they do not reload unrelated lists.
- GET, HEAD, and other read methods remain side-effect free with respect to application data. Telemetry persistence happens outside the request path through Log Drain and the authenticated ingest endpoint.
- Production load tests never send `POST`, `PUT`, `PATCH`, or `DELETE`, and never call an application mutation route.
- Verification order is **local integration → dedicated staging → Realtime isolation → production read-only canary**.
- Run typecheck, lint, unit tests, API tests, and build sequentially; do not parallelize those gates.
- No index migration is created or applied by this plan. The additive observability migration still requires live catalog inspection, `EXPLAIN (ANALYZE, BUFFERS)` where applicable, rollback notes, and a human approval gate.
- No capacity claim is made from local tests, a build, a preview URL, or an incomplete stage. A missing measurement is `not_collected` or `unavailable`, never zero.
- No provider credentials are loaded by a load-test process. Staging load tests may use only a public Realtime anon key when Realtime mode is explicitly selected; service-role and AI provider keys are rejected.
- Preserve the current shared working tree. Do not reset, clean, delete tests, or include unrelated concurrent changes.
- Human approval is required before commit, push, deployment, migration application, staging load, Realtime load, production canary, or budget approval. The current `docs/QA/LOOP-STATE.json` marks commit, push, deploy, and key rotation as human gates and forbids deleting tests.
- The approved design load evidence is historical and insufficient: the current `scripts/loadtest.mjs` uses `http.request`, includes mutation journeys, references undefined `onId`, uses incorrect comment and suggestion paths, and cannot be used remotely until repaired.
- No new service, queue, or vendor is introduced by this plan. If Vercel Log Drain is unavailable on the selected plan, durable server percentiles are explicitly blocked; do not silently fall back to per-request database writes.

## Review Focus

The following are the most likely failure modes; each has a named owning task and a regression test in that task.

1. **Environment or method confusion:** a staging URL, preview host, production host, or mutation method must fail before a socket is opened; the guard is tested independently of the network.
2. **Telemetry cardinality or leakage:** concrete post IDs, query strings, bodies, IP addresses, raw anonymous IDs, tokens, and unbounded error text must never become metric labels or log fields; fixed route and redaction tests own this.
3. **Lost or fabricated percentiles:** a cold start must not turn an empty ring into a healthy zero, and a histogram must report its upper-bound method and sample count; durable-store tests own this.
4. **Amplification hidden by averages:** a request that causes ten Supabase calls or an unclassified write must be visible in a bounded category, including a side-effectful GET; proxy and classification tests own this.
5. **Load-test false confidence:** 404, 405, redirects, missing IDs, 429s, timeouts, generator saturation, Realtime quota pressure, and missing platform evidence must fail or block the stage rather than be averaged away; harness and report tests own this.

## Evidence and Dependency Order

```text
Task 1 request context + SLO policy
  ├── Task 2 durable histogram store + Log Drain ingest
  ├── Task 3 Supabase, cache, and write amplification
  └── Task 5 client request IDs + Web Vitals sampling
          ↓
Task 4 monitoring endpoints + admin evidence surfaces + runbook
          ↓
Task 6 HTTP safety, configuration, and journey harness
          ↓
Task 7 Realtime, generator health, reporting, and cost
          ↓
Task 8 offline CI + protected manual workflow
          ↓
Task 9 validation ladder + evidence publication + final gates
```

Tasks 2 and 3 may be implemented in parallel only after Task 1 context and event schema are fixed. Task 7 depends on Task 6 guard and report schema. Task 9 is the only task that may publish a capacity statement, and it remains blocked until every required report is measured.

## Planned File Map

The following paths are future implementation targets, not files changed while authoring this plan.

- Create `api/_request-context.js` — request ID validation, fixed route normalization, AsyncLocalStorage context, safe session hash, cache status, origin counters, and one-shot finalization.
- Create `api/_slo.js` — immutable SLO targets, alert thresholds, abort policy, and policy validation shared by monitoring and the load harness.
- Create `api/_metrics-store.js` — fixed histogram buckets, metric names, bucket aggregation, durable percentile reads, and retention helpers.
- Create `api/_metrics-ingest.js` — authenticated, bounded Log Drain receiver; it never accepts raw URLs, bodies, or identity headers.
- Create `api/_supabase-metrics.js` — normalized Supabase fetch instrumentation with response-byte counting and retry classification.
- Create `api/_write-amplification.js` — finite write-kind enum, Supabase builder classification, side-effectful-read detection, and amplification summary.
- Create `api/migrations/032_observability_metrics.sql` — additive `system_metrics` columns, partial unique index, and atomic service-role-only bucket RPC. Apply only after live catalog review and human approval.
- Modify `api/index.js` — one request context for every response, canonical request-ID response header, normalized route logging, and exactly one metric finalization.
- Modify `api/_production-error.js` — reuse the gateway request ID and use the structured redacting logger.
- Modify `api/_observability.js` — bounded in-memory compatibility metrics, telemetry redaction, structured request-metric event emission, and durable-store integration points.
- Modify `api/_db-client.js` — install the Supabase metrics fetch wrapper and retain the existing timeout and retry behavior.
- Modify `api/_cache.js` — emit `hit`, `stale`, `miss`, or `bypass` into the active request context.
- Modify `api/_events.js`, `api/_cleanup.js`, `api/_follows.js`, `api/_ai.js`, `api/_providers.js`, and `api/_inbox.js` — classify non-DB amplification such as event enqueue, cleanup batch, follower delivery, and provider or AI work.
- Modify `api/v3/_monitoring.js`, `api/_performance.js`, and `api/_incident-cron.js` — read durable metrics, expose p50, p95, p99, and amplification, and evaluate the shared SLO policy.
- Modify `api/_vitals.js` — receive bounded sampled browser vitals into the durable metric store and return durable percentiles.
- Modify `src/lib/api.ts` — generate and propagate one request ID per logical request and retain the response ID on errors.
- Modify `src/lib/vitals.ts` — remove the recurring five-second timer, sample ordinary vitals, deduplicate navigation metrics, and flush on threshold, pagehide, or unload.
- Modify `src/lib/errors.ts` — send normalized route metadata and the last request ID, never a raw URL or query.
- Modify `src/pages/admin/PerformanceCenter.tsx`, `src/pages/admin/Overview.tsx`, and `src/pages/admin/SystemHealth.tsx` — show durable source, p50, p95, p99, honest unavailable states, and manual refresh without observability-driven polling.
- Replace `scripts/loadtest.mjs` with a thin orchestrator; create `scripts/loadtest-config.mjs`, `scripts/loadtest-guard.mjs`, `scripts/loadtest-journeys.mjs`, `scripts/loadtest-metrics.mjs`, `scripts/loadtest-generator-health.mjs`, `scripts/loadtest-realtime.mjs`, and `scripts/loadtest-report.mjs`.
- Create `tests/load/loadtest-guard.test.ts`, `tests/load/loadtest-journeys.test.ts`, `tests/load/loadtest-metrics.test.ts`, `tests/load/loadtest-realtime.test.ts`, and `tests/load/loadtest-report.test.ts`; create `vitest.config.load.ts`.
- Modify `package.json` and `.github/workflows/ci.yml` only for the offline safety suite. Create `.github/workflows/load-validation.yml` as a manual, protected workflow; it must never run automatically on PR or push.
- Create `docs/runbooks/observability-alerts.md`, `docs/performance/load-validation/README.md`, `docs/performance/load-validation/SCHEMA.md`, and `docs/performance/load-validation/RUNBOOK.md`; update `docs/PERF.md` to distinguish historical, local, staging, Realtime, and production-read-only evidence.

## Exact Shared Interfaces

These signatures are the contract between tasks. An implementation worker must use these names and types; a later task must not invent a second spelling.

```js
// api/_request-context.js
export const REQUEST_ID_HEADER = "x-request-id";
export const REQUEST_ID_RESPONSE_HEADER = "X-Request-ID";
export function normalizeRoute(pathname: string): string;
export function getOrCreateRequestId(req: { headers?: Record<string, unknown> }): string;
export function createRequestContext(input: {
  req: { method?: string; url?: string; headers?: Record<string, unknown> };
  route: string;
  environment?: "local" | "preview" | "staging" | "production";
}): RequestContext;
export function runWithRequestContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T>;
export function currentRequestContext(): RequestContext | undefined;
export function setCacheStatus(status: "hit" | "stale" | "miss" | "bypass" | "unknown"): void;
export function recordSupabaseAttempt(event: SupabaseAttempt): void;
export function recordBusinessWrite(event: BusinessWriteEvent): void;
export function finalizeRequest(statusCode: number, responseHeaders?: HeadersLike): MetricEvent;

// api/_slo.js
export const SLO_TARGETS: Readonly<SLO_TARGETS>;
export const ABORT_POLICY: Readonly<AbortPolicy>;
export function validatePolicy(policy: unknown): { ok: true; value: AbortPolicy } | { ok: false; errors: string[] };

// api/_metrics-store.js
export const HISTOGRAM_BUCKETS_MS: readonly number[];
export const METRIC_NAMES: Readonly<Record<string, string>>;
export function bucketForValue(value: number): number;
export function aggregateMetricEvents(events: MetricEvent[]): MetricBucketRow[];
export function percentileFromHistogram(histogram: Record<string, number>): { p50: number; p95: number; p99: number; count: number; method: "upper-bound-histogram" };
export function appendMetricBuckets(rows: MetricBucketRow[], client?: SupabaseLike): Promise<void>;
export function readDurableMetrics(query: DurableMetricQuery, client?: SupabaseLike): Promise<DurableMetricSnapshot>;
export function readDurableVitals(query: DurableVitalsQuery, client?: SupabaseLike): Promise<DurableVitalsSnapshot>;

// api/_metrics-ingest.js
export function validateMetricEvent(value: unknown): { ok: true; event: MetricEvent } | { ok: false; code: string };
export default async function handler(req: RequestLike, res: ResponseLike): Promise<void>;

// api/_supabase-metrics.js
export function instrumentSupabaseFetch(fetchImpl: typeof fetch, getContext?: () => RequestContext | undefined): typeof fetch;
export function classifySupabaseRequest(url: URL, method: string): { table: string; operation: "select" | "insert" | "update" | "upsert" | "delete" | "rpc" | "other" };

// api/_write-amplification.js
export const WRITE_KINDS: readonly WriteKind[];
export function classifyWrite(input: { table: string; operation: string; entryPoint: string }): WriteKind;
export function recordSupabaseMutation(input: { table: string; operation: string }): void;
export function recordExternalWork(input: { kind: WriteKind; count?: number; operation?: string }): void;
export function getAmplificationSnapshot(): AmplificationSnapshot;
export function resetAmplificationForTests(): void;

// scripts/loadtest-guard.mjs
export function parseLoadConfig(argv: string[], env: NodeJS.ProcessEnv): LoadConfig;
export function assertSafeTarget(config: LoadConfig): { ok: true } | { ok: false; code: string; message: string };
export function assertSafeRequest(config: LoadConfig, method: string, url: URL): { ok: true } | { ok: false; code: string; message: string };
export function createAbortController(config: LoadConfig): AbortController;

// scripts/loadtest-journeys.mjs
export function extractRows(payload: unknown): Record<string, unknown>[];
export function extractJourneyId(payload: unknown, field?: string): string;
export function buildReadJourney(identity: string, rng: () => number): JourneyStep[];
export function buildDisposableWriteJourney(identity: string, rng: () => number): JourneyStep[];

// scripts/loadtest-generator-health.mjs
export function startGeneratorMonitor(options: GeneratorMonitorOptions): GeneratorMonitor;
export function evaluateGeneratorHealth(sample: GeneratorSample, policy: AbortPolicy, nowMs: number): string | null;

// scripts/loadtest-report.mjs
export function buildLoadReport(input: LoadReportInput): LoadReport;
export function renderLoadReportMarkdown(report: LoadReport): string;
export async function writeLoadReport(directory: string, report: LoadReport): Promise<string[]>;
```

`MetricEvent` has this exact shape and no additional free-form payload:

```ts
type MetricEvent = {
  event: "voicebox.http_request.v1";
  timestamp: string;
  requestId: string;
  environment: "local" | "preview" | "staging" | "production";
  route: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  statusClass: "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "transport";
  durationMs: number;
  cacheStatus: "hit" | "stale" | "miss" | "bypass" | "unknown";
  coldStartEstimate: boolean;
  supabase: {
    attempts: number;
    requests: number;
    retries: number;
    errors: number;
    bytes: number;
    bytesKnown: boolean;
  };
  writes: {
    total: number;
    byKind: Record<string, number>;
  };
  sessionHash: string | null;
  entryPoint: "http_request" | "cron" | "worker" | "cli" | "replay_endpoint";
};
```

The metric event intentionally excludes `url`, `query`, `body`, `ip`, `userAgent`, `anonId`, `authorId`, `userId`, cookies, authorization headers, provider names, and raw error text. `requestId` is a correlation field, never a metric label.

---

## Task 1: Establish Request Context, Correlation, and Shared Policy

**Files:**
- Create: `api/_request-context.js`
- Create: `api/_slo.js`
- Modify: `api/index.js:295-463`
- Modify: `api/_production-error.js:24-112`
- Modify: `api/_observability.js:1-314`
- Test: `tests/api/request-context.test.ts`
- Test: `tests/api/request-id-and-redaction.test.ts`

**Interfaces:**
- Consumes: Vercel `req` and `res`, existing `logger`, `recordRequest`, `supabase` client, and the approved normalized route surface.
- Produces: one `RequestContext` per response, one canonical `X-Request-ID` header, fixed route templates, redacted structured events, and immutable SLO and abort constants for Tasks 2, 4, 6, and 7.

- [ ] **Step 1: Write failing tests for route normalization and request ID validation**

Add tests with these exact cases:

```ts
import { describe, expect, it } from "vitest";
import { getOrCreateRequestId, normalizeRoute } from "../../api/_request-context.js";

describe("request context contracts", () => {
  it("normalizes concrete ids and query strings", () => {
    expect(normalizeRoute("/api/posts/post_abc123?cursor=secret")).toBe("/api/posts/:id");
    expect(normalizeRoute("/api/comments?post_id=post_abc123")).toBe("/api/comments");
    expect(normalizeRoute("/api/v3/monitoring?action=latency")).toBe("/api/v3/monitoring");
    expect(normalizeRoute("/assets/index-D8x9.js")).toBe("/assets/:asset");
  });

  it("accepts a bounded incoming id and rejects unsafe input", () => {
    expect(getOrCreateRequestId({ headers: { "x-request-id": "client-abc_123" } })).toBe("client-abc_123");
    expect(getOrCreateRequestId({ headers: { "x-request-id": "bad id with spaces" } })).toMatch(/^[a-z0-9-]+$/);
    expect(getOrCreateRequestId({ headers: { "x-request-id": "x".repeat(129) } })).toMatch(/^[a-z0-9-]+$/);
  });
});
```

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/request-context.test.ts
```

Expected: FAIL because the new module does not exist.

- [ ] **Step 2: Write failing tests for one-shot finalization and redaction**

Use a response double whose `end` method can be called twice. Assert that the metric event is emitted once, the response carries the same request ID, and the serialized log contains no `url`, `query`, `body`, `ip`, `anonId`, or token value. Add a test for the current defect: a valid incoming `x-request-id` must be preserved rather than replaced by a generated ID.

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/request-id-and-redaction.test.ts
```

Expected: FAIL because `api/index.js` currently creates a new ID at line 339 and logs the concrete pathname at lines 434-440.

- [ ] **Step 3: Implement the pure route and ID functions**

Create `api/_request-context.js` with an `AsyncLocalStorage` store and fixed route behavior. The route normalizer must never decode a concrete ID into a label:

```js
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const PARAMETER_ROUTES = new Set([
  "posts", "polls", "reactions", "reports", "admin", "users",
  "notifications", "chat", "communities", "saved", "agent", "agents"
]);

export function normalizeRoute(pathname) {
  const clean = String(pathname || "/").split("?")[0].replace(/\/+/g, "/");
  if (clean === "/health-chunks.json") return "/health-chunks.json";
  if (clean.startsWith("/assets/")) return "/assets/:asset";
  if (!clean.startsWith("/api/")) return clean === "/" ? "/" : "/page";
  const parts = clean.split("/").filter(Boolean);
  if (parts[1] === "v3" && parts[2]) return `/api/v3/${parts[2]}`;
  if (parts.length >= 3 && PARAMETER_ROUTES.has(parts[1])) return `/api/${parts[1]}/:id`;
  return `/api/${parts[1] || "__unknown__"}`;
}

export function getOrCreateRequestId(req) {
  const candidate = req?.headers?.["x-request-id"];
  if (typeof candidate === "string" && ID_RE.test(candidate)) return candidate;
  return crypto.randomUUID();
}
```

Use the platform `crypto.randomUUID` available in Node 22. The implementation must expose `currentRequestContext`, `runWithRequestContext`, `setCacheStatus`, `recordSupabaseAttempt`, `recordBusinessWrite`, and `finalizeRequest` using the shared interfaces above. Hash an anonymous identity with HMAC-SHA256 using `METRICS_HASH_SALT`; never retain the raw value.

- [ ] **Step 4: Define the immutable SLO and abort policy**

Create `api/_slo.js` with these exact values:

```js
export const SLO_TARGETS = Object.freeze({
  readAvailability: 0.999,
  readP95Ms: 500,
  readP99Ms: 1800,
  writeAvailability: 0.999,
  writeP95Ms: 800,
  writeP99Ms: 3000,
  lcpP75Ms: 2500,
  inpP75Ms: 200,
  clsP75: 0.1,
  ttfbP75Ms: 800
});

export const ABORT_POLICY = Object.freeze({
  unexpected5xxRate15s: 0.01,
  unexpected5xxRate60s: 0.001,
  throttled429Rate60s: 0.001,
  p99GateFactor: 2,
  p99WindowSeconds: 30,
  p99ConsecutiveWindows: 2,
  p95HoldSeconds: 300,
  databaseCpuRatio: 0.85,
  databaseCpuHoldSeconds: 300,
  databaseConnectionRatio: 0.85,
  databaseConnectionHoldSeconds: 120,
  realtimeQuotaRatio: 0.80,
  realtimeQuotaHoldSeconds: 30,
  generatorCpuRatio: 0.85,
  generatorCpuHoldSeconds: 30,
  generatorHeapRatio: 0.80,
  generatorHeapHoldSeconds: 10,
  generatorEventLoopP99Ms: 100,
  generatorEventLoopHoldSeconds: 5,
  generatorSocketErrorsRate15s: 0.01
});
```

Export `validatePolicy` and make every threshold finite, nonnegative, and internally ordered. Add tests that reject a policy with a negative rate, a p95 hold below the p99 window, or an unapproved new enum.

- [ ] **Step 5: Integrate the context into the gateway and error wrapper**

In `api/index.js`, parse the pathname before the development `_ping` branch, set the request ID before every early return, create the context before security checks, and install one idempotent `res.end` finalizer. The finalizer must run for success, 404, 413, 429, 405, parse errors, and thrown handlers. Move the existing `recordRequest` call into that single finalizer. Use `normalizeRoute(pathname)` in the log and feature-health map. Keep the raw pathname only in the local control variable; never pass it to `logger`.

In `api/_production-error.js`, replace its independent ID generation with `getOrCreateRequestId(req)` and the canonical response header. Replace the direct `the direct JSON error call` with the redacting structured logger. The finalizer guard must use a symbol or a private context flag so `protect` and the gateway cannot double-count.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/request-context.test.ts tests/api/request-id-and-redaction.test.ts
```

Expected: PASS, including the current gateway regression cases.

Run the existing API tests most likely to exercise the wrapper:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/authorization.test.ts tests/api/auth.test.ts tests/api/errors-authz.test.ts tests/api/admin-gates-runtime.test.ts
```

Expected: PASS with no changed authorization or error contract.

- [ ] **Step 7: Run sequential gates and inspect the diff**

Run exactly in this order:

```powershell
npm run typecheck
npm run lint
npm run test:api
npm run build
```

Expected: zero new failures. Inspect only the listed paths with `git diff -- api/index.js api/_production-error.js api/_observability.js api/_request-context.js api/_slo.js tests/api/request-context.test.ts tests/api/request-id-and-redaction.test.ts`. Do not stage or commit until the human gate in `docs/QA/LOOP-STATE.json` is satisfied.

- [ ] **Step 8: Propose the scoped human-gated commit**

```powershell
git add api/_request-context.js api/_slo.js api/index.js api/_production-error.js api/_observability.js tests/api/request-context.test.ts tests/api/request-id-and-redaction.test.ts
git commit -m "feat(observability): normalize request context and correlation"
```

Rollback: revert only this commit, promote the previous Vercel deployment, and leave no database change. A rollback must not delete telemetry rows or reset the shared working tree.

## Task 2: Add Durable Histograms and an Authenticated Log-Drain Ingest Path

**Files:**
- Create: `api/_metrics-store.js`
- Create: `api/_metrics-ingest.js`
- Create: `api/migrations/032_observability_metrics.sql`
- Modify: `api/index.js:198-293` to register the route
- Modify: `.env.template` to document server-only variables
- Modify: `docs/DEPLOY-SCHOOL.md` with Log Drain setup and plan prerequisites
- Test: `tests/api/metrics-store.test.ts`
- Test: `tests/api/metrics-ingest.test.ts`

**Interfaces:**
- Consumes: the `MetricEvent` from Task 1 and the existing `system_metrics` table from `api/migrations/002_agent_system.sql`.
- Produces: durable fixed-bucket histograms, durable Web Vitals samples/counts, authenticated Log Drain ingestion, and percentile reads with `method: "upper-bound-histogram"`.

- [ ] **Step 1: Write failing tests for bucket boundaries and percentile math**

Pin these boundaries exactly:

```ts
expect(HISTOGRAM_BUCKETS_MS).toEqual([5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000]);
expect(bucketForValue(4)).toBe(5);
expect(bucketForValue(5)).toBe(5);
expect(bucketForValue(30001)).toBe(30000);
```

Build a histogram with 99 values in bucket `100` and one value in bucket `200`; assert p50, p95, and p99 are 100, p50 is not an arithmetic mean, and `count` is 100. Assert an empty histogram returns `count: 0` and percentiles `0` with `method: "upper-bound-histogram"`, never a fabricated sample.

- [ ] **Step 2: Write failing tests for ingest authentication and redaction**

Test all of these:

```ts
expect(validateMetricEvent({ event: "voicebox.http_request.v1", url: "/api/posts/1" }).ok).toBe(false);
expect(validateMetricEvent({ event: "voicebox.http_request.v1", requestId: "r1", body: "secret" }).ok).toBe(false);
expect(validateMetricEvent(validEvent).ok).toBe(true);
```

Call the handler with no token, a wrong token, a body over 100 events, a non-POST method, a disabled ingest flag, and a valid batch. Assert accepted, rejected, and persisted counts, and assert the service-role key is never read by the ingest handler.

- [ ] **Step 3: Write the additive migration, but do not apply it**

Create `api/migrations/032_observability_metrics.sql` with additive columns and an atomic function. The core must be equivalent to:

```sql
ALTER TABLE system_metrics
  ADD COLUMN IF NOT EXISTS series_key TEXT,
  ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bucket_ms INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS system_metrics_metric_series_window_bucket_uidx
  ON system_metrics (metric_name, series_key, window_start, bucket_ms)
  WHERE series_key IS NOT NULL
    AND window_start IS NOT NULL
    AND bucket_ms IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ingest_metric_buckets(p_rows JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE item RECORD;
BEGIN
  FOR item IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      metric_name TEXT,
      series_key TEXT,
      window_start TIMESTAMPTZ,
      bucket_ms INTEGER,
      metric_value NUMERIC,
      tags JSONB
    )
  LOOP
    INSERT INTO system_metrics(metric_name, metric_value, tags, series_key, window_start, bucket_ms)
    VALUES (item.metric_name, item.metric_value, item.tags, item.series_key, item.window_start, item.bucket_ms)
    ON CONFLICT (metric_name, series_key, window_start, bucket_ms)
      WHERE series_key IS NOT NULL AND window_start IS NOT NULL AND bucket_ms IS NOT NULL
    DO UPDATE SET
      metric_value = system_metrics.metric_value + EXCLUDED.metric_value,
      tags = system_metrics.tags || EXCLUDED.tags;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_metric_buckets(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_metric_buckets(JSONB) TO service_role;
```

Before any later application, run a live catalog query for the current `system_metrics` columns, indexes, role names, and existing RPCs. Capture the exact result in the evidence report. Do not run this migration against production in the planning session or in CI.

- [ ] **Step 4: Implement the metric store**

Use these metric names:

```js
export const METRIC_NAMES = Object.freeze({
  httpDuration: "http_request_duration_ms:v1",
  httpOrigin: "http_origin_amplification:v1",
  httpWrites: "http_write_amplification:v1",
  webVitals: "web_vitals_value:v1",
  webVitalsRatings: "web_vitals_rating_count:v1",
  generator: "load_generator_health:v1"
});
```

`aggregateMetricEvents` groups by UTC minute, normalized route, method, status class, cache status, environment, and metric name. The series key is a bounded concatenation of those fields, never a request ID. `appendMetricBuckets` calls `supabase.rpc("ingest_metric_buckets", { p_rows: rows })` and throws on an RPC error. `readDurableMetrics` returns `source: "durable"`, `sampleCount`, `p50`, `p95`, `p99`, and `method`. A missing row is `source: "unavailable"`, not a zero-valued success.

- [ ] **Step 5: Implement the authenticated ingest handler**

Add `metrics-ingest` to the route map as `protect(metricsIngest, "metrics-ingest")`. The handler must require `POST`, `METRICS_INGEST_ENABLED === "true"`, and a constant-time comparison against a `METRICS_INGEST_TOKEN` of at least 32 characters. Accept one event or an array, cap the array at 100, reject forbidden keys, aggregate valid events, and return:

```json
{"ok":true,"accepted":100,"rejected":0,"buckets":4}
```

A malformed event returns a 400 count, not a stack trace. The endpoint is telemetry-exempt from recursive Log Drain emission. The server-only variables are `METRICS_INGEST_ENABLED`, `METRICS_INGEST_TOKEN`, and `METRICS_HASH_SALT`; none use a `VITE_` prefix.

- [ ] **Step 6: Configure and document the durable path**

Document a Vercel Log Drain POST destination of `https://APPROVED_TARGET_HOST/api/metrics-ingest` with the `X-Metrics-Ingest-Token` header and a filter for `event=voicebox.http_request.v1`. Exclude `/api/metrics-ingest` itself. Require a Vercel plan that includes Log Drain and enough log retention for the selected validation window. Require a Supabase plan that can accept the measured bucket writes. If either prerequisite is absent, mark durable server percentiles `blocked` in the evidence report and do not claim a 30-day SLO from memory data.

- [ ] **Step 7: Run focused and sequential verification**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/metrics-store.test.ts tests/api/metrics-ingest.test.ts
npm run typecheck
npm run lint
npm run test:api
npm run build
```

Expected: all new tests pass, and existing tests that mock `system_metrics` continue to pass with either a durable row or an explicit unavailable state. Do not apply the migration until the live catalog evidence and human gate are recorded.

- [ ] **Step 8: Propose the scoped human-gated commit**

```powershell
git add api/_metrics-store.js api/_metrics-ingest.js api/migrations/032_observability_metrics.sql api/index.js .env.template docs/DEPLOY-SCHOOL.md tests/api/metrics-store.test.ts tests/api/metrics-ingest.test.ts
git commit -m "feat(observability): add durable metric buckets and ingest"
```

Rollback: set `METRICS_INGEST_ENABLED=false`, deploy the previous application build, and leave additive columns in place if they are already applied. After a human-approved database rollback, drop the partial index, function, and the three additive columns in that order. Never use a destructive row cleanup as an application rollback.

---
## Task 3: Instrument Supabase Origin Work, Cache State, and Write Amplification

**Files:**
- Create: `api/_supabase-metrics.js`
- Create: `api/_write-amplification.js`
- Modify: `api/_db-client.js:44-97`
- Modify: `api/_cache.js:16-60,173-255`
- Modify: `api/_events.js:68-135,142-181`
- Modify: `api/_cleanup.js:77-90,446-483`
- Modify: `api/_follows.js` at the follower-delivery loop
- Modify: `api/_ai.js`, `api/_providers.js`, and `api/_inbox.js` at provider and AI work calls
- Test: `tests/api/supabase-metrics.test.ts`
- Test: `tests/api/write-amplification.test.ts`
- Test: `tests/api/side-effect-free-read.test.ts`

**Interfaces:**
- Consumes: the active `RequestContext` from Task 1 and the Supabase client used by the existing API modules.
- Produces: normalized origin counters, response-byte accounting, retry classification, bounded write categories, and a side-effectful-read counter for load aborts and dashboards.

- [ ] **Step 1: Write failing tests for normalized Supabase accounting**

Mock `fetch`, run a Supabase request through `instrumentSupabaseFetch`, and assert:

```ts
expect(snapshot.supabase.requests).toBe(1);
expect(snapshot.supabase.attempts).toBe(2);
expect(snapshot.supabase.retries).toBe(1);
expect(snapshot.supabase.errors).toBe(1);
expect(snapshot.supabase.bytes).toBe(128);
expect(snapshot.supabase.bytesKnown).toBe(true);
```

Use a URL with a concrete row filter and assert that the recorded table is only the fixed table name. Assert that no recorded object contains the row ID, query string, authorization value, or request body. Test a response without `content-length`; it must set `bytesKnown: false` and must not invent a byte count.

- [ ] **Step 2: Write failing tests for write categories and side-effectful reads**

Use a fixed table and operation matrix:

```ts
expect(classifyWrite({ table: "users_meta", operation: "update", entryPoint: "heartbeat" })).toBe("heartbeat");
expect(classifyWrite({ table: "settings", operation: "update", entryPoint: "cleanup" })).toBe("cleanup");
expect(classifyWrite({ table: "chat_messages", operation: "insert", entryPoint: "follower_delivery" })).toBe("follower_delivery");
expect(classifyWrite({ table: "agent_conversations", operation: "insert", entryPoint: "ai_job" })).toBe("ai_job");
expect(classifyWrite({ table: "posts", operation: "insert", entryPoint: "http_request" })).toBe("user_mutation");
```

Call `recordSupabaseMutation` while the context method is `GET` and assert `sideEffectfulReads` increments. Assert every write kind is one of the finite list and that an unknown table is `unclassified`, not silently discarded.

- [ ] **Step 3: Implement the Supabase fetch wrapper**

Create `api/_supabase-metrics.js` with a wrapper that counts every attempt, including a retry. Use a `TransformStream` to count response bytes while the body is forwarded; do not clone and buffer the whole response:

```js
export function instrumentSupabaseFetch(fetchImpl, getContext = currentRequestContext) {
  return async (input, init = {}) => {
    const context = getContext();
    const started = performance.now();
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = String(init.method || "GET").toUpperCase();
    const shape = classifySupabaseRequest(url, method);
    context?.recordSupabaseAttempt({ startedAt: started, method, shape, urlForClassification: url });
    const response = await fetchImpl(input, init);
    if (!response.body) {
      context?.finishSupabaseAttempt({ status: response.status, durationMs: performance.now() - started, bytes: 0, bytesKnown: false });
      return response;
    }
    let bytes = 0;
    const counted = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      }
    }));
    const wrapped = new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
    context?.finishSupabaseAttempt({ status: response.status, durationMs: performance.now() - started, bytes, bytesKnown: true });
    return wrapped;
  };
}
```

The context stores only the fixed table name, operation, method, status class, duration, and byte count. `api/_db-client.js` must pass this wrapper to `createClient` and retain its existing timeout and retry behavior. The existing 15-second timeout and 30-second non-JSON retry are part of the measured request path and must be reported as attempts, not hidden.

- [ ] **Step 4: Implement bounded write classification**

Create `api/_write-amplification.js` with this exact finite enum:

```js
export const WRITE_KINDS = Object.freeze([
  "heartbeat",
  "telemetry",
  "cleanup",
  "event",
  "follower_delivery",
  "ai_job",
  "user_mutation",
  "maintenance",
  "unclassified"
]);
```

`classifyWrite` uses the active entry point first, then the fixed table mapping, then operation. The mapping must cover `users_meta.last_seen` heartbeat updates, `system_metrics` and `activity_logs` telemetry, `_cleanup` maintenance batches, `_events` event-log and pending-trigger writes, `_follows` notification delivery, AI/inbox/provider work, and normal user mutations. Add `recordExternalWork` calls around non-DB work: one event enqueue, one cleanup batch, one follower/provider delivery, and one provider/AI attempt. The count is the number of actual attempts, not the number of intended recipients.

- [ ] **Step 5: Instrument cache status without changing cache behavior**

In `api/_cache.js`, call `setCacheStatus("hit")` on a fresh entry, `setCacheStatus("stale")` on a stale usable entry, `setCacheStatus("miss")` on a miss, and `setCacheStatus("bypass")` for viewer-specific or no-cache branches. Do not include cache keys, user IDs, or query values in the status. Preserve the current SWR TTLs, stale TTLs, entry caps, and invalidation methods. Add a test that a stale response is reported as `stale` and that a cache miss does not change the returned product data.

- [ ] **Step 6: Instrument event, cleanup, follower, and AI call sites**

Add one call at each boundary, not one call per loop body that can double count:

- `api/_events.js`: count the persisted event row and queued agent trigger rows separately under `event`.
- `api/_cleanup.js`: count each successful delete or update batch under `cleanup`; a failed batch is not counted as a successful write.
- `api/_follows.js`: count each actual notification/provider delivery attempt under `follower_delivery`, including a failed attempt with a separate error counter.
- `api/_ai.js`, `api/_providers.js`, and `api/_inbox.js`: count each provider call or AI job attempt under `ai_job`; do not count a cached local result as a provider call.

Every call must run inside a request or synthetic worker context. A cron or worker entry point uses `entryPoint: "cron"` or `entryPoint: "worker"`, never `source`.

- [ ] **Step 7: Run focused and sequential verification**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/supabase-metrics.test.ts tests/api/write-amplification.test.ts tests/api/side-effect-free-read.test.ts
npm run typecheck
npm run lint
npm run test:api
npm run build
```

Expected: the three new tests pass, existing cache tests pass, and the side-effect-free read counter is zero for all public GET fixtures except the explicitly induced failure test.

- [ ] **Step 8: Propose the scoped human-gated commit**

```powershell
git add api/_supabase-metrics.js api/_write-amplification.js api/_db-client.js api/_cache.js api/_events.js api/_cleanup.js api/_follows.js api/_ai.js api/_providers.js api/_inbox.js tests/api/supabase-metrics.test.ts tests/api/write-amplification.test.ts tests/api/side-effect-free-read.test.ts
git commit -m "feat(observability): measure origin and write amplification"
```

Rollback: revert the instrumentation commit and promote the previous Vercel deployment. Instrumentation must be observational and must not be used to justify a data migration. If the side-effectful-read counter is nonzero, stop the validation ladder and fix the read path before increasing traffic.

## Task 4: Expose Durable Monitoring, Honest Admin Evidence, and Alert Runbooks

**Files:**
- Modify: `api/v3/_monitoring.js:18-110,116-370`
- Modify: `api/_performance.js:1-340`
- Modify: `api/_incident-cron.js:35-165,214-367`
- Modify: `api/_vitals.js:9-150`
- Modify: `src/pages/admin/PerformanceCenter.tsx:22-144,185-374`
- Modify: `src/pages/admin/Overview.tsx:60-163`
- Modify: `src/pages/admin/SystemHealth.tsx:26-110`
- Create: `docs/runbooks/observability-alerts.md`
- Test: `tests/api/monitoring-slo.test.ts`
- Test: `tests/api/vitals-durable-percentiles.test.ts`
- Test: `src/__tests__/admin-performance-evidence.test.tsx`

**Interfaces:**
- Consumes: durable metric snapshots from Task 2, amplification snapshots from Task 3, and the shared SLO policy from Task 1.
- Produces: admin-visible p50, p95, p99, cache, origin/write amplification, source state, and actionable alert conditions with a runbook link.

- [ ] **Step 1: Write failing monitoring tests**

Pin the current defects as regressions: `api/v3/_monitoring.js` must not use only the current warm instance, must not report p95 from an empty ring as healthy, and must not use the old 5 percent and 10 percent generic error thresholds for the approved load gates. Add cases for:

```ts
expect(evaluateAlerts(metricsAt(0.00001, 499, 1, 0.1))).toEqual([]);
expect(evaluateAlerts(metricsAt(0.0101, 499, 1, 0.1))[0].code).toBe("unexpected_5xx_rate");
expect(evaluateAlerts(metricsAt(0.00001, 501, 1, 0.1))[0].code).toBe("read_p95");
expect(evaluateAlerts(metricsAt(0.00001, 499, 1, 0.81))[0].code).toBe("realtime_quota");
```

Use finite `source` values: `durable`, `memory`, `unavailable`, or `not_collected`. A missing durable store must be visible in the response.

- [ ] **Step 2: Write failing Web Vitals durability tests**

Mock a fresh module instance and send one LCP, one CLS, and one INP batch. Assert the first and second request both contribute to durable counts and p50, p95, and p99 after a simulated cold start. Assert the response includes `method: "upper-bound-histogram"` and `source: "durable"`. A malformed metric is rejected or ignored according to the existing contract and never creates a bucket with a nonnumeric value.

- [ ] **Step 3: Replace warm-instance percentile reads with durable-first reads**

Change `api/v3/_monitoring.js` so `recordRequest` still updates a bounded compatibility ring but the admin action first calls `readDurableMetrics`. Return a `latency` object with `p50`, `p95`, `p99`, `count`, `method`, `source`, and `window`. Preserve the old fields as compatibility aliases only when the source is measured. Update `api/_performance.js` to use the same snapshot and to keep `api_p95_ms` as a measured alias rather than a fabricated default. Update `api/_incident-cron.js` to store the measured p50, p95, p99, error rate, cache hit rate, origin amplification, and write amplification in `system_metrics` or its existing settings snapshot; an unavailable source remains unavailable.

- [ ] **Step 4: Move Web Vitals receiver storage to the durable store**

In `api/_vitals.js`, keep the existing security and method checks, then convert each accepted metric into a bounded value: LCP, FID, INP, and TTFB in integer milliseconds; CLS in integer milli-CLS. Store value histograms under `web_vitals_value:v1` and rating counts under `web_vitals_rating_count:v1`. Use the additive RPC from Task 2, not a read-modify-write of `settings.vitals:durable`. Keep the old cumulative key readable for one release if a consumer still needs it, but mark it `legacy` and do not use it for percentiles. Return the existing `goodRate` and `avg` fields from measured rows, and add `p50`, `p95`, `p99`, `count`, `source`, and `method`.

- [ ] **Step 5: Remove observability-driven polling from the three admin surfaces**

`PerformanceCenter`, `Overview`, and `SystemHealth` must perform one initial read when entered and expose an explicit Refresh button. Remove their 30-second intervals and Realtime callbacks that exist only to refresh these metrics. Preserve manual refresh and last-known-good data with a visible stale or unavailable banner. Do not turn a failed metrics request into a zero-filled performance card. A dashboard test must assert that advancing fake timers does not issue another request and that clicking Refresh issues exactly one request.

- [ ] **Step 6: Add symptom-based alert definitions and the runbook**

Create `docs/runbooks/observability-alerts.md` with two severities only:

- Page: unexpected 5xx or timeout rate above 1 percent for 15 seconds; p99 above twice its route gate for two 30-second windows; p95 above its route gate for five minutes; database CPU above 85 percent for five minutes; database connections above 85 percent for two minutes; Realtime quota above 80 percent for 30 seconds; any safety abort.
- Ticket: mixed 429 rate above 0.1 percent for 60 seconds; cache hit-rate regression; durable source unavailable; unclassified write amplification; missing evidence report.

Each alert entry must state the metric series, threshold, duration, first query, first mitigation, escalation owner, and the exact anchor in the runbook. Use request ID plus normalized route for support lookup. The runbook must say to stop the load harness first, preserve the report, inspect Vercel logs, inspect Supabase database metrics, inspect Realtime quota, and escalate rather than retrying a failed production canary.

- [ ] **Step 7: Run focused and sequential verification**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/monitoring-slo.test.ts tests/api/vitals-durable-percentiles.test.ts
npx vitest run src/__tests__/admin-performance-evidence.test.tsx
npm run typecheck
npm run lint
npm run test:api
npm run test
npm run build
```

Expected: durable percentiles and alert codes pass, all three admin surfaces have no automatic metrics timer, and the full sequential gates remain green.

- [ ] **Step 8: Propose the scoped human-gated commit**

```powershell
git add api/v3/_monitoring.js api/_performance.js api/_incident-cron.js api/_vitals.js src/pages/admin/PerformanceCenter.tsx src/pages/admin/Overview.tsx src/pages/admin/SystemHealth.tsx docs/runbooks/observability-alerts.md tests/api/monitoring-slo.test.ts tests/api/vitals-durable-percentiles.test.ts src/__tests__/admin-performance-evidence.test.tsx
git commit -m "feat(observability): surface durable SLO evidence"
```

Rollback: promote the previous Vercel deployment and set durable ingest disabled if the new monitoring path is noisy. Do not delete `system_metrics` rows as an application rollback; preserve evidence for incident review.

---
## Task 5: Propagate Client Request IDs and Make Web Vitals Sampling Honest

**Files:**
- Modify: `src/lib/api.ts:22-46,191-385`
- Modify: `src/lib/vitals.ts:45-101,200-218`
- Modify: `src/lib/errors.ts:78-97,185-200`
- Test: `src/__tests__/api.test.ts`
- Test: `src/__tests__/vitals.test.ts`
- Create: `src/__tests__/errors.test.ts`

**Interfaces:**
- Consumes: the canonical request-ID header and redacted route labels from Task 1.
- Produces: one client request ID per logical request, an ID on `ApiError`, normalized frontend error route data, and sampled Web Vitals that flush without a recurring timer.

- [ ] **Step 1: Write failing client request-ID tests**

Mock `fetch` and assert the first call includes `X-Request-ID`, a GET retry reuses the same ID, and a 500 response creates an `ApiError` whose `requestId` equals the response header. Add a test that a response without the header still has a locally generated ID available for the error path. Do not expose the ID as a metric label.

Run:

```powershell
npx vitest run src/__tests__/api.test.ts -t "request id"
```

Expected: FAIL because `ApiError` currently has no request ID and the request wrapper sends no request-ID header.

- [ ] **Step 2: Write failing Web Vitals scheduling tests**

Use fake timers and mocked `PerformanceObserver` instances. Assert:

```ts
expect(vi.getTimerCount()).toBe(0);
bufferMetric("LCP", 1200, "good");
expect(vi.getTimerCount()).toBe(0);
bufferMetric("CLS", 20, "poor");
flushOnPageHide();
expect(fetchMock).toHaveBeenCalledWith("/api/vitals", expect.objectContaining({ keepalive: true }));
```

Add cases for a batch-size threshold flush, `pagehide`, `visibilitychange: hidden`, `beforeunload`, one LCP per navigation, one final CLS per navigation, and no raw `location.pathname` with an ID or query. Ordinary LCP and TTFB samples use a deterministic 10 percent sampler; CLS and INP are always eligible but remain bounded by the per-navigation deduplication and rate cap.

- [ ] **Step 3: Implement one logical request ID in `src/lib/api.ts`**

Add a local helper before `request`:

```ts
let lastRequestId: string | null = null;

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getLastRequestId(): string | null {
  return lastRequestId;
}
```

Create the ID once before `doFetch`, set `lastRequestId`, add `headers["X-Request-ID"] = requestId`, and read `res.headers.get("X-Request-ID")` after every response. Extend `ApiError` with `readonly requestId: string | null`, pass it into the constructor, and preserve the existing `status` and `retryAfter` fields. Do not queue or replay a request based on this ID; it is correlation only.

- [ ] **Step 4: Remove the recurring Vitals timer and implement bounded flushing**

Replace the five-second `scheduleFlush` timer with a threshold-or-lifecycle policy:

```ts
const VITALS_FLUSH_BATCH = 20;
const VITALS_SAMPLE_RATE = 0.10;
let buffer: VitalMetric[] = [];
let navigationSent = new Set<string>();
let flushInFlight = false;

function scheduleFlush() {
  if (buffer.length >= VITALS_FLUSH_BATCH) void flush();
}

function report(name: string, value: number, delta: number, id: string) {
  if (navigationSent.has(name)) return;
  if ((name === "LCP" || name === "TTFB") && Math.random() > VITALS_SAMPLE_RATE) return;
  if (!Number.isFinite(value) || value < 0) return;
  navigationSent.add(name);
  buffer.push(makeMetric(name, value, delta, id));
  scheduleFlush();
}
```

Use `pagehide` and `visibilitychange: hidden` as the primary flush points, retain `beforeunload` only as a final fallback, and call `navigator.sendBeacon` when available on lifecycle exit. Keep the existing 50-per-minute rate cap as a second bound. Include the batch request ID in the POST header and include only the fixed route label in each metric object. Reset per-navigation state only on a new navigation, not on a timer tick.

- [ ] **Step 5: Redact frontend error reports**

In `src/lib/errors.ts`, attach `getLastRequestId()` and a fixed `route` label from a small client route map. Replace raw `filename` URLs and `location.pathname` with a normalized path or a fixed `client_error` label. Do not include the query string, stack secrets, local storage values, cookies, email, phone, or full request body. Keep the existing 30-per-minute cap and buffer cap.

- [ ] **Step 6: Run focused and sequential verification**

```powershell
npx vitest run src/__tests__/api.test.ts src/__tests__/vitals.test.ts src/__tests__/errors.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: no Vitals interval exists, hidden and unload flushes are observable, request IDs survive retries, and the full frontend gates pass.

- [ ] **Step 7: Propose the scoped human-gated commit**

```powershell
git add src/lib/api.ts src/lib/vitals.ts src/lib/errors.ts src/__tests__/api.test.ts src/__tests__/vitals.test.ts src/__tests__/errors.test.ts
git commit -m "fix(observability): propagate request ids and sample vitals"
```

Rollback: revert this client commit. A rollback restores the previous five-second timer only as a temporary code version; it must not be combined with a capacity claim. The safe operational rollback is to disable the Vitals receiver at the edge or leave the endpoint available while reporting `not_collected`.

## Task 6: Replace the Unsafe HTTP Load Harness with Pure Safety and Journey Modules

**Files:**
- Replace: `scripts/loadtest.mjs`
- Create: `scripts/loadtest-config.mjs`
- Create: `scripts/loadtest-guard.mjs`
- Create: `scripts/loadtest-journeys.mjs`
- Create: `scripts/loadtest-metrics.mjs`
- Create: `scripts/loadtest-generator-health.mjs` is created in Task 7 but imported by the orchestrator interface
- Create: `vitest.config.load.ts`
- Create: `tests/load/loadtest-guard.test.ts`
- Create: `tests/load/loadtest-journeys.test.ts`
- Create: `tests/load/loadtest-metrics.test.ts`

**Interfaces:**
- Consumes: `api/_slo.js` policy values, current API response shapes, and the existing `scripts/loadtest.mjs` as historical evidence only.
- Produces: a no-network-at-import orchestrator, exact target/method guard, HTTPS HTTP client, corrected read journeys, bounded request statistics, and fail-closed configuration.

- [ ] **Step 1: Write the failing safety tests before replacing the script**

The safety suite must contain these named cases:

```ts
it("rejects a non-local HTTP target in staging", () => {
  expect(assertSafeTarget(configFor("staging", "http://staging.example"))).toMatchObject({ ok: false, code: "https_required" });
});
it("rejects a host outside the exact allowlist", () => {
  expect(assertSafeRequest(configFor("staging", "https://staging.example"), "GET", new URL("https://other.example/api/posts"))).toMatchObject({ ok: false, code: "host_not_allowed" });
});
it("rejects every production mutation method", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    expect(assertSafeRequest(productionConfig, method, new URL("https://voice-box.example/api/posts"))).toMatchObject({ ok: false, code: "production_mutation_forbidden" });
  }
});
it("rejects a missing expected Supabase project ref", () => {
  expect(parseLoadConfig(["--environment", "staging", "--url", "https://staging.example"], {})).toMatchObject({ ok: false, code: "supabase_ref_required" });
});
it("rejects a mismatched Supabase project ref", () => {
  expect(assertSafeTarget(stagingConfigWithWrongRef)).toMatchObject({ ok: false, code: "supabase_ref_mismatch" });
});
it("rejects provider and service-role credentials", () => {
  expect(parseLoadConfig(["--environment", "staging", "--url", "https://staging.example"], { SUPABASE_SERVICE_ROLE_KEY: "secret" }).ok).toBe(false);
});
it("rejects redirects and non-GET production paths", () => {
  expect(assertSafeRequest(productionConfig, "GET", new URL("https://voice-box.example/api/posts"))).toMatchObject({ ok: false, code: "production_api_forbidden" });
});
```

Run:

```powershell
npx vitest run --config vitest.config.load.ts tests/load/loadtest-guard.test.ts
```

Expected: FAIL until the new guard exists. The tests must mock `http.request`, `https.request`, and `WebSocket` and assert that a rejected configuration opens zero sockets.

- [ ] **Step 2: Define the exact CLI and environment contract**

`parseLoadConfig` accepts only these flags:

```text
--environment local|staging|realtime|production
--mode http|realtime|production-canary
--url https://host-or-http://127.0.0.1:5173
--allowed-host host
--supabase-url https://PROJECT_REF.supabase.co
--expected-supabase-ref PROJECT_REF
--realtime-url wss://PROJECT_REF.supabase.co/realtime/v1/websocket
--confirm-target EXACT_TARGET_ORIGIN
--allow-writes
--disposable-project
--users INTEGER
--sessions INTEGER
--rps NUMBER
--duration <seconds>
--rampup <seconds>
--hidden-ratio <0-to-1>
--out-dir PATH
--seed INTEGER
--operator NAME
--kill-switch-owner NAME
```

The following environment variables are required for remote modes and fail closed when absent: `LOADTEST_TARGET_ORIGIN`, `LOADTEST_ALLOWED_HOSTS`, `LOADTEST_EXPECTED_SUPABASE_REF`, `LOADTEST_MAX_COST_USD`, `LOADTEST_COST_RATES_JSON`, `LOADTEST_DB_CPU_LIMIT`, `LOADTEST_DB_CONNECTION_LIMIT`, `LOADTEST_REALTIME_CONNECTION_LIMIT`, and `LOADTEST_PEAK_EDGE_RPS`. Realtime mode additionally requires `SUPABASE_REALTIME_ANON_KEY`; no other provider variable is read. The harness must not import `dotenv` or call `loadEnvFiles`.

Validate `LOADTEST_COST_RATES_JSON` as an object with finite nonnegative `vercelPerThousandInvocationsUsd`, `supabaseEgressPerGbUsd`, and `realtimeMessagePerThousandUsd`. A missing numeric rate is a configuration error, not a zero cost.

- [ ] **Step 3: Implement exact-origin, protocol, redirect, and method guards**

Use `new URL`, compare `url.origin` to the configured exact origin, reject usernames, passwords, fragments, IP-literal remote hosts, and any redirect response, and require HTTPS for every non-local environment. `assertSafeRequest` is called before every request, including dynamically constructed journey URLs. For production, the only allowed method/path pairs are:

```text
HEAD /
HEAD /health-chunks.json
HEAD /assets/<immutable-hashed-file>
```

The asset pattern is `/assets/[A-Za-z0-9._-]+\\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp)$` and the filename must be supplied from the current `dist/health-chunks.json` or a human-reviewed immutable list. No production API path is allowed. A 3xx response is an error and is never followed.

- [ ] **Step 4: Replace the current HTTP client with HTTPS-aware bounded requests**

Use `node:http` only for loopback local mode and `node:https` with a keep-alive agent for every remote mode. Set a per-request timeout of 15 seconds, drain every response, cap response buffering at 1 MiB for JSON journeys, and resolve a timeout exactly once. Do not call `process.exit` from a request helper. Return:

```js
{
  status: number,
  durationMs: number,
  bytes: number,
  requestId: string,
  responseRequestId: string | null,
  outcome: "success" | "http_4xx" | "http_5xx" | "redirect" | "timeout" | "transport"
}
```

- [ ] **Step 5: Correct the read journeys and authoritative IDs**

Implement `extractRows` for an array, `{ data: [] }`, `{ posts: [] }`, and `{ post: {} }`. `extractJourneyId` accepts only a nonempty string of at most 128 characters with no whitespace. The read journey is exactly:

```text
45% GET /api/posts?paginate=1&limit=20
20% GET /api/posts?paginate=1&limit=20, then GET /api/posts/<returned id>, then GET /api/comments?post_id=<returned id>&paginate=1&limit=20
12% GET /api/search?q=<encoded fixed term>
 8% GET /api/polls
 6% GET /api/posts?type=suggestion&paginate=1&limit=20
```

Use `identity` consistently; the current `onId` typo must not survive. A journey that cannot obtain an authoritative post ID records `journey_contract_failure`; it does not fall back to a random ID or silently skip the dependent requests. URL-encode every query value. Read journeys never send a body.

- [ ] **Step 6: Implement the disposable write journey, disabled by default**

`buildDisposableWriteJourney` is constructed only when all three flags are true: `--allow-writes`, `--disposable-project`, and a Supabase ref different from the production ref. It uses the same authoritative feed ID and the `x-anon-id` header. It may create one post, one comment, one reaction, and one report per selected write window, with a bounded global write count. It must remove `author_id` and `reported_by` from bodies and derive identity from the header. It must not run in production mode, Realtime mode, or CI. A write response is counted as successful only when the server returns the expected status and an authoritative ID.

- [ ] **Step 7: Implement request metrics and status classification**

`loadtest-metrics.mjs` records route-template labels, status classes, 4xx codes, 5xx codes, 429 count, timeout count, transport error count, response bytes, and p50, p95, and p99 from a bounded sample. Do not use an average as a gate. A 404, 405, 401, 403, or any other unexpected 4xx is a correctness failure for a public read journey; 429 is tracked separately; 5xx and timeouts are server failures; redirects are safety failures. The report must include `requests`, `successes`, `http4xx`, `http5xx`, `http429`, `timeouts`, `transportErrors`, `p50Ms`, `p95Ms`, `p99Ms`, and `sampleCount`.

- [ ] **Step 8: Add hidden-tab behavior and the shared stop signal**

Each virtual user receives a stable `visibility` value from the seeded RNG. The 10,000-session final stage is exactly 80 percent foreground and 20 percent hidden. Hidden users do not issue a new action during their think interval, but their open request still drains and is measured. `createAbortController` exposes one signal to the orchestrator, request helpers, generator monitor, Realtime clients, and report writer. On abort: stop spawning, abort in-flight requests, destroy keep-alive sockets, close WebSockets, wait at most five seconds for drain, write reports, and return exit code 2.

- [ ] **Step 9: Run the offline safety suite and sequential gates**

```powershell
npx vitest run --config vitest.config.load.ts tests/load/loadtest-guard.test.ts tests/load/loadtest-journeys.test.ts tests/load/loadtest-metrics.test.ts
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run build
```

Expected: all safety tests pass with zero network calls. The old `http.request` mutation path is absent from remote mode. No remote command is part of this step.

- [ ] **Step 10: Propose the scoped human-gated commit**

```powershell
git add scripts/loadtest.mjs scripts/loadtest-config.mjs scripts/loadtest-guard.mjs scripts/loadtest-journeys.mjs scripts/loadtest-metrics.mjs vitest.config.load.ts tests/load/loadtest-guard.test.ts tests/load/loadtest-journeys.test.ts tests/load/loadtest-metrics.test.ts package.json
git commit -m "fix(load): replace unsafe remote load harness"
```

Rollback: revert the harness commit and remove no production data. A running harness is stopped with the shared abort signal, then its report directory is preserved. Never roll back a production canary by replaying mutations, because the production path has no mutations by design.

---
## Task 7: Add Generator Health, Realtime Isolation, Cost Controls, and Separate Reports

**Files:**
- Create: `scripts/loadtest-generator-health.mjs`
- Create: `scripts/loadtest-realtime.mjs`
- Create: `scripts/loadtest-report.mjs`
- Modify: `scripts/loadtest.mjs` to wire the shared monitor, Realtime mode, and report writer
- Test: `tests/load/loadtest-realtime.test.ts`
- Test: `tests/load/loadtest-report.test.ts`
- Test: `tests/load/loadtest-generator-health.test.ts`

**Interfaces:**
- Consumes: the Task 6 guard, journeys, metrics, and abort signal; Node 22.22.0 or later; a public Supabase Realtime anon key only for Realtime mode.
- Produces: generator-health samples, Realtime connection evidence, forecast-spend enforcement, four separate platform reports, one summary report, and a truthful `pass`, `fail`, `blocked`, or `aborted` verdict.

- [ ] **Step 1: Write failing generator-health tests**

Use an injected clock and injected samples so tests do not depend on the host. Pin these behaviors:

```ts
expect(evaluateGeneratorHealth({ cpuRatio: 0.86, heapRatio: 0.10, eventLoopP99Ms: 4, socketErrors: 0 }, policy, 0)).toBe("generator_cpu_saturation");
expect(evaluateGeneratorHealth({ cpuRatio: 0.10, heapRatio: 0.81, eventLoopP99Ms: 4, socketErrors: 0 }, policy, 0)).toBe("generator_heap_saturation");
expect(evaluateGeneratorHealth({ cpuRatio: 0.10, heapRatio: 0.10, eventLoopP99Ms: 101, socketErrors: 0 }, policy, 0)).toBe("generator_event_loop_saturation");
expect(evaluateGeneratorHealth({ cpuRatio: 0.10, heapRatio: 0.10, eventLoopP99Ms: 4, socketErrors: 2 }, policy, 0)).toBe("generator_socket_error_rate");
```

The evaluator must require the policy hold duration, not fire on a single sample. It must return one stable reason for a continuing condition and reset only after the condition clears.

- [ ] **Step 2: Implement the generator monitor with `perf_hooks`**

`startGeneratorMonitor` samples every one second and records:

```ts
type GeneratorSample = {
  timestamp: string;
  cpuRatio: number;
  heapRatio: number;
  rssMb: number;
  eventLoopP99Ms: number;
  activeSockets: number;
  activeWebSockets: number;
  pendingRequests: number;
  socketErrors: number;
  timeouts: number;
  transportErrors: number;
  packetLossEstimate: number;
  osCpuCount: number;
  totalMemoryMb: number;
};
```

Use `process.cpuUsage()` deltas divided by elapsed wall time and CPU count, `process.memoryUsage().rss` and `heapUsed`, `monitorEventLoopDelay({ resolution: 20 })`, and the harness-owned active socket and WebSocket counters. Call the last value `packetLossEstimate`, not packet loss: it is `(socketErrors + timeouts + transportErrors) / completedRequests`, because Node does not expose NIC packet-loss counters portably. The report must state that semantic. The monitor must call the shared abort controller on CPU above 85 percent for 30 seconds, heap above 80 percent of the configured generator heap limit for 10 seconds, event-loop p99 above 100 ms for 5 seconds, or socket error rate above 1 percent for 15 seconds.

- [ ] **Step 3: Enforce generator prerequisites before remote runs**

For staging 10,000-session and Realtime 10,000-connection stages, require at least 8 logical CPUs, 16,000 MB total memory, 8,000 MB configured generator heap, and a stable non-loopback network interface. Refuse a smaller machine with `generator_prerequisite_failed`; allow a smaller machine only for local smoke or an explicitly named lower staging stage. Record the actual `os.cpus().length`, `os.totalmem()`, Node version, platform, network interface count, and free disk before opening a remote socket. Do not use a browser or Playwright; the harness is Node-only and the approved parent plan forbids browser execution.

- [ ] **Step 4: Write failing Realtime safety tests**

Test that Realtime mode:

- requires `wss:` and an exact `*.supabase.co` host;
- extracts the project ref and compares it to `LOADTEST_EXPECTED_SUPABASE_REF`;
- uses only `SUPABASE_REALTIME_ANON_KEY` in the WebSocket query;
- refuses `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, and every other provider variable when present in the load process;
- refuses any HTTP or application mutation URL in Realtime mode;
- records connection attempts, open connections, join latency, messages, fan-out, reconnects, disconnect reasons, and quota evidence;
- aborts when configured Realtime quota utilization is above 80 percent for 30 seconds.

- [ ] **Step 5: Implement the Realtime protocol and separate ladder**

Use the Node 22 global `WebSocket` implementation. The URL is exactly `wss://PROJECT_REF.supabase.co/realtime/v1/websocket?apikey=PUBLIC_REALTIME_ANON_KEY&vsn=1.0.0`. Subscribe to one fixed non-mutating channel name per run and measure channel join. Do not send Postgres changes, broadcasts that mutate application state, or provider messages. A connection is `open` only after the WebSocket handshake and the Realtime join acknowledgment; a socket that opens without joining is a failed connection.

Run these stages separately from HTTP:

```text
100 → 500 → 1,000 → 2,500 → 5,000 → 7,500 → 9,000 → 10,000
```

At each stage, record the configured connection quota before opening sockets and the highest observed utilization. If the configured limit is exactly 10,000, the 10,000 stage is reported as `unvalidated` or `blocked`, never `pass`, because there is no headroom. Close every socket on abort or completion and wait for the close count to reach the open count before writing the report.

- [ ] **Step 6: Implement forecast-spend enforcement**

Calculate forecast spend before each stage and continuously during the run:

```text
vercelUsd = originInvocations / 1000 * vercelPerThousandInvocationsUsd
supabaseUsd = supabaseEgressBytes / 1GB * supabaseEgressPerGbUsd
realtimeUsd = realtimeMessages / 1000 * realtimeMessagePerThousandUsd
forecastUsd = vercelUsd + supabaseUsd + realtimeUsd
```

If any required rate is missing, configuration fails. If forecast spend is greater than or equal to `LOADTEST_MAX_COST_USD`, abort before the next request and report `forecast_budget_exceeded`. The report includes the rate-card version date, numeric rates, observed units, forecast, approved cap, and remaining forecast. No rate card is committed with a secret or an unverified current price.

- [ ] **Step 7: Define separate report inputs and output files**

`buildLoadReport` must produce these files under the run directory:

```text
vercel-report.json
supabase-report.json
database-report.json
realtime-report.json
summary.md
```

The exact report state enum is:

```ts
type EvidenceState = "measured" | "not_collected" | "unavailable";
```

The common fields are:

```ts
type LoadReport = {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  endedAt: string;
  environment: "local" | "staging" | "realtime" | "production";
  mode: "http" | "realtime" | "production-canary";
  target: { origin: string; allowedHosts: string[]; supabaseRef: string | null };
  safety: { passed: boolean; checks: Record<string, boolean>; abortReason: string | null; productionMutations: number };
  http: { state: EvidenceState; requests: number; successes: number; http4xx: number; http5xx: number; http429: number; timeouts: number; transportErrors: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; sampleCount: number };
  vercel: { state: EvidenceState; edgeRequests: number; originRequests: number; cacheHits: number; cacheMisses: number; coldStartEstimates: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null };
  supabase: { state: EvidenceState; requests: number; attempts: number; retries: number; errors: number; bytes: number; bytesKnown: boolean; amplificationRatio: number | null };
  database: { state: EvidenceState; cpuRatio: number | null; connectionRatio: number | null; lockWaits: number | null; deadlocks: number | null; slowStatements: number | null; failedWrites: number | null };
  writes: { state: EvidenceState; total: number; byKind: Record<string, number>; sideEffectfulReads: number; amplificationPerOriginRequest: number | null };
  realtime: { state: EvidenceState; attempts: number; open: number; joined: number; joinP95Ms: number | null; messages: number; fanout: number; reconnects: number; disconnectsByReason: Record<string, number>; quotaLimit: number | null; quotaPeakRatio: number | null };
  generator: { state: EvidenceState; samples: GeneratorSample[]; abortReason: string | null };
  cost: { state: EvidenceState; ratesVersion: string | null; forecastUsd: number | null; capUsd: number | null; withinBudget: boolean | null };
  verdict: "pass" | "fail" | "blocked" | "aborted";
};
```

A missing database snapshot is `not_collected`; a dashboard that cannot be reached is `unavailable`; neither is rendered as zero. `summary.md` states the exact highest verified stage and the blocker.

- [ ] **Step 8: Add report tests for redaction and verdict honesty**

Assert that a report with missing database evidence cannot be `pass`, a production report with one mutation is `aborted`, a 5xx breach is `fail`, a wrong host is `aborted` before request count is nonzero, and no JSON field contains a secret, raw URL query, request body, or raw identity. Assert that the Markdown summary includes p50, p95, p99, 429s, amplification, database resource state, Realtime headroom, cost, and abort reason.

- [ ] **Step 9: Run focused and sequential verification**

```powershell
npx vitest run --config vitest.config.load.ts tests/load/loadtest-generator-health.test.ts tests/load/loadtest-realtime.test.ts tests/load/loadtest-report.test.ts
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run build
```

Expected: safety, generator, Realtime, report, and redaction tests pass with no remote connection. A machine prerequisite failure is a testable configuration outcome, not a reason to bypass the guard.

- [ ] **Step 10: Propose the scoped human-gated commit**

```powershell
git add scripts/loadtest.mjs scripts/loadtest-generator-health.mjs scripts/loadtest-realtime.mjs scripts/loadtest-report.mjs tests/load/loadtest-generator-health.test.ts tests/load/loadtest-realtime.test.ts tests/load/loadtest-report.test.ts
git commit -m "feat(load): add realtime health and evidence reports"
```

Rollback: stop the shared abort signal, close sockets, preserve all generated reports, then revert the harness commit. Never delete evidence to make a failed run appear clean.

---
## Task 8: Integrate Only Offline Safety Checks in CI and Add a Protected Manual Runner

**Files:**
- Modify: `package.json:9-22`
- Create: `vitest.config.load.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/load-validation.yml`
- Test: `tests/load/loadtest-ci-contract.test.ts`

**Interfaces:**
- Consumes: the pure load modules and report builder from Tasks 6 and 7.
- Produces: a deterministic offline safety job on pull requests and pushes, plus a manual protected workflow for operator-approved staging, Realtime, and production-read-only validation.

- [ ] **Step 1: Write the failing CI contract test**

Read the workflow and package files as text and assert:

```ts
expect(ci).toContain("test:load-safety");
expect(ci).toContain("needs: [lint, typecheck, test]");
expect(ci).not.toContain("scripts/loadtest.mjs --environment production");
expect(manualWorkflow).toContain("workflow_dispatch");
expect(manualWorkflow).toContain("loadtest-production");
expect(manualWorkflow).not.toContain("push:");
expect(manualWorkflow).not.toContain("pull_request:");
```

The test must also assert that the offline job contains no `SUPABASE_SERVICE_ROLE_KEY`, provider key, deployment, or remote URL. Run:

```powershell
npx vitest run --config vitest.config.load.ts tests/load/loadtest-ci-contract.test.ts
```

Expected: FAIL until the scripts and workflow files exist.

- [ ] **Step 2: Add the package scripts and isolated Vitest config**

Add these exact scripts to `package.json`:

```json
{
  "test:load-safety": "vitest run --config vitest.config.load.ts",
  "loadtest": "node scripts/loadtest.mjs"
}
```

Create `vitest.config.load.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/load/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    maxWorkers: 1
  }
});
```

The single worker is deliberate: the safety tests inspect process-global fake sockets and must not race each other. No load test is started by importing a module; `scripts/loadtest.mjs` must guard its CLI entry with an `import.meta.url` comparison.

- [ ] **Step 3: Add the offline CI job after existing gates**

Append a job to `.github/workflows/ci.yml` with `needs: [lint, typecheck, test]`, `timeout-minutes: 5`, Node 22, `npm ci`, and `npm run test:load-safety`. It must not call `npm run dev`, deploy Vercel, call Supabase, open a WebSocket, or use a remote URL. Upload `voice-box/test-results/load-safety/` on failure. Do not change the existing E2E workflow or deploy workflow behavior in this task.

The exact job shape is:

```yaml
  load-safety:
    name: Load harness safety (offline)
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: voice-box/package-lock.json
      - name: Install dependencies
        working-directory: voice-box
        run: npm ci
      - name: Run offline load safety tests
        working-directory: voice-box
        run: npm run test:load-safety
      - name: Upload load safety results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: load-safety-results
          path: voice-box/test-results/load-safety/
          retention-days: 7
```

- [ ] **Step 4: Add the protected manual workflow**

Create `.github/workflows/load-validation.yml` with only `workflow_dispatch`. The workflow has three jobs or one job with a protected environment selected from the input. The repository owner must create protected GitHub environments named `loadtest-staging`, `loadtest-realtime`, and `loadtest-production` with required reviewers before this workflow can be used. The workflow must set `concurrency`, `permissions: contents: read`, a 90-minute timeout, and upload all reports after every run.

The dispatch inputs are exact:

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Validation environment
        required: true
        type: choice
        options:
          - staging
          - realtime
          - production
      mode:
        description: Harness mode
        required: true
        type: choice
        options:
          - http
          - realtime
          - production-canary
      operator:
        description: Named operator
        required: true
        type: string
      kill_switch_owner:
        description: Independent kill-switch owner
        required: true
        type: string
```

The job passes values through environment variables, not unvalidated command interpolation. It may use only these repository secrets: `LOADTEST_TARGET_ORIGIN`, `LOADTEST_ALLOWED_HOSTS`, `LOADTEST_EXPECTED_SUPABASE_REF`, `LOADTEST_MAX_COST_USD`, `LOADTEST_COST_RATES_JSON`, `LOADTEST_DB_CPU_LIMIT`, `LOADTEST_DB_CONNECTION_LIMIT`, `LOADTEST_REALTIME_CONNECTION_LIMIT`, `LOADTEST_PEAK_EDGE_RPS`, and `SUPABASE_REALTIME_ANON_KEY` for Realtime mode. It must not receive `SUPABASE_SERVICE_ROLE_KEY` or any AI/email provider key. The command is selected by a checked-in script or a shell case that calls `scripts/loadtest.mjs` with the exact mode; the production branch is allowed only when the protected production environment approves it and the harness itself still enforces static `HEAD` paths.

- [ ] **Step 5: Run the CI contract and full sequential local gates**

```powershell
npx vitest run --config vitest.config.load.ts tests/load/loadtest-ci-contract.test.ts
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run test:load-safety
npm run build
```

Expected: the offline safety suite is green, no remote connection is attempted, and the existing deploy workflow remains unchanged except for no new automatic load step.

- [ ] **Step 6: Propose the scoped human-gated commit**

```powershell
git add package.json vitest.config.load.ts .github/workflows/ci.yml .github/workflows/load-validation.yml tests/load/loadtest-ci-contract.test.ts
git commit -m "ci(load): add offline safety and protected runner"
```

Rollback: revert the workflow commit. A manual workflow that has already started is stopped through its concurrency cancellation or the operator kill switch; do not cancel a database migration or deployment from this workflow.

---
## Task 9: Execute the Validation Ladder and Publish Honest Evidence

**Files:**
- Create: `docs/performance/load-validation/README.md`
- Create: `docs/performance/load-validation/SCHEMA.md`
- Create: `docs/performance/load-validation/RUNBOOK.md`
- Modify: `docs/PERF.md`
- Generated only after a human-approved run: `docs/performance/load-validation/runs/RUN_ID_UTC/vercel-report.json`
- Generated only after a human-approved run: `docs/performance/load-validation/runs/RUN_ID_UTC/supabase-report.json`
- Generated only after a human-approved run: `docs/performance/load-validation/runs/RUN_ID_UTC/database-report.json`
- Generated only after a human-approved run: `docs/performance/load-validation/runs/RUN_ID_UTC/realtime-report.json`
- Generated only after a human-approved run: `docs/performance/load-validation/runs/RUN_ID_UTC/summary.md`

**Interfaces:**
- Consumes: the completed instrumentation, protected manual runner, generator monitor, report writer, approved plan quotas, numeric cost rates, and disposable staging project.
- Produces: a reproducible evidence package and one of the two permitted final capacity statements, with the exact highest verified stage and blocker.

- [ ] **Step 1: Add the final configuration fields before any remote run**

The Task 6 parser must also accept these exact fields, and the report must record them:

```text
--condition cold|warm|mixed
--window-seconds 60
--max-sessions INTEGER
--max-rps NUMBER
--budget-usd NUMBER
```

`LOADTEST_SUPABASE_URL` is required for staging, Realtime, and production-read-only configuration and must match `LOADTEST_EXPECTED_SUPABASE_REF`. `LOADTEST_ALLOWED_HOSTS` is a comma-separated exact-origin list, not a suffix wildcard. `LOADTEST_PEAK_EDGE_RPS` is the measured current peak edge traffic used for the production cap. Missing values fail before a socket is opened.

- [ ] **Step 2: Create the operator README, schema, and runbook before running traffic**

`docs/performance/load-validation/README.md` must document the approval chain, the four environment modes, the protected GitHub environments, the local generator prerequisites, the numeric budget variables, and the rule that no stage is a pass without its report.

`docs/performance/load-validation/SCHEMA.md` must contain the exact `LoadReport` fields from Task 7, the `EvidenceState` enum, the fixed metric names, the fixed route templates, the write-kind enum, the abort codes, and the rule that `requestId` is correlation-only. It must state that histogram percentiles are upper-bound estimates and include `count` and `method`.

`docs/performance/load-validation/RUNBOOK.md` must contain the operator sequence:

1. Verify the exact target and expected Supabase ref without printing secrets.
2. Verify the Vercel plan, Log Drain, function duration, edge peak, and budget.
3. Verify the Supabase plan, database CPU, connection limit, storage, and Realtime quotas.
4. Verify the dedicated staging project is disposable and contains no production data.
5. Verify the named operator and independent kill-switch owner are present.
6. Run the local smoke and safety tests.
7. Run the staging HTTP ladder.
8. Run the Realtime ladder separately.
9. Run the production static canary only after the staging and Realtime gates pass.
10. Preserve reports and publish only the highest verified statement.

- [ ] **Step 3: Run the local integration ladder**

Start the local server in a separate terminal only after the shared worktree has been checked:

```powershell
npm run dev -- --host 127.0.0.1
```

In a second terminal, run these exact stages. The local target is the only mode allowed to use HTTP:

```powershell
node scripts/loadtest.mjs --environment local --mode http --url http://127.0.0.1:5173 --allowed-host 127.0.0.1:5173 --confirm-target http://127.0.0.1:5173 --users 10 --duration 120 --rampup 10 --hidden-ratio 0.20 --seed 101 --out-dir docs/performance/load-validation/runs/local-10
node scripts/loadtest.mjs --environment local --mode http --url http://127.0.0.1:5173 --allowed-host 127.0.0.1:5173 --confirm-target http://127.0.0.1:5173 --users 50 --duration 300 --rampup 30 --hidden-ratio 0.20 --seed 102 --out-dir docs/performance/load-validation/runs/local-50
node scripts/loadtest.mjs --environment local --mode http --url http://127.0.0.1:5173 --allowed-host 127.0.0.1:5173 --confirm-target http://127.0.0.1:5173 --users 200 --duration 600 --rampup 60 --hidden-ratio 0.20 --seed 103 --out-dir docs/performance/load-validation/runs/local-200
```

Each run must record generator health, request outcomes, p50, p95, p99, and the read journey contract. Local Vite results are correctness evidence only. Repeat the 200-session stage with `--allow-writes --disposable-project` only against a disposable local database; verify read-after-write, authorization, expected 4xx behavior, and cleanup. A local failure blocks remote validation.

- [ ] **Step 4: Run the dedicated staging HTTP ladder**

Before the first command, run this PowerShell preflight. It reads no secret value into the report and fails closed on a missing prerequisite:

```powershell
$required = @("LOADTEST_TARGET_ORIGIN","LOADTEST_ALLOWED_HOSTS","LOADTEST_EXPECTED_SUPABASE_REF","LOADTEST_SUPABASE_URL","LOADTEST_MAX_COST_USD","LOADTEST_COST_RATES_JSON","LOADTEST_DB_CPU_LIMIT","LOADTEST_DB_CONNECTION_LIMIT","LOADTEST_REALTIME_CONNECTION_LIMIT","LOADTEST_PEAK_EDGE_RPS")
foreach ($name in $required) { if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) { throw "Missing required load-test prerequisite: $name" } }
if ([double]$env:LOADTEST_MAX_COST_USD -le 0) { throw "LOADTEST_MAX_COST_USD must be greater than zero" }
```

Run the three rate stages exactly:

```powershell
node scripts/loadtest.mjs --environment staging --mode http --url $env:LOADTEST_TARGET_ORIGIN --allowed-host $env:LOADTEST_ALLOWED_HOSTS --supabase-url $env:LOADTEST_SUPABASE_URL --expected-supabase-ref $env:LOADTEST_EXPECTED_SUPABASE_REF --confirm-target $env:LOADTEST_TARGET_ORIGIN --rps 1 --duration 300 --rampup 30 --hidden-ratio 0.20 --seed 201 --out-dir docs/performance/load-validation/runs/staging-1rps
node scripts/loadtest.mjs --environment staging --mode http --url $env:LOADTEST_TARGET_ORIGIN --allowed-host $env:LOADTEST_ALLOWED_HOSTS --supabase-url $env:LOADTEST_SUPABASE_URL --expected-supabase-ref $env:LOADTEST_EXPECTED_SUPABASE_REF --confirm-target $env:LOADTEST_TARGET_ORIGIN --rps 10 --duration 300 --rampup 30 --hidden-ratio 0.20 --seed 202 --out-dir docs/performance/load-validation/runs/staging-10rps
node scripts/loadtest.mjs --environment staging --mode http --url $env:LOADTEST_TARGET_ORIGIN --allowed-host $env:LOADTEST_ALLOWED_HOSTS --supabase-url $env:LOADTEST_SUPABASE_URL --expected-supabase-ref $env:LOADTEST_EXPECTED_SUPABASE_REF --confirm-target $env:LOADTEST_TARGET_ORIGIN --rps 100 --duration 120 --rampup 10 --hidden-ratio 0.20 --seed 203 --out-dir docs/performance/load-validation/runs/staging-100rps
```

The 100 RPS run must use a fresh deployment. Then run the open-model stages with five one-minute windows per stage. The fixed stage array is `100,500,1000,2500,5000,7500,10000`; the fixed final mix is 80 percent foreground and 20 percent hidden. A PowerShell loop is allowed only after the preflight passes:

```powershell
$stages = @(100,500,1000,2500,5000,7500,10000)
foreach ($sessions in $stages) {
  node scripts/loadtest.mjs --environment staging --mode http --url $env:LOADTEST_TARGET_ORIGIN --allowed-host $env:LOADTEST_ALLOWED_HOSTS --supabase-url $env:LOADTEST_SUPABASE_URL --expected-supabase-ref $env:LOADTEST_EXPECTED_SUPABASE_REF --confirm-target $env:LOADTEST_TARGET_ORIGIN --sessions $sessions --duration 300 --window-seconds 60 --rampup 60 --hidden-ratio 0.20 --condition mixed --seed (210 + $sessions) --out-dir "docs/performance/load-validation/runs/staging-$sessions"
  if ($LASTEXITCODE -ne 0) { throw "Staging stage $sessions failed; do not continue" }
}
```

A stage passes only when all five one-minute windows pass, the correctness counters are zero failures, unexpected 5xx and timeout rate is at most 0.01 percent, mixed 429 rate is at most 0.02 percent, p95 and p99 gates hold, the database snapshot is measured, and cost remains within the approved cap. Repeat the final 10,000-session stage three times with `--condition cold`, `--condition warm`, and `--condition mixed`, using seeds 10001, 10002, and 10003. Do not combine a failed run with a later passing run.

- [ ] **Step 5: Run the Realtime isolation ladder separately**

Verify the public anon key and the exact Realtime URL without printing the key:

```powershell
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_REALTIME_ANON_KEY)) { throw "SUPABASE_REALTIME_ANON_KEY is required for Realtime mode" }
$realtimeStages = @(100,500,1000,2500,5000,7500,9000,10000)
foreach ($connections in $realtimeStages) {
  node scripts/loadtest.mjs --environment realtime --mode realtime --url $env:LOADTEST_TARGET_ORIGIN --supabase-url $env:LOADTEST_SUPABASE_URL --expected-supabase-ref $env:LOADTEST_EXPECTED_SUPABASE_REF --realtime-url ("wss://" + $env:LOADTEST_EXPECTED_SUPABASE_REF + ".supabase.co/realtime/v1/websocket") --confirm-target $env:LOADTEST_TARGET_ORIGIN --connections $connections --duration 300 --window-seconds 60 --rampup 60 --seed (300 + $connections) --out-dir "docs/performance/load-validation/runs/realtime-$connections"
  if ($LASTEXITCODE -ne 0) { throw "Realtime stage $connections failed; do not continue" }
}
```

The Realtime report must include quota limit, quota peak, join p95, messages, fan-out, reconnects, and disconnect reasons. A quota exactly equal to 10,000 makes the 10,000 stage `unvalidated`, not passed. Realtime runs never send application mutations and never use a service-role or provider key.

- [ ] **Step 6: Run the production static or CDN read-only canary**

This step is allowed only after local, staging, and Realtime evidence is complete, a named operator and independent kill-switch owner are recorded, and the production protected environment is approved. Derive one immutable asset from the current build manifest, then calculate the cap as the lower of 100 RPS and 0.5 percent of measured peak edge traffic:

```powershell
$peak = [double]$env:LOADTEST_PEAK_EDGE_RPS
$capRps = [Math]::Min(100.0, [Math]::Floor($peak * 0.005))
if ($capRps -lt 1) { throw "Production canary cap is below 1 RPS; do not run" }
$manifest = Get-Content -LiteralPath dist/health-chunks.json | ConvertFrom-Json
$asset = $manifest.chunks | Where-Object { $_.name -match "\.js$" } | Select-Object -First 1
if ($null -eq $asset) { throw "No immutable JavaScript asset is present in dist/health-chunks.json" }
$productionTarget = $env:LOADTEST_TARGET_ORIGIN
$productionHost = $env:LOADTEST_ALLOWED_HOSTS.Split(",")[0].Trim()
$ramps = @(@{rps=1;seconds=300},@{rps=5;seconds=600},@{rps=25;seconds=900},@{rps=100;seconds=1800})
foreach ($ramp in $ramps) {
  if ($ramp.rps -gt $capRps) { continue }
  node scripts/loadtest.mjs --environment production --mode production-canary --url $productionTarget --allowed-host $productionHost --confirm-target $productionTarget --expected-supabase-ref $env:LOADTEST_EXPECTED_SUPABASE_REF --rps $ramp.rps --duration $ramp.seconds --rampup 30 --asset-path ("/assets/" + $asset.name) --out-dir ("docs/performance/load-validation/runs/production-" + $ramp.rps + "rps")
  if ($LASTEXITCODE -ne 0) { throw "Production read-only canary failed; stop and invoke incident review" }
}
```

The production harness is hard-limited to `HEAD /`, `HEAD /health-chunks.json`, and `HEAD /assets/IMMUTABLE_HASHED_FILENAME`. It must not call `/api/posts`, `/api/comments`, `/api/vitals`, `/api/errors`, or any other API route. A production report with `productionMutations` greater than zero is an immediate abort and incident-review condition, even if all HTTP statuses are successful.

- [ ] **Step 7: Enforce the complete automatic abort matrix**

The shared monitor must abort immediately for wrong environment or host, any unexpected production mutation, 5xx or timeout rate above 1 percent for 15 seconds, 5xx or timeout rate above 0.1 percent for 60 seconds, 429 rate above 0.1 percent for 60 seconds, p99 above twice its gate for two 30-second windows, p95 above its gate for five minutes, Supabase CPU above 85 percent for five minutes, database connections above 85 percent for two minutes, lock waits, deadlocks, retry storms, failed write acknowledgements, Realtime quota above 80 percent for 30 seconds, generator saturation, or forecast spend at or above the approved cap. The report must name the first condition that fired, the UTC time, the last safe sample, and the kill-switch owner.

Abort procedure:

```powershell
# The harness owns the AbortController and closes sockets. The operator confirms the report exists.
if (-not (Test-Path -LiteralPath "docs/performance/load-validation/runs")) { throw "Expected evidence directory is missing" }
```

Do not retry automatically. Preserve the partial JSON and Markdown reports, stop the staging deployment if the failure is application-side, promote the previous Vercel deployment when a code regression is confirmed, and open an incident review for any unexplained mutation, correctness mismatch, lock/deadlock signal, or sustained saturation.

- [ ] **Step 8: Update the performance ledger without rewriting history**

In `docs/PERF.md`:

- Keep the 2026-08-26 local results labeled historical and dev-topology-limited.
- Remove any statement that the retired harness is eligible for remote use.
- Add links to the new schema and runbook.
- Add one row per completed validation stage with UTC date, target environment, exact target origin class, Supabase ref verification result, session count, duration, condition, p50, p95, p99, 5xx, 429, timeout, origin amplification, database state, Realtime state, cost, and verdict.
- Do not copy secrets, raw URLs with queries, request IDs as labels, or unredacted dashboard exports.
- If a stage is blocked, write the exact blocker and the next safe evidence needed.

- [ ] **Step 9: Run final sequential verification and publish one capacity statement**

After the evidence package is complete, run:

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run test:load-safety
npm run build
```

Then use exactly one of these statements:

```text
Verified for 10,000 simultaneously active users, with recorded evidence and headroom.
```

or:

```text
Verified to the highest active-user count recorded in the evidence report; blocked at the next stage by the exact evidence-backed limitation recorded in that report.
```

The second form must name the highest stage that passed, the exact stage that failed or was blocked, the measured threshold or missing prerequisite, the UTC time, the report paths, the named operator, and the independent kill-switch owner. Do not use “fully optimized,” “10,000-user ready,” or “production safe” while any report is `not_collected`, any durable source is unavailable, any Realtime quota lacks headroom, any database evidence is missing, or any correctness counter is nonzero.

- [ ] **Step 10: Propose the final human-gated documentation commit**

```powershell
git add docs/performance/load-validation/README.md docs/performance/load-validation/SCHEMA.md docs/performance/load-validation/RUNBOOK.md docs/PERF.md docs/performance/load-validation/runs
 git commit -m "docs(observability): publish load validation evidence"
```

The run directory is added only after the human has approved the evidence and checked it for secrets and PII. Rollback is a documentation revert; it never deletes or rewrites a failed run report.

## Plan Self-Review

Before handing this plan to an implementer, review it against both approved source documents and confirm all of the following:

- [ ] Every route/control/API observability requirement in the design has a named signal, bounded label, and test owner.
- [ ] The current gateway ID replacement, raw pathname logging, average-only metrics, in-memory percentiles, five-second Vitals timer, and unsafe load harness defects are explicitly addressed.
- [ ] The current `onId` typo, incorrect `/api/comments/:id` and `/api/suggestions` paths, mutation journeys, and `http.request` remote path are explicitly removed or corrected.
- [ ] GET/HEAD side-effect freedom is preserved while durable telemetry uses Log Drain and an authenticated ingest endpoint.
- [ ] The migration is additive, atomic, service-role-only, catalog-reviewed, human-gated, and has a rollback path; no index migration appears in this plan.
- [ ] Production mode has no API route and no mutation method, and its traffic cap is computed from measured peak edge traffic.
- [ ] Realtime, Supabase, Vercel, database, generator, and cost evidence have separate report files and honest `not_collected` or `unavailable` states.
- [ ] Every remote run has an exact host, exact origin, expected Supabase ref, HTTPS or WSS check, named operator, independent kill-switch owner, numeric budget, and platform prerequisites.
- [ ] No test or CI job opens a remote socket, uses provider credentials, deploys, applies a migration, or sends production traffic.
- [ ] All shared function names, metric names, enum values, report fields, and commands are consistent across tasks.
- [ ] The plan contains no unresolved placeholder, guessed URL, guessed password, guessed quota, or fabricated capacity number.

## Definition of Done for This Plan

This implementation plan is complete when the future implementation has:

1. A normalized request ID and route event for every API response, with redaction and no cardinality leak.
2. Durable p50, p95, and p99 for server requests and Web Vitals, with source and histogram method visible.
3. Origin and business-write amplification counters with side-effectful-read detection.
4. A remote load harness that fails before a socket on wrong host, wrong ref, unsafe method, missing allowlist, missing budget, missing prerequisites, or provider credentials.
5. Correct current API journeys, authoritative IDs, status classification, generator-health aborts, and Realtime isolation.
6. Separate Vercel, Supabase, database, Realtime, and summary evidence files.
7. Offline CI safety coverage and a protected manual remote workflow.
8. A local, staging, Realtime, and production-read-only evidence ladder with no production mutation path.
9. A human-approved final statement that reports the highest verified level and the exact blocker when the target is not fully proven.