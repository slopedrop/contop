"""
ATDD-style acceptance tests for Story 3.0 — ADK Execution Agent Foundation.

Tests the acceptance criteria from the story specification at the integration level.
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


async def _wait_for_confirmation(sent_messages: list, *, timeout: float = 2.0) -> dict:
    """Poll until an agent_confirmation_request appears in sent_messages."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        confirm_msgs = [(t, p) for t, p in sent_messages if t == "agent_confirmation_request"]
        if confirm_msgs:
            return confirm_msgs[0][1]
        await asyncio.sleep(0.01)
    raise TimeoutError("Confirmation request not received within timeout")


class TestAC1_AgentInitialization:
    """AC #1: Given the server starts up and GEMINI_API_KEY is configured,
    When the execution agent module initializes,
    Then an ADK LlmAgent must be created with correct tools, callbacks, and model."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key-123")
    def test_agent_created_with_system_instruction(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        assert "execution agent" in agent._agent.instruction.lower()

    @patch("core.settings.get_gemini_api_key", return_value="test-key-123")
    def test_agent_has_expected_tools(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        tool_names = sorted([getattr(t, "name", None) or t.__name__ for t in agent._agent.tools])
        # 7 core + 5 file + 5 window/clipboard + 4 document + 3 system + 2 dialog + 2 app + 2 skill = 28 tools
        # Advanced workflow tools (fill_form, extract_text, etc.) moved to on-demand skill
        expected = sorted([
            "execute_cli", "execute_gui", "get_action_history", "get_ui_context",
            "maximize_active_window", "observe_screen", "wait",
            "read_file", "edit_file", "find_files",
            "window_list", "window_focus", "resize_window",
            "clipboard_read", "clipboard_write",
            "read_pdf", "read_image", "read_excel", "write_excel",
            "process_info", "system_info", "download_file",
            "save_dialog", "open_dialog",
            "launch_app", "open_file", "close_app",
            "create_skill", "edit_skill",
        ])
        assert tool_names == expected

    @patch("core.settings.get_gemini_api_key", return_value="test-key-123")
    def test_agent_has_both_callbacks(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        assert agent._agent.before_tool_callback is not None
        assert agent._agent.after_tool_callback is not None


class TestAC3_ProgressStreaming:
    """AC #3: Given the ADK agent executes a tool,
    When the tool returns a result,
    Then the server must send an agent_progress message."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_progress_sent_with_step_tool_detail_status(self, mock_key):
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(route="host", reason="safe", voice_message="")
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        # Before callback sends "running" progress
        await agent._before_tool_callback(mock_tool, {"command": "docker ps"}, mock_context)
        # After callback sends "completed" progress
        await agent._after_tool_callback(
            mock_tool, {"command": "docker ps"}, mock_context, {"status": "success"}
        )

        progress_msgs = [(t, p) for t, p in sent_messages if t == "agent_progress"]
        assert len(progress_msgs) == 2

        running_msg = progress_msgs[0][1]
        assert running_msg["step"] == 1
        assert running_msg["tool"] == "execute_cli"
        assert running_msg["status"] == "running"

        completed_msg = progress_msgs[1][1]
        assert completed_msg["step"] == 1
        assert completed_msg["status"] == "completed"


