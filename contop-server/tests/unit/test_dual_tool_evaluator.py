"""
Unit tests for core/dual_tool_evaluator.py — The Dual-Tool Evaluator Core.

Story 3.1 — Tests for the classification gate that routes tool_call commands
to either "host" (direct execution) or "sandbox" (containerized execution).

Module under test: core.dual_tool_evaluator
"""
import sys
import time

import pytest

from core.dual_tool_evaluator import ClassificationResult, DualToolEvaluator


@pytest.fixture
def evaluator():
    """Create a DualToolEvaluator instance."""
    return DualToolEvaluator()


@pytest.fixture(autouse=True)
def mock_settings(monkeypatch):
    """Mock settings to provide deterministic restricted paths and forbidden commands."""
    monkeypatch.setattr(
        "core.dual_tool_evaluator.get_restricted_paths",
        lambda: ["/root", "/etc/shadow", "/etc/passwd", "C:\\Windows\\System32", "C:\\Windows\\SysWOW64"],
    )
    monkeypatch.setattr(
        "core.dual_tool_evaluator.get_forbidden_commands",
        lambda: ["rm -rf /", "mkfs", "dd if=", "format C:", "del /f /s /q C:\\"],
    )


# --- Task 4.1: Safe CLI commands classified as "host" ---

@pytest.mark.unit
class TestSafeCLICommands:
    """4.1: Safe CLI commands must be classified as host."""

    async def test_safe_cli_command_returns_host(self, evaluator):
        """Given a safe CLI command, classify() must return route='host'."""
        result = await evaluator.classify("execute_cli", {"command": "docker ps"})
        assert result.route == "host"
        assert result.reason == "safe"

    async def test_safe_cli_ls_command(self, evaluator):
        """Given 'ls -la /home', classify() must return route='host'."""
        result = await evaluator.classify("execute_cli", {"command": "ls -la /home"})
        assert result.route == "host"

    async def test_safe_cli_git_command(self, evaluator):
        """Given 'git status', classify() must return route='host'."""
        result = await evaluator.classify("execute_cli", {"command": "git status"})
        assert result.route == "host"

    async def test_safe_cli_has_voice_message(self, evaluator):
        """Safe host result must include a non-empty voice_message."""
        result = await evaluator.classify("execute_cli", {"command": "docker ps"})
        assert result.voice_message, "Safe host result must have a voice_message"


# --- Task 4.2: Restricted-path CLI commands classified as "sandbox" ---

