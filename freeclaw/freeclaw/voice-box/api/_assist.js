// Real-time AI writing assistance: category detection, tag suggestions,
// title improvement, and contextual chat replies.
// NO templates — every reply comes directly from the external LLM model.
// Uses the shared provider chain (NVIDIA/Anthropic/etc) instead of direct Anthropic calls.
import { cors, isAdmin, rateLimited, rateLimitResponse } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import {
	callLLMChain,
	callNvidiaFast,
	hasUsableLLM,
} from "./_providers.js";
import { recordAiCall } from "./_ai-health.js";

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error("timeout")), ms),
		),
	]);
}

// ── Suggestion response cache ───────────────────────────────────
// Typing re-fires suggest on every pause, so identical input hits this
// endpoint repeatedly. A hit returns instantly with zero LLM cost and
// zero wait — and every hit is one less call on the shared NIM worker,
// which is what keeps the inbox fast too. Keyed by task + normalized
// text, 60s TTL, bounded size. Only successful AI results are stored:
// local/empty fallbacks are microseconds to recompute and must stay fresh.
// Conversational tasks (chat_reply) are never cached — context differs.
const SUGGEST_CACHE_TTL_MS = 60000;
const SUGGEST_CACHE_MAX = 200;
const suggestCache = new Map();
function suggestCacheKey(task, text) {
	return `${task}:${String(text || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 500)}`;
}
function suggestCacheGet(task, text) {
	const hit = suggestCache.get(suggestCacheKey(task, text));
	if (!hit) return null;
	if (Date.now() - hit.at > SUGGEST_CACHE_TTL_MS) {
		suggestCache.delete(suggestCacheKey(task, text));
		return null;
	}
	return hit.body;
}
function suggestCacheSet(task, text, body) {
	if (suggestCache.size >= SUGGEST_CACHE_MAX) suggestCache.clear();
	suggestCache.set(suggestCacheKey(task, text), { at: Date.now(), body });
}

// ── Deterministic local complaint structurer ─────────────────────
// Zero-LLM path: no API key, no network, no timeout — runs in
// microseconds and NEVER fails. Used as the guaranteed backbone of
// voice_complaint (the LLM only upgrades the wording when keys exist).
// Understands English + romanised Hindi/Bengali keywords.
const LOCAL_CATEGORIES = [
	"Academics",
	"Facilities",
	"Food",
	"Bullying",
	"Teachers",
	"Events",
	"Transport",
	"Sports",
	"Technology",
	"Library",
	"Hostel",
	"Security",
	"Cleanliness",
	"Medical",
	"Other",
];

const CATEGORY_KEYWORDS = {
	Academics: ["exam", "marks", "syllabus", "homework", "lesson", "study", "padhai", "pariksha", "result", "question paper", "assignment", "test", "pora", "porashona", "syllabus"],
	Facilities: ["building", "repair", "fan", "light", "toilet", "washroom", "bathroom", "classroom", "desk", "bench", "lift", "elevator", "door", "window", "roof", "leak", "water", "paani", "cooler", "jol", "electricity", "bijli", "current", "tap", "kol"],
	Bullying: ["bully", "bullying", "ragging", "ragged", "harass", "tease", "teasing", "beat", "beaten", "hit me", "slapped", "threat", "dhamki", "chedd", "ched"],
	Teachers: ["teacher", "sir", "madam", "ma'am", "professor", "shikshak", "master", "mashai", "faculty", "tutor"],
	Events: ["event", "function", "programme", "program", "annual day", "competition", "anushthan", "ceremony", "celebration"],
	Transport: ["bus", "van", "transport", "driver", "route", "bus stop", "gari", "rickshaw", "auto", "cab"],
	Sports: ["sports", "football", "cricket", "khela", "playground", "coach", "match", "tournament", "basketball", "game"],
	Technology: ["computer", "laptop", "wifi", "wi-fi", "internet", "projector", "software", "printer", "keyboard"],
	Library: ["library", "book", "books", "boi", "librarian", "borrow", "novel"],
	Hostel: ["hostel", "warden", "dormitory", "roommate", "hostel room"],
	Security: ["security", "guard", "gate", "cctv", "camera", "theft", "stolen", "chori", "stranger", "unsafe", "lock"],
	Cleanliness: ["clean", "dirty", "garbage", "dustbin", "sweep", "moyla", "nongra", "smell", "safai", "filthy", "dust"],
	Medical: ["medical", "doctor", "nurse", "sick", "fever", "injury", "injured", "hurt", "first aid", "oshustho", "betha", "health", "dispensary"],
	Food: ["canteen", "food", "lunch", "meal", "khana", "khabar", "mess food", "tiffin", "breakfast", "dinner", "stale", "unhygienic"],
};

