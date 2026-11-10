// ─── Replication tick ───────────────────────────────────────────
// Drives primary → standby convergence.
//
// Why this is a separate route and not a third Vercel Cron:
//   vercel.json already declares two cron jobs (maintenance, incident-cron).
//   The Hobby plan allows exactly two at daily frequency, so a third entry
//   cannot be added. Two triggers therefore exist, both calling the SAME
//   `runScheduledReplication()`:
//
//     1. Vercel Cron → GET /api/maintenance → runScheduledMaintenance()
//        folds a replication step in, so the existing daily cron covers it.
//     2. An external scheduler (free cron service) → GET /api/replication-cron
//        for near-continuous convergence. Authorized with CRON_SECRET or
//        MAINTENANCE_SECRET, never with a user session.
//
// Contract:
//   GET  — scheduled run. Cron secret / maintenance secret / admin.
//   POST — manual admin run from the reliability console.
//
// Honesty rules:
//   • Flags off, or no standby configured, is NOT an error. It answers 200
//     with `skipped:true` and a reason. A cron that fails when redundancy is
//     not configured would page someone about a feature they never enabled.
//   • A cycle that exceeds the time budget reports `timed_out:true` and does
//     NOT claim convergence. The cursor is only advanced by the Replicator
//     when a cycle completes, so a partial run is safe to retry.
//   • Verification is opt-in (`verify=1`). A full row-level compare across 34
//     tables does not fit in a cron budget, and silently running a truncated
//     verify would produce a green light that means nothing.

import { auditLog, cors, hasMaintenanceSecret, isAdmin, isCronAuthorized } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import { FLAGS, flagEnabled, getBackend } from "./_backend/index.js";
import { getControlPlane } from "./_backend/control-plane.js";
import { flushMirrorQueue, mirrorStats } from "./_mirror.js";

/** Default wall-clock budget for one scheduled tick. */
const DEFAULT_BUDGET_MS = 45_000;

/** Default gap between cold-start / maintenance-driven ticks. */
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;

/** Control-plane key holding the cooldown lease. Expiry IS the cooldown. */
const COOLDOWN_KEY = "repl:scheduled:lease";

function budgetMs() {
	const raw = Number.parseInt(process.env.REPLICATION_TIME_BUDGET_MS || "", 10);
	if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BUDGET_MS;
	return Math.min(Math.max(raw, 1_000), 300_000);
}

function cooldownMs() {
	const raw = Number.parseInt(process.env.REPLICATION_COOLDOWN_MS || "", 10);
	if (!Number.isFinite(raw) || raw < 0) return DEFAULT_COOLDOWN_MS;
	return Math.min(raw, 60 * 60 * 1000);
}

