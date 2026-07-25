// Keep-Alive endpoint — lightweight ping to prevent Vercel cold starts
// GET /api/keep-alive → { ok: true, timestamp, uptime }
// Triggered by Vercel Cron every 30 minutes
import { cors } from './_auth.js';

export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  return res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime ? Math.round(process.uptime()) : 0,
    memory_mb: process.memoryUsage ? Math.round(process.memoryUsage().heapUsed / 1024 / 1024) : 0,
  });
}
