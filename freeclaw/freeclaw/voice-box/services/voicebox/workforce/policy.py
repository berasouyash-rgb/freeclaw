"""
Policy Engine — Safety gates for all autonomous agent actions.

Every proposed action goes through:
  agent permission
  + resource permission
  + risk level
  + action type
  + environment
  + confidence
  = allowed / blocked / escalated

Nothing bypasses this layer.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from .models import (
    AgentTask,
    PolicyDecision,
    RiskLevel,
    ToolPermission,
)

logger = logging.getLogger(__name__)


# ─── Policy Rules ───────────────────────────────────────────────────

# Actions that require admin approval (never autonomous)
REQUIRES_APPROVAL = {
    "ban_user",
    "unban_user",
    "delete_post",
    "delete_comment",
    "modify_schema",
    "rotate_credentials",
    "change_rls_policy",
    "disable_agent",
}

# Actions that are always autonomous (safe read/analyze)
AUTONOMOUS_SAFE = {
    "read_metrics",
    "read_logs",
    "analyze_query",
    "read_cache",
    "read_database",
    "read_error_log",
    "check_reports",
    "check_spam",
    "analyze_content",
    "detect_duplicates",
    "get_health",
    "verify_fix",
    "record_finding",
    "create_alert",
    "update_cache_ttl",
    "warm_cache",
    "invalidate_cache",
}

# Agent domain → allowed action domains (least privilege)
DOMAIN_PERMISSIONS = {
    "performance": {"read_metrics", "analyze_query", "optimize_cache", "recommend_index", "performance_monitoring", "read_service_metrics", "read_cache_metrics", "read_database_metrics", "verify_fix", "cache_optimization"},
    "reliability": {"read_logs", "read_metrics", "create_incident", "record_finding", "error_detection", "exception_analysis", "incident_correlation", "read_error_log", "get_system_health"},
    "security": {"read_logs", "check_spam", "check_reports", "analyze_content", "ban_user", "create_alert", "spam_detection", "vulnerability_scanning"},
    "moderation": {"read_reports", "check_content", "hide_post", "flag_content", "resolve_report", "content_risk", "content_moderation", "report_triage", "duplicate_detection", "check_user_reports", "analyze_content_risk", "detect_duplicates", "process_report"},
    "data": {"read_database", "analyze_query", "recommend_index", "cleanup_data", "database_performance", "query_optimization", "analyze_query_plan"},
    "infrastructure": {"read_metrics", "read_cache", "optimize_cache", "get_health", "system_health", "cache_optimization"},
    "product": {"analyze_content", "detect_duplicates", "record_finding", "feedback_analysis"},
    "quality": {"read_logs", "get_health", "verify_fix", "record_finding", "verification", "deployment_safety"},
    "orchestration": set(AUTONOMOUS_SAFE),  # orchestrator can read anything
}


class PolicyEngine:
    """
    Evaluates whether an agent action is allowed based on:
    - Agent permissions
    - Tool permissions
    - Risk level
    - Action type
    - Confidence
    """

    def __init__(self):
        self._overrides: dict[str, PolicyDecision] = {}
        self._audit_log: list[dict] = []

    def evaluate(
        self,
        agent_id: str,
        agent_domain: str,
        action: str,
        risk_level: RiskLevel = RiskLevel.LOW,
        confidence: float = 1.0,
        tool_permission: Optional[ToolPermission] = None,
        resource: Optional[str] = None,
        environment: str = "production",
    ) -> PolicyDecision:
        """
        Evaluate whether an action is allowed.
        Returns a PolicyDecision with allowed/blocked/escalated.
        """
        conditions = []

        # 1. Check for manual overrides FIRST (highest priority)
        override_key = f"{agent_id}:{action}"
        if override_key in self._overrides:
            decision = self._overrides[override_key]
            conditions.append(f"Manual override: {decision.reason}")
            self._log_decision(agent_id, action, decision)
            return decision

        # 2. Check if action requires approval
        if action in REQUIRES_APPROVAL:
            conditions.append(f"Action '{action}' requires admin approval")
            decision = PolicyDecision(
                allowed=False,
                reason=f"Action '{action}' requires admin approval",
                risk_level=risk_level,
                requires_approval=True,
                conditions=conditions,
            )
            self._log_decision(agent_id, action, decision)
            return decision

        # 3. Check domain permissions
        allowed_actions = DOMAIN_PERMISSIONS.get(agent_domain, set())
        if action not in allowed_actions and action not in AUTONOMOUS_SAFE:
            conditions.append(f"Domain '{agent_domain}' not authorized for '{action}'")
            decision = PolicyDecision(
                allowed=False,
                reason=f"Domain '{agent_domain}' not authorized for '{action}'",
                risk_level=risk_level,
                conditions=conditions,
            )
            self._log_decision(agent_id, action, decision)
            return decision

        # 3. Risk-based gating
        if risk_level == RiskLevel.CRITICAL:
            conditions.append("Critical risk requires human review")
            decision = PolicyDecision(
                allowed=False,
                reason="Critical risk requires human review",
                risk_level=risk_level,
                requires_approval=True,
                conditions=conditions,
            )
            self._log_decision(agent_id, action, decision)
            return decision

        if risk_level == RiskLevel.HIGH and confidence < 0.9:
            conditions.append(f"High risk with low confidence ({confidence:.0%})")
            decision = PolicyDecision(
                allowed=False,
                reason=f"High risk with insufficient confidence ({confidence:.0%})",
                risk_level=risk_level,
                requires_approval=True,
                conditions=conditions,
            )
            self._log_decision(agent_id, action, decision)
            return decision

        # 4. Environment gating
        if environment == "production" and risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL):
            conditions.append("Production environment + high risk")
            decision = PolicyDecision(
                allowed=False,
                reason="High-risk action not allowed in production without approval",
                risk_level=risk_level,
                requires_approval=True,
                conditions=conditions,
            )
            self._log_decision(agent_id, action, decision)
            return decision

        # 5. Check for manual overrides
        override_key = f"{agent_id}:{action}"
        if override_key in self._overrides:
            decision = self._overrides[override_key]
            conditions.append(f"Manual override: {decision.reason}")
            self._log_decision(agent_id, action, decision)
            return decision

        # 6. Default: allowed
        decision = PolicyDecision(
            allowed=True,
            reason="Policy check passed",
            risk_level=risk_level,
            conditions=conditions,
        )
        self._log_decision(agent_id, action, decision)
        return decision

    def set_override(
        self,
        agent_id: str,
        action: str,
        allowed: bool,
        reason: str,
    ):
        """Set a manual policy override for a specific agent+action."""
        key = f"{agent_id}:{action}"
        self._overrides[key] = PolicyDecision(
            allowed=allowed,
            reason=reason,
            risk_level=RiskLevel.LOW,
        )
        logger.info(f"[Policy] Override set: {key} → {'ALLOWED' if allowed else 'BLOCKED'}")

    def remove_override(self, agent_id: str, action: str):
        """Remove a manual policy override."""
        key = f"{agent_id}:{action}"
        self._overrides.pop(key, None)

    def _log_decision(self, agent_id: str, action: str, decision: PolicyDecision):
        """Log a policy decision for audit."""
        entry = {
            "agent_id": agent_id,
            "action": action,
            "allowed": decision.allowed,
            "reason": decision.reason,
            "risk_level": decision.risk_level.value,
            "requires_approval": decision.requires_approval,
            "conditions": decision.conditions,
        }
        self._audit_log.append(entry)
        if len(self._audit_log) > 5000:
            self._audit_log = self._audit_log[-5000:]

        if not decision.allowed:
            logger.warning(
                f"[Policy] BLOCKED: {agent_id} → {action} "
                f"(reason: {decision.reason})"
            )

    def get_audit_log(self, limit: int = 100) -> list[dict]:
        """Get recent policy decisions."""
        return self._audit_log[-limit:]

    def get_stats(self) -> dict:
        """Get policy decision statistics."""
        total = len(self._audit_log)
        allowed = sum(1 for e in self._audit_log if e["allowed"])
        blocked = total - allowed
        return {
            "total_decisions": total,
            "allowed": allowed,
            "blocked": blocked,
            "allow_rate": allowed / total if total > 0 else 1.0,
        }


# ─── Singleton ──────────────────────────────────────────────────────

_engine: Optional[PolicyEngine] = None


def get_policy_engine() -> PolicyEngine:
    global _engine
    if _engine is None:
        _engine = PolicyEngine()
    return _engine
