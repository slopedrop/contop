"""
ADK FunctionTool wrappers for the execution agent.

Provides three tools:
- execute_cli: Run CLI commands via HostSubprocess
- execute_gui: GUI automation via GUIAutomation (with optional OmniParser element_id)
- observe_screen: Capture screen as JPEG via mss (with optional OmniParser element detection)
"""
import asyncio
import base64
import io
import logging
import platform
import re
import threading
from typing import Callable, Literal, Optional

import mss
from PIL import Image

# Make the process DPI-aware on Windows so mss and pyautogui use the same
# physical-pixel coordinate system.  Without this, high-DPI displays cause
# mss.monitors to report logical dimensions while the captured image is at
# physical resolution, and pyautogui clicks land in the wrong position.
if platform.system() == "Windows":
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()  # fallback for older Windows
        except Exception:
            pass

from tools.browser_automation import BrowserAutomation
from tools.docker_sandbox import DockerSandbox
from tools.gui_automation import GUIAutomation
from tools.host_subprocess import HostSubprocess

_gui_automation = GUIAutomation()
from tools.omniparser_client import get_omniparser, ParseResult
from tools.ui_automation import UIAutomation

logger = logging.getLogger(__name__)

# Known Windows GUI applications — if the agent tries to run one of these
# directly, we auto-wrap to detach the process so the subprocess returns
# immediately instead of blocking.  Uses ``&`` (Git Bash) or ``start ""`` (cmd.exe fallback).
_GUI_APPS = (
    "notepad", "calc", "mspaint", "explorer", "write", "wordpad", "charmap",
    "snippingtool", "mstsc", "regedit", "winword", "excel", "powerpnt",
    "outlook", "devenv", "code", "msedge", "firefox", "chrome",
)
_GUI_APP_RE = re.compile(
    r"^(?:\"[^\"]*[/\\])?"                    # optional quoted path prefix
    r"(?:(?:C:[/\\])?(?:[^\s/\\]+[/\\])*)?"   # optional unquoted path prefix
    r"(" + "|".join(_GUI_APPS) + r")"
    r"(?:\.exe)?\b",
    re.IGNORECASE,
)


def _maybe_wrap_gui_launch(command: str) -> str:
    """Wrap bare GUI app invocations to detach on Windows.

    Uses Git Bash background operator (``&``) when available,
    or cmd.exe ``start ""`` as fallback.
    """
    stripped = command.strip()

    from tools.host_subprocess import _discover_bash
    using_bash = _discover_bash() is not None

    if using_bash:
        # Bash: already backgrounded?
        if stripped.endswith("&"):
            return command
        if _GUI_APP_RE.match(stripped):
            return f"{stripped} &"
        return command
    else:
        # cmd.exe: original start wrapping
        if re.match(r"^\s*start\s", stripped, re.IGNORECASE):
            if not re.match(r'^\s*start\s+""', stripped, re.IGNORECASE):
                return re.sub(r"^(\s*start)\s", r'\1 "" ', stripped, count=1, flags=re.IGNORECASE)
            return command
        if _GUI_APP_RE.match(stripped):
            return f'start "" {stripped}'
        return command


MAX_CAPTURE_WIDTH = 1280

# Thread-local mss instance for observe_screen (mss GDI handles are thread-local on Windows)
_thread_local = threading.local()

# Cache of the latest OmniParser results so execute_gui can resolve element_ids.
# Protected by _parse_lock to avoid data races between concurrent observe_screen
# and execute_gui calls.
_parse_lock = threading.Lock()
_latest_parse_result: ParseResult | None = None
# Capture dimensions for element_id coordinate conversion
_latest_capture_size: tuple[int, int] = (1280, 720)

# Cached screen dimensions to avoid a full screenshot grab on every execute_gui call.
# Updated on each observe_screen capture; used by execute_gui for scale computation.
_cached_screen_size: tuple[int, int] | None = None

# Optional callback for sending status messages to mobile during long operations
# Set by ExecutionAgent before calling run_intent, cleared after.
_status_callback: Callable[[str, dict], None] | None = None

# Callback to retrieve action history from ExecutionAgent for undo capability.
# Set by ExecutionAgent.run_intent() before running the agent.
_action_history_ref: Callable[[int], tuple[list[dict], int]] | None = None

# Session-scoped working directory for execute_cli.  Files created in one
# tool call persist for subsequent calls within the same session.
# Managed by ExecutionAgent — set on session start, cleared on reset.
_session_cwd: str | None = None

# Session-scoped CU client so history persists across execute_computer_use calls.
# Without this, each call creates a fresh client and CU re-discovers the screen.
_cu_client: object | None = None  # GeminiComputerUseClient (lazy import)

# Callback for sending CU sub-step progress to mobile.
# Set by ExecutionAgent._before_tool_callback when execute_computer_use runs.
# Signature: (detail: str, status: str) -> None
_cu_progress_callback: Callable[[str, str], None] | None = None

# L4: Cached vision grounding client instances keyed by model slug.
_vision_clients: dict[str, object] = {}  # model_slug -> vision client (UI-TARS, OmniParser, Gemini CU, Accessibility, Kimi, Qwen, Phi, Molmo, Holotron)

# Active vision backend name (e.g. 'ui_tars', 'kimi_vision', 'qwen_vision').
# Set by ExecutionAgent.run_intent() before each intent.
_active_vision_backend: str = "ui_tars"

# --- Vision mode system prompts ---
# Grounding prompt: single source of truth lives in vision_client.py
from tools.vision_client import DEFAULT_GROUNDING_SYSTEM_PROMPT as _VISION_PROMPT_GROUNDING

_VISION_PROMPT_UNDERSTANDING = (
    "You are a screen analysis model. Given a screenshot, describe ONLY what you "
    "can actually see in the image. Focus on: which application is open, what content "
    "is visible, the current state of the UI (dialogs, notifications, confirmations, "
    "error messages), and any text you can read. "
    "IMPORTANT: If the user's question mentions things that are NOT visible in the "
    "screenshot, say so explicitly — do NOT confirm or elaborate on content you cannot see. "
    "Never hallucinate or invent content. Only describe what IS on screen."
)