class TestAC5_SandboxConfirmation:
    """AC #5: Given the before_tool_callback detects a sandbox-classified command,
    When the classification result is "sandbox",
    Then it must send agent_confirmation_request and pause until response."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_sandbox_sends_confirmation_with_correct_fields(self, mock_key):
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(
            route="sandbox",
            reason="forbidden_command: rm -rf /",
            voice_message="This command is dangerous.",
        )
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        async def run():
            return await agent._before_tool_callback(
                mock_tool, {"command": "rm -rf /"}, mock_context
            )

        task = asyncio.create_task(run())
        payload = await _wait_for_confirmation(sent_messages)

        # Verify confirmation request was sent with all required fields
        assert "request_id" in payload
        assert payload["tool"] == "execute_cli"
        assert payload["command"] == "rm -rf /"
        assert payload["reason"] == "forbidden_command: rm -rf /"
        assert payload["voice_message"] == "This command is dangerous."

        # Approve to unblock
        agent.resolve_confirmation(payload["request_id"], approved=True)
        result = await task
        # Approved sandbox commands are routed to DockerSandbox (Story 3.4)
        # Result is a dict from execute_cli_sandboxed, not None
        assert isinstance(result, dict)
        assert "status" in result


class TestAC6_DisconnectResilience:
    """AC #6: Given the WebRTC data channel disconnects mid-execution,
    When the agent is processing,
    Then messages are queued and flushed on reconnect."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_messages_queued_and_flushed(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = None  # Disconnected

        # Queue messages during disconnect
        agent._send_or_queue("agent_progress", {"step": 1, "status": "running"})
        agent._send_or_queue("agent_progress", {"step": 1, "status": "completed"})
        agent._send_or_queue("agent_result", {"answer": "Done", "steps_taken": 1})

        assert len(agent._message_queue) == 3

        # Reconnect and flush
        flushed_messages = []

        def mock_send(msg_type, payload):
            flushed_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send
        count = agent.flush_queued_messages()

        assert count == 3
        assert len(agent._message_queue) == 0
        assert flushed_messages[0][0] == "agent_progress"
        assert flushed_messages[2][0] == "agent_result"


