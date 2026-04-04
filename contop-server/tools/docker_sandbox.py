"""
Docker sandbox execution — the "dangerous route" for CLI commands.

Executes shell commands classified as "sandbox" by the DualToolEvaluator
inside ephemeral, hardened Docker containers. When Docker is unavailable,
falls back to a restricted HostSubprocess execution with reduced timeout.

Auto-starts Docker Desktop if installed but not running (transparent to user,
with status messages sent to mobile).

[Source: architecture.md — Execution Routing Decision, tools/docker_sandbox.py is FR17]
[Source: project-context.md — Mandatory Dual-Tool Gate, Error Handling]
"""
import asyncio
import logging
import os
import platform
import shutil
import subprocess
import threading
import time
from typing import Callable

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 30
DEFAULT_MAX_OUTPUT_BYTES = 51200  # 50 KB
DEFAULT_IMAGE = "python:3.12-slim"
TRUNCATION_MARKER = "\n[truncated]"


def _truncate(text: str, max_bytes: int) -> tuple[str, bool]:
    """Truncate text to max_bytes. Returns (text, was_truncated)."""
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= max_bytes:
        return text, False
    truncated = encoded[:max_bytes].decode("utf-8", errors="replace")
    return truncated + TRUNCATION_MARKER, True


# ── Docker Desktop auto-start ────────────────────────────────────────────────

_DOCKER_DESKTOP_PATHS_WINDOWS = [
    os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Docker", "Docker", "Docker Desktop.exe"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Docker", "Docker Desktop.exe"),
]
_DOCKER_DESKTOP_PATHS_MACOS = [
    "/Applications/Docker.app",
]

DOCKER_START_TIMEOUT_S = 45  # Max time to wait for Docker daemon after auto-start


def _find_docker_desktop() -> str | None:
    """Find Docker Desktop executable on disk. Returns path or None."""
    system = platform.system()

    if system == "Windows":
        for path in _DOCKER_DESKTOP_PATHS_WINDOWS:
            if path and os.path.isfile(path):
                return path
    elif system == "Darwin":
        for path in _DOCKER_DESKTOP_PATHS_MACOS:
            if os.path.exists(path):
                return path
    elif system == "Linux":
        # On Linux, Docker is typically a systemd service, not a GUI app
        if shutil.which("docker"):
            return "systemctl"
    return None


