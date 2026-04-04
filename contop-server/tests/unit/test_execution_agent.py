"""
Unit tests for core/execution_agent.py — ADK agent initialization, tool loop, callbacks.

Tests 14.1-14.4, 15.1-15.3, 16.1-16.3, 17.1-17.4, 18.1-18.3 from Story 3.0.
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# Patch audit_logger globally for all tests in this module so that
# _after_tool_callback and run_intent never write to real ~/.contop/logs/.
@pytest.fixture(autouse=True)
def _mock_audit_logger():
    with patch("core.execution_agent.audit_logger") as mock_al:
        mock_al.log = AsyncMock()
        mock_al.log_session_start = AsyncMock()
        mock_al.log_session_end = AsyncMock()
        yield mock_al


# ─── Task 14: Agent initialization and tool loop ─────────────────────────────


class TestExecutionAgentInit:
    """Task 14.1: ExecutionAgent initializes with correct tools, callbacks, and model."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_agent_initializes_with_correct_tools(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        tool_names = [getattr(t, "name", None) or t.__name__ for t in agent._agent.tools]
        assert "execute_cli" in tool_names
        assert "execute_gui" in tool_names
        assert "observe_screen" in tool_names

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_agent_initializes_with_correct_model(self, mock_key):
        from core.execution_agent import ExecutionAgent
        from core.agent_config import EXECUTION_AGENT_MODEL

        agent = ExecutionAgent()
        assert agent._agent.model == EXECUTION_AGENT_MODEL

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_agent_has_before_tool_callback(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        assert agent._agent.before_tool_callback is not None

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_agent_has_after_tool_callback(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        assert agent._agent.after_tool_callback is not None

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_agent_has_evaluator(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        assert agent._evaluator is not None


class TestBeforeToolCallback:
    """Task 14.3: before_tool_callback calls DualToolEvaluator.classify()."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_before_tool_calls_classify(self, mock_key):
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock()

        mock_result = ClassificationResult(route="host", reason="safe", voice_message="")
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        result = await agent._before_tool_callback(
            mock_tool, {"command": "ls"}, mock_context
        )

        agent._evaluator.classify.assert_called_once_with("execute_cli", {"command": "ls"})
        assert result is None  # Proceed with tool execution

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_before_tool_cancelled_returns_dict(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock()
        agent._cancelled = True

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        result = await agent._before_tool_callback(
            mock_tool, {"command": "ls"}, mock_context
        )

        assert result is not None
        assert result["status"] == "cancelled"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_before_tool_classify_failure_returns_error(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock()
        agent._evaluator.classify = AsyncMock(side_effect=Exception("classify failed"))

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        result = await agent._before_tool_callback(
            mock_tool, {"command": "ls"}, mock_context
        )

        assert result is not None
        assert result["status"] == "error"


class TestAfterToolCallback:
    """Task 14.4: after_tool_callback sends agent_progress message."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_sends_progress(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send
        agent._step_counter = 3

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        result = await agent._after_tool_callback(
            mock_tool,
            {"command": "docker ps"},
            mock_context,
            {"status": "success", "stdout": "CONTAINER ID"},
        )

        assert result is None  # Don't modify result
        # Verify progress message was sent with tool output fields
        call_args = mock_send.call_args[0]
        assert call_args[0] == "agent_progress"
        payload = call_args[1]
        assert payload["step"] == 3
        assert payload["tool"] == "execute_cli"
        assert payload["detail"] == "Running: docker ps"
        assert payload["command"] == "docker ps"
        assert payload["status"] == "completed"
        assert payload["stdout"] == "CONTAINER ID"
        assert payload["stderr"] == ""
        assert payload["exit_code"] is None
        assert payload["duration_ms"] is None
        # Story 4.2: audit fields included in payload
        assert "classified_command" in payload
        assert "execution_result" in payload


# ─── Task 15: Progress streaming ─────────────────────────────────────────────


class TestProgressStreaming:
    """Tasks 15.1-15.3: Progress messages for each step and step counter."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_step_counter_increments_in_before_callback(self, mock_key):
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock()

        mock_result = ClassificationResult(route="host", reason="safe", voice_message="")
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        assert agent._step_counter == 0

        await agent._before_tool_callback(mock_tool, {"command": "ls"}, mock_context)
        assert agent._step_counter == 1

        await agent._before_tool_callback(mock_tool, {"command": "pwd"}, mock_context)
        assert agent._step_counter == 2

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_running_progress_sent_in_before_callback(self, mock_key):
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(route="host", reason="safe", voice_message="")
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._before_tool_callback(mock_tool, {"command": "ls"}, mock_context)

        # First call should be agent_progress with status=running
        mock_send.assert_called_with(
            "agent_progress",
            {
                "step": 1,
                "tool": "execute_cli",
                "detail": "Running: ls",
                "command": "ls",
                "status": "running",
            },
        )


# ─── Task 16: Disconnect resilience ──────────────────────────────────────────


class TestDisconnectResilience:
    """Tasks 16.1-16.3: Message queuing during disconnect."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_messages_queued_when_send_fn_none(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = None  # Disconnected

        agent._send_or_queue("agent_progress", {"step": 1})

        assert len(agent._message_queue) == 1
        assert agent._message_queue[0] == ("agent_progress", {"step": 1})

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_messages_queued_when_send_fn_fails(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock(side_effect=Exception("channel closed"))

        agent._send_or_queue("agent_progress", {"step": 1})

        assert len(agent._message_queue) == 1

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_queued_messages_flushed_on_reconnect(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = None

        # Queue some messages
        agent._send_or_queue("agent_progress", {"step": 1})
        agent._send_or_queue("agent_progress", {"step": 2})
        assert len(agent._message_queue) == 2

        # Reconnect
        mock_send = MagicMock()
        agent._send_message_fn = mock_send
        flushed = agent.flush_queued_messages()

        assert flushed == 2
        assert len(agent._message_queue) == 0
        assert mock_send.call_count == 2

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_queue_bounded_at_max(self, mock_key):
        from core.execution_agent import MAX_MESSAGE_QUEUE, ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = None

        for i in range(MAX_MESSAGE_QUEUE + 10):
            agent._send_or_queue("agent_progress", {"step": i})

        assert len(agent._message_queue) == MAX_MESSAGE_QUEUE


# ─── Task 17: Confirmation flow ──────────────────────────────────────────────


class TestConfirmationFlow:
    """Tasks 17.1-17.4: Sandbox classification triggers confirmation."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_sandbox_triggers_confirmation_request(self, mock_key):
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(
            route="sandbox",
            reason="forbidden_command: rm -rf /",
            voice_message="This command is forbidden.",
        )
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        # Run in a task so we can resolve the future
        async def run_callback():
            return await agent._before_tool_callback(
                mock_tool, {"command": "rm -rf /"}, mock_context
            )

        task = asyncio.create_task(run_callback())
        await asyncio.sleep(0.05)  # Let the callback reach the await

        # Check that confirmation request was sent
        calls = [c for c in mock_send.call_args_list if c[0][0] == "agent_confirmation_request"]
        assert len(calls) == 1
        request_payload = calls[0][0][1]
        assert request_payload["tool"] == "execute_cli"
        assert request_payload["reason"] == "forbidden_command: rm -rf /"

        # Resolve the confirmation
        request_id = request_payload["request_id"]
        agent.resolve_confirmation(request_id, approved=False)

        result = await task
        assert result is not None
        assert result["status"] == "rejected"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_approved_confirmation_proceeds(self, mock_key):
        from core.dual_tool_evaluator import ClassificationResult
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send

        mock_result = ClassificationResult(
            route="sandbox",
            reason="restricted_path: /root",
            voice_message="Restricted area.",
        )
        agent._evaluator.classify = AsyncMock(return_value=mock_result)

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        async def run_callback():
            return await agent._before_tool_callback(
                mock_tool, {"command": "cat /root/.bashrc"}, mock_context
            )

        task = asyncio.create_task(run_callback())
        await asyncio.sleep(0.05)

        # Find and approve the confirmation
        calls = [c for c in mock_send.call_args_list if c[0][0] == "agent_confirmation_request"]
        request_id = calls[0][0][1]["request_id"]
        agent.resolve_confirmation(request_id, approved=True)

        result = await task
        # Approved sandbox commands are routed to DockerSandbox (Story 3.4)
        # Result is a dict from execute_cli_sandboxed, not None
        assert isinstance(result, dict)
        assert "status" in result


# ─── Task 18: Cancellation ───────────────────────────────────────────────────


class TestCancellation:
    """Tasks 18.1-18.3: Cancellation flag stops agent loop."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    def test_cancel_sets_flag(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        assert not agent._cancelled

        agent.cancel()
        assert agent._cancelled

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_cancelled_before_tool_returns_dict(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock()
        agent.cancel()

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        result = await agent._before_tool_callback(
            mock_tool, {"command": "ls"}, mock_context
        )

        assert result is not None
        assert result["status"] == "cancelled"


# ─── Task 14.2: run_intent integration test ──────────────────────────────────


class TestRunIntent:
    """Task 14.2: Test run_intent() processes a simple intent and returns result."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_run_intent_sends_agent_result(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        # Mock the runner to yield a single final event
        mock_event = MagicMock()
        mock_event.is_final_response.return_value = True
        mock_event.content = MagicMock()
        mock_part = MagicMock()
        mock_part.text = "I completed the task successfully."
        mock_part.thought = False  # Not a thinking part
        mock_event.content.parts = [mock_part]

        async def mock_run_async(**kwargs):
            yield mock_event

        agent._runner.run_async = mock_run_async
        agent._session_service.create_session = AsyncMock()

        await agent.run_intent(
            text="list files",
            send_message_fn=mock_send,
        )

        # Verify agent_result was sent
        result_msgs = [(t, p) for t, p in sent_messages if t == "agent_result"]
        assert len(result_msgs) == 1
        assert result_msgs[0][1]["answer"] == "I completed the task successfully."
        assert result_msgs[0][1]["steps_taken"] == 0  # No tools called
        assert "duration_ms" in result_msgs[0][1]

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_run_intent_handles_exception(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        sent_messages = []

        def mock_send(msg_type, payload):
            sent_messages.append((msg_type, payload))

        async def mock_run_async(**kwargs):
            raise RuntimeError("model unavailable")
            yield  # make it an async generator  # noqa: E501

        agent._runner.run_async = mock_run_async
        agent._session_service.create_session = AsyncMock()

        await agent.run_intent(
            text="do something",
            send_message_fn=mock_send,
        )

        # Verify error result was sent
        result_msgs = [(t, p) for t, p in sent_messages if t == "agent_result"]
        assert len(result_msgs) == 1
        assert "error" in result_msgs[0][1]["answer"].lower()

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_run_intent_concurrency_guard(self, mock_key):
        """Verify concurrent run_intent cancels previous execution."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()

        # Simulate a long-running intent
        started = asyncio.Event()
        async def slow_run_async(**kwargs):
            started.set()
            await asyncio.sleep(10)
            yield MagicMock(is_final_response=lambda: False, content=None)

        agent._runner.run_async = slow_run_async
        agent._session_service.create_session = AsyncMock()

        # Start first intent
        task1 = asyncio.create_task(agent.run_intent("first", mock_send))
        await started.wait()
        assert agent._running is True

        # Start second intent — should cancel first
        fast_event = MagicMock()
        fast_event.is_final_response.return_value = True
        fast_event.content = MagicMock()
        fast_event.content.parts = [MagicMock(text="done")]
        async def fast_run_async(**kwargs):
            yield fast_event
        agent._runner.run_async = fast_run_async

        await agent.run_intent("second", mock_send)
        assert agent._running is False

        # Clean up first task
        task1.cancel()
        try:
            await task1
        except asyncio.CancelledError:
            pass


# ─── After-tool callback error detection ─────────────────────────────────────


class TestAfterToolErrorDetection:
    """Verify _after_tool_callback correctly detects error status."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_reports_failed_on_error(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send
        agent._step_counter = 1

        mock_tool = MagicMock()
        mock_tool.name = "observe_screen"
        mock_context = MagicMock()

        await agent._after_tool_callback(
            mock_tool,
            {},
            mock_context,
            {"status": "error", "error": "display unavailable"},
        )

        call_args = mock_send.call_args[0]
        assert call_args[0] == "agent_progress"
        assert call_args[1]["status"] == "failed"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_reports_completed_on_success(self, mock_key):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send
        agent._step_counter = 1

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._after_tool_callback(
            mock_tool,
            {"command": "ls"},
            mock_context,
            {"status": "success", "stdout": "file.txt"},
        )

        call_args = mock_send.call_args[0]
        assert call_args[0] == "agent_progress"
        assert call_args[1]["status"] == "completed"


# ─── Helper function tests ───────────────────────────────────────────────────


class TestSummarizeArgs:
    def test_summarize_execute_cli(self):
        from core.execution_agent import _summarize_args

        assert _summarize_args("execute_cli", {"command": "ls -la"}) == "Running: ls -la"

    def test_summarize_execute_cli_truncated(self):
        from core.execution_agent import _summarize_args

        long_cmd = "a" * 100
        result = _summarize_args("execute_cli", {"command": long_cmd})
        assert result.endswith("...")
        assert len(result) <= 92  # "Running: " + 80 chars + "..."

    def test_summarize_execute_gui(self):
        from core.execution_agent import _summarize_args

        result = _summarize_args("execute_gui", {"action": "click", "target": "button"})
        assert result == "click on button"

    def test_summarize_observe_screen(self):
        from core.execution_agent import _summarize_args

        assert _summarize_args("observe_screen", {}) == "Capturing screen..."

    def test_summarize_execute_computer_use(self):
        from core.execution_agent import _summarize_args

        result = _summarize_args("execute_computer_use", {"instruction": "Click the submit button"})
        assert result == "Computer Use: Click the submit button"


# ─── Model role routing ──────────────────────────────────────────────────────


class TestModelRoleRouting:
    """Test that run_intent correctly handles model roles and computer use backend."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_gemini_cu_backend_registers_cu_tool(self, mock_key):
        """When computer_use_backend='gemini_computer_use', execute_computer_use tool is registered."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()

        # Mock the runner to yield a single final event
        mock_event = MagicMock()
        mock_event.is_final_response.return_value = True
        mock_event.content = MagicMock()
        mock_part = MagicMock()
        mock_part.text = "Done."
        mock_part.thought = False
        mock_event.content.parts = [mock_part]

        async def mock_run_async(**kwargs):
            yield mock_event

        agent._runner.run_async = mock_run_async
        agent._session_service.create_session = AsyncMock()

        await agent.run_intent(
            text="test",
            send_message_fn=mock_send,
            computer_use_backend="gemini_computer_use",
        )

        tool_names = [getattr(t, "name", None) or t.__name__ for t in agent._agent.tools]
        assert "execute_computer_use" in tool_names
        # CU backend should NOT have observe_screen or execute_gui (prevents duplicate actions)
        assert "observe_screen" not in tool_names
        assert "execute_gui" not in tool_names
        assert "get_ui_context" not in tool_names

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_omniparser_backend_does_not_register_cu_tool(self, mock_key):
        """When computer_use_backend='omniparser', execute_computer_use tool is NOT registered."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()

        mock_event = MagicMock()
        mock_event.is_final_response.return_value = True
        mock_event.content = MagicMock()
        mock_part = MagicMock()
        mock_part.text = "Done."
        mock_part.thought = False
        mock_event.content.parts = [mock_part]

        async def mock_run_async(**kwargs):
            yield mock_event

        agent._runner.run_async = mock_run_async
        agent._session_service.create_session = AsyncMock()

        await agent.run_intent(
            text="test",
            send_message_fn=mock_send,
            computer_use_backend="omniparser",
        )

        tool_names = [getattr(t, "name", None) or t.__name__ for t in agent._agent.tools]
        assert "execute_computer_use" not in tool_names

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_backward_compat_no_cu_backend_param(self, mock_key):
        """run_intent without computer_use_backend defaults to omniparser (no CU tool)."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()

        mock_event = MagicMock()
        mock_event.is_final_response.return_value = True
        mock_event.content = MagicMock()
        mock_part = MagicMock()
        mock_part.text = "Done."
        mock_part.thought = False
        mock_event.content.parts = [mock_part]

        async def mock_run_async(**kwargs):
            yield mock_event

        agent._runner.run_async = mock_run_async
        agent._session_service.create_session = AsyncMock()

        await agent.run_intent(
            text="test",
            send_message_fn=mock_send,
            model="gemini-2.5-pro",
        )

        tool_names = [getattr(t, "name", None) or t.__name__ for t in agent._agent.tools]
        assert "execute_computer_use" not in tool_names
        assert agent._agent.model == "gemini-2.5-pro"


# ─── Audit logger integration (Story 4.1) ────────────────────────────────────


class TestAuditLoggerIntegration:
    """Verify audit_logger is called from _after_tool_callback and run_intent."""

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_includes_audit_fields_in_progress(self, mock_key, _mock_audit_logger):
        """Story 4.2 Task 1: agent_progress payload includes classified_command and execution_result."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send
        agent._step_counter = 2
        agent._session_id = "test-session"
        agent._current_intent = "install package"
        agent._last_classified_command = "pip install requests"
        agent._last_confirmation_outcome = ""

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._after_tool_callback(
            mock_tool,
            {"command": "pip install requests"},
            mock_context,
            {"status": "success", "stdout": "Successfully installed", "duration_ms": 1500},
        )

        call_args = mock_send.call_args[0]
        assert call_args[0] == "agent_progress"
        payload = call_args[1]
        assert payload["classified_command"] == "pip install requests"
        assert payload["execution_result"] == "success"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_audit_fields_use_confirmation_outcome(self, mock_key, _mock_audit_logger):
        """Story 4.2 Task 1: execution_result uses confirmation outcome when set."""
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()
        agent._send_message_fn = mock_send
        agent._step_counter = 1
        agent._session_id = "s1"
        agent._current_intent = "delete files"
        agent._last_classified_command = "rm -rf /tmp/old"
        agent._last_confirmation_outcome = "force_host"

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._after_tool_callback(
            mock_tool, {"command": "rm -rf /tmp/old"}, mock_context,
            {"status": "success", "stdout": "", "duration_ms": 50},
        )

        call_args = mock_send.call_args[0]
        payload = call_args[1]
        assert payload["execution_result"] == "force_host"
        assert payload["classified_command"] == "rm -rf /tmp/old"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_calls_audit_log(self, mock_key, _mock_audit_logger):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock()
        agent._step_counter = 1
        agent._session_id = "test-session"
        agent._current_intent = "list files"
        agent._last_classified_command = "ls -la"
        agent._last_confirmation_outcome = ""

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._after_tool_callback(
            mock_tool,
            {"command": "ls -la"},
            mock_context,
            {"status": "success", "stdout": "file.txt", "duration_ms": 42, "voice_message": "Listed."},
        )

        _mock_audit_logger.log.assert_called_once_with(
            session_id="test-session",
            user_prompt="list files",
            classified_command="ls -la",
            tool_used="execute_cli",
            execution_result="success",
            voice_message="Listed.",
            duration_ms=42,
        )

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_after_tool_uses_confirmation_outcome(self, mock_key, _mock_audit_logger):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        agent._send_message_fn = MagicMock()
        agent._step_counter = 1
        agent._session_id = "s1"
        agent._current_intent = "rm stuff"
        agent._last_classified_command = "rm -rf /tmp"
        agent._last_confirmation_outcome = "user_cancelled"

        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"
        mock_context = MagicMock()

        await agent._after_tool_callback(
            mock_tool, {"command": "rm -rf /tmp"}, mock_context,
            {"status": "rejected", "output": "cancelled"},
        )

        call_kwargs = _mock_audit_logger.log.call_args[1]
        assert call_kwargs["execution_result"] == "user_cancelled"

    @patch("core.settings.get_gemini_api_key", return_value="test-key")
    async def test_run_intent_calls_session_lifecycle(self, mock_key, _mock_audit_logger):
        from core.execution_agent import ExecutionAgent

        agent = ExecutionAgent()
        mock_send = MagicMock()

        mock_event = MagicMock()
        mock_event.is_final_response.return_value = True
        mock_event.content = MagicMock()
        mock_part = MagicMock()
        mock_part.text = "Done."
        mock_part.thought = False
        mock_event.content.parts = [mock_part]

        async def mock_run_async(**kwargs):
            yield mock_event

        agent._runner.run_async = mock_run_async
        agent._session_service.create_session = AsyncMock()

        await agent.run_intent(text="hello", send_message_fn=mock_send)

        _mock_audit_logger.log_session_start.assert_called_once()
        _mock_audit_logger.log_session_end.assert_called_once()
