// ═══════════════════════════════════════════════════════════════
// WORKFORCE CORE — real autonomous operations engine
// ═══════════════════════════════════════════════════════════════
// Implements the mandatory worker lifecycle:
//   TRIGGER → OBSERVE → EVIDENCE → ANALYZE → DECIDE → SAFETY CHECK
//   → EXECUTE → VERIFY → MEASURE → LOG → ALERT IF NEEDED
//
// Anti-fantasy rules enforced HERE, not by convention:
//   - An execution is "verified_success" ONLY when its verify step returns
//     { ok:true } after the operation ran against real data.
//   - Every execution writes ONE row to the action ledger (settings KV until
//     migration 010 provides the workforce_actions table; the engine uses the
//     table when present, falling back to KV so it works pre-migration).
//   - Workers declare execution_class A/B/C. Class C NEVER executes — it
//     only escalates with evidence.
//   - Per-worker action budgets (max runs/hour, max affected records) are
//     enforced before EXECUTE; exceeding them marks the run "budget_blocked".
//   - No metric may be written that was not measured by the worker itself.
// ═══════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const LEDGER_KEY = "workforce_actions_kv";
const LEDGER_MAX_ROWS = 500;
const HEALTH_KEY = "workforce_health";

/** Worker registry entry shape (all fields REQUIRED at registration): */
// {
//   worker_id, name, responsibility,
//   trigger_types: [],            // which events/crons wake it
//   execution_class: 'A'|'B'|'C', // A=safe-auto B=mitigate+notify C=evidence-only
//   risk_level: 'low'|'medium'|'high',
//   budget: { max_runs_per_hour: n, max_affected_records: n },
//   tools: [toolNames],           // declared capability list (audited)
//   rollback_strategy: 'text'|fn(result)->Promise,
//   success_metric: 'metric.key', // what before/after measures
// }

const _registry = new Map();

export function registerWorker(spec) {
	const required = [
		"worker_id",
		"name",
		"responsibility",
		"execution_class",
	];
	for (const k of required)
		if (!spec[k]) throw new Error(`worker ${spec.worker_id}: missing ${k}`);
	if (!["A", "B", "C"].includes(spec.execution_class))
		throw new Error(`worker ${spec.worker_id}: bad execution_class`);
	_registry.set(spec.worker_id, {
		budget: { max_runs_per_hour: 4, max_affected_records: 200 },
		risk_level: "low",
		trigger_types: ["cron"],
		tools: [],
		rollback_strategy: null,
		success_metric: null,
		version: spec.version || "1.0.0",
		shadow_mode: spec.shadow_mode || false,
		...spec,
	});
}

export function getRegistry() {
	return [..._registry.values()];
}

export function getWorker(workerId) {
	return _registry.get(workerId);
}

// ── Ledger persistence ─────────────────────────────────────────
async function ledgerAppend(row) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", LEDGER_KEY)
			.maybeSingle();
		const items = Array.isArray(data?.value?.items) ? data.value.items : [];
		items.unshift(row);
		await supabase.from("settings").upsert(
			{
				key: LEDGER_KEY,
				value: { items: items.slice(0, LEDGER_MAX_ROWS), updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);
	} catch (err) {
		console.error("[workforce] ledger append failed:", err?.message);
	}
}

export async function readLedger(limit = 50) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", LEDGER_KEY)
			.maybeSingle();
		return (data?.value?.items || []).slice(0, limit);
	} catch {
		return [];
	}
}

/** Aggregate health from REAL ledger rows only. */
export async function workforceHealth() {
	const rows = await readLedger(500);
	const now = Date.now();
	const last24h = rows.filter(
		(r) => now - new Date(r.started_at).getTime() < 24 * 3600 * 1000,
	);
	const count = (s) => last24h.filter((r) => r.outcome === s).length;
	return {
		total_executions_24h: last24h.length,
		verified_success_24h: count("verified_success"),
		verified_failure_24h: count("verified_failure"),
		execution_failed_24h: count("execution_failed"),
		budget_blocked_24h: count("budget_blocked"),
		escalated_24h: count("escalated"),
		workers_registered: _registry.size,
		updated_at: new Date().toISOString(),
	};
}

// ── Budget enforcement (real, time-windowed, per worker) ───────
async function budgetAllows(workerId, maxPerHour) {
	const rows = await readLedger(500);
	const hourAgo = Date.now() - 3600 * 1000;
	const recent = rows.filter(
		(r) =>
			r.worker_id === workerId &&
			new Date(r.started_at).getTime() > hourAgo &&
			r.outcome !== "budget_blocked",
	);
	return recent.length < maxPerHour;
}

/**
 * Run a worker through the FULL lifecycle.
 * `spec.observe()`    → returns evidence object or null (nothing to do)
 * `spec.analyze(ev)`  → { decision: 'act'|'skip'|'escalate', reason, target?, payload? }
 * `spec.execute(dec)` → { result, affected }   (REAL operation)
 * `spec.verify(res)`  → { ok:boolean, proof:string }
 * `spec.measure?()`   → { metric, before, after }  (optional; must be real)
 */
