"""
Gemini Computer Use adapter — planning layer only.

Calls the Gemini CU API with a screenshot + instruction, receives function_call
responses with normalized 0-999 coordinates, and maps them to the standard
gui_automation action vocabulary (click, type, scroll, hotkey, etc.).

Does NOT execute actions — the caller routes planned actions through
gui_automation.py so there is a single execution path for all backends.

Stateless API: full conversation history must be sent with each call.

[Source: tech-spec — Model Role Selection & Gemini Computer Use Adapter]
"""
import asyncio
import base64
import io
import logging
import platform
import re
import time
from dataclasses import dataclass, field

from google import genai
from google.genai import types
from PIL import Image

from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Recommended input resolution for Gemini Computer Use
CU_RECOMMENDED_WIDTH = 1440
CU_RECOMMENDED_HEIGHT = 900

# Maximum steps per execute_task loop to prevent runaway execution
MAX_CU_STEPS = 15

# Maximum history entries to keep (prevents unbounded memory growth from screenshots).
# Each CU step produces ~3 entries (user screenshot, model function_call, user function_response).
# 30 entries covers ~10 steps safely. Kept lower than MAX_CU_STEPS*3 to bound memory.
MAX_CU_HISTORY_ENTRIES = 30

# Allowed URL schemes for navigate action
_ALLOWED_URL_SCHEMES = {"http", "https"}

# Blocked key combinations that could bypass security boundaries
_BLOCKED_KEY_COMBOS = {
    frozenset({"win", "r"}),           # Run dialog
    frozenset({"ctrl", "alt", "del"}),  # Security screen
    frozenset({"ctrl", "alt", "delete"}),
    frozenset({"alt", "f4"}),           # Close window
    frozenset({"super", "r"}),          # Run dialog (Linux)
}


@dataclass
class PlannedAction:
    """A Gemini CU action mapped to standard gui_automation format.

    Fields:
        action: Our action name — "click", "type", "scroll", "hotkey",
                "press_key", "move_mouse", "drag", "wait", "cli".
        target: Human description of the target element.
        coordinates: Action-specific dict in capture-space pixel coords.
        cu_function_name: Original CU function name (for logging/debug).
    """
    action: str
    target: str
    coordinates: dict
    cu_function_name: str = ""


@dataclass
class PlanResult:
    """Result of a single Gemini CU planning step."""
    status: str  # "success", "error", "confirmation_required", "done"
    planned_actions: list[PlannedAction] = field(default_factory=list)
    description: str = ""
    duration_ms: int = 0
    confirmation_request: dict | None = None


