"""
ATDD - Story 1.1: Project Initialization & Infrastructure Scaffold
API Tests for health and root endpoints (GREEN PHASE)

These tests validate acceptance criteria:
  AC2: Host server initialized with FastAPI + dependencies
  AC3: Both environments build and run locally without errors
"""
import pytest


@pytest.mark.api
class TestHealthEndpointContract:
    """1.1-API-001 & 1.1-API-002: Health endpoint response contract"""

    def test_health_returns_200(self, client):
        """[P0] GET /health should return HTTP 200"""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_response_has_status_healthy(self, client):
        """[P0] GET /health response must include status='healthy'"""
        response = client.get("/health")
        data = response.json()
        assert "status" in data, "Health response missing 'status' field"
        assert data["status"] == "healthy"

    def test_health_response_has_service_name(self, client):
        """[P0] GET /health response must include service='contop-server'"""
        response = client.get("/health")
        data = response.json()
        assert "service" in data, "Health response missing 'service' field"
        assert data["service"] == "contop-server"

    def test_health_response_has_version(self, client):
        """[P0] GET /health response must include version='0.1.0'"""
        response = client.get("/health")
        data = response.json()
        assert "version" in data, "Health response missing 'version' field"
        assert data["version"] == "0.1.0"

    def test_health_response_content_type_is_json(self, client):
        """[P1] 1.1-INT-002: Health response Content-Type must be application/json"""
        response = client.get("/health")
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type


@pytest.mark.api
class TestRootEndpointContract:
    """1.1-API-003: Root endpoint response contract"""

    def test_root_returns_200(self, client):
        """[P1] GET / should return HTTP 200"""
        response = client.get("/")
        assert response.status_code == 200

    def test_root_response_has_service_name(self, client):
        """[P1] GET / response must include service='contop-server'"""
        response = client.get("/")
        data = response.json()
        assert "service" in data, "Root response missing 'service' field"
        assert data["service"] == "contop-server"

    def test_root_response_has_description(self, client):
        """[P1] GET / response must include a 'description' field"""
        response = client.get("/")
        data = response.json()
        assert "description" in data, "Root response missing 'description' field"
        assert len(data["description"]) > 0, "Description must not be empty"

    def test_root_response_has_health_endpoint(self, client):
        """[P1] GET / response must include health_endpoint='/health'"""
        response = client.get("/")
        data = response.json()
        assert "health_endpoint" in data, "Root response missing 'health_endpoint' field"
        assert data["health_endpoint"] == "/health"

    def test_root_response_content_type_is_json(self, client):
        """[P1] Root response Content-Type must be application/json"""
        response = client.get("/")
        content_type = response.headers.get("content-type", "")
        assert "application/json" in content_type
