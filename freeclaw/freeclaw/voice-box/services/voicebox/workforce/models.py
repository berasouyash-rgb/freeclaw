"""
Pydantic contracts for the Voice Box AI Workforce.

Every entity in the system is defined here with strict typing.
Reject malformed data at the boundary.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ─── Enums ─────────────────────────────────────────────────────────

class TaskStatus(str, Enum):
    CREATED = "created"
    QUEUED = "queued"
    CLAIMED = "claimed"
    RUNNING = "running"
    WAITING = "waiting"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"
    ROLLED_BACK = "rolled_back"


class TaskPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AgentStatus(str, Enum):
    ACTIVE = "active"
    IDLE = "idle"
    WORKING = "working"
    VERIFYING = "verifying"
    PAUSED = "paused"
    INACTIVE = "inactive"
    UNHEALTHY = "unhealthy"


class AgentDomain(str, Enum):
    ORCHESTRATION = "orchestration"
    PERFORMANCE = "performance"
    RELIABILITY = "reliability"
    SECURITY = "security"
    MODERATION = "moderation"
    UX = "ux"
    DATA = "data"
    INFRASTRUCTURE = "infrastructure"
    PRODUCT = "product"
    QUALITY = "quality"


class ToolPermission(str, Enum):
    READ = "read"
    ANALYZE = "analyze"
    RECOMMEND = "recommend"
    WRITE = "write"
    DELETE = "delete"
    SECURITY = "security"
    INFRASTRUCTURE = "infrastructure"


class Severity(str, Enum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    HIGH = "high"
    CRITICAL = "critical"


class VerificationStatus(str, Enum):
    NONE = "none"
    PASSED = "passed"
    FAILED = "failed"
    AWAITING_APPROVAL = "awaiting_approval"


# ─── Core Entities ─────────────────────────────────────────────────

class Agent(BaseModel):
    """A registered workforce agent."""
    id: str
    name: str
    domain: AgentDomain
    type: str = "deterministic"  # deterministic | ai_reasoning | hybrid
    status: AgentStatus = AgentStatus.IDLE
    version: str = "1.0.0"
    capabilities: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    max_concurrent_tasks: int = 1
    current_tasks: int = 0
    heartbeat_interval_s: int = 30
    last_heartbeat: Optional[datetime] = None
    metrics: AgentMetrics = Field(default_factory=lambda: AgentMetrics())


class AgentMetrics(BaseModel):
    """Performance metrics for a single agent."""
    tasks_started: int = 0
    tasks_completed: int = 0
    tasks_failed: int = 0
    tasks_retried: int = 0
    tool_calls: int = 0
    tool_failures: int = 0
    average_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    queue_wait_ms: float = 0.0
    llm_latency_ms: float = 0.0
    llm_cost_usd: float = 0.0
    verification_success: int = 0
    false_positive_rate: float = 0.0
    rollback_rate: float = 0.0




class TaskOutcome(BaseModel):
    """A verified result of a task execution."""
    type: str
    target_id: Optional[str] = None
    count: Optional[int] = None
    status: Optional[str] = None
    verified: bool = False
    evidence: Optional[str] = None
    at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Tool(BaseModel):
    """A registered tool that agents can execute."""
    id: str
    name: str
    description: str
    permission: ToolPermission
    agent_allowlist: Optional[list[str]] = None  # None = all agents
    max_timeout_s: int = 30
    max_retries: int = 2
    requires_approval: bool = False
    execution_count: int = 0
    success_rate: float = 1.0
    last_execution: Optional[datetime] = None


class ToolExecution(BaseModel):
    """Record of a single tool execution."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tool_id: str
    agent_id: str
    task_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    input_data: Optional[dict[str, Any]] = None
    output_data: Optional[dict[str, Any]] = None
    status: str = "pending"  # pending | success | error | timeout
    duration_ms: float = 0.0
    error: Optional[str] = None
    affected_resource: Optional[str] = None
    before_metric: Optional[dict[str, Any]] = None
    after_metric: Optional[dict[str, Any]] = None
    verification_result: Optional[str] = None


class AgentEvent(BaseModel):
    """An event flowing through the event bus."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str
    data: Optional[dict[str, Any]] = None
    source: str = "system"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    processed_by: list[str] = Field(default_factory=list)


class Finding(BaseModel):
    """A finding produced by an agent analysis."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str
    task_id: Optional[str] = None
    severity: Severity
    category: str
    title: str
    description: str
    evidence: Optional[str] = None
    confidence: float = 0.0
    affected_resource: Optional[str] = None
    recommendation: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Incident(BaseModel):
    """An incident tracked by the workforce."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    severity: Severity
    status: str = "open"  # open | investigating | resolved | closed
    source: str = "agent"
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    affected_resources: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    resolution: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: Optional[datetime] = None


class Alert(BaseModel):
    """An alert raised for admin attention."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    severity: Severity
    title: str
    body: Optional[str] = None
    source: str = "agent"
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    key: Optional[str] = None  # dedup key
    evidence: Optional[str] = None
    status: str = "active"  # active | acknowledged | resolved | dismissed
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Heartbeat(BaseModel):
    """Worker liveness signal."""
    agent_id: str
    worker_instance: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: AgentStatus
    current_task_id: Optional[str] = None
    queue_depth: int = 0
    version: str = "1.0.0"


class PolicyDecision(BaseModel):
    """Result of a policy engine evaluation."""
    allowed: bool
    reason: str
    risk_level: RiskLevel
    requires_approval: bool = False
    conditions: list[str] = Field(default_factory=list)


class SystemHealth(BaseModel):
    """Global health score based on actual measurements."""
    score: float  # 0-100
    availability: float = 1.0
    error_rate: float = 0.0
    avg_latency_ms: float = 0.0
    queue_depth: int = 0
    active_workers: int = 0
    total_workers: int = 0
    database_healthy: bool = True
    cache_healthy: bool = True
    security_incidents: int = 0
    failed_jobs: int = 0
    measured_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))




class AgentTask(BaseModel):
    """A unit of work in the task queue."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: Optional[str] = None
    source: str = "system"
    source_ref: Optional[str] = None
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.CREATED
    assigned_agent: Optional[str] = None
    parent_task_id: Optional[str] = None
    required_capability: Optional[str] = None
    risk_level: RiskLevel = RiskLevel.LOW
    input_data: Optional[dict[str, Any]] = None
    output_data: Optional[dict[str, Any]] = None
    outcomes: Optional[list[TaskOutcome]] = None
    error: Optional[str] = None
    verification_status: VerificationStatus = VerificationStatus.NONE
    attempts: int = 0
    max_attempts: int = 3
    created_by: str = "system"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    claimed_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    heartbeat_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


# Forward reference resolution
AgentTask.model_rebuild()
