"""
Manual control tool - handles direct user touch-to-desktop actions.
Bypasses the Dual-Tool Evaluator - deterministic, user-initiated GUI actions.
[Source: tech-spec-hybrid-control-mode.md - device_control bypass pattern]
"""
import asyncio
import logging
import platform
import time
from typing import Any

import pyautogui

from tools.gui_automation import GUIAutomation

logger = logging.getLogger(__name__)

_gui = GUIAutomation()


def _get_scale_factors() -> tuple[float, float]:
    """Get current scale factors from agent_tools capture state.

    Returns (scale_x, scale_y) for converting screenshot-space to native pixels.
    Falls back to 1.0 if no capture has been taken yet.
    """
    try:
        from core.agent_tools import (
            _latest_capture_size,
            _parse_lock,
            get_screen_size,
        )

        native_w, native_h = get_screen_size()
        with _parse_lock:
            cap_w, cap_h = _latest_capture_size
        if native_w != cap_w or native_h != cap_h:
            return native_w / cap_w, native_h / cap_h
        return 1.0, 1.0
    except Exception:
        logger.warning("Could not determine scale factors, defaulting to 1.0")
        return 1.0, 1.0


async def handle_manual_control(action: str, payload: dict) -> dict[str, Any]:
    """Route and execute a manual control action. Never raises."""
    start = time.monotonic()
    try:
        if action == "click":
            return await _handle_click(payload, start)
        elif action == "right_click":
            return await _handle_right_click(payload, start)
        elif action == "scroll":
            return await _handle_scroll(payload, start)
        elif action == "key_combo":
            return await _handle_key_combo(payload, start)
        else:
            return _result(action, "error", f"Unknown action: {action}",
                           "I don't recognize that manual control action.", start)
    except Exception as exc:
        logger.exception("manual_control failed: action=%s", action)
        return _result(action, "error", str(exc),
                       "Manual control failed. Please try again.", start)


def _move_and_get_pos(dx: int, dy: int) -> tuple[int, int]:
    """Move mouse and return new absolute position. Runs in executor thread."""
    pyautogui.moveRel(dx, dy)
    pos = pyautogui.position()
    return pos[0], pos[1]


async def handle_mouse_move(dx: int, dy: int, screen_track=None) -> None:
    """Fast path for mouse move - no result dict, fire-and-forget.

    Optionally caches cursor position on the screen_track to avoid
    per-frame pyautogui.position() Win32 API calls in _draw_cursor().
    """
    if screen_track is not None:
        try:
            abs_x, abs_y = await asyncio.to_thread(_move_and_get_pos, dx, dy)
            screen_track.update_cursor_pos(abs_x, abs_y)
        except Exception:
            pass
    else:
        await asyncio.to_thread(pyautogui.moveRel, dx, dy)


async def handle_mouse_down() -> None:
    """Fast path for mouse button down - enables drag when combined with move."""
    await asyncio.to_thread(pyautogui.mouseDown)


async def handle_mouse_up() -> None:
    """Fast path for mouse button up - ends drag."""
    await asyncio.to_thread(pyautogui.mouseUp)


async def _handle_click(payload: dict, start: float) -> dict[str, Any]:
    x = payload.get("x")
    y = payload.get("y")
    if x is not None and y is not None:
        # Absolute click (used by quick actions with screenshot-space coords)
        sx, sy = _get_scale_factors()
        nx, ny = GUIAutomation._scale(x, y, sx, sy)
        await asyncio.to_thread(pyautogui.click, nx, ny)
        return _result("click", "success", f"Clicked at ({nx}, {ny})",
                       "Click performed.", start)
    else:
        # Click at current cursor position (joystick mode)
        await asyncio.to_thread(pyautogui.click)
        return _result("click", "success", "Clicked at cursor",
                       "Click performed.", start)


async def _handle_right_click(payload: dict, start: float) -> dict[str, Any]:
    x = payload.get("x")
    y = payload.get("y")
    if x is not None and y is not None:
        sx, sy = _get_scale_factors()
        nx, ny = GUIAutomation._scale(x, y, sx, sy)
        await asyncio.to_thread(pyautogui.rightClick, nx, ny)
        return _result("right_click", "success", f"Right-clicked at ({nx}, {ny})",
                       "Right click performed.", start)
    else:
        await asyncio.to_thread(pyautogui.rightClick)
        return _result("right_click", "success", "Right-clicked at cursor",
                       "Right click performed.", start)


async def handle_scroll(payload: dict) -> None:
    """Fire-and-forget scroll - no result message, safe for rapid calls."""
    direction = payload.get("direction", "down")
    amount = payload.get("amount", 3)
    clicks = amount if direction == "up" else -amount
    await asyncio.to_thread(pyautogui.scroll, clicks)


async def _handle_scroll(payload: dict, start: float) -> dict[str, Any]:
    direction = payload.get("direction", "down")
    amount = payload.get("amount", 3)
    # Direct mouse wheel scroll - positive=up, negative=down
    clicks = amount if direction == "up" else -amount
    await asyncio.to_thread(pyautogui.scroll, clicks)
    return _result("scroll", "success", f"Scrolled {direction} by {amount}",
                   f"Scrolled {direction}.", start)


async def _handle_key_combo(payload: dict, start: float) -> dict[str, Any]:
    keys = payload.get("keys", [])
    if not keys:
        return _result("key_combo", "error", "No keys specified",
                       "No keys to press.", start)
    label = "+".join(keys)
    if len(keys) == 1:
        await asyncio.to_thread(pyautogui.press, keys[0])
    else:
        await asyncio.to_thread(pyautogui.hotkey, *keys)
    return _result("key_combo", "success", f"Pressed {label}",
                   f"Pressed {label}.", start)


def _result(action: str, status: str, message: str,
            voice_message: str, start: float) -> dict[str, Any]:
    return {
        "action": action,
        "status": status,
        "message": message,
        "voice_message": voice_message,
        "duration_ms": int((time.monotonic() - start) * 1000),
    }
