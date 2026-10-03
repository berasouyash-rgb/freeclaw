// Unified Inbox — AI-powered anonymous messaging with emotional routing & admin handoff
// POST /api/inbox — user sends message → instant AI reply, emotional routing, admin notification
// GET  /api/inbox?threads=1 — admin: all threads with AI summaries and handoff state
// GET  /api/inbox?thread_id=X — messages for a specific thread
// POST /api/inbox { action: 'takeover', thread_id } — admin takes over from AI
// POST /api/inbox { action: 'release', thread_id } — admin releases back to AI
// POST /api/inbox { action: 'transfer_emotional', thread_id } — route to emotional agent

import { isTestArtifact, TEST_THREAD_ID_RE } from "./_artifact-filter.js";
import {
	auditLog,
	checkUser,
	clean,
	clientIp,
	cors,
	isAdmin,
	maskProfanity,
	rateLimited,
	rateLimitResponse,
	verifyCallerIdentity,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { recordAiCall } from "./_ai-health.js";
import { sanitizeError } from "./_error.js";
import { EVENT_TYPES, emitEventAndBridge } from "./_events.js";
import { logger } from "./_observability.js";
import { serverModerate } from "./_moderation.js";
import { mergeSlang } from "./_slang.js";
import { evaluateContentDeep } from "./_safety-pipeline.js";
import { callLLMChain, callNvidiaFast } from "./_providers.js";
import { getNotifyPrefs } from "./_notify-prefs.js";
import { createTask } from "./_workforce.js";
import {
	classifyContextual,
	makeEmotionLexicon,
} from "./_context-classify.js";
import { contextualModeration } from "./_context-moderation.js";

// ─── Agent Definitions ─────────────────────────────────────────
const AGENTS = {
	general: {
		name: "General Assistant",
		system: `You are a friendly, helpful school support assistant for an anonymous feedback platform called Voice Flow. Students can post anonymously about issues they face at school. You respond to chat messages helpfully and empathetically. Keep replies concise (under 80 words). Be warm but professional. You have access to platform data — use it when relevant. Never dismiss concerns. Never ask for personal information.`,
		emoji: "🤖",
	},
	emotional: {
		name: "Emotional Support Agent",
		system: `You are a trained emotional support counselor for students at a school. You respond to students who are experiencing emotional distress, anger, anxiety, sadness, or other difficult emotions. 

CRITICAL RULES:
- Be warm, empathetic, and validating. Never dismiss feelings.
- Use reflective listening: "I hear that you're feeling..."
- Do NOT try to solve the problem immediately — first acknowledge the emotion.
- If there's any mention of self-harm or harm to others, immediately provide crisis resources.
- Suggest speaking to a school counselor or trusted adult.
- Keep replies under 100 words.
- Use a gentle, supportive tone.
- You can check in on the student's wellbeing: "How are you feeling right now?"
- Never say "just calm down" or minimize their experience.`,
		emoji: "💙",
	},
	handoff: {
		name: "Admin Handoff",
		system: `You are transitioning this conversation from AI to a human admin. Acknowledge the handoff warmly and let the student know a real person is now available. Keep it brief and reassuring.`,
		emoji: "👤",
	},
};

// ─── Emotion Detection (LLM-enhanced) ──────────────────────────
	const EMOTION_KEYWORDS = {
	critical: [
		"suicide",
		"kill myself",
		"end my life",
		"self harm",
		"hurt myself",
		"want to die",
		"can't go on",
		"no reason to live",
		"ending it all",
		// Hindi / Bengali transliterations — crisis words must match first
		"marna chahta",
		"marna chahti",
		"jaan de dunga",
		"khud ko nuksan",
		"khudkushi",
		"morte chai",
		"nijeke aghat",
	],
	// Genuine distress only. "hate this", "worst ever" and "unacceptable"
	// used to live here, which made ordinary coursework venting ("I hate this
	// homework") classify as HIGH distress and page an admin. They are
	// complaints, not distress — the contextual classifier scores them as
	// non-targeted anger, which is what they are.
	distress: [
		"furious",
		"enraged",
		"livid",
		"disgusted",
		"outraged",
		"rage",
		"gussa",
		"bahut gussa",
		"nafrat",
		"rag",
		"ragging",
		"khub rag",
	],
	anxious: [
		"scared",
		"terrified",
		"anxious",
		"worried sick",
		"panic",
		"stressed",
		"overwhelmed",
		"nervous",
		"cant breathe",
		"dar lag",
		"ghabrahat",
		"tension",
		"chinta",
		"bhoy",
		"bhoy lagche",
		"osthir",
	],
	sad: [
		"depressed",
		"hopeless",
		"worthless",
		"nobody cares",
		"alone",
		"lonely",
		"cry",
		"tears",
		"broken",
		"udas",
		"dukhi",
		"dukkho",
		"akelapan",
		"eka",
		"mon kharap",
		"kanna",
		"rona aa raha",
	],
	positive: [
		"thank",
		"resolved",
		"solved",
		"happy",
		"great",
		"appreciate",
		"grateful",
		"shukriya",
		"dhanyavad",
		"khush",
		"bhalo",
		"dhonnobad",
	],
};

// Canonical distress levels — the ONLY vocabulary allowed to leave this
// module. The admin inbox (EMOTION_LABELS / EMOTION_COLORS) and the
// dashboard emergency digest understand exactly: critical | high |
// moderate | mild | none. The keyword fast path used to return its own
// category names ("distress", "anxious", "sad", "positive"), which
// rendered as an empty badge, were labelled "LOW" in the admin
// notification stream, and never reached the dashboard's high-distress
// view — while the same message re-classified by the LLM came back as
// "high". Mapping keyword hits into the one vocabulary removes that drift.
const LEVEL_BY_CATEGORY = {
	critical: "critical",
	distress: "high",
	anxious: "moderate",
	sad: "moderate",
	positive: "none",
};
const EMOTION_BY_CATEGORY = {
	critical: "critical_distress",
	distress: "anger",
	anxious: "anxious",
	sad: "sad",
	positive: "positive",
};

// Word-boundary matching, not substring. `lower.includes("rag")` fired on
// "ave-rag-e", "sto-rag-e" and "f-rag-ment", so ordinary homework talk was
// classified as distress and paged admins. The boundary rule now lives in one
// place (_context-classify.makeEmotionLexicon) so a caller cannot drop it.
const EMOTION_LEXICON = makeEmotionLexicon(EMOTION_KEYWORDS, {
	levelByCategory: LEVEL_BY_CATEGORY,
	emotionByCategory: EMOTION_BY_CATEGORY,
});
const { keywordDetect } = EMOTION_LEXICON;

async function classifyEmotion(text) {
	// Delegates to the contextual classifier: the emotion lexicon is now ONE
	// signal among several instead of a short-circuit that returned a
	// severity without ever considering who was addressed, whether the
	// hostility was quoted/reported, or which language it was written in.
	// Only the three fields the UI contract needs are returned here.
	const { level, emotion, agent } = await classifyContextual(text, {
		lexicon: EMOTION_LEXICON,
		taskKey: "inbox.emotion",
	});
	return { level, emotion, agent };
}

// ─── Admin Online Detection ────────────────────────────────────
async function isAdminOnline() {
	try {
		// Check if any admin activity in last 5 minutes
		const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "admin_sessions")
			.maybeSingle();
		const sessions = data?.value?.tokens || [];
		const active = sessions.filter((t) => t.exp > Date.now());
		return active.length > 0;
	} catch {
		return false;
	}
}

// ─── Thread State Management ───────────────────────────────────
async function getThreadState(threadId) {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", `inbox_state:${threadId}`)
		.maybeSingle();
	return (
		data?.value || {
			agent: "general",
			handoff: false,
			emotion_history: [],
			message_count: 0,
		}
	);
}

// FIX #24: Validate thread_id format (prevents injection / garbage keys)
function validThreadId(id) {
	return typeof id === "string" && id.length >= 3 && id.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(id);
}
// FIX #11: Rate limit admin takeover/release/transfer (10 per 60s per IP/token)
const _inboxAdminHits = new Map();
function inboxAdminRateLimited(key, windowMs = 60000, limit = 10) {
	const now = Date.now();
	const e = _inboxAdminHits.get(key);
	if (!e || now - e.start > windowMs) { _inboxAdminHits.set(key, { start: now, count: 1 }); return false; }
	e.count++; return e.count > limit;
}

async function setThreadState(threadId, state) {
	// FIX #8: Add error handling + 1 retry so silent failures don't lose handoff state
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const { error } = await supabase
				.from("settings")
				.upsert(
					{
						key: `inbox_state:${threadId}`,
						value: { ...state, updated_at: new Date().toISOString() },
					},
					{ onConflict: "key" },
				);
			if (error) throw error;
			return;
		} catch (e) {
			console.error(`[inbox] setThreadState failed (attempt ${attempt + 1}):`, e.message);
			if (attempt === 1) throw e;
		}
	}
}

// ─── Global AI-mode switch (admin-controlled) ──────────────────
async function getInboxAiConfig() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "inbox_ai_config")
			.maybeSingle();
		return { enabled: data?.value?.enabled !== false };
	} catch {
		return { enabled: true };
	}
}

// ─── AI Reply Generation ───────────────────────────────────────
// NO templates — every reply comes directly from the external LLM model

// Promise with timeout wrapper
function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error("timeout")), ms),
		),
	]);
}

