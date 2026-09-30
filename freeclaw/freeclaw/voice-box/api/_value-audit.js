// ═══════════════════════════════════════════════════════════════════
// Worker Value Audit — SPEC §45 TEST 10 producer + consumer
// ═══════════════════════════════════════════════════════════════════
// TEST 10: "Worker produces no meaningful work -> disable test fails
// value proposition -> capability flagged for removal."
//
//   producer  enqueueValueAudits({declaredWorkers, now}) enumerates
//             every worker that can be held accountable: the declared
//             queue workers handed in by the caller PLUS every worker
//             id discovered on durable queue history (listJobs) — a
//             worker that ever claimed a job stays auditable even when
//             its jobs have since moved to states that null the worker
//             (RETRYING/FAILED). One `worker.value-audit` job per
//             worker per UTC day, idempotencyKey
//             `worker.value-audit:<worker>:<YYYY-MM-DD>`, priority low,
//             input carries the rolling 24h window [now-24h, now] the
//             audit judges against. A discovery read failure is pushed
//             to summary.errors but never silently drops the declared
//             workers — they are still enqueued from the caller's list.
//
//   consumer  runValueAuditWorker() claims `worker.value-audit` jobs
//             and for each: observe (fresh listJobs; jobs whose
//             `worker` is this worker) -> decide (meaningful work =
//             at least one COMPLETED job whose completedAt falls inside
//             the window AND whose evidence array is non-empty — the
//             queue's verification gate makes that an independently
//             re-readable state change, not a claim) -> act (persist
//             the verdict to settings KV `worker_value_flags`, a
//             current-state map keyed by worker id so a later passing
//             audit SUPERSEDES an old flag instead of leaving a stale
//             removal demand, plus one activity_logs evidence row per
//             attempt) -> independently verify (fresh re-reads of BOTH
//             the registry and the activity row — never the writer's
//             return value) -> evidence -> resolve. Zero
//             completed-with-evidence jobs in the window fails the
//             value proposition: verdict `flagged`, reason names
//             whether the worker holds open jobs (claimed but not
//             producing) or is idle/never dispatched. All checks green
//             -> COMPLETED. Any mismatch -> RETRYING via applyFailure
//             with the failing check names. UNKNOWN is never SUCCESS.
//
// Verdicts are current state; activity rows carry per-attempt history
// (detail starts with the audit jobId so a reader can pair an attempt
// row with the registry entry written by the same pass). Activity rows
// whose pass later failed verification stay as the attempt trail — the
// registry entry with the matching jobId is the authoritative verdict.
//
// Self-audit: the auditor counts its own completed, evidenced audit
// jobs like any other worker's. Declared workers enqueue before
// discovered ones, so on the first cycle the auditor processes another
// worker's audit first and then honestly self-verifies off that
// completed job — no special case, no exemption.
//
// Trigger: GET /api/incident-cron?action=value-audit — produce,
// consume, and flag read-back in one call; scheduled daily in
// vercel.json crons. Declared workers are passed by the caller (the
// cron routes TRIAGE_WORKER + VALUE_AUDIT_WORKER) so this module never
// hardcodes another module's worker identity.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { logger } from "./_observability.js";
import {
	enqueueJob,
	enqueueClaim,
	startJob,
	submitVerification,
	resolveVerification,
	failJob,
	listJobs,
} from "./_work-queue.js";

export const VALUE_AUDIT_JOB_TYPE = "worker.value-audit";
export const VALUE_AUDIT_WORKER = "worker:value-audit";
export const VALUE_WINDOW_MS = 24 * 60 * 60 * 1000;
const FLAGS_KEY = "worker_value_flags";
const ACTOR = VALUE_AUDIT_WORKER;
const isWorker = (w) => typeof w === "string" && w.length > 0;

/** Durable verdict registry read. Throws on read error — a failed read
 *  must never look like "no flag exists". Returns the current-state
 *  workerId -> verdict-entry map ({} before the first audit). */
async function readFlags() {
	const { data, error } = await supabase
		.from("settings")
		.select("value")
		.eq("key", FLAGS_KEY)
		.maybeSingle();
	if (error) {
		throw new Error(`worker_value_flags read failed: ${error.message ?? String(error)}`);
	}
	const workers =
		data?.value && typeof data.value.workers === "object" && data.value.workers
			? data.value.workers
			: {};
	return { rowExists: Boolean(data), workers };
}

