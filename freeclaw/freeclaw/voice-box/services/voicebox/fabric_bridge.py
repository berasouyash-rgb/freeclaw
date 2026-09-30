"""
Voice Box ↔ NVIDIA NeMo Fabric bridge (consumer integration).

Translates Voice Box workforce jobs into in-memory FabricConfig objects and
runs them through NeMo Fabric's typed Python SDK (public `nemo_fabric`
symbols only — never `_native` or adapter internals).

Design (per NeMo Fabric integration contract):
- Environment owns installation (`pip install "nemo-fabric[deepagents]"`)
  and credentials (`NVIDIA_API_KEY`). This module never installs anything.
- Smallest lifecycle: single invocation per call. No retries here — the
  caller owns retry policy. No harness/thread management — Fabric owns it.
- `plan()` is credential-free (CI-safe gate); `doctor()` needs the env.
- Every result is normalized: branch on `status`, never on output presence.
- If `nemo_fabric` is not installed, helpers raise FabricUnavailable and the
  API layer answers 503 honestly — the legacy direct-NIM path keeps working.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Optional

try:
    from nemo_fabric import (
        Fabric,
        FabricConfig,
        FabricError,
        HarnessConfig,
        InstructionsConfig,
        InstructionConfig,
        MetadataConfig,
        ModelConfig,
        RuntimeConfig,
        ToolsConfig,
    )

    _HAS_FABRIC = True
except ImportError:  # pragma: no cover - environment without nemo-fabric
    _HAS_FABRIC = False

FABRIC_ADAPTER_ID = "nvidia.fabric.langchain.deepagents"
FABRIC_BASE_URL = "https://integrate.api.nvidia.com/v1"
FABRIC_MODEL = os.getenv("FABRIC_MODEL", "openai/gpt-oss-20b")
FABRIC_API_KEY_ENV = "NVIDIA_API_KEY"


class FabricUnavailable(RuntimeError):
    """nemo-fabric is not installed in this environment."""


def _require_fabric() -> None:
    if not _HAS_FABRIC:
        raise FabricUnavailable(
            'nemo-fabric is not installed. Install it with: pip install "nemo-fabric[deepagents]"'
        )


@dataclass
class VoiceBoxFabricJob:
    """Consumer-owned job description. Translated 1:1 into FabricConfig."""

    name: str
    system_instruction: Optional[str] = None
    timeout_seconds: int = 120
    max_turns: int = 3
    model: str = FABRIC_MODEL
    enabled_tools: Optional[list[str]] = None
    blocked_tools: list[str] = field(default_factory=list)


def to_fabric_config(job: VoiceBoxFabricJob) -> "FabricConfig":
    """Build the typed in-memory config. Public symbols only."""
    _require_fabric()
    enabled = job.enabled_tools
    tools = None
    if enabled is not None or job.blocked_tools:
        tools = ToolsConfig(
            enabled=None if enabled is None else list(enabled),
            blocked=list(job.blocked_tools),
        )
    return FabricConfig(
        metadata=MetadataConfig(name=job.name),
        harness=HarnessConfig(
            adapter_id=FABRIC_ADAPTER_ID, resolution="preinstalled"
        ),
        models={
            "default": ModelConfig(
                provider="nvidia",
                model=job.model,
                api_key_env=FABRIC_API_KEY_ENV,
                base_url=FABRIC_BASE_URL,
            )
        },
        instructions=(
            InstructionsConfig(
                system=InstructionConfig(content=job.system_instruction, mode="append"),
            )
            if job.system_instruction
            else None
        ),
        runtime=RuntimeConfig(
            input_schema="chat",
            output_schema="message",
            timeout_seconds=job.timeout_seconds,
            max_turns=job.max_turns,
        ),
        tools=tools,
    )


def plan_job(job: VoiceBoxFabricJob, base_dir: str) -> dict[str, Any]:
    """Credential-free gate: adapter selection + capability routing."""
    _require_fabric()
    plan = Fabric().plan(to_fabric_config(job), base_dir=base_dir)
    return {
        "adapter_id": plan.adapter.adapter_id,
        "ok": True,
    }


async def check_job(job: VoiceBoxFabricJob, base_dir: str) -> dict[str, Any]:
    """Preflight: plan + doctor aggregate (needs provisioned env)."""
    _require_fabric()
    config = to_fabric_config(job)
    plan = Fabric().plan(config, base_dir=base_dir)
    report = await Fabric().doctor(config, base_dir=base_dir)
    return {
        "adapter_id": plan.adapter.adapter_id,
        "status": report.status,
        "checks": [
            {
                "name": getattr(c, "name", str(c)),
                "status": getattr(c, "status", ""),
                "message": str(getattr(c, "message", getattr(c, "detail", "")))[:300],
            }
            for c in (report.checks or [])
        ],
    }


def _result_to_dict(result: Any) -> dict[str, Any]:
    d = result.to_dict() if hasattr(result, "to_dict") else {}
    out = d.get("output") or {}
    response = out.get("response") if isinstance(out, dict) else None
    if response is None and isinstance(out, dict):
        msgs = out.get("messages") or []
        ai_msgs = [m for m in msgs if isinstance(m, dict) and m.get("role") == "ai"]
        response = ai_msgs[-1].get("content") if ai_msgs else None
    return {
        "status": result.status,
        "response": response,
        "artifacts": d.get("artifacts"),
        "telemetry": d.get("telemetry"),
        "error": d.get("error"),
        "events": d.get("events"),
    }


async def run_agent(
    job: VoiceBoxFabricJob, user_input: str, base_dir: str
) -> dict[str, Any]:
    """Single invocation: full start → invoke → stop cycle, normalized result.

    Raises FabricUnavailable (no package) or FabricError subclasses
    (lifecycle failures). Never retries — caller owns that policy.
    """
    _require_fabric()
    try:
        result = await Fabric().run(
            to_fabric_config(job), base_dir=base_dir, input=user_input
        )
    except Exception as e:
        if _HAS_FABRIC and isinstance(e, FabricError):
            raise
        raise FabricUnavailable(str(e)) from e
    return _result_to_dict(result)