async function generateReply(message, threadState, emotion, adminOnline) {
	// Admin explicitly took over: AI stays quiet
	if (threadState.handoff) {
		return { reply: null, agent: threadState.agent, handoff: true };
	}

	// AI ALWAYS replies to every message — admin can take over later if needed
	const useEmotional =
		emotion.agent === "emotional" || emotion.level === "critical";
	const agentDef = useEmotional ? AGENTS.emotional : AGENTS.general;

	const historyContext = threadState.recent_messages?.length
		? `\n\nRecent conversation:\n${threadState.recent_messages
				.slice(-5)
				.map((m) => `${m.role}: ${m.content}`)
				.join("\n")}`
		: "";

	const emotionContext = `\n\nEmotion detected: ${emotion.emotion} (${emotion.level})`;
	const crisisNote =
		emotion.level === "critical"
			? "\n\nURGENT: This student may be in crisis. Respond with empathy and provide crisis resources. Keep under 100 words."
			: "";

	try {
		// Lane 1 — direct fast NVIDIA call (free key, live model). Skips the
		// whole chain/DB latency for this single reply.
		const fast = await withTimeout(
			callNvidiaFast(
				agentDef.system + emotionContext + crisisNote + historyContext,
				`A student says: "${message.slice(0, 800)}"\n\nRespond directly to the student.`,
				15000,
			),
			16000,
		).catch(() => null);
		if (fast?.text && fast.text.length > 10) {
			return {
				reply: fast.text.trim(),
				agent: useEmotional ? "emotional" : "general",
				handoff: false,
				escalate: emotion.level === "critical",
				engine: `${fast.provider}:${fast.model}`,
			};
		}
		// Lane 2 — full provider chain (DB keys, other vendors).
		// Capped at 18s so fast(16s)+chain(18s)=34s stays inside the 35s
		// outer AI race and the 45s client budget.
		const result = await withTimeout(
			callLLMChain(
				agentDef.system + emotionContext + crisisNote + historyContext,
				`A student says: "${message.slice(0, 800)}"\n\nRespond directly to the student.`,
				[],
				"high",
			),
			18000,
		);

		if (result?.text && result.text.length > 10) {
			return {
				reply: result.text.trim(),
				agent: useEmotional ? "emotional" : "general",
				handoff: false,
				escalate: emotion.level === "critical",
				engine: `${result.provider}:${result.model}`,
			};
		}
	} catch (e) {
		console.error("[inbox] LLM call failed:", e.message);
	}

	// Graceful offline fallback — give the student a helpful message instead of silence
	const offlineReply = useEmotional
		? "I'm having trouble connecting right now, but I want you to know your feelings matter. A team member will be with you soon. 💙"
		: "I'm experiencing a brief connection issue. Your message has been saved and I'll respond shortly. Thank you for your patience. 🤖";
	return {
		reply: offlineReply,
		agent: useEmotional ? "emotional" : "general",
		handoff: false,
		escalate: emotion.level === "critical",
		engine: "offline",
	};
}

// ─── Instant problem triage (no LLM — runs in ~ms, before the AI reply) ───
// When someone tells the inbox "I have this problem", the inbox files a REAL
// report immediately instead of burying it in chat. Emergency → the admin is
// pinged at once and the report jumps to the top of the moderation queue.
// Private/personal → the report is tagged private and NEVER becomes a public
// post. Only genuine problem reports are filed — plain chit-chat is ignored.
const TRIAGE_EMERGENCY = [
	/suicid/, /kill (myself|me)\b/, /self.?harm/, /\bhurt(ing)? (myself|me)\b/,
	/want to die/, /end (my life|it all)/, /can't go on/, /can ?not go on/,
	/no reason to live/, /bully|bullied|bullying/, /ragging/, /harass/,
	/threat/, /stalk/, /molest/, /leak/,
	/hacked/, /\bemergency\b/, /\burgent\b/, /someone (is |was )?hurt/,
	/bleeding/, /\bfire\b/, /kidnap/, /beating (me|us|him|her)/,
	/hit (me|us|him|her)/, /acid/,
	// Named-person coercion reports ("Rahul is blackmailing me") — victims
	// name the perpetrator; missing this meant blackmail never paged anyone.
	/blackmail/, /extort/,
];
const TRIAGE_PRIVATE = [
	/\bprivate\b/, /personal/, /don't (share|tell|post)/, /do not (share|tell|post)/,
	/dont (share|tell|post)/, /keep (this |it )?secret/, /confidential/,
	// Fear/distress words keep the report private even when the facts alone
	// would not ("I'm scared to walk home" must never become a public post).
	/scared/, /afraid/, /\btense\b/,
	/\bfamily\b/, /medical/, /doctor/, /periods?/, /pregnan/, /abuse[sd]? (at home|by)/,
	/my (parents?|dad|mom|mother|father|brother|sister)/, /embarrass/,
	/girlfriend/, /boyfriend/, /crush/, /love (him|her|you)/,
];
const TRIAGE_PROBLEM = [
	/i have (a|this|an|some) problem/, /i am facing/, /\bproblem\b/, /\bissue\b/,
	/not working/, /doesn.?t work/, /does not work/, /broken/, /complain/,
	/unfair/, /favour/, /\bfavor\b/, /cheat/, /dirty/, /no water/, /smell/,
	/stink/, /late/, /rude/, /shout/, /beat/, /scared of/, /afraid of/,
	/plumbing/, /leak/, /mosquito/, /stray dogs?/, /eve.?teas/, /mock/,
];
function triageInboxMessage(text) {
	const t = String(text || "").toLowerCase();
	const emergency = TRIAGE_EMERGENCY.some((re) => re.test(t));
	const isPrivate = emergency || TRIAGE_PRIVATE.some((re) => re.test(t));
	const isProblem = emergency || TRIAGE_PROBLEM.some((re) => re.test(t));
	return { isProblem, isPrivate, urgency: emergency ? "urgent" : isProblem ? "normal" : "none" };
}

// ─── Contextual triage upgrade (deterministic, ~ms — no LLM) ───
// `triageInboxMessage` above is regex-FIRST: it fires only when a hardcoded
// word appears. "Rahul, I hate you" and "don't come to school tomorrow"
// match nothing, so a targeted threat filed no report and paged nobody —
// the exact "inbox does not flag high-priority problems" failure.
//
// This runs the SAME deterministic contextual scan the comment/post write
// paths use (`useModel: false`: no provider, no network, measured ~0-14ms)
// and can only ESCALATE the regex verdict, never downgrade it:
//   - high/critical safety flags (threat, bullying, violence, coercion,
//     hate_speech, explicit) → urgent + problem + private. Private because
//     a targeted-abuse report must never be eligible to become a public post.
//   - threat_report ALONE (quoted/reported abuse — a victim telling us what
//     someone said, e.g. "Rahul said 'I hate you' yesterday") → problem +
//     private, urgency untouched. It is filed for a human, not paged like an
//     in-progress attack — the same reported-vs-direct distinction the safety
//     pipeline enforces on writes.
//   - privacy alone (doxxing/personal-data without hostility) → problem +
//     private, no page.
//   - anything else, including a classifier failure → verdict unchanged.
// The regex lists stay as ONE signal (notably the self-harm floor); they are
// no longer the whole decision.
export async function contextualTriageUpgrade(text, triage) {
	const base =
		triage && typeof triage === "object"
			? { ...triage }
			: { isProblem: false, isPrivate: false, urgency: "none" };
	if (base.urgency === "urgent") return base;
	let extra;
	try {
		extra = await contextualModeration(text);
	} catch {
		// A contextual failure must NEVER be read as "clean", and must never
		// break the reply path. The regex verdict stands exactly as before.
		return base;
	}
	const types = (extra?.flags || [])
		.map((f) => f && f.type)
		.filter(Boolean);
	if (!types.length) return base;
	if (types.length === 1 && types[0] === "threat_report") {
		return { ...base, isProblem: true, isPrivate: true };
	}
	if (
		types.some((t) =>
			["threat", "bullying", "violence", "coercion", "hate_speech", "explicit"].includes(t),
		)
	) {
		return { ...base, isProblem: true, isPrivate: true, urgency: "urgent" };
	}
	if (types.includes("privacy")) {
		return { ...base, isProblem: true, isPrivate: true };
	}
	return base;
}
/** File the triage finding as a real report row (never strikes anyone —
 *  target_type "inbox" resolves to no author, so enforceStrike can't fire). */
export { triageInboxMessage, fileInboxReport, classifyEmotion, generateReply, summarizeThread, isSummaryStale, postIntent, sanitizeDraft, EMOTION_LEXICON };
async function fileInboxReport({ threadId, body, triage }) {
	const since = new Date(Date.now() - 3600000).toISOString();
	const { data: existing } = await supabase
		.from("reports")
		.select("id")
		.eq("target_type", "inbox")
		.eq("target_id", threadId)
		.eq("status", "open")
		.gte("created_at", since)
		.limit(1)
		.maybeSingle();
	if (existing) return { report: existing, deduped: true };
	const tag =
		triage.urgency === "urgent" ? "[INBOX-URGENT]" : triage.isPrivate ? "[INBOX-PRIVATE]" : "[INBOX]";
	const reason = `${tag} ${body.slice(0, 240)}`.slice(0, 300);
	const { data, error } = await supabase
		.from("reports")
		.insert({ target_id: threadId, target_type: "inbox", reason, author_id: threadId, status: "open" })
		.select()
		.single();
	if (error) throw error;
	return { report: data, deduped: false };
}

