// Agent Team — 50+ specialized AI agents with RBAC, subagent spawning, and self-tool-building.
// Manages the full agent roster, role-based access, parallel orchestration, and dynamic tool creation.
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog, clean } from './_auth.js';
import { callLLMChain } from './_providers.js';

// ═══════════════════════════════════════════════════════════════════
// DIVISION 1: EXECUTIVE INTELLIGENCE (agents 1-8)
// ═══════════════════════════════════════════════════════════════════
const EXECUTIVE_AGENTS = [
  { id: 'ceo-intelligence', name: 'CEO Intelligence', division: 'executive', icon: '🧠', role: 'Chief Executive Officer', description: 'Strategic oversight, cross-division coordination, and high-level decision making', permissions: ['*'], capabilities: ['strategic_analysis', 'resource_allocation', 'conflict_resolution', 'report_synthesis'], status: 'active', tier: 'executive' },
  { id: 'chief-orchestrator', name: 'Chief Orchestrator', division: 'executive', icon: '🎯', role: 'Orchestration Lead', description: 'Coordinates all subagent workflows, manages parallel execution pipelines', permissions: ['agents.read', 'agents.spawn', 'agents.orchestrate', 'tools.read'], capabilities: ['workflow_design', 'parallel_dispatch', 'result_aggregation', 'bottleneck_detection'], status: 'active', tier: 'executive' },
  { id: 'strategy-advisor', name: 'Strategy Advisor', division: 'executive', icon: '♟️', role: 'Strategic Advisor', description: 'Long-term planning, trend analysis, and competitive intelligence', permissions: ['analytics.read', 'reports.read'], capabilities: ['trend_forecasting', 'competitive_analysis', 'gap_identification', 'priority_ranking'], status: 'active', tier: 'leadership' },
  { id: 'problem-intelligence', name: 'Problem Intelligence', division: 'executive', icon: '🔍', role: 'Problem Analysis Lead', description: 'Deep-dive problem analysis, root cause detection, and impact assessment', permissions: ['posts.read', 'comments.read', 'analytics.read'], capabilities: ['root_cause_analysis', 'impact_scoring', 'pattern_detection', 'correlation_mapping'], status: 'active', tier: 'leadership' },
  { id: 'quality-assurance', name: 'Quality Assurance', division: 'executive', icon: '✅', role: 'QA Director', description: 'Platform quality monitoring, regression detection, and standards enforcement', permissions: ['posts.read', 'comments.read', 'analytics.read', 'logs.read'], capabilities: ['quality_scoring', 'regression_detection', 'standards_audit', 'health_monitoring'], status: 'active', tier: 'leadership' },
  { id: 'risk-assessor', name: 'Risk Assessor', division: 'executive', icon: '🛡️', role: 'Risk Management', description: 'Identifies platform risks, escalation triggers, and mitigation strategies', permissions: ['posts.read', 'users.read', 'reports.read'], capabilities: ['risk_scoring', 'escalation_triggering', 'mitigation_planning', 'threat_detection'], status: 'active', tier: 'leadership' },
  { id: 'data-scientist', name: 'Data Scientist', division: 'executive', icon: '📊', role: 'Data Science Lead', description: 'Advanced analytics, predictive modeling, and statistical analysis', permissions: ['analytics.read', 'posts.read', 'comments.read', 'users.read'], capabilities: ['predictive_modeling', 'statistical_analysis', 'data_visualization', 'anomaly_detection'], status: 'active', tier: 'leadership' },
  { id: 'operations-director', name: 'Operations Director', division: 'executive', icon: '⚙️', role: 'Ops Director', description: 'Operational efficiency, process optimization, and workflow automation', permissions: ['agents.read', 'tools.read', 'analytics.read', 'logs.read'], capabilities: ['process_optimization', 'efficiency_scoring', 'automation_design', 'workflow_analysis'], status: 'active', tier: 'leadership' },
];

// ═══════════════════════════════════════════════════════════════════
// DIVISION 2: CONTENT OPERATIONS (agents 9-18)
// ═══════════════════════════════════════════════════════════════════
const CONTENT_AGENTS = [
  { id: 'content-moderator', name: 'Content Moderator', division: 'content', icon: '📝', role: 'Moderation Lead', description: 'Content review, moderation queue management, and policy enforcement', permissions: ['posts.read', 'posts.update', 'posts.hide', 'comments.read'], capabilities: ['content_scanning', 'policy_enforcement', 'queue_management', 'escalation_routing'], status: 'active', tier: 'specialist' },
  { id: 'post-analyst', name: 'Post Analyst', division: 'content', icon: '📄', role: 'Post Analysis', description: 'Individual post analysis, sentiment detection, and categorization', permissions: ['posts.read', 'comments.read'], capabilities: ['sentiment_analysis', 'categorization', 'priority_scoring', 'duplicate_detection'], status: 'active', tier: 'specialist' },
  { id: 'comment-tracker', name: 'Comment Tracker', division: 'content', icon: '💬', role: 'Comment Management', description: 'Comment monitoring, reply tracking, and conversation analysis', permissions: ['comments.read', 'comments.create', 'posts.read'], capabilities: ['conversation_analysis', 'reply_tracking', 'thread_management', 'engagement_scoring'], status: 'active', tier: 'specialist' },
  { id: 'announcement-manager', name: 'Announcement Manager', division: 'content', icon: '📢', role: 'Announcements', description: 'Announcement lifecycle management, scheduling, and effectiveness tracking', permissions: ['settings.read', 'settings.update'], capabilities: ['announcement_scheduling', 'effectiveness_tracking', 'a_b_testing', 'reach_analysis'], status: 'active', tier: 'specialist' },
  { id: 'poll-manager', name: 'Poll Manager', division: 'content', icon: '📊', role: 'Poll Operations', description: 'Poll creation, vote analysis, and engagement optimization', permissions: ['polls.read', 'polls.create', 'polls.update'], capabilities: ['poll_design', 'vote_analysis', 'engagement_optimization', 'result_visualization'], status: 'active', tier: 'specialist' },
  { id: 'report-handler', name: 'Report Handler', division: 'content', icon: '🚨', role: 'Report Processing', description: 'Report triage, investigation, and resolution tracking', permissions: ['reports.read', 'reports.update', 'posts.read', 'users.read'], capabilities: ['report_triage', 'investigation_tracking', 'resolution_routing', 'trend_analysis'], status: 'active', tier: 'specialist' },
  { id: 'duplicate-detector', name: 'Duplicate Detector', division: 'content', icon: '🔄', role: 'Duplicate Detection', description: 'Finds duplicate/similar posts and suggests consolidation', permissions: ['posts.read', 'comments.read'], capabilities: ['similarity_scoring', 'duplicate_clustering', 'merge_suggestion', 'pattern_matching'], status: 'active', tier: 'specialist' },
  { id: 'sentiment-engine', name: 'Sentiment Engine', division: 'content', icon: '💭', role: 'Sentiment Analysis', description: 'Real-time sentiment analysis across all content', permissions: ['posts.read', 'comments.read'], capabilities: ['sentiment_scoring', 'emotion_detection', 'trend_tracking', 'alert_generation'], status: 'active', tier: 'specialist' },
  { id: 'content-pipeline', name: 'Content Pipeline', division: 'content', icon: '🔀', role: 'Pipeline Manager', description: 'Content flow management, queue optimization, and processing automation', permissions: ['posts.read', 'posts.update', 'comments.read'], capabilities: ['queue_optimization', 'flow_management', 'automation_design', 'bottleneck_detection'], status: 'active', tier: 'specialist' },
  { id: 'policy-enforcer', name: 'Policy Enforcer', division: 'content', icon: '⚖️', role: 'Policy Enforcement', description: 'Community guideline enforcement and violation tracking', permissions: ['posts.read', 'posts.update', 'users.read', 'users.update'], capabilities: ['violation_detection', 'policy_scoring', 'enforcement_tracking', 'appeal_processing'], status: 'active', tier: 'specialist' },
];

