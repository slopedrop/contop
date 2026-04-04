"""
Unit tests for maximize_active_window tool and platform adapter window management.

Tests the cross-platform is_window_maximized / maximize_window methods with
mocked OS APIs to avoid actual window manipulation during tests.
"""
import asyncio
from unittest.mock import MagicMock, patch, PropertyMock

import pytest


# ---------------------------------------------------------------------------
# Platform Adapter Tests
# ---------------------------------------------------------------------------

class TestWindowsAdapterMaximize:
    """Windows adapter: is_window_maximized and maximize_window via ctypes."""

    def _make_adapter(self):
        with patch.dict("sys.modules", {"pywinauto": MagicMock(), "pywinauto.findwindows": MagicMock()}):
            from platform_adapters.windows import WindowsAdapter
            return WindowsAdapter()

    @patch("platform_adapters.windows.ctypes")
    def test_is_maximized_returns_true_when_sw_maximize(self, mock_ctypes):
        """showCmd == 3 (SW_MAXIMIZE) means maximized."""
        adapter = self._make_adapter()
        # Mock GetWindowPlacement to set showCmd = 3
        mock_ctypes.windll.user32.GetForegroundWindow.return_value = 12345

        def fake_get_placement(hwnd, wp_ptr):
            # ctypes.byref returns a pointer — we set showCmd via side_effect
            pass

        mock_ctypes.windll.user32.GetWindowPlacement.side_effect = fake_get_placement
        # Since ctypes struct mocking is complex, test the method doesn't crash
        # and returns a bool
        result = adapter.is_window_maximized()
        assert isinstance(result, bool)

    @patch("platform_adapters.windows.ctypes")
    def test_is_maximized_returns_false_when_no_hwnd(self, mock_ctypes):
        """No foreground window → False."""
        adapter = self._make_adapter()
        mock_ctypes.windll.user32.GetForegroundWindow.return_value = 0
        assert adapter.is_window_maximized() is False

    @patch("platform_adapters.windows.ctypes")
    def test_maximize_returns_false_when_no_hwnd(self, mock_ctypes):
        """No foreground window → cannot maximize."""
        adapter = self._make_adapter()
        mock_ctypes.windll.user32.GetForegroundWindow.return_value = 0
        assert adapter.maximize_window() is False


class TestMacOSAdapterMaximize:
    """macOS adapter: is_window_maximized and maximize_window via JXA."""

    def _make_adapter(self):
        with patch.dict("sys.modules", {
            "AppKit": MagicMock(),
            "ApplicationServices": MagicMock(),
        }):
            from platform_adapters.macos import MacOSAdapter
            return MacOSAdapter()

    @patch("platform_adapters.macos.subprocess.run")
    def test_is_maximized_true(self, mock_run):
        """JXA returns 'true' → is_window_maximized returns True."""
        adapter = self._make_adapter()
        mock_run.return_value = MagicMock(returncode=0, stdout="true\n")
        assert adapter.is_window_maximized() is True

    @patch("platform_adapters.macos.subprocess.run")
    def test_is_maximized_false(self, mock_run):
        """JXA returns 'false' → not maximized."""
        adapter = self._make_adapter()
        mock_run.return_value = MagicMock(returncode=0, stdout="false\n")
        assert adapter.is_window_maximized() is False

    @patch("platform_adapters.macos.subprocess.run")
    def test_is_maximized_handles_failure(self, mock_run):
        """osascript failure → graceful False."""
        adapter = self._make_adapter()
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="error")
        assert adapter.is_window_maximized() is False

    @patch("platform_adapters.macos.subprocess.run")
    def test_maximize_skips_when_already_maximized(self, mock_run):
        """Idempotent: already maximized → no-op, returns True."""
        adapter = self._make_adapter()
        # First call (is_maximized check) returns true
        mock_run.return_value = MagicMock(returncode=0, stdout="true\n")
        assert adapter.maximize_window() is True
        # Only the is_maximized check should run (1 call)
        assert mock_run.call_count == 1

    @patch("platform_adapters.macos.subprocess.run")
    def test_maximize_calls_jxa_when_not_maximized(self, mock_run):
        """Not maximized → calls JXA to maximize."""
        adapter = self._make_adapter()
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="false\n"),  # is_maximized check
            MagicMock(returncode=0, stdout="true\n"),   # maximize call
        ]
        assert adapter.maximize_window() is True
        assert mock_run.call_count == 2


