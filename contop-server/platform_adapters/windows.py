"""
Windows platform adapter - window management + accessibility via pywinauto (UIA backend).

Falls back gracefully if pywinauto is not installed.

[Source: architecture.md - Cross-Platform OS Abstraction Layer, pywinauto]
"""
import ctypes
import ctypes.wintypes
import logging
import re

from .base import PlatformAdapter

logger = logging.getLogger(__name__)

try:
    from pywinauto import Desktop
    _HAS_PYWINAUTO = True
except ImportError:
    _HAS_PYWINAUTO = False
    logger.info("pywinauto not installed - WindowsAdapter will use fallback")

# Interactive control types to include in get_interactive_elements()
_INTERACTIVE_TYPES = {
    "Button", "Edit", "ComboBox", "CheckBox",
    "RadioButton", "Hyperlink", "MenuItem",
    "ListItem", "TabItem",
    # `Document` is the control type used by text editors (Notepad, WordPad,
    # Word, VS Code) for their main editing area. Without it, the tree walk
    # and the "available elements" hint on errors silently omit the one
    # element the model actually needs to set_value on.
    "Document",
}

# Top-level windows that belong to the Windows shell / system tray.
# These should never be selected as a fallback when looking for an app window.
_SYSTEM_WINDOW_TITLES = frozenset({"", "Taskbar", "Status"})

# ctypes callback type for EnumWindows - pre-allocated at module load to avoid recreation overhead
_WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)

MAX_ELEMENTS = 200


def _get_desktop():
    """Return a fresh pywinauto Desktop instance (UIA backend).

    A new instance is created each call because pywinauto's UIA backend
    uses COM, which has thread affinity.  Since callers run in different
    asyncio.to_thread() workers, a cached Desktop's COM context may be
    invalid in the calling thread, causing ``desktop.windows()`` to
    silently return stale/empty results.
    """
    return Desktop(backend="uia")


def _get_top_window():
    """Return the top-level foreground window wrapper via pywinauto UIA backend.

    Uses GetForegroundWindow() hwnd to find the correct window rather than
    relying on Desktop.windows() ordering.
    """
    import ctypes as _ct
    hwnd = _ct.windll.user32.GetForegroundWindow()
    if not hwnd:
        return None
    desktop = _get_desktop()
    for win in desktop.windows():
        try:
            if win.handle == hwnd:
                return win
        except Exception:
            continue
    # Fallback: return first window if hwnd match fails
    windows = desktop.windows()
    return windows[0] if windows else None


def _find_window_by_title(title: str):
    """Find a top-level window whose title contains *title* (case-insensitive).

    Searches all desktop windows, not just the foreground window.  This avoids
    the race condition where ``GetForegroundWindow()`` returns the wrong handle
    during dialog transitions (e.g. Save As appearing after Ctrl+S).

    Three-stage search:
    1. **Top-level title match** - fast, handles classic separate-window dialogs.
    2. **Embedded child search** - walks non-system windows' children (depth ≤ 2)
       looking for a child whose name matches *title*.  This handles modern apps
       (e.g. Windows 11 Notepad) where dialogs like Save As are embedded children,
       not separate top-level windows.
    3. **Foreground fallback** - last resort via ``GetForegroundWindow()``.

    Returns the matching UIAWrapper, or ``None``.
    """
    desktop = _get_desktop()
    pattern = re.compile(re.escape(title), re.IGNORECASE)
    all_titles: list[str] = []
    app_windows: list[tuple] = []  # (win, title) for non-system windows

    for win in desktop.windows():
        try:
            wt = win.window_text() or ""
            all_titles.append(wt)
            if pattern.search(wt):
                return win
            if wt not in _SYSTEM_WINDOW_TITLES:
                app_windows.append((win, wt))
        except Exception:
            continue

    # Stage 2: Dialog may be embedded in an app window (e.g. Win11 Notepad
    # "Save As" is a child pane, not a separate top-level window).
    # Search non-system windows' children at depth ≤ 2 for a name match.
    for win, wt in app_windows:
        try:
            for child in win.children():
                try:
                    child_name = child.element_info.name or ""
                    if pattern.search(child_name):
                        logger.info(
                            "_find_window_by_title(%r): found as embedded child in window %r",
                            title, wt,
                        )
                        return win
                    # Check one level deeper (dialogs are often wrapped in a pane)
                    for grandchild in child.children():
                        try:
                            gc_name = grandchild.element_info.name or ""
                            if pattern.search(gc_name):
                                logger.info(
                                    "_find_window_by_title(%r): found as embedded grandchild in window %r",
                                    title, wt,
                                )
                                return win
                        except Exception:
                            continue
                except Exception:
                    continue
        except Exception:
            continue

    # Stage 3: Last resort - foreground window.  May be wrong during dialog
    # transitions but is better than returning None.
    fallback = _get_top_window()
    if fallback:
        fb_title = ""
        try:
            fb_title = fallback.window_text() or ""
        except Exception:
            pass
        logger.info(
            "_find_window_by_title(%r): no top-level or embedded match, "
            "falling back to foreground window %r. Available windows: %s",
            title, fb_title, all_titles[:10],
        )
        return fallback
    logger.warning(
        "_find_window_by_title(%r): no match and no foreground window. "
        "Available windows: %s",
        title, all_titles[:10],
    )
    return None