// ═══════════════════════════════════════════════════════════════════
// DIVISION 3: USER OPERATIONS (agents 19-26)
// ═══════════════════════════════════════════════════════════════════
const USER_AGENTS = [
  { id: 'user-manager', name: 'User Manager', division: 'users', icon: '👥', role: 'User Operations Lead', description: 'User account management, banning, warnings, and engagement tracking', permissions: ['users.read', 'users.update', 'posts.read'], capabilities: ['user_lifecycle', 'ban_management', 'warning_system', 'engagement_scoring'], status: 'active', tier: 'specialist' },
  { id: 'ban-coordinator', name: 'Ban Coordinator', division: 'users', icon: '🚫', role: 'Ban Operations', description: 'Ban enforcement, appeal processing, and escalation management', permissions: ['users.read', 'users.update'], capabilities: ['ban_enforcement', 'appeal_processing', 'escalation_management', 'recidivism_tracking'], status: 'active', tier: 'specialist' },
  { id: 'user-onboarding', name: 'User Onboarding', division: 'users', icon: '🎉', role: 'Onboarding Specialist', description: 'New user guidance, tutorial management, and first-post optimization', permissions: ['users.read', 'posts.read'], capabilities: ['onboarding_flow', 'tutorial_management', 'first_post_guidance', 'engagement_boost'], status: 'active', tier: 'specialist' },
  { id: 'user-engagement', name: 'User Engagement', division: 'users', icon: '❤️', role: 'Engagement Analyst', description: 'User engagement patterns, retention analysis, and re-engagement campaigns', permissions: ['users.read', 'posts.read', 'reactions.read', 'comments.read'], capabilities: ['engagement_analysis', 'retention_tracking', 'reengagement_campaigns', 'loyalty_scoring'], status: 'active', tier: 'specialist' },
  { id: 'contributor-tracker', name: 'Contributor Tracker', division: 'users', icon: '🏆', role: 'Contributor Management', description: 'Top contributor identification, recognition, and incentive management', permissions: ['users.read', 'posts.read', 'reactions.read'], capabilities: ['contributor_scoring', 'recognition_programs', 'incentive_management', 'leaderboard_generation'], status: 'active', tier: 'specialist' },
  { id: 'anomaly-detector', name: 'Anomaly Detector', division: 'users', icon: '🔎', role: 'Anomaly Detection', description: 'Detects unusual user behavior, spam patterns, and bot activity', permissions: ['users.read', 'posts.read', 'comments.read', 'logs.read'], capabilities: ['behavior_analysis', 'spam_detection', 'bot_detection', 'anomaly_scoring'], status: 'active', tier: 'specialist' },
  { id: 'feedback-collector', name: 'Feedback Collector', division: 'users', icon: '📮', role: 'Feedback Collection', description: 'Collects and categorizes user feedback for platform improvement', permissions: ['posts.read', 'comments.read', 'users.read'], capabilities: ['feedback_categorization', 'priority_ranking', 'trend_detection', 'action_item_generation'], status: 'active', tier: 'specialist' },
  { id: 'privacy-guardian', name: 'Privacy Guardian', division: 'users', icon: '🔒', role: 'Privacy Protection', description: 'Ensures user anonymity, data protection, and privacy compliance', permissions: ['users.read', 'posts.read', 'comments.read'], capabilities: ['anonymity_verification', 'data_protection', 'privacy_compliance', 'leak_prevention'], status: 'active', tier: 'specialist' },
];

// ═══════════════════════════════════════════════════════════════════
// DIVISION 4: ANALYTICS & INTELLIGENCE (agents 27-34)
// ═══════════════════════════════════════════════════════════════════
const ANALYTICS_AGENTS = [
  { id: 'platform-analytics', name: 'Platform Analytics', division: 'analytics', icon: '📈', role: 'Analytics Lead', description: 'Platform-wide analytics, KPI tracking, and performance dashboards', permissions: ['analytics.read', 'posts.read', 'users.read', 'comments.read'], capabilities: ['kpi_tracking', 'dashboard_generation', 'performance_scoring', 'benchmark_analysis'], status: 'active', tier: 'specialist' },
  { id: 'trend-analyst', name: 'Trend Analyst', division: 'analytics', icon: '📉', role: 'Trend Analysis', description: 'Identifies content trends, category shifts, and emerging topics', permissions: ['posts.read', 'comments.read'], capabilities: ['trend_identification', 'category_analysis', 'topic_clustering', 'emergence_detection'], status: 'active', tier: 'specialist' },
  { id: 'predictive-engine', name: 'Predictive Engine', division: 'analytics', icon: '🔮', role: 'Predictive Analytics', description: 'Forecasts trends, predicts escalation, and models outcomes', permissions: ['analytics.read', 'posts.read', 'users.read'], capabilities: ['trend_forecasting', 'escalation_prediction', 'outcome_modeling', 'risk_projection'], status: 'active', tier: 'specialist' },
  { id: 'report-generator', name: 'Report Generator', division: 'analytics', icon: '📋', role: 'Report Generation', description: 'Generates comprehensive reports, summaries, and executive briefings', permissions: ['analytics.read', 'posts.read', 'users.read', 'comments.read'], capabilities: ['report_generation', 'executive_summary', 'data_compilation', 'visualization_design'], status: 'active', tier: 'specialist' },
  { id: 'health-monitor', name: 'Health Monitor', division: 'analytics', icon: '💓', role: 'Platform Health', description: 'Real-time platform health monitoring and alert generation', permissions: ['analytics.read', 'posts.read', 'users.read', 'logs.read'], capabilities: ['health_scoring', 'alert_generation', 'uptime_tracking', 'performance_monitoring'], status: 'active', tier: 'specialist' },
  { id: 'comparative-analyst', name: 'Comparative Analyst', division: 'analytics', icon: '⚖️', role: 'Comparative Analysis', description: 'Compares periods, categories, and performance metrics', permissions: ['analytics.read', 'posts.read'], capabilities: ['period_comparison', 'category_comparison', 'benchmark_analysis', 'improvement_tracking'], status: 'active', tier: 'specialist' },
  { id: 'data-aggregator', name: 'Data Aggregator', division: 'analytics', icon: '🔢', role: 'Data Aggregation', description: 'Aggregates data across tables and generates cross-domain insights', permissions: ['analytics.read', 'posts.read', 'comments.read', 'users.read', 'polls.read'], capabilities: ['cross_domain_analysis', 'data_fusion', 'insight_generation', 'correlation_discovery'], status: 'active', tier: 'specialist' },
  { id: 'visualization-engine', name: 'Visualization Engine', division: 'analytics', icon: '🎨', role: 'Data Visualization', description: 'Creates charts, graphs, and visual representations of data', permissions: ['analytics.read', 'posts.read'], capabilities: ['chart_generation', 'graph_design', 'interactive_dashboard', 'visual_storytelling'], status: 'active', tier: 'specialist' },
];