_GROUNDING_DEFAULT_INSTRUCTION = (
    "Identify all interactive UI elements on this screen with their coordinates. "
    "Clearly distinguish the browser address bar from in-page search inputs."
)

_UNDERSTANDING_DEFAULT_INSTRUCTION = "Describe what you see on this screen."

# Session-scoped PinchTab browser client and active tab for execute_browser.
_browser_client: BrowserAutomation | None = None
_active_tab_id: str | None = None


def set_status_callback(fn: Callable[[str, dict], None] | None) -> None:
    """Set the callback for sending status messages during tool execution."""
    global _status_callback
    _status_callback = fn
    # Also wire up DockerSandbox so it can notify mobile during auto-start
    DockerSandbox.set_status_callback(fn)


def set_vision_backend(backend: str) -> None:
    """Set the active vision grounding backend for observe_screen."""
    global _active_vision_backend
    _active_vision_backend = backend


def set_action_history_ref(fn: Callable[[int], tuple[list[dict], int]] | None) -> None:
    """Set the callback for retrieving action history from ExecutionAgent."""
    global _action_history_ref
    _action_history_ref = fn


def set_session_cwd(path: str | None) -> None:
    """Set the session-scoped working directory for execute_cli."""
    global _session_cwd
    _session_cwd = path


def reset_cu_client() -> None:
    """Clear the session-scoped CU client (called on session reset)."""
    global _cu_client
    _cu_client = None


def set_cu_progress_callback(fn: Callable[[str, str], None] | None) -> None:
    """Set the callback for sending CU sub-step progress to mobile."""
    global _cu_progress_callback
    _cu_progress_callback = fn


def _get_sct() -> mss.mss:
    """Return the mss instance for the current thread, creating one if needed."""
    if not hasattr(_thread_local, "sct"):
        _thread_local.sct = mss.mss()
    return _thread_local.sct


