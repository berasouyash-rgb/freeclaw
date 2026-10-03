// ─── AI Systems Registry (management harness, slice 1) ─────────────
// Single manifest of every AI-backed task on the platform: which lanes run
// in which order, with what timeouts, what happens when all lanes fail, and
// what gates (rate limits, admin-only, kill switches) guard it.
//
// Read-only in this slice: nothing imports it yet, so it cannot disturb any
// behavior. Slice 2 wires callers + health; slice 3 budgets; slice 4 evals.
// Every claim below was verified against the owner file before writing —
// see the contract test. If you change a lane, timeout, fallback, or rate
// limit in an owner, update its entry here or the contract test goes red.
//
// Conventions:
//   lanes: [{ provider, model, timeoutMs }] in try order. A lane marked
//     knownBad documents a lane that must never be relied on alone.
//   fallback: "local" (deterministic heuristic in-repo) or "none" (honest
//     empty/error to the caller — never invented content).
//   rate: { bucket, windowSec, max, scope } mirroring the rateLimited() call.
//   kill: task kill-switch key, or "none" (global switch only).

/**
 * @typedef {Object} AiLane
 * @property {string} provider
 * @property {string} model
 * @property {number} timeoutMs
 * @property {boolean} [knownBad]
 *
 * @typedef {Object} AiTaskEntry
 * @property {string} key
 * @property {string} owner
 * @property {string} description
 * @property {boolean} adminOnly
 * @property {AiLane[]} lanes
 * @property {"local" | "none"} fallback
 * @property {{ bucket: string, windowSec: number, max: number, scope: string }} rate
 * @property {string} kill
 */

/** @type {AiTaskEntry[]} */
export const AI_TASKS = [
	{
		key: "transcribe",
		owner: "api/_transcribe.js",
		description: "Server speech-to-text for recorded takes (Groq first).",
		adminOnly: false,
		lanes: [
			{ provider: "groq", model: "whisper-large-v3-turbo", timeoutMs: 25000 },
			{ provider: "nvidia", model: "openai/whisper-large-v3", timeoutMs: 25000, knownBad: true },
			{ provider: "openai", model: "whisper-1", timeoutMs: 25000 },
		],
		fallback: "none",
		rate: { bucket: "assist_voice", windowSec: 300, max: 20, scope: "ip+user" },
		kill: "none",
	},
	{
		key: "assist.suggest",
		owner: "api/_assist.js",
		description: "Live category/tags/priority/title suggestions while typing.",
		adminOnly: false,
		lanes: [
			{ provider: "nvidia-fast", model: "staggered-race: super-120b, ultra-550b, gpt-oss-20b (see NVIDIA_FAST_MODELS)", timeoutMs: 6000 },
			{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 8000 },
		],
		fallback: "local",
		rate: { bucket: "assist_suggest", windowSec: 300, max: 30, scope: "ip" },
		kill: "none",
	},
	{
		key: "assist.suggest_poll",
		owner: "api/_assist.js",
		description: "Poll question + options improvement while typing.",
		adminOnly: false,
		lanes: [{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 8000 }],
		fallback: "none",
		rate: { bucket: "assist_suggest_poll", windowSec: 300, max: 30, scope: "ip" },
		kill: "none",
	},
	{
		key: "assist.voice_complaint",
		owner: "api/_assist.js",
		description:
			"Ramble-to-complaint structuring (voice transcripts and typed text via the structure_complaint alias).",
		adminOnly: false,
		lanes: [
			{ provider: "nvidia-fast", model: "staggered-race: super-120b, ultra-550b, gpt-oss-20b (see NVIDIA_FAST_MODELS)", timeoutMs: 12000 },
			{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 4000 },
		],
		fallback: "local",
		rate: { bucket: "assist_voice", windowSec: 300, max: 20, scope: "ip" },
		kill: "none",
	},
	{
		key: "assist.chat_reply",
		owner: "api/_assist.js",
		description: "Admin-side AI reply drafting in support threads.",
		adminOnly: true,
		lanes: [{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 15000 }],
		fallback: "none",
		rate: { bucket: "assist_chat", windowSec: 300, max: 20, scope: "admin-token" },
		kill: "none",
	},
	{
		key: "moderation.heuristic",
		owner: "api/_moderation.js",
		description:
			"Deterministic local moderation (profanity, spam, PII, accusation gates). Always on, no keys, no lanes.",
		adminOnly: false,
		lanes: [],
		fallback: "local",
		rate: { bucket: "none", windowSec: 0, max: 0, scope: "n/a" },
		kill: "none",
	},
	{
		key: "inbox.emotion",
		owner: "api/_inbox.js",
		description: "Emotion classification routing threads to general/emotional agents.",
		adminOnly: false,
		lanes: [
			{ provider: "nvidia-fast", model: "staggered-race: super-120b, ultra-550b, gpt-oss-20b (see NVIDIA_FAST_MODELS)", timeoutMs: 10000 },
			{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 20000 },
		],
		fallback: "local",
		rate: { bucket: "none", windowSec: 0, max: 0, scope: "n/a" },
		kill: "none",
	},
	{
		key: "inbox.triage",
		owner: "api/_inbox.js",
		description: "Thread triage (priority/emotion/action) with allowlisted outputs.",
		adminOnly: false,
		lanes: [
			{ provider: "nvidia-fast", model: "staggered-race: super-120b, ultra-550b, gpt-oss-20b (see NVIDIA_FAST_MODELS)", timeoutMs: 12000 },
			{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 20000 },
		],
		fallback: "local",
		rate: { bucket: "none", windowSec: 0, max: 0, scope: "n/a" },
		kill: "none",
	},
	{
		key: "inbox.summary",
		owner: "api/_inbox.js",
		description: "Thread summaries with bounded state/summary/entities.",
		adminOnly: false,
		lanes: [
			{ provider: "nvidia-fast", model: "staggered-race: super-120b, ultra-550b, gpt-oss-20b (see NVIDIA_FAST_MODELS)", timeoutMs: 12000 },
			{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 20000 },
		],
		fallback: "local",
		rate: { bucket: "none", windowSec: 0, max: 0, scope: "n/a" },
		kill: "none",
	},
	{
		key: "inbox.draft",
		owner: "api/_inbox.js",
		description: "Admin reply drafting; empty reply on failure, never fabricated.",
		adminOnly: false,
		lanes: [
			{ provider: "nvidia-fast", model: "staggered-race: super-120b, ultra-550b, gpt-oss-20b (see NVIDIA_FAST_MODELS)", timeoutMs: 12000 },
			{ provider: "chain", model: "multi-provider failover (first success wins)", timeoutMs: 20000 },
		],
		fallback: "none",
		rate: { bucket: "none", windowSec: 0, max: 0, scope: "n/a" },
		kill: "none",
	},
];

/** Look up a task by key. Returns undefined for unknown keys (never throw). */
export function getAiTask(key) {
	return AI_TASKS.find((t) => t.key === key);
}
