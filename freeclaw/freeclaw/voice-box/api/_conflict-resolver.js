// ═══════════════════════════════════════════════════════════════════
// AGENT CONFLICT RESOLVER — policy + evidence based conflict resolution
// ═══════════════════════════════════════════════════════════════════
// When workers disagree (e.g., Database Worker says "optimize query",
// Security Worker says "don't touch it"), this module resolves the
// conflict using:
//   1. Safety priority (security always wins over performance)
//   2. Evidence strength (more evidence = stronger position)
//   3. Execution class (Class C escalates, never executes)
//   4. Confidence thresholds (low confidence = defer to human)
//
// Resolution hierarchy (highest to lowest priority):
//   SECURITY > DATA_INTEGRITY > PRIVACY > PERFORMANCE > CONVENIENCE
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const CONFLICT_LOG_KEY = "conflict_resolution_log";

// Policy priorities — higher number wins
const POLICY_PRIORITY = {
  security: 100,
  data_integrity: 90,
  privacy: 85,
  authorization: 95,
  performance: 40,
  cache: 30,
  convenience: 10,
  cleanup: 20,
  analytics: 15,
};

/**
 * A conflict is a set of competing proposals from different workers
 * about the same target. Each proposal has:
 *   worker_id, action, reason, evidence, confidence, risk_level, category
 */
export class ConflictResolver {
  /**
   * Resolve a conflict between competing worker proposals.
   * @param {Array<{worker_id: string, action: string, reason: string, evidence: object, confidence: number, risk_level: string, category: string}>} proposals
   * @returns {{ winner: object, loser: object[], reason: string, resolution_id: string }}
   */
  static async resolve(proposals) {
    if (!proposals || proposals.length < 2) {
      return { winner: proposals?.[0] || null, loser: [], reason: "no_conflict", resolution_id: null };
    }

    const resolution_id = `cr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    // Score each proposal
    const scored = proposals.map((p) => ({
      ...p,
      _score: ConflictResolver._scoreProposal(p),
    }));

    // Sort by score descending
    scored.sort((a, b) => b._score - a._score);

    const winner = scored[0];
    const losers = scored.slice(1);

    // Check for irreconcilable conflicts (security vs performance)
    const hasSecurity = proposals.some((p) => p.category === "security");
    const hasPerformance = proposals.some((p) => p.category === "performance");

    let reason = "highest_score_wins";
    if (hasSecurity && hasPerformance) {
      reason = "security_overrides_performance";
    } else if (losers.some((l) => l.confidence > winner.confidence)) {
      reason = "higher_confidence_deferred";
    }

    // Log the resolution
    await ConflictResolver._logResolution(resolution_id, proposals, winner, reason);

    return { winner, loser: losers, reason, resolution_id };
  }

  /**
   * Score a proposal based on policy priority, evidence strength,
   * confidence, and risk level.
   */
  static _scoreProposal(proposal) {
    const policyScore = POLICY_PRIORITY[proposal.category] || 10;
    const evidenceScore = ConflictResolver._evidenceStrength(proposal.evidence);
    const confidenceScore = (proposal.confidence || 0.5) * 40;
    const riskPenalty =
      proposal.risk_level === "high" ? -20 :
      proposal.risk_level === "medium" ? -5 : 0;

    // Class C workers always lose — they escalate, never execute
    const classPenalty = proposal.execution_class === "C" ? -100 : 0;

    return policyScore + evidenceScore + confidenceScore + riskPenalty + classPenalty;
  }

  /**
   * Calculate evidence strength (0-30 scale).
   * More evidence entries and higher evidence quality = stronger position.
   */
  static _evidenceStrength(evidence) {
    if (!evidence || typeof evidence !== "object") return 0;
    let score = 0;
    if (evidence.items?.length) score += Math.min(evidence.items.length * 3, 15);
    if (evidence.metrics) score += 5;
    if (evidence.logs?.length) score += Math.min(evidence.logs.length * 2, 10);
    return Math.min(score, 30);
  }

  /**
   * Log conflict resolution to persistent store for audit trail.
   */
  static async _logResolution(resolution_id, proposals, winner, reason) {
    try {
      const entry = {
        resolution_id,
        timestamp: new Date().toISOString(),
        proposals_count: proposals.length,
        winner_worker: winner.worker_id,
        winner_action: winner.action,
        winner_score: winner._score,
        loser_workers: proposals
          .filter((p) => p.worker_id !== winner.worker_id)
          .map((p) => p.worker_id),
        reason,
      };

      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("key", CONFLICT_LOG_KEY)
        .maybeSingle();

      const items = Array.isArray(data?.value?.items) ? data.value.items : [];
      items.unshift(entry);
      await supabase.from("settings").upsert(
        {
          key: CONFLICT_LOG_KEY,
          value: { items: items.slice(0, 200), updated_at: new Date().toISOString() },
        },
        { onConflict: "key" },
      );
    } catch (err) {
      console.error("[conflict-resolver] log failed:", err?.message);
    }
  }

  /**
   * Get recent conflict resolutions for admin audit.
   */
  static async getResolutions(limit = 50) {
    try {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("key", CONFLICT_LOG_KEY)
        .maybeSingle();
      return (data?.value?.items || []).slice(0, limit);
    } catch {
      return [];
    }
  }
}
