"""
ATDD - Story 3.1: The Dual-Tool Evaluator Core - Integration Tests

Tests for the tool_call data channel message flow through WebRTCPeerManager,
verifying state_update + tool_result responses and gemini_call_id round-trip.

These tests validate acceptance criteria:
  AC8: tool_call → state_update + tool_result response flow
  AC9: sandbox result includes status: "sandboxed" and voice_message
  AC10: force_host override bypasses sandbox classification

Module under test: core.webrtc_peer (with core.dual_tool_evaluator integration)
"""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.webrtc_peer import WebRTCPeerManager


SAMPLE_STUN_CONFIG = {
    "ice_servers": [{"urls": "stun:stun.l.google.com:19302"}]
}


@pytest.fixture(autouse=True)
def mock_settings(monkeypatch):
    """Mock settings for deterministic classification results."""
    monkeypatch.setattr(
        "core.dual_tool_evaluator.get_restricted_paths",
        lambda: ["/root", "/etc/shadow", "C:\\Windows\\System32"],
    )
    monkeypatch.setattr(
        "core.dual_tool_evaluator.get_forbidden_commands",
        lambda: ["rm -rf /", "mkfs", "dd if="],
    )
    monkeypatch.setattr(
        "core.dual_tool_evaluator.get_destructive_patterns",
        lambda: [
            "rm", "rmdir", "del", "deltree", "rd", "erase", "mv",
            "kill", "killall", "pkill", "taskkill",
            "shutdown", "halt", "reboot", "poweroff",
            "format", "mkfs", "fdisk", "dd",
            "DROP TABLE", "DROP DATABASE", "TRUNCATE",
            "remove-item", "move-item", "stop-process",
            "restart-computer", "stop-computer", "clear-content", "clear-item",
            "set-content", "remove-itemproperty", "stop-service",
            "remove-service", "invoke-expression", "iex", "format-volume",
        ],
    )


def _create_manager_with_mock_channel():
    """Create a WebRTCPeerManager with a mock data channel that captures sent messages."""
    with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
        mock_pc = AsyncMock()
        MockRTCPC.return_value = mock_pc
        manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)

    mock_channel = MagicMock()
    mock_channel.readyState = "open"
    sent_messages = []

    def capture_send(raw):
        sent_messages.append(json.loads(raw))

    mock_channel.send = MagicMock(side_effect=capture_send)
    manager._data_channel = mock_channel

    return manager, sent_messages


@pytest.mark.unit
class TestToolCallFlow:
    """3.1-ATDD-001: tool_call → state_update + tool_result response flow (AC8)."""

    async def test_safe_tool_call_sends_state_update_and_tool_result(self):
        """[P0] Safe CLI tool_call must trigger state_update(executing) then tool_result(success).

        Given: A tool_call message with safe CLI command 'docker ps'
        When:  _on_data_channel_message processes it
        Then:  Two messages must be sent: state_update with ai_state=executing,
               then tool_result with status=success
        """
        manager, sent = _create_manager_with_mock_channel()

        tool_call_msg = json.dumps({
            "type": "tool_call",
            "id": "msg-001",
            "payload": {
                "name": "execute_cli",
                "args": {"command": "docker ps"},
                "gemini_call_id": "text-123-abc",
                "force_host": False,
            },
        })

        manager._on_data_channel_message(tool_call_msg)
        # Let the async task complete
        await asyncio.sleep(0.05)

        assert len(sent) == 2, f"Expected 2 messages (state_update + tool_result), got {len(sent)}"

        state_update = sent[0]
        assert state_update["type"] == "state_update"
        assert state_update["payload"]["ai_state"] == "executing"

        tool_result = sent[1]
        assert tool_result["type"] == "tool_result"
        assert tool_result["payload"]["status"] == "success"
        assert tool_result["payload"]["name"] == "execute_cli"

    async def test_sandbox_tool_call_sends_sandboxed_state_and_result(self):
        """[P0] Restricted CLI tool_call must trigger state_update(sandboxed) then tool_result(sandboxed).

        Given: A tool_call message with restricted path command
        When:  _on_data_channel_message processes it
        Then:  state_update must have ai_state=sandboxed and tool_result must have status=sandboxed
        """
        manager, sent = _create_manager_with_mock_channel()

        tool_call_msg = json.dumps({
            "type": "tool_call",
            "id": "msg-002",
            "payload": {
                "name": "execute_cli",
                "args": {"command": "cat /etc/shadow"},
                "gemini_call_id": "text-456-def",
                "force_host": False,
            },
        })

        manager._on_data_channel_message(tool_call_msg)
        await asyncio.sleep(0.05)

        assert len(sent) == 2

        state_update = sent[0]
        assert state_update["type"] == "state_update"
        assert state_update["payload"]["ai_state"] == "sandboxed"

        tool_result = sent[1]
        assert tool_result["type"] == "tool_result"
        assert tool_result["payload"]["status"] == "sandboxed"
        assert tool_result["payload"]["voice_message"], "Sandboxed result must have voice_message"


