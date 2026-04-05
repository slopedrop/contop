"""
Unit tests for tools/vision_client.py — VisionClient class.

Tests ground() with mocked OpenAI client to avoid real API calls.
Validates response parsing, error handling, and fallback behavior.

[Source: tech-spec-gui-agent-optimization.md — Task 21]
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.vision_client import VisionClient, UI_TARS_MODEL


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    """Return a VisionClient with a test API key."""
    c = VisionClient(api_key="sk-test-key-123")
    c._client = None
    return c


@pytest.fixture
def client_no_key():
    """Return a VisionClient with no API key."""
    return VisionClient(api_key="")


def _make_mock_openai(response):
    """Create a mock AsyncOpenAI client that returns the given response."""
    mock = MagicMock()
    mock.chat.completions.create = AsyncMock(return_value=response)
    return mock


def _make_response(content):
    """Create a mock OpenAI response with the given content."""
    mock_choice = MagicMock()
    mock_choice.message.content = content
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


# ---------------------------------------------------------------------------
# Tests: successful responses
# ---------------------------------------------------------------------------

class TestGroundSuccess:
    """Test successful grounding with mocked OpenAI responses."""

    @pytest.mark.asyncio
    async def test_ground_returns_parsed_result(self, client):
        """Successful response is parsed and returned."""
        response = _make_response("Button 'Submit' at (450, 320), Input 'Email' at (300, 200)")
        client._client = _make_mock_openai(response)
        result = await client.ground("base64data", "Find all buttons")

        assert result is not None
        assert result["source"] == UI_TARS_MODEL
        assert "Submit" in result["description"]

    @pytest.mark.asyncio
    async def test_ground_uses_correct_model(self, client):
        """Verifies the correct UI-TARS model is requested."""
        response = _make_response("element found")
        mock_openai = _make_mock_openai(response)
        client._client = mock_openai
        await client.ground("img_data", "Find buttons")

        call_kwargs = mock_openai.chat.completions.create.call_args[1]
        assert call_kwargs["model"] == UI_TARS_MODEL

    @pytest.mark.asyncio
    async def test_ground_passes_capture_size(self, client):
        """capture_size is forwarded and used for zone annotations."""
        response = _make_response("Search bar at (640, 30)")
        client._client = _make_mock_openai(response)
        result = await client.ground("img_data", "Find elements", capture_size=(1280, 720))

        assert result is not None
        # y=30 is in toolbar zone → should be annotated
        assert "BROWSER TOOLBAR" in result["description"]


# ---------------------------------------------------------------------------
# Tests: error handling
# ---------------------------------------------------------------------------

class TestGroundErrorHandling:
    """Test error handling: timeout, network, malformed responses."""

    @pytest.mark.asyncio
    async def test_missing_api_key_returns_none(self, client_no_key):
        """Empty API key -> immediate None return, no API call."""
        result = await client_no_key.ground("img_data", "Find buttons")
        assert result is None

    @pytest.mark.asyncio
    async def test_timeout_returns_none(self, client):
        """Request timeout -> returns None."""
        mock_openai = MagicMock()
        mock_openai.chat.completions.create = AsyncMock(
            side_effect=asyncio.TimeoutError()
        )
        client._client = mock_openai
        result = await client.ground("img_data", "Find buttons")
        assert result is None

    @pytest.mark.asyncio
    async def test_network_error_returns_none(self, client):
        """Network/connection error -> returns None."""
        mock_openai = MagicMock()
        mock_openai.chat.completions.create = AsyncMock(
            side_effect=ConnectionError("network unreachable")
        )
        client._client = mock_openai
        result = await client.ground("img_data", "Find buttons")
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_choices_returns_none(self, client):
        """Response with no choices -> returns None."""
        mock_response = MagicMock()
        mock_response.choices = []
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
        client._client = mock_client
        result = await client.ground("img_data", "Find buttons")
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_content_returns_none(self, client):
        """Response with empty content -> returns None."""
        response = _make_response("")
        client._client = _make_mock_openai(response)
        result = await client.ground("img_data", "Find buttons")
        assert result is None

    @pytest.mark.asyncio
    async def test_none_content_returns_none(self, client):
        """Response with None content -> returns None."""
        response = _make_response(None)
        client._client = _make_mock_openai(response)
        result = await client.ground("img_data", "Find buttons")
        assert result is None


# ---------------------------------------------------------------------------
# Tests: observe_screen integration
# ---------------------------------------------------------------------------

class TestObserveScreenUITarsIntegration:
    """Test that observe_screen uses UI-TARS when OpenRouter key is configured."""

    @pytest.mark.asyncio
    async def test_ui_tars_used_when_key_configured(self):
        """AC 14: When OpenRouter key configured, VisionClient.ground() is called BEFORE OmniParser."""
        mock_instance = AsyncMock()
        mock_instance.ground = AsyncMock(return_value={
            "action": "ground",
            "description": "Found 3 buttons",
            "source": UI_TARS_MODEL,
        })
        mock_tars = MagicMock(return_value=mock_instance)

        with patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)), \
             patch("core.agent_tools.get_omniparser") as mock_omni, \
             patch("core.settings.get_settings", return_value={"openrouter_api_key": "sk-test"}), \
             patch("tools.vision_client.VisionClient", mock_tars), \
             patch("core.agent_tools._vision_clients", {}):
            import core.agent_tools as at
            with patch.object(at, "VisionClient", mock_tars, create=True):
                result = await at.observe_screen()

        assert result["status"] == "success"
        assert "Found 3 buttons" in result["ui_elements"]

    @pytest.mark.asyncio
    async def test_omniparser_fallback_on_ui_tars_failure(self):
        """AC 15: When UI-TARS fails, falls back to OmniParser."""
        mock_parse_result = MagicMock()
        mock_parse_result.elements = [MagicMock()]
        mock_parse_result.annotated_image_b64 = "annotated_b64"
        mock_parse_result.describe_elements.return_value = "elements list"

        mock_tars = MagicMock()
        mock_tars.return_value.ground = AsyncMock(return_value=None)

        with patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)), \
             patch("core.agent_tools.get_omniparser") as mock_omni, \
             patch("core.settings.get_settings", return_value={"openrouter_api_key": "sk-test"}):
            mock_omni.return_value.parse = AsyncMock(return_value=mock_parse_result)
            mock_omni.return_value.get_loading_status.return_value = None
            import core.agent_tools as at
            with patch.object(at, "VisionClient", mock_tars, create=True):
                result = await at.observe_screen()

        assert result["status"] == "success"
        mock_omni.return_value.parse.assert_called_once()

    @pytest.mark.asyncio
    async def test_ui_tars_skipped_when_no_key(self):
        """AC 16: When no OpenRouter key, UI-TARS is skipped entirely."""
        mock_parse_result = MagicMock()
        mock_parse_result.elements = [MagicMock()]
        mock_parse_result.annotated_image_b64 = "annotated_b64"
        mock_parse_result.describe_elements.return_value = "elements list"

        with patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)), \
             patch("core.agent_tools.get_omniparser") as mock_omni, \
             patch("core.settings.get_settings", return_value={"openrouter_api_key": ""}):
            mock_omni.return_value.parse = AsyncMock(return_value=mock_parse_result)
            mock_omni.return_value.get_loading_status.return_value = None
            from core.agent_tools import observe_screen
            result = await observe_screen()

        assert result["status"] == "success"
        mock_omni.return_value.parse.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: zone annotation
# ---------------------------------------------------------------------------

class TestZoneAnnotation:
    """Test _annotate_zones post-processing of UI-TARS responses."""

    def test_toolbar_zone_annotation(self):
        """Coordinates with low y get BROWSER TOOLBAR label."""
        from tools.vision_client import VisionClient
        result = VisionClient._annotate_zones(
            "Search bar at (640, 30)", (1280, 720)
        )
        assert "[BROWSER TOOLBAR]" in result
        assert "(640, 30) [BROWSER TOOLBAR]" in result

    def test_page_content_zone_annotation(self):
        """Coordinates in the middle get PAGE CONTENT label."""
        from tools.vision_client import VisionClient
        result = VisionClient._annotate_zones(
            "Search input at (640, 150)", (1280, 720)
        )
        assert "[PAGE CONTENT]" in result
        assert "(640, 150) [PAGE CONTENT]" in result

    def test_taskbar_zone_annotation(self):
        """Coordinates at the bottom get SYSTEM TASKBAR label."""
        from tools.vision_client import VisionClient
        result = VisionClient._annotate_zones(
            "Start button at (30, 700)", (1280, 720)
        )
        assert "[SYSTEM TASKBAR]" in result
        assert "(30, 700) [SYSTEM TASKBAR]" in result

    def test_multiple_coordinates_annotated(self):
        """Multiple coordinate pairs each get their own zone label."""
        from tools.vision_client import VisionClient
        result = VisionClient._annotate_zones(
            "Address bar at (640, 30), YouTube search at (640, 150), "
            "Taskbar search at (200, 700)",
            (1280, 720),
        )
        assert result.count("[BROWSER TOOLBAR]") >= 1
        assert result.count("[PAGE CONTENT]") >= 1
        assert result.count("[SYSTEM TASKBAR]") >= 1

    def test_zone_legend_prepended(self):
        """A zone legend is prepended to the output."""
        from tools.vision_client import VisionClient
        result = VisionClient._annotate_zones("Button at (100, 300)", (1280, 720))
        assert result.startswith("[Screen zones")
        assert "BROWSER TOOLBAR" in result.split("\n")[0]

    def test_no_coordinates_passes_through(self):
        """Text without coordinate patterns passes through with legend only."""
        from tools.vision_client import VisionClient
        result = VisionClient._annotate_zones("No elements found", (1280, 720))
        assert "No elements found" in result
        assert "[Screen zones" in result
