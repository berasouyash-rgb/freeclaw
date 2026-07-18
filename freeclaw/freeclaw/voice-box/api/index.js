// Consolidated Vercel serverless entry point.
// All /api/* routes are rewritten to this file by vercel.json.
// Individual handlers live as _prefixed modules (private, no separate function).

import { cors as corsFn } from './_auth.js';
import { triggerAutoCleanup, cleanupHandler } from './_cleanup.js';

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

// upload.js needs a 4 MB body limit; the rest are fine with the default.
export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

// Body parsing safety net for rewrites (/api/* → /api/index.js)
// When Vercel rewrites /api/* → /api/index.js, the bodyParser config might not apply.
function parseBody(req) {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return;
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const raw = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
    if (raw) {
      try {
        req.body = JSON.parse(raw);
      } catch (parseErr) {
        console.error('[body-parser] Failed to parse body:', parseErr.message);
      }
    }
  }
  if (!req.body || typeof req.body !== 'object') {
    req.body = {};
  }
}

// Auto-cleanup on cold start (7-day retention, runs once per instance)
triggerAutoCleanup();

const routes = {
  posts,
  comments,
  polls,
  reactions,
  chat,
  reports,
  admin,
  announcements: announcement,
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
  cleanup: cleanupHandler,
};

export default async function handler(req, res) {
  // req.url will be the original e.g. /api/posts (the rewrite preserves it)
  // Strip query strings before splitting
  const pathname = req.url.split('?')[0];
  const parts = pathname.split('/').filter(Boolean);
  const endpoint = parts[1]; // ['api', 'posts', …] → 'posts'

  // Debug endpoint — echoes request info for diagnosing body parsing issues
  if (endpoint === '_debug') {
    corsFn(res, req);
    res.setHeader('Content-Type', 'application/json');
    const bodyPreview = typeof req.body === 'string' ? req.body.slice(0, 500) :
                         Buffer.isBuffer(req.body) ? req.body.toString('utf8').slice(0, 500) :
                         JSON.stringify(req.body).slice(0, 500);
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

  // Apply body parsing safety net before routing
  parseBody(req);

  const routeHandler = routes[endpoint];
  if (!routeHandler) {
    corsFn(res, req);
    return res.status(404).json({ error: 'Not found' });
  }

  return routeHandler(req, res);
}
