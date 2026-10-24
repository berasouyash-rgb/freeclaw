"""
AI Reasoning Agents — LLM-powered agents for complex analysis.

These agents use language models for reasoning tasks that deterministic
workers cannot handle: nuanced classification, root cause analysis,
strategic recommendations.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

from .events import get_event_bus
from .models import AgentTask, Finding, Severity
from .tools import get_tool_registry

logger = logging.getLogger(__name__)


class AIReasoningAgent:
    """Base class for LLM-powered reasoning agents."""

    def __init__(self, agent_id: str, name: str, domain: str):
        self.agent_id = agent_id
        self.name = name
        self.domain = domain
        self._llm_client = None

    async def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        """
        Call the LLM. Uses the platform's existing provider chain.
        Falls back to a deterministic response if LLM is unavailable.
        """
        try:
            import httpx
            # Platform AI endpoint — configurable for Docker/prod where
            # localhost:3000 is wrong. Set WORKFORCE_AI_URL to the real URL.
            ai_url = os.getenv("WORKFORCE_AI_URL", "http://localhost:3000/api/ai")
            # Try the platform's AI endpoint first
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    ai_url,
                    json={
                        "action": "analyze",
                        "system": system_prompt,
                        "user": user_prompt,
                    },
                    headers={"Content-Type": "application/json"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("text", data.get("reply", ""))
        except Exception as e:
            logger.warning(f"[{self.agent_id}] LLM call failed: {e}")

        # Fallback: return structured analysis without LLM
        return json.dumps({
            "analysis": "LLM unavailable — deterministic fallback",
            "confidence": 0.5,
            "recommendation": "Manual review recommended",
            "fallback": True,
        })

    async def execute(self, task: AgentTask) -> dict[str, Any]:
        """Execute a reasoning task. Override in subclass."""
        raise NotImplementedError


# ─── Agent 1: Exception Analyzer ───────────────────────────────────

class ExceptionAnalyzerAgent(AIReasoningAgent):
    """Analyzes error patterns and identifies root causes."""

    def __init__(self):
        super().__init__("exception-analyzer", "Exception Analyzer", "reliability")

    async def execute(self, task: AgentTask) -> dict[str, Any]:
        tools = get_tool_registry()
        input_data = task.input_data or {}

        # Collect evidence
        errors_exec = await tools.execute(
            "read_error_log", self.agent_id, task.id, {}
        )
        metrics_exec = await tools.execute(
            "read_service_metrics", self.agent_id, task.id, {}
        )

        errors = errors_exec.output_data or {}
        metrics = metrics_exec.output_data or {}

        # LLM analysis of error patterns
        analysis_prompt = f"""Analyze these error patterns and identify root causes:

Errors: {json.dumps(errors, indent=2)}
Metrics: {json.dumps(metrics, indent=2)}

Provide:
1. Root cause hypothesis
2. Confidence level (0-1)
3. Recommended action
4. Whether this is a regression or new issue"""

        llm_response = await self._call_llm(
            "You are an expert error analyst for a web platform.",
            analysis_prompt,
        )

        try:
            analysis = json.loads(llm_response)
        except (json.JSONDecodeError, TypeError):
            analysis = {"analysis": llm_response, "confidence": 0.5}

        # Record finding
        await tools.execute(
            "record_finding", self.agent_id, task.id,
            {
                "category": "exception_analysis",
                "title": f"Exception analysis: {errors.get('top_errors', [{}])[0].get('message', 'unknown')}",
                "evidence": json.dumps(errors),
                "confidence": analysis.get("confidence", 0.5),
            },
        )

        return {
            "analysis": analysis,
            "errors": errors,
            "metrics": metrics,
        }


# ─── Agent 2: Incident Correlator ─────────────────────────────────

class IncidentCorrelatorAgent(AIReasoningAgent):
    """Correlates multiple signals into coherent incidents."""

    def __init__(self):
        super().__init__("incident-correlator", "Incident Correlator", "reliability")

    async def execute(self, task: AgentTask) -> dict[str, Any]:
        tools = get_tool_registry()
        input_data = task.input_data or {}

        # Gather evidence from multiple sources
        health_exec = await tools.execute(
            "get_system_health", self.agent_id, task.id, {}
        )
        errors_exec = await tools.execute(
            "read_error_log", self.agent_id, task.id, {}
        )

        health = health_exec.output_data or {}
        errors = errors_exec.output_data or {}

        # Correlate signals
        signals = []
        if health.get("score", 100) < 80:
            signals.append("system_health_degraded")
        if errors.get("errors_last_hour", 0) > 3:
            signals.append("error_spike")
        if not health.get("database_healthy", True):
            signals.append("database_issue")
        if not health.get("cache_healthy", True):
            signals.append("cache_issue")

        # Determine incident severity
        severity = "info"
        if len(signals) >= 3:
            severity = "critical"
        elif len(signals) >= 2:
            severity = "high"
        elif len(signals) >= 1:
            severity = "warning"

        # LLM correlation analysis
        analysis_prompt = f"""Correlate these system signals into an incident assessment:

Signals detected: {signals}
Health score: {health.get('score', 'unknown')}
Error count: {errors.get('errors_last_hour', 0)}

Is this a coordinated incident or isolated issues?"""

        llm_response = await self._call_llm(
            "You are an incident correlation expert.",
            analysis_prompt,
        )

        try:
            analysis = json.loads(llm_response)
        except (json.JSONDecodeError, TypeError):
            analysis = {"assessment": llm_response}

        return {
            "signals": signals,
            "severity": severity,
            "analysis": analysis,
            "health": health,
        }


# ─── Agent 3: Feedback Analyzer ───────────────────────────────────

class FeedbackAnalyzerAgent(AIReasoningAgent):
    """Analyzes user feedback for actionable insights."""

    def __init__(self):
        super().__init__("feedback-analyzer", "Feedback Analyzer", "product")

    async def execute(self, task: AgentTask) -> dict[str, Any]:
        tools = get_tool_registry()
        input_data = task.input_data or {}
        content = input_data.get("content", "")

        # Analyze feedback content
        analysis_prompt = f"""Analyze this user feedback for actionable insights:

"{content}"

Categorize:
1. Issue type (bug, feature request, complaint, praise)
2. Sentiment (positive, neutral, negative)
3. Urgency (low, medium, high)
4. Suggested action"""

        llm_response = await self._call_llm(
            "You are a product feedback analyst for a school feedback platform.",
            analysis_prompt,
        )

        try:
            analysis = json.loads(llm_response)
        except (json.JSONDecodeError, TypeError):
            analysis = {"analysis": llm_response}

        return {"feedback_analysis": analysis}


# ─── Agent 4: Query Optimization Agent ─────────────────────────────

class QueryOptimizationAgent(AIReasoningAgent):
    """Analyzes database queries and recommends optimizations."""

    def __init__(self):
        super().__init__("query-optimizer", "Query Optimization Agent", "data")

    async def execute(self, task: AgentTask) -> dict[str, Any]:
        tools = get_tool_registry()
        input_data = task.input_data or {}
        query = input_data.get("query", "")

        # Analyze query
        plan_exec = await tools.execute(
            "analyze_query_plan", self.agent_id, task.id,
            {"query": query},
        )
        plan = plan_exec.output_data or {}

        # LLM optimization recommendation
        analysis_prompt = f"""Analyze this database query and recommend optimizations:

Query: {query}
Execution Plan: {plan.get('plan', 'unknown')}
Estimated Time: {plan.get('estimated_ms', 'unknown')}ms

Recommend:
1. Index additions
2. Query restructuring
3. Whether this is a safe change"""

        llm_response = await self._call_llm(
            "You are a PostgreSQL performance expert.",
            analysis_prompt,
        )

        try:
            analysis = json.loads(llm_response)
        except (json.JSONDecodeError, TypeError):
            analysis = {"recommendation": llm_response}

        return {
            "query_plan": plan,
            "optimization": analysis,
        }


# ─── Agent 5: Deployment Safety Agent ──────────────────────────────

class DeploymentSafetyAgent(AIReasoningAgent):
    """Evaluates deployment safety and detects regressions."""

    def __init__(self):
        super().__init__("deployment-safety", "Deployment Safety Agent", "quality")

    async def execute(self, task: AgentTask) -> dict[str, Any]:
        tools = get_tool_registry()

        # Collect pre/post deployment metrics
        health_exec = await tools.execute(
            "get_system_health", self.agent_id, task.id, {}
        )
        metrics_exec = await tools.execute(
            "read_service_metrics", self.agent_id, task.id, {}
        )

        health = health_exec.output_data or {}
        metrics = metrics_exec.output_data or {}

        # Assess deployment safety
        issues = []
        if health.get("score", 100) < 85:
            issues.append(f"Health score degraded: {health['score']}")
        if metrics.get("error_rate", 0) > 0.005:
            issues.append(f"Elevated error rate: {metrics['error_rate']:.2%}")
        if metrics.get("api_latency_p95_ms", 0) > 500:
            issues.append(f"High p95 latency: {metrics['api_latency_p95_ms']}ms")

        safe = len(issues) == 0

        return {
            "deployment_safe": safe,
            "issues": issues,
            "health": health,
            "metrics": metrics,
        }


# ─── Agent Registry ────────────────────────────────────────────────

ALL_AI_AGENTS: list[AIReasoningAgent] = [
    ExceptionAnalyzerAgent(),
    IncidentCorrelatorAgent(),
    FeedbackAnalyzerAgent(),
    QueryOptimizationAgent(),
    DeploymentSafetyAgent(),
]

AI_AGENT_MAP: dict[str, AIReasoningAgent] = {a.agent_id: a for a in ALL_AI_AGENTS}
