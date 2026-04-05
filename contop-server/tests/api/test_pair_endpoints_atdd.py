"""
ATDD - Story 1.2: Host QR Code Generation & Token Management
API Tests for pairing endpoints

These tests validate acceptance criteria:
  AC1: POST /api/pair generates a QR code PNG with embedded pairing payload
  AC2: Pairing token follows UUID v4 format with proper expiry
  AC3: Second pairing request for same device invalidates the first token
  AC4: Token status can be queried and tokens can be revoked

Endpoints under test:
  POST   /api/pair        - Initiate pairing, returns QR code PNG + token metadata
  GET    /api/pair/status  - Query current token status
  DELETE /api/pair        - Revoke active pairing token
"""
import re

import pytest
from fastapi.testclient import TestClient

from core.pairing import _token_registry, _device_token_map
from main import app


# --- PNG format constants ---
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@pytest.fixture(autouse=True)
def clear_registry():
    """Clear the token registry before each test."""
    _token_registry.clear()
    _device_token_map.clear()
    yield
    _token_registry.clear()
    _device_token_map.clear()


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.mark.api
class TestPostPairReturnsQRCode:
    """1.2-API-001: POST /api/pair returns 200 with QR code PNG image"""

    def test_post_pair_returns_200(self, client):
        """[P0] POST /api/pair should return HTTP 200 on success"""
        response = client.post("/api/pair")
        assert response.status_code == 200

    def test_post_pair_content_type_is_png(self, client):
        """[P0] POST /api/pair response Content-Type must be image/png"""
        response = client.post("/api/pair")
        content_type = response.headers.get("content-type", "")
        assert "image/png" in content_type, (
            f"Expected Content-Type 'image/png', got '{content_type}'"
        )

    def test_post_pair_body_is_valid_png(self, client):
        """[P0] POST /api/pair response body must be a valid PNG image"""
        response = client.post("/api/pair")
        body = response.content
        assert len(body) > 8, "Response body is too small to be a valid PNG"
        assert body[:8] == PNG_SIGNATURE, (
            f"Response body does not start with PNG signature; "
            f"got {body[:8]!r}"
        )

    def test_post_pair_returns_token_in_header(self, client):
        """[P0] POST /api/pair must return token metadata in response headers"""
        response = client.post("/api/pair")
        token_id = response.headers.get("x-pairing-token")
        assert token_id is not None, "Missing x-pairing-token header"
        uuid_v4_pattern = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            re.IGNORECASE,
        )
        assert uuid_v4_pattern.match(token_id), (
            f"x-pairing-token '{token_id}' is not a valid UUID v4"
        )

    def test_post_pair_returns_expires_at_in_header(self, client):
        """[P0] POST /api/pair must return expiry timestamp in response headers"""
        response = client.post("/api/pair")
        expires_at = response.headers.get("x-pairing-expires-at")
        assert expires_at is not None, "Missing x-pairing-expires-at header"
        iso8601_pattern = re.compile(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"
        )
        assert iso8601_pattern.match(expires_at), (
            f"x-pairing-expires-at '{expires_at}' is not valid ISO 8601"
        )


@pytest.mark.api
class TestPostPairTokenReuse:
    """1.2-API-002: POST /api/pair reuses existing permanent token for same device"""

    def test_second_pair_request_reuses_permanent_token(self, client):
        """[P0] Second POST /api/pair for same device must return the same token (reuse)"""
        first_response = client.post("/api/pair?device_id=test-device")
        first_token = first_response.headers.get("x-pairing-token")

        second_response = client.post("/api/pair?device_id=test-device")
        second_token = second_response.headers.get("x-pairing-token")

        assert second_response.status_code == 200
        assert first_token is not None
        assert second_token is not None
        assert first_token == second_token, (
            "Second pairing request should reuse existing permanent token"
        )

    def test_token_remains_valid_after_second_pair(self, client):
        """[P0] After second POST /api/pair for same device, the token must still be in registry"""
        first_response = client.post("/api/pair?device_id=test-device")
        first_token = first_response.headers.get("x-pairing-token")

        client.post("/api/pair?device_id=test-device")

        assert first_token in _token_registry, (
            "Token should still be in registry after reuse"
        )


@pytest.mark.api
class TestConsumedRevokedTokenRejection:
    """1.2-API-003: Revoked tokens are no longer in the registry"""

    def test_revoked_token_is_not_in_registry(self, client):
        """[P0] A revoked token must not exist in the token registry"""
        pair_response = client.post("/api/pair")
        token = pair_response.headers.get("x-pairing-token")
        client.delete("/api/pair")

        assert token not in _token_registry, (
            "Revoked token should not be in registry"
        )

    def test_revoked_token_replaced_on_new_pair(self, client):
        """[P0] After DELETE + new POST, old token must not be in registry"""
        first_response = client.post("/api/pair?device_id=dev-1")
        first_token = first_response.headers.get("x-pairing-token")
        client.delete("/api/pair")
        second_response = client.post("/api/pair?device_id=dev-1")
        second_token = second_response.headers.get("x-pairing-token")

        assert first_token not in _token_registry, (
            "Revoked token should not be in registry after new pairing"
        )
        assert first_token != second_token, (
            "New pairing after revocation should produce a different token"
        )

    def test_status_none_when_no_tokens(self, client):
        """[P0] Status returns 'none' when no tokens exist"""
        response = client.get("/api/pair/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "none", (
            f"Expected status 'none' when no tokens exist, got '{data.get('status')}'"
        )


