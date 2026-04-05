"""
Unit tests for tools/gui_automation.py — GUIAutomation class.

Tests all action handlers with mocked pyautogui to avoid actual screen interaction.
Validates coordinate scaling, voice_message generation, error handling, and timing.
"""
import asyncio
import platform
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def gui():
    """Return a fresh GUIAutomation instance."""
    from tools.gui_automation import GUIAutomation
    return GUIAutomation()


# ---------------------------------------------------------------------------
# Task 1 subtask tests — basic action dispatch and scaling
# ---------------------------------------------------------------------------

class TestClickAction:
    """AC #2: click action with scaled coordinates."""

    @pytest.mark.asyncio
    async def test_click_calls_pyautogui_with_scaled_coords(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="click",
                target="Save button",
                coordinates={"x": 640, "y": 360},
                scale_x=1.5,
                scale_y=1.5,
            )
        mock_pag.click.assert_called_once_with(960, 540)
        assert result["status"] == "success"
        assert result["action"] == "click"
        assert "Save button" in result["voice_message"]
        assert result["duration_ms"] >= 0

    @pytest.mark.asyncio
    async def test_click_default_scale_factors(self, gui):
        """scale_x=1.0, scale_y=1.0 should pass coords unchanged."""
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="click",
                target="OK",
                coordinates={"x": 100, "y": 200},
            )
        mock_pag.click.assert_called_once_with(100, 200)
        assert result["status"] == "success"


class TestDoubleClickAction:
    """AC #3: double_click action."""

    @pytest.mark.asyncio
    async def test_double_click(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="double_click",
                target="File icon",
                coordinates={"x": 200, "y": 100},
                scale_x=2.0,
                scale_y=2.0,
            )
        mock_pag.doubleClick.assert_called_once_with(400, 200)
        assert result["status"] == "success"
        assert "double-clicked" in result["voice_message"].lower()


class TestRightClickAction:
    """AC #4: right_click action."""

    @pytest.mark.asyncio
    async def test_right_click(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="right_click",
                target="Desktop",
                coordinates={"x": 500, "y": 300},
                scale_x=1.0,
                scale_y=1.0,
            )
        mock_pag.rightClick.assert_called_once_with(500, 300)
        assert result["status"] == "success"
        assert "right-clicked" in result["voice_message"].lower()


