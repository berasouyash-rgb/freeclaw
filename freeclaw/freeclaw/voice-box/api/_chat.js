// Anonymous direct messaging between admin and anonymous users

import { isTestArtifact, TEST_THREAD_ID_RE } from "./_artifact-filter.js";
import {
	checkUser,
	clean,
	cors,
	isAdmin,
	maskProfanity,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { serverModerate } from "./_moderation.js";

// FIX-M9: IP-based rate limiting for anonymous chat (20 messages per 5 min)
const _chatRateLimit = new Map();
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 5 * 60 * 1000;

function chatRateLimited(ip) {
	const now = Date.now();
	const entry = _chatRateLimit.get(ip);
	if (entry && now - entry.start < CHAT_RATE_WINDOW_MS) {
		if (entry.count >= CHAT_RATE_LIMIT) return true;
		entry.count++;
		return false;
	}
	_chatRateLimit.set(ip, { count: 1, start: now });
	if (_chatRateLimit.size > 10000) {
		for (const [k, v] of _chatRateLimit) {
			if (now - v.start > CHAT_RATE_WINDOW_MS) _chatRateLimit.delete(k);
		}
	}
	return false;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			const { thread_id, threads } = req.query;
			if (threads === "1") {
				if (!(await isAdmin(req)))
					return res.status(403).json({ error: "Admin only" });
				const [{ data: t }, { data: msgs }] = await Promise.all([
					supabase
						.from("chat_threads")
						.select("*")
						.order("updated_at", { ascending: false }),
					supabase
						.from("chat_messages")
						.select("thread_id,sender,read,body,created_at")
						.order("created_at", { ascending: false })
						.limit(5000),
				]);
				const enriched = (t || []).map((th) => {
					const mine = (msgs || []).filter((m) => m.thread_id === th.thread_id);
					return {
						...th,
						last_message: mine[0]?.body || "",
						last_at: mine[0]?.created_at || th.updated_at,
						unread: mine.filter((m) => m.sender === "user" && !m.read).length,
					};
				});
				// Full-site zero-fuzz: hide QA/fuzz threads (recognizable thread ids or
				// artifact last messages) so the admin chat queue reads clean. Rows
				// stay intact in the DB; they are only hidden from this listing.
				const visible = enriched.filter(
					(th) =>
						!TEST_THREAD_ID_RE.test(th.thread_id || "") &&
						!isTestArtifact(th.last_message),
				);
				return res.status(200).json(visible);
			}
			if (!thread_id)
				return res.status(400).json({ error: "Missing thread_id" });
			// Gate message-history reads the same way POST is gated: admin passes,
			// anonymous requesters must present a valid (non-banned) anon id.
			// Note: in this anonymous-credential architecture thread_id doubles as
			// the caller's bearer token, so anyone who knows a thread id can read
			// it — the masking fixes elsewhere are what keep ids from leaking.
			if (!(await isAdmin(req))) {
				const gate = await checkUser(thread_id);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
			}
			const [{ data: msgs, error }, { data: thread }] = await Promise.all([
				supabase
					.from("chat_messages")
					.select("*")
					.eq("thread_id", thread_id)
					.order("created_at", { ascending: true })
					.limit(500),
				supabase
					.from("chat_threads")
					.select("*")
					.eq("thread_id", thread_id)
					.maybeSingle(),
			]);
			if (error) throw error;
			return res
				.status(200)
				.json({ messages: msgs || [], thread: thread || null });
		}

		if (req.method === "POST") {
			const b = req.body || {};
			const thread_id = clean(b.thread_id, 40);
			if (!thread_id)
				return res.status(400).json({ error: "Missing thread_id" });
			const fromAdmin = b.sender === "admin" && (await isAdmin(req));
			if (!fromAdmin) {
				const gate = await checkUser(thread_id);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				// FIX-M9: IP-based rate limiting for anonymous chat
				const clientIp =
					req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
					req.socket?.remoteAddress ||
					"unknown";
				if (chatRateLimited(clientIp))
					return rateLimitResponse(
						res,
						300,
						"Rate limit exceeded — 20 messages per 5 minutes",
					);
			}
			const body = maskProfanity(clean(b.body, 1000));
			if (!body && !b.attachment_url)
				return res.status(400).json({ error: "Empty message" });
			// Server-side PII/safety gate for user messages — addresses/phones/emails must
			// never leak through the support chat on an anonymous platform.
			if (!fromAdmin) {
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
				.eq("thread_id", thread_id)
				.eq("sender", fromAdmin ? "admin" : "user")
				.eq("body", body)
				.gte("created_at", tenSecsAgo)
				.order("created_at", { ascending: false })
				.limit(1)
				.maybeSingle();

			if (recentDup) {
				console.log(
					`[chat] Dedup: blocked duplicate message in ${thread_id} (id=${recentDup.id})`,
				);
				return res.status(201).json(recentDup);
			}

			// Ensure thread exists / bump
			const { data: existing } = await supabase
				.from("chat_threads")
				.select("thread_id")
				.eq("thread_id", thread_id)
				.maybeSingle();
			const now = new Date().toISOString();
			if (existing)
				await supabase
					.from("chat_threads")
					.update({ updated_at: now, status: "open" })
					.eq("thread_id", thread_id);
			else
				await supabase
					.from("chat_threads")
					.insert({ thread_id, status: "open", updated_at: now });
			const { data, error } = await supabase
				.from("chat_messages")
				.insert({
					thread_id,
					sender: fromAdmin ? "admin" : "user",
					body,
					attachment_url: clean(b.attachment_url, 500) || null,
				})
				.select()
				.single();
			if (error) throw error;
			return res.status(201).json(data);
		}

		if (req.method === "PUT") {
			const b = req.body || {};
			const admin = await isAdmin(req);
			if (b.action === "mark_read") {
				if (!b.thread_id)
					return res.status(400).json({ error: "Missing thread_id" });
				if (!admin) {
					// In the anonymous-credential model the presented thread_id IS the
					// caller's identity — gate it the same way POST/GET are gated so
					// invalid or banned ids are rejected up front.
					const gate = await checkUser(clean(b.thread_id, 40));
					if (!gate.ok) return res.status(403).json({ error: gate.error });
				}
				// admin marks user messages read; user marks admin messages read
				const senderToMark = admin && b.as === "admin" ? "user" : "admin";
				await supabase
					.from("chat_messages")
					.update({ read: true })
					.eq("thread_id", b.thread_id)
					.eq("sender", senderToMark);
				return res.status(200).json({ ok: true });
			}
			if (b.action === "set_status") {
				if (!admin) return res.status(403).json({ error: "Admin only" });
				await supabase
					.from("chat_threads")
					.update({
						status: b.status === "closed" ? "closed" : "open",
						updated_at: new Date().toISOString(),
					})
					.eq("thread_id", b.thread_id);
				return res.status(200).json({ ok: true });
			}
			return res.status(400).json({ error: "Unknown action" });
		}

		if (req.method === "DELETE") {
			// Hard-delete a conversation (messages + thread) — admin only
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const tid = clean(req.body?.thread_id, 40);
			if (!tid) return res.status(400).json({ error: "Missing thread_id" });
			const [{ error: e1 }, { error: e2 }] = await Promise.all([
				supabase.from("chat_messages").delete().eq("thread_id", tid),
				supabase.from("chat_threads").delete().eq("thread_id", tid),
			]);
			if (e1) throw e1;
			if (e2) throw e2;
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "chat");
	}
}
