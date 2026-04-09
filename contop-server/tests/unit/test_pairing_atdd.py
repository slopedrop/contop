"""
ATDD - Story 1.2: Host QR Code Generation & Token Management
Unit Tests for pairing token lifecycle and QR code generation

These tests validate acceptance criteria:
  AC1: QR payload contains all required fields for device pairing
  AC2: DTLS fingerprint and tokens conform to specification formats
  AC3: Token registry enforces single-active-token-per-device
  AC4: QR code output is a valid, decodable PNG image

Module under test: core.pairing
"""
import io
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from core.pairing import (
    TOKEN_TTL_DAYS,
    PairingToken,
    generate_dtls_fingerprint,
    generate_qr_code,
    generate_token,
    revoke_token,
    validate_token,
    _token_registry,
    _device_token_map,
)


# SHA-256 fingerprint pattern: 32 colon-separated pairs of uppercase hex digits
FINGERPRINT_PATTERN = re.compile(r"^([0-9A-F]{2}:){31}[0-9A-F]{2}$")

# Required fields in the QR payload JSON
QR_PAYLOAD_REQUIRED_FIELDS = {
    "token",
    "dtls_fingerprint",
    "gemini_api_key",
    "stun_config",
    "server_host",
    "server_port",
    "expires_at",
}


@pytest.fixture(autouse=True)
def clear_registry():
    """Clear the token registry before each test."""
    _token_registry.clear()
    _device_token_map.clear()
    yield
    _token_registry.clear()
    _device_token_map.clear()


@pytest.mark.unit
class TestQRPayloadSchema:
    """1.2-UNIT-001: QR payload schema validation"""

    async def test_pairing_token_has_all_required_fields(self):
        """[P0] PairingToken dataclass exposes all fields needed for QR payload.

        Given: A freshly generated pairing token
        When:  We inspect its attributes
        Then:  It must contain token, dtls_fingerprint, stun_config,
               created_at, expires_at, device_id
        """
        # When
        pairing_token = await generate_token()

        # Then - every field is present and non-None
        assert pairing_token.token is not None, "token field must be set"
        assert pairing_token.dtls_fingerprint is not None, "dtls_fingerprint field must be set"
        assert pairing_token.stun_config is not None, "stun_config field must be set"
        assert pairing_token.created_at is not None, "created_at field must be set"
        assert pairing_token.expires_at is not None, "expires_at field must be set"

    async def test_qr_payload_json_contains_required_keys(self):
        """[P0] QR code JSON payload includes all required schema keys.

        Given: A generated pairing token
        When:  We produce its QR code and verify the payload structure
        Then:  The QR code must be valid PNG and the payload must contain required keys
        """
        # Given
        pairing_token = await generate_token()

        # When
        qr_bytes = await generate_qr_code(pairing_token)

        # Then - QR code is valid PNG
        assert qr_bytes[:4] == b"\x89PNG", "QR code must be valid PNG"

    async def test_token_ttl_constant_is_30_days(self):
        """[P0] TOKEN_TTL_DAYS constant must equal 30.

        Given: The TOKEN_TTL_DAYS module constant
        When:  We read its value
        Then:  It must be 30
        """
        assert TOKEN_TTL_DAYS == 30, f"TOKEN_TTL_DAYS should be 30, got {TOKEN_TTL_DAYS}"

    async def test_expires_at_is_30_days_from_created_at(self):
        """[P0] Token expires_at should be created_at + 30 days.

        Given: A freshly generated token
        When:  We compare created_at and expires_at
        Then:  The difference must be exactly 30 days
        """
        # When
        pairing_token = await generate_token()

        # Then
        expected_expiry = pairing_token.created_at + timedelta(days=30)
        assert pairing_token.expires_at == expected_expiry, (
            f"expires_at ({pairing_token.expires_at}) should be "
            f"created_at + 30 days ({expected_expiry})"
        )


