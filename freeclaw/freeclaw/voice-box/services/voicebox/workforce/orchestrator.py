"""
Orchestrator — Routes tasks to the right worker or agent.

The orchestrator:
1. Receives tasks from the event bus or API
2. Checks policy engine for safety
3. Routes to the appropriate worker/agent
4. Verifies outcomes
5. Records results
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Optional

from .agents import AI_AGENT_MAP, ALL_AI_AGENTS
from .events import get_event_bus
from .models import (
    AgentTask,
    PolicyDecision,
    RiskLevel,
    TaskOutcome,
    TaskStatus,
    VerificationStatus,
)
from .policy import get_policy_engine
from .tools import get_tool_registry
from .workers import ALL_WORKERS, WORKER_MAP

logger = logging.getLogger(__name__)


# ─── Capability → Worker/Agent mapping ──────────────────────────────

CAPABILITY_MAP = {
    # Deterministic workers
    "performance_monitoring": "perf-monitor",
    "error_detection": "error-detector",
    "cache_optimization": "cache-optimizer",
    "database_performance": "db-perf",
    "spam_detection": "spam-detector",
    "content_risk": "content-risk",
    "duplicate_detection": "duplicate-detector",
    "system_health": "system-health",
    "report_triage": "report-prioritizer",
    "verification": "verifier",
    # AI reasoning agents
    "exception_analysis": "exception-analyzer",
    "incident_correlation": "incident-correlator",
    "feedback_analysis": "feedback-analyzer",
    "query_optimization": "query-optimizer",
    "deployment_safety": "deployment-safety",
}


class Orchestrator:
    """
    Central orchestrator that:
    - Routes tasks to capable workers
    - Enforces policy gates
    - Verifies outcomes
    - Records everything
    """

    def __init__(self):
        self._task_queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._running_tasks: dict[str, asyncio.Task] = {}
        self._completed_tasks: list[AgentTask] = []
        # Ring buffer of task outcomes — backs GET /api/workforce/tasks.
        self._recent: deque[dict[str, Any]] = deque(maxlen=100)
        self._stats = {
            "tasks_received": 0,
            "tasks_completed": 0,
            "tasks_failed": 0,
            "tasks_blocked": 0,
        }

    def _record(self, task: AgentTask, result: dict[str, Any]) -> None:
        """Append a task outcome to the recent-history ring buffer."""
        self._recent.appendleft(
            {
                "task_id": task.id,
                "title": task.title,
                "source": task.source,
                "priority": task.priority.value if hasattr(task.priority, "value") else str(task.priority),
                "status": result.get("status", "unknown"),
                "executor": result.get("executor"),
                "reason": result.get("reason"),
                "error": result.get("error"),
                "duration_ms": result.get("duration_ms"),
                "at": datetime.now(timezone.utc).isoformat(),
            }
        )

    def get_recent_tasks(self, limit: int = 50, status: Optional[str] = None) -> list[dict[str, Any]]:
        """Recent task outcomes, newest first, optionally filtered by status."""
        items = list(self._recent)
        if status:
            items = [t for t in items if t.get("status") == status]
        return items[: max(1, min(limit, 100))]

    async def submit_task(self, task: AgentTask) -> dict[str, Any]:
        """
        Submit a task to the orchestrator.
        Returns the routing decision and policy check result.
        """
        self._stats["tasks_received"] += 1

        # 1. Policy check
        policy = get_policy_engine()
        decision = policy.evaluate(
            agent_id=task.assigned_agent or "orchestrator",
            agent_domain=self._get_domain(task),
            action=self._get_action(task),
            risk_level=task.risk_level,
            confidence=0.8,
        )

        if not decision.allowed:
            self._stats["tasks_blocked"] += 1
            logger.warning(
                f"[Orchestrator] Task {task.id} BLOCKED: {decision.reason}"
            )
            result = {
                "status": "blocked",
                "task_id": task.id,
                "reason": decision.reason,
                "requires_approval": decision.requires_approval,
            }
            self._record(task, result)
            return result

        # 2. Find capable worker/agent
        executor_id = self._route_task(task)
        if not executor_id:
            result = {
                "status": "no_executor",
                "task_id": task.id,
                "reason": f"No worker found for capability: {task.required_capability}",
            }
            self._record(task, result)
            return result

        # 3. Execute
        result = await self._execute_task(task, executor_id)
        self._record(task, result)

        return result

    async def _execute_task(self, task: AgentTask, executor_id: str) -> dict[str, Any]:
        """Execute a task on the assigned worker/agent."""
        start_time = time.monotonic()

        try:
            # Try deterministic worker first
            worker = WORKER_MAP.get(executor_id)
            if worker:
                output = await worker.execute(task)
                duration_ms = (time.monotonic() - start_time) * 1000

                self._stats["tasks_completed"] += 1
                logger.info(
                    f"[Orchestrator] Task {task.id} completed by {executor_id} "
                    f"({duration_ms:.0f}ms)"
                )

                return {
                    "status": "completed",
                    "task_id": task.id,
                    "executor": executor_id,
                    "output": output,
                    "duration_ms": duration_ms,
                }

            # Try AI reasoning agent
            agent = AI_AGENT_MAP.get(executor_id)
            if agent:
                output = await agent.execute(task)
                duration_ms = (time.monotonic() - start_time) * 1000

                self._stats["tasks_completed"] += 1
                logger.info(
                    f"[Orchestrator] Task {task.id} completed by {executor_id} "
                    f"({duration_ms:.0f}ms)"
                )

                return {
                    "status": "completed",
                    "task_id": task.id,
                    "executor": executor_id,
                    "output": output,
                    "duration_ms": duration_ms,
                }

            return {
                "status": "no_executor",
                "task_id": task.id,
                "reason": f"No executor found: {executor_id}",
            }

        except Exception as e:
            duration_ms = (time.monotonic() - start_time) * 1000
            self._stats["tasks_failed"] += 1
            logger.error(
                f"[Orchestrator] Task {task.id} FAILED ({executor_id}): {e}"
            )
            return {
                "status": "failed",
                "task_id": task.id,
                "executor": executor_id,
                "error": str(e),
                "duration_ms": duration_ms,
            }

    def _route_task(self, task: AgentTask) -> Optional[str]:
        """Route a task to the best executor."""
        capability = task.required_capability
        if capability and capability in CAPABILITY_MAP:
            return CAPABILITY_MAP[capability]

        # Route by source
        source_routes = {
            "report": "report-prioritizer",
            "moderation": "content-risk",
            "error": "error-detector",
            "system": "system-health",
            "security": "spam-detector",
            "duplicate": "duplicate-detector",
            "poll": "system-health",
        }
        return source_routes.get(task.source, "system-health")

    def _get_domain(self, task: AgentTask) -> str:
        """Infer domain from task source/capability."""
        # First try to infer from capability
        cap_domains = {
            "performance_monitoring": "performance",
            "read_service_metrics": "performance",
            "read_cache_metrics": "performance",
            "read_database_metrics": "data",
            "cache_optimization": "performance",
            "database_performance": "data",
            "query_optimization": "data",
            "error_detection": "reliability",
            "exception_analysis": "reliability",
            "incident_correlation": "reliability",
            "spam_detection": "security",
            "content_risk": "moderation",
            "content_moderation": "moderation",
            "report_triage": "moderation",
            "duplicate_detection": "moderation",
            "system_health": "infrastructure",
            "verification": "quality",
            "feedback_analysis": "product",
            "deployment_safety": "quality",
            "ban_user": "security",
        }
        if task.required_capability and task.required_capability in cap_domains:
            return cap_domains[task.required_capability]

        # Fallback to source-based mapping
        source_domains = {
            "report": "moderation",
            "moderation": "moderation",
            "error": "reliability",
            "system": "infrastructure",
            "security": "security",
            "duplicate": "moderation",
            "poll": "product",
        }
        return source_domains.get(task.source, "infrastructure")

    def _get_action(self, task: AgentTask) -> str:
        """Infer action from task."""
        return task.required_capability or f"process_{task.source}"

    def get_stats(self) -> dict:
        return {**self._stats}

    def get_executor_info(self) -> dict:
        """Get info about all available executors."""
        workers = []
        for w in ALL_WORKERS:
            status = w.get_status()
            workers.append({
                "id": w.worker_id,
                "name": w.name,
                "domain": w.domain,
                "type": "deterministic",
                "running": status["running"],
            })

        agents = []
        for a in ALL_AI_AGENTS:
            agents.append({
                "id": a.agent_id,
                "name": a.name,
                "domain": a.domain,
                "type": "ai_reasoning",
            })

        return {
            "workers": workers,
            "agents": agents,
            "total_executors": len(workers) + len(agents),
            "capability_map": CAPABILITY_MAP,
        }


# ─── Singleton ──────────────────────────────────────────────────────

_orchestrator: Optional[Orchestrator] = None


def get_orchestrator() -> Orchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = Orchestrator()
    return _orchestrator