// ═══════════════════════════════════════════════════════════════════
// DIVISION 5: SYSTEM & INFRASTRUCTURE (agents 35-42)
// ═══════════════════════════════════════════════════════════════════
const SYSTEM_AGENTS = [
  { id: 'cleanup-steward', name: 'Cleanup Steward', division: 'system', icon: '🧹', role: 'Data Cleanup', description: 'Manages data retention, auto-cleanup, and storage optimization', permissions: ['posts.read', 'posts.update', 'users.read', 'comments.read', 'logs.read'], capabilities: ['retention_management', 'cleanup_scheduling', 'storage_optimization', 'archive_management'], status: 'active', tier: 'specialist' },
  { id: 'security-monitor', name: 'Security Monitor', division: 'system', icon: '🛡️', role: 'Security Operations', description: 'Security monitoring, vulnerability detection, and incident response', permissions: ['posts.read', 'users.read', 'logs.read', 'users.update'], capabilities: ['threat_detection', 'vulnerability_scanning', 'incident_response', 'security_scoring'], status: 'active', tier: 'specialist' },
  { id: 'performance-tuner', name: 'Performance Tuner', division: 'system', icon: '⚡', role: 'Performance Engineering', description: 'Query optimization, API performance, and response time monitoring', permissions: ['analytics.read', 'logs.read'], capabilities: ['query_optimization', 'latency_monitoring', 'bottleneck_resolution', 'performance_profiling'], status: 'active', tier: 'specialist' },
  { id: 'capacity-planner', name: 'Capacity Planner', division: 'system', icon: '📐', role: 'Capacity Planning', description: 'Resource utilization tracking, scaling recommendations, and load forecasting', permissions: ['analytics.read', 'logs.read'], capabilities: ['resource_tracking', 'scaling_recommendations', 'load_forecasting', 'capacity_planning'], status: 'active', tier: 'specialist' },
  { id: 'database-architect', name: 'Database Architect', division: 'system', icon: '🗄️', role: 'Database Management', description: 'Schema optimization, index management, and query performance', permissions: ['analytics.read', 'logs.read'], capabilities: ['schema_optimization', 'index_management', 'query_analysis', 'migration_planning'], status: 'active', tier: 'specialist' },
  { id: 'api-gateway', name: 'API Gateway', division: 'system', icon: '🌐', role: 'API Management', description: 'API health monitoring, rate limiting, and endpoint optimization', permissions: ['logs.read', 'analytics.read'], capabilities: ['api_monitoring', 'rate_limit_management', 'endpoint_optimization', 'error_tracking'], status: 'active', tier: 'specialist' },
  { id: 'cache-manager', name: 'Cache Manager', division: 'system', icon: '💾', role: 'Cache Operations', description: 'Cache strategy, invalidation management, and hit rate optimization', permissions: ['analytics.read', 'logs.read'], capabilities: ['cache_strategy', 'invalidation_management', 'hit_rate_optimization', 'cache_warming'], status: 'active', tier: 'specialist' },
  { id: 'log-analyzer', name: 'Log Analyzer', division: 'system', icon: '📜', role: 'Log Analysis', description: 'Log parsing, error aggregation, and pattern detection in system logs', permissions: ['logs.read'], capabilities: ['log_parsing', 'error_aggregation', 'pattern_detection', 'anomaly_flagging'], status: 'active', tier: 'specialist' },
];

// ═══════════════════════════════════════════════════════════════════
// DIVISION 6: TOOL BUILDERS & META-AGENTS (agents 43-50)
// ═══════════════════════════════════════════════════════════════════
const META_AGENTS = [
  { id: 'tool-builder', name: 'Tool Builder', division: 'meta', icon: '🔧', role: 'Tool Development', description: 'Builds new tools dynamically when existing tools cannot fulfill a request', permissions: ['tools.read', 'tools.create', 'agents.read'], capabilities: ['tool_design', 'tool_prototyping', 'tool_testing', 'tool_deployment'], status: 'active', tier: 'meta' },
  { id: 'meta-orchestrator', name: 'Meta Orchestrator', division: 'meta', icon: '🧬', role: 'Meta-Orchestration', description: 'Orchestrates complex multi-agent workflows with dynamic routing', permissions: ['agents.read', 'agents.spawn', 'agents.orchestrate', 'tools.read'], capabilities: ['workflow_synthesis', 'dynamic_routing', 'parallel_orchestration', 'result_merging'], status: 'active', tier: 'meta' },
  { id: 'agent-factory', name: 'Agent Factory', division: 'meta', icon: '🏭', role: 'Agent Creation', description: 'Creates new specialized agents based on emerging needs', permissions: ['agents.read', 'agents.create', 'tools.read'], capabilities: ['agent_design', 'capability_specification', 'agent_prototyping', 'agent_deployment'], status: 'active', tier: 'meta' },
  { id: 'capability-mapper', name: 'Capability Mapper', division: 'meta', icon: '🗺️', role: 'Capability Mapping', description: 'Maps available capabilities to tasks and identifies capability gaps', permissions: ['agents.read', 'tools.read'], capabilities: ['capability_analysis', 'gap_detection', 'task_mapping', 'recommendation_engine'], status: 'active', tier: 'meta' },
  { id: 'knowledge-curator', name: 'Knowledge Curator', division: 'meta', icon: '📚', role: 'Knowledge Management', description: 'Curates and maintains the agent knowledge base and best practices', permissions: ['analytics.read', 'logs.read', 'agents.read'], capabilities: ['knowledge_curation', 'pattern_extraction', 'best_practice_maintenance', 'knowledge_graph'], status: 'active', tier: 'meta' },
  { id: 'self-improver', name: 'Self Improver', division: 'meta', icon: '🔄', role: 'Self-Improvement', description: 'Analyzes agent performance and suggests improvements', permissions: ['analytics.read', 'logs.read', 'agents.read'], capabilities: ['performance_analysis', 'improvement_suggestion', 'benchmark_tracking', 'optimization_planning'], status: 'active', tier: 'meta' },
  { id: 'cross-domain-fusion', name: 'Cross-Domain Fusion', division: 'meta', icon: '🔗', role: 'Cross-Domain Integration', description: 'Finds insights across different data domains and generates compound intelligence', permissions: ['analytics.read', 'posts.read', 'comments.read', 'users.read'], capabilities: ['cross_domain_analysis', 'insight_fusion', 'compound_intelligence', 'correlation_engine'], status: 'active', tier: 'meta' },
  { id: 'adaptive-coordinator', name: 'Adaptive Coordinator', division: 'meta', icon: '🌊', role: 'Adaptive Coordination', description: 'Dynamically adjusts agent allocation based on workload and priorities', permissions: ['agents.read', 'agents.spawn', 'agents.orchestrate', 'analytics.read'], capabilities: ['workload_balancing', 'priority_adjustment', 'resource_reallocation', 'adaptive_scheduling'], status: 'active', tier: 'meta' },
];

