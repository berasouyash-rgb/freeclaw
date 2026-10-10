// Automation registry — every deterministic worker in one place so the
// cron, the workforce API, and the OpsCenter UI share a single source of
// truth. Each entry: what it does, which module runs it, and what its
// result means. Nothing here is decorative: "Run" executes the real check.
export const WORKERS = [
	{
		id: "poll-sweep",
		name: "Poll Closer",
		description: "Notifies authors of expired polls nobody opened.",
		module: "./_poll-sweeper.js",
		run: "sweepExpiredPolls",
	},
	{
		id: "sla",
		name: "SLA Watch",
		description: "Warns before deadlines, escalates breaches with priority bump.",
		module: "./_sla.js",
		run: "checkSLA",
	},
	{
		id: "reopen",
		name: "Case Reopener",
		description: "Reopens solved cases with a matching fresh report.",
		module: "./_reopen.js",
		run: "checkReopen",
	},
	{
		id: "followup",
		name: "Stalled-case Pinger",
		description: "Pings assigned cases quiet 3+ days, weekly at most.",
		module: "./_followup.js",
		run: "checkFollowups",
	},
	{
		id: "poll-integrity",
		name: "Vote Fraud Guard",
		description: "Quarantines burst/bot votes to a rollback ledger.",
		module: "./_poll-integrity.js",
		run: "checkPollIntegrity",
	},
	{
		id: "storage",
		name: "Storage Janitor",
		description: "Reclaims orphaned uploads older than 7 days.",
		module: "./_storage.js",
		run: "sweepStorage",
	},
	{
		id: "trends",
		name: "Trend Watch",
		description: "Alerts on 24h category volume spikes vs 7d baseline.",
		module: "./_trend-watch.js",
		run: "checkTrends",
	},
	{
		id: "anonymity",
		name: "Anonymity Guardian",
		description: "Tripwire: identity columns on public rows, mask integrity.",
		module: "./_anonymity.js",
		run: "checkAnonymity",
	},
	{
		id: "comment-watch",
		name: "Comment Moderator",
		description: "Hides abusive comments, strikes authors, alerts admins.",
		module: "./_comment-watch.js",
		run: "watchComments",
	},
	{
		id: "voice-intake",
		name: "Voice-to-Case Intake Worker",
		description: "Probes /api/assist voice intake; escalates when degraded.",
		module: "./_workforce-workers.js",
		run: "runVoiceIntake",
	},
	{
		id: "submission-understanding",
		name: "Submission Understanding Worker",
		description: "Summarizes posts missing AI summaries.",
		module: "./_workforce-workers.js",
		run: "runSubmissionUnderstanding",
	},
	{
		id: "missing-info",
		name: "Missing Information Worker",
		description: "Flags stale AI resolutions for follow-up.",
		module: "./_workforce-workers.js",
		run: "runMissingInfo",
	},
	{
		id: "category-assignment",
		name: "Category Assignment Worker",
		description: "Assigns categories to uncategorized posts.",
		module: "./_workforce-workers.js",
		run: "runCategoryAssignment",
	},
	{
		id: "category-correction",
		name: "Category Correction Worker",
		description: "Records posts tagged Other that match known categories.",
		module: "./_workforce-workers.js",
		run: "runCategoryCorrection",
	},
	{
		id: "suggestion-detection",
		name: "Proactive Suggestion Worker",
		description: "Runs stale/duplicate/trend/pattern detection over the queue.",
		module: "./_workforce-workers.js",
		run: "runSuggestionDetection",
	},
	{
		id: "duplicate-case",
		name: "Duplicate Case Worker",
		description: "Clusters duplicate complaints and logs each group; never merges.",
		module: "./_workforce-workers.js",
		run: "runDuplicateCase",
	},
	{
		id: "related-case",
		name: "Related Case Worker",
		description: "Finds open posts sharing vocabulary and logs the pairs.",
		module: "./_workforce-workers.js",
		run: "runRelatedCase",
	},
	{
		id: "priority",
		name: "Priority Triage Worker",
		description: "Raises priority of near-deadline cases that have discussion.",
		module: "./_workforce-workers.js",
		run: "runPriority",
	},
	{
		id: "case-assignment",
		name: "Case Assignment Worker",
		description: "Dispatches new categorized cases to the agent queue.",
		module: "./_workforce-workers.js",
		run: "runCaseAssignment",
	},
	{
		id: "resolution-verification",
		name: "Resolution Verification Worker",
		description:
			"Re-checks resolved reports against live target state; reopens false resolutions.",
		module: "./_workforce-workers.js",
		run: "runResolutionVerification",
	},
	{
		id: "report-disposition",
		name: "Open Report Disposition Worker",
		description:
			"Closes stale open reports from live target state, enforcing removal where needed.",
		module: "./_workforce-workers.js",
		run: "runReportDisposition",
	},
	{
		id: "cost-intelligence",
		name: "Cost & Compute Intelligence Worker",
		description:
			"Accounts real ledger compute per worker, flagging budget starvation and concentration.",
		module: "./_workforce-workers.js",
		run: "runCostIntelligence",
	},
	{
		id: "multilingual",
		name: "Multilingual Worker",
		description:
			"Detects non-platform-language posts (deterministic script heuristic) and stores advisory translations.",
		module: "./_workforce-workers.js",
		run: "runMultilingual",
	},
	{
		id: "search-intel",
		name: "Search Intelligence Worker",
		description:
			"Measures live search-quality telemetry; logs a report when zero-result rate or latency degrades.",
		module: "./_workforce-workers.js",
		run: "runSearchIntel",
	},
	{
		id: "knowledge",
		name: "Knowledge Worker",
		description:
			"Maintains the knowledge base from real resolved cases; verifies entries are searchable.",
		module: "./_kb-maintain.js",
		run: "maintainKB",
	},
	{
		id: "briefing",
		name: "Admin Briefing Worker",
		description:
			"Builds the operations digest from real ledger/activity/alert reads; persists and verifies it.",
		module: "./_briefing.js",
		run: "generateBriefing",
	},
	{
		id: "search-gap-recovery",
		name: "Search Gap Recovery",
		description:
			"Files repeated zero-result queries as actionable knowledge gaps; deduplicates durably and verifies.",
		module: "./_search-quality.js",
		run: "recoverSearchGaps",
	},
	{
		id: "poll-create",
		name: "Poll Creation Worker",
		description:
			"Creates real polls for engaged suggestions through the platform's own createPoll path; verified by re-read.",
		module: "./_poll-create.js",
		run: "runPollCreate",
	},
	{
		id: "community-health",
		name: "Community Health Worker",
		description:
			"Measures real participation signals (posts/comments/votes 24h) and persists a verified health report.",
		module: "./_community-health.js",
		run: "runCommunityHealth",
	},
	{
		id: "abuse",
		name: "Abuse Detection Worker",
		description:
			"Cross-request rapid-fire burst detection; quarantines floods via the real pending_review status.",
		module: "./_abuse.js",
		run: "runAbuseWatch",
	},
	{
		id: "upload-intel",
		name: "Upload Intelligence Worker",
		description:
			"Monitors real bucket occupancy and orphan pressure; persists a verified report.",
		module: "./_storage.js",
		run: "runUploadIntel",
	},
	{
		id: "ai-quality",
		name: "AI Quality Worker",
		description:
			"Scores the evaluated workforce from the real evaluation history; persists a verified snapshot.",
		module: "./_evaluation-engine.js",
		run: "runAIQuality",
	},
	{
		id: "red-team",
		name: "AI Red-Team Worker",
		description:
			"Runs the injection/PII/threat/false-positive suite through the real moderation engine.",
		module: "./_redteam-cases.js",
		run: "runRedTeam",
	},
	{
		id: "ai-regression",
		name: "AI Regression Worker",
		description:
			"Runs the golden journeys and flags steps that passed before but fail now.",
		module: "./_golden-workflows.js",
		run: "runGoldenRegression",
	},
	{
		id: "ai-drift",
		name: "AI Drift Worker",
		description:
			"Measures real pass-rate and score deltas over time; flags drift beyond tolerance.",
		module: "./_drift.js",
		run: "runDriftWatch",
	},
	{
		id: "ux-intel",
		name: "UX Intelligence Worker",
		description:
			"Reads durable web-vitals telemetry and flags experience regressions beyond tolerance.",
		module: "./_ux-intel.js",
		run: "runUXIntel",
	},
	{
		id: "performance-intel",
		name: "Performance Intelligence Worker",
		description:
			"Measures real table latencies, error rates, and durable web vitals; flags perf regressions beyond tolerance.",
		module: "./_performance.js",
		run: "runPerformanceIntel",
	},
	{
		id: "db-intel",
		name: "Database Intelligence Worker",
		description:
			"READ-ONLY database health measurement: real table stats and latency, persisted and verified; never mutates indexes.",
		module: "./_db-stats.js",
		run: "runDbIntel",
	},
	{
		id: "queue-recovery",
		name: "Queue Recovery Worker",
		description:
			"Recovers stuck durable-queue work: stale claims, due backoff releases, dependency promotion; verified by re-read.",
		module: "./_work-queue.js",
		run: "runQueueRecovery",
	},
	{
		id: "notification-intel",
		name: "Notification Intelligence Worker",
		description:
			"Measures real notification stores and drains the dead-letter ledger with read-back verified retries.",
		module: "./_notification-delivery.js",
		run: "runNotificationIntel",
	},
	{
		id: "incident-recovery",
		name: "Incident Recovery Worker",
		description:
			"Auto-resolves open incidents whose underlying metrics recovered to healthy levels; verified by re-read.",
		module: "./_incidents.js",
		run: "runIncidentRecovery",
	},
	{
		id: "security-ops",
		name: "Security Operations Worker",
		description:
			"Analyzes real security audit events and flags unresolved high-severity ones for review; persisted and verified.",
		module: "./_security-events.js",
		run: "runSecurityOps",
	},
];

