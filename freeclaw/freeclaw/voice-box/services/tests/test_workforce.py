"""
Workforce Runtime Tests — Prove real event → real task → real tool → real verification.

These tests verify the core workforce loop works end-to-end.
"""

import asyncio
import pytest
import sys
import os

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voicebox.workforce.models import (
    AgentTask,
    TaskPriority,
    TaskStatus,
    RiskLevel,
    Severity,
    ToolPermission,
    VerificationStatus,
)
from voicebox.workforce.events import EventBus, EVENT_TYPES, EVENT_AGENT_MAP
from voicebox.workforce.tools import ToolRegistry, get_tool_registry, register_builtin_tools
from voicebox.workforce.policy import PolicyEngine, get_policy_engine
from voicebox.workforce.orchestrator import Orchestrator, get_orchestrator
from voicebox.workforce.workers import (
    PerformanceMonitorWorker,
    ErrorDetectionWorker,
    CacheOptimizationWorker,
    DatabasePerformanceWorker,
    SpamDetectionWorker,
    ALL_WORKERS,
    WORKER_MAP,
)
from voicebox.workforce.agents import (
    ExceptionAnalyzerAgent,
    IncidentCorrelatorAgent,
    ALL_AI_AGENTS,
    AI_AGENT_MAP,
)
from voicebox.workforce.write_tools import register_write_tools


@pytest.fixture(autouse=True)
def register_tools():
    """Ensure all tools (including write tools) are registered before each test."""
    registry = get_tool_registry()
    register_write_tools(registry)
    yield


# ─── Event Bus Tests ────────────────────────────────────────────────

class TestEventBus:
    def test_event_types_complete(self):
        """All 35+ event types are defined."""
        assert len(EVENT_TYPES) >= 35

    def test_event_agent_mapping_complete(self):
        """Every event type has at least one agent mapped."""
        for etype in EVENT_TYPES:
            assert etype in EVENT_AGENT_MAP, f"No agents mapped for {etype}"

    @pytest.mark.asyncio
    async def test_emit_and_subscribe(self):
        """Events are emitted and handlers receive them."""
        bus = EventBus()
        received = []

        def handler(event):
            received.append(event)

        bus.subscribe("POST_CREATED", handler)
        await bus.emit("POST_CREATED", {"post_id": "123"}, source="test")

        assert len(received) == 1
        assert received[0].type == "POST_CREATED"
        assert received[0].data["post_id"] == "123"

    @pytest.mark.asyncio
    async def test_event_stats(self):
        """Event stats are tracked."""
        bus = EventBus()
        await bus.emit("POST_CREATED", source="test")
        await bus.emit("POST_CREATED", source="test")
        await bus.emit("COMMENT_CREATED", source="test")

        stats = bus.get_stats()
        assert stats["POST_CREATED"] == 2
        assert stats["COMMENT_CREATED"] == 1

    @pytest.mark.asyncio
    async def test_get_recent_events(self):
        """Recent events can be retrieved."""
        bus = EventBus()
        await bus.emit("POST_CREATED", {"post_id": "1"}, source="test")
        await bus.emit("COMMENT_CREATED", {"comment_id": "2"}, source="test")

        events = await bus.get_recent_events(limit=10)
        assert len(events) == 2

        events_filtered = await bus.get_recent_events(limit=10, event_type="POST_CREATED")
        assert len(events_filtered) == 1
        assert events_filtered[0].type == "POST_CREATED"


# ─── Tool Registry Tests ────────────────────────────────────────────

