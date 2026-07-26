/**
 * Voice Box — Performance Validation Test Suite
 * Tests: response times, concurrency, memory, DB latency
 * Run: npx vitest run tests/api/performance.test.ts --config vitest.config.api.ts
 */
import { describe, it, expect } from 'vitest';

const BASE = 'https://voice-box-psi.vercel.app';
const TOKEN = '58f44c078a13a16e79ed63d2e7906a28ffe6be74';
const AUTH = { 'x-admin-token': TOKEN };

async function req(path: string, opts: any = {}) {
  const start = Date.now();
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...AUTH, ...opts.headers },
    ...opts,
  });
  const ms = Date.now() - start;
  const body = await r.json();
  return { status: r.status, ms, body };
}

describe('Phase 5.3 — Performance Validation', () => {
  it('GET /api/posts responds under 3s', async () => {
    const { status, ms } = await req('/api/posts');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('GET /api/polls responds under 3s', async () => {
    const { status, ms } = await req('/api/polls');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('GET /api/search?q=test responds under 3s', async () => {
    const { status, ms } = await req('/api/search?q=test');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('GET /api/health responds under 3s', async () => {
    const { status, ms } = await req('/api/health');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('GET /api/performance responds under 3s', async () => {
    const { status, ms } = await req('/api/performance');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('POST /api/posts responds under 3s', async () => {
    const { status, ms } = await req('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ type: 'suggestion', title: 'Perf test post', category: 'Other', priority: 'low', author_id: 'perf-test-user' }),
    });
    expect([200, 201, 400, 403]).toContain(status); // auth may vary
    expect(ms).toBeLessThan(3000);
  });

  it('POST /api/v3/rag responds under 3s', async () => {
    const { status, ms } = await req('/api/v3/rag', {
      method: 'POST',
      body: JSON.stringify({ action: 'search', query: 'schedule' }),
    });
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('POST /api/v3/memory responds under 3s', async () => {
    const { status, ms } = await req('/api/v3/memory', {
      method: 'POST',
      body: JSON.stringify({ action: 'store', type: 'user_preferences', userId: 'perf-test-user', key: 'theme', value: 'dark' }),
    });
    expect(status).toBeLessThan(500); // any non-server-error is fine for perf test
    expect(ms).toBeLessThan(3000);
  });

  it('POST /api/v3/verify responds under 5s', async () => {
    const { status, ms } = await req('/api/v3/verify', {
      method: 'POST',
      body: JSON.stringify({ statement: 'School starts at 8am', domain: 'academic' }),
    });
    expect([200, 400]).toContain(status); // validation may vary
    expect(ms).toBeLessThan(5000);
  });

  it('POST /api/v3/tools responds under 3s', async () => {
    const { status, ms } = await req('/api/v3/tools', {
      method: 'POST',
      body: JSON.stringify({ action: 'list' }),
    });
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('GET /api/v3/monitoring responds under 3s', async () => {
    const { status, ms } = await req('/api/v3/monitoring?action=dashboard');
    expect(status).toBe(200);
    expect(ms).toBeLessThan(3000);
  });

  it('Concurrent requests (5 parallel) complete within 15s', async () => {
    const start = Date.now();
    const results = await Promise.all([
      req('/api/posts'),
      req('/api/polls'),
      req('/api/search?q=test'),
      req('/api/health'),
      req('/api/performance'),
    ]);
    const totalMs = Date.now() - start;
    results.forEach(r => expect(r.status).toBe(200));
    expect(totalMs).toBeLessThan(15000);
  });

  it('Concurrent requests (10 parallel) complete within 20s', async () => {
    const start = Date.now();
    const results = await Promise.all([
      req('/api/posts'),
      req('/api/polls'),
      req('/api/search?q=hello'),
      req('/api/health'),
      req('/api/performance'),
      req('/api/agent-team'),
      req('/api/v3/rag', { method: 'POST', body: JSON.stringify({ action: 'search', query: 'test' }) }),
      req('/api/v3/memory', { method: 'POST', body: JSON.stringify({ action: 'retrieve', type: 'user_preferences', userId: 'test' }) }),
      req('/api/v3/tools', { method: 'POST', body: JSON.stringify({ action: 'list' }) }),
      req('/api/v3/monitoring?action=liveness'),
    ]);
    const totalMs = Date.now() - start;
    results.forEach(r => expect([200, 400, 403]).toContain(r.status));
    expect(totalMs).toBeLessThan(20000);
  });

  it('Monitoring latency percentiles are reasonable', async () => {
    const { body } = await req('/api/v3/monitoring?action=latency');
    expect(body.latency.p50).toBeLessThan(5000);   // p50 under 5s
    expect(body.latency.count).toBeGreaterThan(0);
  });

  it('Monitoring health shows DB latency under 1s', async () => {
    const { body } = await req('/api/v3/monitoring?action=dashboard');
    expect(body.health.database.status).toBe('ok');
    expect(body.health.database.latency_ms).toBeLessThan(1000);
  });

  it('Circuit breakers all closed (healthy)', async () => {
    const { body } = await req('/api/v3/monitoring?action=dashboard');
    expect(body.circuits.supabase.state).toBe('closed');
    expect(body.circuits.llm.state).toBe('closed');
    expect(body.circuits.toolExecution.state).toBe('closed');
  });
});
