"""
Event Bus — Central nervous system of the AI Workforce.

All system events flow through here. Workers subscribe to event types
they care about. Events are persisted for audit and replay.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine, Optional

from .models import AgentEvent

logger = logging.getLogger(__name__)

# ─── Event Types (35+ from spec) ───────────────────────────────────

EVENT_TYPES = [
    # User events
    "USER_CREATED",
    "USER_LOGIN",
    "USER_LOGOUT",
    # Content events
    "POST_CREATED",
    "COMMENT_CREATED",
    "REPORT_CREATED",
    "REPORT_VERIFIED",
    "MESSAGE_SENT",
    "MESSAGE_RECEIVED",
    # Poll events
    "POLL_CREATED",
    "POLL_VOTED",
    # Search
    "SEARCH_PERFORMED",
    # API / System
    "API_REQUEST",
    "API_ERROR",
    "DATABASE_ERROR",
    "CACHE_MISS_SPIKE",
    "LATENCY_SPIKE",
    "ERROR_RATE_SPIKE",
    "CPU_SPIKE",
    "MEMORY_SPIKE",
    "QUEUE_BACKLOG",
    # Security
    "SUSPICIOUS_ACTIVITY",
    "SPAM_DETECTED",
    "ABUSE_DETECTED",
    "SECURITY_ANOMALY",
    # Service health
    "SERVICE_DEGRADED",
    "SERVICE_RECOVERED",
    "DEPLOYMENT_STARTED",
    "DEPLOYMENT_COMPLETED",
    "BACKUP_COMPLETED",
    "BACKUP_FAILED",
    # Feedback / Intelligence
    "USER_FEEDBACK",
    "PERFORMANCE_REGRESSION",
    "CONTENT_ANOMALY",
    "CONFIGURATION_CHANGED",
    # Task lifecycle
    "TASK_CREATED",
    "TASK_ASSIGNED",
    "TASK_COMPLETED",
    "TASK_FAILED",
    # Agent lifecycle
    "AGENT_HEARTBEAT",
    "AGENT_UNHEALTHY",
    "AGENT_RECOVERED",
    # Tool lifecycle
    "TOOL_EXECUTED",
]

# ─── Event → Agent routing map ─────────────────────────────────────

EVENT_AGENT_MAP: dict[str, list[str]] = {
    "USER_CREATED": ["community-health-agent"],
    "USER_LOGIN": [],
    "USER_LOGOUT": [],
    "POST_CREATED": ["spam-detector", "content-risk-classifier", "community-health-agent"],
    "COMMENT_CREATED": ["spam-detector", "harassment-detector"],
    "REPORT_CREATED": ["report-prioritization-agent", "abuse-report-analyzer"],
    "REPORT_VERIFIED": ["trust-safety-coordinator"],
    "MESSAGE_SENT": ["spam-detector"],
    "MESSAGE_RECEIVED": [],
    "POLL_CREATED": ["content-risk-classifier"],
    "POLL_VOTED": ["engagement-analysis-agent"],
    "SEARCH_PERFORMED": ["search-experience-agent"],
    "API_REQUEST": ["api-latency-agent", "performance-monitor"],
    "API_ERROR": ["error-detection-agent", "exception-analyzer"],
    "DATABASE_ERROR": ["database-performance-agent", "failure-diagnosis-agent"],
    "CACHE_MISS_SPIKE": ["cache-optimization-agent"],
    "LATENCY_SPIKE": ["performance-monitor", "api-latency-agent"],
    "ERROR_RATE_SPIKE": ["error-detection-agent", "reliability-monitor"],
    "CPU_SPIKE": ["infrastructure-monitor", "cpu-memory-agent"],
    "MEMORY_SPIKE": ["infrastructure-monitor", "cpu-memory-agent"],
    "QUEUE_BACKLOG": ["queue-health-agent"],
    "SUSPICIOUS_ACTIVITY": ["suspicious-activity-agent", "security-incident-coordinator"],
    "SPAM_DETECTED": ["spam-detector", "trust-safety-coordinator"],
    "ABUSE_DETECTED": ["abuse-detection-agent", "security-incident-coordinator"],
    "SECURITY_ANOMALY": ["injection-detection-agent", "security-incident-coordinator"],
    "SERVICE_DEGRADED": ["service-health-agent", "reliability-monitor"],
    "SERVICE_RECOVERED": ["service-health-agent", "reliability-monitor"],
    "DEPLOYMENT_STARTED": ["deployment-safety-agent"],
    "DEPLOYMENT_COMPLETED": ["deployment-safety-agent", "regression-detection-agent"],
    "BACKUP_COMPLETED": ["backup-verification-agent"],
    "BACKUP_FAILED": ["backup-verification-agent", "incident-correlator"],
    "USER_FEEDBACK": ["feedback-analyzer", "product-improvement-agent"],
    "PERFORMANCE_REGRESSION": ["performance-monitor", "regression-detection-agent"],
    "CONTENT_ANOMALY": ["content-risk-classifier", "coordinated-behavior-agent"],
    "CONFIGURATION_CHANGED": ["configuration-validation-agent"],
    "TASK_CREATED": ["task-router"],
    "TASK_ASSIGNED": ["verification-coordinator"],
    "TASK_COMPLETED": ["verification-coordinator", "workforce-supervisor"],
    "TASK_FAILED": ["failure-diagnosis-agent", "retry-coordinator"],
    "AGENT_HEARTBEAT": ["workforce-supervisor"],
    "AGENT_UNHEALTHY": ["recovery-agent", "workforce-supervisor"],
    "AGENT_RECOVERED": ["workforce-supervisor"],
    "TOOL_EXECUTED": ["workforce-supervisor"],
}


class EventBus:
    """
    In-process event bus with optional Redis-backed persistence.

    Usage:
        bus = EventBus()
        bus.subscribe("POST_CREATED", my_handler)
        await bus.emit("POST_CREATED", {"post_id": "123"})
    """

    def __init__(self, redis_url: Optional[str] = None):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._event_log: list[AgentEvent] = []
        self._stats: dict[str, int] = defaultdict(int)
        self._redis_url = redis_url
        self._redis = None
        self._max_log_size = 10000

    async def initialize(self):
        """Connect to Redis if configured."""
        if self._redis_url:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
                await self._redis.ping()
                logger.info("[EventBus] Connected to Redis")
            except Exception as e:
                logger.warning(f"[EventBus] Redis unavailable, using in-memory: {e}")
                self._redis = None

    def subscribe(self, event_type: str, handler: Callable):
        """Subscribe a handler to an event type."""
        self._subscribers[event_type].append(handler)
        logger.debug(f"[EventBus] Subscribed to {event_type}: {handler.__name__}")

    def unsubscribe(self, event_type: str, handler: Callable):
        """Remove a handler subscription."""
        if handler in self._subscribers[event_type]:
            self._subscribers[event_type].remove(handler)

    async def emit(self, event_type: str, data: Optional[dict[str, Any]] = None, source: str = "system"):
        """
        Emit an event. All matching subscribers are notified.
        Event is also persisted for audit/replay.
        """
        if event_type not in EVENT_TYPES:
            logger.warning(f"[EventBus] Unknown event type: {event_type}")
            return

        event = AgentEvent(type=event_type, data=data or {}, source=source)
        self._stats[event_type] += 1

        # Persist to in-memory log
        self._event_log.append(event)
        if len(self._event_log) > self._max_log_size:
            self._event_log = self._event_log[-self._max_log_size:]

        # Persist to Redis if available
        if self._redis:
            try:
                await self._redis.lpush(
                    "workforce:events",
                    event.model_dump_json(),
                )
                await self._redis.ltrim("workforce:events", 0, self._max_log_size - 1)
                await self._redis.hincrby("workforce:event_stats", event_type, 1)
            except Exception as e:
                logger.warning(f"[EventBus] Redis persist failed: {e}")

        # Notify subscribers
        handlers = self._subscribers.get(event_type, [])
        for handler in handlers:
            try:
                result = handler(event)
                if asyncio.iscoroutine(result):
                    await result
                event.processed_by.append(handler.__name__)
            except Exception as e:
                logger.error(f"[EventBus] Handler {handler.__name__} failed for {event_type}: {e}")

        logger.info(f"[EventBus] Emitted {event_type} (source={source}, handlers={len(handlers)})")

    async def get_recent_events(self, limit: int = 50, event_type: Optional[str] = None) -> list[AgentEvent]:
        """Get recent events from the log."""
        events = self._event_log
        if event_type:
            events = [e for e in events if e.type == event_type]
        return events[-limit:]

    def get_stats(self) -> dict[str, int]:
        """Get event emission counts."""
        return dict(self._stats)

    async def close(self):
        """Clean up connections."""
        if self._redis:
            await self._redis.close()


# ─── Singleton ──────────────────────────────────────────────────────

_bus: Optional[EventBus] = None


def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
