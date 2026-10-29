// Communities — user-created groups with their own discussion feeds.
// GET  /api/communities?action=list              → public community cards
// GET  /api/communities?action=get&slug=<slug>   → detail + posts (anon_id for member state)
// POST /api/communities { action: "create", name, description, avatar, photo, anon_id }
// POST /api/communities { action: "join" | "leave", slug, anon_id }
// POST /api/communities { action: "post", slug, anon_id, author, text, poll? }
// POST /api/communities { action: "comment", slug, post_id, anon_id, author, text }
// POST /api/communities { action: "react", slug, post_id, anon_id, kind }
// POST /api/communities { action: "vote", slug, post_id, anon_id, option_id }
// POST /api/communities { action: "solve_poll", slug, post_id, anon_id } → deletes post + poll
// POST /api/communities { action: "delete_post", slug, post_id, anon_id } (author or admin)
// POST /api/communities { action: "report", slug, anon_id, post_id?, reason }
// POST /api/communities { action: "admin", slug, op: "hide"|"unhide"|"delete" } (admin only)
//
// Persistence: each community is one row in the `settings` table under
// key `community:<slug>` — the same universal KV store the platform already
// uses (categories, announcements, notifications). No new tables required.
// The value is the full community record (members + posts). Nothing here is
// faked: every mutation reads the current row, applies the change, and upserts.

import { auditLog, checkUser, clean, cors, isAdmin, rateLimited, rateLimitResponse, verifyCallerIdentity } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { evaluateContentDeep } from "./_safety-pipeline.js";
import { isTestArtifact } from "./_artifact-filter.js";

const MAX_COMMUNITIES_PER_USER = 5;
const MAX_MEMBERS = 500;
const MAX_POSTS = 300;
const MAX_COMMENTS_PER_POST = 100;
const MAX_REACTIONS_PER_POST = 200;
const MAX_POLL_OPTIONS = 4;
const POST_COOLDOWN_MS = 15 * 1000;
// A member counts as "active now" when their presence heartbeat is this fresh.
// The heartbeat itself is throttled in _me.js, so this window is the truth the
// UI shows — never a fraction of the member count.
const PRESENCE_WINDOW_MS = 5 * 60 * 1000;
const NAME_RE = /^[\p{L}\p{N} _'&-]{2,40}$/u;
const AVATAR_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]{1,4}$/u;
const PHOTO_RE = /^(https?:\/\/|data:image\/)/i;

const _postCooldown = new Map(); // `${slug}:${anon_id}` → last post time (warm only)

async function getCommunity(slug) {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", `community:${slug}`)
		.maybeSingle();
	return data?.value ?? null;
}

async function saveCommunity(community) {
	const { error } = await supabase
		.from("settings")
		.upsert({ key: `community:${community.slug}`, value: community }, { onConflict: "key" });
	return error;
}

async function removeCommunity(slug) {
	const { error } = await supabase
		.from("settings")
		.delete()
		.eq("key", `community:${slug}`);
	return error;
}

function slugify(name) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "community"
	);
}

function summarize(c, admin) {
	const isHidden = !!c.hidden;
	if (isHidden && !admin) return null;
	return {
		slug: c.slug,
		name: c.name,
		description: c.description || "",
		avatar: c.avatar || "🌐",
		photo: c.photo || "",
		created_by: c.created_by,
		created_at: c.created_at,
		hidden: isHidden,
		member_count: Array.isArray(c.members) ? c.members.length : 0,
		post_count: cleanPosts(c.posts).length,
	};
}

// Test/fuzz runs also seed community discussion feeds. Same contract as the
// shared post surfaces: rows stay in storage, only the public listing hides
// them — never delete.
function cleanPosts(posts) {
	return (Array.isArray(posts) ? posts : []).filter(
		(p) => p && !isTestArtifact(p?.text),
	);
}

