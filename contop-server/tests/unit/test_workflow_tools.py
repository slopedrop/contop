"""
Unit tests for core/workflow_tools.py — Workflow-as-tools.

Tests save_dialog, launch_app, fill_form with mocked primitive tools.
Primitives are imported lazily inside each workflow function from
core.agent_tools and core.window_tools, so mocks target those modules.

Module under test: core.workflow_tools
"""
import json
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from core import workflow_tools


# --- save_dialog tests ---

@pytest.mark.unit
class TestSaveDialog:
    async def test_save_dialog_finds_dialog_and_saves(self, monkeypatch):
        """Verify save_dialog calls hotkey, finds dialog, sets path, clicks save."""
        mock_execute_gui = AsyncMock(return_value={"status": "success"})
        mock_wait = AsyncMock(return_value={"status": "success"})
        mock_get_ui_context = AsyncMock(return_value={
            "status": "success",
            "interactive_elements": [
                {"name": "File name:", "control_type": "Edit"},
                {"name": "Save", "control_type": "Button"},
            ],
        })
        mock_execute_accessible = AsyncMock(return_value={"status": "success", "found": True})

        monkeypatch.setattr("core.agent_tools.execute_gui", mock_execute_gui)
        monkeypatch.setattr("core.agent_tools.wait", mock_wait)
        monkeypatch.setattr("core.agent_tools.get_ui_context", mock_get_ui_context)
        monkeypatch.setattr("core.agent_tools.execute_accessible", mock_execute_accessible)

        result = await workflow_tools.save_dialog("/tmp/test.txt")
        assert result["status"] == "success"
        assert result["saved_path"] == "/tmp/test.txt"
        assert mock_execute_gui.call_count >= 1  # At least one hotkey call
        assert mock_execute_accessible.call_count >= 1  # At least set_value + click save

    async def test_save_dialog_no_dialog_found(self, monkeypatch):
        """If no Save dialog is found, return error."""
        mock_execute_gui = AsyncMock(return_value={"status": "success"})
        mock_wait = AsyncMock(return_value={"status": "success"})
        mock_get_ui_context = AsyncMock(return_value={
            "status": "success",
            "interactive_elements": [],
        })

        monkeypatch.setattr("core.agent_tools.execute_gui", mock_execute_gui)
        monkeypatch.setattr("core.agent_tools.wait", mock_wait)
        monkeypatch.setattr("core.agent_tools.get_ui_context", mock_get_ui_context)

        result = await workflow_tools.save_dialog("/tmp/test.txt")
        assert result["status"] == "error"


# --- launch_app tests ---