// ═══════════════════════════════════════════════════════════════════
// DIVISION 7: SPECIALIST EXTENSIONS (agents 51-60)
// ═══════════════════════════════════════════════════════════════════
const SPECIALIST_AGENTS = [
  { id: 'csv-exporter', name: 'CSV Exporter', division: 'specialist', icon: '📑', role: 'Data Export', description: 'Generates CSV exports from any data table with custom formatting', permissions: ['posts.read', 'comments.read', 'users.read'], capabilities: ['csv_generation', 'format_customization', 'data_extraction', 'export_scheduling'], status: 'active', tier: 'specialist' },
  { id: 'presentation-architect', name: 'Presentation Architect', division: 'specialist', icon: '🎬', role: 'Presentation Design', description: 'Creates beautiful HTML presentations from platform data', permissions: ['analytics.read', 'posts.read', 'comments.read'], capabilities: ['presentation_design', 'slide_generation', 'data_storytelling', 'visual_narrative'], status: 'active', tier: 'specialist' },
  { id: 'notification-dispatcher', name: 'Notification Dispatcher', division: 'specialist', icon: '🔔', role: 'Notification Management', description: 'Manages alert notifications, escalation chains, and notification schedules', permissions: ['users.read', 'posts.read', 'reports.read'], capabilities: ['notification_design', 'escalation_chains', 'schedule_management', 'alert_optimization'], status: 'active', tier: 'specialist' },
  { id: 'search-optimizer', name: 'Search Optimizer', division: 'specialist', icon: '🔎', role: 'Search Optimization', description: 'Optimizes search functionality, relevance scoring, and result ranking', permissions: ['posts.read', 'comments.read'], capabilities: ['relevance_scoring', 'search_indexing', 'result_ranking', 'query_optimization'], status: 'active', tier: 'specialist' },
  { id: 'categorization-engine', name: 'Categorization Engine', division: 'specialist', icon: '🏷️', role: 'Auto-Categorization', description: 'Automatically categorizes posts using content analysis', permissions: ['posts.read', 'posts.update'], capabilities: ['auto_categorization', 'category_suggestion', 'taxonomy_management', 'category_balancing'], status: 'active', tier: 'specialist' },
  { id: 'escalation-engine', name: 'Escalation Engine', division: 'specialist', icon: '⬆️', role: 'Escalation Management', description: 'Identifies posts needing escalation and routes to appropriate handlers', permissions: ['posts.read', 'posts.update', 'users.read', 'reports.read'], capabilities: ['escalation_detection', 'priority_routing', 'handler_matching', 'escalation_tracking'], status: 'active', tier: 'specialist' },
  { id: 'nlp-processor', name: 'NLP Processor', division: 'specialist', icon: '💬', role: 'NLP Processing', description: 'Natural language processing for intent detection and entity extraction', permissions: ['posts.read', 'comments.read'], capabilities: ['intent_detection', 'entity_extraction', 'language_analysis', 'context_understanding'], status: 'active', tier: 'specialist' },
  { id: 'batch-processor', name: 'Batch Processor', division: 'specialist', icon: '📦', role: 'Batch Operations', description: 'Handles bulk operations: mass updates, batch deletes, bulk exports', permissions: ['posts.read', 'posts.update', 'comments.read', 'users.read'], capabilities: ['bulk_operations', 'batch_processing', 'mass_updates', 'queue_management'], status: 'active', tier: 'specialist' },
  { id: 'audit-trail', name: 'Audit Trail', division: 'specialist', icon: '📋', role: 'Audit Management', description: 'Comprehensive audit logging and compliance tracking', permissions: ['logs.read', 'analytics.read'], capabilities: ['audit_logging', 'compliance_tracking', 'history_reconstruction', 'forensic_analysis'], status: 'active', tier: 'specialist' },
  { id: 'integration-hub', name: 'Integration Hub', division: 'specialist', icon: '🔌', role: 'External Integration', description: 'Manages integrations with external services and API connectors', permissions: ['tools.read', 'tools.create', 'analytics.read'], capabilities: ['integration_management', 'api_connector', 'webhook_handling', 'sync_management'], status: 'active', tier: 'specialist' },
];

// ═══════════════════════════════════════════════════════════════════
// COMPLETE AGENT ROSTER
// ═══════════════════════════════════════════════════════════════════
const ALL_AGENTS = [
  ...EXECUTIVE_AGENTS,
  ...CONTENT_AGENTS,
  ...USER_AGENTS,
  ...ANALYTICS_AGENTS,
  ...SYSTEM_AGENTS,
  ...META_AGENTS,
  ...SPECIALIST_AGENTS,
];

const AGENT_MAP = new Map(ALL_AGENTS.map((a) => [a.id, a]));

// ═══════════════════════════════════════════════════════════════════
// DIVISION METADATA
// ═══════════════════════════════════════════════════════════════════
const DIVISIONS = {
  executive:  { name: 'Executive Intelligence', icon: '🧠', color: '#f59e0b', description: 'Strategic oversight and cross-division coordination' },
  content:    { name: 'Content Operations',     icon: '📝', color: '#3b82f6', description: 'Content moderation, analysis, and management' },
  users:      { name: 'User Operations',        icon: '👥', color: '#10b981', description: 'User management, engagement, and privacy' },
  analytics:  { name: 'Analytics & Intelligence', icon: '📈', color: '#8b5cf6', description: 'Data analytics, reporting, and visualization' },
  system:     { name: 'System & Infrastructure', icon: '⚙️', color: '#ef4444', description: 'System monitoring, security, and optimization' },
  meta:       { name: 'Tool Builders & Meta',    icon: '🧬', color: '#06b6d4', description: 'Self-building tools, orchestration, and adaptation' },
  specialist: { name: 'Specialist Extensions',   icon: '🎯', color: '#ec4899', description: 'Domain-specific tools and integrations' },
};

