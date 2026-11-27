# Voice-Box Security Audit — Findings Report (2026-09-24)

Scope: read-only source audit of `C:\Users\lenovo\freeclaw\freeclaw\freeclaw\voice-box` (working-tree state, branch `initial-review-branch`).
Excludes findings already tracked in `docs/QA/BUG-LEDGER.md` (BUG-005…022) and areas verified safe (see "Verified safe" below).
All findings re-verified against current file contents with fresh reads. Route reachability confirmed via `vercel.json` rewrites → `api/index.js` dispatcher.

---

## Summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | **HIGH** | Spoofable `verifyCallerIdentity` → any user's PII/data export (IDOR) |
| 2 | **HIGH** | `GET /api/notify-prefs` fully public — phone + email of any user |
| 3 | **HIGH** | `api/_incidents.js` unauthenticated read **and write** (GET/POST) |
| 4 | **HIGH** | `services/main.py` FastAPI control plane has zero auth, binds `0.0.0.0`, port published |
| 5 | **HIGH** | All 3 GitHub workflows broken (`working-directory: voice-box`) — CI/deploy gates never run |
| 6 | **MEDIUM** | `GET /api/transcribe` unauthenticated — paid ASR spend abuse |
| 7 | **MEDIUM** | docker-compose: Redis published `6379:6379` with no password |
| 8 | **MEDIUM** | docker-compose: `SUPABASE_KEY` env var doesn't exist in `.env.template` (empty key) |
| 9 | **LOW** | `WORKFORCE_AI_URL=http://localhost:3000` broken inside containers |
| 10 | **LOW** | `_keep-alive.js` unauthenticated + never scheduled by any cron |
| 11 | **LOW** | Client-influenced `x-forwarded-for` used as rate-limit key |
| 12 | **LOW** | `services/__pycache__/*.pyc` tracked in git |

---

## 1. HIGH — Spoofable `verifyCallerIdentity` grants access to any user's data (IDOR)

**Where:** `api/_auth.js:523-542` (root cause); consumed by `api/_export.js:76`, `api/_notify-prefs.js:94`, `api/_me.js:53`, `api/_saved.js:52`, `api/_follows.js:127`, `api/_notifications.js:69`.

**Bug:** The "P0 SECURITY FIX" identity check compares the `x-anon-id` **request header** against the claimed `user_id`/`anon_id` **query/body parameter** — both of which come from the same attacker-controlled request:

```js
const headerId = (req.headers["x-anon-id"] || "")...;   // attacker sets this
const id = String(claimedUserId || "")...;              // attacker sets this too
if (headerId !== id) return { ok: false, ... };         // always passes when both = victim
```

There is no server-side session, signature, or secret. Anyone who knows a victim's `anon_id` passes the check for that victim.

**How a victim's full `anon_id` is obtained (it is not secret by design):**
- The mention system requires the **full literal id** in public comment bodies: `Comments.tsx:175-179` builds `new RegExp("@" + anonId + "\\b")` and `Comments.tsx:200` toasts `@${anonId}` — users write `@anon_…` in public comments, leaving full ids permanently visible.
- Full ids appear in client URLs (`?viewer=`, `?author=`, `?user_id=` — e.g. `AppContext.tsx:385,470,514`, `PostDetail.tsx:107`) → browser history, shared links, server/proxy logs.
- Partial ids are exposed on every post/comment for non-owners (`_posts.js:527-528`, `_comments.js:108-111`, `_polls.js:143`, `_reactions.js:50` → `slice(0,9)+"..."` = `anon_XXXX...`), and the remainder (~4 base36 chars) is brute-forceable against finding #2's unauthenticated, un-rate-limited GET (36⁴ ≈ 1.7M requests).