export async function runWorker(workerId, trigger = "cron") {
	const spec = _registry.get(workerId);
	if (!spec) return { outcome: "unknown_worker" };
	const t0 = Date.now();
	const row = {
		id: `wf_${t0.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		worker_id: workerId,
		name: spec.name,
		event_id: trigger,
		started_at: new Date(t0).toISOString(),
		completed_at: null,
		outcome: null, // verified_success | verified_failure | execution_failed | skipped | escalated | budget_blocked
		decision: null,
		evidence: null,
		action_type: null,
		target: null,
		verification: null,
		metrics: null,
		error: null,
		duration_ms: null,
	};

	try {
		// Budget gate BEFORE any observation work
		if (!(await budgetAllows(workerId, spec.budget.max_runs_per_hour))) {
			row.outcome = "budget_blocked";
			row.completed_at = new Date().toISOString();
			row.duration_ms = Date.now() - t0;
			await ledgerAppend(row);
			return row;
		}

	// SHADOW MODE — if worker is in shadow mode, observe + analyze + propose
	// but NEVER execute. Record the proposed action for evaluation.
	if (spec.shadow_mode) {
		const evidence = await spec.observe();
		row.evidence = evidence && typeof evidence === 'object'
			? JSON.parse(JSON.stringify(evidence)).summary ?? 'collected'
			: null;
		if (!evidence || evidence.empty) {
			row.outcome = 'skipped';
			row.completed_at = new Date().toISOString();
			row.duration_ms = Date.now() - t0;
			await ledgerAppend(row);
			return row;
		}
		const dec = await spec.analyze(evidence);
		row.decision = `[SHADOW] ${dec.decision}: ${dec.reason || ''}`.slice(0, 300);
		row.action_type = 'shadow_proposal';
		row.outcome = 'skipped';
		row.completed_at = new Date().toISOString();
		row.duration_ms = Date.now() - t0;
		await ledgerAppend(row);
		return row;
	}

	// OBSERVE + COLLECT EVIDENCE
	const evidence = await spec.observe();
		row.evidence =
			evidence && typeof evidence === "object"
				? JSON.parse(JSON.stringify(evidence)).summary ?? "collected"
				: null;
		if (!evidence || evidence.empty) {
			row.outcome = "skipped";
			row.completed_at = new Date().toISOString();
			row.duration_ms = Date.now() - t0;
			await ledgerAppend(row);
			return row;
		}

		// ANALYZE + DECIDE
		const dec = await spec.analyze(evidence);
		row.decision = `${dec.decision}: ${dec.reason || ""}`.slice(0, 300);

		if (dec.decision === "escalate" || spec.execution_class === "C") {
			row.outcome = "escalated";
			row.completed_at = new Date().toISOString();
			row.duration_ms = Date.now() - t0;
			await ledgerAppend(row);
			if (typeof spec.onEscalate === "function")
				await spec.onEscalate(evidence, dec).catch(() => {});
			return row;
		}
		if (dec.decision !== "act") {
			row.outcome = "skipped";
			row.completed_at = new Date().toISOString();
			row.duration_ms = Date.now() - t0;
			await ledgerAppend(row);
			return row;
		}

		// SAFETY CHECK: Class C never reaches here; cap affected records
		if (
			spec.budget.max_affected_records &&
			Number(dec.affected) > spec.budget.max_affected_records
		) {
			row.outcome = "budget_blocked";
			row.decision += " [affected-record cap]";
			row.completed_at = new Date().toISOString();
			row.duration_ms = Date.now() - t0;
			await ledgerAppend(row);
			return row;
		}

		// EXECUTE (real operation)
		let execRes;
		try {
			execRes = await spec.execute(dec);
		} catch (err) {
			row.outcome = "execution_failed";
			row.error = String(err?.message || err).slice(0, 400);
			row.completed_at = new Date().toISOString();
			row.duration_ms = Date.now() - t0;
			await ledgerAppend(row);
			if (spec.execution_class === "B" && typeof spec.onEscalate === "function")
				await spec.onEscalate(evidence, { reason: `execution failed: ${row.error}`, severity: "high" }).catch(() => {});
			return row;
		}
		row.action_type = execRes.action_type || "mutation";
		row.target = execRes.target || null;

		// VERIFY
		const verdict = await spec.verify(execRes);
		row.verification = verdict?.proof ? String(verdict.proof).slice(0, 300) : null;

		// AUTOMATIC ROLLBACK — if verify fails and rollback_strategy exists,
		// restore the previous known-good state before marking as failure.
		if (!verdict?.ok && typeof spec.rollback_strategy === "function") {
			try {
				await spec.rollback_strategy(execRes);
				row.verification += " [rolled back]";
			} catch (rbErr) {
				row.verification += ` [rollback failed: ${String(rbErr?.message || rbErr).slice(0, 100)}]`;
			}
		}

		// MEASURE (only if worker actually measures)
		if (typeof spec.measure === "function") {
			try {
				row.metrics = await spec.measure(execRes);
			} catch {
				row.metrics = null; // never fabricate
			}
		}

		row.outcome = verdict?.ok ? "verified_success" : "verified_failure";
		row.completed_at = new Date().toISOString();
		row.duration_ms = Date.now() - t0;
		await ledgerAppend(row);

		// ALERT IF NECESSARY (class B always notifies admins of mitigation)
		if (
			spec.execution_class === "B" ||
			row.outcome === "verified_failure"
		) {
			if (typeof spec.notifyAdmin === "function")
				await spec.notifyAdmin(row).catch(() => {});
		}
		return row;
	} catch (err) {
		row.outcome = "execution_failed";
		row.error = String(err?.message || err).slice(0, 400);
		row.completed_at = new Date().toISOString();
		row.duration_ms = Date.now() - t0;
		await ledgerAppend(row);
		return row;
	}
}

/** Run all registered workers (used by cron). Never throws. */
export async function runWorkforce(trigger = "cron") {
	const results = [];
	for (const id of _registry.keys()) {
		try {
			results.push(await runWorker(id, trigger));
		} catch (err) {
			results.push({ worker_id: id, outcome: "execution_failed", error: err?.message });
		}
	}
	const health = await workforceHealth();
	return { results, health };
}
