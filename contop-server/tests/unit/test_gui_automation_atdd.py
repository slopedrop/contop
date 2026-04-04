"""
ATDD acceptance tests for Story 3.3: GUI Automation Execution.

BDD-style tests that validate each acceptance criterion end-to-end
with mocked pyautogui to avoid actual screen interaction.
"""
import asyncio
import platform
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pyautogui = pytest.importorskip("pyautogui")

from tools.gui_automation import GUIAutomation


@pytest.fixture
def gui():
    return GUIAutomation()


# ── AC #1: Standardized ToolResult with status, description, duration_ms, voice_message ──

class TestAC1_ToolResultFormat:
    """AC #1: GUIAutomation returns standardized ToolResult payload."""

    @pytest.mark.asyncio
    async def test_success_result_has_required_fields(self, gui):
        """GIVEN a safe GUI intent,
        WHEN the action executes successfully,
        THEN the result contains status, description, duration_ms, and voice_message."""
        with patch("tools.gui_automation.pyautogui"):
            result = await gui.run("click", "Button", {"x": 10, "y": 10}, 1.0, 1.0)

        assert result["status"] == "success"
        assert isinstance(result["description"], str)
        assert isinstance(result["duration_ms"], int)
        assert isinstance(result["voice_message"], str)
        assert result["duration_ms"] >= 0

    @pytest.mark.asyncio
    async def test_error_result_has_required_fields(self, gui):
        """GIVEN an action that fails,
        THEN the error result also has status, description, duration_ms, voice_message."""
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            mock_pag.FailSafeException = pyautogui.FailSafeException
            mock_pag.click.side_effect = RuntimeError("no display")
            result = await gui.run("click", "Button", {"x": 10, "y": 10})

        assert result["status"] == "error"
        assert "description" in result
        assert "duration_ms" in result
        assert "voice_message" in result


# ── AC #2: Click with coordinate scaling ──

class TestAC2_ClickWithScaling:
    """AC #2: click action scales coordinates and invokes pyautogui.click."""

    @pytest.mark.asyncio
    async def test_click_scales_and_calls_pyautogui(self, gui):
        """GIVEN execute_gui with action=click and coordinates,
        WHEN processed,
        THEN coords are scaled and pyautogui.click is invoked."""
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run("click", "Save button", {"x": 640, "y": 360}, 1.5, 1.5)

        mock_pag.click.assert_called_once_with(960, 540)
        assert result["status"] == "success"
        assert "Save button" in result["voice_message"]


# ── AC #3: Double-click ──

