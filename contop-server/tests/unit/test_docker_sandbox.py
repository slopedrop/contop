"""
Unit tests for tools/docker_sandbox.py - Docker sandbox execution (dangerous route).

Tests 5.1-5.10 from Story 3.4: successful execution, timeout enforcement,
output truncation, Docker-unavailable fallback, container cleanup,
security constraints, image pull, and return dict shape.
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import pytest

from tools.docker_sandbox import (
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_TIMEOUT_S,
    DEFAULT_IMAGE,
    TRUNCATION_MARKER,
    DockerSandbox,
    _truncate,
)


@pytest.fixture(autouse=True)
def reset_docker_sandbox():
    """Reset DockerSandbox cached state between tests."""
    DockerSandbox._reset()
    yield
    DockerSandbox._reset()


def _make_mock_container(
    exit_code=0,
    stdout=b"output",
    stderr=b"",
    wait_raises=None,
):
    """Create a mock Docker container with configurable behavior."""
    container = MagicMock()
    if wait_raises:
        container.wait.side_effect = wait_raises
    else:
        container.wait.return_value = {"StatusCode": exit_code}
    # Precise logs based on parameters
    def logs_fn(stdout=True, stderr=True):
        if stdout and not stderr:
            return b"output" if exit_code == 0 else b""
        if stderr and not stdout:
            return b"" if exit_code == 0 else b"error output"
        return b"output"
    container.logs.side_effect = logs_fn
    container.stop.return_value = None
    container.remove.return_value = None
    return container


def _make_mock_client(container=None, image_exists=True, ping_ok=True):
    """Create a mock Docker client."""
    client = MagicMock()
    if not ping_ok:
        client.ping.side_effect = Exception("Docker not running")
    else:
        client.ping.return_value = True

    if container is None:
        container = _make_mock_container()
    client.containers.run.return_value = container

    if image_exists:
        client.images.get.return_value = MagicMock()
    else:
        try:
            import docker as docker_mod
            client.images.get.side_effect = docker_mod.errors.ImageNotFound("not found")
        except (ImportError, AttributeError):
            client.images.get.side_effect = Exception("ImageNotFound")
        client.images.pull.return_value = MagicMock()

    return client, container


# ─── Test 5.2: Successful command execution ──────────────────────────────────


class TestSuccessfulExecution:
    """Verify container.run() called with correct params and result shape."""

    @pytest.mark.asyncio
    async def test_successful_execution_returns_correct_result(self):
        container = _make_mock_container(exit_code=0, stdout=b"hello world", stderr=b"")
        container.logs.side_effect = lambda stdout=True, stderr=True: (
            b"hello world" if stdout and not stderr else
            b"" if stderr and not stdout else
            b"hello world"
        )
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("echo hello world")

        assert result["status"] == "success"
        assert "hello world" in result["stdout"]
        assert result["exit_code"] == 0
        assert result["duration_ms"] >= 0

    @pytest.mark.asyncio
    async def test_container_run_called_with_correct_params(self):
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("ls -la")

        client.containers.run.assert_called_once()
        call_kwargs = client.containers.run.call_args
        assert call_kwargs.kwargs["command"] == ["sh", "-c", "ls -la"]
        assert call_kwargs.kwargs["detach"] is True
        assert call_kwargs.kwargs["auto_remove"] is False
        assert call_kwargs.kwargs["network_disabled"] is True

    @pytest.mark.asyncio
    async def test_result_dict_has_all_required_keys(self):
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("echo test")

        required_keys = {"status", "stdout", "stderr", "exit_code", "duration_ms", "voice_message", "sandboxed"}
        assert required_keys == set(result.keys())

    @pytest.mark.asyncio
    async def test_failed_command_returns_error_status(self):
        container = _make_mock_container(exit_code=1)
        container.logs.side_effect = lambda stdout=True, stderr=True: (
            b"" if stdout and not stderr else
            b"command not found" if stderr and not stdout else
            b"command not found"
        )
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("nonexistent_command")

        assert result["status"] == "error"
        assert result["exit_code"] == 1


# ─── Test 5.3: Timeout enforcement ──────────────────────────────────────────


class TestTimeoutEnforcement:
    """Verify container.stop() and container.remove() on timeout."""

    @pytest.mark.asyncio
    async def test_timeout_stops_and_removes_container(self):
        container = _make_mock_container(wait_raises=Exception("timeout"))
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("sleep 100", timeout_s=1)

        assert result["status"] == "error"
        assert result["exit_code"] == -1
        container.stop.assert_called_once()
        container.remove.assert_called_once_with(force=True)

    @pytest.mark.asyncio
    async def test_timeout_result_has_correct_status(self):
        container = _make_mock_container(wait_raises=Exception("timeout"))
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("sleep 100", timeout_s=5)

        assert result["status"] == "error"
        assert result["exit_code"] == -1


# ─── Test 5.4: Output truncation ────────────────────────────────────────────


class TestOutputTruncation:
    """Verify large output is truncated with marker."""

    def test_truncate_short_text_unchanged(self):
        text, was_truncated = _truncate("short", 1000)
        assert text == "short"
        assert was_truncated is False

    def test_truncate_long_text_truncated(self):
        long_text = "x" * 100000
        text, was_truncated = _truncate(long_text, 1000)
        assert was_truncated is True
        assert text.endswith(TRUNCATION_MARKER)
        assert len(text.encode("utf-8")) <= 1000 + len(TRUNCATION_MARKER.encode("utf-8"))

    @pytest.mark.asyncio
    async def test_large_output_truncated_in_result(self):
        large_output = b"x" * 100000
        container = _make_mock_container()
        container.logs.side_effect = lambda stdout=True, stderr=True: (
            large_output if stdout and not stderr else
            b"" if stderr and not stdout else
            large_output
        )
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("cat bigfile", max_output_bytes=1000)

        assert TRUNCATION_MARKER in result["stdout"]


# ─── Test 5.5: Docker unavailable fallback ───────────────────────────────────


class TestDockerUnavailableFallback:
    """Verify HostSubprocess used with reduced timeout when Docker unavailable."""

    @pytest.mark.asyncio
    async def test_fallback_uses_host_subprocess(self):
        mock_result = {
            "status": "success",
            "stdout": "fallback output",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 100,
        }
        mock_host = AsyncMock(return_value=mock_result)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=False):
            with patch("tools.host_subprocess.HostSubprocess.run", mock_host):
                sandbox = DockerSandbox()
                result = await sandbox.run("echo test")

        mock_host.assert_called_once()
        # Verify reduced timeout (max 10s)
        call_kwargs = mock_host.call_args
        assert call_kwargs.kwargs.get("timeout_s", call_kwargs[1].get("timeout_s", 30)) <= 10

    @pytest.mark.asyncio
    async def test_fallback_returns_host_subprocess_result(self):
        mock_result = {
            "status": "success",
            "stdout": "output",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 100,
        }
        mock_host = AsyncMock(return_value=mock_result)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=False):
            with patch("tools.host_subprocess.HostSubprocess.run", mock_host):
                sandbox = DockerSandbox()
                result = await sandbox.run("echo test")

        assert result["status"] == "success"
        assert result["stdout"] == "output"

    @pytest.mark.asyncio
    async def test_fallback_when_docker_import_fails(self):
        """When docker package isn't installed, fallback should activate."""
        mock_result = {
            "status": "success",
            "stdout": "ok",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 50,
        }
        mock_host = AsyncMock(return_value=mock_result)

        # Simulate ImportError on docker import
        with patch.dict("sys.modules", {"docker": None}):
            DockerSandbox._reset()
            with patch("tools.host_subprocess.HostSubprocess.run", mock_host):
                sandbox = DockerSandbox()
                result = await sandbox.run("echo fallback")

        assert result["status"] == "success"