@pytest.mark.unit
class TestExecutionStop:
    """3.1-ATDD-002: execution_stop message handling."""

    async def test_execution_stop_sets_cancellation_flag(self):
        """[P0] execution_stop message must set the _execution_cancelled flag.

        Given: A WebRTCPeerManager with data channel
        When:  An execution_stop message is received
        Then:  _execution_cancelled must be set to True
        """
        manager, sent = _create_manager_with_mock_channel()

        assert manager._execution_cancelled is False

        stop_msg = json.dumps({
            "type": "execution_stop",
            "id": "msg-003",
            "payload": {},
        })

        manager._on_data_channel_message(stop_msg)

        assert manager._execution_cancelled is True
        # Server must send a state_update ack so mobile UI transitions to idle
        state_updates = [m for m in sent if m["type"] == "state_update"]
        assert len(state_updates) == 1, "execution_stop must send exactly one state_update"
        assert state_updates[0]["payload"]["ai_state"] == "idle"


@pytest.mark.unit
class TestGeminiCallIdRoundTrip:
    """3.1-ATDD-003: gemini_call_id round-trip in tool_result (AC8)."""

    async def test_gemini_call_id_preserved_in_tool_result(self):
        """[P0] gemini_call_id from tool_call must appear in tool_result payload.

        Given: A tool_call with gemini_call_id 'text-789-ghi'
        When:  The tool_call is processed
        Then:  The tool_result payload must contain the same gemini_call_id
        """
        manager, sent = _create_manager_with_mock_channel()

        expected_id = "text-789-ghi"
        tool_call_msg = json.dumps({
            "type": "tool_call",
            "id": "msg-004",
            "payload": {
                "name": "execute_gui",
                "args": {"action": "click", "x": 100, "y": 200},
                "gemini_call_id": expected_id,
                "force_host": False,
            },
        })

        manager._on_data_channel_message(tool_call_msg)
        await asyncio.sleep(0.05)

        assert len(sent) == 2
        tool_result = sent[1]
        assert tool_result["payload"]["gemini_call_id"] == expected_id, (
            f"gemini_call_id must round-trip, got: {tool_result['payload'].get('gemini_call_id')}"
        )

    async def test_force_host_in_payload_ignored_for_security(self):
        """[P0] force_host in payload must be ignored - server never trusts client bypass.

        Given: A tool_call with restricted path and force_host=True in payload
        When:  The tool_call is processed
        Then:  state_update must have ai_state=sandboxed (force_host from client is ignored)
        Note:  Legitimate force_host only comes from execution_agent confirmation flow
        """
        manager, sent = _create_manager_with_mock_channel()

        tool_call_msg = json.dumps({
            "type": "tool_call",
            "id": "msg-005",
            "payload": {
                "name": "execute_cli",
                "args": {"command": "cat /root/.ssh/id_rsa"},
                "gemini_call_id": "text-override-001",
                "force_host": True,
            },
        })

        manager._on_data_channel_message(tool_call_msg)
        await asyncio.sleep(0.05)

        assert len(sent) == 2
        state_update = sent[0]
        assert state_update["payload"]["ai_state"] == "sandboxed", (
            "force_host in payload must be ignored - restricted path must still be sandboxed"
        )
        tool_result = sent[1]
        assert tool_result["payload"]["status"] == "sandboxed"


