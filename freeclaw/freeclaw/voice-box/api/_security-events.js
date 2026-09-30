// ═══════════════════════════════════════════════════════════════════
// SECURITY EVENTS ENDPOINT — GET /api/security?action=events
// ═══════════════════════════════════════════════════════════════════
// Serves REAL security events recorded by the platform's audit logger.
//
// Every security event written by `log.security(...)` in _audit.js lands in
// the `audit_logs` table with:
//     action        = "security.<event>"   e.g. "security.rate_limit_abuse"
//     resource_type = "security"
//     details.level = "WARN"
//
// This endpoint reads those rows and normalises them into the shape the
// admin Security Center expects. Nothing here is simulated — if there are
// no rows, the endpoint returns an empty list and the UI shows an honest
// empty state.
// ═══════════════════════════════════════════════════════════════════

import { queryAuditLogs } from "./_audit.js";
import { isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";

// Map a raw audit action → the event type the UI knows how to render,
// plus a severity derived from the recorded detail when available.
const TYPE_MAP = {
	"security.rate_limit_abuse": { type: "rate.limit", severity: "medium" },
	"security.hourly_limit_abuse": { type: "rate.limit", severity: "medium" },
	"security.error_abuse": { type: "abuse.detected", severity: "high" },
	"security.injection_detected": { type: "injection.detected", severity: "critical" },
	"security.prompt_injection": { type: "injection.detected", severity: "high" },
	"security.auth_failure": { type: "auth.failure", severity: "high" },
	"security.permission_denied": { type: "permission.denied", severity: "medium" },
	"security.pii_detected": { type: "pii.detected", severity: "medium" },
	"security.suspicious_activity": { type: "suspicious.activity", severity: "high" },
	"security.scan": { type: "security.scan", severity: "info" },
};

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

function normaliseSeverity(raw) {
	if (!raw) return null;
	const s = String(raw).toLowerCase();
	if (s === "warn" || s === "warning") return "medium";
	if (s === "error" || s === "err") return "high";
	if (s === "fatal" || s === "crit") return "critical";
	return SEVERITIES.has(s) ? s : null;
}

function humanise(event) {
	// "rate_limit_abuse" → "Rate limit abuse"
	return String(event || "")
		.replace(/[._]+/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.trim();
}

function toEvent(row) {
	const action = String(row.action || "");
	const detail = row.details && typeof row.details === "object" ? row.details : {};
	const key = action.toLowerCase();
	const mapped = TYPE_MAP[key] || {};

	const eventName = action.startsWith("security.")
		? action.slice("security.".length)
		: action;

	const severity =
		normaliseSeverity(detail.severity) ||
		normaliseSeverity(detail.level) ||
		mapped.severity ||
		"info";

	// Build a factual description from the recorded evidence — never invented.
	const bits = [];
	if (detail.identity) bits.push(`identity ${String(detail.identity).slice(0, 24)}`);
	if (detail.ip) bits.push(`ip ${String(detail.ip).slice(0, 45)}`);
	if (typeof detail.requests_per_minute === "number")
		bits.push(`${detail.requests_per_minute} req/min`);
	if (typeof detail.requests_per_hour === "number")
		bits.push(`${detail.requests_per_hour} req/hour`);
	if (typeof detail.errors_per_minute === "number")
		bits.push(`${detail.errors_per_minute} errors/min`);
	if (typeof detail.patterns_matched === "number")
		bits.push(`${detail.patterns_matched} pattern(s) matched`);
	if (detail.reason) bits.push(String(detail.reason).slice(0, 120));

	const description = bits.length
		? `${humanise(eventName)} — ${bits.join(", ")}`
		: humanise(eventName);

	return {
		id: String(row.id ?? `${row.timestamp}-${action}`),
		type: mapped.type || `security.${eventName}`,
		severity,
		source: detail.source || row.actor_type || "system",
		description,
		target: detail.target || detail.identity || undefined,
		action_taken: detail.action_taken || undefined,
		created_at: row.timestamp || row.created_at || new Date().toISOString(),
	};
}

// ─── Security Operations Worker (roster #36) ───────────────────
// REAL JOB: read the REAL security audit events (the same queryAuditLogs
// read the Security Center serves), analyze them, and flag unresolved
// high-severity events for human review — persisted to the canonical
// settings KV (security_ops:latest) and verified by re-read. Zero-arg
// (the cron loop calls the registry run with no arguments). An empty
// read degrades to an honest nothing-to-analyze; a failed read reports
// a failure — never "protected" without evidence.
const SECURITY_OPS_KEY = "security_ops:latest";
const OPS_ACTOR = "worker:security-ops";
const UNRESOLVED_SEVERITIES = new Set(["high", "critical"]);

export async function runSecurityOps({ nowMs = Date.now() } = {}) {
	// 1. Real read: recent security events from the audit trail.
	let rows;
	try {
		rows = await queryAuditLogs({ resourceType: "security", limit: 200, offset: 0 });
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
	const events = (rows || [])
		.map(toEvent)
		.filter(Boolean)
		.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

	// 2. Honest no-op: no security events recorded yet — no fabricated
	//    "clean" snapshot, no KV write.
	if (events.length === 0)
		return {
			ok: true,
			verified: true,
			events_scanned: 0,
			flagged: [],
			note: "no security events recorded yet - nothing to analyze",
		};

	// 3. Analyze: unresolved high/critical events (no recorded action_taken).
	const flagged = events
		.filter((e) => UNRESOLVED_SEVERITIES.has(e.severity) && !e.action_taken)
		.slice(0, 25);

	// 4. Advisory row when high-severity events are unresolved (best-effort).
	if (flagged.length > 0) {
		try {
			await supabase.from("activity_logs").insert({
				actor: OPS_ACTOR,
				action: "security_ops_report",
				detail: JSON.stringify({
					events_scanned: events.length,
					flagged: flagged
						.map((f) => ({ id: f.id, type: f.type, severity: f.severity }))
						.slice(0, 10),
				}).slice(0, 500),
			});
		} catch {
			/* advisory; a failed log must not fabricate a report */
		}
	}

	// 5. Persist + VERIFY by independent re-read.
	const snapshot = {
		generated_at: new Date(nowMs).toISOString(),
		events_scanned: events.length,
		by_severity: events.reduce((acc, e) => {
			acc[e.severity] = (acc[e.severity] || 0) + 1;
			return acc;
		}, {}),
		flagged,
		unresolved_high: flagged.length,
	};
	try {
		await supabase
			.from("settings")
			.upsert({ key: SECURITY_OPS_KEY, value: snapshot }, { onConflict: "key" });
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", SECURITY_OPS_KEY)
			.maybeSingle();
		const persisted = data?.value?.generated_at === snapshot.generated_at;
		return { ok: true, verified: persisted, events_scanned: events.length, flagged: flagged.length, snapshot };
	} catch (err) {
		return { ok: false, error: String(err?.message || err).slice(0, 200) };
	}
}

export default async function handler(req, res) {
	if (req.method !== "GET") {
		res.setHeader("Allow", "GET");
		return res.status(405).json({ error: "method not allowed" });
	}

	// AUTHORIZATION: the audit log is read through the service-role client,
	// so RLS does not protect it. Without this gate ANY anonymous caller
	// could read up to 500 security rows — client IPs, request/error rates,
	// the identities being flagged, and injection/PII detection details.
	// Security Center and the admin dashboard are the only consumers; both
	// run in an admin context.
	if (!(await isAdmin(req))) {
		return res.status(403).json({ error: "Admin only" });
	}

	const action = req.query?.action || "events";
	if (action !== "events") {
		return res.status(400).json({ error: `Unsupported action: ${action}` });
	}

	const limit = Math.min(Number(req.query?.limit) || 200, 500);

	try {
		// resourceType + no action filter: _audit's helper lowercases the
		// `action` ilike pattern, so we filter by resource type instead.
		const rows = await queryAuditLogs({
			resourceType: "security",
			limit,
			offset: 0,
		});

		const events = (rows || [])
			.map(toEvent)
			.filter(Boolean)
			.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

		return res.status(200).json({ ok: true, events, count: events.length });
	} catch (e) {
		// Surface the real failure instead of pretending there is no data.
		return res.status(200).json({
			ok: false,
			events: [],
			error: e instanceof Error ? e.message : "Failed to load security events",
		});
	}
}
