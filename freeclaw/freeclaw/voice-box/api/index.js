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

// upload.js needs a 4 MB body limit; the rest are fine with the default.
export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

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
  cleanup: cleanupHandler,
};

export default async function handler(req, res) {
  // req.url will be the original e.g. /api/posts (the rewrite preserves it)
  // Strip query strings before splitting
  const pathname = req.url.split('?')[0];
  const parts = pathname.split('/').filter(Boolean);
  const endpoint = parts[1]; // ['api', 'posts', …] → 'posts'

  const routeHandler = routes[endpoint];
  if (!routeHandler) {
    corsFn(res);
    return res.status(404).json({ error: 'Not found' });
  }

  return routeHandler(req, res);
}
