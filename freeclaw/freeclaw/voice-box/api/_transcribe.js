// Server-side speech-to-text.
//
// WHY THIS EXISTS: the browser Web Speech API is a live, lossy, network-bound
// recogniser. It drops words, returns "no-speech" while the mic is clearly
// hearing audio, and cannot be tuned. Worse, its transcript is a *property of
// the session*, not of the audio — so the user's own recording (which they can
// play back) can disagree with the text they were given, and there is nothing
// to re-check against.
//
// This endpoint transcribes the RECORDED take instead, so the transcript is a
// property of the audio: record → upload → transcribe → review. The client
// keeps its live transcript only as a fallback, never as the authority.
//
// Honest degradation (spec §0/§56): with no ASR provider key configured this
// returns 503 { degraded:true } and the client keeps the live transcript. It
// NEVER invents text, and never reports a success it cannot evidence.
import { clientIp, cors, rateLimited, rateLimitResponse, verifyCallerIdentity } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import { recordAiCall } from "./_ai-health.js";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/audio/transcriptions";
const NVIDIA_MODEL = "openai/whisper-large-v3";
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_MODEL = "whisper-1";
// Groq hosts the same Whisper weights behind an OpenAI-compatible audio
// endpoint and is an order of magnitude faster per request (their
// whisper-large-v3-turbo is built for speed). Free-tier key, so this is the
// primary whenever GROQ_API_KEY exists. Measured 2026-09-26: the NVIDIA
// audio path 404s ("page not found" — the endpoint is gone for this key),
// which is why NVIDIA alone can no longer carry transcription.
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

// The router caps every /api/* request body at 500 KB (ABUSE_LIMITS
// .maxRequestSize). Base64 inflates by 4/3, so raw audio is capped below the
// equivalent to leave headroom for JSON overhead. ~90 s of Opus fits.
const MAX_AUDIO_BYTES = 350_000;
const MIN_AUDIO_BYTES = 512;
const PROVIDER_TIMEOUT_MS = 25_000;

// The client sends BCP-47 tags (en-IN / hi-IN / bn-IN); Whisper wants an
// ISO-639-1 code.
const LANG_MAP = { "en-IN": "en", "hi-IN": "hi", "bn-IN": "bn" };
function mapLanguage(tag) {
	const raw = String(tag || "").trim();
	if (!raw) return null;
	if (LANG_MAP[raw]) return LANG_MAP[raw];
	const short = raw.split("-")[0].toLowerCase();
	return /^[a-z]{2}$/.test(short) ? short : null;
}

const EXT_BY_MIME = {
	"audio/webm": "webm",
	"video/webm": "webm",
	"audio/ogg": "ogg",
	"audio/mp4": "m4a",
	"audio/x-m4a": "m4a",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
};

