# Refresh Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the perceived five-second reload/flicker/skeleton cycle by separating request deduplication from response caching, standardizing quiet refresh state, and removing dead refresh sources.

**Architecture:** Keep the existing `api` wrapper’s in-flight deduplication, concurrency cap, timeout handling, and offline write queue. Remove the global successful-GET TTL. Add a small request-diagnostic event stream for development/integration evidence, then add a shared `useResourceRefresh` hook that preserves last-known data during silent refresh and exposes explicit stale/error states.

**Tech Stack:** TypeScript, React 19, Vitest, React Testing Library, existing `src/lib/api.ts`, `src/lib/useRealtime.ts`, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-09-24-voice-box-reliability-admin-rebuild-design.md`

## Global Constraints

- No browser automation.
- No deployment, commit, push, or secret rotation.
- Do not delete, skip, or weaken existing tests.
- Every production change begins with a failing test and a re-run of the original failure.
- Keep in-flight GET deduplication and `MAX_INFLIGHT = 6`.
- Do not introduce a recurring five-second page refresh.
- Background refresh must preserve current rows and expose stale/unavailable state.
- Do not log tokens, query strings, message bodies, or personal data.

## Review Focus

- Two identical sequential GETs must perform two requests after the success cache is removed; simultaneous GETs must still perform one request.
- A failed realtime refresh must not clear current data.
- A late response from an unmounted view must not update state.
- A view must not schedule a five-second timer for passive data.
- A manual refresh must be visibly distinct from initial loading.

---

### Task 1: Replace the global GET TTL with in-flight-only deduplication

**Files:**
- Modify: `src/lib/api.ts:89-136,217-226,287-300,380-388`
- Modify: `src/__tests__/api.test.ts:188-258`

**Interfaces:**
- Produces: `resetConcurrencyForTests()` still clears `inflight`, `inflightCount`, and `waitQueue`; no successful response cache remains.
- Produces: `api.get(path)` always starts a new request unless an identical GET is already in flight; `api.getFresh(path)` remains an explicit bypass for realtime callers.

- [ ] **Step 1: Write the failing regression test**

Replace the current “serves the second identical GET from cache” test in `src/__tests__/api.test.ts` with:

```ts
it("deduplicates only simultaneous GETs, not completed responses", async () => {
  fetchMock.mockResolvedValue(okResponse({ n: 1 }));

  await api.get("/api/sequential");
  await api.get("/api/sequential");

  expect(fetchMock).toHaveBeenCalledTimes(2);
});
```

Keep the existing simultaneous in-flight test and the admin/public viewer separation tests.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/__tests__/api.test.ts
```

Expected: the new test fails because the second completed GET is served from the five-second response cache.

- [ ] **Step 3: Remove successful-response cache state**

In `src/lib/api.ts`:

1. Remove `getCache` and `GET_CACHE_TTL_MS`.
2. Remove the cache lookup branch from the GET path.
3. Remove the successful-GET `getCache.set(...)` block.
4. Remove `getCache.clear()` from `resetConcurrencyForTests()` and the successful-write invalidation block.
5. Keep the `inflight` map, `inflightCount`, `waitQueue`, timeout, retry, and concurrency code unchanged.

The resulting GET flow must be:

```ts
if (method === "GET") {
  const key = cacheKey(method, path, viewerKey);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run src/__tests__/api.test.ts
```

Expected: all `api.test.ts` tests pass, including simultaneous deduplication and sequential re-fetch behavior.

- [ ] **Step 5: Run the concurrency regression test**

Run:

```powershell
npx vitest run src/__tests__/api-concurrency.test.ts
```

Expected: `MAX_INFLIGHT` behavior remains unchanged.

- [ ] **Step 6: Verification checkpoint**

Do not commit. Record the focused test output and leave the working tree unchanged except for the test and implementation files.

---

### Task 2: Add bounded request diagnostics without exposing sensitive data

