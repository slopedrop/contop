"""
Unit tests for Tailscale IP detection and QR payload integration.

Tests _get_tailscale_ip() function and tailscale_host inclusion in QR payload.
Module under test: core.pairing
"""
import json
import socket
from unittest.mock import patch, MagicMock

import pytest

from core.pairing import (
    _get_tailscale_ip,
    _generate_qr_code_sync,
    generate_token,
    generate_qr_code,
    _token_registry,
    _device_token_map,
)


@pytest.fixture(autouse=True)
def clear_registry():
    """Clear the token registry before each test."""
    _token_registry.clear()
    _device_token_map.clear()
    yield
    _token_registry.clear()
    _device_token_map.clear()


@pytest.mark.unit
class TestGetTailscaleIp:
    """Tailscale IP detection via CLI and network interface fallback."""

    def test_returns_ip_from_tailscale_cli(self):
        """CLI `tailscale ip -4` returns a valid IP."""
        with patch("core.pairing.shutil.which", return_value="/usr/bin/tailscale"), \
             patch("core.pairing.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="100.64.0.2\n")
            result = _get_tailscale_ip()
        assert result == "100.64.0.2"

    def test_returns_none_when_cli_not_found(self):
        """No tailscale binary on PATH → None."""
        with patch("core.pairing.shutil.which", return_value=None), \
             patch("core.pairing.subprocess.run") as mock_run:
            # psutil fallback also unavailable
            with patch.dict("sys.modules", {"psutil": None}):
                result = _get_tailscale_ip()
        assert result is None
        mock_run.assert_not_called()

    def test_returns_none_when_cli_returns_nonzero(self):
        """CLI exits with error (Tailscale not running) → None."""
        with patch("core.pairing.shutil.which", return_value="/usr/bin/tailscale"), \
             patch("core.pairing.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="")
            with patch.dict("sys.modules", {"psutil": None}):
                result = _get_tailscale_ip()
        assert result is None

    def test_returns_none_when_cli_times_out(self):
        """CLI hangs → subprocess.TimeoutExpired → None."""
        import subprocess
        with patch("core.pairing.shutil.which", return_value="/usr/bin/tailscale"), \
             patch("core.pairing.subprocess.run", side_effect=subprocess.TimeoutExpired("tailscale", 2)):
            with patch.dict("sys.modules", {"psutil": None}):
                result = _get_tailscale_ip()
        assert result is None

    def test_falls_back_to_psutil_network_interfaces(self):
        """CLI not available but psutil finds a 100.x interface."""
        mock_psutil = MagicMock()
        mock_addr = MagicMock()
        mock_addr.family = socket.AF_INET
        mock_addr.address = "100.100.50.1"
        mock_psutil.net_if_addrs.return_value = {"tailscale0": [mock_addr]}

        with patch("core.pairing.shutil.which", return_value=None), \
             patch.dict("sys.modules", {"psutil": mock_psutil}):
            # Force re-import of psutil inside the function
            import importlib
            import core.pairing
            # Call the function — it will import psutil from sys.modules
            result = _get_tailscale_ip()
        assert result == "100.100.50.1"

    def test_ignores_non_tailscale_100_addresses(self):
        """100.0.x.x is not in the Tailscale CGNAT range (100.64-127)."""
        mock_psutil = MagicMock()
        mock_addr = MagicMock()
        mock_addr.family = socket.AF_INET
        mock_addr.address = "100.0.0.1"
        mock_psutil.net_if_addrs.return_value = {"eth0": [mock_addr]}

        with patch("core.pairing.shutil.which", return_value=None), \
             patch.dict("sys.modules", {"psutil": mock_psutil}):
            result = _get_tailscale_ip()
        assert result is None


@pytest.mark.unit
class TestQRPayloadTailscaleHost:
    """QR payload includes/excludes tailscale_host based on Tailscale availability."""

    async def test_qr_payload_includes_tailscale_host_when_available(self, monkeypatch):
        """[P0] AC-6: QR payload includes tailscale_host when Tailscale is running."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
        pairing_token = await generate_token()

        captured_payloads: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured_payloads.append(obj)
            return original_dumps(obj, **kwargs)

        with patch("core.pairing._get_tailscale_ip", return_value="100.64.0.2"), \
             patch("core.tunnel.get_tunnel_url", return_value=None), \
             patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(pairing_token)

        assert captured_payloads
        payload = captured_payloads[0]
        assert "ts" in payload
        assert payload["ts"] == "100.64.0.2"

    async def test_qr_payload_omits_tailscale_host_when_not_available(self, monkeypatch):
        """[P0] AC-7: QR payload does NOT include tailscale_host when Tailscale is not running."""
        monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
        pairing_token = await generate_token()

        captured_payloads: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured_payloads.append(obj)
            return original_dumps(obj, **kwargs)

        with patch("core.pairing._get_tailscale_ip", return_value=None), \
             patch("core.tunnel.get_tunnel_url", return_value=None), \
             patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(pairing_token)

        assert captured_payloads
        payload = captured_payloads[0]
        assert "ts" not in payload
