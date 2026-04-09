"""
Vision grounding client via OpenRouter API.

Uses OpenAI-compatible chat completions format with vision (image_url in messages)
to send screenshots to vision models for element grounding. Returns action coordinates
that bypass YOLO/OCR entirely.

Post-processes responses with screen-zone annotations so the execution agent can
distinguish between browser toolbar, page content, and system taskbar elements.

Supports multiple vision models via the `model` parameter:
- bytedance/ui-tars-1.5-7b (default)
- moonshotai/kimi-k2.5
- Qwen/Qwen3-VL-8B-Instruct
- microsoft/phi-4
- allenai/molmo2-8b
- Hcompany/Holotron-12B

[Source: tech-spec-gui-agent-optimization.md - Tier 4: UI-TARS via OpenRouter]
"""
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

UI_TARS_MODEL = "bytedance/ui-tars-1.5-7b"
REQUEST_TIMEOUT = 30.0

# Default grounding system prompt - single source of truth for element detection.
# Imported by agent_tools.py as _VISION_PROMPT_GROUNDING.
DEFAULT_GROUNDING_SYSTEM_PROMPT = (
    "You are a UI grounding model. Given a screenshot, identify all "
    "interactive UI elements with their coordinates as (x, y). "
    "For EACH element, label its screen region: "
    "[BROWSER TOOLBAR] for browser address bar, tabs, and navigation buttons; "
    "[PAGE CONTENT] for elements inside the web page or application window; "
    "[SYSTEM TASKBAR] for OS taskbar, Start menu, and system tray icons. "
    "Example: [PAGE CONTENT] Search input at (640, 45). "
    "Clearly distinguish the browser address bar from in-page search inputs."
)

# Mapping from backend name to OpenRouter model slug.
VISION_BACKEND_MODELS: dict[str, str] = {
    "ui_tars": "bytedance/ui-tars-1.5-7b",
    "kimi_vision": "moonshotai/kimi-k2.5",
    "qwen_vision": "Qwen/Qwen3-VL-8B-Instruct",
    "phi_vision": "microsoft/phi-4",
    "molmo_vision": "allenai/molmo2-8b",
    "holotron_vision": "Hcompany/Holotron-12B",
}

# Module-level cached clients - reuses HTTP connections across observe_screen calls.
# Keyed by (api_key, model) so the client is recreated if the key or model changes.
_cached_clients: dict[str, Any] = {}


def _get_cached_client(api_key: str):
    """Return a module-level AsyncOpenAI client, creating one if needed."""
    if api_key in _cached_clients:
        return _cached_clients[api_key]
    from openai import AsyncOpenAI
    client = AsyncOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
        timeout=REQUEST_TIMEOUT,
    )
    _cached_clients[api_key] = client
    return client


