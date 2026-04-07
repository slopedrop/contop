"""
Unit tests for core/workflow_tools.py — Workflow-as-tools.

Tests save_dialog, launch_app, fill_form with mocked primitive tools.
Primitives are imported lazily inside each workflow function from
core.agent_tools and core.window_tools, so mocks target those modules.

Module under test: core.workflow_tools
"""
import json
import sys
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from core import workflow_tools


# --- save_dialog tests ---

@pytest.mark.unit
class TestSaveDialog:
    async def test_save_dialog_finds_dialog_and_saves(self, monkeypatch, tmp_path):
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

        # Use a real temp path that exists on disk so the post-save verification passes
        target = tmp_path / "test.txt"
        target.write_text("")
        result = await workflow_tools.save_dialog(str(target))
        assert result["status"] == "success"
        assert result["saved_path"] == str(target)
        assert mock_execute_gui.call_count >= 1  # At least one hotkey call
        assert mock_execute_accessible.call_count >= 1  # At least set_value + click save

    async def test_save_dialog_reports_error_when_set_value_fails(self, monkeypatch, tmp_path):
        """If execute_accessible set_value returns error, save_dialog must NOT return success."""
        mock_execute_gui = AsyncMock(return_value={"status": "success"})
        mock_wait = AsyncMock(return_value={"status": "success"})
        mock_get_ui_context = AsyncMock(return_value={
            "status": "success",
            "interactive_elements": [{"name": "File name:", "control_type": "Edit"}],
        })
        # set_value fails (element not found) — click Save should never run
        mock_execute_accessible = AsyncMock(return_value={
            "status": "error", "found": False,
            "description": "Element not found: File name:",
        })

        monkeypatch.setattr("core.agent_tools.execute_gui", mock_execute_gui)
        monkeypatch.setattr("core.agent_tools.wait", mock_wait)
        monkeypatch.setattr("core.agent_tools.get_ui_context", mock_get_ui_context)
        monkeypatch.setattr("core.agent_tools.execute_accessible", mock_execute_accessible)

        result = await workflow_tools.save_dialog(str(tmp_path / "never_created.txt"))
        assert result["status"] == "error"
        assert "Failed to set file name" in result["description"]
        # Only the set_value call should have been made — Save click never reached
        assert mock_execute_accessible.call_count == 1

    async def test_save_dialog_reports_error_when_file_not_created(self, monkeypatch, tmp_path):
        """If all UIA steps succeed but the file doesn't exist, save_dialog must return error."""
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

        # File path does NOT exist on disk — the fake-success case
        result = await workflow_tools.save_dialog(str(tmp_path / "never_created.txt"))
        assert result["status"] == "error"
        assert "file was not created" in result["description"]

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
        mock_maximize = AsyncMock(return_value={"status": "success"})
        mock_popen = MagicMock()

        async def mock_window_list():
            return {"status": "success", "windows": ["Notepad - Untitled", "Other"], "count": 2}

        mock_window_focus = AsyncMock(return_value={"status": "success", "focused": True})

        monkeypatch.setattr("shutil.which", lambda n: r"C:\Windows\system32\notepad.EXE" if "notepad" in n else None)
        monkeypatch.setattr("subprocess.Popen", mock_popen)
        monkeypatch.setattr("core.agent_tools.maximize_active_window", mock_maximize)
        monkeypatch.setattr("core.window_tools.window_list", mock_window_list)
        monkeypatch.setattr("core.window_tools.window_focus", mock_window_focus)

        result = await workflow_tools.launch_app("notepad")
        assert result["status"] == "success"
        assert "notepad" in result["window_title"].lower()
        mock_popen.assert_called_once()

    async def test_launch_app_no_wait(self, monkeypatch):
        """Verify launch_app returns immediately when wait_ready=False."""
        mock_popen = MagicMock()

        monkeypatch.setattr("shutil.which", lambda n: r"C:\Windows\system32\notepad.EXE" if "notepad" in n else None)
        monkeypatch.setattr("subprocess.Popen", mock_popen)

        result = await workflow_tools.launch_app("notepad", wait_ready=False)
        assert result["status"] == "success"
        assert result["wait_seconds"] == 0

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-specific app launch fallback (PowerShell Start-Process)")
    async def test_launch_app_no_uri_scheme_fallback(self, monkeypatch):
        """URI scheme fallback is removed — only Start-Process by name is tried."""
        cli_calls = []
        async def mock_execute_cli(command):
            cli_calls.append(command)
            return {"status": "success", "stdout": "", "exit_code": 0}

        # No new window ever appears (simulates Start-Process not finding the app)
        async def mock_window_list():
            return {"status": "success", "windows": ["Other"], "count": 1}

        mock_process_info = AsyncMock(return_value={"status": "success", "processes": [], "count": 0})

        monkeypatch.setattr("core.agent_tools.execute_cli", mock_execute_cli)
        monkeypatch.setattr("core.agent_tools.process_info", mock_process_info)
        monkeypatch.setattr("core.window_tools.window_list", mock_window_list)
        monkeypatch.setattr("core.window_tools.window_focus", AsyncMock())

        result = await workflow_tools.launch_app("WhatsApp")
        # Should have tried Start-Process but NOT URI scheme
        assert any("Start-Process" in c for c in cli_calls)
        assert not any(":" in c.split("Start-Process")[1] for c in cli_calls if "Start-Process" in c)
        assert result["status"] == "error"  # no window or process found


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