@pytest.mark.api
class TestGetPairStatus:
    """1.2-API-004: GET /api/pair/status returns token status"""

    def test_status_returns_200(self, client):
        """[P1] GET /api/pair/status should return HTTP 200"""
        client.post("/api/pair")
        response = client.get("/api/pair/status")
        assert response.status_code == 200

    def test_status_content_type_is_json(self, client):
        """[P1] GET /api/pair/status Content-Type must be application/json"""
        client.post("/api/pair")
        response = client.get("/api/pair/status")
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type

    def test_active_token_status_is_active(self, client):
        """[P1] An active token must report status='active'"""
        client.post("/api/pair")
        response = client.get("/api/pair/status")
        data = response.json()
        assert "status" in data, "Status response missing 'status' field"
        assert data["status"] == "active", (
            f"Expected status 'active', got '{data['status']}'"
        )

    def test_status_does_not_expose_token_value(self, client):
        """[P1] Status response must NOT include the token value (AC: without exposing token)"""
        client.post("/api/pair")
        response = client.get("/api/pair/status")
        data = response.json()
        assert "token" not in data, "Status response must not expose token value"

    def test_status_response_includes_expires_at(self, client):
        """[P1] Status response must include expires_at in ISO 8601 format"""
        client.post("/api/pair")
        response = client.get("/api/pair/status")
        data = response.json()
        assert "expires_at" in data, "Status response missing 'expires_at' field"
        iso8601_pattern = re.compile(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"
        )
        assert iso8601_pattern.match(data["expires_at"]), (
            f"expires_at '{data['expires_at']}' is not valid ISO 8601"
        )

    def test_status_without_token_returns_none(self, client):
        """[P1] GET /api/pair/status with no active tokens returns status='none'"""
        response = client.get("/api/pair/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "none"


@pytest.mark.api
class TestDeletePairRevocation:
    """1.2-API-005: DELETE /api/pair revokes active token"""

    def test_delete_pair_returns_200(self, client):
        """[P1] DELETE /api/pair should return HTTP 200"""
        client.post("/api/pair")
        response = client.delete("/api/pair")
        assert response.status_code == 200

    def test_delete_pair_response_content_type_is_json(self, client):
        """[P1] DELETE /api/pair Content-Type must be application/json"""
        client.post("/api/pair")
        response = client.delete("/api/pair")
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type

    def test_delete_pair_confirms_revocation(self, client):
        """[P1] DELETE /api/pair response must confirm the token was revoked"""
        client.post("/api/pair")
        response = client.delete("/api/pair")
        data = response.json()
        assert data["revoked"] is True, (
            f"Expected revoked=True, got {data.get('revoked')}"
        )

    def test_delete_pair_token_no_longer_active(self, client):
        """[P1] After DELETE /api/pair, status should show no active token"""
        client.post("/api/pair")
        client.delete("/api/pair")
        status_response = client.get("/api/pair/status")
        data = status_response.json()
        assert data["status"] == "none", (
            f"Expected status 'none' after revocation, got '{data.get('status')}'"
        )

    def test_delete_pair_without_active_token(self, client):
        """[P1] DELETE /api/pair with no active token returns revoked=False"""
        response = client.delete("/api/pair")
        assert response.status_code == 200
        data = response.json()
        assert data["revoked"] is False, (
            "Expected revoked=False when no active token exists"
        )


@pytest.mark.api
class TestPostPairGeminiApiKey:
    """1.6-API-001: POST /api/pair behaviour with respect to GEMINI_API_KEY"""

    def test_post_pair_returns_500_when_no_api_keys_configured(self, client, monkeypatch, tmp_path):
        """[P0] POST /api/pair must return HTTP 500 when no API keys or subscriptions are configured.

        Given: No API keys are configured in the environment or settings
        When:  A client sends POST /api/pair
        Then:  The server must respond with HTTP 500 and a descriptive error body
        """
        # Given — isolate settings so all key getters fall through to env vars
        settings_file = tmp_path / ".contop" / "settings.json"
        monkeypatch.setattr("core.settings._resolve_settings_path", lambda: settings_file)
        monkeypatch.setattr("core.settings._cached_settings", None)
        monkeypatch.setattr("core.settings._cached_mtime", None)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

        # When
        response = client.post("/api/pair")

        # Then
        assert response.status_code == 500, (
            f"Expected 500 when no API keys are configured, got {response.status_code}"
        )
        data = response.json()
        assert "message" in data, "Error response must include 'message' field"
        assert "No API keys" in data["message"], (
            "Error message must mention missing API keys"
        )

    def test_post_pair_succeeds_when_gemini_api_key_set(self, client, monkeypatch):
        """[P0] POST /api/pair must return HTTP 200 when GEMINI_API_KEY env var is set.

        Given: GEMINI_API_KEY is properly configured in the environment
        When:  A client sends POST /api/pair
        Then:  The server must respond with HTTP 200 and a valid PNG QR code
        """
        # Given
        monkeypatch.setenv("GEMINI_API_KEY", "live-gemini-key-abc123")

        # When
        response = client.post("/api/pair")

        # Then
        assert response.status_code == 200, (
            f"Expected 200 when GEMINI_API_KEY is set, got {response.status_code}"
        )
        assert response.content[:4] == b"\x89PNG", (
            "Response body must be a valid PNG image"
        )