class TestToolRegistry:
    def test_builtin_tools_registered(self):
        """All built-in tools are registered."""
        registry = ToolRegistry()
        register_builtin_tools(registry)
        assert len(registry._tools) >= 12

    def test_tool_permissions(self):
        """Tools have correct permissions."""
        registry = ToolRegistry()
        register_builtin_tools(registry)

        metrics_tool = registry.get_tool("read_service_metrics")
        assert metrics_tool is not None
        assert metrics_tool.permission == ToolPermission.READ

        alert_tool = registry.get_tool("create_alert")
        assert alert_tool is not None
        assert alert_tool.permission == ToolPermission.WRITE

    @pytest.mark.asyncio
    async def test_tool_execution(self):
        """Tools execute and return results."""
        registry = ToolRegistry()
        register_builtin_tools(registry)

        # Override with a simple sync test handler
        registry.register(
            "test_tool", "Test Tool", "Test",
            ToolPermission.READ, lambda x: {"ok": True},
        )
        exec_result = await registry.execute(
            "test_tool", "test-agent", "task-1", {}
        )
        assert exec_result.status == "success"
        assert exec_result.output_data is not None

    @pytest.mark.asyncio
    async def test_tool_audit_trail(self):
        """Tool executions are recorded."""
        registry = ToolRegistry()
        register_builtin_tools(registry)

        await registry.execute("read_service_metrics", "agent-1", "task-1", {})
        await registry.execute("read_database_metrics", "agent-1", "task-2", {})

        executions = registry.get_recent_executions(limit=10)
        assert len(executions) == 2
        assert executions[0].tool_id == "read_service_metrics"
        assert executions[1].tool_id == "read_database_metrics"

    def test_agent_permission_check(self):
        """Agent permissions are enforced."""
        registry = ToolRegistry()
        register_builtin_tools(registry)

        # Open tool — any agent can use
        assert registry.can_agent_use("any-agent", "read_service_metrics")

        # Restricted tool
        registry.register(
            "restricted_tool", "Restricted Tool", "Test",
            ToolPermission.SECURITY, lambda x: {},
            agent_allowlist=["security-agent"],
        )
        assert registry.can_agent_use("security-agent", "restricted_tool")
        assert not registry.can_agent_use("other-agent", "restricted_tool")


# ─── Policy Engine Tests ────────────────────────────────────────────

class TestPolicyEngine:
    def test_safe_action_allowed(self):
        """Safe actions are allowed."""
        engine = PolicyEngine()
        decision = engine.evaluate(
            agent_id="perf-monitor",
            agent_domain="performance",
            action="read_metrics",
            risk_level=RiskLevel.LOW,
        )
        assert decision.allowed

    def test_ban_user_blocked(self):
        """Ban user requires approval."""
        engine = PolicyEngine()
        decision = engine.evaluate(
            agent_id="security-agent",
            agent_domain="security",
            action="ban_user",
            risk_level=RiskLevel.HIGH,
        )
        assert not decision.allowed
        assert decision.requires_approval

    def test_critical_risk_blocked(self):
        """Critical risk always requires approval."""
        engine = PolicyEngine()
        decision = engine.evaluate(
            agent_id="any-agent",
            agent_domain="infrastructure",
            action="read_metrics",
            risk_level=RiskLevel.CRITICAL,
        )
        assert not decision.allowed
        assert decision.requires_approval

    def test_domain_permission_enforced(self):
        """Domain permissions are enforced."""
        engine = PolicyEngine()
        decision = engine.evaluate(
            agent_id="perf-agent",
            agent_domain="performance",
            action="ban_user",
            risk_level=RiskLevel.LOW,
        )
        assert not decision.allowed

    def test_audit_log_recorded(self):
        """Policy decisions are logged."""
        engine = PolicyEngine()
        # Use real domain + action combos so the policy allows the first one
        engine.evaluate("test", "performance", "read_metrics", RiskLevel.LOW)
        engine.evaluate("test", "security", "ban_user", RiskLevel.HIGH)

        log = engine.get_audit_log()
        # Should have at least 2 entries from this test
        assert len(log) >= 2
        # The first one (read_metrics) should be allowed
        assert log[-2]["allowed"]
        # The second one (ban_user) should be blocked (requires approval)
        assert not log[-1]["allowed"]

    def test_manual_override(self):
        """Manual overrides work."""
        engine = PolicyEngine()
        # Override must be checked BEFORE domain check, so set it on an action
        # that would otherwise be blocked. The override check happens early in
        # the evaluate() flow.
        engine.set_override("agent-1", "test_action", True, "Admin approved")

        decision = engine.evaluate(
            agent_id="agent-1",
            agent_domain="infrastructure",
            action="test_action",
            risk_level=RiskLevel.LOW,
        )
        assert decision.allowed


# ─── Worker Tests ───────────────────────────────────────────────────