@pytest.mark.unit
class TestClassifyExceptionHandling:
    """3.1-ATDD-004: classify() exception must produce error tool_result (M1 fix)."""

    async def test_classify_exception_sends_error_tool_result(self):
        """[P0] If classify() raises, client must receive tool_result with status=error.

        Given: DualToolEvaluator.classify() raises an unexpected exception
        When:  _handle_tool_call processes a tool_call message
        Then:  A single tool_result with status=error and voice_message must be sent.
               No state_update should precede it (classify failed before routing).
        """
        manager, sent = _create_manager_with_mock_channel()

        with patch.object(
            manager.__class__,
            "_handle_tool_call",
            wraps=manager._handle_tool_call,
        ):
            # Inject a broken evaluator that always raises
            broken_evaluator = MagicMock()
            broken_evaluator.classify = AsyncMock(side_effect=RuntimeError("settings exploded"))
            manager._evaluator = broken_evaluator

            tool_call_msg = json.dumps({
                "type": "tool_call",
                "id": "msg-006",
                "payload": {
                    "name": "execute_cli",
                    "args": {"command": "docker ps"},
                    "gemini_call_id": "text-error-001",
                    "force_host": False,
                },
            })

            manager._on_data_channel_message(tool_call_msg)
            await asyncio.sleep(0.05)

        assert len(sent) == 1, "On classify() failure, only tool_result (no state_update) must be sent"
        error_result = sent[0]
        assert error_result["type"] == "tool_result"
        assert error_result["payload"]["status"] == "error"
        assert error_result["payload"]["voice_message"], "Error result must have a voice_message"
        assert error_result["payload"]["gemini_call_id"] == "text-error-001"


@pytest.mark.unit
class TestExecutionCancelledReset:
    """3.1-ATDD-005: _execution_cancelled must reset on new tool_call (H2 fix)."""

    async def test_cancelled_flag_resets_on_new_tool_call(self):
        """[P0] After execution_stop, a new tool_call must reset _execution_cancelled to False.

        Given: A WebRTCPeerManager that received an execution_stop
        When:  A new tool_call message is then processed
        Then:  _execution_cancelled must be False during the new tool_call's handling
        """
        manager, sent = _create_manager_with_mock_channel()

        # First: send execution_stop
        stop_msg = json.dumps({"type": "execution_stop", "id": "msg-007", "payload": {}})
        manager._on_data_channel_message(stop_msg)
        assert manager._execution_cancelled is True

        # Then: send a new tool_call - flag must reset
        tool_call_msg = json.dumps({
            "type": "tool_call",
            "id": "msg-008",
            "payload": {
                "name": "execute_cli",
                "args": {"command": "docker ps"},
                "gemini_call_id": "text-reset-001",
                "force_host": False,
            },
        })
        manager._on_data_channel_message(tool_call_msg)
        await asyncio.sleep(0.05)

        assert manager._execution_cancelled is False, (
            "_execution_cancelled must be reset to False at the start of each new tool_call"
        )
        # Tool call still completes: stop ack (idle) + tool_call state_update + tool_result
        state_updates = [m for m in sent if m["type"] == "state_update"]
        tool_results = [m for m in sent if m["type"] == "tool_result"]
        assert any(s["payload"]["ai_state"] == "idle" for s in state_updates), "stop ack must set idle"
        assert any(s["payload"]["ai_state"] == "executing" for s in state_updates), "tool_call must set executing"
        assert len(tool_results) == 1, "tool_call must produce a tool_result"


# ── Story 3.6: Destructive Action Warnings ──────────────────────────────────