/** Persist one verdict (upserts the worker's slot in the registry).
 *  Throws on write error — a refused write never masquerades as a
 *  recorded verdict (the consumer's independent re-read also catches a
 *  write that reports success but did not persist). */
async function writeVerdict(entry) {
	const { rowExists, workers } = await readFlags();
	const value = {
		workers: { ...workers, [entry.workerId]: entry },
		updated_at: new Date().toISOString(),
	};
	const result = rowExists
		? await supabase.from("settings").update({ value }).eq("key", FLAGS_KEY)
		: await supabase.from("settings").insert({ key: FLAGS_KEY, value });
	if (result?.error) {
		throw new Error(`worker_value_flags write failed: ${result.error.message ?? String(result.error)}`);
	}
	return entry;
}

/** Independent read-back of the whole registry (handler `value-audit`
 *  action and tests re-read through this, never through writeVerdict). */
export async function readAllVerdicts() {
	const { workers } = await readFlags();
	return workers;
}

/**
 * Producer: one value-audit job per declared/discovered worker for the
 * rolling 24h window ending now. Idempotent per worker per UTC day.
 */
export async function enqueueValueAudits({ declaredWorkers = [], now = Date.now() } = {}) {
	const summary = { enqueued: 0, duplicates: 0, errors: [] };
	const windowEnd = new Date(now).toISOString();
	const windowStart = new Date(now - VALUE_WINDOW_MS).toISOString();
	const day = windowEnd.slice(0, 10);

	let workerIds;
	try {
		const history = await listJobs({ limit: 500 });
		const discovered = history.map((j) => j.worker).filter(isWorker);
		workerIds = [...new Set([...declaredWorkers.filter(isWorker), ...discovered])];
	} catch (err) {
		// Discovery failed: surface it, still audit the declared workers.
		summary.errors.push(`worker discovery failed: ${err.message}`);
		workerIds = [...new Set(declaredWorkers.filter(isWorker))];
	}

	for (const workerId of workerIds) {
		try {
			const result = await enqueueJob({
				type: VALUE_AUDIT_JOB_TYPE,
				idempotencyKey: `worker.value-audit:${workerId}:${day}`,
				priority: "low",
				input: { workerId, windowStart, windowEnd },
			});
			if (result && result.enqueued) summary.enqueued += 1;
			else summary.duplicates += 1;
		} catch (err) {
			summary.errors.push(`${workerId}: ${err.message}`);
		}
	}
	return summary;
}

/**
 * Consumer: claim `worker.value-audit` jobs and carry each through the
 * full observe -> decide -> act -> independently-verify chain. Summary
 * mirrors the triage consumer shape (SPEC §5 evidence discipline).
 */
