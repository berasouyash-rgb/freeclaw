/**
 * Email Service — Sends emails via EmailJS.
 *
 * Uses EmailJS browser SDK for client-side email sending.
 * No server-side email infrastructure needed.
 *
 * Setup required:
 * 1. Create account at https://www.emailjs.com/
 * 2. Create an email service (Gmail, Outlook, etc.)
 * 3. Create email templates
 * 4. Set environment variables:
 *    - VITE_EMAILJS_PUBLIC_KEY
 *    - VITE_EMAILJS_SERVICE_ID
 *    - VITE_EMAILJS_TEMPLATE_ID
 */

import emailjs from "@emailjs/browser";

// ─── Configuration ──────────────────────────────────────────────

// Read env vars at call time so vi.stubEnv and dynamic config changes take effect.
function getConfig() {
  return {
    publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY || "",
    serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID || "",
    templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID || "",
  };
}

let _initialized = false;

/**
 * Initialize EmailJS with the public key.
 * Safe to call multiple times — only initializes once.
 */
export function initEmailJS(): void {
  const { publicKey } = getConfig();
  if (_initialized || !publicKey) return;
  try {
    emailjs.init(publicKey);
    _initialized = true;
  } catch (e) {
    console.warn("[EmailJS] Init failed:", e);
  }
}

// ─── Email Types ────────────────────────────────────────────────

export interface EmailParams {
  to_email: string;
  to_name?: string;
  subject: string;
  message: string;
  from_name?: string;
  reply_to?: string;
}

export interface ReportEmailParams {
  to_email: string;
  to_name?: string;
  report_title: string;
  report_category: string;
  report_status: string;
  report_url: string;
}

export interface AlertEmailParams {
  to_email: string;
  alert_title: string;
  alert_severity: "info" | "warning" | "critical";
  alert_message: string;
  alert_url?: string;
}

export interface NotificationEmailParams {
  to_email: string;
  notification_title: string;
  notification_body: string;
  notification_url?: string;
}

// ─── Send Functions ─────────────────────────────────────────────

/**
 * Send a generic email.
 * Returns { success, error? }
 */
export async function sendEmail(
  params: EmailParams,
): Promise<{ success: boolean; error?: string }> {
  const { publicKey, serviceId, templateId } = getConfig();
  if (!publicKey || !serviceId || !templateId) {
    return { success: false, error: "EmailJS not configured" };
  }

  initEmailJS();

  try {
    const result = await emailjs.send(
      serviceId,
      templateId,
      {
        to_email: params.to_email,
        to_name: params.to_name || "",
        subject: params.subject,
        message: params.message,
        from_name: params.from_name || "Voice Flow",
        reply_to: params.reply_to || params.to_email,
      },
    );

    return { success: result.status === 200 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Email send failed";
    console.error("[EmailJS] Send failed:", msg);
    return { success: false, error: msg };
  }
}

/**
 * Send a report notification email.
 */
export async function sendReportEmail(
  params: ReportEmailParams,
): Promise<{ success: boolean; error?: string }> {
  return sendEmail({
    to_email: params.to_email,
    to_name: params.to_name,
    subject: `Voice Flow: Report "${params.report_title}" — ${params.report_status}`,
    message: [
      `Your report has been updated.`,
      ``,
      `Title: ${params.report_title}`,
      `Category: ${params.report_category}`,
      `Status: ${params.report_status}`,
      ``,
      `View your report: ${params.report_url}`,
      ``,
      `— Voice Flow Team`,
    ].join("\n"),
  });
}

/**
 * Send an alert email (security, system, etc.).
 */
export async function sendAlertEmail(
  params: AlertEmailParams,
): Promise<{ success: boolean; error?: string }> {
  const severityLabel =
    params.alert_severity === "critical"
      ? "🔴 CRITICAL"
      : params.alert_severity === "warning"
        ? "🟡 WARNING"
        : "ℹ️ INFO";

  return sendEmail({
    to_email: params.to_email,
    subject: `[${severityLabel}] ${params.alert_title}`,
    message: [
      `${severityLabel}: ${params.alert_title}`,
      ``,
      params.alert_message,
      ``,
      params.alert_url ? `View details: ${params.alert_url}` : "",
      ``,
      `— Voice Flow System`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

/**
 * Send a notification email (status update, reply, etc.).
 */
export async function sendNotificationEmail(
  params: NotificationEmailParams,
): Promise<{ success: boolean; error?: string }> {
  return sendEmail({
    to_email: params.to_email,
    subject: `Voice Flow: ${params.notification_title}`,
    message: [
      params.notification_title,
      ``,
      params.notification_body,
      ``,
      params.notification_url ? `View: ${params.notification_url}` : "",
      ``,
      `— Voice Flow Team`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

// ─── Batch Sending ──────────────────────────────────────────────

/**
 * Send emails to multiple recipients.
 * Returns summary of successes and failures.
 */
export async function sendBatchEmails(
  recipients: string[],
  params: Omit<EmailParams, "to_email">,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const email of recipients) {
    const result = await sendEmail({ ...params, to_email: email });
    if (result.success) {
      sent++;
    } else {
      failed++;
      if (result.error) errors.push(`${email}: ${result.error}`);
    }
  }

  return { sent, failed, errors };
}

// ─── Utility ────────────────────────────────────────────────────

/**
 * Check if EmailJS is configured and ready.
 */
export function isEmailConfigured(): boolean {
  const { publicKey, serviceId, templateId } = getConfig();
  return !!(publicKey && serviceId && templateId);
}
