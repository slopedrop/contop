"""
ATDD - Story 1.9: Settings Persistence & Configuration Panel
API Tests for settings REST endpoints

These tests validate acceptance criteria:
  AC3: Modified settings are accessible via API and hot-reload without restart

Endpoints under test:
  GET    /api/settings       - Returns current settings JSON
  PUT    /api/settings       - Updates settings, returns updated JSON
  POST   /api/settings/reset - Resets to defaults, returns default JSON
"""
import json

import pytest
from fastapi.testclient import TestClient

from core.settings import DEFAULT_SETTINGS, _resolve_settings_path
from main import app


@pytest.fixture(autouse=True)
def isolate_settings_file(tmp_path, monkeypatch):
    """Redirect settings file to tmp_path so API tests never touch ~/.contop/."""
    settings_file = tmp_path / ".contop" / "settings.json"
    monkeypatch.setattr("core.settings._resolve_settings_path", lambda: settings_file)
    monkeypatch.setattr("core.settings._cached_settings", None)
    monkeypatch.setattr("core.settings._cached_mtime", None)
    yield settings_file


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.mark.api
class TestGetSettingsEndpoint:
    """1.9-API-001: GET /api/settings returns current settings"""

    def test_get_settings_returns_current(self, client):
        """[P0] GET /api/settings must return 200 with valid settings schema.

        Given: The server is running (default settings will be created if absent)
        When:  GET /api/settings is called
        Then:  Response must be 200 with JSON containing version, restricted_paths, forbidden_commands
        """
        # When
        response = client.get("/api/settings")

        # Then
        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}"
        )
        data = response.json()
        assert "version" in data, "Settings response must contain 'version'"
        assert "restricted_paths" in data, "Settings response must contain 'restricted_paths'"
        assert "forbidden_commands" in data, "Settings response must contain 'forbidden_commands'"
        assert isinstance(data["restricted_paths"], list), "restricted_paths must be a list"
        assert isinstance(data["forbidden_commands"], list), "forbidden_commands must be a list"


@pytest.mark.api
class TestPutSettingsEndpoint:
    """1.9-API-002: PUT /api/settings updates and returns settings"""

    def test_put_settings_updates(self, client):
        """[P0] PUT /api/settings with valid body must persist changes.

        Given: Server running with default settings
        When:  PUT /api/settings with a valid body containing updated paths
        Then:  Response must be 200 with updated values
        And:   Subsequent GET must reflect the changes
        """
        # Given — ensure defaults exist
        client.get("/api/settings")

        # When
        updated = {
            "version": 1,
            "restricted_paths": ["/updated/path"],
            "forbidden_commands": ["updated-cmd"],
        }
        put_response = client.put("/api/settings", json=updated)

        # Then
        assert put_response.status_code == 200, (
            f"Expected 200 on PUT, got {put_response.status_code}"
        )
        put_data = put_response.json()
        assert put_data["restricted_paths"] == ["/updated/path"], (
            f"PUT response must reflect updated paths, got {put_data['restricted_paths']}"
        )

        # Verify GET returns updated values
        get_response = client.get("/api/settings")
        get_data = get_response.json()
        assert get_data["restricted_paths"] == ["/updated/path"], (
            f"GET after PUT must reflect updated paths, got {get_data['restricted_paths']}"
        )

    def test_put_settings_rejects_invalid(self, client):
        """[P0] PUT /api/settings with missing required keys must return 400.

        Given: Server running
        When:  PUT /api/settings with body missing 'restricted_paths'
        Then:  Response must be 400 with error message
        """
        # When
        invalid = {"version": 1, "forbidden_commands": ["cmd"]}
        response = client.put("/api/settings", json=invalid)

        # Then
        assert response.status_code == 400, (
            f"Expected 400 for missing keys, got {response.status_code}"
        )
        data = response.json()
        assert "error" in data, "Error response must contain 'error' field"


@pytest.mark.api
class TestPostSettingsResetEndpoint:
    """1.9-API-003: POST /api/settings/reset restores defaults"""

    def test_post_settings_reset(self, client):
        """[P1] POST /api/settings/reset must restore DEFAULT_SETTINGS.

        Given: Custom settings have been saved via PUT
        When:  POST /api/settings/reset is called
        Then:  Response must be 200 with DEFAULT_SETTINGS values
        And:   Subsequent GET must return defaults
        """
        # Given — save custom settings
        custom = {
            "version": 1,
            "restricted_paths": ["/custom"],
            "forbidden_commands": ["custom"],
        }
        client.put("/api/settings", json=custom)

        # When
        reset_response = client.post("/api/settings/reset")

        # Then
        assert reset_response.status_code == 200, (
            f"Expected 200 on reset, got {reset_response.status_code}"
        )
        reset_data = reset_response.json()
        assert reset_data == DEFAULT_SETTINGS, (
            f"Reset must return DEFAULT_SETTINGS, got {reset_data}"
        )

        # Verify GET returns defaults
        get_response = client.get("/api/settings")
        get_data = get_response.json()
        assert get_data == DEFAULT_SETTINGS, (
            f"GET after reset must return DEFAULT_SETTINGS, got {get_data}"
        )
