"""
ATDD - Story 1.7: Cloudflare Tunnel for Global Signaling Reachability
Acceptance tests validating all 7 acceptance criteria.

AC1: Server spawns Quick Tunnel on startup when cloudflared is available
AC2: Auto-download cloudflared when not on PATH; fallback to LAN if download fails
AC3: Clean subprocess termination on shutdown (SIGTERM + 5s timeout + force kill)
AC4: Mobile uses signaling_url from QR payload for WebSocket connection
AC5: Mobile falls back to ws://host:port/ws/signaling when signaling_url absent
AC6: signaling_url formatted as wss://<subdomain>.trycloudflare.com/ws/signaling
AC7: Tunnel URL extracted from stderr via regex with 30s timeout

Module under test: core.tunnel, core.pairing (QR payload integration)
"""
import asyncio
import platform
import re
import subprocess
import time
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

import core.tunnel as tunnel_mod
from core.tunnel import (
    _find_cloudflared,
    _download_cloudflared,
    _ensure_cloudflared,
    _get_cloudflared_download_url,
    _get_data_dir,
    _read_tunnel_url,
    _TUNNEL_URL_RE,
    _STARTUP_TIMEOUT_SECONDS,
    get_tunnel_url,
    start_tunnel,
    stop_tunnel,
)


@pytest.fixture(autouse=True)
def reset_tunnel_state():
    """Ensure tunnel globals are clean before and after each test."""
    tunnel_mod._tunnel_process = None
    tunnel_mod._tunnel_url = None
    yield
    tunnel_mod._tunnel_process = None
    tunnel_mod._tunnel_url = None


# ──────────────────────────────────────────────
# AC1: Server spawns Quick Tunnel on startup
# ──────────────────────────────────────────────

class TestAC1TunnelSpawnOnStartup:
    """AC1: Given the server starts up, When cloudflared is available,
    Then it spawns a Quick Tunnel and embeds the URL in QR payloads."""

    @pytest.mark.asyncio
    async def test_start_tunnel_spawns_subprocess_with_correct_args(self):
        """[P0] start_tunnel(port) spawns cloudflared with --url http://localhost:{port}."""
        mock_process = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()

        with patch("core.tunnel._ensure_cloudflared", return_value="/usr/bin/cloudflared"), \
             patch("core.tunnel.subprocess.Popen", return_value=mock_process) as mock_popen, \
             patch("core.tunnel._read_tunnel_url", new_callable=AsyncMock,
                   return_value="https://abc-123.trycloudflare.com"):
            result = await start_tunnel(8000)

        assert result == "https://abc-123.trycloudflare.com"
        mock_popen.assert_called_once()
        cmd_args = mock_popen.call_args[0][0]
        assert cmd_args[0] == "/usr/bin/cloudflared"
        assert "--url" in cmd_args
        url_idx = cmd_args.index("--url")
        assert cmd_args[url_idx + 1] == "http://localhost:8000"

    @pytest.mark.asyncio
    async def test_tunnel_url_stored_globally_after_success(self):
        """[P0] After successful startup, get_tunnel_url() returns the active URL."""
        mock_process = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()

        with patch("core.tunnel._ensure_cloudflared", return_value="/usr/bin/cloudflared"), \
             patch("core.tunnel.subprocess.Popen", return_value=mock_process), \
             patch("core.tunnel._read_tunnel_url", new_callable=AsyncMock,
                   return_value="https://active-tunnel.trycloudflare.com"):
            await start_tunnel(8000)

        assert get_tunnel_url() == "https://active-tunnel.trycloudflare.com"

    @pytest.mark.asyncio
    async def test_start_tunnel_returns_none_when_no_binary(self):
        """[P0] start_tunnel returns None and does NOT crash when cloudflared unavailable."""
        with patch("core.tunnel._ensure_cloudflared", return_value=None):
            result = await start_tunnel(8000)

        assert result is None
        assert get_tunnel_url() is None


# ──────────────────────────────────────────────
# AC2: Auto-download cloudflared; fallback if fails
# ──────────────────────────────────────────────

