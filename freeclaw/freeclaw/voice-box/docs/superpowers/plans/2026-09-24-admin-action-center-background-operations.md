# Voice Box Action Center and Background Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the noisy, refresh-heavy admin experience with a stable Action Center, make activity sections independently recoverable, and move operational work behind an honest server-side boundary.

**Architecture:** Keep the existing Vercel + Supabase stack and public routes. Harden the existing `/api/action-center` contract, add a local update-signal primitive that never fetches on a realtime event, rebuild the dashboard around one bounded human-action snapshot, and keep retired operations screens out of the canonical admin registry. Existing workers and API actions remain server-side; no background capability is deleted as a performance shortcut.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, Testing Library, Supabase/PostgreSQL, Vercel serverless functions, Node.js 25 in the current local environment.

**Spec:** `docs/superpowers/specs/2026-09-24-admin-action-center-background-operations-design.md`

## Global Constraints

- This plan implements the approved Action Center design and explicitly supersedes the earlier requirement that the listed human-facing operations surfaces remain in the primary admin navigation.
- The retired front-end list is `agent-chat`, `ops-center`, `activity-stream`, `system-health`, `performance`, `security`, `errors`, and `logs`; backend workers, API routes, audit records, and content/moderation capabilities remain.
- Do not delete, reset, clean, stage, or overwrite unrelated shared dirty files.
- Do not commit, push, deploy, rotate secrets, apply remote migrations, or change production data without the human gate.
- Do not use Playwright, Selenium, Puppeteer, or other browser automation.
- No page may perform a recurring full refresh, visibility-triggered full refresh, or realtime-triggered full snapshot fetch.
- Realtime callbacks may mark a snapshot stale; only an explicit **View updates** or **Refresh** action may fetch a new snapshot.
- Preserve last-known-good data on failure. A transport/database failure never becomes an empty success state.
- User/admin mutations must use authoritative server responses and local row reconciliation; partial bulk success must report exact counts.
- GET/read handlers remain side-effect free. Maintenance writes belong to authenticated scheduled/background paths.
- Run typecheck, lint, frontend tests, API tests, and build sequentially, never in parallel.
- The current tree contains extensive uncommitted work. Record the current status before implementation and review only the exact files named by each task.
- No capacity claim is permitted without approved staging/load evidence.

## Review Focus

1. A realtime burst must not create one full request per event or move a focused table while the admin is acting.
2. One failed activity section must not erase or hide successful sections.
3. A read or write failure in the Action Center store must not become an empty list or fake task success.
4. A retired tab URL must not mount a hidden operational screen or expose its controls.
5. A background maintenance result must count only proven writes and must never be triggered by a public GET.

---

### Task 1: Harden the Action Center contract before using it in the dashboard

**Files:**
- Modify: `api/_action-center.js`
- Test: `tests/api/action-center.test.ts`

**Interfaces:**
- `loadTasks(): Promise<ActionTask[]>` throws when the settings read fails; it never returns an error as `[]`.
- `saveTasks(tasks: ActionTask[]): Promise<void>` throws when insert/update fails and returns only after Supabase reports no error.
- `getActionSummary(): Promise<ActionCenterSummary>` returns a bounded, timestamped summary.
- The HTTP handler requires `isAdmin(req)` for every GET and POST action, including `GET ?action=summary`.

- [ ] **Step 1: Write failing authorization and failure-contract tests**

Add runtime tests using the existing API test response/mocking pattern:

```ts
it("rejects a non-admin summary read", async () => {
  authMocks.isAdmin.mockResolvedValue(false);
  const result = await call("_action-center.js", {
    method: "GET",
    query: { action: "summary" },
  });
  expect(result.statusCode).toBe(403);
});

it("does not turn a settings read error into an empty task list", async () => {
  authMocks.isAdmin.mockResolvedValue(true);
  dbMocks.settingsReadError(new Error("database unavailable"));
  const result = await call("_action-center.js", {
    method: "GET",
    query: { action: "summary" },
  });
  expect(result.statusCode).toBeGreaterThanOrEqual(500);
  expect(result.body).not.toMatchObject({ open: 0, total: 0 });
});

it("does not acknowledge a task when persistence fails", async () => {
  authMocks.isAdmin.mockResolvedValue(true);
  dbMocks.taskRead([{ id: "ACT-1", status: "OPEN" }]);
  dbMocks.taskWriteError(new Error("write failed"));
  const result = await call("_action-center.js", {
    method: "POST",
    body: { action: "acknowledge", task_id: "ACT-1" },
  });
  expect(result.statusCode).toBeGreaterThanOrEqual(500);
  expect(result.body).not.toMatchObject({ status: "ACKNOWLEDGED" });
});
```

