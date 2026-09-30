// Poll Creation — the create side of the auto poll lifecycle (roster #19).
//
// REAL JOB: suggestion posts with community engagement (>= SUPPORT_COMMENTS
// comments) and no poll yet get a real poll created through the platform's
// own createPoll path (api/_polls.js — the exact row shape, mask, and insert
// the handler uses), attributed to the suggestion's author and linked to
// their post so the own-post linking rule holds naturally. The safety engine
// (serverModerate) runs on the poll title BEFORE insert — a blocked title is
// never published.
//
// Verification is independent: after each creation the worker re-reads the
// poll row by id via the polls table.
import { auditLog, clean, cors, isAdmin } from "./_auth.js";
import { readLivePosts } from "./_live-posts.js";
import supabase from "./_db-client.js";
import { isTestArtifact } from "./_artifact-filter.js";
import { serverModerate } from "./_moderation.js";
import { createPoll } from "./_polls.js";

const SUGGESTION_CATEGORIES = new Set(["suggestion", "suggestions"]);
const OPEN_STATUSES = new Set([
	"reported",
	"open",
	"verified",
	"in_progress",
	"waiting",
]);
const SUPPORT_COMMENTS = 2;
const SWEEP_LIMIT = 100;
const MAX_CREATE = 5;

async function existingPollPostIds() {
	try {
		const { data } = await supabase.from("polls").select("post_id").limit(500);
		return new Set((data || []).map((p) => p?.post_id).filter(Boolean));
	} catch {
		return new Set();
	}
}

async function commentCounts(postIds) {
	try {
		const { data } = await supabase
			.from("comments")
			.select("post_id")
			.in("post_id", postIds.length ? postIds : ["_"]);
		const counts = {};
		for (const c of data || []) counts[c.post_id] = (counts[c.post_id] || 0) + 1;
		return counts;
	} catch {
		return {};
	}
}

/**
 * Create polls for engaged suggestions — the real create side of the poll
 * lifecycle. Zero-arg (the cron loop calls the registry run with no
 * arguments).
 *
 * @returns {Promise<{ok: boolean, verified?: boolean, created: Array, errors: Array, error?: string}>}
 */
export async function runPollCreate({ nowMs = Date.now() } = {}) {
	const result = { created: [], errors: [] };

	const live = await readLivePosts({
		columns: "id, title, description, category, tags, status, author_id, created_at",
		limit: SWEEP_LIMIT,
	});
	if (!live.ok || live.source !== "supabase") {
		return {
			...result,
			ok: false,
			error: live.error || "direct post store unavailable",
		};
	}

	const polled = await existingPollPostIds();
	const candidates = [];
	for (const p of live.posts || []) {
		if (!OPEN_STATUSES.has(String(p.status || "").toLowerCase())) continue;
		if (isTestArtifact(p.title)) continue;
		const category = String(p.category || "").trim().toLowerCase();
		const tags = Array.isArray(p.tags)
			? p.tags.join(" ").toLowerCase()
			: String(p.tags || "").toLowerCase();
		const isSuggestion =
			SUGGESTION_CATEGORIES.has(category) || /\bsuggestion\b/.test(tags);
		if (!isSuggestion) continue;
		// One poll per suggestion — the create side never duplicates.
		if (polled.has(p.id)) continue;
		if (!clean(String(p.author_id || ""), 40)) continue;
		candidates.push(p);
		if (candidates.length >= MAX_CREATE * 2) break;
	}
	if (!candidates.length) return { ...result, ok: true, verified: true, created: [] };

	const counts = await commentCounts(candidates.map((p) => p.id));
	const engaged = candidates.filter((p) => (counts[p.id] || 0) >= SUPPORT_COMMENTS);
	if (!engaged.length) return { ...result, ok: true, verified: true, created: [] };

	for (const p of engaged.slice(0, MAX_CREATE)) {
		try {
			const pollTitle = `Do you agree: ${clean(String(p.title || ""), 100)}`;
			// Pre-publication safety: never publish a poll the engine blocks.
			const gate = serverModerate(pollTitle, "Yes No");
			if (gate.blocked) continue;
			const r = await createPoll({
				title: pollTitle,
				ptype: "yesno",
				options: ["Yes", "No"],
				post_id: p.id,
				author_id: p.author_id,
				expires_at: null,
				admin: false,
			});
			if (!r.ok || !r.poll?.id) {
				result.errors.push({
					post_id: p.id,
					error: String(r.error?.message || r.error || "poll insert failed").slice(0, 200),
				});
				continue;
			}
			result.created.push({ post_id: p.id, poll_id: r.poll.id, title: pollTitle });
			try {
				await auditLog("poll-create-worker", "poll_created", `${p.id} -> ${r.poll.id}`);
			} catch {
				/* audit is best-effort */
			}
		} catch (err) {
			result.errors.push({
				post_id: p.id,
				error: String(err?.message || err).slice(0, 200),
			});
		}
	}

	if (!result.created.length)
		return { ...result, ok: true, verified: true, created: [] };

	// VERIFY: independent re-read of each created poll.
	let verified = 0;
	for (const c of result.created) {
		try {
			const { data } = await supabase
				.from("polls")
				.select("id, title")
				.eq("id", c.poll_id)
				.maybeSingle();
			if (data?.id === c.poll_id) verified += 1;
		} catch {
			/* counted as unverified */
		}
	}
	return { ...result, ok: true, verified: verified === result.created.length };
}

// GET /api/poll-create — admin read of the worker-created poll lifecycle.
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const { data } = await supabase
			.from("polls")
			.select("id, title, post_id, ptype, created_at")
			.ilike("title", "Do you agree:%")
			.order("created_at", { ascending: false })
			.limit(50);
		return res.status(200).json({
			worker_created_polls: (data || []).length,
			recent: data || [],
		});
	} catch (err) {
		console.error("poll-create error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
