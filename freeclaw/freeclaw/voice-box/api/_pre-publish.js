// AI Pre-Publish Agent — advisory content gate for user submissions.
// Every complaint, suggestion, poll, comment, and reply can use this BEFORE
// publishing; /api/posts remains the authoritative deterministic safety gate.
// Uses NVIDIA Nemotron 3 Ultra 550B for real AI content moderation.
//
// POST /api/pre-publish
//   { content_type: 'post'|'comment'|'poll', title?, description?, body?, category?, options?, author_id }
//
// Returns:
//   { decision: 'safe'|'revision'|'high_risk', risk_score, checks, analysis, ... }

import {
	auditLog,
	clean,
	cors,
	rateLimited,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { maskPII } from "./_moderation.js";
import { callLLMChain, callNvidiaFast, callPublicFrontierLLM } from "./_providers.js";
import { contextualModeration } from "./_context-moderation.js";
import { evaluateContentDeep } from "./_safety-pipeline.js";

function parseJsonSafe(text) {
	if (!text || typeof text !== "string") return null;
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[0]);
		} catch {}
	}
	return null;
}

// ─── Pre-publish verdict cache ────────────────────────────────────
// The live review panel and the publish gate often submit the same text within
// seconds of each other. Re-running three provider lanes for an identical
// string is pure latency; caching the parsed verdict for a short window makes
// the second call instant and guarantees the panel and the gate agree.
const LLM_CACHE_TTL_MS = 90_000;
const LLM_CACHE_MAX = 400;
const llmCache = new Map();

function cacheGet(key) {
	const hit = llmCache.get(key);
	if (!hit) return undefined;
	if (Date.now() - hit.at > LLM_CACHE_TTL_MS) {
		llmCache.delete(key);
		return undefined;
	}
	// Refresh LRU position.
	llmCache.delete(key);
	llmCache.set(key, hit);
	return hit.value;
}

function cacheSet(key, value) {
	if (!key || !value) return;
	llmCache.set(key, { at: Date.now(), value });
	while (llmCache.size > LLM_CACHE_MAX) {
		const oldest = llmCache.keys().next().value;
		llmCache.delete(oldest);
	}
}

async function callNvidiaLLM(systemPrompt, userPrompt, maxTokens = 2000) {
	// ── Outbound PII redaction (defense-in-depth) ────────────────────────
	// The moderation model must never receive raw phone/email/address, but it
	// must still be able to flag PII. maskPII swaps the values for placeholders
	// (preserving sentence structure), and when anything was redacted we append
	// a note telling the model to score it as PII. The deterministic
	// emergencyRegex() gate below runs on the ORIGINAL text and floors the risk
	// at 80, so this masking can never weaken the block.
	const maskedPrompt = maskPII(userPrompt);
	const piiFound = maskedPrompt !== userPrompt;
	const safeUserPrompt = piiFound
		? `${maskedPrompt}\n\n[SYSTEM NOTE: [EMAIL], [PHONE], [ADDRESS], and [PINCODE] placeholders above replace personal information found in this submission. Flag it: set personal_info_detected: true, risk_score: 80, decision: "high_risk", and list it in privacy_issues.]`
		: maskedPrompt;

	const cacheKey = `${systemPrompt.length}:${safeUserPrompt}`;
	const cached = cacheGet(cacheKey);
	if (cached) return cached;

	// Lane 1: Fast Hedged Lane (sub-second NVIDIA Nemotron + Groq)
	try {
		const res = await callNvidiaFast(systemPrompt, safeUserPrompt, 6000);
		const parsed = parseJsonSafe(res?.text);
		if (parsed) {
			cacheSet(cacheKey, parsed);
			return parsed;
		}
	} catch (err) {
		console.warn("Pre-publish AI fast lane failed:", err?.message);
	}

	// Lane 2: Full Provider Chain
	try {
		const res = await callLLMChain(systemPrompt, safeUserPrompt, [], "high");
		const parsed = parseJsonSafe(res?.text);
		if (parsed) {
			cacheSet(cacheKey, parsed);
			return parsed;
		}
	} catch (err) {
		console.warn("Pre-publish AI chain failed:", err?.message);
	}

	try {
		const res = await callPublicFrontierLLM(
			[
				{ role: "system", content: systemPrompt },
				{ role: "user", content: safeUserPrompt },
			],
			6000,
		);
		const parsed = parseJsonSafe(res?.text);
		if (parsed) {
			cacheSet(cacheKey, parsed);
			return parsed;
		}
	} catch (err) {
		console.warn("Pre-publish AI public frontier failed:", err?.message);
	}

	return null;
}

