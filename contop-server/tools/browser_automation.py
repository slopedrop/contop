"""
PinchTab browser automation client — async HTTP wrapper for the PinchTab REST API.

PinchTab is a Go binary that provides programmatic browser control via CDP.
It exposes a REST API on localhost:9867 for launching browser instances,
managing tabs, taking DOM snapshots, and performing actions (click, fill, etc.).

This client isolates all PinchTab HTTP calls so API changes only affect this file.
It also manages the PinchTab process lifecycle — downloading a pinned release at
server startup if needed, auto-starting the binary, and terminating it on close.

[Source: tech-spec-smart-file-search-browser-tool.md — Task 4]
"""
import asyncio
import logging
import platform
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 10.0
HEALTH_CACHE_TTL_S = 60.0
HEALTH_NEGATIVE_CACHE_TTL_S = 5.0  # Shorter TTL for failures so recovery is fast
PINCHTAB_STARTUP_TIMEOUT_S = 10.0
PINCHTAB_HEALTH_POLL_INTERVAL_S = 0.5
PINCHTAB_DOWNLOAD_TIMEOUT_S = 120.0

# Pinned to a tested release — never pull "latest" at runtime to avoid breakage.
# Bump this version explicitly after testing a new PinchTab release.
PINCHTAB_PINNED_VERSION = "v0.8.2"
PINCHTAB_GITHUB_REPO = "pinchtab/pinchtab"


def _find_pinchtab_binary() -> str | None:
    """Locate the PinchTab binary in expected locations.

    Search order:
    1. ~/.contop/bin/pinchtab[.exe]    (user-installed)
    2. Alongside contop-server/        (bundled with server)
    3. System PATH                     (global install)
    """
    binary_name = "pinchtab.exe" if sys.platform == "win32" else "pinchtab"

    # 1. ~/.contop/bin/
    contop_bin = Path.home() / ".contop" / "bin" / binary_name
    if contop_bin.is_file():
        return str(contop_bin)

    # 2. Bundled alongside the server package
    server_dir = Path(__file__).resolve().parent.parent
    bundled = server_dir / binary_name
    if bundled.is_file():
        return str(bundled)

    # 3. System PATH
    on_path = shutil.which("pinchtab")
    if on_path:
        return on_path

    return None