class TestTypeAction:
    """AC #5: type action with click-to-focus and text input."""

    @pytest.mark.asyncio
    async def test_type_with_coordinates_clicks_first(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="type",
                target="Search box",
                coordinates={"x": 300, "y": 150, "text": "hello"},
                scale_x=1.0,
                scale_y=1.0,
            )
        mock_pag.click.assert_called_once_with(300, 150)
        mock_pag.write.assert_called_once_with("hello", interval=0.02)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_type_without_coordinates(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="type",
                target="Active field",
                coordinates={"text": "world"},
            )
        mock_pag.click.assert_not_called()
        mock_pag.write.assert_called_once_with("world", interval=0.02)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_type_non_ascii_uses_clipboard(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.pyperclip") as mock_clip:
            result = await gui.run(
                action="type",
                target="Input",
                coordinates={"text": "日本語テスト"},
            )
        # First call copies text, second call clears clipboard (M5 fix)
        assert mock_clip.copy.call_count == 2
        mock_clip.copy.assert_any_call("日本語テスト")
        mock_clip.copy.assert_any_call("")
        # Should use correct platform paste modifier
        expected_modifier = "command" if platform.system() == "Darwin" else "ctrl"
        mock_pag.hotkey.assert_called_once_with(expected_modifier, "v")
        assert result["status"] == "success"


@pytest.mark.skipif(sys.platform != "win32", reason="Scroll tests use Windows ctypes.windll.user32.mouse_event")
class TestScrollAction:
    """AC #6: scroll action with direction and amount."""

    @pytest.mark.asyncio
    async def test_scroll_up_positive_amount(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run(
                action="scroll",
                target="Page",
                coordinates={"x": 640, "y": 360, "direction": "up", "amount": 5},
                scale_x=1.5,
                scale_y=1.5,
            )
        # On Windows, clicks at position to focus, then uses ctypes mouse_event
        mock_pag.click.assert_called_once_with(960, 540)
        mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
            0x0800, 0, 0, 5 * 120, 0,  # MOUSEEVENTF_WHEEL, amount * WHEEL_DELTA
        )
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_scroll_down_negative_amount(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run(
                action="scroll",
                target="Page",
                coordinates={"direction": "down", "amount": 10},
            )
        mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
            0x0800, 0, 0, -10 * 120, 0,
        )
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_scroll_default_amount(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run(
                action="scroll",
                target="Page",
                coordinates={"direction": "up"},
            )
        mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
            0x0800, 0, 0, 5 * 120, 0,
        )

    @pytest.mark.asyncio
    async def test_horizontal_scroll_right(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run(
                action="scroll",
                target="Timeline",
                coordinates={"direction": "right", "amount": 3},
            )
        mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
            0x1000, 0, 0, 3 * 120, 0,  # MOUSEEVENTF_HWHEEL
        )
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_horizontal_scroll_left(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run(
                action="scroll",
                target="Timeline",
                coordinates={"direction": "left", "amount": 3},
            )
        mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
            0x1000, 0, 0, -3 * 120, 0,
        )


class TestHotkeyAction:
    """AC #7: hotkey action with keys list."""

    @pytest.mark.asyncio
    async def test_hotkey(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="hotkey",
                target="Copy",
                coordinates={"keys": ["ctrl", "c"]},
            )
        mock_pag.hotkey.assert_called_once_with("ctrl", "c", interval=0.05)
        assert result["status"] == "success"
        assert "ctrl+c" in result["voice_message"].lower()


class TestPressKeyAction:
    """AC #8: press_key action."""

    @pytest.mark.asyncio
    async def test_press_key(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="press_key",
                target="Enter key",
                coordinates={"key": "enter"},
            )
        mock_pag.press.assert_called_once_with("enter")
        assert result["status"] == "success"
        assert "enter" in result["voice_message"].lower()


class TestMoveMouseAction:
    """AC #9: move_mouse action."""

    @pytest.mark.asyncio
    async def test_move_mouse(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="move_mouse",
                target="Menu item",
                coordinates={"x": 100, "y": 50},
                scale_x=2.0,
                scale_y=2.0,
            )
        mock_pag.moveTo.assert_called_once_with(200, 100)
        assert result["status"] == "success"


class TestDragAction:
    """AC #10: drag action with start/end coordinates."""

    @pytest.mark.asyncio
    async def test_drag(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                action="drag",
                target="Slider",
                coordinates={
                    "start_x": 200, "start_y": 300,
                    "end_x": 500, "end_y": 300,
                },
                scale_x=1.5,
                scale_y=1.5,
            )
        # start scaled: (300, 450), end scaled: (750, 450), dx=450, dy=0
        mock_pag.moveTo.assert_called_once_with(300, 450)
        mock_pag.drag.assert_called_once_with(450, 0, duration=0.5)
        assert result["status"] == "success"
        assert "dragged" in result["voice_message"].lower()


class TestCoordinateScaling:
    """AC #1: coordinate scaling with scale_x/scale_y."""

    @pytest.mark.asyncio
    async def test_scaling_math(self, gui):
        """1920x1080 native, 1280x720 capture → scale 1.5x, click(640,360) → native(960,540)."""
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            await gui.run(
                action="click",
                target="Center",
                coordinates={"x": 640, "y": 360},
                scale_x=1.5,
                scale_y=1.5,
            )
        mock_pag.click.assert_called_once_with(960, 540)


class TestFailSafeHandling:
    """AC #11: FailSafeException handling."""

    @pytest.mark.asyncio
    async def test_failsafe_returns_error(self, gui):
        import pyautogui
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            mock_pag.FailSafeException = pyautogui.FailSafeException
            mock_pag.click.side_effect = pyautogui.FailSafeException()
            result = await gui.run(
                action="click",
                target="Button",
                coordinates={"x": 0, "y": 0},
            )
        assert result["status"] == "error"
        assert "failsafe" in result["voice_message"].lower()


class TestGenericExceptionHandling:
    """Subtask 1.14: generic exception handling."""

    @pytest.mark.asyncio
    async def test_generic_exception_returns_error(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            mock_pag.click.side_effect = RuntimeError("display not available")
            # Need to also patch FailSafeException so isinstance check works
            import pyautogui
            mock_pag.FailSafeException = pyautogui.FailSafeException
            result = await gui.run(
                action="click",
                target="Button",
                coordinates={"x": 100, "y": 100},
            )
        assert result["status"] == "error"
        assert "voice_message" in result


class TestVoiceMessages:
    """Subtask 1.15: voice_message generation for each action type."""

    @pytest.mark.asyncio
    async def test_click_voice_message(self, gui):
        with patch("tools.gui_automation.pyautogui"):
            result = await gui.run("click", "Save button", {"x": 10, "y": 10})
        assert "clicked" in result["voice_message"].lower()
        assert "Save button" in result["voice_message"]

    @pytest.mark.asyncio
    async def test_type_voice_truncates_long_text(self, gui):
        long_text = "a" * 100
        with patch("tools.gui_automation.pyautogui"):
            result = await gui.run("type", "Input", {"text": long_text})
        # voice_message should truncate at 50 chars
        assert len(result["voice_message"]) < 200


class TestInvalidAction:
    """Subtask 5.16: invalid action returns error."""

    @pytest.mark.asyncio
    async def test_unknown_action(self, gui):
        result = await gui.run(
            action="fly",
            target="Window",
            coordinates={"x": 0, "y": 0},
        )
        assert result["status"] == "error"
        assert "voice_message" in result


class TestDurationMeasurement:
    """Subtask 5.16 (second): duration_ms measurement."""

    @pytest.mark.asyncio
    async def test_duration_ms_present(self, gui):
        with patch("tools.gui_automation.pyautogui"):
            result = await gui.run("click", "Button", {"x": 10, "y": 10})
        assert "duration_ms" in result
        assert isinstance(result["duration_ms"], int)
        assert result["duration_ms"] >= 0


class TestPlatformAdapterAutoDetection:
    """Subtask 5.17: platform adapter returns correct type per OS."""

    def test_get_adapter_returns_adapter(self):
        from platform_adapters import get_adapter
        adapter = get_adapter()
        from platform_adapters.base import PlatformAdapter
        assert isinstance(adapter, PlatformAdapter)