// ─── Admin Notification ────────────────────────────────────────
async function notifyAdmin(threadId, message, emotion, agent) {
	try {
		const { data: existing } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "notifications:admin")
			.maybeSingle();
		const notifs = existing?.value?.notifications || [];
		const levelLabel =
			emotion.level === "critical"
				? "🔴 CRITICAL"
				: emotion.level === "high"
					? "🟠 HIGH"
					: emotion.level === "moderate"
						? "🟡 MODERATE"
						: ["low", "mild", "none"].includes(emotion.level)
							? "🟢 LOW"
							// An unrecognised level is never silently downgraded to
							// "everything is fine" on a school safety surface.
							: "🟠 HIGH";

		notifs.unshift({
			id: `inbox_${Date.now().toString(36)}`,
			type: emotion.level === "critical" ? "escalation" : "inbox_message",
			title: `${levelLabel}: Student message needs attention`,
			body: `"${message.slice(0, 120)}" — Emotion: ${emotion.emotion}, AI: ${agent}`,
			thread_id: threadId,
			read: false,
			created_at: new Date().toISOString(),
		});
		await supabase
			.from("settings")
			.upsert(
				{
					key: "notifications:admin",
					value: {
						notifications: notifs.slice(0, 50),
						updated_at: new Date().toISOString(),
					},
				},
				{ onConflict: "key" },
			);
	} catch (e) {
		console.error("notifyAdmin error:", e.message);
	}
}

// ─── Post-draft proposals (admin accept/reject popup) ──────────
// When the AI has understood a reportable problem AND the student asked for
// it to be posted (explicit post-intent words — never inferred), or when an
// admin clicks "Draft post", the pipeline drafts a post proposal into thread
// state. The admin popup shows title + description + category + a Private
// toggle with the chat excerpt; Accept creates the post through the REAL
// safety gate (evaluateContentDeep, same pipeline as /api/posts), Reject
// drops it.
// Nothing ever publishes without the admin click.
const POST_INTENT = [
  /\bpost (this|it|that)\b/, /\bpublish( this| it)?\b/, /\bshare (this|it|that)\b/,
  /\bmake .*\bpublic\b/, /\bput .*\bon the board\b/, /\braise (this|it|that) as\b/,
];
const DRAFT_CATEGORIES = [
  "Academics", "Facilities", "Food", "Bullying", "Teachers", "Events",
  "Transport", "Sports", "Technology", "Library", "Hostel", "Security",
  "Cleanliness", "Medical", "Other",
];

function postIntent(text) {
  const t = String(text || "").toLowerCase();
  return POST_INTENT.some((re) => re.test(t));
}

function sanitizeDraft(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const title = String(parsed.title || "").trim().slice(0, 120);
  const description = String(parsed.description || "").trim().slice(0, 500);
  let category = String(parsed.category || "Other").trim();
  if (!DRAFT_CATEGORIES.includes(category)) category = "Other";
  if (title.length < 5 || description.length < 10) return null;
  return { title, description, category, private: parsed.private !== false };
}

async function proposeDraft(threadId, trigger) {
  const state = await getThreadState(threadId);
  if (state?.draft_proposal?.status === "proposed")
    return { proposal: state.draft_proposal, deduped: true };
  const msgs = await getThreadMessages(threadId, 20);
  const convo = msgs.map((m) => `${m.sender}: ${m.body}`).join("\n");
  if (!convo.trim()) return { proposal: null, reason: "empty" };
  // Lane 1 — fast NVIDIA; lane 2 — full chain. Null on failure: the admin
  // sees no popup rather than a fabricated draft.
  const draftSystem = `You draft an anonymous school-feedback post from a support chat. The reporter stays anonymous: replace any reporter name, class/roll identifiers, phone, email, or address with [Redacted] — keep location details needed to fix the issue (building, floor). Understand Hinglish and school slang but write clear formal English. Return ONLY JSON: {"title":"under 120 chars, specific","description":"10-500 chars, factual","category":"one of Academics, Facilities, Food, Bullying, Teachers, Events, Transport, Sports, Technology, Library, Hostel, Security, Cleanliness, Medical, Other","private":true}. Default private to true unless the student plainly asked for public.`;
  const draftUser = `Conversation:\n${convo.slice(0, 1800)}`;
  const fast = await withTimeout(
    callNvidiaFast(draftSystem, draftUser, 12000),
    13000,
  ).catch(() => null);
  const result =
    fast ??
    (await withTimeout(callLLMChain(draftSystem, draftUser, [], "high"), 20000).catch(
      () => null,
    ));
  const proposal = sanitizeDraft(result?.text ? extractJson(result.text) : null);
  if (!proposal) return { proposal: null, reason: "generation_failed" };
  const full = {
    ...proposal,
    status: "proposed",
    trigger: trigger || "manual",
    at: new Date().toISOString(),
  };
  await setThreadState(threadId, { ...state, draft_proposal: full });
  try {
    await auditLog("inbox", "draft_proposed", `Thread ${threadId}: "${proposal.title.slice(0, 60)}" [${trigger || "manual"}]`);
  } catch {
    /* audit is best-effort */
  }
  return { proposal: full, deduped: false };
}

// Owner accept: the student taps Accept in chat. Visibility is FORCED
// private — students can never self-publish public posts; public stays
// admin-only via accept_draft. Identity = thread ownership (same gate
// as message-history reads): banned/suspended callers are refused.
async function acceptOwnDraft(threadId, visibility) {
	const gate = await checkUser(threadId);
	if (!gate.ok) return { ok: false, error: gate.error };
	// The student chooses private or public per post (default private).
	// acceptDraft re-validates: anything but "public" stays private, and
	// public drafts are held for review — never published directly.
	return acceptDraft(threadId, visibility, { owner: true });
}

