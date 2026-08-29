/**
 * Email Template System — defines, stores, and renders email templates
 * for the admin preview/customization page.
 *
 * Templates use {{variable}} syntax for interpolation.
 * Each template has: subject, body, and available variables.
 */

export interface EmailTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  body: string;
  variables: string[];
  category: "notification" | "alert" | "marketing";
}

export interface EmailTemplateVariable {
  key: string;
  label: string;
  example: string;
}

// ─── Default Templates ──────────────────────────────────────────

export const DEFAULT_TEMPLATES: EmailTemplate[] = [
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

// ─── Template Rendering ─────────────────────────────────────────

/**
 * Render an email template with the given variables.
 * Supports {{variable}} and {{#variable}}...{{/variable}} for conditionals.
 */
export function renderTemplate(
  template: EmailTemplate,
  variables: Record<string, string>,
): { subject: string; body: string } {
  return {
    subject: interpolate(template.subject, variables),
    body: interpolate(template.body, variables),
  };
}

/**
 * Interpolate {{variable}} and conditional blocks {{#var}}...{{/var}}
 */
function interpolate(text: string, vars: Record<string, string>): string {
  // First: handle conditional blocks {{#var}}...{{/var}}
  let result = text.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key, content) => {
      const value = vars[key];
      return value ? content : "";
    },
  );

  // Second: replace simple {{variable}} placeholders
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] ?? `{{${key}}}`;
  });

  return result;
}

/**
 * Get example variables for previewing a template
 */
export function getExampleVariables(templateId: string): Record<string, string> {
  const examples: Record<string, Record<string, string>> = {
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
    welcome: {
      app_url: "https://voicebox.app",
    },
  };

  return examples[templateId] || {};
}

/**
 * Get category color for styling
 */
export function getCategoryColor(category: EmailTemplate["category"]): string {
  switch (category) {
    case "notification":
      return "text-accent bg-accent/10 border-accent/25";
    case "alert":
      return "text-warn bg-warn/10 border-warn/25";
    case "marketing":
      return "text-good bg-good/10 border-good/25";
    default:
      return "text-ink3 bg-surface2 border-border";
  }
}
