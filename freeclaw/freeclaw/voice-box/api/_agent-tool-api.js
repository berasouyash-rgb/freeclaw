// Tool Registry API — HTTP handler for the Admin AI Tools panel.
//
// GET  /api/tool-registry?action=list          → { tools: [{name,description,category,permissions,parameters,requiresApproval}] }
//
// Wires the in-process _tool-registry.js (a module with exported helpers,
// not an HTTP handler) to a route so AdminAI's Tools tab can load.
// Role is derived from admin auth — same pattern as v3/_tools.js, so
// anonymous visitors only ever see the public read-only tool surface.

import { cors, isAdmin } from "./_auth.js";
import { sanitizeError } from "./_error.js";
import { getToolsForRole } from "./_agent-tool-registry.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();
	if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

	try {
		const action = req.query.action || "list";
		if (action !== "list")
			return res.status(400).json({ error: `Unknown action: ${action}` });

		// Admin gets the full capability surface; everyone else only the shared
		// read-only tools. Never expose admin-only tool metadata to anonymous users.
		const admin = await isAdmin(req);
		const tools = getToolsForRole(admin ? "admin" : "student");

		const payload = tools.map((t) => ({
			name: t.name,
			description: t.description,
			category: t.category,
			permissions: t.permissions,
			parameters: t.parameters || {},
			requiresApproval: t.requiresApproval || false,
		}));

		res.setHeader(
			"Cache-Control",
			admin ? "private, no-cache" : "public, max-age=30, s-maxage=30",
		);
		return res.status(200).json({ tools: payload, count: payload.length });
	} catch (err) {
		return sanitizeError(res, err, "tool-registry");
	}
}
