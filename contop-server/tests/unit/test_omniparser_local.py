"""
Unit tests for OmniParserLocal - in-process OmniParser V2.

Tests verify model loading, the parse pipeline, deduplication logic,
annotation drawing, and the OmniParserRouter fallback behavior.
"""
import base64
import io
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import numpy as np
import pytest
from PIL import Image

from tools.omniparser_client import (
    OmniParserRouter,
    ParsedElement,
    ParseResult,
    get_omniparser,
)


# ---------------------------------------------------------------------------
# OmniParserLocal geometry helpers
# ---------------------------------------------------------------------------

class TestGeometryHelpers:

    def setup_method(self):
        from tools.omniparser_local import OmniParserLocal
        self.parser = OmniParserLocal()

    def test_box_area(self):
        assert self.parser._box_area([0.0, 0.0, 1.0, 1.0]) == pytest.approx(1.0)
        assert self.parser._box_area([0.1, 0.2, 0.3, 0.4]) == pytest.approx(0.04)
        assert self.parser._box_area([0.5, 0.5, 0.5, 0.5]) == pytest.approx(0.0)

    def test_intersection_area(self):
        # Full overlap
        assert self.parser._intersection_area(
            [0, 0, 1, 1], [0, 0, 1, 1]
        ) == pytest.approx(1.0)
        # No overlap
        assert self.parser._intersection_area(
            [0, 0, 0.5, 0.5], [0.6, 0.6, 1, 1]
        ) == pytest.approx(0.0)
        # Partial overlap
        assert self.parser._intersection_area(
            [0, 0, 0.5, 0.5], [0.25, 0.25, 0.75, 0.75]
        ) == pytest.approx(0.0625)

    def test_compute_overlap_iou(self):
        # Identical boxes → overlap = 1.0
        assert self.parser._compute_overlap(
            [0, 0, 1, 1], [0, 0, 1, 1]
        ) == pytest.approx(1.0)

    def test_compute_overlap_containment(self):
        # Small box inside large box → high overlap due to ratio_a
        overlap = self.parser._compute_overlap(
            [0.4, 0.4, 0.6, 0.6],  # small
            [0.0, 0.0, 1.0, 1.0],  # large
        )
        assert overlap == pytest.approx(1.0)  # intersection/area_small = 1.0


# ---------------------------------------------------------------------------
# Deduplication logic
# ---------------------------------------------------------------------------

class TestDeduplication:

    def setup_method(self):
        from tools.omniparser_local import OmniParserLocal
        self.parser = OmniParserLocal()

    def test_no_overlap_keeps_all(self):
        ocr = [{"type": "text", "bbox": [0.0, 0.0, 0.1, 0.05], "content": "File",
                "interactivity": False, "source": "ocr"}]
        icons = [{"type": "icon", "bbox": [0.5, 0.5, 0.6, 0.6], "content": None,
                  "interactivity": True, "source": "icon_detection"}]
        result = self.parser._deduplicate(ocr, icons)
        assert len(result) == 2

    def test_ocr_inside_icon_absorbed(self):
        """OCR box mostly inside icon → OCR removed, text absorbed by icon."""
        ocr = [{"type": "text", "bbox": [0.42, 0.42, 0.58, 0.58], "content": "Save",
                "interactivity": False, "source": "ocr"}]
        icons = [{"type": "icon", "bbox": [0.4, 0.4, 0.6, 0.6], "content": None,
                  "interactivity": True, "source": "icon_detection"}]
        result = self.parser._deduplicate(ocr, icons)
        assert len(result) == 1
        assert result[0]["type"] == "icon"
        assert result[0]["content"] == "Save"

    def test_icon_inside_ocr_discarded(self):
        """Icon inside OCR box → icon discarded."""
        ocr = [{"type": "text", "bbox": [0.0, 0.0, 1.0, 1.0], "content": "Big Text",
                "interactivity": False, "source": "ocr"}]
        icons = [{"type": "icon", "bbox": [0.4, 0.4, 0.6, 0.6], "content": None,
                  "interactivity": True, "source": "icon_detection"}]
        result = self.parser._deduplicate(ocr, icons)
        assert len(result) == 1
        assert result[0]["type"] == "text"


# ---------------------------------------------------------------------------
# Annotation drawing
# ---------------------------------------------------------------------------

class TestAnnotationDrawing:

    def test_draw_annotations_returns_image(self):
        from tools.omniparser_local import OmniParserLocal
        parser = OmniParserLocal()

        img = Image.new("RGB", (640, 480), "white")
        elements = [
            ParsedElement(0, "icon", "Button", [0.1, 0.1, 0.3, 0.2], True, "icon"),
            ParsedElement(1, "text", "Label", [0.5, 0.5, 0.7, 0.6], False, "ocr"),
        ]
        result = parser._draw_annotations(img, elements)
        assert isinstance(result, Image.Image)
        assert result.size == (640, 480)


# ---------------------------------------------------------------------------
# OmniParserRouter
# ---------------------------------------------------------------------------

class TestOmniParserRouter:

    @pytest.mark.asyncio
    async def test_router_tries_local_first(self):
        router = OmniParserRouter()
        mock_local = MagicMock()
        mock_result = ParseResult(annotated_image_b64="local_img", elements=[
            ParsedElement(0, "icon", "X", [0, 0, 1, 1], True, "icon"),
        ])
        mock_local.parse = AsyncMock(return_value=mock_result)

        with patch.object(router, "_get_local", return_value=mock_local):
            result = await router.parse("fake_b64")

        assert result is not None
        assert result.annotated_image_b64 == "local_img"
        mock_local.parse.assert_called_once_with("fake_b64")

    @pytest.mark.asyncio
    async def test_router_falls_back_to_http(self):
        router = OmniParserRouter()
        router._local_available = False  # Local not available

        mock_http_result = ParseResult(annotated_image_b64="http_img", elements=[])

        with patch("tools.omniparser_client.get_omniparser_client") as mock_get_http:
            mock_http = MagicMock()
            mock_http.parse = AsyncMock(return_value=mock_http_result)
            mock_get_http.return_value = mock_http

            result = await router.parse("fake_b64")

        assert result is not None
        assert result.annotated_image_b64 == "http_img"

    @pytest.mark.asyncio
    async def test_router_remote_mode_skips_local(self):
        router = OmniParserRouter()
        router._mode = "remote"

        mock_http_result = ParseResult(annotated_image_b64="remote_img", elements=[])

        with patch("tools.omniparser_client.get_omniparser_client") as mock_get_http:
            mock_http = MagicMock()
            mock_http.parse = AsyncMock(return_value=mock_http_result)
            mock_get_http.return_value = mock_http

            result = await router.parse("fake_b64")

        assert result.annotated_image_b64 == "remote_img"

    @pytest.mark.asyncio
    async def test_router_local_mode_no_http_fallback(self):
        router = OmniParserRouter()
        router._mode = "local"
        router._local_available = False

        result = await router.parse("fake_b64")
        assert result is None


class TestGetOmniparser:

    def test_returns_router_singleton(self):
        r1 = get_omniparser()
        r2 = get_omniparser()
        assert r1 is r2
        assert isinstance(r1, OmniParserRouter)