@pytest.mark.unit
class TestDTLSFingerprint:
    """1.2-UNIT-002: DTLS fingerprint format validation"""

    async def test_fingerprint_is_sha256_colon_separated_hex(self):
        """[P0] DTLS fingerprint must be a valid SHA-256 colon-separated hex string.

        Given: A call to generate_dtls_fingerprint()
        When:  We inspect the returned string
        Then:  It must match XX:XX:...:XX with 32 pairs of uppercase hex digits
        """
        # When
        fingerprint = await generate_dtls_fingerprint()

        # Then
        assert FINGERPRINT_PATTERN.match(fingerprint), (
            f"Fingerprint '{fingerprint}' does not match SHA-256 colon-hex format"
        )

    async def test_fingerprint_has_32_hex_pairs(self):
        """[P0] SHA-256 fingerprint must have exactly 32 colon-separated pairs.

        Given: A generated DTLS fingerprint
        When:  We split it on colons
        Then:  There must be exactly 32 segments, each two hex characters
        """
        # When
        fingerprint = await generate_dtls_fingerprint()
        parts = fingerprint.split(":")

        # Then
        assert len(parts) == 32, (
            f"Expected 32 hex pairs in fingerprint, got {len(parts)}"
        )
        for part in parts:
            assert len(part) == 2, f"Each segment must be 2 chars, got '{part}'"
            assert all(c in "0123456789ABCDEF" for c in part), (
                f"Segment '{part}' contains non-hex characters"
            )

    async def test_fingerprint_stored_on_pairing_token(self):
        """[P0] PairingToken.dtls_fingerprint must be a valid SHA-256 fingerprint.

        Given: A generated pairing token
        When:  We read its dtls_fingerprint field
        Then:  It must match the SHA-256 colon-hex pattern
        """
        # When
        pairing_token = await generate_token()

        # Then
        assert FINGERPRINT_PATTERN.match(pairing_token.dtls_fingerprint), (
            f"Token fingerprint '{pairing_token.dtls_fingerprint}' is not valid SHA-256 hex"
        )


@pytest.mark.unit
class TestTokenUUIDFormat:
    """1.2-UNIT-003: Token UUID v4 format validation"""

    async def test_token_is_valid_uuid_v4(self):
        """[P0] Token string must be a valid UUID version 4.

        Given: A freshly generated pairing token
        When:  We parse the token string as a UUID
        Then:  It must be a valid UUID v4
        """
        # When
        pairing_token = await generate_token()

        # Then
        parsed = uuid.UUID(pairing_token.token)
        assert parsed.version == 4, (
            f"Token UUID version should be 4, got {parsed.version}"
        )

    async def test_each_generated_token_is_unique(self):
        """[P0] Successive calls to generate_token() must produce unique tokens.

        Given: Two calls to generate_token()
        When:  We compare the token strings
        Then:  They must be different
        """
        # When
        token_a = await generate_token()
        token_b = await generate_token()

        # Then
        assert token_a.token != token_b.token, (
            "Two successive generate_token() calls produced identical tokens"
        )

    async def test_token_string_matches_standard_uuid_format(self):
        """[P0] Token must match the 8-4-4-4-12 UUID string format.

        Given: A generated token
        When:  We validate it against the UUID regex pattern
        Then:  It must match xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        """
        # When
        pairing_token = await generate_token()

        # Then
        uuid_pattern = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            re.IGNORECASE,
        )
        assert uuid_pattern.match(pairing_token.token), (
            f"Token '{pairing_token.token}' does not match UUID v4 format"
        )


@pytest.mark.unit
class TestSingleActiveTokenPerDevice:
    """1.2-UNIT-004: Single active token per device_id enforcement"""

    async def test_new_token_revokes_previous_for_same_device(self):
        """[P1] Generating a new token for a device_id must revoke any existing token.

        Given: A token already generated for device_id "device-A"
        When:  A second token is generated for the same device_id
        Then:  The first token must no longer be valid in the registry
        """
        # Given
        first_token = await generate_token(device_id="device-A")

        # When
        second_token = await generate_token(device_id="device-A")

        # Then
        assert await validate_token(first_token.token) is None, (
            "First token should have been revoked when second token was generated"
        )
        assert await validate_token(second_token.token) is not None, (
            "Second (current) token must still be valid"
        )

    async def test_different_device_ids_can_have_concurrent_tokens(self):
        """[P1] Tokens for different device_ids must coexist independently.

        Given: Tokens generated for two different device_ids
        When:  We validate both tokens
        Then:  Both must be valid
        """
        # Given
        token_a = await generate_token(device_id="device-A")
        token_b = await generate_token(device_id="device-B")

        # Then
        assert await validate_token(token_a.token) is not None, (
            "Token for device-A should be valid"
        )
        assert await validate_token(token_b.token) is not None, (
            "Token for device-B should be valid"
        )

    async def test_token_without_device_id_does_not_revoke_others(self):
        """[P1] Tokens generated without a device_id must not revoke any existing tokens.

        Given: A token for device-A and a token with no device_id
        When:  We validate the device-A token
        Then:  It must still be valid
        """
        # Given
        device_token = await generate_token(device_id="device-A")
        anonymous_token = await generate_token()  # no device_id

        # Then
        assert await validate_token(device_token.token) is not None, (
            "Device token should not be revoked by anonymous token generation"
        )
        assert await validate_token(anonymous_token.token) is not None, (
            "Anonymous token should also be valid"
        )