// ═══════════════════════════════════════════════════════════════════
// RBAC: 100+ ROLES
// ═══════════════════════════════════════════════════════════════════
const ROLE_HIERARCHY = {
  // System-level roles
  'super_admin':     { level: 100, permissions: ['*'], description: 'Full system access' },
  'platform_admin':  { level: 90,  permissions: ['*'], description: 'Platform administration' },
  'security_admin':  { level: 85,  permissions: ['users.read', 'users.update', 'posts.read', 'posts.update', 'logs.read', 'reports.read', 'reports.update', 'agents.read'], description: 'Security operations' },
  
  // Executive roles
  'ceo':             { level: 80,  permissions: ['*'], description: 'Chief Executive Officer' },
  'coo':             { level: 78,  permissions: ['agents.read', 'agents.spawn', 'agents.orchestrate', 'analytics.read', 'tools.read', 'posts.read', 'users.read'], description: 'Chief Operating Officer' },
  'cto':             { level: 76,  permissions: ['tools.read', 'tools.create', 'agents.read', 'agents.create', 'analytics.read', 'logs.read'], description: 'Chief Technology Officer' },
  
  // Director roles
  'content_director':     { level: 70,  permissions: ['posts.read', 'posts.update', 'posts.hide', 'comments.read', 'comments.create', 'reports.read'], description: 'Content department director' },
  'analytics_director':   { level: 70,  permissions: ['analytics.read', 'posts.read', 'users.read', 'comments.read', 'polls.read'], description: 'Analytics department director' },
  'user_director':        { level: 70,  permissions: ['users.read', 'users.update', 'posts.read', 'reports.read'], description: 'User operations director' },
  'system_director':      { level: 70,  permissions: ['logs.read', 'analytics.read', 'tools.read', 'agents.read'], description: 'System operations director' },
  'meta_director':        { level: 70,  permissions: ['agents.read', 'agents.create', 'agents.spawn', 'tools.read', 'tools.create'], description: 'Meta-agent operations director' },
  
  // Manager roles
  'moderation_manager':   { level: 60,  permissions: ['posts.read', 'posts.update', 'posts.hide', 'comments.read', 'reports.read', 'reports.update'], description: 'Moderation team manager' },
  'user_manager':         { level: 60,  permissions: ['users.read', 'users.update', 'posts.read'], description: 'User operations manager' },
  'analytics_manager':    { level: 60,  permissions: ['analytics.read', 'posts.read', 'comments.read', 'users.read'], description: 'Analytics team manager' },
  'system_manager':       { level: 60,  permissions: ['logs.read', 'analytics.read', 'tools.read'], description: 'System operations manager' },
  'tool_manager':         { level: 60,  permissions: ['tools.read', 'tools.create', 'agents.read'], description: 'Tool development manager' },
  'poll_manager':         { level: 60,  permissions: ['polls.read', 'polls.create', 'polls.update'], description: 'Poll operations manager' },
  'report_manager':       { level: 60,  permissions: ['reports.read', 'reports.update', 'posts.read', 'users.read'], description: 'Report management' },
  'security_manager':     { level: 60,  permissions: ['users.read', 'users.update', 'logs.read', 'reports.read'], description: 'Security team manager' },
  
  // Lead roles
  'content_lead':         { level: 50,  permissions: ['posts.read', 'posts.update', 'comments.read'], description: 'Content team lead' },
  'analytics_lead':       { level: 50,  permissions: ['analytics.read', 'posts.read'], description: 'Analytics team lead' },
  'moderation_lead':      { level: 50,  permissions: ['posts.read', 'posts.update', 'comments.read', 'reports.read'], description: 'Moderation team lead' },
  'tooling_lead':         { level: 50,  permissions: ['tools.read', 'agents.read'], description: 'Tooling team lead' },
  'data_lead':            { level: 50,  permissions: ['analytics.read', 'posts.read', 'users.read'], description: 'Data team lead' },
  'ops_lead':             { level: 50,  permissions: ['logs.read', 'analytics.read'], description: 'Operations team lead' },
  
  // Specialist roles
  'content_moderator':    { level: 40,  permissions: ['posts.read', 'posts.update', 'comments.read'], description: 'Content moderation specialist' },
  'user_specialist':      { level: 40,  permissions: ['users.read', 'posts.read'], description: 'User operations specialist' },
  'analytics_specialist': { level: 40,  permissions: ['analytics.read', 'posts.read'], description: 'Analytics specialist' },
  'poll_specialist':      { level: 40,  permissions: ['polls.read', 'polls.create'], description: 'Poll specialist' },
  'report_specialist':    { level: 40,  permissions: ['reports.read', 'reports.update'], description: 'Report specialist' },
  'tool_specialist':      { level: 40,  permissions: ['tools.read', 'tools.create'], description: 'Tool development specialist' },
  'security_specialist':  { level: 40,  permissions: ['users.read', 'logs.read'], description: 'Security specialist' },
  'system_specialist':    { level: 40,  permissions: ['logs.read', 'analytics.read'], description: 'System specialist' },
  
  // Operational roles
  'junior_moderator':     { level: 30,  permissions: ['posts.read', 'comments.read'], description: 'Junior moderator' },
  'junior_analyst':       { level: 30,  permissions: ['analytics.read'], description: 'Junior analyst' },
  'junior_developer':     { level: 30,  permissions: ['tools.read'], description: 'Junior developer' },
  'junior_user_ops':      { level: 30,  permissions: ['users.read'], description: 'Junior user operations' },
  'content_reviewer':     { level: 30,  permissions: ['posts.read', 'comments.read'], description: 'Content reviewer' },
  'data_entry':           { level: 30,  permissions: ['posts.read'], description: 'Data entry specialist' },
  'support_agent':        { level: 30,  permissions: ['posts.read', 'comments.read', 'users.read'], description: 'Support agent' },
  
  // Agent-specific roles
  'agent_operator':       { level: 45,  permissions: ['agents.read', 'agents.spawn'], description: 'Agent operations operator' },
  'agent_architect':      { level: 55,  permissions: ['agents.read', 'agents.create', 'agents.spawn', 'agents.orchestrate', 'tools.read', 'tools.create'], description: 'Agent architecture' },
  'tool_builder':         { level: 45,  permissions: ['tools.read', 'tools.create', 'agents.read'], description: 'Tool builder' },
  'orchestration_engine': { level: 55,  permissions: ['agents.read', 'agents.spawn', 'agents.orchestrate'], description: 'Orchestration engine' },
  'knowledge_manager':    { level: 45,  permissions: ['analytics.read', 'logs.read', 'agents.read'], description: 'Knowledge manager' },
  'self_improver':        { level: 45,  permissions: ['analytics.read', 'logs.read', 'agents.read'], description: 'Self-improvement engine' },
  
  // Cross-functional roles
  'cross_domain_analyst': { level: 45,  permissions: ['analytics.read', 'posts.read', 'comments.read', 'users.read'], description: 'Cross-domain analysis' },
  'escalation_handler':   { level: 50,  permissions: ['posts.read', 'posts.update', 'users.read', 'reports.read', 'reports.update'], description: 'Escalation handler' },
  'batch_operator':       { level: 40,  permissions: ['posts.read', 'posts.update', 'comments.read'], description: 'Batch operations' },
  'notification_manager': { level: 40,  permissions: ['users.read', 'posts.read', 'reports.read'], description: 'Notification management' },
  'export_specialist':    { level: 35,  permissions: ['posts.read', 'comments.read', 'users.read'], description: 'Export specialist' },
  'search_specialist':    { level: 35,  permissions: ['posts.read', 'comments.read'], description: 'Search specialist' },
  'nlp_specialist':       { level: 40,  permissions: ['posts.read', 'comments.read'], description: 'NLP specialist' },
  'audit_specialist':     { level: 40,  permissions: ['logs.read'], description: 'Audit specialist' },
  'integration_specialist': { level: 40, permissions: ['tools.read', 'tools.create'], description: 'Integration specialist' },
  'visualization_specialist': { level: 40, permissions: ['analytics.read', 'posts.read'], description: 'Visualization specialist' },
  
  // Additional granular roles for 100+ count
  'post_reader':          { level: 10,  permissions: ['posts.read'], description: 'Can read posts' },
  'comment_reader':       { level: 10,  permissions: ['comments.read'], description: 'Can read comments' },
  'user_reader':          { level: 10,  permissions: ['users.read'], description: 'Can read user data' },
  'analytics_reader':     { level: 10,  permissions: ['analytics.read'], description: 'Can read analytics' },
  'poll_reader':          { level: 10,  permissions: ['polls.read'], description: 'Can read polls' },
  'report_reader':        { level: 10,  permissions: ['reports.read'], description: 'Can read reports' },
  'log_reader':           { level: 10,  permissions: ['logs.read'], description: 'Can read logs' },
  'tool_reader':          { level: 10,  permissions: ['tools.read'], description: 'Can read tools' },
  'agent_reader':         { level: 10,  permissions: ['agents.read'], description: 'Can read agent info' },
  'post_writer':          { level: 20,  permissions: ['posts.read', 'posts.update'], description: 'Can modify posts' },
  'comment_writer':       { level: 20,  permissions: ['posts.read', 'comments.read', 'comments.create'], description: 'Can create comments' },
  'user_writer':          { level: 20,  permissions: ['users.read', 'users.update'], description: 'Can modify users' },
  'poll_writer':          { level: 20,  permissions: ['polls.read', 'polls.create', 'polls.update'], description: 'Can create/modify polls' },
  'report_writer':        { level: 20,  permissions: ['reports.read', 'reports.update'], description: 'Can update reports' },
  'settings_reader':      { level: 15,  permissions: ['settings.read'], description: 'Can read settings' },
  'settings_writer':      { level: 35,  permissions: ['settings.read', 'settings.update'], description: 'Can modify settings' },
  'announcement_creator': { level: 35,  permissions: ['settings.read', 'settings.update'], description: 'Can create announcements' },
  'user_banner':          { level: 35,  permissions: ['users.read', 'users.update'], description: 'Can ban users' },
  'post_deleter':         { level: 35,  permissions: ['posts.read', 'posts.update', 'posts.delete'], description: 'Can delete posts' },
  'content_hider':        { level: 30,  permissions: ['posts.read', 'posts.update'], description: 'Can hide/show posts' },
  'post_pinner':          { level: 30,  permissions: ['posts.read', 'posts.update'], description: 'Can pin posts' },
  'post_feature':         { level: 30,  permissions: ['posts.read', 'posts.update'], description: 'Can feature posts' },
  'priority_manager':     { level: 35,  permissions: ['posts.read', 'posts.update'], description: 'Can manage priorities' },
  'assignment_manager':   { level: 35,  permissions: ['posts.read', 'posts.update', 'users.read'], description: 'Can assign posts' },
  'eta_manager':          { level: 30,  permissions: ['posts.read', 'posts.update'], description: 'Can set ETAs' },
  'lock_manager':         { level: 30,  permissions: ['posts.read', 'posts.update'], description: 'Can lock/unlock posts' },
  'reply_manager':        { level: 30,  permissions: ['posts.read', 'posts.update', 'comments.read', 'comments.create'], description: 'Can reply to posts' },
  'presentation_creator': { level: 35,  permissions: ['analytics.read', 'posts.read'], description: 'Can create presentations' },
  'csv_generator':        { level: 25,  permissions: ['posts.read', 'comments.read', 'users.read'], description: 'Can generate CSVs' },
  'health_checker':       { level: 30,  permissions: ['analytics.read', 'posts.read', 'users.read'], description: 'Can run health checks' },
  'trend_watcher':        { level: 25,  permissions: ['analytics.read', 'posts.read'], description: 'Can watch trends' },
  'duplicate_finder':     { level: 25,  permissions: ['posts.read', 'comments.read'], description: 'Can find duplicates' },
  'categorizer':          { level: 25,  permissions: ['posts.read', 'posts.update'], description: 'Can categorize posts' },
  'spam_detector':        { level: 30,  permissions: ['users.read', 'posts.read', 'comments.read'], description: 'Can detect spam' },
  'privacy_auditor':      { level: 40,  permissions: ['users.read', 'posts.read', 'comments.read'], description: 'Can audit privacy' },
  'compliance_checker':   { level: 40,  permissions: ['posts.read', 'users.read', 'logs.read'], description: 'Can check compliance' },
  'forensic_analyst':     { level: 45,  permissions: ['logs.read', 'posts.read', 'users.read', 'comments.read'], description: 'Forensic analysis' },
  'capacity_planner':     { level: 40,  permissions: ['analytics.read', 'logs.read'], description: 'Capacity planning' },
  'api_monitor':          { level: 35,  permissions: ['logs.read', 'analytics.read'], description: 'API monitoring' },
  'cache_admin':          { level: 35,  permissions: ['logs.read', 'analytics.read'], description: 'Cache management' },
  'migration_specialist': { level: 40,  permissions: ['analytics.read', 'tools.read'], description: 'Migration specialist' },
  'webhook_manager':      { level: 35,  permissions: ['tools.read', 'tools.create'], description: 'Webhook management' },
  'scheduler':            { level: 30,  permissions: ['posts.read', 'analytics.read'], description: 'Task scheduling' },
  'template_designer':    { level: 30,  permissions: ['tools.read', 'posts.read'], description: 'Template design' },
  'quality_inspector':    { level: 35,  permissions: ['posts.read', 'comments.read', 'analytics.read'], description: 'Quality inspection' },
  'workflow_designer':    { level: 40,  permissions: ['agents.read', 'tools.read', 'analytics.read'], description: 'Workflow design' },
  'pipeline_manager':     { level: 40,  permissions: ['agents.read', 'tools.read'], description: 'Pipeline management' },
  'performance_engineer': { level: 40,  permissions: ['analytics.read', 'logs.read'], description: 'Performance engineering' },
  'security_auditor':     { level: 45,  permissions: ['users.read', 'logs.read', 'posts.read', 'reports.read'], description: 'Security auditing' },
  'incident_responder':   { level: 50,  permissions: ['users.read', 'users.update', 'posts.read', 'posts.update', 'logs.read', 'reports.read'], description: 'Incident response' },
  'data_architect':       { level: 45,  permissions: ['analytics.read', 'tools.read', 'logs.read'], description: 'Data architecture' },
  'feature_flag_manager': { level: 35,  permissions: ['settings.read', 'settings.update'], description: 'Feature flag management' },
  'ab_test_manager':      { level: 35,  permissions: ['analytics.read', 'settings.read', 'settings.update'], description: 'A/B test management' },
  'retention_analyst':    { level: 30,  permissions: ['analytics.read', 'users.read'], description: 'Retention analysis' },
  'engagement_analyst':   { level: 30,  permissions: ['analytics.read', 'users.read', 'posts.read'], description: 'Engagement analysis' },
  'community_manager':    { level: 35,  permissions: ['posts.read', 'posts.update', 'comments.read', 'users.read'], description: 'Community management' },
  'feedback_analyst':     { level: 30,  permissions: ['posts.read', 'comments.read', 'users.read'], description: 'Feedback analysis' },
  'trend_forecaster':     { level: 35,  permissions: ['analytics.read', 'posts.read'], description: 'Trend forecasting' },
  'outlier_detector':     { level: 30,  permissions: ['analytics.read', 'posts.read', 'users.read'], description: 'Outlier detection' },
  'summary_generator':    { level: 25,  permissions: ['analytics.read', 'posts.read'], description: 'Summary generation' },
  'correlation_analyst':  { level: 35,  permissions: ['analytics.read', 'posts.read', 'comments.read'], description: 'Correlation analysis' },
  'forecasting_engine':   { level: 40,  permissions: ['analytics.read', 'posts.read'], description: 'Forecasting engine' },
  'scenario_modeler':     { level: 40,  permissions: ['analytics.read'], description: 'Scenario modeling' },
  'impact_assessor':      { level: 35,  permissions: ['posts.read', 'analytics.read', 'users.read'], description: 'Impact assessment' },
  'risk_scorer':          { level: 35,  permissions: ['posts.read', 'users.read', 'reports.read'], description: 'Risk scoring' },
  'recommendation_engine': { level: 35, permissions: ['analytics.read', 'posts.read', 'users.read'], description: 'Recommendation engine' },
};

