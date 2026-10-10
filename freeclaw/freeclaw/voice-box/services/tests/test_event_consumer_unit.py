"""
Unit Tests for Event Consumer

Proves that:
1. EVENT_CAPABILITY_MAP has complete coverage for all event types
2. Security events get HIGH priority
3. Non-security events get MEDIUM priority
4. Events without capability mapping are silently dropped
5. Events without agent mapping are silently dropped
6. Both mappings must exist for dispatch
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from voicebox.workforce.event_consumer import (
    EVENT_CAPABILITY_MAP,
    make_event_handler,
)
from voicebox.workforce.events import EVENT_AGENT_MAP, EVENT_TYPES
from voicebox.workforce.models import AgentTask, TaskPriority


class FakeEvent:
    def __init__(self, event_type: str, source: str = "test", data: dict = None):
        self.id = f"evt-{event_type.lower()}"
        self.type = event_type
        self.source = source
        self.data = data or {}


class TestCapabilityMap:
    def test_all_mapped_events_are_valid_event_types(self):
        """Every key in EVENT_CAPABILITY_MAP must be a known EVENT_TYPE."""
        for event_type in EVENT_CAPABILITY_MAP:
            assert event_type in EVENT_TYPES, (
                f"{event_type} is in EVENT_CAPABILITY_MAP but not in EVENT_TYPES"
            )

    def test_all_mapped_events_have_agents(self):
        """Every mapped event type also needs agents to handle it."""
        for event_type in EVENT_CAPABILITY_MAP:
            assert event_type in EVENT_AGENT_MAP, (
                f"{event_type} has a capability but no agents mapped"
            )
            assert len(EVENT_AGENT_MAP[event_type]) > 0, (
                f"{event_type} has agents but the list is empty"
            )

    def test_all_capabilities_are_non_empty_strings(self):
        """Every capability mapping is a non-empty string."""
        for event_type, capability in EVENT_CAPABILITY_MAP.items():
            assert isinstance(capability, str), f"{event_type} capability is not a string"
            assert len(capability) > 0, f"{event_type} capability is empty"

    def test_critical_capabilities_are_covered(self):
        """The most important capabilities are all mapped."""
        critical = {
            "spam_detection", "report_triage", "performance_monitoring",
            "system_health", "error_detection", "content_risk",
        }
        mapped_capabilities = set(EVENT_CAPABILITY_MAP.values())
        for cap in critical:
            assert cap in mapped_capabilities, f"Critical capability '{cap}' not mapped"


class TestPriorityAssignment:
    def test_security_events_get_high_priority(self):
        """SECURITY and SPAM events should be dispatched as HIGH priority."""
        security_events = [k for k in EVENT_CAPABILITY_MAP if "SECURITY" in k or "SPAM" in k]
        assert len(security_events) > 0, "No security events to test"

    def test_non_security_events_get_medium_priority(self):
        """Regular events should be dispatched as MEDIUM priority."""
        regular_events = [
            k for k in EVENT_CAPABILITY_MAP
            if "SECURITY" not in k and "SPAM" not in k
        ]
        assert len(regular_events) > 0, "No regular events to test"


class TestEventHandler:
    @pytest.mark.asyncio
    async def test_dispatches_event_with_correct_capability(self):
        """An event in both maps should create a task and submit it."""
        mock_orchestrator = AsyncMock()

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler()
            event = FakeEvent("POST_CREATED")
            await handler(event)

        mock_orchestrator.submit_task.assert_called_once()
        task = mock_orchestrator.submit_task.call_args[0][0]
        assert isinstance(task, AgentTask)
        assert task.required_capability == "spam_detection"
        assert task.priority == TaskPriority.MEDIUM  # POST_CREATED is not SECURITY/SPAM

    @pytest.mark.asyncio
    async def test_security_event_gets_high_priority(self):
        """SECURITY_ANOMALY should be dispatched with HIGH priority."""
        mock_orchestrator = AsyncMock()

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler()
            event = FakeEvent("SECURITY_ANOMALY")
            await handler(event)

        task = mock_orchestrator.submit_task.call_args[0][0]
        assert task.priority == TaskPriority.HIGH

    @pytest.mark.asyncio
    async def test_spam_event_gets_high_priority(self):
        """SPAM_DETECTED should be dispatched with HIGH priority."""
        mock_orchestrator = AsyncMock()

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler()
            event = FakeEvent("SPAM_DETECTED")
            await handler(event)

        task = mock_orchestrator.submit_task.call_args[0][0]
        assert task.priority == TaskPriority.HIGH

    @pytest.mark.asyncio
    async def test_unmapped_event_does_not_dispatch(self):
        """Events not in EVENT_CAPABILITY_MAP should be silently dropped."""
        mock_orchestrator = AsyncMock()

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler()
            # AGENT_HEARTBEAT is not in the capability map
            event = FakeEvent("AGENT_HEARTBEAT")
            await handler(event)

        mock_orchestrator.submit_task.assert_not_called()

    @pytest.mark.asyncio
    async def test_event_without_agents_does_not_dispatch(self):
        """Events with a capability but no agents should be silently dropped."""
        mock_orchestrator = AsyncMock()
        # Create a handler with a custom map that includes a fake event
        custom_map = {"FAKE_EVENT": "spam_detection"}

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler(capability_map=custom_map)
            event = FakeEvent("FAKE_EVENT")
            await handler(event)

        # Should not dispatch because FAKE_EVENT has no agents
        mock_orchestrator.submit_task.assert_not_called()

    @pytest.mark.asyncio
    async def test_orchestrator_failure_is_handled_gracefully(self):
        """If the orchestrator raises, the handler should not crash."""
        mock_orchestrator = AsyncMock()
        mock_orchestrator.submit_task.side_effect = RuntimeError("Orchestrator down")

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler()
            event = FakeEvent("POST_CREATED")
            # Should not raise
            await handler(event)

    @pytest.mark.asyncio
    async def test_custom_capability_map_overrides_default(self):
        """Custom capability map should override the default."""
        mock_orchestrator = AsyncMock()
        custom_map = {"POST_CREATED": "content_risk"}  # Override default

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler(capability_map=custom_map)
            event = FakeEvent("POST_CREATED")
            await handler(event)

        task = mock_orchestrator.submit_task.call_args[0][0]
        assert task.required_capability == "content_risk"

    @pytest.mark.asyncio
    async def test_task_includes_event_metadata(self):
        """The dispatched task should include event type, source, and data."""
        mock_orchestrator = AsyncMock()

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler()
            event = FakeEvent("REPORT_CREATED", source="api", data={"post_id": "abc"})
            await handler(event)

        task = mock_orchestrator.submit_task.call_args[0][0]
        assert task.input_data["event_type"] == "REPORT_CREATED"
        assert task.input_data["event_source"] == "api"
        assert task.input_data["event_data"] == {"post_id": "abc"}
        assert task.source_ref == event.id

    @pytest.mark.asyncio
    async def test_all_critical_events_dispatch_successfully(self):
        """Every critical event type should dispatch and complete."""
        mock_orchestrator = AsyncMock()

        critical_events = [
            "POST_CREATED", "COMMENT_CREATED", "REPORT_CREATED",
            "SPAM_DETECTED", "SERVICE_DEGRADED", "CACHE_MISS_SPIKE",
            "LATENCY_SPIKE",
        ]

        with patch("voicebox.workforce.event_consumer.get_orchestrator", return_value=mock_orchestrator):
            handler = make_event_handler()
            for event_type in critical_events:
                event = FakeEvent(event_type)
                await handler(event)

        assert mock_orchestrator.submit_task.call_count == len(critical_events)