export const LAST_RUNS_KEY = "worker_last_runs";
const LAST_RUNS_MAX = 8;

/** Persist one worker's last-run summary (cron writes, UI reads). */
export async function recordLastRun(client, id, result) {
	const summary = {
		at: new Date().toISOString(),
		ok: result?.ok === true,
		deferred: !!result?.deferred,
		degraded: !!result?.degraded,
		summary: summarize(id, result || {}),
	};
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", LAST_RUNS_KEY)
			.maybeSingle();
		const runs = { ...((data && data.value) || {}) };
		runs[id] = summary;
		// Cap to registry ids so removed workers disappear.
		for (const k of Object.keys(runs)) {
			if (!WORKERS.some((w) => w.id === k)) delete runs[k];
		}
		await client.from("settings").upsert(
			{ key: LAST_RUNS_KEY, value: runs },
			{ onConflict: "key" },
		);
	} catch {
		/* persistence is best-effort; the tick result still reports */
	}
	return summary;
}

export async function readLastRuns(client) {
	try {
		const { data } = await client
			.from("settings")
			.select("value")
			.eq("key", LAST_RUNS_KEY)
			.maybeSingle();
		return data?.value || {};
	} catch {
		return {};
	}
}

/** Failure detail for a manual/automated worker run — pure and unit-tested.
 *  Guarantees a non-empty, worker-attributed message: the UI used to show a
 *  bare "unknown error" when a worker threw a non-Error or returned
 *  {ok:false} with no error string. `thrown` is the caught value (when the
 *  worker threw); otherwise `result` is the worker's return value. */
