// Admin categories manager — settings-backed category list.
// GET /api/categories                     → { categories, source } (public)
// PUT /api/categories (admin only)        → { categories: string[] } replaces the stored list
//
// Persists in the settings table under key `categories` as
// { categories: [name, ...], updated_at } — same storage pattern as saved/notifications.
// Falls back to a default list when nothing has been customized yet.

import { clean, cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";

export const DEFAULT_CATEGORIES = [
	"Academics",
	"Facilities",
	"Food",
	"Bullying",
	"Teachers",
	"Events",
	"Transport",
	"Sports",
	"Technology",
	"Library",
	"Hostel",
	"Security",
	"Cleanliness",
	"Medical",
	"Other",
];

const KEY = "categories";
const MIN_CATEGORIES = 3;
const MAX_CATEGORIES = 30;
const MAX_NAME_LEN = 24;

async function getStored() {
	const { data } = await supabase
		.from("settings")
		.select("value")
		.eq("key", KEY)
		.maybeSingle();
	const list = data?.value?.categories;
	if (Array.isArray(list) && list.length >= MIN_CATEGORIES) {
		return { categories: list, source: "stored" };
	}
	return { categories: DEFAULT_CATEGORIES, source: "default" };
}

function normalize(raw) {
	if (!Array.isArray(raw))
		return { ok: false, error: "categories must be an array" };
	const seen = new Set();
	const out = [];
	for (const c of raw) {
		const name = clean(c, MAX_NAME_LEN).trim();
		if (!name) return { ok: false, error: "Category names cannot be empty" };
		const lower = name.toLowerCase();
		if (seen.has(lower)) continue;
		seen.add(lower);
		out.push(name);
	}
	if (out.length < MIN_CATEGORIES)
		return {
			ok: false,
			error: `At least ${MIN_CATEGORIES} categories are required`,
		};
	if (out.length > MAX_CATEGORIES)
		return {
			ok: false,
			error: `At most ${MAX_CATEGORIES} categories are allowed`,
		};
	return { ok: true, categories: out };
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method === "GET") {
			const { categories, source } = await getStored();
			res.setHeader("Cache-Control", "max-age=60, s-maxage=60");
			return res.status(200).json({ categories, source });
		}

		if (req.method === "PUT") {
			if (!(await isAdmin(req)))
				return res.status(403).json({ error: "Admin only" });
			const n = normalize((req.body || {}).categories);
			if (!n.ok) return res.status(400).json({ error: n.error });
			const value = {
				categories: n.categories,
				updated_at: new Date().toISOString(),
			};
			await supabase
				.from("settings")
				.upsert({ key: KEY, value }, { onConflict: "key" });
			return res
				.status(200)
				.json({ categories: n.categories, source: "stored" });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		console.error("categories error:", err.message);
		return res.status(500).json({ error: "Internal error" });
	}
}