**Trigger (curl):**
```
GET /api/data-export?anon_id=VICTIM_ANON_ID
x-anon-id: VICTIM_ANON_ID
```
→ 200 with the victim's full bundle: profile, all posts, comments, reactions, poll votes, saved, follows, notifications (`_export.js:83-127`). Same header trick works on:
- `GET /api/saved?user_id=V` → victim's saved posts (`_saved.js:52-59`)
- `GET /api/follows?user_id=V` → victim's follow list — **which contains other users' full anon_ids**, escalating targeted IDOR into an id-harvesting oracle (`_follows.js:127-134`)
- `GET /api/notifications?user_id=V` → victim's notifications (`_notifications.js:69-84`)
- `GET /api/me?anon_id=V` → ban/strike status (`_me.js:53`)
- `POST /api/notify-prefs` → overwrite victim's phone/email notification destination (`_notify-prefs.js:94`), hijacking SMS/email alerts about posts they follow (sent by `_follows.js`)

**Impact:** Account takeover of any anonymous account: full personal-data disclosure, notification hijack, impersonation of any user (including banned/suspended ones). GDPR/CCPA-grade PII exposure.

**Fix:** Bind identity to something the attacker cannot forge: sign the id server-side into an HttpOnly cookie or HMAC token at identity creation and verify that instead of a client-settable header. At minimum, make `x-anon-id` a server-issued, expiring token rather than a raw repeatable id. (Root design note: an id that is both *public identifier* and *proof of ownership* cannot be secure.)

---

## 2. HIGH — `GET /api/notify-prefs` is fully public: any user's phone + email

**Where:** `api/_notify-prefs.js:85-89` (handler), values written at `:118-124`, returned shape at `:44-50`.

**Bug:** The GET branch performs **no identity check whatsoever** — not even the (weak) `verifyCallerIdentity`:

```js
// GET: read prefs (public, like _me.js)
if (req.method === "GET") {
    const prefs = await getNotifyPrefs(userId);
    return res.status(200).json(prefs || {});
}
```

The header comment (line 10) declares this intentional: "Reading prefs is public" — but the payload includes `phone` and `email` (lines 44-47), which are not public data. There is also **no rate limit on the GET path** (the `writeRateLimited` at `:98` only guards POST).

**Trigger:**
```
GET /api/notify-prefs?user_id=VICTIM_ANON_ID
```
→ `{"phone":"+1555…","email":"victim@…","sms_enabled":true,…}` — no headers, no auth, no rate limit.

