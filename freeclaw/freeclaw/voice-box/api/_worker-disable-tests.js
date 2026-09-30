// ═══════════════════════════════════════════════════════════════════
// WORKER DISABLE TESTS — spec §45: "If this worker is disabled for 24
// hours, what measurable capability becomes worse?"
// ═══════════════════════════════════════════════════════════════════
// One honest, measurable consequence per worker. If disabling a worker
// changes nothing, it must be merged, redesigned, or removed — every entry
// below names the degradation so the claim is falsifiable against the
// ledger (runs stop) and the product surface (symptom appears).
// Audited by scripts/audit-workers.mjs (criterion 14) and locked by
// tests/api/worker-disable-tests.test.ts (full registry coverage).
// ═══════════════════════════════════════════════════════════════════

export const DISABLE_TESTS = {
	// ── Core-registered workers (api/_workforce-workers.js) ──
	"cache-optimizer":
		"Expired cache entries accumulate for 24h: cache memory grows and stale reads are served until the next run purges them.",
	"session-cleaner":
		"Expired admin session tokens pile up for 24h in the settings KV and revoked sessions stay listed instead of being purged.",
	"suspension-lifecycle":
		"Expired suspensions never lift for 24h: users stay locked out past their suspension end because checkUser keeps seeing a future suspended_until.",
	"poll-archiver":
		"Ended polls stay in the active list for 24h: users keep seeing and voting on dead polls.",
	"counter-reconciliation":
		"Reaction/comment counts drift from their source tables for 24h: the UI shows wrong counts with no repair pass.",
	"authz-probe":
		"Unauthenticated admin-endpoint access goes untested for 24h: an auth regression ships silently with no probe to catch it.",
	"spam-score-decay":
		"Spam scores never decay for 24h: reformed users stay flagged and the false-positive pool only grows.",
	"report-sla":
		"Reports breaching the 7-day SLA are never escalated for 24h: SLA violations rot silently in the queue.",
	"appeal-sla":
		"Stale open appeals are never escalated for 24h: blocked authors waiting on recourse rot past SLA with no alert.",
	"api-reliability":
		"Error-rate spikes go undetected for 24h: a reliability regression is invisible until a human notices.",
	"spam-sentinel":
		"Posting bursts go unflagged for 24h: spam floods reach the public feed with no anomaly escalation.",
	"duplicate-reports":
		"Exact-duplicate reports pile up for 24h: moderators re-triage the same target once per copy instead of once.",
	"notification-health":
		"Failed notification deliveries stay failed for 24h: users miss strike/warning notices with no retry or alert.",
	"orphan-auditor":
		"Orphaned reaction targets accumulate uncounted for 24h: integrity drift grows with no measurement.",
	"supervisor":
		"Ledger failures go unreviewed for 24h: repeatedly failing workers keep running with no pause or escalation.",
	"db-health":
		"Settings-KV payload bloat goes undetected for 24h: read amplification grows with no mitigation pass.",
	"content-quality":
		"Sub-10-character spam/accident posts stay public for 24h: the lowest-effort junk is never auto-hidden.",
	"user-anomaly":
		"Abnormal activity patterns go undetected for 24h: bot-like bursts and mass-reporting run with no flag.",
	"search-quality":
		"Search latency and zero-result rate go unmeasured for 24h: search degradation is invisible until users complain.",
	"content-enricher":
		"New posts get no summaries/keywords for 24h: search relevance and related-case matching degrade for fresh content.",
	"stale-sweeper":
		"Resolved posts are never archived for 24h: the feed fills with stale resolved items.",
	"priority-scaler":
		"Priorities freeze for 24h: high-engagement urgent posts never surface above older quiet ones.",
	"data-consistency":
		"Orphan records accumulate for 24h: comments on deleted posts and votes on deleted polls stay visible with no repair.",
	"anonymity-guard":
		"Anonymous cases go unprobed for 24h: a public identifier leak or RLS gap stays exposed with no alert.",
	"voice-intake":
		"Voice-complaint intake degradation goes unnoticed for 24h: spoken reports fail silently with no escalation.",
	"submission-understanding":
		"New posts get no deterministic summaries for 24h: downstream categorization and inbox triage starve for fresh content.",
	"missing-info":
		"AI-resolved-but-still-open complaints are never flagged for 24h: the follow-up window passes with no check.",
	"category-assignment":
		"The uncategorized bucket grows for 24h: new posts skip routing and category filters miss them.",
	"category-correction":
		"Misfiled Other-category posts are never flagged for 24h: category analytics skews and humans never get the review list.",
	"suggestion-detection":
		"Stale/duplicate/trend suggestions stop for 24h: queue intelligence freezes and moderators lose the suggestion feed.",
	"duplicate-case":
		"Duplicate complaint clusters go unlogged for 24h: moderators handle each copy separately, multiplying toil per duplicate.",
	"related-case":
		"Related-post pairs go unlogged for 24h: moderators lose linked context when triaging connected issues.",
	"priority":
		"Pre-breach priority escalation stops for 24h: cases breach SLA instead of being raised at half-window with discussion.",
	"case-assignment":
		"New categorized cases never dispatch to the agent queue for 24h: automation stalls at intake with an empty queue.",
	"resolution-verification":
		"False resolutions stand for 24h: resolved-but-still-live violations stay public with no reopen or re-enforcement.",
	"report-disposition":
		"Stale open reports never close for 24h: the queue grows unboundedly with no disposition pass.",
	"cost-intelligence":
		"Budget-starved and compute-concentrated workers go unnamed for 24h: cost blindness returns with no aggregation.",
	"multilingual":
		"Non-platform-language posts go untranslated for 24h: admins cannot read them and the advisory-translation backlog grows.",
	"search-intel":
		"Search-quality telemetry goes unmeasured for 24h: zero-result-rate and latency degradation pass with no advisory report.",
	// ── Deterministic registry workers (api/_automation-registry.js) ──
	"poll-sweep":
		"Expired polls are never closed or notified for 24h: authors get no notice and dead polls linger open.",
	"sla": "Deadline warnings and breach escalations stop for 24h: SLA breaches land with no priority bump and no warning.",
	"reopen":
		"Solved cases with matching fresh reports stay solved for 24h: regressions hide behind a resolved status.",
	"followup":
		"Assigned cases quiet 3+ days are never pinged for 24h: stalled cases idle indefinitely with no nudge.",
	"poll-integrity":
		"Burst/bot votes go unquarantined for 24h: poll results stay manipulable with nothing moved to the rollback ledger.",
	"storage":
		"Orphaned uploads older than 7 days are never reclaimed for 24h: storage grows with no janitor pass.",
	"trends":
		"Category volume spikes go unalerted for 24h: a 24h surge against the 7d baseline passes with no signal.",
	"anonymity":
		"The identity-column tripwire and mask-integrity check never run for 24h: a de-anonymizing row stays public.",
	"comment-watch":
		"Abusive comments stay visible for 24h: no hides, no author strikes, no admin alerts from the proactive sweep.",
	"knowledge":
		"The knowledge base goes unmaintained for 24h: newly resolved cases are never distilled into entries and search answers rot.",
	"briefing":
		"The operations digest stops for 24h: no fresh admin briefing is built, persisted, or verified from ledger/activity/alert reads.",
	"search-gap-recovery":
		"Repeated zero-result queries go unfiled for 24h: users keep hitting dead searches with no knowledge gap ever reaching curators.",
	"poll-create":
		"Engaged suggestions never get polls for 24h: high-support suggestions sit with no vote path and the poll lifecycle stalls at intake.",
	"community-health":
		"The participation report goes stale for 24h: admins lose the 24h posts/comments/votes picture and trend breaks go unnoticed.",
	"abuse":
		"Rapid-fire posting bursts go unquarantined for 24h: flood content stays public with no burst detection or pending_review quarantine.",
	"upload-intel":
		"Bucket occupancy goes unmeasured for 24h: orphan pressure builds with no report flagging when reclaim cannot keep up.",
	"ai-quality":
		"AI output quality goes unscored for 24h: model regressions and safety violations pass with no measured scorecard.",
	"red-team":
		"Adversarial safety probes stop running for 24h: prompt-injection and moderation-bypass regressions ship undetected.",
	"ai-regression":
		"Golden user journeys go unverified for 24h: a broken publish/report/vote path escapes with no recorded failure.",
	"ai-drift":
		"Model drift goes unmeasured for 24h: slowly degrading AI answers rot with no comparison against baseline.",
	"ux-intel":
		"Durable web-vitals telemetry goes unmeasured for 24h: LCP and CLS regressions stay invisible until users report a broken experience.",
	// ── B6: platform reliability workers ──
	"performance-intel":
		"Real perf telemetry goes unmeasured for 24h: table-latency, error-rate, p95, and vitals regressions pass silently with no advisory report.",
	"db-intel":
		"Database health goes unmeasured for 24h: unreadable tables and slow-query pressure pass with no verified report and no issue flag.",
	"queue-recovery":
		"Stuck durable-queue work stays stuck for 24h: stale claims, due backoff releases, and promotable or dead-blocked dependencies are never recovered.",
	"notification-intel":
		"Failed notification deliveries stay dead-lettered for 24h: the ledger never drains and users miss notices with no verified retry pass.",
	"incident-recovery":
		"Open incidents whose metrics recovered stay open for 24h: auto-resolution stops and stale incidents pile up with no re-read proof.",
	"security-ops":
		"Security audit events go unanalyzed for 24h: unresolved high-severity events sit with no flag naming them for human review.",
};

export default DISABLE_TESTS;