def _capture_screen_sync() -> tuple[str, int, int, int, int]:
    """Capture primary display and return (base64 JPEG, capture_w, capture_h, native_w, native_h)."""
    sct = _get_sct()
    monitor = sct.monitors[1]
    shot = sct.grab(monitor)
    img = Image.frombytes("RGB", (shot.width, shot.height), shot.rgb)

    # grab() always returns physical pixels — this is the true native resolution
    native_w = shot.width
    native_h = shot.height

    logger.info(
        "Screen capture: native=%dx%d, monitor=%dx%d",
        native_w, native_h, monitor["width"], monitor["height"],
    )

    # Downscale if needed for the LLM (saves tokens / fits context)
    if native_w > MAX_CAPTURE_WIDTH:
        ratio = MAX_CAPTURE_WIDTH / native_w
        new_w = MAX_CAPTURE_WIDTH
        new_h = int(native_h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    else:
        new_w = img.width
        new_h = img.height

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode("ascii"), new_w, new_h, native_w, native_h


async def execute_cli(command: str) -> dict:
    """Run a command-line command on the host machine.

    Args:
        command: The shell command to execute.

    Returns:
        dict with status, stdout, stderr, exit_code, duration_ms.
    """
    # On Windows, auto-wrap GUI app launches with `start ""` so they
    # detach immediately instead of blocking the subprocess.
    if platform.system() == "Windows":
        command = _maybe_wrap_gui_launch(command)

    from tools.host_subprocess import _redact_for_log
    logger.info("execute_cli called: %s", _redact_for_log(command))
    try:
        result = await HostSubprocess().run(command, cwd=_session_cwd, auto_confirm=True)

        # For GUI app launches (via `&` in bash or `start` in cmd.exe),
        # stdout is empty because the app detaches.  Add a confirmation
        # so the model trusts the result.
        stripped_cmd = command.rstrip()
        is_gui_launch = (
            re.match(r'^\s*start\s', command, re.IGNORECASE)
            or (stripped_cmd.endswith("&") and _GUI_APP_RE.match(stripped_cmd.rstrip("& ")))
        )
        if (
            result.get("status") == "success"
            and not result.get("stdout", "").strip()
            and is_gui_launch
        ):
            result["stdout"] = "Application launched successfully (exit code 0). The app is now running."

        return result
    except Exception as exc:
        logger.exception("execute_cli failed for command: %s", command[:80])
        return {
            "status": "error",
            "stdout": "",
            "stderr": str(exc),
            "exit_code": -1,
            "duration_ms": 0,
        }


async def execute_cli_sandboxed(command: str) -> dict:
    """Run a command inside a Docker sandbox (or restricted fallback).

    Delegates to DockerSandbox.run(). The return dict shape matches
    execute_cli / HostSubprocess exactly.

    Args:
        command: The shell command to execute in the sandbox.

    Returns:
        dict with status, stdout, stderr, exit_code, duration_ms.
    """
    from tools.host_subprocess import _redact_for_log
    logger.info("execute_cli_sandboxed called: %s", _redact_for_log(command))
    try:
        return await DockerSandbox().run(command)
    except Exception as exc:
        logger.exception("execute_cli_sandboxed failed for command: %s", command[:80])
        return {
            "status": "error",
            "stdout": "",
            "stderr": str(exc),
            "exit_code": -1,
            "duration_ms": 0,
        }


async def execute_gui(action: str, target: str, coordinates: dict) -> dict:
    """Perform a GUI automation action on the host machine.

    Args:
        action: The action type (click, double_click, right_click, type,
                scroll, hotkey, press_key, move_mouse, drag).
        target: Description of the UI element to interact with.
        coordinates: Action-specific dict. Supports x/y, text, keys, direction,
                    etc. Also supports element_id to reference an OmniParser-
                    detected UI element by its ID number.

    Returns:
        dict with status, description, duration_ms.
    """
    logger.info("execute_gui called: %s on %s at %s", action, target, coordinates)
    try:
        # Compute scale factors from screen size and last capture size
        native_w, native_h = get_screen_size()
        with _parse_lock:
            cap_w, cap_h = _latest_capture_size
        if native_w != cap_w or native_h != cap_h:
            scale_x = native_w / cap_w
            scale_y = native_h / cap_h
        else:
            scale_x = 1.0
            scale_y = 1.0

        logger.info(
            "execute_gui scaling: native=(%d,%d), capture=(%d,%d), scale=(%.2f, %.2f)",
            native_w, native_h, cap_w, cap_h, scale_x, scale_y,
        )

        # Resolve element_id to x/y coordinates if provided
        resolved_coords = _resolve_element_id(coordinates)

        return await _gui_automation.run(action, target, resolved_coords, scale_x, scale_y)
    except Exception as exc:
        logger.exception("execute_gui failed for action: %s", action)
        return {
            "status": "error",
            "action": action,
            "target": target,
            "coordinates": coordinates,
            "description": str(exc),
            "duration_ms": 0,
            "voice_message": (
                f"I couldn't perform the {action}. {exc}. "
                "Should I try a different approach?"
            ),
        }


def _resolve_element_id(coordinates: dict) -> dict:
    """If coordinates contains element_id, resolve it to x/y using cached OmniParser results."""
    element_id = coordinates.get("element_id")
    if element_id is None:
        return coordinates

    with _parse_lock:
        parse_result = _latest_parse_result
        cap_w, cap_h = _latest_capture_size

    if parse_result is None:
        logger.warning("element_id %s requested but no OmniParser results cached", element_id)
        return coordinates

    try:
        element_id_int = int(element_id)
    except (ValueError, TypeError):
        logger.warning("Invalid element_id '%s' — must be numeric", element_id)
        return {
            **coordinates,
            "error": f"Invalid element_id '{element_id}' — must be a numeric ID from observe_screen results",
        }

    element = parse_result.get_element(element_id_int)
    if element is None:
        logger.warning("element_id %s not found in OmniParser results", element_id)
        return coordinates

    # OmniParser bbox is normalized (0-1). Convert to screenshot pixel coordinates.
    pixel_x = int(element.center_x * cap_w)
    pixel_y = int(element.center_y * cap_h)

    # Merge into coordinates (element_id takes precedence for x/y)
    resolved = dict(coordinates)
    resolved["x"] = pixel_x
    resolved["y"] = pixel_y
    resolved.pop("element_id", None)

    logger.info(
        "Resolved element_id %d (%s) → screenshot coords (%d, %d)",
        element_id_int, element.content[:40], pixel_x, pixel_y,
    )
    return resolved


def get_screen_size() -> tuple[int, int]:
    """Return primary monitor physical dimensions (width, height).

    Uses cached dimensions from the last observe_screen capture when available,
    falling back to a fresh mss grab only on the first call (before any capture).
    """
    global _cached_screen_size
    if _cached_screen_size is not None:
        return _cached_screen_size
    try:
        sct = _get_sct()
        monitor = sct.monitors[1]
        # grab() always returns physical pixels, unlike monitor dict which
        # may return logical pixels on high-DPI without DPI awareness
        shot = sct.grab(monitor)
        _cached_screen_size = (shot.width, shot.height)
        return _cached_screen_size
    except Exception:
        logger.warning("Could not detect screen size, using 1920x1080 default")
        return (1920, 1080)


async def observe_screen(
    mode: Literal["grounding", "understanding"] = "grounding",
    intent: str = "",
) -> dict:
    """Capture the screen and analyze it via a vision backend.

    Args:
        mode: Vision mode — "grounding" returns UI element coordinates for
            execute_gui; "understanding" returns a natural language description
            for verification and decision-making.
        intent: What you want to know — e.g. "find the submit button" (grounding)
            or "check if the PDF was sent" (understanding). When empty, a default
            instruction is used based on the mode.

    The screenshot is sent to the active vision backend (UI-TARS, Kimi, Qwen,
    OmniParser, etc.) which processes the image and returns text descriptions.
    The execution LLM receives only text — the image is NOT re-sent to it.

    As a last resort, if no vision backend is available, the raw screenshot is
    included so the execution LLM can interpret it directly (needs_llm_vision).

    Returns:
        dict with status, ui_elements text, and optionally image_b64 for
        mobile display or LLM fallback.
    """
    global _latest_parse_result, _latest_capture_size, _cached_screen_size

    if mode not in ("grounding", "understanding"):
        logger.warning("Unknown observe_screen mode %r, defaulting to grounding", mode)
        mode = "grounding"

    loop = asyncio.get_running_loop()
    try:
        jpeg_b64, cap_w, cap_h, nat_w, nat_h = await loop.run_in_executor(None, _capture_screen_sync)
        with _parse_lock:
            _latest_capture_size = (cap_w, cap_h)
        # Cache the native screen size (physical pixels) for execute_gui scaling
        _cached_screen_size = (nat_w, nat_h)
    except Exception as e:
        logger.exception("observe_screen capture failed")
        return {
            "status": "error",
            "error": str(e),
        }

    # --- Select system prompt and instruction based on mode ---
    logger.info("observe_screen called: mode=%s, intent=%r", mode, intent or "(default)")
    is_understanding = mode == "understanding"
    if is_understanding:
        vision_system_prompt = _VISION_PROMPT_UNDERSTANDING
        instruction = intent or _UNDERSTANDING_DEFAULT_INSTRUCTION
        annotate = False
    else:
        vision_system_prompt = _VISION_PROMPT_GROUNDING
        if intent:
            # Compose: custom intent + default disambiguation guidance
            instruction = f"{intent} {_GROUNDING_DEFAULT_INSTRUCTION}"
        else:
            instruction = _GROUNDING_DEFAULT_INSTRUCTION
        annotate = True

    logger.info("observe_screen routing: prompt=%s, instruction=%r, annotate_zones=%s",
                "understanding" if is_understanding else "grounding",
                instruction[:80] + "..." if len(instruction) > 80 else instruction,
                annotate)

    # --- Vision backend: send screenshot once, get text back ---
    # Try OpenRouter vision models (UI-TARS, Kimi, Qwen, Phi, Molmo, etc.)
    # "accessibility" is a mode, not a vision model — fall back to UI-TARS for vision
    from core.settings import get_openrouter_api_key
    from tools.vision_client import VisionClient, VISION_BACKEND_MODELS
    openrouter_key = get_openrouter_api_key()
    effective_backend = "ui_tars" if _active_vision_backend == "accessibility" else _active_vision_backend
    vision_model = VISION_BACKEND_MODELS.get(effective_backend)
    if openrouter_key and vision_model:
        try:
            global _vision_clients
            if vision_model not in _vision_clients:
                _vision_clients[vision_model] = VisionClient(openrouter_key, model=vision_model)
            client = _vision_clients[vision_model]
            tars_result = await client.ground(
                jpeg_b64,
                instruction,
                capture_size=(cap_w, cap_h),
                system_prompt=vision_system_prompt,
                annotate_zones=annotate,
            )
            if tars_result and tars_result.get("description"):
                full_desc = tars_result["description"]
                logger.info("%s %s succeeded — full response (%d chars):\n%s", _active_vision_backend, mode, len(full_desc), full_desc)
                with _parse_lock:
                    _latest_parse_result = None
                return {
                    "status": "success",
                    # image_b64 for mobile display only — stripped before LLM sees it
                    "image_b64": jpeg_b64,
                    "ui_elements": tars_result["description"],
                    "actual_backend": effective_backend,
                }
        except Exception:
            logger.warning("%s failed, falling back", _active_vision_backend, exc_info=True)
            if _status_callback:
                try:
                    _status_callback("agent_status", {
                        "type": "vision_fallback",
                        "message": f"Vision: {_active_vision_backend} failed → falling back",
                    })
                except Exception:
                    pass

    # Try OmniParser (only for 'omniparser' backend)
    if _active_vision_backend == "omniparser":
        if is_understanding:
            # OmniParser can't answer understanding questions — LLM fallback
            with _parse_lock:
                _latest_parse_result = None
            logger.info("Understanding mode + omniparser — sending to LLM")
            return {
                "status": "success",
                "image_b64": jpeg_b64,
                "needs_llm_vision": True,
                "intent": intent,
                "actual_backend": "llm_vision",
            }

        omni = get_omniparser()

        # If OmniParser models are still loading, send a status update to mobile
        loading_status = omni.get_loading_status()
        if loading_status and _status_callback:
            try:
                _status_callback("agent_status", {
                    "type": "omniparser_loading",
                    "message": loading_status,
                })
            except Exception:
                pass

        parse_result = await omni.parse(jpeg_b64)

        if parse_result and parse_result.elements:
            with _parse_lock:
                _latest_parse_result = parse_result
            return {
                "status": "success",
                # Raw screenshot for mobile display — stripped before LLM sees it
                "image_b64": jpeg_b64,
                "ui_elements": parse_result.describe_elements(),
                "actual_backend": "omniparser",
            }

    # Last resort: no vision backend processed the image.
    # Send the raw screenshot to the execution LLM as a fallback.
    with _parse_lock:
        _latest_parse_result = None
    logger.warning("No vision backend available — sending raw screenshot to LLM")
    if _status_callback:
        try:
            _status_callback("agent_status", {
                "type": "vision_fallback",
                "message": f"Vision: all backends failed → raw screenshot sent to LLM",
            })
        except Exception:
            pass
    return {
        "status": "success",
        "image_b64": jpeg_b64,
        "needs_llm_vision": True,
        "intent": intent,
        "actual_backend": "llm_vision",
    }


async def wait(seconds: float) -> dict:
    """Wait for a specified number of seconds before proceeding.

    Use this after actions that trigger loading (e.g. navigating to a URL,
    clicking a link, opening an application) to give the page or app time
    to fully render before observing the screen or interacting with elements.

    Args:
        seconds: Number of seconds to wait (0.5 to 10). Values outside
                 this range are clamped.

    Returns:
        dict with status and the actual wait duration.
    """
    clamped = max(0.5, min(float(seconds), 10.0))
    logger.info("wait called: %.1f seconds (requested %.1f)", clamped, seconds)
    await asyncio.sleep(clamped)
    return {
        "status": "success",
        "waited_seconds": clamped,
    }


async def get_ui_context(max_depth: int = 8, window_title: Optional[str] = None) -> dict:
    """Get the current UI context: active window, focused element, and interactive elements.

    Returns the foreground window name, currently focused element details,
    and a list of interactive elements in the active window. Use this to
    understand the current UI state before performing keyboard-based actions.

    Args:
        max_depth: Maximum tree depth to walk (default 8). Increase for deeply
                   nested dialogs (Save As, Open, etc.). Decrease for faster
                   scans of simple windows.
        window_title: Optional — scan this window instead of the foreground window.
                      Pass the expected dialog/window title (e.g. "Save As", "Open")
                      when the target window may not yet be in the foreground.

    Returns:
        dict with foreground_window, focused_element, interactive_elements, element_count.
    """
    logger.info("get_ui_context called (max_depth=%d, window_title=%s)", max_depth, window_title)
    try:
        return await UIAutomation().get_context(max_depth=max_depth, window_title=window_title)
    except Exception as exc:
        logger.exception("get_ui_context failed")
        return {
            "status": "error",
            "foreground_window": "",
            "focused_element": {},
            "interactive_elements": [],
            "element_count": 0,
            "voice_message": f"Failed to get UI context: {exc}",
        }


async def maximize_active_window() -> dict:
    """Ensure the foreground window is maximized (fills the entire screen).

    Checks the current window state first — if already maximized this is a
    no-op. Never closes or minimizes any window. Use this after launching or
    focusing an app to keep the screen clutter-free for observe_screen.

    Returns:
        dict with status, was_maximized (prior state), and description.
    """
    import time as _time
    logger.info("maximize_active_window called")
    start = _time.monotonic()
    try:
        from platform_adapters import get_adapter
        adapter = get_adapter()
        was_maximized = await asyncio.get_running_loop().run_in_executor(
            None, adapter.is_window_maximized,
        )
        if was_maximized:
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success",
                "was_maximized": True,
                "description": "Window was already maximized — no action taken.",
                "duration_ms": duration_ms,
                "voice_message": "The window is already maximized.",
            }

        success = await asyncio.get_running_loop().run_in_executor(
            None, adapter.maximize_window,
        )
        duration_ms = int((_time.monotonic() - start) * 1000)
        if success:
            return {
                "status": "success",
                "was_maximized": False,
                "description": "Window has been maximized.",
                "duration_ms": duration_ms,
                "voice_message": "I've maximized the window.",
            }
        return {
            "status": "error",
            "was_maximized": False,
            "description": "Could not maximize the window — platform API unavailable or failed.",
            "duration_ms": duration_ms,
            "voice_message": "I wasn't able to maximize the window. Should I try a different approach?",
        }
    except Exception as exc:
        logger.exception("maximize_active_window failed")
        return {
            "status": "error",
            "was_maximized": False,
            "description": str(exc),
            "duration_ms": 0,
            "voice_message": f"Failed to maximize: {exc}. Should I try manually?",
        }