class TestAC2AutoDownloadAndFallback:
    """AC2: Given cloudflared is NOT on PATH or in data dir,
    Then auto-download is attempted; if that fails, fallback to LAN-only."""

    def test_find_cloudflared_checks_path_first(self):
        """[P0] _find_cloudflared() searches PATH before app data directory."""
        with patch("core.tunnel.shutil.which", return_value="/usr/local/bin/cloudflared") as mock_which:
            result = _find_cloudflared()

        assert result == "/usr/local/bin/cloudflared"
        mock_which.assert_called_once()

    def test_find_cloudflared_checks_data_dir_when_not_on_path(self, tmp_path):
        """[P0] _find_cloudflared() falls back to app data dir when not on PATH."""
        binary_name = "cloudflared.exe" if platform.system().lower() == "windows" else "cloudflared"
        binary = tmp_path / binary_name
        binary.touch()

        with patch("core.tunnel.shutil.which", return_value=None), \
             patch("core.tunnel._get_data_dir", return_value=tmp_path):
            result = _find_cloudflared()

        assert result == str(binary)

    def test_ensure_cloudflared_attempts_download_when_not_found(self):
        """[P0] _ensure_cloudflared() calls _download_cloudflared() when binary not found."""
        with patch("core.tunnel._find_cloudflared", return_value=None), \
             patch("core.tunnel._download_cloudflared", return_value="/path/to/cloudflared") as mock_dl:
            result = _ensure_cloudflared()

        assert result == "/path/to/cloudflared"
        mock_dl.assert_called_once()

    @pytest.mark.asyncio
    async def test_start_tunnel_succeeds_after_download(self):
        """[P0] Tunnel starts successfully after auto-downloading cloudflared."""
        mock_process = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()

        with patch("core.tunnel._find_cloudflared", return_value=None), \
             patch("core.tunnel._download_cloudflared", return_value="/downloaded/cloudflared"), \
             patch("core.tunnel.subprocess.Popen", return_value=mock_process), \
             patch("core.tunnel._read_tunnel_url", new_callable=AsyncMock,
                   return_value="https://downloaded-tunnel.trycloudflare.com"):
            result = await start_tunnel(8000)

        assert result == "https://downloaded-tunnel.trycloudflare.com"

    @pytest.mark.asyncio
    async def test_fallback_to_lan_when_download_fails(self):
        """[P0] When cloudflared unavailable and download fails, returns None (LAN-only)."""
        with patch("core.tunnel._find_cloudflared", return_value=None), \
             patch("core.tunnel._download_cloudflared", return_value=None):
            result = await start_tunnel(8000)

        assert result is None
        assert get_tunnel_url() is None

    def test_download_handles_windows_amd64(self):
        """[P1] Download URL correct for Windows amd64."""
        with patch("core.tunnel.platform.system", return_value="Windows"), \
             patch("core.tunnel.platform.machine", return_value="AMD64"):
            url = _get_cloudflared_download_url()

        assert url is not None
        assert "cloudflared-windows-amd64.exe" in url

    def test_download_handles_macos_arm64(self):
        """[P1] Download URL correct for macOS arm64."""
        with patch("core.tunnel.platform.system", return_value="Darwin"), \
             patch("core.tunnel.platform.machine", return_value="arm64"):
            url = _get_cloudflared_download_url()

        assert url is not None
        assert "cloudflared-darwin-arm64.tgz" in url

    def test_download_handles_macos_amd64(self):
        """[P1] Download URL correct for macOS amd64."""
        with patch("core.tunnel.platform.system", return_value="Darwin"), \
             patch("core.tunnel.platform.machine", return_value="x86_64"):
            url = _get_cloudflared_download_url()

        assert url is not None
        assert "cloudflared-darwin-amd64.tgz" in url

    def test_download_handles_linux_amd64(self):
        """[P1] Download URL correct for Linux amd64."""
        with patch("core.tunnel.platform.system", return_value="Linux"), \
             patch("core.tunnel.platform.machine", return_value="x86_64"):
            url = _get_cloudflared_download_url()

        assert url is not None
        assert "cloudflared-linux-amd64" in url

    def test_download_handles_linux_aarch64(self):
        """[P1] Download URL correct for Linux aarch64."""
        with patch("core.tunnel.platform.system", return_value="Linux"), \
             patch("core.tunnel.platform.machine", return_value="aarch64"):
            url = _get_cloudflared_download_url()

        assert url is not None
        assert "cloudflared-linux-arm64" in url

    def test_download_returns_none_for_unsupported_platform(self):
        """[P1] Download returns None for unsupported platform (no crash)."""
        with patch("core.tunnel.platform.system", return_value="FreeBSD"), \
             patch("core.tunnel.platform.machine", return_value="x86_64"):
            url = _get_cloudflared_download_url()

        assert url is None

    def test_download_cloudflared_handles_exception_gracefully(self, tmp_path):
        """[P0] _download_cloudflared() returns None on network failure (no crash)."""
        with patch("core.tunnel._get_cloudflared_download_url",
                   return_value="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"), \
             patch("core.tunnel._get_data_dir", return_value=tmp_path), \
             patch("core.tunnel.urlretrieve", side_effect=OSError("Network unreachable")):
            result = _download_cloudflared()

        assert result is None

    def test_download_extracts_tgz_archive_for_macos(self, tmp_path):
        """[P1] _download_cloudflared() extracts cloudflared from .tgz archive on macOS."""
        import tarfile
        import io

        # Create a fake .tgz in a separate source directory to avoid SameFileError
        src_dir = tmp_path / "source"
        src_dir.mkdir()
        source_archive = src_dir / "cloudflared.tgz"
        with tarfile.open(str(source_archive), "w:gz") as tar:
            data = b"#!/bin/sh\necho fake cloudflared"
            info = tarfile.TarInfo(name="cloudflared")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))

        data_dir = tmp_path / "data"
        data_dir.mkdir()

        def fake_urlretrieve(url, dest):
            import shutil
            shutil.copy(str(source_archive), dest)

        with patch("core.tunnel._get_cloudflared_download_url",
                   return_value="https://github.com/.../cloudflared-darwin-arm64.tgz"), \
             patch("core.tunnel._get_data_dir", return_value=data_dir), \
             patch("core.tunnel.platform.system", return_value="Darwin"), \
             patch("core.tunnel.urlretrieve", side_effect=fake_urlretrieve):
            result = _download_cloudflared()

        assert result is not None
        assert (data_dir / "cloudflared").exists()

    def test_download_direct_binary_for_linux(self, tmp_path):
        """[P1] _download_cloudflared() saves direct binary on Linux."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        def fake_urlretrieve(url, dest):
            from pathlib import Path
            Path(dest).write_bytes(b"fake binary")

        with patch("core.tunnel._get_cloudflared_download_url",
                   return_value="https://github.com/.../cloudflared-linux-amd64"), \
             patch("core.tunnel._get_data_dir", return_value=data_dir), \
             patch("core.tunnel.platform.system", return_value="Linux"), \
             patch("core.tunnel.urlretrieve", side_effect=fake_urlretrieve):
            result = _download_cloudflared()

        assert result is not None
        assert (data_dir / "cloudflared").exists()


# ──────────────────────────────────────────────
# AC3: Clean subprocess termination on shutdown
# ──────────────────────────────────────────────

class TestAC3CleanShutdown:
    """AC3: Given the server is shutting down, When the tunnel subprocess is running,
    Then SIGTERM with 5-second timeout before force kill."""

    @pytest.mark.asyncio
    async def test_stop_tunnel_terminates_process(self):
        """[P0] stop_tunnel() sends terminate() (SIGTERM) to the subprocess."""
        mock_process = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = MagicMock()
        tunnel_mod._tunnel_process = mock_process
        tunnel_mod._tunnel_url = "https://test.trycloudflare.com"

        await stop_tunnel()

        mock_process.terminate.assert_called_once()

    @pytest.mark.asyncio
    async def test_stop_tunnel_waits_5_seconds(self):
        """[P0] stop_tunnel() waits up to 5 seconds for graceful exit."""
        mock_process = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = MagicMock()
        tunnel_mod._tunnel_process = mock_process
        tunnel_mod._tunnel_url = "https://test.trycloudflare.com"

        await stop_tunnel()

        mock_process.wait.assert_called_once_with(timeout=5)

    @pytest.mark.asyncio
    async def test_stop_tunnel_force_kills_on_timeout(self):
        """[P0] stop_tunnel() force-kills if process doesn't exit within 5 seconds."""
        mock_process = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = MagicMock(
            side_effect=subprocess.TimeoutExpired(cmd="cloudflared", timeout=5)
        )
        mock_process.kill = MagicMock()
        tunnel_mod._tunnel_process = mock_process
        tunnel_mod._tunnel_url = "https://test.trycloudflare.com"

        await stop_tunnel()

        mock_process.terminate.assert_called_once()
        mock_process.kill.assert_called_once()

    @pytest.mark.asyncio
    async def test_stop_tunnel_clears_global_state(self):
        """[P0] stop_tunnel() clears _tunnel_process and _tunnel_url."""
        mock_process = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = MagicMock()
        tunnel_mod._tunnel_process = mock_process
        tunnel_mod._tunnel_url = "https://test.trycloudflare.com"

        await stop_tunnel()

        assert tunnel_mod._tunnel_process is None
        assert tunnel_mod._tunnel_url is None
        assert get_tunnel_url() is None

    @pytest.mark.asyncio
    async def test_stop_tunnel_safe_when_no_tunnel_running(self):
        """[P0] stop_tunnel() is safe to call when no tunnel is running."""
        assert tunnel_mod._tunnel_process is None
        await stop_tunnel()  # Must not raise
        assert get_tunnel_url() is None


