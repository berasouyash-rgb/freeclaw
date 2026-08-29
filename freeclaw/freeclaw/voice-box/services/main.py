"""
Voice Box AI Workforce — FastAPI Application

Exposes the workforce runtime as a REST API for:
- Admin dashboard integration
- Event ingestion
- Task management
- Agent monitoring
- Observability metrics
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from voicebox.workforce.agents import ALL_AI_AGENTS, AI_AGENT_MAP
from voicebox.workforce.events import EVENT_TYPES, get_event_bus
from voicebox.workforce.models import AgentTask, TaskPriority, TaskStatus, RiskLevel
from voicebox.workforce.orchestrator import get_orchestrator
from voicebox.workforce.policy import get_policy_engine
from voicebox.workforce.registry import ALL_AGENTS, AGENT_MAP, DOMAIN_MAP, agents_for_event
from voicebox.workforce.tools import get_tool_registry
from voicebox.workforce.workers import ALL_WORKERS, WORKER_MAP

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Lifespan ───────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown."""
    logger.info("[Workforce] Starting AI Workforce Runtime...")

    # Initialize event bus
    bus = get_event_bus()
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        bus._redis_url = redis_url
    await bus.initialize()

    # Register write tools (real platform-modifying operations)
    from voicebox.workforce.write_tools import register_write_tools
    tools = get_tool_registry()
    register_write_tools(tools)
    logger.info(f"[Workforce] {len(tools._tools)} tools registered (including write tools)")

    # Wire event bus → SSE push (so SSE subscribers get live events)
    _original_emit = bus.emit
    async def _emit_with_sse(event_type: str, data=None, source="system"):
        result = await _original_emit(event_type, data, source)
        try:
            await push_sse_event({
                "event_type": event_type,
                "data": data or {},
                "source": source,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        return result
    bus.emit = _emit_with_sse  # type: ignore

    # Subscribe event consumer for automatic task dispatch
    from voicebox.workforce.event_consumer import make_event_handler, EVENT_CAPABILITY_MAP
    event_handler = make_event_handler()
    for etype in EVENT_TYPES:
        bus.subscribe(etype, event_handler)
    logger.info(f"[Workforce] Event consumer subscribed to {len(EVENT_TYPES)} event types")

    # Start background patrol (periodic health scans)
    import voicebox.workforce.main_patrol as patrol_mod
    patrol_task = asyncio.create_task(patrol_mod.run_patrol_loop())

    # Emit startup event
    await bus.emit("SERVICE_RECOVERED", {"service": "workforce_runtime"}, source="system")

    logger.info("[Workforce] Runtime ready — event consumer + patrol active")
    yield

    # Shutdown
    patrol_task.cancel()
    try:
        await patrol_task
    except asyncio.CancelledError:
        pass
    await bus.emit("SERVICE_DEGRADED", {"service": "workforce_runtime"}, source="system")
    await bus.close()
    logger.info("[Workforce] Shutdown complete")


# ─── App ────────────────────────────────────────────────────────────

app = FastAPI(
    title="Voice Box AI Workforce",
    description="Production-grade autonomous AI operations workforce",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request/Response Models ────────────────────────────────────────

class EmitEventRequest(BaseModel):
    event_type: str
    data: dict = {}
    source: str = "api"


class SubmitTaskRequest(BaseModel):
    title: str
    description: str = ""
    source: str = "api"
    priority: str = "medium"
    risk_level: str = "low"
    required_capability: Optional[str] = None
    input_data: dict = {}


class PolicyOverrideRequest(BaseModel):
    agent_id: str
    action: str
    allowed: bool
    reason: str = ""


# ─── Health ─────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "voicebox-workforce", "timestamp": datetime.now(timezone.utc).isoformat()}


# ─── Workforce Overview ─────────────────────────────────────────────

@app.get("/api/workforce/overview")
async def workforce_overview():
    """Get workforce health overview."""
    orchestrator = get_orchestrator()
    tools = get_tool_registry()
    policy = get_policy_engine()
    bus = get_event_bus()

    executor_info = orchestrator.get_executor_info()
    tool_stats = tools.get_tool_stats()
    policy_stats = policy.get_stats()
    event_stats = bus.get_stats()

    return {
        "health": {
            "total_workers": len(ALL_WORKERS),
            "total_ai_agents": len(ALL_AI_AGENTS),
            "total_registered_agents": len(ALL_AGENTS),
            "total_domains": len(DOMAIN_MAP),
            "total_executors": executor_info["total_executors"],
        },
        "orchestrator": orchestrator.get_stats(),
        "tools": {
            "registered": len(tool_stats),
            "total_executions": sum(s["execution_count"] for s in tool_stats.values()),
            "stats": tool_stats,
        },
        "policy": policy_stats,
        "events": {
            "total_types": len(EVENT_TYPES),
            "emissions": event_stats,
        },
    }


# ─── Events ─────────────────────────────────────────────────────────

@app.get("/api/workforce/events")
async def list_events(
    limit: int = Query(50, ge=1, le=200),
    event_type: Optional[str] = None,
):
    """Get recent events."""
    bus = get_event_bus()
    events = await bus.get_recent_events(limit, event_type)
    return {"events": [e.model_dump() for e in events], "count": len(events)}


@app.post("/api/workforce/events")
async def emit_event(req: EmitEventRequest):
    """Emit an event into the workforce."""
    if req.event_type not in EVENT_TYPES:
        raise HTTPException(400, f"Invalid event type. Valid: {EVENT_TYPES}")

    bus = get_event_bus()
    await bus.emit(req.event_type, req.data, req.source)

    return {"status": "emitted", "event_type": req.event_type}


@app.get("/api/workforce/events/types")
async def list_event_types():
    """Get all event types and their agent mappings."""
    from voicebox.workforce.events import EVENT_AGENT_MAP
    types = []
    for etype in EVENT_TYPES:
        agents = EVENT_AGENT_MAP.get(etype, [])
        types.append({"type": etype, "agents": agents, "agent_count": len(agents)})
    return {"types": types, "total": len(types)}


# ─── Tasks ──────────────────────────────────────────────────────────

@app.post("/api/workforce/tasks")
async def submit_task(req: SubmitTaskRequest):
    """Submit a task to the workforce."""
    task = AgentTask(
        title=req.title,
        description=req.description,
        source=req.source,
        priority=TaskPriority(req.priority),
        risk_level=RiskLevel(req.risk_level),
        required_capability=req.required_capability,
        input_data=req.input_data,
    )

    orchestrator = get_orchestrator()
    result = await orchestrator.submit_task(task)

    return result


@app.get("/api/workforce/tasks")
async def list_tasks(
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
):
    """List recent tasks."""
    # For now, return from orchestrator stats
    orchestrator = get_orchestrator()
    return {
        "tasks": [],
        "stats": orchestrator.get_stats(),
    }


# ─── Agents ─────────────────────────────────────────────────────────

@app.get("/api/workforce/agents")
async def list_agents():
    """List all 100 registered agents with their real definitions."""
    agents = []
    for a in ALL_AGENTS:
        agents.append({
            "id": a.agent_id,
            "name": a.name,
            "domain": a.domain,
            "type": a.agent_type,
            "purpose": a.purpose,
            "tools": list(a.tools),
            "events": list(a.events),
            "status": "active",
            "version": a.version,
            "max_runs_per_hour": a.max_runs_per_hour,
            "confidence_threshold": a.confidence_threshold,
            "verification_method": a.verification_method,
        })
    return {"agents": agents, "total": len(agents)}


@app.get("/api/workforce/agents/{agent_id}")
async def get_agent(agent_id: str):
    """Get detailed information about a specific agent."""
    agent = AGENT_MAP.get(agent_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {agent_id}")
    return {
        "agent": {
            "id": agent.agent_id,
            "name": agent.name,
            "domain": agent.domain,
            "type": agent.agent_type,
            "purpose": agent.purpose,
            "tools": list(agent.tools),
            "events": list(agent.events),
            "trigger_conditions": list(agent.trigger_conditions),
            "decision_policy": agent.decision_policy,
            "max_runs_per_hour": agent.max_runs_per_hour,
            "max_concurrent": agent.max_concurrent,
            "confidence_threshold": agent.confidence_threshold,
            "verification_method": agent.verification_method,
            "rollback_policy": agent.rollback_policy,
            "version": agent.version,
        }
    }


# ─── Agent Registry ────────────────────────────────────────────────

@app.get("/api/workforce/registry")
async def get_registry():
    """Get the full agent registry organized by domain."""
    domains = {}
    for domain, agents in DOMAIN_MAP.items():
        domains[domain] = {
            "count": len(agents),
            "agents": [
                {
                    "id": a.agent_id,
                    "name": a.name,
                    "type": a.agent_type,
                    "purpose": a.purpose,
                    "tools": list(a.tools),
                    "events": list(a.events),
                }
                for a in agents
            ],
        }
    return {
        "total": len(ALL_AGENTS),
        "domains": domains,
        "domain_count": len(DOMAIN_MAP),
    }


@app.get("/api/workforce/events/{event_type}/agents")
async def get_agents_for_event(event_type: str):
    """Get all agents that respond to a specific event type."""
    agents = agents_for_event(event_type)
    return {
        "event_type": event_type,
        "agents": [
            {"id": a.agent_id, "name": a.name, "domain": a.domain, "type": a.agent_type}
            for a in agents
        ],
        "total": len(agents),
    }


# ─── Tools ──────────────────────────────────────────────────────────

@app.get("/api/workforce/tools")
async def list_tools():
    """List all registered tools."""
    registry = get_tool_registry()
    tools = registry.list_tools()
    stats = registry.get_tool_stats()
    return {
        "tools": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "permission": t.permission.value,
                "stats": stats.get(t.id, {}),
            }
            for t in tools
        ],
        "total": len(tools),
    }


@app.get("/api/workforce/tools/executions")
async def list_tool_executions(limit: int = Query(50, ge=1, le=200)):
    """Get recent tool executions."""
    registry = get_tool_registry()
    executions = registry.get_recent_executions(limit)
    return {"executions": [e.model_dump() for e in executions], "count": len(executions)}


# ─── Policy ─────────────────────────────────────────────────────────

@app.get("/api/workforce/policy")
async def get_policy():
    """Get policy engine status and stats."""
    engine = get_policy_engine()
    return {"stats": engine.get_stats(), "audit_log": engine.get_audit_log(50)}


@app.post("/api/workforce/policy/override")
async def set_policy_override(req: PolicyOverrideRequest):
    """Set a manual policy override."""
    engine = get_policy_engine()
    engine.set_override(req.agent_id, req.action, req.allowed, req.reason)
    return {"status": "set", "key": f"{req.agent_id}:{req.action}"}


# ─── Action Ledger ────────────────────────────────────────────────

from voicebox.workforce.action_ledger import get_action_ledger

@app.get("/api/workforce/actions")
async def get_actions(
    limit: int = Query(50, ge=1, le=200),
    worker_id: Optional[str] = None,
):
    """Get real workforce action records — the source of truth."""
    ledger = get_action_ledger()
    if worker_id:
        actions = ledger.get_by_worker(worker_id, limit)
    else:
        actions = ledger.get_recent(limit)
    return {
        "actions": actions,
        "total": len(actions),
        "stats": ledger.get_stats(),
    }


@app.get("/api/workforce/actions/stats")
async def get_action_stats():
    """Get aggregate workforce action statistics."""
    ledger = get_action_ledger()
    return ledger.get_stats()


# ─── Lock Manager ───────────────────────────────────────────────────

from voicebox.workforce.locks import get_lock_manager

@app.get("/api/workforce/locks")
async def get_locks():
    """Get current resource lock status."""
    lock_mgr = get_lock_manager()
    return lock_mgr.get_stats()


# ─── SSE (Server-Sent Events) ──────────────────────────────────────

import json
from fastapi.responses import StreamingResponse

# In-memory event buffer for SSE subscribers (last 100 events)
_sse_buffer: list[dict] = []
_sse_subscribers: list[asyncio.Queue] = []
_SSE_BUFFER_MAX = 100


async def push_sse_event(event: dict):
    """Push an event to all SSE subscribers. Called by event bus hook in lifespan."""
    _sse_buffer.append(event)
    if len(_sse_buffer) > _SSE_BUFFER_MAX:
        _sse_buffer.pop(0)
    dead: list[asyncio.Queue] = []
    for q in list(_sse_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _sse_subscribers.remove(q)


@app.get("/api/workforce/stream")
async def sse_stream():
    """Server-Sent Events stream for real-time admin updates.

    Emits events as they happen: alerts, incidents, task completions,
    agent heartbeats, etc. Clients reconnect automatically.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    _sse_subscribers.append(queue)

    async def event_generator():
        try:
            # Send recent buffered events on connect
            for evt in _sse_buffer[-20:]:
                yield f"event: {evt.get('event_type', 'unknown')}\ndata: {json.dumps(evt)}\n\n"

            # Then stream live events
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"event: {event.get('event_type', 'unknown')}\ndata: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Send heartbeat to keep connection alive
                    yield f"event: heartbeat\ndata: {json.dumps({'ts': datetime.now(timezone.utc).isoformat()})}\n\n"
        finally:
            # Clean up subscriber on disconnect
            if queue in _sse_subscribers:
                _sse_subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/workforce/stream/status")
async def sse_status():
    """Check SSE connection status."""
    return {
        "subscribers": len(_sse_subscribers),
        "buffer_size": len(_sse_buffer),
    }


# ─── Observability ──────────────────────────────────────────────────

@app.get("/api/workforce/metrics")
async def get_metrics():
    """Get workforce metrics for Prometheus."""
    orchestrator = get_orchestrator()
    tools = get_tool_registry()
    policy = get_policy_engine()
    stats = orchestrator.get_stats()

    metrics = {
        "workforce_tasks_total": stats["tasks_received"],
        "workforce_tasks_completed": stats["tasks_completed"],
        "workforce_tasks_failed": stats["tasks_failed"],
        "workforce_tasks_blocked": stats["tasks_blocked"],
        "workforce_tools_registered": len(tools._tools),
        "workforce_tool_executions": sum(
            t.execution_count for t in tools._tools.values()
        ),
        "workforce_policy_decisions": policy.get_stats()["total_decisions"],
        "workforce_policy_blocked": policy.get_stats()["blocked"],
    }
    return metrics


@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus-compatible metrics endpoint."""
    orchestrator = get_orchestrator()
    tools = get_tool_registry()
    stats = orchestrator.get_stats()

    lines = [
        "# HELP voicebox_tasks_total Total tasks received",
        "# TYPE voicebox_tasks_total counter",
        f"voicebox_tasks_total {stats['tasks_received']}",
        "",
        "# HELP voicebox_tasks_completed Total tasks completed",
        "# TYPE voicebox_tasks_completed counter",
        f"voicebox_tasks_completed {stats['tasks_completed']}",
        "",
        "# HELP voicebox_tasks_failed Total tasks failed",
        "# TYPE voicebox_tasks_failed counter",
        f"voicebox_tasks_failed {stats['tasks_failed']}",
        "",
        "# HELP voicebox_tasks_blocked Total tasks blocked by policy",
        "# TYPE voicebox_tasks_blocked counter",
        f"voicebox_tasks_blocked {stats['tasks_blocked']}",
        "",
        "# HELP voicebox_tools_registered Total registered tools",
        "# TYPE voicebox_tools_registered gauge",
        f"voicebox_tools_registered {len(tools._tools)}",
        "",
    ]
    return PlainTextResponse("\n".join(lines))


# ─── Run ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
