"""
GUI automation tool - executes clicks, typing, scrolling, drag-and-drop,
keyboard shortcuts, and mouse movements via PyAutoGUI.

Coordinates received from the ADK agent are in screenshot space (max 1280px wide)
and must be scaled to native screen space using scale_x/scale_y factors.

All pyautogui calls are wrapped with asyncio.to_thread() to avoid blocking
the event loop (pyautogui is synchronous).

NOTE: pyautogui.scroll() is broken on Windows (does not multiply by WHEEL_DELTA
and passes erratic coordinates). We bypass it with direct ctypes mouse_event calls.

[Source: architecture.md - tools/gui_automation.py is FR13]
[Source: project-context.md - Error Handling, Mandatory voice_message]
"""
import asyncio
import ctypes  # stdlib on all platforms; windll only accessed on Windows
import logging
import platform
import time

import pyautogui
import pyperclip

logger = logging.getLogger(__name__)

# Safety: keep failsafe enabled (mouse to corner = abort)
pyautogui.FAILSAFE = True
# Small pause between pyautogui calls to prevent racing
pyautogui.PAUSE = 0.1

_VALID_ACTIONS = frozenset({
    "click", "double_click", "right_click", "type", "scroll",
    "hotkey", "press_key", "move_mouse", "drag",
})


