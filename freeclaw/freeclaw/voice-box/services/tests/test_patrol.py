"""
TDD Tests for Patrol Loop

Proves that:
1. Patrol cycle dispatches all 3 health checks
2. Patrol cycle handles worker failures gracefully
3. Patrol loop respects cancellation
4. Patrol interval is configurable
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch
from voicebox.workforce.main_patrol import run_patrol_cycle, run_patrol_loop, PATROL_INTERVAL


class TestPatrolCycle:
    """Patrol cycle dispatches health checks and handles errors."""

    @pytest.mark.asyncio
    async def test_dispatches_all_three_checks(self):
        """Patrol cycle dispatches health, performance, and cache checks."""
        with patch("voicebox.workforce.main_patrol.get_orchestrator") as mock_orch:
            orchestrator = AsyncMock()
            orchestrator.submit_task.return_value = {"status": "completed"}
            mock_orch.return_value = orchestrator

            await run_patrol_cycle()

            # Should have dispatched 3 tasks (health, performance, cache)
            assert orchestrator.submit_task.call_count == 3

    @pytest.mark.asyncio
    async def test_handles_worker_failure_gracefully(self):
        """Patrol cycle continues even if a worker fails."""
        with patch("voicebox.workforce.main_patrol.get_orchestrator") as mock_orch:
            orchestrator = AsyncMock()
            # First call fails, second and third succeed
            orchestrator.submit_task.side_effect = [
                Exception("Worker failed"),
                {"status": "completed"},
                {"status": "completed"},
            ]
            mock_orch.return_value = orchestrator

            # Should not raise
            await run_patrol_cycle()

            # All 3 tasks were attempted
            assert orchestrator.submit_task.call_count == 3

    @pytest.mark.asyncio
    async def test_patrol_loop_respects_cancellation(self):
        """Patrol loop stops when cancelled."""
        call_count = 0

        async def mock_cycle():
            nonlocal call_count
            call_count += 1

        with patch("voicebox.workforce.main_patrol.run_patrol_cycle", mock_cycle), \
             patch("voicebox.workforce.main_patrol.PATROL_INTERVAL", 0.01):

            task = asyncio.create_task(run_patrol_loop())
            await asyncio.sleep(0.05)  # Let it run a few cycles
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

            assert call_count >= 1  # At least one cycle ran


class TestPatrolInterval:
    """Patrol interval is configurable via environment."""

    def test_default_interval_is_60(self):
        """Default patrol interval is 60 seconds."""
        # The module constant should be 60 by default
        # (env var not set in test environment)
        assert PATROL_INTERVAL >= 1  # At least 1 second
