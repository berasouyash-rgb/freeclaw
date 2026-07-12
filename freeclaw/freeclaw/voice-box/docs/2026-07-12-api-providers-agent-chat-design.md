# Design: Multi-Provider API Keys + Admin Agent Chat

**Date:** 2026-07-12
**Status:** Approved
**Author:** Opencode AGI

## 1. Overview

Add two major features to Voice Box admin panel:
1. **Multi-Provider API Key Management** — Configure and switch between 7 AI providers with automatic failover
2. **Admin Agent Chat** — Natural language interface to manage the entire app with approval workflow

## 2. Architecture

### 2.1 Hybrid Key Storage (Safest Approach)

**Existing env vars remain as fallback.** DB keys override when present.

```
Priority Chain:
1. DB settings (api_providers) — admin can change without redeploy
2. Env vars (NVIDIA_API_KEY, ANTHROPIC_API_KEY) — existing, backward compatible
3. Heuristic fallback — no API key needed
```

**Why hybrid is safest:**
- Zero breaking changes for existing deployments
- Env vars still work if DB is empty
- Admin can upgrade to DB-managed keys anytime
- No migration needed for existing users

### 2.2 Provider Chain with Failover

```
Request → Try Provider 1 (DB or env) → Success? Return
                                        ↓ Fail
                                  Try Provider 2 → Success? Return
                                                    ↓ Fail
                                                  Try Provider 3 → ...
                                                    ↓ All fail
                                                  Heuristic fallback
```

**Failover triggers:**
- HTTP 429 (rate limit) → skip to next provider
- HTTP 401/403 (bad key) → skip, mark provider as failed
- Timeout (8s) → skip to next
- Network error → skip to next
- Invalid JSON response → skip to next

**Provider priority order (configurable in DB):**
1. OpenAI (GPT-4o) — best reasoning
2. Anthropic (Claude Sonnet) — best analysis
3. Google Gemini (2.5 Pro) — best multimodal
4. NVIDIA NIM (Llama 3.1 70B) — free tier available
5. Mistral (Large) — fast
6. DeepSeek (V3) — cheap
7. Groq (Llama 3.3 70B) — fastest inference

## 3. Database Schema

### 3.1 New Settings Row

```sql
INSERT INTO settings (key, value) VALUES ('api_providers', '{
  "openai": {
    "key": "",
    "model": "gpt-4o",
    "enabled": false,
    "priority": 1,
    "status": "untested",
    "last_tested": null
  },
  "anthropic": {
    "key": "",
    "model": "claude-sonnet-4-6",
    "enabled": false,
    "priority": 2,
    "status": "untested",
    "last_tested": null
  },
  "gemini": {
    "key": "",
    "model": "gemini-2.5-pro",
    "enabled": false,
    "priority": 3,
    "status": "untested",
    "last_tested": null
  },
  "nvidia": {
    "key": "",
    "model": "meta/llama-3.1-70b-instruct",
    "enabled": false,
    "priority": 4,
    "status": "untested",
    "last_tested": null
  },
  "mistral": {
    "key": "",
    "model": "mistral-large-latest",
    "enabled": false,
    "priority": 5,
    "status": "untested",
    "last_tested": null
  },
  "deepseek": {
    "key": "",
    "model": "deepseek-chat",
    "enabled": false,
    "priority": 6,
    "status": "untested",
    "last_tested": null
  },
  "groq": {
    "key": "",
    "model": "llama-3.3-70b-versatile",
    "enabled": false,
    "priority": 7,
    "status": "untested",
    "last_tested": null
  }
}');
```

### 3.2 Agent Conversations Table

```sql
CREATE TABLE agent_conversations (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  actions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_conv_session ON agent_conversations(session_id);
```

## 4. API Endpoints

### 4.1 Provider Management (`/api/admin`)

**GET `/api/admin?action=providers`**
- Returns all provider configs (keys masked)
- Requires admin auth

