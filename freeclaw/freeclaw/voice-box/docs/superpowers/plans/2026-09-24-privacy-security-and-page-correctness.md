# Privacy, Security, and Page Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the notification-preference PII disclosure, make privacy/admin copy truthful, enforce request-size limits while streaming, reconcile anonymous Realtime/RLS publication state, correct admin tab context and page honesty defects, and add outcome-based security/page regression coverage.

**Architecture:** Keep Vercel + Supabase and the existing anonymous identity model. Add one bounded request-body reader at the API boundary, owner-scope notification preference reads through the existing identity verifier, and make one canonical Realtime contract drive both client capability checks and migration tests. Centralize privacy disclosures and correct page failure states so transport failures never masquerade as empty data.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, Testing Library, Supabase/PostgreSQL, Vercel Node.js serverless functions, Node.js 22.

**Spec:** `docs/superpowers/specs/2026-09-24-10k-smooth-platform-design.md`  
**Surface Inventory:** `docs/superpowers/specs/2026-09-24-platform-surface-inventory.md`

## Global Constraints

- Keep Vercel + Supabase; add no service or runtime dependency without measured evidence.
- Preserve the current anonymous identity/product behavior; the client-controlled identity limitation remains a documented risk.
- Every slice starts with a failing regression test or explicit measured baseline.
- Run typecheck, lint, unit tests, API tests, and build sequentially.
- Do not run production load tests or production writes/deletes.
- Apply database migrations only to a dedicated staging project; never rewrite deployed migrations 001–015.
- `Content-Length` is only a hint; enforce actual bytes while reading.
- Final anonymous Realtime allowlist is exactly `posts`, `comments`, and `polls`.
- Anonymous/authenticated roles receive no public-table write grants.
- Private, hidden, deleted, pending-review, and moderation-only rows cannot be read through anonymous PostgREST/Realtimes.
- Never turn transport, authorization, or server failures into authoritative empty data.
- Never claim a live health check, timestamp, uptime, or incident state when no check occurred.
- Do not expose a public Sentry test-error control.
- Do not run Playwright/Selenium/Puppeteer; correct E2E definitions but verify with component/API tests and `npx playwright test --list` only.
- Preserve unrelated dirty-tree changes; stage exact paths/hunks only.

## Review Focus

1. Cross-user notification reads: no caller can read another identity's phone/email/preferences.
2. Chunked and multibyte bodies: a body without `Content-Length` stops at 500,000 bytes and returns 413.
3. Anonymous database visibility: direct PostgREST/Realtimes exposes only final public-row predicates.
4. Admin route identity: `/admin?tab=reports` means Reports in navigation, PageContext, command palette, analytics, and tests.
5. Failure/status honesty: failed reads never show “no records,” fake timestamps, or successful refresh copy.

## File Map

### Create

- `api/_request-body.js` — bounded Node/Web stream body reader/parser.
- `tests/api/request-body.test.ts` — streaming and byte-limit tests.
- `src/lib/realtimeContract.json` — canonical anonymous table/predicate contract.
- `src/lib/adminTabs.ts` — canonical 17-tab registry/parser/URL builder.
- `api/migrations/016_realtime_rls_reconciliation.sql` — forward RLS/publication reconciliation.
- `tests/api/realtime-rls-contract.test.ts` — static migration/client drift test.
- `src/lib/privacyCopy.ts` — shared truthful privacy/retention text.
- `src/__tests__/Privacy.test.tsx`
- `src/__tests__/Settings.test.tsx`
- `src/__tests__/PageContext.test.tsx`
- `src/__tests__/adminTabs.test.ts`
- `src/__tests__/StatusPage.test.tsx`
- `src/__tests__/SecurityCenter.test.tsx`
- `src/__tests__/CommunityDetail.test.tsx`
- `src/__tests__/Contact.test.tsx`
- `src/__tests__/SystemHealth.test.tsx`
- `src/__tests__/PerformanceCenter.test.tsx`

### Modify

