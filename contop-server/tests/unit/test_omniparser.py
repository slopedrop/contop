"""
Unit tests for OmniParser integration - client, element_id resolution,
and observe_screen enhancement.
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from tools.omniparser_client import (
    OmniParserClient,
    ParsedElement,
    ParseResult,
    get_omniparser,
)


# ---------------------------------------------------------------------------
# ParsedElement tests
# ---------------------------------------------------------------------------

class TestParsedElement:

    def test_center_coordinates(self):
        el = ParsedElement(
            element_id=0, type="icon", content="Save button",
            bbox=[0.1, 0.2, 0.3, 0.4], interactivity=True, source="icon_detection",
        )
        assert el.center_x == pytest.approx(0.2)
        assert el.center_y == pytest.approx(0.3)

    def test_center_full_screen(self):
        el = ParsedElement(
            element_id=1, type="text", content="Title",
            bbox=[0.0, 0.0, 1.0, 1.0], interactivity=False, source="ocr",
        )
        assert el.center_x == pytest.approx(0.5)
        assert el.center_y == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# ParseResult tests
# ---------------------------------------------------------------------------

class TestParseResult:

    def _make_result(self):
        return ParseResult(
            annotated_image_b64="annotated_img",
            elements=[
                ParsedElement(0, "icon", "File menu", [0.05, 0.01, 0.12, 0.04], True, "icon"),
                ParsedElement(1, "text", "Save", [0.2, 0.5, 0.3, 0.55], True, "ocr"),
                ParsedElement(2, "icon", "Logo", [0.45, 0.45, 0.55, 0.55], False, "icon"),
            ],
        )

    def test_get_element_by_id(self):
        result = self._make_result()
        el = result.get_element(1)
        assert el is not None
        assert el.content == "Save"

    def test_get_element_missing_returns_none(self):
        result = self._make_result()
        assert result.get_element(99) is None

    def test_describe_elements(self):
        result = self._make_result()
        desc = result.describe_elements()
        assert "[0] File menu" in desc
        assert "[1] Save" in desc
        assert "[2] Logo" in desc
        assert "interactive" in desc
        assert "static" in desc

    def test_describe_empty_elements(self):
        result = ParseResult(annotated_image_b64="", elements=[])
        assert "No UI elements detected" in result.describe_elements()


# ---------------------------------------------------------------------------
# OmniParserClient tests
# ---------------------------------------------------------------------------

class TestOmniParserClient:

    @pytest.mark.asyncio
    async def test_parse_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "som_image_base64": "annotated_b64",
            "parsed_content_list": [
                {"type": "icon", "content": "Button", "bbox": [0.1, 0.2, 0.3, 0.4],
                 "interactivity": True, "source": "icon_detection"},
            ],
            "latency": 0.5,
        }

        with patch("tools.omniparser_client.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(return_value=mock_response)
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=None)
            MockClient.return_value = mock_client_instance

            client = OmniParserClient("http://localhost:8090")
            result = await client.parse("fake_b64")

        assert result is not None
        assert len(result.elements) == 1
        assert result.elements[0].content == "Button"
        assert result.annotated_image_b64 == "annotated_b64"

    @pytest.mark.asyncio
    async def test_parse_connection_error_returns_none(self):
        import httpx
        with patch("tools.omniparser_client.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(side_effect=httpx.ConnectError("refused"))
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=None)
            MockClient.return_value = mock_client_instance

            client = OmniParserClient("http://localhost:9999")
            result = await client.parse("fake_b64")

        assert result is None

    @pytest.mark.asyncio
    async def test_parse_generic_error_returns_none(self):
        with patch("tools.omniparser_client.httpx.AsyncClient") as MockClient:
            mock_client_instance = AsyncMock()
            mock_client_instance.post = AsyncMock(side_effect=RuntimeError("boom"))
            mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
            mock_client_instance.__aexit__ = AsyncMock(return_value=None)
            MockClient.return_value = mock_client_instance

            client = OmniParserClient()
            result = await client.parse("fake_b64")

        assert result is None


# ---------------------------------------------------------------------------
# element_id resolution in agent_tools
# ---------------------------------------------------------------------------

class TestElementIdResolution:

    def test_resolve_element_id_to_coordinates(self):
        import core.agent_tools as at

        # Set up cached parse result
        at._latest_parse_result = ParseResult(
            annotated_image_b64="",
            elements=[
                ParsedElement(0, "icon", "Menu", [0.05, 0.02, 0.15, 0.05], True, "icon"),
                ParsedElement(1, "icon", "Save", [0.4, 0.4, 0.6, 0.6], True, "icon"),
            ],
        )
        at._latest_capture_size = (1280, 720)

        coords = at._resolve_element_id({"element_id": 1, "extra": "keep"})

        # element 1 center: (0.5, 0.5) * (1280, 720) = (640, 360)
        assert coords["x"] == 640
        assert coords["y"] == 360
        assert "element_id" not in coords
        assert coords["extra"] == "keep"  # Other keys preserved

        # Cleanup
        at._latest_parse_result = None

    def test_resolve_without_omniparser_passthrough(self):
        import core.agent_tools as at

        at._latest_parse_result = None
        coords = {"x": 100, "y": 200}
        result = at._resolve_element_id(coords)
        assert result == coords

    def test_resolve_missing_element_id_passthrough(self):
        import core.agent_tools as at

        at._latest_parse_result = ParseResult(
            annotated_image_b64="",
            elements=[ParsedElement(0, "icon", "X", [0, 0, 1, 1], True, "icon")],
        )
        at._latest_capture_size = (1280, 720)

        coords = {"element_id": 99}
        result = at._resolve_element_id(coords)
        assert result == coords  # Unchanged - element not found

        at._latest_parse_result = None

    def test_resolve_no_element_id_key_passthrough(self):
        import core.agent_tools as at

        coords = {"x": 50, "y": 60}
        result = at._resolve_element_id(coords)
        assert result == coords


# ---------------------------------------------------------------------------
# observe_screen with OmniParser
# ---------------------------------------------------------------------------

class TestObserveScreenWithOmniParser:

    @pytest.mark.asyncio
    async def test_observe_screen_with_omniparser(self):
        """When OmniParser returns elements, observe_screen includes ui_elements."""
        import core.agent_tools as at

        mock_parse_result = ParseResult(
            annotated_image_b64="annotated_img_b64",
            elements=[
                ParsedElement(0, "icon", "File", [0.05, 0.01, 0.12, 0.04], True, "icon"),
            ],
        )

        old_backend = at._active_vision_backend
        at._active_vision_backend = "omniparser"
        try:
            with patch.object(at, "_capture_screen_sync", return_value=("raw_img_b64", 1280, 720, 1920, 1080)), \
                 patch("core.settings.get_openrouter_api_key", return_value=""), \
                 patch("core.agent_tools.get_omniparser") as mock_get_client:
                mock_client = MagicMock()
                mock_client.parse = AsyncMock(return_value=mock_parse_result)
                mock_client.get_loading_status.return_value = None
                mock_get_client.return_value = mock_client

                result = await at.observe_screen()
        finally:
            at._active_vision_backend = old_backend

        assert result["status"] == "success"
        assert "ui_elements" in result
        assert "[0] File" in result["ui_elements"]

    @pytest.mark.asyncio
    async def test_observe_screen_without_omniparser(self):
        """When OmniParser is unavailable, observe_screen returns raw screenshot."""
        import core.agent_tools as at

        old_backend = at._active_vision_backend
        at._active_vision_backend = "omniparser"
        try:
            with patch.object(at, "_capture_screen_sync", return_value=("raw_img_b64", 1280, 720, 1920, 1080)), \
                 patch("core.settings.get_openrouter_api_key", return_value=""), \
                 patch("core.agent_tools.get_omniparser") as mock_get_client:
                mock_client = MagicMock()
                mock_client.parse = AsyncMock(return_value=None)
                mock_client.get_loading_status.return_value = None
                mock_get_client.return_value = mock_client

                result = await at.observe_screen()
        finally:
            at._active_vision_backend = old_backend

        assert result["status"] == "success"
        assert result["image_b64"] == "raw_img_b64"
        assert "ui_elements" not in result
