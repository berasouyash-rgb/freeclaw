// ─── Phase 2 Enterprise AI Tests ──────────────────────────────────
// Tests for tool registry, verification engine, orchestrator,
// RAG integration, and long-term memory.
//
// These tests hit the live production API to verify real functionality.

import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'https://voice-box-psi.vercel.app';
const ADMIN_TOKEN = '58f44c078a13a16e79ed63d2e7906a28ffe6be74';

// Helper for API calls
async function api(method, path, body = null, headers = {}) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}/api${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ═══════════════════════════════════════════════════════════════════
// 2.1 TOOL CALLING FRAMEWORK
// ═══════════════════════════════════════════════════════════════════
describe('Phase 2.1: Tool Calling Framework', () => {

  it('GET /v3/tools returns tool list', async () => {
    const { status, data } = await api('GET', '/v3/tools');
    expect(status).toBe(200);
    expect(data.tools).toBeDefined();
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.length).toBeGreaterThan(0);
  });

  it('Tool list includes required fields', async () => {
    const { data } = await api('GET', '/v3/tools');
    const tool = data.tools[0];
    expect(tool).toHaveProperty('name');
    expect(tool).toHaveProperty('description');
    expect(tool).toHaveProperty('parameters');
    expect(tool).toHaveProperty('category');
  });

  it('GET /v3/tools includes read tools', async () => {
    const { data } = await api('GET', '/v3/tools');
    const toolNames = data.tools.map(t => t.name);
    expect(toolNames).toContain('get_posts');
    expect(toolNames).toContain('get_polls');
    expect(toolNames).toContain('search_knowledge_base');
  });

  it('POST /v3/tools action=list returns tools', async () => {
    const { status, data } = await api('POST', '/v3/tools', { action: 'list' });
    expect(status).toBe(200);
    expect(data.tools).toBeDefined();
  });

  it('POST /v3/tools action=validate validates params', async () => {
    const { status, data } = await api('POST', '/v3/tools', {
      action: 'validate',
      name: 'get_posts',
      params: { limit: 5 },
    });
    expect(status).toBe(200);
    expect(data.valid).toBe(true);
    expect(data.errors).toEqual([]);
  });

  it('POST /v3/tools action=validate catches missing required', async () => {
    const { status, data } = await api('POST', '/v3/tools', {
      action: 'validate',
      name: 'get_comments',
      params: {},
    });
    expect(status).toBe(200);
    expect(data.valid).toBe(false);
    expect(data.errors.length).toBeGreaterThan(0);
  });

  it('POST /v3/tools action=execute runs tool', async () => {
    const { status, data } = await api('POST', '/v3/tools', {
      action: 'execute',
      name: 'get_posts',
      params: { limit: 3 },
    });
    expect(status).toBe(200);
    expect(data.status).toBe('success');
    expect(data.outputs).toBeDefined();
    expect(Array.isArray(data.outputs.posts)).toBe(true);
  });

  it('POST /v3/tools action=execute handles unknown tool', async () => {
    const { status, data } = await api('POST', '/v3/tools', {
      action: 'execute',
      name: 'nonexistent_tool',
      params: {},
    });
    expect(status).toBe(400);
    expect(data.error).toContain('Unknown tool');
  });

  it('POST /v3/tools action=batch executes multiple', async () => {
    const { status, data } = await api('POST', '/v3/tools', {
      action: 'batch',
      tools: [
        { name: 'get_posts', params: { limit: 2 } },
        { name: 'get_polls', params: {} },
      ],
    });
    expect(status).toBe(200);
    expect(data.results).toBeDefined();
    expect(data.results.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2.2 VERIFICATION ENGINE
// ═══════════════════════════════════════════════════════════════════
describe('Phase 2.2: Verification Engine', () => {

  it('POST /v3/verify verifies an answer', async () => {
    const { status, data } = await api('POST', '/v3/verify', {
      query: 'How do I submit a report?',
      answer: 'You can submit a report through the Reports page.',
    });
    expect(status).toBe(200);
    expect(data.verification).toBeDefined();
    expect(data.verification.status).toBeDefined();
    expect(data.verification.confidence).toBeDefined();
  });

  it('Verification includes confidence score', async () => {
    const { data } = await api('POST', '/v3/verify', {
      query: 'What are the school hours?',
      answer: 'School starts at 8 AM and ends at 3 PM.',
    });
    expect(data.verification.confidence.score).toBeGreaterThanOrEqual(0);
    expect(data.verification.confidence.score).toBeLessThanOrEqual(1);
    expect(data.verification.confidence.level).toBeDefined();
  });

  it('Verification includes citations', async () => {
    const { data } = await api('POST', '/v3/verify', {
      query: 'How do I change my password?',
      answer: 'Go to Settings and click Change Password.',
    });
    expect(Array.isArray(data.verification.citations)).toBe(true);
  });

  it('Verification detects uncertainty', async () => {
    const { data } = await api('POST', '/v3/verify', {
      query: 'What is the policy on phones?',
      answer: "I'm not sure about the exact policy, but you should check with the office.",
    });
    expect(data.verification.uncertainty).toBeDefined();
    expect(data.verification.uncertainty.uncertain).toBe(true);
  });

  it('Batch verification works', async () => {
    const { status, data } = await api('POST', '/v3/verify', {
      queries: [
        { query: 'How do I login?', answer: 'Use your school email.' },
        { query: 'Where is the library?', answer: 'The library is in Building A.' },
      ],
    });
    expect(status).toBe(200);
    expect(data.results).toBeDefined();
    expect(data.results.length).toBe(2);
  });

  it('GET /v3/verify returns status', async () => {
    const { status, data } = await api('GET', '/v3/verify');
    expect(status).toBe(200);
    expect(data.service).toBe('verification-engine');
    expect(data.status).toBe('operational');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2.3 MULTI-AGENT ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════
describe('Phase 2.3: Multi-Agent Orchestrator', () => {

  it('GET /v3/orchestrate lists agents', async () => {
    const { status, data } = await api('GET', '/v3/orchestrate');
    expect(status).toBe(200);
    expect(data.agents).toBeDefined();
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.agents.length).toBeGreaterThan(0);
  });

  it('Agent list includes all specialized agents', async () => {
    const { data } = await api('GET', '/v3/orchestrate');
    const agentIds = data.agents.map(a => a.id);
    expect(agentIds).toContain('general');
    expect(agentIds).toContain('emotional');
    expect(agentIds).toContain('academic');
    expect(agentIds).toContain('behavioral');
    expect(agentIds).toContain('facilities');
    expect(agentIds).toContain('crisis');
  });

  it('Agent definitions have required fields', async () => {
    const { data } = await api('GET', '/v3/orchestrate');
    const agent = data.agents[0];
    expect(agent).toHaveProperty('id');
    expect(agent).toHaveProperty('name');
    expect(agent).toHaveProperty('description');
    expect(agent).toHaveProperty('capabilities');
    expect(agent).toHaveProperty('tools');
  });

  it('POST /v3/orchestrate action=route routes to agent', async () => {
    const { status, data } = await api('POST', '/v3/orchestrate', {
      action: 'route',
      query: 'I need help with my homework',
    });
    expect(status).toBe(200);
    expect(data.agent).toBeDefined();
    expect(data.agent.id).toBeDefined();
  });

  it('Crisis query routes to crisis agent', async () => {
    const { data } = await api('POST', '/v3/orchestrate', {
      action: 'route',
      query: 'There is an emergency situation with a weapon',
    });
    expect(data.agent.id).toBe('crisis');
  });

  it('Emotional query routes to emotional agent', async () => {
    const { data } = await api('POST', '/v3/orchestrate', {
      action: 'route',
      query: 'I feel so anxious and stressed about exams',
    });
    expect(data.agent.id).toBe('emotional');
  });

  it('POST /v3/orchestrate action=execute runs agent', async () => {
    const { status, data } = await api('POST', '/v3/orchestrate', {
      action: 'execute',
      agent_id: 'general',
      query: 'What posts are on the platform?',
    });
    expect(status).toBe(200);
    expect(data.agentId).toBe('general');
    expect(data.task).toBeDefined();
  });

  it('POST /v3/orchestrate returns 404 for unknown agent', async () => {
    const { status, data } = await api('POST', '/v3/orchestrate', {
      action: 'execute',
      agent_id: 'nonexistent',
      query: 'test',
    });
    expect(status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2.4 RAG INTEGRATION
// ═══════════════════════════════════════════════════════════════════
describe('Phase 2.4: RAG Integration', () => {

  it('POST /v3/rag action=search searches KB', async () => {
    const { status, data } = await api('POST', '/v3/rag', {
      action: 'search',
      query: 'school policy',
    });
    expect(status).toBe(200);
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
  });

  it('POST /v3/rag action=retrieve gets context', async () => {
    const { status, data } = await api('POST', '/v3/rag', {
      action: 'retrieve',
      query: 'How do I submit a report?',
    });
    expect(status).toBe(200);
    expect(data.context).toBeDefined();
    expect(typeof data.context).toBe('string');
  });

  it('Retrieve includes citations', async () => {
    const { data } = await api('POST', '/v3/rag', {
      action: 'retrieve',
      query: 'school resources',
    });
    expect(Array.isArray(data.citations)).toBe(true);
  });

  it('GET /v3/rag returns analytics', async () => {
    const { status, data } = await api('GET', '/v3/rag');
    expect(status).toBe(200);
    expect(data.service).toBe('rag-engine');
    expect(data.analytics).toBeDefined();
  });

  it('Search with category filter works', async () => {
    const { status, data } = await api('POST', '/v3/rag', {
      action: 'search',
      query: 'policy',
      category: 'policy',
    });
    expect(status).toBe(200);
    expect(Array.isArray(data.results)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2.5 LONG-TERM MEMORY
// ═══════════════════════════════════════════════════════════════════
describe('Phase 2.5: Long-Term Memory', () => {

  it('POST /v3/memory action=store stores memory', async () => {
    const { status, data } = await api('POST', '/v3/memory', {
      action: 'store',
      agent_id: 'test-agent',
      memory_type: 'user_preferences',
      content: { theme: 'dark', language: 'en' },
    });
    expect(status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.memory).toBeDefined();
  });

  it('POST /v3/memory action=retrieve gets memories', async () => {
    const { status, data } = await api('POST', '/v3/memory', {
      action: 'retrieve',
      agent_id: 'test-agent',
    });
    expect(status).toBe(200);
    expect(data.memories).toBeDefined();
    expect(Array.isArray(data.memories)).toBe(true);
  });

  it('POST /v3/memory action=search finds memories', async () => {
    // First store a memory
    await api('POST', '/v3/memory', {
      action: 'store',
      agent_id: 'test-search',
      memory_type: 'learned_facts',
      content: { fact: 'User prefers dark theme' },
    });

    const { status, data } = await api('POST', '/v3/memory', {
      action: 'search',
      agent_id: 'test-search',
      query: 'dark theme',
    });
    expect(status).toBe(200);
    expect(Array.isArray(data.memories)).toBe(true);
  });

  it('POST /v3/memory action=context builds context', async () => {
    const { status, data } = await api('POST', '/v3/memory', {
      action: 'context',
      agent_id: 'test-agent',
    });
    expect(status).toBe(200);
    expect(typeof data.context).toBe('string');
  });

  it('POST /v3/memory validates memory type', async () => {
    const { status, data } = await api('POST', '/v3/memory', {
      action: 'store',
      agent_id: 'test-agent',
      memory_type: 'invalid_type',
      content: { test: true },
    });
    expect(status).toBe(400);
    expect(data.error).toContain('Invalid memory type');
  });

  it('POST /v3/memory action=consolidate works', async () => {
    const { status, data } = await api('POST', '/v3/memory', {
      action: 'consolidate',
      agent_id: 'test-agent',
    });
    expect(status).toBe(200);
    expect(data.consolidated).toBeDefined();
  });

  it('POST /v3/memory action=clear removes memories', async () => {
    // Store then clear
    await api('POST', '/v3/memory', {
      action: 'store',
      agent_id: 'test-clear',
      memory_type: 'experience',
      content: { event: 'test' },
    });

    const { status, data } = await api('POST', '/v3/memory', {
      action: 'clear',
      agent_id: 'test-clear',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('GET /v3/memory returns analytics', async () => {
    const { status, data } = await api('GET', '/v3/memory?agent_id=test-agent');
    expect(status).toBe(200);
    expect(data.service).toBe('memory-engine');
    expect(data.memory_types).toBeDefined();
  });
});
