// Contributor badges — a user's contribution profile and earned badges.
// GET /api/badges?anon_id=X
// Returns: { counts, total, badges } where each badge has an `earned` flag.
// Badges are deterministic from the user's own contribution counts.

import { clean, cors } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

const BADGES = [
	{
		id: "first-post",
		name: "First Voice",
		emoji: "📣",
		description: "Posted for the first time",
	},
	{
		id: "active-voice",
		name: "Active Voice",
		emoji: "🎙️",
		description: "10+ posts & comments",
	},
	{
		id: "reaction-lead",
		name: "Reaction Lead",
		emoji: "⚡",
		description: "25+ reactions given",
	},
	{
		id: "poll-hub",
		name: "Poll Hub",
		emoji: "🗳️",
		description: "Voted in 5+ polls",
	},
	{
		id: "curator",
		name: "Curator",
		emoji: "🔖",
		description: "Saved 3+ posts",
	},
	{
		id: "connector",
		name: "Connector",
		emoji: "🔗",
		description: "Followed 3+ threads",
	},
	{
		id: "cornerstone",
		name: "Cornerstone",
		emoji: "🏛️",
		description: "50+ total contributions",
	},
];

async function settingsList(key, field) {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", key)
		.maybeSingle();
	const value = data?.value;
	if (Array.isArray(value?.[field])) return value[field];
	if (Array.isArray(value)) return value;
	return [];
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET")
		return res.status(405).json({ error: "Method not allowed" });

	try {
		const anonId = clean(req.query.anon_id, 40);
		if (!anonId) return res.status(400).json({ error: "Missing anon_id" });
		const id = anonId.toLowerCase();

		const [posts, comments, reactions, pollVotes, saved, follows] =
			await Promise.all([
				supabase.from("posts").select("id").eq("author_id", id),
				supabase.from("comments").select("id").eq("author_id", id),
				supabase.from("reactions").select("id").eq("author_id", id),
				supabase.from("poll_votes").select("id").eq("author_id", id),
				settingsList(`saved:${id}`, "saved"),
				settingsList(`follows:${id}`, "follows"),
			]);

		const counts = {
			posts: posts?.data?.length || 0,
			comments: comments?.data?.length || 0,
			reactions: reactions?.data?.length || 0,
			poll_votes: pollVotes?.data?.length || 0,
			saved: saved.length,
			follows: follows.length,
		};
		const total =
			counts.posts +
			counts.comments +
			counts.reactions +
			counts.poll_votes +
			counts.saved +
			counts.follows;

		const badges = BADGES.map((b) => {
			let earned = false;
			switch (b.id) {
				case "first-post":
					earned = counts.posts >= 1;
					break;
				case "active-voice":
					earned = counts.posts + counts.comments >= 10;
					break;
				case "reaction-lead":
					earned = counts.reactions >= 25;
					break;
				case "poll-hub":
					earned = counts.poll_votes >= 5;
					break;
				case "curator":
					earned = counts.saved >= 3;
					break;
				case "connector":
					earned = counts.follows >= 3;
					break;
				case "cornerstone":
					earned = total >= 50;
					break;
			}
			return { ...b, earned };
		});

		return res.status(200).json({ counts, total, badges });
	} catch (err) {
		return sanitizeError(res, err, "badges");
	}
}
