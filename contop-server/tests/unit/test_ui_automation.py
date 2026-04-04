"""
Unit tests for tools/ui_automation.py and platform adapter accessibility methods.

Tests get_foreground_window_name(), get_focused_element(), get_interactive_elements(),
interact_element(), get_element_tree() for each platform adapter + execute_accessible tool.
Mocks platform-specific libraries to avoid requiring actual display/accessibility access.

[Source: tech-spec-accessibility-tree-backend.md — Tasks 18-20]
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def ui_auto():
    """Return a fresh UIAutomation instance (clear singleton)."""
    from tools.ui_automation import UIAutomation
    UIAutomation._instance = None
    return UIAutomation()


# ---------------------------------------------------------------------------
# Task 20.1: Base adapter graceful degradation
# ---------------------------------------------------------------------------

class TestBaseAdapterDefaults:
    """When accessibility library is NOT installed, methods return empty values."""

    def _make_minimal(self):
        from platform_adapters.base import PlatformAdapter
        class MinimalAdapter(PlatformAdapter):
            def focus_window(self, title): return False
            def list_windows(self): return []
        return MinimalAdapter()

    def test_base_get_foreground_window_name_returns_empty(self):
        adapter = self._make_minimal()
        assert adapter.get_foreground_window_name() == ""

    def test_base_get_focused_element_returns_empty_dict(self):
        adapter = self._make_minimal()
        assert adapter.get_focused_element() == {}

    def test_base_get_interactive_elements_returns_empty_list(self):
        adapter = self._make_minimal()
        assert adapter.get_interactive_elements() == []

    def test_base_interact_element_returns_graceful_error(self):
        adapter = self._make_minimal()
        result = adapter.interact_element(name="Submit", action="click")
        assert result["found"] is False
        assert result["status"] == "error"
        assert "not available" in result["description"].lower()

    def test_base_get_element_tree_returns_empty_list(self):
        adapter = self._make_minimal()
        assert adapter.get_element_tree() == []


# ---------------------------------------------------------------------------
# Task 20.2: Windows adapter with mocked pywinauto
# ---------------------------------------------------------------------------

class TestWindowsAdapterAccessibility:
    """Windows adapter accessibility methods with pywinauto UIA backend."""

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_get_foreground_window_name_with_pywinauto(self, mock_top_win):
        mock_win = MagicMock()
        mock_win.window_text.return_value = "Google Chrome"
        mock_top_win.return_value = mock_win
        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.get_foreground_window_name()
        assert result == "Google Chrome"

    @patch("platform_adapters.windows._HAS_PYWINAUTO", False)
    def test_get_foreground_window_name_without_pywinauto(self):
        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.get_foreground_window_name()
        assert result == ""

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    def test_get_focused_element_with_pywinauto(self):
        import sys

        # Mock UIA's GetFocusedElement() → UIAElementInfo path
        mock_info = MagicMock()
        mock_info.name = "Address bar"
        mock_info.control_type = "Edit"
        mock_info.automation_id = "addressBar"
        mock_info.class_name = "OmniboxView"

        mock_uia_defines = MagicMock()
        mock_uia_defines.IUIA.return_value.iuia.GetFocusedElement.return_value = MagicMock()
        mock_uia_element_info = MagicMock()
        mock_uia_element_info.UIAElementInfo.return_value = mock_info

        with patch.dict(sys.modules, {
            "pywinauto.uia_defines": mock_uia_defines,
            "pywinauto.uia_element_info": mock_uia_element_info,
        }):
            from platform_adapters.windows import WindowsAdapter
            adapter = WindowsAdapter()
            result = adapter.get_focused_element()
            assert result["name"] == "Address bar"
            assert result["type"] == "Edit"
            assert result["automation_id"] == "addressBar"
            assert result["class_name"] == "OmniboxView"

    @patch("platform_adapters.windows._HAS_PYWINAUTO", False)
    def test_get_focused_element_without_pywinauto(self):
        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.get_focused_element()
        assert result == {}

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_get_interactive_elements_with_pywinauto(self, mock_top_win):
        # Create mock UI tree with pywinauto element_info pattern
        btn = MagicMock()
        btn.element_info.control_type = "Button"
        btn.element_info.name = "Submit"
        btn.element_info.automation_id = "submitBtn"
        btn.children.return_value = []

        edit = MagicMock()
        edit.element_info.control_type = "Edit"
        edit.element_info.name = "Username"
        edit.element_info.automation_id = "userInput"
        edit.children.return_value = []

        text = MagicMock()
        text.element_info.control_type = "Text"  # Not in _INTERACTIVE_TYPES
        text.element_info.name = "Label"
        text.element_info.automation_id = ""
        text.children.return_value = []

        mock_win = MagicMock()
        mock_win.children.return_value = [btn, edit, text]
        mock_top_win.return_value = mock_win

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.get_interactive_elements()

        assert len(result) == 2  # btn + edit, not text
        assert result[0]["name"] == "Submit"
        assert result[0]["type"] == "Button"
        assert result[1]["name"] == "Username"

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._find_window_by_title")
    @patch("platform_adapters.windows._get_top_window")
    def test_get_interactive_elements_with_window_title(self, mock_top_win, mock_find_by_title):
        """When window_title is provided, _find_window_by_title is used instead of _get_top_window."""
        btn = MagicMock()
        btn.element_info.control_type = "Button"
        btn.element_info.name = "Save"
        btn.element_info.automation_id = "saveBtn"
        btn.children.return_value = []

        mock_dialog = MagicMock()
        mock_dialog.children.return_value = [btn]
        mock_find_by_title.return_value = mock_dialog

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.get_interactive_elements(window_title="Save As")

        mock_find_by_title.assert_called_once_with("Save As")
        mock_top_win.assert_not_called()
        assert len(result) == 1
        assert result[0]["name"] == "Save"

    @patch("platform_adapters.windows._HAS_PYWINAUTO", False)
    def test_get_interactive_elements_without_pywinauto(self):
        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.get_interactive_elements()
        assert result == []

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_get_interactive_elements_respects_max_elements(self, mock_top_win):
        """Element cap prevents hangs on complex UIs."""
        children = []
        for i in range(250):
            btn = MagicMock()
            btn.element_info.control_type = "Button"
            btn.element_info.name = f"Button{i}"
            btn.element_info.automation_id = f"btn{i}"
            btn.children.return_value = []
            children.append(btn)

        mock_win = MagicMock()
        mock_win.children.return_value = children
        mock_top_win.return_value = mock_win

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.get_interactive_elements()
        assert len(result) == 200  # MAX_ELEMENTS cap


# ---------------------------------------------------------------------------
# _find_window_by_title helper
# ---------------------------------------------------------------------------

class TestFindWindowByTitle:
    """Tests for the _find_window_by_title helper function."""

    @patch("platform_adapters.windows._get_desktop")
    def test_finds_matching_window(self, mock_desktop):
        mock_win = MagicMock()
        mock_win.window_text.return_value = "Save As"
        mock_desktop.return_value.windows.return_value = [mock_win]

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("Save As")
        assert result is mock_win

    @patch("platform_adapters.windows._get_desktop")
    def test_finds_partial_match(self, mock_desktop):
        mock_win = MagicMock()
        mock_win.window_text.return_value = "Save As - Notepad"
        mock_desktop.return_value.windows.return_value = [mock_win]

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("Save As")
        assert result is mock_win

    @patch("platform_adapters.windows._get_desktop")
    def test_finds_embedded_child_dialog(self, mock_desktop):
        """Win11 Notepad: Save As is a child pane inside the Notepad window,
        not a separate top-level window. Stage 2 should find it."""
        # System window (should be skipped)
        status_win = MagicMock()
        status_win.window_text.return_value = "Status"

        # Notepad window with embedded "Save As" child pane
        save_as_pane = MagicMock()
        save_as_pane.element_info.name = "Save As"
        save_as_pane.children.return_value = []

        notepad_win = MagicMock()
        notepad_win.window_text.return_value = "*Untitled - Notepad"
        notepad_win.children.return_value = [save_as_pane]

        mock_desktop.return_value.windows.return_value = [status_win, notepad_win]

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("Save As")
        assert result is notepad_win

    @patch("platform_adapters.windows._get_desktop")
    def test_finds_embedded_grandchild_dialog(self, mock_desktop):
        """Dialog pane nested two levels deep (wrapper pane → dialog)."""
        wrapper_pane = MagicMock()
        dialog_pane = MagicMock()
        dialog_pane.element_info.name = "Save As"
        wrapper_pane.element_info.name = ""
        wrapper_pane.children.return_value = [dialog_pane]

        notepad_win = MagicMock()
        notepad_win.window_text.return_value = "Notepad"
        notepad_win.children.return_value = [wrapper_pane]

        mock_desktop.return_value.windows.return_value = [notepad_win]

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("Save As")
        assert result is notepad_win

    @patch("platform_adapters.windows._get_desktop")
    def test_embedded_search_skips_system_windows(self, mock_desktop):
        """System windows (Taskbar, Status, empty) are never searched for embedded dialogs."""
        taskbar = MagicMock()
        taskbar.window_text.return_value = "Taskbar"
        # If searched, this would match — but it should be skipped
        taskbar_child = MagicMock()
        taskbar_child.element_info.name = "Save As"
        taskbar.children.return_value = [taskbar_child]

        status = MagicMock()
        status.window_text.return_value = "Status"
        status.children.return_value = []

        empty = MagicMock()
        empty.window_text.return_value = ""
        empty.children.return_value = []

        mock_desktop.return_value.windows.return_value = [taskbar, status, empty]

        from platform_adapters.windows import _find_window_by_title
        with patch("platform_adapters.windows._get_top_window", return_value=None):
            result = _find_window_by_title("Save As")
        assert result is None  # None, not the taskbar

    @patch("platform_adapters.windows._get_top_window")
    @patch("platform_adapters.windows._get_desktop")
    def test_falls_back_to_foreground_when_no_embedded_match(self, mock_desktop, mock_top_win):
        """When neither top-level nor embedded search matches, fall back to foreground."""
        # Chrome window with no matching children
        chrome_child = MagicMock()
        chrome_child.element_info.name = "Address bar"
        chrome_child.children.return_value = []

        chrome_win = MagicMock()
        chrome_win.window_text.return_value = "Google Chrome"
        chrome_win.children.return_value = [chrome_child]

        mock_desktop.return_value.windows.return_value = [chrome_win]

        mock_fg = MagicMock()
        mock_fg.window_text.return_value = "*Untitled - Notepad"
        mock_top_win.return_value = mock_fg

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("Save As")
        assert result is mock_fg  # Falls back to foreground window

    @patch("platform_adapters.windows._get_top_window")
    @patch("platform_adapters.windows._get_desktop")
    def test_returns_none_when_no_match_and_no_foreground(self, mock_desktop, mock_top_win):
        chrome_win = MagicMock()
        chrome_win.window_text.return_value = "Google Chrome"
        chrome_win.children.return_value = []
        mock_desktop.return_value.windows.return_value = [chrome_win]
        mock_top_win.return_value = None

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("Save As")
        assert result is None

    @patch("platform_adapters.windows._get_desktop")
    def test_case_insensitive(self, mock_desktop):
        mock_win = MagicMock()
        mock_win.window_text.return_value = "SAVE AS"
        mock_desktop.return_value.windows.return_value = [mock_win]

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("save as")
        assert result is mock_win

    @patch("platform_adapters.windows._get_desktop")
    def test_embedded_search_prefers_app_over_system_foreground(self, mock_desktop):
        """The real bug: GetForegroundWindow() returns 'Status' (taskbar) but
        the Notepad window with the embedded Save As dialog should be found
        by stage 2 instead of falling through to the broken foreground fallback."""
        status_win = MagicMock()
        status_win.window_text.return_value = "Status"

        taskbar_win = MagicMock()
        taskbar_win.window_text.return_value = "Taskbar"

        # Notepad with embedded Save As
        save_as_child = MagicMock()
        save_as_child.element_info.name = "Save As"
        save_as_child.children.return_value = []

        notepad_win = MagicMock()
        notepad_win.window_text.return_value = "*we need to add multi model support - Notepad"
        notepad_win.children.return_value = [save_as_child]

        chrome_win = MagicMock()
        chrome_win.window_text.return_value = "Google Chrome"
        chrome_child = MagicMock()
        chrome_child.element_info.name = "tabs"
        chrome_child.children.return_value = []
        chrome_win.children.return_value = [chrome_child]

        mock_desktop.return_value.windows.return_value = [
            status_win, taskbar_win, notepad_win, chrome_win,
        ]

        from platform_adapters.windows import _find_window_by_title
        result = _find_window_by_title("Save As")
        assert result is notepad_win  # Found via embedded search, NOT foreground fallback


# ---------------------------------------------------------------------------
# Windows adapter interact_element() via pywinauto
# ---------------------------------------------------------------------------

class TestWindowsAdapterInteraction:
    """Windows adapter interact_element() with mocked pywinauto."""

    @staticmethod
    def _make_element(name="", control_type="", automation_id=""):
        """Create a mock pywinauto element with element_info and no children."""
        elem = MagicMock()
        elem.element_info.name = name
        elem.element_info.control_type = control_type
        elem.element_info.automation_id = automation_id
        elem.children.return_value = []
        return elem

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_click_by_name(self, mock_top_win):
        """Click element found by name — invoke() used for deterministic click."""
        mock_element = self._make_element("Submit", "Button")
        mock_win = MagicMock()
        mock_win.children.return_value = [mock_element]
        mock_top_win.return_value = mock_win

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.interact_element(name="Submit", action="click")

        assert result["found"] is True
        assert result["status"] == "success"
        assert result["element_name"] == "Submit"
        mock_element.invoke.assert_called_once()

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_click_by_automation_id(self, mock_top_win):
        """Click element found by automation_id — exact match."""
        mock_element = self._make_element("OK", "Button", "okBtn")
        mock_win = MagicMock()
        mock_win.children.return_value = [mock_element]
        mock_top_win.return_value = mock_win

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.interact_element(automation_id="okBtn", action="click")

        assert result["found"] is True
        assert result["element_name"] == "OK"

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_set_value(self, mock_top_win):
        """set_value action uses focus + select-all + type_keys for real keyboard events."""
        mock_element = self._make_element("Search", "Edit")
        mock_win = MagicMock()
        mock_win.children.return_value = [mock_element]
        mock_top_win.return_value = mock_win

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.interact_element(name="Search", action="set_value", value="hello")

        assert result["found"] is True
        assert result["action_performed"] == "set_value"
        mock_element.set_focus.assert_called_once()
        # First type_keys call: Ctrl+A (select all), second: the value
        assert mock_element.type_keys.call_count == 2
        mock_element.type_keys.assert_any_call("^a", pause=0.05)
        mock_element.type_keys.assert_any_call("hello", with_spaces=True, pause=0.05)

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_element_not_found(self, mock_top_win):
        """Element not found → returns found=False with error message."""
        # Only non-matching elements in tree
        mock_element = self._make_element("Other", "Text")
        mock_win = MagicMock()
        mock_win.children.return_value = [mock_element]
        mock_top_win.return_value = mock_win

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.interact_element(name="NonExistent", action="click")

        assert result["found"] is False
        assert result["status"] == "error"

    @patch("platform_adapters.windows._HAS_PYWINAUTO", True)
    @patch("platform_adapters.windows._get_top_window")
    def test_ambiguous_elements(self, mock_top_win):
        """Multiple matching elements → first match is returned (tree walk)."""
        match1 = self._make_element("Save", "Button")
        match2 = self._make_element("Save As", "Button")
        mock_win = MagicMock()
        mock_win.children.return_value = [match1, match2]
        mock_top_win.return_value = mock_win

        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.interact_element(name="Save", action="click")

        # Tree walk returns first match ("Save")
        assert result["found"] is True
        assert result["element_name"] == "Save"

    @patch("platform_adapters.windows._HAS_PYWINAUTO", False)
    def test_without_pywinauto_returns_graceful_error(self):
        """Without pywinauto → graceful degradation from base class."""
        from platform_adapters.windows import WindowsAdapter
        adapter = WindowsAdapter()
        result = adapter.interact_element(name="Submit", action="click")
        assert result["found"] is False
        assert result["status"] == "error"
        assert "not available" in result["description"].lower()


# ---------------------------------------------------------------------------
# UIAutomation.get_context() async wrapper
# ---------------------------------------------------------------------------

class TestUIAutomationGetContext:
    """Tests for the UIAutomation async wrapper."""

    @pytest.mark.asyncio
    async def test_get_context_returns_dict(self, ui_auto):
        mock_adapter = MagicMock()
        mock_adapter.get_foreground_window_name.return_value = "VS Code"
        mock_adapter.get_focused_element.return_value = {"name": "Editor", "type": "Edit"}
        mock_adapter.get_interactive_elements.return_value = [
            {"name": "File", "type": "MenuItem", "automation_id": ""},
        ]
        # Inject mock adapter directly (singleton caches the adapter at creation)
        ui_auto._adapter = mock_adapter
        result = await ui_auto.get_context()
        assert result["status"] == "success"
        assert result["foreground_window"] == "VS Code"
        assert result["focused_element"]["name"] == "Editor"
        assert result["element_count"] == 1
        assert len(result["interactive_elements"]) == 1


# ---------------------------------------------------------------------------
# get_ui_context tool function in agent_tools.py
# ---------------------------------------------------------------------------

class TestGetUIContextTool:
    """Tests for the get_ui_context ADK tool function."""

    @pytest.mark.asyncio
    async def test_get_ui_context_success(self):
        mock_context = {
            "foreground_window": "Chrome",
            "focused_element": {"name": "Search", "type": "Edit"},
            "interactive_elements": [],
            "element_count": 0,
            "status": "success",
        }
        with patch("core.agent_tools.UIAutomation") as MockClass:
            MockClass.return_value.get_context = AsyncMock(return_value=mock_context)
            from core.agent_tools import get_ui_context
            result = await get_ui_context()
        assert result["status"] == "success"
        assert result["foreground_window"] == "Chrome"

    @pytest.mark.asyncio
    async def test_get_ui_context_passes_window_title(self):
        mock_context = {
            "foreground_window": "Save As",
            "focused_element": {},
            "interactive_elements": [{"name": "File name:", "type": "Edit", "automation_id": ""}],
            "element_count": 1,
            "status": "success",
        }
        with patch("core.agent_tools.UIAutomation") as MockClass:
            MockClass.return_value.get_context = AsyncMock(return_value=mock_context)
            from core.agent_tools import get_ui_context
            result = await get_ui_context(window_title="Save As")
        MockClass.return_value.get_context.assert_called_once_with(max_depth=8, window_title="Save As")
        assert result["status"] == "success"
        assert result["element_count"] == 1

    @pytest.mark.asyncio
    async def test_get_ui_context_error_returns_voice_message(self):
        with patch("core.agent_tools.UIAutomation") as MockClass:
            MockClass.return_value.get_context = AsyncMock(side_effect=RuntimeError("no display"))
            from core.agent_tools import get_ui_context
            result = await get_ui_context()
        assert result["status"] == "error"
        assert "voice_message" in result
        assert "no display" in result["voice_message"]


# ---------------------------------------------------------------------------
# execute_accessible tool function in agent_tools.py
# ---------------------------------------------------------------------------

class TestExecuteAccessibleTool:
    """Tests for the execute_accessible ADK tool function."""

    @pytest.mark.asyncio
    async def test_success(self):
        """Successful element interaction returns found=True."""
        mock_result = {
            "found": True, "status": "success",
            "element_name": "Submit", "element_type": "Button",
            "action_performed": "click",
            "description": "Clicked Submit",
            "voice_message": "Done.",
        }
        with patch("core.agent_tools.UIAutomation") as MockClass:
            MockClass.return_value.interact = AsyncMock(return_value=mock_result)
            from core.agent_tools import execute_accessible
            result = await execute_accessible(
                action="click", target="Submit button", element_name="Submit"
            )
        assert result["status"] == "success"
        assert result["found"] is True
        assert "duration_ms" in result

    @pytest.mark.asyncio
    async def test_not_found_shows_available_elements(self):
        """Element not found → error enriched with available elements from rich tree."""
        mock_result = {
            "found": False, "status": "error",
            "element_name": "NonExistent", "element_type": "",
            "action_performed": "click",
            "description": "Element not found.",
            "voice_message": "Not found.",
        }
        mock_rich_tree = [
            {"name": "OK", "type": "Button", "enabled": True, "visible": True},
            {"name": "Cancel", "type": "Button", "enabled": False, "visible": True},
        ]
        with patch("core.agent_tools.UIAutomation") as MockClass:
            instance = MockClass.return_value
            instance.interact = AsyncMock(return_value=mock_result)
            instance.get_rich_tree = AsyncMock(return_value=mock_rich_tree)
            from core.agent_tools import execute_accessible
            result = await execute_accessible(
                action="click", target="missing", element_name="NonExistent"
            )
        assert result["status"] == "error"
        assert "available_elements" in result
        assert "OK" in result["available_elements"]
        assert "disabled" in result["available_elements"]  # Cancel is disabled

    @pytest.mark.asyncio
    async def test_invalid_action(self):
        """Unknown action → immediate error without calling UIAutomation."""
        from core.agent_tools import execute_accessible
        result = await execute_accessible(
            action="destroy", target="button", element_name="Submit"
        )
        assert result["status"] == "error"
        assert "destroy" in result["description"].lower() or "unknown" in result["description"].lower()

    @pytest.mark.asyncio
    async def test_no_identifier(self):
        """No element identifier → error asking for element_name/auto_id/type."""
        from core.agent_tools import execute_accessible
        result = await execute_accessible(action="click", target="something")
        assert result["status"] == "error"
        assert "identifier" in result["description"].lower() or "specify" in result["description"].lower()


# ---------------------------------------------------------------------------
# macOS adapter interact_element() via mocked pyobjc AX API
# ---------------------------------------------------------------------------

class TestMacOSAdapterInteraction:
    """macOS adapter interact_element() with mocked pyobjc/AX."""

    @patch("platform_adapters.macos._HAS_AX", True)
    @patch("platform_adapters.macos._HAS_PYOBJC", True)
    @patch("platform_adapters.macos.NSWorkspace", create=True)
    @patch("platform_adapters.macos.AXUIElementCreateApplication", create=True)
    def test_click_success(self, mock_create_app, mock_workspace):
        """Click element found by name in macOS AX tree."""
        mock_app = MagicMock()
        mock_app.processIdentifier.return_value = 1234
        mock_workspace.sharedWorkspace.return_value.frontmostApplication.return_value = mock_app

        # Build a mock AX tree with one matching child
        mock_child = MagicMock()
        mock_child.copyAttributeValue_.side_effect = lambda attr, _: {
            "AXRole": (0, "AXButton"),
            "AXTitle": (0, "Submit"),
            "AXDescription": (0, ""),
            "AXIdentifier": (0, ""),
            "AXChildren": (0, []),
        }.get(attr, (1, None))

        mock_app_ref = MagicMock()
        mock_app_ref.copyAttributeValue_.side_effect = lambda attr, _: {
            "AXChildren": (0, [mock_child]),
        }.get(attr, (1, None))
        mock_create_app.return_value = mock_app_ref

        from platform_adapters.macos import MacOSAdapter
        adapter = MacOSAdapter()
        # Patch _execute_ax_action to avoid importing ApplicationServices
        mock_execute = MagicMock()
        with patch.object(adapter, "_execute_ax_action", mock_execute):
            result = adapter.interact_element(name="Submit", action="click")

        assert result["found"] is True
        assert result["status"] == "success"
        assert result["element_name"] == "Submit"
        mock_execute.assert_called_once()

    @patch("platform_adapters.macos._HAS_AX", True)
    @patch("platform_adapters.macos._HAS_PYOBJC", True)
    @patch("platform_adapters.macos.NSWorkspace", create=True)
    @patch("platform_adapters.macos.AXUIElementCreateApplication", create=True)
    def test_element_not_found(self, mock_create_app, mock_workspace):
        """Element not found in macOS AX tree → returns found=False."""
        mock_app = MagicMock()
        mock_app.processIdentifier.return_value = 1234
        mock_workspace.sharedWorkspace.return_value.frontmostApplication.return_value = mock_app

        # Empty children list
        mock_app_ref = MagicMock()
        mock_app_ref.copyAttributeValue_.side_effect = lambda attr, _: {
            "AXChildren": (0, []),
        }.get(attr, (1, None))
        mock_create_app.return_value = mock_app_ref

        from platform_adapters.macos import MacOSAdapter
        adapter = MacOSAdapter()
        result = adapter.interact_element(name="NonExistent", action="click")

        assert result["found"] is False
        assert result["status"] == "error"

    @patch("platform_adapters.macos._HAS_AX", False)
    @patch("platform_adapters.macos._HAS_PYOBJC", False)
    def test_without_pyobjc_returns_graceful_error(self):
        """Without pyobjc → graceful degradation from base class."""
        from platform_adapters.macos import MacOSAdapter
        adapter = MacOSAdapter()
        result = adapter.interact_element(name="Submit", action="click")
        assert result["found"] is False
        assert result["status"] == "error"
        assert "not available" in result["description"].lower()

    @patch("platform_adapters.macos._HAS_AX", True)
    @patch("platform_adapters.macos._HAS_PYOBJC", True)
    @patch("platform_adapters.macos.NSWorkspace", create=True)
    def test_no_frontmost_app(self, mock_workspace):
        """No frontmost application → returns error."""
        mock_workspace.sharedWorkspace.return_value.frontmostApplication.return_value = None

        from platform_adapters.macos import MacOSAdapter
        adapter = MacOSAdapter()
        result = adapter.interact_element(name="Submit", action="click")

        assert result["found"] is False
        assert "no frontmost" in result["description"].lower() or "not found" in result["description"].lower()


# ---------------------------------------------------------------------------
# Linux adapter interact_element() via mocked pyatspi
# ---------------------------------------------------------------------------

class TestLinuxAdapterInteraction:
    """Linux adapter interact_element() with mocked pyatspi."""

    @patch("platform_adapters.linux._HAS_PYATSPI", True)
    @patch("platform_adapters.linux.pyatspi", create=True)
    def test_click_success(self, mock_pyatspi):
        """Click element found by name in AT-SPI2 tree."""
        # Build a mock desktop → app → frame → element tree
        mock_element = MagicMock()
        mock_element.name = "Submit"
        mock_element.getRoleName.return_value = "push button"
        mock_element.childCount = 0
        mock_element.getChildAtIndex.return_value = None

        mock_frame = MagicMock()
        mock_frame.getState.return_value.contains.return_value = True  # STATE_ACTIVE
        mock_frame.childCount = 1
        mock_frame.getChildAtIndex.return_value = mock_element

        mock_app = MagicMock()
        mock_app.childCount = 1
        mock_app.getChildAtIndex.return_value = mock_frame

        mock_desktop = MagicMock()
        mock_desktop.__iter__ = lambda self: iter([mock_app])

        mock_pyatspi.Registry.getDesktop.return_value = mock_desktop
        mock_pyatspi.STATE_ACTIVE = "active"

        from platform_adapters.linux import LinuxAdapter
        adapter = LinuxAdapter()
        result = adapter.interact_element(name="Submit", action="click")

        assert result["found"] is True
        assert result["status"] == "success"
        assert result["element_name"] == "Submit"
        mock_element.queryAction.return_value.doAction.assert_called_once_with(0)

    @patch("platform_adapters.linux._HAS_PYATSPI", True)
    @patch("platform_adapters.linux.pyatspi", create=True)
    def test_set_value(self, mock_pyatspi):
        """set_value action uses AT-SPI2 editable text interface."""
        mock_element = MagicMock()
        mock_element.name = "Search"
        mock_element.getRoleName.return_value = "text"
        mock_element.childCount = 0

        mock_frame = MagicMock()
        mock_frame.getState.return_value.contains.return_value = True
        mock_frame.childCount = 1
        mock_frame.getChildAtIndex.return_value = mock_element

        mock_app = MagicMock()
        mock_app.childCount = 1
        mock_app.getChildAtIndex.return_value = mock_frame

        mock_desktop = MagicMock()
        mock_desktop.__iter__ = lambda self: iter([mock_app])

        mock_pyatspi.Registry.getDesktop.return_value = mock_desktop
        mock_pyatspi.STATE_ACTIVE = "active"

        from platform_adapters.linux import LinuxAdapter
        adapter = LinuxAdapter()
        result = adapter.interact_element(name="Search", action="set_value", value="hello")

        assert result["found"] is True
        assert result["action_performed"] == "set_value"
        mock_element.queryEditableText.return_value.setTextContents.assert_called_once_with("hello")

    @patch("platform_adapters.linux._HAS_PYATSPI", True)
    @patch("platform_adapters.linux.pyatspi", create=True)
    def test_element_not_found(self, mock_pyatspi):
        """Element not found in AT-SPI2 tree → returns found=False."""
        # Frame with no matching children
        mock_frame = MagicMock()
        mock_frame.getState.return_value.contains.return_value = True
        mock_frame.childCount = 0

        mock_app = MagicMock()
        mock_app.childCount = 1
        mock_app.getChildAtIndex.return_value = mock_frame

        mock_desktop = MagicMock()
        mock_desktop.__iter__ = lambda self: iter([mock_app])

        mock_pyatspi.Registry.getDesktop.return_value = mock_desktop
        mock_pyatspi.STATE_ACTIVE = "active"

        from platform_adapters.linux import LinuxAdapter
        adapter = LinuxAdapter()
        result = adapter.interact_element(name="NonExistent", action="click")

        assert result["found"] is False
        assert result["status"] == "error"

    @patch("platform_adapters.linux._HAS_PYATSPI", False)
    def test_without_pyatspi_returns_graceful_error(self):
        """Without pyatspi → graceful degradation from base class."""
        from platform_adapters.linux import LinuxAdapter
        adapter = LinuxAdapter()
        result = adapter.interact_element(name="Submit", action="click")
        assert result["found"] is False
        assert result["status"] == "error"
        assert "not available" in result["description"].lower()


# ---------------------------------------------------------------------------
# BrowserAutomation.connect_to_cdp() tests
# ---------------------------------------------------------------------------

class TestConnectToCdp:
    """Tests for SSRF protection and CDP connection in BrowserAutomation."""

    @pytest.mark.asyncio
    async def test_ssrf_rejects_external_host(self):
        """CDP URL pointing to external host → immediate rejection."""
        from tools.browser_automation import BrowserAutomation
        ba = BrowserAutomation()
        result = await ba.connect_to_cdp("http://evil.com:9222")
        assert result["status"] == "error"
        assert "localhost" in result["description"].lower()

    @pytest.mark.asyncio
    async def test_ssrf_rejects_internal_ip(self):
        """CDP URL to a private network IP → rejected (not localhost)."""
        from tools.browser_automation import BrowserAutomation
        ba = BrowserAutomation()
        result = await ba.connect_to_cdp("http://192.168.1.100:9222")
        assert result["status"] == "error"
        assert "localhost" in result["description"].lower()

    @pytest.mark.asyncio
    async def test_ssrf_rejects_bad_scheme(self):
        """CDP URL with disallowed scheme → rejected."""
        from tools.browser_automation import BrowserAutomation
        ba = BrowserAutomation()
        # ftp://localhost still has a valid host but a disallowed scheme
        result = await ba.connect_to_cdp("ftp://localhost:9222")
        assert result["status"] == "error"
        assert "scheme" in result["description"].lower()

    @pytest.mark.asyncio
    async def test_allows_localhost(self):
        """CDP URL to localhost → passes SSRF check, proceeds to PinchTab."""
        from tools.browser_automation import BrowserAutomation
        ba = BrowserAutomation()
        with patch.object(ba, "ensure_running", new_callable=AsyncMock, return_value=True):
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"id": "inst-123"}
            mock_resp.raise_for_status = MagicMock()
            with patch.object(ba._client, "post", new_callable=AsyncMock, return_value=mock_resp):
                result = await ba.connect_to_cdp("http://localhost:9222")
        assert result["status"] == "success"
        assert result["instance_id"] == "inst-123"

    @pytest.mark.asyncio
    async def test_allows_127_0_0_1(self):
        """CDP URL to 127.0.0.1 → passes SSRF check."""
        from tools.browser_automation import BrowserAutomation
        ba = BrowserAutomation()
        with patch.object(ba, "ensure_running", new_callable=AsyncMock, return_value=True):
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {"id": "inst-456"}
            mock_resp.raise_for_status = MagicMock()
            with patch.object(ba._client, "post", new_callable=AsyncMock, return_value=mock_resp):
                result = await ba.connect_to_cdp("http://127.0.0.1:9222")
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_pinchtab_404_returns_unsupported(self):
        """PinchTab returns 404 for /instances/connect → unsupported message."""
        import httpx
        from tools.browser_automation import BrowserAutomation
        ba = BrowserAutomation()
        with patch.object(ba, "ensure_running", new_callable=AsyncMock, return_value=True):
            mock_resp = MagicMock()
            mock_resp.status_code = 404
            mock_request = MagicMock()
            mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
                "404 Not Found", request=mock_request, response=mock_resp,
            )
            with patch.object(ba._client, "post", new_callable=AsyncMock, return_value=mock_resp):
                result = await ba.connect_to_cdp("http://localhost:9222")
        assert result["status"] == "error"
        assert "does not support" in result["description"] or "failed" in result["description"].lower()

    @pytest.mark.asyncio
    async def test_pinchtab_not_running(self):
        """PinchTab not running → error returned."""
        from tools.browser_automation import BrowserAutomation
        ba = BrowserAutomation()
        with patch.object(ba, "ensure_running", new_callable=AsyncMock, return_value=False):
            result = await ba.connect_to_cdp("http://localhost:9222")
        assert result["status"] == "error"
        assert "not running" in result["description"].lower()


# ---------------------------------------------------------------------------
# get_adapter returns correct type per OS
# ---------------------------------------------------------------------------

class TestGetAdapterAccessibility:
    """Verify that get_adapter() returns an adapter with accessibility methods."""

    def test_adapter_has_accessibility_methods(self):
        from platform_adapters import get_adapter
        adapter = get_adapter()
        assert hasattr(adapter, "get_foreground_window_name")
        assert hasattr(adapter, "get_focused_element")
        assert hasattr(adapter, "get_interactive_elements")
        assert hasattr(adapter, "interact_element")
        assert hasattr(adapter, "get_element_tree")
        # Verify they are callable and return correct types
        assert isinstance(adapter.get_foreground_window_name(), str)
        assert isinstance(adapter.get_focused_element(), dict)
        assert isinstance(adapter.get_interactive_elements(), list)
        assert isinstance(adapter.get_element_tree(), list)
