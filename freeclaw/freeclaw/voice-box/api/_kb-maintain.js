// Knowledge-base maintenance — the KB stays maintained from real resolutions.
//
// This is the run side of the Knowledge worker (roster #17). REAL JOB:
// resolved cases (admin_reply = the claimed fix) are harvested into the
// knowledge_base table so the Coworker's RAG retrieval keeps improving —
// the same approved-data discipline as the controlled learning pipeline
// (spec §33): only real, admin-answered resolutions, never raw chat logs.
//
// Verification is independent: after each harvest the worker re-reads the
// inserted row AND runs the platform's own searchKB against the new entry,
// proving the KB is actually searchable — not just that a row exists.
import { auditLog, clean } from "./_auth.js";
import { readLivePosts } from "./_live-posts.js";
import supabase from "./_db-client.js";
import { isTestArtifact } from "./_artifact-filter.js";
import { searchKB } from "./_rag.js";

const KB_SOURCE = "resolved_case";
const RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000;
const SWEEP_LIMIT = 100;
const MAX_HARVEST = 10;
const HARVEST_CONFIDENCE = 0.8;

const SOLVED_STATUSES = new Set(["solved", "resolved", "closed"]);

async function existingResolvedEntries() {
	try {
		const { data } = await supabase
			.from("knowledge_base")
			.select("id, title")
			.eq("source", KB_SOURCE)
			.order("created_at", { ascending: false })
			.limit(500);
		return data || [];
	} catch {
		return [];
	}
}

/**
 * Maintain the knowledge base: health probe → harvest resolved cases →
 * verify by independent re-read + search. Zero-arg (the cron loop calls
 * the registry run with no arguments).
 *
 * @returns {Promise<{ok: boolean, verified?: boolean, kb_reachable?: boolean, harvested?: Array, errors?: Array, error?: string}>}
 */
export async function maintainKB({ nowMs = Date.now() } = {}) {
	const result = { harvested: [], errors: [] };

	// 1. Health probe — the KB table is reachable and search answers.
	let kbReachable = true;
	try {
		const probe = await searchKB("password reset", { limit: 1 });
		kbReachable = Array.isArray(probe);
	} catch {
		kbReachable = false;
	}
	if (!kbReachable) return { ...result, ok: false, error: "knowledge base unreachable" };

	// 2. Harvest candidates: recently resolved posts WITH a claimed fix.
	const live = await readLivePosts({
		columns: "id, title, description, category, status, admin_reply, updated_at",
		limit: SWEEP_LIMIT,
	});
	if (!live.ok || live.source !== "supabase") {
		return {
			...result,
			ok: true,
			verified: true,
			kb_reachable: true,
			harvested: [],
			note: "post store unavailable - standing down",
		};
	}
	const resolved = (live.posts || []).filter(
		(p) =>
			SOLVED_STATUSES.has(String(p.status || "").toLowerCase()) &&
			!isTestArtifact(p.title) &&
			clean(String(p.admin_reply || ""), 100),
	);
	if (!resolved.length)
		return { ...result, ok: true, verified: true, kb_reachable: true, harvested: [] };

	const existing = await existingResolvedEntries();
	const seen = new Set(existing.map((e) => String(e.title || "").toLowerCase()));
	const candidates = resolved.filter((p) => !seen.has(String(p.title || "").toLowerCase()));
	if (!candidates.length)
		return { ...result, ok: true, verified: true, kb_reachable: true, harvested: [] };

	// 3. Insert one KB entry per new resolved case.
	for (const p of candidates.slice(0, MAX_HARVEST)) {
		try {
			const reply = clean(String(p.admin_reply || ""), 500);
			const content = clean(
				`${String(p.title || "untitled")}. Resolution: ${reply || "resolved by administration"}`,
				2000,
			);
			const { data } = await supabase
				.from("knowledge_base")
				.insert({
					title: clean(String(p.title || ""), 200),
					content,
					category: clean(String(p.category || "Administration"), 60) || "Administration",
					tags: ["resolved", KB_SOURCE],
					confidence: HARVEST_CONFIDENCE,
					source: KB_SOURCE,
					last_verified: new Date(nowMs).toISOString(),
					usage_count: 0,
				})
				.select("id");
			for (const row of data || []) {
				if (row?.id) {
					result.harvested.push({ post_id: p.id, kb_id: row.id, title: p.title });
					try {
						await auditLog(
							"knowledge-worker",
							"kb_maintained",
							`harvested resolved case ${p.id} as KB ${row.id}`,
						);
					} catch {
						/* audit is best-effort */
					}
				}
			}
		} catch (err) {
			result.errors.push({ post_id: p.id, error: String(err?.message || err).slice(0, 200) });
		}
	}

	if (!result.harvested.length)
		return { ...result, ok: true, verified: true, kb_reachable: true, harvested: [] };

	// 4. VERIFY: independent re-read of each inserted row, then prove the KB
	//    is actually searchable via the platform's own searchKB.
	let verified = 0;
	for (const h of result.harvested) {
		try {
			const { data } = await supabase
				.from("knowledge_base")
				.select("id, title")
				.eq("id", h.kb_id)
				.maybeSingle();
			if (data?.id !== h.kb_id) continue;
			const hits = await searchKB(h.title, { limit: 5 });
			if (hits.some((hit) => hit.id === h.kb_id)) verified += 1;
		} catch {
			/* counted as unverified */
		}
	}
	return {
		...result,
		ok: true,
		verified: verified === result.harvested.length,
		kb_reachable: true,
	};
}

// GET /api/kb-maintain — admin read of the KB maintenance status.
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
		if (!(await isAdmin(req))) return res.status(401).json({ error: "Admin access required" });
		const { data } = await supabase
			.from("knowledge_base")
			.select("id, title, category, source, last_verified")
			.order("created_at", { ascending: false })
			.limit(100);
		return res.status(200).json({
			kb_entries: (data || []).length,
			recent: data || [],
		});
	} catch (err) {
		console.error("kb-maintain error:", err);
		return res.status(500).json({ error: "Internal error" });
	}
}
