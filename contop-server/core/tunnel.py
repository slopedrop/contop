"""
Cloudflare Tunnel manager - spawns and manages a cloudflared Quick Tunnel subprocess.

Provides a public HTTPS/WSS URL for the local FastAPI server so that mobile clients
can reach the signaling WebSocket from anywhere in the world, without port forwarding.

Uses Cloudflare Quick Tunnels (no account required, free).
Includes a periodic health monitor that restarts the tunnel if the cloudflared
subprocess dies or the tunnel URL becomes unreachable.
"""
import asyncio
import logging
import platform
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen, urlretrieve, Request
from urllib.error import URLError

logger = logging.getLogger(__name__)

# Regex to extract the tunnel URL from cloudflared's stderr output.
# cloudflared prints a line like: "... https://xxx-yyy.trycloudflare.com ..."
_TUNNEL_URL_RE = re.compile(r"(https://[a-zA-Z0-9]+-[a-zA-Z0-9\-]+\.trycloudflare\.com)")

# How long to wait for cloudflared to print its tunnel URL before giving up.
_STARTUP_TIMEOUT_SECONDS = 30

# DNS readiness: probe interval and max attempts after tunnel URL is extracted
_DNS_PROBE_INTERVAL_SECONDS = 5
_DNS_PROBE_MAX_ATTEMPTS = 6  # up to 30s total

# Health check interval in seconds
_HEALTH_CHECK_INTERVAL_SECONDS = 120

# How many consecutive probe failures before restarting the tunnel
_MAX_CONSECUTIVE_FAILURES = 3

# Global tunnel state
_tunnel_process: subprocess.Popen | None = None
_tunnel_url: str | None = None
_local_port: int | None = None
_health_task: asyncio.Task | None = None
_consecutive_failures: int = 0


def _get_cloudflared_download_url() -> str | None:
    """Return the download URL for the cloudflared binary for the current platform."""
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        if machine in ("amd64", "x86_64", "x64"):
            return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        return None
    elif system == "darwin":
        if machine == "arm64":
            return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
        return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
    elif system == "linux":
        if machine in ("amd64", "x86_64"):
            return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        elif machine in ("aarch64", "arm64"):
            return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
        return None

    return None


def _get_data_dir() -> Path:
    """Return the application data directory for storing the cloudflared binary."""
    if platform.system().lower() == "windows":
        base = Path.home() / "AppData" / "Local" / "contop"
    elif platform.system().lower() == "darwin":
        base = Path.home() / "Library" / "Application Support" / "contop"
    else:
        base = Path.home() / ".local" / "share" / "contop"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _find_cloudflared() -> str | None:
    """Find the cloudflared binary - first on PATH, then in app data directory."""
    # Check PATH first
    binary_name = "cloudflared.exe" if platform.system().lower() == "windows" else "cloudflared"
    path_result = shutil.which(binary_name)
    if path_result:
        return path_result

    # Check app data directory
    data_dir = _get_data_dir()
    local_binary = data_dir / binary_name
    if local_binary.exists():
        return str(local_binary)

    return None


def _download_cloudflared() -> str | None:
    """Download the cloudflared binary for the current platform. Returns path or None."""
    url = _get_cloudflared_download_url()
    if url is None:
        logger.warning("No cloudflared download available for this platform (%s/%s)",
                        platform.system(), platform.machine())
        return None

    data_dir = _get_data_dir()
    system = platform.system().lower()
    binary_name = "cloudflared.exe" if system == "windows" else "cloudflared"
    target = data_dir / binary_name

    logger.info("Downloading cloudflared from %s ...", url)
    try:
        if url.endswith(".tgz"):
            import tarfile
            archive_path = data_dir / "cloudflared.tgz"
            urlretrieve(url, str(archive_path))
            with tarfile.open(str(archive_path), "r:gz") as tar:
                try:
                    tar.extract("cloudflared", path=str(data_dir), filter='data')
                except TypeError:
                    # Python < 3.12 doesn't support filter kwarg
                    tar.extract("cloudflared", path=str(data_dir))
            archive_path.unlink(missing_ok=True)
        elif url.endswith(".zip"):
            archive_path = data_dir / "cloudflared.zip"
            urlretrieve(url, str(archive_path))
            with zipfile.ZipFile(str(archive_path), "r") as zf:
                zf.extract("cloudflared", path=str(data_dir))
            archive_path.unlink(missing_ok=True)
        else:
            # Direct binary download (Windows .exe or Linux binary)
            urlretrieve(url, str(target))

        # Make executable on Unix
        if system != "windows":
            target.chmod(0o755)

        logger.info("cloudflared downloaded to %s", target)
        return str(target)

    except Exception:
        logger.warning("Failed to download cloudflared", exc_info=True)
        return None