function publicPost(p, anonId) {
	return {
		id: p.id,
		anon_id: p.anon_id,
		author: p.author || "",
		text: p.text,
		image_url: p.image_url || null,
		created_at: p.created_at,
		reactions: p.reactions || {},
		reaction_counts: Object.fromEntries(
			Object.entries(p.reactions || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
		),
		mine_reactions: Object.fromEntries(
			Object.entries(p.reactions || {}).map(([k, v]) => [k, Array.isArray(v) && anonId ? v.includes(anonId) : false]),
		),
		poll: p.poll ? publicPoll(p.poll, anonId) : null,
		comments: (p.comments || [])
			.filter((c) => c && !isTestArtifact(c?.text))
			.map((c) => ({
			id: c.id,
			anon_id: c.anon_id,
			author: c.author || "",
			text: c.text,
			created_at: c.created_at,
		})),
	};
}

function publicPoll(poll, anonId) {
	return {
		id: poll.id,
		question: poll.question,
		options: poll.options.map((o) => ({
			id: o.id,
			text: o.text,
			votes: Array.isArray(poll.votes?.[o.id]) ? poll.votes[o.id].length : 0,
		})),
		created_by: poll.created_by,
		my_vote: anonId
			? Object.entries(poll.votes || {}).find(([, v]) => v.includes(anonId))?.[0] ?? null
			: null,
		total_votes: Object.values(poll.votes || {}).reduce((s, v) => s + v.length, 0),
	};
}

function rid(prefix) {
	return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Membership is the write key for every discussion action. */
function isMember(c, anonId) {
	return !!anonId && Array.isArray(c?.members) && c.members.includes(anonId);
}

/**
 * How many members are actually online right now.
 *
 * Reads the real presence heartbeat (`users_meta.last_seen`, written by
 * _me.js) for this community's members. Returns `null` when the lookup could
 * not run — the UI then says nothing rather than inventing a number. The old
 * detail page rendered `Math.max(1, ceil(member_count * 0.4))` as "active
 * now", which is a fabricated statistic about real students.
 */
async function onlineIdSet(ids) {
	const unique = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))].slice(
		0,
		2000,
	);
	if (unique.length === 0) return new Set();
	try {
		const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();
		const online = new Set();
		// PostgREST caps URL length with `.in()`, so read in bounded chunks.
		for (let i = 0; i < unique.length; i += 100) {
			const chunk = unique.slice(i, i + 100);
			const { data, error } = await supabase
				.from("users_meta")
				.select("anon_id")
				.in("anon_id", chunk)
				.gte("last_seen", cutoff);
			if (error) return null;
			for (const row of data || []) if (row?.anon_id) online.add(row.anon_id);
		}
		return online;
	} catch {
		return null;
	}
}

// Presence is re-read by the detail page's 3s live tick. A 15s cache keeps
// that from turning every open tab into a presence query — the number is
// still live to a human eye, and the heartbeat that feeds it only updates
// once a minute anyway.
const ONLINE_TTL_MS = 15 * 1000;
const _onlineCache = new Map(); // slug → { at, count }

async function countOnlineMembers(members, slug) {
	const ids = Array.isArray(members) ? members.slice(0, MAX_MEMBERS) : [];
	if (ids.length === 0) return 0;
	const key = String(slug || "");
	if (key) {
		const hit = _onlineCache.get(key);
		if (hit && Date.now() - hit.at < ONLINE_TTL_MS) return hit.count;
	}
	const online = await onlineIdSet(ids);
	if (!online) return null;
	const count = ids.reduce((n, id) => n + (online.has(id) ? 1 : 0), 0);
	if (key) {
		_onlineCache.set(key, { at: Date.now(), count });
		if (_onlineCache.size > 500) {
			for (const [k, v] of _onlineCache) {
				if (Date.now() - v.at > ONLINE_TTL_MS) _onlineCache.delete(k);
			}
		}
	}
	return count;
}

