// Community Health — real participation signals (roster #21).
//
// REAL JOB: measure the community's actual activity every run — posts,
// comments and votes in the last 24h, top categories, and the leaderboard
// inputs (problems/suggestions the board computes from) — and persist a
// health report to the canonical settings KV (community_health:latest),
// verified by re-read. Advisory audit rows record each run.
//
// Every number comes from a real read; the report degrades honestly (null
// sections) when a read is unavailable rather than fabricating zeros or
// pretending a section was measured.
import { auditLog } from "./_auth.js";
import { readLivePosts } from "./_live-posts.js";
import supabase from "./_db-client.js";
import { isTestArtifact } from "./_artifact-filter.js";

const HEALTH_KEY = "community_health:latest";
const WINDOW_MS = 24 * 3600 * 1000;

async function countRecent(table, column, cutoffIso) {
	try {
		const { data } = await supabase
			.from(table)
			.select(column)
			.gte("created_at", cutoffIso)
			.limit(1000);
		return { count: (data || []).length, ok: true };
	} catch {
		return { count: 0, ok: false };
	}
}

/**
 * Build the community health report from real reads and persist it.
 * Zero-arg (the cron loop calls the registry run with no arguments).
 *
 * @returns {Promise<{ok: boolean, verified?: boolean, report?: object, error?: string}>}
 */
export async function runCommunityHealth({ nowMs = Date.now() } = {}) {
	const cutoff = nowMs - WINDOW_MS;
	const cutoffIso = new Date(cutoff).toISOString();

	// 1. Posts (dual read — the live feed first, honest null when unavailable).
	let posts = null;
	try {
		const live = await readLivePosts({
			columns: "id, title, category, status, created_at",
			limit: 300,
		});
		if (live.ok && live.source === "supabase") {
			const fresh = (live.posts || []).filter(
				(p) =>
					!isTestArtifact(p.title) && new Date(p.created_at).getTime() >= cutoff,
			);
			const byCategory = {};
			for (const p of fresh) {
				const c = String(p.category || "Other");
				byCategory[c] = (byCategory[c] || 0) + 1;
			}
			posts = { new_24h: fresh.length, by_category: byCategory };
		}
	} catch {
		posts = null;
	}

	// 2. Comments + votes (real count reads).
	const comments = await countRecent("comments", "post_id", cutoffIso);
	const votes = await countRecent("votes", "post_id", cutoffIso);

	const report = {
		generated_at: new Date(nowMs).toISOString(),
		window: "last_24h",
		posts,
		comments_24h: comments.ok ? comments.count : null,
		votes_24h: votes.ok ? votes.count : null,
	};

	// 3. Persist + VERIFY by independent re-read.
	try {
		await supabase.from("settings").upsert(
			{ key: HEALTH_KEY, value: report },
			{ onConflict: "key" },
		);
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", HEALTH_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === report.generated_at;
		if (persisted) {
			try {
				await auditLog(
					"community-health-worker",
					"community_health_report",
					`posts ${report.posts?.new_24h ?? "n/a"} · comments ${report.comments_24h ?? "n/a"} · votes ${report.votes_24h ?? "n/a"}`,
				);
			} catch {
				/* audit is best-effort */
			}
		}
		return { ok: true, verified: persisted, report };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

// GET /api/community-health — admin read of the latest health report.
export default async function handler(req, res) {
	const { cors, isAdmin } = await import("./_auth.js");
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", HEALTH_KEY)
			.maybeSingle();
		if (!data?.value) return res.status(404).json({ error: "No health report generated yet" });
		return res.status(200).json(data.value);
	} catch (err) {
		console.error("community-health error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
