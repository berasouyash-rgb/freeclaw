// Appeals — recourse for safety-blocked content (Phase 1 backlog item).
//
// A 403 never stores the text, so a wrongful block (victim quoting an
// insult, educational discussion, transliteration false positive) had no
// remedy except retyping and hoping. Appeals close that loop following the
// pre-review queue pattern: durable settings-KV records (`appeal:%`),
// admin review, notifyUser receipts, audit rows.
//
// Differences from pre-review:
// - Appeals are filed BY the blocked author (public POST), not by a scanner.
// - The appeal text itself may contain blocked words: it is CLASSIFIED for
//   routing but never gated and never published except via overturn.
// - Overturn PUBLISHES through the normal insert path (verified by re-read)
//   and clears the safety fingerprint that would otherwise re-block the
//   vindicated text as SAFETY_REPOST_BLOCKED.
// - Same-text repeat appeals by the same author are idempotent (dedupe).
// - Open-appeal cap (3/author) + rate limit bound the queue against floods.

import {
	auditLog,
	clean,
	cors,
	ensureUser,
	isAdmin,
	notifyUser,
} from "./_auth.js";
import supabase from "./_db-client.js";
import {
	checkSafetyRepost,
	clearSafetyRepost,
	fingerprintSafetyText,
	recordModerationDecision,
} from "./_moderation.js";
import { evaluateContent } from "./_safety-pipeline.js";
import { createPoll } from "./_polls.js";

export const APPEAL_PREFIX = "appeal:";
const APPEAL_MAX_OPEN = 3;

function appealTextOf(a) {
	return `${a.title || ""} ${a.body || ""}`.trim();
}

async function readAppeal(client, id) {
	const { data } = await client
		.from("settings")
		.select("value")
		.eq("key", `${APPEAL_PREFIX}${id}`)
		.maybeSingle();
	return data?.value || null;
}

async function listAppeals(client, { author_id = null, status = null } = {}) {
	const q = client.from("settings").select("key, value").like("key", `${APPEAL_PREFIX}%`);
	const { data, error } = await q;
	if (error) throw error;
	let items = (data || []).map((row) => ({ id: String(row.key).slice(APPEAL_PREFIX.length), ...row.value }));
	if (author_id) items = items.filter((a) => a.author_id === author_id);
	if (status) items = items.filter((a) => a.status === status);
	items.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
	return items;
}

async function writeAppeal(client, appeal) {
	const { error } = await client.from("settings").upsert(
		{ key: `${APPEAL_PREFIX}${appeal.id}`, value: appeal },
		{ onConflict: "key" },
	);
	if (error) throw error;
}

