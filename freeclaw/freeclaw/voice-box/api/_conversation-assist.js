// AI Conversation Assistant — auto-reply when admin is offline, emotional flagging.
// POST /api/conversation-assist { thread_id, message }  →  AI auto-reply or flag
// GET  /api/conversation-assist?thread_id=X           →  check if auto-reply is active
// NO templates — every reply comes directly from the external LLM model

import {
	auditLog,
	checkUser,
	clean,
	cors,
	rateLimited,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { callLLMChain } from "./_providers.js";
import { analyzeContext, makeEmotionLexicon } from "./_context-classify.js";

const EMOTIONAL_KEYWORDS = {
	distressed: [
		"suicide",
		"kill myself",
		"end my life",
		"can't go on",
		"no reason to live",
		"self harm",
		"hurt myself",
	],
	angry: [
		"furious",
		"enraged",
		"livid",
		"outraged",
		"disgusted",
		"hate this school",
		"worst ever",
		"unacceptable",
	],
	anxious: [
		"scared",
		"terrified",
		"anxious",
		"worried sick",
		"panic",
		"stressed",
		"overwhelmed",
	],
	sad: [
		"depressed",
		"hopeless",
		"worthless",
		"nobody cares",
		"alone",
		"lonely",
		"cry",
	],
};

// Boundary-matched, not substring-matched. `lower.includes("alone")` used to
// fire on "along" ("let's go along with it" → flagged sad), and the categories
// here were a second, incompatible vocabulary that no consumer understood.
// Both problems are solved by reusing the shared lexicon + contextual engine:
// these lists are now one signal, and the canonical severity drives routing.
const EMOTION_LEXICON = makeEmotionLexicon(EMOTIONAL_KEYWORDS, {
	levelByCategory: {
		distressed: "critical",
		angry: "high",
		anxious: "moderate",
		sad: "moderate",
	},
	emotionByCategory: {
		distressed: "critical_distress",
		angry: "anger",
		anxious: "anxious",
		sad: "sad",
	},
});

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error("timeout")), ms),
		),
	]);
}

/** Routing keyed on the canonical severity, so one vocabulary decides both the
 *  UI label and the escalation. Harassment and threats now reach an admin
 *  instead of being labelled LOW and dropped. */
function getEmotionMeta(level) {
	switch (level) {
		case "critical":
			return {
				priority: "immediate",
				escalate: true,
				flags: ["emotional_distress", "requires_immediate_attention"],
			};
		case "high":
			return {
				priority: "high",
				escalate: true,
				flags: ["emotional_elevated", "requires_immediate_attention"],
			};
		case "moderate":
			return { priority: "medium", escalate: false, flags: ["emotional_mild"] };
		case "mild":
			return { priority: "low", escalate: false, flags: ["emotional_mild"] };
		default:
			return { priority: "low", escalate: false, flags: ["auto_reply"] };
	}
}