function inCooldown(slug, anonId) {
	const key = `${slug}:${anonId}`;
	const last = _postCooldown.get(key) || 0;
	const remaining = Math.ceil((last + POST_COOLDOWN_MS - Date.now()) / 1000);
	if (remaining <= 0) {
		_postCooldown.set(key, Date.now());
		// prune stale entries
		if (_postCooldown.size > 5000) {
			for (const [k, v] of _postCooldown) {
				if (Date.now() - v > POST_COOLDOWN_MS) _postCooldown.delete(k);
			}
		}
		return 0;
	}
	return remaining;
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		// GET params travel in the query string; POST params in the body.
		const b = req.method === "GET" ? { ...(req.query || {}) } : req.body || {};
		const action = req.method === "GET" ? req.query.action : b.action;

		// Session binding (same model as the main posts/comments writes):
		// community posts/comments expose full anon_ids to any viewer, so the
		// body-claimed anon_id must match the x-anon-id header AND the session
		// cookie. Without this, anyone knowing a student's id could post,
		// vote, or delete as them. Reads (list/get) stay open; the admin op
		// carries no anon_id and keeps its admin-token gate below.
		if (action !== "list" && action !== "get" && action !== "admin") {
			const claimed = clean(b.anon_id || "", 40).toLowerCase();
			if (!claimed) return res.status(400).json({ error: "anon_id required" });
			const gate = await verifyCallerIdentity(req, res, claimed);
			if (!gate.ok)
				return res.status(gate.status || 403).json({ error: gate.error, code: gate.code });
		}

		// ── LIST ────────────────────────────────────────────────
		if (action === "list") {
			const admin = await isAdmin(req).catch(() => false);
			const { data: rows } = await supabase
				.from("settings")
				.select("key,value")
				.ilike("key", "community:%")
				.limit(200);
			const summaries = (rows || [])
				.map((r) => {
					// The KV key is the routing authority: a legacy row whose value
					// lost its `slug` field must still produce a link that resolves
					// (otherwise "Open" navigates to /communities/undefined → 404).
					const v = r.value || {};
					const keySlug = String(r.key || "").replace(/^community:/, "");
					const summary = summarize({ ...v, slug: v.slug || keySlug }, admin);
					return summary
						? { ...summary, members: Array.isArray(v.members) ? v.members : [] }
						: null;
				})
				.filter((c) => c && !isTestArtifact(c.name));
			// One presence lookup for every listed community instead of one per
			// card: unique member ids → the online set → per-community counts.
			const online = await onlineIdSet(
				summaries.flatMap((c) => c.members).slice(0, 2000),
			);
			const communities = summaries
				.map(({ members, ...card }) => ({
					...card,
					online_count: online
						? members.reduce((n, id) => n + (online.has(id) ? 1 : 0), 0)
						: null,
				}))
				.sort((a, b) => b.created_at.localeCompare(a.created_at));
			// Dynamic list: member/post counts change on every join and new post —
			// match the other list endpoints (`private, no-cache`) so nothing serves
			// a stale count for 30s.
			res.setHeader("Cache-Control", "private, no-cache");
			return res.status(200).json({ communities });
		}

		// ── GET (detail) ───────────────────────────────────────
		if (action === "get") {
			const slug = clean(b.slug, 40);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			const admin = await isAdmin(req).catch(() => false);
			const c = await getCommunity(slug);
			if (!c || (c.hidden && !admin))
				return res.status(404).json({ error: "Community not found" });
			// The requested key slug is canonical for routing.
			c.slug = slug;
			const memberList = Array.isArray(c.members) ? c.members.slice(0, MAX_MEMBERS) : [];
			return res.status(200).json({
				...summarize(c, admin),
				members: memberList,
				// Real presence (see countOnlineMembers) — null means "unknown",
				// never a made-up number.
				online_count: await countOnlineMembers(memberList, slug),
				is_member: anonId ? (c.members || []).includes(anonId) : false,
				is_creator: anonId ? c.created_by === anonId : false,
				posts: cleanPosts(c.posts)
					.slice(-50)
					.map((p) => publicPost(p, anonId)),
			});
		}

		// ── CREATE ─────────────────────────────────────────────
		if (action === "create") {
			const name = clean(b.name, 40).trim();
			const anonId = clean(b.anon_id, 40).toLowerCase();
			if (!NAME_RE.test(name))
				return res.status(400).json({ error: "Name must be 2–40 letters, numbers, spaces, or basic punctuation" });
			if (!anonId) return res.status(400).json({ error: "anon_id required" });
			const avatar = clean(b.avatar, 8).trim();
			if (avatar && !AVATAR_RE.test(avatar))
				return res.status(400).json({ error: "Avatar must be an emoji or a short symbol" });
			const description = clean(b.description, 240).trim();
			const photo = clean(b.photo, 400).trim();
			if (photo && !PHOTO_RE.test(photo))
				return res.status(400).json({ error: "Photo must be an image URL" });

			// School-safe gate — a community's name and description are
			// reader-facing text too, and this surface has NO review queue,
			// so anything the policy blocks is refused outright. Same Deep
			// pipeline as posts/comments (L1 keywords + deterministic
			// contextual scan + bounded model pass): layers only ever make
			// the verdict stricter, never more permissive.
			const gate = await evaluateContentDeep(
				[name, description].filter(Boolean).join("\n"),
				"direct",
				null,
				{ taskKey: "communities.write" },
			);
			if (gate.blocked) {
				return res.status(403).json({ error: gate.message, code: gate.code });
			}

			const slug = slugify(name);
			const existing = await getCommunity(slug);
			if (existing)
				return res.status(409).json({ error: "A community with this name already exists" });

			// Per-user cap: at most 5 created communities.
			const { data: rows } = await supabase
				.from("settings")
				.select("key,value")
				.ilike("key", "community:%")
				.limit(200);
			const created = (rows || []).filter(
				(r) => r.value?.created_by === anonId && !r.value?.hidden,
			).length;
			if (created >= MAX_COMMUNITIES_PER_USER)
				return res.status(400).json({ error: `You can create at most ${MAX_COMMUNITIES_PER_USER} communities` });

			const community = {
				slug,
				name,
				description,
				avatar,
				photo,
				created_by: anonId,
				created_at: new Date().toISOString(),
				hidden: false,
				members: [anonId],
				posts: [],
			};
			const err = await saveCommunity(community);
			if (err) throw err;
			return res.status(201).json({ community: summarize(community, true) });
		}

		// ── JOIN / LEAVE ───────────────────────────────────────
		if (action === "join" || action === "leave") {
			const slug = clean(b.slug, 40);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			if (!anonId) return res.status(400).json({ error: "anon_id required" });
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			const members = Array.isArray(c.members) ? c.members.slice() : [];
			if (action === "join" && !members.includes(anonId)) {
				if (members.length >= MAX_MEMBERS)
					return res.status(400).json({ error: "Community is full" });
				members.push(anonId);
			}
			if (action === "leave") {
				const i = members.indexOf(anonId);
				if (i >= 0) members.splice(i, 1);
			}
			c.members = members;
			await saveCommunity(c);
			return res.status(200).json({ is_member: action === "join", member_count: members.length });
		}

		// ── POST (discussion message) ──────────────────────────
		if (action === "post") {
			const slug = clean(b.slug, 40);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			const text = clean(b.text, 500).trim();
			if (!anonId) return res.status(400).json({ error: "anon_id required" });
			if (!text) return res.status(400).json({ error: "Message cannot be empty" });
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			if (!(c.members || []).includes(anonId))
				return res.status(403).json({ error: "Join the community to post" });

			const cooldown = inCooldown(slug, anonId);
			if (cooldown > 0)
				return res.status(429).json({ error: `Please wait ${cooldown}s between messages` });

			// School-safe gate — same unified pipeline as comments/posts.
			// Runs on the raw text (plus poll question/options when present)
			// so tricks and obfuscation face detection, not just the wordlist.
			// DEEP path: keywords + deterministic contextual scan + bounded
			// model judging — this surface has no review queue, so anything
			// flagged as blocked is refused outright rather than held.
			{
				const pollQuestion =
					b.poll && typeof b.poll === "object"
						? clean(b.poll.question, 80).trim()
						: "";
				const pollOptions =
					b.poll && typeof b.poll === "object" && Array.isArray(b.poll.options)
						? b.poll.options
								.map((o) => clean(o, 40).trim())
								.filter((o) => o.length > 0)
								.slice(0, MAX_POLL_OPTIONS)
						: [];
				const decision = await evaluateContentDeep(
					[text, pollQuestion, ...pollOptions].filter(Boolean).join("\n"),
					"direct",
					null,
					{ taskKey: "communities.write" },
				);
				if (decision.blocked) {
					return res.status(403).json({
						error: decision.message,
						code: decision.code,
					});
				}
			}

			// Optional attached poll: { question, options: string[2..4] }
			let poll = null;
			if (b.poll && typeof b.poll === "object") {
				const question = clean(b.poll.question, 80).trim();
				const rawOptions = Array.isArray(b.poll.options) ? b.poll.options : [];
				const options = rawOptions
					.map((o) => clean(o, 40).trim())
					.filter((o) => o.length > 0)
					.slice(0, MAX_POLL_OPTIONS);
				if (!question) return res.status(400).json({ error: "Poll question required" });
				if (options.length < 2)
					return res.status(400).json({ error: "A poll needs at least 2 options" });
				poll = {
					id: rid("cv"),
					question,
					options: options.map((o) => ({ id: rid("co"), text: o })),
					votes: {},
					created_by: anonId,
				};
			}

			const posts = Array.isArray(c.posts) ? c.posts.slice() : [];
			if (posts.length >= MAX_POSTS) posts.shift();
			// Only a stored https URL is accepted — `data:` payloads would bypass
			// /api/upload (and therefore the image safety review) entirely.
			const imageUrl =
				typeof b.image_url === "string" && b.image_url.startsWith("https://")
					? clean(b.image_url, 1000)
					: null;
			posts.push({
				id: rid("cp"),
				anon_id: anonId,
				author: clean(b.author, 24).trim(),
				text,
				image_url: imageUrl,
				created_at: new Date().toISOString(),
				reactions: {},
				comments: [],
				poll,
			});
			c.posts = posts;
			await saveCommunity(c);
			return res.status(201).json({ post: publicPost(posts[posts.length - 1], anonId) });
		}

		// ── COMMENT ────────────────────────────────────────────
		if (action === "comment") {
			const slug = clean(b.slug, 40);
			const postId = clean(b.post_id, 24);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			const text = clean(b.text, 400).trim();
			if (!anonId) return res.status(400).json({ error: "anon_id required" });
			if (!text) return res.status(400).json({ error: "Comment cannot be empty" });
			{
				// DEEP path, same as main-feed comments: keywords + deterministic
				// contextual scan + bounded model pass. Community comments have
				// no review queue, so blocked means refused.
				const decision = await evaluateContentDeep(
					text,
					"direct",
					null,
					{ taskKey: "communities.comment" },
				);
				if (decision.blocked) {
					return res.status(403).json({
						error: decision.message,
						code: decision.code,
					});
				}
			}
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			// Reactions and comments are member-only on the WRITE path too. The
			// buttons were already hidden for non-members, but a client gate is
			// not an authorization boundary: without this, any browser could
			// comment or react on a community it never joined.
			if (!isMember(c, anonId))
				return res.status(403).json({
					error: "Join the community to comment",
					code: "NOT_MEMBER",
				});
			const posts = (c.posts || []).slice();
			const post = posts.find((p) => p.id === postId);
			if (!post) return res.status(404).json({ error: "Post not found" });
			const comments = (post.comments || []).slice();
			if (comments.length >= MAX_COMMENTS_PER_POST) comments.shift();
			comments.push({
				id: rid("cc"),
				anon_id: anonId,
				author: clean(b.author, 24).trim(),
				text,
				created_at: new Date().toISOString(),
			});
			post.comments = comments;
			c.posts = posts;
			await saveCommunity(c);
			return res.status(201).json({ comment: comments[comments.length - 1] });
		}

		// ── REACT (toggle support / helpful / etc.) ────────────
		if (action === "react") {
			const slug = clean(b.slug, 40);
			const postId = clean(b.post_id, 24);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			const kind = clean(b.kind, 24).trim();
			if (!anonId) return res.status(400).json({ error: "anon_id required" });
			if (!kind) return res.status(400).json({ error: "kind required" });
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			if (!isMember(c, anonId))
				return res.status(403).json({
					error: "Join the community to react",
					code: "NOT_MEMBER",
				});
			const posts = (c.posts || []).slice();
			const post = posts.find((p) => p.id === postId);
			if (!post) return res.status(404).json({ error: "Post not found" });
			const reactions = { ...(post.reactions || {}) };
			const list = Array.isArray(reactions[kind]) ? reactions[kind].slice() : [];
			const i = list.indexOf(anonId);
			if (i >= 0) list.splice(i, 1);
			else {
				if (list.length >= MAX_REACTIONS_PER_POST)
					return res.status(400).json({ error: "Reaction limit reached on this post" });
				list.push(anonId);
			}
			if (list.length === 0) delete reactions[kind];
			else reactions[kind] = list;
			post.reactions = reactions;
			c.posts = posts;
			await saveCommunity(c);
			return res.status(200).json({
				kind,
				active: i < 0,
				count: list.length,
			});
		}

		// ── VOTE (poll on a community post) ────────────────────
		if (action === "vote") {
			const slug = clean(b.slug, 40);
			const postId = clean(b.post_id, 24);
			const optionId = clean(b.option_id, 24);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			if (!anonId) return res.status(400).json({ error: "anon_id required" });
			if (!optionId) return res.status(400).json({ error: "option_id required" });
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			if (!isMember(c, anonId))
				return res.status(403).json({
					error: "Join the community to vote",
					code: "NOT_MEMBER",
				});
			const posts = (c.posts || []).slice();
			const post = posts.find((p) => p.id === postId);
			if (!post?.poll) return res.status(404).json({ error: "Poll not found" });
			if (!post.poll.options.some((o) => o.id === optionId))
				return res.status(400).json({ error: "Unknown option" });
			const votes = { ...(post.poll.votes || {}) };
			// one person, one vote — move any previous vote to the new option
			for (const key of Object.keys(votes)) {
				votes[key] = (votes[key] || []).filter((id) => id !== anonId);
				if (votes[key].length === 0) delete votes[key];
			}
			const list = Array.isArray(votes[optionId]) ? votes[optionId].slice() : [];
			list.push(anonId);
			votes[optionId] = list;
			post.poll.votes = votes;
			c.posts = posts;
			await saveCommunity(c);
			return res.status(200).json({ ok: true, my_vote: optionId });
		}

		// ── SOLVE POLL (creator or admin) → deletes post + poll ─
		if (action === "solve_poll") {
			const slug = clean(b.slug, 40);
			const postId = clean(b.post_id, 24);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			const admin = await isAdmin(req).catch(() => false);
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			const posts = (c.posts || []).slice();
			const post = posts.find((p) => p.id === postId);
			if (!post) return res.status(404).json({ error: "Post not found" });
			if (!post.poll) return res.status(400).json({ error: "Post has no poll" });
			if (!admin && post.anon_id !== anonId && post.poll.created_by !== anonId)
				return res.status(403).json({ error: "Only the author can solve this poll" });
			// Requirement: solving the poll deletes the poll together with the post.
			c.posts = posts.filter((p) => p.id !== postId);
			await saveCommunity(c);
			return res.status(200).json({ ok: true, deleted: true, post_count: c.posts.length });
		}

		// ── DELETE POST (author or admin) → removes post (+ its poll) ─
		if (action === "delete_post") {
			const slug = clean(b.slug, 40);
			const postId = clean(b.post_id, 24);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			const admin = await isAdmin(req).catch(() => false);
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			const posts = (c.posts || []).slice();
			const post = posts.find((p) => p.id === postId);
			if (!post) return res.status(404).json({ error: "Post not found" });
			if (!admin && post.anon_id !== anonId)
				return res.status(403).json({ error: "Only the author can delete this post" });
			c.posts = posts.filter((p) => p.id !== postId);
			await saveCommunity(c);
			return res.status(200).json({ ok: true, deleted: true, post_count: c.posts.length });
		}

		// ── REPORT (flows into the existing admin Reports queue) ─
		if (action === "report") {
			const slug = clean(b.slug, 40);
			const anonId = clean(b.anon_id, 40).toLowerCase();
			const reason = clean(b.reason, 200).trim() || "Community content";
			const postId = clean(b.post_id, 24);
			if (!anonId) return res.status(400).json({ error: "anon_id required" });
			// Session binding already ran at the top of this handler for every
			// non-read action (including report) — re-verifying here repeated the
			// same session lookup on every report. Only the ban/suspension gate
			// is new at this point.
			const gate = await checkUser(anonId);
			if (!gate.ok) return res.status(403).json({ error: gate.error });
			if (await rateLimited("communities_report", anonId, 300, 10)) {
				return rateLimitResponse(res, 300, "Slow down — max 10 reports per 5 minutes.");
			}
			const c = await getCommunity(slug);
			if (!c || c.hidden) return res.status(404).json({ error: "Community not found" });
			const posts = Array.isArray(c.posts) ? c.posts : [];
			if (postId && !posts.some((p) => p?.id === postId))
				return res.status(404).json({ error: "Post not found" });
			// Community reports carry their own target_type so admins can tell
			// them apart from feed posts. Older deployments still enforce a
			// CHECK constraint allowing only post|comment|poll — if that fires,
			// retry once as a `post` row with a `community:`-prefixed target_id
			// so the report still reaches the queue instead of a 500.
			const targetId = postId ? `${slug}::${postId}` : slug;
			const targetType = postId ? "community_post" : "community";

			// A report is a durable claim about a target. Reporting the same
			// target twice in a day used to create a second identical row (and a
			// second strike), so a double-tap or an impatient user inflated the
			// queue. Return the existing row instead.
			const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
			const { data: existing } = await supabase
				.from("reports")
				.select("id")
				.eq("target_id", targetId)
				.eq("author_id", anonId)
				.gte("created_at", since)
				.limit(1);
			if (Array.isArray(existing) && existing.length > 0) {
				return res.status(200).json({ ok: true, duplicate: true });
			}

			const first = await supabase.from("reports").insert({
				target_type: targetType,
				target_id: targetId,
				reason,
				author_id: anonId,
				status: "pending",
			});
			let inserted = !first.error;
			if (first.error) {
				const retry = await supabase.from("reports").insert({
					target_type: "post",
					target_id: `community:${targetId}`,
					reason,
					author_id: anonId,
					status: "pending",
				});
				inserted = !retry.error;
				if (!inserted) {
					console.error(
						"[communities] report insert failed both ways:",
						first.error.message || first.error,
						retry.error?.message || retry.error,
					);
					// Never answer 201 for a report that is not in the queue: the
					// user must know it did not reach a moderator.
					return res.status(503).json({
						error: "Couldn't file the report right now — please try again in a moment.",
						code: "REPORT_UNAVAILABLE",
					});
				}
			}
			if (typeof auditLog === "function") {
				await auditLog(anonId, "community_report", `${targetType} ${targetId}: ${reason}`).catch(() => {});
			}
			return res.status(201).json({ ok: true, duplicate: false });
		}

		// ── ADMIN (hide / unhide / delete) ─────────────────────
		if (action === "admin") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const slug = clean(b.slug, 40);
			const op = clean(b.op, 12);
			const c = await getCommunity(slug);
			if (!c) return res.status(404).json({ error: "Community not found" });
			if (op === "hide") {
				c.hidden = true;
				await saveCommunity(c);
				return res.status(200).json({ ok: true, hidden: true });
			}
			if (op === "unhide") {
				c.hidden = false;
				await saveCommunity(c);
				return res.status(200).json({ ok: true, hidden: false });
			}
			if (op === "delete") {
				await removeCommunity(slug);
				return res.status(200).json({ ok: true, deleted: true });
			}
			return res.status(400).json({ error: "Unknown admin op" });
		}

		return res.status(400).json({ error: "Unknown action" });
	} catch (err) {
		console.error("[communities] error:", err.message);
		return sanitizeError(res, err, "communities");
	}
}