**Files:**
- Create: `src/lib/requestDiagnostics.ts`
- Create: `src/__tests__/requestDiagnostics.test.ts`
- Modify: `src/lib/api.ts:195-388`

**Interfaces:**

```ts
export type RequestDiagnostic = {
  id: string;
  method: string;
  path: string;
  durationMs: number;
  outcome: "success" | "error" | "retry";
  attempt: number;
};

export function subscribeRequestDiagnostics(
  listener: (event: RequestDiagnostic) => void,
): () => void;

export function emitRequestDiagnostic(event: RequestDiagnostic): void;
```

The `path` must contain only `new URL(path, "http://local").pathname`; it must never include the query string.

- [ ] **Step 1: Write failing diagnostics tests**

Create `src/__tests__/requestDiagnostics.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  emitRequestDiagnostic,
  subscribeRequestDiagnostics,
} from "../lib/requestDiagnostics";

describe("request diagnostics", () => {
  it("delivers events to subscribers and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRequestDiagnostics(listener);

    emitRequestDiagnostic({
      id: "req-1",
      method: "GET",
      path: "/api/posts",
      durationMs: 12,
      outcome: "success",
      attempt: 0,
    });
    unsubscribe();
    emitRequestDiagnostic({
      id: "req-2",
      method: "GET",
      path: "/api/comments",
      durationMs: 9,
      outcome: "error",
      attempt: 0,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ id: "req-1" });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run src/__tests__/requestDiagnostics.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the bounded event registry**

Create `src/lib/requestDiagnostics.ts` with a `Set` of listeners. `emitRequestDiagnostic` must iterate over a copied listener set and catch listener exceptions so diagnostics can never break a request. `subscribeRequestDiagnostics` must add the listener and return an idempotent unsubscribe function.

- [ ] **Step 4: Instrument `api.ts`**

At the start of `request`, create an id using `crypto.randomUUID()` when available and a timestamp/counter fallback otherwise. Emit only these fields:

```ts
{
  id,
  method,
  path: new URL(path, "http://local").pathname,
  durationMs: Math.max(0, Date.now() - startedAt),
  outcome,
  attempt,
}
```

Emit `retry` immediately before a GET retry and `success` or `error` in the existing terminal paths. Do not add console logging or store events globally beyond the listener set.

- [ ] **Step 5: Run the diagnostics and API tests**

Run:

```powershell
npx vitest run src/__tests__/requestDiagnostics.test.ts src/__tests__/api.test.ts
```

Expected: both suites pass.

- [ ] **Step 6: Verification checkpoint**

Do not commit. Confirm no diagnostic event contains `anon_id`, `token`, `body`, or the original query string.

---

### Task 3: Add the shared quiet-refresh resource state

**Files:**
- Create: `src/hooks/useResourceRefresh.ts`
- Create: `src/__tests__/useResourceRefresh.test.tsx`
- Modify: `src/hooks/useInfiniteScroll.ts:69-112,158-201`
- Modify: `src/__tests__/useInfiniteScroll.test.tsx:118-128`

**Interfaces:**

```ts
export type ResourceStatus =
  | "loading"
  | "refreshing"
  | "success"
  | "stale"
  | "error";

export interface ResourceRefreshState<T> {
  data: T | null;
  status: ResourceStatus;
  error: string | null;
  lastUpdated: string | null;
  refresh: (mode?: "initial" | "silent") => Promise<void>;
}

export function useResourceRefresh<T>(
  fetcher: () => Promise<T>,
  initialData: T | null = null,
): ResourceRefreshState<T>;
```

- [ ] **Step 1: Write failing hook tests**

Create `src/__tests__/useResourceRefresh.test.tsx` with tests for:

```ts
it("keeps last-known data during a silent refresh", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ value: "first" })
    .mockResolvedValueOnce({ value: "second" });
  const { result } = renderHook(() => useResourceRefresh(fetcher, { value: "initial" }));

  await waitFor(() => expect(result.current.status).toBe("success"));
  await act(async () => {
    await result.current.refresh("silent");
  });

  expect(result.current.data).toEqual({ value: "second" });
  expect(result.current.status).toBe("success");
});

