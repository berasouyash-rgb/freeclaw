// Decision harness — one imported entry point for every content decision
// on the site: chat messages, posts, comments, polls.
//
// Design notes, read before extending:
//   - Deterministic only. It runs with ZERO provider keys (the user asked
//     for decision-making that does not depend on locating any model API).
//     Anything needing judgment beyond fixed rules belongs in the LLM lanes
//     (api/_providers.js), never here.
//   - It reuses the exported pure engines (triage, slang, moderation) — it
//     never re-implements their patterns, so a rule fix lands everywhere.
//   - "Training" here means threshold calibration locked by tests
//     (tests/api/harness.test.ts), not ML weights: every boundary below
//     has a named test. Change a boundary, update its test, say why.
//   - serverModerate is called with learned=null (no DB): the harness is
//     intentionally conservative — routes with learned stats may approve
//     what the harness holds, never the reverse.
//   - Category hints are routing aids (which queue, which auto-tag), NOT
//     assignments: the author/LLM category always wins. The full
//     suggest engine (tags, priority, titles) stays in api/_assist.js.
import { postIntent, triageInboxMessage } from "./_inbox.js";
import { serverModerate } from "./_moderation.js";
import { scanSlang } from "./_slang.js";

// Compact routing keywords. Deliberately small: high-precision anchors per
// category. Ties and zero-hits resolve to "Other" (never a confident wrong
// category — a wrong auto-category is worse than none).
const CATEGORY_ANCHORS = [
  ["Facilities", ["lift", "elevator", "water", "bathroom", "toilet", "fan", "light", "bulb", "plumbing", "bench", "classroom", "building", "floor", "door", "window", "electricity", "power"]],
  ["Food", ["canteen", "mess", "lunch", "dinner", "breakfast", "food", "meal", "cook"]],
  ["Bullying", ["bully", "bullying", "ragging", "ragged", "harass", "beat", "threat", "blackmail", "extort", "tease", "mock", "scared"]],
  ["Teachers", ["teacher", "sir", "ma'am", "maam", "professor", "staff"]],
  ["Academics", ["exam", "marks", "homework", "syllabus", "grade", "test", "assignment", "study", "class", "lesson"]],
  ["Transport", ["bus", "transport", "driver", "route", "stop"]],
  ["Sports", ["sports", "football", "cricket", "playground", "coach", "match"]],
  ["Library", ["library", "books", "librarian"]],
  ["Hostel", ["hostel", "warden", "room", "dorm"]],
  ["Medical", ["medical", "doctor", "nurse", "clinic", "health", "sick"]],
  ["Technology", ["wifi", "wi-fi", "computer", "projector", "internet", "lab"]],
  ["Security", ["security", "guard", "cctv", "gate", "stranger"]],
  ["Cleanliness", ["dirty", "garbage", "dustbin", "mosquito", "smell", "stink", "clean"]],
  ["Events", ["event", "function", "annual day", "sports day", "celebration"]],
];