class GeminiComputerUseClient:
    """Wraps the Gemini Computer Use API for GUI automation planning.

    Returns planned actions mapped to the standard gui_automation vocabulary.
    The caller is responsible for executing them through gui_automation.py.
    """

    # Module-level shared client to avoid creating one per CU invocation
    _shared_client: genai.Client | None = None

    def __init__(
        self,
        api_key: str,
        capture_size: tuple[int, int] = (1280, 720),
    ) -> None:
        if GeminiComputerUseClient._shared_client is None:
            GeminiComputerUseClient._shared_client = genai.Client(api_key=api_key)
        self._client = GeminiComputerUseClient._shared_client
        self._capture_size = capture_size
        self._history: list[types.Content] = []
        self._model = "gemini-2.5-computer-use-preview-10-2025"
        # Track the current URL for ENVIRONMENT_BROWSER function responses.
        # Gemini CU requires 'current_url' in every function response.
        self._current_url = "about:blank"
        # Store the first instruction so it can be re-injected after trimming
        self._initial_instruction: str | None = None

    def _denormalize_to_capture(self, x: int, y: int) -> tuple[int, int]:
        """Convert 0-999 normalized coords to capture-space pixel coords.

        Formula: pixel = (normalized / 1000) * capture_dimension
        The caller (execute_gui) then scales from capture-space → native-space.
        """
        px = int((x / 1000) * self._capture_size[0])
        py = int((y / 1000) * self._capture_size[1])
        logger.debug("CU coords: raw(%d,%d) → capture(%d,%d) [capture_size=%s]", x, y, px, py, self._capture_size)
        return px, py

    async def plan_step(
        self,
        screenshot_b64: str,
        instruction: str | None = None,
    ) -> PlanResult:
        """Single step: send screenshot to Gemini CU, get planned actions back.

        Does NOT execute anything. Returns PlannedActions for the caller to
        execute through gui_automation.py.

        Args:
            screenshot_b64: Base64-encoded JPEG screenshot.
            instruction: User instruction (only needed for the first step).

        Returns:
            PlanResult with status and planned_actions list.
        """
        start = time.monotonic()

        # Save the initial instruction so we can re-inject after history trimming
        if instruction and self._initial_instruction is None:
            self._initial_instruction = instruction

        # Build user content with screenshot
        image_bytes = base64.b64decode(screenshot_b64)
        parts: list[types.Part] = [
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
        ]
        if instruction:
            parts.insert(0, types.Part.from_text(text=instruction))

        user_content = types.Content(role="user", parts=parts)
        self._history.append(user_content)

        # Trim history to prevent unbounded memory growth from screenshots.
        # Smart trim: keep recent entries but ensure the first entry always has
        # the original instruction, so the model retains task context.
        if len(self._history) > MAX_CU_HISTORY_ENTRIES:
            trimmed = self._history[-MAX_CU_HISTORY_ENTRIES:]
            # Re-inject instruction into the first user content if it was lost
            if self._initial_instruction and trimmed:
                first = trimmed[0]
                has_instruction = any(
                    hasattr(p, "text") and p.text and p.text == self._initial_instruction
                    for p in (first.parts or [])
                )
                if not has_instruction and first.role == "user":
                    trimmed[0] = types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(text=f"[Task reminder] {self._initial_instruction}"),
                            *(first.parts or []),
                        ],
                    )
            self._history = trimmed

        # Retry with exponential backoff for rate limits (429) and 404 errors.
        # 404 NOT_FOUND can occur when trimmed history confuses the CU session;
        # retrying with a reset history recovers from this.
        max_retries = 3
        response = None
        for attempt in range(max_retries):
            try:
                response = await asyncio.to_thread(
                    self._client.models.generate_content,
                    model=self._model,
                    contents=self._history,
                    config=types.GenerateContentConfig(
                        tools=[types.Tool(computer_use=types.ComputerUse(
                            environment=types.Environment.ENVIRONMENT_UNSPECIFIED,
                        ))],
                        # Disable AFC — we manage function responses manually via _history.
                        # Without this, the SDK tries to auto-call functions alongside our
                        # manual history, corrupting conversation state and causing 404s.
                        automatic_function_calling=types.AutomaticFunctionCallingConfig(
                            disable=True,
                        ),
                    ),
                )
                break  # Success
            except Exception as exc:
                status_code = getattr(exc, "status_code", 0)
                if status_code == 429 and attempt < max_retries - 1:
                    wait_secs = 2 ** (attempt + 1)  # 2s, 4s
                    logger.warning("CU API rate limited (429), retrying in %ds (attempt %d/%d)", wait_secs, attempt + 1, max_retries)
                    await asyncio.sleep(wait_secs)
                    continue
                if status_code == 404 and attempt < max_retries - 1:
                    # 404 often means corrupted conversation history.
                    # Reset to just the current screenshot + instruction and retry.
                    logger.warning("CU API 404, resetting history and retrying (attempt %d/%d)", attempt + 1, max_retries)
                    reset_parts: list[types.Part] = [
                        types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    ]
                    if self._initial_instruction:
                        reset_parts.insert(0, types.Part.from_text(text=self._initial_instruction))
                    self._history = [types.Content(role="user", parts=reset_parts)]
                    await asyncio.sleep(1)
                    continue
                logger.exception("Gemini CU API call failed")
                duration_ms = int((time.monotonic() - start) * 1000)
                return PlanResult(
                    status="error",
                    description=f"Gemini CU API error: {exc}",
                    duration_ms=duration_ms,
                )

        # Parse response
        if not response.candidates or not response.candidates[0].content:
            duration_ms = int((time.monotonic() - start) * 1000)
            return PlanResult(
                status="done",
                description="Model returned no actions — task may be complete.",
                duration_ms=duration_ms,
            )

        model_content = response.candidates[0].content
        self._history.append(model_content)

        planned_actions = []
        function_responses = []

        for part in model_content.parts:
            # Check for text response (model is done)
            if part.text:
                duration_ms = int((time.monotonic() - start) * 1000)
                return PlanResult(
                    status="done",
                    planned_actions=planned_actions,
                    description=part.text,
                    duration_ms=duration_ms,
                )

            # Check for safety_decision requiring confirmation
            if hasattr(part, "safety_decision") and part.safety_decision:
                decision = part.safety_decision
                if hasattr(decision, "decision") and decision.decision == "require_confirmation":
                    duration_ms = int((time.monotonic() - start) * 1000)
                    return PlanResult(
                        status="confirmation_required",
                        planned_actions=planned_actions,
                        description="Gemini CU requires user confirmation before proceeding.",
                        duration_ms=duration_ms,
                        confirmation_request={
                            "reason": getattr(decision, "reason", "Safety check required"),
                            "message": getattr(decision, "message", "The model wants to confirm this action."),
                        },
                    )

            # Handle function calls — map to our action vocabulary
            if part.function_call:
                action_name = part.function_call.name
                args = dict(part.function_call.args) if part.function_call.args else {}

                mapped = self._map_to_gui_actions(action_name, args)
                planned_actions.extend(mapped)

                # Track URL from navigate actions
                if action_name == "navigate" and args.get("url"):
                    url = re.sub(r"^(https?)\.", r"\1://", args["url"])
                    parsed = urlparse(url)
                    if not parsed.scheme:
                        url = f"https://{url}"
                    self._current_url = url

                # Build function response for conversation history.
                # CU API requires 'current_url' in EVERY function response,
                # even with ENVIRONMENT_UNSPECIFIED (400 error otherwise).
                function_responses.append(types.Part.from_function_response(
                    name=action_name,
                    response={"status": "success", "current_url": self._current_url},
                ))

        # Append function responses to history for multi-step conversations
        if function_responses:
            self._history.append(types.Content(
                role="user",
                parts=function_responses,
            ))

        duration_ms = int((time.monotonic() - start) * 1000)
        return PlanResult(
            status="success",
            planned_actions=planned_actions,
            description=f"Planned {len(planned_actions)} action(s).",
            duration_ms=duration_ms,
        )

    def _map_to_gui_actions(self, cu_action: str, args: dict) -> list[PlannedAction]:
        """Map a Gemini CU action to our standard gui_automation action(s)."""
        mapper = _CU_TO_GUI_MAP.get(cu_action)
        if mapper is None:
            logger.warning("Unknown CU action: %s — skipping", cu_action)
            return []
        return mapper(self, args)

    def set_current_url(self, url: str) -> None:
        """Update the tracked browser URL (used in function responses)."""
        self._current_url = url

    async def reset(self) -> None:
        """Clear conversation history for a new task."""
        self._history.clear()
        self._current_url = "about:blank"
        self._initial_instruction = None