class TestAC7_Cancellation:
    """AC #7: Given an execution_stop message arrives,
    When the agent is mid-loop,
    Then the agent loop must terminate with a partial result."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_cancellation_aborts_tool_execution(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send
        agent.cancel()

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        result = await agent._before_tool_callback(
            mock_tool, {"command": "long-running-task"}, mock_context
        )

        assert result is not None
        assert result["status"] == "cancelled"
        assert "cancelled" in result["output"].lower()


class TestWebRTCPeerIntegration:
    """Test that WebRTCPeerManager correctly dispatches user_intent and confirmation."""

    async def test_user_intent_handler_exists(self):
        """Verify _handle_user_intent method exists, is callable, and accepts expected parameters."""
        import inspect

        from core.webrtc_peer import WebRTCPeerManager

        assert hasattr(WebRTCPeerManager, "_handle_user_intent")
        method = getattr(WebRTCPeerManager, "_handle_user_intent")
        assert callable(method)
        sig = inspect.signature(method)
        param_names = list(sig.parameters.keys())
        assert "self" in param_names
        assert "data" in param_names

    async def test_confirmation_handler_exists(self):
        """Verify _handle_agent_confirmation_response method exists, is callable, and accepts expected parameters."""
        import inspect

        from core.webrtc_peer import WebRTCPeerManager

        assert hasattr(WebRTCPeerManager, "_handle_agent_confirmation_response")
        method = getattr(WebRTCPeerManager, "_handle_agent_confirmation_response")
        assert callable(method)
        sig = inspect.signature(method)
        param_names = list(sig.parameters.keys())
        assert "self" in param_names
        assert "data" in param_names

    def test_message_queue_on_peer(self):
        """Verify WebRTCPeerManager has message queue for disconnect resilience."""
        from core.webrtc_peer import WebRTCPeerManager

        # Instantiate with mock config
        with patch("core.webrtc_peer.RTCPeerConnection"):
            peer = WebRTCPeerManager({"ice_servers": []})
            assert hasattr(peer, "_message_queue")
            from collections import deque
            assert isinstance(peer._message_queue, deque)

    def test_send_message_queues_when_no_channel(self):
        """Verify send_message queues when data channel is unavailable."""
        from core.webrtc_peer import WebRTCPeerManager

        with patch("core.webrtc_peer.RTCPeerConnection"):
            peer = WebRTCPeerManager({"ice_servers": []})
            peer._data_channel = None

            peer.send_message("agent_progress", {"step": 1})

            assert len(peer._message_queue) == 1
            assert peer._message_queue[0] == ("agent_progress", {"step": 1})


# ── Story 3.6: Destructive Action Warnings ──────────────────────────────────


class TestAC_DestructiveConfirmation:
    """3.6-ATDD: Destructive commands require confirmation and execute on host when approved."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_destructive_sends_confirmation_request(self, mock_key):
        """[P0] 7.6: _before_tool_callback sends agent_confirmation_request for destructive commands."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(
            route="host",
            reason="destructive_command",
            voice_message="This command may be destructive.",
            require_confirmation=True,
        )
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        async def run():
            return await agent._before_tool_callback(
                mock_tool, {"command": "rm myfile.txt"}, mock_context
            )

        task = asyncio.create_task(run())
        payload = await _wait_for_confirmation(sent_messages)

        # Verify confirmation request was sent
        assert payload["reason"] == "destructive_command"
        assert payload["command"] == "rm myfile.txt"
        assert "request_id" in payload

        # Approve to unblock
        agent.resolve_confirmation(payload["request_id"], approved=True)
        result = await task
        # Approved destructive commands return None → proceeds with HOST execution
        assert result is None

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_approved_destructive_returns_none(self, mock_key):
        """[P0] 7.7: Approved destructive command → returns None (host execution proceeds)."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(
            route="host",
            reason="destructive_command",
            voice_message="Destructive.",
            require_confirmation=True,
        )
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        async def run():
            return await agent._before_tool_callback(
                mock_tool, {"command": "kill -9 1234"}, mock_context
            )

        task = asyncio.create_task(run())
        payload = await _wait_for_confirmation(sent_messages)

        # Approve to unblock
        agent.resolve_confirmation(payload["request_id"], approved=True)
        result = await task
        assert result is None  # None = proceed with host execution

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_rejected_destructive_returns_user_cancelled(self, mock_key):
        """[P0] 7.8: Rejected destructive command → returns rejected dict with user_cancelled."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(
            route="host",
            reason="destructive_command",
            voice_message="Destructive.",
            require_confirmation=True,
        )
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        async def run():
            return await agent._before_tool_callback(
                mock_tool, {"command": "rm important.txt"}, mock_context
            )

        task = asyncio.create_task(run())
        payload = await _wait_for_confirmation(sent_messages)

        # Reject
        agent.resolve_confirmation(payload["request_id"], approved=False)
        result = await task

        assert result is not None
        assert result["status"] == "rejected"
        assert result["execution_result"] == "user_cancelled"
        assert "won't run" in result["voice_message"]

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_destructive_confirmation_timeout_returns_timeout(self, mock_key):
        """[P1] L1: Destructive confirmation timeout → returns timeout dict."""
        from unittest.mock import patch as mock_patch

        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(
            route="host",
            reason="destructive_command",
            voice_message="Destructive.",
            require_confirmation=True,
        )
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        # Patch asyncio.wait_for to simulate immediate timeout
        original_wait_for = asyncio.wait_for

        async def fast_timeout(fut, timeout):
            raise asyncio.TimeoutError()

        with mock_patch("asyncio.wait_for", side_effect=fast_timeout):
            result = await agent._before_tool_callback(
                mock_tool, {"command": "rm important.txt"}, mock_context
            )

        assert result is not None
        assert result["status"] == "timeout"
        assert "timed out" in result["output"]

        # Verify timeout progress message was sent
        progress_msgs = [(t, p) for t, p in sent_messages if t == "agent_progress" and p.get("status") == "failed"]
        assert any("timed out" in p.get("detail", "") for _, p in progress_msgs)

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_callback_maps_rejected_to_cancelled(self, mock_key):
        """[P1] Verify _after_tool_callback maps status='rejected' → status='cancelled' in progress."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        agent._send_message_fn = mock_send

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._after_tool_callback(
            mock_tool,
            {"command": "rm file.txt"},
            mock_context,
            {"status": "rejected", "output": "User cancelled destructive command.", "execution_result": "user_cancelled"},
        )

        progress_msgs = [(t, p) for t, p in sent_messages if t == "agent_progress"]
        assert len(progress_msgs) == 1
        assert progress_msgs[0][1]["status"] == "cancelled"


# ── Story 3.7: Undo Action Command ──────────────────────────────────


