"""
Linux platform adapter — window management via pyatspi.

Falls back gracefully if pyatspi is not installed.

[Source: architecture.md — Cross-Platform OS Abstraction Layer, pyatspi]
"""
import logging
import subprocess

from .base import PlatformAdapter

logger = logging.getLogger(__name__)

try:
    import pyatspi
    _HAS_PYATSPI = True
except ImportError:
    _HAS_PYATSPI = False
    logger.info("pyatspi not installed — LinuxAdapter will use fallback")


class LinuxAdapter(PlatformAdapter):
    """Linux window management using pyatspi or wmctrl fallback."""

    def focus_window(self, title: str) -> bool:
        # Try wmctrl first (more reliable for window focus)
        try:
            result = subprocess.run(
                ["wmctrl", "-a", title],
                capture_output=True, timeout=5,
            )
            if result.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        # pyatspi can confirm a window exists but cannot bring it to the
        # foreground — return False to indicate the focus was not performed.
        return False

    def list_windows(self) -> list[str]:
        # Try wmctrl first
        try:
            result = subprocess.run(
                ["wmctrl", "-l"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                titles = []
                for line in result.stdout.strip().split("\n"):
                    parts = line.split(None, 3)
                    if len(parts) >= 4:
                        titles.append(parts[3])
                return titles
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        if not _HAS_PYATSPI:
            return []

        try:
            desktop = pyatspi.Registry.getDesktop(0)
            return [app.name for app in desktop if app.name]
        except Exception:
            logger.warning("Failed to list windows via pyatspi")
            return []

    # -- Accessibility API (pyatspi / xdotool fallback) --

    def get_foreground_window_name(self) -> str:
        # Try xdotool first (lightweight, doesn't need pyatspi)
        try:
            result = subprocess.run(
                ["xdotool", "getactivewindow", "getwindowname"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        if not _HAS_PYATSPI:
            return ""

        try:
            desktop = pyatspi.Registry.getDesktop(0)
            for app in desktop:
                if app.getState().contains(pyatspi.STATE_ACTIVE):
                    return app.name or ""
            # Fallback: return first app with a focused widget
            for app in desktop:
                try:
                    for i in range(app.childCount):
                        child = app.getChildAtIndex(i)
                        if child and child.getState().contains(pyatspi.STATE_ACTIVE):
                            return app.name or ""
                except Exception:
                    continue
        except Exception:
            logger.warning("Failed to get foreground window name via pyatspi")
        return ""

    def get_focused_element(self) -> dict:
        if not _HAS_PYATSPI:
            return {}
        try:
            desktop = pyatspi.Registry.getDesktop(0)
            for app in desktop:
                try:
                    for i in range(app.childCount):
                        frame = app.getChildAtIndex(i)
                        if not frame:
                            continue
                        focused = self._find_focused(frame)
                        if focused:
                            return {
                                "name": focused.name or "",
                                "type": focused.getRoleName() or "",
                                "automation_id": "",
                                "class_name": "",
                            }
                except Exception:
                    continue
        except Exception:
            logger.warning("Failed to get focused element via pyatspi")
        return {}

    def _find_focused(self, element):
        """Recursively find the focused element in the AT-SPI2 tree."""
        try:
            if element.getState().contains(pyatspi.STATE_FOCUSED):
                return element
            for i in range(element.childCount):
                child = element.getChildAtIndex(i)
                if child:
                    result = self._find_focused(child)
                    if result:
                        return result
        except Exception:
            pass
        return None

    # -- Window state management (xdotool + xprop / wmctrl) --

    def is_window_maximized(self) -> bool:
        try:
            wid_result = subprocess.run(
                ["xdotool", "getactivewindow"],
                capture_output=True, text=True, timeout=5,
            )
            if wid_result.returncode != 0:
                return False
            wid = wid_result.stdout.strip()

            # Check _NET_WM_STATE for maximized atoms via xprop
            prop_result = subprocess.run(
                ["xprop", "-id", wid, "_NET_WM_STATE"],
                capture_output=True, text=True, timeout=5,
            )
            if prop_result.returncode != 0:
                return False
            state = prop_result.stdout
            return (
                "_NET_WM_STATE_MAXIMIZED_VERT" in state
                and "_NET_WM_STATE_MAXIMIZED_HORZ" in state
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        except Exception:
            logger.warning("Failed to check window maximized state")
        return False

    def maximize_window(self) -> bool:
        if self.is_window_maximized():
            return True  # Already maximized — idempotent

        # wmctrl adds both maximized atoms in one call
        try:
            result = subprocess.run(
                ["wmctrl", "-r", ":ACTIVE:", "-b", "add,maximized_vert,maximized_horz"],
                capture_output=True, timeout=5,
            )
            if result.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        # Fallback: xdotool key super+Up (works on some WMs like GNOME/KDE)
        try:
            result = subprocess.run(
                ["xdotool", "key", "super+Up"],
                capture_output=True, timeout=5,
            )
            if result.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        except Exception:
            logger.warning("Failed to maximize window")
        return False

    # -- Window resize/snap + clipboard (expanded tools) --

    def resize_window(
        self,
        title: str | None,
        width: int,
        height: int,
        x: int | None = None,
        y: int | None = None,
    ) -> bool:
        # Try wmctrl first
        target = title or ":ACTIVE:"
        try:
            move_x = x if x is not None else -1  # wmctrl uses -1 for "keep current"
            move_y = y if y is not None else -1
            result = subprocess.run(
                ["wmctrl", "-r", target, "-e", f"0,{move_x},{move_y},{width},{height}"],
                capture_output=True, timeout=5,
            )
            if result.returncode == 0:
                return True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        # Fallback: xdotool
        try:
            cmds = ["xdotool", "getactivewindow"]
            if x is not None and y is not None:
                cmds += ["windowmove", str(x), str(y)]
            cmds += ["windowsize", str(width), str(height)]
            result = subprocess.run(cmds, capture_output=True, timeout=5)
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        except Exception:
            logger.warning("Failed to resize window")
        return False

    def snap_window(self, title: str | None, layout: str) -> bool:
        if layout == "maximize":
            if title:
                self.focus_window(title)
            return self.maximize_window()
        if layout == "restore":
            try:
                target = title or ":ACTIVE:"
                result = subprocess.run(
                    ["wmctrl", "-r", target, "-b", "remove,maximized_vert,maximized_horz"],
                    capture_output=True, timeout=5,
                )
                return result.returncode == 0
            except (FileNotFoundError, subprocess.TimeoutExpired):
                return False

        try:
            # Get screen geometry
            geo_result = subprocess.run(
                ["xdotool", "getdisplaygeometry"],
                capture_output=True, text=True, timeout=5,
            )
            if geo_result.returncode != 0:
                return False
            parts = geo_result.stdout.strip().split()
            if len(parts) < 2:
                return False
            sw, sh = int(parts[0]), int(parts[1])

            layouts = {
                "left_half": (0, 0, sw // 2, sh),
                "right_half": (sw // 2, 0, sw // 2, sh),
                "top_half": (0, 0, sw, sh // 2),
                "bottom_half": (0, sh // 2, sw, sh // 2),
            }
            if layout not in layouts:
                logger.warning("Unknown snap layout: %s", layout)
                return False

            x, y, w, h = layouts[layout]
            target = title or ":ACTIVE:"
            # Remove maximize state first
            subprocess.run(
                ["wmctrl", "-r", target, "-b", "remove,maximized_vert,maximized_horz"],
                capture_output=True, timeout=5,
            )
            result = subprocess.run(
                ["wmctrl", "-r", target, "-e", f"0,{x},{y},{w},{h}"],
                capture_output=True, timeout=5,
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        except Exception:
            logger.warning("Failed to snap window")
        return False

    def clipboard_read(self) -> str:
        # Try xclip (X11), then xsel (X11), then wl-paste (Wayland)
        for cmd in [
            ["xclip", "-selection", "clipboard", "-o"],
            ["xsel", "--clipboard", "--output"],
            ["wl-paste"],
        ]:
            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=5,
                )
                if result.returncode == 0:
                    return result.stdout
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
            except Exception:
                continue
        logger.warning("Failed to read clipboard — no clipboard tool found")
        return ""

    def clipboard_write(self, text: str) -> bool:
        # Try xclip (X11), then xsel (X11), then wl-copy (Wayland)
        for cmd in [
            ["xclip", "-selection", "clipboard"],
            ["xsel", "--clipboard", "--input"],
            ["wl-copy"],
        ]:
            try:
                result = subprocess.run(
                    cmd, input=text, text=True, timeout=5,
                )
                if result.returncode == 0:
                    return True
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
            except Exception:
                continue
        logger.warning("Failed to write clipboard — no clipboard tool found")
        return False

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
        if not _HAS_PYATSPI:
            return super().interact_element(name, automation_id, control_type, action, value, window_title)

        try:
            if window_title:
                self.focus_window(window_title)

            desktop = pyatspi.Registry.getDesktop(0)
            # Find the active app's frame
            active_frame = None
            for app in desktop:
                try:
                    for i in range(app.childCount):
                        frame = app.getChildAtIndex(i)
                        if frame and frame.getState().contains(pyatspi.STATE_ACTIVE):
                            active_frame = frame
                            break
                    if active_frame:
                        break
                except Exception:
                    continue

            if not active_frame:
                return {
                    "found": False, "status": "error",
                    "element_name": "", "element_type": "",
                    "action_performed": action,
                    "description": "No active window found.",
                    "voice_message": "I can't find any active window.",
                }

            # Search for the element
            element = self._find_atspi_element(active_frame, name, automation_id, control_type)
            if element is None:
                return {
                    "found": False, "status": "error",
                    "element_name": name or "", "element_type": control_type or "",
                    "action_performed": action,
                    "description": f"Element not found: name={name}, type={control_type}.",
                    "voice_message": f"I couldn't find the {name or 'element'} in the current window.",
                }

            elem_name = element.name or ""
            elem_type = element.getRoleName() or ""

            # Execute action
            self._execute_atspi_action(element, action, value)

            return {
                "found": True, "status": "success",
                "element_name": elem_name, "element_type": elem_type,
                "action_performed": action,
                "description": f"Successfully performed '{action}' on '{elem_name}' ({elem_type}).",
                "voice_message": f"Done — {action} on {elem_name}.",
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

    def _find_atspi_element(self, root, name, automation_id, control_type, max_depth=5):
        """Search AT-SPI2 tree for an element matching name, automation_id, and/or role."""
        return self._search_atspi_tree(root, name, automation_id, control_type, 0, max_depth)

    def _search_atspi_tree(self, element, name, automation_id, control_type, depth, max_depth):
        if depth > max_depth:
            return None
        try:
            for i in range(element.childCount):
                child = element.getChildAtIndex(i)
                if not child:
                    continue
                try:
                    child_name = child.name or ""
                    child_role = child.getRoleName() or ""

                    match = True
                    if automation_id:
                        # AT-SPI2 doesn't have a standard automation_id, but some
                        # toolkits expose it via accessible description or object path
                        try:
                            child_desc = child.description or ""
                        except Exception:
                            child_desc = ""
                        if automation_id != child_desc:
                            match = False
                    if name and name.lower() not in child_name.lower():
                        match = False
                    if control_type and child_role != control_type:
                        match = False
                    if match and (name or control_type or automation_id):
                        return child

                    result = self._search_atspi_tree(child, name, automation_id, control_type, depth + 1, max_depth)
                    if result:
                        return result
                except Exception:
                    logger.debug("AT-SPI2 tree walk error at depth %d", depth, exc_info=True)
                    continue
        except Exception:
            logger.debug("AT-SPI2 tree walk failed at depth %d", depth, exc_info=True)
        return None

    def _execute_atspi_action(self, element, action: str, value: str | None) -> None:
        """Execute an AT-SPI2 action on the element."""
        if action == "click":
            action_iface = element.queryAction()
            action_iface.doAction(0)  # Primary action (usually click/activate)
        elif action == "set_value":
            editable = element.queryEditableText()
            editable.setTextContents(value or "")
        elif action == "toggle":
            action_iface = element.queryAction()
            action_iface.doAction(0)
        elif action == "focus":
            component = element.queryComponent()
            component.grabFocus()
        elif action in ("expand", "collapse", "select"):
            action_iface = element.queryAction()
            action_iface.doAction(0)
        else:
            raise ValueError(f"Unknown action: {action}")

    _INTERACTIVE_ROLES = {
        pyatspi.ROLE_PUSH_BUTTON,
        pyatspi.ROLE_TEXT,
        pyatspi.ROLE_CHECK_BOX,
        pyatspi.ROLE_RADIO_BUTTON,
        pyatspi.ROLE_LINK,
        pyatspi.ROLE_MENU_ITEM,
        pyatspi.ROLE_COMBO_BOX,
        pyatspi.ROLE_LIST_ITEM,
        pyatspi.ROLE_PAGE_TAB,
    } if _HAS_PYATSPI else set()

    MAX_ELEMENTS = 200

    def get_interactive_elements(self, max_depth: int = 8) -> list[dict]:
        if not _HAS_PYATSPI:
            return []
        try:
            desktop = pyatspi.Registry.getDesktop(0)
            # Find the active application
            for app in desktop:
                try:
                    for i in range(app.childCount):
                        frame = app.getChildAtIndex(i)
                        if frame and frame.getState().contains(pyatspi.STATE_ACTIVE):
                            elements: list[dict] = []
                            self._walk_atspi_children(frame, elements, 0, max_depth)
                            return elements
                except Exception:
                    continue
        except Exception:
            logger.warning("Failed to get interactive elements via pyatspi")
        return []

    def _walk_atspi_children(
        self, element, elements: list[dict], depth: int, max_depth: int
    ) -> None:
        """Recursively walk AT-SPI2 tree collecting interactive elements."""
        if depth > max_depth or len(elements) >= self.MAX_ELEMENTS:
            return
        try:
            for i in range(element.childCount):
                if len(elements) >= self.MAX_ELEMENTS:
                    return
                child = element.getChildAtIndex(i)
                if not child:
                    continue
                try:
                    role = child.getRole()
                    if role in self._INTERACTIVE_ROLES:
                        elements.append({
                            "name": child.name or "",
                            "type": child.getRoleName() or "",
                            "automation_id": "",
                        })
                    self._walk_atspi_children(child, elements, depth + 1, max_depth)
                except Exception:
                    continue
        except Exception:
            return