async def get_action_history(last_n: int) -> dict:
    """Retrieve the most recent action history entries for undo analysis.

    Call this BEFORE attempting to undo an action. Returns structured data
    about the last N tool executions, including the tool name, arguments,
    result summary, and an undoable_hint suggesting a reversal strategy.

    Args:
        last_n: Number of recent actions to retrieve (1-50).

    Returns:
        dict with status, actions list, and total_count of all history entries.
    """
    logger.info("get_action_history called: last_n=%d", last_n)
    if _action_history_ref is None:
        return {"status": "success", "actions": [], "total_count": 0}
    clamped = max(1, min(last_n, 50))
    actions, total = _action_history_ref(clamped)
    return {
        "status": "success",
        "actions": actions,
        "total_count": total,
    }


async def execute_computer_use(instruction: str) -> dict:
    """Execute a GUI task using Gemini Computer Use API.

    Gemini CU analyses the screen and plans actions. Those actions are then
    executed through the *same* gui_automation pipeline used by OmniParser and
    UI-TARS, so there is a single execution path for all backends.

    Args:
        instruction: Natural language description of the GUI task to perform.

    Returns:
        dict with status, actions_taken, description, duration_ms.
    """
    import time as _time
    from tools.gemini_computer_use import GeminiComputerUseClient, resize_screenshot_for_cu, MAX_CU_STEPS

    logger.info("execute_computer_use called: %s", instruction[:80])
    start = _time.monotonic()

    try:
        from core.settings import get_gemini_api_key
        api_key = get_gemini_api_key()
        if not api_key:
            return {
                "status": "error",
                "description": "Gemini API key not configured.",
                "duration_ms": 0,
            }

        # Capture initial screenshot
        loop = asyncio.get_running_loop()
        jpeg_b64, cap_w, cap_h, nat_w, nat_h = await loop.run_in_executor(None, _capture_screen_sync)

        # Resize to CU recommended resolution
        cu_screenshot = resize_screenshot_for_cu(jpeg_b64)

        # Reuse session-scoped CU client so history persists across calls.
        # Without this, Flash calls CU multiple times and each starts fresh,
        # causing CU to re-discover screen state and waste API calls.
        global _cu_client
        if _cu_client is None:
            _cu_client = GeminiComputerUseClient(api_key=api_key, capture_size=(cap_w, cap_h))
            logger.info("Created new CU client for session")
        client = _cu_client
        client._capture_size = (cap_w, cap_h)

        all_actions = []
        # Multi-step CU loop: plan + execute until done or max steps
        for step in range(MAX_CU_STEPS):
            # Report sub-step progress to mobile so CU doesn't feel frozen
            if _cu_progress_callback:
                _cu_progress_callback(
                    f"CU step {step + 1}/{MAX_CU_STEPS}: capturing screen...",
                    "running",
                )

            if step == 0:
                screenshot = cu_screenshot
                # Prefix instruction with guidance to avoid unnecessary browser launches.
                # CU model is heavily browser-biased and will open Chrome by default
                # even for desktop tasks (e.g. editing a Notepad file).
                step_instruction = (
                    "You are controlling a desktop computer. Interact with the "
                    "applications currently visible on screen. Do NOT open a web "
                    "browser unless the task specifically requires web browsing.\n\n"
                    + instruction
                )
            else:
                # Capture fresh screenshot for subsequent steps
                step_instruction = None
                try:
                    jpeg_b64, cap_w, cap_h, _, _ = await loop.run_in_executor(None, _capture_screen_sync)
                    screenshot = resize_screenshot_for_cu(jpeg_b64)
                    # Update capture size in case resolution changed
                    client._capture_size = (cap_w, cap_h)
                except Exception as exc:
                    logger.error("Screenshot capture failed on CU step %d: %s", step, exc)
                    duration_ms = int((_time.monotonic() - start) * 1000)
                    return {
                        "status": "error",
                        "actions_taken": all_actions,
                        "description": f"Screenshot capture failed on step {step}: {exc}",
                        "duration_ms": duration_ms,
                    }

            # Plan step — Gemini CU returns mapped actions, no execution
            if _cu_progress_callback:
                _cu_progress_callback(
                    f"CU step {step + 1}/{MAX_CU_STEPS}: planning actions...",
                    "running",
                )

            plan = await client.plan_step(
                screenshot_b64=screenshot,
                instruction=step_instruction,
            )

            if plan.status in ("done", "error", "confirmation_required"):
                duration_ms = int((_time.monotonic() - start) * 1000)
                return {
                    "status": plan.status,
                    "actions_taken": all_actions,
                    "description": plan.description,
                    "duration_ms": duration_ms,
                    "confirmation_request": plan.confirmation_request,
                }

            # Execute each planned action through our standard pipeline
            for i, planned in enumerate(plan.planned_actions):
                if _cu_progress_callback:
                    _cu_progress_callback(
                        f"CU step {step + 1}: {planned.action} → {planned.target}",
                        "running",
                    )

                if planned.action == "wait":
                    result = await wait(planned.coordinates.get("seconds", 5))
                elif planned.action == "cli":
                    result = await execute_cli(planned.coordinates.get("command", ""))
                else:
                    result = await execute_gui(
                        planned.action,
                        planned.target,
                        planned.coordinates,
                    )
                all_actions.append({
                    "cu_action": planned.cu_function_name,
                    "action": planned.action,
                    "target": planned.target,
                    "coordinates": planned.coordinates,
                    "result": result,
                })

        duration_ms = int((_time.monotonic() - start) * 1000)
        return {
            "status": "success",
            "actions_taken": all_actions,
            "description": f"Completed {len(all_actions)} actions over {MAX_CU_STEPS} steps.",
            "duration_ms": duration_ms,
        }

    except Exception as exc:
        logger.exception("execute_computer_use failed")
        duration_ms = int((_time.monotonic() - start) * 1000)
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": duration_ms,
        }


