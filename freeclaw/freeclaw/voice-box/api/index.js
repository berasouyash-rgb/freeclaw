// Consolidated Vercel serverless entry point.
// All /api/* routes are rewritten to this file by vercel.json.
// Individual handlers live as _prefixed modules (private, no separate function).

import { cors as corsFn } from './_auth.js';
import { triggerAutoCleanup, cleanupHandler } from './_cleanup.js';
import { setSecurityHeaders, securityCheck, detectPromptInjection } from './_security.js';
import { cleanupMetrics } from './_observability.js';
import { cleanupCache } from './_cache.js';

import posts from './_posts.js';
import comments from './_comments.js';
import polls from './_polls.js';
import reactions from './_reactions.js';
import chat from './_chat.js';
import reports from './_reports.js';
import admin from './_admin.js';
import announcement from './_announcement.js';
import upload from './_upload.js';
import users from './_users.js';
import agent from './_agent.js';
import ai from './_ai.js';
import assist from './_assist.js';
import me from './_me.js';
import providers from './_providers.js';
import agentChat from './_agent-chat.js';
import metaAgent from './_meta-agent.js';
import agentTeam from './_agent-team.js';
import aiResolution from './_ai-resolution.js';
import duplicates from './_duplicates.js';
import routing from './_routing.js';
import search from './_search.js';
import notifications from './_notifications.js';
import moderation from './_moderation.js';
import evidence from './_evidence.js';
import auditTrail from './_audit-trail.js';
import health from './_health.js';
import trends from './_trends.js';
import performance from './_performance.js';
import timeline from './_timeline.js';
import conversationAssist from './_conversation-assist.js';
import prePublish from './_pre-publish.js';
import prePublishReview from './_pre-publish-review.js';
import evidenceScan from './_evidence-scan.js';
import inbox from './_inbox.js';
import agentExecutions from './_agent-executions.js';
import agentsCron from './_agents-cron.js';
import eventAgents from './_event-agents.js';
import keepAlive from './_keep-alive.js';
import toolForge from './_tool-forge.js';
import persona from './_persona.js';
import aiChat from './_ai-chat.js';
import commandCenter from './_command-center.js';
import proactive from './_proactive.js';
import learning from './learning.js';

// V3 Enterprise endpoints
import v3Stream from './v3/_stream.js';
import v3Audit from './v3/_audit.js';
import v3Tools from './v3/_tools.js';
import v3Verify from './v3/_verify.js';
import v3Orchestrate from './v3/_orchestrate.js';
import v3Rag from './v3/_rag.js';
import v3Memory from './v3/_memory.js';
import v3Security from './v3/_security.js';
import v3Monitoring, { recordRequest } from './v3/_monitoring.js';

// Body parser: consume raw stream if Vercel didn't already parse it.
// In Vercel Node.js runtime, req.body may be a ReadableStream, Buffer, string,
// or already-parsed object. This function normalizes it to a plain object.
async function parseBody(req) {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return;

  // Already a parsed plain object — use as-is
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b) && typeof b.getReader !== 'function' && typeof b.pipe !== 'function') {
    return;
  }

  let raw = '';

  try {
    // ReadableStream (web streams API)
    if (b && typeof b.getReader === 'function') {
      const reader = b.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      raw = new TextDecoder().decode(new Uint8Array(chunks.flatMap(c => Array.from(c))));
    }
    // Node.js Readable stream
    else if (b && typeof b.pipe === 'function') {
      raw = await new Promise((resolve, reject) => {
        const chunks = [];
        b.on('data', (chunk) => chunks.push(chunk));
        b.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        b.on('error', reject);
      });
    }
    // Buffer
    else if (Buffer.isBuffer(b)) {
      raw = b.toString('utf8');
    }
    // String
    else if (typeof b === 'string') {
      raw = b;
    }
  } catch (_) {
    // Stream read failed — fall through with empty raw
  }

  // Parse the raw text into an object
  if (raw) {
    try { req.body = JSON.parse(raw); } catch (_) {
      try { req.body = Object.fromEntries(new URLSearchParams(raw)); } catch (_) { req.body = {}; }
    }
  } else {
    req.body = {};
  }
}

// Auto-cleanup on cold start (7-day retention, runs once per instance)
triggerAutoCleanup();

// Periodic cleanup of observability metrics and cache
cleanupMetrics();
cleanupCache();