# ──────────────────────────────────────────────
# AC4 & AC5: Mobile signaling URL selection
# (Tested in mobile tests - server-side tests here verify QR payload)
# ──────────────────────────────────────────────


# ──────────────────────────────────────────────
# AC6: signaling_url format in QR payload
# ──────────────────────────────────────────────

class TestAC6SignalingUrlFormat:
    """AC6: Given a Quick Tunnel is active, signaling_url must be
    wss://<subdomain>.trycloudflare.com/ws/signaling."""

    @pytest.mark.asyncio
    async def test_generate_qr_code_produces_wss_signaling_url(self, monkeypatch):
        """[P0] generate_qr_code() converts HTTPS tunnel URL to WSS signaling_url in payload.

        Note: signaling_url is only included for temp connections.
        """
        import json
        from core.pairing import generate_token, generate_qr_code

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        token = await generate_token(connection_type="temp")

        captured: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured.append(obj)
            return original_dumps(obj, **kwargs)

        with patch("core.tunnel.get_tunnel_url",
                   return_value="https://my-tunnel-xyz.trycloudflare.com"), \
             patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(token)

        assert captured
        # Compact key "s" is used for signaling_url in temp connections
        assert captured[0]["s"] == "wss://my-tunnel-xyz.trycloudflare.com/ws/signaling"

    @pytest.mark.asyncio
    async def test_signaling_url_absent_when_no_tunnel(self, monkeypatch):
        """[P0] generate_qr_code() omits signaling_url when tunnel is inactive."""
        import json
        from core.pairing import generate_token, generate_qr_code

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        token = await generate_token()

        captured: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured.append(obj)
            return original_dumps(obj, **kwargs)

        with patch("core.tunnel.get_tunnel_url", return_value=None), \
             patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(token)

        assert captured
        assert "s" not in captured[0]


