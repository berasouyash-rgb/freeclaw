// Public announcement banner — set by admin, visible to everyone

import { auditLog, clean, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			const { data } = await supabase
				.from("settings")
				.select("value")
				.eq("key", "announcement")
				.maybeSingle();
			// Cache: 60s — announcements change rarely
			res.setHeader(
				"Cache-Control",
				"public, max-age=60, s-maxage=60, stale-while-revalidate=30",
			);
			return res.status(200).json(data?.value || null);
		}

		if (req.method === "POST") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const b = req.body || {};
			if (b.clear) {
				// Delete the announcement row entirely (value is NOT NULL, can't set null)
				// The error MUST be checked: this is the platform-wide banner, and
				// an unchecked delete answered ok:true while the previous notice
				// stayed live for every user.
				const { error: clearErr } = await supabase
					.from("settings")
					.delete()
					.eq("key", "announcement");
				if (clearErr) throw clearErr;
				await auditLog("admin", "clear_announcement", "");
				return res.status(200).json({ ok: true, value: null });
			}
			const value = {
				text: clean(String(b.text || "").replace(/<[^>]*>/g, ""), 300),
				kind: ["info", "success", "warning"].includes(b.kind) ? b.kind : "info",
				at: new Date().toISOString(),
			};
			const { data: existing } = await supabase
				.from("settings")
				.select("key")
				.eq("key", "announcement")
				.maybeSingle();
			// An unchecked write here meant the admin saw their own text echoed
			// back with ok:true while every user kept seeing the PREVIOUS
			// banner — and the audit log recorded a publish that never landed.
			// Urgent notices are exactly the case that must not fail quietly.
			if (existing) {
				const { error: setErr } = await supabase
					.from("settings")
					.update({ value })
					.eq("key", "announcement");
				if (setErr) throw setErr;
			} else {
				const { error: insertErr } = await supabase
					.from("settings")
					.insert({ key: "announcement", value });
				if (insertErr) throw insertErr;
			}
			await auditLog("admin", "set_announcement", b.text || "");
			return res.status(200).json({ ok: true, value });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "announcement");
	}
}