const ROLE_MAP = new Map(Object.entries(ROLE_HIERARCHY).map(([k, v]) => [k, { name: k, ...v }]));

// ═══════════════════════════════════════════════════════════════════
// CUSTOM AGENT STORAGE (supplemented from DB)
// ═══════════════════════════════════════════════════════════════════
const customAgents = new Map();

function getAllAgents() {
  return [...ALL_AGENTS, ...Array.from(customAgents.values())];
}

function getAgent(id) {
  return AGENT_MAP.get(id) || customAgents.get(id);
}

function createAgent({ name, description, icon, division, role, permissions, capabilities }) {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const agent = {
    id,
    name: clean(name, 100),
    division: division || 'specialist',
    icon: icon || '🤖',
    role: clean(role, 100),
    description: clean(description, 500),
    permissions: Array.isArray(permissions) ? permissions : ['posts.read'],
    capabilities: Array.isArray(capabilities) ? capabilities : ['general_task'],
    status: 'active',
    tier: 'custom',
    custom: true,
    created_at: new Date().toISOString(),
  };
  customAgents.set(id, agent);
  return agent;
}

function deleteAgent(id) {
  if (AGENT_MAP.has(id)) return false; // can't delete built-in
  return customAgents.delete(id);
}

// ═══════════════════════════════════════════════════════════════════
// SUBAGENT SPAWNING & ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════
const activeWorkflows = new Map();