class WindowsAdapter(PlatformAdapter):
    """Windows window management + accessibility using pywinauto (optional)."""

    def focus_window(self, title: str) -> bool:
        if not _HAS_PYWINAUTO:
            return False
        try:
            desktop = Desktop(backend="uia")
            windows = desktop.windows(title_re=f".*{re.escape(title)}.*")
            if windows:
                windows[0].set_focus()
                return True
        except Exception:
            logger.warning("Failed to focus window '%s' via pywinauto", title)
        return False

    def list_windows(self) -> list[str]:
        # Primary: pywinauto UIA
        titles: list[str] = []
        if _HAS_PYWINAUTO:
            try:
                desktop = Desktop(backend="uia")
                titles = [w.window_text() for w in desktop.windows() if w.window_text()]
            except Exception:
                logger.warning("Failed to list windows via pywinauto")

        # Fallback: ctypes EnumWindows - catches windows that UIA misses
        # (e.g. Office Click-to-Run, some UWP apps during launch)
        if not titles:
            titles = self._list_windows_ctypes()

        return titles

    @staticmethod
    def _list_windows_ctypes() -> list[str]:
        """Enumerate visible top-level windows via Win32 EnumWindows."""
        user32 = ctypes.windll.user32
        results: list[str] = []

        def _enum_cb(hwnd, _lp):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value
            if title and title not in _SYSTEM_WINDOW_TITLES:
                results.append(title)
            return True

        user32.EnumWindows(_WNDENUMPROC(_enum_cb), 0)
        return results

    # -- Accessibility API (pywinauto UIA backend) --

    def get_foreground_window_name(self) -> str:
        if not _HAS_PYWINAUTO:
            return ""
        try:
            win = _get_top_window()
            return win.window_text() if win else ""
        except Exception:
            logger.warning("Failed to get foreground window name via pywinauto")
            return ""

    def get_focused_element(self) -> dict:
        if not _HAS_PYWINAUTO:
            return {}
        try:
            # Use UIA's GetFocusedElement() directly - UIAWrapper doesn't
            # have get_focus(), so we go through pywinauto's IUIA singleton.
            from pywinauto.uia_defines import IUIA
            from pywinauto.uia_element_info import UIAElementInfo

            focused_com = IUIA().iuia.GetFocusedElement()
            if not focused_com:
                return {}
            info = UIAElementInfo(focused_com)
            return {
                "name": info.name or "",
                "type": info.control_type or "",
                "automation_id": info.automation_id or "",
                "class_name": info.class_name or "",
            }
        except Exception:
            logger.warning("Failed to get focused element via pywinauto")
            return {}

    def get_interactive_elements(self, max_depth: int = 8, window_title: str | None = None) -> list[dict]:
        if not _HAS_PYWINAUTO:
            return []
        try:
            if window_title:
                win = _find_window_by_title(window_title)
            else:
                win = _get_top_window()
            if not win:
                return []
            elements: list[dict] = []
            self._walk_children(win, elements, depth=0, max_depth=max_depth)
            if len(elements) >= MAX_ELEMENTS:
                logger.info("Interactive element list truncated at %d (MAX_ELEMENTS cap)", MAX_ELEMENTS)
            return elements
        except Exception:
            logger.warning("Failed to get interactive elements via pywinauto")
            return []

    def _walk_children(
        self, wrapper, elements: list[dict], depth: int, max_depth: int
    ) -> None:
        """Recursively walk pywinauto UI tree collecting interactive elements."""
        if depth > max_depth or len(elements) >= MAX_ELEMENTS:
            return
        try:
            children = wrapper.children()
        except Exception:
            return
        for child in children:
            if len(elements) >= MAX_ELEMENTS:
                return
            try:
                info = child.element_info
                ctrl_type = info.control_type or ""
                if ctrl_type in _INTERACTIVE_TYPES:
                    elements.append({
                        "name": info.name or "",
                        "type": ctrl_type,
                        "automation_id": info.automation_id or "",
                    })
                self._walk_children(child, elements, depth + 1, max_depth)
            except Exception:
                logger.debug("pywinauto tree walk error at depth %d", depth, exc_info=True)
                continue

    # -- Element interaction (execute_accessible tool) --

    def interact_element(
        self,
        name: str | None = None,
        automation_id: str | None = None,
        control_type: str | None = None,
        action: str = "click",
        value: str | None = None,
        window_title: str | None = None,
    ) -> dict:
        if not _HAS_PYWINAUTO:
            return super().interact_element(name, automation_id, control_type, action, value, window_title)

        try:
            # Find target window - by title if given, else foreground
            if window_title:
                win = _find_window_by_title(window_title)
            else:
                win = _get_top_window()
            if not win:
                logger.warning(
                    "interact_element: no window found (window_title=%s)", window_title,
                )
                return {
                    "found": False, "status": "error",
                    "element_name": "", "element_type": "",
                    "action_performed": action,
                    "description": f"No window found{f' matching title={window_title!r}' if window_title else ''}.",
                    "voice_message": "I can't find any active window.",
                }

            win_title = ""
            try:
                win_title = win.window_text() or ""
            except Exception:
                pass
            logger.info(
                "interact_element: searching window=%r for name=%s, auto_id=%s, type=%s",
                win_title, name, automation_id, control_type,
            )

            # Find element using pywinauto search
            element = self._find_element(win, name, automation_id, control_type)
            if element is None:
                # Log available elements for debugging
                available = []
                try:
                    for child in win.children():
                        try:
                            ci = child.element_info
                            available.append(f"{ci.name or '?'}({ci.control_type or '?'},id={ci.automation_id or ''})")
                        except Exception:
                            pass
                except Exception:
                    pass
                logger.warning(
                    "interact_element: element NOT FOUND. Top-level children: %s",
                    "; ".join(available[:15]) if available else "(none)",
                )
                return {
                    "found": False, "status": "error",
                    "element_name": name or "", "element_type": control_type or "",
                    "action_performed": action,
                    "description": f"Element not found: name={name}, auto_id={automation_id}, type={control_type}. Window={win_title!r}.",
                    "voice_message": f"I couldn't find the {name or 'element'} in the current window.",
                }

            info = element.element_info
            elem_name = info.name or ""
            elem_type = info.control_type or ""

            # Execute action
            self._execute_action(element, action, value)

            return {
                "found": True, "status": "success",
                "element_name": elem_name, "element_type": elem_type,
                "action_performed": action,
                "description": f"Successfully performed '{action}' on '{elem_name}' ({elem_type}).",
                "voice_message": f"Done - {action} on {elem_name}.",
            }

        except Exception as exc:
            logger.warning("interact_element failed: %s", exc)
            return {
                "found": False, "status": "error",
                "element_name": name or "", "element_type": control_type or "",
                "action_performed": action,
                "description": f"Interaction failed: {exc}",
                "voice_message": f"I couldn't interact with the element. {exc}",
            }

    def _find_element(self, win, name, automation_id, control_type):
        """Find a single element by walking the UIA tree with children().

        Uses recursive tree walk instead of child_window() because
        _get_top_window() returns a UIAWrapper (not a WindowSpecification).
        """
        if not name and not automation_id and not control_type:
            return None
        return self._search_element_tree(win, name, automation_id, control_type, 0, 8)

    def _search_element_tree(self, wrapper, name, automation_id, control_type, depth, max_depth):
        """Recursively search the UIA tree for a matching element."""
        if depth > max_depth:
            return None
        try:
            children = wrapper.children()
        except Exception:
            return None
        for child in children:
            try:
                info = child.element_info
                child_name = info.name or ""
                child_type = info.control_type or ""
                child_auto_id = info.automation_id or ""

                match = True
                if automation_id and child_auto_id != automation_id:
                    match = False
                if name and name.lower() not in child_name.lower():
                    match = False
                if control_type and child_type != control_type:
                    match = False
                if match and (name or control_type or automation_id):
                    return child

                result = self._search_element_tree(
                    child, name, automation_id, control_type, depth + 1, max_depth,
                )
                if result:
                    return result
            except Exception:
                continue
        return None

    def _find_all_matches(self, win, name, automation_id, control_type):
        """Find all matching elements for disambiguation."""
        matches: list = []
        self._collect_matches(win, name, automation_id, control_type, matches, 0, 8)
        return matches

    def _collect_matches(self, wrapper, name, automation_id, control_type, matches, depth, max_depth):
        """Recursively collect all matching elements."""
        if depth > max_depth or len(matches) >= 10:
            return
        try:
            children = wrapper.children()
        except Exception:
            return
        for child in children:
            if len(matches) >= 10:
                return
            try:
                info = child.element_info
                child_name = info.name or ""
                child_type = info.control_type or ""
                child_auto_id = info.automation_id or ""

                match = True
                if automation_id and child_auto_id != automation_id:
                    match = False
                if name and name.lower() not in child_name.lower():
                    match = False
                if control_type and child_type != control_type:
                    match = False
                if match and (name or control_type or automation_id):
                    matches.append(child)

                self._collect_matches(
                    child, name, automation_id, control_type, matches, depth + 1, max_depth,
                )
            except Exception:
                continue

    def _execute_action(self, element, action: str, value: str | None) -> None:
        """Execute a UIA action on the found element."""
        if action == "click":
            # Prefer invoke() (programmatic, deterministic) over click_input() (moves real mouse)
            try:
                element.invoke()
            except Exception:
                element.click_input()
        elif action == "set_value":
            # Strategy: clipboard paste is preferred - it's fast (constant-time
            # regardless of text length), preserves newlines/tabs/unicode, and
            # works in file dialogs (Ctrl+V is a standard shortcut). Fall back
            # to type_keys() with with_newlines/with_tabs enabled so multi-line
            # text is still typed correctly if the clipboard path fails.
            # set_edit_text() is last-resort - file dialogs silently ignore it.
            try:
                element.set_focus()
            except Exception:
                pass

            val = value or ""
            pasted = False
            try:
                import pyperclip
                prev_clip = ""
                try:
                    prev_clip = pyperclip.paste()
                except Exception:
                    pass
                pyperclip.copy(val)
                element.type_keys("^a", pause=0.05)  # Select any existing text
                element.type_keys("^v", pause=0.05)  # Paste
                pasted = True
                # Restore the previous clipboard so we don't leak the pasted
                # value. Small delay to let WM_PASTE finish before we overwrite.
                try:
                    import time as _t
                    _t.sleep(0.15)
                    pyperclip.copy(prev_clip)
                except Exception:
                    pass
            except Exception:
                logger.info("set_value: clipboard paste unavailable, falling back to type_keys")

            if not pasted:
                safe_value = val.replace("{", "{{").replace("}", "}}")
                safe_value = safe_value.replace("+", "{+}").replace("^", "{^}").replace("%", "{%}")
                try:
                    element.type_keys("^a", pause=0.05)
                    element.type_keys(
                        safe_value,
                        with_spaces=True,
                        with_tabs=True,
                        with_newlines=True,
                        pause=0.01,
                    )
                except Exception:
                    element.set_edit_text(val)
        elif action == "toggle":
            element.toggle()
        elif action == "select":
            element.select()
        elif action == "expand":
            element.expand()
        elif action == "collapse":
            element.collapse()
        elif action == "focus":
            element.set_focus()
        else:
            raise ValueError(f"Unknown action: {action}")

    # -- Rich element tree (get_element_tree) --

    def get_element_tree(self, max_depth: int = 8) -> list[dict]:
        if not _HAS_PYWINAUTO:
            return []
        try:
            win = _get_top_window()
            if not win:
                return []
            elements: list[dict] = []
            self._walk_tree(win, elements, depth=0, max_depth=max_depth)
            return elements
        except Exception:
            logger.warning("Failed to get element tree via pywinauto")
            return []

    def _walk_tree(
        self, wrapper, elements: list[dict], depth: int, max_depth: int
    ) -> None:
        """Walk pywinauto tree collecting elements with state info."""
        if depth > max_depth or len(elements) >= MAX_ELEMENTS:
            return
        try:
            children = wrapper.children()
        except Exception:
            return
        for child in children:
            if len(elements) >= MAX_ELEMENTS:
                return
            try:
                info = child.element_info
                ctrl_type = info.control_type or ""
                if ctrl_type in _INTERACTIVE_TYPES:
                    rect = info.rectangle
                    bbox = None
                    if rect:
                        bbox = {"left": rect.left, "top": rect.top, "right": rect.right, "bottom": rect.bottom}
                    elements.append({
                        "name": info.name or "",
                        "type": ctrl_type,
                        "automation_id": info.automation_id or "",
                        "enabled": info.enabled,
                        "visible": info.visible,
                        "bbox": bbox,
                    })
                self._walk_tree(child, elements, depth + 1, max_depth)
            except Exception:
                continue

    # -- Window state management (ctypes user32) --

    # SW_MAXIMIZE = 3 in Windows API
    _SW_MAXIMIZE = 3

    class _WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [
            ("length", ctypes.wintypes.UINT),
            ("flags", ctypes.wintypes.UINT),
            ("showCmd", ctypes.wintypes.UINT),
            ("ptMinPosition", ctypes.wintypes.POINT),
            ("ptMaxPosition", ctypes.wintypes.POINT),
            ("rcNormalPosition", ctypes.wintypes.RECT),
        ]

    def _get_foreground_placement(self) -> tuple[int, int]:
        """Return (hwnd, showCmd) for the foreground window, or (0, 0) on failure."""
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return 0, 0
        wp = self._WINDOWPLACEMENT()
        wp.length = ctypes.sizeof(self._WINDOWPLACEMENT)
        ctypes.windll.user32.GetWindowPlacement(hwnd, ctypes.byref(wp))
        return hwnd, wp.showCmd

    def is_window_maximized(self) -> bool:
        try:
            _, show_cmd = self._get_foreground_placement()
            return show_cmd == self._SW_MAXIMIZE
        except Exception:
            logger.warning("Failed to check window maximized state via user32")
            return False

    def maximize_window(self) -> bool:
        try:
            hwnd, show_cmd = self._get_foreground_placement()
            if not hwnd:
                return False
            if show_cmd == self._SW_MAXIMIZE:
                return True  # Already maximized - idempotent
            return bool(ctypes.windll.user32.ShowWindow(hwnd, self._SW_MAXIMIZE))
        except Exception:
            logger.warning("Failed to maximize window via user32")
            return False

    # -- Window resize/snap + clipboard (expanded tools) --

    def _resolve_hwnd(self, title: str | None) -> int:
        """Resolve a window title to an hwnd. None = foreground window."""
        if title:
            win = _find_window_by_title(title)
            if win:
                try:
                    return win.handle
                except Exception:
                    pass
            return 0
        return ctypes.windll.user32.GetForegroundWindow()

    _SW_RESTORE = 9

    def resize_window(
        self,
        title: str | None,
        width: int,
        height: int,
        x: int | None = None,
        y: int | None = None,
    ) -> bool:
        try:
            hwnd = self._resolve_hwnd(title)
            if not hwnd:
                return False
            # Restore if maximized - MoveWindow doesn't work on maximized windows
            wp = self._WINDOWPLACEMENT()
            wp.length = ctypes.sizeof(self._WINDOWPLACEMENT)
            ctypes.windll.user32.GetWindowPlacement(hwnd, ctypes.byref(wp))
            if wp.showCmd == self._SW_MAXIMIZE:
                ctypes.windll.user32.ShowWindow(hwnd, self._SW_RESTORE)
            # If x/y not given, keep current position
            if x is None or y is None:
                rect = ctypes.wintypes.RECT()
                ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
                if x is None:
                    x = rect.left
                if y is None:
                    y = rect.top
            return bool(ctypes.windll.user32.MoveWindow(hwnd, x, y, width, height, True))
        except Exception:
            logger.warning("Failed to resize window via user32")
            return False

    def snap_window(self, title: str | None, layout: str) -> bool:
        if layout == "maximize":
            if title:
                win = _find_window_by_title(title)
                if win:
                    try:
                        win.set_focus()
                    except Exception:
                        pass
            return self.maximize_window()
        if layout == "restore":
            try:
                hwnd = self._resolve_hwnd(title)
                if not hwnd:
                    return False
                return bool(ctypes.windll.user32.ShowWindow(hwnd, self._SW_RESTORE))
            except Exception:
                return False
        try:
            hwnd = self._resolve_hwnd(title)
            if not hwnd:
                return False
            # Get screen work area (excludes taskbar)
            work_area = ctypes.wintypes.RECT()
            ctypes.windll.user32.SystemParametersInfoW(
                0x0030, 0, ctypes.byref(work_area), 0,  # SPI_GETWORKAREA
            )
            sw = work_area.right - work_area.left
            sh = work_area.bottom - work_area.top
            ox = work_area.left
            oy = work_area.top

            layouts = {
                "left_half": (ox, oy, sw // 2, sh),
                "right_half": (ox + sw // 2, oy, sw // 2, sh),
                "top_half": (ox, oy, sw, sh // 2),
                "bottom_half": (ox, oy + sh // 2, sw, sh // 2),
            }
            if layout not in layouts:
                logger.warning("Unknown snap layout: %s", layout)
                return False

            x, y, w, h = layouts[layout]
            # Restore if maximized
            wp = self._WINDOWPLACEMENT()
            wp.length = ctypes.sizeof(self._WINDOWPLACEMENT)
            ctypes.windll.user32.GetWindowPlacement(hwnd, ctypes.byref(wp))
            if wp.showCmd == self._SW_MAXIMIZE:
                ctypes.windll.user32.ShowWindow(hwnd, self._SW_RESTORE)
            return bool(ctypes.windll.user32.MoveWindow(hwnd, x, y, w, h, True))
        except Exception:
            logger.warning("Failed to snap window via user32")
            return False

    def clipboard_read(self) -> str:
        try:
            import pyperclip
            return pyperclip.paste()
        except Exception:
            logger.warning("Failed to read clipboard via pyperclip")
            return ""

    def clipboard_write(self, text: str) -> bool:
        try:
            import pyperclip
            pyperclip.copy(text)
            return True
        except Exception:
            logger.warning("Failed to write clipboard via pyperclip")
            return False
