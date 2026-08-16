// RAG API — HTTP handler for the Admin AI Knowledge Base (KB) panel.
//
// POST /api/rag  { query, limit?, category? } → { results: [{id,title,content,category,tags,confidence,...}] }
//
// _rag.js exposes helper functions but is not an HTTP handler, so this
// module adapts it for the /api/rag route that AdminAI's KB tab calls.

import { cors, isAdmin } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import { searchKB } from "./_rag.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "POST")
		return res.status(405).json({ error: "POST only" });

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		const b = req.body || {};
		const query = String(b.query || "")
			.trim()
			.slice(0, 500);
		if (!query) return res.status(400).json({ error: "Missing query" });

		const limit = Math.min(parseInt(b.limit) || 10, 25);
		const results = await searchKB(query, {
			limit,
			category: b.category ? String(b.category) : undefined,
		});
		return res.status(200).json({ results, count: results.length, query });
	} catch (err) {
		return sanitizeError(res, err, "rag");
	}
}
