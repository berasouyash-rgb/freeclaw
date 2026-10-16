"""
Action Ledger — Source of truth for every workforce operation.

Every real operation performed by a worker is recorded here with:
- Before metrics (baseline)
- Action performed
- After metrics (result)
- Verification status
- Rollback reference
- Audit trail

This is NOT a log of "agent thinking" — it is a record of REAL EFFECTS.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .events import get_event_bus

logger = logging.getLogger(__name__)


class ActionRecord:
    """A single recorded workforce action with full audit trail."""

    def __init__(
        self,
        worker_id: str,
        action_type: str,
        target_type: str,
        target_id: str,
        event_id: Optional[str] = None,
    ):
        self.id = f"action_{uuid.uuid4().hex[:16]}"
        self.worker_id = worker_id
        self.action_type = action_type
        self.target_type = target_type
        self.target_id = target_id
        self.event_id = event_id

        self.started_at = datetime.now(timezone.utc)
        self.completed_at: Optional[datetime] = None
        self.duration_ms: float = 0.0

        # Before/after measurement
        self.before_metrics: dict[str, Any] = {}
        self.after_metrics: dict[str, Any] = {}
        self.delta_pct: Optional[float] = None

        # Execution details
        self.tool_used: Optional[str] = None
        self.input_evidence: dict[str, Any] = {}
        self.decision: str = ""
        self.execution_result: dict[str, Any] = {}
        self.execution_status: str = "pending"  # pending | success | failed | rolled_back

        # Verification
        self.verification_status: str = "none"  # none | passed | failed | pending
        self.verification_result: Optional[dict[str, Any]] = None

        # Risk & rollback
        self.risk_level: str = "low"
        self.rollback_available: bool = False
        self.rollback_reference: Optional[str] = None
        self.rollback_data: Optional[dict[str, Any]] = None

        # Error tracking
        self.error: Optional[str] = None

    def set_before(self, metrics: dict[str, Any]):
        """Capture baseline metrics before action."""
        self.before_metrics = metrics

    def set_after(self, metrics: dict[str, Any]):
        """Capture result metrics after action."""
        self.after_metrics = metrics
        # Calculate delta for key numeric metrics
        for key in metrics:
            if key in self.before_metrics:
                before_val = self.before_metrics[key]
                after_val = metrics[key]
                if isinstance(before_val, (int, float)) and isinstance(after_val, (int, float)):
                    if before_val > 0:
                        self.delta_pct = round((after_val - before_val) / before_val * 100, 1)

    def set_rollback(self, reference: str, data: dict[str, Any]):
        """Store rollback information."""
        self.rollback_available = True
        self.rollback_reference = reference
        self.rollback_data = data

    def complete(self, result: dict[str, Any], status: str = "success"):
        """Mark action as completed."""
        self.completed_at = datetime.now(timezone.utc)
        self.duration_ms = (self.completed_at - self.started_at).total_seconds() * 1000
        self.execution_result = result
        self.execution_status = status

    def verify(self, passed: bool, result: Optional[dict[str, Any]] = None):
        """Record verification result."""
        self.verification_status = "passed" if passed else "failed"
        self.verification_result = result or {}

    def fail(self, error: str):
        """Mark action as failed."""
        self.completed_at = datetime.now(timezone.utc)
        self.duration_ms = (self.completed_at - self.started_at).total_seconds() * 1000
        self.execution_status = "failed"
        self.error = error

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "worker_id": self.worker_id,
            "action_type": self.action_type,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "event_id": self.event_id,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_ms": round(self.duration_ms, 1),
            "before_metrics": self.before_metrics,
            "after_metrics": self.after_metrics,
            "delta_pct": self.delta_pct,
            "tool_used": self.tool_used,
            "input_evidence": self.input_evidence,
            "decision": self.decision,
            "execution_result": self.execution_result,
            "execution_status": self.execution_status,
            "verification_status": self.verification_status,
            "verification_result": self.verification_result,
            "risk_level": self.risk_level,
            "rollback_available": self.rollback_available,
            "rollback_reference": self.rollback_reference,
            "rollback_data": self.rollback_data,
            "rollback_reference": self.rollback_reference,
            "error": self.error,
        }


class ActionLedger:
    """
    Central ledger that records all workforce operations.

    This is the source of truth for:
    - What the workforce actually did
    - What the state was before and after
    - Whether the action was verified
    - Whether rollback is available

    Never fabricate entries.
    """

    def __init__(self):
        self._actions: list[ActionRecord] = []
        self._by_worker: dict[str, list[ActionRecord]] = {}
        self._by_target: dict[str, list[ActionRecord]] = {}
        self._stats = {
            "total_actions": 0,
            "successful": 0,
            "failed": 0,
            "rolled_back": 0,
            "verified": 0,
            "verification_failed": 0,
        }

    def record(self, action: ActionRecord):
        """Record a completed action."""
        self._actions.append(action)
        self._by_worker.setdefault(action.worker_id, []).append(action)
        self._by_target.setdefault(f"{action.target_type}:{action.target_id}", []).append(action)

        self._stats["total_actions"] += 1
        if action.execution_status == "success":
            self._stats["successful"] += 1
        elif action.execution_status == "failed":
            self._stats["failed"] += 1
        elif action.execution_status == "rolled_back":
            self._stats["rolled_back"] += 1

        if action.verification_status == "passed":
            self._stats["verified"] += 1
        elif action.verification_status == "failed":
            self._stats["verification_failed"] += 1

        # Trim to last 10000 actions
        if len(self._actions) > 10000:
            self._actions = self._actions[-10000:]

        logger.info(
            f"[ActionLedger] {action.worker_id}: {action.action_type} "
            f"on {action.target_type}/{action.target_id} — "
            f"{action.execution_status} ({action.duration_ms:.0f}ms) "
            f"verified={action.verification_status}"
        )

    def get_recent(self, limit: int = 50) -> list[dict[str, Any]]:
        """Get recent actions."""
        return [a.to_dict() for a in self._actions[-limit:]]

    def get_by_worker(self, worker_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Get actions by a specific worker."""
        actions = self._by_worker.get(worker_id, [])
        return [a.to_dict() for a in actions[-limit:]]

    def get_by_target(self, target_type: str, target_id: str) -> list[dict[str, Any]]:
        """Get actions on a specific target."""
        key = f"{target_type}:{target_id}"
        return [a.to_dict() for a in self._by_target.get(key, [])]

    def get_stats(self) -> dict[str, Any]:
        """Get aggregate ledger stats."""
        # Calculate real impact metrics
        improvements = []
        for a in self._actions:
            if a.delta_pct is not None and a.execution_status == "success":
                improvements.append({
                    "worker": a.worker_id,
                    "action": a.action_type,
                    "target": f"{a.target_type}/{a.target_id}",
                    "delta_pct": a.delta_pct,
                    "before": a.before_metrics,
                    "after": a.after_metrics,
                    "verified": a.verification_status == "passed",
                })

        return {
            **self._stats,
            "improvements": improvements[-20:],  # last 20 improvements
            "actions_today": sum(
                1 for a in self._actions
                if a.started_at.date() == datetime.now(timezone.utc).date()
            ),
        }

    def has_recent_action(self, target_type: str, target_id: str, within_seconds: int = 60) -> bool:
        """Check if a target was recently acted upon (prevents duplicate actions)."""
        key = f"{target_type}:{target_id}"
        recent = self._by_target.get(key, [])
        now = datetime.now(timezone.utc)
        for a in reversed(recent):
            if a.started_at and (now - a.started_at).total_seconds() < within_seconds:
                return True
        return False


# ─── Singleton ──────────────────────────────────────────────────────

_ledger: Optional[ActionLedger] = None


def get_action_ledger() -> ActionLedger:
    global _ledger
    if _ledger is None:
        _ledger = ActionLedger()
    return _ledger