class TestAC3_DoubleClick:
    """AC #3: double_click invokes pyautogui.doubleClick with scaled coords."""

    @pytest.mark.asyncio
    async def test_double_click_with_scaling(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run("double_click", "File", {"x": 100, "y": 100}, 2.0, 2.0)

        mock_pag.doubleClick.assert_called_once_with(200, 200)
        assert result["status"] == "success"


# ── AC #4: Right-click ──

class TestAC4_RightClick:
    """AC #4: right_click invokes pyautogui.rightClick with scaled coords."""

    @pytest.mark.asyncio
    async def test_right_click_with_scaling(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run("right_click", "Icon", {"x": 50, "y": 50}, 1.5, 1.5)

        mock_pag.rightClick.assert_called_once_with(75, 75)
        assert result["status"] == "success"


# ── AC #5: Type with click-to-focus, ASCII, and non-ASCII fallback ──

class TestAC5_TypeAction:
    """AC #5: type action with click-to-focus and clipboard fallback."""

    @pytest.mark.asyncio
    async def test_type_clicks_to_focus_then_writes(self, gui):
        """GIVEN x/y and text in coordinates,
        WHEN action=type,
        THEN click(x,y) is called first, then write(text)."""
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                "type", "Search", {"x": 200, "y": 100, "text": "hello"}, 1.0, 1.0,
            )

        mock_pag.click.assert_called_once_with(200, 100)
        mock_pag.write.assert_called_once_with("hello", interval=0.02)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_type_non_ascii_uses_pyperclip_paste(self, gui):
        """GIVEN non-ASCII text,
        WHEN action=type,
        THEN pyperclip.copy + paste hotkey is used."""
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.pyperclip") as mock_clip:
            result = await gui.run("type", "Input", {"text": "こんにちは"})

        # M5 fix: clipboard is cleared after paste, so 2 calls total
        assert mock_clip.copy.call_count == 2
        mock_clip.copy.assert_any_call("こんにちは")
        mock_clip.copy.assert_any_call("")
        assert mock_pag.hotkey.called
        assert result["status"] == "success"


# ── AC #6: Scroll with direction and amount ──
# NOTE: On Windows, pyautogui.scroll() is bypassed in favor of direct
# ctypes mouse_event calls (pyautogui doesn't multiply by WHEEL_DELTA).

class TestAC6_ScrollAction:
    """AC #6: scroll with direction, amount, and position."""

    @pytest.mark.asyncio
    async def test_scroll_up_positive(self, gui):
        """direction=up → positive scroll amount."""
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run("scroll", "Page", {"direction": "up", "amount": 5})
        if platform.system() == "Windows":
            mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
                0x0800, 0, 0, 5 * 120, 0,
            )
        else:
            mock_pag.scroll.assert_called_once_with(5)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_scroll_down_negative(self, gui):
        """direction=down → negative scroll amount."""
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run("scroll", "Page", {"direction": "down", "amount": 5})
        if platform.system() == "Windows":
            mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
                0x0800, 0, 0, -5 * 120, 0,
            )
        else:
            mock_pag.scroll.assert_called_once_with(-5)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_scroll_default_amount_is_5(self, gui):
        """Default amount is 5 clicks."""
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run("scroll", "Page", {"direction": "up"})
        if platform.system() == "Windows":
            mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
                0x0800, 0, 0, 5 * 120, 0,
            )
        else:
            mock_pag.scroll.assert_called_once_with(5)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_horizontal_scroll_right(self, gui):
        """direction=right → horizontal scroll positive."""
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run("scroll", "Timeline", {"direction": "right", "amount": 3})
        if platform.system() == "Windows":
            mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
                0x1000, 0, 0, 3 * 120, 0,
            )
        else:
            mock_pag.hscroll.assert_called_once_with(3)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_horizontal_scroll_left(self, gui):
        """direction=left → horizontal scroll negative."""
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run("scroll", "Timeline", {"direction": "left", "amount": 3})
        if platform.system() == "Windows":
            mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
                0x1000, 0, 0, -3 * 120, 0,
            )
        else:
            mock_pag.hscroll.assert_called_once_with(-3)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_scroll_clicks_to_focus_at_position(self, gui):
        """If x/y provided, click is called at position to focus window before scroll."""
        with patch("tools.gui_automation.pyautogui") as mock_pag, \
             patch("tools.gui_automation.ctypes") as mock_ctypes:
            result = await gui.run(
                "scroll", "Page",
                {"x": 640, "y": 360, "direction": "down", "amount": 10},
                scale_x=1.5, scale_y=1.5,
            )
        mock_pag.click.assert_called_once_with(960, 540)
        if platform.system() == "Windows":
            mock_ctypes.windll.user32.mouse_event.assert_called_once_with(
                0x0800, 0, 0, -10 * 120, 0,
            )
        else:
            mock_pag.scroll.assert_called_once_with(-10)
        assert result["status"] == "success"


# ── AC #7: Hotkey ──