The test harness must distinguish a successful empty settings value from a Supabase `{ error }` result.

- [ ] **Step 2: Run the focused API test and verify it fails for the old implementation**

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/action-center.test.ts
```

Expected: the non-admin GET and persistence-failure cases fail because the current GET path is ungated and `saveTasks()` swallows errors.

- [ ] **Step 3: Implement the smallest authorization and truthfulness fix**

In `api/_action-center.js`:

```js
if (!(await isAdmin(req))) {
  return res.status(403).json({ error: "Admin only" });
}
```

Place this gate before both GET and POST branches. Change the settings read to inspect `error` and throw. Change both insert and update paths in `saveTasks()` to inspect `error` and throw. Do not catch those errors in the HTTP handler; let `sanitizeError` produce the existing safe error response. Preserve the current task shape and action names.

- [ ] **Step 4: Add the bounded summary shape**

Return a response with these fields while retaining the existing summary data for current callers:

```js
{
  generated_at: new Date().toISOString(),
  total: tasks.length,
  open: open.length,
  critical: critical.length,
  by_category: existingCategoryCounts,
  recent: tasks.slice(0, 20),
}
```

The response must be bounded to the existing `MAX_TASKS` value and must not call `ops-summary`, worker registries, or raw log scans.

- [ ] **Step 5: Run the focused API test and typecheck**

Run:

```powershell
npx vitest run --config vitest.config.api.ts tests/api/action-center.test.ts
npm run typecheck
```

Expected: all Action Center tests pass and typecheck exits 0.

- [ ] **Step 6: Review checkpoint (no commit without approval)**

Inspect only the diff for `api/_action-center.js` and `tests/api/action-center.test.ts`. Confirm no unrelated API file changed. Do not commit.

---

### Task 2: Add a local update signal and accessible update affordance

**Files:**
- Create: `src/hooks/useUpdateSignal.ts`
- Create: `src/components/admin/UpdateNotice.tsx`
- Create: `src/__tests__/useUpdateSignal.test.tsx`
- Create: `src/__tests__/UpdateNotice.test.tsx`

**Interfaces:**

```ts
export function useUpdateSignal(): {
  updatesAvailable: number;
  markUpdatesAvailable: () => void;
  clearUpdates: () => void;
};
```

The count is local-only, capped at `99`, and cleared only by the consumer after an accepted fresh snapshot. The hook contains no fetch, timer, or Supabase subscription.

```ts
export function UpdateNotice(props: {
  count: number;
  onViewUpdates: () => void;
  refreshing?: boolean;
  lastUpdatedAt?: number | null;
}): JSX.Element | null;
```

- [ ] **Step 1: Write failing hook and component tests**

Cover these exact behaviors:

```tsx
it("starts at zero and increments without making a request", () => {
  const { result } = renderHook(() => useUpdateSignal());
  expect(result.current.updatesAvailable).toBe(0);
  act(() => result.current.markUpdatesAvailable());
  expect(result.current.updatesAvailable).toBe(1);
});

it("caps the visible count at 99 and clears explicitly", () => {
  const { result } = renderHook(() => useUpdateSignal());
  act(() => {
    for (let i = 0; i < 120; i += 1) result.current.markUpdatesAvailable();
  });
  expect(result.current.updatesAvailable).toBe(99);
  act(() => result.current.clearUpdates());
  expect(result.current.updatesAvailable).toBe(0);
});

