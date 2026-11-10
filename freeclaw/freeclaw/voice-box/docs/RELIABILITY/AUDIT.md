# VoiceFlow Reliability Audit — Phase 0

**Status:** evidence-gathered, read-only. No production state was modified.
**Date:** 2026-11-07
**Scope:** web (Vercel SPA), Android (Capacitor APK), desktop (Electron EXE), admin console, Supabase data layer.

Every number below was produced by a re-runnable read-only probe, not estimated. Probe scripts live in `D:\Temp\opencode\` and their raw output in `D:\Temp\opencode\voiceflow-recovery\`.

---

## 1. Verified production identity

| Item | Value | How verified |
|---|---|---|
| Production URL | `https://voice-box-psi.vercel.app` | `GET /api/version` → 200 |
| Deployed commit | `31f2aaa315dcab18d43270419136470c9a4e045b` | `/api/version` body |
| App title | "Voice Flow — Anonymous School Feedback Platform" | `GET /` `<title>` |
| Vercel project | `voice-box` / `prj_qlgIg4LZowlvNq1AKDz4dV3Srjcv` | Vercel CLI |
| Vercel team | `team_swuVQyCP7CcREueAK5xIVxnf` | Vercel CLI |
| Supabase project | `kfesjnidtejyldytdwfl.supabase.co` | `.env.local` |

> **`https://voice-box.vercel.app` is NOT this application.** It returns a Next.js document (no title, 6,123-byte body, `/api/version` → 404). It must never be used as a VoiceFlow health target or failover endpoint. This is a real footgun for any monitoring that guesses the "obvious" domain.

---

## 2. Platform inventory

### Web
- React + Vite SPA, deployed to Vercel.
- Serverless entry: single consolidated `api/index.js` with an internal route map (~130 handlers). `vercel.json` rewrites `/api/*` → `/api/index.js`.
- 182 files in `api/`, 4 non-underscore entry files.
- 415 test files (`tests/api/**`, `tests/e2e/**`, unit).

### Android
- Capacitor shell, package `app.voicebox`, namespace `app.voicebox`.
- Gradle 8.11.1, `versionCode 5`, `versionName 2.0.3`.
- Only permission: `INTERNET`. `android:allowBackup="false"` present.
- **No `google-services.json`** — Firebase is not registered for this package.
- **Debug-signed only** — no `signingConfigs` block, so the APK is not store-distributable.
- WebView cookie patch (`scripts/patch-android-webview-cookies.mjs`) is mandatory between `cap sync` and Gradle; without it `vb_session` is dropped as a third-party cookie.

### Desktop
- Electron + electron-builder, asar enabled.
- `webPreferences` at `electron/main.cjs:167-172` leave Electron secure defaults on (no Node in renderer, isolated context, `webSecurity` on). Device store is reached only through `preload.cjs`.
- Build requires `VB_NATIVE_ELECTRON=1` because `vite.config.ts:97` switches `base` between `"./"` (Electron `file://`) and `"/"` (web). The cross-platform wrapper is `scripts/desktop-build.mjs`.
- **macOS:** `electron-builder.yml` contains mac/dmg strings but no verified macOS build exists. Treat macOS as **not supported** until a real target is confirmed.

### Admin
- 26 pages under `src/pages/admin/`.
- Auth: `isAdmin(req)` in `api/_auth.js:158`, reads `x-admin-token`, 30s cache, fails closed.

---

## 3. Data layer — the central finding

### 3.1 Schema drift: 38 declared vs 76 live

Migrations under `api/migrations/*.sql` declare **38 tables**. The live database contains **76**.

**42 tables exist in the live DB but in no migration:**

```
app_data              awards                chat                  chat_polls
cricket_matches       death_overs           diet_log              equipment
fitness_log           injuries              match_schedule        matches
mon_activity_heartbeats  mon_agent_registry  mon_alerts          mon_app_events
mon_app_usage_daily   mon_audit_log         mon_daily_rollups     mon_daily_summaries
mon_device_events     mon_employees         mon_focus_rules       mon_focus_violations
mon_leave_requests    mon_owners            mon_screenshots       mon_settings
mon_stream_frames     mon_stream_sessions   mon_url_events        opponents
performance_data      player_stats          players               points_table
powerplay_data        rcbian_log            sync_log              tournaments
training_sessions     trips
```

**4 tables declared in migrations but absent from the live DB:**

```
workforce_actions  workforce_alerts  workforce_heartbeats  workforce_incidents
```

`api/migrations/012_workforce_ledger.sql` was **never applied**. Do not assume any migration reflects live schema — the migration directory is a *partial* record, not the source of truth.

### 3.2 This Supabase project is shared with unrelated applications

The 42 foreign tables are clearly other products: cricket statistics (`cricket_matches`, `points_table`, `powerplay_data`, `player_stats`), personal tracking (`diet_log`, `fitness_log`, `trips`, `rcbian_log`), and an employee-monitoring suite (`mon_*`, 19 tables).

Consequences that constrain this whole project:

1. **Backup/replication scope must be the 34 VoiceFlow tables only.** Replicating 76 tables would copy other products' data into a second vendor — a privacy and cost problem.
2. **No destructive DDL** may be run against this project. Dropping or altering "unused" tables risks other applications.
3. **Firebase standby must not become a copy of unrelated data.**

### 3.3 Row inventory (VoiceFlow scope)

`84,028` total rows across the 34 reachable VoiceFlow tables. Largest:

| Table | Rows |
|---|---|
| `agent_activity_log` | 22,669 |
| `system_metrics` | 15,991 |
| `users_meta` | 14,660 |
| `settings` | 13,403 |
| `agent_executions` | 11,553 |
| `activity_logs` | 1,547 |
| `audit_logs` | 1,582 |
| `agent_reports` | 755 |
| `agent_suggestions` | 481 |
| `comments` | 344 |
| `posts` | 214 |
| `tool_calls` | 251 |
| `tool_evidence` | 174 |
| `settings`-adjacent + remaining tables | < 200 each |

