# Firebase standby — what is actually true today

Supabase is the **primary**. Firebase (`voicelflow`) is the **standby copy**.
Every classification below is deliberate: nothing here is marked tested unless
a test asserts it, and nothing is marked working unless it works without a
credential we do not have.

Run the proof:

```bash
cd voice-box
npx vitest run --config vitest.config.api.ts \
  tests/api/mirror.test.ts \
  tests/api/standby-copy.test.ts \
  tests/api/failover.test.ts \
  tests/api/backend-router.test.ts \
  tests/api/firebase-adapter.test.ts
```

---

## 1. The design

```
user write
   │
   ▼
Supabase (PRIMARY)  ──commits──►  response to the user
   │
   │  same call, observed in api/_db-client.js
   ▼
api/_mirror.js  ──►  Firestore  projects/voicelflow/documents/<table>/<row id>
                     (one document per row, overwritten on update)
```

Two properties make this safe rather than decorative:

1. **One choke point.** Every Supabase query in the app goes through the
   custom `fetch` in `api/_db-client.js`. Observing writes there means a new
   endpoint physically cannot forget to replicate, and there is no second
   definition of "what counts as a write".
2. **The mirror cannot break the write.** Supabase has already committed when
   the mirror runs. A mirror failure is recorded as `pending`/`failed` and
   retried later — it never turns a successful save into an error.

The document id is derived from the row's own id, so an update **overwrites**
the standby copy instead of appending a duplicate. Delivery is at-least-once
with an idempotency key of `table:op:row id:payload hash`; an identical repeat
is skipped.

---

## 2. Deliverable status

| # | Deliverable | Status | Evidence / limit |
|---|---|---|---|
| 1 | Full audit of the write path | **Implemented + tested** | `tests/api/standby-copy.test.ts` asserts the mirror is wired to the single fetch choke point |
| 2 | Data protection first (a copy failure never fails a save) | **Implemented + tested** | `mirrorWrite` never throws; `observePrimaryWrite` is fully try/caught |
| 3 | Shared write gateway | **Implemented + tested** | `api/_db-client.js` → `observePrimaryWrite` |
| 4 | Continuous replication on commit | **Implemented + tested** | `tests/api/mirror.test.ts`: insert, batch, upsert, delete |
| 5 | Retry of failed copies | **Implemented + tested** | bounded queue, 5 attempts then dropped; `flushMirrorQueue` tests |
| 6 | Reviewable failover state machine | **Implemented + tested** | `api/_failover.js` — 8 states, asymmetric thresholds, fencing tokens |
| 7 | Report standby health honestly | **Implemented + tested** | `backend.status().standby_copy` with `lagging`, `pending`, `failed`, `transport` |
| 8 | Standby copy drained on a schedule | **Implemented + tested** | `runScheduledReplication()` flushes it before anything else |
| 9 | Queue draining independent of feature flags | **Implemented + tested** | the test runs with `failover:false, replication:false` and still drains |
| 10 | Operator surface | **Implemented + tested** | `GET /api/reliability`; `POST {action:"flush-standby-copy"}` (admin, audited) |
| 11 | Service-account auth (OAuth2 JWT bearer) | **Implemented, not live-tested** | unit-tested only through stubs; no `FIREBASE_SERVICE_ACCOUNT_JSON` in this repo |
| 12 | ID-token auth (`FIREBASE_ID_TOKEN`) | **Implemented + tested** | used by the test suite |
| 13 | Configurable table scope | **Implemented + tested** | `MIRROR_TABLES` override test |
| 14 | Excluding high-churn agent tables | **Implemented + tested** | `isMirroredTable("agent_conversations") === false` |
| 15 | Conflict rules on the write path | **Implemented + tested** | `api/_backend/conflict.js` + router tests (`StaleWriteError` never fails over) |
| 16 | Idempotent writes | **Implemented + tested** | `api/_backend/idempotency.js`, `WRITE_IN_FLIGHT` → 429 |
| 17 | Dead-letter queue for standby writes | **Implemented + tested** | `api/_backend/dlq.js`, `/api/reliability` actions |
| 18 | Tenant isolation on the standby copy | **Implemented** | `tenant_id` is on every mirrored event; **Firestore rules are not deployed** |
| 19 | Automatic read switch to the standby | **Implemented + tested** | `api/_standby-read.js`; fires on 5xx / 402 / 429 / 408 / transport failure for mirrored tables (`tests/api/standby-read.test.ts`) |
| 20 | Storage object replication | **Not implemented** | needs a bucket-to-bucket copy decision |
| 21 | Auth user / password continuity | **Not implemented** | Firebase cannot import Supabase password hashes; would need a reset-on-failover flow |
| 22 | Independent backup of the standby | **Not implemented** | needs a scheduled export target |
| 23 | Monitoring / alerting on lag | **Partial** | `standby_copy.lagging` is exposed; no external alerter wired |
| 24 | Free-tier budget guard | **Partial** | table scope limits volume; no quota counter |
| 25 | Live failover drill | **Not run** | refused in production by design; needs a staging run |
| 26 | Android client sync | **Blocked** | needs a real `google-services.json`; fabricating one is not acceptable |
| 27 | Windows/Electron client sync | **Not needed for reads** | clients talk to `/api`; the copy is server-side |
| 28 | Web client | **Implemented** | unchanged; gains nothing to break |
| 29 | Firestore security rules | **Not deployed** | the copy is written with server credentials only |
| 30 | Rollback | **Implemented + tested** | delete the credential / leave flags off → primary-only, `configured:false` |

