"""
OmniParser V2 HTTP client — sends screenshots to an external OmniParser
server for UI element detection and returns structured element data.

OmniParser is optional. When unavailable, the system falls back to
Gemini's vision model for coordinate estimation.

The OmniParser server (Microsoft/OmniParser) exposes a POST /parse/ endpoint
that accepts a base64-encoded screenshot and returns:
- Annotated image with numbered bounding boxes
- List of detected elements with normalized bounding box coordinates

[Source: architecture.md — GUI Automation Fallback, OmniParser V2]
"""
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Default URL — override via OMNIPARSER_URL env var
DEFAULT_OMNIPARSER_URL = "http://localhost:8090"
PARSE_TIMEOUT_S = 30.0  # OmniParser can be slow on CPU


@dataclass
class ParsedElement:
    """A single UI element detected by OmniParser."""

    element_id: int
    type: str  # "text" or "icon"
    content: str  # description or OCR text
    bbox: list[float]  # [x1, y1, x2, y2] normalized 0-1
    interactivity: bool
    source: str  # "ocr" or "icon_detection"

    @property
    def center_x(self) -> float:
        """Normalized center X (0-1 range)."""
        return (self.bbox[0] + self.bbox[2]) / 2

    @property
    def center_y(self) -> float:
        """Normalized center Y (0-1 range)."""
        return (self.bbox[1] + self.bbox[3]) / 2


@dataclass
class ParseResult:
    """Result from OmniParser screen parsing."""

    annotated_image_b64: str  # Screenshot with numbered bounding boxes
    elements: list[ParsedElement] = field(default_factory=list)
    latency_s: float = 0.0

    def get_element(self, element_id: int) -> Optional[ParsedElement]:
        """Look up an element by its ID."""
        for el in self.elements:
            if el.element_id == element_id:
                return el
        return None

    def describe_elements(self) -> str:
        """Format elements as a text list for the LLM prompt."""
        if not self.elements:
            return "No UI elements detected."
        lines = []
        for el in self.elements:
            tag = "interactive" if el.interactivity else "static"
            lines.append(f"[{el.element_id}] {el.content} ({el.type}, {tag})")
        return "\n".join(lines)


class OmniParserClient:
    """Async HTTP client for the OmniParser V2 server."""

    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = (
            base_url
            or os.environ.get("OMNIPARSER_URL")
            or DEFAULT_OMNIPARSER_URL
        )
        self._available: bool | None = None  # Cached availability

    async def is_available(self) -> bool:
        """Check if the OmniParser server is reachable."""
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self._base_url}/docs")
                self._available = resp.status_code == 200
        except Exception:
            self._available = False
        return self._available

    async def parse(self, image_b64: str) -> ParseResult | None:
        """Send a screenshot to OmniParser and return parsed elements.

        Args:
            image_b64: Base64-encoded JPEG screenshot.

        Returns:
            ParseResult with annotated image and element list, or None if
            OmniParser is unavailable or fails.
        """
        # Skip if server is known to be unreachable (avoids repeated connect attempts)
        if self._available is False:
            return None
        try:
            async with httpx.AsyncClient(timeout=PARSE_TIMEOUT_S) as client:
                resp = await client.post(
                    f"{self._base_url}/parse/",
                    json={"base64_image": image_b64},
                )
                resp.raise_for_status()
                data = resp.json()

            elements = []
            for idx, item in enumerate(data.get("parsed_content_list", [])):
                elements.append(ParsedElement(
                    element_id=idx,
                    type=item.get("type", "unknown"),
                    content=item.get("content", ""),
                    bbox=item.get("bbox", [0, 0, 0, 0]),
                    interactivity=item.get("interactivity", False),
                    source=item.get("source", ""),
                ))

            result = ParseResult(
                annotated_image_b64=data.get("som_image_base64", ""),
                elements=elements,
                latency_s=data.get("latency", 0.0),
            )
            logger.info(
                "OmniParser detected %d elements in %.1fs",
                len(elements), result.latency_s,
            )
            self._available = True
            return result

        except httpx.ConnectError:
            if self._available is not False:
                logger.info("OmniParser not available at %s — using Gemini vision fallback", self._base_url)
            self._available = False
            return None
        except Exception:
            logger.warning("OmniParser parse failed", exc_info=True)
            return None


# Module-level singleton
_client: OmniParserClient | None = None


def get_omniparser_client() -> OmniParserClient:
    """Return the module-level OmniParser HTTP client singleton."""
    global _client
    if _client is None:
        _client = OmniParserClient()
    return _client


class OmniParserRouter:
    """Tries local in-process OmniParser first, falls back to HTTP client.

    The local parser auto-downloads models from HuggingFace on first use.
    Set OMNIPARSER_MODE=remote to skip local and only use HTTP.
    Set OMNIPARSER_MODE=local to skip HTTP fallback.
    """

    def __init__(self) -> None:
        self._mode = os.environ.get("OMNIPARSER_MODE", "auto")  # auto | local | remote
        self._local = None
        self._local_available: bool | None = None

    def _get_local(self):
        """Lazy-import local parser to avoid importing torch at module load."""
        if self._local is None:
            try:
                from tools.omniparser_local import get_omniparser_local
                self._local = get_omniparser_local()
            except ImportError as e:
                logger.warning("OmniParser local import failed: %s — using HTTP fallback", e)
                self._local_available = False
                return None
            except Exception as e:
                logger.warning("OmniParser local init failed: %s — using HTTP fallback", e, exc_info=True)
                self._local_available = False
                return None
        return self._local

    def get_loading_status(self) -> str:
        """Return a human-readable loading status, or empty string if ready."""
        if self._local is not None:
            if self._local.is_loading:
                return self._local.load_status or "Loading OmniParser models..."
            if self._local.is_loaded:
                return ""
        if self._local_available is False:
            return ""  # Not available, won't load
        return ""

    async def parse(self, image_b64: str) -> ParseResult | None:
        """Parse screenshot via local OmniParser, falling back to HTTP."""
        # Try local first (unless mode is 'remote')
        if self._mode != "remote" and self._local_available is not False:
            local = self._get_local()
            if local is not None:
                try:
                    result = await local.parse(image_b64)
                    if result is not None:
                        self._local_available = True
                        return result
                except Exception:
                    logger.warning("OmniParser local parse failed, trying HTTP", exc_info=True)
                    if self._mode == "local":
                        return None

        # Fall back to HTTP client (unless mode is 'local')
        if self._mode != "local":
            return await get_omniparser_client().parse(image_b64)

        return None


# Module-level router singleton
_router: OmniParserRouter | None = None


def get_omniparser() -> OmniParserRouter:
    """Return the OmniParser router (local-first with HTTP fallback)."""
    global _router
    if _router is None:
        _router = OmniParserRouter()
    return _router
