// ═══════════════════════════════════════════════════════════════════
// Incident Triage Queue Wiring — SPEC §5 producer + consumer
// ═══════════════════════════════════════════════════════════════════
// The first real producer/consumer pair on the durable work queue:
//
//   producer  detectIncidents() (real threshold breach) → enqueueTriageJobs()
//             one `incident.triage` job per NEW incident, idempotencyKey
//             `incident.triage:<incident.id>` (a replayed detection run
//             dedupes to 1 record), priority mapped from the incident's
//             real severity (critical→critical … info→low, unknown→medium).
//
//   consumer  runTriageWorker() claims `incident.triage` jobs and for each:
//             observe (fresh loadIncidents) → decide (missing → failJob;
//             already RESOLVED/CLOSED → cancelJob, no resurrection) →
//             act (assignIncident: a real state change — status ASSIGNED,
//             worker_assignments entry, timeline entry, KV write) →
//             independently verify (a SECOND fresh loadIncidents re-read —
//             never the writer's return value — must show the incident,
//             status ASSIGNED, and the persisted assignment for THIS job)
//             → evidence (the three check records) → resolveVerification.
//             All checks pass → COMPLETED. Any check fails → applyFailure
//             (RETRYING/FAILED). UNKNOWN is never SUCCESS.
//
// Failure never masquerades as success: every producer failure lands in
// summary.errors (surfaced by the cron into results.errors), every
// consumer exception is re-failed with a reason (best-effort), and a
// verification pass requires all three independent checks green.
// ═══════════════════════════════════════════════════════════════════

import { assignIncident, loadIncidents } from "./_incidents.js";
import { logger } from "./_observability.js";
import {
	enqueueJob,
	enqueueClaim,
	startJob,
	submitVerification,
	resolveVerification,
	failJob,
	cancelJob,
} from "./_work-queue.js";

export const TRIAGE_JOB_TYPE = "incident.triage";
export const TRIAGE_WORKER = "worker:incident-triage";

/** Real incident severity → queue priority (unmapped → medium). */
export const SEVERITY_PRIORITY = Object.freeze({
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
	info: "low",
});

export function triagePriority(severity) {
	return SEVERITY_PRIORITY[severity] ?? "medium";
}

/**
 * Producer: one durable triage job per newly detected incident.
 * Per-incident try/catch — one bad incident must not drop the others.
 * Returns { enqueued, duplicates, errors } (errors are message strings,
 * surfaced by the caller into results.errors; never silently swallowed).
 */
export async function enqueueTriageJobs(incidents) {
	const summary = { enqueued: 0, duplicates: 0, errors: [] };
	if (!Array.isArray(incidents)) {
		summary.errors.push("incidents must be an array");
		return summary;
	}
	for (const incident of incidents) {
		if (!incident || typeof incident.id !== "string" || incident.id.length === 0) {
			summary.errors.push("incident without id — not enqueued");
			continue;
		}
		try {
			const result = await enqueueJob({
				type: TRIAGE_JOB_TYPE,
				idempotencyKey: `incident.triage:${incident.id}`,
				priority: triagePriority(incident.severity),
				input: {
					incidentId: incident.id,
					severity: typeof incident.severity === "string" ? incident.severity : "unknown",
					title: typeof incident.title === "string" ? incident.title : "",
				},
			});
			if (result.enqueued) {
				summary.enqueued += 1;
			} else {
				summary.duplicates += 1;
			}
		} catch (err) {
			summary.errors.push(`${incident.id}: ${err.message}`);
		}
	}
	return summary;
}

/**
 * Consumer: claim up to maxJobs `incident.triage` jobs and run the full
 * observe → decide → act → verify → evidence loop on each. Only PENDING
 * jobs of this type are ever claimed (other producers' jobs untouched).
 * Returns { claimed, completed, failed, cancelled, errors }.
 */