@pytest.mark.unit
class TestIsDestructive:
    """3.6-ATDD-001: _is_destructive() pattern matching (Task 7.1, 7.2)."""

    async def test_rm_matches(self):
        """[P0] 7.1: 'rm file.txt' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("rm file.txt") is True

    async def test_ls_does_not_match(self):
        """[P0] 7.1: 'ls -la' → False."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("ls -la") is False

    async def test_kill_matches(self):
        """[P0] 7.1: 'kill -9 1234' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("kill -9 1234") is True

    async def test_echo_does_not_match(self):
        """[P0] 7.1: 'echo hello' → False."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("echo hello") is False

    async def test_shutdown_matches(self):
        """[P0] 7.1: 'shutdown /s' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("shutdown /s") is True

    async def test_drop_table_matches(self):
        """[P0] 7.1: 'DROP TABLE users' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("DROP TABLE users") is True

    async def test_chaining_rm(self):
        """[P0] 7.2: 'echo hello && rm file.txt' → True (chained destructive)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("echo hello && rm file.txt") is True

    async def test_pipe_no_destructive(self):
        """[P0] 7.2: 'ls | grep foo' → False (pipe, no destructive verb)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("ls | grep foo") is False

    async def test_full_path_rm(self):
        """[P1] /usr/bin/rm resolves to 'rm' and matches."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("/usr/bin/rm file.txt") is True

    async def test_mv_is_destructive(self):
        """[P1] 'mv' is intentionally flagged as destructive."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("mv old.txt new.txt") is True

    async def test_case_insensitive_rm(self):
        """[P1] M2: 'RM file.txt' → True (case insensitive)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("RM file.txt") is True

    async def test_case_insensitive_kill(self):
        """[P1] M2: 'Kill -9 1234' → True (case insensitive)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("Kill -9 1234") is True

    async def test_case_insensitive_shutdown(self):
        """[P1] M2: 'SHUTDOWN /s' → True (case insensitive)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("SHUTDOWN /s") is True

    async def test_sudo_rm_is_destructive(self):
        """[P0] H1: 'sudo rm file.txt' → True (sudo prefix stripped)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("sudo rm file.txt") is True

    async def test_sudo_kill_is_destructive(self):
        """[P0] H1: 'sudo kill -9 1234' → True (sudo prefix stripped)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("sudo kill -9 1234") is True

    async def test_env_rm_is_destructive(self):
        """[P1] H1: 'env rm file.txt' → True (env prefix stripped)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("env rm file.txt") is True

    async def test_nohup_kill_is_destructive(self):
        """[P1] H1: 'nohup kill 1234' → True (nohup prefix stripped)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("nohup kill 1234") is True

    async def test_sudo_alone_not_destructive(self):
        """[P1] H1: 'sudo' alone → False (no second token)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("sudo") is False

    async def test_sudo_safe_command_not_destructive(self):
        """[P1] H1: 'sudo ls -la' → False (ls is not destructive)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("sudo ls -la") is False

    async def test_empty_command_not_destructive(self):
        """[P2] L3: '' → False (empty command)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("") is False

    # ── Deep scan: wrapper commands (powershell, cmd /c, bash -c) ────────

    async def test_powershell_remove_item_is_destructive(self):
        """[P0] Deep scan: powershell -Command 'Remove-Item ...' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Remove-Item -Path \'C:/file.txt\' -Force"'
        ) is True

    async def test_pwsh_remove_item_is_destructive(self):
        """[P0] Deep scan: pwsh -Command 'Remove-Item ...' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'pwsh -Command "Remove-Item file.txt"'
        ) is True

    async def test_powershell_stop_process_is_destructive(self):
        """[P0] Deep scan: powershell Stop-Process → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Stop-Process -Name notepad -Force"'
        ) is True

    async def test_powershell_move_item_is_destructive(self):
        """[P1] Deep scan: powershell Move-Item → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Move-Item old.txt new.txt"'
        ) is True

    async def test_cmd_c_del_is_destructive(self):
        """[P0] Deep scan: cmd /c 'del file' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive('cmd /c "del file.txt"') is True

    async def test_bash_c_rm_is_destructive(self):
        """[P0] Deep scan: bash -c 'rm file' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive('bash -c "rm file.txt"') is True

    async def test_powershell_safe_command_not_destructive(self):
        """[P0] Deep scan: powershell Get-ChildItem → False (safe cmdlet)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Get-ChildItem C:\\Users"'
        ) is False

    async def test_powershell_get_process_not_destructive(self):
        """[P1] Deep scan: powershell Get-Process → False (read-only)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Get-Process"'
        ) is False

    # ── F4: Multi-level prefix skipping ──────────────────────────────────

    async def test_sudo_env_rm_is_destructive(self):
        """[P0] F4: 'sudo env rm file.txt' → True (two prefix levels)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("sudo env rm file.txt") is True

    async def test_nohup_sudo_kill_is_destructive(self):
        """[P0] F4: 'nohup sudo kill 1234' → True (two prefix levels)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("nohup sudo kill 1234") is True

    # ── F5: Subshell / backtick extraction ───────────────────────────────

    async def test_subshell_rm_is_destructive(self):
        """[P0] F5: 'echo $(rm file)' → True (subshell contains rm)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("echo $(rm file)") is True

    async def test_backtick_rm_is_destructive(self):
        """[P0] F5: 'echo `rm file`' → True (backtick contains rm)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("echo `rm file`") is True

    async def test_subshell_safe_not_destructive(self):
        """[P0] F5: 'echo $(date)' → False (safe subshell)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive("echo $(date)") is False

    # ── F7: PowerShell -EncodedCommand ───────────────────────────────────

    async def test_powershell_encoded_command_is_destructive(self):
        """[P0] F7: powershell -EncodedCommand <base64> → True (opaque payload)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            "powershell -EncodedCommand UgBlAG0AbwB2AGUALQBJAHQAZQBtAA=="
        ) is True

    async def test_pwsh_encoded_command_short_flag(self):
        """[P0] F7: pwsh -e <base64> → True (short -e flag)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            "pwsh -e UgBlAG0AbwB2AGUALQBJAHQAZQBtAA=="
        ) is True

    async def test_powershell_exe_encoded_command(self):
        """[P0] F7: powershell.exe -EncodedCommand → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            "powershell.exe -EncodedCommand UgBlAG0AbwB2AGUALQBJAHQAZQBtAA=="
        ) is True

    # ── F8: powershell.exe (with extension) ──────────────────────────────

    async def test_powershell_exe_remove_item_is_destructive(self):
        """[P0] F8: powershell.exe -Command 'Remove-Item' → True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell.exe -Command "Remove-Item file.txt"'
        ) is True

    # ── F9: Expanded cmdlet coverage ─────────────────────────────────────

    async def test_invoke_expression_is_destructive(self):
        """[P0] F9: powershell Invoke-Expression → True (arbitrary code exec)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Invoke-Expression \'rm file\'"'
        ) is True

    async def test_iex_is_destructive(self):
        """[P0] F9: powershell iex → True (Invoke-Expression alias)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "iex \'rm file\'"'
        ) is True

    async def test_set_content_is_destructive(self):
        """[P1] F9: powershell Set-Content → True (overwrites files)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Set-Content -Path file.txt -Value \'pwned\'"'
        ) is True

    async def test_format_volume_is_destructive(self):
        """[P0] F9: powershell Format-Volume → True (disk formatting)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        assert evaluator._is_destructive(
            'powershell -Command "Format-Volume -DriveLetter D"'
        ) is True


@pytest.mark.unit
class TestClassifyDestructive:
    """3.6-ATDD-002: classify() returns require_confirmation for destructive commands (Task 7.3-7.5, 7.9)."""

    async def test_destructive_returns_require_confirmation_true(self):
        """[P0] 7.3: classify() returns require_confirmation=True for 'rm myfile.txt' with route='host'."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_cli", {"command": "rm myfile.txt"})
        assert result.route == "host"
        assert result.require_confirmation is True
        assert result.reason == "destructive_command"

    async def test_safe_returns_require_confirmation_false(self):
        """[P0] 7.4: classify() returns require_confirmation=False for non-destructive 'echo hello'."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_cli", {"command": "echo hello"})
        assert result.route == "host"
        assert result.require_confirmation is False
        assert result.reason == "safe"

    async def test_forbidden_still_routes_sandbox(self):
        """[P0] 7.5: Forbidden commands still return route='sandbox' (not affected by destructive check)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_cli", {"command": "rm -rf /"})
        assert result.route == "sandbox"
        assert result.require_confirmation is False

    async def test_force_host_bypasses_destructive_confirmation(self):
        """[P0] 7.9: force_host=True bypasses destructive confirmation - require_confirmation=False."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify(
            "execute_cli", {"command": "rm myfile.txt"}, force_host=True
        )
        assert result.route == "host"
        assert result.require_confirmation is False
        assert result.reason == "user_override"

    async def test_kill_destructive_with_confirmation(self):
        """[P0] 7.3: 'kill -9 1234' is destructive with require_confirmation=True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_cli", {"command": "kill -9 1234"})
        assert result.route == "host"
        assert result.require_confirmation is True
        assert result.reason == "destructive_command"

    async def test_sudo_rm_classified_destructive(self):
        """[P0] H1: classify('sudo rm file.txt') returns require_confirmation=True."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_cli", {"command": "sudo rm file.txt"})
        assert result.route == "host"
        assert result.require_confirmation is True
        assert result.reason == "destructive_command"

    async def test_empty_command_requires_confirmation(self):
        """[P2] H5 fix: classify with empty command returns host with confirmation required."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_cli", {"command": ""})
        assert result.route == "host"
        assert result.require_confirmation is True
        assert result.reason == "empty_command"

    # ── Deep scan: wrapper commands require confirmation ──────────────────

    async def test_powershell_remove_item_requires_confirmation(self):
        """[P0] powershell Remove-Item must require confirmation (exact bug scenario)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify(
            "execute_cli",
            {"command": 'powershell -Command "Remove-Item -Path \'C:/Users/mmssw/Downloads/file.py\' -Force"'},
        )
        assert result.route == "host"
        assert result.require_confirmation is True
        assert result.reason == "destructive_command"

    async def test_cmd_c_del_requires_confirmation(self):
        """[P0] cmd /c del must require confirmation."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify(
            "execute_cli",
            {"command": 'cmd /c "del file.txt"'},
        )
        assert result.route == "host"
        assert result.require_confirmation is True
        assert result.reason == "destructive_command"

    async def test_powershell_safe_command_no_confirmation(self):
        """[P0] powershell Get-ChildItem must NOT require confirmation."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify(
            "execute_cli",
            {"command": 'powershell -Command "Get-ChildItem C:\\Users"'},
        )
        assert result.route == "host"
        assert result.require_confirmation is False
        assert result.reason == "safe"

    async def test_encoded_command_requires_confirmation(self):
        """[P0] F7: PowerShell -EncodedCommand must require confirmation."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify(
            "execute_cli",
            {"command": "powershell -EncodedCommand UgBlAG0AbwB2AGUALQBJAHQAZQBtAA=="},
        )
        assert result.route == "host"
        assert result.require_confirmation is True
        assert result.reason == "destructive_command"