# ─── Test 5.6: Container cleanup ────────────────────────────────────────────


class TestContainerCleanup:
    """Verify container.remove() called in all paths (success, error, timeout)."""

    @pytest.mark.asyncio
    async def test_container_removed_on_success(self):
        container = _make_mock_container(exit_code=0)
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("echo ok")

        container.remove.assert_called_once_with(force=True)

    @pytest.mark.asyncio
    async def test_container_removed_on_error(self):
        container = _make_mock_container(exit_code=1)
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("false")

        container.remove.assert_called_once_with(force=True)

    @pytest.mark.asyncio
    async def test_container_removed_on_timeout(self):
        container = _make_mock_container(wait_raises=Exception("timeout"))
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("sleep 999", timeout_s=1)

        container.remove.assert_called_with(force=True)


# ─── Test 5.8: Security constraints ─────────────────────────────────────────


class TestSecurityConstraints:
    """Verify network_disabled, no volumes, mem_limit, read_only in container config."""

    @pytest.mark.asyncio
    async def test_container_security_hardening(self):
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("echo test")

        call_kwargs = client.containers.run.call_args.kwargs

        # Network isolation
        assert call_kwargs["network_disabled"] is True
        # Memory limit
        assert call_kwargs["mem_limit"] == "256m"
        # CPU limits
        assert call_kwargs["cpu_period"] == 100000
        assert call_kwargs["cpu_quota"] == 50000
        # PID limit (fork bomb prevention)
        assert call_kwargs["pids_limit"] == 100
        # Read-only root filesystem
        assert call_kwargs["read_only"] is True
        # Writable /tmp via tmpfs
        assert "/tmp" in call_kwargs["tmpfs"]
        # No privilege escalation
        assert "no-new-privileges" in call_kwargs["security_opt"]
        # No auto-remove (race condition prevention)
        assert call_kwargs["auto_remove"] is False
        # Detached mode
        assert call_kwargs["detach"] is True

    @pytest.mark.asyncio
    async def test_no_volume_mounts(self):
        """Container must NOT have any host volume mounts."""
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("echo test")

        call_kwargs = client.containers.run.call_args.kwargs
        # volumes should not be present
        assert "volumes" not in call_kwargs or call_kwargs.get("volumes") is None


