"""
Main Patrol — Periodic background scans by high-value workers.

Runs on a schedule (every 60s by default) and dispatches patrol tasks
to the orchestrator. This ensures the workforce is actively monitoring
the platform even without incoming events.

Patrol tasks are lightweight:
- System health check
- Performance monitoring
- Cache health scan
- Spam pattern scan
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone

from .events import get_event_bus, EVENT_TYPES
from .models import AgentTask, TaskPriority, RiskLevel
from .orchestrator import get_orchestrator

logger = logging.getLogger(__name__)

# Patrol interval in seconds (configurable via env)
PATROL_INTERVAL = int(os.getenv("WORKFORCE_PATROL_INTERVAL", "60"))


async def run_patrol_cycle():
    """Run one patrol cycle — dispatch tasks for key health checks."""
    orchestrator = get_orchestrator()
    bus = get_event_bus()
    cycle_start = time.monotonic()

    # Dispatch system health check
    health_task = AgentTask(
        title="Patrol: System Health Check",
        description="Periodic system health scan",
        source="patrol",
        priority=TaskPriority.LOW,
        risk_level=RiskLevel.LOW,
        required_capability="system_health",
        input_data={"source": "patrol", "check_type": "health"},
    )
    try:
        result = await orchestrator.submit_task(health_task)
        if result.get("status") == "completed":
            logger.debug("[Patrol] Health check completed")
    except Exception as e:
        logger.warning(f"[Patrol] Health check failed: {e}")

    # Dispatch performance monitoring
    perf_task = AgentTask(
        title="Patrol: Performance Monitor",
        description="Periodic performance scan",
        source="patrol",
        priority=TaskPriority.LOW,
        risk_level=RiskLevel.LOW,
        required_capability="performance_monitoring",
        input_data={"source": "patrol", "check_type": "performance"},
    )
    try:
        result = await orchestrator.submit_task(perf_task)
        if result.get("status") == "completed":
            logger.debug("[Patrol] Performance scan completed")
    except Exception as e:
        logger.warning(f"[Patrol] Performance scan failed: {e}")

    # Dispatch cache health scan
    cache_task = AgentTask(
        title="Patrol: Cache Health Scan",
        description="Periodic cache health check",
        source="patrol",
        priority=TaskPriority.LOW,
        risk_level=RiskLevel.LOW,
        required_capability="cache_optimization",
        input_data={"source": "patrol", "check_type": "cache_health"},
    )
    try:
        result = await orchestrator.submit_task(cache_task)
        if result.get("status") == "completed":
            logger.debug("[Patrol] Cache health scan completed")
    except Exception as e:
        logger.warning(f"[Patrol] Cache health scan failed: {e}")

    duration_ms = (time.monotonic() - cycle_start) * 1000
    logger.info(f"[Patrol] Cycle completed in {duration_ms:.0f}ms")


async def run_patrol_loop():
    """Run patrol cycles continuously at the configured interval."""
    logger.info(f"[Patrol] Starting patrol loop (interval={PATROL_INTERVAL}s)")
    while True:
        try:
            await run_patrol_cycle()
        except asyncio.CancelledError:
            logger.info("[Patrol] Patrol loop cancelled")
            break
        except Exception as e:
            logger.error(f"[Patrol] Patrol cycle error: {e}")

        try:
            await asyncio.sleep(PATROL_INTERVAL)
        except asyncio.CancelledError:
            logger.info("[Patrol] Patrol loop cancelled during sleep")
            break