# ── CU → gui_automation mappers ──────────────────────────────────────────────
#
# Each mapper converts a single Gemini CU function_call into one or more
# PlannedAction(s) using our standard action vocabulary.
# Coordinates are denormalized from 0-999 → capture-space pixels.


def _map_click_at(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    x, y = client._denormalize_to_capture(args.get("x", 0), args.get("y", 0))
    return [PlannedAction("click", "screen element", {"x": x, "y": y}, "click_at")]


def _map_hover_at(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    x, y = client._denormalize_to_capture(args.get("x", 0), args.get("y", 0))
    return [PlannedAction("move_mouse", "screen element", {"x": x, "y": y}, "hover_at")]


def _map_type_text_at(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    x, y = client._denormalize_to_capture(args.get("x", 0), args.get("y", 0))
    text = args.get("text", "")
    return [PlannedAction("type", "text input", {"x": x, "y": y, "text": text}, "type_text_at")]


def _map_scroll_at(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    x, y = client._denormalize_to_capture(args.get("x", 0), args.get("y", 0))
    direction = args.get("direction", "down")
    magnitude = args.get("magnitude", 3)
    return [PlannedAction("scroll", "screen area", {"x": x, "y": y, "direction": direction, "amount": magnitude}, "scroll_at")]


def _map_key_combination(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    keys_str = args.get("keys", "")
    keys = [k.strip().lower() for k in keys_str.split("+") if k.strip()]
    # Block dangerous key combinations
    key_set = frozenset(keys)
    if key_set in _BLOCKED_KEY_COMBOS:
        logger.warning("Blocked key combination from CU: %s", keys_str)
        return []
    return [PlannedAction("hotkey", f"keyboard shortcut {keys_str}", {"keys": keys}, "key_combination")]


def _map_drag_and_drop(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    x, y = client._denormalize_to_capture(args.get("x", 0), args.get("y", 0))
    dx, dy = client._denormalize_to_capture(args.get("dest_x", 0), args.get("dest_y", 0))
    return [PlannedAction("drag", "draggable element", {"start_x": x, "start_y": y, "end_x": dx, "end_y": dy}, "drag_and_drop")]


def _map_navigate(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    url = args.get("url", "")
    # Fix malformed scheme prefixes from CU model (e.g. "https.youtube.com" → "https://youtube.com")
    url = re.sub(r"^(https?)\.", r"\1://", url)
    # Validate URL scheme
    parsed = urlparse(url)
    if parsed.scheme and parsed.scheme.lower() not in _ALLOWED_URL_SCHEMES:
        logger.warning("Blocked URL scheme from CU: %s", parsed.scheme)
        return []
    if not parsed.scheme:
        url = f"https://{url}"
    # Decompose into: focus address bar → type URL → press Enter
    modifier = "command" if platform.system() == "Darwin" else "ctrl"
    return [
        PlannedAction("hotkey", "focus address bar", {"keys": [modifier, "l"]}, "navigate"),
        PlannedAction("type", "address bar", {"text": url}, "navigate"),
        PlannedAction("press_key", "confirm navigation", {"key": "enter"}, "navigate"),
    ]


def _map_wait_5_seconds(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    return [PlannedAction("wait", "pause", {"seconds": 5}, "wait_5_seconds")]


def _map_scroll_document(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    direction = args.get("direction", "down")
    key_map = {"up": "Home", "down": "End", "page_up": "pageup", "page_down": "pagedown"}
    key = key_map.get(direction, "pagedown")
    return [PlannedAction("press_key", f"scroll document {direction}", {"key": key}, "scroll_document")]


def _map_go_back(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    modifier = "command" if platform.system() == "Darwin" else "alt"
    return [PlannedAction("hotkey", "go back", {"keys": [modifier, "left"]}, "go_back")]


def _map_go_forward(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    modifier = "command" if platform.system() == "Darwin" else "alt"
    return [PlannedAction("hotkey", "go forward", {"keys": [modifier, "right"]}, "go_forward")]


def _map_search(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    modifier = "command" if platform.system() == "Darwin" else "ctrl"
    return [PlannedAction("hotkey", "find on page", {"keys": [modifier, "f"]}, "search")]


def _map_open_web_browser(client: GeminiComputerUseClient, args: dict) -> list[PlannedAction]:
    system = platform.system()
    if system == "Windows":
        cmd = 'start "" chrome.exe'
    elif system == "Darwin":
        cmd = "open -a 'Google Chrome'"
    else:
        cmd = "xdg-open https://www.google.com"
    return [PlannedAction("cli", "open browser", {"command": cmd}, "open_web_browser")]


_CU_TO_GUI_MAP = {
    "click_at": _map_click_at,
    "hover_at": _map_hover_at,
    "type_text_at": _map_type_text_at,
    "scroll_at": _map_scroll_at,
    "key_combination": _map_key_combination,
    "drag_and_drop": _map_drag_and_drop,
    "navigate": _map_navigate,
    "wait_5_seconds": _map_wait_5_seconds,
    "scroll_document": _map_scroll_document,
    "go_back": _map_go_back,
    "go_forward": _map_go_forward,
    "search": _map_search,
    "open_web_browser": _map_open_web_browser,
}


def resize_screenshot_for_cu(jpeg_b64: str) -> str:
    """Resize a screenshot to fit within the recommended CU input resolution.

    Preserves aspect ratio by scaling to fit within 1440x900 and padding if needed.
    Returns the base64-encoded resized JPEG.
    """
    image_bytes = base64.b64decode(jpeg_b64)
    img = Image.open(io.BytesIO(image_bytes))

    if img.size != (CU_RECOMMENDED_WIDTH, CU_RECOMMENDED_HEIGHT):
        # Scale preserving aspect ratio to fit within target dimensions
        img.thumbnail((CU_RECOMMENDED_WIDTH, CU_RECOMMENDED_HEIGHT), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")
