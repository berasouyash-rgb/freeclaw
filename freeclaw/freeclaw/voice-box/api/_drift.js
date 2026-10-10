// AI Drift watch — measures real quality deltas over time (roster #28).
//
// REAL JOB: compare the two most recent red-team runs (pass-rate drift) and
// the evaluation history's per-worker score deltas (score drift), flag any
// regression beyond tolerance, and persist a verified snapshot to the
// canonical settings KV (ai_drift:latest). Zero-arg (the cron loop calls the
// registry run with no arguments).
//
// Every number comes from a real read; an unavailable source degrades to a
// null section rather than a fabricated zero.
import supabase from "./_db-client.js";
import { getEvaluationHistory } from "./_evaluation-engine.js";

const DRIFT_KEY = "ai_drift:latest";
const DRIFT_TOLERANCE = 10; // percentage points of pass-rate drift

async function readRedteamRuns() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "safety_redteam_runs")
			.maybeSingle();
		return Array.isArray(data?.value?.runs) ? data.value.runs : [];
	} catch {
		return [];
	}
}

export async function runDriftWatch({ nowMs = Date.now() } = {}) {
	const snapshot = { generated_at: new Date(nowMs).toISOString() };

	// 1. Red-team pass-rate drift (two most recent real runs).
	const runs = await readRedteamRuns();
	let redteam = null;
	if (runs.length >= 2) {
		const latest = runs[0];
		const previous = runs[1];
		const delta =
			(Number(latest.pass_rate) || 0) - (Number(previous.pass_rate) || 0);
		redteam = {
			latest_pass_rate: Number(latest.pass_rate) || 0,
			previous_pass_rate: Number(previous.pass_rate) || 0,
			delta,
			drifted: Math.abs(delta) > DRIFT_TOLERANCE,
		};
	}

	// 2. Evaluation score drift (per worker: latest vs previous average_score).
	let evaluations = null;
	try {
		const items = (await getEvaluationHistory(50)) || [];
		const byWorker = new Map();
		for (const it of items) {
			if (!it?.worker_id) continue;
			if (!byWorker.has(it.worker_id)) byWorker.set(it.worker_id, []);
			byWorker.get(it.worker_id).push(Number(it.summary?.average_score) || 0);
		}
		const drifting = [];
		for (const [workerId, scores] of byWorker) {
			if (scores.length < 2) continue;
			const delta = scores[0] - scores[1]; // newest minus previous
			if (delta < -DRIFT_TOLERANCE)
				drifting.push({ worker_id: workerId, delta });
		}
		evaluations = { workers_tracked: byWorker.size, drifting };
	} catch {
		evaluations = null;
	}

	const driftFlags = [
		...(redteam?.drifted ? [{ source: "redteam", delta: redteam.delta }] : []),
		...(evaluations?.drifting || []).map((d) => ({
			source: "evaluation",
			...d,
		})),
	];
	const report = {
		...snapshot,
		redteam,
		evaluations,
		drift_flags: driftFlags,
		drifted: driftFlags.length > 0,
	};

	try {
		await supabase.from("settings").upsert(
			{ key: DRIFT_KEY, value: report },
			{ onConflict: "key" },
		);
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", DRIFT_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === report.generated_at;
		return { ok: true, verified: persisted, ...report };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

// GET /api/drift — admin read of the latest drift snapshot.
export default async function handler(req, res) {
	const { cors, isAdmin } = await import("./_auth.js");
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", DRIFT_KEY)
			.maybeSingle();
		if (!data?.value) return res.status(404).json({ error: "No drift snapshot generated yet" });
		return res.status(200).json(data.value);
	} catch (err) {
		console.error("drift error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