const routes = {
  posts,
  comments,
  polls,
  reactions,
  chat,
  reports,
  admin,
  announcements: announcement,
  announcement: announcement, // singular alias used by frontend
  upload,
  users,
  agent,
  ai,
  assist,
  me,
  providers,
  'agent-chat': agentChat,
  'meta-agent': metaAgent,
  'agent-team': agentTeam,
  'ai-resolution': aiResolution,
  duplicates,
  routing,
  search,
  notifications,
  moderation,
  evidence,
  'audit-trail': auditTrail,
  health,
  trends,
  performance,
  timeline,
  'conversation-assist': conversationAssist,
  'pre-publish': prePublish,
  'pre-review': prePublishReview,
  'evidence-scan': evidenceScan,
  inbox,
  'agents-cron': agentsCron,
  'agent-executions': agentExecutions,
  'event-agents': eventAgents,
  'keep-alive': keepAlive,
  'tool-forge': toolForge,
  persona,
  'ai-chat': aiChat,
  'command-center': commandCenter,
  proactive,
  learning,
  cleanup: cleanupHandler,
  // V3 Enterprise routes
  'v3/stream': v3Stream,
  'v3/audit': v3Audit,
  'v3/tools': v3Tools,
  'v3/verify': v3Verify,
  'v3/orchestrate': v3Orchestrate,
  'v3/rag': v3Rag,
  'v3/memory': v3Memory,
  'v3/security': v3Security,
  'v3/monitoring': v3Monitoring,
};

export default async function handler(req, res) {
  // EARLY TEST: confirm handler runs for JSON POST
  if (req.url.includes('_ping')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ pong: true, method: req.method, url: req.url });
  }

  // req.url will be the original e.g. /api/posts (the rewrite preserves it)
  // Strip query strings before splitting
  const pathname = req.url.split('?')[0];
  const parts = pathname.split('/').filter(Boolean);
  
  // Handle V3 routes: /api/v3/stream → 'v3/stream'
  let endpoint = parts[1]; // ['api', 'posts', …] → 'posts'
  if (endpoint === 'v3' && parts[2]) {
    endpoint = `v3/${parts[2]}`;
  }

  // Set security headers on every response
  setSecurityHeaders(res);

  // Security check (abuse prevention, request size)
  const secCheck = securityCheck(req);
  if (!secCheck.ok) {
    corsFn(res, req);
    if (secCheck.retryAfter) {
      res.setHeader('Retry-After', String(secCheck.retryAfter));
    }
    return res.status(secCheck.status).json({ error: secCheck.error });
  }

  // Parse body from raw stream (Vercel body parser is disabled)
  // Must run BEFORE debug endpoint so it can inspect the parsed body.
  try {
    await parseBody(req);
  } catch (parseErr) {
    console.error('[handler] parseBody threw:', parseErr.message);
  }

  // Debug endpoint — echoes request info for diagnosing body parsing issues
  if (endpoint === '_debug') {
    corsFn(res, req);
    res.setHeader('Content-Type', 'application/json');
    let bodyPreview = '';
    try {
      const bodyRaw = req.body === undefined || req.body === null ? '' :
                      typeof req.body === 'string' ? req.body :
                      Buffer.isBuffer(req.body) ? req.body.toString('utf8') :
                      JSON.stringify(req.body) || '';
      bodyPreview = bodyRaw.slice(0, 500);
    } catch (_) { bodyPreview = '[unserializable]'; }
    return res.status(200).json({
      method: req.method,
      bodyType: typeof req.body,
      bodyIsNull: req.body === null,
      bodyIsUndefined: req.body === undefined,
      bodyIsBuffer: Buffer.isBuffer(req.body),
      bodyPreview,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(([k]) => !k.startsWith('x-forwarded') && !k.startsWith('x-vercel'))
          .slice(0, 30)
          .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
      ),
      timestamp: new Date().toISOString(),
    });
  }

  const routeHandler = routes[endpoint];
  if (!routeHandler) {
    corsFn(res, req);
    recordRequest(0, 404, pathname);
    return res.status(404).json({ error: 'Not found' });
  }

  // Wrap response to capture status code for monitoring
  const originalEnd = res.end;
  const startMs = Date.now();
  res.end = function (...args) {
    const duration = Date.now() - startMs;
    recordRequest(duration, res.statusCode, pathname);
    return originalEnd.apply(this, args);
  };

  return routeHandler(req, res);
}