**POST `/api/admin` with `action: "update_provider"`**
```json
{
  "action": "update_provider",
  "provider": "openai",
  "config": {
    "key": "sk-...",
    "model": "gpt-4o",
    "enabled": true,
    "priority": 1
  }
}
```

**POST `/api/admin` with `action: "test_provider"`**
```json
{
  "action": "test_provider",
  "provider": "openai"
}
```
- Sends test prompt: "Say 'hello' in JSON: {\"response\": \"hello\"}"
- Returns: `{ success: true, latency_ms: 234, model: "gpt-4o" }`

**POST `/api/admin` with `action: "reorder_providers"`**
```json
{
  "action": "reorder_providers",
  "order": ["anthropic", "openai", "gemini", "groq", "nvidia", "mistral", "deepseek"]
}
```

### 4.2 Agent Chat (`/api/admin`)

**POST `/api/admin` with `action: "agent_chat"`**
```json
{
  "action": "agent_chat",
  "session_id": "abc123",
  "message": "Hide all spam posts"
}
```

**Response:**
```json
{
  "reply": "I found 3 spam posts. Here's what I'll do:",
  "actions": [
    {
      "id": "act_1",
      "type": "hide_post",
      "target": "post_xyz",
      "title": "Buy cheap followers!!!",
      "before": { "hidden": false },
      "after": { "hidden": true },
      "reason": "Spam: promotional content with external link"
    },
    ...
  ],
  "requires_approval": true
}
```

**POST `/api/admin` with `action: "agent_execute"`**
```json
{
  "action": "agent_execute",
  "session_id": "abc123",
  "action_ids": ["act_1", "act_2", "act_3"]
}
```
- Executes approved actions
- Returns results with before/after states

## 5. LLM Tool Definitions

The agent chat uses **function calling** (OpenAI format) or **tool use** (Anthropic format) with these tools:

### 5.1 Tool Definitions

```json
[
  {
    "name": "get_posts",
    "description": "Retrieve posts with optional filters",
    "parameters": {
      "type": "object",
      "properties": {
        "status": { "type": "string", "enum": ["reported", "verified", "in_progress", "solved", "archived"] },
        "category": { "type": "string" },
        "limit": { "type": "integer", "default": 20 }
      }
    }
  },
  {
    "name": "update_post",
    "description": "Update a post's status, priority, or content",
    "parameters": {
      "type": "object",
      "properties": {
        "post_id": { "type": "string" },
        "status": { "type": "string" },
        "priority": { "type": "string" },
        "admin_reply": { "type": "string" },
        "hidden": { "type": "boolean" }
      },
      "required": ["post_id"]
    }
  },
  {
    "name": "delete_post",
    "description": "Soft-delete a post (marks as deleted, not removed)",
    "parameters": {
      "type": "object",
      "properties": {
        "post_id": { "type": "string" },
        "reason": { "type": "string" }
      },
      "required": ["post_id", "reason"]
    }
  },
  {
    "name": "warn_user",
    "description": "Issue a warning to an anonymous user",
    "parameters": {
      "type": "object",
      "properties": {
        "anon_id": { "type": "string" },
        "reason": { "type": "string" },
        "strike": { "type": "boolean", "default": true }
      },
      "required": ["anon_id", "reason"]
    }
  },
  {
    "name": "ban_user",
    "description": "Ban an anonymous user (prevents posting)",
    "parameters": {
      "type": "object",
      "properties": {
        "anon_id": { "type": "string" },
        "reason": { "type": "string" }
      },
      "required": ["anon_id", "reason"]
    }
  },
  {
    "name": "get_user_posts",
    "description": "Get all posts from a specific anonymous user",
    "parameters": {
      "type": "object",
      "properties": {
        "anon_id": { "type": "string" }
      },
      "required": ["anon_id"]
    }
  },
  {
    "name": "create_poll",
    "description": "Create a new poll",
    "parameters": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "options": { "type": "array", "items": { "type": "string" } },
        "ptype": { "type": "string", "enum": ["yesno", "choice", "rating"] }
      },
      "required": ["title"]
    }
  },
  {
    "name": "close_poll",
    "description": "Close a poll to new votes",
    "parameters": {
      "type": "object",
      "properties": {
        "poll_id": { "type": "integer" }
      },
      "required": ["poll_id"]
    }
  },
  {
    "name": "get_analytics",
    "description": "Get platform analytics and statistics",
    "parameters": {
      "type": "object",
      "properties": {
        "period": { "type": "string", "enum": ["day", "week", "month", "all"] },
        "metric": { "type": "string", "enum": ["posts", "users", "reactions", "categories", "all"] }
      }
    }
  },
  {
    "name": "export_data",
    "description": "Export data as CSV",
    "parameters": {
      "type": "object",
      "properties": {
        "table": { "type": "string", "enum": ["posts", "comments", "users", "polls"] },
        "format": { "type": "string", "enum": ["csv", "json"] }
      },
      "required": ["table"]
    }
  },
  {
    "name": "get_activity_logs",
    "description": "Retrieve recent activity logs",
    "parameters": {
      "type": "object",
      "properties": {
        "limit": { "type": "integer", "default": 50 },
        "action": { "type": "string" }
      }
    }
  },
  {
    "name": "update_settings",
    "description": "Update system settings",
    "parameters": {
      "type": "object",
      "properties": {
        "key": { "type": "string" },
        "value": { "type": "object" }
      },
      "required": ["key", "value"]
    }
  },
  {
    "name": "set_announcement",
    "description": "Set or clear a site-wide announcement",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string" },
        "enabled": { "type": "boolean" }
      }
    }
  }
]
```