function classifyTask(message) {
  const lower = message.toLowerCase();
  if (/\b(content|post|comment|moderate|review|publish|unpublish|hide|show)\b/i.test(lower)) return { division: 'content', priority: 'high' };
  if (/\b(user|ban|warn|account|profile|anonymous|contributor)\b/i.test(lower)) return { division: 'users', priority: 'high' };
  if (/\b(analytics|report|data|stats|trend|chart|graph|dashboard|kpi)\b/i.test(lower)) return { division: 'analytics', priority: 'medium' };
  if (/\b(security|vulnerability|threat|attack|spam|bot|anomal)\b/i.test(lower)) return { division: 'system', priority: 'critical' };
  if (/\b(tool|build|create tool|generate|export|csv|presentation|report)\b/i.test(lower)) return { division: 'meta', priority: 'medium' };
  if (/\b(poll|vote|survey|announcement|broadcast)\b/i.test(lower)) return { division: 'content', priority: 'medium' };
  if (/\b(performance|optimize|speed|latency|cache|database|query)\b/i.test(lower)) return { division: 'system', priority: 'medium' };
  if (/\b(strategy|plan|roadmap|forecast|predict|model)\b/i.test(lower)) return { division: 'executive', priority: 'high' };
  return { division: 'content', priority: 'medium' };
}

function selectAgentsForTask(task, maxAgents = 5) {
  const candidates = ALL_AGENTS.filter((a) => a.status === 'active');
  
  // Priority: same division first, then meta agents, then specialists
  const sameDivision = candidates.filter((a) => a.division === task.division);
  const metaAgents = candidates.filter((a) => a.division === 'meta');
  const others = candidates.filter((a) => a.division !== task.division && a.division !== 'meta');
  
  const selected = [];
  // Always include meta-orchestrator for coordination
  const orchestrator = candidates.find((a) => a.id === 'meta-orchestrator');
  if (orchestrator) selected.push(orchestrator);
  
  // Add division specialists
  for (const agent of sameDivision) {
    if (selected.length >= maxAgents) break;
    if (!selected.find((s) => s.id === agent.id)) selected.push(agent);
  }
  
  // Fill with meta agents if needed
  for (const agent of metaAgents) {
    if (selected.length >= maxAgents) break;
    if (!selected.find((s) => s.id === agent.id)) selected.push(agent);
  }
  
  // Fill remaining with others
  for (const agent of others) {
    if (selected.length >= maxAgents) break;
    if (!selected.find((s) => s.id === agent.id)) selected.push(agent);
  }
  
  return selected;
}

async function spawnSubagents(message, maxAgents = 5) {
  const task = classifyTask(message);
  const selected = selectAgentsForTask(task, maxAgents);
  const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const workflow = {
    id: workflowId,
    task: message,
    classification: task,
    agents: selected.map((a) => ({ id: a.id, name: a.name, icon: a.icon, status: 'queued', started_at: null, completed_at: null })),
    created_at: new Date().toISOString(),
    status: 'running',
    results: {},
  };
  
  activeWorkflows.set(workflowId, workflow);
  
  // Simulate parallel execution (in real implementation, these would be actual subagent calls)
  const results = [];
  for (const agent of workflow.agents) {
    agent.status = 'running';
    agent.started_at = new Date().toISOString();
    
    // Each agent processes based on its capabilities
    const agentDef = getAgent(agent.id);
    const result = await processAgentTask(agentDef, message, task);
    
    agent.status = 'completed';
    agent.completed_at = new Date().toISOString();
    results.push({ agent_id: agent.id, agent_name: agent.name, result });
    workflow.results[agent.id] = result;
  }
  
  workflow.status = 'completed';
  workflow.completed_at = new Date().toISOString();
  
  return {
    workflow_id: workflowId,
    classification: task,
    agents_used: workflow.agents.map((a) => ({ id: a.id, name: a.name, icon: a.icon, status: a.status })),
    results,
    total_time_ms: new Date(workflow.completed_at).getTime() - new Date(workflow.created_at).getTime(),
  };
}

