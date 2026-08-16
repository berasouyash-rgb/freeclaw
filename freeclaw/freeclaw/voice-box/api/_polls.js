// Poll system: standalone + complaint-linked, with live results

import { isTestArtifact } from "./_artifact-filter.js";
import {
	auditLog,
	checkUser,
	clean,
	cors,
	isAdmin,
	maskProfanity,
	rateLimited,
	rateLimitResponse,
} from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { serverModerate } from "./_moderation.js";

async function attachResults(polls, strict = false) {
	const ids = polls.map((p) => p.id);
	if (!ids.length) return polls;
	const { data: votes, error } = await supabase
		.from("poll_votes")
		.select("poll_id,choices")
		.in("poll_id", ids);
	// Strict mode is used after a write: a failed results read must not
	// masquerade as "0 votes" — the vote DID persist, so report the error.
	if (strict && error) throw error;
	const map = {};
	(votes || []).forEach((v) => {
		map[v.poll_id] = map[v.poll_id] || { total: 0, counts: {} };
		map[v.poll_id].total += 1;
		(v.choices || []).forEach((c) => {
			map[v.poll_id].counts[c] = (map[v.poll_id].counts[c] || 0) + 1;
		});
	});
	return polls.map((p) => ({
		...p,
		total_votes: map[p.id]?.total || 0,
		vote_counts: map[p.id]?.counts || {},
	}));
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			const { id, post_id, voter } = req.query;
			const admin = await isAdmin(req);
			// Cache: 30s browser + CDN for poll listings
			res.setHeader(
				"Cache-Control",
				"public, max-age=0, no-cache, s-maxage=10, stale-while-revalidate=10",
			);
			if (voter) {
				const { data } = await supabase
					.from("poll_votes")
					.select("poll_id,choices")
					.eq("author_id", voter);
				return res.status(200).json(data || []);
			}
			// Widen the fetch window: the artifact filter below runs in JS AFTER this
			// SQL limit, so a narrow window of mostly-fuzz rows would starve the list.
			let q = supabase
				.from("polls")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(2000);
			if (id) q = q.eq("id", id);
			if (post_id) q = q.eq("post_id", post_id);
			if (!admin) q = q.eq("deleted", false);
			const { data, error } = await q;
			if (error) throw error;

			// Full-site zero-fuzz: hide test/fuzz polls on every surface, admin
			// included. Rows stay intact in the DB; they are only hidden.
			const cleanRows = (data || []).filter((p) => !isTestArtifact(p.title));

			// Validate linked posts still exist — clean orphaned post_id references
			const pollsWithLinks = cleanRows.filter((p) => p.post_id);
			if (pollsWithLinks.length) {
				const postIds = [...new Set(pollsWithLinks.map((p) => p.post_id))];
				const { data: existingPosts } = await supabase
					.from("posts")
					.select("id")
					.in("id", postIds);
				const existingSet = new Set((existingPosts || []).map((p) => p.id));
				const orphans = pollsWithLinks.filter(
					(p) => !existingSet.has(p.post_id),
				);
				if (orphans.length) {
					// Clear orphaned post_id in background (non-blocking)
					Promise.all(
						orphans.map((p) =>
							supabase.from("polls").update({ post_id: null }).eq("id", p.id),
						),
					).catch(() => {});
					// Also fix in-memory for this response
					orphans.forEach((p) => {
						p.post_id = null;
					});
				}
			}

			const results = await attachResults(cleanRows.slice(0, 200));
			// Mask author IDs — they are bearer tokens for poll deletion
			const v = clean(req.query.viewer, 40);
			const masked = results.map((p) => {
				const is_mine = !!v && p.author_id === v;
				return {
					...p,
					is_mine,
					author_id:
						is_mine || p.author_id === "ADMIN"
							? p.author_id
							: (p.author_id || "").slice(0, 9) + "...",
				};
			});
			return res.status(200).json(masked);
		}

		if (req.method === "POST") {
			const b = req.body || {};
			const author_id = clean(b.author_id, 40);

			if (b.action === "closed") {
				// Poll-close notification — notifies the poll's author that it has
				// closed so they can review results. Idempotent per poll.
				const { data: poll } = await supabase
					.from("polls")
					.select("*")
					.eq("id", b.poll_id)
					.maybeSingle();
				if (!poll) return res.status(404).json({ error: "Poll not found" });
				const closed = !!(
					poll.expires_at && new Date(poll.expires_at) < new Date()
				);
				if (!closed)
					return res.status(200).json({ closed: false, notified: false });
				const key = `notifications:${poll.author_id}`;
				const { data: row } = await supabase
					.from("settings")
					.select("value")
					.eq("key", key)
					.maybeSingle();
				const existing = (row?.value?.notifications || []).find(
					(n) => n.type === "poll_closed" && n.poll_id === poll.id,
				);
				if (existing)
					return res
						.status(200)
						.json({ closed: true, notified: false, already_notified: true });
				const notification = {
					id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
					type: "poll_closed",
					title: "Your poll closed",
					body: `“${(poll.title || "").slice(0, 80)}” has closed — results are in.`,
					post_id: poll.post_id || null,
					poll_id: poll.id,
					read: false,
					created_at: new Date().toISOString(),
				};
				const notifications = [
					notification,
					...(row?.value?.notifications || []),
				].slice(0, 100);
				await supabase
					.from("settings")
					.upsert(
						{
							key,
							value: { notifications, updated_at: new Date().toISOString() },
						},
						{ onConflict: "key" },
					);
				return res.status(200).json({ closed: true, notified: true });
			}

			if (b.action === "vote") {
				const gate = await checkUser(author_id);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				const { data: poll } = await supabase
					.from("polls")
					.select("*")
					.eq("id", b.poll_id)
					.maybeSingle();
				if (!poll) return res.status(404).json({ error: "Poll not found" });
				if (poll.deleted)
					return res.status(404).json({ error: "Poll not found" });
				if (poll.archived)
					return res.status(400).json({ error: "Poll is archived." });
				if (poll.expires_at && new Date(poll.expires_at) < new Date())
					return res.status(400).json({ error: "Poll has ended." });
				const choices = (Array.isArray(b.choices) ? b.choices : [])
					.map(Number)
					.filter(
						(n) =>
							Number.isInteger(n) && n >= 0 && n < (poll.options || []).length,
					);
				if (!choices.length)
					return res.status(400).json({ error: "Select at least one option." });
				if (poll.ptype !== "multi" && choices.length > 1)
					return res.status(400).json({ error: "Only one choice allowed." });
				// A failed write MUST NOT return a fake 200 with zeroed results —
				// that is exactly how votes silently disappear after refresh.
				const { data: existing, error: existingError } = await supabase
					.from("poll_votes")
					.select("id")
					.eq("poll_id", poll.id)
					.eq("author_id", author_id)
					.maybeSingle();
				if (existingError) throw existingError;
				const write = existing
					? await supabase
							.from("poll_votes")
							.update({ choices })
							.eq("id", existing.id)
					: await supabase
							.from("poll_votes")
							.insert({ poll_id: poll.id, author_id, choices });
				if (write.error) throw write.error;
				const [withResults] = await attachResults([poll], true);
				return res.status(200).json(withResults);
			}

			// Create poll
			const admin = await isAdmin(req);
			if (!admin) {
				const gate = await checkUser(author_id);
				if (!gate.ok) return res.status(403).json({ error: gate.error });
				if (await rateLimited("polls", author_id, 120, 2))
					return rateLimitResponse(
						res,
						120,
						"Please wait before creating another poll.",
					);
			}
			const title = maskProfanity(clean(b.title, 140));
			if (title.length < 5)
				return res
					.status(400)
					.json({ error: "Question must be at least 5 characters." });
			const ptype = ["yesno", "single", "multi"].includes(b.ptype)
				? b.ptype
				: "yesno";
			const options =
				ptype === "yesno"
					? ["Yes", "No"]
					: Array.isArray(b.options)
						? b.options.map((o) => clean(o, 60)).filter(Boolean)
						: [];
			if (ptype !== "yesno" && (options.length < 2 || options.length > 10)) {
				return res.status(400).json({ error: "Provide 2–10 options." });
			}
			// Server-side PII/safety gate — poll questions and options can leak addresses too.
			const mod = serverModerate(title, options.join(" "));
			// Weak privacy signals also block polls — they have no review queue.
			if (mod.blocked || mod.flags.some((f) => f.type === "privacy_weak")) {
				const isPII = mod.flags.some(
					(f) => f.type === "privacy" || f.type === "privacy_weak",
				);
				await auditLog(
					"moderation",
					"poll_blocked",
					`${author_id}: ${title.slice(0, 60)} [${mod.flags.map((f) => f.type).join(", ")}]`,
				);
				return res.status(403).json({
					error: isPII
						? "Personal information detected (address, phone, or email). This is an anonymous platform — please remove personal details."
						: "This poll violates our safety guidelines and cannot be published.",
					code: isPII ? "PII_BLOCKED" : "CONTENT_BLOCKED",
				});
			}
			const expRaw = b.expires_at;
			const expires_at =
				expRaw && !Number.isNaN(new Date(expRaw).getTime())
					? new Date(expRaw).toISOString()
					: null;
			const row = {
				id: `poll_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
				title,
				ptype,
				options,
				post_id: b.post_id ? clean(b.post_id, 60) : null,
				author_id: admin && !author_id ? "ADMIN" : author_id,
				expires_at,
				deleted: false,
				archived: false,
				created_at: new Date().toISOString(),
			};
			const { data, error } = await supabase
				.from("polls")
				.insert(row)
				.select()
				.single();
			if (error) throw error;
			return res.status(201).json(data);
		}

		if (req.method === "PUT") {
			const b = req.body || {};
			const admin = await isAdmin(req);
			const { data: poll } = await supabase
				.from("polls")
				.select("*")
				.eq("id", b.id)
				.maybeSingle();
			if (!poll) return res.status(404).json({ error: "Poll not found" });
			// 'ADMIN' polls may only be modified by verified admins — a plain user
			// could otherwise spoof author_id='ADMIN' (a public constant) to delete them.
			const isOwner =
				b.author_id &&
				b.author_id !== "ADMIN" &&
				b.author_id === poll.author_id;
			if (!admin && !isOwner)
				return res.status(403).json({ error: "Not authorized" });
			const patch = {};
			if (typeof b.archived === "boolean") patch.archived = b.archived;
			if (typeof b.deleted === "boolean") patch.deleted = b.deleted;
			if (admin && b.expires_at !== undefined) patch.expires_at = b.expires_at;
			const { data, error } = await supabase
				.from("polls")
				.update(patch)
				.eq("id", b.id)
				.select()
				.single();
			if (error) throw error;
			if (admin) await auditLog("admin", "update_poll", b.id);
			return res.status(200).json(data);
		}

		if (req.method === "DELETE") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			await supabase.from("poll_votes").delete().eq("poll_id", req.body?.id);
			const { error } = await supabase
				.from("polls")
				.delete()
				.eq("id", req.body?.id);
			if (error) throw error;
			await auditLog("admin", "delete_poll", req.body?.id);
			return res.status(200).json({ ok: true });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "polls");
	}
}