class TestAC7_HotkeyAction:
    """AC #7: hotkey unpacks keys list to pyautogui.hotkey."""

    @pytest.mark.asyncio
    async def test_hotkey_unpacks_keys(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run("hotkey", "Copy", {"keys": ["ctrl", "c"]})

        mock_pag.hotkey.assert_called_once_with("ctrl", "c", interval=0.05)
        assert result["status"] == "success"
        assert "ctrl+c" in result["voice_message"].lower()


# ── AC #8: Press key ──

class TestAC8_PressKeyAction:
    """AC #8: press_key invokes pyautogui.press."""

    @pytest.mark.asyncio
    async def test_press_key(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run("press_key", "Enter", {"key": "enter"})

        mock_pag.press.assert_called_once_with("enter")
        assert result["status"] == "success"


# ── AC #9: Move mouse ──

class TestAC9_MoveMouseAction:
    """AC #9: move_mouse invokes pyautogui.moveTo without clicking."""

    @pytest.mark.asyncio
    async def test_move_mouse(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run("move_mouse", "Menu", {"x": 100, "y": 50}, 2.0, 2.0)

        mock_pag.moveTo.assert_called_once_with(200, 100)
        mock_pag.click.assert_not_called()
        assert result["status"] == "success"


# ── AC #10: Drag ──

class TestAC10_DragAction:
    """AC #10: drag scales all 4 coordinates and performs moveTo + drag."""

    @pytest.mark.asyncio
    async def test_drag_scales_and_executes(self, gui):
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            result = await gui.run(
                "drag", "Slider",
                {"start_x": 200, "start_y": 300, "end_x": 500, "end_y": 300},
                scale_x=1.5, scale_y=1.5,
            )

        # start: (300, 450), end: (750, 450), dx=450, dy=0
        mock_pag.moveTo.assert_called_once_with(300, 450)
        mock_pag.drag.assert_called_once_with(450, 0, duration=0.5)
        assert result["status"] == "success"
        assert "dragged" in result["voice_message"].lower()


# ── AC #11: FailSafe exception ──

class TestAC11_FailSafeHandling:
    """AC #11: FailSafeException returns error, failsafe stays True."""

    @pytest.mark.asyncio
    async def test_failsafe_returns_descriptive_error(self, gui):
        """WHEN FailSafeException is raised,
        THEN status=error with descriptive voice_message."""
        with patch("tools.gui_automation.pyautogui") as mock_pag:
            mock_pag.FailSafeException = pyautogui.FailSafeException
            mock_pag.click.side_effect = pyautogui.FailSafeException()
            result = await gui.run("click", "Button", {"x": 0, "y": 0})

        assert result["status"] == "error"
        assert "failsafe" in result["voice_message"].lower()
        assert "corner" in result["voice_message"].lower()

    def test_failsafe_remains_enabled(self):
        """pyautogui.FAILSAFE must remain True."""
        assert pyautogui.FAILSAFE is True


# ── AC #12: execute_gui in agent_tools.py delegates to GUIAutomation ──

class TestAC12_AgentToolsDelegation:
    """AC #12: execute_gui in agent_tools.py delegates to gui_automation.py."""

    @pytest.mark.asyncio
    async def test_execute_gui_delegates_to_gui_automation(self):
        """GIVEN execute_gui is called from agent_tools,
        THEN it delegates to _gui_automation.run with scale factors."""
        mock_gui = AsyncMock()
        mock_gui.run = AsyncMock(return_value={
            "status": "success", "description": "clicked",
            "duration_ms": 50, "voice_message": "Done.",
        })

        with patch("core.agent_tools._gui_automation", mock_gui), \
             patch("core.agent_tools.get_screen_size", return_value=(1920, 1080)):
            from core.agent_tools import execute_gui
            result = await execute_gui("click", "Button", {"x": 640, "y": 360})

        mock_gui.run.assert_called_once()
        call_args = mock_gui.run.call_args
        assert call_args[0][0] == "click"
        assert call_args[0][1] == "Button"
        assert call_args[0][2] == {"x": 640, "y": 360}
        # Scale factors should be computed from 1920/1280 = 1.5
        assert call_args[0][3] == pytest.approx(1.5, abs=0.01)
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_execute_gui_preserves_function_signature(self):
        """Signature must remain: async def execute_gui(action, target, coordinates)."""
        import inspect
        from core.agent_tools import execute_gui
        sig = inspect.signature(execute_gui)
        params = list(sig.parameters.keys())
        assert params == ["action", "target", "coordinates"]


# ── AC #13: Platform adapter auto-detection ──

class TestAC13_PlatformAdapters:
    """AC #13: platform_adapters provides get_adapter() with correct methods."""

    def test_get_adapter_returns_platform_adapter(self):
        from platform_adapters import get_adapter
        from platform_adapters.base import PlatformAdapter
        adapter = get_adapter()
        assert isinstance(adapter, PlatformAdapter)

    def test_adapter_has_focus_window_method(self):
        from platform_adapters import get_adapter
        adapter = get_adapter()
        assert hasattr(adapter, "focus_window")
        assert callable(adapter.focus_window)

    def test_adapter_has_list_windows_method(self):
        from platform_adapters import get_adapter
        adapter = get_adapter()
        assert hasattr(adapter, "list_windows")
        assert callable(adapter.list_windows)

    def test_correct_adapter_for_current_os(self):
        from platform_adapters import get_adapter
        adapter = get_adapter()
        system = platform.system()
        if system == "Windows":
            from platform_adapters.windows import WindowsAdapter
            assert isinstance(adapter, WindowsAdapter)
        elif system == "Darwin":
            from platform_adapters.macos import MacOSAdapter
            assert isinstance(adapter, MacOSAdapter)
        else:
            from platform_adapters.linux import LinuxAdapter
            assert isinstance(adapter, LinuxAdapter)