class TestActionHistoryTracking:
    """3.7-ATDD: Action history tracking in ExecutionAgent."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_action_history_populated_after_tool_execution(self, mock_key):
        """[P0] 7.1: _action_history populated after successful tool execution."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent = []
        agent._send_message_fn = lambda t, p: sent.append((t, p))

        mock_result = ClassificationResult(route="host", reason="safe", voice_message="")
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._before_tool_callback(mock_tool, {"command": "echo hello"}, mock_context)
        await agent._after_tool_callback(
            mock_tool, {"command": "echo hello"}, mock_context,
            {"status": "success", "stdout": "hello", "stderr": "", "exit_code": 0}
        )

        assert len(agent._action_history) == 1
        entry = agent._action_history[0]
        assert entry["tool"] == "execute_cli"
        assert entry["args"] == {"command": "echo hello"}
        assert "timestamp" in entry
        assert entry["undoable_hint"] == "check_command"
        assert entry["step"] == 1

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_action_history_capped_at_50(self, mock_key):
        """[P0] 7.2: _action_history capped at 50 entries — oldest dropped."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = lambda t, p: None

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        # Call _after_tool_callback 55 times with successful results
        for i in range(55):
            agent._step_counter = i + 1
            await agent._after_tool_callback(
                mock_tool,
                {"command": f"cmd-{i}"},
                mock_context,
                {"status": "success", "stdout": f"output-{i}", "stderr": "", "exit_code": 0},
            )

        assert len(agent._action_history) == 50
        # Oldest 5 entries (cmd-0 through cmd-4) should be dropped
        # First remaining entry should have step=6 (i=5, step_counter=i+1)
        assert agent._action_history[0]["args"]["command"] == "cmd-5"
        assert agent._action_history[-1]["args"]["command"] == "cmd-54"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_action_history_cleared_on_reset_session(self, mock_key):
        """[P0] 7.3: _action_history cleared on reset_session()."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._action_history.append({"step": 1, "tool": "test"})
        assert len(agent._action_history) == 1

        agent.reset_session()
        assert len(agent._action_history) == 0