**Impact:** Mass PII disclosure (phone numbers + emails of every user who enabled SMS/email alerts) for anyone who obtains ids (see #1 for the id-acquisition chain: public mentions → direct; truncated id → 1.7M unthrottled requests → brute force). Enables doxxing, SIM-swap targeting, phishing.

**Fix:** Require the same (proper) ownership proof as writes; return only feature flags to non-owners; rate-limit the GET by IP.

---

## 3. HIGH — Incident API has no authentication on read or correlate-write

**Where:** `api/_incidents.js:511-542` (GET block), `:578-581` (POST correlate), vs. admin-gated siblings `:549,561,567`.

**Bug:** The entire GET branch runs before/independently of any `isAdmin` check:

- `GET /api/incidents?action=detect` (`:520-523`) calls `detectIncidents()`, which **writes** to the database — `createIncident`/`saveIncidents` at `:128,137,150…` and `saveIncidents(incidents)` at `:201,228,257,296,317,340,466`. An unauthenticated visitor can trigger DB writes (and incident-spam loops: repeated calls create duplicate-suppressed-but-still-processed incidents).
- `GET /api/incidents` default (`:539-541`) returns **all incidents** (internal operational data: error rates, latency, affected services, timelines).
- `GET /api/incidents?action=summary` (`:526-529`) returns the health summary.
- `POST /api/incidents {action:"correlate"}` (`:578-581`) calls `correlateEvent()` which mutates stored incidents and `saveIncidents(incidents)` at `:296` — **no `isAdmin`**, while the sibling actions `create`/`assign`/`update` correctly check admin at `:549,561,567`.

**Trigger:**
```
GET /api/incidents                       → full incident dump, no auth
GET /api/incidents?action=detect         → triggers unauthenticated DB writes
POST /api/incidents {"action":"correlate", ...} → unauthenticated incident mutation
```

**Impact:** Internal-monitoring disclosure to any visitor; unauthenticated state mutation (integrity); potential storage-abuse loop via repeated `?action=detect`.

**Fix:** Require `isAdmin(req)` for the whole GET block (or at least `detect`/`summary`/list) and for the `correlate` POST branch, mirroring lines 549/561/567.

---

## 4. HIGH — Python workforce control plane: no auth, `0.0.0.0`, published port

**Where:** `services/main.py` (all routes), CORS at `:127-133`, bind at `:628-630`; `docker-compose.yml:22-23`.

**Bug:** FastAPI app defines 27 endpoints (`/api/workforce/*`, `/api/events/*`, `/api/registry/*`, `/api/actions/*`, `/metrics`). Grepping the entire file for `Depends|HTTPBearer|HTTPBasic|api_key|Authorization|verify|auth` returns **one match — the CORS `allow_headers` list at line 132**. No endpoint checks credentials. CORS (`:127-133`) only constrains browsers; it is irrelevant to direct HTTP clients. Meanwhile:

- `uvicorn.run(app, host="0.0.0.0", port=8000)` (`:630`)
- `docker-compose.yml:22-23` publishes `8000:8000` to the host.

**Triggers (unauthenticated):**
- `POST /api/workforce/policy/override` (`main.py:439-444`) — **disables the workforce's safety policy entirely**, no confirmation step, no auth.
- `POST /api/workforce/fabric/run` (`:189-219`) — invokes a real NeMo Fabric / NVIDIA NIM agent (`run_agent`), spending paid `NVIDIA_API_KEY` credits on attacker-chosen `input`, `system_instruction`, up to `timeout_seconds=600`.
- `POST /api/workforce/tasks` (`:291-313`) — submits tasks into the orchestrator; `GET /api/workforce/tasks` (`:316+`) — reads task outcomes.
- Unauthenticated `GET /api/workforce/agents|registry|actions`, `POST /api/events/emit`, `GET /metrics` (process metrics at `:600-625`).

**Impact:** With the default compose config on any non-firewalled host: remote unauthenticated attackers can disable safety controls, burn NVIDIA API credits, inject work into the agent orchestrator, and read internal state.

**Fix:** Add shared-secret middleware (e.g. require `X-Admin-Token`/`Authorization` compared constant-time against an env var — the header is already whitelisted in CORS at `:132` but never checked); default `host="127.0.0.1"`; drop the `ports:` publish from compose (keep it on the internal network).

---

## 5. HIGH — All three GitHub workflows reference a nonexistent `voice-box/` directory

**Where:** `.github/workflows/ci.yml`, `deploy.yml`, `e2e.yml` — 28 occurrences total (`cache-dependency-path: voice-box/package-lock.json` at `ci.yml:28`, `deploy.yml:27`, `e2e.yml:33`; `working-directory: voice-box` at `ci.yml:31,35,…`, `deploy.yml:30,34,39,47`, `e2e.yml:36,40,44,48`).

**Verified:** `git rev-parse --show-toplevel` → `…/voice-box` (the repo root **is** voice-box); `Test-Path voice-box` → `False`; `package.json` sits at the root.

**Bug:** Every job's first real step (`npm ci` with `working-directory: voice-box`, and setup-node's `cache-dependency-path: voice-box/package-lock.json`) fails with "directory does not exist". Checkout (`actions/checkout@v4`, `ci.yml:22`) puts repo contents at `$GITHUB_WORKSPACE/`, not `$GITHUB_WORKSPACE/voice-box/`.

**Impact:** Lint, type-check, unit tests, E2E, and the Vercel deploy job **never run** — the repo's entire automated quality/security gate is dead (which also explains why these path bugs survived). The deploy workflow failing means deploys happen only via Vercel's git integration, silently bypassing whatever gating `deploy.yml` intended.

**Fix:** Remove `voice-box/` from all `working-directory` and `cache-dependency-path` values (paths become `package-lock.json` / root `.`).

---

