"""
Integration Layer — Bridges Python workforce with existing Node.js API.

This module connects the Python workforce to:
1. Supabase (shared database)
2. Node.js API events (via event bus)
3. Existing agent execution records
4. Existing task queue
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


class SupabaseClient:
    """Lightweight Supabase client for the Python workforce."""

    def __init__(self):
        self.url = os.getenv("SUPABASE_URL", "")
        self.key = os.getenv("SUPABASE_KEY", "")
        self._client = None

    async def initialize(self):
        """Initialize the Supabase client."""
        if not self.url or not self.key:
            logger.warning("[Supabase] No URL/key configured — using mock client")
            self._client = MockSupabaseClient()
            return

        try:
            from supabase import create_client, Client
            self._client = create_client(self.url, self.key)
            logger.info("[Supabase] Connected")
        except Exception as e:
            logger.warning(f"[Supabase] Connection failed: {e} — using mock")
            self._client = MockSupabaseClient()

    @property
    def client(self):
        return self._client


class MockSupabaseClient:
    """Mock Supabase client for development/testing."""

    def __init__(self):
        self._data: dict[str, list] = {}

    def table(self, name: str):
        return MockTable(self._data, name)


class MockTable:
    """Mock table for development."""

    def __init__(self, data: dict, table_name: str):
        self._data = data
        self._table = table_name
        if table_name not in data:
            data[table_name] = []

    def select(self, *cols):
        return self

    def insert(self, row):
        self._data[self._table].append(row)
        return self

    def eq(self, col, val):
        return self

    def order(self, col, ascending=True):
        return self

    def limit(self, n):
        return self

    def maybeSingle(self):
        return self

    def execute(self):
        return {"data": [], "error": None}


class EventBusBridge:
    """
    Bridges Python event bus to Node.js API events.
    Listens for events and forwards them to the existing system.
    """

    def __init__(self, supabase: SupabaseClient):
        self._supabase = supabase

    async def emit_to_node_api(self, event_type: str, data: dict):
        """Forward an event to the Node.js API."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    "http://localhost:3000/api/event-agents",
                    json={"action": "trigger", "event_type": event_type, "data": data},
                    headers={"Content-Type": "application/json"},
                )
                if resp.status_code == 200:
                    logger.info(f"[Bridge] Forwarded {event_type} to Node API")
                else:
                    logger.warning(f"[Bridge] Node API returned {resp.status_code}")
        except Exception as e:
            logger.warning(f"[Bridge] Failed to forward {event_type}: {e}")

    async def sync_from_node_api(self) -> dict:
        """Pull recent data from Node.js API."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                # Get recent executions
                exec_resp = await client.get(
                    "http://localhost:3000/api/workforce/executions",
                    params={"limit": 50},
                )
                # Get recent events
                events_resp = await client.get(
                    "http://localhost:3000/api/event-agents?action=events",
                    params={"limit": 50},
                )
                return {
                    "executions": exec_resp.json() if exec_resp.status_code == 200 else [],
                    "events": events_resp.json() if events_resp.status_code == 200 else [],
                }
        except Exception as e:
            logger.warning(f"[Bridge] Sync failed: {e}")
            return {"executions": [], "events": []}


class WorkforceIntegration:
    """
    Main integration class that ties everything together.
    """

    def __init__(self):
        self.supabase = SupabaseClient()
        self.bridge: Optional[EventBusBridge] = None

    async def initialize(self):
        """Initialize all connections."""
        await self.supabase.initialize()
        self.bridge = EventBusBridge(self.supabase)

        # Initialize the workforce components
        from .events import get_event_bus
        from .tools import get_tool_registry
        from .policy import get_policy_engine
        from .orchestrator import get_orchestrator

        bus = get_event_bus()
        tools = get_tool_registry()
        policy = get_policy_engine()
        orchestrator = get_orchestrator()

        logger.info("[Integration] Workforce initialized")
        logger.info(f"[Integration] {len(tools._tools)} tools registered")
        logger.info(f"[Integration] Orchestrator ready")

        return {
            "bus": bus,
            "tools": tools,
            "policy": policy,
            "orchestrator": orchestrator,
        }


# ─── Singleton ──────────────────────────────────────────────────────

_integration: Optional[WorkforceIntegration] = None


def get_integration() -> WorkforceIntegration:
    global _integration
    if _integration is None:
        _integration = WorkforceIntegration()
    return _integration
