"""
Screen capture module - captures primary display via mss and provides
a WebRTC video track and JPEG frame relay for LLM context.

Architecture ref: tools/screen_capture.py (FR10: mss capture + JPEG relay)
"""
import asyncio
import base64
import fractions
import io
import logging
import threading
import time
import uuid
from typing import Callable

import av
import mss
import pyautogui
from aiortc import MediaStreamTrack
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

MAX_CAPTURE_WIDTH = 1280


class ScreenCaptureTrack(MediaStreamTrack):
    """Custom video track that captures the primary display using mss.

    Subclasses aiortc MediaStreamTrack to deliver av.VideoFrame objects
    from screen captures. Runs mss.grab() in an executor to avoid
    blocking the asyncio event loop.
    """

    kind = "video"

    _VIDEO_CLOCK_RATE = 90_000
    _TARGET_FPS = 30
    _FRAME_DURATION = _VIDEO_CLOCK_RATE // _TARGET_FPS  # pts increment per frame

    def __init__(self) -> None:
        super().__init__()
        # Use a temporary mss instance just to read monitor geometry, then close it.
        # mss GDI handles are thread-local on Windows, so we cannot keep an instance
        # created in the main thread and use it from executor threads.
        with mss.mss() as sct:
            self._monitor = sct.monitors[1]  # Primary display

        # Thread-local storage - each executor thread creates its own mss instance
        self._thread_local = threading.local()

        self._native_width: int = self._monitor["width"]
        self._native_height: int = self._monitor["height"]

        # Manual mode - cursor caching for reduced latency
        self._manual_mode: bool = False
        self._cached_cursor_pos: tuple[int, int] | None = None  # (abs_x, abs_y)

        # Downscale to max MAX_CAPTURE_WIDTH wide, preserving aspect ratio
        if self._native_width > MAX_CAPTURE_WIDTH:
            ratio = MAX_CAPTURE_WIDTH / self._native_width
            self._capture_width = MAX_CAPTURE_WIDTH
            self._capture_height = int(self._native_height * ratio)
        else:
            self._capture_width = self._native_width
            self._capture_height = self._native_height

        self._scale_x: float = self._native_width / self._capture_width
        self._scale_y: float = self._native_height / self._capture_height

        self._latest_frame: Image.Image | None = None

        # Timestamp management (replaces next_timestamp() which is absent in this aiortc version)
        self._pts: int = 0
        self._time_base = fractions.Fraction(1, self._VIDEO_CLOCK_RATE)
        self._start_time: float | None = None

    def set_manual_mode(self, enabled: bool) -> None:
        """Toggle manual mode - enables cursor caching."""
        self._manual_mode = enabled
        if not enabled:
            self._cached_cursor_pos = None
        logger.info("Screen capture manual mode %s", "ON" if enabled else "OFF")

    def update_cursor_pos(self, abs_x: int, abs_y: int) -> None:
        """Cache the absolute cursor position (called from mouse_move handler)."""
        self._cached_cursor_pos = (abs_x, abs_y)

    @property
    def scale_x(self) -> float:
        """Ratio of native width to capture width."""
        return self._scale_x

    @property
    def scale_y(self) -> float:
        """Ratio of native height to capture height."""
        return self._scale_y

    @property
    def latest_frame(self) -> Image.Image | None:
        """Most recently captured PIL Image, or None if not yet captured."""
        return self._latest_frame

    async def recv(self) -> av.VideoFrame:
        """Capture a screen frame and return it as an av.VideoFrame.

        Called by aiortc when it needs the next video frame.
        Manages frame pacing at _TARGET_FPS and runs the blocking
        mss.grab() call in an executor.
        """
        if self._start_time is None:
            self._start_time = time.time()

        # Pace frames to target FPS
        target_time = self._start_time + (self._pts / self._VIDEO_CLOCK_RATE)
        wait = target_time - time.time()
        if wait > 0:
            await asyncio.sleep(wait)

        loop = asyncio.get_running_loop()
        frame = await loop.run_in_executor(None, self._grab_and_convert)
        frame.pts = self._pts
        frame.time_base = self._time_base
        self._pts += self._FRAME_DURATION
        return frame

    def _get_sct(self) -> mss.mss:
        """Return the mss instance for the current thread, creating one if needed."""
        if not hasattr(self._thread_local, "sct"):
            self._thread_local.sct = mss.mss()
        return self._thread_local.sct

    def _grab_and_convert(self) -> av.VideoFrame:
        """Capture screenshot with mss and convert to av.VideoFrame.

        Synchronous method - must be called via run_in_executor.
        Also stores the resized PIL Image as latest_frame for JPEG relay.
        Draws a cursor crosshair since mss doesn't capture the OS cursor.
        """
        sct = self._get_sct()
        shot = sct.grab(self._monitor)
        img = Image.frombytes("RGB", (shot.width, shot.height), shot.rgb)
        resized = img.resize(
            (self._capture_width, self._capture_height), Image.LANCZOS
        )
        self._draw_cursor(resized)
        self._latest_frame = resized
        return av.VideoFrame.from_image(resized)

    # Arrow cursor polygon - tip at (0,0), classic pointer shape, small
    _CURSOR_SHAPE = [
        (0, 0), (0, 12), (3, 9), (6, 14), (8, 13), (5, 8), (9, 8), (0, 0),
    ]

    def _draw_cursor(self, img: Image.Image) -> None:
        """Draw a small mouse-pointer arrow at the current cursor position.

        Uses cached position from mouse_move handler when available (saves
        a Win32 API call per frame), falls back to pyautogui.position().
        """
        try:
            if self._cached_cursor_pos is not None:
                abs_x, abs_y = self._cached_cursor_pos
            else:
                abs_x, abs_y = pyautogui.position()
            cx = int((abs_x - self._monitor["left"]) / self._scale_x)
            cy = int((abs_y - self._monitor["top"]) / self._scale_y)
            if cx < 0 or cy < 0 or cx >= img.width or cy >= img.height:
                return
            draw = ImageDraw.Draw(img)
            # Offset polygon to cursor position
            pts = [(cx + x, cy + y) for x, y in self._CURSOR_SHAPE]
            # Black outline then white fill - visible on any background
            draw.polygon(pts, outline=(0, 0, 0), fill=(255, 255, 255))
        except Exception:
            pass

    def capture(self) -> Image.Image:
        """Capture a screenshot and return as PIL Image. Also updates latest_frame.

        Synchronous method - call via run_in_executor from async code.
        Unlike _grab_and_convert(), does not create an av.VideoFrame.
        """
        sct = self._get_sct()
        shot = sct.grab(self._monitor)
        img = Image.frombytes("RGB", (shot.width, shot.height), shot.rgb)
        self._latest_frame = img.resize(
            (self._capture_width, self._capture_height), Image.LANCZOS
        )
        return self._latest_frame

    def stop(self) -> None:
        """Clean up thread-local mss instances and stop the track."""
        if hasattr(self._thread_local, "sct"):
            self._thread_local.sct.close()
        super().stop()


