// Real-time AI writing assistance: category detection, tag suggestions,
// title improvement, and contextual chat replies.
// NO templates — every reply comes directly from the external LLM model.
// Uses the shared provider chain (NVIDIA/Anthropic/etc) instead of direct Anthropic calls.
import { cors, isAdmin, rateLimited, rateLimitResponse } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import { callLLMChain } from "./_providers.js";

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error("timeout")), ms),
		),
	]);
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
			// Always call the LLM — no keyword fallback; 8s timeout to keep UI responsive
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
			try {
				const result = await withTimeout(
					callLLMChain(
						"You classify school feedback. Categories: Academics, Facilities, Food, Bullying, Teachers, Events, Transport, Sports, Technology, Library, Hostel, Security, Cleanliness, Medical, Other. Respond with STRICT valid JSON only.",
						`Text: """${input}"""\nReturn JSON: {"category":string,"confidence":0-1,"tags":[max 3 short kebab-case strings],"priority":"low|medium|high|critical","improved_title":string(max 80 chars, clear and specific)}`,
					),
					8000,
				);
				if (result?.text) {
					// Strip markdown fences + extract first JSON object robustly
					let raw = result.text
						.replace(/^```json?\s*/i, "")
						.replace(/```\s*$/, "")
						.trim();
					const jsonMatch = raw.match(/\{[\s\S]*\}/);
					if (jsonMatch) raw = jsonMatch[0];
					const parsed = JSON.parse(raw);
					// Validate and sanitize fields before returning
					const category = VALID_CATEGORIES.includes(parsed.category)
						? parsed.category
						: null;
					const priority = VALID_PRIORITIES.includes(parsed.priority)
						? parsed.priority
						: undefined;
					const tags = Array.isArray(parsed.tags)
						? parsed.tags
								.filter((t) => typeof t === "string" && t.length > 0)
								.slice(0, 3)
						: [];
					const improved_title =
						typeof parsed.improved_title === "string"
							? parsed.improved_title.slice(0, 120)
							: undefined;
					const confidence =
						typeof parsed.confidence === "number"
							? Math.max(0, Math.min(1, parsed.confidence))
							: undefined;
					if (category) {
						return res.status(200).json({
							engine: `${result.provider}:${result.model}`,
							category,
							confidence,
							priority,
							tags,
							improved_title,
						});
					}
				}
			} catch {
				/* fall through — LLM timeout or parse error */
			}
			// If LLM fails completely, return no suggestions rather than fake data
			return res
				.status(200)
				.json({ engine: "none", category: null, tags: [], priority: null });
		}

		// ---- Smart poll suggestions (public, fast) ----
		if (task === "suggest_poll") {
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
			try {
				const result = await withTimeout(
					callLLMChain(
						"You help students create better polls on an anonymous school feedback platform. Given a draft poll question, return STRICT valid JSON only.",
						`Draft poll question: """${input}"""\nReturn JSON: {"improved_title": string (max 90 chars, clearer and more specific), "suggested_options": [4 short concise option strings (max 40 chars each)] OR [] if it is a yes/no question, "ptype": "yesno"|"single"|"multi", "note": short tip for the student (max 80 chars)}`,
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
						return res
							.status(200)
							.json({
								engine: `${result.provider}:${result.model}`,
								improved_title,
								suggested_options,
								ptype,
								note,
							});
					}
				}
			} catch {
				/* fall through — LLM timeout or parse error */
			}
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

		// ---- AI chat reply (admin side) ----
		if (task === "chat_reply") {
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
				const result = await withTimeout(
					callLLMChain(
						"You are a kind, professional school admin replying to an anonymous student in a support chat. Keep replies short (1-3 sentences), warm, and actionable. Never ask for personal details.",
						`Conversation:\n${history}\n\nReply directly to the student.`,
					),
					15000,
				);
				if (result?.text && result.text.length > 10) {
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
			return res.status(200).json({ engine: "none", reply: null });
		}

		return res.status(400).json({ error: "Unknown task" });
	} catch (err) {
		return sanitizeError(res, err, "assist");
	}
}
