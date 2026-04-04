"""
Unit tests for main.py API endpoints.

Tests the /api/connection-info endpoint response shape and content.
Module under test: main

NOTE: Patches target "main._get_local_ip" etc. because main.py imports these
names at module scope (`from core.pairing import _get_local_ip`). If the import
style changes, these patch targets must be updated accordingly.
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestConnectionInfoEndpoint:
    """Tests for GET /api/connection-info."""

    def test_returns_correct_shape(self, client):
        """Verify response contains all required keys."""
        with patch("main._get_local_ip", return_value="192.168.1.10"), \
             patch("main._get_tailscale_ip", return_value=None), \
             patch("main.get_tunnel_url", return_value=None), \
             patch("main._active_peers", {}):
            resp = client.get("/api/connection-info")
        assert resp.status_code == 200
        data = resp.json()
        assert "lan_ip" in data
        assert "tailscale_ip" in data
        assert "tailscale_available" in data
        assert "tunnel_url" in data
        assert "tunnel_active" in data
        assert "connected_clients" in data

    def test_without_tailscale(self, client):
        """Verify correct values when Tailscale is not installed."""
        with patch("main._get_local_ip", return_value="192.168.1.10"), \
             patch("main._get_tailscale_ip", return_value=None), \
             patch("main.get_tunnel_url", return_value=None), \
             patch("main._active_peers", {}):
            resp = client.get("/api/connection-info")
        data = resp.json()
        assert data["lan_ip"] == "192.168.1.10"
        assert data["tailscale_ip"] is None
        assert data["tailscale_available"] is False
        assert data["tunnel_url"] is None
        assert data["tunnel_active"] is False
        assert data["connected_clients"] == 0

    def test_with_tailscale(self, client):
        """Verify correct values when Tailscale is available."""
        with patch("main._get_local_ip", return_value="192.168.1.10"), \
             patch("main._get_tailscale_ip", return_value="100.64.0.5"), \
             patch("main.get_tunnel_url", return_value=None), \
             patch("main._active_peers", {}):
            resp = client.get("/api/connection-info")
        data = resp.json()
        assert data["tailscale_ip"] == "100.64.0.5"
        assert data["tailscale_available"] is True

    def test_with_tunnel(self, client):
        """Verify correct values when tunnel is active."""
        with patch("main._get_local_ip", return_value="192.168.1.10"), \
             patch("main._get_tailscale_ip", return_value=None), \
             patch("main.get_tunnel_url", return_value="https://abc123.trycloudflare.com"), \
             patch("main._active_peers", {}):
            resp = client.get("/api/connection-info")
        data = resp.json()
        assert data["tunnel_url"] == "https://abc123.trycloudflare.com"
        assert data["tunnel_active"] is True

    def test_client_count(self, client):
        """Verify connected_clients reflects active peers count."""
        fake_peers = {"token1": "peer1", "token2": "peer2"}
        with patch("main._get_local_ip", return_value="192.168.1.10"), \
             patch("main._get_tailscale_ip", return_value=None), \
             patch("main.get_tunnel_url", return_value=None), \
             patch("main._active_peers", fake_peers):
            resp = client.get("/api/connection-info")
        data = resp.json()
        assert data["connected_clients"] == 2
