// ═══════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES ENDPOINT — /api/email-templates
// ═══════════════════════════════════════════════════════════════════
// Admin surface that previously 404'd, which left the Email Templates
// page permanently empty. This route is the server-side source of truth
// for the platform's outbound email templates.
//
//   GET  /api/email-templates
//        → { ok, templates: [...], overrides: n }
//
//   POST /api/email-templates  { action: "preview",    id, variables }
//        → { ok, subject, body }
//
//   POST /api/email-templates  { action: "test-send",  id, to_email, variables }
//        → { ok, error? }        (real send via EmailJS; honest failure)
//
//   PUT  /api/email-templates  { id, subject, body }
//        → { ok, templates: [...] }   (persists an override in `settings`)
//
// Edits are stored as an override map under the `settings` row keyed
// `email_template_overrides`, so the built-in defaults always remain
// recoverable. Nothing is faked: if EmailJS is not configured the test
// send reports the real reason instead of pretending to succeed.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";
import { isAdmin } from "./_auth.js";
import { isEmailConfigured } from "./_email.js";

const OVERRIDES_KEY = "email_template_overrides";

// ── Default templates (mirrors src/lib/emailTemplates.ts) ────────
const DEFAULT_TEMPLATES = [
	{
		id: "post-solved",
		name: "Post Solved",
		description: "Sent when an admin marks a report as solved",
		subject: 'Voice Box: Your report "{{post_title}}" has been solved!',
		body: `Great news! Your report has been resolved.

Title: {{post_title}}
{{#admin_reply}}
Admin reply: {{admin_reply}}
{{/admin_reply}}

View your report: {{post_url}}

Thank you for helping improve our community!
— Voice Box Team`,
		variables: ["post_title", "post_url", "admin_reply"],
		category: "notification",
	},
	{
		id: "poll-closed",
		name: "Poll Closed",
		description: "Sent when a poll expires or is closed by the creator",
		subject: 'Voice Box: Your poll "{{poll_title}}" has closed',
		body: `Your poll has closed and results are in!

Poll: {{poll_title}}

View results: {{poll_url}}

— Voice Box Team`,
		variables: ["poll_title", "poll_url"],
		category: "notification",
	},
	{
		id: "alert-critical",
		name: "Critical Alert",
		description: "Sent to admins when a critical system alert fires",
		subject: "[🔴 CRITICAL] Voice Box Alert: {{alert_title}}",
		body: `🔴 CRITICAL: {{alert_title}}

{{alert_message}}

{{#alert_url}}
View details: {{alert_url}}
{{/alert_url}}

— Voice Box System`,
		variables: ["alert_title", "alert_message", "alert_url"],
		category: "alert",
	},
	{
		id: "alert-warning",
		name: "Warning Alert",
		description: "Sent to admins when a warning-level alert fires",
		subject: "[🟡 WARNING] Voice Box Alert: {{alert_title}}",
		body: `🟡 WARNING: {{alert_title}}

{{alert_message}}

{{#alert_url}}
View details: {{alert_url}}
{{/alert_url}}

— Voice Box System`,
		variables: ["alert_title", "alert_message", "alert_url"],
		category: "alert",
	},
	{
		id: "alert-info",
		name: "Info Alert",
		description: "Sent to admins for informational alerts",
		subject: "[ℹ️ INFO] Voice Box Alert: {{alert_title}}",
		body: `ℹ️ INFO: {{alert_title}}

{{alert_message}}

{{#alert_url}}
View details: {{alert_url}}
{{/alert_url}}

— Voice Box System`,
		variables: ["alert_title", "alert_message", "alert_url"],
		category: "alert",
	},
	{
		id: "welcome",
		name: "Welcome Email",
		description: "Sent to new users when they first sign up",
		subject: "Welcome to Voice Box! 🎉",
		body: `Welcome to Voice Box!

You're now part of a community that speaks up and gets things fixed.

Here's what you can do:
• Report problems anonymously
• Suggest improvements
• Vote on community polls
• Track the status of your reports

Get started: {{app_url}}

— Voice Box Team`,
		variables: ["app_url"],
		category: "marketing",
	},
];

const EXAMPLE_VARIABLES = {
	"post-solved": {
		post_title: "Broken elevator in Building A",
		post_url: "https://voicebox.app/post/abc123",
		admin_reply: "Fixed by maintenance team on July 20th",
	},
	"poll-closed": {
		poll_title: "Should we install solar panels?",
		poll_url: "https://voicebox.app/post/poll456",
	},
	"alert-critical": {
		alert_title: "Security breach detected",
		alert_message: "Unauthorized access attempt from unknown IP",
		alert_url: "https://voicebox.app/admin/alerts/789",
	},
	"alert-warning": {
		alert_title: "High error rate detected",
		alert_message: "API error rate exceeded 5% threshold",
		alert_url: "https://voicebox.app/admin/alerts/101",
	},
	"alert-info": {
		alert_title: "Scheduled maintenance",
		alert_message: "System update scheduled for 2:00 AM UTC",
		alert_url: "https://voicebox.app/admin/alerts/202",
	},
	welcome: { app_url: "https://voicebox.app" },
};

// ── Rendering ───────────────────────────────────────────────────