// ─── AI Content Moderation Prompt ────────────────────────────────
const MODERATION_SYSTEM_PROMPT = `You are a school content moderation AI. Analyze user-submitted content for a school complaint platform.

CRITICAL RULE — DISTINGUISH REPORTING FROM DOING:
The user is SUBMITTING A COMPLAINT or REPORT about something that happened. They are DESCRIBING a problem, not COMMITTING it.

REPORTS ARE SAFE (the user is describing what someone else did):
- "Student uses profanity and abusive language toward staff" → REPORT. SAFE.
- "Teacher calls students names like idiot and loser" → REPORT. SAFE.
- "Someone said the n-word in class" → REPORT. SAFE.
- "A kid told me to kill myself" → REPORT (user is victim). SAFE.
- "Students are using homophobic slurs" → REPORT. SAFE.
- "There is bullying and name-calling in the hallway" → REPORT. SAFE.
- "A student made racist comments" → REPORT. SAFE.
- "Someone threatened me with a knife" → REPORT (user is victim). SAFE.
- "Teacher shouts and screams at students" → REPORT. SAFE.
- "The canteen food is terrible and disgusting" → OPINION about food. SAFE.
- "This school is garbage" → OPINION. SAFE.
- "No cap, the bus is always late" → CASUAL SPEECH. SAFE.
- "Bruh, the wifi sucks" → CASUAL SPEECH. SAFE.
- "The test was mid" → SLANG/OPINION. SAFE.
- "That teacher is lowkey scary" → SLANG/OPINION. SAFE.
- "The principal is sus" → SLANG/OPINION. SAFE.

ACTUAL VIOLATIONS (the POST AUTHOR is doing it):
- "i will not leave you [name]" / "tujhe chhodunga nahi" / "dekh lunga" / "watch your back" / "you will pay" → INTIMIDATION / TARGETED THREAT / HARASSMENT. UNSAFE (risk 90+, decision: "high_risk", threats_detected: true, bullying_detected: true).
- Targeting named students with personal menace, stalking, obsession, or warnings ("i will not leave you priya", "watch your back", "i know where you live") → TARGETED HARASSMENT / THREAT. UNSAFE.
- "You are an idiot and everyone hates you" → DIRECT ABUSE. UNSAFE.
- "I will kill you" → DIRECT THREAT. UNSAFE.
- "Shut up you loser" → DIRECT ABUSE. UNSAFE.
- "You're so stupid, nobody likes you" → DIRECT ABUSE. UNSAFE.
- "Kill yourself kys" → DIRECT THREAT. UNSAFE.
- "My phone number is 555-1234567" → PII. UNSAFE.
- "Buy my merch at coolstuff.com" → SPAM. UNSAFE.
- "I'll post your nudes" → BLACKMAIL/EXPLICIT. UNSAFE.
- "All [racial group] are terrible" → HATE SPEECH. UNSAFE.
- "I want to kill myself, I'm going to end it" → FIRST-PERSON SELF-HARM. UNSAFE (hold for review — never publish a suicidal crisis post unreviewed).

VEILED / IMPLIED INTIMIDATION (second-person, future-oriented, no stated act):
- "Enjoy it while it lasts." / "You seem pretty comfortable with the way things are right now. I wonder if you'll feel the same way a little later." → MAY imply intimidation. It does NOT establish a threat on its own. Do not call it a threat, do not set threats_detected, do not use "high_risk". Set risk_score 40, decision "revision", and put an entry in safety_issues whose wording says the wording MAY imply intimidation but does not establish a threat on its own, so a human can read the surrounding thread.
- Same for "we'll see what happens", "sooner than you think", "when you least expect it", "wait and see who laughs", "hope you sleep well" used as a closing line toward a person.
- ONE weak marker ("we'll see", "a little later", "I wonder if you'll…") is ordinary conversation → SAFE, risk 0. Only flag when several such markers stack, or one unmistakable one appears.
- If the author is quoting or describing someone else ("he said he'd make me regret it") → REPORT, SAFE, risk 0.

SLANG THAT IS NOT ABUSE (when used as opinions or casual speech):
- "no cap" = no lie/truth → SAFE
- "bruh" = informal exclamation → SAFE
- "sus" = suspicious → SAFE
- "mid" = mediocre/average → SAFE
- "slay" = do well/amazing → SAFE
- "bet" = okay/agreed → SAFE
- "lowkey/highkey" = somewhat/very → SAFE
- "vibe" = feeling/atmosphere → SAFE
- "ghosting" = ignoring someone → SAFE (when describing behavior)
- "simp" = someone who tries too hard → SAFE (when describing)
- "Karen" = entitled person → SAFE (when describing)
- "NPC" = basic/unoriginal person → SAFE (when describing)
- "touch grass" = go outside → SAFE
- "rent free" = can't stop thinking → SAFE
- "main character" = self-centered → SAFE (when describing)
- "ick" = turn off → SAFE
- "delulu" = delusional → SAFE (when describing)
- "cringe" = embarrassing → SAFE
- "based" = good/authentic → SAFE
- "W/L" = win/loss → SAFE
- "ratio" = more likes on reply → SAFE
- "cope" = dealing with something → SAFE
- "seethe" = be angry → SAFE
- "mald" = very angry → SAFE
- "rekt" = destroyed → SAFE
- "big yikes" = very embarrassing → SAFE
- "oof" = expression of discomfort → SAFE
- "fam" = friends → SAFE
- "yeet" = throw → SAFE
- "tea" = gossip → SAFE
- "shade" = disrespect → SAFE (when describing)
- "read" = criticize → SAFE (when describing)
- "yas queen" = enthusiastic support → SAFE
- "green flag/red flag" = good/bad signs → SAFE
- "ick" = turn off → SAFE
- "breadcrumbing" = leading someone on → SAFE (when describing)
- "gaslighting" = manipulating reality → SAFE (when describing)
- "love bombing" = overwhelming affection → SAFE (when describing)
- "situationship" = undefined relationship → SAFE
- "rizz" = charisma → SAFE
- "sigma" = lone wolf → SAFE
- "alpha" = dominant → SAFE
- "normie" = normal person → SAFE
- "chad" = successful person → SAFE
- "clout" = influence → SAFE
- "stan" = obsessive fan → SAFE
- "salty" = upset → SAFE
- "thot" = promiscuous person → SAFE (when describing)
- "slut" = promiscuous person → SAFE (when describing)
- "whore" = promiscuous person → SAFE (when describing)

RULE: Only flag content that ACTUALLY CONTAINS threats, abuse, hate speech, PII, or spam IN THE POST ITSELF. Do NOT flag posts that are REPORTING or DESCRIBING such behavior by others. Do NOT flag casual slang, opinions, or informal speech.

Return ONLY this JSON (no other text, no markdown fences):
{
  "risk_score": 0-100,
  "personal_info_detected": true/false,
  "threats_detected": true/false,
  "bullying_detected": true/false,
  "hate_speech_detected": true/false,
  "doxxing_detected": true/false,
  "blackmail_detected": true/false,
  "explicit_detected": true/false,
  "self_harm_detected": true/false,
  "spam_detected": true/false,
  "privacy_issues": ["specific issues found"],
  "safety_issues": ["specific issues found"],
  "spam_issues": ["specific issues found"],
  "quality_issues": ["specific issues found"],
  "summary": "one sentence summary",
  "suggested_category": "Academics|Facilities|Canteen|Transport|Discipline|Sports|IT|Administration|Events",
  "suggested_priority": "low|medium|high|critical",
  "decision": "safe|revision|high_risk",
  "reason": "brief explanation"
}

SCORING RULES:
- Clean legitimate complaint/report → risk = 0, decision = "safe"
- Phone/email/address/name/student ID found in POST → risk >= 50, personal_info_detected = true
- POST AUTHOR makes threats/violence → risk >= 80, threats_detected = true, decision = "high_risk"
- POST AUTHOR bullies/harasses → risk >= 65, bullying_detected = true, decision = "high_risk"
- POST AUTHOR uses hate speech/slurs → risk >= 80, hate_speech_detected = true, decision = "high_risk"
- Doxxing someone's personal info → risk >= 80, doxxing_detected = true, decision = "high_risk"
- POST AUTHOR blackmails → risk >= 75, blackmail_detected = true, decision = "high_risk"
- Explicit/sexual content in POST → risk >= 70, explicit_detected = true, decision = "high_risk"
- POST AUTHOR expresses first-person self-harm/suicidal intent → risk >= 75, self_harm_detected = true, decision = "high_risk" (reports like "a kid told me to kill myself" stay SAFE with risk 0)
- Spam in POST → risk >= 45, spam_detected = true, decision = "revision"
- Gibberish/too short → risk >= 25, decision = "revision"
- Veiled/implied intimidation (see above) → risk = 40, decision = "revision", threats_detected = false, high_risk is WRONG here. Say the wording MAY imply intimidation but does not establish a threat on its own.

REPORTING is not a violation. A post saying "someone bullied me" or "a student uses profanity" is a REPORT and should be marked SAFE. Slang like "no cap", "bruh", "sus", "mid", "slay" is NOT abuse.`;

// ─── DB Spam Check (2.5s timeout) ───────────────────────────────
// Anonymous authors have no history to compare against, so the two round
// trips are pure latency. Short-circuit them: the integrity checks that still
// matter for anonymous traffic are all local (length, duplication in text).
async function checkSpamDB(text, authorId) {
	if (!authorId || authorId === "anonymous") return { pass: true, issues: [] };
	return Promise.race([
		(async () => {
			const issues = [];
			const tenMinAgo = new Date(Date.now() - 600000).toISOString();
			const { count } = await supabase
				.from("posts")
				.select("id", { count: "exact", head: true })
				.eq("author_id", authorId)
				.gte("created_at", tenMinAgo);
			if (count && count > 5)
				issues.push(`Flooding: ${count} posts in last 10 minutes`);

			const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
			const { data: recentPosts } = await supabase
				.from("posts")
				.select("title,description")
				.eq("author_id", authorId)
				.gte("created_at", oneHourAgo)
				.limit(10);
			if (recentPosts?.length) {
				const words = text
					.toLowerCase()
					.split(/\s+/)
					.filter((w) => w.length > 3);
				for (const rp of recentPosts) {
					const existing =
						`${rp.title || ""} ${rp.description || ""}`.toLowerCase();
					const overlap = words.filter((w) => existing.includes(w)).length;
					const similarity = words.length > 0 ? overlap / words.length : 0;
					if (similarity > 0.7) {
						issues.push(
							"Duplicate: very similar post from you in the last hour",
						);
						break;
					}
				}
			}
			return { pass: issues.length === 0, issues };
		})(),
		new Promise((resolve) =>
			setTimeout(() => resolve({ pass: true, issues: [] }), 2500),
		),
	]);
}

