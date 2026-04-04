"""
Unit tests for Cloudflare Tunnel manager.

Tests tunnel URL detection, subprocess management, and graceful fallback.
"""
import asyncio
import platform
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from urllib.error import URLError

import pytest

from core.tunnel import (
    _find_cloudflared,
    _get_cloudflared_download_url,
    _get_data_dir,
    _probe_tunnel_url,
    _wait_for_dns,
    _TUNNEL_URL_RE,
    get_tunnel_url,
    start_tunnel,
    stop_tunnel,
)


# ──────────────────────────────────────────────
# Tunnel URL regex tests
# ──────────────────────────────────────────────

class TestTunnelUrlRegex:
    """Verify the regex correctly extracts trycloudflare.com URLs from cloudflared output."""

    def test_extracts_standard_url(self):
        line = "2026-03-09T10:00:00Z INF +-------------------------------------------+"
        assert _TUNNEL_URL_RE.search(line) is None

        line = "2026-03-09T10:00:00Z INF |  https://abc-def-123.trycloudflare.com  |"
        match = _TUNNEL_URL_RE.search(line)
        assert match is not None
        assert match.group(1) == "https://abc-def-123.trycloudflare.com"

    def test_extracts_url_from_info_line(self):
        line = "2026-03-09T10:00:00Z INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.200.193 location=LAX protocol=quic"
        assert _TUNNEL_URL_RE.search(line) is None

        line = "2026-03-09T10:00:00Z INF https://my-tunnel-name.trycloudflare.com"
        match = _TUNNEL_URL_RE.search(line)
        assert match is not None
        assert match.group(1) == "https://my-tunnel-name.trycloudflare.com"

    def test_no_match_for_other_urls(self):
        line = "https://example.com"
        assert _TUNNEL_URL_RE.search(line) is None

    def test_no_match_for_api_subdomain(self):
        """api.trycloudflare.com is Cloudflare's API, not a tunnel URL."""
        line = "2026-03-09T10:00:00Z INF https://api.trycloudflare.com/something"
        assert _TUNNEL_URL_RE.search(line) is None

    def test_no_match_for_single_word_subdomains(self):
        """Quick Tunnel URLs always have hyphens (multiple random words)."""
        line = "https://something.trycloudflare.com"
        assert _TUNNEL_URL_RE.search(line) is None

    def test_no_match_for_empty_line(self):
        assert _TUNNEL_URL_RE.search("") is None


# ──────────────────────────────────────────────
# Binary location tests
# ──────────────────────────────────────────────

class TestFindCloudflared:
    """Test cloudflared binary discovery logic."""

    @patch("core.tunnel.shutil.which", return_value="/usr/local/bin/cloudflared")
    def test_finds_on_path(self, mock_which):
        result = _find_cloudflared()
        assert result == "/usr/local/bin/cloudflared"

    @patch("core.tunnel.shutil.which", return_value=None)
    @patch("core.tunnel._get_data_dir")
    def test_finds_in_data_dir(self, mock_data_dir, mock_which, tmp_path):
        binary_name = "cloudflared.exe" if platform.system().lower() == "windows" else "cloudflared"
        binary = tmp_path / binary_name
        binary.touch()
        mock_data_dir.return_value = tmp_path
        result = _find_cloudflared()
        assert result == str(binary)

    @patch("core.tunnel.shutil.which", return_value=None)
    @patch("core.tunnel._get_data_dir")
    def test_returns_none_when_not_found(self, mock_data_dir, mock_which, tmp_path):
        mock_data_dir.return_value = tmp_path
        result = _find_cloudflared()
        assert result is None


# ──────────────────────────────────────────────
# Download URL tests
# ──────────────────────────────────────────────

class TestGetDownloadUrl:
    """Verify download URL generation for supported platforms."""

    @patch("core.tunnel.platform.system", return_value="Windows")
    @patch("core.tunnel.platform.machine", return_value="AMD64")
    def test_windows_amd64(self, mock_machine, mock_system):
        url = _get_cloudflared_download_url()
        assert url is not None
        assert "windows-amd64" in url

    @patch("core.tunnel.platform.system", return_value="Linux")
    @patch("core.tunnel.platform.machine", return_value="x86_64")
    def test_linux_amd64(self, mock_machine, mock_system):
        url = _get_cloudflared_download_url()
        assert url is not None
        assert "linux-amd64" in url

    @patch("core.tunnel.platform.system", return_value="Darwin")
    @patch("core.tunnel.platform.machine", return_value="arm64")
    def test_macos_arm64(self, mock_machine, mock_system):
        url = _get_cloudflared_download_url()
        assert url is not None
        assert "darwin-arm64" in url

    @patch("core.tunnel.platform.system", return_value="FreeBSD")
    @patch("core.tunnel.platform.machine", return_value="x86_64")
    def test_unsupported_platform(self, mock_machine, mock_system):
        url = _get_cloudflared_download_url()
        assert url is None