it("marks existing data stale when a refresh fails", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ value: "first" })
    .mockRejectedValueOnce(new Error("server unavailable"));
  const { result } = renderHook(() => useResourceRefresh(fetcher, { value: "initial" }));

  await waitFor(() => expect(result.current.status).toBe("success"));
  await act(async () => {
    await result.current.refresh("silent");
  });

  expect(result.current.data).toEqual({ value: "first" });
  expect(result.current.status).toBe("stale");
  expect(result.current.error).toBe("server unavailable");
});

it("uses error state when initial loading fails with no data", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("server unavailable"));
  const { result } = renderHook(() => useResourceRefresh(fetcher));

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.data).toBeNull();
});
```

Add a test that a late promise resolving after unmount does not trigger a React state update.

- [ ] **Step 2: Run the focused hook tests and verify RED**

Run:

```powershell
npx vitest run src/__tests__/useResourceRefresh.test.tsx
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the hook**

Use refs for the fetcher, mounted state, request sequence, and in-flight promise. On a successful response, update data, `lastUpdated`, `error`, and `status`. On a failed response, preserve existing data and set `stale`; if no data exists, set `error`. Increment a sequence number and ignore responses from superseded requests or unmounted components.

- [ ] **Step 4: Update infinite-scroll initial failure semantics**

Replace the initial-load catch behavior in `useInfiniteScroll.ts`:

```ts
.catch(() => {
  hasMoreRef.current = false;
  setHasMore(false);
});
```

with an error state and retry trigger. Add `loadError: string | null` and `retryInitial: () => void` to the returned interface. A failed initial load must not set `hasMore` to false until the user retries or a successful response explicitly returns no cursor.

Update the existing test named `disables pagination when the initial load fails` to assert `loadError` and `retryInitial` rather than silently treating the failure as a complete list.

- [ ] **Step 5: Run the hook suites and verify GREEN**

Run:

```powershell
npx vitest run src/__tests__/useResourceRefresh.test.tsx src/__tests__/useInfiniteScroll.test.tsx
```

Expected: all tests pass and the total test count does not decrease.

- [ ] **Step 6: Verification checkpoint**

Do not commit. Confirm no test was skipped or deleted and that the old “failure means no more data” assertion is replaced by an explicit retry contract.

---

### Task 4: Remove dead refresh sources and migrate high-traffic views

**Files:**
- Modify: `src/pages/admin/SecurityCenter.tsx:71-91`
- Modify: `src/pages/admin/Overview.tsx:227-328`
- Modify: `src/pages/admin/ActivityStream.tsx:82-181`
- Modify: `src/pages/admin/Reports.tsx:759-879`
- Modify: `src/pages/admin/Logs.tsx:158-222`
- Modify: `src/pages/Home.tsx:74-123,288-373`
- Modify: `src/pages/PostDetail.tsx:103-186`
- Modify: `src/contexts/AppContext.tsx:504-648`
- Modify: corresponding existing tests under `src/__tests__/`

**Interfaces:**

- `SecurityCenter` uses `useResourceRefresh<SecurityEvent[]>` and exposes `status`, `lastUpdated`, and `refresh("silent")`.
- `Overview` preserves partial source data and reports failed source names without clearing successful sources.
- `ActivityStream`, `Reports`, and `Logs` use explicit manual refresh and supported realtime tables only.
- `Home` and `PostDetail` use fresh requests for realtime callbacks and never replace current rows with a skeleton during a silent refresh.

- [ ] **Step 1: Add failing tests for dead subscriptions and silent refresh**

Add tests that:

