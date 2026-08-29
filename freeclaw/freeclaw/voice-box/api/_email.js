/**
 * Server-side Email Helper — sends emails via EmailJS REST API.
 *
 * Used by API routes (_posts.js, _polls.js, etc.) to send notification
 * emails when events happen (post solved, poll closed, alerts).
 *
 * Environment variables required:
 *   EMAILJS_SERVICE_ID   — EmailJS service ID
 *   EMAILJS_TEMPLATE_ID  — EmailJS template ID
 *   EMAILJS_PUBLIC_KEY   — EmailJS public key (for REST API auth)
 *   EMAILJS_PRIVATE_KEY  — EmailJS private key (for server-side sends)
 *
 * All sends are fire-and-forget (best-effort) — email failures never
 * block the API response.
 */

const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "";
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "";
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "";
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || "";

const EMAILJS_API_URL = "https://api.emailjs.com/api/v1.0/email/send";

/**
 * Check if email is configured and ready to send.
 */
export function isEmailConfigured() {
  return !!(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY && EMAILJS_PRIVATE_KEY);
}

/**
 * Send an email via EmailJS REST API.
 * Returns { ok: boolean, error?: string }
 */
async function sendEmail({ toEmail, toName, subject, message, fromName }) {
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email not configured" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(EMAILJS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: toEmail,
          to_name: toName || "",
          subject,
          message,
          from_name: fromName || "Voice Box",
          reply_to: toEmail,
        },
      }),
    }).finally(() => clearTimeout(timeout));

    if (response.ok) {
      return { ok: true };
    } else {
      const text = await response.text().catch(() => "Unknown error");
      return { ok: false, error: `EmailJS ${response.status}: ${text}` };
    }
  } catch (e) {
    return { ok: false, error: e.message || "Email send failed" };
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
  sendEmail({
    toEmail: `${authorId}@voicebox.local`, // Anonymous relay address
    toName: "Community Member",
    subject,
    message,
  }).catch(() => {
    /* email is best-effort */
  });

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

  sendEmail({
    toEmail: `${authorId}@voicebox.local`,
    toName: "Poll Creator",
    subject,
    message,
  }).catch(() => {
    /* email is best-effort */
  });

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
  }).catch(() => {
    /* email is best-effort */
  });

  return { queued: true };
}
