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

let _aiVerificationCache = null;
let _aiVerificationExpiresAt = 0;

/**
 * AI System Verification Harness: proves a REAL model generated an answer.
 *
 * The old probe only checked `res.ok`. That is not evidence: Groq's
 * gpt-oss-120b is a reasoning model, so a `max_tokens: 15` request returns
 * HTTP 200 with an EMPTY `content` (the budget was consumed by reasoning) —
 * the console reported "verified_real_llm: true" while no text was produced.
 * It also probed nemotron-3-ultra, which answers 503 on the shared free
 * worker, so the quality lane read as dead even when it was usable.
 *
 * This probe therefore asserts non-empty generated content and uses the two
 * model ids actually live on the configured keys (probed 2026-11-15).
 */
const GROQ_VERIFY_MODEL = "openai/gpt-oss-120b";
const NVIDIA_VERIFY_MODEL = "nvidia/nemotron-3.5-bolt-e4b";

async function probeModel({ url, key, model, extraBody = {}, timeoutMs = 8000 }) {
	const cleanKey = String(key || "").replace(/["']/g, "").trim();
	if (!cleanKey) return { configured: false, live: false, model, answer: "", status: 0 };
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	const started = Date.now();
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${cleanKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "user", content: 'Reply with exactly this JSON and nothing else: {"pong":true}' },
				],
				max_tokens: 512,
				temperature: 0,
				...extraBody,
			}),
			signal: ctrl.signal,
		});
		if (!res.ok) {
			return { configured: true, live: false, model, answer: "", status: res.status, latency_ms: Date.now() - started };
		}
		const data = await res.json().catch(() => null);
		const answer = String(data?.choices?.[0]?.message?.content ?? "")
			.replace(/<\/?think>/gi, "")
			.trim();
		return {
			configured: true,
			// HTTP 200 with empty content is a FAILED verification, not a pass.
			live: answer.length > 0,
			model,
			answer: answer.slice(0, 120),
			status: res.status,
			latency_ms: Date.now() - started,
		};
	} catch (err) {
		return {
			configured: true,
			live: false,
			model,
			answer: "",
			status: 0,
			latency_ms: Date.now() - started,
			error: err?.name === "AbortError" ? "timeout" : String(err?.message || err).slice(0, 120),
		};
	} finally {
		clearTimeout(timer);
	}
}

export async function verifyRealLlmConnectivity() {
	const now = Date.now();
	if (_aiVerificationCache && _aiVerificationExpiresAt > now) {
		return _aiVerificationCache;
	}

	const groqKey = process.env.GROQ_API_KEY || "";
	const nvidiaKey = process.env.NVIDIA_API_KEY || "";

	const start = Date.now();
	const [groq, nvidia] = await Promise.all([
		probeModel({
			url: "https://api.groq.com/openai/v1/chat/completions",
			key: groqKey,
			model: GROQ_VERIFY_MODEL,
			// Keep reasoning cheap so the answer is not starved of tokens.
			extraBody: { reasoning_effort: "low" },
		}),
		probeModel({
			url: "https://integrate.api.nvidia.com/v1/chat/completions",
			key: nvidiaKey,
			model: NVIDIA_VERIFY_MODEL,
		}),
	]);

	const liveModels = [
		...(groq.live ? [`groq:${groq.model}`] : []),
		...(nvidia.live ? [`nvidia:${nvidia.model}`] : []),
	];
	const verified = liveModels.length > 0;

	const result = {
		status: verified ? "ok" : "warning",
		verified_real_llm: verified,
		primary_fast: groq.live ? `groq (${groq.model})` : nvidia.live ? `nvidia (${nvidia.model})` : "none",
		primary_quality: nvidia.live ? `nvidia (${nvidia.model})` : groq.live ? `groq (${groq.model})` : "none",
		groq_live: groq.live,
		nvidia_live: nvidia.live,
		live_models: liveModels,
		checked: { groq, nvidia },
		latency_ms: Date.now() - start,
		timestamp: new Date().toISOString(),
		...(verified
			? {}
			: {
					note:
						"No provider returned generated text. AI features report a degraded state instead of inventing answers.",
				}),
	};

	_aiVerificationCache = result;
	_aiVerificationExpiresAt = now + 60_000;
	return result;
}

/** Test-only reset: ring state would otherwise leak across test cases. */
export function __resetAiHealth() {
  rings.clear();
  _aiVerificationCache = null;
  _aiVerificationExpiresAt = 0;
}
