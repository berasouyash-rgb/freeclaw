"""
Platform Bridge — Connects Python workforce workers to real Node.js platform operations.

Every tool call here:
1. Calls the real Node.js API bridge
2. Gets a real result
3. Records the execution
4. Returns before/after metrics for verification

This is how the Python workforce produces REAL effects on the platform.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Bridge URL — defaults to localhost for development
BRIDGE_URL = os.getenv("BRIDGE_URL", "http://localhost:3000")
BRIDGE_TIMEOUT = int(os.getenv("BRIDGE_TIMEOUT", "10"))
BRIDGE_SECRET = os.getenv("WORKFORCE_BRIDGE_SECRET", "")


async def call_bridge(
    tool: str,
    params: dict[str, Any],
    agent_id: str = "unknown",
    task_id: str = "",
) -> dict[str, Any]:
    """
    Call the Node.js platform bridge to perform a real operation.

    Returns the bridge response or error details.
    Every call is timed and logged.
    """
    import httpx

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=BRIDGE_TIMEOUT) as client:
            headers = {"Content-Type": "application/json"}
            if BRIDGE_SECRET:
                headers["X-Bridge-Secret"] = BRIDGE_SECRET
            response = await client.post(
                f"{BRIDGE_URL}/api/workforce-bridge",
                json={
                    "action": tool,
                    "params": params,
                    "agent_id": agent_id,
                    "task_id": task_id,
                },
                headers=headers,
            )
            duration_ms = (time.monotonic() - start) * 1000

            if response.status_code == 200:
                data = response.json()
                logger.info(
                    f"[Bridge] {agent_id} → {tool}: OK ({duration_ms:.0f}ms)"
                )
                return {
                    "ok": True,
                    "tool": tool,
                    "result": data.get("result", {}),
                    "duration_ms": duration_ms,
                }
            else:
                error_text = response.text[:200]
                logger.warning(
                    f"[Bridge] {agent_id} → {tool}: HTTP {response.status_code} ({duration_ms:.0f}ms)"
                )
                return {
                    "ok": False,
                    "tool": tool,
                    "error": f"HTTP {response.status_code}: {error_text}",
                    "duration_ms": duration_ms,
                }

    except httpx.ConnectError:
        duration_ms = (time.monotonic() - start) * 1000
        logger.warning(f"[Bridge] {agent_id} → {tool}: connection failed ({duration_ms:.0f}ms)")
        return {"ok": False, "tool": tool, "error": "bridge_unavailable", "duration_ms": duration_ms}
    except httpx.TimeoutException:
        duration_ms = (time.monotonic() - start) * 1000
        logger.warning(f"[Bridge] {agent_id} → {tool}: timeout ({duration_ms:.0f}ms)")
        return {"ok": False, "tool": tool, "error": "timeout", "duration_ms": duration_ms}
    except Exception as e:
        duration_ms = (time.monotonic() - start) * 1000
        logger.error(f"[Bridge] {agent_id} → {tool}: {e} ({duration_ms:.0f}ms)")
        return {"ok": False, "tool": tool, "error": str(e), "duration_ms": duration_ms}


# ─── Convenience wrappers for common operations ─────────────────

async def read_post(post_id: str, agent_id: str = "", task_id: str = "") -> dict:
    """Read a real post from the platform."""
    return await call_bridge("read_post", {"post_id": post_id}, agent_id, task_id)


async def read_pending_reports(limit: int = 50, agent_id: str = "", task_id: str = "") -> dict:
    """Read real pending reports."""
    return await call_bridge("read_pending_reports", {"limit": limit}, agent_id, task_id)


async def read_recent_posts(limit: int = 20, agent_id: str = "", task_id: str = "") -> dict:
    """Read recent posts for analysis."""
    return await call_bridge("read_recent_posts", {"limit": limit}, agent_id, task_id)


async def count_posts(**kwargs) -> dict:
    """Count posts with optional filters."""
    return await call_bridge("count_posts", kwargs)


async def count_comments(**kwargs) -> dict:
    """Count comments."""
    return await call_bridge("count_comments", kwargs)


async def read_executions(limit: int = 50, agent_id: str = "", task_id: str = "") -> dict:
    """Read recent agent executions."""
    return await call_bridge("read_executions", {"limit": limit}, agent_id, task_id)


async def read_system_health(agent_id: str = "", task_id: str = "") -> dict:
    """Read real system health."""
    return await call_bridge("read_system_health", {}, agent_id, task_id)


async def quarantine_post(post_id: str, reason: str = "", agent_id: str = "", task_id: str = "") -> dict:
    """Quarantine a suspicious post (reversible)."""
    return await call_bridge("quarantine_post", {"post_id": post_id, "reason": reason}, agent_id, task_id)


async def restore_post(post_id: str, agent_id: str = "", task_id: str = "") -> dict:
    """Restore a quarantined post."""
    return await call_bridge("restore_post", {"post_id": post_id}, agent_id, task_id)


async def record_metric(metric_name: str, metric_value: float, tags: dict = None, agent_id: str = "", task_id: str = "") -> dict:
    """Record a metric."""
    return await call_bridge("record_metric", {"metric_name": metric_name, "metric_value": metric_value, "tags": tags or {}}, agent_id, task_id)


async def record_action(action_data: dict, agent_id: str = "", task_id: str = "") -> dict:
    """Record a workforce action in the ledger."""
    return await call_bridge("record_action", action_data, agent_id, task_id)


async def create_alert(severity: str, title: str, body: str = "", source_worker: str = "", category: str = "", dedup_key: str = "", agent_id: str = "", task_id: str = "") -> dict:
    """Create a real admin alert."""
    return await call_bridge("create_alert", {
        "severity": severity, "title": title, "body": body,
        "source_worker": source_worker, "category": category, "dedup_key": dedup_key,
    }, agent_id, task_id)


async def create_incident(incident_data: dict, agent_id: str = "", task_id: str = "") -> dict:
    """Create a real incident record."""
    return await call_bridge("create_incident", incident_data, agent_id, task_id)


async def emit_event(event_type: str, data: dict = None, agent_id: str = "", task_id: str = "") -> dict:
    """Emit a platform event."""
    return await call_bridge("emit_event", {"event_type": event_type, "data": data or {}}, agent_id, task_id)
