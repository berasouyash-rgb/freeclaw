"""
TDD Tests for Platform Bridge

Proves that:
1. call_bridge sends correct request format
2. call_bridge handles connection errors gracefully
3. call_bridge handles timeouts gracefully
4. call_bridge handles HTTP errors gracefully
5. call_bridge returns timing information
6. Convenience wrappers (read_post, quarantine_post, etc.) work correctly
7. Bridge secret is sent when configured
8. Bridge secret is NOT sent when not configured
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from voicebox.workforce.platform_bridge import call_bridge, read_post, quarantine_post, restore_post


class TestCallBridge:
    """call_bridge sends correct requests and handles errors."""

    @pytest.mark.asyncio
    async def test_sends_correct_request_format(self):
        """call_bridge sends POST with action, params, agent_id, task_id."""
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json = MagicMock(return_value={"ok": True, "result": {"id": "123"}})

        import httpx
        with patch.object(httpx, "AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            result = await call_bridge(
                "read_post",
                {"post_id": "123"},
                agent_id="test-agent",
                task_id="task-1",
            )

            assert result["ok"] is True
            assert result["tool"] == "read_post"
            assert result["result"] == {"id": "123"}
            assert result["duration_ms"] >= 0

            # Verify request was sent correctly
            call_args = mock_client.post.call_args
            assert "/api/workforce-bridge" in call_args[0][0]
            assert call_args[1]["json"]["action"] == "read_post"
            assert call_args[1]["json"]["params"] == {"post_id": "123"}
            assert call_args[1]["json"]["agent_id"] == "test-agent"
            assert call_args[1]["json"]["task_id"] == "task-1"

    @pytest.mark.asyncio
    async def test_handles_connection_error(self):
        """call_bridge returns error dict when connection fails."""
        import httpx

        with patch.object(httpx, "AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            result = await call_bridge("read_post", {"post_id": "123"})

            assert result["ok"] is False
            assert result["tool"] == "read_post"
            assert "bridge_unavailable" in result["error"]
            assert result["duration_ms"] >= 0

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        """call_bridge returns error dict when request times out."""
        import httpx

        with patch.object(httpx, "AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.TimeoutException("Timeout")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            result = await call_bridge("read_post", {"post_id": "123"})

            assert result["ok"] is False
            assert result["tool"] == "read_post"
            assert "timeout" in result["error"]

    @pytest.mark.asyncio
    async def test_handles_http_error(self):
        """call_bridge returns error dict for non-200 responses."""
        mock_response = AsyncMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"

        import httpx
        with patch.object(httpx, "AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            result = await call_bridge("read_post", {"post_id": "123"})

            assert result["ok"] is False
            assert result["tool"] == "read_post"
            assert "HTTP 500" in result["error"]

    @pytest.mark.asyncio
    async def test_includes_timing(self):
        """call_bridge always includes duration_ms in response."""
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ok": True}

        import httpx
        with patch.object(httpx, "AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            result = await call_bridge("read_post", {"post_id": "123"})

            assert "duration_ms" in result
            assert isinstance(result["duration_ms"], (int, float))


class TestBridgeSecret:
    """Bridge secret is sent when configured, omitted when not."""

    @pytest.mark.asyncio
    async def test_sends_secret_when_configured(self):
        """X-Bridge-Secret header is sent when WORKFORCE_BRIDGE_SECRET is set."""
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ok": True}

        import httpx
        with patch("voicebox.workforce.platform_bridge.BRIDGE_SECRET", "my-secret-key"), \
             patch.object(httpx, "AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            await call_bridge("read_post", {"post_id": "123"})

            call_args = mock_client.post.call_args
            headers = call_args[1]["headers"]
            assert headers["X-Bridge-Secret"] == "my-secret-key"

    @pytest.mark.asyncio
    async def test_omits_secret_when_empty(self):
        """X-Bridge-Secret header is NOT sent when WORKFORCE_BRIDGE_SECRET is empty."""
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ok": True}

        import httpx
        with patch("voicebox.workforce.platform_bridge.BRIDGE_SECRET", ""), \
             patch.object(httpx, "AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            await call_bridge("read_post", {"post_id": "123"})

            call_args = mock_client.post.call_args
            headers = call_args[1]["headers"]
            assert "X-Bridge-Secret" not in headers


class TestConvenienceWrappers:
    """Convenience wrappers call call_bridge with correct parameters."""

    @pytest.mark.asyncio
    async def test_read_post_calls_bridge(self):
        """read_post calls bridge with read_post action."""
        with patch("voicebox.workforce.platform_bridge.call_bridge", new_callable=AsyncMock) as mock_bridge:
            mock_bridge.return_value = {"ok": True, "result": {"id": "123"}}

            result = await read_post("123", agent_id="test", task_id="t1")

            mock_bridge.assert_called_once_with(
                "read_post",
                {"post_id": "123"},
                "test",
                "t1",
            )
            assert result["ok"] is True

    @pytest.mark.asyncio
    async def test_quarantine_post_calls_bridge(self):
        """quarantine_post calls bridge with quarantine_post action."""
        with patch("voicebox.workforce.platform_bridge.call_bridge", new_callable=AsyncMock) as mock_bridge:
            mock_bridge.return_value = {"ok": True}

            result = await quarantine_post("post-1", "spam detected", agent_id="test")

            mock_bridge.assert_called_once()
            call_args = mock_bridge.call_args[0]
            assert call_args[0] == "quarantine_post"
            assert call_args[1]["post_id"] == "post-1"
            assert call_args[1]["reason"] == "spam detected"

    @pytest.mark.asyncio
    async def test_restore_post_calls_bridge(self):
        """restore_post calls bridge with restore_post action."""
        with patch("voicebox.workforce.platform_bridge.call_bridge", new_callable=AsyncMock) as mock_bridge:
            mock_bridge.return_value = {"ok": True}

            result = await restore_post("post-1", agent_id="test")

            mock_bridge.assert_called_once()
            call_args = mock_bridge.call_args[0]
            assert call_args[0] == "restore_post"
            assert call_args[1]["post_id"] == "post-1"