# ──────────────────────────────────────────────
# AC7: URL extraction from stderr with timeout
# ──────────────────────────────────────────────

class TestAC7UrlExtractionAndTimeout:
    """AC7: Tunnel URL extracted from cloudflared stderr via regex,
    with 30-second timeout if no URL detected."""

    def test_regex_matches_valid_trycloudflare_url(self):
        """[P0] Regex extracts valid trycloudflare.com URLs from cloudflared output."""
        line = "2026-03-09T10:00:00Z INF |  https://abc-def-123.trycloudflare.com  |"
        match = _TUNNEL_URL_RE.search(line)
        assert match is not None
        assert match.group(1) == "https://abc-def-123.trycloudflare.com"

    def test_regex_rejects_non_trycloudflare_urls(self):
        """[P0] Regex does NOT match non-trycloudflare.com URLs."""
        assert _TUNNEL_URL_RE.search("https://example.com") is None
        assert _TUNNEL_URL_RE.search("https://cloudflare.com") is None
        assert _TUNNEL_URL_RE.search("https://abc.nottrycloudflare.com") is None

    def test_regex_handles_various_subdomain_formats(self):
        """[P1] Regex handles hyphens, numbers, and mixed case subdomains.

        Quick Tunnel URLs always contain hyphens (multiple random words).
        Single-word subdomains like 'a' or 'api' are NOT tunnel URLs.
        """
        should_match = [
            "https://abc-def-123.trycloudflare.com",
            "https://UPPER-case.trycloudflare.com",
            "https://x1-y2-z3.trycloudflare.com",
        ]
        for url in should_match:
            match = _TUNNEL_URL_RE.search(f"INF {url}")
            assert match is not None, f"Regex should match: {url}"
            assert match.group(1) == url

        should_not_match = [
            "https://a.trycloudflare.com",
            "https://api.trycloudflare.com",
        ]
        for url in should_not_match:
            match = _TUNNEL_URL_RE.search(f"INF {url}")
            assert match is None, f"Regex should NOT match single-word subdomain: {url}"

    def test_startup_timeout_constant_is_30_seconds(self):
        """[P0] _STARTUP_TIMEOUT_SECONDS must equal 30."""
        assert _STARTUP_TIMEOUT_SECONDS == 30

    @pytest.mark.asyncio
    async def test_read_tunnel_url_returns_url_on_match(self):
        """[P0] _read_tunnel_url() returns URL when cloudflared prints it to stderr."""
        mock_process = MagicMock()
        mock_process.poll.return_value = None  # Process still running

        stderr_lines = [
            "2026-03-09 INF Starting tunnel\n",
            "2026-03-09 INF Registered connector\n",
            "2026-03-09 INF https://my-test-tunnel.trycloudflare.com\n",
        ]
        mock_process.stderr = MagicMock()
        mock_process.stderr.readline = MagicMock(side_effect=stderr_lines)

        result = await _read_tunnel_url(mock_process, timeout=30)
        assert result == "https://my-test-tunnel.trycloudflare.com"

    @pytest.mark.asyncio
    async def test_read_tunnel_url_returns_none_when_process_exits(self):
        """[P0] _read_tunnel_url() returns None if process exits before printing URL."""
        mock_process = MagicMock()
        mock_process.poll.return_value = 1  # Process exited
        mock_process.stderr = MagicMock()
        mock_process.stderr.readline = MagicMock(return_value="")

        result = await _read_tunnel_url(mock_process, timeout=5)
        assert result is None

    @pytest.mark.asyncio
    async def test_start_tunnel_stops_process_on_timeout(self):
        """[P0] If no URL detected within timeout, stop_tunnel() is called and None returned."""
        mock_process = MagicMock()
        mock_process.stdout = MagicMock()
        mock_process.stderr = MagicMock()
        mock_process.terminate = MagicMock()
        mock_process.wait = MagicMock()

        with patch("core.tunnel._ensure_cloudflared", return_value="/usr/bin/cloudflared"), \
             patch("core.tunnel.subprocess.Popen", return_value=mock_process), \
             patch("core.tunnel._read_tunnel_url", new_callable=AsyncMock, return_value=None):
            result = await start_tunnel(8000)

        assert result is None
        assert get_tunnel_url() is None
        # Verify cleanup was attempted
        mock_process.terminate.assert_called()


