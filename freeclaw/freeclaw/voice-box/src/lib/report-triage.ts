/**
 * Allegation-only report triage.
 *
 * WHY THIS EXISTS
 * ---------------
 * The old admin classifier ran keyword regexes over `report.details`. But
 * `details` is the *reported post/comment text* (api/_reports.js joins the
 * target content into that column), not what the reporter alleged. So a
 * student writing "this exam is killing me" in a normal vent post matched the
 * self-harm rule, got labelled "Threat / Violence", and the AI panel then
 * recommended hiding the post and sanctioning the author. This module replaces
 * that behaviour.
 *
 * WHAT WE CLASSIFY
 * ----------------
 * Only allegation signals, in strict priority order:
 *   1. Machine tags the backstop wrote onto the report reason
 *      ([INBOX-URGENT], [BACKSTOP-PII], [BACKSTOP-ABUSE]) — accusations about
 *      the *report*, never quoted content.
 *   2. The moderation worker's own disposition, when it says the content
 *      violated policy (worker_actions.disposition / action).
 *   3. The human reporter's allegation (report.reason), stripped of the tags.
 *   4. Nothing matched -> "no violation found". A real, valid verdict that is
 *      never dressed up as a violation.
 *
 * We NEVER read `details`. If the only signal is quoted post text, the honest
 * answer is "no violation found".
 */

export type TriageTone = "critical" | "warning" | "info" | "safe";

/** What the one-click button should actually do. Derived from the matched
 *  allegation, never inferred from quoted content. */
export type TriageEnforce = "escalate" | "hide_and_warn" | "hide" | "dismiss";

export interface TriageVerdict {
  /** Stable machine id for the rule that matched. */
  rule: string;
  /** Short human label shown as the badge. Never "Policy Violation". */
  label: string;
  /** One sentence an admin can act on, always naming the phrase we matched. */
  why: string;
  /** The concrete next step, written for a tired moderator at 2am. */
  action: string;
  tone: TriageTone;
  enforce: TriageEnforce;
  /** True only for credible self-harm / imminent-violence allegations. */
  urgent: boolean;
  /**
   * True when nothing was alleged against the author. The post may still be
   * bad — but nothing here proves it, so the default move is dismissal, not
   * punishment.
   */
  noViolationFound: boolean;
}

interface Rule {
  id: string;
  label: string;
  phrases: string[];
  action: string;
  tone: TriageTone;
  enforce: TriageEnforce;
  urgent?: boolean;
}

/**
 * Ordered crisis -> threat -> hate -> privacy -> spam -> profanity so the most
 * serious matching allegation wins when a reporter ticks several boxes.
 */
const RULES: Rule[] = [
  {
    id: "self_harm",
    label: "Self-harm crisis",
    phrases: [
      "kill myself", "killing myself", "end my life", "want to die",
      "suicid", "self-harm", "self harm", "hurt myself",
      "don't want to be here", "no reason to live",
    ],
    action:
      "Treat as a welfare check, not a rule-break: escalate to a human moderator now so the author can be offered help.",
    tone: "critical",
    enforce: "escalate",
    urgent: true,
  },
  {
    id: "threat",
    label: "Threat / violence",
    phrases: [
      "i will kill", "im going to kill", "i'll kill", "going to kill you",
      "hunt you", "find you and", "beat you up", "shoot you", "hurt you",
      "you're dead", "you are dead", "i will hurt", "i will find you",
      "make you pay", "wait till i see you",
    ],
    action:
      "Hide the content now and warn the author. If it names a specific person or place, escalate before doing anything else.",
    tone: "critical",
    enforce: "hide_and_warn",
    urgent: true,
  },
  {
    id: "hate",
    label: "Hate speech",
    phrases: [
      "go back to your", "send them back", "not welcome here",
      "don't belong here", "your kind of people",
    ],
    action:
      "Hide the content and warn the author. Repeated hate speech should be escalated for a suspension.",
    tone: "warning",
    enforce: "hide_and_warn",
  },
  {
    id: "pii",
    label: "Private info shared",
    phrases: [
      "phone number", "home address", "their number", "posted their",
      "leaked her", "leaked his", "doxx", "dox ",
    ],
    action:
      "Hide the content now — private details spread fast. Ask the reporter for the source, then escalate.",
    tone: "warning",
    enforce: "hide",
  },
  {
    id: "spam",
    label: "Spam / scam",
    phrases: [
      "click here", "free money", "whatsapp me", "wire transfer",
      "crypto giveaway", "send me money", "airdrop", "limited time offer",
    ],
    action:
      "Hide the content and warn the author. If it links off-platform, escalate so the link can be checked.",
    tone: "info",
    enforce: "hide",
  },
  {
    id: "profanity",
    label: "Inappropriate language",
    phrases: ["fuck you", "shit on you", "bitch", "asshole", "bastard", "dickhead"],
    action:
      "Mild language on its own is not a violation — dismiss. Only warn the author if it was aimed at a person.",
    tone: "info",
    enforce: "dismiss",
  },
];

