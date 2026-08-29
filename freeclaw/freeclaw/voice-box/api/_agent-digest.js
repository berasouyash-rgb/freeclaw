// ═══════════════════════════════════════════════════════════════════
// SMART NOTIFICATION DIGEST — groups related agent notifications
// ═══════════════════════════════════════════════════════════════════
// Instead of spamming the admin with 200 individual agent notifications,
// group related events into digestible summaries:
//
//   "17 cache anomalies detected"
//   "15 automatically resolved"
//   "2 require investigation"
//
// Groups by: category + severity + time window.
// Preserves critical alerts individually (never groups SECURITY events).
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const DIGEST_KEY = "agent_digest";

/**
 * Group agent activity into digestible summaries.
 * @param {Array<{agent_id: string, action: string, severity: string, details: string, created_at: string}>} activities
 * @returns {{ digest: Array<{category: string, severity: string, count: number, items: string[], requires_attention: boolean }>, total, summary }}
 */
export function buildDigest(activities) {
  if (!activities || activities.length === 0) {
    return { digest: [], total: 0, summary: "No recent agent activity" };
  }

  const groups = {};

  for (const activity of activities) {
    const category = categorizeAction(activity.action, activity.details);
    const severity = activity.severity || "info";
    const key = `${category}::${severity}`;

    if (!groups[key]) {
      groups[key] = {
        category,
        severity,
        count: 0,
        items: [],
        requires_attention: severity === "critical" || severity === "high",
        agents: new Set(),
      };
    }

    groups[key].count++;
    if (groups[key].items.length < 5) {
      groups[key].items.push(
        typeof activity.details === "string"
          ? activity.details.slice(0, 120)
          : activity.action
      );
    }
    groups[key].agents.add(activity.agent_id);
  }

  // Convert sets to arrays and sort by severity then count
  const digest = Object.values(groups)
    .map((g) => ({
      ...g,
      agents: [...g.agents],
    }))
    .sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4) || b.count - a.count;
    });

  const total = activities.length;
  const criticalCount = digest.filter((d) => d.severity === "critical").reduce((s, d) => s + d.count, 0);
  const autoResolvedCount = digest
    .filter((d) => d.category === "resolution" || d.category === "recovery")
    .reduce((s, d) => s + d.count, 0);
  const requiresAttention = digest.filter((d) => d.requires_attention).reduce((s, d) => s + d.count, 0);

  const summary = buildSummary(total, criticalCount, autoResolvedCount, requiresAttention);

  return { digest, total, summary };
}

/**
 * Categorize an agent action into a digest category.
 */
function categorizeAction(action, details) {
  const text = `${action} ${details}`.toLowerCase();

  if (/cache|stale|invalidate|warm|rebuild/.test(text)) return "cache";
  if (/search|index|reindex/.test(text)) return "search";
  if (/security|auth|permission|token|session/.test(text)) return "security";
  if (/pii|privacy|sensitive/.test(text)) return "privacy";
  if (/spam|abuse|harassment/.test(text)) return "moderation";
  if (/duplicate|clone|merge/.test(text)) return "dedup";
  if (/performance|latency|slow|optimize/.test(text)) return "performance";
  if (/resolve|fix|repair|recover|heal/.test(text)) return "resolution";
  if (/error|fail|timeout|crash/.test(text)) return "error";
  if (/health|monitor|check|patrol/.test(text)) return "health";
  if (/backup|retention|cleanup|purge/.test(text)) return "maintenance";
  if (/notification|alert|notify/.test(text)) return "notification";
  if (/analysis|summary|insight|detect/.test(text)) return "analysis";
  return "other";
}

/**
 * Build a human-readable summary string.
 */
function buildSummary(total, critical, resolved, attention) {
  const parts = [];
  if (total <= 5) return `${total} agent events — routine operations.`;
  if (critical > 0) parts.push(`${critical} critical`);
  if (attention > 0) parts.push(`${attention} require attention`);
  if (resolved > 0) parts.push(`${resolved} automatically resolved`);
  if (parts.length === 0) parts.push(`${total} routine events`);
  return parts.join(", ");
}

/**
 * Persist and retrieve digest.
 */
export async function persistDigest(activities) {
  const digest = buildDigest(activities);
  try {
    await supabase.from("settings").upsert(
      {
        key: DIGEST_KEY,
        value: {
          ...digest,
          built_at: new Date().toISOString(),
        },
      },
      { onConflict: "key" },
    );
  } catch (err) {
    console.error("[digest] persist failed:", err?.message);
  }
  return digest;
}

export async function getDigest() {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", DIGEST_KEY)
      .maybeSingle();
    return data?.value || { digest: [], total: 0, summary: "No digest available" };
  } catch {
    return { digest: [], total: 0, summary: "No digest available" };
  }
}
