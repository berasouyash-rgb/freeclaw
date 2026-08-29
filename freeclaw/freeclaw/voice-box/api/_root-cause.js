// ═══════════════════════════════════════════════════════════════════
// ROOT-CAUSE ENGINE — determines WHY metrics changed
// ═══════════════════════════════════════════════════════════════════
// Instead of: "42 complaints about login"
// Determines: "37/42 occurred after authentication-service latency increased"
//
// Uses temporal correlation and category analysis to identify
// the most likely root cause of metric changes.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const ROOT_CAUSE_KEY = "root_cause_analysis";

/**
 * Analyze a metric change and identify likely root causes.
 * @param {string} metric - e.g., "complaints", "resolution_time", "engagement"
 * @param {string} period - e.g., "24h", "7d", "30d"
 * @returns {{ metric, change, causes: Array<{factor: string, impact: number, evidence: string[]}> }}
 */
export async function analyzeRootCause(metric = "complaints", period = "24h") {
  const periodMs = parsePeriod(period);
  const now = Date.now();
  const cutoff = now - periodMs;
  const prevCutoff = cutoff - periodMs;

  const causes = [];

  switch (metric) {
    case "complaints":
    case "reports": {
      // Get recent complaints
      const { data: recent } = await supabase
        .from("posts")
        .select("id, category, status, priority, created_at, description")
        .eq("type", "problem")
        .eq("deleted", false)
        .gte("created_at", new Date(cutoff).toISOString())
        .order("created_at", { ascending: false });

      const { data: previous } = await supabase
        .from("posts")
        .select("id, category, status, created_at")
        .eq("type", "problem")
        .eq("deleted", false)
        .gte("created_at", new Date(prevCutoff).toISOString())
        .lt("created_at", new Date(cutoff).toISOString());

      const recentCount = recent?.length || 0;
      const prevCount = previous?.length || 0;
      const change = prevCount > 0 ? ((recentCount - prevCount) / prevCount) * 100 : 0;

      // Analyze category breakdown
      const recentCats = {};
      const prevCats = {};
      (recent || []).forEach((p) => {
        const cat = p.category || "uncategorized";
        recentCats[cat] = (recentCats[cat] || 0) + 1;
      });
      (previous || []).forEach((p) => {
        const cat = p.category || "uncategorized";
        prevCats[cat] = (prevCats[cat] || 0) + 1;
      });

      // Find categories with disproportionate increase
      for (const [cat, count] of Object.entries(recentCats)) {
        const prevCount = prevCats[cat] || 0;
        if (count > prevCount * 1.5 && count >= 3) {
          const factorImpact = Math.round((count / recentCount) * 100);
          causes.push({
            factor: `${cat} complaints increased`,
            impact: factorImpact,
            evidence: [
              `${count} complaints in this period vs ${prevCount} previously`,
              `${factorImpact}% of all complaints this period`,
              `Increase of ${Math.round(((count - Math.max(prevCount, 1)) / Math.max(prevCount, 1)) * 100)}%`,
            ],
          });
        }
      }

      // Check for priority spikes
      const criticalCount = (recent || []).filter((p) => p.priority === "critical").length;
      if (criticalCount > 0) {
        causes.push({
          factor: `${criticalCount} critical-priority complaints`,
          impact: Math.round((criticalCount / Math.max(recentCount, 1)) * 100),
          evidence: [`${criticalCount} of ${recentCount} complaints marked critical`],
        });
      }

      // Check temporal clustering (same-day spikes)
      const dayCounts = {};
      (recent || []).forEach((p) => {
        const day = p.created_at.slice(0, 10);
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      });
      const maxDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
      if (maxDay && maxDay[1] > recentCount * 0.3) {
        causes.push({
          factor: `Spike on ${maxDay[0]}`,
          impact: Math.round((maxDay[1] / Math.max(recentCount, 1)) * 100),
          evidence: [`${maxDay[1]} complaints on a single day (${Math.round((maxDay[1] / Math.max(recentCount, 1)) * 100)}% of total)`],
        });
      }

      const result = {
        metric: "complaints",
        period,
        current_count: recentCount,
        previous_count: prevCount,
        change_percent: Math.round(change),
        causes: causes.sort((a, b) => b.impact - a.impact),
        analyzed_at: new Date().toISOString(),
      };

      // Persist
      await persistAnalysis(result);
      return result;
    }

    case "resolution_time":
    case "resolution": {
      // Analyze resolution time trends
      const { data: solved } = await supabase
        .from("posts")
        .select("id, category, created_at, updated_at, status")
        .eq("type", "problem")
        .eq("status", "solved")
        .eq("deleted", false)
        .gte("updated_at", new Date(cutoff).toISOString())
        .order("updated_at", { ascending: false })
        .limit(200);

      const { data: prevSolved } = await supabase
        .from("posts")
        .select("id, category, created_at, updated_at")
        .eq("type", "problem")
        .eq("status", "solved")
        .eq("deleted", false)
        .gte("updated_at", new Date(prevCutoff).toISOString())
        .lt("updated_at", new Date(cutoff).toISOString())
        .limit(200);

      const avgResolutionMs = (items) => {
        if (!items?.length) return 0;
        return items.reduce((sum, p) => {
          return sum + (new Date(p.updated_at).getTime() - new Date(p.created_at).getTime());
        }, 0) / items.length;
      };

      const currentAvg = avgResolutionMs(solved);
      const prevAvg = avgResolutionMs(prevSolved);
      const change = prevAvg > 0 ? ((currentAvg - prevAvg) / prevAvg) * 100 : 0;

      // Category-level resolution time
      const catTimes = {};
      (solved || []).forEach((p) => {
        const cat = p.category || "uncategorized";
        if (!catTimes[cat]) catTimes[cat] = [];
        catTimes[cat].push(new Date(p.updated_at).getTime() - new Date(p.created_at).getTime());
      });

      for (const [cat, times] of Object.entries(catTimes)) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const avgHours = Math.round(avg / 3600000);
        if (avg > currentAvg * 1.5 && times.length >= 2) {
          causes.push({
            factor: `${cat} has slower resolution`,
            impact: Math.round((avg / Math.max(currentAvg, 1)) * 50),
            evidence: [
              `Average resolution: ${avgHours}h (vs platform avg ${Math.round(currentAvg / 3600000)}h)`,
              `${times.length} issues in this category`,
            ],
          });
        }
      }

      const result = {
        metric: "resolution_time",
        period,
        current_avg_hours: Math.round(currentAvg / 3600000),
        previous_avg_hours: Math.round(prevAvg / 3600000),
        change_percent: Math.round(change),
        causes: causes.sort((a, b) => b.impact - a.impact),
        analyzed_at: new Date().toISOString(),
      };

      await persistAnalysis(result);
      return result;
    }

    default:
      return { metric, period, causes: [], error: `Unknown metric: ${metric}` };
  }
}

function parsePeriod(period) {
  const match = period.match(/^(\d+)(h|d|w)$/);
  if (!match) return 24 * 3600000;
  const n = parseInt(match[1]);
  switch (match[2]) {
    case "h": return n * 3600000;
    case "d": return n * 86400000;
    case "w": return n * 7 * 86400000;
    default: return 24 * 3600000;
  }
}

async function persistAnalysis(result) {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", ROOT_CAUSE_KEY)
      .maybeSingle();

    const history = Array.isArray(data?.value?.history) ? data.value.history : [];
    history.unshift(result);
    await supabase.from("settings").upsert(
      {
        key: ROOT_CAUSE_KEY,
        value: { latest: result, history: history.slice(0, 50), updated_at: new Date().toISOString() },
      },
      { onConflict: "key" },
    );
  } catch (err) {
    console.error("[root-cause] persist failed:", err?.message);
  }
}

export async function getLatestAnalysis() {
  try {
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", ROOT_CAUSE_KEY)
      .maybeSingle();
    return data?.value || { latest: null, history: [] };
  } catch {
    return { latest: null, history: [] };
  }
}
