"""ATDD RED phase tests for Story 1.8 — QR image storage and retrieval."""

import pytest

import core.pairing as pairing
from core.pairing import generate_token, generate_qr_code, _token_registry, _device_token_map


@pytest.fixture(autouse=True)
def clear_registry():
    _token_registry.clear()
    _device_token_map.clear()
    pairing._last_qr_png = None
    yield
    _token_registry.clear()
    _device_token_map.clear()
    pairing._last_qr_png = None


@pytest.mark.unit
class TestGetQrImageFunction:
    """1.8-UNIT-001: get_qr_image() returns stored PNG bytes or None."""

    def test_get_qr_image_returns_none_initially(self):
        """[P1] get_qr_image() returns None before any QR generation."""
        result = pairing.get_qr_image()
        assert result is None

    @pytest.mark.asyncio
    async def test_get_qr_image_returns_bytes_after_generation(self):
        """[P1] After calling generate_qr_code(), get_qr_image() returns bytes."""
        token = await generate_token()
        await generate_qr_code(token)
        result = pairing.get_qr_image()
        assert isinstance(result, bytes)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_get_qr_image_returns_valid_png(self):
        """[P1] The bytes returned by get_qr_image() start with the PNG signature."""
        token = await generate_token()
        await generate_qr_code(token)
        result = pairing.get_qr_image()
        assert result is not None
        assert result[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.unit
class TestLastQrPngStorage:
    """1.8-UNIT-002: _last_qr_png stores PNG bytes after QR generation."""

    def test_last_qr_png_not_set_initially(self):
        """[P1] _last_qr_png is None initially."""
        assert pairing._last_qr_png is None

    @pytest.mark.asyncio
    async def test_last_qr_png_set_after_qr_generation(self):
        """[P1] After generate_qr_code(), _last_qr_png is not None and is bytes."""
        token = await generate_token()
        await generate_qr_code(token)
        assert pairing._last_qr_png is not None
        assert isinstance(pairing._last_qr_png, bytes)
