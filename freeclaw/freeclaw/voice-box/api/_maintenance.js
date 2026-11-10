// Scheduled upkeep: janitor passes + closed-post retention sweep.
//
// Invocation contract (enforced by the route matrix BEFORE this handler runs):
//   GET  — cron / external scheduler. Authorized with CRON_SECRET or
//          MAINTENANCE_SECRET (an admin session also passes the matrix, but
//          Vercel Cron only ever sends GET).
//   POST — manual admin run from the admin center.
//
// Why GET exists: the retention rule is time-based ("5 days after last
// activity"), so it needs a trigger that actually fires on a schedule. Vercel
// Cron issues GET requests, and this route used to be POST-only, meaning the
// sweep could only ever run on a cold start — which is exactly why solved
// posts were never auto-deleted.

import { auditLog, cors, hasMaintenanceSecret, isAdmin, isCronAuthorized } from "./_auth.js";
import { runCleanup } from "./_cleanup.js";
import { sanitizeError } from "./_error.js";
import { purgeExpired } from "./_posts.js";
import { runScheduledReplicationIfDue } from "./_replication-cron.js";

export async function runScheduledMaintenance() {
	const cleanup = await runCleanup();
	const postPurge = await purgeExpired();
	const cleanupSkipped = cleanup === null;
	const postPurgeSkipped = postPurge?.skipped === true;

	// Redundancy tick. The Hobby plan allows only two Vercel crons, so the
	// daily maintenance cron is what keeps primary → standby convergence
	// moving when no external scheduler is configured. It is:
	//   • flag-gated (RELIABILITY_REPLICATION_ENABLED, default off), and
	//   • throttled by a control-plane lease, so a burst of cold starts does
	//     not each sweep 34 tables.
	// Guarded so upkeep NEVER fails because redundancy is idle, unconfigured,
	// or briefly unreachable — a failed replication is reported, not thrown.
	const replication = await runScheduledReplicationIfDue().catch((err) => ({
		skipped: true,
		reason: "replication_error",
		error: String(err?.message || err).slice(0, 200),
	}));
	const replicationSkipped = replication?.skipped === true;

	return {
		ran_at: new Date().toISOString(),
		skipped: cleanupSkipped && postPurgeSkipped && replicationSkipped,
		cleanup: cleanup ?? {
			cleaned: 0,
			details: {},
			skipped: true,
		},
		post_purge: postPurge ?? {
			purged: 0,
			skipped: true,
		},
		poll_maintenance: cleanup?.details ?? {},
		replication,
	};
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	const isCronInvocation = req.method === "GET";
	const isAdminInvocation = req.method === "POST";
	if (!isCronInvocation && !isAdminInvocation) {
		return res.status(405).json({ error: "GET or POST only", allow: "GET, POST" });
	}

	try {
		// Defense in depth: the matrix already authorized this route, but the
		// handler must stand on its own (it is imported directly by tests and
		// could be mounted elsewhere). Cron-only for GET, admin for POST —
		// an external scheduler may use the shared MAINTENANCE_SECRET for
		// either, and an admin session satisfies both.
		const scheduledAuth = isCronInvocation
			? (await isCronAuthorized(req)) || hasMaintenanceSecret(req)
			: (await isAdmin(req)) || hasMaintenanceSecret(req);
		if (!scheduledAuth) {
			return res.status(isCronInvocation ? 401 : 403).json({
				error: isCronInvocation
					? "Scheduled maintenance requires a valid cron secret"
					: "Maintenance authentication required",
			});
		}

		const actor = isCronInvocation ? "cron" : "admin";
		const result = await runScheduledMaintenance();
		await auditLog(
			actor,
			"maintenance",
			result.skipped ? "Maintenance skipped by cooldown" : "Maintenance completed",
		);
		return res.status(200).json({ success: true, ...result });
	} catch (err) {
		return sanitizeError(res, err, "maintenance");
	}
}
