// ─── AI health ring (management harness, slice 3, observe-only) ────
// Per-task success/error/latency ring + consecutive-failure lane demotion
// tracking. OBSERVE-ONLY: recordAiCall is synchronous, in-memory, and never
// throws — callers invoke it fire-and-forget and behavior cannot change.
// Enforcement (skipping demoted lanes, budgets) is a later slice with its
// own tests; this slice only makes the invisible visible.
//
// Shape: { [taskKey]: { samples: [{ok, latencyMs, lane, at}], fails: number,
// demoted: { [lane]: untilMs } } }. Bounded: MAX_SAMPLES per task, so a
// hot task cannot grow memory without bound. No timers, no DB, no leaks.
// Aggregates (success rate, p50/p95, active lane) derive from measured
// samples only — never estimates, never fake scores.
import { AI_TASKS } from "./_ai-registry.js";

const MAX_SAMPLES = 200;
const DEMOTE_AFTER_FAILS = 5;
const DEMOTE_COOLDOWN_MS = 5 * 60 * 1000;

/** @type {Map<string, { samples: Array<{ok: boolean, latencyMs: number, lane: string, at: number}>, fails: number, demoted: Record<string, number> >}} */
const rings = new Map();

function entry(key) {
  let e = rings.get(key);
  if (!e) {
    e = { samples: [], fails: 0, demoted: {} };
    rings.set(key, e);
  }
  return e;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * Record one lane attempt. Never throws — wrapped defensively so a health
 * bug can never break a user request.
 */
export function recordAiCall(taskKey, { ok, latencyMs, lane } = {}) {
  try {
    if (typeof taskKey !== "string" || !taskKey) return;
    const e = entry(taskKey);
    const laneName = typeof lane === "string" && lane ? lane : "unknown";
    const ms = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : 0;
    e.samples.push({ ok: ok === true, latencyMs: ms, lane: laneName, at: Date.now() });
    if (e.samples.length > MAX_SAMPLES) {
      e.samples.splice(0, e.samples.length - MAX_SAMPLES);
    }
    if (ok === true) {
      e.fails = 0;
    } else {
      e.fails += 1;
      if (e.fails >= DEMOTE_AFTER_FAILS) {
        e.demoted[laneName] = Date.now() + DEMOTE_COOLDOWN_MS;
        e.fails = 0;
      }
    }
    // Expire stale demotions opportunistically (no timers).
    const now = Date.now();
    for (const [l, until] of Object.entries(e.demoted)) {
      if (until <= now) delete e.demoted[l];
    }
  } catch {
    /* health must never break requests */
  }
}

/** True while a lane sits out its consecutive-failure cooldown. */
export function isLaneDemoted(taskKey, lane) {
  try {
    const e = rings.get(taskKey);
    if (!e) return false;
    const until = e.demoted[lane];
    if (!until) return false;
    if (until <= Date.now()) {
      delete e.demoted[lane];
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Aggregate one task from measured samples only. Null when never observed. */
export function getTaskHealth(taskKey) {
  const e = rings.get(taskKey);
  if (!e || !e.samples.length) return null;
  const lat = e.samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const okCount = e.samples.reduce((n, s) => n + (s.ok ? 1 : 0), 0);
  const last = e.samples[e.samples.length - 1];
  const demoted = Object.entries(e.demoted)
    .filter(([, until]) => until > Date.now())
    .map(([lane]) => lane);
  return {
    calls: e.samples.length,
    errors: e.samples.length - okCount,
    successRate: okCount / e.samples.length,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    lastLane: last.lane,
    lastOk: last.ok,
    demoted,
  };
}

/** Whole-ring snapshot for /api/health and the console. */
export function getAiHealth() {
	const tasks = {};
	for (const key of rings.keys()) {
		const h = getTaskHealth(key);
		if (h) tasks[key] = h;
	}
	return { tasks, registry: AI_TASKS };
}

/**
 * Health-check view of the ring for /api/health's checks object. Pure
 * derivation from measured samples: empty ring is "ok" (fresh boot, not an
 * alarm), demoted lanes or sub-50% success over ≥10 calls is "warning".
 * Small samples stay quiet to avoid alerting on noise.
 */
export function aiHealthCheck() {
	const { tasks, registry } = getAiHealth();
	const names = Object.keys(tasks);
	if (!names.length) {
		return { status: "ok", note: "no AI calls observed this instance", tasks: {}, registry };
	}
	const issues = [];
	for (const [key, h] of Object.entries(tasks)) {
		if (h.demoted.length) {
			issues.push(`${key}: lane(s) demoted (${h.demoted.join(",")})`);
		} else if (h.calls >= 10 && h.successRate < 0.5) {
			issues.push(
				`${key}: success ${(h.successRate * 100).toFixed(0)}% over ${h.calls} calls`,
			);
		}
	}
	return issues.length
		? { status: "warning", issues, tasks, registry }
		: { status: "ok", tasks, registry };
}

/** Test-only reset: ring state would otherwise leak across test cases. */
export function __resetAiHealth() {
  rings.clear();
}
