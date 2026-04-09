"""
Unit tests for core/window_tools.py - Window and clipboard tools.

Tests window_list, window_focus, resize_window, clipboard_read, clipboard_write
with a mocked platform adapter.

Module under test: core.window_tools
"""
import pytest

from core.window_tools import window_list, window_focus, resize_window, clipboard_read, clipboard_write


class MockAdapter:
    """Mock platform adapter for testing window/clipboard tools."""

    def __init__(self):
        self.windows = ["Notepad", "Chrome - Google", "VS Code"]
        self._focused = None
        self._clipboard = "initial clipboard"
        self._resized = False

    def list_windows(self):
        return self.windows

    def focus_window(self, title):
        for w in self.windows:
            if title.lower() in w.lower():
                self._focused = w
                return True
        return False

    def resize_window(self, title, width, height, x=None, y=None):
        self._resized = True
        return True

    def snap_window(self, title, layout):
        self._resized = True
        return True

    def clipboard_read(self):
        return self._clipboard

    def clipboard_write(self, text):
        self._clipboard = text
        return True


@pytest.fixture(autouse=True)
def mock_adapter(monkeypatch):
    """Replace _get_adapter() with our mock."""
    adapter = MockAdapter()
    monkeypatch.setattr("core.window_tools._get_adapter", lambda: adapter)
    return adapter


@pytest.mark.unit
class TestWindowList:
    async def test_returns_window_titles(self, mock_adapter):
        result = await window_list()
        assert result["status"] == "success"
        assert result["count"] == 3
        assert "Notepad" in result["windows"]

    async def test_empty_window_list(self, mock_adapter):
        mock_adapter.windows = []
        result = await window_list()
        assert result["status"] == "success"
        assert result["count"] == 0


@pytest.mark.unit
class TestWindowFocus:
    async def test_focus_existing_window(self, mock_adapter):
        result = await window_focus("Notepad")
        assert result["status"] == "success"
        assert result["focused"] is True
        assert mock_adapter._focused == "Notepad"

    async def test_focus_nonexistent_window(self, mock_adapter):
        result = await window_focus("nonexistent_app_xyz")
        assert result["status"] == "success"
        assert result["focused"] is False


@pytest.mark.unit
class TestResizeWindow:
    async def test_resize_with_layout(self, mock_adapter):
        result = await resize_window(layout="left_half")
        assert result["status"] == "success"
        assert result["resized"] is True

    async def test_resize_with_dimensions(self, mock_adapter):
        result = await resize_window(width=800, height=600)
        assert result["status"] == "success"
        assert result["resized"] is True

    async def test_resize_no_params_returns_error(self, mock_adapter):
        result = await resize_window()
        assert result["status"] == "error"
        assert "layout" in result["description"].lower() or "width" in result["description"].lower()


@pytest.mark.unit
class TestClipboardRead:
    async def test_read_clipboard(self, mock_adapter):
        result = await clipboard_read()
        assert result["status"] == "success"
        assert result["content"] == "initial clipboard"


@pytest.mark.unit
class TestClipboardWrite:
    async def test_write_clipboard(self, mock_adapter):
        result = await clipboard_write("hello world")
        assert result["status"] == "success"
        assert result["written"] is True
        assert result["length"] == 11
        assert mock_adapter._clipboard == "hello world"