export async function runValueAuditWorker({ maxJobs = 20 } = {}) {
	const summary = { claimed: 0, completed: 0, flagged: 0, verified: 0, failed: 0, errors: [] };

	for (let i = 0; i < maxJobs; i++) {
		let claim;
		try {
			claim = await enqueueClaim(VALUE_AUDIT_WORKER, { type: VALUE_AUDIT_JOB_TYPE });
		} catch (err) {
			summary.errors.push(`claim failed: ${err.message}`);
			break;
		}
		if (!claim || !claim.claimed) break;
		summary.claimed += 1;
		const job = claim.job;

		try {
			await startJob(job.id, VALUE_AUDIT_WORKER);

			// ── input contract: an audit without a target is not an audit
			const workerId = job.input?.workerId;
			const windowStart = job.input?.windowStart;
			const windowEnd = job.input?.windowEnd;
			if (!isWorker(workerId) || !windowStart || !windowEnd) {
				await failJob(job.id, "job input missing workerId or window", {
					worker: VALUE_AUDIT_WORKER,
				});
				summary.failed += 1;
				continue;
			}

			// ── observe: fresh independent queue read (never cached state)
			const seen = await listJobs({ limit: 500 });
			const mine = seen.filter((j) => j.worker === workerId);
			const completedWithEvidence = mine.filter(
				(j) =>
					j.state === "COMPLETED" &&
					typeof j.completedAt === "string" &&
					j.completedAt >= windowStart &&
					j.completedAt <= windowEnd &&
					Array.isArray(j.evidence) &&
					j.evidence.length > 0,
			);
			const heldOpen = mine.filter(
				(j) => j.state === "CLAIMED" || j.state === "RUNNING" || j.state === "VERIFYING",
			);

			// ── decide: TEST 10 — zero meaningful work fails the value proposition
			const meaningful = completedWithEvidence.length > 0;
			const verdict = meaningful ? "verified" : "flagged";
			const reason = meaningful
				? null
				: heldOpen.length > 0
					? `no meaningful work in 24h: holds ${heldOpen.length} open job(s), completed 0 with evidence`
					: "no meaningful work in 24h: 0 completed jobs with evidence (idle or never dispatched)";

			// ── act: durable verdict + attempt evidence (both required)
			const entry = {
				workerId,
				verdict,
				reason,
				windowStart,
				windowEnd,
				jobId: job.id,
				completedWithEvidence: completedWithEvidence.length,
				heldOpen: heldOpen.length,
				jobIds: completedWithEvidence.slice(0, 10).map((j) => j.id),
				at: new Date().toISOString(),
			};
			await writeVerdict(entry);

			const action = meaningful ? "worker_value_verified" : "worker_flagged_for_removal";
			const detail = JSON.stringify({
				jobId: job.id,
				workerId,
				verdict,
				reason,
				completed: completedWithEvidence.length,
				heldOpen: heldOpen.length,
				windowStart,
				windowEnd,
			}).slice(0, 500);
			const inserted = await supabase.from("activity_logs").insert({
				actor: ACTOR,
				action,
				detail,
			});
			if (inserted?.error) {
				throw new Error(`activity_logs insert failed: ${inserted.error.message ?? String(inserted.error)}`);
			}

			// ── independently verify: fresh re-reads, never the writer's returns
			const reread = await readFlags();
			const verdictEntry = reread.workers[workerId] ?? null;
			const { data: activityRows, error: activityErr } = await supabase
				.from("activity_logs")
				.select("*")
				.eq("action", action);
			if (activityErr) {
				throw new Error(`activity_logs read failed: ${activityErr.message ?? String(activityErr)}`);
			}
			const activityRow = (Array.isArray(activityRows) ? activityRows : []).find(
				(r) =>
					r.actor === ACTOR &&
					r.action === action &&
					String(r.detail ?? "").includes(job.id),
			);
			const checks = [
				{
					check: "observation: completed with evidence in window",
					workerId,
					observed: { completedWithEvidence: completedWithEvidence.length, heldOpen: heldOpen.length },
					pass: true,
				},
				{
					check: "verdict persisted on independent re-read",
					workerId,
					verdict,
					observed: verdictEntry?.verdict ?? null,
					pass: verdictEntry?.verdict === verdict,
				},
				{
					check: "verdict is this audit job's verdict",
					workerId,
					jobId: job.id,
					observed: verdictEntry?.jobId ?? null,
					pass: verdictEntry?.jobId === job.id,
				},
				{
					check: "window preserved on re-read",
					workerId,
					observed: verdictEntry ? `${verdictEntry.windowStart}..${verdictEntry.windowEnd}` : null,
					pass: verdictEntry?.windowStart === windowStart && verdictEntry?.windowEnd === windowEnd,
				},
				{
					check: "activity evidence row re-read",
					workerId,
					action,
					jobId: job.id,
					observed: activityRow ? "present" : "absent",
					pass: Boolean(activityRow),
				},
			];
			const passed = checks.every((c) => c.pass);
			await submitVerification(job.id, { worker: VALUE_AUDIT_WORKER, evidence: checks });
			const resolved = await resolveVerification(job.id, {
				worker: VALUE_AUDIT_WORKER,
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
				if (meaningful) summary.verified += 1;
				else summary.flagged += 1;
			} else {
				summary.failed += 1;
			}
		} catch (err) {
			// An exception is a failure, never a pass: re-fail with reason.
			summary.errors.push(`${job.id}: ${err.message}`);
			logger.error("value-audit", "Audit job raised", { jobId: job.id, error: err.message });
			try {
				await failJob(job.id, `worker exception: ${err.message}`, { worker: VALUE_AUDIT_WORKER });
				summary.failed += 1;
			} catch (err2) {
				summary.errors.push(`${job.id}: re-fail after exception failed: ${err2.message}`);
			}
		}
	}
	return summary;
}