it("announces and exposes a keyboard-operable View updates action", () => {
  render(
    <UpdateNotice
      count={3}
      onViewUpdates={onViewUpdates}
      lastUpdatedAt={Date.now() - 5_000}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("3 new updates");
  expect(screen.getByRole("button", { name: /view updates/i })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /view updates/i }));
  expect(onViewUpdates).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

```powershell
npx vitest run src/__tests__/useUpdateSignal.test.tsx src/__tests__/UpdateNotice.test.tsx
```

Expected: FAIL because the hook and component do not exist.

- [ ] **Step 3: Implement the hook and component**

Use `useReducer` or an equivalent stable state transition. `markUpdatesAvailable()` increments with `Math.min(previous + 1, 99)` and performs no side effect. `clearUpdates()` resets to zero.

`UpdateNotice` must:

- return `null` when `count === 0`;
- render a polite `role="status"` live region;
- render a real `<button>` with an accessible name containing the count;
- keep the previous timestamp visible;
- disable the button only while `refreshing` is true;
- use existing button/tokens and no spinner-only loading state.

- [ ] **Step 4: Run the focused tests and lint the new files**

```powershell
npx vitest run src/__tests__/useUpdateSignal.test.tsx src/__tests__/UpdateNotice.test.tsx
npm run lint
```

Expected: all new tests pass and lint exits 0.

- [ ] **Step 5: Review checkpoint (no commit without approval)**

Confirm the new primitive cannot initiate a request by itself. Do not commit.

---

### Task 3: Make `MyActivity` recover section by section

**Files:**
- Modify: `src/pages/MyActivity.tsx`
- Modify: `src/__tests__/MyActivity.test.tsx`
- Modify: `src/__tests__/MyActivityExport.test.tsx` only if its shared setup assumes one global loading state

**Interfaces:**

```ts
type ActivitySection =
  | "posts"
  | "polls"
  | "comments"
  | "votes"
  | "bookmarks"
  | "appeals";

type SectionState<T> = {
  data: T;
  status: "loading" | "ready" | "error";
  error: string | null;
  lastSuccessfulLoad: number | null;
};
```

- [ ] **Step 1: Add failing partial-failure tests**

Add tests that mock independent endpoint outcomes:

```tsx
it("keeps successful activity sections visible when comments fail", async () => {
  mockActivity({
    posts: [POST],
    comments: new Error("comments unavailable"),
    reactions: [REACTION],
    votes: [VOTE],
    polls: [POLL],
    appeals: [],
  });
  render(<MyActivity />);
  expect(await screen.findByText(POST.title)).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Comments");
  expect(screen.queryByText("Couldn't load your activity")).not.toBeInTheDocument();
});

it("retries only the failed section", async () => {
  // First comments request rejects; second comments request succeeds.
  render(<MyActivity />);
  await screen.findByRole("button", { name: /retry comments/i });
  fireEvent.click(screen.getByRole("button", { name: /retry comments/i }));
  await waitFor(() => expect(screen.getByText("Recovered comment")).toBeInTheDocument());
  expect(postsRequest).toHaveBeenCalledTimes(1);
  expect(commentsRequest).toHaveBeenCalledTimes(2);
});

it("does not block a ready section behind a slow unrelated section", async () => {
  // Posts resolve; polls remain pending until its deferred promise resolves.
  render(<MyActivity />);
  expect(await screen.findByText(POST.title)).toBeInTheDocument();
  expect(screen.getByText(/loading polls/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused MyActivity tests and verify the old all-or-nothing behavior fails**

```powershell
npx vitest run src/__tests__/MyActivity.test.tsx src/__tests__/MyActivityExport.test.tsx
```

Expected: at least the new partial-failure and retry-isolation tests fail against the current single `Promise.all`/global error implementation.

- [ ] **Step 3: Replace the global load state with section state**

Refactor `MyActivity` so each section has an independent loader. The loaders must:

- preserve the previous `data` when a refresh fails;
- set only that section's `status` to `error`;
- set `lastSuccessfulLoad` only after a fulfilled request;
- render a section-level retry button with an accessible name;
- keep the page-level alert only for an unavailable initial shell with no usable data;
- retain the existing delete/undo/export behavior and authoritative local reconciliation;
- avoid a global `loading` gate that hides already-ready tabs.

The bookmarks loader must depend on `bookmarks` and update only the bookmarks section. The appeals loader may continue treating an unavailable appeals endpoint as an empty optional section, but it must record its own source status rather than affecting other sections.

- [ ] **Step 4: Run the focused tests and typecheck**

```powershell
npx vitest run src/__tests__/MyActivity.test.tsx src/__tests__/MyActivityExport.test.tsx
npm run typecheck
```

Expected: all MyActivity tests pass and typecheck exits 0.

- [ ] **Step 5: Review checkpoint (no commit without approval)**

Confirm no action path was changed from authoritative confirmation to optimistic success. Do not commit.

---

### Task 4: Build the stable Action Center dashboard

**Files:**
- Modify: `api/_action-center.js`
- Modify: `src/pages/admin/Overview.tsx`
- Create: `src/components/admin/ActionCenterSummary.tsx`
- Modify: `src/__tests__/Overview.test.tsx`
- Create: `src/__tests__/ActionCenterSummary.test.tsx`

**Interfaces:**

```ts
export type ActionCenterSummary = {
  generated_at: string;
  total: number;
  open: number;
  critical: number;
  by_category: Array<{ category: string; label: string; count: number }>;
  recent: Array<{
    id: string;
    status: string;
    category: string;
    title: string;
    created_at: string;
    resolved_at: string | null;
    resolution: string | null;
  }>;
};
```

`ActionCenterSummary` renders only real values. A missing field is shown as unavailable, never as a fabricated zero.

- [ ] **Step 1: Write failing dashboard lifecycle tests**

Add tests that capture the realtime callback without allowing it to trigger a request:

```tsx
it("marks updates without refetching when realtime fires", async () => {
  render(<Overview />);
  await screen.findByText("Action Center");
  realtimeCallback?.("reports", { eventType: "INSERT" });
  expect(screen.getByRole("status")).toHaveTextContent("1 new update");
  expect(summaryRequest).toHaveBeenCalledTimes(1);
});

it("fetches once when the admin chooses View updates", async () => {
  render(<Overview />);
  await screen.findByText("Action Center");
  realtimeCallback?.("reports", { eventType: "INSERT" });
  fireEvent.click(screen.getByRole("button", { name: /view updates/i }));
  await waitFor(() => expect(summaryRequest).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("status")).not.toHaveTextContent("new update");
});

it("keeps the last snapshot visible when refresh fails", async () => {
  // Initial summary succeeds; the explicit refresh rejects.
  render(<Overview />);
  const first = await screen.findByText("Security review required");
  mockSummaryError(new Error("temporary unavailable"));
  fireEvent.click(screen.getByRole("button", { name: /^refresh/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/last known/i);
  expect(screen.getByText("Security review required")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused dashboard tests and verify they fail**

```powershell
npx vitest run src/__tests__/Overview.test.tsx src/__tests__/ActionCenterSummary.test.tsx
```

Expected: the new tests fail because the current Overview has no stable update signal and still loads operational summary sources.

- [ ] **Step 3: Remove operational fan-out from `Overview`**

Replace the current `loadAlerts`, `loadSystemHealth`, raw `ops-summary` reads, and duplicated full-list dashboard load with one bounded Action Center read:

```ts
const loadSnapshot = useCallback(async () => {
  const next = await api.get<ActionCenterSummary>(
    "/api/action-center?action=summary",
  );
  setSnapshot(next);
  setLastUpdatedAt(Date.now());
  setSnapshotError(null);
}, []);
```

The initial effect calls `loadSnapshot()` once. The visible Refresh control calls the same function. A failed refresh preserves `snapshot` and sets a stale error state.

The dashboard must link to Reports, Feed, Users, Polls, and Inbox rather than duplicating their full tables. Content actions remain in their owning focused workspaces; no moderation capability is deleted.

- [ ] **Step 4: Add the update signal without automatic fetching**

Use the existing shared realtime transport only as a signal:

```ts
const {
  updatesAvailable,
  markUpdatesAvailable,
  clearUpdates,
} = useUpdateSignal();

useRealtime(
  ["reports", "posts", "polls", "poll_votes"],
  markUpdatesAvailable,
  1_000,
);
```

The callback passed to `useRealtime` must be `markUpdatesAvailable` or an equivalent function that performs no API request. The **View updates** handler calls `loadSnapshot()` and clears the signal only after the request is accepted. Keep a request-generation guard so a slower old response cannot replace a newer snapshot.

- [ ] **Step 5: Implement `ActionCenterSummary` with progressive disclosure**

Render, in order:

1. attention count and critical count;
2. category rows with links to the relevant human workspace;
3. recent verified outcomes;
4. last-updated timestamp and explicit Refresh;
5. no raw worker names, queue internals, provider state, or operational controls.

Use existing `--vb-*` tokens, compact rows, real status labels, and a readable mobile fallback. Do not add a decorative chart or a fake “Live” label.

- [ ] **Step 6: Run focused tests, typecheck, and lint**

```powershell
npx vitest run src/__tests__/Overview.test.tsx src/__tests__/ActionCenterSummary.test.tsx
npm run typecheck
npm run lint
```

Expected: all focused tests pass; typecheck and lint exit 0.

- [ ] **Step 7: Review checkpoint (no commit without approval)**

Inspect the exact diff and confirm no `ops-summary` call remains in the primary dashboard. Do not commit.

---

### Task 5: Integrate stable updates with Reports and retire hidden operations tabs

**Files:**
- Modify: `src/pages/admin/Reports.tsx`
- Modify: `src/pages/Admin.tsx`
- Modify: `src/__tests__/AdminShell.test.tsx`
- Modify: `src/__tests__/AdminTabSweep.test.tsx`
- Modify: `src/__tests__/page-lifecycle-contract.test.ts`
- Do not delete retired component files in this task

**Interfaces:**

```ts
const RETIRED_ADMIN_TABS = new Set([
  "agent-chat",
  "ops-center",
  "activity-stream",
  "system-health",
  "performance",
  "security",
  "errors",
  "logs",
]);

function normalizeAdminTab(raw: string | null): {
  tab: string;
  retired: boolean;
};
```

- [ ] **Step 1: Write failing navigation and Reports lifecycle tests**

Add tests for:

```tsx
it("redirects a retired operations tab to the Action Center", async () => {
  renderShell("?tab=ops-center");
  expect(await screen.findByRole("button", { name: "Dashboard" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByRole("button", { name: /Ops Center/ })).not.toBeInTheDocument();
  expect(screen.queryByTestId("ops-center")).not.toBeInTheDocument();
});

it("does not refetch Reports when a realtime event arrives", async () => {
  render(<Reports />);
  await screen.findByText("Report Queue");
  reportsRealtimeCallback?.("reports", { eventType: "INSERT" });
  expect(reportsRequest).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(/new update/i);
});
```

Update the tab sweep to mount only the active primary navigation. Keep retired component tests as source-level regression tests until a human approves deletion of the files.

- [ ] **Step 2: Run the focused navigation tests and verify they fail**

```powershell
npx vitest run src/__tests__/AdminShell.test.tsx src/__tests__/AdminTabSweep.test.tsx src/__tests__/page-lifecycle-contract.test.ts
```

Expected: the retired-tab redirect and stable Reports signal tests fail against the current 17-tab registry.

- [ ] **Step 3: Make `normalizeAdminTab` the single tab boundary**

Update `Admin.tsx` so `ALL_TABS` contains only:

- `dashboard`
- `reports`
- `posts`
- `users`
- `categories`
- `polls`
- `inbox`
- `email-templates`
- `settings`

Use `normalizeAdminTab` for the URL value, sidebar/search navigation, render switch, and tests. When a retired value is present, replace the query parameter with `dashboard` and show one honest informational notice:

> This operations view now runs in the background. Open the Action Center for human-required work.

Do not render the retired lazy component while the redirect is pending.

- [ ] **Step 4: Add the Reports update signal**

Use `useUpdateSignal` in `Reports` and subscribe only to supported report/content tables. The realtime callback marks updates; it must not call `loadFast`, `loadPosts`, or any other full-list loader. **View updates** performs the existing explicit `refreshAll` path. Preserve the existing per-section queue errors and partial bulk status behavior.

- [ ] **Step 5: Keep retired files out of the active bundle without deleting shared work**

Remove their lazy imports and render branches from `Admin.tsx`, but leave the source files and their direct tests in place for human reconciliation. Add a static contract assertion that `Admin.tsx` does not import or render the retired component modules. Do not resurrect deleted dashboard-builder files or alter unrelated concurrent work.

- [ ] **Step 6: Run focused tests, typecheck, and lint**

```powershell
npx vitest run src/__tests__/AdminShell.test.tsx src/__tests__/AdminTabSweep.test.tsx src/__tests__/page-lifecycle-contract.test.ts
npm run typecheck
npm run lint
```

Expected: all focused tests pass; typecheck and lint exit 0.

- [ ] **Step 7: Review checkpoint (no commit without approval)**

Review the active navigation and verify every remaining link has a real content/communication/configuration owner. Do not commit.

---

### Task 6: Put existing maintenance work behind an authenticated background boundary

**Files:**
- Modify: `api/_cleanup.js`
- Modify: `api/_posts.js`
- Modify: `api/_polls.js`
- Create: `api/_maintenance.js`
- Modify: `api/index.js`
- Create: `tests/api/maintenance-boundary.test.ts`

**Interfaces:**

```ts
export async function runScheduledMaintenance(): Promise<{
  ran_at: string;
  skipped: boolean;
  cleanup: Record<string, number>;
  post_purge: Record<string, number>;
  poll_maintenance: Record<string, number>;
}>;
```

The maintenance handler accepts only an authenticated scheduler/admin request. It never runs from a public GET and never reports counts for writes that were not proven.

- [ ] **Step 1: Write failing maintenance-boundary tests**

Cover:

```ts
it("rejects an unauthenticated maintenance invocation", async () => {
  const result = await call("_maintenance.js", { method: "POST", body: {} });
  expect([401, 403]).toContain(result.statusCode);
});

it("does not run maintenance from a public posts or polls GET", async () => {
  await call("_posts.js", { method: "GET", query: {} });
  await call("_polls.js", { method: "GET", query: {} });
  expect(runCleanup).not.toHaveBeenCalled();
  expect(purgeExpired).not.toHaveBeenCalled();
});

it("reports only proven cleanup counts", async () => {
  dbMocks.deleteReturns({ data: [], error: null });
  const result = await call("_maintenance.js", {
    method: "POST",
    body: {},
    headers: { "x-maintenance-secret": "test-secret" },
  });
  expect(result.statusCode).toBe(200);
  expect(result.body.cleanup.deleted).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and verify the old boundary fails**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/maintenance-boundary.test.ts
```

Expected: the unauthenticated handler and public-GET side-effect tests fail until the boundary is explicit.

- [ ] **Step 3: Extract and expose the existing maintenance operations**

Refactor existing cleanup/post/poll helpers into named exported functions instead of duplicating their SQL. `runScheduledMaintenance()` must call the same functions used by the authenticated maintenance route. Preserve the existing cooldown/singleton behavior and make it explicit in the result (`skipped: true` when a cooldown is active).

Remove any module-load invocation that causes a public request to start maintenance. Public GET handlers may read their own bounded data but must not call purge, archive, or repair functions.

- [ ] **Step 4: Add the authenticated maintenance route**

Add the route to `api/index.js` using the existing protection wrapper. Require either the configured maintenance secret or a valid admin session. Validate the request method and action. Return only verified counts and a safe error code. Do not expose raw database errors, secrets, or SQL.

- [ ] **Step 5: Run focused API tests, existing posts/polls tests, typecheck, and lint**

```powershell
npx vitest run --config vitest.config.api.ts tests/api/maintenance-boundary.test.ts tests/api/posts-feed.test.ts tests/api/polls-full.test.ts
npm run typecheck
npm run lint
```

Expected: all focused tests pass; public GET tests remain side-effect-free; typecheck and lint exit 0.

- [ ] **Step 6: Review checkpoint (no commit without approval)**

Confirm no production schedule, secret, migration, or remote route was changed. Do not commit.

---

### Task 7: Accessibility, regression evidence, and human handoff

**Files:**
- Modify: `src/__tests__/page-lifecycle-contract.test.ts`
- Modify: `src/__tests__/MyActivity.test.tsx` only for final accessibility assertions
- Modify: `src/__tests__/AdminShell.test.tsx` only for final navigation assertions
- Modify: `src/__tests__/Overview.test.tsx` only for final update/accessibility assertions
- Modify: `docs/superpowers/plans/2026-09-24-admin-action-center-background-operations.md` to mark completed steps only after evidence exists

**Interfaces:**
- The final active admin registry is the nine-tab set in Task 5.
- The final activity page exposes section-level errors and retries.
- The final dashboard exposes a stable snapshot, explicit update affordance, and honest stale state.

- [ ] **Step 1: Add accessibility assertions for the changed surfaces**

Assert with Testing Library that:

- the update status is a polite live region;
- the View updates button is keyboard reachable and disabled only while its explicit refresh is active;
- each activity retry has a section-specific accessible name;
- the retired tab notice is readable without relying on color;
- the mobile action layout has a deterministic accessible name and no hover-only action.

- [ ] **Step 2: Run focused changed-surface tests**

```powershell
npx vitest run src/__tests__/MyActivity.test.tsx src/__tests__/Overview.test.tsx src/__tests__/AdminShell.test.tsx src/__tests__/ActionCenterSummary.test.tsx src/__tests__/UpdateNotice.test.tsx
```

Expected: all changed-surface tests pass.

- [ ] **Step 3: Run the full sequential verification gates**

Run exactly in this order and record the actual output:

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:api
npm run build
```

Expected: every command exits 0. The build may retain the already documented large-chunk warning; any new error or warning is a review item.

- [ ] **Step 4: Inspect the final diff and shared-tree boundary**

```powershell
git status --short
git diff --stat
git diff -- api/_action-center.js api/_cleanup.js api/_maintenance.js src/hooks/useUpdateSignal.ts src/components/admin/UpdateNotice.tsx src/components/admin/ActionCenterSummary.tsx src/pages/MyActivity.tsx src/pages/admin/Overview.tsx src/pages/admin/Reports.tsx src/pages/Admin.tsx
```

Confirm that unrelated concurrent files, generated caches, audit documents, and prior reliability changes were not staged, reset, or overwritten.

- [ ] **Step 5: Human review and integration gate**

Present the exact changed-file list, focused test output, full sequential verification output, remaining retired source files, and any unresolved maintenance/capacity evidence. Stop for human approval before commit, push, deploy, remote migration, or production-data action. Do not claim 10,000-user capacity from local tests.

- [ ] **Step 6: Optional dead-code cleanup only after explicit approval**

After the human confirms that the retired source files are no longer needed, remove the unused front-end component files and their obsolete direct tests in a separate reviewable change. Do not combine that deletion with behavior changes, and do not delete backend workers or API modules.

---

## Plan self-review

- **Spec coverage:** refresh/update badge, activity partial recovery, Action Center information hierarchy, retired front-end operations surfaces, background maintenance boundary, accessibility, and human gates map to Tasks 1–7.
- **Placeholder scan:** the plan contains no unresolved placeholder markers or unspecified error-handling steps; every task names exact files, interfaces, commands, and observable outcomes.
- **Type consistency:** `ActionCenterSummary`, `useUpdateSignal`, `UpdateNotice`, `ActivitySection`, `SectionState<T>`, and `runScheduledMaintenance` are defined once and reused by later tasks.
- **Conflict handling:** the explicit front-end retirement list is separated from backend capability preservation, so the earlier full-feature reliability guarantees remain intact.
- **Shared-tree safety:** every task limits edits to named files, uses read-only inspection before integration, and stops at the human commit/deploy gate.
