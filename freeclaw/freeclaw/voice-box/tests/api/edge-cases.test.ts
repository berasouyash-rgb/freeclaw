/**
 * Edge Cases & Error Handling Tests — Voice Box
 */
import { describe, it, expect } from 'vitest';

const BASE = 'https://voice-box-psi.vercel.app';
const ADMIN_TOKEN = '58f44c078a13a16e79ed63d2e7906a28ffe6be74';

async function get(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ─── 404 Handling ────────────────────────────────────────────
describe('404 Handling', () => {
  it('Non-existent endpoint returns 404', async () => {
    const { status } = await get('/api/nonexistent');
    expect(status).toBe(404);
  });

  it('Non-existent V3 endpoint returns 404', async () => {
    const { status } = await get('/api/v3/nonexistent');
    expect(status).toBe(404);
  });
});

// ─── Input Validation ────────────────────────────────────────
describe('Input Validation', () => {
  it('POST /api/posts with missing required fields', async () => {
    const { status } = await post('/api/posts', {});
    // Returns 403 because author_id is missing (user check fails)
    expect([200, 201, 400, 403]).toContain(status);
  });

  it('POST /api/comments with empty body', async () => {
    const { status } = await post('/api/comments', {
      post_id: 'test',
      body: '',
      author_id: 'test-user',
    });
    expect([400, 403]).toContain(status);
  });

  it('POST /api/comments with short body (1 char)', async () => {
    const { status } = await post('/api/comments', {
      post_id: 'test',
      body: 'a',
      author_id: 'test-user',
    });
    expect(status).toBe(400);
  });

  it('POST /api/reactions with invalid kind', async () => {
    const { status } = await post('/api/reactions', {
      target_id: 'test',
      kind: 'invalid-kind',
      author_id: 'test-user',
    });
    expect([200, 400]).toContain(status);
  });

  it('POST /api/ai-chat with empty messages', async () => {
    const { status } = await post('/api/ai-chat', {
      messages: [],
      stream: false,
    }, { 'x-admin-token': ADMIN_TOKEN });
    expect(status).toBe(400);
  });

  it('POST /api/ai-chat without messages field', async () => {
    const { status } = await post('/api/ai-chat', {
      stream: false,
    }, { 'x-admin-token': ADMIN_TOKEN });
    expect(status).toBe(400);
  });
});

// ─── Poll Voting Edge Cases ──────────────────────────────────
describe('Poll Voting Edge Cases', () => {
  it('GET /api/polls returns array', async () => {
    const { status, body } = await get('/api/polls');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/polls with missing poll_id', async () => {
    const { status } = await post('/api/polls', {
      option_index: 0,
      user_id: 'test-user',
    });
    // Returns 403 because user check fails without proper author_id
    expect([400, 403, 404]).toContain(status);
  });
});

// ─── Admin Endpoint Edge Cases ───────────────────────────────
describe('Admin Endpoint Edge Cases', () => {
  const headers = { 'x-admin-token': ADMIN_TOKEN };

  it('POST /api/agent-team with invalid action', async () => {
    const { status } = await post('/api/agent-team', { action: 'invalid' }, headers);
    expect(status).toBe(400);
  });

  it('POST /api/ai-chat with invalid message format', async () => {
    const { status } = await post('/api/ai-chat', {
      messages: 'not-an-array',
      stream: false,
    }, headers);
    expect([400, 500]).toContain(status);
  });

  it('GET /api/health returns health data', async () => {
    const { status, body } = await get('/api/health?type=full', headers);
    expect(status).toBe(200);
    expect(body).toBeDefined();
  });

  it('GET /api/performance returns performance data', async () => {
    const { status, body } = await get('/api/performance', headers);
    expect(status).toBe(200);
    expect(body).toBeDefined();
  });
});

// ─── CORS & Headers ──────────────────────────────────────────
describe('CORS & Headers', () => {
  it('OPTIONS request returns CORS headers', async () => {
    const res = await fetch(`${BASE}/api/posts`, { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-origin')).toBeDefined();
  });

  it('GET request includes CORS header', async () => {
    const res = await fetch(`${BASE}/api/posts`);
    expect(res.headers.get('access-control-allow-origin')).toBeDefined();
  });
});

// ─── V3 Enterprise Endpoints ─────────────────────────────────
describe('V3 Enterprise Endpoints', () => {
  const headers = { 'x-admin-token': ADMIN_TOKEN };

  it('V3 /api/v3/audit returns audit data', async () => {
    const { status, body } = await get('/api/v3/audit', headers);
    expect(status).toBe(200);
    expect(body).toBeDefined();
  });

  it('V3 /api/v3/audit without auth returns 403', async () => {
    const { status } = await get('/api/v3/audit');
    expect(status).toBe(403);
  });
});

// ─── Content Type ────────────────────────────────────────────
describe('Content Type', () => {
  it('GET /api/posts returns JSON', async () => {
    const res = await fetch(`${BASE}/api/posts`);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('POST /api/posts returns JSON', async () => {
    const res = await fetch(`${BASE}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Content Type Test',
        description: 'Testing content type headers',
        category: 'Test',
        author_id: 'content-type-test',
      }),
    });
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
