// ═══════════════════════════════════════════════════════════════════
// Worker Contracts — domain enrollment (FRAMEWORK §3/§8)
// ═══════════════════════════════════════════════════════════════════
// Declarative WorkerContract registry: the 10 §8.2 Trust & Safety,
// 6 §8.1 Orchestration, 6 §8.3 Community, 5 §8.4 Search &
// Knowledge, 7 §8.5 Platform, 5 §8.6 Security, 7 §8.7 Quality, and
// 8 §8.8 Coworker capabilities (54 total), plus the R14 dispatch gate
// (validate + assert). The SPEC §7 ↔ §8 system crosswalk for all
// domains lives in _domain-map.js.
//
// Contract shape follows FRAMEWORK §3 exactly: id, domain, capability,
// class, trigger{kind,expr}, tools(ToolSpec[]), caps, workflow,
// disableTest, verify(V1–V6), optional ui. §8.2/§8.3's second class
// value ("B/C", "A/B", "B→C") becomes `classDegradeTo` — the fallback
// class for low-confidence or ambiguous inputs (§5: low confidence demotes).
//
// `workflow` values are FRAMEWORK §4's six shapes. OPERATIONS-ENGINE
// §3.1 aliases them as: chaining_gates→chaining_gates, routing→routing,
// Parallelization→parallel_voting, Orchestrator–workers→
// orchestrator_worker, Evaluator–optimizer→evaluator_optimizer,
// Deterministic sweep→deterministic_sweep (+event_driven variant).
//
// R14 note: assertDispatchable() is exported here but NOT yet wired
// into dispatch — every dispatch module (_workforce-core, agent-cron,
// …) is foreign-modified and untouchable this slice. Until wiring
// lands, this module is the registry + gate implementation only; no
// enforcement claim is made.
// ═══════════════════════════════════════════════════════════════════

export const DOMAINS = Object.freeze([
	"orchestration",
	"trust_safety",
	"community",
	"search_knowledge",
	"platform",
	"security",
	"quality",
	"coworker",
]);

const CLASSES = Object.freeze(["A", "B", "C"]);

const TRIGGER_KINDS = Object.freeze(["event", "cron", "manual"]);

// FRAMEWORK §4's six workflow shapes (see header for §3.1 aliases).
const WORKFLOW_SHAPES = Object.freeze([
	"chaining_gates",
	"routing",
	"parallelization",
	"orchestrator_workers",
	"evaluator_optimizer",
	"deterministic_sweep",
]);

const VERIFY_METHODS = Object.freeze(["V1", "V2", "V3", "V4", "V5", "V6"]);

// Caps by execution class (§5/R11 — enforced by the tool handle).
const CLASS_CAPS = Object.freeze({
	A: Object.freeze({ costUsdPerRun: 0.002, attempts: 3, durationMs: 15000 }),
	B: Object.freeze({ costUsdPerRun: 0.01, attempts: 3, durationMs: 30000 }),
	C: Object.freeze({ costUsdPerRun: 0.005, attempts: 1, durationMs: 10000 }),
});

// ToolSpec builder — names must exist in _agent-tool-registry.js.
// scope = rows/fields touchable; destructive → Approvals (R7).
const tool = (name, scope, destructive = false, dryRunSupported = true) => ({
	name,
	scope,
	destructive,
	dryRunSupported,
});

const READ_POSTS = () => tool("get_posts", ["posts"], false, false);
const READ_COMMENTS = () => tool("get_comments", ["comments"], false, false);
const READ_REPORTS = () => tool("get_reports", ["reports"], false, false);
const READ_USERS = () => tool("search_users", ["users"], false, false);
const READ_ANALYTICS = () => tool("get_analytics", ["analytics"], false, false);
const UPDATE_POST = () => tool("update_post", ["posts"], false, true);
const HIDE_POST = () => tool("hide_post", ["posts"], true, true);
const WARN_USER = () => tool("warn_user", ["users", "strikes"], true, true);
const BAN_USER = () => tool("ban_user", ["users"], true, true);
const UNBAN_USER = () => tool("unban_user", ["users"], true, true);
const ESCALATE = () => tool("escalate_issue", ["reports", "approvals"], false, false);
const READ_ACTIVITY_LOGS = () => tool("get_activity_logs", ["activity_logs"], false, false);
const READ_POLLS = () => tool("get_polls", ["polls"], false, false);
const SET_PRIORITY = () => tool("set_priority", ["posts"], false, true);
const CREATE_POLL = () => tool("create_poll", ["polls"], false, true);
const SEARCH_KB = () => tool("search_knowledge_base", ["knowledge_base"], false, false);
const EXEC_SQL = () => tool("execute_sql", ["sql"], false, false);

/**
 * The 10 Trust & Safety capabilities from FRAMEWORK §8.2.
 * Shape/Class/Trigger/Verify triples are copied from that table —
 * held-out tests assert them independently.
 */
