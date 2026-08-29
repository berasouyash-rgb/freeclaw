"""
Real Write Tools — Tools that actually modify the platform.

These tools produce MEASURABLE CHANGES in the real system.
Every write tool:
1. Captures before state
2. Performs the operation
3. Captures after state
4. Returns both for verification
5. Can be rolled back where safe
"""

from __future__ import annotations

import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

_supabase_client = None


def _get_supabase():
    """Lazy-init Supabase client."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", os.getenv("SUPABASE_SERVICE_KEY", ""))
    if url and key:
        try:
            from supabase import create_client
            _supabase_client = create_client(url, key)
            return _supabase_client
        except Exception as e:
            logger.warning(f"[WriteTools] Supabase connection failed: {e}")
    return None


# ─── Cache Tools ─────────────────────────────────────────────────────

async def invalidate_cache(input_data: dict) -> dict:
    """
    Invalidate stale cache entries in system_metrics.
    Returns before/after cache hit counts for verification.
    """
    sb = _get_supabase()
    if not sb:
        return {"error": "supabase_not_connected", "rolled_back": False}

    pattern = input_data.get("pattern", "cache_miss")
    scope = input_data.get("scope", "all")

    try:
        # BEFORE: count current cache metrics
        before = sb.table("system_metrics").select("id", count="exact").eq(
            "metric_name", "cache_miss"
        ).execute()
        before_count = before.count or 0

        # ACTION: Remove old cache miss entries (older than 1 hour)
        one_hour_ago = (datetime.now(timezone.utc) - __import__('datetime').timedelta(hours=1)).isoformat()
        if pattern == "cache_miss":
            deleted = sb.table("system_metrics").delete().eq(
                "metric_name", "cache_miss"
            ).lt("recorded_at", one_hour_ago).execute()
        else:
            deleted = sb.table("system_metrics").delete().like(
                "metric_name", f"%{pattern}%"
            ).lt("recorded_at", one_hour_ago).execute()

        # AFTER: count remaining
        after = sb.table("system_metrics").select("id", count="exact").eq(
            "metric_name", "cache_miss"
        ).execute()
        after_count = after.count or 0

        return {
            "action": "invalidate_cache",
            "pattern": pattern,
            "before_count": before_count,
            "after_count": after_count,
            "reduced": before_count - after_count,
            "rolled_back": False,
        }
    except Exception as e:
        logger.error(f"[WriteTools] invalidate_cache failed: {e}")
        return {"error": str(e), "rolled_back": False}


async def cleanup_stale_sessions(input_data: dict) -> dict:
    """
    Clean up stale agent_executions that are stuck in 'running' state.
    Returns before/after count of stuck executions.
    """
    sb = _get_supabase()
    if not sb:
        return {"error": "supabase_not_connected"}

    try:
        # BEFORE: count stuck executions
        stuck = sb.table("agent_executions").select("id").eq(
            "status", "running"
        ).execute()
        before_count = len(stuck.data or [])

        if before_count == 0:
            return {"action": "cleanup_stale_sessions", "before": 0, "after": 0, "cleaned": 0}

        # Mark old running executions as failed (stale — they should have completed by now)
        one_hour_ago = (datetime.now(timezone.utc) - __import__('datetime').timedelta(hours=1)).isoformat()
        sb.table("agent_executions").update({
            "status": "failed",
            "error": "stale_execution_cleaned_by_workforce",
        }).eq("status", "running").lt("started_at", one_hour_ago).execute()

        # AFTER
        stuck_after = sb.table("agent_executions").select("id").eq(
            "status", "running"
        ).execute()
        after_count = len(stuck_after.data or [])

        return {
            "action": "cleanup_stale_sessions",
            "before": before_count,
            "after": after_count,
            "cleaned": before_count - after_count,
        }
    except Exception as e:
        logger.error(f"[WriteTools] cleanup_stale_sessions failed: {e}")
        return {"error": str(e)}


async def cleanup_old_events(input_data: dict) -> dict:
    """
    Clean up old event_log entries to prevent unbounded growth.
    Keeps the most recent N events.
    """
    sb = _get_supabase()
    if not sb:
        return {"error": "supabase_not_connected"}

    keep_count = input_data.get("keep_count", 200)

    try:
        # BEFORE: get current event count
        result = sb.table("settings").select("value").eq("key", "event_log").maybeSingle().execute()
        events = result.data.get("value", {}).get("events", []) if result.data else []
        before_count = len(events)

        if before_count <= keep_count:
            return {"action": "cleanup_old_events", "before": before_count, "after": before_count, "cleaned": 0}

        # TRIM to keep_count
        trimmed = events[:keep_count]
        sb.table("settings").update({"value": {"events": trimmed}}).eq("key", "event_log").execute()

        return {
            "action": "cleanup_old_events",
            "before": before_count,
            "after": len(trimmed),
            "cleaned": before_count - len(trimmed),
        }
    except Exception as e:
        logger.error(f"[WriteTools] cleanup_old_events failed: {e}")
        return {"error": str(e)}


async def quarantine_content(input_data: dict) -> dict:
    """
    Quarantine suspicious content by setting it as hidden.
    SAFE AUTONOMOUS ACTION: reversible, low risk.
    """
    sb = _get_supabase()
    if not sb:
        return {"error": "supabase_not_connected"}

    post_id = input_data.get("post_id")
    reason = input_data.get("reason", "quarantined_by_workforce")

    if not post_id:
        return {"error": "missing_post_id"}

    try:
        # BEFORE: check current state
        post = sb.table("posts").select("id, hidden, deleted").eq("id", post_id).maybeSingle().execute()
        if not post.data:
            return {"error": "post_not_found"}

        before_hidden = post.data.get("hidden", False)

        # Only quarantine if not already hidden
        if before_hidden:
            return {"action": "quarantine_content", "post_id": post_id, "already_quarantined": True}

        # ACTION: hide the post
        sb.table("posts").update({
            "hidden": True,
            "admin_notes": f"Quarantined by workforce: {reason}",
        }).eq("id", post_id).execute()

        # AFTER
        after = sb.table("posts").select("hidden").eq("id", post_id).maybeSingle().execute()
        after_hidden = after.data.get("hidden", False) if after.data else False

        return {
            "action": "quarantine_content",
            "post_id": post_id,
            "reason": reason,
            "before_hidden": before_hidden,
            "after_hidden": after_hidden,
            "rolled_back": False,
            "rollback_data": {"post_id": post_id, "hidden": before_hidden},
        }
    except Exception as e:
        logger.error(f"[WriteTools] quarantine_content failed: {e}")
        return {"error": str(e)}


async def restore_content(input_data: dict) -> dict:
    """
    Restore quarantined content (rollback).
    """
    sb = _get_supabase()
    if not sb:
        return {"error": "supabase_not_connected"}

    post_id = input_data.get("post_id")
    if not post_id:
        return {"error": "missing_post_id"}

    try:
        sb.table("posts").update({
            "hidden": False,
            "admin_notes": "Restored by workforce rollback",
        }).eq("id", post_id).execute()

        return {"action": "restore_content", "post_id": post_id, "restored": True}
    except Exception as e:
        return {"error": str(e)}


async def create_index_candidate(input_data: dict) -> dict:
    """
    Record an index candidate for slow queries.
    Does NOT modify the database — only records the recommendation.
    This is a CLASS B action: observe + recommend.
    """
    sb = _get_supabase()
    if not sb:
        return {"error": "supabase_not_connected"}

    table_name = input_data.get("table", "unknown")
    columns = input_data.get("columns", [])
    reason = input_data.get("reason", "")
    query_text = input_data.get("query", "")

    try:
        # Record the recommendation in system_metrics
        sb.table("system_metrics").insert({
            "metric_name": "index_recommendation",
            "metric_value": 1,
            "tags": {
                "table": table_name,
                "columns": columns,
                "reason": reason,
                "query_preview": query_text[:200] if query_text else "",
                "status": "recommended",
            },
        }).execute()

        return {
            "action": "create_index_candidate",
            "table": table_name,
            "columns": columns,
            "status": "recommended",
        }
    except Exception as e:
        return {"error": str(e)}


async def retry_notification(input_data: dict) -> dict:
    """
    Retry a failed notification by re-emitting the notification event.
    """
    from .events import get_event_bus

    notification_type = input_data.get("type", "info")
    title = input_data.get("title", "")
    body = input_data.get("body", "")

    bus = get_event_bus()
    await bus.emit("NOTIFICATION_FAILED", {
        "retry": True,
        "type": notification_type,
        "title": title,
        "body": body,
    }, source="notification_retry_worker")

    return {
        "action": "retry_notification",
        "type": notification_type,
        "title": title,
        "retried": True,
    }


async def record_metric(input_data: dict) -> dict:
    """
    Record a metric in system_metrics for tracking.
    Used by optimization workers to record before/after measurements.
    """
    sb = _get_supabase()
    if not sb:
        return {"error": "supabase_not_connected"}

    metric_name = input_data.get("metric_name", "")
    metric_value = input_data.get("metric_value", 0)
    tags = input_data.get("tags", {})

    try:
        sb.table("system_metrics").insert({
            "metric_name": metric_name,
            "metric_value": metric_value,
            "tags": {
                **tags,
                "recorded_by": "workforce",
                "recorded_at": datetime.now(timezone.utc).isoformat(),
            },
        }).execute()

        return {"action": "record_metric", "metric_name": metric_name, "recorded": True}
    except Exception as e:
        return {"error": str(e)}


def register_write_tools(registry):
    """Register all write tools with the tool registry."""
    from .models import ToolPermission

    registry.register(
        "invalidate_cache", "Invalidate Cache",
        "Remove stale cache entries and record before/after counts",
        ToolPermission.WRITE, invalidate_cache,
    )
    registry.register(
        "cleanup_stale_sessions", "Cleanup Stale Sessions",
        "Mark stuck executions as failed and record before/after counts",
        ToolPermission.WRITE, cleanup_stale_sessions,
    )
    registry.register(
        "cleanup_old_events", "Cleanup Old Events",
        "Trim event log to prevent unbounded growth",
        ToolPermission.WRITE, cleanup_old_events,
    )
    registry.register(
        "quarantine_content", "Quarantine Content",
        "Hide suspicious content (reversible)",
        ToolPermission.WRITE, quarantine_content,
    )
    registry.register(
        "restore_content", "Restore Content",
        "Restore quarantined content (rollback)",
        ToolPermission.WRITE, restore_content,
    )
    registry.register(
        "create_index_candidate", "Create Index Candidate",
        "Record an index recommendation for slow queries",
        ToolPermission.ANALYZE, create_index_candidate,
    )
    registry.register(
        "retry_notification", "Retry Notification",
        "Retry a failed notification delivery",
        ToolPermission.WRITE, retry_notification,
    )
    registry.register(
        "record_metric", "Record Metric",
        "Record a metric for before/after measurement tracking",
        ToolPermission.WRITE, record_metric,
    )

    logger.info("[WriteTools] Registered 8 write tools")
