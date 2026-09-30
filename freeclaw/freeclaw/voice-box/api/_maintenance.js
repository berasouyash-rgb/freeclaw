import crypto from "crypto";
import { auditLog, cors, isAdmin } from "./_auth.js";
import { runCleanup } from "./_cleanup.js";
import { sanitizeError } from "./_error.js";
import { purgeExpired } from "./_posts.js";

function hasMaintenanceSecret(req) {
	const configured = process.env.MAINTENANCE_SECRET;
	const provided = req.headers?.["x-maintenance-secret"];
	if (!configured || typeof provided !== "string") return false;

	const expected = Buffer.from(configured);
	const actual = Buffer.from(provided);
	return (
		expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
	);
}

export async function runScheduledMaintenance() {
	const cleanup = await runCleanup();
	const postPurge = await purgeExpired();
	const cleanupSkipped = cleanup === null;
	const postPurgeSkipped = postPurge?.skipped === true;

	return {
		ran_at: new Date().toISOString(),
		skipped: cleanupSkipped && postPurgeSkipped,
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
	};
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST") {
		return res.status(405).json({ error: "POST only" });
	}

	try {
		const admin = await isAdmin(req);
		if (!admin && !hasMaintenanceSecret(req)) {
			return res.status(403).json({ error: "Maintenance authentication required" });
		}

		const result = await runScheduledMaintenance();
		await auditLog(
			admin ? "admin" : "maintenance",
			"maintenance",
			result.skipped ? "Maintenance skipped by cooldown" : "Maintenance completed",
		);
		return res.status(200).json({ success: true, ...result });
	} catch (err) {
		return sanitizeError(res, err, "maintenance");
	}
}
