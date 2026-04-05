"""
Unit tests for ScreenCaptureTrack and JPEG frame relay.

Covers AC: 1 (screen capture >= 15 FPS, video frame delivery),
         2 (canonical frame envelope format),
         3 (resource cleanup).
"""
import asyncio
import base64
import json
import sys
from fractions import Fraction
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest
from PIL import Image

from tools.screen_capture import ScreenCaptureTrack, start_jpeg_relay, _compress_frame


# --- Helpers ---

def _make_fake_monitor():
    """Return a fake mss monitor dict for primary display."""
    return {"left": 0, "top": 0, "width": 1920, "height": 1080}


def _make_fake_screenshot(width=1920, height=1080):
    """Return a mock mss ScreenShot with .rgb, .width, .height."""
    img = Image.new("RGB", (width, height), color="blue")
    shot = MagicMock()
    shot.width = width
    shot.height = height
    shot.rgb = img.tobytes()
    return shot


def _make_mock_sct(monitor=None, screenshot=None):
    """Create a mock mss instance with monitors and grab.

    Supports context-manager protocol (used by __init__) and direct use
    (used by _get_sct for thread-local instances).
    """
    if monitor is None:
        monitor = _make_fake_monitor()
    if screenshot is None:
        screenshot = _make_fake_screenshot(monitor["width"], monitor["height"])

    mock_sct = MagicMock()
    mock_sct.monitors = [
        {"left": 0, "top": 0, "width": 3840, "height": 2160},  # virtual screen
        monitor,  # primary display
    ]
    mock_sct.grab.return_value = screenshot
    # Support `with mss.mss() as sct:` context-manager usage
    mock_sct.__enter__ = MagicMock(return_value=mock_sct)
    mock_sct.__exit__ = MagicMock(return_value=False)
    return mock_sct


# --- Task 4.1: Initialization tests ---

@pytest.mark.unit
class TestScreenCaptureTrackInit:
    """Test ScreenCaptureTrack initialization."""

    def test_kind_is_video(self):
        """4.1: Track kind must be 'video'."""
        with patch("tools.screen_capture.mss.mss", return_value=_make_mock_sct()):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        assert track.kind == "video"

    def test_mss_instance_created(self):
        """4.1: mss instance must be created on init to read monitor geometry."""
        mock_sct = _make_mock_sct()
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct) as mock_mss:
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        mock_mss.assert_called_once()
        assert track._monitor is mock_sct.monitors[1]

    def test_primary_monitor_selected(self):
        """4.1: monitors[1] (primary display) must be selected."""
        monitor = {"left": 0, "top": 0, "width": 2560, "height": 1440}
        mock_sct = _make_mock_sct(monitor=monitor)
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        assert track._monitor is monitor

    def test_native_dimensions_stored(self):
        """4.1: Native monitor dimensions must be stored."""
        monitor = {"left": 0, "top": 0, "width": 2560, "height": 1440}
        mock_sct = _make_mock_sct(monitor=monitor)
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        assert track._native_width == 2560
        assert track._native_height == 1440

    def test_capture_resolution_downscaled(self):
        """4.1: Capture resolution downscaled to max 1280px wide, preserving aspect ratio."""
        monitor = {"left": 0, "top": 0, "width": 1920, "height": 1080}
        mock_sct = _make_mock_sct(monitor=monitor)
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        assert track._capture_width == 1280
        assert track._capture_height == int(1080 * (1280 / 1920))

    def test_no_downscale_when_within_limit(self):
        """4.1: No downscale when monitor width <= 1280."""
        monitor = {"left": 0, "top": 0, "width": 1024, "height": 768}
        mock_sct = _make_mock_sct(monitor=monitor)
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        assert track._capture_width == 1024
        assert track._capture_height == 768


# --- Task 4.5: Scale factor tests ---

@pytest.mark.unit
class TestScaleFactors:
    """Test scale_x and scale_y computation."""

    def test_scale_factors_computed_correctly(self):
        """4.5: scale_x/scale_y must be native/capture ratio."""
        monitor = {"left": 0, "top": 0, "width": 1920, "height": 1080}
        mock_sct = _make_mock_sct(monitor=monitor)
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        assert track.scale_x == 1920 / 1280
        assert track.scale_y == 1080 / track._capture_height

    def test_scale_factors_are_1_when_no_downscale(self):
        """4.5: scale factors are 1.0 when no downscaling needed."""
        monitor = {"left": 0, "top": 0, "width": 1280, "height": 720}
        mock_sct = _make_mock_sct(monitor=monitor)
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()
        assert track.scale_x == 1.0
        assert track.scale_y == 1.0


# --- Task 4.2: recv() tests ---

@pytest.mark.unit
class TestRecv:
    """Test recv() returns valid av.VideoFrame."""

    @pytest.mark.skipif(sys.platform != "win32", reason="mss.grab requires real display — fails on headless CI")
    async def test_recv_returns_video_frame(self):
        """4.2: recv() must return an av.VideoFrame with correct dimensions."""
        import av

        monitor = {"left": 0, "top": 0, "width": 1920, "height": 1080}
        screenshot = _make_fake_screenshot(1920, 1080)
        mock_sct = _make_mock_sct(monitor=monitor, screenshot=screenshot)

        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()

        # Set up thread-local mss for the executor thread grab
        grab_sct = _make_mock_sct(monitor=monitor, screenshot=screenshot)
        track._thread_local.sct = grab_sct

        frame = await track.recv()

        assert isinstance(frame, av.VideoFrame)
        assert frame.width == 1280
        assert frame.height == int(1080 * (1280 / 1920))
        assert frame.pts == 0
        assert frame.time_base == Fraction(1, 90_000)