async function acceptDraft(threadId, visibility, opts) {
  const state = await getThreadState(threadId);
  const proposal = state?.draft_proposal;
  if (!proposal || proposal.status !== "proposed")
    return { ok: false, error: "No open proposal on this thread" };
  const vis = visibility === "public" ? "public" : "private";
  // The REAL gate: the SAME pipeline the posts route runs, not just the same
  // POLICY table. `evaluateContent` (the old call here) was only the
  // synchronous keyword floor — so a draft whose harm lived in context
  // (a named target, a politely-worded threat) passed this accept while the
  // identical text would have been held if the student had submitted it
  // directly. `evaluateContentDeep` adds the deterministic contextual scan
  // AND the model layer, and it SKIPS the model when the floor already
  // blocks, so the common case stays cheap. A provider outage degrades to
  // the deterministic verdict — never to "cleared".
  const decision = await evaluateContentDeep(`${proposal.title} ${proposal.description}`, "queued", null);
  if (decision.blocked) {
    return { ok: false, error: "Draft blocked by safety review", code: decision.code || "CONTENT_BLOCKED" };
  }
  const holdForReview =
    decision.needsReview ||
    decision.flags.some((f) => f.type === "privacy_weak") ||
    vis === "public";
  const now = new Date().toISOString();
  const initialStatus = holdForReview ? "pending_review" : "reported";
  const post = {
    id: `post_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    type: "problem",
    title: maskProfanity(proposal.title),
    description: maskProfanity(proposal.description),
    category: proposal.category,
    visibility: vis,
    priority: "medium",
    tags: [],
    image_url: null,
    author_id: threadId,
    status: initialStatus,
    progress: 0,
    status_history: [
      { status: initialStatus, at: now, note: "Drafted from inbox AI, accepted by admin" },
    ],
  };
  const { data, error } = await supabase.from("posts").insert(post).select().single();
  if (error) throw error;
  await setThreadState(threadId, {
    ...state,
    draft_proposal: { ...proposal, status: "accepted", post_id: data?.id || post.id, at: now },
  });
  try {
    await auditLog("admin", "draft_accepted", `Thread ${threadId} → post ${data?.id || post.id} [${vis}]`);
  } catch {
    /* audit is best-effort */
  }
  return { ok: true, post_id: data?.id || post.id, status: initialStatus };
}

async function rejectDraft(threadId) {
  const state = await getThreadState(threadId);
  const proposal = state?.draft_proposal;
  if (!proposal || proposal.status !== "proposed")
    return { ok: false, error: "No open proposal on this thread" };
  await setThreadState(threadId, {
    ...state,
    draft_proposal: { ...proposal, status: "rejected", at: new Date().toISOString() },
  });
  try {
    await auditLog("admin", "draft_rejected", `Thread ${threadId}: "${String(proposal.title || "").slice(0, 60)}"`);
  } catch {
    /* audit is best-effort */
  }
  return { ok: true };
}

// ─── Agent Operations Center helpers ───────────────────────────
async function getThreadMessages(threadId, limit = 30) {
	const { data } = await supabase
		.from("chat_messages")
		.select("*")
		.eq("thread_id", threadId)
		.order("created_at", "asc")
		.limit(limit);
	return data || [];
}

function extractJson(text) {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) return null;
	try {
		return JSON.parse(m[0]);
	} catch {
		return null;
	}
}

async function triageThread(threadId) {
	const msgs = await getThreadMessages(threadId, 20);
	if (!msgs.length)
		return {
			priority: "low",
			emotion: "neutral",
			topic: "empty",
			suggested_action: "monitor",
		};
	const convo = msgs.map((m) => `${m.sender}: ${m.body}`).join("\n");
	// Lane 1 — fast NVIDIA; lane 2 — full chain. Both fail-safe below.
	const triageSystem = `You are a triage supervisor for a school anonymous-feedback platform. Analyze the conversation and return ONLY a JSON object:
{"priority":"low|medium|high|urgent","emotion":"neutral|frustrated|anxious|sad|angry|positive","topic":"short topic (max 4 words)","suggested_action":"one of: monitor|reply_empathy|reply_info|escalate_human|route_emotional|close"}
Critical/self-harm emotion → escalate_human or route_emotional.`;
	const triageUser = `Conversation:\n${convo.slice(0, 1500)}`;
	const tFastT = Date.now();
	const fastTriage = await withTimeout(
		callNvidiaFast(triageSystem, triageUser, 12000),
		13000,
	).catch(() => null);
	const tChainT = Date.now();
	const result =
		fastTriage ??
		(await withTimeout(
			callLLMChain(triageSystem, triageUser, [], "high"),
			20000,
		).catch(() => null));
	const parsed = result?.text ? extractJson(result.text) : null;
	{
		const triageLane = fastTriage ? "nvidia-fast" : "chain";
		const triageLat = Date.now() - (fastTriage ? tFastT : tChainT);
		recordAiCall("inbox.triage", parsed ? { ok: true, latencyMs: triageLat, lane: triageLane } : { ok: false, latencyMs: triageLat, lane: triageLane });
	}
	// Model output is allowlisted (same discipline as classifyEmotion):
	// a prompt-injected or wild model can never plant arbitrary
	// priority/action strings into thread state and page admins.
	const TRIAGE_PRIORITIES = ["low", "medium", "high", "urgent"];
	const TRIAGE_EMOTIONS = ["neutral", "frustrated", "anxious", "sad", "angry", "positive"];
	const TRIAGE_ACTIONS = ["monitor", "reply_empathy", "reply_info", "escalate_human", "route_emotional", "close"];
	const triage = {
		priority: TRIAGE_PRIORITIES.includes(parsed?.priority) ? parsed.priority : "low",
		emotion: TRIAGE_EMOTIONS.includes(parsed?.emotion) ? parsed.emotion : "neutral",
		topic: typeof parsed?.topic === "string" && parsed.topic.trim() ? parsed.topic.trim().slice(0, 60) : "unknown",
		suggested_action: TRIAGE_ACTIONS.includes(parsed?.suggested_action) ? parsed.suggested_action : "monitor",
	};
	const state = await getThreadState(threadId);
	state.triage = { ...triage, at: new Date().toISOString() };
	await setThreadState(threadId, state);
	return triage;
}

async function draftReplyForThread(threadId) {
	const msgs = await getThreadMessages(threadId, 20);
	if (!msgs.length) return { reply: "" };
	const convo = msgs.map((m) => `${m.sender}: ${m.body}`).join("\n");
	// Lane 1 — fast NVIDIA; lane 2 — full chain. Empty reply on failure
	// (the admin sees nothing rather than a fabricated draft).
	const draftSystem = `You are a school admin drafting a reply to a student on an anonymous feedback platform. Write a concise, warm, professional admin reply (under 90 words). Address the student's actual concern. Return ONLY the reply text — no quotes, no preamble.`;
	const draftUser = `Conversation:\n${convo.slice(0, 1500)}`;
	const tFastD = Date.now();
	const fastDraft = await withTimeout(
		callNvidiaFast(draftSystem, draftUser, 12000),
		13000,
	).catch(() => null);
	const tChainD = Date.now();
	const result =
		fastDraft ??
		(await withTimeout(callLLMChain(draftSystem, draftUser, [], "high"), 20000).catch(
			() => null,
		));
	{
		const draftLane = fastDraft ? "nvidia-fast" : "chain";
		const draftOk = !!result?.text?.trim();
		recordAiCall("inbox.draft", { ok: draftOk, latencyMs: Date.now() - (fastDraft ? tFastD : tChainD), lane: draftLane });
	}
	return { reply: result?.text?.trim() || "" };
}

/** A cached summary is stale when the thread has newer activity than it. */
function isSummaryStale(threadUpdatedAt, summarizedAt) {
	if (!threadUpdatedAt || !summarizedAt) return false;
	return (
		new Date(threadUpdatedAt).getTime() > new Date(summarizedAt).getTime()
	);
}

async function summarizeThread(threadId) {
	const msgs = await getThreadMessages(threadId, 30);
	if (!msgs.length)
		return { summary: "", entities: [], resolution_state: "open" };
	const convo = msgs.map((m) => `${m.sender}: ${m.body}`).join("\n");
	// Lane 1 — fast NVIDIA; lane 2 — full chain. Safe empty default below.
	const sumSystem = `Summarize this support conversation. Return ONLY JSON:
{"summary":"2-3 sentence summary","entities":["key people/places/topics"],"resolution_state":"open|in_progress|resolved"}
Be factual, under 60 words total.`;
	const sumUser = `Conversation:\n${convo.slice(0, 1800)}`;
	const tFastS = Date.now();
	const fastSum = await withTimeout(
		callNvidiaFast(sumSystem, sumUser, 12000),
		13000,
	).catch(() => null);
	const tChainS = Date.now();
	const result =
		fastSum ??
		(await withTimeout(callLLMChain(sumSystem, sumUser, [], "high"), 20000).catch(
			() => null,
		));
	const raw = result?.text
		? extractJson(result.text) || {
				summary: "",
				entities: [],
				resolution_state: "open",
			}
		: { summary: "", entities: [], resolution_state: "open" };
	// Contain model output before it reaches the thread list and the
	// persisted summary row: allowlisted state, capped summary, capped
	// entities (an injected model can neither fake resolution nor
	// bloat the settings row). Mirrors the triage discipline above.
	const SUMMARY_STATES = ["open", "in_progress", "resolved"];
	const out = {
		summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 500) : "",
		entities: Array.isArray(raw.entities)
			? raw.entities.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim().slice(0, 60)).slice(0, 10)
			: [],
		resolution_state: SUMMARY_STATES.includes(raw.resolution_state) ? raw.resolution_state : "open",
	};
	{
		const sumLane = fastSum ? "nvidia-fast" : "chain";
		const sumOk = !!(result?.text && extractJson(result.text));
		recordAiCall("inbox.summary", { ok: sumOk, latencyMs: Date.now() - (fastSum ? tFastS : tChainS), lane: sumLane });
	}
	// Persist non-empty summaries so the thread LIST can show each
	// conversation's topic without re-running the LLM per row.
	if (out.summary) {
		try {
			await supabase.from("settings").upsert(
				{
					key: `inbox_summary:${threadId}`,
					value: { ...out, summarized_at: new Date().toISOString() },
				},
				{ onConflict: "key" },
			);
		} catch {
			/* persistence is best-effort; the live result still reports */
		}
	}
	return out;
}

async function applyBulkAction(ids, action) {
	const results = [];
	for (const tid of ids || []) {
		if (!/^[a-zA-Z0-9_-]{3,40}$/.test(tid)) continue;
		const state = await getThreadState(tid);
		if (action === "close") {
			const { error: closeErr } = await supabase
				.from("chat_threads")
				.update({ status: "closed", updated_at: new Date().toISOString() })
				.eq("thread_id", tid);
			if (closeErr) {
				results.push({ thread_id: tid, ok: false, error: closeErr.message });
				continue;
			}
		} else if (action === "release") {
			state.handoff = false;
			state.agent = "general";
		} else if (action === "takeover") {
			state.handoff = true;
			state.agent = "admin";
		} else if (action === "route_emotional") {
			state.agent = "emotional";
			state.handoff = false;
		} else {
			continue;
		}
		await setThreadState(tid, state);
		results.push({ thread_id: tid, ok: true });
	}
	return { processed: results.filter((r) => r.ok !== false).length, results };
}

async function getInsights() {
	const { data: msgs } = await supabase
		.from("chat_messages")
		.select("body,created_at,sender")
		.order("created_at", "desc")
		.limit(500);
	// Full-site zero-fuzz: exclude test/fuzz message bodies from the admin
	// chat insights aggregate so the trend and topic counts stay clean.
	const rows = (msgs || []).filter((m) => !isTestArtifact(m.body));
	const days = 7;
	const byDay = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(Date.now() - i * 86400000);
		byDay.push({ date: d.toISOString().slice(0, 10), count: 0 });
	}
	for (const m of rows) {
		const key = (m.created_at || "").slice(0, 10);
		const slot = byDay.find((b) => b.date === key);
		if (slot) slot.count++;
	}
	const text = rows
		.map((r) => r.body || "")
		.join(" ")
		.toLowerCase();
	const watch = [
		"pothole",
		"road",
		"bully",
		"mental",
		"teacher",
		"wifi",
		"library",
		"bus",
		"water",
		"grade",
		"food",
		"bathroom",
	];
	const topics = {};
	for (const w of watch) {
		const c = (text.match(new RegExp(w, "g")) || []).length;
		if (c >= 2) topics[w] = c;
	}
	const insights = Object.entries(topics)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([w, c]) => `"${w}" mentioned ${c}× in recent messages`);
	return { trend: byDay, insights, total_recent: rows.length };
}