function interpolate(text, vars) {
	let result = String(text || "").replace(
		/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
		(_, key, content) => (vars[key] ? content : ""),
	);
	result = result.replace(/\{\{(\w+)\}\}/g, (_, key) =>
		vars[key] ?? `{{${key}}}`,
	);
	return result;
}

function render(template, vars) {
	return {
		subject: interpolate(template.subject, vars),
		body: interpolate(template.body, vars),
	};
}

// ── Storage ─────────────────────────────────────────────────────

async function readOverrides() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", OVERRIDES_KEY)
			.maybeSingle();
		const value = data?.value;
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
}

async function writeOverrides(map) {
	const { data } = await supabase
		.from("settings")
		.select("key")
		.eq("key", OVERRIDES_KEY)
		.maybeSingle();
	if (data)
		await supabase.from("settings").update({ value: map }).eq("key", OVERRIDES_KEY);
	else await supabase.from("settings").insert({ key: OVERRIDES_KEY, value: map });
}

function mergeTemplates(overrides) {
	return DEFAULT_TEMPLATES.map((t) => {
		const o = overrides[t.id];
		return o && typeof o === "object"
			? { ...t, subject: o.subject ?? t.subject, body: o.body ?? t.body }
			: t;
	});
}

// ── Handler ─────────────────────────────────────────────────────

export default async function handler(req, res) {
	try {
		// P0: preview/test-send/overwrite were reachable with no auth — an
		// open email relay (burns EmailJS quota/reputation) plus global
		// template tampering. Writes and sends require a real admin session;
		// GET (read-only defaults) stays public for the admin UI bootstrap.
		if (
			(req.method === "POST" || req.method === "PUT") &&
			!(await isAdmin(req))
		) {
			return res
				.status(403)
				.json({ ok: false, error: "Admin only" });
		}
		if (req.method === "GET") {
			const overrides = await readOverrides();
			return res.status(200).json({
				ok: true,
				templates: mergeTemplates(overrides),
				overrides: Object.keys(overrides).length,
				email_configured: isEmailConfigured(),
			});
		}

		if (req.method === "POST") {
			const body = req.body || {};
			const action = body.action;
			const template = mergeTemplates(await readOverrides()).find(
				(t) => t.id === body.id,
			);
			if (!template)
				return res.status(404).json({ ok: false, error: "Unknown template" });

			const vars =
				body.variables && typeof body.variables === "object"
					? body.variables
					: EXAMPLE_VARIABLES[template.id] || {};

			if (action === "preview") {
				return res.status(200).json({ ok: true, ...render(template, vars) });
			}

			if (action === "test-send") {
				const to = String(body.to_email || "").trim();
				if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
					return res
						.status(400)
						.json({ ok: false, error: "A valid recipient email is required" });
				}
				if (!isEmailConfigured()) {
					return res.status(200).json({
						ok: false,
						error:
							"Email is not configured on this deployment (RESEND_API_KEY).",
					});
				}
				const { subject, body: message } = render(template, vars);
				try {
					const {
						EMAILJS_SERVICE_ID,
						EMAILJS_TEMPLATE_ID,
						EMAILJS_PUBLIC_KEY,
						EMAILJS_PRIVATE_KEY,
					} = process.env;
					const r = await fetch(
						"https://api.emailjs.com/api/v1.0/email/send",
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								service_id: EMAILJS_SERVICE_ID,
								template_id: EMAILJS_TEMPLATE_ID,
								user_id: EMAILJS_PUBLIC_KEY,
								accessToken: EMAILJS_PRIVATE_KEY,
								template_params: {
									to_email: to,
									to_name: "Admin",
									subject,
									message,
									from_name: "Voice Box",
									reply_to: to,
								},
							}),
						},
					);
					if (!r.ok) {
						const text = await r.text().catch(() => "");
						return res
							.status(200)
							.json({ ok: false, error: `EmailJS ${r.status}: ${text}`.slice(0, 300) });
					}
					return res.status(200).json({ ok: true });
				} catch (e) {
					return res
						.status(200)
						.json({ ok: false, error: e?.message || "Send failed" });
				}
			}

			return res
				.status(400)
				.json({ ok: false, error: `Unsupported action: ${action}` });
		}

		if (req.method === "PUT") {
			const body = req.body || {};
			if (!body.id || typeof body.subject !== "string" || typeof body.body !== "string") {
				return res
					.status(400)
					.json({ ok: false, error: "id, subject and body are required" });
			}
			const base = DEFAULT_TEMPLATES.find((t) => t.id === body.id);
			if (!base)
				return res.status(404).json({ ok: false, error: "Unknown template" });

			const overrides = await readOverrides();
			overrides[body.id] = {
				subject: body.subject.slice(0, 300),
				body: body.body.slice(0, 20000),
			};
			await writeOverrides(overrides);
			return res
				.status(200)
				.json({ ok: true, templates: mergeTemplates(overrides) });
		}

		res.setHeader("Allow", "GET, POST, PUT");
		return res.status(405).json({ ok: false, error: "method not allowed" });
	} catch (e) {
		return res.status(500).json({
			ok: false,
			error: e instanceof Error ? e.message : "Email template operation failed",
		});
	}
}