export function formatRunError(id, step, result, thrown) {
	let reason;
	if (thrown !== undefined) {
		reason =
			thrown instanceof Error && thrown.message
				? thrown.message
				: String(thrown ?? "unknown error");
	} else {
		const keys = Object.keys(result || {})
			.slice(0, 5)
			.join(", ");
		reason =
			result?.error ||
			result?.reason ||
			result?.summary ||
			`finished without ok (returned keys: ${keys || "none"})`;
	}
	if (!reason) reason = "unknown error";
	const where =
		step === "load"
			? "failed to load"
			: step === "threw"
				? "threw during run"
				: "reported failure";
	return { step, error: `Worker "${id}" ${where}: ${reason}` };
}

/** One-line human summary per worker result — what the UI shows. */
export function summarize(id, r) {
	if (r.deferred) return "deferred — tick budget spent";
	if (r.degraded) return `standby — ${r.reason || "missing foundation"}`;
	if (r.ok !== true)
		return `failed — ${r.error || r.reason || r.summary || "no details recorded"}`;
	switch (id) {
		// Every scan-type summary leads with WHAT WAS EXAMINED: "0 hidden"
		// alone reads as "did nothing", while "47 scanned · 0 hidden" proves
		// the work happened and the platform was clean.
		case "poll-sweep":
			return `${r.checked ?? 0} polls scanned · ${r.notified || 0} authors notified · ${r.skipped || 0} already notified`;
		case "sla":
			return `${r.checked ?? 0} open cases scanned · ${r.warned || 0} warned · ${r.escalated || 0} escalated`;
		case "reopen":
			return `${r.checked ?? 0} fresh comments scanned · ${(r.reopened || []).length} cases reopened`;
		case "followup":
			return `${r.checked ?? 0} assigned cases scanned · ${r.pinged || 0} stalled cases pinged`;
		case "poll-integrity":
			return `${r.checked ?? 0} votes scanned · ${r.quarantined || 0} votes quarantined · ${r.watchAlerts || 0} watched`;
		case "storage":
			return `${(r.deleted || []).length} orphans reclaimed`;
		case "trends":
			return `${(r.spikes || []).length} spikes`;
		case "anonymity":
			return `${(r.findings || []).length} findings`;
		case "comment-watch":
			return `${r.checked ?? 0} comments scanned · ${r.hidden || 0} hidden · ${r.verified || 0} verified`;
		case "voice-intake":
			return r.outcome === "escalated" ? "escalated — voice intake degraded" : "voice intake healthy";
		case "missing-info":
			return r.outcome === "escalated" ? "escalated — stale resolutions flagged" : "no stale resolutions";
		case "submission-understanding":
			return `${r.metrics?.affected || 0} summaries generated`;
		case "category-assignment":
			return `${r.metrics?.assigned || 0} categories assigned`;
		case "category-correction":
			return `${r.metrics?.logged || 0} correction candidates logged`;
		case "suggestion-detection":
			return `${r.metrics?.detected || 0} suggestions detected`;
		case "duplicate-case":
			return `${r.metrics?.logged || 0} duplicate groups flagged`;
		case "related-case":
			return `${r.metrics?.logged || 0} related pairs flagged`;
		case "priority":
			return `${r.metrics?.bumped || 0} priorities raised`;
		case "case-assignment":
			return `${r.metrics?.dispatched || 0} cases dispatched`;
		case "resolution-verification":
			return r.outcome === "escalated"
				? "escalated — resolutions unverifiable"
				: `${r.metrics?.reopened || 0} false resolutions reopened`;
		case "report-disposition":
			return r.outcome === "escalated"
				? "escalated — open queue unreadable"
				: `${r.metrics?.closed || 0} open reports closed · ${r.metrics?.enforced || 0} enforced`;
		case "cost-intelligence":
			if (r.outcome === "escalated")
				return "escalated — ledger unreadable";
			return r.outcome === "skipped"
				? "compute distribution nominal"
				: `${r.metrics?.after || 0} compute anomaly(ies) · ${r.metrics?.total_runs || 0} runs / ${Math.round((r.metrics?.total_ms || 0) / 1000)}s accounted`;
		case "multilingual":
			return `${r.metrics?.stored || 0} translations stored`;
		case "search-intel":
			return r.outcome === "skipped"
				? "search quality within thresholds"
				: `zero-result ${r.zero_result_rate || "0%"} · avg ${r.avg_latency_ms || 0}ms · ${r.logged || 0} report(s)`;
		case "knowledge":
			return `${(r.harvested || []).length} resolved cases indexed`;
		case "briefing":
			return r.verified
				? `briefing stored · ${r.briefing?.attention?.unresolved_alerts || 0} open alerts`
				: "briefing generated (unverified)";
		case "poll-create":
			return `${(r.created || []).length} polls created`;
		case "community-health":
			return r.verified
				? `posts ${r.report?.posts?.new_24h ?? "n/a"} · comments ${r.report?.comments_24h ?? "n/a"} · votes ${r.report?.votes_24h ?? "n/a"}`
				: "health report generated (unverified)";
		case "abuse":
			return r.verified
				? `${(r.quarantined || []).length} rapid-fire posts quarantined`
				: "no rapid-fire abuse detected";
		case "upload-intel":
			return r.verified
				? `${Object.values(r.buckets || {}).filter(Boolean).length}/${Object.keys(r.buckets || {}).length} buckets monitored`
				: "upload intel generated (unverified)";
		case "ai-quality":
			return r.verified
				? `${r.snapshot?.workers_evaluated || 0} workers scored · avg ${r.snapshot?.average_score ?? "n/a"} · ${r.snapshot?.safety_violations_total || 0} safety violations`
				: "quality snapshot generated (unverified)";
		case "red-team":
			return `${r.passed || 0}/${r.total || 0} red-team cases passed (${r.pass_rate || 0}%)`;
		case "ai-regression":
			return r.regressed
				? `${r.regressed} golden step(s) regressed — ${r.passed || 0} passed / ${r.failed || 0} failed`
				: `all ${r.passed || 0} golden steps hold`;
		case "ai-drift":
			return r.verified
				? r.drifted
					? `${r.drift_flags.length} drift flag(s) beyond tolerance`
					: `no drift (${r.evaluations?.workers_tracked || 0} workers tracked)`
				: "drift snapshot generated (unverified)";
		case "ux-intel":
			return r.verified
				? r.regressed
					? `${r.snapshot?.regressions.length} experience regression(s) flagged across ${r.snapshot?.metrics_tracked || 0} vitals`
					: `${r.snapshot?.metrics_tracked || 0} vitals tracked — within tolerance`
				: "ux snapshot generated (unverified)";
		case "search-gap-recovery":
			return r.verified
				? `${(r.gaps_filed || []).length} search gap(s) filed · ${r.skipped_filed || 0} already filed`
				: "gap recovery finished unverified";
		case "performance-intel":
			return r.verified
				? r.snapshot?.regressed
					? `${r.snapshot.regressions.length} perf regression(s) flagged · ${r.snapshot.error_rate_per_hour ?? "?"} errors/h`
					: `${r.snapshot?.tables_measured ?? 0} tables measured · within tolerance`
				: "perf snapshot generated (unverified)";
		case "db-intel":
			return r.verified
				? `health ${r.snapshot?.health_score ?? "n/a"}/100 · ${(r.snapshot?.issues || []).length} table issue(s)`
				: "db snapshot generated (unverified)";
		case "queue-recovery":
			return r.verified
				? `${r.released || 0} retried released · ${r.recovered || 0} stale claims recovered · ${r.promoted || 0} promoted`
				: "queue recovery finished unverified";
		case "notification-intel":
			return r.verified
				? `${r.stores_scanned ?? 0} store(s) scanned · ${r.delivered || 0} dead-letter(s) delivered · ${r.dead || 0} dead`
				: "notification intel generated (unverified)";
		case "incident-recovery":
			return r.verified
				? `${r.checked ?? 0} open incidents scanned · ${(r.recovered || []).length} auto-resolved`
				: "incident recovery finished unverified";
		case "security-ops":
			return r.verified
				? `${r.events_scanned ?? 0} security event(s) analyzed · ${(r.flagged || []).length} flagged`
				: "security snapshot generated (unverified)";
		default:
			return "ran ok";
	}
}