export const TRUST_SAFETY_CONTRACTS = Object.freeze([
	{
		id: "tst-content-understanding",
		domain: "trust_safety",
		capability: "Content Understanding",
		class: "B",
		trigger: { kind: "event", expr: "NEW_POST|NEW_COMMENT|CONTENT_EDITED" },
		tools: [READ_POSTS(), READ_COMMENTS(), UPDATE_POST()],
		caps: { ...CLASS_CAPS.B },
		workflow: "routing",
		disableTest:
			"If off for 24h, new posts and comments go uncategorized and the Review tab shows no classifications.",
		verify: ["V1", "V6"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "tst-context-slang",
		domain: "trust_safety",
		capability: "Context/Slang",
		class: "B",
		trigger: { kind: "event", expr: "NEW_COMMENT|NEW_REPLY" },
		tools: [READ_COMMENTS(), READ_POSTS(), UPDATE_POST()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, slang and coded harassment pass through with no decision rows written to the moderation queue.",
		verify: ["V1", "V6"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "tst-harassment",
		domain: "trust_safety",
		capability: "Harassment",
		class: "B",
		classDegradeTo: "C",
		trigger: { kind: "event", expr: "NEW_POST|NEW_COMMENT|NEW_REPLY" },
		tools: [READ_POSTS(), READ_COMMENTS(), WARN_USER(), ESCALATE()],
		caps: { ...CLASS_CAPS.B },
		workflow: "parallelization",
		disableTest:
			"If off for 24h, multi-signal harassment scoring stops and no new warn_user strikes reach the moderation queue.",
		verify: ["V1", "V6"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "tst-threat-detect",
		domain: "trust_safety",
		capability: "Threat Detection",
		class: "B",
		classDegradeTo: "C",
		trigger: { kind: "event", expr: "NEW_POST|NEW_COMMENT|NEW_MESSAGE" },
		tools: [READ_POSTS(), READ_COMMENTS(), HIDE_POST(), ESCALATE()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, threats stay publicly visible: no hide_post actions and no Approvals escalations are created.",
		verify: ["V1", "V3"],
		ui: { surface: "Reports", tab: "Approvals" },
	},
	{
		id: "tst-pii-protection",
		domain: "trust_safety",
		capability: "PII Protection",
		class: "A",
		trigger: { kind: "event", expr: "NEW_POST|NEW_UPLOAD|manual review" },
		tools: [READ_POSTS(), UPDATE_POST()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, raw phone/email/address values remain unmasked in published posts.",
		verify: ["V1", "V2"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "tst-child-safety",
		domain: "trust_safety",
		capability: "Child Safety",
		class: "C",
		trigger: { kind: "event", expr: "NEW_POST|NEW_COMMENT|NEW_UPLOAD" },
		tools: [READ_POSTS(), READ_COMMENTS(), ESCALATE()],
		caps: { ...CLASS_CAPS.C },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, no child-safety escalations land in the Approvals queue for human spot check.",
		verify: ["V6"],
		ui: { surface: "Reports", tab: "Approvals" },
	},
	{
		id: "tst-sexual-safety",
		domain: "trust_safety",
		capability: "Sexual Safety",
		class: "B",
		classDegradeTo: "C",
		trigger: { kind: "event", expr: "NEW_POST|NEW_COMMENT|NEW_UPLOAD" },
		tools: [READ_POSTS(), READ_COMMENTS(), HIDE_POST(), ESCALATE()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, explicit content is never hidden — hide_post count for this class stays flat.",
		verify: ["V1", "V3"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "tst-scam-fraud",
		domain: "trust_safety",
		capability: "Scam/Fraud",
		class: "B",
		classDegradeTo: "C",
		trigger: { kind: "cron", expr: "*/30 * * * *" },
		tools: [READ_REPORTS(), READ_USERS(), READ_ANALYTICS(), WARN_USER(), ESCALATE()],
		caps: { ...CLASS_CAPS.B },
		workflow: "parallelization",
		disableTest:
			"If off for 24h, fraud reports stop aging out: open scam reports in the moderation queue stop decreasing.",
		verify: ["V1", "V4"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "tst-spam-abuse",
		domain: "trust_safety",
		capability: "Spam/Abuse",
		class: "A",
		classDegradeTo: "B",
		trigger: { kind: "event", expr: "NEW_POST|NEW_COMMENT|NEW_REPORT" },
		tools: [READ_REPORTS(), READ_POSTS(), HIDE_POST(), WARN_USER()],
		caps: { ...CLASS_CAPS.A },
		workflow: "parallelization",
		disableTest:
			"If off for 24h, reported spam stays public: hide_post actions on reported content stop entirely.",
		verify: ["V1", "V2"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "tst-enforcement",
		domain: "trust_safety",
		capability: "Enforcement",
		class: "C",
		trigger: { kind: "manual", expr: "approvals:enforcement" },
		tools: [READ_REPORTS(), WARN_USER(), BAN_USER(), UNBAN_USER(), ESCALATE()],
		caps: { ...CLASS_CAPS.C },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, no enforcement ladder steps (warn/strike/ban) are proposed from the moderation queue.",
		verify: ["V1", "V6"],
		ui: { surface: "Reports", tab: "Approvals" },
	},
]);

/**
 * The 6 Orchestration capabilities from FRAMEWORK §8.1 — the L0
 * engine, "deterministic by law": event ingestion with spans, queue
 * claim, registry scheduling, backoff retry, dependency promote, and
 * stale-claim recovery. Cron exprs pin to the deployed vercel.json
 * crons (all three on the 5-minute schedule); event exprs use real
 * spec §4 OPS_EVENT_TYPES names (verified against _ops-events.js).
 * These sweeps mutate queue state inside their owning modules — the
 * single ToolSpec below is the admin read envelope they may use for
 * evidence, never a mutation handle (R5: L0 owns its internals).
 * Disable tests name the observable flatline (spec §7 failure policy).
 */
export const ORCHESTRATION_CONTRACTS = Object.freeze([
	{
		id: "orc-event-engine",
		domain: "orchestration",
		capability: "Event Engine",
		class: "A",
		trigger: { kind: "event", expr: "OPS_EVENT_TYPES (spec §4 catalog)" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, queue and incident signals never enter the durable ops event log, so detection sees nothing and replay shows a gap for the whole window.",
		verify: ["V5"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "orc-work-dispatcher",
		domain: "orchestration",
		capability: "Work Dispatcher",
		class: "A",
		trigger: { kind: "cron", expr: "*/5 * * * *" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, no PENDING job is ever claimed: triage and sweep jobs pile up while the queue read-back shows zero claims and backlog grows the whole window.",
		verify: ["V1"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "orc-scheduler",
		domain: "orchestration",
		capability: "Scheduler",
		class: "A",
		trigger: { kind: "cron", expr: "*/5 * * * *" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, the registry loop never ticks: every worker's last-run stamp goes stale and no cron sweep, recovery, or triage step runs again.",
		verify: ["V4"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "orc-retry-engine",
		domain: "orchestration",
		capability: "Retry Engine",
		class: "A",
		trigger: { kind: "event", expr: "job failure → state RETRYING (nextRetryAt set)" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, RETRYING jobs are never requeued: failed work sits until timeout instead of backing off, and nothing reaches dead-letter through retries.",
		verify: ["V1"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "orc-dependency-manager",
		domain: "orchestration",
		capability: "Dependency Manager",
		class: "A",
		trigger: { kind: "event", expr: "WAITING job whose dependencies all finish" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, WAITING jobs never promote when their dependencies finish and dead-dependency jobs never turn BLOCKED, so dependent work sits unclaimed.",
		verify: ["V2"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "orc-watchdog",
		domain: "orchestration",
		capability: "Watchdog",
		class: "A",
		trigger: { kind: "cron", expr: "*/5 * * * *" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, stale RUNNING claims from crashed workers are never recovered: those jobs stay CLAIMED forever and recovery counts stay flat.",
		verify: ["V5"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
]);

/**
 * The 6 Community capabilities from FRAMEWORK §8.3. Rows (shape,
 * class, trigger, verify, ui) are copied from that table — held-out
 * tests assert them independently. Dual tokens follow the
 * first-token-primary rule: class "A/B" → class A with
 * classDegradeTo "B"; trigger "E/C" → kind event with the cron
 * cadence noted in expr; shape "DS+EO" → deterministic_sweep
 * primary with evaluator–optimizer as the documented secondary
 * phase. Cron exprs are the DECLARED contract cadence, not a
 * deployed schedule — no community cron is wired (R14 dispatch
 * gate still unwired) and vercel.json is untouched. Every tool
 * name below exists in _agent-tool-registry.js; case-state
 * transitions and cluster links run inside the owning worker
 * module (module owns its internals — the tools are the approved
 * envelope, not the only handle).
 */
export const COMMUNITY_CONTRACTS = Object.freeze([
	{
		id: "comm-duplicate-detection",
		domain: "community",
		capability: "Duplicate Detection",
		class: "B",
		trigger: { kind: "cron", expr: "0 * * * *" },
		tools: [READ_REPORTS(), READ_POSTS(), UPDATE_POST()],
		caps: { ...CLASS_CAPS.B },
		workflow: "parallelization",
		disableTest:
			"If off for 24h, duplicate reports are never linked: fresh duplicates keep accruing while created-link evidence rows stay flat for the whole window.",
		verify: ["V1", "V6"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "comm-issue-clustering",
		domain: "community",
		capability: "Issue Clustering",
		class: "B",
		trigger: { kind: "cron", expr: "20 * * * *" },
		tools: [READ_REPORTS(), READ_COMMENTS(), UPDATE_POST()],
		caps: { ...CLASS_CAPS.B },
		workflow: "parallelization",
		disableTest:
			"If off for 24h, related reports are never grouped: clusters stop forming and the cluster view in Review stays frozen while new reports pile up.",
		verify: ["V1", "V6"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "comm-priority",
		domain: "community",
		capability: "Priority",
		class: "B",
		trigger: { kind: "cron", expr: "*/15 * * * *" },
		tools: [READ_POSTS(), SET_PRIORITY(), READ_ANALYTICS()],
		caps: { ...CLASS_CAPS.B },
		// FRAMEWORK shape "DS+EO": deterministic_sweep primary,
		// evaluator–optimizer phase scores the result (V4 delta).
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, priorities never refresh: time-to-first-response climbs on unanswered posts while set_priority actions stay flat for the whole window.",
		verify: ["V4"],
		ui: { surface: "Reports", tab: "Reports" },
	},
	{
		id: "comm-case-lifecycle",
		domain: "community",
		capability: "Case Lifecycle",
		class: "A",
		classDegradeTo: "B",
		trigger: { kind: "event", expr: "CASE_CREATED|CASE_UPDATED|CASE_RESOLVED|CASE_REOPENED|cron hourly" },
		tools: [READ_REPORTS(), ESCALATE(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, cases never advance or reopen: state stamps freeze on open cases and failed verifications never reopen a closed case.",
		verify: ["V1", "V2"],
		ui: { surface: "Reports", tab: "Reports" },
	},
	{
		id: "comm-poll-operations",
		domain: "community",
		capability: "Poll Operations",
		class: "A",
		trigger: { kind: "cron", expr: "10 * * * *" },
		tools: [READ_POLLS(), CREATE_POLL(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, no poll is created or rotated: the poll count stays frozen and hourly sweeps produce zero new polls for the whole window.",
		verify: ["V1", "V5"],
		ui: { surface: "Reports", tab: "Reports" },
	},
	{
		id: "comm-community-health",
		domain: "community",
		capability: "Community Health",
		class: "B",
		trigger: { kind: "cron", expr: "0 5 * * *" },
		tools: [READ_ANALYTICS(), READ_POSTS(), READ_COMMENTS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "evaluator_optimizer",
		disableTest:
			"If off for 24h, health metrics stop updating: Overview health scores stay frozen at their last computed values with no new evaluator runs.",
		verify: ["V4", "V6"],
		ui: { surface: "Overview", tab: "Overview" },
	},
]);

/**
 * The 5 Search & Knowledge capabilities from FRAMEWORK §8.4 — same
 * held-out copy rule and first-token-primary dual-token rule as the
 * Community block (shape "DS+CH" → deterministic_sweep primary with
 * chaining gates as the documented secondary phase; trigger "E/C" →
 * kind event with cron noted in expr). Cron exprs are DECLARED, not
 * deployed (R14 gate unwired, vercel.json untouched). Knowledge
 * Updates deliberately carries a read-only evidence envelope: the
 * knowledge_base write path (update_knowledge_base) is not in
 * _agent-tool-registry.js and that file is foreign-modified this
 * slice, so stale-entry replacement runs inside the owning
 * _kb-maintain module until the tool lands — no write claim is made
 * through a registry tool here.
 */
export const SEARCH_KNOWLEDGE_CONTRACTS = Object.freeze([
	{
		id: "sk-search",
		domain: "search_knowledge",
		capability: "Search",
		class: "B",
		trigger: { kind: "event", expr: "NEW_POST|CONTENT_EDITED|cron hourly" },
		tools: [READ_POSTS(), SEARCH_KB(), READ_ANALYTICS()],
		caps: { ...CLASS_CAPS.B },
		// FRAMEWORK shape "DS+CH": deterministic_sweep primary,
		// chaining gates sequence fetch → rank → measure (V4).
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, search never re-indexes or sweeps: zero-result rate and p95 stop updating while queries keep arriving, so both metrics flatline.",
		verify: ["V4"],
		ui: { surface: "Overview", tab: "Overview" },
	},
	{
		id: "sk-ranking",
		domain: "search_knowledge",
		capability: "Ranking",
		class: "B",
		trigger: { kind: "cron", expr: "30 5 * * *" },
		tools: [READ_ANALYTICS(), READ_POSTS(), SEARCH_KB()],
		caps: { ...CLASS_CAPS.B },
		workflow: "evaluator_optimizer",
		disableTest:
			"If off for 24h, ranking never re-evaluates: the rank-quality metric stays at its last value and result order never adapts to fresh signals.",
		verify: ["V4"],
		ui: { surface: "Overview", tab: "Overview" },
	},
	{
		id: "sk-rag",
		domain: "search_knowledge",
		capability: "RAG",
		class: "B",
		trigger: { kind: "event", expr: "NEW_MESSAGE" },
		tools: [SEARCH_KB(), READ_POSTS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, no cited answers are produced: the answer queue stays empty and source-citation evidence rows stay flat for the whole window.",
		verify: ["V1", "V6"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "sk-knowledge-updates",
		domain: "search_knowledge",
		capability: "Knowledge Updates",
		class: "B",
		trigger: { kind: "event", expr: "CASE_RESOLVED|CONTENT_EDITED" },
		tools: [SEARCH_KB(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, stale knowledge entries are never replaced: old entries keep serving while replacement evidence rows stay flat for the whole window.",
		verify: ["V1", "V2"],
		ui: { surface: "Reports", tab: "Review" },
	},
	{
		id: "sk-zero-result-recovery",
		domain: "search_knowledge",
		capability: "Zero-result Recovery",
		class: "B",
		trigger: { kind: "cron", expr: "0 */6 * * *" },
		tools: [READ_ANALYTICS(), SEARCH_KB(), READ_POSTS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "evaluator_optimizer",
		disableTest:
			"If off for 24h, zero-result queries are never recovered: the zero-result rate never improves and recovery sweeps produce no fallback suggestions.",
		verify: ["V4"],
		ui: { surface: "Overview", tab: "Overview" },
	},
]);

/**
 * The 7 Platform capabilities from FRAMEWORK §8.5 — held-out copy
 * rule plus first-token dual-token rule ("A/B" → class A +
 * classDegradeTo B; "DS+EO" → deterministic_sweep primary with the
 * evaluator–optimizer scoring phase documented in code; trigger C →
 * cron, E → event). Cron exprs are DECLARED contract schedules, not
 * deployed (R14 gate unwired, vercel.json untouched) — hourly
 * staggered minutes, an every-10 backlog sample, an every-30
 * load-manager sweep. Every envelope is read-only: platform sweeps
 * observe metrics and logs, they never mutate rows — Database uses
 * execute_sql's single-SELECT least-privilege gate (admin, no
 * approval) for the V4 EXPLAIN/latency before-after check.
 */
export const PLATFORM_CONTRACTS = Object.freeze([
	{
		id: "plat-database",
		domain: "platform",
		capability: "Database",
		class: "A",
		classDegradeTo: "B",
		trigger: { kind: "cron", expr: "25 * * * *" },
		tools: [EXEC_SQL(), READ_ANALYTICS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, no EXPLAIN/latency sweeps run: slow-query regressions accumulate unseen while sweep evidence rows stay flat for the whole window.",
		verify: ["V4", "V1"],
		ui: { surface: "Overview", tab: "Overview" },
	},
	{
		id: "plat-cache",
		domain: "platform",
		capability: "Cache",
		class: "A",
		trigger: { kind: "event", expr: "CACHE_FAILURE|CONTENT_EDITED" },
		tools: [READ_ANALYTICS(), READ_POSTS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, hit-rate never refreshes and invalidations go unchecked: the hit-rate delta stays frozen while correctness re-reads never happen.",
		verify: ["V4", "V2"],
		ui: { surface: "Overview", tab: "Overview" },
	},
	{
		id: "plat-queue",
		domain: "platform",
		capability: "Queue",
		class: "A",
		trigger: { kind: "cron", expr: "*/10 * * * *" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, backlog depth is never sampled: QUEUE_BACKLOG warnings pile up unread while the OpsCenter backlog series flatlines.",
		verify: ["V4"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "plat-realtime",
		domain: "platform",
		capability: "Realtime",
		class: "A",
		trigger: { kind: "cron", expr: "50 * * * *" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, no heartbeat or broadcast-ack checks run: realtime delivery degrades silently with zero new ack receipts for the whole window.",
		verify: ["V3"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "plat-storage",
		domain: "platform",
		capability: "Storage",
		class: "A",
		trigger: { kind: "cron", expr: "55 * * * *" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, object and row counts never reconcile: storage drift accumulates unreconciled while reconcile evidence rows stay flat.",
		verify: ["V1"],
		ui: { surface: "Overview", tab: "Overview" },
	},
	{
		id: "plat-notifications",
		domain: "platform",
		capability: "Notifications",
		class: "A",
		trigger: { kind: "event", expr: "NOTIFICATION_FAILURE|EMAIL_FAILURE|SMS_FAILURE|PUSH_FAILURE" },
		tools: [READ_ACTIVITY_LOGS(), READ_ANALYTICS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, delivery failures are never triaged: email, SMS, and push failures queue up unread with no new delivery receipts.",
		verify: ["V3"],
		ui: { surface: "Reports", tab: "Reports" },
	},
	{
		id: "plat-performance",
		domain: "platform",
		capability: "Performance (load manager)",
		class: "B",
		trigger: { kind: "cron", expr: "45 * * * *" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.B },
		// FRAMEWORK shape "DS+EO": deterministic_sweep primary,
		// evaluator–optimizer phase scores against TARGET ENVELOPER (V4).
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, no load-manager sweep runs against the target envelope: latency and error-rate regressions go undetected while metrics keep arriving.",
		verify: ["V4", "V1"],
		ui: { surface: "Overview", tab: "Overview" },
	},
]);

/**
 * The 5 Security capabilities from FRAMEWORK §8.6 — held-out copy
 * rule plus first-token dual-token rule ("A/C" and "B/C" → primary
 * class + classDegradeTo; trigger "E/C"/"E/M" → kind event with the
 * cron/manual leg noted in expr; OW → orchestrator_workers).
 * Cron exprs are DECLARED, not deployed (R14 gate unwired). All
 * envelopes are observation-only (activity logs / analytics /
 * reports reads plus the escalate_issue approval handoff — itself
 * non-destructive, R7 gates the human step): detection, probing,
 * and containment evidence are recorded, not acted on, in this
 * domain — enforcement tools live in §8.2 Trust & Safety.
 */
export const SECURITY_CONTRACTS = Object.freeze([
	{
		id: "sec-detection",
		domain: "security",
		capability: "Detection",
		class: "B",
		trigger: { kind: "event", expr: "SECURITY_EVENT|AUTHORIZATION_FAILURE|cron hourly" },
		tools: [READ_ACTIVITY_LOGS(), READ_REPORTS(), ESCALATE()],
		caps: { ...CLASS_CAPS.B },
		workflow: "parallelization",
		disableTest:
			"If off for 24h, security signals are never triaged: finding rows stop appearing while SECURITY_EVENT and AUTHORIZATION_FAILURE entries age unread.",
		verify: ["V1", "V6"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "sec-authz-testing",
		domain: "security",
		capability: "Authorization Testing",
		class: "A",
		classDegradeTo: "C",
		trigger: { kind: "cron", expr: "5 * * * *" },
		tools: [READ_ACTIVITY_LOGS(), READ_ANALYTICS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, authz probes never run: no new probe-replay evidence rows appear while permission regressions accumulate undetected.",
		verify: ["V5", "V1"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "sec-abuse-detection",
		domain: "security",
		capability: "Abuse Detection",
		class: "B",
		classDegradeTo: "C",
		trigger: { kind: "event", expr: "SUSPICIOUS_ACTIVITY|ABUSE_SPIKE" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "parallelization",
		disableTest:
			"If off for 24h, abuse spikes go unnoticed: the abuse-rate metric flatlines while SUSPICIOUS_ACTIVITY events pile up with no finding rows.",
		verify: ["V1", "V4"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "sec-incident-response",
		domain: "security",
		capability: "Incident Response",
		class: "C",
		trigger: { kind: "event", expr: "SECURITY_EVENT|ERROR_SPIKE|manual (approval handoff)" },
		tools: [READ_ACTIVITY_LOGS(), ESCALATE()],
		caps: { ...CLASS_CAPS.C },
		workflow: "orchestrator_workers",
		disableTest:
			"If off for 24h, incidents never contain: no escalation rows are opened for incoming security events, so containment evidence stays empty.",
		verify: ["V3", "V1"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "sec-verification",
		domain: "security",
		capability: "Verification (meta)",
		class: "A",
		trigger: { kind: "cron", expr: "55 */2 * * *" },
		tools: [READ_ACTIVITY_LOGS(), READ_ANALYTICS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, verifier self-tests never replay: no new V5 evidence rows are written while broken verifiers keep passing silently.",
		verify: ["V5"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
]);

// FRAMEWORK §8.7 Quality — 7 rows, all UI OpsCenter. Cron schedules
// below are DECLARED, not deployed (R14 gate unwired; vercel.json
// intentionally untouched): no quality schedule goes live until the
// dispatch gate wires in. Regression is the only event-triggered row
// (AI_REGRESSION / TOOL_FAILURE are canonical OPS_EVENT_TYPES).
export const QUALITY_CONTRACTS = Object.freeze([
	{
		id: "qual-e2e-qa",
		domain: "quality",
		capability: "E2E QA",
		class: "A",
		trigger: { kind: "cron", expr: "15 */6 * * *" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, the end-to-end suite never replays: no new suite-run evidence rows appear while user-path regressions ship undetected.",
		verify: ["V5"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "qual-mobile-qa",
		domain: "quality",
		capability: "Mobile QA",
		class: "A",
		trigger: { kind: "cron", expr: "35 */12 * * *" },
		tools: [READ_ANALYTICS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, mobile viewport suites never run: no device-matrix evidence rows appear while mobile-only breakage ships undetected.",
		verify: ["V5"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "qual-accessibility",
		domain: "quality",
		capability: "Accessibility",
		class: "B",
		trigger: { kind: "cron", expr: "10 3 * * *" },
		tools: [READ_POSTS(), ESCALATE()],
		caps: { ...CLASS_CAPS.B },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, axe scans never run: no accessibility finding rows are opened while new WCAG regressions accumulate in shipped UI.",
		verify: ["V1", "V6"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "qual-ai-eval",
		domain: "quality",
		capability: "AI Evaluation",
		class: "B",
		trigger: { kind: "cron", expr: "20 */6 * * *" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "evaluator_optimizer",
		disableTest:
			"If off for 24h, judge scoring never runs: no agreement metrics are recorded while model-quality regressions pass review unseen.",
		verify: ["V6", "V1"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "qual-regression",
		domain: "quality",
		capability: "Regression",
		class: "A",
		trigger: { kind: "event", expr: "AI_REGRESSION|TOOL_FAILURE" },
		tools: [READ_ANALYTICS(), ESCALATE()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, AI_REGRESSION events are never replayed: no regression evidence rows appear while known failure modes re-emerge unchecked.",
		verify: ["V5"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "qual-red-team",
		domain: "quality",
		capability: "Red Team",
		class: "C",
		trigger: { kind: "cron", expr: "5 4 * * *" },
		tools: [READ_ANALYTICS(), ESCALATE()],
		caps: { ...CLASS_CAPS.C },
		workflow: "orchestrator_workers",
		disableTest:
			"If off for 24h, adversarial probes never run: no reproduced-finding rows are written while newly introduced vulnerabilities stay untested.",
		verify: ["V6"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
	{
		id: "qual-drift",
		domain: "quality",
		capability: "Drift",
		class: "B",
		trigger: { kind: "cron", expr: "30 */8 * * *" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "evaluator_optimizer",
		disableTest:
			"If off for 24h, distribution deltas are never computed: drift metrics flatline while model inputs shift silently away from training data.",
		verify: ["V4", "V6"],
		ui: { surface: "OpsCenter", tab: "ops-center" },
	},
]);

// FRAMEWORK §8.8 AI Coworker — 8 rows, the conversational edge of the
// same engine. R5 holds here: the coworker never gets a tool handle —
// these contracts govern the turn-processing workers, whose tools are
// strictly observation-only (intents/WorkItems enter L0 like any
// other trigger; no mutation, no enforcement). Manual triggers carry
// their declared exprs; Reports' cron is DECLARED, not deployed
// (R14 gate unwired; vercel.json untouched).
export const COWORKER_CONTRACTS = Object.freeze([
	{
		id: "cw-chat",
		domain: "coworker",
		capability: "Chat",
		class: "B",
		trigger: { kind: "manual", expr: "manual (user message)|event: intent-routed WorkItem" },
		tools: [READ_POSTS(), SEARCH_KB()],
		caps: { ...CLASS_CAPS.B },
		workflow: "routing",
		disableTest:
			"If off for 24h, the coworker never answers: no in-thread replies or WorkItems are created from user messages while intent routing stays dark.",
		verify: ["V1"],
		ui: { surface: "Coworker panel", tab: "Coworker panel" },
	},
	{
		id: "cw-voice",
		domain: "coworker",
		capability: "Voice",
		class: "B",
		trigger: { kind: "manual", expr: "manual (voice submit → transcript)" },
		tools: [SEARCH_KB()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, voice turns never land: no transcripts are receipted while spoken requests go unanswered in the submit voice UI.",
		verify: ["V3", "V1"],
		ui: { surface: "Submit voice UI", tab: "Submit voice UI" },
	},
	{
		id: "cw-files",
		domain: "coworker",
		capability: "Files",
		class: "A",
		classDegradeTo: "B",
		trigger: { kind: "manual", expr: "manual (file upload)" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, uploads stall: no object+metadata rows are written while PII and harmful-content scans never run on new files.",
		verify: ["V1", "V2"],
		ui: { surface: "Coworker panel", tab: "Coworker panel" },
	},
	{
		id: "cw-research",
		domain: "coworker",
		capability: "Research",
		class: "B",
		trigger: { kind: "manual", expr: "manual (research question)" },
		tools: [SEARCH_KB(), READ_POSTS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, research answers stop: no cited drafts with per-claim source links are produced while questions queue unanswered.",
		verify: ["V6", "V1"],
		ui: { surface: "Coworker panel", tab: "Coworker panel" },
	},
	{
		id: "cw-coding",
		domain: "coworker",
		capability: "Coding",
		class: "B",
		trigger: { kind: "manual", expr: "manual (coding task)" },
		tools: [READ_ACTIVITY_LOGS(), SEARCH_KB()],
		caps: { ...CLASS_CAPS.B },
		workflow: "chaining_gates",
		disableTest:
			"If off for 24h, coding tasks never progress: no gate-run evidence (tsc/eslint/tests) is recorded on proposed diffs before human merge.",
		verify: ["V5"],
		ui: { surface: "Coworker panel", tab: "Coworker panel" },
	},
	{
		id: "cw-investigation",
		domain: "coworker",
		capability: "Investigation",
		class: "C",
		trigger: { kind: "manual", expr: "manual (investigation question)" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.C },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, read-only probes never run: no investigation findings or read-receipt rows appear while questions go unexplored.",
		verify: ["V1"],
		ui: { surface: "Coworker panel", tab: "Coworker panel" },
	},
	{
		id: "cw-delegation",
		domain: "coworker",
		capability: "Delegation",
		class: "B",
		trigger: { kind: "manual", expr: "manual (delegate WorkItem)" },
		tools: [READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.B },
		workflow: "orchestrator_workers",
		disableTest:
			"If off for 24h, delegated WorkItems are never emitted: no child runs start in worker domains while in-thread status stays idle.",
		verify: ["V1"],
		ui: { surface: "Coworker", tab: "OpsCenter" },
	},
	{
		id: "cw-reports",
		domain: "coworker",
		capability: "Reports",
		class: "A",
		trigger: { kind: "cron", expr: "40 6 * * *|manual rerun" },
		tools: [READ_ANALYTICS(), READ_ACTIVITY_LOGS()],
		caps: { ...CLASS_CAPS.A },
		workflow: "deterministic_sweep",
		disableTest:
			"If off for 24h, report tabs never refresh: no evidence-pack aggregations are recomputed while displayed counts drift from packs.",
		verify: ["V1"],
		ui: { surface: "Reports", tab: "Reports" },
	},
]);

/**
 * Validate one contract against FRAMEWORK §3.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateContract(c) {
	const errors = [];
	const req = (cond, msg) => {
		if (!cond) errors.push(msg);
	};

	req(c && typeof c === "object" && !Array.isArray(c), "contract must be an object");
	if (errors.length) return { ok: false, errors };

	req(typeof c.id === "string" && c.id.length > 0, "id: non-empty string required");
	req(DOMAINS.includes(c.domain), `domain: must be one of ${DOMAINS.join("|")}`);
	req(
		typeof c.capability === "string" && c.capability.length > 0,
		"capability: non-empty string required",
	);
	req(CLASSES.includes(c.class), "class: must be A, B, or C");
	if (c.classDegradeTo !== undefined) {
		req(
			CLASSES.includes(c.classDegradeTo) && c.classDegradeTo !== c.class,
			"classDegradeTo: must be A, B, or C and differ from class",
		);
	}

	req(c.trigger && typeof c.trigger === "object", "trigger: object required");
	if (c.trigger) {
		req(TRIGGER_KINDS.includes(c.trigger.kind), "trigger.kind: event|cron|manual");
		req(
			typeof c.trigger.expr === "string" && c.trigger.expr.length > 0,
			"trigger.expr: non-empty string required",
		);
	}

	req(Array.isArray(c.tools) && c.tools.length > 0, "tools: at least one ToolSpec required");
	if (Array.isArray(c.tools)) {
		c.tools.forEach((t, i) => {
			req(t && typeof t === "object", `tools[${i}]: must be an object`);
			if (t && typeof t === "object") {
				req(
					typeof t.name === "string" && t.name.length > 0,
					`tools[${i}].name: non-empty string required`,
				);
				req(
					Array.isArray(t.scope) && t.scope.length > 0 && t.scope.every((s) => typeof s === "string"),
					`tools[${i}].scope: non-empty string array required`,
				);
				req(typeof t.destructive === "boolean", `tools[${i}].destructive: boolean required`);
				req(
					typeof t.dryRunSupported === "boolean",
					`tools[${i}].dryRunSupported: boolean required`,
				);
			}
		});
	}

	req(c.caps && typeof c.caps === "object", "caps: object required");
	if (c.caps) {
		req(
			typeof c.caps.costUsdPerRun === "number" && Number.isFinite(c.caps.costUsdPerRun) && c.caps.costUsdPerRun >= 0,
			"caps.costUsdPerRun: non-negative number required",
		);
		req(
			typeof c.caps.attempts === "number" && Number.isInteger(c.caps.attempts) && c.caps.attempts >= 1,
			"caps.attempts: integer >= 1 required",
		);
		req(
			typeof c.caps.durationMs === "number" && Number.isFinite(c.caps.durationMs) && c.caps.durationMs >= 1,
			"caps.durationMs: number >= 1 required",
		);
	}

	req(WORKFLOW_SHAPES.includes(c.workflow), `workflow: must be one of ${WORKFLOW_SHAPES.join("|")}`);

	req(
		typeof c.disableTest === "string" && c.disableTest.length >= 40,
		"disableTest: measurable degradation string (>= 40 chars) required",
	);
	if (typeof c.disableTest === "string") {
		req(c.disableTest.includes("24h"), 'disableTest: must state the "24h" off-period');
	}

	req(Array.isArray(c.verify) && c.verify.length > 0, "verify: at least one of V1–V6 required");
	if (Array.isArray(c.verify)) {
		c.verify.forEach((v, i) => {
			req(VERIFY_METHODS.includes(v), `verify[${i}]: must be one of ${VERIFY_METHODS.join("|")}`);
		});
	}

	if (c.ui !== undefined) {
		req(
			c.ui && typeof c.ui === "object" && typeof c.ui.surface === "string" && typeof c.ui.tab === "string",
			"ui: when present, must be { surface: string, tab: string }",
		);
	}

	return { ok: errors.length === 0, errors };
}

/** Every enrolled contract across all enrolled domains — the R14 gate's registry. */
export const ALL_CONTRACTS = Object.freeze([
	...TRUST_SAFETY_CONTRACTS,
	...ORCHESTRATION_CONTRACTS,
	...COMMUNITY_CONTRACTS,
	...SEARCH_KNOWLEDGE_CONTRACTS,
	...PLATFORM_CONTRACTS,
	...SECURITY_CONTRACTS,
	...QUALITY_CONTRACTS,
	...COWORKER_CONTRACTS,
]);

const BY_ID = new Map(ALL_CONTRACTS.map((c) => [c.id, c]));

/**
 * R14 dispatch gate: a worker without a valid contract never runs.
 * Throws with the validation errors when the contract is missing or
 * fails schema validation.
 *
 * NOT yet wired into dispatch modules (foreign-modified files) — see
 * header. Wiring is tracked as an open runbook item.
 *
 * @param {string} id
 * @returns the validated contract
 * @throws {Error} when unknown or invalid
 */
export function assertDispatchable(id) {
	const contract = BY_ID.get(id);
	if (!contract) {
		throw new Error(`R14: no contract registered for worker "${id}" — dispatch refused`);
	}
	const { ok, errors } = validateContract(contract);
	if (!ok) {
		throw new Error(
			`R14: contract "${id}" failed validation: ${errors.join("; ")}`,
		);
	}
	return contract;
}
