"""
ATDD - Story 1.8: Desktop GUI Application Shell — QR Image Endpoint
API Tests for GET /api/qr-image

These tests validate the acceptance criterion:
  AC: GET /api/qr-image returns the last-generated QR code as a PNG image,
      or 404 if no active pairing token exists.

Endpoint under test:
  GET /api/qr-image  - Retrieve current QR code as PNG image

RED PHASE: All tests are expected to FAIL because the endpoint does not
exist yet.  Do NOT add skip markers — let them fail naturally.
"""

import pytest
from fastapi.testclient import TestClient

import core.pairing as pairing
from core.pairing import _token_registry, _device_token_map
from main import app


# --- PNG format constants ---
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@pytest.fixture(autouse=True)
def clear_registry():
    """Clear the token registry and cached QR before each test."""
    _token_registry.clear()
    _device_token_map.clear()
    pairing._last_qr_png = None
    yield
    _token_registry.clear()
    _device_token_map.clear()
    pairing._last_qr_png = None


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.mark.api
class TestGetQrImageAfterPairing:
    """1.8-API-001: GET /api/qr-image returns 200 with PNG after pairing"""

    def test_get_qr_image_returns_200_after_pairing(self, client):
        """[P0] GET /api/qr-image should return HTTP 200 after a successful POST /api/pair"""
        client.post("/api/pair")
        response = client.get("/api/qr-image")
        assert response.status_code == 200, (
            f"Expected 200 after pairing, got {response.status_code}"
        )

    def test_get_qr_image_content_type_is_png(self, client):
        """[P0] GET /api/qr-image Content-Type must be image/png after pairing"""
        client.post("/api/pair")
        response = client.get("/api/qr-image")
        content_type = response.headers.get("content-type", "")
        assert "image/png" in content_type, (
            f"Expected Content-Type 'image/png', got '{content_type}'"
        )


@pytest.mark.api
class TestGetQrImageBodyValidation:
    """1.8-API-002: GET /api/qr-image body is a valid, non-empty PNG"""

    def test_get_qr_image_body_is_valid_png(self, client):
        """[P1] GET /api/qr-image response body must start with the PNG signature"""
        client.post("/api/pair")
        response = client.get("/api/qr-image")
        body = response.content
        assert len(body) > 8, "Response body is too small to be a valid PNG"
        assert body[:8] == PNG_SIGNATURE, (
            f"Response body does not start with PNG signature; "
            f"got {body[:8]!r}"
        )

    def test_get_qr_image_body_is_not_empty(self, client):
        """[P1] GET /api/qr-image response body must have non-trivial size (>100 bytes)"""
        client.post("/api/pair")
        response = client.get("/api/qr-image")
        body = response.content
        assert len(body) > 100, (
            f"Expected QR PNG body >100 bytes, got {len(body)} bytes"
        )


@pytest.mark.api
class TestGetQrImageConsistency:
    """1.8-API-005: Multiple GET /api/qr-image calls return identical data"""

    def test_multiple_get_qr_image_returns_consistent_data(self, client):
        """[P0] Multiple GET /api/qr-image calls must return identical PNG data (no regeneration)"""
        client.post("/api/pair")
        first = client.get("/api/qr-image")
        second = client.get("/api/qr-image")
        third = client.get("/api/qr-image")
        assert first.content == second.content == third.content, (
            "Multiple GET /api/qr-image calls should return identical data"
        )


@pytest.mark.api
class TestGetQrImageWithoutToken:
    """1.8-API-003: GET /api/qr-image returns 404 when no active pairing token exists"""

    def test_get_qr_image_returns_404_without_token(self, client):
        """[P1] GET /api/qr-image without prior pairing must return 404 with error body"""
        response = client.get("/api/qr-image")
        assert response.status_code == 404, (
            f"Expected 404 when no active token, got {response.status_code}"
        )
        data = response.json()
        assert data.get("error") == "no_active_qr", (
            f"Expected error='no_active_qr' in 404 body, got {data!r}"
        )


@pytest.mark.api
class TestGetQrImageAfterRevocation:
    """1.8-API-004: GET /api/qr-image returns 404 after token revocation"""

    def test_get_qr_image_returns_404_after_revoke(self, client):
        """[P1] GET /api/qr-image must return 404 after POST /api/pair then DELETE /api/pair"""
        client.post("/api/pair")
        client.delete("/api/pair")

        response = client.get("/api/qr-image")
        assert response.status_code == 404, (
            f"Expected 404 after revocation, got {response.status_code}"
        )
        data = response.json()
        assert data.get("error") == "no_active_qr", (
            f"Expected error='no_active_qr' in 404 body, got {data!r}"
        )