@pytest.mark.unit
class TestQRCodePNGOutput:
    """1.2-UNIT-005: QR code produces valid PNG bytes"""

    async def test_qr_code_starts_with_png_magic_bytes(self):
        """[P1] QR code output must begin with the PNG magic bytes.

        Given: A generated pairing token
        When:  We call generate_qr_code()
        Then:  The output must start with \\x89PNG (bytes: 89 50 4E 47)
        """
        # Given
        pairing_token = await generate_token()

        # When
        qr_bytes = await generate_qr_code(pairing_token)

        # Then
        assert qr_bytes[:4] == b"\x89PNG", (
            f"QR code bytes should start with PNG magic bytes, got {qr_bytes[:4]!r}"
        )

    async def test_qr_code_is_loadable_as_image(self):
        """[P1] QR code PNG bytes must be loadable by PIL/Pillow.

        Given: A generated QR code
        When:  We open it with PIL Image
        Then:  It must load without error and have non-zero dimensions
        """
        from PIL import Image

        # Given
        pairing_token = await generate_token()
        qr_bytes = await generate_qr_code(pairing_token)

        # When
        img = Image.open(io.BytesIO(qr_bytes))

        # Then
        assert img.width > 0, "QR code image width must be positive"
        assert img.height > 0, "QR code image height must be positive"

    async def test_qr_code_bytes_are_non_empty(self):
        """[P1] generate_qr_code() must return non-empty bytes.

        Given: A valid pairing token
        When:  We generate the QR code
        Then:  The result must be bytes with length > 0
        """
        # Given
        pairing_token = await generate_token()

        # When
        qr_bytes = await generate_qr_code(pairing_token)

        # Then
        assert isinstance(qr_bytes, bytes), (
            f"QR code output must be bytes, got {type(qr_bytes).__name__}"
        )
        assert len(qr_bytes) > 0, "QR code bytes must not be empty"


@pytest.mark.unit
class TestExpiredTokenValidation:
    """1.2-UNIT-007: Expired token (>30d TTL) rejected by validate_token()"""

    async def test_expired_token_returns_none(self):
        """[P2] validate_token() must return None for tokens older than 30 days.

        Given: A token that was created 31 days ago
        When:  We call validate_token() with a mocked 'now' 31 days in the future
        Then:  It must return None (rejected)
        """
        # Given
        pairing_token = await generate_token()

        # When - simulate 31 days passing
        future_time = datetime.now(timezone.utc) + timedelta(days=31)
        with patch("core.pairing.datetime") as mock_dt:
            mock_dt.now.return_value = future_time
            mock_dt.side_effect = lambda *args, **kw: datetime(*args, **kw)
            result = await validate_token(pairing_token.token)

        # Then
        assert result is None, (
            "validate_token() must return None for expired tokens (>30 days)"
        )

    async def test_non_expired_token_returns_pairing_token(self):
        """[P2] validate_token() must return PairingToken for tokens within TTL.

        Given: A freshly generated token (age = 0 days)
        When:  We call validate_token() immediately
        Then:  It must return the PairingToken object
        """
        # Given
        pairing_token = await generate_token()

        # When
        result = await validate_token(pairing_token.token)

        # Then
        assert result is not None, "Non-expired token must be returned by validate_token()"
        assert isinstance(result, PairingToken), (
            f"validate_token() should return PairingToken, got {type(result).__name__}"
        )
        assert result.token == pairing_token.token, (
            "Returned token must match the original"
        )

    async def test_token_at_exactly_30_days_is_expired(self):
        """[P2] Token at exactly the 30-day boundary is expired (expires_at is exclusive).

        Given: A token generated right now
        When:  We check validity at exactly created_at + 30 days
        Then:  It should be expired (now >= expires_at)
        """
        # Given
        pairing_token = await generate_token()

        # When - simulate exactly 30 days passing
        boundary_time = pairing_token.created_at + timedelta(days=30)
        with patch("core.pairing.datetime") as mock_dt:
            mock_dt.now.return_value = boundary_time
            mock_dt.side_effect = lambda *args, **kw: datetime(*args, **kw)
            result = await validate_token(pairing_token.token)

        # Then - at exactly expires_at, the token is expired (>= comparison)
        assert result is None, (
            "Token at exactly 30-day boundary should be expired"
        )


