"""
Unit tests for PinchTab browser automation client.

Tests the BrowserAutomation HTTP client wrapper using mocked httpx responses.
All PinchTab API calls are mocked - no live server required.

[Source: tech-spec-smart-file-search-browser-tool.md - Task 9]
"""
import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from tools.browser_automation import (
    BrowserAutomation,
    HEALTH_CACHE_TTL_S,
    _find_pinchtab_binary,
    _get_platform_asset_name,
    _download_pinchtab_binary,
    ensure_pinchtab_installed,
)


@pytest.fixture
def client():
    """Create a BrowserAutomation client for testing."""
    return BrowserAutomation(base_url="http://127.0.0.1:9867")


# ---------------------------------------------------------------------------
# Health check tests
# ---------------------------------------------------------------------------

class TestHealthCheck:

    @pytest.mark.asyncio
    async def test_health_check_success(self, client):
        """Mock httpx response 200, verify returns True."""
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch.object(client._client, "get", new_callable=AsyncMock, return_value=mock_response):
            result = await client.health_check()
            assert result is True

    @pytest.mark.asyncio
    async def test_health_check_failure(self, client):
        """Mock connection error, verify returns False."""
        with patch.object(
            client._client, "get",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("Connection refused"),
        ):
            result = await client.health_check()
            assert result is False

    @pytest.mark.asyncio
    async def test_health_check_caches_result(self, client):
        """Verify health check result is cached for HEALTH_CACHE_TTL_S."""
        mock_response = MagicMock()
        mock_response.status_code = 200

        mock_get = AsyncMock(return_value=mock_response)
        with patch.object(client._client, "get", mock_get):
            result1 = await client.health_check()
            result2 = await client.health_check()
            assert result1 is True
            assert result2 is True
            # Should only have called get() once due to caching
            assert mock_get.call_count == 1

    @pytest.mark.asyncio
    async def test_health_check_timeout(self, client):
        """Mock timeout, verify returns False."""
        with patch.object(
            client._client, "get",
            new_callable=AsyncMock,
            side_effect=httpx.TimeoutException("Timeout"),
        ):
            result = await client.health_check()
            assert result is False


# ---------------------------------------------------------------------------
# Instance management tests
# ---------------------------------------------------------------------------

class TestInstanceManagement:

    @pytest.mark.asyncio
    async def test_get_or_create_instance_existing(self, client):
        """Mock GET /instances returns existing instance, verify reuses."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {"id": "inst-123", "name": "contop", "status": "running"}
        ]
        mock_response.raise_for_status = MagicMock()

        with patch.object(client._client, "get", new_callable=AsyncMock, return_value=mock_response):
            instance_id = await client.get_or_create_instance()
            assert instance_id == "inst-123"

    @pytest.mark.asyncio
    async def test_get_or_create_instance_new(self, client):
        """Mock empty instances list, verify launches new."""
        # First call: GET /instances returns empty list
        mock_list_response = MagicMock()
        mock_list_response.status_code = 200
        mock_list_response.json.return_value = []
        mock_list_response.raise_for_status = MagicMock()

        # Second call: POST /instances/launch returns new instance
        mock_launch_response = MagicMock()
        mock_launch_response.status_code = 200
        mock_launch_response.json.return_value = {"id": "inst-new-456"}
        mock_launch_response.raise_for_status = MagicMock()

        with patch.object(client._client, "get", new_callable=AsyncMock, return_value=mock_list_response):
            with patch.object(client._client, "post", new_callable=AsyncMock, return_value=mock_launch_response):
                instance_id = await client.get_or_create_instance()
                assert instance_id == "inst-new-456"

    @pytest.mark.asyncio
    async def test_get_or_create_instance_cached(self, client):
        """Verify cached instance ID is reused on subsequent calls."""
        client._cached_instance_id = "inst-cached-789"
        instance_id = await client.get_or_create_instance()
        assert instance_id == "inst-cached-789"


# ---------------------------------------------------------------------------
# Tab management tests
# ---------------------------------------------------------------------------

class TestTabManagement:

    @pytest.mark.asyncio
    async def test_open_tab(self, client):
        """Mock POST response, verify returns tab_id."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"tabId": "tab-abc"}
        mock_response.raise_for_status = MagicMock()

        with patch.object(client._client, "post", new_callable=AsyncMock, return_value=mock_response):
            tab_id = await client.open_tab("inst-123", "https://example.com")
            assert tab_id == "tab-abc"

    @pytest.mark.asyncio
    async def test_open_tab_failure(self, client):
        """Mock connection error on tab open, verify returns empty string."""
        with patch.object(
            client._client, "post",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("Connection refused"),
        ):
            tab_id = await client.open_tab("inst-123", "https://example.com")
            assert tab_id == ""