def set_browser_client(client: BrowserAutomation | None) -> None:
    """Set or clear the PinchTab browser client (for testing or session reset)."""
    global _browser_client, _active_tab_id
    _browser_client = client
    if client is None:
        _active_tab_id = None


async def execute_browser(action: str, url: str, params: dict) -> dict:
    """Interact with web pages programmatically via PinchTab browser automation.

    Use this for tasks that involve reading web content, filling forms, clicking
    links, or extracting text. Faster and more reliable than execute_gui for
    browser tasks that don't require visual verification.

    Workflow: call with action="snapshot" first to get element refs (eN format),
    then use those refs in click/fill/press actions.

    Args:
        action: The browser action to perform. One of: "navigate" (go to URL),
                "click" (click element by ref), "fill" (type into input by ref),
                "press" (press key on element), "extract_text" (get page text),
                "snapshot" (get page structure with element refs), "open_tab"
                (open new tab with URL), "close_tab" (close current tab).
        url: Target URL for navigate/open_tab actions. Empty string for others.
        params: Action-specific parameters. Examples:
                {"ref": "e5"} for click,
                {"ref": "e3", "value": "hello"} for fill,
                {"ref": "e2", "key": "Enter"} for press,
                {"visible": true} on navigate/open_tab to launch a headed
                (visible) browser instead of headless.

    Returns:
        dict with status, content (snapshot/text result), tab_id, duration_ms,
        voice_message.
    """
    import time as _time

    global _browser_client, _active_tab_id

    # Redact params for logging — fill actions may contain sensitive values
    safe_params = {k: ("***" if k == "value" else v) for k, v in params.items()} if params else {}
    logger.info("execute_browser called: action=%s url=%s params=%s", action, url, safe_params)
    start = _time.monotonic()

    # URL scheme validation — only allow http/https to prevent SSRF
    if url and action in ("navigate", "open_tab"):
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.scheme and parsed.scheme.lower() not in ("http", "https", ""):
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "error",
                "description": f"URL scheme '{parsed.scheme}' is not allowed. Only http:// and https:// URLs are supported.",
                "duration_ms": duration_ms,
                "voice_message": "That URL scheme isn't allowed for security reasons. Only HTTP and HTTPS URLs are supported.",
            }

    # Lazy-initialize the browser client
    if _browser_client is None:
        from core.settings import get_pinchtab_url
        _browser_client = BrowserAutomation(base_url=get_pinchtab_url())

    client = _browser_client

    # Ensure PinchTab is running — auto-starts the binary
    if not await client.ensure_running():
        duration_ms = int((_time.monotonic() - start) * 1000)
        return {
            "status": "error",
            "description": (
                "PinchTab could not be started. The binary may not have been "
                "downloaded at server startup (check server logs)."
            ),
            "duration_ms": duration_ms,
            "voice_message": "I couldn't start the browser automation tool. I'll fall back to GUI automation.",
        }

    try:
        # Ensure we have a browser instance (headed if visible requested)
        visible = bool(params.get("visible", False)) if params else False
        instance_id = await client.get_or_create_instance(visible=visible)
        if not instance_id:
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "error",
                "description": "Failed to get or create a PinchTab browser instance.",
                "duration_ms": duration_ms,
                "voice_message": "I couldn't start a browser instance.",
            }

        # Handle open_tab / navigate — both need a tab
        if action == "open_tab" or (action == "navigate" and _active_tab_id is None):
            tab_id = await client.open_tab(instance_id, url or "about:blank")
            if tab_id:
                _active_tab_id = tab_id
            else:
                duration_ms = int((_time.monotonic() - start) * 1000)
                return {
                    "status": "error",
                    "description": "Failed to open a browser tab.",
                    "duration_ms": duration_ms,
                    "voice_message": "I couldn't open a new browser tab.",
                }
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success",
                "content": f"Opened tab to {url}",
                "tab_id": _active_tab_id,
                "duration_ms": duration_ms,
            }

        if action == "navigate" and _active_tab_id:
            result = await client.action(_active_tab_id, kind="navigate", value=url)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success" if result.get("status") != "error" else "error",
                "content": result,
                "tab_id": _active_tab_id,
                "duration_ms": duration_ms,
            }

        # All remaining actions require an active tab
        if not _active_tab_id:
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "error",
                "description": "No active browser tab. Use action='navigate' or 'open_tab' with a URL first.",
                "duration_ms": duration_ms,
                "voice_message": "There's no browser tab open. Let me open one first.",
            }

        if action == "snapshot":
            interactive_only = params.get("interactive_only", True)
            result = await client.snapshot(_active_tab_id, interactive_only=interactive_only)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success" if result.get("status") != "error" else "error",
                "content": result,
                "tab_id": _active_tab_id,
                "duration_ms": duration_ms,
            }

        if action == "extract_text":
            text = await client.extract_text(_active_tab_id)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success",
                "content": text,
                "tab_id": _active_tab_id,
                "duration_ms": duration_ms,
            }

        if action == "click":
            ref = params.get("ref", "")
            result = await client.action(_active_tab_id, kind="click", ref=ref)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success" if result.get("status") != "error" else "error",
                "content": result,
                "tab_id": _active_tab_id,
                "duration_ms": duration_ms,
            }

        if action == "fill":
            ref = params.get("ref", "")
            value = params.get("value", "")
            result = await client.action(_active_tab_id, kind="fill", ref=ref, value=value)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success" if result.get("status") != "error" else "error",
                "content": result,
                "tab_id": _active_tab_id,
                "duration_ms": duration_ms,
            }

        if action == "press":
            ref = params.get("ref", "")
            key = params.get("key", "")
            result = await client.action(_active_tab_id, kind="press", ref=ref, key=key)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success" if result.get("status") != "error" else "error",
                "content": result,
                "tab_id": _active_tab_id,
                "duration_ms": duration_ms,
            }

        if action == "close_tab":
            tab_to_close = _active_tab_id
            _active_tab_id = None
            await client.close_tab(tab_to_close)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": "success",
                "content": "Tab closed.",
                "tab_id": "",
                "duration_ms": duration_ms,
            }

        if action == "connect_cdp":
            result = await client.connect_to_cdp(url)
            duration_ms = int((_time.monotonic() - start) * 1000)
            return {
                "status": result.get("status", "error"),
                "content": result,
                "duration_ms": duration_ms,
                "voice_message": result.get("description", ""),
            }

        duration_ms = int((_time.monotonic() - start) * 1000)
        return {
            "status": "error",
            "description": f"Unknown browser action: {action}. Valid actions: navigate, click, fill, press, extract_text, snapshot, open_tab, close_tab, connect_cdp.",
            "duration_ms": duration_ms,
        }

    except Exception as exc:
        logger.exception("execute_browser failed for action: %s", action)
        # Invalidate cached instance ID — PinchTab may have restarted
        if client:
            client.invalidate_instance()
        duration_ms = int((_time.monotonic() - start) * 1000)
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": duration_ms,
            "voice_message": f"Browser automation failed: {exc}. Should I try GUI automation instead?",
        }