export { EMOTION_LEXICON };

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		// GET: check auto-reply status (thread_id doubles as the anon bearer credential)
		if (req.method === "GET") {
			const threadId = clean(req.query.thread_id, 40);
			const gate = await checkUser(threadId);
			if (!gate.ok)
				return res.status(403).json({ error: gate.error || "Forbidden" });
			const { data } = await supabase
				.from("settings")
				.select("value")
				.eq("key", `conversation_assist:${threadId || "global"}`)
				.maybeSingle();
			return res
				.status(200)
				.json({
					active: data?.value?.active ?? true,
					settings: data?.value || {},
				});
		}

		// POST: process message
		if (req.method === "POST") {
			const b = req.body || {};
			if (!b.thread_id || !b.message)
				return res
					.status(400)
					.json({ error: "thread_id and message required" });

			const threadId = clean(b.thread_id, 40);
			const gate = await checkUser(threadId);
			if (!gate.ok)
				return res.status(403).json({ error: gate.error || "Forbidden" });
			// Cap LLM cost — auto-reply is only ever triggered per-thread, so throttle per thread
			if (await rateLimited("conversation_assist", threadId, 60, 10)) {
				return rateLimitResponse(
					res,
					60,
					"Too many auto-reply requests. Please wait.",
				);
			}

			const message = clean(b.message, 2000);
			// Contextual: understands a named target, quoted/reported abuse and
			// Hinglish, instead of only counting keyword hits.
			const decision = await analyzeContext(message, {
				lexicon: EMOTION_LEXICON,
				taskKey: "conversation_assist.emotion",
			});
			const level = decision.severity;
			const emotion = decision.classification;
			const meta = getEmotionMeta(level);

			// Check if admin is online (had activity in last 10 minutes)
			let adminOnline = false;
			try {
				const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
				// chat_threads is keyed by thread_id (NOT id) — the previous .eq('id')
				// always returned null, so adminOnline was permanently false and the AI
				// auto-replied even while an admin was actively chatting.
				const { data: thread } = await supabase
					.from("chat_threads")
					.select("updated_at")
					.eq("thread_id", threadId)
					.maybeSingle();
				adminOnline =
					thread && new Date(thread.updated_at) > new Date(tenMinAgo);
			} catch {
				/* assume offline */
			}

			// Only auto-reply if admin is offline or escalation is needed
			const shouldReply = !adminOnline || meta.escalate;

			// All replies come from the LLM — no templates
			let finalReply = null;
			let provider = "none";
			if (shouldReply) {
				const systemPrompt =
					level === "critical"
						? "You are a trained school counselor. A student is in crisis. Respond with empathy, validate their feelings, and provide crisis resources. Keep under 100 words. Never dismiss their pain."
						: "You are a helpful school support assistant. Be empathetic, supportive, and professional. Keep replies under 100 words. Never dismiss concerns.";

				try {
					const result = await withTimeout(
						callLLMChain(
							systemPrompt,
							`A student wrote: "${message.slice(0, 800)}"\n\nProvide a direct, empathetic response.`,
						),
						20000,
					);
					if (result?.text && result.text.length > 10) {
						finalReply = result.text.trim();
						provider = `${result.provider}:${result.model}`;
					}
				} catch (e) {
					console.error("[conversation-assist] LLM call failed:", e.message);
				}
			}

			// Store the auto-reply decision
			await supabase.from("settings").upsert(
				{
					key: `conversation_assist:${threadId}`,
					value: {
						last_message: message.slice(0, 200),
						emotion,
						level,
						categories: decision.categories,
						auto_reply_sent: shouldReply && !!finalReply,
						reply: finalReply,
						admin_online: adminOnline,
						priority: meta.priority,
						escalate: meta.escalate,
						flags: meta.flags,
						processed_at: new Date().toISOString(),
					},
				},
				{ onConflict: "key" },
			);

			// If escalation needed, add to notifications for admins
			if (meta.escalate) {
				const { data: existingNotifs } = await supabase
					.from("settings")
					.select("value")
					.eq("key", "notifications:admin")
					.maybeSingle();
				const notifs = existingNotifs?.value?.notifications || [];
				notifs.unshift({
					id: `notif_${Date.now().toString(36)}`,
					type: "escalation",
					title:
						level === "critical"
							? "⚠️ Urgent: possible crisis — immediate attention needed"
							: `⚠️ Escalated: ${emotion} — needs review`,
					body: `Thread ${threadId}: Student message requires immediate attention (content truncated for privacy)`,
					post_id: null,
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
								notifications: notifs.slice(0, 100),
								updated_at: new Date().toISOString(),
							},
						},
						{ onConflict: "key" },
					);
			}

			// Audit trail: truncate message to avoid logging full PII
			const auditSnippet =
				message.slice(0, 40).replace(/[^\w\s]/g, "") +
				(message.length > 40 ? "..." : "");			await auditLog(
				"system",
				"conversation_assist",
				`Processed message in thread ${threadId}: level=${level}, emotion=${emotion || "none"}, auto_reply=${shouldReply && !!finalReply}, snippet="${auditSnippet}"`,
			);

			return res.status(200).json({
				emotion,
				level,
				auto_reply: finalReply,
				admin_online: adminOnline,
				priority: meta.priority,
				escalate: meta.escalate,
				flags: meta.flags,
				provider,
			});
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		console.error("conversation-assist error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