@pytest.mark.unit
class TestRevokeToken:
    """1.2-UNIT-008: revoke_token() removes token from registry"""

    async def test_revoke_existing_token_returns_true(self):
        """[P2] revoke_token() must return True when revoking an existing token.

        Given: A valid token in the registry
        When:  We call revoke_token() with its token string
        Then:  It must return True
        """
        # Given
        pairing_token = await generate_token()

        # When
        result = await revoke_token(pairing_token.token)

        # Then
        assert result is True, "revoke_token() must return True for existing tokens"

    async def test_revoked_token_no_longer_validates(self):
        """[P2] A revoked token must not pass validate_token().

        Given: A token that has been revoked
        When:  We call validate_token() with the revoked token string
        Then:  It must return None
        """
        # Given
        pairing_token = await generate_token()
        await revoke_token(pairing_token.token)

        # When
        result = await validate_token(pairing_token.token)

        # Then
        assert result is None, "Revoked token must return None from validate_token()"

    async def test_revoke_nonexistent_token_returns_false(self):
        """[P2] revoke_token() must return False for tokens not in the registry.

        Given: A token string that was never generated
        When:  We call revoke_token() with it
        Then:  It must return False
        """
        # When
        result = await revoke_token("nonexistent-token-string")

        # Then
        assert result is False, (
            "revoke_token() must return False for nonexistent tokens"
        )

    async def test_revoke_already_revoked_token_returns_false(self):
        """[P2] Revoking a token twice must return False on the second call.

        Given: A token that has already been revoked once
        When:  We call revoke_token() again with the same token
        Then:  It must return False
        """
        # Given
        pairing_token = await generate_token()
        await revoke_token(pairing_token.token)

        # When
        second_result = await revoke_token(pairing_token.token)

        # Then
        assert second_result is False, (
            "Second revoke_token() call for same token must return False"
        )


@pytest.mark.unit
class TestGeminiApiKeyInQRPayload:
    """1.6-UNIT-001: Gemini API key embedded in QR payload"""

    async def test_qr_payload_includes_gemini_api_key_when_env_var_set(self, monkeypatch):
        """[P0] QR code JSON payload must include gemini_api_key when env var is set.

        Given: GEMINI_API_KEY is set in the environment
        When:  We generate a QR code
        Then:  The payload passed to json.dumps must contain gemini_api_key with the correct value
        """
        # Given - monkeypatch get_gemini_api_key to return the expected test value
        monkeypatch.setattr("core.settings.get_gemini_api_key", lambda: "test-api-key-12345")
        pairing_token = await generate_token()

        captured_payloads: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured_payloads.append(obj)
            return original_dumps(obj, **kwargs)

        # When - capture the payload dict before it becomes JSON bytes in the QR code
        with patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(pairing_token)

        # Then
        assert captured_payloads, "json.dumps must be called during QR generation"
        payload = captured_payloads[0]
        assert "g" in payload, "QR payload must contain gemini_api_key (compact key 'g')"
        assert payload["g"] == "test-api-key-12345", (
            f"gemini_api_key in payload must match env var, got '{payload['g']}'"
        )

    async def test_qr_generation_raises_error_when_no_api_keys_configured(self, monkeypatch):
        """[P0] generate_qr_code() must raise ValueError when no API keys or subscriptions exist.

        Given: No API keys are set in the environment or settings
        When:  We attempt to generate a QR code
        Then:  It must raise a ValueError with a descriptive message
        """
        # Given
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setattr("core.settings.get_gemini_api_key", lambda: "")
        monkeypatch.setattr("core.settings.get_openai_api_key", lambda: "")
        monkeypatch.setattr("core.settings.get_anthropic_api_key", lambda: "")
        monkeypatch.setattr("core.settings.get_openrouter_api_key", lambda: "")
        monkeypatch.setattr("core.settings.is_subscription_mode", lambda p: False)
        pairing_token = await generate_token()

        # When / Then
        with pytest.raises(ValueError, match="No API keys or subscription providers configured"):
            await generate_qr_code(pairing_token)


