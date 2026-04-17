"""
ATDD acceptance tests for tools/docker_sandbox.py - Story 3.4 acceptance criteria.

BDD-style tests mapping to each AC scenario (AC #1–#7).
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.docker_sandbox import DockerSandbox


@pytest.fixture(autouse=True)
def reset_docker_sandbox():
    """Reset DockerSandbox cached state between tests."""
    DockerSandbox._reset()
    yield
    DockerSandbox._reset()


def _mock_docker_run(exit_code=0, stdout=b"output", stderr=b""):
    """Set up a mocked Docker environment returning a container with given behavior."""
    container = MagicMock()
    container.wait.return_value = {"StatusCode": exit_code}
    # Precise logs based on parameters
    def logs_fn(stdout_flag=True, stderr_flag=True):
        if stdout_flag and not stderr_flag:
            return stdout
        if stderr_flag and not stdout_flag:
            return stderr
        return stdout + stderr
    container.logs = MagicMock(side_effect=lambda stdout=True, stderr=True: logs_fn(stdout, stderr))
    container.stop.return_value = None
    container.remove.return_value = None

    client = MagicMock()
    client.ping.return_value = True
    client.containers.run.return_value = container
    client.images.get.return_value = MagicMock()

    return client, container


# ─── AC #1: Sandbox execution with standardized ToolResult ───────────────────


class TestAC1_SandboxExecutionToolResult:
    """Given a CLI command classified as "sandbox",
    When the user approves via agent_confirmation_response,
    Then the command must be executed in an ephemeral Docker container,
    And the output must be formatted as a standardized ToolResult dict.
    """

    @pytest.mark.asyncio
    async def test_sandbox_execution_returns_standardized_result(self):
        client, container = _mock_docker_run(exit_code=0, stdout=b"sandbox output")

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            result = await DockerSandbox().run("echo sandbox output")

        # Standardized ToolResult dict shape
        assert result["status"] == "success"
        assert "sandbox output" in result["stdout"]
        assert isinstance(result["stderr"], str)
        assert result["exit_code"] == 0
        assert isinstance(result["duration_ms"], int)
        assert result["duration_ms"] >= 0


# ─── AC #2: Docker availability check ───────────────────────────────────────


class TestAC2_DockerAvailabilityCheck:
    """Given Docker Engine is available on the host,
    When DockerSandbox is first invoked,
    Then Docker availability must be verified via docker.from_env() ping,
    And the sandbox base image must be pulled if not present,
    And Docker status must be logged.
    """

    def test_docker_check_caches_result(self):
        mock_docker = MagicMock()
        mock_client = MagicMock()
        mock_client.ping.return_value = True
        mock_docker.from_env.return_value = mock_client

        with patch.dict("sys.modules", {"docker": mock_docker}):
            DockerSandbox._reset()
            result1 = DockerSandbox._check_docker()
            result2 = DockerSandbox._check_docker()

        assert result1 is True
        assert result2 is True
        # from_env should only be called once (cached)
        mock_docker.from_env.assert_called_once()

    @pytest.mark.asyncio
    async def test_image_pulled_when_missing(self):
        client, container = _mock_docker_run()
        try:
            import docker as docker_mod
            client.images.get.side_effect = docker_mod.errors.ImageNotFound("not found")
        except (ImportError, AttributeError):
            client.images.get.side_effect = Exception("ImageNotFound")
        client.images.pull.return_value = MagicMock()

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            await DockerSandbox().run("echo test")

        client.images.pull.assert_called_once()


# ─── AC #3: Docker unavailable fallback ──────────────────────────────────────


class TestAC3_DockerUnavailableFallback:
    """Given Docker Engine is NOT available on the host,
    When a sandbox-classified command needs execution,
    Then the system must refuse execution for security,
    And the fallback must be logged as a warning.
    """

    @pytest.mark.asyncio
    async def test_fallback_refuses_execution(self):
        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=False):
            result = await DockerSandbox().run("echo test")

        # Fallback must return error
        assert result["status"] == "error"
        assert result["sandboxed"] is False
        assert "Execution refused" in result["stderr"]


# ─── AC #4: Timeout enforcement ──────────────────────────────────────────────


class TestAC4_TimeoutEnforcement:
    """Given a command executing in the Docker sandbox,
    When execution exceeds the configured timeout,
    Then the container must be forcefully stopped and removed,
    And return payload must have status "error",
    And partial stdout/stderr must be included.
    """

    @pytest.mark.asyncio
    async def test_timeout_returns_error_with_cleanup(self):
        container = MagicMock()
        container.wait.side_effect = Exception("timeout")
        container.logs.side_effect = lambda stdout=True, stderr=True: (
            b"partial output" if stdout and not stderr else
            b"" if stderr and not stdout else
            b"partial output"
        )
        container.stop.return_value = None
        container.remove.return_value = None

        client = MagicMock()
        client.containers.run.return_value = container
        client.images.get.return_value = MagicMock()

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            result = await DockerSandbox().run("sleep 100", timeout_s=1)

        assert result["status"] == "error"
        assert result["exit_code"] == -1
        container.stop.assert_called_once()
        container.remove.assert_called_with(force=True)


# ─── AC #5: Output truncation ───────────────────────────────────────────────


class TestAC5_OutputTruncation:
    """Given a command executing in the Docker sandbox,
    When the output exceeds the configured max size,
    Then the output must be truncated with [truncated] marker.
    """

    @pytest.mark.asyncio
    async def test_output_truncated_with_marker(self):
        large_output = b"x" * 100000
        client, container = _mock_docker_run(stdout=large_output)
        container.logs.side_effect = lambda stdout=True, stderr=True: (
            large_output if stdout and not stderr else
            b"" if stderr and not stdout else
            large_output
        )

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            result = await DockerSandbox().run("cat bigfile", max_output_bytes=1000)

        assert "\n[truncated]" in result["stdout"]


# ─── AC #6: Ephemeral container cleanup ──────────────────────────────────────


class TestAC6_EphemeralContainerCleanup:
    """Given a completed sandbox execution (success or failure),
    When the container exits,
    Then the container must be automatically removed,
    And no host filesystem mounts or network access must be available.
    """

    @pytest.mark.asyncio
    async def test_container_removed_after_success(self):
        client, container = _mock_docker_run(exit_code=0)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            await DockerSandbox().run("echo ok")

        container.remove.assert_called_with(force=True)

    @pytest.mark.asyncio
    async def test_container_removed_after_failure(self):
        client, container = _mock_docker_run(exit_code=1, stderr=b"error")

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            await DockerSandbox().run("false")

        container.remove.assert_called_with(force=True)

    @pytest.mark.asyncio
    async def test_no_host_mounts_or_network(self):
        client, container = _mock_docker_run()

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            await DockerSandbox().run("echo test")

        call_kwargs = client.containers.run.call_args.kwargs
        assert call_kwargs["network_disabled"] is True
        assert "volumes" not in call_kwargs or call_kwargs.get("volumes") is None


# ─── AC #7: Sandbox routing in execution_agent ───────────────────────────────


class TestAC7_SandboxRouting:
    """Given the execute_cli tool function,
    When before_tool_callback classifies as "sandbox" AND user approves,
    Then execution must be routed to DockerSandbox.run(),
    And the return dict must be indistinguishable from HostSubprocess output.
    """

    @pytest.mark.asyncio
    async def test_execute_cli_sandboxed_delegates_to_docker_sandbox(self):
        """Verify execute_cli_sandboxed in agent_tools calls DockerSandbox."""
        mock_sandbox_result = {
            "status": "success",
            "stdout": "sandboxed",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 100,
        }

        with patch("core.agent_tools.DockerSandbox") as MockSandbox:
            mock_instance = AsyncMock()
            mock_instance.run.return_value = mock_sandbox_result
            MockSandbox.return_value = mock_instance

            from core.agent_tools import execute_cli_sandboxed
            result = await execute_cli_sandboxed("rm -rf /")

        mock_instance.run.assert_called_once_with("rm -rf /")
        assert result == mock_sandbox_result

    @pytest.mark.asyncio
    async def test_sandbox_result_shape_matches_host_subprocess(self):
        """Sandbox result must have same keys as HostSubprocess result."""
        host_keys = {"status", "stdout", "stderr", "exit_code", "duration_ms"}

        mock_sandbox_result = {
            "status": "success",
            "stdout": "ok",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 50,
        }

        with patch("core.agent_tools.DockerSandbox") as MockSandbox:
            mock_instance = AsyncMock()
            mock_instance.run.return_value = mock_sandbox_result
            MockSandbox.return_value = mock_instance

            from core.agent_tools import execute_cli_sandboxed
            result = await execute_cli_sandboxed("echo test")

        assert set(result.keys()) == host_keys

    @pytest.mark.asyncio
    async def test_before_tool_callback_routes_approved_sandbox_to_docker(self):
        """In ExecutionAgent, approved sandbox commands call execute_cli_sandboxed."""
        mock_sandbox_result = {
            "status": "success",
            "stdout": "sandboxed output",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 100,
        }

        # Mock the classification as sandbox
        mock_classify = AsyncMock()
        mock_classify.return_value = MagicMock(route="sandbox", reason="dangerous", voice_message="Needs approval")

        # Mock the confirmation future to approve immediately
        mock_tool = MagicMock()
        mock_tool.name = "execute_cli"

        with patch("core.execution_agent.execute_cli_sandboxed", new_callable=AsyncMock) as mock_fn:
            mock_fn.return_value = mock_sandbox_result

            from core.execution_agent import ExecutionAgent

            from collections import deque

            agent = ExecutionAgent.__new__(ExecutionAgent)
            agent._evaluator = MagicMock()
            agent._evaluator.classify = mock_classify
            agent._cancelled = False
            agent._step_counter = 0
            agent._send_message_fn = MagicMock()
            agent._confirmation_futures = {}
            agent._action_history = deque(maxlen=50)
            agent._message_queue = deque(maxlen=100)
            agent._computer_use_backend = "ui_tars"
            agent._active_tool_spans = {}
            agent._last_classified_command = ""
            agent._last_confirmation_outcome = ""
            agent._agent = MagicMock()

            # Simulate: classify returns sandbox, user approves
            async def mock_before_tool():
                result = await agent._before_tool_callback(
                    mock_tool, {"command": "rm -rf /"}, MagicMock()
                )
                return result

            # Patch the confirmation to auto-approve
            import asyncio

            async def run_with_approval():
                task = asyncio.create_task(mock_before_tool())
                # Wait for the confirmation future to be created
                await asyncio.sleep(0.05)
                # Find and resolve the future
                for req_id, future in agent._confirmation_futures.items():
                    future.set_result(True)  # Approve
                    break
                return await task

            result = await run_with_approval()

            # Verify sandbox was called
            mock_fn.assert_called_once_with("rm -rf /")
            assert result == mock_sandbox_result