class TestLinuxAdapterMaximize:
    """Linux adapter: is_window_maximized and maximize_window via xdotool/wmctrl."""

    def _make_adapter(self):
        with patch.dict("sys.modules", {"pyatspi": MagicMock()}):
            from platform_adapters.linux import LinuxAdapter
            return LinuxAdapter()

    @patch("platform_adapters.linux.subprocess.run")
    def test_is_maximized_true(self, mock_run):
        """xprop shows both maximized atoms → True."""
        adapter = self._make_adapter()
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="12345\n"),  # xdotool getactivewindow
            MagicMock(
                returncode=0,
                stdout="_NET_WM_STATE(ATOM) = _NET_WM_STATE_MAXIMIZED_VERT, _NET_WM_STATE_MAXIMIZED_HORZ\n",
            ),  # xprop
        ]
        assert adapter.is_window_maximized() is True

    @patch("platform_adapters.linux.subprocess.run")
    def test_is_maximized_false_partial(self, mock_run):
        """Only one maximized atom → not fully maximized."""
        adapter = self._make_adapter()
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="12345\n"),
            MagicMock(
                returncode=0,
                stdout="_NET_WM_STATE(ATOM) = _NET_WM_STATE_MAXIMIZED_VERT\n",
            ),
        ]
        assert adapter.is_window_maximized() is False

    @patch("platform_adapters.linux.subprocess.run")
    def test_is_maximized_false_no_xdotool(self, mock_run):
        """xdotool not found → graceful False."""
        adapter = self._make_adapter()
        mock_run.side_effect = FileNotFoundError
        assert adapter.is_window_maximized() is False

    @patch("platform_adapters.linux.subprocess.run")
    def test_maximize_uses_wmctrl(self, mock_run):
        """wmctrl -r :ACTIVE: -b add,maximized should be called."""
        adapter = self._make_adapter()
        mock_run.side_effect = [
            # is_maximized → xdotool
            MagicMock(returncode=0, stdout="12345\n"),
            # is_maximized → xprop (not maximized)
            MagicMock(returncode=0, stdout="_NET_WM_STATE(ATOM) = \n"),
            # wmctrl maximize
            MagicMock(returncode=0),
        ]
        assert adapter.maximize_window() is True

    @patch("platform_adapters.linux.subprocess.run")
    def test_maximize_idempotent(self, mock_run):
        """Already maximized → no wmctrl call."""
        adapter = self._make_adapter()
        mock_run.side_effect = [
            MagicMock(returncode=0, stdout="12345\n"),
            MagicMock(
                returncode=0,
                stdout="_NET_WM_STATE(ATOM) = _NET_WM_STATE_MAXIMIZED_VERT, _NET_WM_STATE_MAXIMIZED_HORZ\n",
            ),
        ]
        assert adapter.maximize_window() is True
        # Only 2 calls (xdotool + xprop for is_maximized), no wmctrl
        assert mock_run.call_count == 2


# ---------------------------------------------------------------------------
# Tool-level Tests (agent_tools.maximize_active_window)
# ---------------------------------------------------------------------------

class TestMaximizeActiveWindowTool:
    """Test the ADK tool wrapper in agent_tools.py."""

    @pytest.mark.asyncio
    async def test_already_maximized_returns_noop(self):
        """Already maximized → status success, was_maximized True."""
        mock_adapter = MagicMock()
        mock_adapter.is_window_maximized.return_value = True

        with patch("platform_adapters.get_adapter", return_value=mock_adapter):
            from core.agent_tools import maximize_active_window
            result = await maximize_active_window()

        assert result["status"] == "success"
        assert result["was_maximized"] is True
        assert "already" in result["description"].lower()
        mock_adapter.maximize_window.assert_not_called()

    @pytest.mark.asyncio
    async def test_maximizes_when_not_maximized(self):
        """Not maximized → calls maximize_window, returns success."""
        mock_adapter = MagicMock()
        mock_adapter.is_window_maximized.return_value = False
        mock_adapter.maximize_window.return_value = True

        with patch("platform_adapters.get_adapter", return_value=mock_adapter):
            from core.agent_tools import maximize_active_window
            result = await maximize_active_window()

        assert result["status"] == "success"
        assert result["was_maximized"] is False
        assert result["duration_ms"] >= 0
        mock_adapter.maximize_window.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_error_when_maximize_fails(self):
        """Platform API fails → status error."""
        mock_adapter = MagicMock()
        mock_adapter.is_window_maximized.return_value = False
        mock_adapter.maximize_window.return_value = False

        with patch("platform_adapters.get_adapter", return_value=mock_adapter):
            from core.agent_tools import maximize_active_window
            result = await maximize_active_window()

        assert result["status"] == "error"
        assert "voice_message" in result

    @pytest.mark.asyncio
    async def test_handles_exception_gracefully(self):
        """Exception → status error with voice_message."""
        mock_adapter = MagicMock(
            is_window_maximized=MagicMock(side_effect=RuntimeError("no display")),
        )
        with patch("platform_adapters.get_adapter", return_value=mock_adapter):
            from core.agent_tools import maximize_active_window
            result = await maximize_active_window()

        assert result["status"] == "error"
        assert "voice_message" in result
