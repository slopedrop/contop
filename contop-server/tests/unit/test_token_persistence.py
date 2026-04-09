"""
Unit tests for token persistence - save/load/round-trip, temp exclusion, expiry cleanup.

Module under test: core.pairing (save_tokens_to_disk, load_tokens_from_disk, generate_token)
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from core.pairing import (
    PairingToken,
    DEFAULT_STUN_CONFIG,
    _token_registry,
    _device_token_map,
    _tokens_path,
    save_tokens_to_disk,
    load_tokens_from_disk,
    generate_token,
    validate_token,
    get_token_status,
)


@pytest.fixture(autouse=True)
def clear_registry():
    """Clear the in-memory registry before and after each test."""
    _token_registry.clear()
    _device_token_map.clear()
    yield
    _token_registry.clear()
    _device_token_map.clear()


def _make_token(
    token: str = "test-token-1",
    connection_type: str = "permanent",
    device_id: str | None = "device-1",
    ttl_days: int = 30,
) -> PairingToken:
    """Helper to create a PairingToken without async DTLS generation."""
    now = datetime.now(timezone.utc)
    return PairingToken(
        token=token,
        dtls_fingerprint="AA:BB:CC:DD",
        stun_config=DEFAULT_STUN_CONFIG,
        created_at=now,
        expires_at=now + timedelta(days=ttl_days),
        device_id=device_id,
        connection_type=connection_type,
    )


def _make_expired_token(token: str = "expired-1", connection_type: str = "permanent") -> PairingToken:
    """Helper to create an already-expired PairingToken."""
    now = datetime.now(timezone.utc)
    return PairingToken(
        token=token,
        dtls_fingerprint="EE:FF:00:11",
        stun_config=DEFAULT_STUN_CONFIG,
        created_at=now - timedelta(days=31),
        expires_at=now - timedelta(days=1),
        device_id=None,
        connection_type=connection_type,
    )


@pytest.mark.unit
class TestSaveAndLoadTokens:
    """Round-trip permanent tokens through JSON persistence."""

    def test_save_and_load_round_trip(self, tmp_path):
        """Permanent token survives save → clear → load cycle."""
        tokens_file = tmp_path / "tokens.json"
        pt = _make_token()
        _token_registry[pt.token] = pt
        _device_token_map[pt.device_id] = pt.token

        with patch("core.pairing._tokens_path", return_value=tokens_file), \
             patch("core.pairing.save_tokens_to_disk", wraps=save_tokens_to_disk) as mock_save:
            # Direct call (wraps= means original runs)
            save_tokens_to_disk()

        assert tokens_file.exists()
        data = json.loads(tokens_file.read_text(encoding="utf-8"))
        assert len(data["tokens"]) == 1
        assert data["tokens"][0]["token"] == "test-token-1"
        assert data["tokens"][0]["connection_type"] == "permanent"

        # Clear and reload
        _token_registry.clear()
        _device_token_map.clear()

        with patch("core.pairing._tokens_path", return_value=tokens_file):
            loaded = load_tokens_from_disk()

        assert loaded == 1
        assert "test-token-1" in _token_registry
        assert _token_registry["test-token-1"].connection_type == "permanent"
        assert _device_token_map.get("device-1") == "test-token-1"

    def test_temp_tokens_not_persisted(self, tmp_path):
        """Temp tokens are excluded from disk persistence."""
        tokens_file = tmp_path / "tokens.json"
        perm = _make_token(token="perm-1", connection_type="permanent")
        temp = _make_token(token="temp-1", connection_type="temp", device_id="device-2")
        _token_registry[perm.token] = perm
        _token_registry[temp.token] = temp

        with patch("core.pairing._tokens_path", return_value=tokens_file), \
             patch("core.settings._ensure_contop_dir"):
            save_tokens_to_disk()

        data = json.loads(tokens_file.read_text(encoding="utf-8"))
        assert len(data["tokens"]) == 1
        assert data["tokens"][0]["token"] == "perm-1"

    def test_expired_tokens_cleaned_on_load(self, tmp_path):
        """Expired entries are discarded during load."""
        tokens_file = tmp_path / "tokens.json"
        now = datetime.now(timezone.utc)

        tokens_data = {
            "tokens": [
                {
                    "token": "valid-1",
                    "dtls_fingerprint": "AA:BB",
                    "stun_config": DEFAULT_STUN_CONFIG,
                    "created_at": now.isoformat(),
                    "expires_at": (now + timedelta(days=10)).isoformat(),
                    "device_id": "dev-a",
                    "connection_type": "permanent",
                },
                {
                    "token": "expired-1",
                    "dtls_fingerprint": "CC:DD",
                    "stun_config": DEFAULT_STUN_CONFIG,
                    "created_at": (now - timedelta(days=31)).isoformat(),
                    "expires_at": (now - timedelta(days=1)).isoformat(),
                    "device_id": "dev-b",
                    "connection_type": "permanent",
                },
            ]
        }
        tokens_file.write_text(json.dumps(tokens_data), encoding="utf-8")

        with patch("core.pairing._tokens_path", return_value=tokens_file):
            loaded = load_tokens_from_disk()

        assert loaded == 1
        assert "valid-1" in _token_registry
        assert "expired-1" not in _token_registry

    def test_load_returns_zero_when_file_missing(self, tmp_path):
        """Missing tokens.json returns 0 loaded."""
        tokens_file = tmp_path / "tokens.json"
        with patch("core.pairing._tokens_path", return_value=tokens_file):
            loaded = load_tokens_from_disk()
        assert loaded == 0

    def test_load_handles_malformed_json(self, tmp_path):
        """Malformed JSON returns 0 loaded without crashing."""
        tokens_file = tmp_path / "tokens.json"
        tokens_file.write_text("not valid json", encoding="utf-8")
        with patch("core.pairing._tokens_path", return_value=tokens_file):
            loaded = load_tokens_from_disk()
        assert loaded == 0

    def test_load_skips_malformed_entries(self, tmp_path):
        """Entries missing required fields are skipped."""
        tokens_file = tmp_path / "tokens.json"
        now = datetime.now(timezone.utc)
        tokens_data = {
            "tokens": [
                {"token": "bad-entry"},  # Missing required fields
                {
                    "token": "good-1",
                    "dtls_fingerprint": "AA:BB",
                    "stun_config": DEFAULT_STUN_CONFIG,
                    "created_at": now.isoformat(),
                    "expires_at": (now + timedelta(days=10)).isoformat(),
                    "connection_type": "permanent",
                },
            ]
        }
        tokens_file.write_text(json.dumps(tokens_data), encoding="utf-8")
        with patch("core.pairing._tokens_path", return_value=tokens_file):
            loaded = load_tokens_from_disk()
        assert loaded == 1
        assert "good-1" in _token_registry


@pytest.mark.unit
class TestConnectionTypeOnToken:
    """connection_type field is set correctly on generated tokens."""

    @pytest.mark.asyncio
    async def test_generate_permanent_token(self):
        """Default generate_token() produces a permanent token with 30-day TTL."""
        pt = await generate_token(device_id="dev-1", connection_type="permanent")
        assert pt.connection_type == "permanent"
        ttl = pt.expires_at - pt.created_at
        assert ttl.days >= 29  # 30 days minus any sub-second rounding

    @pytest.mark.asyncio
    async def test_generate_temp_token(self):
        """Temp token has ~4 hour TTL."""
        pt = await generate_token(device_id="dev-2", connection_type="temp")
        assert pt.connection_type == "temp"
        ttl = pt.expires_at - pt.created_at
        assert ttl.total_seconds() <= 4 * 3600 + 60  # 4 hours + small tolerance
        assert ttl.total_seconds() >= 4 * 3600 - 60

    @pytest.mark.asyncio
    async def test_permanent_token_auto_saves(self, tmp_path):
        """Generating a permanent token triggers save_tokens_to_disk()."""
        tokens_file = tmp_path / "tokens.json"
        with patch("core.pairing._tokens_path", return_value=tokens_file), \
             patch("core.settings._ensure_contop_dir"):
            pt = await generate_token(device_id="dev-1", connection_type="permanent")

        assert tokens_file.exists()
        data = json.loads(tokens_file.read_text(encoding="utf-8"))
        assert len(data["tokens"]) == 1

    @pytest.mark.asyncio
    async def test_temp_token_does_not_save(self, tmp_path):
        """Generating a temp token does NOT write to disk."""
        tokens_file = tmp_path / "tokens.json"
        with patch("core.pairing._tokens_path", return_value=tokens_file), \
             patch("core.settings._ensure_contop_dir"):
            pt = await generate_token(device_id="dev-2", connection_type="temp")

        assert not tokens_file.exists()


@pytest.mark.unit
class TestTokenStatus:
    """get_token_status() includes connection_type."""

    def test_status_includes_connection_type(self):
        """Active token status includes connection_type field."""
        pt = _make_token(connection_type="permanent")
        _token_registry[pt.token] = pt
        status = get_token_status()
        assert status["status"] == "active"
        assert status["connection_type"] == "permanent"

    def test_status_temp_token(self):
        """Temp token status shows connection_type='temp'."""
        pt = _make_token(token="t-1", connection_type="temp")
        _token_registry[pt.token] = pt
        status = get_token_status()
        assert status["connection_type"] == "temp"


@pytest.mark.unit
class TestReusePermanentToken:
    """POST /api/pair reuses existing valid permanent token."""

    @pytest.mark.asyncio
    async def test_reuse_existing_valid_permanent(self, tmp_path):
        """If a valid permanent token exists for the device, generate_token revokes the old one."""
        tokens_file = tmp_path / "tokens.json"
        with patch("core.pairing._tokens_path", return_value=tokens_file), \
             patch("core.settings._ensure_contop_dir"):
            first = await generate_token(device_id="dev-1", connection_type="permanent")
            second = await generate_token(device_id="dev-1", connection_type="permanent")

        # Old token should be revoked
        assert first.token not in _token_registry
        assert second.token in _token_registry
        assert _device_token_map["dev-1"] == second.token