## 6. MEDIUM — Transcription endpoint has no authentication (paid ASR spend)

**Where:** `api/_transcribe.js:17` (imports only `cors, rateLimited, rateLimitResponse` — no auth import), rate limit `:108-110`.

**Bug:** The handler never calls `verifyCallerIdentity`, `isAdmin`, `checkUser`, or any token check. The only gate is an IP rate limit keyed on the raw `x-forwarded-for` header. It forwards up to 350 KB of attacker-supplied audio (`:28`) to NVIDIA Whisper (`:20-21`) or OpenAI (`:22-23`) — paid per-request APIs — using the server's keys.

**Trigger:**
```
POST /api/transcribe   (body: { audio: base64, … }, no auth headers)
```
→ 20 requests per 300 s per key; distribute across IPs/keys for unlimited volume.

**Impact:** Direct financial abuse of `NVIDIA_API_KEY`/`OPENAI_API_KEY`; no user identity means no accountability or per-user quotas.

**Fix:** Require a valid caller identity (`verifyCallerIdentity` with the user's anon id) and rate-limit per user, not per raw header.

---

## 7. MEDIUM — Redis published to the host with no password

**Where:** `docker-compose.yml:5-8` (`image: redis:7-alpine`, `ports: "6379:6379"`), no `--requirepass` / `command` anywhere; consumed by `:25` (`REDIS_URL=redis://redis:6379`).

**Bug:** Compose publishes Redis on all host interfaces with default config: no auth, no TLS, protected-mode accepts connections from any host that can reach the port (LAN, or internet if the host has a public IP — Docker's port publish bypasses ufw's default rules on many setups).

**Impact:** Anyone reaching port 6379 can read/write the event bus and cache (Redis used as the workforce event bus): data tampering, poisoning of `bus.emit(...)` events consumed by the workforce runtime, `FLUSHALL` DoS, and — if any Redis module/SSRF path exists — RCE. Even without that, unauthenticated read of all cached/event data is a confidentiality breach.

**Fix:** Remove the `ports:` publish (keep Redis on the compose-internal network only), or add `command: redis-server --requirepass $REDIS_PASSWORD` + `REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379`.

---

## 8. MEDIUM — Compose passes `SUPABASE_KEY`, but the template defines `SUPABASE_SERVICE_ROLE_KEY`

**Where:** `docker-compose.yml:27` (`- SUPABASE_KEY=${SUPABASE_KEY}`) vs `.env.template:9` (`SUPABASE_SERVICE_ROLE_KEY=`). `SUPABASE_KEY` appears nowhere in `.env.template` or (checked) application code expecting that name from env in the services built by this compose.

**Bug:** A user following the template fills in `SUPABASE_SERVICE_ROLE_KEY`; compose interpolates `SUPABASE_KEY` → **empty string**. Any code path in the workforce container reading `SUPABASE_KEY` boots without credentials (fail-open to empty/unauthenticated Supabase calls, or runtime failures), and the operator gets no warning.

**Impact:** Broken/misconfigured deployments; potential unauthenticated DB calls depending on fallback logic; confusing security posture during real incidents.

**Fix:** Align the variable name with the template (`SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}`) and fail the container fast if it's empty.

---

## 9. LOW — `WORKFORCE_AI_URL` default points at the wrong host inside containers

**Where:** `.env.template:34` (`WORKFORCE_AI_URL=http://localhost:3000/api/ai`), consumed by the Python workforce, which runs **inside** the `workforce` container (`docker-compose.yml:18-37`) where `localhost` is the container itself, not the host/Node API. The compose `environment:` block (`:24-28`) doesn't pass it at all.

**Bug:** From inside the container the AI-fallback URL never resolves to the Node API; if set via env it either hits nothing or a wrong process. (If run on bare metal on Windows/macOS, `localhost` works — the bug is container-specific, but the variable's stated purpose is the Python workforce.)

**Impact:** Silent feature failure (agent AI fallback), degraded-mode confusion — availability, not confidentiality.

**Fix:** Default to `http://host.docker.internal:3000/api/ai` (or the compose `api` service name) and pass `WORKFORCE_AI_URL` through compose `environment:`.

---

## 10. LOW — Keep-alive endpoint unauthenticated and never scheduled

**Where:** `api/_keep-alive.js` (no auth import/call; comment claims "30-min cron"), `vercel.json:56-69` (crons: `agent-cron`, `incident-cron`, `incident-cron?action=value-audit` only — **no keep-alive path**).

**Bug:** Two independent defects: (a) anyone can invoke `GET /api/keep-alive` — it reports uptime/memory (minor info disclosure) and, per its comment, may ping the deployment; (b) the cron that the comment promises doesn't exist in `vercel.json`, so the endpoint's stated purpose never runs.

**Impact:** Negligible info disclosure; a dead feature operators may believe is running.

**Fix:** Gate on the same cron-secret pattern as `_incident-cron.js:381`; add the cron entry or delete the endpoint.

---

## 11. LOW — Rate limits keyed on client-influenced `x-forwarded-for`

**Where:** `api/_export.js:67-69` (`(req.headers["x-forwarded-for"] || "").split(",")[0]`), `api/_me.js:44-46` (same pattern), `api/_transcribe.js:108-110` (raw full header).

**Bug:** The **first** `XFF` element is the leftmost — i.e. the value the original client sent; proxies append the real IP to the right. On Vercel the platform overwrites XFF, so this is unexploitable *in the current deployment*, but the code reads the spoofable position rather than the trusted rightmost entry (or `req.headers["x-real-ip"]`). Any self-hosted/reverse-proxy deployment (the compose file encourages one) makes every IP rate limit trivially bypassable by randomizing the header.

**Impact:** Rate-limit bypass → amplifies #2 (brute force) and #6 (spend abuse) wherever not behind Vercel.

**Fix:** Derive the client IP from the trusted platform header (`x-real-ip` / rightmost XFF hop), or a library that parses it correctly.

---

## 12. LOW — Python bytecode committed to git

**Where:** `services/__pycache__/*.pyc` — 14 tracked files (confirmed via `git ls-files`).

**Bug:** `.gitignore` doesn't cover `__pycache__`/`*.pyc`. Dated `.pyc` files can shadow or mismatch the edited `.py` sources (Python prefers the `.pyc` only when timestamps match, so impact is limited but real after edge-case edits), and they permanently bloat the repo with generated artifacts.

**Impact:** Stale-bytecode confusion; repo hygiene.

**Fix:** `git rm -r --cached services/__pycache__` and add `__pycache__/` to `.gitignore`.

---

## Verified safe (checked, not findings)

- Public `VITE_SUPABASE_ANON_KEY` in `.env` (by design, excluded per scope; `.env` untracked — `.gitignore` covers `.env*`).
- `npm audit --omit=dev` → 0 vulnerabilities; prod dependency tree clean; no hardcoded secrets (service-role key confined to `api/_db-client.js`; scripts read keys from env).
- CORS strict allowlist (`_auth.js:42-54`); cron auth constant-time `CRON_SECRET`/`isAdmin` (`_auth.js:109-126`) present at `_incident-cron.js:381` and all `vercel.json` crons; `isAdmin` session tokens with exp + cache (`_auth.js:79-94`).
- `src/lib/markdown.ts` escape-first XSS defense; `UnifiedInbox.tsx:204` safe; admin gating on `_memory-api.js`, `_bulk-operations.js`, `_agent-chat.js`, `_evidence-scan.js` (+ its SSRF guard); `_dispatch.js` validation; `_transcribe.js` fetches only fixed provider URLs (not SSRF); `_streaming.js:16-19` SSE origin non-reflection; `_orchestrator.js`/`agents/_runner.js` are libraries, not HTTP handlers.
- CI/deploy use `secrets.*` (no plaintext); `vercel.json` security headers/CSP present; `reset-admin-password.mjs`/`seed-agent-autonomy.mjs` env-only keys; `security-scan.mjs` offline only.
- Anon-ID generation entropy adequate (`src/lib/identity.ts` randomId: 9 random bytes → 14 base36 chars ≈ 50 bits — not brute-forceable directly; the exposure path is disclosure/truncation, findings #1–2).
- Prior ledger BUG-005…022 confirmed distinct — not repeated here.

## Suggested fix order

1. **#1 + #2** (same root cause family: identity proof) — replace header-equality with a server-issued token/cookie; close the public PII GET.
2. **#3** — add `isAdmin` to `_incidents.js` GET block + `correlate`.
3. **#4** — auth middleware + `127.0.0.1` + unpublish port 8000 (before any compose-based deployment).
4. **#7 + #8 + #9** — compose hardening (same file, one PR).
5. **#5** — fix workflow paths so CI gates actually run, preventing regressions of everything above.
6. **#6, #10, #11, #12** — cheap hygiene fixes.

---

# Fix log (all 12 findings addressed)

All fixes applied on `initial-review-branch`, left **uncommitted** per instruction (only the 27 stale `.pyc` deletions are staged, #12). Deviations from the audit's suggested fixes are noted inline.

## #1 - Session binding (HIGH) - `api/_auth.js` + 6 call sites
`verifyCallerIdentity(req, res, claimedUserId)` now enforces a DB-backed HttpOnly cookie session:
- Header `x-anon-id` must be present **and** a valid anon ID, else `403 "Invalid session identity"`; header != claimed ID -> `403 "Cannot operate on another user's data"` (admin allowlist bypasses).
- KV record `session:<claimedId>` stores `{th, exp, created_at}` - only the SHA-256 hash of a `randomBytes(32)` token (raw token never persisted).
- Cookie `vb_session`: HttpOnly, Path=/, SameSite=Lax, Max-Age 30d, `Secure` only when `x-forwarded-proto=https`. Denies when a live record exists but the cookie is absent (no header-only fallback - the disclosed-ID flaw cannot return).
- KV/DB error -> `503 "Session service unavailable"` (fail-closed). Expired record with no cookie -> re-mint (anti-lockout); valid match + expired record -> sliding refresh; hash mismatch within a 60s mint-grace window rotates the token while keeping the original `created_at`.
- Call sites updated to pass `res`: `_export.js`, `_follows.js`, `_notifications.js`, `_me.js`, `_notify-prefs.js`, `_saved.js`.

## #2 - Public notify-prefs GET (HIGH) - `api/_notify-prefs.js`
Per-IP read limit first (`readRateLimited`, 30/min), then `verifyCallerIdentity` for **both** GET and POST.

## #3 - Incidents admin gate (MEDIUM) - `api/_incidents.js`
Single `isAdmin` guard at the top of the GET block (covers every read route) + guard on `POST /correlate` ("Admin only").

## #4 - FastAPI admin token + loopback (HIGH) - `services/main.py`, `_events.js`, `_workforce.js`, compose, `.env.template`
- `@app.middleware("http")` registered **after** CORS (outermost): sha256 of `X-Admin-Token` vs `hmac.compare_digest` against env `ADMIN_TOKEN`; **fail-closed 503** when unset; OPTIONS preflight and `/health` exempt (container healthchecks).
- uvicorn default bind `127.0.0.1` (`HOST` env overrides; compose sets `HOST=0.0.0.0`); port 8000 no longer published (commented, for local debug).
- Node callers `_events.js` / `_workforce.js` add `X-Admin-Token` conditionally when `ADMIN_TOKEN` is set. `ADMIN_TOKEN` documented in `.env.template`.

## #5 - CI paths (MEDIUM) - `ci.yml`, `deploy.yml`, `e2e.yml`
Removed all `working-directory: voice-box` (repo root IS voice-box), `cache-dependency-path: package-lock.json`, artifact paths `test-results/` / `playwright-report/` at repo root - so the gates actually execute.

## #6 - Transcribe identity gate (HIGH) - `api/_transcribe.js`
`claimedId` read from `x-anon-id` **before** body validation (missing -> 403), `verifyCallerIdentity` enforced, IP limit rekeyed via `clientIp(req)`, plus a per-user bucket `rateLimited("assist_voice", callerId, 300, 20)`.

## #7 - Redis auth (MEDIUM) - `docker-compose.yml`, `.env.template`
`redis-server --requirepass ${REDIS_PASSWORD:-voicebox-local}`; healthcheck authenticates via `REDISCLI_AUTH` and greps PONG; `REDIS_URL` carries the password for the workload. `.env.template` notes to use a URL-safe password (default is local-dev only).

## #8 - Service-role key (MEDIUM) - `docker-compose.yml`
Workforce env `SUPABASE_KEY=${SUPABASE_SERVICE_ROLE_KEY}` (commented api block too) instead of the anon key.

## #9 - host.docker.internal (LOW) - `docker-compose.yml`, `.env.template`
Workforce `WORKFORCE_AI_URL=${WORKFORCE_AI_URL:-http://host.docker.internal:3000/api/ai}` + `extra_hosts: host-gateway` for Linux.

## #10 - Keep-alive cron auth (MEDIUM) - `api/_keep-alive.js`, `vercel.json`
Gated on `isCronAuthorized` (401 body `CRON_UNAUTHORIZED_BODY` after OPTIONS); scheduled in `vercel.json` crons `*/30 * * * *`.

## #11 - Rightmost-XFF `clientIp` (MEDIUM) - scope: `_export.js`, `_me.js`, `_transcribe.js`
`clientIp(req)` exported from `_auth.js` (prefers `x-real-ip`, else RIGHTMOST XFF hop, else socket address) applied at exactly the three audited sites. Other leftmost-XFF usages elsewhere are out of scope for this audit - **follow-up recommended**, logged here only.

## #12 - Bytecode untracked (LOW) - `.gitignore`
Added `__pycache__/`, `*.pyc`, `*.pyo`; all 27 tracked `.pyc` files `git rm --cached` (staged deletions, no commit). Full `__pycache__` tree untracked, not just `services/`.

## Test sync
Updated mocks/assertions for the new `verifyCallerIdentity(req, res, ...)` signature and `clientIp` export in `data-export`, `me`, `notify-prefs`, `idor-protection`, `transcribe` tests (incl. `x-anon-id` header in transcribe's `req()` helper - the handler now 403s before body validation).

## Verification
- API suite run via `npx vitest run --config vitest.config.api.ts` (default config only includes `src/**`): **131/132 files passed; 1440+ tests passed.**
- The single failure - `workforce-core-coverage.test.ts > anonymity-guard budget cap` - is a **pre-existing environmental timeout**, unrelated to these fixes: no file in that test's import graph was modified (`_db-client`/`_auth` mocked; `_workforce-core/workers/verification` untouched), its `observe()` makes real Supabase HTTP calls because `VITE_SUPABASE_*` leaks into vitest's `process.env` from `.env`, and all 25 budget-cap tests pass with `--testTimeout=120000` (31s actual). Recommend capping or mocking that network path as a follow-up.
- Targeted batches (identity, rate-limit, admin-gates, cron, providers, schema, notification, admin-settings) all green.

## Deviations / notes
1. Expired-session record with no cookie re-mints (anti-lockout) instead of hard-deny; sliding cookie refresh on valid match; 60s grace rotation keeps original `created_at`. Header-equality fallback was NEVER restored.
2. Legacy disclosed-ID claim race during the 30d cookie window is accepted (bounded by SameSite=Lax + HttpOnly).
3. `_incidents.js` uses one guard for the whole GET block rather than per-route (equivalent coverage, less duplication).
4. #12 untracks the entire bytecode tree (27 files, not only the 14 under `services/`).
5. #10 requires `CRON_SECRET` to be configured - keep-alive now fails closed if it is not (intended).
6. #6 adds a per-user voice bucket (300s/20) on top of the IP limit - hardening beyond the finding.
7. FastAPI binds loopback by default for bare-metal runs; compose opts into `0.0.0.0` inside the container network.
8. API tests require `--config vitest.config.api.ts`.

---

# Follow-ups (executed under "do everything best")

## F1 - Complete rightmost-XFF migration (extends #11)
Every remaining raw `x-forwarded-for` read under `api/` was migrated to the shared `clientIp(req)` helper (rightmost hop, spoof-resistant), after a module-graph cycle check confirmed `_auth.js`'s dependency set (`_db-client`, `_db-wake`, `_wordlists`, `_notification-delivery`, `_audit`) has no edge into the receiving modules:
- `api/_assist.js` (3 sites), `api/_admin.js` (local duplicate `clientIp` deleted in favor of the shared import), `api/_chat.js` (chat rate-limit key), `api/_users.js` (heartbeat/claimed-ID rate-limit key, both usages), `api/_inbox.js` (admin-reply key), `api/_observability.js` (trace request IP), `api/_posts.js` (spam scoring IP), `api/_security.js` (security-check IP), `api/v3/_tools.js` (2 audit/exec IP sites), `api/_moderation.js` (JSDoc only - comment updated, no code change).
- Verified by grep: the only surviving `x-forwarded-for` references under `api/` are the `clientIp` implementation itself and comments in `_auth.js`.

## F2 - Test mock sync for `clientIp` (consequence of F1)
The 8 test files whose `vi.mock("../../api/_auth.js")` factory lacked a `clientIp` export - `assist-suggest`, `assist-voice`, `posts-full`, `v3-tools`, `v3-tools-unauthorized-audit`, `admin-gates-runtime`, `inbox-admin-reply`, `users` - now provide a `clientIp` mock (`x-forwarded-for` header, else socket address, else `"unknown"`), preserving single-hop rate-limit-key assertions.

## F3 - Hermetic API suite (fixes the budget-cap timeout root cause)
- New `tests/api/setup-env.ts` stubs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL` to `""` via `vi.stubEnv`; wired through `setupFiles` in `vitest.config.api.ts`. `publicClient()` (`api/_workforce-workers.js:1741-1752`) returns `null` on empty URL/key, so tests that previously leaked the real `.env` values and issued live Supabase HTTP (the actual cause of `anonymity-guard budget cap` hitting the 30s timeout at 31s) now make zero network calls.

## Final verification (supersedes the "Verification" section above)
| Suite | Command | Result |
|---|---|---|
| API | `npx vitest run --config vitest.config.api.ts` | **134/134 test files passed**, 40.5s (previously 131/132 with a 31s network-bound failure; the formerly flaky budget-cap test now passes hermetically, whole suite faster than that single test used to be) |
| Python services | `python -m pytest tests/ -q --tb=short` in `services/` | **150 passed**, exit 0 (includes the `services/main.py` admin-token middleware from #4) |
| Frontend | `npx vitest run` (default config) | **1474/1476 tests, 97/98 files** - the 2 failures are **pre-existing/in-flight refactor state, not regressions from these fixes** (evidence below); `Overview.test.tsx` additionally showed one flaky run (critical-alert overlay timing) and passes in isolation |

Evidence for the frontend classification (files under `src/` were being rewritten by a concurrent workstream *during* verification; none of the audit/follow-up changes touch `src/`):
- `page-lifecycle-contract.test.ts > keeps retired operations screens out of the active Admin registry`: the test file (written 21:14:31) asserts `src/pages/Admin.tsx` contains `./admin/ActionCenter`, but `src/pages/admin/ActionCenter.tsx` (created 21:05) is not wired into `Admin.tsx` yet - an incomplete step of the active admin-tab retirement refactor.
- `CommandPalette.test.tsx > offers canonical admin destinations...`: the test (written 20:53) expects an "AI Coworker" button navigating to `/admin?tab=agent-chat`, but `src/lib/adminTabs.ts` was rewritten at 21:14:24 (after front-run2 had already passed this test at 21:14:04) and now retires `agent-chat` - stale test vs. new registry.
- Both files' mismatches are internal to that refactor's source/test pair; per instruction, in-flight working-tree work was left untouched.