// ---------------------------------------------------------------------------
// Machine tags written by the backstop workers (api/_agents-cron.js). These
// are accusations about the report itself and always outrank human text.
// ---------------------------------------------------------------------------
const TAG_RULES: Array<{ tag: string; id: string; verdict: Omit<TriageVerdict, "rule" | "id"> }> = [
  {
    tag: "[INBOX-URGENT]",
    id: "tag_inbox_urgent",
    verdict: {
      label: "Urgent — safety risk",
      why: "The safety backstop flagged this report as urgent before a human saw it.",
      action: "Review first and escalate to a human moderator.",
      tone: "critical",
      enforce: "escalate",
      urgent: true,
      noViolationFound: false,
    },
  },
  {
    tag: "[BACKSTOP-PII]",
    id: "tag_backstop_pii",
    verdict: {
      label: "Private info shared",
      why: "The safety backstop detected personal details in this report.",
      action:
        "Hide the content now, then escalate so the exposed details can be removed at source.",
      tone: "warning",
      enforce: "hide",
      urgent: false,
      noViolationFound: false,
    },
  },
  {
    tag: "[BACKSTOP-ABUSE]",
    id: "tag_backstop_abuse",
    verdict: {
      label: "Abuse detected",
      why: "The safety backstop detected abusive content in this report.",
      action: "Hide the content and warn the author.",
      tone: "warning",
      enforce: "hide_and_warn",
      urgent: false,
      noViolationFound: false,
    },
  },
];

const NO_VERDICT: TriageVerdict = {
  rule: "none",
  label: "No violation found",
  why: "Nothing in this report matches a policy rule.",
  action:
    "Dismiss if the content is fine — you do not need to punish anyone to close this.",
  tone: "safe",
  enforce: "dismiss",
  urgent: false,
  noViolationFound: true,
};

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

/** Strip the machine tags so the human allegation is what we match on. */
function cleanReason(reason: string): string {
  let out = String(reason ?? "");
  for (const { tag } of TAG_RULES) out = out.split(tag).join(" ");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Triage one report. `details` is accepted only so callers keep their shape —
 * it is deliberately never inspected.
 */
export function triageReport(input: {
  reason?: unknown;
  details?: unknown;
  workerDisposition?: unknown;
  workerAction?: unknown;
}): TriageVerdict {
  const reason = String(input.reason ?? "");

  // 1. Machine tags — written by our own backstop, never by a user.
  for (const { tag, id, verdict } of TAG_RULES) {
    if (reason.includes(tag)) return { rule: id, ...verdict };
  }

  // 2. Worker disposition — the pipeline already judged the content itself.
  const disposition = `${norm(input.workerDisposition)} ${norm(input.workerAction)}`;
  if (/(violation|hide|remove|takedown|take down|strike|warn|abuse|spam|policy)/.test(disposition)) {
    return {
      rule: "worker",
      label: "Confirmed by safety pipeline",
      why: "The automated safety check already judged this content a policy violation.",
      action: "Hide the content and warn the author.",
      tone: "warning",
      enforce: "hide_and_warn",
      urgent: false,
      noViolationFound: false,
    };
  }

  // 3. Human allegation — the reporter's own words, tags stripped.
  const human = cleanReason(reason);
  if (human) {
    for (const rule of RULES) {
      const hit = rule.phrases.find((p) => human.includes(p));
      if (hit) {
        return {
          rule: rule.id,
          label: rule.label,
          why: `Filed for “${hit}”.`,
          action: rule.action,
          tone: rule.tone,
          enforce: rule.enforce,
          urgent: rule.urgent === true,
          noViolationFound: false,
        };
      }
    }
  }

  // 4. Nothing matched. Say so plainly instead of inventing a violation.
  return { ...NO_VERDICT };
}

/** Back-compat alias — older call sites imported this name. */
export const getReportGuidance = triageReport;

/** True when this report needs a human to look before anything else. */
export function isUrgentVerdict(v: TriageVerdict): boolean {
  return v.urgent === true;
}