# ---------------------------------------------------------------------------
# Snapshot tests
# ---------------------------------------------------------------------------

class TestSnapshot:

    @pytest.mark.asyncio
    async def test_snapshot(self, client):
        """Mock GET response, verify returns structured DOM."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "title": "Example Page",
            "elements": [
                {"ref": "e1", "tag": "button", "text": "Submit"},
                {"ref": "e2", "tag": "input", "text": ""},
            ],
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(client._client, "get", new_callable=AsyncMock, return_value=mock_response):
            result = await client.snapshot("tab-abc")
            assert "elements" in result
            assert len(result["elements"]) == 2
            assert result["elements"][0]["ref"] == "e1"


# ---------------------------------------------------------------------------
# Action tests
# ---------------------------------------------------------------------------

class TestActions:

    @pytest.mark.asyncio
    async def test_action_click(self, client):
        """Mock POST response, verify correct payload sent for click."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "success"}
        mock_response.raise_for_status = MagicMock()

        mock_post = AsyncMock(return_value=mock_response)
        with patch.object(client._client, "post", mock_post):
            result = await client.action("tab-abc", kind="click", ref="e5")
            assert result["status"] == "success"
            # Verify the correct payload was sent
            mock_post.assert_called_once_with(
                "/tabs/tab-abc/action",
                json={"kind": "click", "ref": "e5"},
            )

    @pytest.mark.asyncio
    async def test_action_fill(self, client):
        """Mock POST response, verify ref and value passed for fill."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "success"}
        mock_response.raise_for_status = MagicMock()

        mock_post = AsyncMock(return_value=mock_response)
        with patch.object(client._client, "post", mock_post):
            result = await client.action("tab-abc", kind="fill", ref="e3", value="hello world")
            assert result["status"] == "success"
            mock_post.assert_called_once_with(
                "/tabs/tab-abc/action",
                json={"kind": "fill", "ref": "e3", "value": "hello world"},
            )

    @pytest.mark.asyncio
    async def test_extract_text(self, client):
        """Mock snapshot response, verify text returned from accessibility nodes."""
        mock_snapshot = {
            "title": "Hello, World!",
            "nodes": [
                {"name": "Hello, World!"},
                {"name": "This is page content."},
            ],
        }

        with patch.object(client, "snapshot", new_callable=AsyncMock, return_value=mock_snapshot):
            text = await client.extract_text("tab-abc")
            assert "Hello, World!" in text
            assert "This is page content." in text


# ---------------------------------------------------------------------------
# Error handling tests
# ---------------------------------------------------------------------------

class TestErrorHandling:

    @pytest.mark.asyncio
    async def test_connection_timeout(self, client):
        """Mock timeout on action, verify error dict returned."""
        with patch.object(
            client._client, "post",
            new_callable=AsyncMock,
            side_effect=httpx.TimeoutException("Request timed out"),
        ):
            result = await client.action("tab-abc", kind="click", ref="e1")
            assert result["status"] == "error"
            assert "description" in result

    @pytest.mark.asyncio
    async def test_snapshot_connection_error(self, client):
        """Mock connection error on snapshot, verify error dict with description."""
        with patch.object(
            client._client, "get",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("Connection refused"),
        ):
            result = await client.snapshot("tab-abc")
            assert result["status"] == "error"
            assert "description" in result

    @pytest.mark.asyncio
    async def test_launch_instance_failure(self, client):
        """Mock failed instance launch, verify error dict returned."""
        with patch.object(
            client._client, "post",
            new_callable=AsyncMock,
            side_effect=httpx.ConnectError("Connection refused"),
        ):
            result = await client.launch_instance()
            assert result["status"] == "error"
            assert "description" in result


# ---------------------------------------------------------------------------
# Auto-start / binary discovery tests
# ---------------------------------------------------------------------------

class TestAutoStart:

    def test_find_binary_not_found(self):
        """When no binary exists anywhere, returns None."""
        with patch("tools.browser_automation.Path.is_file", return_value=False):
            with patch("tools.browser_automation.shutil.which", return_value=None):
                assert _find_pinchtab_binary() is None

    def test_find_binary_on_path(self):
        """When binary is on system PATH, returns that path."""
        with patch("tools.browser_automation.Path.is_file", return_value=False):
            with patch("tools.browser_automation.shutil.which", return_value="/usr/bin/pinchtab"):
                assert _find_pinchtab_binary() == "/usr/bin/pinchtab"

    @pytest.mark.asyncio
    async def test_ensure_running_already_healthy(self, client):
        """If PinchTab is already healthy, ensure_running returns True without starting."""
        with patch.object(client, "health_check", new_callable=AsyncMock, return_value=True):
            assert await client.ensure_running() is True

    @pytest.mark.asyncio
    async def test_ensure_running_no_binary(self, client):
        """If PinchTab is down and no binary found, returns False."""
        with patch.object(client, "health_check", new_callable=AsyncMock, return_value=False):
            with patch("tools.browser_automation._find_pinchtab_binary", return_value=None):
                assert await client.ensure_running() is False

    @pytest.mark.asyncio
    async def test_ensure_running_starts_process(self, client):
        """If binary found and PinchTab is down, starts it and waits for healthy."""
        call_count = 0

        async def health_side_effect():
            nonlocal call_count
            call_count += 1
            # Unhealthy on first call, healthy on subsequent (simulating startup)
            return call_count > 1

        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_process.pid = 12345

        with patch.object(client, "health_check", side_effect=health_side_effect):
            with patch("tools.browser_automation._find_pinchtab_binary", return_value="/usr/bin/pinchtab"):
                with patch("tools.browser_automation.subprocess.Popen", return_value=mock_process):
                    with patch("tools.browser_automation.asyncio.sleep", new_callable=AsyncMock):
                        result = await client.ensure_running()
                        assert result is True
                        assert client._process is mock_process

    @pytest.mark.asyncio
    async def test_close_terminates_managed_process(self, client):
        """close() should terminate a managed PinchTab process."""
        mock_process = MagicMock()
        mock_process.poll.return_value = None  # Process is running
        mock_process.pid = 12345
        client._process = mock_process

        with patch.object(client._client, "aclose", new_callable=AsyncMock):
            await client.close()

        mock_process.terminate.assert_called_once()
        mock_process.wait.assert_called_once_with(timeout=5)


# ---------------------------------------------------------------------------
# Platform asset name tests
# ---------------------------------------------------------------------------

class TestPlatformAsset:

    def test_windows_amd64(self):
        """Windows x86_64 returns correct asset name."""
        with patch("tools.browser_automation.sys") as mock_sys:
            with patch("tools.browser_automation.platform") as mock_platform:
                mock_sys.platform = "win32"
                mock_platform.machine.return_value = "AMD64"
                assert _get_platform_asset_name() == "pinchtab-windows-amd64.exe"

    def test_linux_amd64(self):
        """Linux x86_64 returns correct asset name."""
        with patch("tools.browser_automation.sys") as mock_sys:
            with patch("tools.browser_automation.platform") as mock_platform:
                mock_sys.platform = "linux"
                mock_platform.machine.return_value = "x86_64"
                assert _get_platform_asset_name() == "pinchtab-linux-amd64"

    def test_darwin_arm64(self):
        """macOS ARM64 returns correct asset name."""
        with patch("tools.browser_automation.sys") as mock_sys:
            with patch("tools.browser_automation.platform") as mock_platform:
                mock_sys.platform = "darwin"
                mock_platform.machine.return_value = "arm64"
                assert _get_platform_asset_name() == "pinchtab-darwin-arm64"

    def test_unsupported_os(self):
        """Unsupported OS returns None."""
        with patch("tools.browser_automation.sys") as mock_sys:
            mock_sys.platform = "freebsd"
            assert _get_platform_asset_name() is None

    def test_unsupported_arch(self):
        """Unsupported architecture returns None."""
        with patch("tools.browser_automation.sys") as mock_sys:
            with patch("tools.browser_automation.platform") as mock_platform:
                mock_sys.platform = "linux"
                mock_platform.machine.return_value = "mips"
                assert _get_platform_asset_name() is None


# ---------------------------------------------------------------------------
# Auto-download tests
# ---------------------------------------------------------------------------

class TestAutoDownload:

    @pytest.mark.asyncio
    async def test_download_success(self, tmp_path):
        """Successful download saves binary and returns path."""
        mock_binary_resp = MagicMock()
        mock_binary_resp.status_code = 200
        mock_binary_resp.content = b"\x7fELF fake binary content"
        mock_binary_resp.raise_for_status = MagicMock()

        mock_get = AsyncMock(return_value=mock_binary_resp)

        with patch("tools.browser_automation._get_platform_asset_name", return_value="pinchtab-linux-amd64"):
            with patch("tools.browser_automation.sys") as mock_sys:
                mock_sys.platform = "linux"
                with patch("tools.browser_automation.Path.home", return_value=tmp_path):
                    with patch("tools.browser_automation.httpx.AsyncClient") as MockClient:
                        mock_client_instance = AsyncMock()
                        mock_client_instance.get = mock_get
                        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
                        mock_client_instance.__aexit__ = AsyncMock(return_value=False)
                        MockClient.return_value = mock_client_instance

                        result = await _download_pinchtab_binary()

                        assert result is not None
                        assert "pinchtab" in result
                        # Single GET for the binary (no API call - pinned version)
                        assert mock_get.call_count == 1

    @pytest.mark.asyncio
    async def test_download_unsupported_platform(self):
        """Returns None when platform is unsupported."""
        with patch("tools.browser_automation._get_platform_asset_name", return_value=None):
            result = await _download_pinchtab_binary()
            assert result is None

    @pytest.mark.asyncio
    async def test_download_network_failure(self):
        """Returns None when download fails due to network error."""
        mock_get = AsyncMock(side_effect=httpx.ConnectError("Network error"))

        with patch("tools.browser_automation._get_platform_asset_name", return_value="pinchtab-linux-amd64"):
            with patch("tools.browser_automation.sys") as mock_sys:
                mock_sys.platform = "linux"
                with patch("tools.browser_automation.httpx.AsyncClient") as MockClient:
                    mock_client_instance = AsyncMock()
                    mock_client_instance.get = mock_get
                    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
                    mock_client_instance.__aexit__ = AsyncMock(return_value=False)
                    MockClient.return_value = mock_client_instance

                    result = await _download_pinchtab_binary()
                    assert result is None


# ---------------------------------------------------------------------------
# Server startup install tests
# ---------------------------------------------------------------------------

class TestEnsureInstalled:

    @pytest.mark.asyncio
    async def test_already_installed(self):
        """If binary already exists, returns path without downloading."""
        with patch("tools.browser_automation._find_pinchtab_binary", return_value="/usr/bin/pinchtab"):
            result = await ensure_pinchtab_installed()
            assert result == "/usr/bin/pinchtab"

    @pytest.mark.asyncio
    async def test_downloads_when_missing(self):
        """If binary not found, downloads and returns path."""
        with patch("tools.browser_automation._find_pinchtab_binary", return_value=None):
            with patch("tools.browser_automation._download_pinchtab_binary", new_callable=AsyncMock, return_value="/home/user/.contop/bin/pinchtab"):
                result = await ensure_pinchtab_installed()
                assert result == "/home/user/.contop/bin/pinchtab"

    @pytest.mark.asyncio
    async def test_download_fails(self):
        """If binary not found and download fails, returns None."""
        with patch("tools.browser_automation._find_pinchtab_binary", return_value=None):
            with patch("tools.browser_automation._download_pinchtab_binary", new_callable=AsyncMock, return_value=None):
                result = await ensure_pinchtab_installed()
                assert result is None