@pytest.mark.unit
class TestForbiddenMatches:
    """Tests for _forbidden_matches word-boundary matching (F6 fix)."""

    async def test_dd_if_matches(self):
        """[P0] F6: 'dd if=/dev/zero' matches forbidden 'dd if='."""
        from core.dual_tool_evaluator import DualToolEvaluator

        assert DualToolEvaluator._forbidden_matches("dd if=/dev/zero of=/dev/sda", "dd if=") is True

    async def test_add_if_does_not_match_dd_if(self):
        """[P0] F6: 'add if=foo' must NOT match forbidden 'dd if=' (word boundary)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        assert DualToolEvaluator._forbidden_matches("add if=foo", "dd if=") is False

    async def test_mkfs_matches(self):
        """[P0] F6: 'mkfs.ext4 /dev/sda1' matches forbidden 'mkfs'."""
        from core.dual_tool_evaluator import DualToolEvaluator

        assert DualToolEvaluator._forbidden_matches("mkfs.ext4 /dev/sda1", "mkfs") is True

    async def test_rm_rf_slash_matches(self):
        """[P0] F6: 'rm -rf /' matches forbidden 'rm -rf /'."""
        from core.dual_tool_evaluator import DualToolEvaluator

        assert DualToolEvaluator._forbidden_matches("rm -rf /", "rm -rf /") is True

    async def test_rm_rf_double_space_matches(self):
        """[P1] F6: 'rm  -rf /' (double space) must NOT match 'rm -rf /' (word boundary)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        # Double-space evasion: the forbidden pattern is "rm -rf /" (single space)
        # Word-boundary matching starts at \brm, so "rm  -rf /" doesn't contain
        # the exact substring "rm -rf /".  This is correct - the command IS different.
        assert DualToolEvaluator._forbidden_matches("rm  -rf /", "rm -rf /") is False


@pytest.mark.unit
class TestGeminiComputerUseToolClassification:
    """Test DualToolEvaluator classification for execute_computer_use tool."""

    async def test_execute_computer_use_routes_to_host(self):
        """execute_computer_use always routes to host (needs screen access)."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_computer_use", {"instruction": "click submit"})
        assert result.route == "host"
        assert result.reason == "gemini_computer_use_native"
        assert result.require_confirmation is False

    async def test_execute_computer_use_is_known_tool(self):
        """execute_computer_use must be in KNOWN_TOOL_NAMES to avoid unknown_tool classification."""
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES

        assert "execute_computer_use" in KNOWN_TOOL_NAMES
