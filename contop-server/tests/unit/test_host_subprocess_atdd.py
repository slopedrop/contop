"""
ATDD acceptance tests for tools/host_subprocess.py — Story 3.2 acceptance criteria.

BDD-style tests mapping to each AC scenario.
"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

from tools.host_subprocess import HostSubprocess


# ─── AC #1: Safe command execution with standardized ToolResult ──────────────


class TestAC1_SafeCommandExecution:
    """Given a CLI command classified as safe,
    When the Evaluator routes it to host_subprocess.py,
    Then the command must be executed async on the OS shell,
    And the output must be formatted into a standardized ToolResult payload.
    """

    @pytest.mark.asyncio
    async def test_safe_command_executes_and_returns_tool_result(self):
        host = HostSubprocess()
        result = await host.run("echo acceptance_test_1")

        # Executed on OS shell
        assert "acceptance_test_1" in result["stdout"]
        # Standardized ToolResult payload
        assert result["status"] == "success"
        assert "stdout" in result
        assert "stderr" in result
        assert "exit_code" in result
        assert "duration_ms" in result

    @pytest.mark.asyncio
    async def test_async_execution(self):
        """Verify the execution is truly async — can run concurrently."""
        host = HostSubprocess()
        # Run two commands concurrently
        results = await asyncio.gather(
            host.run("echo first"),
            host.run("echo second"),
        )
        assert results[0]["status"] == "success"
        assert results[1]["status"] == "success"


# ─── AC #2: Timeout enforcement ──────────────────────────────────────────────


class TestAC2_TimeoutEnforcement:
    """Given a command that exceeds the configured timeout (default 30s),
    When the timeout is reached,
    Then the subprocess must be killed,
    And the return payload must have status: "error",
    And any partial stdout/stderr captured before the timeout must be included.
    """

    @pytest.mark.asyncio
    async def test_timeout_kills_subprocess_and_returns_error(self):
        host = HostSubprocess()
        if sys.platform == "win32":
            cmd = "ping -n 60 127.0.0.1"
        else:
            cmd = "sleep 60"

        result = await host.run(cmd, timeout_s=1)

        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_timeout_default_is_30_seconds(self):
        """Verify default timeout is 30s (we won't wait that long, just check the parameter)."""
        from tools.host_subprocess import DEFAULT_TIMEOUT_S
        assert DEFAULT_TIMEOUT_S == 30


# ─── AC #3: Output truncation ────────────────────────────────────────────────


class TestAC3_OutputTruncation:
    """Given a command that produces output larger than the configured max (default 50KB),
    When the output exceeds the limit,
    Then the output must be truncated with a [truncated] marker.
    """

    @pytest.mark.asyncio
    async def test_large_output_truncated_with_marker(self):
        host = HostSubprocess()
        if sys.platform == "win32":
            cmd = 'python -c "print(\'A\' * 5000)"'
        else:
            cmd = "python3 -c \"print('A' * 5000)\""

        result = await host.run(cmd, max_output_bytes=100)

        assert "[truncated]" in result["stdout"]

    @pytest.mark.asyncio
    async def test_default_max_output_is_50kb(self):
        from tools.host_subprocess import DEFAULT_MAX_OUTPUT_BYTES
        assert DEFAULT_MAX_OUTPUT_BYTES == 51200


# ─── AC #4: execute_cli delegates to HostSubprocess ─────────────────────────


class TestAC4_ExecuteCliDelegation:
    """Given the execute_cli ADK tool function in core/agent_tools.py,
    When it receives a command string from the ADK agent runner,
    Then it must delegate to tools/host_subprocess.py for actual execution,
    And the return dict must conform to { status, stdout, stderr, exit_code, duration_ms }.
    """

    @pytest.mark.asyncio
    async def test_execute_cli_delegates_to_host_subprocess(self):
        from core.agent_tools import execute_cli

        result = await execute_cli("echo delegation_test")

        assert result["status"] == "success"
        assert "delegation_test" in result["stdout"]
        assert "duration_ms" in result
        assert "exit_code" in result

    @pytest.mark.asyncio
    async def test_execute_cli_returns_correct_shape(self):
        from core.agent_tools import execute_cli

        result = await execute_cli("echo shape_test")
        required_keys = {"status", "stdout", "stderr", "duration_ms", "exit_code"}
        assert required_keys.issubset(set(result.keys()))

    @pytest.mark.asyncio
    async def test_execute_cli_handles_exceptions(self):
        """Test that execute_cli handles exceptions gracefully."""
        from core.agent_tools import execute_cli

        with patch("core.agent_tools.HostSubprocess") as MockHost:
            MockHost.return_value.run = AsyncMock(side_effect=RuntimeError("test error"))
            result = await execute_cli("echo test")
            assert result["status"] == "error"


# ─── AC #5: Cancellation support ────────────────────────────────────────────


class TestAC5_CancellationSupport:
    """Given a running subprocess and an execution_stop cancellation signal,
    When the ExecutionAgent._cancelled flag is set,
    Then the running subprocess must be terminated (SIGTERM, then SIGKILL after 2s),
    And the return payload must indicate status: "cancelled".
    """

    @pytest.mark.asyncio
    async def test_cancel_event_terminates_and_returns_cancelled(self):
        host = HostSubprocess()
        cancel_event = asyncio.Event()

        async def cancel_soon():
            await asyncio.sleep(0.5)
            cancel_event.set()

        # Use Python sleep to avoid Windows child process tree issues with ping
        cmd = 'python -c "import time; time.sleep(60)"'

        cancel_task = asyncio.create_task(cancel_soon())
        result = await host.run(cmd, timeout_s=30, cancel_event=cancel_event)
        await cancel_task

        assert result["status"] == "cancelled"


# ─── AC #6: Cross-platform execution and environment sanitization ───────────


class TestAC6_CrossPlatformAndEnvSanitization:
    """Given execution on any supported platform (Windows, macOS, Linux),
    When a command is executed,
    Then the correct shell must be used,
    And the subprocess must inherit a restricted environment (no secret env vars leaked).
    """

    @pytest.mark.asyncio
    async def test_executes_on_current_platform_shell(self):
        host = HostSubprocess()
        result = await host.run("echo platform_test")
        assert result["status"] == "success"
        assert "platform_test" in result["stdout"]

    @pytest.mark.asyncio
    async def test_sensitive_env_vars_not_leaked(self):
        """Verify GEMINI_API_KEY is not available in subprocess."""
        with patch.dict(os.environ, {"GEMINI_API_KEY": "super_secret_key_123"}):
            host = HostSubprocess()
            if sys.platform == "win32":
                result = await host.run("set GEMINI_API_KEY")
                assert "super_secret_key_123" not in result["stdout"]
            else:
                result = await host.run("echo $GEMINI_API_KEY")
                assert "super_secret_key_123" not in result["stdout"]

    @pytest.mark.asyncio
    async def test_path_env_var_preserved(self):
        """Verify PATH is available in subprocess (not stripped)."""
        host = HostSubprocess()
        if sys.platform == "win32":
            result = await host.run("echo %PATH%")
        else:
            result = await host.run("echo $PATH")
        assert result["status"] == "success"
        # PATH should not be empty
        assert len(result["stdout"].strip()) > 0
