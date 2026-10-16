# Voice Flow — Complete Architecture

> **Version:** 1.0  
> **Last updated:** 2026-07-29  
> **Live at:** https://voice-box-psi.vercel.app

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Directory Map](#3-project-directory-map)
4. [Request Flow (End to End)](#4-request-flow-end-to-end)
5. [Authentication & Identity Model](#5-authentication--identity-model)
6. [Database Schema](#6-database-schema-supabase-postgresql)
7. [AI / Agent System](#7-ai--agent-system-deep-dive)
8. [Security Architecture](#8-security-architecture)
9. [Frontend Architecture](#9-frontend-architecture-deep-dive)
10. [Deployment](#10-deployment)
11. [API Reference (Route Map)](#11-api-reference-route-map)
12. [Metrics](#12-metrics)
13. [Known Issues & Constraints](#13-known-issues--constraints)

---

## 1. Overview

**Voice Flow** is an **anonymous school feedback platform** where students post problems/suggestions anonymously and staff/AI triage, moderate, and resolve them. It evolved from a simple anonymous complaints board into a sophisticated system with AI agents, enterprise observability, 50+ LLM provider integrations, and real-time messaging.

**Brand / Identity:** Voice Flow — "Your Voice Matters" — low-barrier, anonymous participation with AI-assisted triage.
---
## 2. Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend framework** | React + TypeScript | 19.2 / 5.9 |
| **Bundler** | Vite | 7.3 |
| **CSS engine** | TailwindCSS | 4.2 |
| **CSS transformer** | LightningCSS | (via Vite) |
| **Icons** | lucide-react | 0.577 |
| **Routing** | react-router-dom | 7.13 |
| **HTTP client** | Native fetch wrapper | - |
| **Backend runtime** | Node.js (Vercel serverless) | 20+ |
| **Entry point** | Single api/index.js | - |
| **Database** | Supabase PostgreSQL | - |
| **Real-time** | Supabase Realtime channels | JS 2.99 |
| **AI/LLM** | 50+ providers (NVIDIA NIM default) | - |
| **Auth** | Anonymous ID + admin SHA-256 token | - |
| **Testing** | Vitest | 4.1 |
| **CI/CD** | Vercel (auto-deploy on push) | - |

---

## 3. Project Directory Map

```
voice-box/
|
+-- api/                          68 Vercel serverless modules
|   +-- index.js                  SINGLE ENTRY POINT
|   |   - Imports 30+ handler modules
|   |   - Route dispatch by HTTP method + URL path
|   |   - Global unhandledRejection / uncaughtException
|   |   - /api/cron endpoint
|   |
|   +-- SHARED UTILITIES (8 modules)
|   |   +-- _auth.js              Auth, rate limiting, moderation
|   |   +-- _security.js          CSP, prompt injection (70+ patterns)
|   |   +-- _error.js             Error sanitization (no internals leaked)
|   |   +-- _validate.js          Input validation
|   |   +-- _observability.js     Logging, tracing, metrics
|   |   +-- _events.js            Event bus (10 event types)
|   |   +-- _db-client.js         Supabase server client
|   |   +-- _db-wake.js           DB keep-alive
|   |
|   +-- CORE CRUD (5 modules)
|   |   +-- _posts.js             Posts + moderation + trending
|   |   +-- _comments.js          Comments + nested replies
|   |   +-- _reactions.js         Support/unsupport toggle
|   |   +-- _polls.js             Polls + voting
|   |   +-- _inbox.js             AI messaging + emotional routing
|   |
|   +-- AI / AGENT SYSTEM (12+ modules)
|   |   +-- _providers.js         50+ LLM providers + failover chain
|   |   +-- _agent.js             Suggestion engine (read-only)
|   |   +-- _agent-chat.js        Admin AI chat + intent engine
|   |   +-- _ai.js / _ai-chat.js / _ai-resolution.js
|   |   +-- _agents-cron.js       3AM scheduled execution
|   |   +-- _agent-executions.js  Execution tracking
|   |   +-- _event-agents.js      Event-driven triggers
|   |   +-- _orchestrator.js      Agent orchestration
|   |   +-- _meta-agent.js        Meta-agent oversight
|   |   +-- _rag.js               RAG system
|   |
|   +-- ADMIN OPERATIONS (12+ modules)
|   |   +-- _admin.js             Login/logout/session
|   |   +-- _reports.js           Moderation queue
|   |   +-- _moderation.js        Content moderation
|   |   +-- _duplicates.js        Duplicate detection
|   |   +-- _command-center.js    Command center
|   |   +-- _proactive.js
|   |   +-- _pre-publish.js / _pre-publish-review.js
|   |   +-- _search.js / _stats.js / _batch.js / _cleanup.js
|   |
|   +-- SYSTEM (5+ modules)
|   |   +-- _health.js / _cache.js / _gateway.js
|   |   +-- _keep-alive.js / _production-error.js
|   |
|   +-- v3/                       8 ENTERPRISE V3 MODULES
|   |   +-- _stream.js / _audit.js / _tools.js
|   |   +-- _verify.js / _orchestrate.js
|   |   +-- _rag.js / _memory.js / _security.js
|   |
|   +-- migrations/
|       +-- 002_agent_system.sql
|       +-- 003_v3_enterprise.sql
|
+-- src/                          FRONTEND
|   +-- main.tsx                  Entry point + splash screen
|   +-- App.tsx                   21 lazy routes + ErrorBoundary
|   |
|   +-- lib/
|   |   +-- supabase.ts           Browser Supabase (Realtime only)
|   |   +-- api.ts                HTTP wrapper
|   |   +-- identity.ts           Anonymous ID (UUID v4)
|   |   +-- useRealtime.ts        Shared channel registry
|   |   +-- offline.ts            Offline queue
|   |   +-- speech.ts             SpeechRecognition
|   |   +-- puter.ts              Puter.js AI chat fallback
|   |   +-- moderation.ts         Client-side moderation
|   |   +-- utils.ts              Constants, helpers
|   |
|   +-- pages/
|   |   +-- Home.tsx              Feed + filter + sort + word cloud
|   |   +-- Submit.tsx            New post + speech-to-text
|   |   +-- PostDetail.tsx        Detail + comments + polls
|   |   +-- UserChat.tsx          AI chat (Puter.js fallback)
|   |   +-- Suggestions.tsx / Polls.tsx / SolvingBoard.tsx
|   |   +-- MyActivity.tsx / Admin.tsx / Settings.tsx
|   |   +-- Changelog / About / Contact / Terms
|   |   +-- Accessibility / NotFound / StatusPage
|   |   +-- admin/                22 tab components
|   |
|   +-- components/
|   |   +-- Layout.tsx            Shell + nav + offline indicator
|   |   +-- PostCard / PollCard / Comments / WordCloud
|   |   +-- Trend / CountUp / FadeIn / CommandPalette
|   |   +-- RecapCard / admin/PageContext / ui/
|   |
|   +-- contexts/
|   |   +-- AppContext.tsx        Global state (anonId, theme, toast)
|   |
|   +-- types/
|       +-- index.ts              TS type definitions
|
+-- vercel.json                   CSP, rewrites, caching, cron
+-- vite.config.ts                manualChunks, LightningCSS
+-- package.json                  Dependencies
```

---

## 4. Request Flow (End to End)

```
Browser              Vercel Edge          Vercel Serverless          Supabase
  |                      |                       |                      |
  | GET /api/posts       |                       |                      |
  +-------------------->|                       |                      |
  |                      | Rewrite -> /api/      |                      |
  |                      +--------------------->|                      |
  |                      |                       |                      |
  |                      |                       | 1. CSP headers      |
  |                      |                       | 2. CORS check       |
  |                      |                       | 3. Rate limit       |
  |                      |                       | 4. Security check   |
  |                      |                       | 5. Parse body       |
  |                      |                       | 6. Route dispatch   |
  |                      |                       |    |                |
  |                      |                       | 7. Handler          |
  |                      |                       |    +-- validate()   |
  |                      |                       |    +-- checkUser()  |
  |                      |                       |    +-- supabase     |
  |                      |                       |    |   .from()      |
  |                      |                       |    |   .select()    |
  |                      |                       |    |   .eq()       +>----->|
  |                      |                       |    |   .range()     |      |
  |                      |                       |    +-- return data  |      |
  |                      |                       |                    |<-----+
  |                      |                       | 8. Sanitize error  |
  |                      |                       | 9. Log + trace     |
  |                      |<---------------------+ 10. Return JSON     |
  |<---------------------+                       |                    |
  |                      |                       |                    |
  | (Parallel)           |                       |                    |
  | Realtime SUBSCRIBE   +------------------------------------------->|
```

---

## 5. Authentication & Identity Model

### 5.1 Anonymous Users (99% of traffic)

- **No accounts. No emails. No passwords.**
- Every user uniquely identified but fully anonymous
- Rate limits per-anon-id per-endpoint
- Ban/suspension per-anon-id

Browser generates UUID v4 on first visit, stores in localStorage.
Sends as author_id header on every request.

### 5.2 Admin Authentication

Admin enters password on /admin:
- POST /api/admin/login sends password
- Server SHA-256 hashes password, compares with stored hash (timing-safe)
- Match -> 60-min session token stored in Supabase settings.admin_sessions
- Returned to client, stored in localStorage
- Every admin API call sends x-admin-token header
- Server validates token (30s in-memory cache)
- All destructive actions audit-logged

---

## 6. Database Schema (Supabase PostgreSQL)

### 6.1 Core Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| posts | id, title, description, category, tags, status, priority, author_id, reactions, admin_reply, status_history, moderation_status, ai_summary, created_at | Problem/suggestion posts |
| comments | id, post_id, parent_id, body, author_id, moderation_status, created_at | Comment threads |
| reactions | id, author_id, target_type, target_id, kind, created_at | Support votes |
| polls | id, question, options, votes, author_id, active, created_at | Polls |
| reports | id, target_type, target_id, reason, reported_by, status, resolved_by | Moderation queue |
| users_meta | anon_id, banned, strikes, spam_score, first_seen, last_seen | User metadata |
| settings | key, value (JSONB) | System config, providers, events |

### 6.2 Inbox / Chat Tables

| Table | Purpose |
|-------|---------|
| chat_threads | id, subject, category, status, priority, assigned_to, ai_mode, created_at |
| chat_messages | id, thread_id, role (user/ai/admin), body, metadata, created_at |

### 6.3 Agent System Tables (v2)

| Table | Purpose |
|-------|---------|
| agent_executions | id, agent_id, status, started_at, duration, result |
| agent_activity_log | id, agent_id, action, target, details, created_at |
| agent_suggestions | id, type, target_id, suggestion, status, expires_at |
| agent_tasks | id, agent_id, type, params, status, result, created_at |
| system_metrics | id, metric_name, value, recorded_at |

### 6.4 Enterprise V3 Tables

| Table | Purpose |
|-------|---------|
| tool_calls | AI tool execution tracking |
| approvals | id, action_type, target, requested_by, approved_by, status |
| audit_logs | id, action, actor, target, details, ip_address, created_at |
| knowledge_docs | id, title, content, embedding VECTOR(1536), created_at |
| agent_memory | id, agent_id, key, value, type, created_at |
| agent_definitions | Agent system prompts + config |
| agent_teams | Agent team orchestration |

### 6.5 Key Indexes

- posts (status, category, created_at DESC) -- feed queries
- posts (author_id) -- user activity
- comments (post_id, created_at) -- threaded display
- reactions (target_type, target_id) -- reaction counts
- chat_messages (thread_id, created_at) -- inbox
- agent_executions (agent_id, status) -- agent monitoring
- audit_logs (created_at DESC) -- recent actions

---

## 7. AI / Agent System (Deep Dive)

### 7.1 LLM Provider Architecture (_providers.js)

**Provider Resolution Flow:**
1. Read DB settings: api_providers (JSON array with priorities)
2. Has providers? Sort by priority, use first available
3. Empty / not configured? Use hardcoded failover chain:
   - NVIDIA NIM: Nemotron Ultra 550B (primary)
   - NVIDIA NIM: GLM-5.2 (fallback 1)
   - NVIDIA NIM: Llama 3.1 8B (fallback 2)

**Provider Categories (50+ total):**
- OpenAI-compatible: OpenAI, Azure OpenAI, Together, Fireworks, OpenRouter, Deep Infra
- Anthropic-compatible: Anthropic Claude
- Google: Gemini
- Chinese: DeepSeek, Qwen, GLM, Baidu, Alibaba, ByteDance, Zhipu, Moonshot, Stepfun, MiniMax
- Cloud inference: AWS Bedrock, GCP Vertex AI
- Specialized: Groq (fast inference), Replicate, Perplexity
- Self-hosted: Ollama, vLLM, LocalAI, LM Studio
- NVIDIA NIM: Default -- Nemotron, Llama, GLM

**Failover logic:** Try provider[0] -> fail -> try provider[1] -> fail -> try provider[2] -> fail -> return error

### 7.2 Inbox AI System (_inbox.js)

The most complex agent -- ~860 lines:

1. Validate input, check rate limits, save message to DB
2. Emotion Classification (2-tier):
   - TIER 1 (Fast): Keyword-based (15+ patterns)
     - suicide, kill myself, self-harm -> crisis
     - angry, furious, frustrated -> angry
     - sad, depressed, hopeless -> sad
     - anxious, worried, scared -> anxious
     - thanks, grateful, appreciate -> grateful
   - TIER 2 (LLM): If TIER 1 returns neutral or mixed
3. Agent Routing based on emotion:
   - crisis -> ALWAYS emotional support + notify admin
   - emotional -> emotional support agent
   - general -> general assistant agent
4. Admin Handoff if user requests human/agent/real person
5. Generate AI Reply via failover LLM chain
6. Save and return response

### 7.3 Admin Agent Chat (_agent-chat.js)

Natural language admin interface -- ~800 lines:

Available intents (20+):
- count_all / count_by_status / count_by_category / count_by_priority
- search_posts / search_users
- latest_posts / top_reported / most_voted
- summarize / trending / analytics
- help / status_board / report
- ban_user / unban_user
- set_status / set_priority / delete_post
- reply / announce

All destructive actions require explicit admin confirmation (execute parameter).
Every action is audit-logged.

### 7.4 Suggestion Engine (_agent.js)

Read-only AI that generates suggestions for human approval:
- Triggered by cron (3 AM) or manual
- Analyzes each open post (title + description + comments)
- Generates suggestions: mark resolved, escalate, merge, close as duplicate
- All are read-only -- admin must approve in SuggestionsTable
- Suggestions expire after 48 hours

### 7.5 Event-Driven Agents

10 event types triggering agent workflows:
1. post.created -> moderation agent reviews
2. comment.created -> spam check agent
3. reaction.created -> trend detection agent
4. report.created -> escalation agent
5. status.changed -> notification agent
6. priority.changed -> triage agent
7. user.banned -> cleanup agent
8. user.unbanned -> restoration agent
9. agent.suggestion -> approval agent
10. system.alert -> diagnostic agent

---

## 8. Security Architecture

### 8.1 Defense Layers (10 layers)

| Layer | Name | Implementation |
|-------|------|----------------|
| 1 | CSP | Strict Content-Security-Policy on all responses |
| 2 | CORS | Whitelist: production + Vercel preview + localhost |
| 3 | Rate limiting | Per-anon-id, per-endpoint limits with 429 responses |
| 4 | Input validation | String lengths, UUID format, enum values, URL/email format |
| 5 | Input sanitization | Strip control chars, trim, length caps, profanity masking |
| 6 | Content moderation | Violence/hate speech/spam/PII detection on all writes |
| 7 | Prompt injection | 70+ regex patterns for prompt injection detection |
| 8 | Auth verification | checkUser() verifies not banned/suspended on every write |
| 9 | Admin auth | SHA-256 + timing-safe compare + 30s in-memory cache |
| 10 | Error handling | sanitizeError() never leaks SQL/paths/env/URLs |

### 8.2 Prompt Injection Detection (_security.js)

70+ regex patterns including:
- Ignore all previous instructions
- Forget everything above
- You are now [role]
- Your system prompt is...
- Ignore your training
- Base64/hex encoded instructions
- STFU / Ignore patterns

Match blocks request with 400 response.

### 8.3 Content Moderation (_auth.js)

Applied to every post, comment, and message:
- maskProfanity(): common profanity -> f***, slurs -> [blocked]
- Violence detection: 20+ patterns (kill, murder, shoot, bomb, hurt)
- PII detection: phone numbers, emails, addresses auto-stripped
- Spam detection: excessive links, repeated chars, CAPS ratio > 70%

---

## 9. Frontend Architecture (Deep Dive)

### 9.1 Component Hierarchy

<ErrorBoundary>
  <AppContext.Provider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          |
          +-- Lazy: Home.tsx            /
          +-- Lazy: Submit.tsx          /submit
          +-- Lazy: PostDetail.tsx      /post/:id
          +-- Lazy: UserChat.tsx        /chat
          +-- Lazy: Admin.tsx           /admin (18 lazy tabs)
          +-- Eager: NotFound.tsx       *
          +-- 15 more lazy pages
        </Route>
      </Routes>
    </BrowserRouter>
  </AppContext.Provider>
</ErrorBoundary>

### 9.2 State Management

All state lives in AppContext.tsx:
- anonId: string (from localStorage)
- theme: dark | light (toggle + persist)
- toasts: Toast[] (global toast queue)
- isOnline: boolean (navigator.onLine + events)
- showOnlineIndicator: boolean
- isTutorialComplete: boolean

No Redux, no Zustand, no React Query. Each page manages own state.

### 9.3 Real-time Data Flow

Uses useRealtime() hook with registry pattern:
- Multiple components subscribing to same table share ONE Supabase channel
- Reference-counted subscribers, debounced callbacks (500ms)
- On INSERT/UPDATE/DELETE: broadcast to all subscribers
- Fallback: 5s polling if Realtime fails or stagnates

### 9.4 Offline Support

Failed API writes are queued to localStorage and replayed on next page load.

### 9.5 Routing (21 routes)

| Path | Component | Type |
|------|-----------|------|
| / | Home | Eager |
| /board | SolvingBoard | Lazy |
| /submit | Submit | Lazy |
| /post/:id | PostDetail | Lazy |
| /suggestions | Suggestions | Lazy |
| /polls | Polls | Lazy |
| /chat | UserChat | Lazy |
| /my-activity | MyActivity | Lazy |
| /admin | Admin (18 tabs) | Lazy |
| /settings | Settings | Lazy |
| /changelog | Changelog | Lazy |
| /about | About | Lazy |
| /contact | Contact | Lazy |
| /terms | Terms | Lazy |
| /accessibility | Accessibility | Lazy |
| /status | StatusPage | Lazy |
| * | NotFound | Eager |

---

## 10. Deployment

### 10.1 Vercel Configuration (vercel.json)

- CSP headers on all responses
- Rewrites: /api/* -> /api/index.js
- Static asset caching: 24h
- Cron: agents-cron at 3 AM daily

### 10.2 Build Optimization (vite.config.ts)

manualChunks splits into:
- react-vendor: React + ReactDOM
- supabase-vendor: @supabase/supabase-js
- icons-vendor: lucide-react
- admin-vendor: src/pages/admin/ (only loaded on /admin)

Results: ~261 KB main chunk, separate vendor/admin chunks.

---

## 11. API Reference (Route Map)

All routes handled by api/index.js:

| Method | Route | Module | Purpose |
|--------|-------|--------|---------|
| GET | /api/posts | _posts | List posts (paginated) |
| POST | /api/posts | _posts | Create post |
| GET | /api/posts/:id | _posts | Get single post |
| PUT | /api/posts/:id | _posts | Update post |
| DELETE | /api/posts/:id | _posts | Delete post |
| GET | /api/comments/:postId | _comments | Get comments |
| POST | /api/comments/:postId | _comments | Create comment |
| DELETE | /api/comments/:id | _comments | Delete comment |
| POST | /api/reactions | _reactions | Toggle reaction |
| GET | /api/polls | _polls | List polls |
| POST | /api/polls | _polls | Create poll |
| POST | /api/polls/:id/vote | _polls | Vote on poll |
| GET | /api/inbox/threads | _inbox | List threads |
| POST | /api/inbox | _inbox | Create thread |
| POST | /api/inbox/:id/message | _inbox | Send message |
| POST | /api/inbox/:id/takeover | _inbox | Admin takeover |
| GET | /api/suggestions | _agent | List suggestions |
| POST | /api/suggestions/:id/approve | _agent | Approve suggestion |
| POST | /api/agent-chat | _agent-chat | Admin AI chat |
| POST | /api/admin/login | _admin | Admin login |
| POST | /api/admin/logout | _admin | Admin logout |
| GET | /api/admin/stats | _admin | Dashboard stats |
| GET | /api/reports | _reports | List reports |
| POST | /api/reports | _reports | Create report |
| PUT | /api/reports/:id | _reports | Update report |
| GET | /api/health | _health | Health check |
| POST | /api/cron | _agents-cron | Scheduled tasks (3AM) |
| GET | /api/providers | _providers | List providers |

Plus 40+ more routes across all handler modules.

---

## 12. Metrics

| Metric | Count |
|--------|-------|
| API handler modules | 68 |
| Enterprise V3 modules | 8 |
| Frontend pages | 21 |
| Admin tabs | 18 |
| Supabase tables | ~20 |
| Database indexes | 30+ |
| LLM providers supported | 50+ |
| Agent types | 10 event-driven + cron + inbox + chat |
| Admin intent patterns | 20+ |
| Prompt injection patterns | 70+ |
| Content moderation patterns | 40+ profanity/slurs, 20+ violence |
| Inbox AI lines | ~860 |
| Agent chat lines | ~800 |
| Total API lines | ~15,000+ |
| Total frontend lines | ~10,000+ |
| CSP directives | ~20 |

---

## 13. Known Issues & Constraints

| Issue | Impact | Workaround |
|-------|--------|------------|
| tsc -b fails (~200 errors) | No type checking in CI | vite build succeeds (esbuild skips types) |
| Missing lucide-react declarations | Type errors on icon imports | Icons render correctly at runtime |
| Missing override on lifecycle methods | ErrorBoundary errors | ~10 files, doesnt block build |
| index.html is 0 bytes | Relies on Vite transformIndexHtml | Vite handles via plugin |
| C: drive ~1.5 GB free | Cannot install new npm packages | Work with existing deps |
| Subagent dispatch fails | Cannot parallelize across agents | Work directly |
| No auth users (fully anonymous) | No user recovery, no cross-device ID | Intentional design choice |

---

> **End of Architecture Document**
