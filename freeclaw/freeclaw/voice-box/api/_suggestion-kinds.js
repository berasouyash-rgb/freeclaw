// ═══════════════════════════════════════════════════════════════════
// Shared suggestion-kind registry (backend)
// ═══════════════════════════════════════════════════════════════════
// Single source of truth for which suggestion kinds map to a real
// executable action in api/_agent.js's approve handler. Used by:
//   - api/_agent.js      (approve guard + advisory auto-expiry)
//   - api/_agent-team.js (choke point: only executable kinds enter the
//                         approval queue)
// Free-text / advisory kinds (LLM-invented 'enforcement'/'policy'/'trend')
// have NO approve action — approving them would be a silent no-op, so they
// must never be inserted as pending approvable work and age out fast.
export const EXECUTABLE_SUGGESTION_KINDS = [
	"escalation",
	"status_change",
	"solved_confirm",
	"reply",
	"merge",
	"user_warn",
	"user_suspend",
	"hide_comment",
	"resolve_report",
	"review_decision",
];

/** Kinds produced by the proactive detection engine (_proactive.js) with
 *  their own UI (AiPanel) — legitimate detections, NOT LLM noise. They are
 *  advisory in the approval panel but must keep the standard 48h retention
 *  (their suggestedActions are rendered in AiPanel, not the approval queue). */
export const PROACTIVE_SUGGESTION_KINDS = [
	"stale_report",
	"duplicate",
	"trend",
	"pattern",
];