def _get_platform_asset_name() -> str | None:
    """Return the PinchTab release asset name for the current platform.

    Maps sys.platform + platform.machine() to the GitHub release asset naming
    convention: pinchtab-{os}-{arch}[.exe]
    """
    os_name = {
        "win32": "windows",
        "linux": "linux",
        "darwin": "darwin",
    }.get(sys.platform)
    if not os_name:
        return None

    machine = platform.machine().lower()
    arch = {
        "x86_64": "amd64",
        "amd64": "amd64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }.get(machine)
    if not arch:
        return None

    ext = ".exe" if sys.platform == "win32" else ""
    return f"pinchtab-{os_name}-{arch}{ext}"


async def _download_pinchtab_binary() -> str | None:
    """Download the pinned PinchTab release from GitHub.

    Uses PINCHTAB_PINNED_VERSION — never queries /releases/latest.
    Saves to ~/.contop/bin/pinchtab[.exe] and makes it executable.
    Returns the path on success, None on failure.
    """
    asset_name = _get_platform_asset_name()
    if not asset_name:
        logger.warning(
            "No PinchTab binary available for this platform: %s/%s",
            sys.platform, platform.machine(),
        )
        return None

    binary_name = "pinchtab.exe" if sys.platform == "win32" else "pinchtab"
    install_dir = Path.home() / ".contop" / "bin"
    install_path = install_dir / binary_name

    download_url = (
        f"https://github.com/{PINCHTAB_GITHUB_REPO}/releases/download/"
        f"{PINCHTAB_PINNED_VERSION}/{asset_name}"
    )

    async with httpx.AsyncClient(
        timeout=PINCHTAB_DOWNLOAD_TIMEOUT_S, follow_redirects=True
    ) as dl_client:
        try:
            logger.info(
                "Downloading PinchTab %s (%s)...",
                PINCHTAB_PINNED_VERSION, asset_name,
            )
            resp = await dl_client.get(download_url)
            resp.raise_for_status()
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.error("Failed to download PinchTab from %s: %s", download_url, exc)
            return None

        try:
            install_dir.mkdir(parents=True, exist_ok=True)
            install_path.write_bytes(resp.content)

            # Make executable on Unix
            if sys.platform != "win32":
                install_path.chmod(
                    install_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
                )

            logger.info("PinchTab %s installed to %s", PINCHTAB_PINNED_VERSION, install_path)
            return str(install_path)
        except OSError as exc:
            logger.error("Failed to save PinchTab binary: %s", exc)
            return None


async def ensure_pinchtab_installed() -> str | None:
    """Ensure PinchTab binary is available on disk. Downloads if missing.

    Called at server startup so the binary is ready before any tool call.
    Returns the binary path, or None if unavailable.
    """
    binary = _find_pinchtab_binary()
    if binary:
        logger.info("PinchTab binary found: %s", binary)
        return binary

    logger.info("PinchTab not found locally — downloading %s...", PINCHTAB_PINNED_VERSION)
    return await _download_pinchtab_binary()


class BrowserAutomation:
    """Async HTTP client for the PinchTab browser automation REST API.

    Manages the PinchTab process lifecycle: auto-starts on first use,
    terminates on close().
    """

    def __init__(self, base_url: str = "http://127.0.0.1:9867") -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=REQUEST_TIMEOUT_S,
        )
        self._cached_instance_id: str | None = None
        self._health_cache: tuple[bool, float] | None = None  # (result, timestamp)
        self._process: subprocess.Popen | None = None  # Managed PinchTab process

    async def health_check(self) -> bool:
        """Check if PinchTab is running. Caches success for 60s, failure for 5s."""
        if self._health_cache is not None:
            cached_result, cached_time = self._health_cache
            ttl = HEALTH_CACHE_TTL_S if cached_result else HEALTH_NEGATIVE_CACHE_TTL_S
            if time.monotonic() - cached_time < ttl:
                return cached_result

        try:
            resp = await self._client.get("/instances")
            is_healthy = resp.status_code == 200
            self._health_cache = (is_healthy, time.monotonic())
            return is_healthy
        except (httpx.ConnectError, httpx.TimeoutException, OSError):
            self._health_cache = (False, time.monotonic())
            return False

    async def ensure_running(self) -> bool:
        """Ensure PinchTab is running, auto-starting if the binary is found.

        Returns True if PinchTab is responsive, False if it could not be started.
        """
        if await self.health_check():
            return True

        # If we already have a managed process that's still alive, wait for it
        if self._process is not None and self._process.poll() is None:
            return await self._wait_for_healthy()

        # Find the binary (should already be downloaded at server startup)
        binary = _find_pinchtab_binary()
        if not binary:
            logger.warning(
                "PinchTab binary not found. It should have been downloaded at "
                "server startup. Searched: ~/.contop/bin/, server directory, PATH."
            )
            return False

        logger.info("Auto-starting PinchTab from: %s", binary)
        try:
            kwargs: dict[str, Any] = {}
            if sys.platform == "win32":
                kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            self._process = subprocess.Popen(
                [binary, "server"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **kwargs,
            )
        except OSError as exc:
            logger.error("Failed to start PinchTab: %s", exc)
            return False

        # Invalidate health cache so we poll fresh
        self._health_cache = None
        return await self._wait_for_healthy()

    async def _wait_for_healthy(self) -> bool:
        """Poll health check until PinchTab responds or timeout."""
        deadline = time.monotonic() + PINCHTAB_STARTUP_TIMEOUT_S
        while time.monotonic() < deadline:
            self._health_cache = None  # Force fresh check each poll
            if await self.health_check():
                logger.info("PinchTab is now running (pid=%s)", getattr(self._process, "pid", "?"))
                return True
            await asyncio.sleep(PINCHTAB_HEALTH_POLL_INTERVAL_S)
        logger.error("PinchTab failed to become healthy within %ds", PINCHTAB_STARTUP_TIMEOUT_S)
        return False

    async def launch_instance(
        self, name: str = "contop", mode: str = "headless"
    ) -> dict[str, Any]:
        """Launch a new browser instance via POST /instances/launch."""
        try:
            resp = await self._client.post(
                "/instances/launch",
                json={"name": name, "mode": mode},
            )
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.error("Failed to launch PinchTab instance: %s", exc)
            return {"status": "error", "description": str(exc)}

    async def get_or_create_instance(self, visible: bool = False) -> str:
        """Return a running instance ID, preferring one named 'contop'.

        Caches the instance ID so subsequent calls skip the lookup.
        When visible=True, launches a headed browser (visible on desktop)
        instead of the default headless mode. A headed request bypasses
        the cache and always launches a new instance if no headed one exists.
        """
        # For headed requests, skip cache — the cached instance may be headless
        if not visible and self._cached_instance_id:
            return self._cached_instance_id

        target_name = "contop-visible" if visible else "contop"

        try:
            resp = await self._client.get("/instances")
            resp.raise_for_status()
            instances = resp.json()
            if isinstance(instances, list):
                # Prefer an instance matching the target name
                fallback_id = ""
                for inst in instances:
                    if not isinstance(inst, dict):
                        continue
                    inst_id = inst.get("id", "")
                    if not inst_id:
                        continue
                    profile = inst.get("profileName", inst.get("name", ""))
                    if profile == target_name:
                        self._cached_instance_id = inst_id
                        logger.info("Reusing '%s' PinchTab instance: %s", target_name, inst_id)
                        return inst_id
                    if inst.get("status") == "running" and not fallback_id:
                        fallback_id = inst_id
                # For headless, fall back to any running instance
                if not visible and fallback_id:
                    self._cached_instance_id = fallback_id
                    logger.info("Reusing existing PinchTab instance: %s", fallback_id)
                    return fallback_id
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.warning("Failed to list PinchTab instances: %s", exc)

        # No matching instance found — launch a new one
        mode = "headed" if visible else "headless"
        result = await self.launch_instance(name=target_name, mode=mode)
        instance_id = result.get("id", "")
        if instance_id:
            await self._wait_for_instance_ready(instance_id)
            self._cached_instance_id = instance_id
            logger.info("Launched new PinchTab instance (%s): %s", mode, instance_id)
        return instance_id

    async def _wait_for_instance_ready(self, instance_id: str) -> None:
        """Poll until a newly launched instance reaches 'running' status."""
        deadline = time.monotonic() + PINCHTAB_STARTUP_TIMEOUT_S
        while time.monotonic() < deadline:
            try:
                resp = await self._client.get("/instances")
                resp.raise_for_status()
                for inst in resp.json():
                    if isinstance(inst, dict) and inst.get("id") == instance_id:
                        if inst.get("status") == "running":
                            return
                        break
            except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException):
                pass
            await asyncio.sleep(PINCHTAB_HEALTH_POLL_INTERVAL_S)
        logger.warning("Instance %s did not reach 'running' within timeout", instance_id)

    def invalidate_instance(self) -> None:
        """Clear the cached instance ID, forcing a fresh lookup on next call."""
        self._cached_instance_id = None

    async def connect_to_cdp(self, cdp_url: str) -> dict:
        """Connect to an external CDP endpoint (e.g. Electron app with --remote-debugging-port).

        Args:
            cdp_url: The CDP endpoint URL (e.g. 'http://localhost:9222')

        Returns:
            dict with status, instance_id, description.
        """
        # Security: only allow localhost CDP connections to prevent SSRF
        from urllib.parse import urlparse
        parsed = urlparse(cdp_url)
        allowed_hosts = {"localhost", "127.0.0.1", "::1", "[::1]"}
        if parsed.hostname not in allowed_hosts:
            return {
                "status": "error",
                "description": f"CDP connections are only allowed to localhost. Got host: {parsed.hostname}",
            }
        if parsed.scheme and parsed.scheme.lower() not in ("http", "https", "ws", "wss"):
            return {
                "status": "error",
                "description": f"CDP URL scheme '{parsed.scheme}' is not allowed.",
            }

        if not await self.ensure_running():
            return {"status": "error", "description": "PinchTab is not running."}

        try:
            resp = await self._client.post(
                "/instances/connect",
                json={"cdpUrl": cdp_url},
            )
            resp.raise_for_status()
            data = resp.json()
            instance_id = data.get("id", "")
            if instance_id:
                self._cached_instance_id = instance_id
            return {
                "status": "success",
                "instance_id": instance_id,
                "description": f"Connected to CDP at {cdp_url}",
            }
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return {
                    "status": "error",
                    "description": "PinchTab does not support external CDP connections. This version cannot connect to Electron apps.",
                }
            return {"status": "error", "description": f"Failed to connect: {exc}"}
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            return {"status": "error", "description": f"Connection failed: {exc}"}

    async def open_tab(self, instance_id: str, url: str) -> str:
        """Open a new tab in the given instance. Returns tab ID."""
        try:
            resp = await self._client.post(
                f"/instances/{instance_id}/tabs/open",
                json={"url": url},
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("tabId", data.get("tab_id", ""))
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.error("Failed to open tab: %s", exc)
            return ""

    async def snapshot(
        self, tab_id: str, interactive_only: bool = True
    ) -> dict[str, Any]:
        """Get page DOM structure and interactive elements."""
        try:
            params = {"filter": "interactive"} if interactive_only else {}
            resp = await self._client.get(
                f"/tabs/{tab_id}/snapshot",
                params=params,
            )
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.error("Failed to take snapshot: %s", exc)
            return {"status": "error", "description": str(exc)}

    async def action(
        self,
        tab_id: str,
        kind: str,
        ref: str = "",
        value: str = "",
        key: str = "",
    ) -> dict[str, Any]:
        """Perform an action on a tab (click, fill, press, navigate).

        PinchTab uses different payload fields per action kind:
        - click: {"kind": "click", "ref": "eN"}
        - fill:  {"kind": "fill", "ref": "eN", "value": "text"}
        - press: {"kind": "press", "ref": "eN", "key": "Enter"}
        - navigate: {"kind": "navigate", "value": "https://..."}
        """
        payload: dict[str, str] = {"kind": kind}
        if ref:
            payload["ref"] = ref
        if value:
            payload["value"] = value
        if key:
            payload["key"] = key

        try:
            resp = await self._client.post(
                f"/tabs/{tab_id}/action",
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.error("Failed to perform action %s: %s", kind, exc)
            return {"status": "error", "description": str(exc)}

    async def close_tab(self, tab_id: str) -> dict[str, Any]:
        """Close a browser tab via POST /tabs/{tabId}/action with kind=close."""
        try:
            resp = await self._client.post(
                f"/tabs/{tab_id}/action",
                json={"kind": "close"},
            )
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.error("Failed to close tab %s: %s", tab_id, exc)
            return {"status": "error", "description": str(exc)}

    async def extract_text(self, tab_id: str) -> str:
        """Extract page text by taking a full snapshot and returning node names.

        PinchTab v0.8.2 does not have a dedicated 'text' action kind.
        Instead, we take a non-interactive snapshot (all nodes) and
        concatenate the text content from the accessibility tree.
        """
        snapshot = await self.snapshot(tab_id, interactive_only=False)
        if isinstance(snapshot, dict) and snapshot.get("status") == "error":
            return ""
        # Build text from snapshot nodes — each node has a 'name' field with text
        nodes = snapshot.get("nodes", [])
        title = snapshot.get("title", "")
        lines: list[str] = []
        if title:
            lines.append(title)
        for node in nodes:
            name = node.get("name", "").strip()
            if name and name != title:
                lines.append(name)
        return "\n".join(lines)

    async def close(self) -> None:
        """Close the HTTP client and terminate any managed PinchTab process."""
        await self._client.aclose()
        if self._process is not None and self._process.poll() is None:
            logger.info("Terminating managed PinchTab process (pid=%d)", self._process.pid)
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None