1. `SecurityCenter` does not call `useRealtime` with `settings`.
2. A failed `SecurityCenter` refresh leaves existing events visible and renders an unavailable/stale message.
3. A failed `ActivityStream` refresh leaves existing events visible.
4. A failed `Reports` fast-queue refresh leaves the last-known queue visible.
5. A failed `Home` silent reload does not set a page-level error or clear the current feed.
6. A failed `AppContext` notification fetch does not overwrite local notifications with an empty list.

- [ ] **Step 2: Run the new tests and verify RED**

Run the specific test files with Vitest. Expected: failures identify the dead subscription, empty fallback, or missing stale state.

- [ ] **Step 3: Remove the dead `settings` subscription**

In `SecurityCenter.tsx`, remove:

```ts
useRealtime(["settings"], () => void loadEvents(), 5000);
```

Keep manual refresh and the existing error surface. Do not replace it with another passive timer.

- [ ] **Step 4: Migrate SecurityCenter to `useResourceRefresh`**

Replace the `events`/`loading` state pair with the hook state. Render:

- initial skeleton only when `status === "loading"`
- existing rows during `status === "refreshing"` or `"stale"`
- an inline unavailable/retry message when `status === "error"` or `"stale"`
- a quiet last-updated indicator

- [ ] **Step 5: Preserve partial dashboard data**

Keep `Overview.loadAll()` source-level `Promise.allSettled` behavior. Preserve the agent/workforce health source, but deduplicate it when it overlaps another authoritative health read. Keep a real `/api/health` or `/api/admin` system-health source. Never set a failed source to `[]` if it previously had data.

- [ ] **Step 6: Scope activity/log/report refreshes without removing capabilities**

- `ActivityStream`: keep `/api/workforce?action=ops-summary` and agent execution data, but load them once per visit, cap rows, and use scoped refresh/reconciliation. Preserve the admin’s ability to inspect worker state.
- `Reports`: keep `pending-approvals` and `approvals` queues; make their refresh user-triggered or event-scoped and reconcile actions locally.
- `Logs`: keep the agent activity tab and `/api/agent-executions`; bound the response and remove only passive timer/visibility full reloads.

- [ ] **Step 7: Keep public refresh quiet**

In `Home.tsx` and `PostDetail.tsx`, keep current rows during failed silent refreshes, log the failure with route context, and expose a stale state through the existing page error/last-update UI. Do not add a new timer.

- [ ] **Step 8: Run the migrated view tests**

Run:

```powershell
npx vitest run src/__tests__/SecurityCenter.test.tsx src/__tests__/ActivityStream.test.tsx src/__tests__/Reports.test.tsx src/__tests__/Home.test.tsx src/__tests__/PostDetail.test.tsx
```

If a named test file does not exist, add the assertion to the closest existing page test rather than creating a duplicate test harness.

Expected: all pass; no page schedules a five-second passive data refresh.

- [ ] **Step 9: Verification checkpoint**

Do not commit. Record the request-count assertions proving no five-second loop remains.

---

### Task 5: Refresh workstream verification

**Files:**
- No new production files.
- Update only test files that encode the new refresh contract.

- [ ] **Step 1: Run the refresh-specific suites**

```powershell
npx vitest run src/__tests__/api.test.ts src/__tests__/api-concurrency.test.ts src/__tests__/useRealtime.test.ts src/__tests__/useResourceRefresh.test.tsx src/__tests__/useInfiniteScroll.test.tsx
```

- [ ] **Step 2: Run the full local battery**

```powershell
npm run typecheck
npm run lint
npm run test:api
npm test
npm run build
```

- [ ] **Step 3: Record the original symptom evidence**

Record that:

- sequential GETs are not served from a five-second success cache;
- simultaneous GETs remain deduplicated;
- no page owns a five-second passive interval;
- failed background refreshes preserve last-known rows;
- retry paths are visible and executable.

Do not claim the live site is fixed until the human redeploys and runs the live smoke suite.
