// Memory API — HTTP handler for the Admin AI Memory panel.
//
// GET  /api/memory?action=list&limit=50        → { memories: [...] } across all agents
// GET  /api/memory?action=search&q=...         → { memories: [...] } filtered by content match
// GET  /api/memory?action=analytics&agent_id=X → { ...analytics }
//
// _memory.js exposes helper functions but is not an HTTP handler, so this
// module adapts it for the /api/memory route that AdminAI calls.

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { getMemoryAnalytics } from "./_memory.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		const action = req.query.action || "list";
		const limit = Math.min(parseInt(req.query.limit) || 50, 200);

		if (action === "analytics") {
			const agentId = String(req.query.agent_id || "general");
			const stats = await getMemoryAnalytics(agentId);
			return res.status(200).json(stats);
		}

		if (action === "search") {
			const q = String(req.query.q || "")
				.trim()
				.toLowerCase();
			if (!q) return res.status(200).json({ memories: [] });
			// Query recent memories then filter in-memory (robust across DB schemas).
			const { data } = await supabase
				.from("agent_memory")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(200);
			const memories = (data || [])
				.filter((m) => {
					const haystack = JSON.stringify(m.content || "").toLowerCase();
					const agent = String(m.agent_id || "").toLowerCase();
					return haystack.includes(q) || agent.includes(q);
				})
				.slice(0, limit);
			return res.status(200).json({ memories });
		}

		// action === 'list' (default)
		const { data, error } = await supabase
			.from("agent_memory")
			.select("*")
			.order("created_at", { ascending: false })
			.limit(limit);
		if (error) throw error;
		return res.status(200).json({ memories: data || [] });
	} catch (err) {
		return sanitizeError(res, err, "memory");
	}
}