class TestGetActionHistory:
    """3.7-ATDD: get_action_history tool function."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_get_action_history_returns_last_n(self, mock_key):
        """[P0] 7.4/7.5: get_action_history returns last N actions in correct order."""
        from core.agent_tools import get_action_history, set_action_history_ref

        history = [
            {"step": 1, "tool": "execute_cli", "args": {"command": "a"}},
            {"step": 2, "tool": "execute_gui", "args": {"action": "click"}},
            {"step": 3, "tool": "execute_cli", "args": {"command": "c"}},
            {"step": 4, "tool": "execute_cli", "args": {"command": "d"}},
            {"step": 5, "tool": "execute_cli", "args": {"command": "e"}},
        ]
        set_action_history_ref(lambda n=5: (history[-n:], len(history)))

        result = await get_action_history(last_n=3)
        assert result["status"] == "success"
        assert len(result["actions"]) == 3
        assert result["actions"][0]["step"] == 3
        assert result["actions"][-1]["step"] == 5
        # total_count must reflect TOTAL history, not just the returned slice
        assert result["total_count"] == 5

        # Clean up
        set_action_history_ref(None)

    async def test_get_action_history_empty_when_no_history(self):
        """[P0] 7.6: get_action_history returns empty list when no history."""
        from core.agent_tools import get_action_history, set_action_history_ref

        set_action_history_ref(lambda n=5: ([], 0))
        result = await get_action_history(last_n=5)
        assert result["status"] == "success"
        assert result["actions"] == []
        assert result["total_count"] == 0

        set_action_history_ref(None)

    async def test_get_action_history_returns_empty_when_ref_is_none(self):
        """get_action_history returns empty when _action_history_ref is None."""
        from core.agent_tools import get_action_history, set_action_history_ref

        set_action_history_ref(None)
        result = await get_action_history(last_n=5)
        assert result["status"] == "success"
        assert result["actions"] == []
        assert result["total_count"] == 0


class TestClassifyGetActionHistory:
    """3.7-ATDD: DualToolEvaluator classifies get_action_history correctly."""

    async def test_get_action_history_routes_host_no_confirmation(self):
        """[P0] 7.7: classify('get_action_history', ...) → route=host, require_confirmation=False."""
        from core.dual_tool_evaluator import DualToolEvaluator

        evaluator = DualToolEvaluator()
        result = await evaluator.classify("get_action_history", {"last_n": 5})
        assert result.route == "host"
        assert result.require_confirmation is False


class TestUndoableHints:
    """3.7-ATDD: undoable_hint set correctly per tool."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_undoable_hint_execute_cli(self, mock_key):
        """[P0] 7.8: execute_cli → undoable_hint='check_command'."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = lambda t, p: None
        agent._evaluator.classify = AsyncMock(
            return_value=ClassificationResult(route="host", reason="safe", voice_message="")
        )

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._before_tool_callback(mock_tool, {"command": "ls"}, mock_context)
        await agent._after_tool_callback(
            mock_tool, {"command": "ls"}, mock_context, {"status": "success"}
        )

        assert agent._action_history[-1]["undoable_hint"] == "check_command"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_undoable_hint_execute_gui(self, mock_key):
        """[P0] 7.8: execute_gui → undoable_hint='ctrl_z'."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = lambda t, p: None
        agent._evaluator.classify = AsyncMock(
            return_value=ClassificationResult(route="host", reason="gui_requires_host", voice_message="")
        )

        mock_tool = MagicMock()
        mock_tool.name = "execute_gui"
        mock_context = MagicMock()

        await agent._before_tool_callback(mock_tool, {"action": "click"}, mock_context)
        await agent._after_tool_callback(
            mock_tool, {"action": "click"}, mock_context, {"status": "success"}
        )

        assert agent._action_history[-1]["undoable_hint"] == "ctrl_z"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_undoable_hint_observe_screen(self, mock_key):
        """[P0] 7.8: observe_screen → undoable_hint='no_op'."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = lambda t, p: None
        agent._evaluator.classify = AsyncMock(
            return_value=ClassificationResult(route="host", reason="display_requires_host", voice_message="")
        )

        mock_tool = MagicMock()
        mock_tool.name = "observe_screen"
        mock_context = MagicMock()

        await agent._before_tool_callback(mock_tool, {}, mock_context)
        await agent._after_tool_callback(
            mock_tool, {}, mock_context, {"status": "success", "image_b64": "abc"}
        )

        assert agent._action_history[-1]["undoable_hint"] == "no_op"


class TestResultSummaryTruncation:
    """3.7-ATDD: result_summary truncated to 500 chars."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_result_summary_truncated_to_500(self, mock_key):
        """[P0] 7.9: result_summary truncated to 500 chars for large outputs."""
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = lambda t, p: None
        agent._evaluator.classify = AsyncMock(
            return_value=ClassificationResult(route="host", reason="safe", voice_message="")
        )

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        large_output = {"status": "success", "stdout": "x" * 1000}
        await agent._before_tool_callback(mock_tool, {"command": "big"}, mock_context)
        await agent._after_tool_callback(
            mock_tool, {"command": "big"}, mock_context, large_output
        )

        assert len(agent._action_history[-1]["result_summary"]) <= 500


class TestGetActionHistoryEdgeCases:
    """3.7-ATDD: Additional edge case coverage for get_action_history."""

    async def test_total_count_reflects_full_history_not_slice(self):
        """[P0] Review fix: total_count must equal total history size, not returned slice."""
        from core.agent_tools import get_action_history, set_action_history_ref

        history = [{"step": i, "tool": "execute_cli"} for i in range(20)]
        set_action_history_ref(lambda n=5: (history[-n:], len(history)))

        result = await get_action_history(last_n=3)
        assert len(result["actions"]) == 3
        assert result["total_count"] == 20  # total, not 3

        set_action_history_ref(None)

    async def test_last_n_greater_than_history_size(self):
        """[P1] Review fix: requesting more history than exists returns all entries."""
        from core.agent_tools import get_action_history, set_action_history_ref

        history = [{"step": i, "tool": "execute_cli"} for i in range(3)]
        set_action_history_ref(lambda n=5: (history[-n:], len(history)))

        result = await get_action_history(last_n=50)
        assert len(result["actions"]) == 3
        assert result["total_count"] == 3

        set_action_history_ref(None)