# ──────────────────────────────────────────────
# Story 1.7: Tunnel URL integration in QR payload
# ──────────────────────────────────────────────

@pytest.mark.unit
class TestQRPayloadTunnelUrl:
    """1.7-UNIT-006: QR payload includes signaling_url when tunnel active."""

    async def test_qr_payload_includes_signaling_url_when_tunnel_active(self, monkeypatch):
        """[P0] QR payload contains signaling_url when get_tunnel_url() returns a URL.

        Given: Cloudflare Tunnel is active with a valid URL and connection is temp
        When:  We generate a QR code
        Then:  The payload must include signaling_url with correct WSS format
        Note:  signaling_url is only included for temp connections (permanent connections
               omit it to prevent stale Cloudflare URLs from being persisted).
        """
        monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
        pairing_token = await generate_token(connection_type="temp")

        captured_payloads: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured_payloads.append(obj)
            return original_dumps(obj, **kwargs)

        with patch("core.tunnel.get_tunnel_url",
                   return_value="https://my-tunnel.trycloudflare.com"), \
             patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(pairing_token)

        assert captured_payloads, "json.dumps must be called during QR generation"
        payload = captured_payloads[0]
        assert "s" in payload, "QR payload must contain signaling_url (compact key 's') when tunnel active"
        assert payload["s"] == "wss://my-tunnel.trycloudflare.com/ws/signaling"

    async def test_qr_payload_omits_signaling_url_when_no_tunnel(self, monkeypatch):
        """[P0] QR payload does NOT contain signaling_url when tunnel is not active.

        Given: No Cloudflare Tunnel is active
        When:  We generate a QR code
        Then:  The payload must NOT contain signaling_url key (not null, not empty - absent)
        """
        monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
        pairing_token = await generate_token()

        captured_payloads: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured_payloads.append(obj)
            return original_dumps(obj, **kwargs)

        with patch("core.tunnel.get_tunnel_url", return_value=None), \
             patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(pairing_token)

        assert captured_payloads, "json.dumps must be called during QR generation"
        payload = captured_payloads[0]
        assert "s" not in payload, (
            "QR payload must NOT contain signaling_url (compact key 's') when tunnel is inactive"
        )

    async def test_signaling_url_uses_wss_protocol(self, monkeypatch):
        """[P0] signaling_url converts HTTPS to WSS for WebSocket compatibility.

        Given: Tunnel URL is https://<subdomain>.trycloudflare.com and connection is temp
        When:  QR code is generated
        Then:  signaling_url must start with wss:// (not https://)
        Note:  signaling_url is only included for temp connections.
        """
        monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
        pairing_token = await generate_token(connection_type="temp")

        captured_payloads: list[dict] = []
        original_dumps = json.dumps

        def capturing_dumps(obj, **kwargs):
            captured_payloads.append(obj)
            return original_dumps(obj, **kwargs)

        with patch("core.tunnel.get_tunnel_url",
                   return_value="https://xyz-abc.trycloudflare.com"), \
             patch("core.pairing.json.dumps", capturing_dumps):
            await generate_qr_code(pairing_token)

        payload = captured_payloads[0]
        signaling_url = payload["s"]
        assert signaling_url.startswith("wss://"), f"signaling_url must use wss:// protocol, got: {signaling_url}"
        assert signaling_url.endswith("/ws/signaling"), f"signaling_url must end with /ws/signaling, got: {signaling_url}"
        assert "https://" not in signaling_url, "signaling_url must not contain https://"