### 5.2 System Prompt for Agent

```
You are the Voice Box admin agent. You help school administrators manage their anonymous feedback platform.

CAPABILITIES:
- View, edit, hide, delete posts
- Warn or ban anonymous users
- Create and manage polls
- Generate analytics reports
- Export data
- View activity logs
- Update system settings
- Post announcements

RULES:
1. ALWAYS show your plan before executing actions
2. NEVER auto-execute destructive actions (delete, ban, password change)
3. Group related actions together when possible
4. Explain WHY you're recommending each action
5. If uncertain, ask for clarification
6. Be concise — administrators are busy

RESPONSE FORMAT:
- Start with a brief summary of what you found
- List specific actions you recommend (with before/after states)
- End with "Ready to execute?" or ask a clarifying question
```

## 6. Frontend Components

### 6.1 AdminSettings.tsx — New Provider Section

```
┌─────────────────────────────────────────────┐
│ API Providers                                │
├─────────────────────────────────────────────┤
│                                              │
│  Priority  Provider    Model          Status │
│  ────────  ──────────  ─────────────  ────── │
│  1         OpenAI      gpt-4o         🟢 OK  │
│            [Edit] [Test] [Disable]           │
│                                              │
│  2         Anthropic   claude-sonnet   🟢 OK  │
│            [Edit] [Test] [Disable]           │
│                                              │
│  3         Gemini      gemini-2.5-pro  ⚪ Off │
│            [Edit] [Test] [Enable]            │
│                                              │
│  4         NVIDIA NIM  llama-3.1-70b   ⚪ Off │
│            [Edit] [Test] [Enable]            │
│                                              │
│  5         Mistral     mistral-large   ⚪ Off │
│            [Edit] [Test] [Enable]            │
│                                              │
│  6         DeepSeek    deepseek-chat   ⚪ Off │
│            [Edit] [Test] [Enable]            │
│                                              │
│  7         Groq        llama-3.3-70b   ⚪ Off │
│            [Edit] [Test] [Enable]            │
│                                              │
│  [Test All] [Reset to Defaults]              │
│                                              │
│  ℹ️ Providers are tried in priority order.   │
│    If one fails, the next is used automatically. │
│    Env vars are used as fallback if no DB keys.  │
└─────────────────────────────────────────────┘
```

### 6.2 AgentPanel.tsx — Chat Interface