- `api/_notify-prefs.js`
- `tests/api/notify-prefs.test.ts`
- `api/index.js`
- `api/_security.js`
- `src/lib/useRealtime.ts`
- `src/__tests__/useRealtime.test.ts`
- `src/pages/Admin.tsx`
- `src/components/admin/PageContext.jsx`
- `src/components/admin/PageContext.d.ts`
- `src/components/CommandPalette.tsx`
- `src/pages/Privacy.tsx`
- `src/pages/Settings.tsx`
- `src/pages/admin/AdminSettings.tsx`
- `src/__tests__/AdminSettings.test.tsx`
- `src/pages/StatusPage.tsx`
- `src/pages/admin/ActivityStream.tsx`
- `src/pages/admin/SecurityCenter.tsx`
- `src/pages/UserChat.tsx`
- `src/__tests__/ActivityStream.test.tsx`
- `src/__tests__/UserChat.test.tsx`
- `src/pages/admin/SystemHealth.tsx`
- `src/pages/admin/PerformanceCenter.tsx`
- `src/__tests__/AdminShell.test.tsx`
- `src/__tests__/AdminTabSweep.test.tsx`
- `tests/e2e/account-pages.spec.ts`
- `tests/e2e/full-platform.spec.ts`
- `tests/e2e/no-horizontal-overflow.spec.ts`
- `tests/e2e/audit.spec.ts`
- `package.json`

---

### Task 1: Make Notification Preferences Owner-Scoped

**Files:** `api/_notify-prefs.js:1-137`, `tests/api/notify-prefs.test.ts:1-206`  
**Consumes:** `verifyCallerIdentity(req, claimedUserId) -> {ok:true,callerId}|{ok:false,status,error}`.

- [ ] Replace the current public-GET tests with owner success, cross-user denial, missing identity, malformed ID, and “database not called after denial” cases. Mock `verifyCallerIdentity` through `vi.hoisted` and make `maybeSingle` return a synthetic preference fixture.
- [ ] Run `npm run test:api -- tests/api/notify-prefs.test.ts`; confirm the current handler fails cross-user/missing cases with 200.
- [ ] Gate the browser GET and POST before `getNotifyPrefs`, validation, rate limit, or `checkUser`:

```js
const caller = await verifyCallerIdentity(req, userId);
if (!caller.ok) return res.status(caller.status || 403).json({ error: caller.error });
```

Keep the valid-anon-id check before this gate. Internal callers that already pass a server-derived user ID remain internal helpers.
- [ ] Run `npm run test:api -- tests/api/notify-prefs.test.ts`, then `npm run test:api -- tests/api/me.test.ts tests/api/notifications.test.ts tests/api/idor-protection.test.ts`.
- [ ] Diff only the two files, verify no real PII, and commit:

```powershell
git add api/_notify-prefs.js tests/api/notify-prefs.test.ts
git diff --cached --check
git commit -m "fix(notify-prefs): require owner identity for preference reads"
```

### Task 2: Centralize Truthful Privacy Disclosures

**Files:** create `src/lib/privacyCopy.ts`; modify Privacy, Settings, AdminSettings and their tests.

- [ ] Add tests that render the shared constants and reject `/no personal data.*ever/i`, `/never asks for or stores.*email/i`, `/ownership data.*stays only in your browser/i`, and the old AdminSettings no-PII claim.
- [ ] Run the focused tests and confirm RED against current contradictory copy.
- [ ] Create exact shared constants:

```ts
export const NOTIFY_PRIVACY_COPY =
  "If you turn on phone or email alerts, Voice Flow stores the phone number or email address on the server to deliver the alerts you requested. Clear either field and save to overwrite the stored value.";
export const CONTACT_PRIVACY_COPY =
  "The Contact form sends the name, email address, subject, and message you enter through the post moderation pipeline. Do not include information you do not want stored with the request.";
export const LOCAL_PROFILE_COPY =
  "Display name, avatar, bio, profile photo, bookmarks, and drafts are stored in this browser unless a control explicitly says server-side.";
export const RETENTION_COPY =
  "Solved or archived posts inactive for 5 days are purged; soft-deleted posts are purged after 14 days; comments, activity logs, and chat messages are purged after 30 days; archived polls are purged after 30 days. Notification contact values remain until you clear or replace them in Settings.";
export const SERVER_PII_COPY =
  "Anonymous IDs link public content. Optional alert contact values and Contact-form submissions are server-side personal data; protect exports and logs, and do not place those values in public responses.";
export const INFRASTRUCTURE_COPY =
  "The application does not intentionally store application-table IP addresses or use advertising cookies. Infrastructure providers may process request metadata under their own policies.";
```

- [ ] Replace the contradictory copy in all three surfaces, import the constants, and rename the local JSON export to “Export on-device settings.”
- [ ] Run `npm run test -- src/__tests__/Privacy.test.tsx src/__tests__/Settings.test.tsx src/__tests__/AdminSettings.test.tsx` and `npm run typecheck`.
- [ ] Commit exact files:

```powershell
git add src/lib/privacyCopy.ts src/pages/Privacy.tsx src/pages/Settings.tsx src/pages/admin/AdminSettings.tsx src/__tests__/Privacy.test.tsx src/__tests__/Settings.test.tsx src/__tests__/AdminSettings.test.tsx
git diff --cached --check
git commit -m "fix(privacy): align contact-data disclosures with stored data"
```

### Task 3: Enforce the 500 KB Limit While Reading Streams

**Files:** create `api/_request-body.js`, `tests/api/request-body.test.ts`; modify `api/index.js`, `api/_security.js`, `tests/api/rate-limiter.test.ts`.

- [ ] Add tests for exact-limit Buffer, oversized Web stream cancellation, UTF-8 byte counting (`"é".repeat(250_001)` = 500,002 bytes), oversized Node stream, URL-encoded/form body, pre-parsed object, and malformed JSON.
- [ ] Run `npm run test:api -- tests/api/request-body.test.ts`; confirm module-not-found RED.
- [ ] Implement:

```js
export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes, receivedBytes) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
    this.maxBytes = maxBytes;
    this.receivedBytes = receivedBytes;
  }
}
export async function parseRequestBody(req, { maxBytes }) { /* bounded parser */ }
```

The Web reader must increment by `chunk.byteLength`, call `reader.cancel()` before throwing, and never retain more than `maxBytes`. The Node reader must `destroy()` the stream on overflow. String/Buffer parsing uses `Buffer.byteLength`, not `.length`.
- [ ] Replace `api/index.js`'s private parser with `parseRequestBody`; keep the declared-size fast rejection, map `RequestBodyTooLargeError` to 413, and map malformed JSON to 400. Move `peekBodyIdentity` after parsing and make it inspect only `req.body`.
- [ ] Run the body, rate-limiter, auth, typecheck, and lint commands sequentially.
- [ ] Commit:

```powershell
git add api/_request-body.js api/index.js api/_security.js tests/api/request-body.test.ts tests/api/rate-limiter.test.ts
git commit -m "fix(api): enforce request body limit during streaming"
```

### Task 4: Establish the Canonical Anonymous Realtime Contract

**Files:** create `src/lib/realtimeContract.json`; modify `src/lib/useRealtime.ts`, `src/__tests__/useRealtime.test.ts`, and `tsconfig.app.json` only if JSON resolution requires it.

- [ ] Add a RED test asserting the exact set:

```ts
expect([...REALTIME_TABLES].sort()).toEqual(["comments", "polls", "posts"]);
```

- [ ] Create the contract:

```json
{
  "publication": "supabase_realtime",
  "anonSelectTables": ["posts", "comments", "polls"],
  "publicRowPredicates": {
    "posts": "deleted = false AND hidden = false AND COALESCE(visibility, 'public') = 'public' AND status <> 'pending_review'",
    "comments": "deleted = false AND hidden = false AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = comments.post_id AND p.deleted = false AND p.hidden = false AND COALESCE(p.visibility, 'public') = 'public' AND p.status <> 'pending_review')",
    "polls": "deleted = false"
  }
}
```

- [ ] Derive `REALTIME_TABLES` from the JSON. Keep shared channels, debounce, polling fallback, and teardown behavior unchanged in this task.
- [ ] Replace tests that assume private tables are successful channels; add a negative test that `reports`, `chat_messages`, `poll_votes`, and `reactions` create no channel.
- [ ] Run the focused suite, typecheck, and commit:

```powershell
git add src/lib/realtimeContract.json src/lib/useRealtime.ts src/__tests__/useRealtime.test.ts tsconfig.app.json
git commit -m "fix(realtime): align anonymous client allowlist"
```

### Task 5: Add the Forward RLS and Publication Reconciliation Migration

**Files:** create `api/migrations/016_realtime_rls_reconciliation.sql`, `tests/api/realtime-rls-contract.test.ts`.

- [ ] Add a RED static test that reads the migration and asserts the three-table contract, row predicates, `REVOKE ALL`, `supabase_realtime`, and absence of anon/authenticated write grants.
- [ ] Write an idempotent transaction migration that removes non-allowlisted publication membership and anon/authenticated grants, revokes old policies, enables RLS, grants SELECT only on the three tables, and creates `anon_select_public_posts`, `anon_select_public_comments`, and `anon_select_public_polls` with these exact predicates:

```sql
-- posts
USING (deleted = false AND hidden = false
  AND COALESCE(visibility, 'public') = 'public'
  AND status <> 'pending_review');
-- comments
USING (deleted = false AND hidden = false AND EXISTS (
  SELECT 1 FROM public.posts p WHERE p.id = comments.post_id
    AND p.deleted = false AND p.hidden = false
    AND COALESCE(p.visibility, 'public') = 'public'
    AND p.status <> 'pending_review'));
-- polls
USING (deleted = false);
```