const CRITICAL_WORDS = ["blood", "accident", "fire", "electric shock", "unconscious", "emergency", "attack", "weapon", "knife", "fainted"];
const HIGH_WORDS = ["urgent", "immediately", "turant", "ekhuni", "danger", "dangerous", "khatra", "bipod", "ragging", "ragged", "beaten", "harass", "unsafe", "as soon as possible", "right now"];
const LOW_HINTS = ["suggest", "request", "please add", "would be nice", "it would be good", "poramorsho"];

const TAG_STOPWORDS = new Set([
	"the", "a", "an", "is", "are", "was", "were", "be", "been", "my", "our",
	"their", "his", "her", "this", "that", "these", "those", "and", "or",
	"but", "of", "to", "in", "on", "for", "with", "has", "have", "had",
	"not", "no", "very", "too", "so", "do", "does", "did", "it", "its",
	"at", "by", "from", "as", "we", "they", "you", "he", "she", "school",
	"hai", "hain", "mein", "me", "ka", "ki", "ke", "ko", "ne", "aur",
	"or", "ek", "yeh", "woh", "jo", "kya", "nahi", "nahin", "bahut",
	"ache", "achhe", "achey", "ache", "amader", "amar", "ache", "achhe",
	"nei", "kore", "korche", "ta", "ti", "er", "onek", "khub", "amake",
	"hay", "haye", "ro", "ra", "der", "gulo", "guli", "hocche", "hoche",
	"korchi", "koro", "theke", "jonno", "shob", "sab", "sabhi",
]);

/** Parse + validate an LLM suggest-task JSON blob. Null when unusable. */
function parseSuggestJson(text, VALID_CATEGORIES, VALID_PRIORITIES) {
	try {
		let raw = String(text || "")
			.replace(/^```json?\s*/i, "")
			.replace(/```\s*$/, "")
			.trim();
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (jsonMatch) raw = jsonMatch[0];
		const parsed = JSON.parse(raw);
		if (!VALID_CATEGORIES.includes(parsed.category)) return null;
		return {
			category: parsed.category,
			confidence:
				typeof parsed.confidence === "number"
					? Math.max(0, Math.min(1, parsed.confidence))
					: undefined,
			priority: VALID_PRIORITIES.includes(parsed.priority)
				? parsed.priority
				: undefined,
			tags: Array.isArray(parsed.tags)
				? parsed.tags
						.filter((t) => typeof t === "string" && t.length > 0)
						.slice(0, 3)
				: [],
			improved_title:
				typeof parsed.improved_title === "string"
					? parsed.improved_title.slice(0, 120)
					: undefined,
		};
	} catch {
		return null;
	}
}

/** Parse + validate an LLM voice-draft JSON blob. Null when unusable. */
function parseVoiceDraft(text, VALID_CATEGORIES, VALID_PRIORITIES) {
	try {
		let raw = String(text || "")
			.replace(/^```json?\s*/i, "")
			.replace(/```\s*$/, "")
			.trim();
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (jsonMatch) raw = jsonMatch[0];
		const parsed = JSON.parse(raw);
		const title =
			typeof parsed.title === "string"
				? parsed.title.slice(0, 120).trim()
				: "";
		const description =
			typeof parsed.description === "string"
				? parsed.description.slice(0, 500).trim()
				: "";
		if (!title || !description) return null;
		return {
			title,
			description,
			category: VALID_CATEGORIES.includes(parsed.category)
				? parsed.category
				: "Other",
			tags: Array.isArray(parsed.tags)
				? parsed.tags
						.filter((t) => typeof t === "string" && t.length > 0)
						.slice(0, 3)
				: [],
			priority: VALID_PRIORITIES.includes(parsed.priority)
				? parsed.priority
				: "medium",
			// Extracted details (dates, places, times, amounts) —
			// same PII strip as the local backbone: emails, phone-like
			// digit runs. Names stay out by prompt contract + caps.
			details: Array.isArray(parsed.details)
				? parsed.details
					.filter((d) => typeof d === "string")
					.filter((d) => !/[\w.+-]+@[\w-]+\.[\w.]+/.test(d) && !/\b\d[\d\s-]{6,}\d\b/.test(d))
					.map((d) =>
						d
							.replace(/\s+/g, " ")
							.trim()
							.slice(0, 40),
					)
					.filter(Boolean)
					.slice(0, 4)
				: [],
		};
	} catch {
		return null;
	}
}