# ──────────────────────────────────────────────
# Tunnel lifecycle tests
# ──────────────────────────────────────────────

class TestStartTunnel:
    """Test tunnel start/stop lifecycle."""

    @pytest.fixture(autouse=True)
    async def cleanup_tunnel(self):
        """Ensure tunnel state is clean before and after each test."""
        import core.tunnel as tunnel_mod
        tunnel_mod._tunnel_process = None
        tunnel_mod._tunnel_url = None
        tunnel_mod._local_port = None
        if tunnel_mod._health_task is not None:
            tunnel_mod._health_task.cancel()
            try:
                await tunnel_mod._health_task
            except asyncio.CancelledError:
                pass
        tunnel_mod._health_task = None
        yield
        tunnel_mod._tunnel_process = None
        tunnel_mod._tunnel_url = None
        tunnel_mod._local_port = None
        if tunnel_mod._health_task is not None:
            tunnel_mod._health_task.cancel()
            try:
                await tunnel_mod._health_task
            except asyncio.CancelledError:
                pass
        tunnel_mod._health_task = None

    @patch("core.tunnel._ensure_cloudflared", return_value=None)
    @pytest.mark.asyncio
    async def test_returns_none_when_no_binary(self, mock_ensure):
        result = await start_tunnel(8000)
        assert result is None
        assert get_tunnel_url() is None

    @patch("core.tunnel._read_tunnel_url", new_callable=AsyncMock)
    @patch("core.tunnel._ensure_cloudflared", return_value="/usr/local/bin/cloudflared")
    @pytest.mark.asyncio
    async def test_returns_url_on_success(self, mock_ensure, mock_read_url):
        mock_read_url.return_value = "https://test-tunnel.trycloudflare.com"

        mock_process = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()

        with patch("core.tunnel.subprocess.Popen", return_value=mock_process):
            result = await start_tunnel(8000)

        assert result == "https://test-tunnel.trycloudflare.com"
        assert get_tunnel_url() == "https://test-tunnel.trycloudflare.com"

    @patch("core.tunnel._read_tunnel_url", new_callable=AsyncMock)
    @patch("core.tunnel._ensure_cloudflared", return_value="/usr/local/bin/cloudflared")
    @pytest.mark.asyncio
    async def test_returns_none_on_timeout(self, mock_ensure, mock_read_url):
        mock_read_url.return_value = None

        mock_process = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = MagicMock()
        mock_process.kill = MagicMock()

        with patch("core.tunnel.subprocess.Popen", return_value=mock_process):
            result = await start_tunnel(8000)

        assert result is None
        assert get_tunnel_url() is None


class TestStopTunnel:
    """Test tunnel shutdown."""

    @pytest.fixture(autouse=True)
    async def cleanup_tunnel(self):
        import core.tunnel as tunnel_mod
        tunnel_mod._tunnel_process = None
        tunnel_mod._tunnel_url = None
        tunnel_mod._local_port = None
        if tunnel_mod._health_task is not None:
            tunnel_mod._health_task.cancel()
            try:
                await tunnel_mod._health_task
            except asyncio.CancelledError:
                pass
        tunnel_mod._health_task = None
        yield
        tunnel_mod._tunnel_process = None
        tunnel_mod._tunnel_url = None
        tunnel_mod._local_port = None
        if tunnel_mod._health_task is not None:
            tunnel_mod._health_task.cancel()
            try:
                await tunnel_mod._health_task
            except asyncio.CancelledError:
                pass
        tunnel_mod._health_task = None

    @pytest.mark.asyncio
    async def test_stop_when_no_tunnel(self):
        """stop_tunnel should be safe to call when no tunnel is running."""
        await stop_tunnel()
        assert get_tunnel_url() is None

    @pytest.mark.asyncio
    async def test_stop_terminates_process(self):
        import core.tunnel as tunnel_mod

        mock_process = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = MagicMock()

        tunnel_mod._tunnel_process = mock_process
        tunnel_mod._tunnel_url = "https://test.trycloudflare.com"

        await stop_tunnel()

        mock_process.terminate.assert_called_once()
        assert get_tunnel_url() is None
        assert tunnel_mod._tunnel_process is None


# ──────────────────────────────────────────────
# Data directory test
# ──────────────────────────────────────────────

