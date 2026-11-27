"""NeMo Fabric bridge tests — plan is the credential-free CI gate."""

import os

import pytest

pytest.importorskip("nemo_fabric")

from voicebox.fabric_bridge import (
    FABRIC_ADAPTER_ID,
    VoiceBoxFabricJob,
    plan_job,
    to_fabric_config,
)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_config_translates_consumer_job():
    cfg = to_fabric_config(
        VoiceBoxFabricJob(
            name="test-job",
            system_instruction="Be brief.",
            blocked_tools=["shell"],
        )
    )
    assert cfg.metadata.name == "test-job"
    assert cfg.harness.adapter_id == FABRIC_ADAPTER_ID
    assert cfg.models["default"].api_key_env == "NVIDIA_API_KEY"
    assert cfg.models["default"].base_url.startswith("https://")
    assert cfg.tools.blocked == ["shell"]


def test_plan_selects_deepagents_adapter():
    out = plan_job(VoiceBoxFabricJob(name="plan-probe"), BASE)
    assert out["ok"] is True
    assert out["adapter_id"] == FABRIC_ADAPTER_ID
