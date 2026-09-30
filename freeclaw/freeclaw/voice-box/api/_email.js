/**
 * Server-side Email Helper — sends emails via the free Resend path.
 *
 * Used by API routes (_posts.js, _polls.js, etc.) to send notification
 * emails when events happen (post solved, poll closed, alerts).
 *
 * The recipient is ALWAYS the real email the user saved in Settings
 * (/api/notify-prefs) — never a fake relay address. If the user never
 * saved an email or disabled email alerts, the send is skipped silently.
 *
 * Environment variables required (free Resend tier works):
 *   RESEND_API_KEY — Resend API key (https://resend.com, free tier)
 *   EMAIL_FROM     — sender, e.g. "VoiceBox <notifications@resend.dev>"
 *
 * All sends are fire-and-forget (best-effort) — email failures never
 * block the API response.
 */

import { sendEmail as dispatchEmail } from "./_dispatch.js";
import { getNotifyPrefs } from "./_notify-prefs.js";

/**
 * Whether server-side email can send (free Resend key present).
 * Kept as the single source of truth — api/_email-templates.js reports it.
 */
export function isEmailConfigured() {
	return !!process.env.RESEND_API_KEY;
}

/**
 * Resolve the real, opted-in email for an author, or null when there is
 * nothing to send to (no email saved, or email alerts disabled).
 */
async function recipientEmail(authorId) {
	try {
		const prefs = await getNotifyPrefs(authorId);
		if (prefs?.email_enabled && prefs.email) return prefs.email;
		return null;
	} catch {
		return null;
	}
}

/**
 * Send a post-solved notification email.
 * Called when an admin marks a post as solved.
 */
export async function sendPostSolvedEmail({ postTitle, postId, authorId, adminReply }) {
  const postUrl = `https://voicebox.app/post/${postId}`;
  const subject = `Voice Box: Your report "${(postTitle || "").slice(0, 60)}" has been solved!`;
  const message = [
    `Great news! Your report has been resolved.`,
    ``,
    `Title: ${postTitle || "Untitled"}`,
    adminReply ? `Admin reply: ${adminReply}` : ``,
    ``,
    `View your report: ${postUrl}`,
    ``,
    `Thank you for helping improve our community!`,
    `— Voice Box Team`,
  ]
    .filter(Boolean)
    .join("\n");

  // Fire-and-forget — don't block the API response
  const to = await recipientEmail(authorId);
  if (!to) return { queued: false, reason: "no_opted_in_email" };
  dispatchEmail(to, subject, message).catch((err) => { console.error("[email] send failed", { error: err?.message || String(err) }); });

  return { queued: true };
}

/**
 * Send a poll-closed notification email.
 * Called when a poll expires or is closed.
 */
export async function sendPollClosedEmail({ pollTitle, pollId, authorId, postId }) {
  const pollUrl = postId
    ? `https://voicebox.app/post/${postId}`
    : `https://voicebox.app`;
  const subject = `Voice Box: Your poll "${(pollTitle || "").slice(0, 60)}" has closed`;
  const message = [
    `Your poll has closed and results are in!`,
    ``,
    `Poll: ${pollTitle || "Untitled"}`,
    ``,
    `View results: ${pollUrl}`,
    ``,
    `— Voice Box Team`,
  ].join("\n");

  const to = await recipientEmail(authorId);
  if (!to) return { queued: false, reason: "no_opted_in_email" };
  dispatchEmail(to, subject, message).catch((err) => { console.error("[email] send failed", { error: err?.message || String(err) }); });

  return { queued: true };
}

/**
 * Send a system alert email to admins.
 * Called when workforce detects critical issues.
 */
export async function sendAlertEmail({ title, message, severity, url }) {
  const severityLabel =
    severity === "critical"
      ? "🔴 CRITICAL"
      : severity === "warning"
        ? "🟡 WARNING"
        : "ℹ️ INFO";

  const subject = `[${severityLabel}] Voice Box Alert: ${title}`;
  const body = [
    `${severityLabel}: ${title}`,
    ``,
    message || "No details provided.",
    ``,
    url ? `View details: ${url}` : ``,
    ``,
    `— Voice Box System`,
  ]
    .filter(Boolean)
    .join("\n");

  // Send to admin relay address
  sendEmail({
    toEmail: "admin@voicebox.local",
    toName: "Admin",
    subject,
    message: body,
  }).catch((err) => { console.error("[email] send failed", { domain: "voicebox.local", error: err?.message || String(err) }); });

  return { queued: true };
}