**Summary: 15 implemented and tested, 3 implemented but not live-tested,
3 partial, 4 not implemented, 1 blocked, 2 unchanged.**

---

## 3. What you must provide (the only blockers)

| Variable | Purpose | Where |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | server writes to Firestore | Vercel → Project → Settings → Environment Variables |
| *or* `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` + `FIREBASE_PROJECT_ID` | same, split form | same |
| `FIREBASE_ID_TOKEN` | short-lived alternative, for a smoke test | same |

Get a service account key from the Firebase console → `voicelflow` → Project
settings → Service accounts → *Generate new private key*. Treat it as a
production secret: it can write the whole standby database.

Until one of these is set, the honest state is:

```json
{ "configured": false, "transport": "none", "delivered": 0, "pending": 0 }
```

`mirrorWrite` returns `reason: "not_configured"`. It never reports success.

**Do not** put `FIREBASE_SERVICE_ACCOUNT_JSON` in the web bundle, the APK, or
the Electron `app.asar`. Only `api/` may read it. The public web config
(`apiKey`, `appId`, `projectId`) is a client identifier, not a credential.

---

## 4. Turning it on

```bash
# 1. Configure the credential (above), then verify the path is live:
curl -s https://<host>/api/reliability -H "Cookie: <admin session>" | jq .standby_copy
# expect: configured true, transport "service-account"

# 2. Make a real write in the app, then re-read:
# expect: delivered >= 1, pending 0, lagging false

# 3. Drain anything queued:
curl -s -X POST https://<host>/api/reliability \
  -H "Content-Type: application/json" -H "Cookie: <admin session>" \
  -d '{"action":"flush-standby-copy"}'
```

Traffic does **not** move to the standby until you also set
`RELIABILITY_FAILOVER_ENABLED=1`. Writing the copy and routing traffic are
separate decisions on purpose: the first is safe to enable today, the second
needs a staging drill.

---

## 5. Automatic switch on the read path

```
GET /api/posts
   │
   ▼
Supabase  ──5xx / 402 (egress limit) / 429 / 408 / timeout──┐
   │ ok                                                     │
   ▼                                                        ▼
rows                                                    Firestore runQuery
                                                             │ rows
                                                             ▼
                                              Response + X-Standby-Read: firebase
```

When Postgres returns an internal error or the egress/quota limit is reached,
a read of a mirrored table is answered from the standby instead of failing.
The route code is untouched: `_db-client.js` returns a normal `Response`, so
supabase-js parses it exactly as if the primary had answered.

What it deliberately will **not** do:

- **Move traffic on an application error.** 400/401/403/404/422 mean the
  request was wrong, not that the database is down. Failing over on those
  would answer under a different backend for an unrelated reason.
- **Accept writes.** A write that cannot reach the primary still fails closed
  with a retryable message. Accepting it into the standby with no durable
  reconciliation path is the data loss this architecture exists to prevent.
- **Translate a query it cannot reproduce.** Only `field=eq.value` filters are
  mapped; `gt`, `in`, `like`, `or` and full-text return the real error rather
  than a different result set.
- **Fake an empty result.** An unfiltered list that comes back empty from the
  standby returns the primary's error, because "no rows copied yet" and "no
  rows exist" must never look the same. An empty result for a *filtered*
  lookup (e.g. `id=eq.x`) IS returned: that is a real "not found".

Every served response carries `X-Standby-Read: firebase`, and
`standby_copy.lagging` / `standbyReads` in `/api/reliability` show whether the
switch is actually being used.

> **This only helps if the standby has the data.** With no Firebase credential
> configured the copy is empty, so the switch declines and the user gets the
> real error. Configure `FIREBASE_SERVICE_ACCOUNT_JSON` (section 3) for the
> standby to mean anything.

## 6. Known limits, stated plainly

- **Counters are per instance.** In serverless, `pending` describes the warm
  instance that answered. The real check is whether it is persistently non-zero
  across polls, not any single reading.
- **The retry queue is in memory.** A process death loses queued events. Work
  lost that way is still in Supabase — nothing is destroyed — but the copy is
  not gap-free until a durable outbox exists. That is why `pending` is exposed
  and why `control_plane.durable` is reported.
- **No backfill.** A table that was not mirrored when it was written is not
  retroactively copied. `backend.replicate()` covers the adapter-stack path,
  not the mirror.
- **No cross-provider transactions.** Supabase commits first, always. The
  standby is eventually consistent, which is the correct trade for a copy.