# ─── Test 5.9: Image pull on first use ───────────────────────────────────────


class TestImagePull:
    """Verify images.pull() called when image not found locally."""

    @pytest.mark.asyncio
    async def test_image_pulled_when_not_found(self):
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container, image_exists=False)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("echo test")

        client.images.pull.assert_called_once()

    @pytest.mark.asyncio
    async def test_image_not_pulled_when_exists(self):
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container, image_exists=True)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            await sandbox.run("echo test")

        client.images.pull.assert_not_called()

    @pytest.mark.asyncio
    async def test_custom_image_via_env_var(self):
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            with patch.dict("os.environ", {"CONTOP_SANDBOX_IMAGE": "ubuntu:22.04"}):
                sandbox = DockerSandbox()
                await sandbox.run("echo test")

        call_kwargs = client.containers.run.call_args
        assert call_kwargs.kwargs["image"] == "ubuntu:22.04"


# ─── Test 5.10: Return dict shape matches HostSubprocess format ──────────────


class TestReturnDictShape:
    """Verify DockerSandbox returns same shape as HostSubprocess."""

    REQUIRED_KEYS = {"status", "stdout", "stderr", "exit_code", "duration_ms", "voice_message", "sandboxed"}

    @pytest.mark.asyncio
    async def test_docker_path_returns_correct_shape(self):
        container = _make_mock_container()
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("echo test")

        assert set(result.keys()) == self.REQUIRED_KEYS
        assert isinstance(result["status"], str)
        assert isinstance(result["stdout"], str)
        assert isinstance(result["stderr"], str)
        assert isinstance(result["exit_code"], int)
        assert isinstance(result["duration_ms"], int)

    @pytest.mark.asyncio
    async def test_fallback_path_returns_correct_shape(self):
        mock_result = {
            "status": "success",
            "stdout": "ok",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 50,
            "voice_message": "The command completed successfully.",
        }

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=False):
            with patch("tools.host_subprocess.HostSubprocess.run", AsyncMock(return_value=mock_result)):
                sandbox = DockerSandbox()
                result = await sandbox.run("echo test")

        assert set(result.keys()) == self.REQUIRED_KEYS

    @pytest.mark.asyncio
    async def test_timeout_path_returns_correct_shape(self):
        container = _make_mock_container(wait_raises=Exception("timeout"))
        client, _ = _make_mock_client(container=container)

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("sleep 999", timeout_s=1)

        assert set(result.keys()) == self.REQUIRED_KEYS

    @pytest.mark.asyncio
    async def test_exception_path_returns_correct_shape(self):
        """Even when docker_run raises internally, shape must be correct."""
        client = MagicMock()
        client.containers.run.side_effect = Exception("Docker crashed")
        client.images.get.return_value = MagicMock()

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("echo test")

        assert set(result.keys()) == self.REQUIRED_KEYS
        assert result["status"] == "error"


# ─── Docker auto-start tests ────────────────────────────────────────────────