class GUIAutomation:
    """Execute GUI automation actions with coordinate scaling and safety controls."""

    async def run(
        self,
        action: str,
        target: str,
        coordinates: dict,
        scale_x: float = 1.0,
        scale_y: float = 1.0,
    ) -> dict:
        """Execute a GUI action and return a standardized ToolResult.

        Args:
            action: Action type (click, double_click, right_click, type, scroll,
                    hotkey, press_key, move_mouse, drag).
            target: Human description of the UI element.
            coordinates: Dict with action-specific keys (x, y, text, keys, etc.).
            scale_x: Horizontal scale factor (native_width / capture_width).
            scale_y: Vertical scale factor (native_height / capture_height).

        Returns:
            dict with status, action, target, coordinates, description,
            duration_ms, and voice_message.
        """
        start = time.monotonic()

        if action not in _VALID_ACTIONS:
            return self._error_result(
                action, target, coordinates, start,
                f"Unknown action '{action}'. Supported: {', '.join(sorted(_VALID_ACTIONS))}",
            )

        try:
            handler = getattr(self, f"_handle_{action}")
            result = await handler(target, coordinates, scale_x, scale_y)
            result["duration_ms"] = int((time.monotonic() - start) * 1000)
            return result

        except pyautogui.FailSafeException:
            duration_ms = int((time.monotonic() - start) * 1000)
            logger.warning("PyAutoGUI failsafe triggered during %s", action)
            return {
                "status": "error",
                "action": action,
                "target": target,
                "coordinates": coordinates,
                "description": "PyAutoGUI failsafe triggered - mouse moved to screen corner.",
                "duration_ms": duration_ms,
                "voice_message": (
                    "The emergency failsafe was triggered - the mouse was moved to the "
                    "corner. No action was taken. Should I continue?"
                ),
            }
        except Exception as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            logger.exception("GUI action '%s' failed on '%s'", action, target)
            return {
                "status": "error",
                "action": action,
                "target": target,
                "coordinates": coordinates,
                "description": f"Action '{action}' failed: {exc}",
                "duration_ms": duration_ms,
                "voice_message": (
                    f"I couldn't perform the {action}. {exc}. "
                    "Should I try a different approach?"
                ),
            }

    # ── Coordinate helpers ─────────────────────────────────────────────────

    @staticmethod
    def _scale(x: int | float, y: int | float, sx: float, sy: float) -> tuple[int, int]:
        return int(x * sx), int(y * sy)

    # ── Action handlers ────────────────────────────────────────────────────

    async def _handle_click(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        x, y = self._scale(coords["x"], coords["y"], sx, sy)
        await asyncio.to_thread(pyautogui.click, x, y)
        return self._success_result(
            "click", target, {"x": x, "y": y},
            f"Clicked on '{target}' at native coordinates ({x}, {y})",
            f"Done. I clicked on the {target}.",
        )

    async def _handle_double_click(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        x, y = self._scale(coords["x"], coords["y"], sx, sy)
        await asyncio.to_thread(pyautogui.doubleClick, x, y)
        return self._success_result(
            "double_click", target, {"x": x, "y": y},
            f"Double-clicked on '{target}' at native coordinates ({x}, {y})",
            f"Done. I double-clicked on the {target}.",
        )

    async def _handle_right_click(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        x, y = self._scale(coords["x"], coords["y"], sx, sy)
        await asyncio.to_thread(pyautogui.rightClick, x, y)
        return self._success_result(
            "right_click", target, {"x": x, "y": y},
            f"Right-clicked on '{target}' at native coordinates ({x}, {y})",
            f"Done. I right-clicked on the {target} to open the context menu.",
        )

    async def _handle_type(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        text = coords.get("text", "")

        # Click to focus if coordinates provided
        if "x" in coords and "y" in coords:
            x, y = self._scale(coords["x"], coords["y"], sx, sy)
            await asyncio.to_thread(pyautogui.click, x, y)

        # Use clipboard paste for non-ASCII text
        if text and not text.isascii():
            await asyncio.to_thread(pyperclip.copy, text)
            paste_key = "command" if platform.system() == "Darwin" else "ctrl"
            await asyncio.to_thread(pyautogui.hotkey, paste_key, "v")
            # Clear clipboard to avoid leaking typed text to other apps
            try:
                await asyncio.to_thread(pyperclip.copy, "")
            except Exception:
                pass  # Best-effort; don't fail the action if clipboard clearing fails
        else:
            await asyncio.to_thread(pyautogui.write, text, interval=0.02)

        display_text = text[:50] + "..." if len(text) > 50 else text
        return self._success_result(
            "type", target, coords,
            f"Typed '{display_text}' into '{target}'",
            f"Done. I typed '{display_text}' into the {target}.",
        )

    async def _handle_scroll(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        direction = coords.get("direction", "down")
        amount = coords.get("amount", 5)

        # Click to focus the window at the scroll position (required on Windows
        # for the scroll event to be delivered to the correct window).
        if "x" in coords and "y" in coords:
            x, y = self._scale(coords["x"], coords["y"], sx, sy)
            await asyncio.to_thread(pyautogui.click, x, y)
        else:
            # Click current mouse position to ensure window focus
            await asyncio.to_thread(pyautogui.click)

        if platform.system() == "Windows":
            # Bypass broken pyautogui.scroll() on Windows.
            # pyautogui doesn't multiply by WHEEL_DELTA (120) and passes
            # erratic coordinates to mouse_event.  We call mouse_event
            # directly with dx=dy=0 and correct dwData.
            MOUSEEVENTF_WHEEL = 0x0800
            MOUSEEVENTF_HWHEEL = 0x1000
            WHEEL_DELTA = 120

            if direction in ("left", "right"):
                dw = int(amount * WHEEL_DELTA) if direction == "right" else int(-amount * WHEEL_DELTA)
                await asyncio.to_thread(
                    ctypes.windll.user32.mouse_event,
                    MOUSEEVENTF_HWHEEL, 0, 0, dw, 0,
                )
            else:
                dw = int(amount * WHEEL_DELTA) if direction == "up" else int(-amount * WHEEL_DELTA)
                await asyncio.to_thread(
                    ctypes.windll.user32.mouse_event,
                    MOUSEEVENTF_WHEEL, 0, 0, dw, 0,
                )
        else:
            # Non-Windows: pyautogui scroll works fine
            if direction in ("left", "right"):
                clicks = amount if direction == "right" else -amount
                await asyncio.to_thread(pyautogui.hscroll, clicks)
            else:
                clicks = amount if direction == "up" else -amount
                await asyncio.to_thread(pyautogui.scroll, clicks)

        return self._success_result(
            "scroll", target, coords,
            f"Scrolled {direction} by {amount} steps",
            f"Done. I scrolled {direction} by {amount} steps.",
        )

    async def _handle_hotkey(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        keys = coords.get("keys", [])
        if not keys:
            return self._error_result(
                "hotkey", target, coords, time.monotonic(),
                "No keys provided for hotkey action. Specify keys in coordinates['keys'].",
            )
        await asyncio.to_thread(pyautogui.hotkey, *keys, interval=0.05)
        key_combo = "+".join(keys)
        return self._success_result(
            "hotkey", target, coords,
            f"Pressed hotkey {key_combo}",
            f"Done. I pressed {key_combo}.",
        )

    async def _handle_press_key(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        key = coords.get("key", "")
        await asyncio.to_thread(pyautogui.press, key)
        return self._success_result(
            "press_key", target, coords,
            f"Pressed the {key} key",
            f"Done. I pressed the {key} key.",
        )

    async def _handle_move_mouse(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        x, y = self._scale(coords["x"], coords["y"], sx, sy)
        await asyncio.to_thread(pyautogui.moveTo, x, y)
        return self._success_result(
            "move_mouse", target, {"x": x, "y": y},
            f"Moved cursor to '{target}' at native coordinates ({x}, {y})",
            f"Done. I moved the cursor to the {target}.",
        )

    async def _handle_drag(
        self, target: str, coords: dict, sx: float, sy: float,
    ) -> dict:
        start_x, start_y = self._scale(coords["start_x"], coords["start_y"], sx, sy)
        end_x, end_y = self._scale(coords["end_x"], coords["end_y"], sx, sy)
        dx = end_x - start_x
        dy = end_y - start_y

        await asyncio.to_thread(pyautogui.moveTo, start_x, start_y)
        await asyncio.to_thread(pyautogui.drag, dx, dy, duration=0.5)

        return self._success_result(
            "drag", target,
            {"start_x": start_x, "start_y": start_y, "end_x": end_x, "end_y": end_y},
            f"Dragged '{target}' from ({start_x}, {start_y}) to ({end_x}, {end_y})",
            f"Done. I dragged the {target} to the new position.",
        )

    # ── Result builders ────────────────────────────────────────────────────

    @staticmethod
    def _success_result(
        action: str, target: str, coordinates: dict,
        description: str, voice_message: str,
    ) -> dict:
        return {
            "status": "success",
            "action": action,
            "target": target,
            "coordinates": coordinates,
            "description": description,
            "duration_ms": 0,  # Overwritten by run() with actual timing
            "voice_message": voice_message,
        }

    @staticmethod
    def _error_result(
        action: str, target: str, coordinates: dict,
        start: float, error_desc: str,
    ) -> dict:
        duration_ms = int((time.monotonic() - start) * 1000)
        return {
            "status": "error",
            "action": action,
            "target": target,
            "coordinates": coordinates,
            "description": error_desc,
            "duration_ms": duration_ms,
            "voice_message": (
                f"I couldn't perform the {action}. {error_desc}. "
                "Should I try a different approach?"
            ),
        }