function truthy(value) {
	const raw = String(value ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function withTimeout(promise, ms) {
	let timer = null;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve({ timed_out: true, budget_ms: ms }), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/**
 * One convergence tick. Never throws — the maintenance cron must not fail
 * because redundancy is unconfigured or the standby is briefly unreachable.
 *
 * @param {{ tables?: string[], reset?: boolean, verify?: boolean }} [opts]
 */
export async function runScheduledReplication(opts = {}) {
	const startedAt = Date.now();

	// Drain the write-path standby copy FIRST and independently of the
	// failover/replication flags: those flags gate the swappable-adapter stack,
	// while the mirror runs on every Supabase write regardless. Coupling them
	// would mean pending copies never retry on a deployment that (correctly)
	// has failover switched off.
	const mirrorFlush = await withTimeout(flushMirrorQueue(), budgetMs()).catch((err) => ({
		error: String(err?.message || err).slice(0, 200),
	}));

	let backend;
	try {
		backend = await getBackend();
	} catch (err) {
		return {
			ran_at: new Date(startedAt).toISOString(),
			ok: mirrorFlush?.error ? false : true,
			skipped: true,
			reason: "backend_unavailable",
			error: String(err?.message || err).slice(0, 200),
			standby_copy: { flush: mirrorFlush, stats: mirrorStats() },
		};
	}

	const replicateResult = await withTimeout(
		backend.replicate({ tables: opts.tables, reset: opts.reset === true }),
		budgetMs(),
	).catch((err) => ({
		ok: false,
		error: String(err?.message || err).slice(0, 200),
		code: err?.code || null,
	}));

	const skipped = replicateResult?.skipped === true;
	const timedOut = replicateResult?.timed_out === true;

	// Verification is opt-in and only meaningful once replication actually ran.
	let verified = null;
	if (opts.verify === true && !skipped && !timedOut) {
		verified = await withTimeout(backend.verify({ tables: opts.tables }), budgetMs()).catch(
			(err) => ({ ok: false, error: String(err?.message || err).slice(0, 200) }),
		);
	}

	return {
		ran_at: new Date(startedAt).toISOString(),
		duration_ms: Date.now() - startedAt,
		ok: !timedOut && replicateResult?.ok !== false && !mirrorFlush?.error,
		skipped,
		timed_out: timedOut,
		reason: skipped ? replicateResult.reason : undefined,
		replicated: replicateResult,
		verified,
		standby_copy: { flush: mirrorFlush, stats: mirrorStats() },
	};
}

/**
 * Cold-start / maintenance-driven tick, throttled by a control-plane lease.
 *
 * api/index.js runs `runScheduledMaintenance()` on every cold start. Without a
 * throttle, every new serverless instance would sweep 34 tables looking for
 * changes — harmless but wasteful, and noisy in the primary's logs. The lease
 * is acquired with CAS-if-absent and expires on its own, so no cleanup path is
 * needed. On the process-local memory control plane the lease cannot span
 * instances; that limitation is already reported as `control_plane.durable`.
 *
 * Returns `{skipped:true, reason}` instead of throwing so the caller (the
 * daily maintenance cron) never fails because redundancy is idle.
 */
export async function runScheduledReplicationIfDue(opts = {}) {
	if (!flagEnabled(process.env, FLAGS.REPLICATION)) {
		return { skipped: true, reason: `${FLAGS.REPLICATION} is off` };
	}
	const ttlMs = cooldownMs();
	if (ttlMs > 0) {
		const acquired = await getControlPlane()
			.compareAndSet(COOLDOWN_KEY, null, { at: new Date().toISOString() }, { ttlMs })
			.catch(() => ({ ok: true }));
		if (!acquired?.ok) {
			return { skipped: true, reason: "cooldown" };
		}
	}
	return runScheduledReplication(opts);
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	const isCronInvocation = req.method === "GET";
	const isAdminInvocation = req.method === "POST";
	if (!isCronInvocation && !isAdminInvocation) {
		return res.status(405).json({ error: "GET or POST only", allow: "GET, POST" });
	}

	// Defense in depth: the matrix already authorized this route. The handler
	// stands on its own because it is imported directly by tests and by
	// runScheduledMaintenance(), and could be mounted elsewhere.
	const authorized = isCronInvocation
		? (await isCronAuthorized(req)) || hasMaintenanceSecret(req)
		: (await isAdmin(req)) || hasMaintenanceSecret(req);
	if (!authorized) {
		return res.status(isCronInvocation ? 401 : 403).json({
			error: isCronInvocation
				? "Scheduled replication requires a valid cron secret"
				: "Replication authentication required",
		});
	}

	const body = req.body && typeof req.body === "object" ? req.body : {};
	const tables = Array.isArray(body.tables)
		? body.tables.map((t) => String(t).trim()).filter(Boolean).slice(0, 64)
		: undefined;
	const verify =
		truthy(body.verify) || truthy(req.query?.verify) || truthy(req.query?.full);

	try {
		const result = await runScheduledReplication({
			tables,
			reset: body.reset === true,
			verify,
		});

		// Only log runs that actually did something, so a disabled feature does
		// not fill activity_logs with "skipped" rows every few minutes.
		if (!result.skipped) {
			await auditLog(
				isCronInvocation ? "cron" : "admin",
				"replication",
				result.timed_out
					? `timed out after ${result.duration_ms}ms`
					: `completed in ${result.duration_ms}ms`,
			).catch(() => false);
		}

		return res.status(200).json({ success: result.ok !== false, ...result });
	} catch (err) {
		return sanitizeError(res, err, "replication-cron");
	}
}
