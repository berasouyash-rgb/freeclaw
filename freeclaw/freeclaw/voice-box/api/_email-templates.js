/**
 * Email Templates API — CRUD for email templates with admin-only access.
 *
 * GET    /api/email-templates              → list all templates
 * GET    /api/email-templates?id=xxx       → get single template
 * PUT    /api/email-templates              → update template
 * POST   /api/email-templates/preview      → preview rendered template
 * POST   /api/email-templates/test-send    → send test email
 *
 * Templates are stored in the settings table under key "email_templates".
 */

import { cors, isAdmin, rateLimited, sanitizeError } from "./_auth.js";
import supabase from "./_db-client.js";
import { sendEmail } from "./_email.js";

const TEMPLATES_KEY = "email_templates";

// ─── Default templates (fallback if none stored) ────────────────

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

// ─── Helpers ────────────────────────────────────────────────────

async function getTemplates() {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", TEMPLATES_KEY)
    .maybeSingle();
  return data?.value?.templates || DEFAULT_TEMPLATES;
}

async function saveTemplates(templates) {
  const { error } = await supabase
    .from("settings")
    .upsert(
      {
        key: TEMPLATES_KEY,
        value: { templates, updated_at: new Date().toISOString() },
      },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}

function interpolate(text, vars) {
  // Handle conditional blocks {{#var}}...{{/var}}
  let result = text.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, content) => (vars[key] ? content : ""),
  );
  // Replace simple {{variable}} placeholders
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  return result;
}

// ─── Handler ────────────────────────────────────────────────────

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (!(await isAdmin(req)))
      return res.status(403).json({ error: "Admin only" });

    // ── GET: list or get single ──
    if (req.method === "GET") {
      const templates = await getTemplates();
      const { id } = req.query || {};
      if (id) {
        const t = templates.find((t) => t.id === id);
        if (!t) return res.status(404).json({ error: "Template not found" });
        return res.status(200).json(t);
      }
      return res.status(200).json({ templates });
    }

    // ── PUT: update template ──
    if (req.method === "PUT") {
      const { id, subject, body, name, description } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing template id" });

      const templates = await getTemplates();
      const idx = templates.findIndex((t) => t.id === id);
      if (idx === -1) return res.status(404).json({ error: "Template not found" });

      if (subject !== undefined) templates[idx].subject = subject;
      if (body !== undefined) templates[idx].body = body;
      if (name !== undefined) templates[idx].name = name;
      if (description !== undefined) templates[idx].description = description;

      // Re-extract variables from the updated template
      const varMatches = new Set();
      const allText = (templates[idx].subject || "") + " " + (templates[idx].body || "");
      const re = /\{\{#?(\w+)\}\}/g;
      let m;
      while ((m = re.exec(allText))) varMatches.add(m[1]);
      templates[idx].variables = [...varMatches];

      await saveTemplates(templates);
      return res.status(200).json(templates[idx]);
    }

    // ── POST: preview or test-send ──
    if (req.method === "POST") {
      const { action, id, variables, to_email } = req.body || {};

      if (action === "preview") {
        if (!id) return res.status(400).json({ error: "Missing template id" });
        const templates = await getTemplates();
        const t = templates.find((t) => t.id === id);
        if (!t) return res.status(404).json({ error: "Template not found" });

        return res.status(200).json({
          subject: interpolate(t.subject, variables || {}),
          body: interpolate(t.body, variables || {}),
        });
      }

      if (action === "test-send") {
        if (!id) return res.status(400).json({ error: "Missing template id" });
        if (!to_email) return res.status(400).json({ error: "Missing to_email" });

        const templates = await getTemplates();
        const t = templates.find((t) => t.id === id);
        if (!t) return res.status(404).json({ error: "Template not found" });

        const subject = interpolate(t.subject, variables || {});
        const body = interpolate(t.body, variables || {});

        const result = await sendEmail({
          toEmail: to_email,
          toName: "Admin Test",
          subject: `[TEST] ${subject}`,
          message: body,
        });

        return res.status(200).json(result);
      }

      return res.status(400).json({ error: "Invalid action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[email-templates] Error:", err.message);
    return sanitizeError(res, err, "email-templates");
  }
}
