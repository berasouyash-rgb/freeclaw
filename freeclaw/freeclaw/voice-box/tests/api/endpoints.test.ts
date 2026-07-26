/**
 * API Integration Tests — Voice Box Production
 * Tests all endpoints against the live production deployment.
 */
import { describe, it, expect } from 'vitest';

const BASE = 'https://voice-box-psi.vercel.app';
const ADMIN_TOKEN = '58f44c078a13a16e79ed63d2e7906a28ffe6be74';

/** Generate a unique title using random gibberish words that can never collide with production data. */
function uniqueTitle(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 10);
  const s = Math.random().toString(36).slice(2, 10);
  return `${prefix} ${r} ${s}`;
}

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

// ─── Public Endpoints ────────────────────────────────────────
describe('Public Endpoints', () => {
  it('GET /api/posts returns posts', async () => {
    const { status, body } = await get('/api/posts');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/posts with type filter', async () => {
    const { status } = await get('/api/posts?type=question');
    expect(status).toBe(200);
  });

  it('GET /api/polls returns polls', async () => {
    const { status, body } = await get('/api/polls');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/comments with post_id', async () => {
    const { status } = await get('/api/comments?post_id=test');
    expect(status).toBe(200);
  });

  it('GET /api/search?q=test', async () => {
    const { status } = await get('/api/search?q=test');
    expect(status).toBe(200);
  });

  it('GET /api/providers returns provider data', async () => {
    const { status, body } = await get('/api/providers');
    expect(status).toBe(200);
    expect(body).toBeDefined();
  });
});

// ─── Auth Enforcement ────────────────────────────────────────
describe('Auth Enforcement', () => {
  const adminEndpoints = [
    '/api/agent-team',
    '/api/agent-executions',
    '/api/audit-trail',
  ];

  for (const endpoint of adminEndpoints) {
    it(`${endpoint} returns 403 without token`, async () => {
      const { status } = await get(endpoint);
      expect(status).toBe(403);
    });

    it(`${endpoint} returns 200 with valid token`, async () => {
      const { status } = await get(endpoint, { 'x-admin-token': ADMIN_TOKEN });
      expect(status).toBe(200);
    });
  }

  it('Invalid token returns 403', async () => {
    const { status } = await get('/api/admin', { 'x-admin-token': 'invalid-token' });
    expect(status).toBe(403);
  });
});

// ─── CRUD Operations ─────────────────────────────────────────
describe('CRUD Operations', () => {
  const testUserId = `test-user-${Date.now()}`;
  let createdPostId: string;

  it('Create post', async () => {
    const { status, body } = await post('/api/posts', {
      title: uniqueTitle('Xqvtm'),
      description: 'Automated test post for verification',
      category: 'Test',
      priority: 'low',
      type: 'suggestion',
      author_id: testUserId,
    });
    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    createdPostId = body.id;
  });

  it('Add reaction to post', async () => {
    const { status } = await post('/api/reactions', {
      target_id: createdPostId,
      kind: 'support',
      author_id: testUserId,
    });
    expect(status).toBe(200);
  });

  it('Add comment to post', async () => {
    const { status } = await post('/api/comments', {
      post_id: createdPostId,
      body: 'This is a test comment with sufficient length for validation',
      author_id: testUserId,
    });
    expect(status).toBe(201);
  });

  it('Read comments for post', async () => {
    const { status, body } = await get(`/api/comments?post_id=${createdPostId}`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ─── Admin Endpoints ─────────────────────────────────────────
describe('Admin Endpoints', () => {
  const headers = { 'x-admin-token': ADMIN_TOKEN };

  it('GET /api/agent-team returns agent data', async () => {
    const { status, body } = await get('/api/agent-team', headers);
    expect(status).toBe(200);
  });

  it('GET /api/agent-team?action=divisions', async () => {
    const { status } = await get('/api/agent-team?action=divisions', headers);
    expect(status).toBe(200);
  });

  it('GET /api/agent-executions', async () => {
    const { status } = await get('/api/agent-executions', headers);
    expect(status).toBe(200);
  });

  it('GET /api/audit-trail', async () => {
    const { status } = await get('/api/audit-trail', headers);
    expect(status).toBe(200);
  });

  it('GET /api/health?type=full', async () => {
    const { status } = await get('/api/health?type=full', headers);
    expect(status).toBe(200);
  });

  it('GET /api/performance', async () => {
    const { status } = await get('/api/performance', headers);
    expect(status).toBe(200);
  });

  it('GET /api/trends?type=admin', async () => {
    const { status } = await get('/api/trends?type=admin', headers);
    expect(status).toBe(200);
  });

  it('POST /api/agent-team action=list', async () => {
    const { status } = await post('/api/agent-team', { action: 'list' }, headers);
    expect(status).toBe(200);
  });

  it('POST /api/agent-team action=status', async () => {
    const { status } = await post('/api/agent-team', { action: 'status' }, headers);
    expect(status).toBe(200);
  });

  it('POST /api/ai-chat returns AI response', async () => {
    const { status, body } = await post('/api/ai-chat', {
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false,
    }, headers);
    expect(status).toBe(200);
    expect(body.reply).toBeDefined();
  });

  it('V3 /api/v3/audit endpoint', async () => {
    const { status } = await get('/api/v3/audit', headers);
    expect(status).toBe(200);
  });
});

// ─── RBAC ────────────────────────────────────────────────────
describe('RBAC', () => {
  it('No-token blocked on admin endpoints', async () => {
    const { status } = await get('/api/agent-team');
    expect(status).toBe(403);
  });

  it('Invalid-token blocked on admin endpoints', async () => {
    const { status } = await get('/api/agent-team', { 'x-admin-token': 'bad-token' });
    expect(status).toBe(403);
  });

  it('Valid-token passes on admin endpoints', async () => {
    const { status } = await get('/api/agent-team', { 'x-admin-token': ADMIN_TOKEN });
    expect(status).toBe(200);
  });

  it('Public endpoints accessible without token', async () => {
    const { status } = await get('/api/posts');
    expect(status).toBe(200);
  });
});