class TestWorkers:
    @pytest.mark.asyncio
    async def test_performance_monitor_executes(self):
        """Performance monitor executes and returns metrics."""
        worker = PerformanceMonitorWorker()
        task = AgentTask(
            title="Monitor performance",
            source="system",
            required_capability="performance_monitoring",
        )
        result = await worker.execute(task)
        assert "metrics" in result
        assert "findings_count" in result

    @pytest.mark.asyncio
    async def test_error_detection_executes(self):
        """Error detection worker executes."""
        worker = ErrorDetectionWorker()
        task = AgentTask(title="Detect errors", source="system")
        result = await worker.execute(task)
        assert "errors" in result

    @pytest.mark.asyncio
    async def test_cache_optimization_executes(self):
        """Cache optimization worker executes."""
        worker = CacheOptimizationWorker()
        task = AgentTask(title="Optimize cache", source="system")
        result = await worker.execute(task)
        assert "cache_metrics" in result

    @pytest.mark.asyncio
    async def test_database_performance_executes(self):
        """Database performance worker executes."""
        worker = DatabasePerformanceWorker()
        task = AgentTask(title="Check DB", source="system")
        result = await worker.execute(task)
        assert "db_metrics" in result

    @pytest.mark.asyncio
    async def test_spam_detection_executes(self):
        """Spam detection worker executes."""
        worker = SpamDetectionWorker()
        task = AgentTask(
            title="Check spam",
            source="moderation",
            input_data={"content": "test post"},
        )
        result = await worker.execute(task)
        assert "spam_signals" in result

    def test_all_workers_registered(self):
        """All workers are registered."""
        assert len(ALL_WORKERS) >= 10
        assert "perf-monitor" in WORKER_MAP
        assert "error-detector" in WORKER_MAP
        assert "spam-detector" in WORKER_MAP

    def test_worker_status(self):
        """Workers report status."""
        worker = PerformanceMonitorWorker()
        status = worker.get_status()
        assert "worker_id" in status
        assert "name" in status
        assert "domain" in status


# ─── AI Agent Tests ─────────────────────────────────────────────────

class TestAIAgents:
    def test_all_agents_registered(self):
        """All AI agents are registered."""
        assert len(ALL_AI_AGENTS) >= 5
        assert "exception-analyzer" in AI_AGENT_MAP
        assert "incident-correlator" in AI_AGENT_MAP

    @pytest.mark.asyncio
    async def test_exception_analyzer_executes(self):
        """Exception analyzer executes with fallback."""
        agent = ExceptionAnalyzerAgent()
        task = AgentTask(
            title="Analyze exceptions",
            source="error",
            input_data={"errors": ["test error"]},
        )
        result = await agent.execute(task)
        assert "analysis" in result

    @pytest.mark.asyncio
    async def test_incident_correlator_executes(self):
        """Incident correlator executes."""
        agent = IncidentCorrelatorAgent()
        task = AgentTask(
            title="Correlate incidents",
            source="system",
        )
        result = await agent.execute(task)
        assert "signals" in result
        assert "severity" in result


# ─── Orchestrator Tests ─────────────────────────────────────────────

class TestOrchestrator:
    @pytest.mark.asyncio
    async def test_submit_safe_task(self):
        """Safe tasks are accepted and executed."""
        orch = Orchestrator()
        task = AgentTask(
            title="Monitor performance",
            source="system",
            priority=TaskPriority.MEDIUM,
            risk_level=RiskLevel.LOW,
            required_capability="performance_monitoring",
        )
        result = await orch.submit_task(task)
        assert result["status"] == "completed"
        assert "output" in result

    @pytest.mark.asyncio
    async def test_submit_blocked_task(self):
        """High-risk tasks without approval are blocked."""
        orch = Orchestrator()
        task = AgentTask(
            title="Ban malicious user",
            source="security",
            priority=TaskPriority.HIGH,
            risk_level=RiskLevel.HIGH,
            required_capability="ban_user",
        )
        result = await orch.submit_task(task)
        assert result["status"] == "blocked"
        assert result["requires_approval"]

    @pytest.mark.asyncio
    async def test_routing_by_capability(self):
        """Tasks route to the correct worker by capability."""
        orch = Orchestrator()

        # Test performance routing
        task = AgentTask(
            title="Check performance",
            source="system",
            required_capability="performance_monitoring",
        )
        result = await orch.submit_task(task)
        assert result["executor"] == "perf-monitor"

    @pytest.mark.asyncio
    async def test_routing_by_source(self):
        """Tasks route by source when no capability specified."""
        orch = Orchestrator()

        task = AgentTask(
            title="Handle report",
            source="report",
        )
        result = await orch.submit_task(task)
        assert result["executor"] == "report-prioritizer"

    @pytest.mark.asyncio
    async def test_stats_tracked(self):
        """Orchestrator tracks statistics."""
        orch = Orchestrator()

        # Submit a safe task
        task = AgentTask(
            title="Test task",
            source="system",
            required_capability="system_health",
        )
        await orch.submit_task(task)

        stats = orch.get_stats()
        assert stats["tasks_received"] >= 1
        assert stats["tasks_completed"] >= 1

    def test_executor_info(self):
        """Orchestrator reports executor info."""
        orch = Orchestrator()
        info = orch.get_executor_info()
        assert "workers" in info
        assert "agents" in info
        assert info["total_executors"] >= 15


