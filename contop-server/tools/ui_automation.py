"""
Cross-platform UI automation via accessibility APIs.

Provides UI context (foreground window, focused element, interactive elements)
using platform-native accessibility APIs via platform_adapters/.

All platform-specific calls are wrapped with asyncio.to_thread() since
accessibility APIs are synchronous operations.

[Source: tech-spec-gui-agent-optimization.md - Tier 1: Keyboard-First Execution]
"""
import asyncio
import logging

from platform_adapters import get_adapter

logger = logging.getLogger(__name__)


class UIAutomation:
    """Cross-platform UI context via accessibility APIs (singleton)."""

    _instance: "UIAutomation | None" = None
    _adapter = None

    def __new__(cls) -> "UIAutomation":
        if cls._instance is None:
            inst = super().__new__(cls)
            inst._adapter = get_adapter()
            cls._instance = inst
        return cls._instance

    async def get_context(self, max_depth: int = 8, window_title: str | None = None) -> dict:
        """Get the current UI context: active window, focused element, interactive elements.

        All platform calls are run in a thread executor to avoid blocking the event loop.

        Args:
            max_depth: Maximum tree depth to walk when collecting elements.
                       Default 8 handles deeply nested dialogs (Save As, Open, etc.).
            window_title: Optional - scan this window instead of the foreground window.
                          Useful for dialogs (Save As, Open) that may not yet have focus.

        Returns:
            dict with foreground_window, focused_element, interactive_elements,
            element_count, and status.
        """
        adapter = self._adapter

        foreground_window, focused_element, interactive_elements = await asyncio.gather(
            asyncio.to_thread(adapter.get_foreground_window_name),
            asyncio.to_thread(adapter.get_focused_element),
            asyncio.to_thread(adapter.get_interactive_elements, max_depth, window_title),
        )

        return {
            "foreground_window": foreground_window,
            "focused_element": focused_element,
            "interactive_elements": interactive_elements,
            "element_count": len(interactive_elements),
            "status": "success",
        }

    async def interact(
        self,
        name: str | None = None,
        automation_id: str | None = None,
        control_type: str | None = None,
        action: str = "click",
        value: str | None = None,
        window_title: str | None = None,
    ) -> dict:
        """Execute an action on a UI element via the accessibility tree.

        Delegates to the platform adapter's interact_element() in a thread executor.
        """
        return await asyncio.to_thread(
            self._adapter.interact_element,
            name=name, automation_id=automation_id, control_type=control_type,
            action=action, value=value, window_title=window_title,
        )

    async def get_rich_tree(self, max_depth: int = 3) -> list[dict]:
        """Return interactive elements with enabled/visible state."""
        return await asyncio.to_thread(self._adapter.get_element_tree, max_depth)