async function publishOverturn(client, appeal) {
	const now = new Date().toISOString();
	const author_id = appeal.author_id || "anonymous";
	if (appeal.surface === "comment") {
		if (!appeal.post_id) throw new Error("comment appeal missing post_id");
		const row = {
			id: `cmt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
			post_id: appeal.post_id,
			parent_id: appeal.parent_id || null,
			author_id,
			body: String(appeal.body || ""),
			is_admin: false,
		};
		const { data, error } = await client.from("comments").insert(row).select().single();
		if (error) throw error;
		const { data: check } = await client
			.from("comments")
			.select("id")
			.eq("id", data?.id || row.id)
			.maybeSingle();
		if (!check) throw new Error("overturned comment not readable after insert");
		await ensureUser(author_id).catch(() => {});
		return { kind: "comment", id: data?.id || row.id };
	}
	if (appeal.surface === "poll") {
		const r = await createPoll({
			title: String(appeal.title || appeal.body || "Untitled").slice(0, 140),
			ptype: appeal.ptype || "yesno",
			options: Array.isArray(appeal.options) && appeal.options.length ? appeal.options : ["Yes", "No"],
			post_id: null,
			author_id,
			expires_at: null,
			admin: false,
		});
		if (!r.ok || !r.poll?.id) throw new Error("overturned poll insert failed");
		return { kind: "poll", id: r.poll.id };
	}
	// post (default)
	const postId = `post_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	const postData = {
		id: postId,
		type: "problem",
		title: String(appeal.title || "Untitled").slice(0, 120),
		description: String(appeal.body || "").slice(0, 500),
		category: appeal.category || "Other",
		priority: "medium",
		author_id,
		status: "reported",
		progress: 5,
		image_url: null,
		tags: [],
		deleted: false,
		hidden: false,
		status_history: [
			{ status: "reported", at: now, note: "Published on appeal overturn" },
		],
	};
	const { error: postErr } = await client.from("posts").insert(postData);
	if (postErr) throw postErr;
	const { data: check } = await client.from("posts").select("id").eq("id", postId).maybeSingle();
	if (!check) throw new Error("overturned post not readable after insert");
	await ensureUser(author_id).catch(() => {});
	return { kind: "post", id: postId };
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		// ── POST: file an appeal (public, identity-bound) ──
		if (req.method === "POST") {
			const b = req.body || {};
			const callerId = clean(req.headers["x-anon-id"] || "", 40);
			const author_id = clean(b.author_id || "", 40);
			if (!author_id || (callerId && callerId !== "ADMIN" && callerId !== author_id))
				return res.status(403).json({ error: "Not authorized" });
			const surface = String(b.surface || "").toLowerCase();
			if (!["post", "comment", "poll"].includes(surface))
				return res.status(400).json({ error: "surface must be post, comment, or poll" });
			const title = clean(b.title || "", 140);
			const body = clean(b.body || "", 2000);
			if (!body && !title)
				return res.status(400).json({ error: "Appealed text is required" });
			if (surface === "comment" && !clean(b.post_id || "", 60))
				return res.status(400).json({ error: "post_id is required for comment appeals" });

			// Classify for routing info only — appeals are never gated.
			let flags = [];
			try {
				const d = evaluateContent(`${title} ${body}`, "queued", null);
				flags = (d.flags || []).map((f) => f.type);
			} catch {
				flags = [];
			}

			const open = await listAppeals(supabase, { author_id, status: "open" });
			const fp = fingerprintSafetyText(`${title} ${body}`);
			const dup = fp && open.find((a) => fingerprintSafetyText(appealTextOf(a)) === fp);
			if (dup) return res.status(200).json({ id: dup.id, status: "open", deduped: true });
			if (open.length >= APPEAL_MAX_OPEN)
				return res.status(429).json({
					error: `Too many open appeals (${open.length}). Wait for review before filing more.`,
					code: "APPEALS_EXHAUSTED",
				});

			const appeal = {
				id: `apl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
				surface,
				author_id,
				title,
				body,
				post_id: surface === "comment" ? clean(b.post_id, 60) : null,
				parent_id: b.parent_id ? clean(b.parent_id, 60) : null,
				ptype: b.ptype || null,
				options: Array.isArray(b.options) ? b.options.map((o) => clean(o, 60)).filter(Boolean).slice(0, 10) : null,
				category: clean(b.category || "", 40) || null,
				reason: clean(b.reason || "", 500),
				flags,
				status: "open",
				created_at: new Date().toISOString(),
			};
			await writeAppeal(supabase, appeal);
			await auditLog("moderation", "appeal_filed", `${author_id}: ${appeal.id} [${surface}] [${flags.join(",")}]`);
			return res.status(201).json({ id: appeal.id, status: "open", flags });
		}

		// ── GET: admin sees all; users see only their own ──
		if (req.method === "GET") {
			const admin = await isAdmin(req);
			const callerId = clean(req.headers["x-anon-id"] || "", 40);
			if (!admin && !callerId)
				return res.status(401).json({ error: "Admin access required" });
			const items = await listAppeals(supabase, {
				author_id: admin ? null : callerId,
				status: clean(req.query?.status || "", 20) || null,
			});
			return res.status(200).json({ items, total: items.length });
		}

		// ── PUT: admin review (uphold | overturn) ──
		if (req.method === "PUT") {
			if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
			const b = req.body || {};
			const id = clean(b.id || "", 60);
			const decision = String(b.decision || "").toLowerCase();
			if (!id || !["uphold", "overturn"].includes(decision))
				return res.status(400).json({ error: "id and decision (uphold|overturn) required" });
			const appeal = await readAppeal(supabase, id);
			if (!appeal) return res.status(404).json({ error: "Appeal not found" });
			if (appeal.status !== "open")
				return res.status(409).json({ error: `Appeal already ${appeal.status}`, code: "APPEAL_CLOSED" });

			const note = clean(b.note || "", 500);
			if (decision === "uphold") {
				const updated = { ...appeal, status: "upheld", reviewed_at: new Date().toISOString(), review_note: note };
				await writeAppeal(supabase, updated);
				await auditLog("moderation", "appeal_upheld", `${appeal.author_id}: ${id} [${appeal.surface}]`);
				await notifyUser(
					appeal.author_id,
					"info",
					"Appeal reviewed: content stays down",
					`Your appeal for "${String(appeal.title || appeal.body || "").slice(0, 60)}" was reviewed and the block stands.${note ? ` Note: ${note}` : ""} You can rephrase and resubmit.`,
				);
				return res.status(200).json({ id, status: "upheld", published: null });
			}

			// overturn: publish through the normal path, verify, clear the
			// fingerprint that would re-block this text, feed the learned loop.
			const published = await publishOverturn(supabase, appeal);
			const cleared = await clearSafetyRepost(supabase, appealTextOf(appeal));
			if ((appeal.flags || []).includes("privacy_weak")) {
				try {
					await recordModerationDecision("privacy_weak", true);
				} catch {
					/* learning is best-effort */
				}
			}
			const updated = {
				...appeal,
				status: "overturned",
				reviewed_at: new Date().toISOString(),
				review_note: note,
				published,
				fingerprint_cleared: cleared,
			};
			await writeAppeal(supabase, updated);
			await auditLog(
				"moderation",
				"appeal_overturned",
				`${appeal.author_id}: ${id} [${appeal.surface}] → ${published.kind}:${published.id} (fingerprint ${cleared ? "cleared" : "absent"})`,
			);
			await notifyUser(
				appeal.author_id,
				"info",
				"Appeal approved: your content is live",
				`Your appeal for "${String(appeal.title || appeal.body || "").slice(0, 60)}" was approved and the content is now public.`,
			);
			// Independent verification is inside publishOverturn (re-read);
			// re-confirm the appeal row itself landed overturned.
			const confirm = await readAppeal(supabase, id);
			return res.status(200).json({
				id,
				status: "overturned",
				published,
				fingerprint_cleared: cleared,
				verified: confirm?.status === "overturned" && !!confirm?.published,
			});
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		console.error("appeals error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