@pytest.mark.unit
class TestRestrictedPathCommands:
    """4.2: CLI commands targeting restricted paths must be classified as sandbox."""

    async def test_command_targeting_root_returns_sandbox(self, evaluator):
        """Given a command referencing /root, classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "cat /root/.ssh/id_rsa"})
        assert result.route == "sandbox"
        assert "restricted_path" in result.reason

    async def test_command_targeting_etc_shadow(self, evaluator):
        """Given a command referencing /etc/shadow, classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "cat /etc/shadow"})
        assert result.route == "sandbox"

    async def test_command_targeting_windows_system32(self, evaluator):
        """Given a command referencing C:\\Windows\\System32, classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "dir C:\\Windows\\System32"})
        assert result.route == "sandbox"

    async def test_sandbox_result_has_voice_message(self, evaluator):
        """Given a sandboxed command, the result must include a voice_message."""
        result = await evaluator.classify("execute_cli", {"command": "cat /etc/shadow"})
        assert result.voice_message, "Sandboxed result must have a voice_message"
        assert len(result.voice_message) > 0


# --- Task 4.3: Forbidden-command CLI commands classified as "sandbox" ---

@pytest.mark.unit
class TestForbiddenCommands:
    """4.3: CLI commands matching forbidden patterns must be classified as sandbox."""

    async def test_rm_rf_root_returns_sandbox(self, evaluator):
        """Given 'rm -rf /', classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "rm -rf /"})
        assert result.route == "sandbox"
        assert "forbidden_command" in result.reason

    async def test_mkfs_returns_sandbox(self, evaluator):
        """Given 'mkfs.ext4 /dev/sda1', classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "mkfs.ext4 /dev/sda1"})
        assert result.route == "sandbox"

    async def test_dd_if_returns_sandbox(self, evaluator):
        """Given 'dd if=/dev/zero of=/dev/sda', classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "dd if=/dev/zero of=/dev/sda"})
        assert result.route == "sandbox"

    async def test_format_c_returns_sandbox(self, evaluator):
        """Given 'format C:', classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "format C:"})
        assert result.route == "sandbox"

    async def test_del_f_s_q_returns_sandbox(self, evaluator):
        """Given 'del /f /s /q C:\\', classify() must return route='sandbox'."""
        result = await evaluator.classify("execute_cli", {"command": "del /f /s /q C:\\"})
        assert result.route == "sandbox"


# --- Task 4.4: GUI commands always classified as "host" ---

@pytest.mark.unit
class TestGUICommands:
    """4.4: GUI commands must always be classified as host."""

    async def test_execute_gui_returns_host(self, evaluator):
        """Given execute_gui tool, classify() must always return route='host'."""
        result = await evaluator.classify("execute_gui", {"action": "click", "x": 100, "y": 200})
        assert result.route == "host"
        assert result.reason == "gui_requires_host"

    async def test_execute_gui_ignores_restricted_args(self, evaluator):
        """GUI commands must return host even if args contain restricted path strings."""
        result = await evaluator.classify("execute_gui", {"action": "click", "target": "/root/file"})
        assert result.route == "host"


# --- Task 4.5: force_host=True override ---

@pytest.mark.unit
class TestForceHostOverride:
    """4.5: force_host=True must bypass sandbox classification."""

    async def test_force_host_bypasses_restricted_path(self, evaluator):
        """Given force_host=True with restricted path, classify() must return route='host'."""
        result = await evaluator.classify("execute_cli", {"command": "cat /root/.ssh/id_rsa"}, force_host=True)
        assert result.route == "host"
        assert result.reason == "user_override"

    async def test_force_host_bypasses_forbidden_command(self, evaluator):
        """Given force_host=True with forbidden command, classify() must return route='host'."""
        result = await evaluator.classify("execute_cli", {"command": "rm -rf /"}, force_host=True)
        assert result.route == "host"
        assert result.reason == "user_override"


# --- Task 4.6: Performance test ---

@pytest.mark.unit
class TestPerformance:
    """4.6: Classification must complete in under 100ms."""

    async def test_classification_under_100ms(self, evaluator):
        """classify() must complete in under 100ms for any command."""
        start = time.perf_counter()
        await evaluator.classify("execute_cli", {"command": "cat /root/.ssh/id_rsa"})
        elapsed_ms = (time.perf_counter() - start) * 1000
        assert elapsed_ms < 100, f"Classification took {elapsed_ms:.2f}ms, must be under 100ms"


# --- Task 4.7: Hot-reload picks up changed settings ---

@pytest.mark.unit
class TestHotReload:
    """4.7: Evaluator must use latest settings on each classify() call."""

    async def test_hot_reload_picks_up_new_restricted_path(self, evaluator, monkeypatch):
        """When restricted paths change, classify() must use updated list."""
        # Initially safe
        result = await evaluator.classify("execute_cli", {"command": "ls /custom/secret"})
        assert result.route == "host"

        # Update restricted paths to include /custom/secret
        monkeypatch.setattr(
            "core.dual_tool_evaluator.get_restricted_paths",
            lambda: ["/custom/secret"],
        )

        result = await evaluator.classify("execute_cli", {"command": "ls /custom/secret"})
        assert result.route == "sandbox"


# --- Task 4.8: Case-sensitivity behavior per platform ---

@pytest.mark.unit
class TestCaseSensitivity:
    """4.8: Path matching must be case-insensitive on Windows, case-sensitive on Linux/macOS."""

    async def test_windows_case_insensitive_path_match(self, evaluator, monkeypatch):
        """On Windows, 'c:\\windows\\system32' must match 'C:\\Windows\\System32'."""
        monkeypatch.setattr(sys, "platform", "win32")
        result = await evaluator.classify("execute_cli", {"command": "dir c:\\windows\\system32"})
        assert result.route == "sandbox"

    async def test_linux_case_sensitive_path_match(self, evaluator, monkeypatch):
        """On Linux, '/Root' must NOT match '/root' (case-sensitive)."""
        monkeypatch.setattr(sys, "platform", "linux")
        result = await evaluator.classify("execute_cli", {"command": "ls /Root"})
        assert result.route == "host", "Linux path matching must be case-sensitive"

    async def test_linux_exact_case_match(self, evaluator, monkeypatch):
        """On Linux, '/root' must match '/root' exactly."""
        monkeypatch.setattr(sys, "platform", "linux")
        result = await evaluator.classify("execute_cli", {"command": "ls /root"})
        assert result.route == "sandbox"


# --- Task 4.9: Edge cases ---

@pytest.mark.unit
class TestEdgeCases:
    """4.9: Edge cases — empty commands, unknown tool names, missing args."""

    async def test_empty_command_returns_host(self, evaluator):
        """Given an empty command string, classify() must return route='host'."""
        result = await evaluator.classify("execute_cli", {"command": ""})
        assert result.route == "host"

    async def test_unknown_tool_name_returns_sandbox(self, evaluator):
        """Given an unknown tool name, classify() must sandbox it for safety."""
        result = await evaluator.classify("unknown_tool", {"command": "anything"})
        assert result.route == "sandbox", "Unknown tools must default to sandbox (defense-in-depth)"
        assert result.reason == "unknown_tool"
        assert result.voice_message, "Unknown tool must produce a voice_message"

    async def test_missing_command_arg(self, evaluator):
        """Given CLI tool with missing 'command' arg, classify() must handle gracefully."""
        result = await evaluator.classify("execute_cli", {})
        # Should treat as safe (empty command) rather than crashing
        assert result.route == "host"

    async def test_classification_result_dataclass_fields(self):
        """ClassificationResult must have route, reason, and voice_message fields."""
        result = ClassificationResult(route="host", reason="safe", voice_message="")
        assert result.route == "host"
        assert result.reason == "safe"
        assert result.voice_message == ""


# --- Browser tool classification tests ---

@pytest.mark.unit
class TestBrowserToolClassification:
    """execute_browser must route to host without confirmation."""

    async def test_execute_browser_routes_to_host(self, evaluator):
        """Verify execute_browser classified as route='host', reason='browser_requires_host'."""
        result = await evaluator.classify("execute_browser", {"action": "navigate", "url": "https://example.com"})
        assert result.route == "host"
        assert result.reason == "browser_requires_host"

    async def test_execute_browser_no_confirmation(self, evaluator):
        """Verify execute_browser does not require user confirmation."""
        result = await evaluator.classify("execute_browser", {"action": "click", "params": {"ref": "e5"}})
        assert result.require_confirmation is False

    async def test_execute_browser_in_known_tools(self):
        """Verify 'execute_browser' is in KNOWN_TOOL_NAMES."""
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        assert "execute_browser" in KNOWN_TOOL_NAMES

    async def test_execute_browser_has_voice_message(self, evaluator):
        """Verify browser classification returns a voice_message."""
        result = await evaluator.classify("execute_browser", {"action": "snapshot"})
        assert result.voice_message  # Non-empty


# --- New tool routing tests (Agent Architecture Overhaul) ---

@pytest.mark.unit
class TestFileToolRouting:
    """File tools (read_file, edit_file, find_files) must route to host."""

    async def test_read_file_routes_to_host(self, evaluator):
        result = await evaluator.classify("read_file", {"file_path": "/tmp/test.py"})
        assert result.route == "host"
        assert result.reason == "file_operation"

    async def test_edit_file_routes_to_host(self, evaluator):
        result = await evaluator.classify("edit_file", {"file_path": "/tmp/test.py", "old_string": "a", "new_string": "b"})
        assert result.route == "host"
        assert result.reason == "file_operation"

    async def test_find_files_routes_to_host(self, evaluator):
        result = await evaluator.classify("find_files", {"pattern": "*.py"})
        assert result.route == "host"
        assert result.reason == "file_operation"

    async def test_file_tools_in_known_tool_names(self):
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        for tool in ("read_file", "edit_file", "find_files"):
            assert tool in KNOWN_TOOL_NAMES


@pytest.mark.unit
class TestWindowToolRouting:
    """Window & clipboard tools must route to host (display_requires_host)."""

    async def test_window_list_routes_to_host(self, evaluator):
        result = await evaluator.classify("window_list", {})
        assert result.route == "host"
        assert result.reason == "display_requires_host"

    async def test_window_focus_routes_to_host(self, evaluator):
        result = await evaluator.classify("window_focus", {"title": "Notepad"})
        assert result.route == "host"
        assert result.reason == "display_requires_host"

    async def test_resize_window_routes_to_host(self, evaluator):
        result = await evaluator.classify("resize_window", {"layout": "left_half"})
        assert result.route == "host"
        assert result.reason == "display_requires_host"

    async def test_clipboard_read_routes_to_host(self, evaluator):
        result = await evaluator.classify("clipboard_read", {})
        assert result.route == "host"
        assert result.reason == "display_requires_host"

    async def test_clipboard_write_routes_to_host(self, evaluator):
        result = await evaluator.classify("clipboard_write", {"text": "hello"})
        assert result.route == "host"
        assert result.reason == "display_requires_host"

    async def test_window_tools_in_known_tool_names(self):
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        for tool in ("window_list", "window_focus", "resize_window", "clipboard_read", "clipboard_write"):
            assert tool in KNOWN_TOOL_NAMES


@pytest.mark.unit
class TestDocumentToolRouting:
    """Document tools must route to host (file_operation)."""

    async def test_read_pdf_routes_to_host(self, evaluator):
        result = await evaluator.classify("read_pdf", {"file_path": "/tmp/doc.pdf"})
        assert result.route == "host"
        assert result.reason == "file_operation"

    async def test_read_image_routes_to_host(self, evaluator):
        result = await evaluator.classify("read_image", {"file_path": "/tmp/img.png"})
        assert result.route == "host"
        assert result.reason == "file_operation"

    async def test_read_excel_routes_to_host(self, evaluator):
        result = await evaluator.classify("read_excel", {"file_path": "/tmp/data.xlsx"})
        assert result.route == "host"
        assert result.reason == "file_operation"

    async def test_write_excel_routes_to_host(self, evaluator):
        result = await evaluator.classify("write_excel", {"file_path": "/tmp/out.xlsx", "operations": []})
        assert result.route == "host"
        assert result.reason == "file_operation"


@pytest.mark.unit
class TestSystemToolRouting:
    """System info tools must route to host."""

    async def test_process_info_routes_to_host(self, evaluator):
        result = await evaluator.classify("process_info", {})
        assert result.route == "host"
        assert result.reason == "system_info"

    async def test_system_info_routes_to_host(self, evaluator):
        result = await evaluator.classify("system_info", {})
        assert result.route == "host"
        assert result.reason == "system_info"

    async def test_download_file_routes_to_host(self, evaluator):
        result = await evaluator.classify("download_file", {"url": "https://example.com/file.zip"})
        assert result.route == "host"
        assert result.reason == "safe"


@pytest.mark.unit
class TestWorkflowToolRouting:
    """Workflow tools must route to host (workflow_operation)."""

    async def test_save_dialog_routes_to_host(self, evaluator):
        result = await evaluator.classify("save_dialog", {"file_path": "/tmp/test.txt"})
        assert result.route == "host"
        assert result.reason == "workflow_operation"

    async def test_launch_app_routes_to_host(self, evaluator):
        result = await evaluator.classify("launch_app", {"app_name": "notepad"})
        assert result.route == "host"
        assert result.reason == "workflow_operation"

    async def test_fill_form_routes_to_host(self, evaluator):
        result = await evaluator.classify("fill_form", {"fields": []})
        assert result.route == "host"
        assert result.reason == "workflow_operation"

    async def test_install_app_routes_to_host(self, evaluator):
        result = await evaluator.classify("install_app", {"app_name": "git"})
        assert result.route == "host"
        assert result.reason == "workflow_operation"

    async def test_close_app_routes_to_host(self, evaluator):
        result = await evaluator.classify("close_app", {"app_name": "notepad"})
        assert result.route == "host"
        assert result.reason == "workflow_operation"

    async def test_workflow_tools_in_known_tool_names(self):
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        for tool in ("save_dialog", "open_dialog", "launch_app", "close_app",
                      "app_menu", "install_app", "copy_between_apps",
                      "fill_form", "extract_text", "set_env_var",
                      "change_setting", "find_and_replace_in_files"):
            assert tool in KNOWN_TOOL_NAMES, f"{tool} missing from KNOWN_TOOL_NAMES"


@pytest.mark.unit
class TestUnknownToolStillSandboxed:
    """Regression: unknown tools must still route to sandbox after all new routing rules."""

    async def test_completely_unknown_tool_routes_to_sandbox(self, evaluator):
        result = await evaluator.classify("totally_unknown_tool_xyz", {"anything": "value"})
        assert result.route == "sandbox"
        assert result.reason == "unknown_tool"


# --- Skill tool classification tests ---

@pytest.mark.unit
class TestSkillToolClassification:
    """Tests for skill-related tool classifications."""

    async def test_execute_skill_routes_to_host(self, evaluator):
        """execute_skill must route to host."""
        result = await evaluator.classify("execute_skill", {"skill_name": "ide-chat", "workflow_name": "open"})
        assert result.route == "host"
        assert result.reason == "skill_workflow_execution"

    async def test_load_skill_routes_to_host(self, evaluator):
        """load_skill must route to host with no voice message (silent)."""
        result = await evaluator.classify("load_skill", {"skill_name": "ide-chat"})
        assert result.route == "host"
        assert result.reason == "skill_instructions_load"
        assert result.voice_message == ""

    async def test_execute_skill_in_known_tools(self):
        """execute_skill must be in KNOWN_TOOL_NAMES."""
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        assert "execute_skill" in KNOWN_TOOL_NAMES

    async def test_load_skill_in_known_tools(self):
        """load_skill must be in KNOWN_TOOL_NAMES."""
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        assert "load_skill" in KNOWN_TOOL_NAMES

    async def test_dynamic_skill_tool_routes_to_host(self, evaluator):
        """Dynamically registered skill tool names route to host."""
        evaluator.register_skill_tools({"my_custom_skill_tool"})
        result = await evaluator.classify("my_custom_skill_tool", {})
        assert result.route == "host"
        assert result.reason == "skill_python_tool"

    async def test_create_skill_routes_to_host_with_confirmation(self, evaluator):
        """create_skill routes to host with require_confirmation=True."""
        result = await evaluator.classify("create_skill", {"name": "test"})
        assert result.route == "host"
        assert result.reason == "skill_authoring"
        assert result.require_confirmation is True

    async def test_edit_skill_routes_to_host_with_confirmation(self, evaluator):
        """edit_skill routes to host with require_confirmation=True."""
        result = await evaluator.classify("edit_skill", {"name": "test"})
        assert result.route == "host"
        assert result.reason == "skill_authoring"
        assert result.require_confirmation is True

    async def test_reset_skill_tools_clears_dynamic_names(self, evaluator):
        """reset_skill_tools removes dynamic names from routing (F6/F12)."""
        evaluator.register_skill_tools({"stale_tool"})
        result = await evaluator.classify("stale_tool", {})
        assert result.route == "host"
        assert result.reason == "skill_python_tool"

        evaluator.reset_skill_tools()
        result = await evaluator.classify("stale_tool", {})
        assert result.route == "sandbox"
        assert result.reason == "unknown_tool"