def start_jpeg_relay(
    track: ScreenCaptureTrack,
    send_fn: Callable[[str, dict], None],
    interval: float = 1.0,
) -> asyncio.Task:
    """Start an async task that periodically sends JPEG frames via send_fn.

    The relay reads the latest captured frame from the track, compresses
    it to JPEG, base64-encodes it, and sends it using the canonical
    envelope format via send_fn.

    Args:
        track: The ScreenCaptureTrack providing latest_frame.
        send_fn: Callable(msg_type, payload) - typically WebRTCPeerManager.send_message.
        interval: Seconds between JPEG sends (default 1.0s for LLM context).

    Returns:
        The asyncio.Task running the relay loop.
    """
    async def _relay_loop() -> None:
        try:
            while True:
                await asyncio.sleep(interval)
                try:
                    # Read the latest frame already captured by recv() to avoid
                    # concurrent mss.grab() calls (mss is not thread-safe).
                    frame = track.latest_frame
                    if frame is None:
                        continue
                    loop = asyncio.get_running_loop()
                    jpeg_b64 = await loop.run_in_executor(
                        None, _compress_frame, frame
                    )
                    send_fn(
                        "frame",
                        {
                            "jpeg_b64": jpeg_b64,
                            "timestamp_ms": int(time.time() * 1000),
                            "scale_x": track.scale_x,
                            "scale_y": track.scale_y,
                        },
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.exception("JPEG relay error")
        except asyncio.CancelledError:
            pass

    return asyncio.create_task(_relay_loop())


def _compress_frame(img: Image.Image) -> str:
    """Compress a PIL Image to JPEG and return base64-encoded string."""
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode("ascii")