export async function runTriageWorker({ maxJobs = 3 } = {}) {
	const summary = { claimed: 0, completed: 0, failed: 0, cancelled: 0, errors: [] };

	for (let i = 0; i < maxJobs; i++) {
		let claim;
		try {
			claim = await enqueueClaim(TRIAGE_WORKER, { type: TRIAGE_JOB_TYPE });
		} catch (err) {
			summary.errors.push(`claim failed: ${err.message}`);
			break;
		}
		if (!claim.claimed) break;
		summary.claimed += 1;
		const job = claim.job;

		try {
			await startJob(job.id, TRIAGE_WORKER);
			const incidentId = job.input?.incidentId;
			if (typeof incidentId !== "string" || incidentId.length === 0) {
				await failJob(job.id, "job input missing incidentId", { worker: TRIAGE_WORKER });
				summary.failed += 1;
				continue;
			}

			// observe — fresh read before acting
			const observed = await loadIncidents();
			const current = observed.find((x) => x.id === incidentId);
			if (!current) {
				// decided: no record to triage — cancel, never fake success.
				// (a transient read glitch re-enqueues a fresh job; retrying a
				// deleted record would only burn attempts into dead-letter)
				await cancelJob(job.id, `incident ${incidentId} not found`);
				summary.cancelled += 1;
				continue;
			}
			if (current.status === "RESOLVED" || current.status === "CLOSED") {
				// decided: never resurrect a finished incident
				await cancelJob(job.id, `incident already ${current.status}`);
				summary.cancelled += 1;
				continue;
			}

			// act — real state change through the domain API (KV write)
			const assigned = await assignIncident(
				incidentId,
				TRIAGE_WORKER,
				`triage job ${job.id}`,
			);
			if (assigned && assigned.error) {
				await failJob(job.id, `assignIncident: ${assigned.error}`, {
					worker: TRIAGE_WORKER,
				});
				summary.failed += 1;
				continue;
			}

			// independently verify — a second fresh re-read, NOT the
			// writer's return object
			const reread = await loadIncidents();
			const inc = reread.find((x) => x.id === incidentId);
			const assignment = inc?.worker_assignments?.find(
				(a) => a.worker_id === TRIAGE_WORKER && a.task === `triage job ${job.id}`,
			);
			const checks = [
				{
					check: "incident exists on independent re-read",
					incidentId,
					pass: Boolean(inc),
				},
				{
					check: "status is ASSIGNED",
					incidentId,
					observed_status: inc?.status ?? null,
					pass: inc?.status === "ASSIGNED",
				},
				{
					check: "assignment persisted for this job",
					incidentId,
					jobId: job.id,
					worker: TRIAGE_WORKER,
					pass: Boolean(assignment),
				},
			];
			const passed = checks.every((c) => c.pass);

			await submitVerification(job.id, {
				worker: TRIAGE_WORKER,
				evidence: checks,
				result: {
					incidentId,
					checks: checks.length,
					verifiedAt: new Date().toISOString(),
				},
			});
			const resolved = await resolveVerification(job.id, {
				worker: TRIAGE_WORKER,
				passed,
				...(passed
					? {}
					: {
							failureReason: `independent verification mismatch: ${checks
								.filter((c) => !c.pass)
								.map((c) => c.check)
								.join("; ")}`,
					  }),
			});
			if (resolved.state === "COMPLETED") {
				summary.completed += 1;
			} else {
				summary.failed += 1;
			}
		} catch (err) {
			summary.errors.push(`${job.id}: ${err.message}`);
			logger.error("incident-triage", "Triage job raised", {
				jobId: job.id,
				error: err.message,
			});
			try {
				await failJob(job.id, `worker exception: ${err.message}`, {
					worker: TRIAGE_WORKER,
				});
				summary.failed += 1;
			} catch (err2) {
				summary.errors.push(`${job.id}: re-fail after exception failed: ${err2.message}`);
			}
		}
	}

	return summary;
}
