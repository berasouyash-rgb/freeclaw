// ═══════════════════════════════════════════════════════════════
// Improvement Queue — the 24/7 hidden agent workforce's suggestion desk.
// ═══════════════════════════════════════════════════════════════
// Background scan agents audit the platform (content health, security
// posture, database hygiene, performance, community/UX) and silently queue
// SUGGESTIONS here. Nothing is ever applied automatically: every item waits
// for an explicit admin decision (approve/dismiss) in the admin desk.
//
// Storage: settings table, key `improvement_queue`, value:
//   { items: [{ id, title, detail, category, priority, source,
//               status: 'pending'|'approved'|'dismissed', created_at,
//               decided_at? }], updated_at }
// Bounded to MAX_ITEMS; duplicates collapse by title+category within 14 days.
// ═══════════════════════════════════════════════════════════════

import { clean, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";

const KEY = "improvement_queue";
const MAX_ITEMS = 200;
const DEDUPE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

async function readQueue() {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", KEY)
		.maybeSingle();
	return {
		items: Array.isArray(data?.value?.items) ? data.value.items : [],
	};
}

async function writeQueue(items) {
	await supabase.from("settings").upsert(
		{
			key: KEY,
			value: { items, updated_at: new Date().toISOString() },
		},
		{ onConflict: "key" },
	);
}

/** Queue one suggestion. Internal-agent safe: never throws. Dedupes and caps. */
export async function queueImprovement({
	title,
	detail,
	category = "general",
	priority = "medium",
	source = "scanner",
}) {
	try {
		if (!title || typeof title !== "string") return false;
		const { items } = await readQueue();
		const now = Date.now();
		const norm = title.toLowerCase().trim();
		const dupe = items.some(
			(it) =>
				it.title.toLowerCase().trim() === norm &&
				it.category === category &&
				now - new Date(it.created_at).getTime() < DEDUPE_WINDOW_MS,
		);
		if (dupe) return false;
		const item = {
			id: `imp_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
			title: String(title).slice(0, 160),
			detail: String(detail || "").slice(0, 800),
			category: String(category).slice(0, 40),
			priority: ["high", "medium", "low"].includes(priority)
				? priority
				: "medium",
			source: String(source).slice(0, 60),
			status: "pending",
			created_at: new Date().toISOString(),
		};
		// Newest first, hard cap (drop oldest dismissed first, then oldest).
		let next = [item, ...items];
		if (next.length > MAX_ITEMS) {
			const keep = next.filter((it) => it.status !== "dismissed");
			next = keep.length >= MAX_ITEMS ? keep.slice(0, MAX_ITEMS) : next.slice(0, MAX_ITEMS);
		}
		await writeQueue(next);
		return true;
	} catch (err) {
		console.warn("[improvements] queueImprovement failed:", err?.message);
		return false;
	}
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		if (req.method === "GET") {
			const { items } = await readQueue();
			const pending = items.filter((it) => it.status === "pending");
			const decided = items.filter((it) => it.status !== "pending");
			return res.status(200).json({ pending, decided });
		}

		if (req.method === "POST") {
			const b = req.body || {};
			const action = clean(b.action, 30);
			const { items } = await readQueue();

			if (action === "approve" || action === "dismiss") {
				const idx = items.findIndex((it) => it.id === b.id);
				if (idx < 0) return res.status(404).json({ error: "Not found" });
				items[idx].status =
					action === "approve" ? "approved" : "dismissed";
				items[idx].decided_at = new Date().toISOString();
				await writeQueue(items);
				return res.status(200).json({ ok: true, item: items[idx] });
			}

			if (action === "clear_decided") {
				await writeQueue(items.filter((it) => it.status === "pending"));
				return res.status(200).json({ ok: true });
			}

			return res.status(400).json({ error: "Unknown action" });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "improvements");
	}
}
