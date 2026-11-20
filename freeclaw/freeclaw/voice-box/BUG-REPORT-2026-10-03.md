# Voice-Box Bug Report (2026-10-03)

Scope: read-only review of `C:\Users\lenovo\freeclaw\freeclaw\freeclaw\voice-box`
(branch `review-fix`, working tree). Complements `AUDIT-REPORT.md` (which covered
reads/security); this report focuses on the **current** state and on gaps the
prior audit's fix did not close.

Validation run during review:
- `npm run lint` → clean
- `npx vitest run` → **117 files / 1714 tests passed**
- API subset (`vitest.config.api.ts`) → 93 tests passed

> Note: the working tree changed under me mid-review. A fresh `npm run typecheck`
> failed with `src/pages/admin/PostsTable.tsx(875,62): error TS1005: ':' expected`
> and `npm run lint` reported 3 errors; minutes later, with no edits from me,
> both were clean and the full suite was green. Something else is actively
> editing this tree — see P5.

---

## P1 — HIGH: Writes/edit/delete still authorized by the public `x-anon-id` header

The prior audit's session fix bound **read/exfil** endpoints to a server-issued
HttpOnly cookie via `verifyCallerIdentity()`, but every **state-changing**
endpoint still derives identity from the raw, client-settable `x-anon-id`
header and only calls `checkUser()` — which checks ban/suspend status, nothing
more (`api/_auth.js:161-184`).

Consequently, anyone who knows a victim's full `anon_id` can act **as** that
victim: create posts/comments/polls, vote, react, report, file appeals, and
**edit / soft-delete / lock / change the visibility** of the victim's content.

Evidence — authz is header-equality only:

| Endpoint | Location | Operation |
|---|---|---|
| `POST /api/comments` | `api/_comments.js:144-151` | comment as victim |
| `PUT /api/comments` | `api/_comments.js:315-319` | edit/delete victim's comment (`callerId === cmt.author_id`) |
| `POST /api/posts` | `api/_posts.js:676-682` | create post as victim |
| `PUT /api/posts` | `api/_posts.js:1036-1053` | edit / soft-delete / lock / change visibility of victim's post |
| `POST /api/polls` | `api/_polls.js:218-223` | vote as victim |
| `PUT /api/polls` | `api/_polls.js:521-531` | archive/delete victim's poll |
| `POST /api/reactions` | `api/_reactions.js:65-69` | toggle victim's reactions |
| `POST /api/reports` | `api/_reports.js:503-507` | report as victim |
| `POST /api/appeals` | `api/_appeals.js:145,202` | appeal as victim |
| `POST /api/users` | `api/_users.js:41` | uses header **or body** `anon_id` |

By contrast these DO prove session possession, proving the inconsistency:
`verifyCallerIdentity` is called in `_export.js:76`, `_saved.js:52`,
`_follows.js:127`, `_notifications.js:69`, `_me.js:73/109`,
`_notify-prefs.js:109`, `_transcribe.js:124`, `_chat.js:265`,
`_inbox.js:1437`.

`api/index.js` (dispatcher) and `protect()` (`api/_production-error.js:24-57`)
perform **no** session check — `protect` only sets CORS/headers and catches errors.

Precondition — a victim's full `anon_id` is discoverable:
- Public comment bodies can contain the literal `@<full anonId>`; mention
  detection matches the **full** id (`src/components/Comments.tsx:175-180`,
  toast at `:200`). Comment bodies are returned to all viewers.
- Full ids ride in request URLs the user creates/shares and that land in browser
  history, referrers, and proxy/server logs, e.g. `?viewer=`, `?author=`
  (`src/pages/Home.tsx:258`, `src/contexts/AppContext.tsx:554`,
  `src/pages/PostDetail.tsx:107`).

Trigger (illustrative):
```
POST /api/comments
x-anon-id: <VICTIM_ANON_ID>
{"post_id":"<id>","body":"..."}
```
```
PUT /api/posts
x-anon-id: <VICTIM_ANON_ID>
{"id":"<victim post id>","deleted":true}
```

Impact: impersonation + data/integrity destruction. The audit rated the
identical read-side flaw HIGH; the write side is at least as severe and remains open.

