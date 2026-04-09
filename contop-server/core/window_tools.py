"""
Window & clipboard tools - structured window management and clipboard operations.

Provides window_list, window_focus, resize_window, clipboard_read, clipboard_write
as ADK FunctionTools. Routes through platform_adapters for cross-platform support.

All tools follow the standard async pattern: async def, dict return with
status field, logger.info at entry, try/except with logger.exception.
"""
import asyncio
import logging
import time as _time

logger = logging.getLogger(__name__)


def _get_adapter():
    """Lazy import to avoid circular imports and platform-specific load errors."""
    from platform_adapters import get_adapter
    return get_adapter()


async def window_list() -> dict:
    """List all visible window titles.

    Returns dict with status, windows (list of titles), count.
    """
    logger.info("window_list called")
    start = _time.monotonic()
    try:
        adapter = _get_adapter()
        titles = await asyncio.wait_for(
            asyncio.to_thread(adapter.list_windows), timeout=5,
        )
        return {
            "status": "success",
            "windows": titles,
            "count": len(titles),
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except asyncio.TimeoutError:
        logger.warning("window_list timed out after 5s (UIA hang)")
        return {
            "status": "error",
            "description": "Window listing timed out (UIA hang).",
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't list the open windows.",
        }
    except Exception as exc:
        logger.exception("window_list failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't list the open windows.",
        }


async def window_focus(title: str) -> dict:
    """Bring a window with the given title to the foreground.

    Args:
        title: Window title to focus (partial match, case-insensitive).

    Returns dict with status, focused, title.
    """
    logger.info("window_focus called: title=%s", title)
    start = _time.monotonic()
    try:
        adapter = _get_adapter()
        focused = await asyncio.wait_for(
            asyncio.to_thread(adapter.focus_window, title), timeout=5,
        )
        return {
            "status": "success",
            "focused": focused,
            "title": title,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("window_focus failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't focus the window '{title}'.",
        }


async def resize_window(
    layout: str = "",
    width: int = 0,
    height: int = 0,
    x: int = 0,
    y: int = 0,
    title: str = "",
) -> dict:
    """Resize or snap a window to a layout.

    If layout is given (e.g. "left_half"), snap the window to that layout.
    If width/height are given, resize to exact dimensions.

    Args:
        layout: Snap layout - "left_half", "right_half", "top_half",
                "bottom_half", "maximize", "restore".
        width: New width in pixels (used when layout is empty).
        height: New height in pixels.
        x: New x position.
        y: New y position.
        title: Window title to target. Empty = foreground window.

    Returns dict with status, resized.
    """
    logger.info(
        "resize_window called: layout=%s, width=%d, height=%d, title=%s",
        layout, width, height, title,
    )
    start = _time.monotonic()
    try:
        adapter = _get_adapter()
        win_title = title or None

        if layout:
            resized = await asyncio.to_thread(adapter.snap_window, win_title, layout)
        elif width and height:
            kw = {}
            if x is not None:
                kw["x"] = x
            if y is not None:
                kw["y"] = y
            resized = await asyncio.to_thread(
                adapter.resize_window, win_title, width, height, **kw,
            )
        else:
            return {
                "status": "error",
                "description": "Provide either layout (e.g. 'left_half') or width+height.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "I need a layout or dimensions to resize the window.",
            }

        return {
            "status": "success",
            "resized": resized,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("resize_window failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't resize the window.",
        }


async def clipboard_read() -> dict:
    """Read text from the system clipboard.

    Returns dict with status, content.
    """
    logger.info("clipboard_read called")
    start = _time.monotonic()
    try:
        adapter = _get_adapter()
        content = await asyncio.to_thread(adapter.clipboard_read)
        return {
            "status": "success",
            "content": content,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("clipboard_read failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't read the clipboard.",
        }


async def clipboard_write(text: str) -> dict:
    """Write text to the system clipboard.

    Args:
        text: Text to write to the clipboard.

    Returns dict with status, written, length.
    """
    logger.info("clipboard_write called: length=%d", len(text))
    start = _time.monotonic()
    try:
        adapter = _get_adapter()
        written = await asyncio.to_thread(adapter.clipboard_write, text)
        return {
            "status": "success",
            "written": written,
            "length": len(text),
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("clipboard_write failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't write to the clipboard.",
        }