# ──────────────────────────────────────────────
# Cross-cutting: Graceful degradation
# ──────────────────────────────────────────────

class TestGracefulDegradation:
    """Cross-cutting: Server MUST NOT crash when cloudflared is unavailable."""

    @pytest.mark.asyncio
    async def test_no_crash_when_binary_not_found(self):
        """[P0] Server continues in LAN-only mode when cloudflared is not found."""
        with patch("core.tunnel._ensure_cloudflared", return_value=None):
            result = await start_tunnel(8000)

        assert result is None
        # Server should still be functional - no exceptions raised

    @pytest.mark.asyncio
    async def test_no_crash_when_subprocess_fails(self):
        """[P0] Server continues in LAN-only mode when cloudflared subprocess fails."""
        with patch("core.tunnel._ensure_cloudflared", return_value="/usr/bin/cloudflared"), \
             patch("core.tunnel.subprocess.Popen", side_effect=FileNotFoundError("not found")):
            result = await start_tunnel(8000)

        assert result is None
        assert get_tunnel_url() is None

    @pytest.mark.asyncio
    async def test_no_crash_when_unexpected_exception(self):
        """[P0] Server handles unexpected exceptions gracefully."""
        with patch("core.tunnel._ensure_cloudflared", return_value="/usr/bin/cloudflared"), \
             patch("core.tunnel.subprocess.Popen", side_effect=RuntimeError("unexpected")):
            result = await start_tunnel(8000)

        assert result is None

    def test_get_tunnel_url_returns_none_when_no_tunnel(self):
        """[P0] get_tunnel_url() returns None when no tunnel is running."""
        assert get_tunnel_url() is None
