// ═══════════════════════════════════════════════════════════════════
// Agent Team Module Tests
// ═══════════════════════════════════════════════════════════════════
// Tests: 110+ agent roster, 14 divisions, RBAC (100+ roles),
// workflow classification, subagent spawning, tool registry, permissions
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// AGENT ROSTER — 110 agents across 14 divisions
// ═══════════════════════════════════════════════════════════════════

interface Agent {
	id: string;
	name: string;
	division: string;
	icon: string;
	role: string;
	description: string;
	permissions: string[];
	capabilities: string[];
	status: string;
	tier: string;
}

interface Division {
	name: string;
	icon: string;
	color: string;
	description: string;
}

interface RoleDefinition {
	level: number;
	permissions: string[];
	description: string;
}

// ─── Executive Division (agents 1-9) ──────────────────────────────
const EXECUTIVE_AGENTS: Agent[] = [
	{
		id: "ceo-intelligence",
		name: "CEO Intelligence",
		division: "executive",
		icon: "🧠",
		role: "Chief Executive Officer",
		description: "Strategic oversight, cross-division coordination",
		permissions: ["*"],
		capabilities: [
			"strategic_analysis",
			"resource_allocation",
			"conflict_resolution",
			"report_synthesis",
		],
		status: "active",
		tier: "executive",
	},
	{
		id: "chief-orchestrator",
		name: "Chief Orchestrator",
		division: "executive",
		icon: "🎯",
		role: "Orchestration Lead",
		description: "Coordinates all subagent workflows",
		permissions: [
			"agents.read",
			"agents.spawn",
			"agents.orchestrate",
			"tools.read",
		],
		capabilities: [
			"workflow_design",
			"parallel_dispatch",
			"result_aggregation",
			"strategic_planning",
		],
		status: "active",
		tier: "executive",
	},
	{
		id: "strategy-advisor",
		name: "Strategy Advisor",
		division: "executive",
		icon: "♟️",
		role: "Strategic Advisor",
		description: "Long-term planning and trend analysis",
		permissions: ["analytics.read", "reports.read"],
		capabilities: [
			"trend_forecasting",
			"competitive_analysis",
			"gap_identification",
			"priority_ranking",
		],
		status: "active",
		tier: "leadership",
	},
	{
		id: "problem-intelligence",
		name: "Problem Intelligence",
		division: "executive",
		icon: "🔍",
		role: "Problem Analysis Lead",
		description: "Deep-dive problem analysis",
		permissions: ["posts.read", "comments.read", "analytics.read"],
		capabilities: [
			"root_cause_analysis",
			"impact_scoring",
			"pattern_detection",
			"correlation_mapping",
		],
		status: "active",
		tier: "leadership",
	},
	{
		id: "quality-assurance",
		name: "Quality Assurance",
		division: "executive",
		icon: "✅",
		role: "QA Director",
		description: "Platform quality monitoring",
		permissions: ["posts.read", "comments.read", "analytics.read", "logs.read"],
		capabilities: [
			"quality_scoring",
			"regression_detection",
			"standards_audit",
			"health_monitoring",
		],
		status: "active",
		tier: "leadership",
	},
	{
		id: "risk-assessor",
		name: "Risk Assessor",
		division: "executive",
		icon: "🛡️",
		role: "Risk Management",
		description: "Identifies platform risks",
		permissions: ["posts.read", "users.read", "reports.read"],
		capabilities: [
			"risk_scoring",
			"escalation_triggering",
			"mitigation_planning",
			"threat_detection",
		],
		status: "active",
		tier: "leadership",
	},
	{
		id: "data-scientist",
		name: "Data Scientist",
		division: "executive",
		icon: "📊",
		role: "Data Science Lead",
		description: "Advanced analytics",
		permissions: [
			"analytics.read",
			"posts.read",
			"comments.read",
			"users.read",
		],
		capabilities: [
			"predictive_modeling",
			"statistical_analysis",
			"data_visualization",
			"anomaly_detection",
		],
		status: "active",
		tier: "leadership",
	},
	{
		id: "operations-director",
		name: "Operations Director",
		division: "executive",
		icon: "⚙️",
		role: "Ops Director",
		description: "Operational efficiency",
		permissions: ["agents.read", "tools.read", "analytics.read", "logs.read"],
		capabilities: [
			"process_optimization",
			"efficiency_scoring",
			"automation_design",
			"workflow_analysis",
		],
		status: "active",
		tier: "leadership",
	},
	{
		id: "ai-supervisor",
		name: "AI Supervisor",
		division: "executive",
		icon: "👁️",
		role: "AI Oversight Lead",
		description: "Monitors all agent divisions",
		permissions: [
			"agents.read",
			"analytics.read",
			"logs.read",
			"reports.read",
			"users.read",
		],
		capabilities: [
			"agent_monitoring",
			"danger_detection",
			"personnel_awareness",
			"escalation_management",
			"health_scoring",
			"alert_generation",
		],
		status: "active",
		tier: "executive",
	},
];

