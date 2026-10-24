// Anonymity guardian — continuous tripwire that anonymous case data
// cannot be linked to identity. Deterministic and read-only (it never
// mutates user data; on a finding it alerts + audits and a human acts).
//
// Probes, every tick:
// 1. Schema surface: one live post row + one comment row must contain NO
//    identity-linkable columns (ip, session, token, fingerprint, email,
//    phone, user-agent). A new column leaking in = finding.
// 2. Mask integrity: the outbound PII masker must still scrub a synthetic
//    email/phone/address sample (catches masking regressions).
// Any finding → one admin alert (keyed, deduped while unresolved).
// Clean sweep → silent (no news is good news; the tick reports checked).
import supabase from "./_db-client.js";
import { auditLog } from "./_auth.js";
import { maskPII } from "./_moderation.js";

const IDENTITY_KEYS = [
	"ip",
	"ip_address",
	"client_ip",
	"session",
	"session_id",
	"token",
	"fingerprint",
	"user_agent",
	"useragent",
	"email",
	"phone",
];
const ALERT_KEY = "workforce_alerts";
const ALERT_MAX = 100;

function identityKeysPresent(row) {
	if (!row || typeof row !== "object") return [];
	return IDENTITY_KEYS.filter((k) => row[k] !== undefined && row[k] !== null);
}

async function readAlerts(client) {
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", ALERT_KEY)
			.maybeSingle();
		return Array.isArray(data?.value?.alerts) ? data.value.alerts : [];
	} catch {
		return [];
	}
}

export async function checkAnonymity(client = supabase, maskFn = maskPII) {
	const result = { checked: 0, findings: [], errors: [] };
	const findings = [];
	try {
		const { data: post, error: e1 } = await client
			.from("posts")
			.select("*")
			.limit(1)
			.maybeSingle();
		if (e1) throw e1;
		result.checked += 1;
		for (const k of identityKeysPresent(post)) {
			findings.push({ surface: "posts", key: k });
		}
		const { data: comment, error: e2 } = await client
			.from("comments")
			.select("*")
			.limit(1)
			.maybeSingle();
		if (e2) throw e2;
		result.checked += 1;
		for (const k of identityKeysPresent(comment)) {
			findings.push({ surface: "comments", key: k });
		}
	} catch (err) {
		return { ...result, ok: false, error: err.message };
	}

	// Mask integrity probe with synthetic PII (never real user data).
	try {
		const sample =
			"reach me at jane.doe@example.com or 555-123-4567, 12 Park Street";
		const masked = maskFn(sample);
		if (
			typeof masked !== "string" ||
			masked.includes("jane.doe@example.com") ||
			masked.includes("555-123-4567") ||
			masked.includes("12 Park Street")
		) {
			findings.push({ surface: "maskPII", key: "redaction-bypass" });
		}
		result.checked += 1;
	} catch (err) {
		findings.push({ surface: "maskPII", key: "threw:" + err.message });
	}
	result.findings = findings;

	if (!findings.length) return { ok: true, ...result };

	const alerts = await readAlerts(client);
	let raised = 0;
	for (const f of findings) {
		const key = `anon-leak:${f.surface}:${f.key}`;
		if (alerts.some((a) => a.key === key && !a.resolved_at)) continue;
		alerts.unshift({
			key,
			severity: "critical",
			title: `Anonymity leak: identity field "${f.key}" present on ${f.surface}`,
			body: "Anonymous case data is linkable to identity. Investigate before more data accumulates.",
			agent: "anonymity-guardian",
			created_at: new Date().toISOString(),
			occurrences: 1,
		});
		raised += 1;
	}
	if (raised > 0) {
		await client.from("settings").upsert(
			{
				key: ALERT_KEY,
				value: { alerts: alerts.slice(0, ALERT_MAX), updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);
		try {
			await auditLog(
				"anonymity-guardian",
				"leak_detected",
				findings.map((f) => `${f.surface}.${f.key}`).join(", "),
			);
		} catch {
			/* audit is best-effort */
		}
	}
	return { ok: true, ...result, raised };
}