Fix: in every mutating route, call `verifyCallerIdentity(req, res, headerId)`
(or a dedicated write-session guard) before acting, exactly like the read
routes; keep the admin bypass. The client already sends the HttpOnly `vb_session`
cookie same-origin (including offline-queue replay), so this is compatible with
the offline queue and native shell.

---

## P2 — MEDIUM: unhandled promise rejections on lazy chunk load

The WIP perf refactor moved heavy modules to dynamic `import()`, but two call
sites drop the promise without a rejection handler:

- `src/lib/useRealtime.ts:261` — `void import("./supabase").then(...)` has no
  `.catch`. `src/lib/supabase.ts` is null-safe (won't throw on missing env), but
  a **network** chunk-load failure still rejects → unhandled rejection, and the
  realtime subscription silently never attaches (no retry).
- `src/main.tsx:11-13` — `void initSentry()`; `initSentry` awaits
  `import("@sentry/react")` (`src/lib/sentry.ts`), so a failed chunk load
  rejects unhandled.

Fix: `.catch(() => {})` (or a bounded retry) at both sites.

---

## P3 — LOW: comment dedup returns a partial row (inconsistent response shape)

`api/_comments.js:272` returns the deduped twin selected with only
`id, post_id, parent_id, body, created_at, deleted, hidden` (+ `deduped:true`),
while the normal insert path (`:300`) returns the full inserted row
(`author_id`, `is_admin`, …). Any consumer that reads `author_id`/`is_admin`
from a POST response gets a differently-shaped object on a deduped submit.
Currently latent — the client ignores the POST body and reloads — so low impact.
Fix: `.select()` the full row for the twin (or return `{...twin, deduped:true}`
from a full-column select).

Related: the twin scan (`api/_comments.js:254-261`) is `.limit(10)` with no
`parent_id` DB filter; if an author posts >10 comments on one post within 90s,
a legitimate twin can fall outside the window and a duplicate lands.

---

## P4 — LOW: committed double-CR line endings

`src/pages/admin/PostsTable.tsx` (1144 occurrences of `\r\r`) and
`src/components/admin/WorkItem.tsx` (145) contain `\r\r\n` line endings, and the
corruption is present in `HEAD`, not only the working tree. Verified with the
TypeScript compiler API that `\r\r\n` does **not** by itself break parsing (0
diagnostics), so this is hygiene/robustness, not the cause of the transient
parse error in P5 — but it is abnormal (git prints `LF will be replaced by
CRLF`) and makes line-numbered tooling inconsistent. Normalize to LF/CRLF.

---

## P5 — Process: concurrent edits make validation a moving target

Between two identical commands (no edits by me) the tree went from a
build-breaking `PostsTable.tsx` syntax error + 3 lint errors → clean lint +
1714/1714 tests. Treat any single green run with suspicion until the tree stops
changing; re-run the gate on a frozen commit before relying on it.

---

## Verified clean (checked, not findings)

- Prior audit fixes are present and correct: `verifyCallerIdentity` cookie
  session (`api/_auth.js:670-790`); `_notify-prefs` GET gated + rate-limited
  (`:99-115`); `_incidents` GET and `correlate` admin-gated (`:520,584`);
  `_keep-alive` cron-gated (`api/_keep-alive.js:12`); FastAPI `X-Admin-Token`
  middleware is constant-time and fail-closed (`services/main.py:148-173`).
- New dedup/rate-limit changes are sound and tested
  (`tests/api/comment-twins.test.ts`); reactions rate-limit block
  (`api/_reactions.js:79-90`) is correctly ordered after `checkUser`.
- Only `useRealtime.ts` references `supabase` (type-only), so the lazy-import
  optimization is intact; admin pages are `retryLazy`-loaded, so
  `ErrorTracking`'s static `@sentry/react` import does not hit the boot chunk.
- No tracked `.env`, `.apk`, `__pycache__`, `dist`, or `test-results`.
- Request-body parser and top-level dispatcher handle malformed/oversized input
  and errors defensively (`api/_request-body.js`, `api/index.js:286-324`).