class TestDockerAutoStart:
    """Verify Docker Desktop auto-start when installed but not running."""

    def test_auto_start_attempted_when_ping_fails_but_desktop_found(self):
        """If Docker SDK works but daemon not running, try to start Desktop."""
        mock_docker = MagicMock()
        mock_client = MagicMock()
        mock_client.ping.side_effect = [Exception("not running"), True]
        mock_docker.from_env.return_value = mock_client

        with patch.dict("sys.modules", {"docker": mock_docker}):
            with patch("tools.docker_sandbox._find_docker_desktop", return_value="C:/Docker/Docker Desktop.exe"):
                with patch("tools.docker_sandbox._start_docker_desktop", return_value=True):
                    with patch("tools.docker_sandbox.time.sleep"):
                        DockerSandbox._reset()
                        result = DockerSandbox._check_docker()

        assert result is True
        assert DockerSandbox._docker_available is True

    def test_no_auto_start_when_desktop_not_found(self):
        """If Docker Desktop is not installed, go straight to fallback."""
        mock_docker = MagicMock()
        mock_client = MagicMock()
        mock_client.ping.side_effect = Exception("not running")
        mock_docker.from_env.return_value = mock_client

        with patch.dict("sys.modules", {"docker": mock_docker}):
            with patch("tools.docker_sandbox._find_docker_desktop", return_value=None):
                DockerSandbox._reset()
                result = DockerSandbox._check_docker()

        assert result is False

    def test_status_callback_notified_during_auto_start(self):
        """Mobile should be notified when Docker is being started."""
        mock_docker = MagicMock()
        mock_client = MagicMock()
        mock_client.ping.side_effect = [Exception("not running"), True]
        mock_docker.from_env.return_value = mock_client

        mock_callback = MagicMock()
        DockerSandbox.set_status_callback(mock_callback)

        with patch.dict("sys.modules", {"docker": mock_docker}):
            with patch("tools.docker_sandbox._find_docker_desktop", return_value="/app/Docker"):
                with patch("tools.docker_sandbox._start_docker_desktop", return_value=True):
                    with patch("tools.docker_sandbox.time.sleep"):
                        DockerSandbox._reset()
                        DockerSandbox._status_callback = mock_callback
                        DockerSandbox._check_docker()

        # Verify at least one status message was sent
        assert mock_callback.call_count >= 1
        # First call should mention "Docker"
        first_call_payload = mock_callback.call_args_list[0][0][1]
        assert "docker" in first_call_payload["message"].lower()

    def test_auto_start_timeout_falls_back(self):
        """If Docker doesn't start within timeout, use fallback."""
        mock_docker = MagicMock()
        mock_client = MagicMock()
        mock_client.ping.side_effect = Exception("still not running")
        mock_docker.from_env.return_value = mock_client

        with patch.dict("sys.modules", {"docker": mock_docker}):
            with patch("tools.docker_sandbox._find_docker_desktop", return_value="/app/Docker"):
                with patch("tools.docker_sandbox._start_docker_desktop", return_value=True):
                    with patch("tools.docker_sandbox.DOCKER_START_TIMEOUT_S", 0):
                        with patch("tools.docker_sandbox.time.sleep"):
                            DockerSandbox._reset()
                            result = DockerSandbox._check_docker()

        assert result is False


# ─── Docker cache invalidation tests ─────────────────────────────────────────


class TestDockerCacheInvalidation:
    """Verify Docker cache is invalidated on connection errors."""

    @pytest.mark.asyncio
    async def test_connection_error_invalidates_cache(self):
        """Docker connection error should reset cached availability."""
        client = MagicMock()
        client.images.get.return_value = MagicMock()
        client.containers.run.side_effect = Exception("connection refused")

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("echo test")

        assert result["status"] == "error"
        # Cache should be invalidated
        assert DockerSandbox._docker_available is None
        assert DockerSandbox._client is None

    @pytest.mark.asyncio
    async def test_non_connection_error_preserves_cache(self):
        """Non-connection errors should NOT invalidate cache."""
        client = MagicMock()
        client.images.get.return_value = MagicMock()
        client.containers.run.side_effect = Exception("image config error")

        with patch("tools.docker_sandbox.DockerSandbox._check_docker", return_value=True):
            DockerSandbox._client = client
            DockerSandbox._docker_available = True

            sandbox = DockerSandbox()
            result = await sandbox.run("echo test")

        assert result["status"] == "error"
        # Cache should be preserved (not a connection error)
        assert DockerSandbox._docker_available is True


# ─── Linux auto-start tests ──────────────────────────────────────────────────


class TestLinuxAutoStart:
    """Verify Linux Docker auto-start uses systemctl without sudo."""

    def test_linux_start_uses_systemctl_without_sudo(self):
        """On Linux, _start_docker_desktop should NOT use sudo."""
        with patch("tools.docker_sandbox.platform.system", return_value="Linux"):
            with patch("tools.docker_sandbox.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                from tools.docker_sandbox import _start_docker_desktop
                result = _start_docker_desktop("systemctl")

        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert "sudo" not in cmd
        assert cmd == ["systemctl", "start", "docker"]
        assert result is True

    def test_linux_start_returns_false_on_permission_error(self):
        """If systemctl fails (e.g., no permissions), return False."""
        with patch("tools.docker_sandbox.platform.system", return_value="Linux"):
            with patch("tools.docker_sandbox.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=1)
                from tools.docker_sandbox import _start_docker_desktop
                result = _start_docker_desktop("systemctl")

        assert result is False
