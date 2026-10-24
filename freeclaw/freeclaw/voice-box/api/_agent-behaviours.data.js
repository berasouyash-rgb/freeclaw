// AUTO-GENERATED FROM THE ROUTER — do not hand-edit.
// Regenerate with: node scripts/agent-behaviours.gen.mjs
//
// Source of truth: the hasCap(...) branch groups inside processAgentTask()
// in _agent-team.js. A drift-guard test asserts this file and the router
// expose exactly the same capability strings, so the two cannot diverge
// silently again.
//
// 57 behaviours · 3 change state · 54 are advisory · 326 capabilities

export const BEHAVIOURS = [
 {
  "id": "content-moderation",
  "label": "Content moderation",
  "impact": "act",
  "changes_state": true,
  "capabilities": [
   "content_scanning",
   "policy_enforcement",
   "queue_management",
   "escalation_routing"
  ]
 },
 {
  "id": "sentiment-categorisation",
  "label": "Sentiment / categorisation",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "sentiment_analysis",
   "categorization",
   "priority_scoring",
   "sentiment_scoring",
   "emotion_detection",
   "auto_categorization",
   "category_suggestion"
  ]
 },
 {
  "id": "trend-detection",
  "label": "Trend detection",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "trend_identification",
   "trend_forecasting",
   "trend_tracking",
   "emergence_detection",
   "topic_clustering"
  ]
 },
 {
  "id": "threat-detection",
  "label": "Threat detection",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "threat_detection",
   "anomaly_scoring",
   "vulnerability_scanning",
   "security_scoring",
   "spam_detection",
   "bot_detection",
   "behavior_analysis"
  ]
 },
 {
  "id": "kpi-dashboard",
  "label": "KPI dashboard",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "kpi_tracking",
   "dashboard_generation",
   "performance_scoring",
   "benchmark_analysis",
   "data_compilation",
   "cross_domain_analysis",
   "data_fusion",
   "insight_generation"
  ]
 },
 {
  "id": "report-triage",
  "label": "Report triage",
  "impact": "act",
  "changes_state": true,
  "capabilities": [
   "report_triage",
   "investigation_tracking",
   "resolution_routing",
   "trend_analysis"
  ]
 },
 {
  "id": "conversation-analysis",
  "label": "Conversation analysis",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "conversation_analysis",
   "reply_tracking",
   "thread_management",
   "engagement_scoring"
  ]
 },
 {
  "id": "user-lifecycle",
  "label": "User lifecycle",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "user_lifecycle",
   "ban_management",
   "warning_system",
   "engagement_scoring",
   "engagement_analysis",
   "retention_tracking",
   "loyalty_scoring",
   "contributor_scoring",
   "leaderboard_generation"
  ]
 },
 {
  "id": "duplicate-clustering",
  "label": "Duplicate clustering",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "similarity_scoring",
   "duplicate_clustering",
   "merge_suggestion",
   "pattern_matching"
  ]
 },
 {
  "id": "poll-analysis",
  "label": "Poll analysis",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "poll_design",
   "vote_analysis",
   "engagement_optimization",
   "result_visualization"
  ]
 },
 {
  "id": "anonymity-verification",
  "label": "Anonymity verification",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "anonymity_verification",
   "data_protection",
   "privacy_compliance",
   "leak_prevention"
  ]
 },
 {
  "id": "anomaly-detection",
  "label": "Anomaly detection",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "anomaly_detection",
   "anomaly_scoring"
  ]
 },
 {
  "id": "feedback-prioritisation",
  "label": "Feedback prioritisation",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "feedback_categorization",
   "priority_ranking",
   "action_item_generation"
  ]
 },
 {
  "id": "notification-routing",
  "label": "Notification routing",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "notification_design",
   "escalation_chains",
   "escalation_detection",
   "priority_routing",
   "handler_matching",
   "escalation_tracking"
  ]
 },
 {
  "id": "bulk-export",
  "label": "Bulk export",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "csv_generation",
   "data_extraction",
   "bulk_operations",
   "batch_processing",
   "mass_updates"
  ]
 },
 {
  "id": "search-relevance",
  "label": "Search relevance",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "relevance_scoring",
   "search_indexing",
   "result_ranking",
   "query_optimization"
  ]
 },
 {
  "id": "intent-extraction",
  "label": "Intent extraction",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "intent_detection",
   "entity_extraction",
   "language_analysis",
   "context_understanding"
  ]
 },
 {
  "id": "audit-forensics",
  "label": "Audit / forensics",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "audit_logging",
   "compliance_tracking",
   "history_reconstruction",
   "forensic_analysis"
  ]
 },
 {
  "id": "uptime-slo",
  "label": "Uptime / SLO",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "uptime_monitoring",
   "slo_tracking",
   "health_scoring",
   "alert_generation",
   "alert_escalation",
   "slo_monitoring",
   "sli_tracking",
   "error_budgets",
   "reliability_reporting",
   "response_time_tracking",
   "error_rate_monitoring",
   "latency_analysis",
   "endpoint_health"
  ]
 },
 {
  "id": "resilience-recovery",
  "label": "Resilience / recovery",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "auto_recovery",
   "circuit_breaking",
   "resilience_testing",
   "failover_management",
   "auto_remediation",
   "chaos_engineering",
   "fault_injection"
  ]
 },
 {
  "id": "performance-profiling",
  "label": "Performance profiling",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "query_optimization",
   "latency_monitoring",
   "bottleneck_resolution",
   "performance_profiling",
   "perf_profiling",
   "bottleneck_elimination",
   "latency_reduction",
   "throughput_optimization",
   "profiling",
   "memory_optimization",
   "cold_start_reduction",
   "runtime_tuning",
   "cold_start_optimization",
   "memory_tuning",
   "timeout_management"
  ]
 },
 {
  "id": "cache-strategy",
  "label": "Cache strategy",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "cache_strategy",
   "invalidation_management",
   "hit_rate_optimization",
   "cache_warming",
   "edge_caching",
   "cache_invalidation",
   "cdn_analytics"
  ]
 },
 {
  "id": "capacity-planning",
  "label": "Capacity planning",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "resource_tracking",
   "scaling_recommendations",
   "load_forecasting",
   "capacity_planning",
   "resource_forecasting",
   "scaling_triggers",
   "cost_optimization",
   "demand_prediction",
   "auto_scaling",
   "cost_at_scale",
   "capacity_modeling"
  ]
 },
 {
  "id": "schema-review",
  "label": "Schema review",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "schema_optimization",
   "index_management",
   "query_analysis",
   "migration_planning",
   "schema_design",
   "normalization",
   "data_modeling",
   "connection_pooling",
   "replication_health",
   "data_integrity"
  ]
 },
 {
  "id": "log-error-analysis",
  "label": "Log / error analysis",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "log_parsing",
   "error_aggregation",
   "pattern_detection",
   "anomaly_flagging"
  ]
 },
 {
  "id": "incident-coordination",
  "label": "Incident coordination",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "incident_coordination",
   "postmortem_generation",
   "sla_tracking",
   "escalation_management"
  ]
 },
 {
  "id": "rate-limit-shaping",
  "label": "Rate limiting / shaping",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "rate_limiting",
   "load_balancing",
   "traffic_shaping",
   "burst_detection"
  ]
 },
 {
  "id": "queue-reliability",
  "label": "Queue reliability",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "queue_management",
   "retry_logic",
   "dead_letter_handling",
   "queue_monitoring"
  ]
 },
 {
  "id": "api-monitoring",
  "label": "API monitoring",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "api_monitoring",
   "rate_limit_management",
   "endpoint_optimization",
   "error_tracking"
  ]
 },
 {
  "id": "api-architecture",
  "label": "API architecture",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "api_design",
   "service_decomposition",
   "data_flow_mapping",
   "architecture_review"
  ]
 },
 {
  "id": "frontend-architecture",
  "label": "Frontend architecture",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "component_design",
   "state_management",
   "routing_optimization",
   "build_optimization"
  ]
 },
 {
  "id": "ux-heatmap",
  "label": "UX / heatmap",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "interaction_tracking",
   "heatmap_analysis",
   "click_pattern_detection",
   "ux_scoring",
   "transition_design",
   "micro_interaction",
   "motion_optimization",
   "responsive_layouts",
   "breakpoint_management",
   "touch_optimization"
  ]
 },
 {
  "id": "bundle-analysis",
  "label": "Bundle analysis",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "bundle_analysis",
   "tree_shaking",
   "lazy_loading",
   "core_web_vitals"
  ]
 },
 {
  "id": "accessibility-audit",
  "label": "Accessibility audit",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "wcag_compliance",
   "screen_reader_testing",
   "keyboard_navigation",
   "aria_pattern_design"
  ]
 },
 {
  "id": "deployment-management",
  "label": "Deployment management",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "deployment_management",
   "cicd_optimization",
   "serverless_config",
   "environment_management",
   "blue_green_deployment",
   "canary_releases",
   "rollback_management",
   "deployment_health"
  ]
 },
 {
  "id": "release-management",
  "label": "Release management",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "release_trains",
   "hotfix_management",
   "version_tagging",
   "changelog_generation"
  ]
 },
 {
  "id": "test-strategy",
  "label": "Test strategy",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "regression_detection",
   "snapshot_testing",
   "visual_diff",
   "compatibility_checks",
   "test_strategy",
   "coverage_analysis",
   "flaky_detection",
   "test_pyramid",
   "playwright_automation",
   "visual_testing",
   "cross_browser"
  ]
 },
 {
  "id": "static-analysis",
  "label": "Static analysis",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "static_analysis",
   "lint_enforcement",
   "quality_scoring",
   "security_scanning"
  ]
 },
 {
  "id": "tooling-design",
  "label": "Tooling design",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "tool_design",
   "tool_prototyping",
   "tool_testing",
   "tool_deployment",
   "tool_creation",
   "cli_utility",
   "admin_dashboard",
   "dev_tooling"
  ]
 },
 {
  "id": "agent-design",
  "label": "Agent design",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "agent_design",
   "capability_specification",
   "agent_prototyping",
   "agent_deployment",
   "agent_creation",
   "workflow_synthesis",
   "dynamic_routing",
   "parallel_orchestration",
   "result_merging",
   "workflow_design",
   "parallel_dispatch",
   "result_aggregation",
   "bottleneck_detection"
  ]
 },
 {
  "id": "capability-gap-analysis",
  "label": "Capability gap analysis",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "capability_analysis",
   "gap_detection",
   "task_mapping",
   "recommendation_engine"
  ]
 },
 {
  "id": "knowledge-curation",
  "label": "Knowledge curation",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "knowledge_curation",
   "pattern_extraction",
   "best_practice_maintenance",
   "performance_analysis",
   "improvement_suggestion",
   "benchmark_tracking",
   "optimization_planning"
  ]
 },
 {
  "id": "cross-domain-insight",
  "label": "Cross-domain insight",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "cross_domain_analysis",
   "insight_fusion",
   "compound_intelligence",
   "correlation_engine",
   "correlation_discovery"
  ]
 },
 {
  "id": "workload-balancing",
  "label": "Workload balancing",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "workload_balancing",
   "priority_adjustment",
   "resource_reallocation",
   "adaptive_scheduling"
  ]
 },
 {
  "id": "presentation-design",
  "label": "Presentation design",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "presentation_design",
   "slide_generation",
   "data_storytelling",
   "chart_generation",
   "graph_design",
   "interactive_dashboard",
   "visual_storytelling"
  ]
 },
 {
  "id": "documentation",
  "label": "Documentation",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "api_documentation",
   "changelog_generation",
   "runbook_creation",
   "architecture_diagrams"
  ]
 },
 {
  "id": "dependency-audit",
  "label": "Dependency audit",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "dependency_audit",
   "version_upgrade",
   "security_patching",
   "license_compliance"
  ]
 },
 {
  "id": "integration-management",
  "label": "Integration management",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "integration_management",
   "api_connector",
   "webhook_handling",
   "sync_management",
   "api_integration",
   "webhook_design",
   "service_mesh",
   "integration_testing"
  ]
 },
 {
  "id": "secret-rotation",
  "label": "Secret rotation",
  "impact": "act",
  "changes_state": true,
  "capabilities": [
   "secret_rotation",
   "env_management",
   "config_validation",
   "access_control"
  ]
 },
 {
  "id": "disaster-recovery",
  "label": "Disaster recovery",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "point_in_time_recovery",
   "snapshot_management",
   "disaster_recovery",
   "recovery_testing",
   "disaster_recovery_planning"
  ]
 },
 {
  "id": "etl-design",
  "label": "ETL design",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "etl_design",
   "data_streaming",
   "batch_processing",
   "pipeline_monitoring"
  ]
 },
 {
  "id": "tech-debt",
  "label": "Tech debt",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "dead_code_detection",
   "tech_debt_tracking",
   "code_smell_identification",
   "cleanup_planning",
   "debt_tracking",
   "prioritization",
   "improvement_metrics",
   "cleanup_scheduling",
   "complexity_analysis",
   "maintainability_scoring",
   "growth_metrics",
   "health_reporting"
  ]
 },
 {
  "id": "service-contracts",
  "label": "Service contracts",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "service_boundary",
   "api_contract",
   "event_driven",
   "saga_patterns"
  ]
 },
 {
  "id": "git-workflow",
  "label": "Git workflow",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "branch_strategy",
   "conflict_resolution",
   "commit_hygiene",
   "pr_automation"
  ]
 },
 {
  "id": "process-automation",
  "label": "Process automation",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "process_optimization",
   "efficiency_scoring",
   "automation_design",
   "workflow_analysis"
  ]
 },
 {
  "id": "risk-scoring",
  "label": "Risk scoring",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "risk_scoring",
   "escalation_triggering",
   "mitigation_planning"
  ]
 },
 {
  "id": "predictive-modelling",
  "label": "Predictive modelling",
  "impact": "advisory",
  "changes_state": false,
  "capabilities": [
   "predictive_modeling",
   "statistical_analysis",
   "data_visualization",
   "outcome_modeling",
   "risk_projection"
  ]
 }
];

export const ROUTED_CAPABILITIES = new Set(
	BEHAVIOURS.flatMap((b) => b.capabilities),
);