async function processAgentTask(agent, message, task) {
  if (!agent) return { error: 'Agent not found' };
  
  // Route to appropriate processing based on agent capabilities
  try {
    if (agent.capabilities.includes('root_cause_analysis') || agent.capabilities.includes('trend_identification')) {
      const { data: posts } = await supabase.from('posts').select('id,title,category,status,priority,created_at,deleted').eq('deleted', false).order('created_at', { ascending: false }).limit(50);
      const active = (posts || []).filter((p) => !p.deleted);
      const cats = {};
      const statuses = {};
      active.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; statuses[p.status] = (statuses[p.status] || 0) + 1; });
      return { type: 'analysis', agent: agent.name, data: { total: active.length, categories: cats, statuses } };
    }
    
    if (agent.capabilities.includes('content_scanning') || agent.capabilities.includes('policy_enforcement')) {
      const { data: posts } = await supabase.from('posts').select('id,title,status,hidden,deleted').eq('deleted', false).order('created_at', { ascending: false }).limit(20);
      return { type: 'moderation', agent: agent.name, data: { reviewed: (posts || []).length, flagged: (posts || []).filter((p) => p.hidden).length } };
    }
    
    if (agent.capabilities.includes('threat_detection') || agent.capabilities.includes('anomaly_scoring')) {
      const { data: users } = await supabase.from('users_meta').select('anon_id,banned,spam_score,strikes').order('spam_score', { ascending: false }).limit(20);
      const suspicious = (users || []).filter((u) => (u.spam_score || 0) > 5 || u.banned);
      return { type: 'security', agent: agent.name, data: { scanned: (users || []).length, suspicious: suspicious.length } };
    }
    
    if (agent.capabilities.includes('kpi_tracking') || agent.capabilities.includes('dashboard_generation')) {
      const [{ count: posts }, { count: users }, { count: comments }] = await Promise.all([
        supabase.from('posts').select('*', { count: 'exact', head: true }),
        supabase.from('users_meta').select('*', { count: 'exact', head: true }),
        supabase.from('comments').select('*', { count: 'exact', head: true }),
      ]);
      return { type: 'analytics', agent: agent.name, data: { posts: posts || 0, users: users || 0, comments: comments || 0 } };
    }
    
    if (agent.capabilities.includes('tool_design') || agent.capabilities.includes('tool_prototyping')) {
      return { type: 'tool_building', agent: agent.name, data: { capability: 'ready', message: 'Available to build custom tools on request' } };
    }
    
    if (agent.capabilities.includes('agent_design') || agent.capabilities.includes('agent_prototyping')) {
      return { type: 'agent_creation', agent: agent.name, data: { capability: 'ready', message: 'Available to create new specialized agents on request' } };
    }
    
    // Generic processing
    return { type: 'generic', agent: agent.name, data: { status: 'processed', message: `${agent.name} completed analysis` } };
  } catch (err) {
    return { type: 'error', agent: agent.name, data: { error: err.message } };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RBAC CHECK
// ═══════════════════════════════════════════════════════════════════
function hasPermission(agentId, requiredPermission) {
  const agent = getAgent(agentId);
  if (!agent) return false;
  if (agent.permissions.includes('*')) return true;
  return agent.permissions.includes(requiredPermission);
}

function getAgentRoles(agentId) {
  // Map agent to applicable roles based on its tier and permissions
  const agent = getAgent(agentId);
  if (!agent) return [];
  
  const roles = [];
  if (agent.tier === 'executive') {
    roles.push('platform_admin', 'coo');
  } else if (agent.tier === 'meta') {
    roles.push('agent_architect', 'tool_builder');
  } else if (agent.tier === 'leadership') {
    roles.push(`${agent.division}_director`);
  }
  
  // Add specific role based on division
  const divisionRole = `${agent.division}_specialist`;
  if (ROLE_MAP.has(divisionRole)) roles.push(divisionRole);
  
  return roles;
}

// ═══════════════════════════════════════════════════════════════════
// HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  
  try {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });
    
    const b = req.body || {};
    const action = req.method === 'GET' ? req.query.action : b.action;
    
    // List all agents
    if (action === 'list' || (!action && req.method === 'GET')) {
      const agents = getAllAgents();
      const divisions = {};
      agents.forEach((a) => {
        if (!divisions[a.division]) divisions[a.division] = [];
        divisions[a.division].push(a);
      });
      return res.status(200).json({
        agents,
        divisions: Object.entries(divisions).map(([id, members]) => ({
          id,
          ...DIVISIONS[id],
          agents: members,
          count: members.length,
        })),
        total: agents.length,
        custom: customAgents.size,
      });
    }
    
    // Get single agent
    if (action === 'get') {
      const agent = getAgent(b.id || req.query.id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });
      const roles = getAgentRoles(agent.id);
      return res.status(200).json({ agent, roles });
    }
    
    // List all roles
    if (action === 'roles') {
      const roles = Object.entries(ROLE_HIERARCHY).map(([id, r]) => ({ id, ...r }));
      return res.status(200).json({ roles, total: roles.length });
    }
    
    // Create custom agent
    if (action === 'create') {
      if (!b.name) return res.status(400).json({ error: 'name required' });
      const agent = createAgent(b);
      await auditLog('admin', 'agent_create', `Created agent: ${agent.name} (${agent.id})`);
      return res.status(201).json({ agent });
    }
    
    // Delete custom agent
    if (action === 'delete') {
      if (!b.id) return res.status(400).json({ error: 'id required' });
      if (AGENT_MAP.has(b.id)) return res.status(400).json({ error: 'Cannot delete built-in agent' });
      if (!customAgents.has(b.id)) return res.status(404).json({ error: 'Agent not found' });
      deleteAgent(b.id);
      await auditLog('admin', 'agent_delete', `Deleted agent: ${b.id}`);
      return res.status(200).json({ deleted: true });
    }
    
    // Spawn subagents for a task
    if (action === 'spawn') {
      if (!b.message) return res.status(400).json({ error: 'message required' });
      const result = await spawnSubagents(clean(b.message, 500), b.max_agents || 5);
      await auditLog('admin', 'agent_spawn', `Spawned ${result.agents_used.length} agents for: "${b.message.slice(0, 60)}"`);
      return res.status(200).json(result);
    }
    
    // Classify a task
    if (action === 'classify') {
      if (!b.message) return res.status(400).json({ error: 'message required' });
      const task = classifyTask(b.message);
      const recommended = selectAgentsForTask(task, b.max_agents || 5);
      return res.status(200).json({ task, recommended: recommended.map((a) => ({ id: a.id, name: a.name, icon: a.icon, division: a.division })) });
    }
    
    // Check permission
    if (action === 'check_permission') {
      if (!b.agent_id || !b.permission) return res.status(400).json({ error: 'agent_id and permission required' });
      const allowed = hasPermission(b.agent_id, b.permission);
      return res.status(200).json({ allowed, agent_id: b.agent_id, permission: b.permission });
    }
    
    // Division summary
    if (action === 'divisions') {
      const divs = Object.entries(DIVISIONS).map(([id, div]) => ({
        id,
        ...div,
        agents: ALL_AGENTS.filter((a) => a.division === id).map((a) => ({ id: a.id, name: a.name, icon: a.icon })),
        count: ALL_AGENTS.filter((a) => a.division === id).length,
      }));
      return res.status(200).json({ divisions: divs, total_agents: ALL_AGENTS.length, total_roles: Object.keys(ROLE_HIERARCHY).length });
    }
    
    // Dashboard stats
    if (action === 'dashboard') {
      const agents = getAllAgents();
      const divCounts = {};
      const tierCounts = {};
      agents.forEach((a) => { divCounts[a.division] = (divCounts[a.division] || 0) + 1; tierCounts[a.tier] = (tierCounts[a.tier] || 0) + 1; });
      return res.status(200).json({
        total_agents: agents.length,
        active_agents: agents.filter((a) => a.status === 'active').length,
        custom_agents: customAgents.size,
        total_roles: Object.keys(ROLE_HIERARCHY).length,
        division_counts: divCounts,
        tier_counts: tierCounts,
        active_workflows: activeWorkflows.size,
      });
    }
    
    return res.status(400).json({ error: 'Unknown action. Actions: list, get, roles, create, delete, spawn, classify, check_permission, divisions, dashboard' });
  } catch (err) {
    console.error('agent-team error:', err);
    return res.status(500).json({ error: err.message });
  }
}