@pytest.mark.unit
class TestLaunchApp:
    async def test_launch_app_finds_window(self, monkeypatch):
        """Verify launch_app opens the app and finds its window."""
        mock_execute_cli = AsyncMock(return_value={"status": "success", "stdout": "", "exit_code": 0})
        mock_maximize = AsyncMock(return_value={"status": "success"})

        # window_list is called multiple times:
        #   1. Pre-snapshot (before launch) — returns baseline windows
        #   2-4. _check_new_window polling (up to 3 calls) — app window appears
        #   5+. wait_ready polling — app window present
        call_count = 0
        async def mock_window_list():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Pre-snapshot: only existing windows
                return {"status": "success", "windows": ["Other"], "count": 1}
            # After launch: Notepad window appears
            return {"status": "success", "windows": ["Notepad - Untitled", "Other"], "count": 2}

        mock_window_focus = AsyncMock(return_value={"status": "success", "focused": True})

        monkeypatch.setattr("core.agent_tools.execute_cli", mock_execute_cli)
        monkeypatch.setattr("core.agent_tools.maximize_active_window", mock_maximize)
        monkeypatch.setattr("core.window_tools.window_list", mock_window_list)
        monkeypatch.setattr("core.window_tools.window_focus", mock_window_focus)

        result = await workflow_tools.launch_app("notepad")
        assert result["status"] == "success"
        assert "notepad" in result["window_title"].lower()

    async def test_launch_app_no_wait(self, monkeypatch):
        """Verify launch_app returns immediately when wait_ready=False."""
        mock_execute_cli = AsyncMock(return_value={"status": "success"})

        # Even with wait_ready=False, Windows branch takes a pre-snapshot
        # and polls briefly to decide between start/URI strategies.
        call_count = 0
        async def mock_window_list():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"status": "success", "windows": ["Other"], "count": 1}
            return {"status": "success", "windows": ["Notepad - Untitled", "Other"], "count": 2}

        monkeypatch.setattr("core.agent_tools.execute_cli", mock_execute_cli)
        monkeypatch.setattr("core.window_tools.window_list", mock_window_list)

        result = await workflow_tools.launch_app("notepad", wait_ready=False)
        assert result["status"] == "success"
        assert result["wait_seconds"] == 0

    async def test_launch_app_falls_back_to_uri(self, monkeypatch):
        """If start command doesn't produce a window, fall back to URI scheme."""
        cli_calls = []
        async def mock_execute_cli(command):
            cli_calls.append(command)
            return {"status": "success", "stdout": "", "exit_code": 0}

        # Pre-snapshot: one existing window.  After start: no new window.
        # After URI: new window appears.
        call_count = 0
        async def mock_window_list():
            nonlocal call_count
            call_count += 1
            # Calls 1-4: pre-snapshot + 3 polls after start — no new window
            if call_count <= 4:
                return {"status": "success", "windows": ["Other"], "count": 1}
            # Calls 5+: after URI scheme — WhatsApp window appears
            return {"status": "success", "windows": ["WhatsApp", "Other"], "count": 2}

        mock_maximize = AsyncMock(return_value={"status": "success"})
        mock_window_focus = AsyncMock(return_value={"status": "success", "focused": True})

        monkeypatch.setattr("core.agent_tools.execute_cli", mock_execute_cli)
        monkeypatch.setattr("core.agent_tools.maximize_active_window", mock_maximize)
        monkeypatch.setattr("core.window_tools.window_list", mock_window_list)
        monkeypatch.setattr("core.window_tools.window_focus", mock_window_focus)

        result = await workflow_tools.launch_app("WhatsApp")
        assert result["status"] == "success"
        # Should have tried start first, then URI
        assert any("cmd.exe /c start" in c for c in cli_calls)
        assert any("Start-Process" in c for c in cli_calls)


# --- fill_form tests ---

@pytest.mark.unit
class TestFillForm:
    async def test_fill_form_sets_fields(self, monkeypatch):
        """Verify fill_form calls execute_accessible for each field."""
        mock_execute_accessible = AsyncMock(return_value={"status": "success", "found": True})

        monkeypatch.setattr("core.agent_tools.execute_accessible", mock_execute_accessible)

        fields = json.dumps([
            {"label": "Name", "value": "John"},
            {"label": "Email", "value": "john@example.com"},
        ])
        result = await workflow_tools.fill_form(fields)
        assert result["status"] == "success"
        assert result["fields_filled"] == 2
        assert result["total_fields"] == 2
        assert mock_execute_accessible.call_count == 2

    async def test_fill_form_invalid_json_returns_error(self):
        """Invalid JSON in fields should return error."""
        result = await workflow_tools.fill_form("not valid json {{{")
        assert result["status"] == "error"
        assert "json" in result["description"].lower()

    async def test_fill_form_partial_failure(self, monkeypatch):
        """If some fields aren't found, they appear in failed_fields."""
        call_count = 0
        async def mock_execute_accessible(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"status": "success", "found": True}
            return {"status": "error", "found": False}

        monkeypatch.setattr("core.agent_tools.execute_accessible", mock_execute_accessible)

        fields = json.dumps([
            {"label": "Name", "value": "John"},
            {"label": "Missing", "value": "data"},
        ])
        result = await workflow_tools.fill_form(fields)
        assert result["status"] == "success"
        assert result["fields_filled"] == 1
        assert "Missing" in result["failed_fields"]
