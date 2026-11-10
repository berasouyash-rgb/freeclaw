// ─── Spam Analysis Endpoint ─────────────────────────────────────
// Exposes real spam detection data to the admin dashboard.
// GET /api/spam — returns recent spam detections, scores, and signals.
// POST /api/spam — manually analyze a text sample (admin testing).
//
// Both verbs are admin-only. The GET response carries quarantined posts
// including `author_id`, and VoiceFlow is an anonymous platform — leaking
// that pairing to a non-admin deanonymizes users, so the check is not
// optional. This route is also listed as ADMIN_ONLY in _auth-matrix.js so
// the gate runs before the handler as well.
import { securityCheck } from "./_security.js";
import { isAdmin } from "./_auth.js";
import { spamAnalyze, cleanupSpamData } from "./_moderation.js";
import supabase from "./_db-client.js";

// In-memory recent detections (persists across requests in same instance)
const _recentDetections = [];
const MAX_DETECTIONS = 50;

export function recordSpamDetection(detection) {
	_recentDetections.unshift(detection);
	if (_recentDetections.length > MAX_DETECTIONS) _recentDetections.pop();
}

export default async function handler(req, res) {
	// securityCheck returns { ok, status, error, retryAfter } — enforce it
	// properly instead of comparing the whole object to null (which never
	// matched, so abusive traffic was never actually limited).
	const sec = securityCheck(req);
	if (!sec.ok) {
		if (sec.retryAfter) res.setHeader("Retry-After", String(sec.retryAfter));
		return res.status(sec.status || 429).json({ error: sec.error || "rate limited" });
	}

	// Admin-only. GET returns quarantined posts with author_id plus audit
	// entries; POST is a manual analyzer used for admin testing. Fail closed.
	if (!(await isAdmin(req))) {
		return res.status(403).json({ error: "forbidden" });
	}

	// ── GET /api/spam — admin reads spam data ────────────────────
	if (req.method === "GET") {
		cleanupSpamData();

		// Fetch recent quarantined posts from DB
		const { data: quarantined } = await supabase
			.from("posts")
			.select("id, title, category, status, author_id, created_at, status_history")
			.eq("status", "pending_review")
			.order("created_at", { ascending: false })
			.limit(30);

		// Fetch recent audit trail spam entries
		const { data: auditEntries } = await supabase
			.from("activity_logs")
			.select("id, action, detail, created_at")
			.eq("actor", "spam")
			.order("created_at", { ascending: false })
			.limit(30);

		return res.status(200).json({
			ok: true,
			recent_detections: _recentDetections,
			quarantined_posts: quarantined || [],
			audit_entries: auditEntries || [],
			summary: {
				detections_24h: _recentDetections.filter(
					(d) => Date.now() - new Date(d.timestamp).getTime() < 86400000
				).length,
				quarantined: (quarantined || []).length,
			},
		});
	}

	// ── POST /api/spam — manually analyze text (admin testing) ────
	if (req.method === "POST") {
		const { text, title, description, author_id, ip } = req.body || {};
		const t = title || text || "";
		const d = description || "";
		const result = spamAnalyze(t, d, author_id || "admin-test", ip || "127.0.0.1");

		recordSpamDetection({
			text: `${t} ${d}`.slice(0, 200),
			spam_score: result.spam_score,
			action: result.action,
			signals: result.signals,
			timestamp: new Date().toISOString(),
			source: "manual_admin_test",
		});

		return res.status(200).json({ ok: true, result });
	}

	res.setHeader("Allow", "GET, POST");
	res.status(405).json({ error: "method not allowed" });
}