```
┌─────────────────────────────────────────────┐
│ Admin Agent                                  │
├─────────────────────────────────────────────┤
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ 🤖 Hi! I'm your admin assistant.    │    │
│  │ I can help you manage posts, users, │    │
│  │ polls, and analytics.               │    │
│  │                                     │    │
│  │ What would you like to do?          │    │
│  └─────────────────────────────────────┘    │
│                                              │
│            ┌─────────────────────────────┐  │
│            │ Hide all spam posts         │  │
│            └─────────────────────────────┘  │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ 🤖 I found 3 spam posts. Here's     │    │
│  │ what I'll do:                       │    │
│  │                                     │    │
│  │ ┌─────────────────────────────┐    │    │
│  │ │ Hide "Buy cheap followers"  │    │    │
│  │ │ Reason: promotional spam    │    │    │
│  │ │ [Execute] [Cancel]          │    │    │
│  │ └─────────────────────────────┘    │    │
│  │ ┌─────────────────────────────┐    │    │
│  │ │ Hide "Free crypto scam"     │    │    │
│  │ │ Reason: scam content        │    │    │
│  │ │ [Execute] [Cancel]          │    │    │
│  │ └─────────────────────────────┘    │    │
│  │ ┌─────────────────────────────┐    │    │
│  │ │ Hide "Click here for prize" │    │    │
│  │ │ Reason: phishing attempt    │    │    │
│  │ │ [Execute] [Cancel]          │    │    │
│  │ └─────────────────────────────┘    │    │
│  │                                     │    │
│  │ [Execute All] [Cancel All]          │    │
│  └─────────────────────────────────────┘    │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │ Type a command...              [↑]  │    │
│  └─────────────────────────────────────┘    │
│                                              │
└─────────────────────────────────────────────┘
```

## 7. Implementation Files

### New Files
1. `api/_providers.js` — Provider registry, failover chain, test connections
2. `api/_agent-chat.js` — Agent chat handler with tool execution
3. `src/pages/admin/ProviderSettings.tsx` — Provider management UI
4. `src/pages/admin/AgentChat.tsx` — Chat interface component

### Modified Files
1. `api/_ai.js` — Use provider chain instead of hardcoded providers
2. `api/_admin.js` — Add provider management and agent chat routes
3. `src/pages/admin/AdminSettings.tsx` — Import ProviderSettings component
4. `src/pages/admin/AgentPanel.tsx` — Import AgentChat component

## 8. Error Handling

### Provider Failover
```
Provider timeout (8s) → Log warning → Try next provider
Provider 401/403 → Mark as failed → Try next provider
Provider 429 → Wait 1s → Try next provider
All providers failed → Use heuristic → Show warning to user
```

### Agent Chat Errors
```
LLM returns invalid JSON → Retry once → Fall back to heuristic
Tool execution fails → Show error to user → Rollback if partial
User cancels mid-execution → Stop queue → Show what was done
Session expires → Prompt re-login → Preserve conversation
```

## 9. Security

### API Key Protection
- Keys stored in DB `settings` table (admin-only access via RLS)
- Never sent to frontend — only used server-side
- Masked in UI (show last 4 chars only)
- Test endpoint uses isolated fetch (no side effects)

### Agent Chat Safety
- All actions require admin auth
- Destructive actions (delete, ban) require explicit confirmation
- Rate limit: 10 actions per minute per session
- Full audit log of all agent actions
- Agent cannot access API keys or system secrets

## 10. Testing Plan

### Provider Failover
1. Configure OpenAI with invalid key → verify fallback to Anthropic
2. Configure all providers with invalid keys → verify heuristic fallback
3. Test rate limiting → verify automatic retry with next provider
4. Test timeout → verify failover within 8 seconds

### Agent Chat
1. Test all tool functions with valid inputs
2. Test destructive actions require confirmation
3. Test rate limiting (10 actions/min)
4. Test session expiry preserves conversation
5. Test audit logging for all actions

## 11. Rollback Plan

If anything breaks:
1. Remove `api_providers` row from settings → env vars take over
2. Disable agent chat in admin → old suggestion panel still works
3. No database schema changes → zero migration risk