async def execute_accessible(
    action: str,
    target: str,
    element_name: Optional[str] = None,
    automation_id: Optional[str] = None,
    control_type: Optional[str] = None,
    value: Optional[str] = None,
    window_title: Optional[str] = None,
) -> dict:
    """Interact with a UI element deterministically using the OS accessibility tree.

    Instead of clicking at pixel coordinates, this tool finds UI elements by their
    name, automation ID, or control type, and performs native actions on them.
    This is MORE RELIABLE than execute_gui for standard desktop applications.

    Use get_ui_context first to see available elements and their properties,
    then call this tool with the matching element identifiers.

    Falls back gracefully: if the element cannot be found, returns an error with
    available elements so you can retry with corrected identifiers or fall back
    to observe_screen + execute_gui.

    Args:
        action: Action to perform — 'click', 'set_value', 'toggle', 'select',
                'expand', 'collapse', 'focus'.
        target: Human description of the UI element (for logging/voice).
        element_name: Element's visible name/label (fuzzy matched).
        automation_id: Element's automation ID (exact match, most reliable).
        control_type: Element's control type (e.g. 'Button', 'Edit').
        value: Text value for 'set_value' action.
        window_title: Optional — focus this window before finding the element.

    Returns:
        dict with status, found, element_name, element_type, action_performed,
        description, duration_ms, voice_message.
    """
    import time as _time

    logger.info(
        "execute_accessible: action=%s target=%s name=%s auto_id=%s type=%s window_title=%s",
        action, target, element_name, automation_id, control_type, window_title,
    )
    start = _time.monotonic()

    valid_actions = {"click", "set_value", "toggle", "select", "expand", "collapse", "focus"}
    if action not in valid_actions:
        duration_ms = int((_time.monotonic() - start) * 1000)
        return {
            "status": "error", "found": False,
            "element_name": "", "element_type": "",
            "action_performed": action,
            "description": f"Unknown action '{action}'. Supported: {', '.join(sorted(valid_actions))}",
            "duration_ms": duration_ms,
            "voice_message": f"Unknown action {action}. I'll try a different approach.",
        }

    if not element_name and not automation_id and not control_type:
        duration_ms = int((_time.monotonic() - start) * 1000)
        return {
            "status": "error", "found": False,
            "element_name": "", "element_type": "",
            "action_performed": action,
            "description": "No element identifier provided. Specify element_name, automation_id, or control_type.",
            "duration_ms": duration_ms,
            "voice_message": "I need to know which element to interact with. Let me check the UI context first.",
        }

    try:
        ui = UIAutomation()
        result = await ui.interact(
            name=element_name, automation_id=automation_id,
            control_type=control_type, action=action,
            value=value, window_title=window_title,
        )
        result["duration_ms"] = int((_time.monotonic() - start) * 1000)

        # If element not found, enrich error with available elements
        # Uses get_rich_tree() for enabled/visible state — helps the LLM
        # understand why an element may not be interactable.
        if not result.get("found", False):
            available = await ui.get_rich_tree()
            if available:
                element_list = "; ".join(
                    f"{e.get('name', '?')} ({e.get('type', '?')}"
                    f"{', disabled' if not e.get('enabled', True) else ''}"
                    f"{', hidden' if not e.get('visible', True) else ''})"
                    for e in available[:15]
                )
                result["available_elements"] = element_list
                result["description"] += f" Available elements: {element_list}"

        return result
    except Exception as exc:
        duration_ms = int((_time.monotonic() - start) * 1000)
        logger.exception("execute_accessible failed")
        return {
            "status": "error", "found": False,
            "element_name": "", "element_type": "",
            "action_performed": action,
            "description": f"Accessibility interaction failed: {exc}",
            "duration_ms": duration_ms,
            "voice_message": f"I couldn't interact with the {target} via accessibility. Let me try clicking it visually.",
        }