- [ ] Include a safe rollback comment: revoke SELECT, drop the three policies, remove the three tables from publication; never restore migration 006's unsafe eight-table list.
- [ ] Inspect publication, grants, and policies in a disposable staging database before/after applying. Assert exactly `comments`, `polls`, `posts` are published and zero anon/authenticated write grants exist.
- [ ] Run `npm run typecheck`, the static contract test, and commit without applying to production:

```powershell
git add api/migrations/016_realtime_rls_reconciliation.sql tests/api/realtime-rls-contract.test.ts
git commit -m "fix(db): reconcile anonymous realtime rls contract"
```

### Task 6: Replace Path-Based Admin Mapping with One Query-Tab Parser

**Files:** create `src/lib/adminTabs.ts`, `src/__tests__/adminTabs.test.ts`, `src/__tests__/PageContext.test.tsx`; modify Admin, PageContext, CommandPalette, AdminShell tests.

- [ ] Add RED tests for the exact 17 keys, `parseAdminTab("?tab=reports") === "reports"`, invalid `builder` → dashboard, and `adminTabHref("email-templates") === "/admin?tab=email-templates"`.
- [ ] Add a PageContext test rendering `/admin?tab=reports&status=open` and asserting `reports|Reports|{"status":"open"}` with `tab` excluded from filters.
- [ ] Export `AdminTabKey`, `ADMIN_TAB_GROUPS`, `ADMIN_TABS`, `ADMIN_TAB_KEYS`, `parseAdminTab`, and `adminTabHref`; parser normalizes leading `?`, lowercases, and rejects unknown keys.
- [ ] Refactor Admin, PageContext, and CommandPalette to consume the same registry. Preserve query-string update and Back behavior. CommandPalette admin commands are shown only to admin sessions.
- [ ] Run focused parser/context/AdminShell tests, typecheck, and commit:

```powershell
git add src/lib/adminTabs.ts src/pages/Admin.tsx src/components/admin/PageContext.jsx src/components/admin/PageContext.d.ts src/components/CommandPalette.tsx src/__tests__/adminTabs.test.ts src/__tests__/PageContext.test.tsx src/__tests__/AdminShell.test.tsx
git commit -m "fix(admin): share query-tab parsing across console surfaces"
```

### Task 7: Make StatusPage an Explicit Static Snapshot

**Files:** `src/pages/StatusPage.tsx`, `src/__tests__/StatusPage.test.tsx`.

- [ ] Add RED tests for the `System Status` heading, `/static snapshot.*not a live health check/i`, no `Last checked`, no refresh button, no Sentry test button/link, and zero timers.
- [ ] Remove dynamic timestamp state, fake refresh timer, public Sentry test control, and misleading live-status language. Rename hard-coded data to `STATIC_SERVICES`/`STATIC_INCIDENTS` and label it illustrative.
- [ ] Run `npm run test -- src/__tests__/StatusPage.test.tsx`, typecheck, and commit:

```powershell
git add src/pages/StatusPage.tsx src/__tests__/StatusPage.test.tsx
git commit -m "fix(status): remove misleading live health claims"
```

### Task 8: Preserve Last-Known-Good Admin Data on Failure

**Files:** ActivityStream/SecurityCenter and focused tests.

- [ ] Add RED tests: initial failure shows retryable alert and no “No events”; refresh failure keeps existing events and says “Showing last known events”; SecurityCenter behaves equivalently and does not update lastUpdate on failure.
- [ ] Add `loadError` state. On success set data and clear error; on failure do not clear data or update last-known timestamp. Render a full error state when no data exists, otherwise a stale/error alert with Retry.
- [ ] Run the focused tests, typecheck, lint, and commit:

```powershell
git add src/pages/admin/ActivityStream.tsx src/pages/admin/SecurityCenter.tsx src/__tests__/ActivityStream.test.tsx src/__tests__/SecurityCenter.test.tsx
git commit -m "fix(admin): preserve data when activity reads fail"
```

### Task 9: Make UserChat Failure States Honest

**Files:** `src/pages/UserChat.tsx`, `src/__tests__/UserChat.test.tsx`.

- [ ] Replace the “every API unreachable means empty” test with a retryable error test; add a test that existing messages remain visible when a later sync fails.
- [ ] Refactor `load()` so a successful inbox read or legacy fallback clears `loadError` and preserves messages; a failed mark-read does not erase a successful message read. If both reads fail, set a generic error and return the existing message list.
- [ ] Render a full retryable error when no messages exist, otherwise a stale/error alert with Retry. Never render “No messages yet” for a transport failure.
- [ ] Run the full UserChat suite, typecheck, and commit:

```powershell
git add src/pages/UserChat.tsx src/__tests__/UserChat.test.tsx
git commit -m "fix(chat): distinguish load failures from an empty inbox"
```

### Task 10: Add Direct Page Suites and Close Admin-Sweep Omissions

**Files:** create CommunityDetail, Contact, SystemHealth, PerformanceCenter, SecurityCenter tests; modify SystemHealth/PerformanceCenter and AdminTabSweep.

- [ ] Add CommunityDetail tests for 404 versus 503, retry, exact join/post payload, and last-known data. Add Contact tests for exact payload, success-after-POST, and accessible failure preserving fields.
- [ ] Add SystemHealth tests for successful health, manual refresh, initial failure, and stale data. Add PerformanceCenter tests for both performance/vitals reads, metric rendering, and stale data when one endpoint fails.
- [ ] Make the admin sweep a typed `Record<AdminTabKey, ...>` containing all 17 keys and assert its keys equal `ADMIN_TAB_KEYS`; include `agent-chat`, `ops-center`, and every other canonical tab.
- [ ] Run the direct suites and sweep, typecheck, and commit:

```powershell
git add src/__tests__/CommunityDetail.test.tsx src/__tests__/Contact.test.tsx src/__tests__/SystemHealth.test.tsx src/__tests__/PerformanceCenter.test.tsx src/__tests__/SecurityCenter.test.tsx src/__tests__/AdminTabSweep.test.tsx src/pages/admin/SystemHealth.tsx src/pages/admin/PerformanceCenter.tsx
git commit -m "test(pages): add outcome coverage for uncovered routes and admin tabs"
```

### Task 11: Correct Route-Level Test Definitions Without Running Browser Automation

**Files:** `tests/e2e/account-pages.spec.ts`, `full-platform.spec.ts`, `no-horizontal-overflow.spec.ts`, `audit.spec.ts`.

- [ ] Replace the nonexistent `/inbox` account route with `/settings`, `/notifications`, and `/chat`, and assert the intended heading plus absence of the 404 heading.
- [ ] Make full-platform tests assert each declared heading, not only body length/console output.
- [ ] Replace duplicated admin lists with `ADMIN_TAB_KEYS`; reject nonexistent `builder`; include all 17 canonical keys, including `agent-chat`, `ops-center`, and `email-templates`.
- [ ] Run only `npx playwright test --list`; do not run a browser test.
- [ ] Commit:

```powershell
git add tests/e2e/account-pages.spec.ts tests/e2e/full-platform.spec.ts tests/e2e/no-horizontal-overflow.spec.ts tests/e2e/audit.spec.ts
git commit -m "test(routes): remove placeholder paths and assert page headings"
```

### Task 12: Add the Security/Privacy Regression Gate

**Files:** `package.json` only.

- [ ] Add sequential scripts without changing existing commands:

```json
"test:security:api": "vitest run --config vitest.config.api.ts tests/api/notify-prefs.test.ts tests/api/request-body.test.ts tests/api/realtime-rls-contract.test.ts",
"test:security:ui": "vitest run src/__tests__/Privacy.test.tsx src/__tests__/Settings.test.tsx src/__tests__/StatusPage.test.tsx src/__tests__/PageContext.test.tsx src/__tests__/useRealtime.test.ts src/__tests__/ActivityStream.test.tsx src/__tests__/SecurityCenter.test.tsx src/__tests__/UserChat.test.tsx",
"test:security": "npm run test:security:api && npm run test:security:ui"
```

- [ ] Run `npm run test:security`, `npm run test`, `npm run test:api`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run audit:security` sequentially.
- [ ] Verify no real PII, no service key, no production migration, no anon writes, no private table allowlist, no timed page refresh, and no browser execution.
- [ ] Commit:

```powershell
git add package.json
git commit -m "test(security): add privacy and authorization regression gate"
```

## Plan Self-Review

- Every identified privacy/security/page blocker has a task and a focused regression test.
- Notification authorization defines owner success and all denial paths before storage access.
- Body parsing covers Web, Node, Buffer, strings, UTF-8, exact-limit, and malformed input.
- RLS and client allowlist share one contract and have staging-only migration checks.
- Admin tab identity is shared across navigation, context, command palette, and tests.
- Failure/status pages cannot claim live checks or show transport failures as empty data.
- No browser automation is executed; route definitions are collected only.
- All commands are sequential and scoped commits preserve unrelated dirty-tree work.
