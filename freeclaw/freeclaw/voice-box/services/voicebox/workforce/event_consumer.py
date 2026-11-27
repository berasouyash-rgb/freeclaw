"""
Event Consumer — Routes platform events to the orchestrator as tasks.

This module maps event types to worker capabilities and dispatches
tasks through the orchestrator. It's the bridge between the event bus
and the workforce execution engine.

Separated from main.py lifespan for testability and clarity.
"""

from __future__ import annotations

import logging
from typing import Any

from .events import EVENT_AGENT_MAP
from .models import AgentTask, TaskPriority, RiskLevel
from .orchestrator import get_orchestrator

logger = logging.getLogger(__name__)

# ─── Event → Capability mapping ──────────────────────────────────
# Maps platform event types to the worker capability that should handle them.
# Both EVENT_AGENT_MAP (which agents respond) AND this map (which capability
# routes through the orchestrator) must match for an event to be dispatched.
EVENT_CAPABILITY_MAP: dict[str, str] = {
    "POST_CREATED": "spam_detection",
    "COMMENT_CREATED": "spam_detection",
    "REPORT_CREATED": "report_triage",
    "REPORT_VERIFIED": "verification",
    "MESSAGE_SENT": "spam_detection",
    "SPAM_DETECTED": "spam_detection",
    "ABUSE_DETECTED": "content_risk",
    "SECURITY_ANOMALY": "error_detection",
    "SUSPICIOUS_ACTIVITY": "error_detection",
    "API_ERROR": "error_detection",
    "DATABASE_ERROR": "database_performance",
    "LATENCY_SPIKE": "performance_monitoring",
    "ERROR_RATE_SPIKE": "error_detection",
    "CACHE_MISS_SPIKE": "cache_optimization",
    "SERVICE_DEGRADED": "system_health",
    "SERVICE_RECOVERED": "system_health",
    "CONTENT_ANOMALY": "content_risk",
    "PERFORMANCE_REGRESSION": "performance_monitoring",
    "USER_CREATED": "system_health",
    "POLL_CREATED": "content_risk",
    "POLL_VOTED": "system_health",
}


def make_event_handler(capability_map: dict[str, str] | None = None):
    """Create an async event handler that routes events to the orchestrator.

    Returns an async callable suitable for bus.subscribe().
    The capability_map parameter allows testing with custom mappings.
    """
    caps = capability_map if capability_map is not None else EVENT_CAPABILITY_MAP
    orchestrator = get_orchestrator()

    async def _on_event(event):
        # Both agent mapping AND capability mapping must exist for dispatch.
        # Agent mapping = "which agents care about this event"
        # Capability mapping = "which orchestrator capability routes this"
        agent_ids = EVENT_AGENT_MAP.get(event.type, [])
        if not agent_ids:
            return

        capability = caps.get(event.type)
        if not capability:
            return

        task = AgentTask(
            title=f"Event: {event.type}",
            description=f"Auto-dispatched from {event.source}: {event.type}",
            source="event_consumer",
            priority=TaskPriority.HIGH if "SECURITY" in event.type or "SPAM" in event.type else TaskPriority.MEDIUM,
            risk_level=RiskLevel.LOW,
            required_capability=capability,
            input_data={"event_type": event.type, "event_data": event.data, "event_source": event.source},
            source_ref=event.id,
        )
        try:
            await orchestrator.submit_task(task)
        except Exception as e:
            logger.warning(f"[EventConsumer] Failed to dispatch {event.type}: {e}")

    return _on_event