// ─── HTTP Handler ──────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		// ── GET: admin views all threads ──────────────────────────
		if (req.method === "GET") {
			const { thread_id, threads, insights } = req.query;

			// Global AI-mode state for the admin toggle
			if (req.query.action === "ai_mode") {
				if (!(await isAdmin(req)))
					return res.status(403).json({ error: "Admin only" });
				const cfg = await getInboxAiConfig();
				return res.status(200).json(cfg);
			}

			// Admin: aggregate insights + sentiment trend
			if (insights === "1") {
				if (!(await isAdmin(req)))
					return res.status(403).json({ error: "Admin only" });
				const data = await getInsights();
				return res.status(200).json(data);
			}

			// Admin: list all threads with summaries
			if (threads === "1") {
				if (!(await isAdmin(req)))
					return res.status(403).json({ error: "Admin only" });

				// OPTIMIZED: Get threads first, then only last message per thread
				const { data: dbThreads } = await supabase
					.from("chat_threads")
					.select("*")
					.order("updated_at", { ascending: false })
					.limit(50);

				if (!dbThreads?.length) return res.status(200).json([]);

				// Get inbox states for visible threads only
				const threadIds = dbThreads.map((t) => t.thread_id);
				const states = {};
				const { data: stateRows } = await supabase
					.from("settings")
					.select("key,value")
					.like("key", "inbox_state:%");
				for (const row of stateRows || []) {
					const tid = row.key.replace("inbox_state:", "");
					if (threadIds.includes(tid)) states[tid] = row.value;
				}

				// Cached AI summaries (written by summarizeThread on demand).
				// A summary is stale when the thread has new messages after
				// it — the row shows it greyed with a refresh affordance
				// instead of pretending it is current.
				const summaries = {};
				try {
					const { data: summaryRows } = await supabase
						.from("settings")
						.select("key,value")
						.like("key", "inbox_summary:%");
					for (const row of summaryRows || []) {
						const tid = row.key.replace("inbox_summary:", "");
						if (threadIds.includes(tid) && row.value?.summary)
							summaries[tid] = row.value;
					}
				} catch {
					/* summaries are a bonus; the list works without them */
				}

				// Get last message + unread count for each thread (batch query)
				// NOTE: the fetch limit applies ACROSS all threads, so it must be large
				// enough to contain every thread's latest message — otherwise older
				// (still-open) threads report last_message:'' and unread:0. 5000 covers
				// a school platform's realistic inbox volume.
				const threadMsgCounts = {};
				const threadLastMsg = {};
				const { data: recentMsgs } = await supabase
					.from("chat_messages")
					.select("thread_id,sender,read,body,created_at")
					.in("thread_id", threadIds)
					.order("created_at", { ascending: false })
					.limit(5000);

				// Derived chat titles: each thread's earliest user words (chronological).
				// Computed, never AI-invented — no hallucinated names.
				const titleByThread = {};
				for (let i = (recentMsgs || []).length - 1; i >= 0; i--) {
					const m = recentMsgs[i] || {};
					if (!m.body || !m.thread_id) continue;
					const cur = titleByThread[m.thread_id];
					if (!cur) titleByThread[m.thread_id] = m;
					else if (cur.sender !== "user" && m.sender === "user") titleByThread[m.thread_id] = m.body;
				}
				for (const m of recentMsgs || []) {
					if (!threadMsgCounts[m.thread_id]) {
						threadMsgCounts[m.thread_id] = { total: 0, unread: 0 };
						threadLastMsg[m.thread_id] = m;
					}
					threadMsgCounts[m.thread_id].total++;
					if (m.sender === "user" && !m.read)
						threadMsgCounts[m.thread_id].unread++;
				}

				const enriched = dbThreads.map((th) => {
					const state = states[th.thread_id] || {};
					const counts = threadMsgCounts[th.thread_id] || {
						total: 0,
						unread: 0,
					};
					const cached = summaries[th.thread_id] || null;
					const stale =
						!!cached &&
						isSummaryStale(th.updated_at, cached.summarized_at);
					return {
						...th,
						title: String((titleByThread[th.thread_id] || {}).body || "").slice(0, 60) || "Conversation",
						last_message: threadLastMsg[th.thread_id]?.body || "",
						last_sender: threadLastMsg[th.thread_id]?.sender || "",
						last_at: threadLastMsg[th.thread_id]?.created_at || th.updated_at,
						unread: counts.unread,
						ai_summary: cached
							? { ...cached, stale }
							: null,
						ai_agent: state.agent || "general",
						handoff: state.handoff || false,
						emotion:
							state.emotion_history?.[state.emotion_history.length - 1] || null,
						triage: state.triage || null,
						slang: state.slang_hits || null,
						status: th.status || "open",
						message_count: counts.total,
					};
				});

				// Full-site zero-fuzz: hide QA/fuzz threads (recognizable thread ids or
				// artifact last messages) so the admin inbox queue reads clean. Rows
				// stay intact in the DB; they are only hidden from this listing.
				const visible = enriched.filter(
					(t) =>
						!TEST_THREAD_ID_RE.test(t.thread_id || "") &&
						!isTestArtifact(t.last_message),
				);

				return res.status(200).json(visible);
			}

			// Get messages for a specific thread (limit to last 100 for performance)
			if (thread_id) {
				if (!validThreadId(thread_id)) return res.status(400).json({ error: "Invalid thread_id format" });
				// Gate message-history reads like _chat.js: admins pass; anonymous
				// requesters must present a valid (non-banned) anon id so message
				// history is not readable by anyone who guesses a thread id.
				const readerIsAdmin = await isAdmin(req);
				if (!readerIsAdmin) {
					const gate = await checkUser(thread_id);
					if (!gate.ok) return res.status(403).json({ error: gate.error });
				}
				// Admin console window: admins see the last ADMIN_HISTORY_DAYS
				// of conversation — the recent slice that matters for triage —
				// never the whole archive. Owners reading their own thread are
				// unaffected (full history, same as their device shows).
				const ADMIN_HISTORY_DAYS = 5;
				const adminCutoff = readerIsAdmin
					? new Date(Date.now() - ADMIN_HISTORY_DAYS * 86400000).toISOString()
					: null;
				const limit = Math.min(parseInt(req.query.limit) || 100, 200);
				let msgQuery = supabase
					.from("chat_messages")
					.select("*")
					.eq("thread_id", thread_id)
					.order("created_at", "asc")
					.limit(limit);
				if (adminCutoff) msgQuery = msgQuery.gte("created_at", adminCutoff);
				const [{ data: msgs, error }, { data: thread }] = await Promise.all([
					msgQuery,
					supabase
						.from("chat_threads")
						.select("*")
						.eq("thread_id", thread_id)
						.maybeSingle(),
				]);
				if (error) throw error;

				// Get thread state
				const state = await getThreadState(thread_id);

				// Full-site zero-fuzz: hide test/fuzz message bodies from history too.
				// Rows stay intact in the DB; they are only hidden from the response.
				const visibleMsgs = (msgs || []).filter((m) => !isTestArtifact(m.body));

				return res
					.status(200)
					.json({
						messages: visibleMsgs,
						thread: thread || null,
						title: String((visibleMsgs.find((m) => m.sender === "user" && m.body) || visibleMsgs.find((m) => m.body) || {}).body || "").slice(0, 60) || "Conversation",
						state,
						history_window: readerIsAdmin ? "5d" : "full",
					});
			}

			return res.status(400).json({ error: "Missing thread_id or threads=1" });
		}

		// ── POST: user sends message or admin action ──────────────
		if (req.method === "POST") {
			const b = req.body || {};
			// Honest latency accounting: every user-message 201 below reports
			// how long the server held the request (triage + AI + saves). The
			// 5s budget is measured against this number, not claimed.
			const postStart = Date.now();

			// Admin-only actions that don't need thread_id
			const admin = await isAdmin(req);

			// ── Cleanup test threads (no thread_id needed) ─────────
			if (admin && b.action === "cleanup_threads") {
				const patterns = b.patterns || [
					"test",
					"dbg",
					"e2e",
					"smoke",
					"health-",
					"thread_debug",
					"thread_crit",
					"thread_anx",
					"thread_neu",
					"inbox-test",
					"inbox-e2e",
					"lt_",
					"live_test_",
					"pos-test",
					"crit-test",
					"ai-test",
					"anon_test",
					"stress_chat",
					"fulltest",
				];

				// Get all threads
				const { data: allThreads } = await supabase
					.from("chat_threads")
					.select("thread_id");
				const matchThreads = (allThreads || []).filter((t) =>
					patterns.some((p) =>
						t.thread_id.toLowerCase().includes(p.toLowerCase()),
					),
				);

				if (matchThreads.length === 0) {
					return res
						.status(200)
						.json({
							ok: true,
							deleted: 0,
							message: "No matching threads found",
						});
				}

				let deleted = 0;
				const removedThreadIds = [];
				for (const t of matchThreads) {
					// Delete the thread row FIRST and PROVE it landed. The old
					// order wiped messages, then deleted the thread, then the
					// state row — with no error check on any of them and an
					// unconditional deleted++. A failed thread delete was then
					// reported as "Cleaned up N test threads" while the thread
					// stayed in the inbox, and the already-wiped messages left a
					// live thread with no history. chat_messages has no FK on
					// chat_threads, so the order is safe to change.
					const { data: removed, error: threadErr } = await supabase
						.from("chat_threads")
						.delete()
						.eq("thread_id", t.thread_id)
						.select("thread_id");
					if (threadErr) throw threadErr;
					// 0 rows => someone else already removed it. Not a deletion
					// to report, and not a reason to touch its children.
					if (!removed || removed.length === 0) continue;
					deleted++;
					removedThreadIds.push(t.thread_id);

					const { error: msgErr } = await supabase
						.from("chat_messages")
						.delete()
						.eq("thread_id", t.thread_id);
					if (msgErr) throw msgErr;
					const { error: stateErr } = await supabase
						.from("settings")
						.delete()
						.eq("key", `inbox_state:${t.thread_id}`);
					if (stateErr) throw stateErr;
				}

				if (deleted === 0) {
					return res
						.status(200)
						.json({
							ok: true,
							deleted: 0,
							message: "No matching threads found",
						});
				}

				await auditLog(
					"admin",
					"inbox_cleanup",
					`Cleaned up ${deleted} test threads`,
				);
				return res
					.status(200)
					.json({
						ok: true,
						deleted,
						threads: removedThreadIds,
					});
			}

			// ── Deduplicate messages in a thread ────────────────────
			if (admin && b.action === "dedup_messages") {
				const threadId = clean(b.thread_id, 40);
				if (!threadId)
					return res.status(400).json({ error: "Missing thread_id" });

				// Fetch all messages for this thread
				const { data: allMsgs } = await supabase
					.from("chat_messages")
					.select("id, sender, body, created_at")
					.eq("thread_id", threadId)
					.order("created_at", { ascending: true });

				if (!allMsgs || allMsgs.length === 0) {
					return res
						.status(200)
						.json({ ok: true, removed: 0, message: "No messages found" });
				}

				// Find duplicates: same sender + body + within 2 seconds of each other
				const toDelete = new Set();
				for (let i = 0; i < allMsgs.length; i++) {
					if (toDelete.has(allMsgs[i].id)) continue;
					for (let j = i + 1; j < allMsgs.length; j++) {
						if (toDelete.has(allMsgs[j].id)) continue;
						const timeDiff = Math.abs(
							new Date(allMsgs[i].created_at).getTime() -
								new Date(allMsgs[j].created_at).getTime(),
						);
						if (
							allMsgs[i].sender === allMsgs[j].sender &&
							allMsgs[i].body === allMsgs[j].body &&
							timeDiff < 10000
						) {
							toDelete.add(allMsgs[j].id); // Keep first, delete duplicate
						}
					}
				}

				let removed = 0;
				if (toDelete.size > 0) {
					const ids = [...toDelete];
					// Delete in batches of 100
					for (let k = 0; k < ids.length; k += 100) {
						const batch = ids.slice(k, k + 100);
						const { error: delErr } = await supabase
							.from("chat_messages")
							.delete()
							.in("id", batch);
						if (delErr) throw delErr;
						removed += batch.length;
					}
				}

				await auditLog(
					"admin",
					"inbox_dedup",
					`Deduped ${removed} duplicate messages in ${threadId}`,
				);
				return res
					.status(200)
					.json({ ok: true, removed, total: allMsgs.length });
			}

			// ── Deduplicate ALL threads ────────────────────────────
			if (admin && b.action === "dedup_all") {
				const { data: allThreads } = await supabase
					.from("chat_threads")
					.select("thread_id");
				let totalRemoved = 0;

				for (const t of allThreads || []) {
					const { data: allMsgs } = await supabase
						.from("chat_messages")
						.select("id, sender, body, created_at")
						.eq("thread_id", t.thread_id)
						.order("created_at", { ascending: true });

					if (!allMsgs || allMsgs.length < 2) continue;

					const toDelete = new Set();
					for (let i = 0; i < allMsgs.length; i++) {
						if (toDelete.has(allMsgs[i].id)) continue;
						for (let j = i + 1; j < allMsgs.length; j++) {
							if (toDelete.has(allMsgs[j].id)) continue;
							const timeDiff = Math.abs(
								new Date(allMsgs[i].created_at).getTime() -
									new Date(allMsgs[j].created_at).getTime(),
							);
							if (
								allMsgs[i].sender === allMsgs[j].sender &&
								allMsgs[i].body === allMsgs[j].body &&
								timeDiff < 10000
							) {
								toDelete.add(allMsgs[j].id);
							}
						}
					}

					if (toDelete.size > 0) {
						const ids = [...toDelete];
						for (let k = 0; k < ids.length; k += 100) {
							const batch = ids.slice(k, k + 100);
							const { error: delErr } = await supabase
								.from("chat_messages")
								.delete()
								.in("id", batch);
							if (delErr) throw delErr;
							totalRemoved += batch.length;
						}
					}
				}

				await auditLog(
					"admin",
					"inbox_dedup_all",
					`Deduped ${totalRemoved} duplicate messages across all threads`,
				);
				return res.status(200).json({ ok: true, removed: totalRemoved });
			}

			// Thread-specific actions below
			const threadId = clean(b.thread_id, 40);
			if (!threadId)
				return res.status(400).json({ error: "Missing thread_id" });
			// FIX-M2: validate thread_id format — alphanumeric, hyphens, underscores only, 3-40 chars
			if (!/^[a-zA-Z0-9_-]{3,40}$/.test(threadId))
				return res.status(400).json({ error: "Invalid thread_id format" });

			// ── Owner accept: the student taps Accept in chat. Non-admin,
			// gated by thread ownership inside acceptOwnDraft (same gate as
			// message-history reads). Visibility comes from the student's own
			// choice on the draft card (default private); public drafts are held
			// for review inside acceptDraft, never published directly.
			if (!admin && b.action === "accept_own_draft") {
				const result = await acceptOwnDraft(threadId, b.visibility);
				if (!result.ok) return res.status(403).json({ error: result.error, code: result.code });
				return res.status(200).json({ ...result, server_ms: Date.now() - postStart });
			}


			// ── Owner/admin thread delete: the student clears their own inbox,
			// an admin clears any thread. Owner threads are keyed by the caller's
			// own anon id; session proof required. State + summary rows go too,
			// so a deleted thread leaves no residue in the admin queue.
			if (b.action === "delete_thread") {
				if (!admin) {
					const headerId = clean(req.headers["x-anon-id"] || "", 40);
					if (!headerId || headerId !== threadId)
					return res.status(403).json({ error: "You can only delete your own conversation" });
					const gate = await verifyCallerIdentity(req, res, threadId);
					if (!gate.ok) return res.status(gate.status || 403).json({ error: gate.error, code: gate.code });
				}
				const [{ error: e1 }, { error: e2 }] = await Promise.all([
					supabase.from("chat_messages").delete().eq("thread_id", threadId),
					supabase.from("chat_threads").delete().eq("thread_id", threadId),
				]);
				if (e1) throw e1;
				if (e2) throw e2;
				await supabase.from("settings").delete().eq("key", `inbox_state:${threadId}`);
				await supabase.from("settings").delete().eq("key", `inbox_summary:${threadId}`);
				await auditLog(admin ? "admin" : "inbox", "thread_deleted", `Thread ${threadId} deleted by ${admin ? "admin" : "owner"}`);
				return res.status(200).json({ ok: true, server_ms: Date.now() - postStart });
			}
						// ── Admin actions ────────────────────────────────────
			// FIX #11: rate-limit admin state mutations to prevent takeover spam
			const adminKey = req.headers["x-admin-token"] || clientIp(req);
			if (admin && ["takeover","release","transfer_emotional"].includes(b.action) && inboxAdminRateLimited(String(adminKey))) {
				return rateLimitResponse(res, 60, "Too many admin actions — slow down");
			}
			if (admin && b.action === "takeover") {
				// The user-visible notice must be proven stored BEFORE the state
				// flips: otherwise ok:true + audit claim a handoff the user never sees.
				const handoffMsg =
					"A team member has joined the conversation and will assist you directly. 👤";
				const { error: handoffMsgErr } = await supabase.from("chat_messages").insert({
					thread_id: threadId,
					sender: "admin",
					body: handoffMsg,
				});
				if (handoffMsgErr) throw handoffMsgErr;
				const state = await getThreadState(threadId);
				state.handoff = true;
				state.agent = "admin";
				state.handoff_at = new Date().toISOString();
				await setThreadState(threadId, state);

				await auditLog(
					"admin",
					"inbox_takeover",
					`Admin took over thread ${threadId}`,
				);
				return res.status(200).json({ ok: true, state });
			}

			if (admin && b.action === "release") {
				const state = await getThreadState(threadId);
				state.handoff = false;
				state.agent = "general";
				state.released_at = new Date().toISOString();
				await setThreadState(threadId, state);
				await auditLog(
					"admin",
					"inbox_release",
					`Admin released thread ${threadId}`,
				);
				return res.status(200).json({ ok: true, state });
			}

			if (admin && b.action === "transfer_emotional") {
				const state = await getThreadState(threadId);
				state.agent = "emotional";
				state.handoff = false;
				state.transfer_reason = b.reason || "emotional_support_needed";
				await setThreadState(threadId, state);
				await auditLog(
					"admin",
					"inbox_transfer",
					`Thread ${threadId} transferred to emotional agent: ${b.reason}`,
				);
				return res.status(200).json({ ok: true, state });
			}

			if (admin && b.action === "set_ai_mode") {
				const enabled = b.enabled !== false;
				// This is the platform-wide AI kill switch. Unchecked, a failed
				// write was reported as applied and audited as "disabled
				// platform-wide" while AI replies stayed ON for every user.
				const { error: aiModeErr } = await supabase
					.from("settings")
					.upsert(
						{
							key: "inbox_ai_config",
							value: { enabled, updated_at: new Date().toISOString() },
						},
						{ onConflict: "key" },
					);
				if (aiModeErr) throw aiModeErr;
				await auditLog(
					"admin",
					"inbox_ai_mode",
					`Inbox AI replies ${enabled ? "enabled" : "disabled"} platform-wide`,
				);
				return res.status(200).json({ ok: true, enabled });
			}

			// ── Agent Operations Center actions ────────────────────
			if (admin && b.action === "triage") {
				const triage = await triageThread(threadId);
				return res.status(200).json({ ok: true, triage });
			}

			if (admin && b.action === "draft_post") {
			const { proposal, deduped, reason } = await proposeDraft(threadId, "admin");
			return res.status(200).json({ ok: true, proposal, deduped: !!deduped, reason: reason || null, server_ms: Date.now() - postStart });
		}

		if (admin && b.action === "accept_draft") {
			const result = await acceptDraft(threadId, b.visibility);
			if (!result.ok) return res.status(403).json({ error: result.error, code: result.code });
			return res.status(200).json({ ...result, server_ms: Date.now() - postStart });
		}

		if (admin && b.action === "reject_draft") {
			const result = await rejectDraft(threadId);
			if (!result.ok) return res.status(400).json({ error: result.error });
			return res.status(200).json({ ...result, server_ms: Date.now() - postStart });
		}
		if (admin && b.action === "draft_reply") {
				const { reply } = await draftReplyForThread(threadId);
				return res.status(200).json({ ok: true, reply });
			}

			if (admin && b.action === "summary") {
				const summary = await summarizeThread(threadId);
				return res.status(200).json({ ok: true, ...summary });
			}

			if (admin && b.action === "bulk_action") {
				const ids = Array.isArray(b.thread_ids) ? b.thread_ids : [];
				const result = await applyBulkAction(ids, b.bulk_action || b.operation);
				await auditLog(
					"admin",
					"inbox_bulk",
					`Bulk ${b.bulk_action || b.operation} on ${result.processed} threads`,
				);
				return res.status(200).json({ ok: true, ...result });
			}

			if (admin && b.action === "admin_reply") {
				const body = String(b.body || "")
					.slice(0, 4000)
					.trim();
				if (!body) return res.status(400).json({ error: "Empty reply" });
				// The reply must be PROVEN stored before anything downstream
				// runs. This destructured only `data`, so a failed insert still
				// marked the thread handed-off, marked the user's messages
				// READ, audited "inbox_reply" and answered ok:true — the admin
				// believed the reply was sent and the user never received it.
				const { data: ins, error: insErr } = await supabase
					.from("chat_messages")
					.insert({
						thread_id: threadId,
						sender: "admin",
						body,
						read: true,
						created_at: new Date().toISOString(),
					})
					.select()
					.single();
				if (insErr) throw insErr;
				if (!ins)
					throw new Error("Admin reply was not persisted — please retry");
				const state = await getThreadState(threadId);
				state.handoff = true;
				state.agent = "admin";
				await setThreadState(threadId, state);
				const { error: threadErr } = await supabase
					.from("chat_threads")
					.update({
						updated_at: new Date().toISOString(),
						status: b.close ? "closed" : "open",
					})
					.eq("thread_id", threadId);
				if (threadErr) throw threadErr;
				const { error: markReadErr } = await supabase
					.from("chat_messages")
					.update({ read: true })
					.eq("thread_id", threadId)
					.eq("sender", "user");
				if (markReadErr) throw markReadErr;
				await auditLog("admin", "inbox_reply", `Admin replied to ${threadId}`);
				return res.status(200).json({ ok: true, message: ins });
			}

			// ── Create task for agent ────────────────────────────
			if (admin && b.action === "create_task") {
				const taskBody = String(b.body || "")
					.slice(0, 2000)
					.trim();
				const agentId = String(b.agent_id || "").trim();
				const priority = String(b.priority || "medium").trim();
				if (!taskBody)
					return res.status(400).json({ error: "Task description required" });

				// Create task through the workforce queue (agent_tasks table,
				// settings fallback) so it is persistent + visible in the console
				const task = await createTask({
					title: taskBody.slice(0, 120),
					description: taskBody,
					source: "admin",
					source_ref: `inbox:${threadId}:${Date.now()}`,
					priority: ["low", "medium", "high", "critical"].includes(priority)
						? priority
						: "medium",
					required_capability: null,
					risk_level: "low",
					input: {
						thread_id: threadId,
						requested_agent: agentId || null,
						via: "inbox",
					},
					created_by: "admin",
				});
				if (!task)
					return res.status(500).json({ error: "Task could not be created" });

				// Add system message to thread about the task. Unchecked, a
				// failure meant the task existed but the conversation silently
				// never showed the confirmation the admin and user rely on.
				const { error: taskMsgErr } = await supabase
					.from("chat_messages")
					.insert({
						thread_id: threadId,
						sender: "system",
						body: `📋 Task created: "${taskBody.slice(0, 100)}" — Assigned to: ${agentId || "auto-assign"}`,
						read: true,
						created_at: new Date().toISOString(),
					});
				if (taskMsgErr) throw taskMsgErr;

				await auditLog(
					"admin",
					"inbox_task",
					`Task created for ${threadId}: ${taskBody.slice(0, 50)}`,
				);
				return res.status(201).json({ ok: true, task });
			}

			// ── Send message to agent ─────────────────────────────
			if (admin && b.action === "send_to_agent") {
				const agentId = String(b.agent_id || "").trim();
				const msgBody = String(b.body || "")
					.slice(0, 2000)
					.trim();
				if (!agentId || !msgBody)
					return res.status(400).json({ error: "agent_id and body required" });

				// Create agent task through the workforce queue
				const task = await createTask({
					title: msgBody.slice(0, 120),
					description: msgBody,
					source: "admin",
					source_ref: `inbox:${threadId}:${Date.now()}`,
					priority: "high",
					required_capability: null,
					risk_level: "low",
					input: {
						thread_id: threadId,
						requested_agent: agentId,
						via: "inbox",
					},
					created_by: "admin",
				});

				if (!task)
					return res.status(500).json({ error: "Agent task could not be created" });

				// The notice must exist before ok:true + audit claim it was sent.
				const { error: agentMsgErr } = await supabase.from("chat_messages").insert({
					thread_id: threadId,
					sender: "system",
					body: `🤖 Message sent to agent: ${agentId}`,
					read: true,
					created_at: new Date().toISOString(),
				});
				if (agentMsgErr) throw agentMsgErr;

				await auditLog(
					"admin",
					"inbox_agent_msg",
					`Message sent to ${agentId} for ${threadId}`,
				);
				return res.status(200).json({ ok: true, task });
			}

			// ── User sends message ─────────────────────────────
			if (!admin) {
				const gate = await checkUser(threadId);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				if (await rateLimited("chat_messages", threadId, 60, 10)) {
					return rateLimitResponse(
						res,
						60,
						"Slow down — max 10 messages per minute.",
					);
				}
			}

			const body = maskProfanity(clean(b.body, 2000));
			if (!body && !b.attachment_url)
				return res.status(400).json({ error: "Empty message" });
			// Server-side PII/safety gate for user messages — addresses/phones/emails must
			// never leak through the AI inbox on an anonymous platform.
			if (!admin) {
				const mod = serverModerate("", body);
				if (mod.blocked) {
					const isPII = mod.flags.some((f) => f.type === "privacy");
					return res.status(403).json({
						error: isPII
							? "Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details."
							: "This message violates our safety guidelines and cannot be sent.",
						code: isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED",
					});
				}
			}

			// Server-side dedup: check for same sender+body within 10s window
			const tenSecsAgo = new Date(Date.now() - 10000).toISOString();
			const { data: recentDup } = await supabase
				.from("chat_messages")
				.select("id, body, created_at, sender")
				.eq("thread_id", threadId)
				.eq("sender", admin ? "admin" : "user")
				.eq("body", body)
				.gte("created_at", tenSecsAgo)
				.order("created_at", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (recentDup) {
				// Duplicate found — return existing message, skip insert + AI reply
				logger.info("inbox", `Dedup blocked duplicate`, { thread: threadId, msg_id: recentDup.id });
				return res.status(201).json({
					message: recentDup,
					auto_reply: null,
					emotion: { level: "none", emotion: "none" },
					agent: "admin",
					handoff: false,
					admin_online: false,
					escalate: false,
					dedup: true,
				});
			}

			// 1. Save user message
			const { data: savedMsg, error: saveErr } = await supabase
				.from("chat_messages")
				.insert({
					thread_id: threadId,
					sender: admin ? "admin" : "user",
					body,
					attachment_url: clean(b.attachment_url, 500) || null,
				})
				.select()
				.single();
			if (saveErr) throw saveErr;

			// Ensure thread exists
			const { data: existingThread } = await supabase
				.from("chat_threads")
				.select("thread_id")
				.eq("thread_id", threadId)
				.maybeSingle();
			const now = new Date().toISOString();
			if (existingThread) {
				await supabase
					.from("chat_threads")
					.update({ updated_at: now, status: "open" })
					.eq("thread_id", threadId);
			} else {
				await supabase
					.from("chat_threads")
					.insert({ thread_id: threadId, status: "open", updated_at: now });
			}

		// If admin is sending, just save and return
		if (admin) {
			return res
				.status(201)
				.json({ message: savedMsg, auto_reply: null, emotion: null });
		}

		// ── Instant problem triage (fast path, no LLM) ──────────────
		// A real problem becomes a real report NOW — not after the AI reply,
		// not buried in chat. Emergency pings the admin immediately so the
		// admin dashboard shows it within seconds.
		let triage = { isProblem: false, isPrivate: false, urgency: "none" };
		let triageReported = false;
		try {
			triage = triageInboxMessage(body);
			// Contextual upgrade: the regex above misses targeted hostility
			// that names no listed word ("Rahul, I hate you"). The upgrade is
			// deterministic-only (~ms, no provider) and can only escalate —
			// never clear — the regex verdict. Skipped when already urgent.
			if (triage.urgency !== "urgent") {
				triage = await contextualTriageUpgrade(body, triage);
			}
			if (triage.isProblem) {
				const filed = await fileInboxReport({ threadId, body, triage });
				triageReported = !filed.deduped;
				if (triage.urgency === "urgent") {
					await notifyAdmin(
						threadId,
						body,
						{ level: "critical", emotion: "inbox_urgent" },
						"triage",
					);
				}
				emitEventAndBridge(EVENT_TYPES.USER_REPORTED, {
					target_id: threadId,
					target_type: "inbox",
					author_id: threadId,
					urgency: triage.urgency,
					private: triage.isPrivate,
				}).catch(() => {});
			}
		} catch (triErr) {
			console.error("[inbox] triage failed (non-fatal):", triErr.message);
		}
		const triageOut = {
			reported: triageReported,
			urgency: triage.urgency,
			private: triage.isPrivate,
		};

		// Auto-propose a post draft ONLY on explicit post-intent words from
		// the student ("post this", "publish"…​) about a real problem — never
		// inferred. Skipped when AI is off for this user (an LLM draft would
		// violate their opt-out). Best-effort: never blocks the reply. The
		// cheap regex runs first so the prefs reads happen only on intent.
		let draftProposed = false;
		let draftProposal = null;
		if (triage.isProblem && postIntent(body)) {
			try {
				const prefsEarly = await getNotifyPrefs(threadId).catch(() => null);
				const aiOnEarly = (!prefsEarly || prefsEarly.ai_chat_enabled !== false) && (await getInboxAiConfig()).enabled;
				if (aiOnEarly) {
					const { proposal: draftProposal } = await proposeDraft(threadId, "student-request");
					draftProposed = !!draftProposal;
				}
			} catch (draftErr) {
				console.error("[inbox] draft auto-propose failed (non-fatal):", draftErr.message);
			}
		}

			// ── AI-mode gate ─────────────────────────────────────────
			// The user can turn AI auto-replies off for their own inbox
			// (notify_prefs.ai_chat_enabled) and admins can disable them
			// platform-wide (inbox_ai_config.enabled). With AI off the message
			// is saved and waits for a human admin — no LLM call, no fallback
			// bot message.
			let userPrefs = null;
			try {
				userPrefs = await getNotifyPrefs(threadId);
			} catch {
				/* prefs unavailable → default to AI on */
			}
			const globalAi = await getInboxAiConfig();
			const userAiOn = !userPrefs || userPrefs.ai_chat_enabled !== false;
			if (!userAiOn || !globalAi.enabled) {
				await auditLog(
					"user",
					"inbox_message",
					`Thread ${threadId}: AI off (user=${!userAiOn}, global=${!globalAi.enabled})`,
				);
				emitEventAndBridge(EVENT_TYPES.INBOX_MESSAGE, {
					thread_id: threadId,
					sender: "user",
					emotion: "none",
					level: "none",
				}).catch(() => {});
				return res.status(201).json({
					message: savedMsg,
					auto_reply: null,
					emotion: { level: "none", emotion: "none" },
					agent: "off",
					handoff: false,
					admin_online: false,
					escalate: false,
					ai_mode: false,
					triage: triageOut,
					draft_proposed: false,
				server_ms: Date.now() - postStart,
				});
			}

			// 2. Generate AI reply with timeout (must complete before response)
			let emotion = { level: "none", emotion: "none", agent: "default" };
			let replyResult = { reply: null, agent: "default", handoff: false };

			try {
				// Run emotion + reply with 35s total timeout (Vercel has 60s max).
				// Latency: emotion, thread state, and admin presence resolve in
				// parallel; the tail (notify/audit/emit) settles in parallel too.
				const aiWork = (async () => {
					const [emo, threadState, adminOnline] = await Promise.all([
						classifyEmotion(body),
						getThreadState(threadId),
						isAdminOnline(),
					]);
					threadState.message_count = (threadState.message_count || 0) + 1;
					if (!threadState.emotion_history) threadState.emotion_history = [];
					if (emo.level !== "none") {
						threadState.emotion_history.push({
							emotion: emo.emotion,
							level: emo.level,
							at: now,
						});
						if (threadState.emotion_history.length > 20)
							threadState.emotion_history =
								threadState.emotion_history.slice(-20);
					}
					if (!threadState.recent_messages) threadState.recent_messages = [];
					threadState.recent_messages.push({
						role: "user",
						content: body.slice(0, 200),
					});
					if (threadState.recent_messages.length > 10)
						threadState.recent_messages =
							threadState.recent_messages.slice(-10);
					const reply = await generateReply(
						body,
						threadState,
						emo,
						adminOnline,
					);
					return { emotion: emo, replyResult: reply, threadState };
				})();

				const timeout = new Promise((_, rej) =>
					setTimeout(() => rej(new Error("AI timeout")), 35000),
				);
				const {
					emotion: emo,
					replyResult: rr,
					threadState,
				} = await Promise.race([aiWork, timeout]);
				emotion = emo;
				replyResult = rr;

				// Update thread state
				threadState.agent = replyResult.agent || threadState.agent;
				if (replyResult.handoff !== undefined)
					threadState.handoff = replyResult.handoff;
				if (
					emotion.agent === "emotional" &&
					threadState.agent !== "emotional"
				) {
					threadState.agent = "emotional";
					threadState.transfer_reason = emotion.emotion;
				}
				if (triage.urgency === "urgent") threadState.priority = "urgent";

				// Save AI reply
				let aiReply = null;
				if (replyResult.reply) {
					const { data: aiMsg } = await supabase
						.from("chat_messages")
						.insert({
							thread_id: threadId,
							sender: "ai",
							body: replyResult.reply,
						})
						.select()
						.single();
					aiReply = aiMsg;
					threadState.recent_messages.push({
						role: "assistant",
						content: replyResult.reply.slice(0, 200),
					});
					if (threadState.recent_messages.length > 10)
						threadState.recent_messages =
							threadState.recent_messages.slice(-10);
				}
				// Slang rollup (detection only — gates decide blocking).
				// User message only: AI/admin prose never feeds the finder.
				threadState.slang_hits = mergeSlang(threadState.slang_hits, body, now);
				// Single state write (was two sequential writes)
				await setThreadState(threadId, threadState);

				// Tail settles in parallel: notify, audit, event (was 3 sequential)
				const needsNotify =
					replyResult.notifyAdmin ||
					replyResult.escalate ||
					emotion.level === "critical" ||
					emotion.level === "high";
				await Promise.allSettled([
					needsNotify
						? notifyAdmin(threadId, body, emotion, replyResult.agent)
						: Promise.resolve(),
				auditLog(
					"user",
					"inbox_message",
					`Thread ${threadId}: emotion=${emotion.emotion}(${emotion.level}), agent=${replyResult.agent}, engine=${replyResult.engine || "unknown"}, reply=${!!replyResult.reply}, triage=${triage.urgency}`,
				),
					emitEventAndBridge(EVENT_TYPES.INBOX_MESSAGE, {
						thread_id: threadId,
						sender: "user",
						emotion: emotion.emotion,
						level: emotion.level,
					}),
				]);

				return res.status(201).json({
					message: savedMsg,
					auto_reply: aiReply,
					emotion: { level: emotion.level, emotion: emotion.emotion },
					agent: replyResult.agent,
					handoff: replyResult.handoff || false,
					admin_online: false,
					escalate: replyResult.escalate || false,
					engine: replyResult.engine || "unknown",
					triage: triageOut,
					draft_proposed: draftProposed,
				server_ms: Date.now() - postStart,
				draft: draftProposal,
				});
			} catch (aiErr) {
				console.error("[inbox] AI generation failed/timed out:", aiErr.message);
				await auditLog(
					"user",
					"inbox_ai_error",
					`Thread ${threadId}: ${aiErr.message}`,
				);

				// Save a fallback offline message so user sees a reply instead of blank
				let fallbackReply = null;
				try {
					const fallbackText =
						"Thank you for your message. Our team is currently away but will get back to you shortly. Please leave your message and we will respond as soon as possible.";
					const { data: fallbackMsg } = await supabase
						.from("chat_messages")
						.insert({
							thread_id: threadId,
							sender: "ai",
							body: fallbackText,
							metadata: {
								agent: "default",
								offline_fallback: true,
								error: aiErr.message,
							},
						})
						.select()
						.single();
					fallbackReply = fallbackMsg || { body: fallbackText };
				} catch (fallbackErr) {
					console.error(
						"[inbox] Fallback message save failed:",
						fallbackErr.message,
					);
				}

				return res.status(201).json({
					message: savedMsg,
					auto_reply: fallbackReply,
					emotion: { level: "none", emotion: "error" },
					agent: "default",
					handoff: false,
					admin_online: false,
					escalate: false,
					ai_error: aiErr.message,
					triage: triageOut,
					draft_proposed: draftProposed,
				server_ms: Date.now() - postStart,
				draft: draftProposal,
				});
			}
		}

		// ── PUT: mark read, set status ────────────────────────────
		if (req.method === "PUT") {
			const b = req.body || {};
			const admin = await isAdmin(req);

			if (b.action === "mark_read") {
				if (!b.thread_id)
					return res.status(400).json({ error: "Missing thread_id" });
				// A user opening their inbox has read everything not from
				// themselves — admin AND ai replies. Marking only "admin" left
				// every AI reply unread forever, so the unread badge could never
				// clear. (Admins marking as admin still mark only "user".)
				const senderToMark = admin && b.as === "admin" ? "user" : null;
				let markQ = supabase
					.from("chat_messages")
					.update({ read: true })
					.eq("thread_id", b.thread_id);
				if (senderToMark) markQ = markQ.eq("sender", senderToMark);
				else markQ = markQ.neq("sender", "user");
				if (!admin) markQ = markQ.eq("thread_id", clean(b.thread_id, 40));
				const { error: markErr } = await markQ;
				if (markErr) throw markErr;
				return res.status(200).json({ ok: true });
			}

			if (b.action === "set_status") {
				if (!admin) return res.status(403).json({ error: "Admin only" });
				const { error: statusErr } = await supabase
					.from("chat_threads")
					.update({
						status: b.status === "closed" ? "closed" : "open",
						updated_at: new Date().toISOString(),
					})
					.eq("thread_id", b.thread_id);
				if (statusErr) throw statusErr;
				return res.status(200).json({ ok: true });
			}

			return res.status(400).json({ error: "Unknown action" });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "inbox");
	}
}
