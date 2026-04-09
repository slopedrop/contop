"""
Abstract base class for platform-specific window management adapters.

Each adapter augments PyAutoGUI with OS-native window management capabilities
(focus_window, list_windows) that pyautogui cannot provide alone.

[Source: architecture.md - Cross-Platform OS Abstraction Layer]
"""
import abc


class PlatformAdapter(abc.ABC):
    """Abstract adapter for platform-specific window management."""

    @abc.abstractmethod
    def focus_window(self, title: str) -> bool:
        """Bring a window with the given title to the foreground.

        Returns True if the window was found and focused, False otherwise.
        """

    @abc.abstractmethod
    def list_windows(self) -> list[str]:
        """Return titles of all visible windows."""

    # -- Accessibility API methods (Tier 1: Keyboard-First Execution) ----------
    # Default implementations return empty values for graceful degradation.
    # Subclasses override with platform-specific logic when available.

    def get_foreground_window_name(self) -> str:
        """Return the title of the active/foreground window (empty string if unavailable)."""
        return ""

    def get_focused_element(self) -> dict:
        """Return info about the currently focused element.

        Returns:
            dict with keys: name, type, automation_id, class_name.
            Empty dict if unavailable.
        """
        return {}

    def get_interactive_elements(self, max_depth: int = 8, window_title: str | None = None) -> list[dict]:
        """Return interactive elements in the foreground window.

        Args:
            max_depth: Maximum tree depth to walk.
            window_title: Optional - scan this window instead of the foreground window.
                          Useful for dialogs that may not yet be the foreground window.

        Returns:
            List of dicts with keys: name, type, automation_id.
            Empty list if unavailable.
        """
        return []

    # -- Element interaction (execute_accessible tool) -------------------------
    # Default implementations return graceful degradation values.
    # Subclasses override with platform-specific interaction logic.

    def interact_element(
        self,
        name: str | None = None,
        automation_id: str | None = None,
        control_type: str | None = None,
        action: str = "click",
        value: str | None = None,
        window_title: str | None = None,
    ) -> dict:
        """Interact with a UI element by its accessibility properties.

        Args:
            name: Element's visible name/label (fuzzy matched).
            automation_id: Element's automation ID (exact match, preferred).
            control_type: Element's control type (e.g. 'ButtonControl', 'EditControl').
            action: 'click', 'set_value', 'toggle', 'select', 'expand', 'collapse', 'focus'.
            value: Text value for 'set_value' action (typing into text fields).
            window_title: Optional - focus this window first before finding the element.

        Returns:
            dict with keys: found, status, element_name, element_type,
            action_performed, description, voice_message.
        """
        return {
            "found": False,
            "status": "error",
            "element_name": "",
            "element_type": "",
            "action_performed": action,
            "description": "Element interaction not available on this platform.",
            "voice_message": "Element interaction isn't available. Let me try a different approach.",
        }

    def get_element_tree(self, max_depth: int = 8) -> list[dict]:
        """Return interactive elements with enabled/visible state for rich tree queries.

        Returns list of dicts with keys: name, type, automation_id, enabled, visible, bbox.
        Default returns empty list (graceful degradation).
        """
        return []

    # -- Window state management (maximize_active_window tool) -----------------

    def is_window_maximized(self) -> bool:
        """Check if the foreground window is maximized (fills the screen).

        Returns True if maximized, False otherwise or if unable to determine.
        """
        return False

    def maximize_window(self) -> bool:
        """Maximize the foreground window to fill the screen.

        Returns True if the window was successfully maximized, False otherwise.
        Does NOT close or minimize any windows.
        """
        return False

    # -- Window resize/snap + clipboard (expanded tools) -----------------------

    def resize_window(
        self,
        title: str | None,
        width: int,
        height: int,
        x: int | None = None,
        y: int | None = None,
    ) -> bool:
        """Resize (and optionally move) a window.

        Args:
            title: Window title to target. None = foreground window.
            width: New width in pixels.
            height: New height in pixels.
            x: New x position (optional).
            y: New y position (optional).

        Returns True if the window was resized, False otherwise.
        """
        return False

    def snap_window(self, title: str | None, layout: str) -> bool:
        """Snap a window to a predefined screen layout.

        Args:
            title: Window title to target. None = foreground window.
            layout: One of "left_half", "right_half", "top_half",
                    "bottom_half", "maximize", "restore".

        Returns True if the window was snapped, False otherwise.
        """
        return False

    def clipboard_read(self) -> str:
        """Read text from the system clipboard.

        Returns the clipboard text, or empty string if unavailable.
        """
        return ""

    def clipboard_write(self, text: str) -> bool:
        """Write text to the system clipboard.

        Returns True if the text was written, False otherwise.
        """
        return False