def _ensure_cloudflared() -> str | None:
    """Find or download cloudflared. Returns path to binary or None."""
    binary = _find_cloudflared()
    if binary:
        return binary

    logger.info("cloudflared not found on PATH or in app data - attempting download")
    return _download_cloudflared()


async def start_tunnel(local_port: int) -> str | None:
    """Start a Cloudflare Quick Tunnel pointing to the local server.

    Returns the public tunnel URL (e.g., "https://xxx.trycloudflare.com") or None
    if the tunnel could not be started.

    The tunnel subprocess is stored globally and should be stopped via stop_tunnel().
    Also starts a background health monitor that auto-restarts the tunnel if it dies.

    DNS readiness probing runs as a background task so it does not block server
    startup - the FastAPI lifespan must complete quickly for the /health endpoint
    to become available (Tauri health polling times out at 30s).
    """
    global _tunnel_process, _tunnel_url, _local_port

    _local_port = local_port

    binary = _ensure_cloudflared()
    if binary is None:
        logger.warning(
            "cloudflared binary not available - remote connections will not work. "
            "Install cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) "
            "or place it on your PATH for global connectivity."
        )
        return None

    tunnel_url = await _start_tunnel_process(binary, local_port)
    if tunnel_url:
        # DNS probe + health monitor run in the background so the server can
        # start accepting requests immediately (fixes 30s startup timeout).
        asyncio.create_task(_post_tunnel_setup(tunnel_url))
    return tunnel_url


async def _post_tunnel_setup(tunnel_url: str) -> None:
    """Background task: wait for DNS propagation, then start the health monitor."""
    dns_ready = await _wait_for_dns(tunnel_url)
    if not dns_ready:
        logger.warning("Tunnel URL DNS did not become resolvable within %ds - proceeding anyway",
                       _DNS_PROBE_INTERVAL_SECONDS * _DNS_PROBE_MAX_ATTEMPTS)
    _start_health_monitor()


async def _start_tunnel_process(binary: str, local_port: int) -> str | None:
    """Internal: spawn cloudflared and extract the tunnel URL."""
    global _tunnel_process, _tunnel_url

    local_url = f"http://localhost:{local_port}"
    cmd = [binary, "tunnel", "--url", local_url, "--no-autoupdate"]

    logger.info("Starting Cloudflare Tunnel: %s -> %s", local_url, "public URL pending...")

    try:
        # cloudflared writes the tunnel URL to stderr
        _tunnel_process = await asyncio.to_thread(
            lambda: subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        )

        # Read stderr lines until we find the tunnel URL or timeout
        tunnel_url = await _read_tunnel_url(_tunnel_process, _STARTUP_TIMEOUT_SECONDS)

        if tunnel_url:
            _tunnel_url = tunnel_url
            logger.info("Cloudflare Tunnel active: %s -> %s", tunnel_url, local_url)
            return tunnel_url
        else:
            logger.warning("cloudflared started but no tunnel URL detected within %ds", _STARTUP_TIMEOUT_SECONDS)
            await _kill_tunnel_process()
            return None

    except FileNotFoundError:
        logger.warning("cloudflared binary not found at %s", binary)
        return None
    except Exception:
        logger.warning("Failed to start Cloudflare Tunnel", exc_info=True)
        await _kill_tunnel_process()
        return None


async def _read_tunnel_url(process: subprocess.Popen, timeout: float) -> str | None:
    """Read cloudflared stderr in a thread to find the tunnel URL."""
    def _read_lines() -> str | None:
        import time
        deadline = time.monotonic() + timeout
        stderr = process.stderr
        if stderr is None:
            return None

        while time.monotonic() < deadline:
            line = stderr.readline()
            if not line:
                # Process exited or EOF
                if process.poll() is not None:
                    return None
                continue

            logger.debug("cloudflared: %s", line.rstrip())
            match = _TUNNEL_URL_RE.search(line)
            if match:
                return match.group(1)

        return None

    return await asyncio.to_thread(_read_lines)


async def _kill_tunnel_process() -> None:
    """Terminate the cloudflared subprocess without touching the health monitor."""
    global _tunnel_process, _tunnel_url

    if _tunnel_process is not None:
        try:
            _tunnel_process.terminate()
            await asyncio.to_thread(_tunnel_process.wait, timeout=5)
        except Exception:
            try:
                _tunnel_process.kill()
            except Exception:
                pass
        finally:
            _tunnel_process = None
            _tunnel_url = None