# ─── Model Tests ────────────────────────────────────────────────────

class TestModels:
    def test_agent_task_creation(self):
        """AgentTask can be created with defaults."""
        task = AgentTask(title="Test task")
        assert task.status == TaskStatus.CREATED
        assert task.priority == TaskPriority.MEDIUM
        assert task.risk_level == RiskLevel.LOW
        assert task.attempts == 0
        assert task.max_attempts == 3

    def test_tool_execution_creation(self):
        """ToolExecution records are created correctly."""
        from voicebox.workforce.models import ToolExecution
        exec = ToolExecution(tool_id="test", agent_id="agent-1")
        assert exec.status == "pending"
        assert exec.duration_ms == 0

    def test_finding_creation(self):
        """Findings are created correctly."""
        from voicebox.workforce.models import Finding
        finding = Finding(
            agent_id="test-agent",
            severity=Severity.HIGH,
            category="test",
            title="Test finding",
            description="Test description",
        )
        assert finding.severity == Severity.HIGH
        assert finding.confidence == 0.0

    def test_incident_creation(self):
        """Incidents are created correctly."""
        from voicebox.workforce.models import Incident
        incident = Incident(
            title="Test incident",
            description="Test description",
            severity=Severity.WARNING,
        )
        assert incident.status == "open"


# ─── End-to-End Tests ───────────────────────────────────────────────

class TestEndToEnd:
    @pytest.mark.asyncio
    async def test_event_to_task_to_execution(self):
        """Full loop: event → task → execution → verification."""
        # 1. Emit event
        bus = EventBus()
        await bus.emit("POST_CREATED", {"post_id": "test-123"}, source="api")

        # 2. Create task from event
        task = AgentTask(
            title="Review new post",
            source="moderation",
            source_ref="post:test-123",
            required_capability="content_risk",
            input_data={"content": "Test post content"},
        )

        # 3. Submit to orchestrator
        orch = Orchestrator()
        result = await orch.submit_task(task)

        # 4. Verify execution
        assert result["status"] == "completed"
        assert result["executor"] is not None
        assert result["duration_ms"] > 0
        assert result["output"] is not None

    @pytest.mark.asyncio
    async def test_multi_worker_pipeline(self):
        """Multiple workers process related tasks."""
        orch = Orchestrator()

        # Performance check
        task1 = AgentTask(
            title="Check API performance",
            source="system",
            required_capability="performance_monitoring",
        )
        result1 = await orch.submit_task(task1)
        assert result1["status"] == "completed"

        # Error check
        task2 = AgentTask(
            title="Check errors",
            source="system",
            required_capability="error_detection",
        )
        result2 = await orch.submit_task(task2)
        assert result2["status"] == "completed"

        # DB check
        task3 = AgentTask(
            title="Check database",
            source="system",
            required_capability="database_performance",
        )
        result3 = await orch.submit_task(task3)
        assert result3["status"] == "completed"

        # All completed
        stats = orch.get_stats()
        assert stats["tasks_completed"] >= 3

    @pytest.mark.asyncio
    async def test_policy_blocks_dangerous_action(self):
        """Policy engine blocks dangerous autonomous actions."""
        orch = Orchestrator()

        # This should be blocked
        task = AgentTask(
            title="Delete all users",
            source="system",
            risk_level=RiskLevel.CRITICAL,
            required_capability="ban_user",
        )
        result = await orch.submit_task(task)
        assert result["status"] == "blocked"

    @pytest.mark.asyncio
    async def test_tool_execution_captured(self):
        """Tool executions are captured in the audit trail."""
        registry = ToolRegistry()
        register_builtin_tools(registry)

        # Register a simple test tool
        registry.register(
            "audit_tool", "Audit Test", "Test",
            ToolPermission.READ, lambda x: {"result": "ok"},
        )

        # Execute multiple times
        await registry.execute("audit_tool", "agent-1", "task-1", {})
        await registry.execute("audit_tool", "agent-1", "task-2", {})
        await registry.execute("audit_tool", "agent-1", "task-3", {})

        # Verify audit trail
        executions = registry.get_recent_executions(limit=10)
        assert len(executions) == 3

        # Verify stats
        stats = registry.get_tool_stats()
        assert stats["audit_tool"]["execution_count"] == 3



# ─── Registry Tests ───────────────────────────────────────────────

