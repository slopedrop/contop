"""
Device control tool — handles lock_screen and keep_awake actions.
Bypasses the Dual-Tool Evaluator — direct device operations.
[Source: project-context.md — Mandatory Dual-Tool Gate exception]
"""
import asyncio
import logging
import platform
import subprocess
from typing import Any

logger = logging.getLogger(__name__)

_keep_awake_process: "asyncio.subprocess.Process | None" = None

# Windows SetThreadExecutionState flags
_ES_CONTINUOUS = 0x80000000
_ES_SYSTEM_REQUIRED = 0x00000001
_ES_DISPLAY_REQUIRED = 0x00000002


def _win_set_execution_state(flags: int) -> bool:
    """Call SetThreadExecutionState with proper ctypes types. Returns True on success."""
    import ctypes
    kernel32 = ctypes.windll.kernel32
    kernel32.SetThreadExecutionState.argtypes = [ctypes.c_uint]
    kernel32.SetThreadExecutionState.restype = ctypes.c_uint
    result = kernel32.SetThreadExecutionState(flags)
    return result != 0


def _persist_keep_awake(enabled: bool) -> None:
    """Save keep_host_awake state to ~/.contop/settings.json."""
    try:
        import copy
        from core.settings import get_settings, save_settings
        current = get_settings()
        if current.get("keep_host_awake") != enabled:
            updated = copy.deepcopy(current)
            updated["keep_host_awake"] = enabled
            save_settings(updated)
            logger.info("Persisted keep_host_awake=%s to settings", enabled)
    except Exception:
        logger.warning("Failed to persist keep_host_awake setting", exc_info=True)


async def handle_device_control(action: str) -> dict[str, Any]:
    """Route and execute a device control action. Never raises."""
    try:
        if action == "lock_screen":
            return await _lock_screen()
        elif action == "keep_awake_on":
            return await _keep_awake_on()
        elif action == "keep_awake_off":
            return await _keep_awake_off()
        else:
            return {
                "action": action,
                "status": "error",
                "message": f"Unknown action: {action}",
                "voice_message": f"I don't recognize the device control action '{action}'.",
            }
    except Exception as exc:
        logger.exception("device_control failed: action=%s", action)
        return {
            "action": action,
            "status": "error",
            "message": str(exc),
            "voice_message": "Device control failed. Please try again.",
        }


async def _lock_screen() -> dict[str, Any]:
    system = platform.system()
    if system == "Windows":
        cmd = ["rundll32.exe", "user32.dll,LockWorkStation"]
    elif system == "Darwin":
        cmd = ["pmset", "displaysleepnow"]
    else:
        cmd = ["loginctl", "lock-session"]
    await asyncio.to_thread(subprocess.run, cmd, check=True, timeout=5)
    return {"action": "lock_screen", "status": "success",
            "message": "Screen locked.", "voice_message": "Screen locked."}


async def _keep_awake_on(*, persist: bool = True) -> dict[str, Any]:
    global _keep_awake_process
    await _keep_awake_off_internal()
    system = platform.system()
    if system == "Windows":
        # CRITICAL: Call directly on the event loop thread — NOT via asyncio.to_thread.
        # SetThreadExecutionState is thread-local on Windows. If ON runs on thread pool
        # worker A and OFF runs on worker B, OFF clears B's state (never set) while
        # A's state stays active. Both calls must happen on the same thread.
        flags = _ES_CONTINUOUS | _ES_SYSTEM_REQUIRED | _ES_DISPLAY_REQUIRED
        ok = _win_set_execution_state(flags)
        if not ok:
            logger.error("SetThreadExecutionState failed (returned 0)")
            return {
                "action": "keep_awake_on",
                "status": "error",
                "message": "SetThreadExecutionState failed.",
                "voice_message": "Keep awake failed to start on Windows.",
            }
        logger.info("Windows keep-awake enabled via SetThreadExecutionState")
    elif system == "Darwin":
        _keep_awake_process = await asyncio.create_subprocess_exec(
            "caffeinate", "-d",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
    else:
        _keep_awake_process = await asyncio.create_subprocess_exec(
            "systemd-inhibit", "--what=sleep:idle", "--who=contop",
            "--why=Contop keep-awake active", "--mode=block", "sleep", "infinity",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
    # Detect immediate startup failure (e.g. binary not found or permission error)
    if _keep_awake_process is not None and _keep_awake_process.returncode is not None:
        _keep_awake_process = None
        return {
            "action": "keep_awake_on",
            "status": "error",
            "message": "Keep-awake process exited immediately.",
            "voice_message": "Keep awake failed to start.",
        }
    if persist:
        _persist_keep_awake(True)
    return {"action": "keep_awake_on", "status": "success",
            "message": "Keep-awake enabled. Host will not sleep.",
            "voice_message": "Keep awake enabled."}


async def _keep_awake_off() -> dict[str, Any]:
    """Turn off keep-awake and persist the setting."""
    await _keep_awake_off_internal()
    _persist_keep_awake(False)
    return {"action": "keep_awake_off", "status": "success",
            "message": "Keep-awake disabled. Normal sleep behavior restored.",
            "voice_message": "Keep awake disabled."}


async def _keep_awake_off_internal() -> None:
    """Turn off keep-awake without persisting (used internally and on startup reset)."""
    global _keep_awake_process
    system = platform.system()
    if system == "Windows":
        # Must run on the same thread as _keep_awake_on (event loop thread).
        # See comment in _keep_awake_on for why asyncio.to_thread is forbidden here.
        _win_set_execution_state(_ES_CONTINUOUS)
        _keep_awake_process = None
    else:
        if _keep_awake_process is not None:
            try:
                _keep_awake_process.terminate()
                await asyncio.wait_for(_keep_awake_process.wait(), timeout=3.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                pass
            _keep_awake_process = None


async def apply_keep_awake_from_settings() -> None:
    """Apply keep_host_awake setting on server startup. Called from lifespan."""
    try:
        from core.settings import get_settings
        if get_settings().get("keep_host_awake", False):
            result = await _keep_awake_on(persist=False)
            if result["status"] == "success":
                logger.info("Keep-awake restored from settings on startup")
            else:
                logger.warning("Failed to restore keep-awake on startup: %s", result["message"])
    except Exception:
        logger.warning("Failed to apply keep_host_awake from settings", exc_info=True)