// ─── Duplicate Detection (2.5s timeout) ───────────────────────────
async function detectDuplicates(title, description) {
	return Promise.race([
		(async () => {
			const combined = `${title} ${description || ""}`.toLowerCase();
			const words = combined.split(/\s+/).filter((w) => w.length > 3);
			if (words.length < 2) return [];

			const { data: existing } = await supabase
				.from("posts")
				.select("id,title,description,category,status")
				.eq("deleted", false)
				.limit(200);

			const similar = [];
			if (existing?.length) {
				for (const post of existing) {
					const otherWords = `${post.title || ""} ${post.description || ""}`
						.toLowerCase()
						.split(/\s+/)
						.filter((w) => w.length > 3);
					const overlap = words.filter((w) => otherWords.includes(w)).length;
					const similarity =
						words.length > 0 ? Math.round((overlap / words.length) * 100) : 0;
					if (similarity > 50)
						similar.push({
							id: post.id,
							title: post.title,
							category: post.category,
							status: post.status,
							similarity,
						});
				}
			}
			return similar.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
		})(),
		new Promise((resolve) => setTimeout(() => resolve([]), 2500)),
	]);
}

// ─── Veiled / implied intimidation ────────────────────────────────
// Non-explicit wording that does NOT establish a threat on its own but is a
// recognised coercion/grooming pattern: second-person, future-oriented,
// conditional menace with no stated act. The old regexes only caught explicit
// phrasing ("watch your back", "you will pay"), so "Enjoy it while it lasts" +
// "I wonder if you'll feel the same way a little later" scored 0/100 and
// published silently. That is wrong in the other direction: a human should
// decide with the surrounding thread in view.
//
// Design contract:
//   * never auto-blocks — floors the score into the "needs review" band
//   * one STRONG marker or two WEAK markers is enough
//   * describing someone else's behaviour ("he said ...") never flags
//   * a single weak marker ("we'll see", "I wonder if you'll like the canteen")
//     stays silent, so ordinary conversation is untouched
const VEILED_STRONG = [
	/\benjoy\s+it\s+while\s+(?:it|you)\s+(?:lasts?|can)\b/i,
	/\b(?:you'?ll|you\s+will)\s+(?:see|find\s+out|regret)\s+(?:what\s+happens|it|later|soon)\b/i,
	/\bwhen\s+you\s+least\s+expect\s+it\b/i,
	/\bsooner\s+than\s+you\s+think\b/i,
	/\b(?:we'?ll|we\s+will)\s+see\s+(?:about\s+that|what\s+happens|who\s+laughs)\b/i,
	/\bwait\s+and\s+see\s+(?:what|who|how)\b/i,
	/\b(?:you'?ll|you\s+will)\s+pay\s+for\s+(?:this|that)\b/i,
];
const VEILED_WEAK = [
	/\bi\s+wonder\s+if\s+you'?ll\b/i,
	/\bfeel\s+the\s+same\s+way\b/i,
	/\ba\s+(?:little|bit)\s+later\b/i,
	/\b(?:we'?ll|we\s+will)\s+see\b/i,
	/\bjust\s+(?:you\s+)?wait\b/i,
	/\bhope\s+you'?re\s+ready\b/i,
	/\bhope\s+you\s+sleep\s+well\b/i,
	/\bthe\s+way\s+things\s+are\s+right\s+now\b/i,
	/\bthings\s+(?:are\s+going\s+to|will)\s+change\b/i,
	/\b(?:comfortable|safe)\s+right\s+now\b/i,
	/\b(?:you\s+seem|you\s+look)\s+(?:pretty\s+)?comfortable\b/i,
];

/** Deterministic veiled-intimidation signal. Returns matched marker count. */
function veiledIntimidation(text) {
	const t = String(text || "");
	// Quoting / reporting someone else's words is not the author doing it.
	if (/\b(?:he|she|they)\s+(?:said|says|told|tells|wrote|writes|messaged|texted|threatened)\b/i.test(t))
		return { flagged: false, hits: 0 };
	const strong = VEILED_STRONG.filter((re) => re.test(t)).length;
	const weak = VEILED_WEAK.filter((re) => re.test(t)).length;
	return { flagged: strong >= 1 || weak >= 2, hits: strong + weak };
}

export const VEILED_INTIMIDATION_ISSUE =
	"VEILED INTIMIDATION — the wording may imply a threat but does not establish one on its own; held for contextual review.";

/** Public, side-effect-free probe used by the API test suite. */
export function detectVeiledIntimidation(text) {
	return veiledIntimidation(text);
}

// ─── Shared contextual reconciliation ────────────────────────────
// The contextual layer can emit several kinds of flag, and the two call sites
// below (LLM-down and LLM-up) used to duplicate the same list of types and
// both word the hold as "This reads as a report of abuse". That duplication is
// how "Kakuli mam is a horrible teacher" was shown an abuse-report message even
// though nothing in the sentence reports abuse. These helpers are now the ONE
// place that decides what a contextual flag means and what the author is told.

/** Flag types that genuinely describe reported abuse. */
const GENUINE_REPORT_FLAGS = ["threat_report", "reported-abuse"];

/**
 * Review-grade flags: they hold content for a human. They must never on their
 * own force `high_risk` — the score floor for them is the "revision" band.
 */
const REVIEW_HELD_FLAGS = new Set([
	"threat_report",
	"reported-abuse",
	"conduct_weak",
]);

const ABUSE_REPORT_MESSAGE =
	"This reads as a report of abuse — held for a human to review.";
const CONDUCT_REVIEW_MESSAGE =
	"This wording may be hostile, so a moderator must review it first.";

/** Author is describing/relaying someone else's behaviour, not doing it. */
function looksLikeReport(text) {
	return (
		/\b(reports?|reported|complains?|complained|describes?|described|mentions?|mentioned|tells?|told|says?|said|claims?|claimed|witnessed?|saw|noticed?|observed?|experienced?|dealing with|facing|problem with|issue with|incident|occurred|happened|keeps?|always|every day|every time|daily|regularly|habitually|pattern of)\b/i.test(
			text,
		) ||
		/\b(student|teacher|staff|person|someone|they|he|she|bully|bullying|abusive|abuse|profanity|swearing|threats?|threatening|harassment|harassing)\b/i.test(
			text,
		)
	);
}

/**
 * Second-person abuse the author is committing, not reporting: an insult
 * aimed at "you" or a first-person threat aimed at "you".
 *
 * The insult arm keeps the original shape. The threat arm exists because the
 * reporting heuristic is deliberately loose (any mention of "teacher" or
 * "threat" reads as a report), so "I will hurt you, teacher" used to be
 * exempted as a report and slipped past the contextual hold. The deterministic
 * gate still catches it, but the contextual layer must not contradict it.
 */
function looksLikeDirectAbuse(text) {
	if (
		/\b(you\s+are|you're|you\s+will|you\s+should|you\s+deserve)\s+(a\s+)?(idiot|stupid|loser|ugly|fat|disgusting|pathetic|worthless|trash|moron|dumb|terrible|horrible|worst)/i.test(
			text,
		)
	) {
		return true;
	}
	return /\b(?:i(?:'ll| will| am going to|'m going to| gonna)|we(?:'ll| will| are going to))\s+(?:hurt|hit|beat|kill|punch|slap|stab|shoot|find|destroy|end)\s+(?:you|u|ya)\b/i.test(
		text,
	) || /\b(?:watch\s+your\s+back|you(?:'re| are)\s+(?:dead|finished|done for|going to regret))\b/i.test(
		text,
	);
}

/**
 * Turn contextual flags into ONE hold decision.
 *
 * @returns {null | {mode: "private"} | {mode: "review", message: string}}
 *   `null` means "the contextual layer has nothing to add". `private` means the
 *   submission goes straight to the administration, so no moderator queue
 *   applies. `review` means hold for a human — never auto-block.
 */
function reconcileContextual({
	flags,
	visibility = "public",
	isReporting = false,
	isDirectAbuse = false,
}) {
	const types = new Set(
		(Array.isArray(flags) ? flags : [])
			.map((f) => f?.type)
			.filter(Boolean),
	);
	if (!types.size) return null;
	if (visibility === "private") return { mode: "private" };

	const genuine = GENUINE_REPORT_FLAGS.some((t) => types.has(t));
	// Describing someone else's behaviour is a report, not the author's own
	// conduct — the contextual layer adds no hold, even for a genuine report
	// ("a kid told me to kill myself" is a victim speaking, not a threat).
	// The deterministic gate still runs and always wins on direct threats, so
	// this exemption can only ever remove a contextual hold, never a block.
	if (isReporting && !isDirectAbuse) return null;

	return {
		mode: "review",
		message: genuine ? ABUSE_REPORT_MESSAGE : CONDUCT_REVIEW_MESSAGE,
	};
}

/** Normalise an issue string for de-duplication (emoji/prefix/space-insensitive). */
function issueKey(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/^[^a-z0-9]+/, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/** Drop duplicate issue strings while preserving order and first wording. */
function dedupeIssues(list) {
	const seen = new Set();
	const out = [];
	for (const item of Array.isArray(list) ? list : []) {
		const key = issueKey(item);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

// ─── Emergency Regex Fallback (when NVIDIA API is down) ───────────
async function emergencyRegex(text, visibility = "public") {
	const lower = String(text || "")
		.slice(0, 10000)
		.toLowerCase(); // FIX-M4: cap input length to prevent ReDoS
	const safetyIssues = [];
	const privacyIssues = [];
	const qualityIssues = [];
	let riskScore = 0;

	// CRITICAL: Check if this is a REPORT/COMPLAINT about abuse (not actual abuse)
	// If the post is describing someone else's behavior, it's likely a report
	const isReporting = looksLikeReport(text);

	// If it's a report about abuse BY someone else, reduce risk significantly
	// Reports use phrases like "uses profanity", "is abusive", "threatens students"
	const isDescribingOthers =
		/\b(uses?\s+(profanity|abusive|vulgar|offensive|inappropriate|threatening)|is\s+(abusive|bullying|aggressive|hostile|threatening|disruptive)|engages?\s+in|participates?\s+in|directed\s+at\s+(staff|students|teachers|others))\b/i.test(
			text,
		);

	// Only flag if the post ITSELF contains actual abuse directed at someone
	// "you are X" = actual abuse; "student is X" = report about someone else
	const isDirectAbuse = looksLikeDirectAbuse(text);

	// Casual slang that is NOT abuse (when used as opinions)
	const isCasualSlang =
		/\b(no\s*cap|bruh|sus|mid|slay|bet|lowkey|highkey|vibe|ghosting|simp|karen|npc|touch\s*grass|rent\s*free|main\s*character|ick|delulu|cringe|based|w\s*rizz|l\s*rizz|sigma|alpha|beta|normie|chad|clout|stan|salty|tea|shade|yas\s*queen|green\s*flag|red\s*flag|breadcrumbing|gaslighting|love\s*bombing|situationship|rizz|thot|yeet|oof|fam|big\s*yikes|cope|seethe|mald|rekt|kekw|poggers|copium|hopium|doomer)\b/i.test(
			text,
		);

	// PII — always flag regardless of context
	// Strip date-like strings (2026-07-30, 07/30/2026) AND academic-year ranges
	// (2026-2027, 2026-27) BEFORE the loose phone scan so legitimate posts mentioning
	// exam/deadline dates or school years are never flagged as PII.
	const textNoDates = text.replace(
		/\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b|\b(?:19|20)\d{2}\s*[-/]\s*(?:19|20)?\d{2}\b/g,
		" ",
	);
	if (/\+?\d[\d\s\-()]{7,}/.test(textNoDates)) {
		privacyIssues.push("Phone number detected");
		riskScore += 25;
	}
	if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) {
		privacyIssues.push("Email detected");
		riskScore += 25;
	}
	// Address detection — including common misspellings (stree, strret, sreet, howrag, etc.)
	const STREET_TYPES =
		"street|st|strret|sreet|stree|stre|avenue|ave|avnue|avenu|road|rd|roed|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|way|close|gardens|park|heights|colony|nagar|town|city|village|housing|society|sector|phase|block|building|howrag|howrah|bally";

	// Strict whitelist for the "number AFTER street" pattern — only unambiguous
	// street words. Excludes common English words (place, way, park, block, phase,
	// lane, drive, court, close, gardens, heights, sector, housing, society, etc.)
	// that would false-positive on phrases like "first place 5" or "phase 2".
	const STREET_TYPES_AFTER =
		"street|st|stree|strret|sreet|stre|avenue|avenu|avnue|ave|road|rd|roed|boulevard|blvd|ln|dr|ct|pl|colony|nagar|howrag|howrah|bally";
	if (
		new RegExp(
			"\\b\\d{1,5}[\\s,/\\-]*[a-zA-Z\\s]+\\b(?:" + STREET_TYPES_AFTER + ")\\b",
			"i",
		).test(text)
	) {
		privacyIssues.push("Address detected");
		riskScore += 30;
	}
	if (
		new RegExp(
			"\\b[a-zA-Z\\s]+\\b(?:" + STREET_TYPES_AFTER + ")\\s+\\d{1,5}\\b",
			"i",
		).test(text)
	) {
		privacyIssues.push("Address detected (number after street)");
		riskScore += 30;
	}
	// Name + location: NAME lives/stays/resides at/in/on LOCATION (also handles ALL CAPS)
	// Multi-word names ("MAAM KAULI") + digits in location ("STREE 123") — the
	// single-word-only `[A-Z][a-zA-Z]+` used to let "MAAM KAULI LIVES IN STREE 123" through.
	// Uses the STRICT whitelist (STREET_TYPES_AFTER): generic words like park, block, city,
	// town, village, area, place, way, lane, drive, building, phase are excluded so legit
	// sentences ("Students live in hostel block 3", "Kids play in the park") are never
	// hard-blocked. The reported case still matches (stree + howrag are in the strict list).
	if (
		new RegExp(
			"\\b(?:[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,2})\\s+(?:lives?|stays?|resides?|resid|living)\\s+(?:at|in|on|near)\\s+[A-Za-z0-9\\s]+\\b(?:" +
				STREET_TYPES_AFTER +
				")\\b",
			"i",
		).test(text)
	) {
		privacyIssues.push("Personal name with address detected");
		riskScore += 35;
	}

	// Direct threats — only if POST AUTHOR is making threats (not reporting them)
	if (
		/\b(kill yourself|kys|i will find you|i will hurt you|watch your back|shoot|stab|bomb|burn down)\b/i.test(
			text,
		)
	) {
		// Check if this is a report about threats vs actual threats
		const reportingThreats =
			/\b(reported?|says?|said|claims?|claimed|told|describes?|mentioned|witnessed?|saw|heard|threatening|threatens?|used?\s+threats?)\b/i.test(
				text,
			);
		if (!reportingThreats && !isDescribingOthers) {
			safetyIssues.push("DIRECT THREATS");
			riskScore += 60;
		}
	}

	// First-person self-harm — ONLY when the author describes THEIR OWN intent.
	// Victim reports ("a kid told me to kill myself", "my friend said she wants
	// to die") must stay safe: the reporting-word guard mirrors the threats
	// block above and the prompt's pinned example at L118.
	if (
		/\b(kill myself|killing myself|end my (?:life|story)|i want to die|i don'?t want to (?:live|be here|wake up)|take my (?:own )?life|suicid\w*|hurt myself|cut myself)\b/i.test(
			text,
		) &&
		!/\b(told|tells|says?|said|claims?|claimed|mentioned|reports?|reported|describes?|described|witnessed?|saw|heard|kid|friend|student|teacher)\b/i.test(
			text,
		) &&
		!isDescribingOthers &&
		!isReporting
	) {
		safetyIssues.push("SELF-HARM");
		riskScore += 60;
	}

	// Direct abuse — only if POST AUTHOR is being abusive (not reporting)
	if (
		/\b(idiot|loser|ugly|fat|disgusting|pathetic|worthless|trash|moron|dumb|no one likes you|everyone hates you|you suck|shut up)\b/i.test(
			text,
		)
	) {
		if (
			isDirectAbuse ||
			(/\byou\b/i.test(text) && !isReporting && !isCasualSlang)
		) {
			safetyIssues.push("BULLYING LANGUAGE");
			riskScore += 40;
		}
	}

	// Name-based bullying — only if targeting someone directly
	if (
		/\b(is|was)\s+(a\s+)?(bad|ugly|stupid|dumb|annoying|terrible|horrible|disgusting)\s+(girl|boy|student|teacher|person|kid|child)\b/i.test(
			text,
		)
	) {
		// If it's a report ("student is disruptive") or feedback about staff/teachers, it's feedback/reporting
		const isReportAboutOthers =
			/\b(student|teacher|staff|faculty|principal|someone|they|he|she|person)\s+(is|was)\s+(a\s+)?(bad|ugly|stupid|dumb|annoying|terrible|horrible|disgusting)\b/i.test(
				text,
			) ||
			/\b(?:sir|ma'?am|mam|teacher|professor|faculty|staff|principal|instructor)\b/i.test(text);
		if (!isReportAboutOthers && !isReporting) {
			safetyIssues.push("BULLYING: targeting a specific person");
			riskScore += 45;
		}
	}

	// Hate speech — always flag (slurs are never acceptable in a report)
	if (/\b(nigger|faggot|kike|spic|chink|retard|slur)\b/i.test(text)) {
		safetyIssues.push("HATE SPEECH");
		riskScore += 60;
	}

	// Harassment/blackmail/intimidation — only if POST AUTHOR is doing it
	if (
		/\b(?:i\s+will\s+not\s+leave\s+you|will\s+not\s+leave\s+you|wont\s+leave\s+you|won't\s+leave\s+you|not\s+leave\s+you|chhodunga\s+nahi|chodunga\s+nahi|nahi\s+chhodunga|dekh\s+lunga|watch\s+your\s+back|you\s+will\s+pay|you're\s+dead|you\s+are\s+dead|i\s+know\s+where\s+you\s+live|i\s+will\s+get\s+you|meet\s+me\s+after\s+school|see\s+you\s+after\s+school|meet\s+me\s+alone|coming\s+for\s+you|i'll\s+get\s+you|send\s+me\s+money|i'll\s+tell\s+everyone|i'll\s+post\s+your|or\s+else|if\s+you\s+don't)\b/i.test(
			text,
		)
	) {
		safetyIssues.push("HARASSMENT/INTIMIDATION/THREAT");
		riskScore += 75;
	}

	// Veiled / implied intimidation — floors the score into the human-review
	// band. Never high_risk on its own, never 0 either.
	const veiled = veiledIntimidation(text);
	if (veiled.flagged && !isDescribingOthers) {
		safetyIssues.push(VEILED_INTIMIDATION_ISSUE);
		riskScore = Math.max(riskScore, 40);
	}

	// Explicit content — only if POST AUTHOR is sharing it
	if (
		/\b(?:nudes?|naked|porn|pornographic|xxx|onlyfans|only\s*fans|sex\s*tapes?|hookups?|sexy|sugar\s*dadd(?:y|ies)|sugar\s*bab(?:y|ies)|explicit)\b/i.test(
			text,
		) ||
		/\bnaked\s+(?:pics?|photos?|videos?|selfies?|pictures?)\b/i.test(text)
	) {
		safetyIssues.push("EXPLICIT CONTENT");
		riskScore += 50;
	}

	// Quality
	if (text.trim().length < 5) {
		qualityIssues.push("Too short");
		riskScore += 10;
	}

	riskScore = Math.min(100, riskScore);
	// Decision forcing — the score alone under-calls these categories:
	// PII always queues (the AI path floors PII at 80 for the same reason),
	// the severe safety categories are never merely "revision", and any
	// other safety issue floors at revision (never silently "safe").
	let decision = "safe";
	if (visibility === "private") {
		// Private posts are direct to school administration.
		// Only direct severe profanity / hate speech / malice stops them.
		// Contact info (phone/email/address) does NOT block private reports to admin.
		const hasDirectSevereMalice = safetyIssues.some((i) =>
			/HATE|BLACKMAIL|SELF-HARM/.test(i),
		);
		if (hasDirectSevereMalice) {
			decision = "high_risk";
		} else {
			decision = "safe";
			riskScore = 0;
		}
	} else if (
		riskScore >= 70 ||
		privacyIssues.length > 0 ||
		safetyIssues.some((i) =>
			/THREAT|HATE|BLACKMAIL|SELF-HARM/.test(i),
		)
	) {
		decision = "high_risk";
	} else if (riskScore >= 30 || safetyIssues.length > 0) {
		decision = "revision";
	}

	// Unified contextual moderation check
	let ctxMod = null;
	try {
		ctxMod = await contextualModeration(text);
	} catch {}
	const hold = reconcileContextual({
		flags: ctxMod?.flags,
		text,
		visibility,
		isReporting,
		isDirectAbuse,
	});
	if (hold?.mode === "private") {
		// Private reports go straight to the administration — no queue, and no
		// threat wording left over from the keyword scan.
		decision = "safe";
		riskScore = 0;
	} else if (hold?.mode === "review" && decision !== "high_risk") {
		decision = "revision";
		riskScore = Math.max(riskScore, 40);
		safetyIssues.unshift(hold.message);
	}

	return {
		riskScore,
		decision,
		reason: safetyIssues.length
			? safetyIssues.join("; ")
			: privacyIssues.length
				? privacyIssues.join("; ")
				: visibility === "private"
					? "Private report — submitted directly to school administration."
					: "Content passed automated checks",
		checks: {
			privacy: { pass: privacyIssues.length === 0, issues: privacyIssues },
			safety: { pass: safetyIssues.length === 0, issues: safetyIssues },
			spam: { pass: true, issues: [] },
			quality: { pass: qualityIssues.length === 0, issues: qualityIssues },
			duplicates: { count: 0, items: [] },
		},
		personal_info_detected: privacyIssues.length > 0,
		threats_detected: safetyIssues.some((i) => i.includes("THREAT")),
		bullying_detected: safetyIssues.some((i) => i.includes("BULLY")),
		hate_speech_detected: safetyIssues.some((i) => i.includes("HATE")),
		// Name + address in the same post is doxxing (same issue the AI path
		// forces to high_risk) — never a silent "false" anymore.
		doxxing_detected: privacyIssues.some((i) =>
			i.includes("Personal name with address"),
		),
		blackmail_detected: safetyIssues.some((i) => i.includes("BLACKMAIL")),
		explicit_detected: safetyIssues.some((i) => i.includes("EXPLICIT")),
		self_harm_detected: safetyIssues.some((i) => i.includes("SELF-HARM")),
		// Contextual signal only — never high_risk on its own. Consumers must
		// treat this as "a human should look with the thread in view".
		veiled_intimidation_detected: safetyIssues.includes(
			VEILED_INTIMIDATION_ISSUE,
		),
		spam_detected: false,
		suggested_priority:
			riskScore >= 70 ? "critical" : riskScore >= 40 ? "high" : "medium",
		suggested_category: "Other",
		summary: `Safety score: ${100 - riskScore}/100`,
	};
}

// ─── Run Checks (called by handler, must complete within budget) ─
async function runChecks(
	combinedText,
	contentType,
	title,
	description,
	category,
	authorId,
	startTime,
	visibility = "public",
) {
	// ── Call NVIDIA Nemotron + DB checks + contextual scan in parallel ──
	const [aiResult, spamDB, duplicates, ctxMod] = await Promise.all([
		callNvidiaLLM(
			MODERATION_SYSTEM_PROMPT,
			`Analyze this ${contentType}:\n\n"${combinedText}"`,
		),
		checkSpamDB(combinedText, authorId),
		contentType === "post"
			? detectDuplicates(title, description)
			: Promise.resolve([]),
		// Deterministic (~4ms, no network) and independent of the LLM lanes —
		// running it here removes it from the serial critical path.
		contextualModeration(combinedText).catch(() => null),
	]);

	// ── If NVIDIA API failed, use emergency regex ────────────────
	if (!aiResult) {
		console.error("NVIDIA LLM unavailable — using emergency regex fallback");
		const fallback = await emergencyRegex(combinedText, visibility);
		const checks = {
			...fallback.checks,
			spam: { pass: spamDB.pass, issues: spamDB.issues },
			duplicates: { count: duplicates.length, items: duplicates },
		};
		return {
			...fallback,
			// Map the fallback's suggested_priority onto the `priority` field
			// unifiedReview reads. Without this, a veiled-intimidation floor at
			// risk 40 would report priority "medium" (the default) instead of
			// "high" — the score and the priority would disagree on the LLM-down
			// path while agreeing on the LLM-up path.
			priority: fallback.suggested_priority || "medium",
			checks,
			spamDB,
			duplicates,
			contentType,
			authorId,
			startTime,
			llmAnalyzed: false,
		};
	}

	// ── NVIDIA succeeded — use its analysis ─────────────────────
	const allPrivacy = [...(aiResult.privacy_issues || [])];
	if (
		aiResult.personal_info_detected &&
		!allPrivacy.some((i) => /personal|pii|info/i.test(i))
	)
		allPrivacy.push("Personal information detected by AI");

	// ALWAYS run the deterministic regex scan too — the LLM must never
	// "forgive" a clear address/phone/email. Merge regex hits into the
	// AI result and raise the score so a leaked address is never published.
	const regexScan = await emergencyRegex(combinedText, visibility);
	for (const issue of regexScan.checks.privacy.issues || []) {
		if (
			!allPrivacy.some((i) =>
				i.toLowerCase().includes(issue.toLowerCase().split(" ")[0]),
			)
		)
			allPrivacy.push(issue);
	}
	if ((regexScan.checks.privacy.issues || []).length > 0) {
		aiResult.personal_info_detected = true;
		// Floor at 80 so leaked PII ALWAYS lands 'high_risk' (>= 70) and is queued for
		// admin review — the LLM can never downgrade a clear address/phone/email to 'safe'.
		aiResult.risk_score = Math.max(aiResult.risk_score || 0, 80);
	}

	let allSafety = [...(aiResult.safety_issues || [])];
	if (aiResult.threats_detected) allSafety.push("⚠️ THREATS DETECTED");
	if (aiResult.bullying_detected) allSafety.push("⚠️ BULLYING DETECTED");
	if (aiResult.hate_speech_detected) allSafety.push("⚠️ HATE SPEECH DETECTED");
	if (aiResult.doxxing_detected) allSafety.push("⚠️ DOXXING DETECTED");
	if (aiResult.blackmail_detected) allSafety.push("⚠️ BLACKMAIL DETECTED");
	if (aiResult.explicit_detected) allSafety.push("⚠️ EXPLICIT CONTENT DETECTED");
	if (aiResult.self_harm_detected) allSafety.push("⚠️ SELF-HARM DETECTED");

	const allSpam = [...(aiResult.spam_issues || [])];
	if (aiResult.spam_detected) allSpam.push("Spam detected by AI");
	if (!spamDB.pass) allSpam.push(...spamDB.issues);

	const allQuality = [...(aiResult.quality_issues || [])];

	let riskScore = aiResult.risk_score || 0;
	if (!spamDB.pass) riskScore = Math.max(riskScore, 45);

	// Veiled / implied intimidation — deterministic half merged into the AI path.
	// The model frequently scores non-explicit menace as 0 ("no threat stated"),
	// which published it silently. Floor at 40 => "revision" (human review) but
	// NEVER high_risk from this signal alone, and never when the author is
	// quoting/describing someone else. Explicit severe categories keep their own
	// higher floors.
	const veiledDetected = Boolean(regexScan.veiled_intimidation_detected);
	if (veiledDetected) {
		if (!allSafety.includes(VEILED_INTIMIDATION_ISSUE))
			allSafety.push(VEILED_INTIMIDATION_ISSUE);
		const severe =
			aiResult.threats_detected ||
			aiResult.hate_speech_detected ||
			aiResult.doxxing_detected ||
			aiResult.blackmail_detected ||
			aiResult.self_harm_detected ||
			aiResult.explicit_detected;
		if (!severe) riskScore = Math.max(riskScore, 40);
	}
	riskScore = Math.min(100, riskScore);

	let decision = aiResult.decision || "safe";
	if (visibility === "private") {
		// Private posts are direct to administration.
		// Only direct severe profanity / hate speech / blackmail stops them.
		if (aiResult.hate_speech_detected || aiResult.blackmail_detected || aiResult.explicit_detected) {
			decision = "high_risk";
		} else {
			decision = "safe";
			riskScore = 0;
		}
	} else if (
		riskScore >= 70 ||
		aiResult.threats_detected ||
		aiResult.hate_speech_detected ||
		aiResult.doxxing_detected ||
		aiResult.blackmail_detected ||
		aiResult.explicit_detected ||
		aiResult.self_harm_detected
	) {
		// Severity floor: these categories are never below high_risk no matter
		// what decision the LLM returned (the LLM can downgrade, we can't let it).
		decision = "high_risk";
	} else if (riskScore >= 30 || !spamDB.pass || aiResult.bullying_detected) {
		decision = "revision";
	}

	// ── Unified reconciliation with Contextual Content Review ──
	const hold = reconcileContextual({
		flags: ctxMod?.flags,
		text: combinedText,
		visibility,
		isReporting: looksLikeReport(combinedText),
		isDirectAbuse: looksLikeDirectAbuse(combinedText),
	});
	if (hold?.mode === "private") {
		// Private posts go straight to the administration: no moderator queue,
		// and no leftover threat wording from the other checks.
		decision = "safe";
		riskScore = 0;
		allSafety = allSafety.filter((s) => !/abuse|threat/i.test(s));
	} else if (hold?.mode === "review" && decision !== "high_risk") {
		decision = "revision";
		riskScore = Math.max(riskScore, 40);
		allSafety.unshift(hold.message);
	}

	const safetyIssues = dedupeIssues(allSafety);
	const privacyIssues = dedupeIssues(allPrivacy);
	const spamIssues = dedupeIssues(allSpam);
	const qualityIssues = dedupeIssues(allQuality);

	const reason =
		(safetyIssues.length
			? safetyIssues.join("; ")
			: privacyIssues.length
				? privacyIssues.join("; ")
				: visibility === "private"
					? "Private report — submitted directly to school administration."
					: aiResult.reason || "Content passed all checks");

	const checks = {
		privacy: {
			pass: visibility === "private" ? true : privacyIssues.length === 0,
			issues: privacyIssues,
		},
		safety: { pass: safetyIssues.length === 0, issues: safetyIssues },
		spam: { pass: spamIssues.length === 0, issues: spamIssues },
		quality: { pass: qualityIssues.length === 0, issues: qualityIssues },
		duplicates: { count: duplicates.length, items: duplicates },
	};

	return {
		riskScore,
		decision,
		reason,
		checks,
		priority: aiResult.suggested_priority || "medium",
		department: aiResult.suggested_category || category || "Other",
		category: aiResult.suggested_category || category || "Other",
		summary: aiResult.summary || `${contentType} submitted`,
		resolutionTime:
			{
				critical: "1-2 hours",
				high: "4-8 hours",
				medium: "1-3 days",
				low: "3-7 days",
			}[aiResult.suggested_priority || "medium"] || "1-3 days",
		duplicates,
		contentType,
		authorId,
		startTime,
		llmAnalyzed: true,
		title,
		description,
		body: combinedText,
		options: null,
		aiResult,
	};
}

// ══════════════════════════════════════════════════════════════
// UNIFIED REVIEW — ONE verdict for the author
// ══════════════════════════════════════════════════════════════
// Before this, the Submit page ran TWO independent reviews that could
// contradict each other: the live "content review" (the deterministic +
// contextual safety gate) and the "AI review — safe to publish" panel
// (this module's LLM analysis). A post the gate flagged could still be
// painted green by the analysis, because each judge only saw half the
// picture. A creator cannot act on two verdicts that disagree.
//
// `unifiedReview` runs both passes and merges them so the STRICTER one
// wins. Neither judge can downgrade the other:
//   * the safety gate's `blocked` is final (it is the write-path policy);
//   * its flags are merged into the four check buckets;
//   * the risk score is the max of both;
//   * categories that either pass flags force at least "revision".
// The result is the single object both `/api/pre-publish` and the live
// `/api/moderate` preview return, so the preview and the publish gate can
// never disagree.

const GATE_CHECKS = {
	privacy: "privacy",
	privacy_weak: "privacy",
	doxxing: "privacy",
	spam: "spam",
	profanity: "quality",
};

const SEVERITY_SCORE = { none: 0, low: 20, medium: 45, high: 75, critical: 100 };

function gateScore(flags) {
	return (Array.isArray(flags) ? flags : []).reduce(
		(max, f) => {
			// Review-grade flags hold the content; they are not severity signals.
			// Scoring `conduct_weak` at "high" here would escalate ordinary
			// hostility to high_risk, which is the over-blocking we removed from
			// the contextual layer in the first place.
			if (REVIEW_HELD_FLAGS.has(f?.type)) return max;
			return Math.max(max, SEVERITY_SCORE[f?.severity] ?? 0);
		},
		0,
	);
}

export function toClientReview(result) {
	return {
		decision: result.decision,
		risk_score: result.riskScore,
		reason: result.reason,
		checks: result.checks,
		analysis: {
			priority: result.priority,
			department: result.department,
			category: result.category,
			summary: result.summary,
			estimated_resolution_time: result.resolutionTime,
			llm_analyzed: result.llmAnalyzed,
			// Which engines produced this verdict — the UI shows it so
			// "AI reviewed" is a fact, not a guess.
			engines: result.engines,
		},
		// The gate's own verdict, for the client's "the server will reject
		// this" affordance and its flag messages.
		blocked: result.gate?.blocked === true,
		code: result.gate?.code || null,
	};
}

/**
 * Run the safety gate and the LLM analysis, then merge them into one
 * verdict. Never throws: a failed pass degrades to the other pass's
 * answer, and both failing yields the fail-closed "held for review"
 * answer that this module already returns on pipeline errors.
 */
export async function unifiedReview(opts = {}) {
	const {
		text,
		surface = "queued",
		contentType = "post",
		title = "",
		description = "",
		category = "",
		authorId = "anonymous",
		visibility = "public",
	} = opts;
	const startTime = Date.now();
	const combined = String(text || "").slice(0, 12000);

	const [gateOutcome, analysisOutcome] = await Promise.allSettled([
		evaluateContentDeep(combined, surface, null, {
			timeoutMs: 8000,
			taskKey: "review.unified",
		}),
		runChecks(
			combined,
			contentType,
			title,
			description,
			category,
			authorId,
			startTime,
			visibility,
		),
	]);

	const gate =
		gateOutcome.status === "fulfilled" && gateOutcome.value
			? gateOutcome.value
			: null;
	const analysis =
		analysisOutcome.status === "fulfilled" && analysisOutcome.value
			? analysisOutcome.value
			: null;

	if (!gate && !analysis) {
		// Both passes failed. Hold for review — never auto-approve.
		return {
			riskScore: 75,
			decision: "high_risk",
			reason: "Content review unavailable — held for admin review",
			checks: {
				privacy: { pass: false, issues: ["Review unavailable"] },
				safety: { pass: false, issues: ["Review unavailable"] },
				spam: { pass: false, issues: ["Review unavailable"] },
				quality: { pass: false, issues: ["Review unavailable"] },
				duplicates: { count: 0, items: [] },
			},
			priority: "high",
			department: category || "Other",
			category: category || "Other",
			summary: "Review system error — held for review",
			resolutionTime: "4-8 hours",
			duplicates: [],
			contentType,
			authorId,
			startTime,
			llmAnalyzed: false,
			engines: [],
			title,
			description,
			body: combined,
			options: null,
			aiResult: null,
			gate: null,
			gateDecision: {
				blocked: false,
				flags: [],
				action: "UNKNOWN",
				model_used: false,
			},
		};
	}

	const gateFlags = Array.isArray(gate?.flags) ? gate.flags : [];

	// Start from the analysis checks when they exist. An absent check stays
	// absent (a check that never ran is not a pass); when only the gate ran,
	// only the buckets it can actually judge are reported.
	const checks = analysis?.checks
		? { ...analysis.checks }
		: {
				duplicates: { count: 0, items: [] },
			};

	for (const key of ["privacy", "safety", "spam", "quality"]) {
		if (checks[key]) {
			checks[key] = {
				pass: checks[key].pass !== false,
				issues: [...(checks[key].issues || [])],
			};
		}
	}
	const ensure = (key) => {
		if (!checks[key]) checks[key] = { pass: true, issues: [] };
		return checks[key];
	};

	// Merge every gate flag into exactly one bucket, so the same finding can
	// never be counted twice and no finding can be dropped.
	for (const flag of gateFlags) {
		if (analysis?.decision === "safe" && (flag?.type === "threat_report" || flag?.type === "reported-abuse")) {
			continue;
		}
		const bucket = GATE_CHECKS[flag?.type] || "safety";
		const target = ensure(bucket);
		const message = String(flag?.message || flag?.type || "Policy violation");
		if (!target.issues.some((i) => i.toLowerCase() === message.toLowerCase()))
			target.issues.push(message);
		target.pass = false;
	}

	const score = Math.max(
		Number(analysis?.riskScore) || 0,
		gateScore(gateFlags),
		gate?.blocked ? 80 : 0,
	);

	let decision = analysis?.decision || "safe";
	if (gate?.blocked || score >= 70) decision = "high_risk";
	else if (decision !== "high_risk" && (score >= 30 || gateFlags.some((f) => f?.type !== "threat_report" && f?.type !== "reported-abuse")))
		decision = "revision";
	else if (decision !== "high_risk" && decision !== "revision") decision = "safe";

	const gateMessage = gate?.blocked
		? String(gate?.message || gateFlags[0]?.message || "This content breaks the school safety policy.")
		: null;

	const reason =
		gateMessage ||
		analysis?.reason ||
		(!gateFlags.length ? "Content passed all checks" : gateFlags.map((f) => f.message).join("; "));

	const engines = [];
	if (gate) engines.push("safety-gate");
	if (gate?.model_used) engines.push("gate-model");
	if (analysis?.llmAnalyzed) engines.push("analysis-model");

	return {
		riskScore: Math.min(100, score),
		decision,
		reason,
		checks,
		priority: analysis?.priority || "medium",
		department: analysis?.department || category || "Other",
		category: analysis?.category || category || "Other",
		summary: analysis?.summary || reason,
		resolutionTime: analysis?.resolutionTime || "1-3 days",
		duplicates: analysis?.duplicates || [],
		contentType,
		authorId,
		startTime,
		llmAnalyzed: Boolean(analysis?.llmAnalyzed || gate?.model_used),
		engines,
		title,
		description,
		body: combined,
		options: null,
		aiResult: analysis?.aiResult || null,
		gate: gate
			? {
					blocked: gate.blocked === true,
					code: gate.code || null,
					message: gate.message || null,
				}
			: null,
		gateDecision: gate || {
			blocked: false,
			flags: [],
			action: "UNKNOWN",
			model_used: false,
		},
	};
}

// ─── Main Handler ───────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "POST only" });

	const startTime = Date.now();
	const b = req.body || {};

	// Rate limit: max 10 pre-publish checks per 5 minutes per author
	const authorId = b.author_id || "anonymous";
	if (await rateLimited("pre_publish_log", authorId, 300, 10)) {
		return rateLimitResponse(
			res,
			300,
			"Too many submissions — please wait a few minutes.",
		);
	}

	const title = clean(b.title || "", 140);
	const description = clean(b.description || "", 500);
	const body = clean(b.body || "", 500);
	const contentType = b.content_type || "post";
	const category = b.category || "";
	const visibility = b.visibility === "private" ? "private" : "public";
	const options = Array.isArray(b.options)
		? b.options
				.map((o) => clean(o, 60))
				.filter(Boolean)
				.join(", ")
		: "";
	// The image that was going to be published — carried into the review snapshot
	// so admins can SEE the exact post (including screenshot) before deciding.
	const image_url = clean(b.image_url || "", 500);
	// Poll options as an array — threaded into the review item so the snapshot
	// shows the exact choices that would have been published.
	const cleanOptions = Array.isArray(b.options)
		? b.options.map((o) => clean(o, 60)).filter(Boolean)
		: null;

	const combinedText = [title, description, body, options]
		.filter(Boolean)
		.join(" ");
	if (!combinedText.trim()) {
		return res.status(400).json({ error: "No content to analyze" });
	}

	try {
		// ── Overall 10s timeout — must return within budget ───────────
		// ONE review: the safety gate and the LLM analysis merged, stricter wins.
		// `/api/moderate` calls this exact function for the live preview, so the
		// panel the student reads and the check that publishes cannot disagree.
		const result = await Promise.race([
			unifiedReview({
				text: combinedText,
				// Match the surface the write path will apply: polls publish
				// through "direct" (no review queue), posts through "queued".
				surface: contentType === "poll" ? "direct" : "queued",
				contentType,
				title,
				description,
				category,
				authorId,
				visibility,
			}),
			new Promise((resolve) =>
				setTimeout(
					async () =>
						resolve({
							timedOut: true,
							fallback: await emergencyRegex(combinedText, visibility),
						}),
					10000,
				),
			),
		]);

		if (result.timedOut) {
			console.error("pre-publish timed out after 10s — using emergency regex");
			const fb = result.fallback;
			return finish(res, {
				...fb,
				checks: {
					...fb.checks,
					spam: { pass: true, issues: [] },
					duplicates: { count: 0, items: [] },
				},
				contentType,
				authorId,
				startTime,
				llmAnalyzed: false,
				image_url,
				options: cleanOptions,
			});
		}
		return finish(res, { ...result, image_url, options: cleanOptions });
	} catch (err) {
		console.error("pre-publish error:", err);
		// FAIL-CLOSED: content moderation failure = hold for review, never auto-approve.
		return finish(res, {
			riskScore: 75,
			decision: "high_risk",
			reason: "Content moderation system unavailable — held for admin review",
			checks: {
				privacy: { pass: false, issues: ["Moderation unavailable"] },
				safety: { pass: false, issues: ["Moderation unavailable"] },
				spam: { pass: false, issues: ["Moderation unavailable"] },
				quality: { pass: false, issues: ["Moderation unavailable"] },
				duplicates: { count: 0, items: [] },
			},
			priority: "high",
			department: "Other",
			category: "Other",
			summary: "Moderation system error — held for review",
			resolutionTime: "4-8 hours",
			duplicates: [],
			contentType,
			authorId,
			startTime,
			llmAnalyzed: false,
			title,
			description,
			body,
			options: b.options,
			aiResult: null,
			image_url,
		});
	}
}

// ─── Build Final Response + Audit ────────────────────────────────
async function finish(res, opts) {
	const {
		riskScore,
		decision,
		reason,
		checks,
		priority,
		department,
		category,
		summary,
		resolutionTime,
		duplicates,
		contentType,
		authorId,
		startTime,
		llmAnalyzed,
		title: t,
		description: d,
		body: b,
		options: o,
		aiResult,
		image_url: img,
	} = opts;

	let reviewId = null;
	if (decision === "high_risk") {
		// Store with 5s timeout — don't let DB hang the response
		try {
			const reviewItem = {
				content_type: contentType,
				title: t || "[No title]",
				description: d || null,
				body: b || null,
				category: category || "Other",
				options: Array.isArray(o) ? o : null,
				image_url: img || null,
				author_id: authorId,
				checks,
				risk_score: riskScore,
				priority: aiResult?.suggested_priority || priority || "medium",
				department: aiResult?.suggested_category || category || "Other",
				summary: aiResult?.summary || summary || "Content flagged by AI",
				status: "pending",
				created_at: new Date().toISOString(),
			};
			const { data: ins } = await Promise.race([
				supabase
					.from("settings")
					.insert({
						key: `pre_publish_review:${Date.now().toString(36)}`,
						value: reviewItem,
					})
					.select("key")
					.maybeSingle(),
				new Promise((_, rej) =>
					setTimeout(() => rej(new Error("DB timeout")), 5000),
				),
			]);
			reviewId = ins?.key || null;
		} catch (err) {
			console.error("pre-publish review insert failed:", err.message);
		}
	}

	const elapsed = Date.now() - startTime;
	// Audit log with 3s timeout
	try {
		await Promise.race([
			auditLog(
				authorId,
				`pre_publish_${decision}`,
				`${contentType} risk=${riskScore} llm=${llmAnalyzed} ${elapsed}ms${reviewId ? ` review=${reviewId}` : ""}`,
			),
			new Promise((_, rej) =>
				setTimeout(() => rej(new Error("Audit timeout")), 3000),
			),
		]);
	} catch (err) {
		console.error("pre-publish audit log failed:", err.message);
	}

	return res.status(200).json({
		decision,
		risk_score: riskScore,
		reason,
		checks,
		analysis: {
			priority,
			department,
			category,
			summary,
			estimated_resolution_time: resolutionTime,
			llm_analyzed: llmAnalyzed,
		},
		review_id: reviewId,
		elapsed_ms: elapsed,
	});
}