def _start_docker_desktop(path: str) -> bool:
    """Attempt to start Docker Desktop. Returns True if launch command succeeded."""
    system = platform.system()
    try:
        if system == "Windows":
            # Start Docker Desktop minimized in background
            subprocess.Popen(
                [path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
            )
            return True
        elif system == "Darwin":
            subprocess.Popen(
                ["open", "-a", "Docker"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        elif path == "systemctl":
            # Try without sudo first — works if user is in the docker group
            # or has polkit permissions. Avoids silent sudo failures (no TTY).
            result = subprocess.run(
                ["systemctl", "start", "docker"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
            if result.returncode == 0:
                return True
            logger.info("systemctl start docker failed (rc=%d) — requires sudo or docker group", result.returncode)
            return False
    except Exception as exc:
        logger.warning("Failed to start Docker Desktop: %s", exc)
    return False


class DockerSandbox:
    """Execute shell commands inside ephemeral, hardened Docker containers.

    Auto-starts Docker Desktop if installed but not running.
    Falls back to restricted HostSubprocess execution when Docker is unavailable.
    """

    _docker_available: bool | None = None  # Cached availability check
    _client = None  # Cached Docker client
    _status_callback: Callable[[str, dict], None] | None = None
    _check_lock = threading.Lock()  # Protects first-write to _docker_available

    @classmethod
    def _reset(cls) -> None:
        """Reset cached state (for testing)."""
        cls._docker_available = None
        cls._client = None
        cls._status_callback = None

    @classmethod
    def set_status_callback(cls, fn: Callable[[str, dict], None] | None) -> None:
        """Set callback for sending status messages to mobile during Docker operations."""
        cls._status_callback = fn

    @classmethod
    def _notify(cls, message: str) -> None:
        """Send a status notification to mobile (if callback available)."""
        if cls._status_callback:
            try:
                cls._status_callback("agent_status", {
                    "type": "docker_sandbox",
                    "message": message,
                })
            except Exception:
                pass

    @classmethod
    def _check_docker(cls) -> bool:
        """Check if Docker Engine is available. Auto-starts if needed. Caches result."""
        # Fast path: already checked
        if cls._docker_available is not None:
            return cls._docker_available

        with cls._check_lock:
            # Re-check inside lock (another thread may have set it)
            if cls._docker_available is not None:
                return cls._docker_available

            try:
                import docker as docker_mod
            except ImportError:
                logger.warning("Docker SDK not installed — sandbox will use fallback")
                cls._docker_available = False
                return False

            # Attempt 1: Try connecting directly (Docker already running)
            try:
                client = docker_mod.from_env()
                client.ping()
                cls._client = client
                cls._docker_available = True
                logger.info("Docker Engine is available")
                return True
            except Exception as exc:
                logger.info("Docker daemon not responding: %s — checking if we can auto-start", exc)

            # Attempt 2: Auto-start Docker Desktop if installed
            desktop_path = _find_docker_desktop()
            if desktop_path is None:
                logger.warning("Docker not installed — sandbox will use fallback")
                cls._notify("Docker is not installed. Running command in restricted mode on the host.")
                cls._docker_available = False
                return False

            logger.info("Docker Desktop found at %s — attempting auto-start", desktop_path)
            cls._notify("Starting Docker for sandbox isolation... this may take a moment.")

            if not _start_docker_desktop(desktop_path):
                logger.warning("Failed to launch Docker Desktop")
                cls._notify("Could not start Docker. Running command in restricted mode on the host.")
                cls._docker_available = False
                return False

            # Poll for Docker daemon readiness
            start_time = time.monotonic()
            while time.monotonic() - start_time < DOCKER_START_TIMEOUT_S:
                try:
                    client = docker_mod.from_env()
                    client.ping()
                    cls._client = client
                    cls._docker_available = True
                    elapsed = int(time.monotonic() - start_time)
                    logger.info("Docker Engine ready after %ds auto-start", elapsed)
                    cls._notify("Docker is ready. Running command in sandbox.")
                    return True
                except Exception:
                    time.sleep(2)

            logger.warning("Docker daemon did not start within %ds", DOCKER_START_TIMEOUT_S)
            cls._notify("Docker is taking too long to start. Running command in restricted mode on the host.")
            cls._docker_available = False
            return False

    @classmethod
    def _ensure_image(cls, image: str) -> None:
        """Pull the sandbox base image if not present locally."""
        if cls._client is None:
            return
        try:
            import docker as docker_mod
            ImageNotFound = docker_mod.errors.ImageNotFound
        except (ImportError, AttributeError):
            ImageNotFound = Exception

        try:
            cls._client.images.get(image)
            logger.info("Sandbox image '%s' already present", image)
        except ImageNotFound:
            logger.info("Pulling sandbox image '%s'...", image)
            cls._client.images.pull(image)
            logger.info("Sandbox image '%s' pulled successfully", image)

    async def run(
        self,
        command: str,
        timeout_s: int = DEFAULT_TIMEOUT_S,
        max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES,
    ) -> dict:
        """Execute a command in a Docker sandbox or fall back to restricted host execution.

        Returns:
            dict with status, stdout, stderr, exit_code, duration_ms.
        """
        # Run Docker check in a thread to avoid blocking the event loop
        # during auto-start polling
        available = await asyncio.to_thread(self._check_docker)
        if not available:
            return await self._fallback_run(command, timeout_s, max_output_bytes)

        return await self._docker_run(command, timeout_s, max_output_bytes)

    async def _docker_run(
        self,
        command: str,
        timeout_s: int,
        max_output_bytes: int,
    ) -> dict:
        """Execute command inside an ephemeral Docker container."""
        image = os.environ.get("CONTOP_SANDBOX_IMAGE", DEFAULT_IMAGE)
        start = time.monotonic()
        container = None

        try:
            # Ensure image is available (pull if needed)
            await asyncio.to_thread(self._ensure_image, image)

            # Create and start container with security hardening
            container = await asyncio.to_thread(
                self._client.containers.run,
                image=image,
                command=["sh", "-c", command],
                detach=True,
                auto_remove=False,  # Remove manually after reading logs (docker-py#1813)
                network_disabled=True,
                mem_limit="256m",
                cpu_period=100000,
                cpu_quota=50000,  # 50% CPU
                pids_limit=100,
                read_only=True,
                tmpfs={"/tmp": "size=64M"},
                security_opt=["no-new-privileges"],
                user="nobody",
                cap_drop=["ALL"],
                labels={"contop.sandbox": "ephemeral"},
            )

            # Wait for completion with timeout
            timed_out = False
            try:
                result = await asyncio.to_thread(container.wait, timeout=timeout_s)
                exit_code = result["StatusCode"]
            except Exception:
                # Timeout or other error — stop the container
                timed_out = True
                exit_code = -1
                try:
                    await asyncio.to_thread(container.stop, timeout=1)
                except Exception:
                    pass

            # Read logs before removal
            try:
                stdout_bytes = await asyncio.to_thread(
                    container.logs, stdout=True, stderr=False
                )
                stderr_bytes = await asyncio.to_thread(
                    container.logs, stdout=False, stderr=True
                )
                stdout_str = stdout_bytes.decode("utf-8", errors="replace")
                stderr_str = stderr_bytes.decode("utf-8", errors="replace")
            except Exception:
                stdout_str = ""
                stderr_str = ""

            duration_ms = int((time.monotonic() - start) * 1000)

            # Truncate output
            stdout_str, _ = _truncate(stdout_str, max_output_bytes)
            stderr_str, _ = _truncate(stderr_str, max_output_bytes)

            if timed_out:
                status = "error"
                voice = "The sandboxed command timed out."
            elif exit_code == 0:
                status = "success"
                voice = "The sandboxed command completed successfully."
            else:
                status = "error"
                voice = f"The sandboxed command failed with exit code {exit_code}."

            logger.info(
                "DockerSandbox container %s finished: exit_code=%d, timed_out=%s, duration=%dms",
                container.short_id if container else "?",
                exit_code,
                timed_out,
                duration_ms,
            )

            return {
                "status": status,
                "stdout": stdout_str,
                "stderr": stderr_str,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "sandboxed": True,
                "voice_message": voice,
            }

        except Exception as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            logger.exception("DockerSandbox._docker_run() failed for command: %s", command[:80])

            # Invalidate cache on Docker connection errors so next call
            # attempts reconnection / auto-start instead of failing repeatedly
            exc_str = str(exc).lower()
            if "connection" in exc_str or "refused" in exc_str or "not found" in exc_str:
                self.__class__._docker_available = None
                self.__class__._client = None
                logger.warning("Docker connection error — cache invalidated for retry on next call")

            return {
                "status": "error",
                "stdout": "",
                "stderr": str(exc),
                "exit_code": -1,
                "duration_ms": duration_ms,
                "sandboxed": True,
                "voice_message": "The sandboxed command failed due to a Docker error.",
            }
        finally:
            # Belt-and-suspenders: always remove the container
            if container is not None:
                try:
                    await asyncio.to_thread(container.remove, force=True)
                except Exception:
                    pass

    async def _fallback_run(
        self,
        command: str,
        timeout_s: int,
        max_output_bytes: int,
    ) -> dict:
        """Restricted subprocess fallback when Docker is unavailable."""
        from tools.host_subprocess import HostSubprocess

        logger.warning(
            "Docker unavailable — executing in restricted host subprocess (NO sandbox isolation): %s",
            command[:80],
        )
        if self._status_callback:
            try:
                self._status_callback("agent_status", {
                    "type": "sandbox_fallback",
                    "message": "Docker unavailable → restricted subprocess (no isolation)",
                })
            except Exception:
                pass

        # Use shorter timeout for safety in non-sandboxed environment
        fallback_timeout = min(timeout_s, 10)

        result = await HostSubprocess().run(
            command=command,
            timeout_s=fallback_timeout,
            max_output_bytes=max_output_bytes,
            auto_confirm=False,
        )

        # Mark that this execution was NOT sandboxed so callers can distinguish
        result["sandboxed"] = False
        result["voice_message"] = (
            "Warning: Docker is not available, so this command ran without "
            "sandbox isolation on the host machine."
        )

        return result