function escapeRegExp(w) {
  return String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ranked category hints: [{ category, hits }] with hits > 0, best first. */
export function categoryHints(text) {
  const t = String(text || "").toLowerCase();
  const out = [];
  for (const [category, words] of CATEGORY_ANCHORS) {
    let hits = 0;
    for (const w of words) {
      const re = new RegExp(`\\b${escapeRegExp(w)}\\b`, "i");
      if (re.test(t)) hits++;
    }
    if (hits > 0) out.push({ category, hits });
  }
  out.sort((a, b) => b.hits - a.hits || a.category.localeCompare(b.category));
  return out;
}

/** Best hint or "Other". Never throws. */
export function categoryHint(text) {
  try {
    const ranked = categoryHints(text);
    return ranked.length ? ranked[0].category : "Other";
  } catch {
    return "Other";
  }
}

/** Chat message routing: triage + slang + post-intent in one verdict. */
export function decideChat(text) {
  const body = String(text || "");
  const triage = triageInboxMessage(body);
  const slangHits = scanSlang(body);
  const wantsPost = triage.isProblem && postIntent(body);
  const route = triage.urgency === "urgent" ? "urgent" : triage.isProblem ? "normal" : "none";
  const actions = [];
  if (triage.isProblem) actions.push("file_report");
  if (triage.urgency === "urgent") actions.push("notify_admin");
  if (wantsPost) actions.push("propose_draft");
  if (slangHits.length > 0) actions.push("flag_slang");
  const reasons = [];
  if (triage.isProblem) reasons.push(`problem report (urgency=${triage.urgency}, private=${triage.isPrivate})`);
  else reasons.push("chit-chat: no report filed");
  if (slangHits.length > 0)
    reasons.push(`slang: ${[...new Set(slangHits.map((h) => h.term))].slice(0, 5).join(", ")}`);
  if (wantsPost) reasons.push("explicit post request: draft eligible");
  return {
    kind: "chat",
    route,
    triage,
    slang: { count: slangHits.length, terms: [...new Set(slangHits.map((h) => h.term))].slice(0, 20) },
    wantsPost,
    actions,
    reasons,
  };
}

/** Post verdict: publish | hold | block (+ category hint). Empty
 *  submissions hold — length validation lives in the routes, but the
 *  harness must never bless nothing as publishable. */
export function decidePost({ title, description, visibility }) {
  const t = String(title || "");
  const d = String(description || "");
  if (t.trim().length === 0 && d.trim().length === 0) {
    return {
      kind: "post",
      decision: "hold",
      visibility: visibility === "public" ? "public" : "private",
      flags: [],
      categoryHint: "Other",
      privacyHeld: false,
      reasons: ["empty submission: held for human review"],
    };
  }
  const mod = serverModerate(t, d, null);
  const types = new Set((mod.flags || []).map((f) => f.type));
  let decision;
  if (mod.blocked) decision = "block";
  else if (mod.requiresReview) decision = "hold";
  else decision = "publish";
  const reasons = (mod.flags || []).map((f) => `${f.type}: ${f.message}`);
  if (decision === "publish") reasons.push("clean: no flags");
  return {
    kind: "post",
    decision,
    visibility: visibility === "public" ? "public" : "private",
    flags: mod.flags || [],
    categoryHint: categoryHint(`${t} ${d}`),
    privacyHeld: types.has("privacy") || types.has("privacy_weak"),
    reasons,
  };
}

/** Comment verdict: direct surface (no review queue) — review means block. */
export function decideComment(text) {
  const mod = serverModerate("", String(text || ""), null);
  const blocked = mod.blocked || mod.requiresReview;
  return {
    kind: "comment",
    decision: blocked ? "block" : "publish",
    flags: mod.flags || [],
    reasons: blocked
      ? (mod.flags || []).map((f) => `${f.type}: ${f.message}`)
      : ["clean: no flags"],
  };
}

/** Poll verdict: same direct-surface rule as comments. */
export function decidePoll({ title, options }) {
  const text = `${String(title || "")} ${(options || []).join(" ")}`;
  const mod = serverModerate(text, "", null);
  const blocked = mod.blocked || mod.requiresReview;
  return {
    kind: "poll",
    decision: blocked ? "block" : "publish",
    flags: mod.flags || [],
    reasons: blocked
      ? (mod.flags || []).map((f) => `${f.type}: ${f.message}`)
      : ["clean: no flags"],
  };
}

/** Single entry point. Unknown kinds fail closed with a reason. */
export function decide(kind, input) {
  try {
    if (kind === "chat") return decideChat(typeof input === "string" ? input : input?.text);
    if (kind === "post") return decidePost(input || {});
    if (kind === "comment") return decideComment(typeof input === "string" ? input : input?.text);
    if (kind === "poll") return decidePoll(input || {});
    return { kind: String(kind), decision: "hold", reasons: ["unknown decision kind: held for human review"] };
  } catch (err) {
    return { kind: String(kind), decision: "hold", reasons: [`harness error (fail-closed): ${String((err && err.message) || err).slice(0, 120)}`] };
  }
}