function structureLocally(raw) {
	// 1. Clean: strip PII + name intros, collapse whitespace.
	let text = String(raw || "")
		.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "")
		.replace(/\b\d[\d\s-]{6,}\d\b/g, "")
		.replace(/\b(my name is|mera naam|amar naam)\s+[a-zA-Z\u0980-\u09FF]+(\s+[a-zA-Z\u0980-\u09FF]+)?(\s+(hai|hain|ache))?/gi, "")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length < 8) return null;

	const lower = ` ${text.toLowerCase()} `;

	// 2. Category: keyword score, best wins, fallback Other.
	let bestCat = "Other";
	let bestScore = 0;
	for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
		let score = 0;
		for (const w of words) {
			if (lower.includes(w.toLowerCase())) score += w.includes(" ") ? 3 : 1;
		}
		if (score > bestScore) {
			bestScore = score;
			bestCat = cat;
		}
	}

	// 3. Title: first sentence, capped at 80 chars on a word boundary.
	const sentences = text
		.split(/[.!?।\n]+/)
		.map((s) => s.trim())
		.filter(Boolean);
	let title = sentences[0] || text;
	if (title.length < 15 && sentences[1]) title = `${title}, ${sentences[1]}`;
	title = title.charAt(0).toUpperCase() + title.slice(1);
	if (title.length > 80) {
		const cut = title.slice(0, 77);
		title = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
	}

	// 4. Description: full cleaned text, capped at 400.
	const description =
		text.length > 400
			? `${text.slice(0, 397).slice(0, Math.max(text.slice(0, 397).lastIndexOf(" "), 200)).trim()}…`
			: text;

	// 5. Tags: top content words, kebab-safe, max 3.
	const freq = new Map();
	for (const word of lower
		.replace(/[^a-z\u0980-\u09FF\s]/gi, " ")
		.split(/\s+/)) {
		const w = word.trim();
		if (w.length <= 2 || TAG_STOPWORDS.has(w)) continue;
		freq.set(w, (freq.get(w) || 0) + 1);
	}
	let tags = [...freq.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([w]) => w);
	if (tags.length === 0) tags = [bestCat.toLowerCase()];

	// 6. Priority: danger words win, requests soften, else medium.
	let priority = "medium";
	if (CRITICAL_WORDS.some((w) => lower.includes(w))) priority = "critical";
	else if (HIGH_WORDS.some((w) => lower.includes(w))) priority = "high";
	else if (LOW_HINTS.some((w) => lower.includes(w))) priority = "low";

	return { title, description, category: bestCat, tags, priority, details: [] };
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		const { task, text, messages } = req.body || {};

		// ---- Real-time submission assist (public, fast) ----
		if (task === "suggest") {
			let tFast = 0, tChain = 0;
			const input = String(text || "").slice(0, 800);
			if (input.trim().length < 8)
				return res
					.status(200)
					.json({ engine: "none", category: null, tags: [], priority: null });
			// Rate limit: max 30 suggestions per IP per 5 minutes
			if (
				await rateLimited(
					"assist_suggest",
					req.headers["x-forwarded-for"] || "anon",
					300,
					30,
				)
			) {
				return rateLimitResponse(
					res,
					300,
					"Too many requests — please wait a moment.",
				);
			}
			const cachedSuggest = suggestCacheGet("suggest", input);
			if (cachedSuggest)
				return res.status(200).json({ ...cachedSuggest, cached: true });
			// Three lanes, best first: fast NVIDIA → full chain → guaranteed
			// local keywords. The UI's live suggestions must never go blank
			// just because the AI is down.
			const VALID_CATEGORIES = [
				"Academics",
				"Facilities",
				"Food",
				"Bullying",
				"Teachers",
				"Events",
				"Transport",
				"Sports",
				"Technology",
				"Library",
				"Hostel",
				"Security",
				"Cleanliness",
				"Medical",
				"Other",
			];
			const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
			const SUGGEST_SYSTEM =
				"You classify school feedback. Categories: Academics, Facilities, Food, Bullying, Teachers, Events, Transport, Sports, Technology, Library, Hostel, Security, Cleanliness, Medical, Other. Respond with STRICT valid JSON only.";
			const SUGGEST_USER = `Text: """${input}"""\nReturn JSON: {"category":string,"confidence":0-1,"tags":[max 3 short kebab-case strings],"priority":"low|medium|high|critical","improved_title":string(max 80 chars, clear and specific)}`;
			try {
				tFast = Date.now();
				const fast = await withTimeout(
					callNvidiaFast(SUGGEST_SYSTEM, SUGGEST_USER, 6000),
					7000,
				).catch(() => null);
				const fastParsed = fast?.text
					? parseSuggestJson(fast.text, VALID_CATEGORIES, VALID_PRIORITIES)
					: null;
				if (fastParsed) {
					recordAiCall("assist.suggest", { ok: true, latencyMs: Date.now() - tFast, lane: "nvidia-fast" });
					const body = {
						engine: `${fast.provider}:${fast.model}`,
						...fastParsed,
					};
					suggestCacheSet("suggest", input, body);
					return res.status(200).json(body);
				}
				tChain = Date.now();
				const result = await withTimeout(
					callLLMChain(SUGGEST_SYSTEM, SUGGEST_USER, [], "high"),
					8000,
				);
				const chainParsed = result?.text
					? parseSuggestJson(
							result.text,
							VALID_CATEGORIES,
							VALID_PRIORITIES,
						)
					: null;
				if (chainParsed) {
					recordAiCall("assist.suggest", { ok: true, latencyMs: Date.now() - tChain, lane: "chain" });
					const body = {
						engine: `${result.provider}:${result.model}`,
						...chainParsed,
					};
					suggestCacheSet("suggest", input, body);
					return res.status(200).json(body);
				}
			} catch {
				/* fall through to the local backbone */
			}
			// Guaranteed local backbone — category, tags and priority from
			// keywords (no improved_title without an LLM; the client hides
			// just that row instead of the whole suggestion card).
			const local = structureLocally(input);
			if (local) {
				if (tFast) recordAiCall("assist.suggest", { ok: false, latencyMs: Date.now() - tFast, lane: "nvidia-fast" });
				if (tChain) recordAiCall("assist.suggest", { ok: false, latencyMs: Date.now() - tChain, lane: "chain" });
				return res.status(200).json({
					engine: "local",
					category: local.category,
					confidence: 0.55,
					priority: local.priority,
					tags: local.tags,
					improved_title: undefined,
				});
			}
			// If LLM fails completely, return no suggestions rather than fake data
			return res
				.status(200)
				.json({ engine: "none", category: null, tags: [], priority: null });
		}

		// ---- Smart poll suggestions (public, fast) ----
		if (task === "suggest_poll") {
			let tChain = 0;
			const input = String(text || "").slice(0, 500);
			if (input.trim().length < 4)
				return res
					.status(200)
					.json({
						engine: "none",
						improved_title: null,
						suggested_options: [],
						ptype: null,
					});
			if (
				await rateLimited(
					"assist_suggest_poll",
					req.headers["x-forwarded-for"] || "anon",
					300,
					30,
				)
			) {
				return rateLimitResponse(
					res,
					300,
					"Too many requests — please wait a moment.",
				);
			}
			const cachedPoll = suggestCacheGet("suggest_poll", input);
			if (cachedPoll)
				return res.status(200).json({ ...cachedPoll, cached: true });
			try {
				tChain = Date.now();
				const result = await withTimeout(
					callLLMChain(
						"You help students create better polls on an anonymous school feedback platform. Given a draft poll question, return STRICT valid JSON only.",
						`Draft poll question: """${input}"""\nReturn JSON: {"improved_title": string (max 90 chars, clearer and more specific), "suggested_options": [4 short concise option strings (max 40 chars each)] OR [] if it is a yes/no question, "ptype": "yesno"|"single"|"multi",						"note": short tip for the student (max 80 chars)}`,
						[],
						"high",
					),
					8000,
				);
				if (result?.text) {
					let raw = result.text
						.replace(/^```json?\s*/i, "")
						.replace(/```\s*$/, "")
						.trim();
					const jsonMatch = raw.match(/\{[\s\S]*\}/);
					if (jsonMatch) raw = jsonMatch[0];
					const parsed = JSON.parse(raw);
					const improved_title =
						typeof parsed.improved_title === "string"
							? parsed.improved_title.slice(0, 120)
							: null;
					const suggested_options = Array.isArray(parsed.suggested_options)
						? parsed.suggested_options
								.filter((o) => typeof o === "string" && o.length > 0)
								.slice(0, 6)
						: [];
					const ptype = ["yesno", "single", "multi"].includes(parsed.ptype)
						? parsed.ptype
						: suggested_options.length > 1
							? "single"
							: "yesno";
					const note =
						typeof parsed.note === "string" ? parsed.note.slice(0, 120) : null;
					if (improved_title || suggested_options.length > 0) {
						recordAiCall("assist.suggest_poll", { ok: true, latencyMs: Date.now() - tChain, lane: "chain" });
						const body = {
							engine: `${result.provider}:${result.model}`,
							improved_title,
							suggested_options,
							ptype,
							note,
						};
						suggestCacheSet("suggest_poll", input, body);
						return res.status(200).json(body);
					}
				}
			} catch {
				/* fall through — LLM timeout or parse error */
			}
			if (tChain) recordAiCall("assist.suggest_poll", { ok: false, latencyMs: Date.now() - tChain, lane: "chain" });
			return res
				.status(200)
				.json({
					engine: "none",
					improved_title: null,
					suggested_options: [],
					ptype: null,
					note: null,
				});
		}

		// ---- Voice complaint structuring (public, fast) ----
		// Takes a raw speech transcript in English, Hindi, or Bengali and turns
		// it into a proper complaint draft. Output is ALWAYS English (the
		// platform's working language) — the prompt instructs translation.
		if (task === "voice_complaint" || task === "structure_complaint") {
			let tFast = 0, tChain = 0;
			const input = String(text || "").slice(0, 1200);
			if (input.trim().length < 8)
				return res.status(200).json({ engine: "none", draft: null });
			if (
				await rateLimited(
					"assist_voice",
					req.headers["x-forwarded-for"] || "anon",
					300,
					20,
				)
			) {
				return rateLimitResponse(
					res,
					300,
					"Too many requests — please wait a moment.",
				);
			}
			const cachedDraft = suggestCacheGet("voice_complaint", input);
			if (cachedDraft)
				return res.status(200).json({ ...cachedDraft, cached: true });
			const VALID_CATEGORIES = [
				"Academics",
				"Facilities",
				"Food",
				"Bullying",
				"Teachers",
				"Events",
				"Transport",
				"Sports",
				"Technology",
				"Library",
				"Hostel",
				"Security",
				"Cleanliness",
				"Medical",
				"Other",
			];
			const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
			// Guaranteed backbone FIRST (microseconds, never fails) — the user
			// always has a structured draft even if everything below burns.
			const local = structureLocally(input);
			let draft = local;
			let engine = "local";
			const VOICE_SYSTEM =
				"You structure spoken school complaints. The speaker may use English, Hindi (Devanagari or romanised), or Bengali (Bengali script or romanised). Translate and rewrite everything into clear, polite ENGLISH. Categories: Academics, Facilities, Food, Bullying, Teachers, Events, Transport, Sports, Technology, Library, Hostel, Security, Cleanliness, Medical, Other. Respond with STRICT valid JSON only.";
			const VOICE_USER = `Complaint: """${input}"""\nReturn JSON: {"title":string(max 80 chars, specific English headline),"description":string(max 400 chars, clear English, first person, no names/phones/addresses),"category":one of the listed categories,"tags":[max 3 short kebab-case English strings],"priority":"low|medium|high|critical","details":[up to 4 short strings: dates, places, times or amounts mentioned, in English; never names, phones or addresses]}`;
			try {
				// Lane 1 — direct fast NVIDIA call (free key, live model).
				// Skips the whole chain/DB latency for this small JSON task.
				tFast = Date.now();
				const fast = await withTimeout(
					callNvidiaFast(VOICE_SYSTEM, VOICE_USER, 12000),
					13000,
				).catch(() => null);
				const fastDraft = fast?.text
					? parseVoiceDraft(fast.text, VALID_CATEGORIES, VALID_PRIORITIES)
					: null;
				if (fastDraft) {
					recordAiCall("assist.voice_complaint", { ok: true, latencyMs: Date.now() - tFast, lane: "nvidia-fast" });
					draft = fastDraft;
					engine = `${fast.provider}:${fast.model}`;
				} else {
					// Lane 2 — full provider chain (DB keys, other vendors).
					// The chain is the same congested NVIDIA key when no DB-configured
					// vendor exists, so keep these budgets tight: the local draft is
					// already ready and a long second wait only delays the user.
					const usable = await withTimeout(hasUsableLLM(), 1500).catch(
						() => false,
					);
					if (usable) {
						tChain = Date.now();
						const result = await withTimeout(
							callLLMChain(VOICE_SYSTEM, VOICE_USER, [], "high"),
							4000,
						);
						const chainDraft = result?.text
							? parseVoiceDraft(
									result.text,
									VALID_CATEGORIES,
									VALID_PRIORITIES,
								)
							: null;
						if (chainDraft) {
							recordAiCall("assist.voice_complaint", { ok: true, latencyMs: Date.now() - tChain, lane: "chain" });
							draft = chainDraft;
							engine = `${result.provider}:${result.model}`;
						}
					}
				}
			} catch {
				/* keep the guaranteed local draft */
			}
			if (draft) {
				if (engine === "local") {
					if (tFast) recordAiCall("assist.voice_complaint", { ok: false, latencyMs: Date.now() - tFast, lane: "nvidia-fast" });
					if (tChain) recordAiCall("assist.voice_complaint", { ok: false, latencyMs: Date.now() - tChain, lane: "chain" });
				}
				const body = { engine, draft };
				// Only AI wins are cached — the instant local draft is
				// microseconds to rebuild and must never go stale.
				if (engine !== "local") suggestCacheSet("voice_complaint", input, body);
				return res.status(200).json(body);
			}
			return res.status(200).json({ engine: "none", draft: null });
		}

		// ---- AI chat reply (admin side) ----
		if (task === "chat_reply") {
			let tChain = 0;
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			// Rate limit: max 20 chat replies per admin per 5 minutes
			if (
				await rateLimited(
					"assist_chat",
					req.headers["x-admin-token"] || "anon",
					300,
					20,
				)
			) {
				return rateLimitResponse(
					res,
					300,
					"Too many requests — please wait a moment.",
				);
			}
			const history = (messages || [])
				.slice(-8)
				.map(
					(m) =>
						`${m.sender === "admin" ? "Admin" : "Student"}: ${String(m.body || "").slice(0, 300)}`,
				)
				.join("\n");
			// All replies come from the LLM — no keyword fallback; 15s timeout for longer conversations
			try {
				tChain = Date.now();
				const result = await withTimeout(
					callLLMChain(
						"You are a kind, professional school admin replying to an anonymous student in a support chat. Keep replies short (1-3 sentences), warm, and actionable. Never ask for personal details.",
						`Conversation:\n${history}\n\nReply directly to the student.`,
						[],
						"high",
					),
					15000,
				);
				if (result?.text && result.text.length > 10) {
					recordAiCall("assist.chat_reply", { ok: true, latencyMs: Date.now() - tChain, lane: "chain" });
					return res
						.status(200)
						.json({
							engine: `${result.provider}:${result.model}`,
							reply: result.text.trim(),
						});
				}
			} catch {
				/* fall through */
			}
			// If LLM fails, return no reply rather than a fake one
			if (tChain) recordAiCall("assist.chat_reply", { ok: false, latencyMs: Date.now() - tChain, lane: "chain" });
			return res.status(200).json({ engine: "none", reply: null });
		}

		return res.status(400).json({ error: "Unknown task" });
	} catch (err) {
		return sanitizeError(res, err, "assist");
	}
}