/** One OpenAI-compatible audio-transcription call. Never throws. */
async function postAudio({ url, key, model, blob, filename, language }) {
	const form = new FormData();
	form.append("file", blob, filename);
	form.append("model", model);
	if (language) form.append("language", language);

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), PROVIDER_TIMEOUT_MS);
	try {
		const r = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
			body: form,
			signal: ctrl.signal,
		});
		if (!r.ok) {
			const detail = await r.text().catch(() => "");
			return {
				ok: false,
				status: r.status,
				detail: String(detail || "").slice(0, 200),
			};
		}
		const data = await r.json().catch(() => null);
		const text =
			typeof data?.text === "string" ? data.text.trim() : "";
		if (!text) return { ok: false, status: 502, detail: "empty transcript" };
		return { ok: true, text };
	} catch (err) {
		return {
			ok: false,
			status: 0,
			detail: String(err?.message || err).slice(0, 120),
		};
	} finally {
		clearTimeout(timer);
	}
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		const { audioBase64, contentType, lang } = req.body || {};
		if (!audioBase64 || typeof audioBase64 !== "string")
			return res.status(400).json({ error: "Missing audioBase64" });

		// FIX #6 (AUDIT): ASR calls cost real provider money — require the
		// caller's session identity (api.ts sends x-anon-id on every request).
		const claimedId = String(req.headers["x-anon-id"] || "")
			.trim()
			.toLowerCase();
		if (!claimedId)
			return res
				.status(403)
				.json({ error: "Invalid session identity", code: "invalid_identity" });

		const caller = await verifyCallerIdentity(req, res, claimedId);
		if (!caller.ok)
			return res
				.status(caller.status || 403)
				.json({ error: caller.error || "Forbidden" });

		// Reuse the platform's existing voice rate-limit bucket — the same one
		// the voice assist path uses — rather than inventing a table.
		if (
			await rateLimited(
				"assist_voice",
				clientIp(req), // FIX #11: proxy-aware key, not the spoofable raw header
				300,
				20,
			)
		) {
			return rateLimitResponse(
				res,
				300,
				"Too many voice notes — please wait a moment and try again.",
			);
		}

		// Per-user cap so rotating IPs doesn't buy extra ASR quota.
		if (await rateLimited("assist_voice", caller.callerId, 300, 20)) {
			return rateLimitResponse(
				res,
				300,
				"Too many voice notes — please wait a moment and try again.",
			);
		}

		const declared = String(contentType || "")
			.toLowerCase()
			.split(";")[0]
			.trim();
		if (declared && !EXT_BY_MIME[declared])
			return res
				.status(415)
				.json({ error: `Unsupported audio type: ${declared}` });

		// Tolerate a data: URL prefix — the client may send either form.
		const b64 = audioBase64.replace(/^data:[^;]+;base64,/, "");
		let buffer;
		try {
			buffer = Buffer.from(b64, "base64");
		} catch {
			buffer = null;
		}
		if (!buffer || buffer.length < MIN_AUDIO_BYTES)
			return res
				.status(400)
				.json({ error: "Recording too short or unreadable" });
		if (buffer.length > MAX_AUDIO_BYTES)
			return res.status(413).json({
				error: `Recording too long (${Math.round(buffer.length / 1024)} KB, max ${Math.round(MAX_AUDIO_BYTES / 1024)} KB). Keep voice notes under about 90 seconds.`,
			});

		const groqKey = process.env.GROQ_API_KEY || "";
		const nvidiaKey = process.env.NVIDIA_API_KEY || "";
		const openaiKey = process.env.OPENAI_API_KEY || "";
		if (!groqKey && !nvidiaKey && !openaiKey) {
			// Honest capability gap, not a failure the user can fix.
			return res.status(503).json({
				ok: false,
				degraded: true,
				reason:
					"No speech-to-text provider configured (set GROQ_API_KEY or OPENAI_API_KEY).",
			});
		}

		const mime = declared || "audio/webm";
		const ext = EXT_BY_MIME[mime] || "webm";
		const blob = new Blob([buffer], { type: mime });
		const filename = `take.${ext}`;
		const language = mapLanguage(lang);

		// Failover chain: Groq (fastest) → NVIDIA NIM → OpenAI (reference).
		const attempts = [];
		if (groqKey) {
			const tGroq = Date.now();
			const r = await postAudio({
				url: GROQ_URL,
				key: groqKey,
				model: GROQ_MODEL,
				blob,
				filename,
				language,
			});
			if (r.ok) {
				recordAiCall("transcribe", { ok: true, latencyMs: Date.now() - tGroq, lane: "groq" });
				return res.status(200).json({
					ok: true,
					text: r.text.slice(0, 4000),
					provider: "groq",
					model: GROQ_MODEL,
					bytes: buffer.length,
				});
			}
			recordAiCall("transcribe", { ok: false, latencyMs: Date.now() - tGroq, lane: "groq" });
			attempts.push(`groq(${r.status}): ${r.detail}`);
		}
		if (nvidiaKey) {
			const tNvidia = Date.now();
			const r = await postAudio({
				url: NVIDIA_URL,
				key: nvidiaKey,
				model: NVIDIA_MODEL,
				blob,
				filename,
				language,
			});
			if (r.ok) {
				recordAiCall("transcribe", { ok: true, latencyMs: Date.now() - tNvidia, lane: "nvidia" });
				return res.status(200).json({
					ok: true,
					text: r.text.slice(0, 4000),
					provider: "nvidia",
					model: NVIDIA_MODEL,
					bytes: buffer.length,
				});
			}
			recordAiCall("transcribe", { ok: false, latencyMs: Date.now() - tNvidia, lane: "nvidia" });
			attempts.push(`nvidia(${r.status}): ${r.detail}`);
		}
		if (openaiKey) {
			const tOpenai = Date.now();
			const r = await postAudio({
				url: OPENAI_URL,
				key: openaiKey,
				model: OPENAI_MODEL,
				blob,
				filename,
				language,
			});
			if (r.ok) {
				recordAiCall("transcribe", { ok: true, latencyMs: Date.now() - tOpenai, lane: "openai" });
				return res.status(200).json({
					ok: true,
					text: r.text.slice(0, 4000),
					provider: "openai",
					model: OPENAI_MODEL,
					bytes: buffer.length,
				});
			}
			recordAiCall("transcribe", { ok: false, latencyMs: Date.now() - tOpenai, lane: "openai" });
			attempts.push(`openai(${r.status}): ${r.detail}`);
		}

		// Every configured provider failed — report it, never invent text.
		return res.status(502).json({
			ok: false,
			error: "Speech-to-text provider failed",
			detail: attempts.join(" | ").slice(0, 300),
		});
	} catch (err) {
		return sanitizeError(res, err, "transcribe");
	}
}