async def stop_tunnel() -> None:
    """Stop the cloudflared tunnel subprocess and health monitor."""
    global _health_task

    # Cancel health monitor first
    if _health_task is not None:
        _health_task.cancel()
        try:
            await _health_task
        except asyncio.CancelledError:
            pass
        _health_task = None

    await _kill_tunnel_process()
    logger.info("Cloudflare Tunnel stopped")


def _start_health_monitor() -> None:
    """Launch the background health check task."""
    global _health_task
    if _health_task is not None and not _health_task.done():
        return
    _health_task = asyncio.create_task(_health_monitor_loop())
    logger.info("Tunnel health monitor started (interval=%ds)", _HEALTH_CHECK_INTERVAL_SECONDS)


async def _health_monitor_loop() -> None:
    """Periodically check that the tunnel is alive.

    Only restarts the tunnel when:
    - The cloudflared process has actually exited (immediate restart), OR
    - The tunnel URL fails HTTP probes _MAX_CONSECUTIVE_FAILURES times in a row
      (guards against transient network hiccups triggering unnecessary restarts)

    Invalidates the cached QR image on restart so the next QR fetch encodes the new URL.
    """
    global _consecutive_failures

    while True:
        await asyncio.sleep(_HEALTH_CHECK_INTERVAL_SECONDS)

        try:
            # Check 1: Is the cloudflared subprocess still running?
            # Process death is definitive - restart immediately.
            # Capture reference locally to avoid interleaving issues across await.
            proc = _tunnel_process
            if proc is None:
                logger.warning("Tunnel health check: process is None - restarting")
                await _restart_tunnel()
                continue
            elif proc.poll() is not None:
                exit_code = proc.returncode
                logger.warning("Tunnel health check: cloudflared exited with code %s - restarting", exit_code)
                await _restart_tunnel()
                continue

            # Check 2: Is the tunnel URL reachable?
            # Network probes can fail transiently, so require multiple
            # consecutive failures before restarting.
            if _tunnel_url:
                reachable = await _probe_tunnel_url(_tunnel_url)
                if reachable:
                    if _consecutive_failures > 0:
                        logger.info("Tunnel probe recovered after %d failure(s)", _consecutive_failures)
                    _consecutive_failures = 0
                else:
                    _consecutive_failures += 1
                    logger.warning(
                        "Tunnel probe failed (%d/%d): %s",
                        _consecutive_failures, _MAX_CONSECUTIVE_FAILURES, _tunnel_url,
                    )
                    if _consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
                        logger.warning("Tunnel unreachable after %d consecutive probes - restarting", _MAX_CONSECUTIVE_FAILURES)
                        _consecutive_failures = 0
                        await _restart_tunnel()

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Tunnel health check error", exc_info=True)


async def _restart_tunnel() -> None:
    """Kill the current tunnel process and start a new one."""
    await _kill_tunnel_process()

    # Invalidate cached QR so next fetch encodes the new URL
    try:
        import core.pairing as _pairing_mod
        _pairing_mod._last_qr_png = None
    except Exception:
        pass

    binary = _ensure_cloudflared()
    if binary and _local_port:
        new_url = await _start_tunnel_process(binary, _local_port)
        if new_url:
            logger.info("Tunnel restarted successfully: %s", new_url)
        else:
            logger.error("Tunnel restart failed - will retry in %ds", _HEALTH_CHECK_INTERVAL_SECONDS)
    else:
        logger.error("Cannot restart tunnel - binary or port unavailable")


async def _wait_for_dns(url: str) -> bool:
    """Poll the tunnel URL until it responds, confirming DNS has propagated.

    Returns True if the URL became reachable, False if all attempts were exhausted.
    """
    for attempt in range(1, _DNS_PROBE_MAX_ATTEMPTS + 1):
        if await _probe_tunnel_url(url):
            logger.info("Tunnel DNS ready after %d probe(s)", attempt)
            return True
        logger.debug("Tunnel DNS probe %d/%d failed, retrying in %ds...",
                     attempt, _DNS_PROBE_MAX_ATTEMPTS, _DNS_PROBE_INTERVAL_SECONDS)
        await asyncio.sleep(_DNS_PROBE_INTERVAL_SECONDS)
    return False


async def _probe_tunnel_url(url: str) -> bool:
    """Send an HTTP HEAD request to the tunnel URL to verify it resolves and responds.

    Returns True if the URL is reachable (any HTTP response), False on DNS/connection failure.
    """
    def _do_probe() -> bool:
        try:
            req = Request(url, method="HEAD")
            with urlopen(req, timeout=10) as resp:
                return True
        except URLError:
            return False
        except Exception:
            return False

    return await asyncio.to_thread(_do_probe)


def get_tunnel_url() -> str | None:
    """Return the active tunnel URL, or None if no tunnel is running."""
    return _tunnel_url
