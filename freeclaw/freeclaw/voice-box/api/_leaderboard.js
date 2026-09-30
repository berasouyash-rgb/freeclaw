// Leaderboard — aggregates human + AI supports across problems, suggestions, and polls.
// GET /api/leaderboard
//   Returns { problems, suggestions, polls, ai_activity, generated_at }
//
// Human supports = reactions (support on problems, upvote on suggestions, votes on polls).
// AI activity = recent agent executions / learning records so the "AI side" of the
// leaderboard reflects real agent work (never faked).

import { isTestArtifact } from "./_artifact-filter.js";
import { cors } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

// Default page size when no admin config is stored — kept in sync with the
// admin setter default (api/_admin.js) so the Customize panel always previews
// exactly what the public board will serve.
const DEFAULT_PAGE_SIZE = 25;

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

	try {
		res.setHeader(
			"Cache-Control",
			"public, max-age=30, s-maxage=30, stale-while-revalidate=10",
		);

		// ── Admin customization (set via Admin → Leaderboard → Customize) ──
		// The config lives in the settings table and is applied to the public board
		// so the admin controls what visitors actually see. Never fabricated defaults.
		let cfg = {
			enabled: true,
			hide_empty: false,
			page_size: DEFAULT_PAGE_SIZE,
			pinned_ids: [],
		};
		try {
			const { data: cfgRow } = await supabase
				.from("settings")
				.select("value")
				.eq("key", "leaderboard_config")
				.maybeSingle();
			if (cfgRow?.value && typeof cfgRow.value === "object") {
				const c = cfgRow.value;
				cfg = {
					enabled: c.enabled !== false,
					hide_empty: !!c.hide_empty,
					// Clamp must mirror the admin setter (api/_admin.js: 5–100) or an
					// admin who picks 100 would get a 50-row board back.
					page_size: Math.min(100, Math.max(5, Number(c.page_size) || DEFAULT_PAGE_SIZE)),
					pinned_ids: Array.isArray(c.pinned_ids)
						? c.pinned_ids.map((x) => String(x)).slice(0, 10)
						: [],
				};
			}
		} catch {
			/* config optional — defaults apply */
		}
		const LIMIT = cfg.page_size;

		if (!cfg.enabled) {
			return res.status(200).json({
				problems: [],
				suggestions: [],
				polls: [],
				ai_activity: [],
				leaderboard: [],
				generated_at: new Date().toISOString(),
			});
		}

		// ── Problems & Suggestions: fetch real columns + compute support from the
		//    reactions table (posts.reactions / comment_count are NOT stored columns —
		//    selecting them would make PostgREST error and silently empty the board).
		const [{ data: problems }, { data: suggestions }, { data: pollRows }] =
			await Promise.all([
				supabase
					.from("posts")
					.select("id,title,category,status,created_at,admin_reply")
					.eq("type", "problem")
					.eq("deleted", false)
					.neq("hidden", true)
					.order("created_at", { ascending: false })
					.limit(200),
				supabase
					.from("posts")
					.select("id,title,category,status,created_at,admin_reply")
					.eq("type", "suggestion")
					.eq("deleted", false)
					.neq("hidden", true)
					.order("created_at", { ascending: false })
					.limit(200),
				supabase
					.from("polls")
					.select("id,title,ptype,created_at,archived")
					.eq("deleted", false)
					.order("created_at", { ascending: false })
					.limit(200),
			]);

		// Batch-fetch reactions for the union of post ids, then sum per target_id.
		const allPostIds = [
			...new Set([
				...(problems || []).map((p) => p.id),
				...(suggestions || []).map((s) => s.id),
			]),
		];
		const reactMap = {};
		let reactionsFailed = false;
		const chunk = (arr, size) => {
			const out = [];
			for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
			return out;
		};
		const reactionsTask = (async () => {
			try {
				if (allPostIds.length) {
				for (const ids of chunk(allPostIds, 100)) {
					const { data: reactRows, error: reactErr } = await supabase
						.from("reactions")
						.select("target_id,kind")
						.in("target_id", ids);
					if (reactErr) throw reactErr;
					(reactRows || []).forEach((r) => {
						reactMap[r.target_id] = reactMap[r.target_id] || {};
						reactMap[r.target_id][r.kind] =
							(reactMap[r.target_id][r.kind] || 0) + 1;
					});
				}
				}
			} catch (err) {
				console.error("[leaderboard] reactions fetch failed, marking estimated", { error: err?.message || String(err) });
				reactionsFailed = true;
			}
		})();

		const supportOf = (counts) =>
			(counts?.support || 0) +
			(counts?.upvote || 0) +
			(counts?.appreciate || 0) +
			(counts?.concerned || 0) +
			(counts?.frustrated || 0);

		// Down-votes (thumbs-down / arrow-down). Legacy rows never had
		// them, so this is 0 for all historical data — rankings are
		// unchanged until users actually cast down-votes.
		const downOf = (counts) =>
			(counts?.disagree || 0) +
			(counts?.downvote || 0);

		// ── Multi-factor leaderboard scoring ──────────────────────────
		// Instead of raw support count, use a weighted composite:
		//   Quality = support × 3 + comments × 2.5 + resolution_bonus
		//   Freshness = log(1 + hours_since_post) / 48
		//   Participation = diversity of engagement types
		//   Score = quality × freshness_factor + resolution_bonus
		const fetchCommentCounts = async (ids) => {
			const counts = {};
			if (!ids.length) return { counts, failed: false };
			try {
				for (let i = 0; i < ids.length; i += 100) {
					const slice = ids.slice(i, i + 100);
					const { data, error: cErr } = await supabase
						.from("comments")
						.select("post_id")
						.in("post_id", slice)
						.eq("deleted", false);
					if (cErr) throw cErr;
					(data || []).forEach((c) => {
						counts[c.post_id] = (counts[c.post_id] || 0) + 1;
					});
				}
			} catch (err) { console.error("[leaderboard] comment counts fetch failed", { error: err?.message || String(err) }); return { counts, failed: true }; }
			return { counts, failed: false };
		};

		const computeScore = (item, commentCount, up, down = 0) => {
			const net = Math.max(0, up - down);
			const comments = commentCount || 0;
			const hours = Math.max(0.1, (Date.now() - new Date(item.created_at).getTime()) / 3600000);
			const isSolved = item.status === "solved";

			// Quality: weighted engagement. Down-votes subtract from the
			// up-vote signal (floored at zero) so a thumbs-down actually
			// counts instead of being decorative.
			const quality = net * 3 + comments * 2.5;

			// Freshness: log-compressed time decay (not harsh — rewards sustained engagement)
			const freshness = Math.log(1 + hours / 24) / 2;

			// Resolution bonus: solved posts get a 20% boost
			const resolutionBonus = isSolved ? 1.2 : 1;

			// Discussion depth: posts with comments are more valuable than reaction-only
			const depthFactor = comments > 3 ? 1.15 : comments > 0 ? 1.05 : 1;

			const score = Math.round((quality + freshness) * resolutionBonus * depthFactor);

			return {
				score,
				breakdown: {
					support: net * 3,
					downvotes: down * 3,
					comments: comments * 2.5,
					freshness: Math.round(freshness * 10) / 10,
					resolution: isSolved ? "+20%" : "—",
					depth: depthFactor > 1 ? "+" + Math.round((depthFactor - 1) * 100) + "%" : "—",
				},
			};
		};

		// Full ranked lists (no hide_empty filter, no cap) — the source of truth
		// for BOTH the visible per-section lists AND the merged board. Pinned ids
		// resolve against these full lists so a pin can never silently no-op just
		// because the item ranks below the page cap or has zero support.
		// Fetch comment counts for all posts to enable discussion depth scoring
		const commentsTask = fetchCommentCounts(allPostIds);

		// ── Polls: ranked by total votes (independent leg of the fan-out) ───────
		let rankedPolls = [];
		const votesTask = (async () => {
		const pollIds = (pollRows || []).map((p) => p.id);
		if (pollIds.length) {
			try {
				const votes = [];
				for (let i = 0; i < pollIds.length; i += 100) {
					const slice = pollIds.slice(i, i + 100);
					const { data } = await supabase
						.from("poll_votes")
						.select("poll_id")
						.in("poll_id", slice);
					if (data) votes.push(...data);
				}
				const voteMap = {};
				(votes || []).forEach((v) => {
					voteMap[v.poll_id] = (voteMap[v.poll_id] || 0) + 1;
				});
				rankedPolls = (pollRows || [])
					.map((p) => ({ ...p, votes: voteMap[p.id] || 0 }))
					.filter((p) => !isTestArtifact(p.title))
					.filter((p) => (cfg.hide_empty ? p.votes > 0 : true))
					.sort((a, b) => b.votes - a.votes)
					.slice(0, LIMIT);
			} catch {
				/* non-fatal — leaderboard shows zero votes */
			}
		}
		})();


		// ── AI activity: recent agent executions + learning records ─
		// NOTE: uses real columns from agent_executions (started_at/agent_name/task —
		// there is no created_at/metadata) and agent_insights (insight_type/reasoning —
		// there is no title). Selecting non-existent columns makes PostgREST error,
		// which the old code swallowed and rendered an always-empty AI tab.
		let aiActivity = [];
		const aiTask = (async () => {
		try {
			// Guard each sub-query independently so one missing table can't sink the board.
			let execs = null;
			let learning = null;
			try {
				({ data: execs } = await supabase
					.from("agent_executions")
					.select("agent_id,agent_name,division,task,status,started_at")
					.order("started_at", { ascending: false })
					.limit(30));
			} catch {
				/* optional */
			}
			try {
				({ data: learning } = await supabase
					.from("agent_insights")
					.select("agent_id,insight_type,reasoning,created_at")
					.order("created_at", { ascending: false })
					.limit(20));
			} catch {
				/* optional */
			}
			aiActivity = [
				...(execs || []).map((e) => ({
					kind: "execution",
					label: e.agent_name || e.agent_id || "agent",
					detail: [e.task, e.division, e.status].filter(Boolean).join(" · "),
					at: e.started_at,
				})),
				...(learning || []).map((l) => ({
					kind: "learning",
					label: l.agent_id || "system",
					detail: (l.reasoning || l.insight_type || "").slice(0, 140),
					at: l.created_at,
				})),
			]
				.sort((a, b) => +new Date(b.at || 0) - +new Date(a.at || 0))
				.slice(0, 20);
		} catch {
			/* non-fatal — AI activity is supplementary */
		}
		})();

		// ── Fan-in: one join for the whole independent fan-out. ──
		await reactionsTask;
		const { counts: commentCounts, failed: commentsFailed } = await commentsTask;
		await votesTask;
		await aiTask;
		const countsDegraded = reactionsFailed || commentsFailed;

		const allProblems = (problems || [])
			.map((p) => {
				const support = supportOf(reactMap[p.id]);
				const down = downOf(reactMap[p.id]);
				const { score, breakdown } = computeScore(p, commentCounts[p.id], support, down);
				return { ...p, support, down, score, breakdown };
			})
			.filter((p) => !isTestArtifact(p.title))
			.sort((a, b) => (b.score || 0) - (a.score || 0));

		const allSuggestions = (suggestions || [])
			.map((s) => {
				const support = (reactMap[s.id]?.upvote || 0) + (reactMap[s.id]?.support || 0);
				const down = downOf(reactMap[s.id]);
				const { score, breakdown } = computeScore(s, commentCounts[s.id], support, down);
				return { ...s, support, down, score, breakdown };
			})
			.filter((s) => !isTestArtifact(s.title))
			.sort((a, b) => (b.score || 0) - (a.score || 0));

		const rankedProblems = allProblems
			.filter((p) => (cfg.hide_empty ? p.support > 0 : true))
			.slice(0, LIMIT);

		const rankedSuggestions = allSuggestions
			.filter((s) => (cfg.hide_empty ? s.support > 0 : true))
			.slice(0, LIMIT);


		// ── Aggregate leaderboard (merged, human + AI) ─────────────
		// Admin-pinned ids rise to the top (in the order they were listed);
		// remaining entries keep score order. Pins resolve against the FULL
		// ranked lists, so a pinned item always surfaces even under hide_empty
		// or when it sits below the per-section cap.
		const toMerged = (r, type) => ({
			type,
			id: r.id,
			title: r.title,
			score: r.score || r.support,
			breakdown: r.breakdown,
			category: r.category,
			status: r.status,
			at: r.created_at,
		});
		const mergedAll = [
			...allProblems.map((r) => toMerged(r, "problem")),
			...allSuggestions.map((r) => toMerged(r, "suggestion")),
			...rankedPolls.map((r) => ({
				type: "poll",
				id: r.id,
				title: r.title,
				score: r.votes,
				category: "Polls",
				status: r.archived ? "archived" : "open",
				at: r.created_at,
			})),
		].sort((a, b) => b.score - a.score);

		// Pins are explicit admin overrides: always included, always first.
		const pinned = cfg.pinned_ids
			.map((id) => mergedAll.find((m) => m.id === id))
			.filter(Boolean);
		const pinnedIds = new Set(pinned.map((m) => m.id));
		const unpinned = mergedAll.filter((m) => !pinnedIds.has(m.id));
		const visible = cfg.hide_empty ? unpinned.filter((m) => m.score > 0) : unpinned;
		const merged = [...pinned, ...visible].slice(0, cfg.page_size);

		return res.status(200).json({
			problems: rankedProblems,
			suggestions: rankedSuggestions,
			polls: rankedPolls,
			ai_activity: aiActivity,
			leaderboard: merged,
			generated_at: new Date().toISOString(),
			degraded: countsDegraded || undefined,
			estimated: countsDegraded || undefined,
		});
	} catch (err) {
		return sanitizeError(res, err, "leaderboard");
	}
}