# --- Task 4.3: _grab_and_convert() stores latest_frame ---

@pytest.mark.unit
class TestGrabAndConvert:
    """Test _grab_and_convert() stores latest_frame as PIL Image."""

    def test_stores_latest_frame(self):
        """4.3: After _grab_and_convert(), latest_frame must be a PIL Image."""
        monitor = {"left": 0, "top": 0, "width": 1920, "height": 1080}
        screenshot = _make_fake_screenshot(1920, 1080)
        mock_sct = _make_mock_sct(monitor=monitor, screenshot=screenshot)

        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()

        assert track.latest_frame is None  # Before capture

        # Set up thread-local mss for the grab call
        grab_sct = _make_mock_sct(monitor=monitor, screenshot=screenshot)
        track._thread_local.sct = grab_sct

        track._grab_and_convert()

        assert isinstance(track.latest_frame, Image.Image)
        assert track.latest_frame.size == (1280, int(1080 * (1280 / 1920)))


# --- Task 4.4: stop() cleanup ---

@pytest.mark.unit
class TestStop:
    """Test stop() cleans up mss instance."""

    def test_stop_closes_mss(self):
        """4.4: stop() must close thread-local mss instance."""
        mock_sct = _make_mock_sct()
        with patch("tools.screen_capture.mss.mss", return_value=mock_sct):
            with patch("tools.screen_capture.MediaStreamTrack.__init__"):
                track = ScreenCaptureTrack()

        # Simulate a thread-local mss instance having been created
        thread_sct = MagicMock()
        track._thread_local.sct = thread_sct

        with patch("tools.screen_capture.MediaStreamTrack.stop"):
            track.stop()

        thread_sct.close.assert_called_once()


# --- Task 4.6: JPEG relay envelope format ---

@pytest.mark.unit
class TestJpegRelay:
    """Test JPEG relay sends correctly formatted canonical envelope."""

    async def test_relay_sends_canonical_envelope(self):
        """4.6: JPEG relay must call send_fn with type='frame' and correct payload."""
        # Create a mock track whose latest_frame returns a test image
        mock_track = MagicMock()
        test_img = Image.new("RGB", (1280, 720), color="red")
        mock_track.latest_frame = test_img
        mock_track.scale_x = 1.5
        mock_track.scale_y = 1.5

        send_fn = MagicMock()

        # Start the relay with a very short interval (start_jpeg_relay is synchronous)
        task = start_jpeg_relay(mock_track, send_fn, interval=0.01)

        # Let it run one iteration
        await asyncio.sleep(0.1)

        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        # Verify send_fn was called
        assert send_fn.call_count >= 1
        call_args = send_fn.call_args
        msg_type = call_args[0][0]
        payload = call_args[0][1]

        assert msg_type == "frame"
        assert "jpeg_b64" in payload
        assert "timestamp_ms" in payload
        assert "scale_x" in payload
        assert "scale_y" in payload
        assert payload["scale_x"] == 1.5
        assert payload["scale_y"] == 1.5
        assert isinstance(payload["timestamp_ms"], int)

        # Verify jpeg_b64 is valid base64-encoded JPEG
        jpeg_bytes = base64.b64decode(payload["jpeg_b64"])
        assert jpeg_bytes[:2] == b"\xff\xd8"  # JPEG magic bytes

    async def test_relay_skips_when_latest_frame_is_none(self):
        """4.7: JPEG relay must skip iteration when latest_frame is None."""
        mock_track = MagicMock()
        mock_track.latest_frame = None

        send_fn = MagicMock()

        task = start_jpeg_relay(mock_track, send_fn, interval=0.01)

        await asyncio.sleep(0.1)

        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        # send_fn should never have been called
        send_fn.assert_not_called()

    async def test_relay_handles_cancellation(self):
        """4.8: JPEG relay must handle CancelledError cleanly."""
        mock_track = MagicMock()
        test_img = Image.new("RGB", (1280, 720), color="green")
        mock_track.latest_frame = test_img
        mock_track.scale_x = 1.0
        mock_track.scale_y = 1.0

        send_fn = MagicMock()

        task = start_jpeg_relay(mock_track, send_fn, interval=0.01)
        await asyncio.sleep(0.05)

        task.cancel()

        # Should not raise — CancelledError is handled cleanly inside the relay
        # The task's internal CancelledError is caught, so await returns normally
        # We need to give it a moment to process the cancellation
        try:
            await task
        except asyncio.CancelledError:
            pass  # Also acceptable if the outer task propagates cancellation

        # Task should be done (not stuck running)
        assert task.done()


# --- Compress frame helper ---

@pytest.mark.unit
class TestCompressFrame:
    """Test _compress_frame helper."""

    def test_compress_returns_base64_jpeg(self):
        """Compressed output must be valid base64-encoded JPEG."""
        img = Image.new("RGB", (640, 480), color="white")
        result = _compress_frame(img)

        assert isinstance(result, str)
        decoded = base64.b64decode(result)
        assert decoded[:2] == b"\xff\xd8"  # JPEG magic bytes