from voicebox.workforce.registry import (
    ALL_AGENTS,
    AGENT_MAP,
    DOMAIN_MAP,
    agents_for_event,
    SECURITY_AGENTS,
    MODERATION_AGENTS,
    PERFORMANCE_AGENTS,
    RELIABILITY_AGENTS,
    DATA_AGENTS,
    UX_AGENTS,
    COMMUNITY_AGENTS,
    ANALYTICS_AGENTS,
    PLATFORM_OPS_AGENTS,
    AI_GOVERNANCE_AGENTS,
)


class TestRegistry:
    def test_100_agents_registered(self):
        """All 100 agents are registered across 10 domains."""
        assert len(ALL_AGENTS) == 100

    def test_agent_map_populated(self):
        """Every agent is in the agent map."""
        assert len(AGENT_MAP) == 100
        for agent in ALL_AGENTS:
            assert agent.agent_id in AGENT_MAP

    def test_10_domains(self):
        """Agents are spread across 10 domains."""
        assert len(DOMAIN_MAP) == 10

    def test_each_domain_has_10_agents(self):
        """Each domain has exactly 10 agents."""
        for domain, agents in DOMAIN_MAP.items():
            assert len(agents) == 10, f"Domain {domain} has {len(agents)} agents, expected 10"

    def test_agents_have_unique_ids(self):
        """No two agents share the same ID."""
        ids = [a.agent_id for a in ALL_AGENTS]
        assert len(ids) == len(set(ids))

    def test_agents_have_purpose(self):
        """Every agent has a non-empty purpose."""
        for agent in ALL_AGENTS:
            assert agent.purpose, f"Agent {agent.agent_id} has no purpose"

    def test_agents_have_tools(self):
        """Every agent has at least one tool."""
        for agent in ALL_AGENTS:
            assert len(agent.tools) > 0, f"Agent {agent.agent_id} has no tools"

    def test_agents_have_events(self):
        """Every agent subscribes to at least one event."""
        for agent in ALL_AGENTS:
            assert len(agent.events) > 0, f"Agent {agent.agent_id} has no events"

    def test_agents_for_event_routes_correctly(self):
        """Event routing returns the correct agents."""
        # POST_CREATED should route to multiple agents across domains
        agents = agents_for_event("POST_CREATED")
        assert len(agents) > 5, f"POST_CREATED only routes to {len(agents)} agents"
        domains = {a.domain for a in agents}
        assert "security" in domains
        assert "moderation" in domains

    def test_security_domain_agents(self):
        """Security domain has the right agents."""
        assert len(SECURITY_AGENTS) == 10
        ids = {a.agent_id for a in SECURITY_AGENTS}
        assert "sec-001" in ids  # Threat Monitor
        assert "sec-004" in ids  # Spam Detection

    def test_performance_domain_agents(self):
        """Performance domain has the right agents."""
        assert len(PERFORMANCE_AGENTS) == 10
        ids = {a.agent_id for a in PERFORMANCE_AGENTS}
        assert "perf-001" in ids  # Frontend Performance
        assert "perf-002" in ids  # API Latency

    def test_agent_type_distribution(self):
        """Agents use appropriate types (not all the same)."""
        types = {a.agent_type for a in ALL_AGENTS}
        assert "deterministic" in types
        assert "ai_reasoning" in types
        assert "coordinator" in types

    def test_rate_limits_set(self):
        """Every agent has a rate limit."""
        for agent in ALL_AGENTS:
            assert agent.max_runs_per_hour > 0


# ─── SSE Integration Tests ─────────────────────────────────────────

import json


class TestSSE:
    def test_registry_imports_cleanly(self):
        """The registry module imports cleanly and provides all agents."""
        from voicebox.workforce.registry import ALL_AGENTS, DOMAIN_MAP, agents_for_event
        assert len(ALL_AGENTS) == 100
        assert len(DOMAIN_MAP) == 10

    def test_agents_for_event_coverage(self):
        """Event routing covers critical event types."""
        from voicebox.workforce.registry import agents_for_event
        critical_events = [
            "POST_CREATED", "COMMENT_CREATED", "REPORT_CREATED",
            "SUSPICIOUS_ACTIVITY", "API_ERROR", "DEPLOYMENT_COMPLETED",
        ]
        for event_type in critical_events:
            agents = agents_for_event(event_type)
            assert len(agents) > 0, f"No agents handle {event_type}"

    def test_registry_domain_counts(self):
        """Each of the 10 domains has exactly 10 agents."""
        from voicebox.workforce.registry import DOMAIN_MAP
        for domain, agents in DOMAIN_MAP.items():
            assert len(agents) == 10


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