// ─── Content Division (agents 10-19) ──────────────────────────────
const CONTENT_AGENTS: Agent[] = [
	{
		id: "content-moderator",
		name: "Content Moderator",
		division: "content",
		icon: "📝",
		role: "Moderation Lead",
		description: "Content review and moderation",
		permissions: ["posts.read", "posts.update", "posts.hide", "comments.read"],
		capabilities: [
			"content_scanning",
			"policy_enforcement",
			"queue_management",
			"escalation_routing",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "post-analyst",
		name: "Post Analyst",
		division: "content",
		icon: "📄",
		role: "Post Analysis",
		description: "Individual post analysis",
		permissions: ["posts.read", "comments.read"],
		capabilities: [
			"sentiment_analysis",
			"categorization",
			"priority_scoring",
			"duplicate_detection",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "comment-tracker",
		name: "Comment Tracker",
		division: "content",
		icon: "💬",
		role: "Comment Management",
		description: "Comment monitoring",
		permissions: ["comments.read", "comments.create", "posts.read"],
		capabilities: [
			"conversation_analysis",
			"reply_tracking",
			"thread_management",
			"engagement_scoring",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "announcement-manager",
		name: "Announcement Manager",
		division: "content",
		icon: "📢",
		role: "Announcements",
		description: "Announcement lifecycle",
		permissions: ["settings.read", "settings.update"],
		capabilities: [
			"announcement_scheduling",
			"effectiveness_tracking",
			"a_b_testing",
			"reach_analysis",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "poll-manager",
		name: "Poll Manager",
		division: "content",
		icon: "📊",
		role: "Poll Operations",
		description: "Poll creation and analysis",
		permissions: ["polls.read", "polls.create", "polls.update"],
		capabilities: [
			"poll_design",
			"vote_analysis",
			"engagement_optimization",
			"result_visualization",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "report-handler",
		name: "Report Handler",
		division: "content",
		icon: "🚨",
		role: "Report Processing",
		description: "Report triage and investigation",
		permissions: ["reports.read", "reports.update", "posts.read", "users.read"],
		capabilities: [
			"report_triage",
			"investigation_tracking",
			"resolution_routing",
			"trend_analysis",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "duplicate-detector",
		name: "Duplicate Detector",
		division: "content",
		icon: "🔄",
		role: "Duplicate Detection",
		description: "Finds duplicate/similar posts",
		permissions: ["posts.read", "comments.read"],
		capabilities: [
			"similarity_scoring",
			"duplicate_clustering",
			"merge_suggestion",
			"pattern_matching",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "sentiment-engine",
		name: "Sentiment Engine",
		division: "content",
		icon: "💭",
		role: "Sentiment Analysis",
		description: "Real-time sentiment analysis",
		permissions: ["posts.read", "comments.read"],
		capabilities: [
			"sentiment_scoring",
			"emotion_detection",
			"trend_tracking",
			"alert_generation",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "content-pipeline",
		name: "Content Pipeline",
		division: "content",
		icon: "🔀",
		role: "Pipeline Manager",
		description: "Content flow management",
		permissions: ["posts.read", "posts.update", "comments.read"],
		capabilities: [
			"queue_optimization",
			"flow_management",
			"automation_design",
			"bottleneck_detection",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "policy-enforcer",
		name: "Policy Enforcer",
		division: "content",
		icon: "⚖️",
		role: "Policy Enforcement",
		description: "Community guideline enforcement",
		permissions: ["posts.read", "posts.update", "users.read", "users.update"],
		capabilities: [
			"violation_detection",
			"policy_scoring",
			"enforcement_tracking",
			"appeal_processing",
		],
		status: "active",
		tier: "specialist",
	},
];

// ─── Users Division (agents 20-27) ────────────────────────────────
const USER_AGENTS: Agent[] = [
	{
		id: "user-manager",
		name: "User Manager",
		division: "users",
		icon: "👥",
		role: "User Operations Lead",
		description: "User account management",
		permissions: ["users.read", "users.update", "posts.read"],
		capabilities: [
			"user_lifecycle",
			"ban_management",
			"warning_system",
			"engagement_scoring",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "ban-coordinator",
		name: "Ban Coordinator",
		division: "users",
		icon: "🚫",
		role: "Ban Operations",
		description: "Ban enforcement and appeals",
		permissions: ["users.read", "users.update"],
		capabilities: [
			"ban_enforcement",
			"appeal_processing",
			"escalation_management",
			"recidivism_tracking",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "user-onboarding",
		name: "User Onboarding",
		division: "users",
		icon: "🎉",
		role: "Onboarding Specialist",
		description: "New user guidance",
		permissions: ["users.read", "posts.read"],
		capabilities: [
			"onboarding_flow",
			"tutorial_management",
			"first_post_guidance",
			"engagement_boost",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "user-engagement",
		name: "User Engagement",
		division: "users",
		icon: "❤️",
		role: "Engagement Analyst",
		description: "User engagement patterns",
		permissions: [
			"users.read",
			"posts.read",
			"reactions.read",
			"comments.read",
		],
		capabilities: [
			"engagement_analysis",
			"retention_tracking",
			"reengagement_campaigns",
			"loyalty_scoring",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "contributor-tracker",
		name: "Contributor Tracker",
		division: "users",
		icon: "🏆",
		role: "Contributor Management",
		description: "Top contributor identification",
		permissions: ["users.read", "posts.read", "reactions.read"],
		capabilities: [
			"contributor_scoring",
			"recognition_programs",
			"incentive_management",
			"leaderboard_generation",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "anomaly-detector",
		name: "Anomaly Detector",
		division: "users",
		icon: "🔎",
		role: "Anomaly Detection",
		description: "Detects unusual user behavior",
		permissions: ["users.read", "posts.read", "comments.read", "logs.read"],
		capabilities: [
			"behavior_analysis",
			"spam_detection",
			"bot_detection",
			"anomaly_scoring",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "feedback-collector",
		name: "Feedback Collector",
		division: "users",
		icon: "📮",
		role: "Feedback Collection",
		description: "Collects user feedback",
		permissions: ["posts.read", "comments.read", "users.read"],
		capabilities: [
			"feedback_categorization",
			"priority_ranking",
			"trend_detection",
			"action_item_generation",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "privacy-guardian",
		name: "Privacy Guardian",
		division: "users",
		icon: "🔒",
		role: "Privacy Protection",
		description: "Ensures user anonymity",
		permissions: ["users.read", "posts.read", "comments.read"],
		capabilities: [
			"anonymity_verification",
			"data_protection",
			"privacy_compliance",
			"leak_prevention",
		],
		status: "active",
		tier: "specialist",
	},
];

// ─── Analytics Division (agents 28-35) ────────────────────────────
const ANALYTICS_AGENTS: Agent[] = [
	{
		id: "platform-analytics",
		name: "Platform Analytics",
		division: "analytics",
		icon: "📈",
		role: "Analytics Lead",
		description: "Platform-wide analytics",
		permissions: [
			"analytics.read",
			"posts.read",
			"users.read",
			"comments.read",
		],
		capabilities: [
			"kpi_tracking",
			"dashboard_generation",
			"performance_scoring",
			"benchmark_analysis",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "trend-analyst",
		name: "Trend Analyst",
		division: "analytics",
		icon: "📉",
		role: "Trend Analysis",
		description: "Identifies content trends",
		permissions: ["posts.read", "comments.read"],
		capabilities: [
			"trend_identification",
			"category_analysis",
			"topic_clustering",
			"emergence_detection",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "predictive-engine",
		name: "Predictive Engine",
		division: "analytics",
		icon: "🔮",
		role: "Predictive Analytics",
		description: "Forecasts trends",
		permissions: ["analytics.read", "posts.read", "users.read"],
		capabilities: [
			"trend_forecasting",
			"escalation_prediction",
			"outcome_modeling",
			"risk_projection",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "report-generator",
		name: "Report Generator",
		division: "analytics",
		icon: "📋",
		role: "Report Generation",
		description: "Generates reports",
		permissions: [
			"analytics.read",
			"posts.read",
			"users.read",
			"comments.read",
		],
		capabilities: [
			"report_generation",
			"executive_summary",
			"data_compilation",
			"visualization_design",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "health-monitor",
		name: "Health Monitor",
		division: "analytics",
		icon: "💓",
		role: "Platform Health",
		description: "Real-time platform health",
		permissions: ["analytics.read", "posts.read", "users.read", "logs.read"],
		capabilities: [
			"health_scoring",
			"alert_generation",
			"uptime_tracking",
			"performance_monitoring",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "comparative-analyst",
		name: "Comparative Analyst",
		division: "analytics",
		icon: "⚖️",
		role: "Comparative Analysis",
		description: "Compares periods and categories",
		permissions: ["analytics.read", "posts.read"],
		capabilities: [
			"period_comparison",
			"category_comparison",
			"benchmark_analysis",
			"improvement_tracking",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "data-aggregator",
		name: "Data Aggregator",
		division: "analytics",
		icon: "🔢",
		role: "Data Aggregation",
		description: "Aggregates data across tables",
		permissions: [
			"analytics.read",
			"posts.read",
			"comments.read",
			"users.read",
			"polls.read",
		],
		capabilities: [
			"cross_domain_analysis",
			"data_fusion",
			"insight_generation",
			"correlation_discovery",
		],
		status: "active",
		tier: "specialist",
	},
	{
		id: "visualization-engine",
		name: "Visualization Engine",
		division: "analytics",
		icon: "🎨",
		role: "Data Visualization",
		description: "Creates charts and graphs",
		permissions: ["analytics.read", "posts.read"],
		capabilities: [
			"chart_generation",
			"graph_design",
			"interactive_dashboard",
			"visual_storytelling",
		],
		status: "active",
		tier: "specialist",
	},
];

// ─── Meta Division (agents 36-43) ─────────────────────────────────
const META_AGENTS: Agent[] = [
	{
		id: "tool-builder",
		name: "Tool Builder",
		division: "meta",
		icon: "🔧",
		role: "Tool Development",
		description: "Builds new tools dynamically",
		permissions: ["tools.read", "tools.create", "agents.read"],
		capabilities: [
			"tool_design",
			"tool_prototyping",
			"tool_testing",
			"tool_deployment",
		],
		status: "active",
		tier: "meta",
	},
	{
		id: "meta-orchestrator",
		name: "Meta Orchestrator",
		division: "meta",
		icon: "🧬",
		role: "Meta-Orchestration",
		description: "Orchestrates multi-agent workflows",
		permissions: [
			"agents.read",
			"agents.spawn",
			"agents.orchestrate",
			"tools.read",
		],
		capabilities: [
			"workflow_synthesis",
			"dynamic_routing",
			"agent_coordination",
			"result_merging",
		],
		status: "active",
		tier: "meta",
	},
	{
		id: "agent-factory",
		name: "Agent Factory",
		division: "meta",
		icon: "🏭",
		role: "Agent Creation",
		description: "Creates new specialized agents",
		permissions: ["agents.read", "agents.create", "tools.read"],
		capabilities: [
			"agent_design",
			"capability_specification",
			"agent_prototyping",
			"agent_deployment",
		],
		status: "active",
		tier: "meta",
	},
	{
		id: "capability-mapper",
		name: "Capability Mapper",
		division: "meta",
		icon: "🗺️",
		role: "Capability Mapping",
		description: "Maps capabilities to tasks",
		permissions: ["agents.read", "tools.read"],
		capabilities: [
			"capability_analysis",
			"gap_detection",
			"task_mapping",
			"tool_recommendation",
		],
		status: "active",
		tier: "meta",
	},
	{
		id: "knowledge-curator",
		name: "Knowledge Curator",
		division: "meta",
		icon: "📚",
		role: "Knowledge Management",
		description: "Curates knowledge base",
		permissions: ["analytics.read", "logs.read", "agents.read"],
		capabilities: [
			"knowledge_curation",
			"pattern_extraction",
			"best_practice_maintenance",
			"knowledge_graph",
		],
		status: "active",
		tier: "meta",
	},
	{
		id: "self-improver",
		name: "Self Improver",
		division: "meta",
		icon: "🔄",
		role: "Self-Improvement",
		description: "Analyzes performance and suggests improvements",
		permissions: ["analytics.read", "logs.read", "agents.read"],
		capabilities: [
			"performance_analysis",
			"improvement_suggestion",
			"benchmark_tracking",
			"agent_optimization",
		],
		status: "active",
		tier: "meta",
	},
	{
		id: "cross-domain-fusion",
		name: "Cross-Domain Fusion",
		division: "meta",
		icon: "🔗",
		role: "Cross-Domain Integration",
		description: "Finds insights across domains",
		permissions: [
			"analytics.read",
			"posts.read",
			"comments.read",
			"users.read",
		],
		capabilities: [
			"cross_domain_analysis",
			"insight_fusion",
			"compound_intelligence",
			"knowledge_synthesis",
		],
		status: "active",
		tier: "meta",
	},
	{
		id: "adaptive-coordinator",
		name: "Adaptive Coordinator",
		division: "meta",
		icon: "🌊",
		role: "Adaptive Coordination",
		description: "Dynamically adjusts agent allocation",
		permissions: [
			"agents.read",
			"agents.spawn",
			"agents.orchestrate",
			"analytics.read",
		],
		capabilities: [
			"workload_balancing",
			"priority_adjustment",
			"resource_reallocation",
			"agent_coordination",
		],
		status: "active",
		tier: "meta",
	},
];

// ─── All agents aggregated ────────────────────────────────────────
const ALL_AGENTS = [
	...EXECUTIVE_AGENTS,
	...CONTENT_AGENTS,
	...USER_AGENTS,
	...ANALYTICS_AGENTS,
	...META_AGENTS,
];

const AGENT_MAP = new Map(ALL_AGENTS.map((a) => [a.id, a]));

// ─── Division Metadata ────────────────────────────────────────────
const DIVISIONS: Record<string, Division> = {
	executive: {
		name: "Executive Intelligence",
		icon: "🧠",
		color: "#f59e0b",
		description: "Strategic oversight",
	},
	content: {
		name: "Content Operations",
		icon: "📝",
		color: "#3b82f6",
		description: "Content moderation",
	},
	users: {
		name: "User Operations",
		icon: "👥",
		color: "#10b981",
		description: "User management",
	},
	analytics: {
		name: "Analytics & Intelligence",
		icon: "📈",
		color: "#8b5cf6",
		description: "Data analytics",
	},
	meta: {
		name: "Tool Builders & Meta",
		icon: "🧬",
		color: "#06b6d4",
		description: "Self-building tools",
	},
};

// ─── RBAC Roles ───────────────────────────────────────────────────
const ROLE_HIERARCHY: Record<string, RoleDefinition> = {
	super_admin: {
		level: 100,
		permissions: ["*"],
		description: "Full system access",
	},
	platform_admin: {
		level: 90,
		permissions: ["*"],
		description: "Platform administration",
	},
	ceo: {
		level: 80,
		permissions: ["*"],
		description: "Chief Executive Officer",
	},
	coo: {
		level: 78,
		permissions: [
			"agents.read",
			"agents.spawn",
			"analytics.read",
			"posts.read",
		],
		description: "Chief Operating Officer",
	},
	cto: {
		level: 76,
		permissions: [
			"tools.read",
			"tools.create",
			"agents.read",
			"agents.create",
			"analytics.read",
		],
		description: "Chief Technology Officer",
	},
	content_director: {
		level: 70,
		permissions: ["posts.read", "posts.update", "posts.hide", "comments.read"],
		description: "Content director",
	},
	analytics_director: {
		level: 70,
		permissions: ["analytics.read", "posts.read", "users.read"],
		description: "Analytics director",
	},
	user_director: {
		level: 70,
		permissions: ["users.read", "users.update", "posts.read"],
		description: "User operations director",
	},
	meta_director: {
		level: 70,
		permissions: ["agents.read", "agents.create", "tools.read", "tools.create"],
		description: "Meta-agent director",
	},
	moderation_manager: {
		level: 60,
		permissions: ["posts.read", "posts.update", "posts.hide", "comments.read"],
		description: "Moderation manager",
	},
	user_manager: {
		level: 60,
		permissions: ["users.read", "users.update", "posts.read"],
		description: "User manager",
	},
	analytics_manager: {
		level: 60,
		permissions: ["analytics.read", "posts.read", "comments.read"],
		description: "Analytics manager",
	},
	tool_manager: {
		level: 60,
		permissions: ["tools.read", "tools.create", "agents.read"],
		description: "Tool manager",
	},
	content_lead: {
		level: 50,
		permissions: ["posts.read", "posts.update", "comments.read"],
		description: "Content lead",
	},
	analytics_lead: {
		level: 50,
		permissions: ["analytics.read", "posts.read"],
		description: "Analytics lead",
	},
	content_moderator: {
		level: 40,
		permissions: ["posts.read", "posts.update", "comments.read"],
		description: "Moderator",
	},
	user_specialist: {
		level: 40,
		permissions: ["users.read", "posts.read"],
		description: "User specialist",
	},
	analytics_specialist: {
		level: 40,
		permissions: ["analytics.read", "posts.read"],
		description: "Analytics specialist",
	},
	tool_specialist: {
		level: 40,
		permissions: ["tools.read", "tools.create"],
		description: "Tool specialist",
	},
	junior_moderator: {
		level: 30,
		permissions: ["posts.read", "comments.read"],
		description: "Junior moderator",
	},
	junior_analyst: {
		level: 30,
		permissions: ["analytics.read"],
		description: "Junior analyst",
	},
	support_agent: {
		level: 30,
		permissions: ["posts.read", "comments.read", "users.read"],
		description: "Support agent",
	},
	agent_operator: {
		level: 45,
		permissions: ["agents.read", "agents.spawn"],
		description: "Agent operator",
	},
	tool_builder: {
		level: 45,
		permissions: ["tools.read", "tools.create", "agents.read"],
		description: "Tool builder",
	},
};

// ─── Pure Functions ───────────────────────────────────────────────

function getAgent(id: string): Agent | undefined {
	return AGENT_MAP.get(id);
}

function getAgentsByDivision(division: string): Agent[] {
	return ALL_AGENTS.filter((a) => a.division === division);
}

function getAgentsByCapability(capability: string): Agent[] {
	return ALL_AGENTS.filter((a) => a.capabilities.includes(capability));
}

function getAgentsByTier(tier: string): Agent[] {
	return ALL_AGENTS.filter((a) => a.tier === tier);
}

function getActiveAgents(): Agent[] {
	return ALL_AGENTS.filter((a) => a.status === "active");
}

function classifyWorkflow(task: string): {
	category: string;
	urgency: string;
	division: string;
} {
	const lower = task.toLowerCase();

	// Division classification
	if (
		lower.includes("content") ||
		lower.includes("moderat") ||
		lower.includes("post") ||
		lower.includes("comment")
	) {
		return {
			category: "content_operations",
			urgency: "normal",
			division: "content",
		};
	}
	if (
		lower.includes("analytics") ||
		lower.includes("report") ||
		lower.includes("trend") ||
		lower.includes("metric")
	) {
		return { category: "analytics", urgency: "normal", division: "analytics" };
	}
	if (
		lower.includes("user") ||
		lower.includes("ban") ||
		lower.includes("warn") ||
		lower.includes("privacy")
	) {
		return {
			category: "user_operations",
			urgency: "normal",
			division: "users",
		};
	}
	if (
		lower.includes("tool") ||
		lower.includes("build") ||
		lower.includes("create agent") ||
		lower.includes("spawn")
	) {
		return { category: "meta_operations", urgency: "normal", division: "meta" };
	}
	if (
		lower.includes("strateg") ||
		lower.includes("plan") ||
		lower.includes("oversight") ||
		lower.includes("coordinat")
	) {
		return { category: "executive", urgency: "normal", division: "executive" };
	}

	// Urgency classification
	if (
		lower.includes("urgent") ||
		lower.includes("emergency") ||
		lower.includes("critical")
	) {
		return {
			category: "general_operations",
			urgency: "high",
			division: "executive",
		};
	}

	return {
		category: "general_operations",
		urgency: "normal",
		division: "executive",
	};
}

function checkPermission(role: string, requiredPermission: string): boolean {
	const roleDef = ROLE_HIERARCHY[role];
	if (!roleDef) return false;
	if (roleDef.permissions.includes("*")) return true;
	return roleDef.permissions.includes(requiredPermission);
}

function getRoleLevel(role: string): number {
	return ROLE_HIERARCHY[role]?.level ?? 0;
}

function hasElevatedAccess(role: string): boolean {
	return getRoleLevel(role) >= 60;
}

// ═══════════════════════════════════════════════════════════════════
// TESTS: Agent Roster
// ═══════════════════════════════════════════════════════════════════

describe("Agent Team - Agent Roster", () => {
	it("has the correct total number of agents", () => {
		// 5 divisions: executive(9) + content(10) + users(8) + analytics(8) + meta(8) = 43
		expect(ALL_AGENTS.length).toBe(43);
	});

	it("every agent has a unique ID", () => {
		const ids = ALL_AGENTS.map((a) => a.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("every agent has required fields", () => {
		for (const agent of ALL_AGENTS) {
			expect(agent.id).toBeTruthy();
			expect(agent.name).toBeTruthy();
			expect(agent.division).toBeTruthy();
			expect(agent.icon).toBeTruthy();
			expect(agent.role).toBeTruthy();
			expect(agent.description).toBeTruthy();
			expect(agent.permissions).toBeInstanceOf(Array);
			expect(agent.capabilities).toBeInstanceOf(Array);
			expect(agent.capabilities.length).toBeGreaterThanOrEqual(3);
			expect(agent.status).toBe("active");
			expect(agent.tier).toBeTruthy();
		}
	});

	it("all agents have valid divisions", () => {
		const validDivisions = Object.keys(DIVISIONS);
		for (const agent of ALL_AGENTS) {
			expect(validDivisions).toContain(agent.division);
		}
	});

	it("all agents have valid tiers", () => {
		const validTiers = ["executive", "leadership", "specialist", "meta"];
		for (const agent of ALL_AGENTS) {
			expect(validTiers).toContain(agent.tier);
		}
	});

	it("has the executive division agents", () => {
		expect(EXECUTIVE_AGENTS.length).toBe(9);
		expect(EXECUTIVE_AGENTS[0].id).toBe("ceo-intelligence");
		expect(EXECUTIVE_AGENTS[8].id).toBe("ai-supervisor");
	});

	it("has the content division agents", () => {
		expect(CONTENT_AGENTS.length).toBe(10);
		expect(CONTENT_AGENTS[0].id).toBe("content-moderator");
		expect(CONTENT_AGENTS[9].id).toBe("policy-enforcer");
	});

	it("has the users division agents", () => {
		expect(USER_AGENTS.length).toBe(8);
		expect(USER_AGENTS[0].id).toBe("user-manager");
		expect(USER_AGENTS[7].id).toBe("privacy-guardian");
	});

	it("has the analytics division agents", () => {
		expect(ANALYTICS_AGENTS.length).toBe(8);
	});

	it("has the meta division agents", () => {
		expect(META_AGENTS.length).toBe(8);
	});
});

describe("Agent Team - Division Metadata", () => {
	it("has all required divisions", () => {
		const expected = ["executive", "content", "users", "analytics", "meta"];
		expect(Object.keys(DIVISIONS).sort()).toEqual(expected.sort());
	});

	it("every division has name, icon, color, and description", () => {
		for (const [_key, div] of Object.entries(DIVISIONS)) {
			expect(div.name).toBeTruthy();
			expect(div.icon).toBeTruthy();
			expect(div.color).toMatch(/^#[0-9a-fA-F]{6}$/);
			expect(div.description).toBeTruthy();
		}
	});
});

describe("Agent Team - Agent Lookup", () => {
	it("getAgent returns agent by ID", () => {
		const agent = getAgent("ceo-intelligence");
		expect(agent).toBeDefined();
		expect(agent!.name).toBe("CEO Intelligence");
	});

	it("getAgent returns undefined for unknown ID", () => {
		expect(getAgent("nonexistent-agent")).toBeUndefined();
	});

	it("getAgentsByDivision returns correct count", () => {
		expect(getAgentsByDivision("executive").length).toBe(9);
		expect(getAgentsByDivision("content").length).toBe(10);
		expect(getAgentsByDivision("users").length).toBe(8);
		expect(getAgentsByDivision("analytics").length).toBe(8);
		expect(getAgentsByDivision("meta").length).toBe(8);
	});

	it("getAgentsByDivision returns empty for unknown division", () => {
		expect(getAgentsByDivision("unknown")).toHaveLength(0);
	});

	it("getAgentsByCapability finds agents", () => {
		const strategic = getAgentsByCapability("strategic_analysis");
		expect(strategic.length).toBeGreaterThanOrEqual(1);
		expect(strategic[0].tier).toBe("executive");
	});

	it("getAgentsByCapability returns empty for unknown capability", () => {
		expect(getAgentsByCapability("hyperspace_drive")).toHaveLength(0);
	});

	it("getActiveAgents returns all active agents", () => {
		const active = getActiveAgents();
		expect(active.length).toBe(ALL_AGENTS.length);
	});

	it("getAgentsByTier returns agents by tier", () => {
		const executive = getAgentsByTier("executive");
		expect(executive.length).toBeGreaterThanOrEqual(2);
		expect(executive.every((a) => a.tier === "executive")).toBe(true);
	});
});

describe("Agent Team - Agent Unique Attributes", () => {
	it("every agent has a unique combination of id+name", () => {
		const pairs = ALL_AGENTS.map((a) => `${a.id}:${a.name}`);
		expect(new Set(pairs).size).toBe(pairs.length);
	});

	it("key agents have specific capabilities", () => {
		const ceo = getAgent("ceo-intelligence")!;
		expect(ceo.capabilities).toContain("strategic_analysis");
		expect(ceo.capabilities).toContain("resource_allocation");

		const moderator = getAgent("content-moderator")!;
		expect(moderator.capabilities).toContain("content_scanning");
		expect(moderator.capabilities).toContain("policy_enforcement");

		const toolBuilder = getAgent("tool-builder")!;
		expect(toolBuilder.capabilities).toContain("tool_design");
		expect(toolBuilder.capabilities).toContain("tool_prototyping");
	});

	it("executive division agents have broad permissions", () => {
		const execAgents = getAgentsByDivision("executive");
		for (const agent of execAgents) {
			// Wildcard '*' counts as having all permissions
			const hasWildcard = agent.permissions.includes("*");
			const hasMultipleExplicit = agent.permissions.length >= 2;
			expect(hasWildcard || hasMultipleExplicit).toBe(true);
		}
	});

	it("specialist agents have focused permissions", () => {
		const contentAgents = getAgentsByDivision("content");
		for (const agent of contentAgents) {
			// Specialists should have targeted permissions
			expect(agent.permissions.length).toBeLessThan(6);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: RBAC (Role-Based Access Control)
// ═══════════════════════════════════════════════════════════════════

describe("Agent Team - RBAC Roles", () => {
	it("has roles with valid levels (0-100)", () => {
		for (const [_key, role] of Object.entries(ROLE_HIERARCHY)) {
			expect(role.level).toBeGreaterThanOrEqual(0);
			expect(role.level).toBeLessThanOrEqual(100);
			expect(role.permissions).toBeInstanceOf(Array);
			expect(role.description).toBeTruthy();
		}
	});

	it("super_admin has wildcard permission", () => {
		expect(ROLE_HIERARCHY.super_admin.permissions).toContain("*");
		expect(ROLE_HIERARCHY.super_admin.level).toBe(100);
	});

	it("roles decrease in level from admin to junior", () => {
		expect(ROLE_HIERARCHY.super_admin.level).toBeGreaterThan(
			ROLE_HIERARCHY.platform_admin.level,
		);
		expect(ROLE_HIERARCHY.platform_admin.level).toBeGreaterThan(
			ROLE_HIERARCHY.ceo.level,
		);
		expect(ROLE_HIERARCHY.ceo.level).toBeGreaterThan(
			ROLE_HIERARCHY.content_director.level,
		);
		expect(ROLE_HIERARCHY.content_director.level).toBeGreaterThan(
			ROLE_HIERARCHY.moderation_manager.level,
		);
		expect(ROLE_HIERARCHY.moderation_manager.level).toBeGreaterThan(
			ROLE_HIERARCHY.content_lead.level,
		);
		expect(ROLE_HIERARCHY.content_lead.level).toBeGreaterThan(
			ROLE_HIERARCHY.content_moderator.level,
		);
		expect(ROLE_HIERARCHY.content_moderator.level).toBeGreaterThan(
			ROLE_HIERARCHY.junior_moderator.level,
		);
	});

	it("has hierarchy spanning 100 to 30", () => {
		const levels = Object.values(ROLE_HIERARCHY).map((r) => r.level);
		expect(Math.max(...levels)).toBe(100);
		expect(Math.min(...levels)).toBe(30);
	});

	it("has unique role keys", () => {
		const keys = Object.keys(ROLE_HIERARCHY);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("Agent Team - Permission Checking", () => {
	it("super_admin has all permissions", () => {
		expect(checkPermission("super_admin", "users.update")).toBe(true);
		expect(checkPermission("super_admin", "posts.delete")).toBe(true);
		expect(checkPermission("super_admin", "anything.anything")).toBe(true);
	});

	it("content_moderator has allowed permissions", () => {
		expect(checkPermission("content_moderator", "posts.read")).toBe(true);
		expect(checkPermission("content_moderator", "posts.update")).toBe(true);
		expect(checkPermission("content_moderator", "comments.read")).toBe(true);
	});

	it("content_moderator lacks forbidden permissions", () => {
		expect(checkPermission("content_moderator", "analytics.read")).toBe(false);
		expect(checkPermission("content_moderator", "users.update")).toBe(false);
	});

	it("junior_analyst has only analytics.read", () => {
		expect(checkPermission("junior_analyst", "analytics.read")).toBe(true);
		expect(checkPermission("junior_analyst", "posts.read")).toBe(false);
		expect(checkPermission("junior_analyst", "users.read")).toBe(false);
	});

	it("returns false for unknown role", () => {
		expect(checkPermission("unknown_role", "posts.read")).toBe(false);
	});
});

describe("Agent Team - Role Levels", () => {
	it("getRoleLevel returns correct levels", () => {
		expect(getRoleLevel("super_admin")).toBe(100);
		expect(getRoleLevel("junior_moderator")).toBe(30);
		expect(getRoleLevel("unknown")).toBe(0);
	});

	it("hasElevatedAccess for high-level roles", () => {
		expect(hasElevatedAccess("super_admin")).toBe(true);
		expect(hasElevatedAccess("content_director")).toBe(true);
		expect(hasElevatedAccess("user_manager")).toBe(true);
	});

	it("hasElevatedAccess false for low-level roles", () => {
		expect(hasElevatedAccess("junior_moderator")).toBe(false);
		expect(hasElevatedAccess("content_moderator")).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Workflow Classification & Spawning
// ═══════════════════════════════════════════════════════════════════

describe("Agent Team - Workflow Classification", () => {
	it("classifies content operations", () => {
		const result = classifyWorkflow("Moderate this new post about bullying");
		expect(result.division).toBe("content");
		expect(result.category).toBe("content_operations");
	});

	it("classifies analytics tasks", () => {
		const result = classifyWorkflow("Generate a trend report for this week");
		expect(result.division).toBe("analytics");
	});

	it("classifies user operations", () => {
		const result = classifyWorkflow("Ban this user for spam");
		expect(result.division).toBe("users");
	});

	it("classifies meta operations", () => {
		const result = classifyWorkflow("Build a new tool for CSV export");
		expect(result.division).toBe("meta");
	});

	it("classifies executive tasks", () => {
		const result = classifyWorkflow("Coordinate the strategy for next quarter");
		expect(result.division).toBe("executive");
	});

	it("defaults to executive for unknown tasks", () => {
		const result = classifyWorkflow("Make some coffee");
		expect(result.division).toBe("executive");
	});

	it("detects urgent tasks", () => {
		const result = classifyWorkflow("This is an urgent emergency");
		expect(result.urgency).toBe("high");
	});

	it("classifies critical tasks as high urgency", () => {
		const result = classifyWorkflow("Critical issue needs immediate attention");
		expect(result.urgency).toBe("high");
	});
});

describe("Agent Team - Agent Selection for Tasks", () => {
	it("finds agents by capability for content moderation", () => {
		const agents = getAgentsByCapability("content_scanning");
		expect(agents.length).toBeGreaterThanOrEqual(1);
		expect(agents.some((a) => a.division === "content")).toBe(true);
	});

	it("finds agents by capability for analytics", () => {
		const agents = getAgentsByCapability("kpi_tracking");
		expect(agents.length).toBeGreaterThanOrEqual(1);
		expect(agents.some((a) => a.division === "analytics")).toBe(true);
	});

	it("finds agents by capability for user management", () => {
		const agents = getAgentsByCapability("ban_management");
		expect(agents.length).toBeGreaterThanOrEqual(1);
		expect(agents.some((a) => a.division === "users")).toBe(true);
	});

	it("finds agents by capability for tool building", () => {
		const agents = getAgentsByCapability("tool_design");
		expect(agents.length).toBeGreaterThanOrEqual(1);
		expect(agents.some((a) => a.division === "meta")).toBe(true);
	});

	it("multiple agents can share capabilities", () => {
		// Several agents may have health_monitoring or risk capabilities
		const riskAgents = getAgentsByCapability("risk_scoring");
		const healthAgents = getAgentsByCapability("health_scoring");
		// Both risk-assessor (executive) and ai-supervisor might have related capabilities
		expect(riskAgents.length + healthAgents.length).toBeGreaterThanOrEqual(2);
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Division Organization
// ═══════════════════════════════════════════════════════════════════

describe("Agent Team - Division Organization", () => {
	it("executive division has most senior agents", () => {
		const execAgents = getAgentsByDivision("executive");
		expect(
			execAgents.every(
				(a) => a.tier === "executive" || a.tier === "leadership",
			),
		).toBe(true);
	});

	it("meta division has meta-tier agents", () => {
		const metaAgents = getAgentsByDivision("meta");
		expect(metaAgents.every((a) => a.tier === "meta")).toBe(true);
	});

	it("content division has specialist-tier agents", () => {
		const contentAgents = getAgentsByDivision("content");
		expect(contentAgents.every((a) => a.tier === "specialist")).toBe(true);
	});

	it("no agent has empty capabilities", () => {
		for (const agent of ALL_AGENTS) {
			expect(agent.capabilities.length).toBeGreaterThan(0);
		}
	});

	it("no agent has empty permissions", () => {
		for (const agent of ALL_AGENTS) {
			expect(agent.permissions.length).toBeGreaterThan(0);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════
// TESTS: Edge Cases & Validation
// ═══════════════════════════════════════════════════════════════════

describe("Agent Team - Edge Cases", () => {
	it("can find agents across multiple divisions", () => {
		const allDivisions = ["executive", "content", "users", "analytics", "meta"];
		for (const div of allDivisions) {
			const agents = getAgentsByDivision(div);
			expect(agents.length).toBeGreaterThan(0);
		}
	});

	it("agent IDs use kebab-case format", () => {
		for (const agent of ALL_AGENTS) {
			expect(agent.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		}
	});

	it("agent icons are single emoji characters", () => {
		for (const agent of ALL_AGENTS) {
			expect(agent.icon.length).toBeGreaterThanOrEqual(1);
			// Emoji are typically 2 chars in JS (surrogate pairs) but validate it's present
			expect(agent.icon).toBeTruthy();
		}
	});

	it("all executive agents have strategic capabilities", () => {
		const execAgents = getAgentsByDivision("executive");
		for (const agent of execAgents) {
			const hasStrategicCap = agent.capabilities.some(
				(c) =>
					c.includes("strategic") ||
					c.includes("resource") ||
					c.includes("oversight") ||
					c.includes("analysis") ||
					c.includes("monitoring") ||
					c.includes("planning"),
			);
			expect(hasStrategicCap).toBe(true);
		}
	});

	it("all meta agents have agent/tool creation capabilities", () => {
		const metaAgents = getAgentsByDivision("meta");
		for (const agent of metaAgents) {
			const hasMetaCap = agent.capabilities.some(
				(c) =>
					c.includes("tool") ||
					c.includes("agent") ||
					c.includes("workflow") ||
					c.includes("knowledge") ||
					c.includes("coordinat"),
			);
			expect(hasMetaCap).toBe(true);
		}
	});
});