class TestHealthMonitor:
    """Test tunnel health check and auto-restart."""

    @pytest.fixture(autouse=True)
    async def cleanup_tunnel(self):
        import core.tunnel as tunnel_mod
        tunnel_mod._tunnel_process = None
        tunnel_mod._tunnel_url = None
        tunnel_mod._local_port = None
        if tunnel_mod._health_task is not None:
            tunnel_mod._health_task.cancel()
            try:
                await tunnel_mod._health_task
            except asyncio.CancelledError:
                pass
        tunnel_mod._health_task = None
        yield
        tunnel_mod._tunnel_process = None
        tunnel_mod._tunnel_url = None
        tunnel_mod._local_port = None
        if tunnel_mod._health_task is not None:
            tunnel_mod._health_task.cancel()
            try:
                await tunnel_mod._health_task
            except asyncio.CancelledError:
                pass
        tunnel_mod._health_task = None

    @patch("core.tunnel._wait_for_dns", new_callable=AsyncMock, return_value=True)
    @patch("core.tunnel._read_tunnel_url", new_callable=AsyncMock)
    @patch("core.tunnel._ensure_cloudflared", return_value="/usr/local/bin/cloudflared")
    @pytest.mark.asyncio
    async def test_health_monitor_starts_on_success(self, mock_ensure, mock_read_url, mock_dns):
        """Health monitor task should be created when tunnel starts successfully."""
        import core.tunnel as tunnel_mod

        mock_read_url.return_value = "https://test.trycloudflare.com"
        mock_process = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()

        with patch("core.tunnel.subprocess.Popen", return_value=mock_process):
            await start_tunnel(8000)

        # _post_tunnel_setup runs as a background task; give it a tick to complete
        await asyncio.sleep(0)

        assert tunnel_mod._health_task is not None
        assert not tunnel_mod._health_task.done()

    @pytest.mark.asyncio
    async def test_stop_cancels_health_monitor(self):
        """stop_tunnel should cancel the health monitor task."""
        import core.tunnel as tunnel_mod

        # Create a dummy health task
        async def dummy_loop():
            while True:
                await asyncio.sleep(999)

        tunnel_mod._health_task = asyncio.create_task(dummy_loop())
        await stop_tunnel()

        assert tunnel_mod._health_task is None

    @patch("core.tunnel.urlopen")
    @pytest.mark.asyncio
    async def test_probe_returns_true_for_reachable_url(self, mock_urlopen):
        """Probe should return True when URL is reachable."""
        mock_urlopen.return_value.__enter__ = MagicMock(return_value=MagicMock())
        mock_urlopen.return_value.__exit__ = MagicMock(return_value=False)
        result = await _probe_tunnel_url("https://test.trycloudflare.com")
        assert result is True

    @patch("core.tunnel.urlopen", side_effect=URLError("DNS resolution failed"))
    @pytest.mark.asyncio
    async def test_probe_returns_false_for_unreachable_url(self, mock_urlopen):
        """Probe should return False when URL is unreachable."""
        result = await _probe_tunnel_url("https://dead-tunnel.trycloudflare.com")
        assert result is False


class TestWaitForDns:
    """Test DNS readiness wait logic."""

    @patch("core.tunnel._DNS_PROBE_INTERVAL_SECONDS", 0)
    @patch("core.tunnel._probe_tunnel_url", new_callable=AsyncMock, return_value=True)
    @pytest.mark.asyncio
    async def test_returns_true_on_first_probe(self, mock_probe):
        """Should return True immediately if DNS resolves on first try."""
        result = await _wait_for_dns("https://fast-tunnel.trycloudflare.com")
        assert result is True
        assert mock_probe.call_count == 1

    @patch("core.tunnel._DNS_PROBE_INTERVAL_SECONDS", 0)
    @patch("core.tunnel._probe_tunnel_url", new_callable=AsyncMock, side_effect=[False, False, True])
    @pytest.mark.asyncio
    async def test_returns_true_after_retries(self, mock_probe):
        """Should retry and return True once DNS propagates."""
        result = await _wait_for_dns("https://slow-tunnel.trycloudflare.com")
        assert result is True
        assert mock_probe.call_count == 3

    @patch("core.tunnel._DNS_PROBE_INTERVAL_SECONDS", 0)
    @patch("core.tunnel._DNS_PROBE_MAX_ATTEMPTS", 3)
    @patch("core.tunnel._probe_tunnel_url", new_callable=AsyncMock, return_value=False)
    @pytest.mark.asyncio
    async def test_returns_false_after_exhausting_attempts(self, mock_probe):
        """Should return False if all probes fail."""
        result = await _wait_for_dns("https://dead-tunnel.trycloudflare.com")
        assert result is False
        assert mock_probe.call_count == 3


# ──────────────────────────────────────────────
# Data directory test
# ──────────────────────────────────────────────

class TestGetDataDir:
    """Verify data directory creation."""

    def test_returns_path(self):
        result = _get_data_dir()
        assert result.exists()
        assert "contop" in str(result).lower()
