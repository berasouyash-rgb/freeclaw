// Keep-Alive endpoint — lightweight ping to prevent Vercel cold starts
// GET /api/keep-alive → { ok: true, timestamp, uptime }
// Triggered by Vercel Cron daily (Hobby plan: daily max)
import { cors, isCronAuthorized, CRON_UNAUTHORIZED_BODY } from "./_auth.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	// FIX #10 (AUDIT): cron-only — an open endpoint lets anyone keep the
	// instance warm (and read uptime/memory). Same gate as _incident-cron.
	if (!(await isCronAuthorized(req)))
		return res.status(401).json(CRON_UNAUTHORIZED_BODY);

	return res.status(200).json({
		ok: true,
		timestamp: new Date().toISOString(),
		uptime: process.uptime ? Math.round(process.uptime()) : 0,
		memory_mb: process.memoryUsage
			? Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
			: 0,
	});
}