# -- System Tools (Layer 2) -------------------------------------------------


async def process_info(name: str = "") -> dict:
    """List running processes or find processes by name.

    Args:
        name: Process name to search for. If empty, returns top 20 by CPU/memory.

    Returns dict with status, processes (list of name, pid, cpu, memory).
    """
    import time as _time
    logger.info("process_info called: name=%s", name)
    start = _time.monotonic()
    try:
        import platform as _platform
        import subprocess

        if _platform.system() == "Windows":
            # tasklist IMAGENAME filter doesn't support wildcards — filter client-side
            cmd = ["tasklist", "/FO", "CSV", "/NH"]
        else:
            cmd = ["ps", "aux", "--sort=-pcpu"]

        result = await asyncio.to_thread(
            subprocess.run, cmd,
            capture_output=True, text=True, timeout=10,
        )

        processes = []
        if _platform.system() == "Windows":
            import csv
            import io
            reader = csv.reader(io.StringIO(result.stdout))
            for row in reader:
                if len(row) >= 5:
                    proc_name = row[0].strip('"')
                    if name and name.lower() not in proc_name.lower():
                        continue
                    processes.append({
                        "name": proc_name,
                        "pid": int(row[1].strip('"')),
                        "memory": row[4].strip('"'),
                    })
        else:
            lines = result.stdout.strip().split("\n")[1:]  # Skip header
            for line in lines:
                parts = line.split(None, 10)
                if len(parts) >= 11:
                    proc_name = parts[10][:60]
                    if name and name.lower() not in proc_name.lower():
                        continue
                    processes.append({
                        "name": proc_name,
                        "pid": int(parts[1]),
                        "cpu": parts[2],
                        "memory": parts[3],
                    })

        # Limit results
        processes = processes[:20]

        return {
            "status": "success",
            "processes": processes,
            "count": len(processes),
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("process_info failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't get process information.",
        }


async def system_info() -> dict:
    """Get system information (OS, CPU, memory, disk).

    Returns dict with status, os, version, hostname, cpu, memory_total,
    memory_available, disk_free, python_version.
    """
    import os
    import time as _time
    logger.info("system_info called")
    start = _time.monotonic()
    try:
        import platform as _platform
        import shutil

        def _gather():
            info = {
                "os": _platform.system(),
                "version": _platform.version(),
                "hostname": _platform.node(),
                "cpu": f"{os.cpu_count()} cores",
                "python_version": _platform.python_version(),
                "architecture": _platform.machine(),
            }

            # Disk free
            try:
                usage = shutil.disk_usage(os.path.expanduser("~"))
                info["disk_total"] = f"{usage.total // (1024**3)} GB"
                info["disk_free"] = f"{usage.free // (1024**3)} GB"
            except Exception:
                pass

            # Memory (psutil if available, else try OS-specific)
            try:
                import psutil
                mem = psutil.virtual_memory()
                info["memory_total"] = f"{mem.total // (1024**3)} GB"
                info["memory_available"] = f"{mem.available // (1024**3)} GB"
            except ImportError:
                pass

            return info

        info = await asyncio.to_thread(_gather)
        info["status"] = "success"
        info["duration_ms"] = int((_time.monotonic() - start) * 1000)
        return info
    except Exception as exc:
        logger.exception("system_info failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't get system information.",
        }


async def download_file(url: str, destination: str = "") -> dict:
    """Download a file from a URL.

    Args:
        url: HTTP(S) URL to download.
        destination: Local path to save the file. Default: ~/Downloads/<filename>.

    Returns dict with status, path, size_bytes, duration_ms.
    """
    import os
    import time as _time
    logger.info("download_file called: url=%s, destination=%s", url, destination)
    start = _time.monotonic()
    try:
        import urllib.request
        import urllib.parse

        # URL validation: only http/https
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return {
                "status": "error",
                "description": f"Only http/https URLs are allowed. Got: {parsed.scheme}",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "I can only download from HTTP or HTTPS URLs.",
            }

        # SSRF prevention: block private/internal IPs and cloud metadata endpoints
        import ipaddress
        import socket
        hostname = parsed.hostname or ""
        try:
            resolved = socket.getaddrinfo(hostname, None)
            for _, _, _, _, addr in resolved:
                ip = ipaddress.ip_address(addr[0])
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                    return {
                        "status": "error",
                        "description": f"URL resolves to a private/internal IP ({addr[0]}). Downloads from internal networks are blocked.",
                        "duration_ms": int((_time.monotonic() - start) * 1000),
                        "voice_message": "I can't download from internal network addresses.",
                    }
        except (socket.gaierror, ValueError):
            pass  # DNS resolution failure is handled by urllib later

        # Default destination (always in ~/Downloads to prevent arbitrary path writes)
        if not destination:
            filename = os.path.basename(parsed.path) or "download"
            downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
            os.makedirs(downloads_dir, exist_ok=True)
            destination = os.path.join(downloads_dir, filename)
        else:
            # Validate destination is within user's home directory
            resolved_dest = os.path.realpath(os.path.expanduser(destination))
            home = os.path.realpath(os.path.expanduser("~"))
            if not resolved_dest.startswith(home):
                return {
                    "status": "error",
                    "description": "Destination must be within the user's home directory.",
                    "duration_ms": int((_time.monotonic() - start) * 1000),
                    "voice_message": "Downloads must be saved within your home directory.",
                }

        def _download():
            req = urllib.request.Request(url, headers={"User-Agent": "Contop/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                content_length = resp.headers.get("Content-Length")
                max_size = 500 * 1024 * 1024  # 500MB
                if content_length and int(content_length) > max_size:
                    raise ValueError(f"File too large: {int(content_length)} bytes (max {max_size})")

                try:
                    with open(destination, "wb") as f:
                        total = 0
                        while True:
                            chunk = resp.read(65536)
                            if not chunk:
                                break
                            total += len(chunk)
                            if total > max_size:
                                raise ValueError(f"Download exceeded max size of {max_size} bytes")
                            f.write(chunk)
                except Exception:
                    # Clean up partial file on failure
                    try:
                        os.unlink(destination)
                    except OSError:
                        pass
                    raise
                return total

        size = await asyncio.to_thread(_download)

        return {
            "status": "success",
            "path": destination,
            "size_bytes": size,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("download_file failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't download the file.",
        }
