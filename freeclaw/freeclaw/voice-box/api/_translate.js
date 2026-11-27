// Multilingual translation — detect + translate non-localized content.
//
// This is the LIBRARY side of the Multilingual worker (roster #15). It is
// deterministic-first: language detection is a Unicode-script heuristic (no
// model call), and translation goes through the provider abstraction
// (callLLMChain) with an honest {ok:false} when no provider is configured —
// the worker never fabricates a translation.
//
// Dual-backend + canonical writes: the ORIGINAL text is never replaced.
// Translations are advisory copies stored in the settings KV
// (translation:{postId} — the same canonical pattern as ai_resolution:{id})
// so admins can read them; the worker records evidence per row.
import { clean } from "./_auth.js";
import supabase from "./_db-client.js";
import { callLLMChain } from "./_providers.js";

// Unicode script ranges — the majority script of the text decides the code.
const SCRIPT_RANGES = [
	{ code: "hi", name: "Devanagari (Hindi/Marathi)", start: 0x0900, end: 0x097f },
	{ code: "bn", name: "Bengali", start: 0x0980, end: 0x09ff },
	{ code: "pa", name: "Gurmukhi (Punjabi)", start: 0x0a00, end: 0x0a7f },
	{ code: "gu", name: "Gujarati", start: 0x0a80, end: 0x0aff },
	{ code: "ta", name: "Tamil", start: 0x0b80, end: 0x0bff },
	{ code: "te", name: "Telugu", start: 0x0c00, end: 0x0c7f },
	{ code: "kn", name: "Kannada", start: 0x0c80, end: 0x0cff },
	{ code: "ml", name: "Malayalam", start: 0x0d00, end: 0x0d7f },
	{ code: "ar", name: "Arabic", start: 0x0600, end: 0x06ff },
	{ code: "ja", name: "Kana (Japanese)", start: 0x3040, end: 0x30ff },
	{ code: "zh", name: "CJK (Chinese)", start: 0x4e00, end: 0x9fff },
	{ code: "ko", name: "Hangul (Korean)", start: 0xac00, end: 0xd7af },
	{ code: "ru", name: "Cyrillic", start: 0x0400, end: 0x04ff },
];

const MIN_SCRIPT_CHARS = 2;

/**
 * Deterministic language detection by Unicode script.
 *
 * @returns {{ ok: boolean, language: string, script: string|null, reason?: string }}
 *   `language: "en"` when the text is ASCII/Latin; `ok:false` when there is
 *   not enough text to decide.
 */
export function detectLanguage(text) {
	const t = String(text || "");
	if (!t.trim()) return { ok: false, language: "und", script: null, reason: "no text" };
	const counts = new Map();
	for (const ch of t) {
		const cp = ch.codePointAt(0);
		// ASCII / Latin-1 letters are the platform default — not counted.
		if (cp < 0x0250) continue;
		for (const r of SCRIPT_RANGES) {
			if (cp >= r.start && cp <= r.end) {
				counts.set(r.code, (counts.get(r.code) || 0) + 1);
				break;
			}
		}
	}
	if (counts.size === 0) return { ok: true, language: "en", script: null };
	let best = null;
	let bestCount = 0;
	for (const [code, n] of counts) {
		if (n > bestCount) {
			best = code;
			bestCount = n;
		}
	}
	if (bestCount < MIN_SCRIPT_CHARS)
		return { ok: false, language: "und", script: null, reason: "too few script chars" };
	const range = SCRIPT_RANGES.find((r) => r.code === best);
	return { ok: true, language: best, script: range ? range.name : null };
}

/**
 * Translate text to the target language through the provider abstraction.
 * The original text is preserved by the caller; this returns an advisory
 * translation only. Honest failure when no provider is configured.
 *
 * @returns {Promise<{ok: boolean, language: string, title_translation?: string, description_translation?: string, provider?: string, error?: string}>}
 */
export async function translateText({ title, description, targetLang = "en" } = {}) {
	const t = clean(String(title || ""), 300);
	const d = clean(String(description || ""), 2000);
	if (!t && !d) return { ok: false, language: targetLang, error: "no text to translate" };

	const system =
		"You are a translation assistant for a school feedback platform. " +
		`Translate the given title and description into ${targetLang}. ` +
		"Preserve the original meaning — never summarize, censor, or add information. " +
		'Respond ONLY with JSON: {"title_translation": string, "description_translation": string}.';
	const user = `Title: ${t || "(none)"}\nDescription: ${d || "(none)"}`;

	try {
		const result = await callLLMChain(system, user);
		if (!result?.text) {
			return { ok: false, language: targetLang, error: result?.error || "provider returned no text" };
		}
		const payload = JSON.parse(
			result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(),
		);
		const titleTranslation = clean(String(payload.title_translation || ""), 300);
		const descriptionTranslation = clean(String(payload.description_translation || ""), 2000);
		if (!titleTranslation && !descriptionTranslation) {
			return { ok: false, language: targetLang, error: "provider returned empty translation" };
		}
		return {
			ok: true,
			language: targetLang,
			title_translation: titleTranslation || undefined,
			description_translation: descriptionTranslation || undefined,
			provider: result.provider,
		};
	} catch (err) {
		return { ok: false, language: targetLang, error: String(err?.message || err).slice(0, 200) };
	}
}

/**
 * Read the stored translation for one post (canonical settings KV).
 *
 * @returns {Promise<{ok: boolean, translation?: object, error?: string}>}
 */
export async function getTranslation(postId) {
	if (!postId) return { ok: false, error: "post_id required" };
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", `translation:${postId}`)
			.maybeSingle();
		if (!data?.value) return { ok: false, error: "no translation stored" };
		return { ok: true, translation: data.value };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

/** Persist a translation to the canonical settings KV. */
export async function saveTranslation(postId, value) {
	await supabase.from("settings").upsert(
		{ key: `translation:${postId}`, value },
		{ onConflict: "key" },
	);
}

// GET /api/translate?post_id=X — admin read of a stored translation.
export default async function handler(req, res) {
	const { cors } = await import("./_auth.js");
	const { isAdmin } = await import("./_auth.js");
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const postId = req.query.post_id;
		if (!postId) return res.status(400).json({ error: "post_id required" });
		const r = await getTranslation(postId);
		if (!r.ok) return res.status(404).json({ error: r.error });
		return res.status(200).json(r.translation);
	} catch (err) {
		console.error("translate error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