Four tables are genuinely missing live (`workforce_*`, 404), matching §3.1.

### 3.4 Anonymous-key exposure — verified GOOD

Tested every one of the 76 live tables with the public anon key:

| Result | Count |
|---|---|
| VoiceFlow tables readable by anon | **3** — `posts` (200), `comments` (7), `polls` (12) |
| **Foreign** tables readable by anon | **0** |
| Protected (401/403/404) | 73 |

This is the intentional realtime allowlist. `api/migrations/005_rls_hardening.sql` drops all policies, enables RLS on every public table, and revokes all privileges from `anon`/`authenticated`/`PUBLIC`. `014_revoke_anon_private_tables.sql` documents the three-table exception.

**This posture must be preserved exactly.** Any Firebase mirror must reproduce it: only `posts`, `comments`, `polls` publicly readable; everything else deny-by-default.

### 3.5 All data access is server-side

Clients never hold the service role key. Every handler goes through `api/_db-client.js`, which:
- lazily proxies a service-role Supabase client,
- bounds outbound concurrency (`DB_MAX_CONCURRENCY=32`),
- enforces `DB_TIMEOUT_MS=15000`,
- **fails closed** in production if the service key is missing.

Client Realtime degrades to a 10s polling fallback for non-allowlisted tables (`src/lib/useRealtime.ts`), because RLS denies anon SELECT on them.

**Therefore the "shared backend gateway" already exists: it is `/api`.** Failover authority belongs inside that serverless layer, not in localStorage, Android preferences, or per-client code. There is no need to build a second gateway.

---

## 4. Storage

- Two Supabase Storage buckets: **`chat-media`** and **`voicebox-media`** (`api/_upload.js:12`, `api/_storage.js:16`).
- Uploads are server-side (`api/_upload.js`), gated by an image-safety screen that fails closed. No data-URL fallback.
- Public URLs are issued via `getPublicUrl`.
- A 24h orphan sweep reclaims unreferenced objects older than 7 days (`api/_storage.js`).

Storage replication is therefore **in scope** and must mirror both buckets plus the `settings` rows that reference held-review snapshots.

---

## 5. Existing resilience module (reuse, do not duplicate)

`api/_reliability.js` already provides:

- `CircuitBreaker` (CLOSED → OPEN → HALF_OPEN → CLOSED)
- global `circuits` for `supabase`, `llm`, `toolExecution`
- `withRetry` (exponential backoff + jitter)
- `withFallback`, `withDegradation`, `withTimeout`
- `Bulkhead`
- `healthRoute`, `getAllCircuitStatus`

The new backend core **builds on** these primitives. It adds adapters, a health monitor, a failover controller, replication, idempotency, and conflict rules.

---

## 6. Dependency map — what breaks when Supabase is unavailable

| Surface | Fails without Supabase | Why |
|---|---|---|
| Feed / posts / comments / polls | Yes | All reads through `/api` → Supabase |
| Auth / sessions | Yes | Session rows in Supabase |
| Admin console | Yes | Every admin route queries Supabase |
| Uploads | Yes | Buckets are Supabase Storage |
| Realtime (allowlisted) | Yes | Supabase Realtime channels |
| Realtime (non-allowlisted) | Yes | Already polls `/api`, which is down |
| Web shell load | **No** | Static SPA assets served by Vercel CDN |
| Android/EXE shell launch | **No** | Bundled assets |
| `/api/version` | **No** | Static response, no DB |

The blast radius is total for data operations and zero for shell delivery. That split is what makes an active/standby data plane viable: the client can always load and can always show a maintenance state.

---

## 7. Environment inventory

- 36 declared keys; 87 referenced in code.
- Used but undeclared: `ADMIN_SESSION_SECRET`, `ALLOWED_ORIGINS`, `SENTRY_DSN`, `LATEST_EXE_URL`.
- `.env.local` contains: `NVIDIA_API_KEY`, `GROQ_API_KEY`, `SUPABASE_URL`/`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_ENV`.
- **No Firebase credentials** — neither the web config's server counterpart nor a service account JSON. The supplied web config (`appId 1:765393264593:web:f8ab6b61d4a262f194caf0`) is client-side only.

---

## 8. Blocking gaps (honest classification)

| Gap | Classification | Missing action |
|---|---|---|
| Android Firebase registration | **Blocked** | Genuine `google-services.json` for `app.voicebox` from Firebase console |
| Firebase server replication | **Blocked** | Firebase service-account JSON (Admin SDK) |
| Independent control-plane CAS store | **Blocked (production path)** | Upstash/Redis REST credential; memory fallback implemented for tests |
| Transactional outbox DDL | **Partial** | Migration authored, cannot be applied live without approved DDL window; watermark CDC fallback implemented |
| Release APK signing | **Not implemented** | `signingConfigs` + keystore; current APK is debug-signed |
| macOS build | **Not supported** | No verified target; documented, not fabricated |

Everything not in this table can be implemented and tested locally.

---

## 9. Invariants this project must never violate

1. Do not run destructive DDL against the shared Supabase project.
2. Do not replicate the 42 foreign tables.
3. Do not expose anything to `anon` beyond `posts`, `comments`, `polls`.
4. Do not put the service-role key or Firebase Admin credentials in web, APK, or EXE bundles.
5. Do not surface database errors to end users.
6. Do not claim backup success without a restore test into an isolated environment.
7. Do not claim failover works without simulating the outage in staging.
8. Do not replace production with the new data plane while its flag is off.