class VisionClient:
    """Client for vision grounding via OpenRouter's OpenAI-compatible API.

    Supports any vision model available on OpenRouter. The model can be
    specified at construction time or defaults to UI-TARS.
    """

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self._api_key = api_key.strip() if api_key else ""
        self._model = model or UI_TARS_MODEL
        # Instance-level client override for testing. When set, bypasses the
        # module-level cache so tests can inject mocks without side effects.
        self._client = None

    async def ground(
        self,
        image_b64: str,
        instruction: str,
        capture_size: tuple[int, int] = (1280, 720),
        system_prompt: str | None = None,
        annotate_zones: bool = True,
    ) -> dict | None:
        """Send a screenshot to a vision model for grounding or understanding.

        Args:
            image_b64: Base64-encoded JPEG screenshot.
            instruction: What to identify/do on the screenshot (user message).
            capture_size: (width, height) of the screenshot in pixels,
                used for screen-zone annotation of coordinates.
            system_prompt: Override the default grounding system prompt.
                When None, uses DEFAULT_GROUNDING_SYSTEM_PROMPT.
            annotate_zones: Whether to post-process with screen-zone labels.
                Set to False for understanding mode (returns raw prose).

        Returns:
            dict with action, coordinates, description - or None on failure.
        """
        if not self._api_key:
            return None

        try:
            client = self._client or _get_cached_client(self._api_key)
            # Rely on the httpx client timeout (set during client creation)
            # instead of wrapping with asyncio.wait_for to avoid double-timeout
            # conflicts and potential connection leaks.
            response = await client.chat.completions.create(
                model=self._model,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt or DEFAULT_GROUNDING_SYSTEM_PROMPT,
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": instruction},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_b64}",
                                },
                            },
                        ],
                    },
                ],
                max_tokens=1024,
            )

            if not response.choices:
                logger.warning("Vision client returned no choices")
                return None

            text = response.choices[0].message.content or ""
            logger.info("Vision client raw response (%s, %d chars):\n%s", self._model, len(text), text)
            if not text.strip():
                logger.warning("Vision client returned empty response")
                return None

            return self._parse_response(text, capture_size, annotate_zones)

        except Exception as exc:
            exc_str = str(exc)
            if "429" in exc_str or "rate" in exc_str.lower():
                logger.warning(
                    "Vision client rate-limited (429). Free-tier models have aggressive "
                    "rate limits. Consider upgrading or reducing request frequency."
                )
            elif "timeout" in exc_str.lower() or "timed out" in exc_str.lower():
                logger.warning("Vision client request timed out after %.0fs", REQUEST_TIMEOUT)
            elif "401" in exc_str or "auth" in exc_str.lower():
                logger.warning(
                    "Vision client authentication failed. Check your OpenRouter API key."
                )
            else:
                logger.warning("Vision client request failed", exc_info=True)
            return None

    def _parse_response(
        self, text: str, capture_size: tuple[int, int] = (1280, 720),
        annotate_zones: bool = True,
    ) -> dict | None:
        """Parse vision model response text into structured data.

        When annotate_zones is True (grounding mode), coordinates are
        post-processed with screen-zone labels. When False (understanding
        mode), the raw text is returned as-is.

        Note: When vision grounding succeeds, OmniParser element_id resolution is
        unavailable - the agent must use coordinates from the description
        or re-observe with OmniParser if element_id targeting is needed.
        """
        cleaned = text.strip()
        if annotate_zones:
            cleaned = self._annotate_zones(cleaned, capture_size)
        return {
            "action": "ground",
            "description": cleaned,
            "source": self._model,
        }

    @staticmethod
    def _annotate_zones(
        text: str, capture_size: tuple[int, int] = (1280, 720),
    ) -> str:
        """Add screen-zone labels to coordinate mentions in vision model output.

        Scans for (x, y) coordinate patterns and appends a zone tag based
        on the y value relative to known screen regions:
        - y <= toolbar_threshold  → [BROWSER TOOLBAR]
        - y >= taskbar_threshold  → [SYSTEM TASKBAR]
        - otherwise               → [PAGE CONTENT]

        Also prepends a zone legend so the agent knows how to interpret them.
        """
        _, cap_h = capture_size
        # Thresholds scaled to capture height (calibrated for 720p)
        toolbar_y = int(55 * cap_h / 720)
        taskbar_y = cap_h - int(40 * cap_h / 720)

        def _zone_for_y(y: int) -> str:
            if y <= toolbar_y:
                return "BROWSER TOOLBAR"
            if y >= taskbar_y:
                return "SYSTEM TASKBAR"
            return "PAGE CONTENT"

        # Match common coordinate patterns: (N, N)  [N, N]  (N,N)
        _COORD_RE = re.compile(
            r'(?<!\[)[\(\[]\s*(?P<x>\d+)\s*,\s*(?P<y>\d+)\s*[\)\]]'
        )

        def _annotate(m: re.Match) -> str:
            try:
                y = int(m.group("y"))
                zone = _zone_for_y(y)
                # Only add zone if not already labeled nearby
                return f"{m.group(0)} [{zone}]"
            except (ValueError, IndexError):
                return m.group(0)

        annotated = _COORD_RE.sub(_annotate, text)

        legend = (
            f"[Screen zones - y<={toolbar_y}: BROWSER TOOLBAR/ADDRESS BAR, "
            f"y>={taskbar_y}: SYSTEM TASKBAR, between: PAGE CONTENT. "
            f"NEVER type search queries into BROWSER TOOLBAR elements - "
            f"use the app's keyboard shortcut to focus its search input instead.]\n\n"
        )
        return legend + annotated
