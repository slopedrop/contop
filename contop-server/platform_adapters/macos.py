"""
macOS platform adapter — window management via pyobjc, accessibility via AXUIElement.

Falls back gracefully if pyobjc is not installed.

[Source: architecture.md — Cross-Platform OS Abstraction Layer, pyobjc]
"""
import logging
import subprocess

from .base import PlatformAdapter

logger = logging.getLogger(__name__)

_HAS_PYOBJC = False
_HAS_AX = False

try:
    from AppKit import NSWorkspace, NSRunningApplication
    _HAS_PYOBJC = True
except ImportError:
    logger.info("pyobjc not installed — MacOSAdapter will use fallback")

try:
    from ApplicationServices import (
        AXUIElementCreateSystemWide,
        AXUIElementCreateApplication,
    )
    _HAS_AX = True
except ImportError:
    logger.info("pyobjc Accessibility not available — accessibility methods will return empty results")

# Interactive AX roles to include in get_interactive_elements()
_INTERACTIVE_ROLES = {
    "AXButton", "AXTextField", "AXCheckBox", "AXRadioButton",
    "AXLink", "AXMenuItem", "AXPopUpButton", "AXComboBox",
    "AXSecureTextField", "AXTextArea",
}

MAX_ELEMENTS = 200


class MacOSAdapter(PlatformAdapter):
    """macOS window management using pyobjc (optional)."""

    def focus_window(self, title: str) -> bool:
        if not _HAS_PYOBJC:
            return False
        try:
            workspace = NSWorkspace.sharedWorkspace()
            for app in workspace.runningApplications():
                if title.lower() in (app.localizedName() or "").lower():
                    # Prefer modern activate() API (macOS 14+). Fall back to
                    # the deprecated activateWithOptions_ for older versions.
                    if hasattr(app, "activate"):
                        app.activate()
                    else:
                        app.activateWithOptions_(1 << 1)  # NSApplicationActivateIgnoringOtherApps
                    return True
        except Exception:
            logger.warning("Failed to focus window '%s' via pyobjc", title)
        return False

    def list_windows(self) -> list[str]:
        if not _HAS_PYOBJC:
            return []
        try:
            workspace = NSWorkspace.sharedWorkspace()
            return [
                app.localizedName()
                for app in workspace.runningApplications()
                if app.localizedName() and not app.isHidden()
            ]
        except Exception:
            logger.warning("Failed to list windows via pyobjc")
            return []

    # -- Accessibility API (pyobjc AXUIElement) --

    def get_foreground_window_name(self) -> str:
        if not _HAS_PYOBJC:
            return ""
        try:
            workspace = NSWorkspace.sharedWorkspace()
            app = workspace.frontmostApplication()
            return app.localizedName() if app else ""
        except Exception:
            logger.warning("Failed to get foreground window name via pyobjc")
            return ""

    def get_focused_element(self) -> dict:
        if not _HAS_AX:
            return {}
        try:
            system_wide = AXUIElementCreateSystemWide()
            err, focused = system_wide.copyAttributeValue_("AXFocusedUIElement", None)
            if err or not focused:
                return {}
            err_title, title = focused.copyAttributeValue_("AXTitle", None)
            err_role, role = focused.copyAttributeValue_("AXRole", None)
            err_sub, subrole = focused.copyAttributeValue_("AXSubrole", None)
            return {
                "name": (title or "") if not err_title else "",
                "type": (role or "") if not err_role else "",
                "automation_id": (subrole or "") if not err_sub else "",
                "class_name": "",
            }
        except Exception:
            logger.warning("Failed to get focused element via pyobjc AX API")
            return {}

    def get_interactive_elements(self, max_depth: int = 8) -> list[dict]:
        if not _HAS_AX or not _HAS_PYOBJC:
            return []
        try:
            workspace = NSWorkspace.sharedWorkspace()
            app = workspace.frontmostApplication()
            if not app:
                return []
            pid = app.processIdentifier()
            app_ref = AXUIElementCreateApplication(pid)
            elements: list[dict] = []
            self._walk_ax_children(app_ref, elements, depth=0, max_depth=max_depth)
            return elements
        except Exception:
            logger.warning("Failed to get interactive elements via pyobjc AX API")
            return []

    # -- Window state management (JXA via osascript) --

    _IS_MAXIMIZED_JXA = (
        'ObjC.import("AppKit");'
        "var vf=$.NSScreen.mainScreen.visibleFrame;"
        "var sw=vf.size.width;"
        "var sh=vf.size.height;"
        'var se=Application("System Events");'
        "var fp=se.processes.whose({frontmost:true})[0];"
        "var w=fp.windows[0];"
        "var ws=w.size();"
        '(ws[0]>=sw-20&&ws[1]>=sh-20)?"true":"false";'
    )

    _MAXIMIZE_JXA = (
        'ObjC.import("AppKit");'
        "var vf=$.NSScreen.mainScreen.visibleFrame;"
        "var ff=$.NSScreen.mainScreen.frame;"
        "var sw=vf.size.width;"
        "var sh=vf.size.height;"
        "var menuH=ff.size.height-sh-vf.origin.y;"
        'var se=Application("System Events");'
        "var fp=se.processes.whose({frontmost:true})[0];"
        "var w=fp.windows[0];"
        "w.position=[0,menuH];"
        "w.size=[sw,sh];"
        '"true";'
    )

    def is_window_maximized(self) -> bool:
        try:
            result = subprocess.run(
                ["osascript", "-l", "JavaScript", "-e", self._IS_MAXIMIZED_JXA],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode != 0:
                logger.warning("JXA is_maximized failed: %s", result.stderr.strip())
            return result.returncode == 0 and "true" in result.stdout.strip()
        except Exception:
            logger.warning("Failed to check window maximized state via JXA", exc_info=True)
            return False

    def maximize_window(self) -> bool:
        try:
            if self.is_window_maximized():
                return True  # Already maximized — idempotent
            result = subprocess.run(
                ["osascript", "-l", "JavaScript", "-e", self._MAXIMIZE_JXA],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode != 0:
                logger.warning("JXA maximize failed: %s", result.stderr.strip())
            return result.returncode == 0
        except Exception:
            logger.warning("Failed to maximize window via JXA", exc_info=True)
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
        if not _HAS_AX or not _HAS_PYOBJC:
            return super().interact_element(name, automation_id, control_type, action, value, window_title)

        try:
            if window_title:
                self.focus_window(window_title)

            workspace = NSWorkspace.sharedWorkspace()
            app = workspace.frontmostApplication()
            if not app:
                return {
                    "found": False, "status": "error",
                    "element_name": "", "element_type": "",
                    "action_performed": action,
                    "description": "No frontmost application found.",
                    "voice_message": "I can't find any active application.",
                }

            pid = app.processIdentifier()
            app_ref = AXUIElementCreateApplication(pid)

            # Search for the element in the AX tree
            element = self._find_ax_element(app_ref, name, automation_id, control_type)
            if element is None:
                return {
                    "found": False, "status": "error",
                    "element_name": name or "", "element_type": control_type or "",
                    "action_performed": action,
                    "description": f"Element not found: name={name}, type={control_type}.",
                    "voice_message": f"I couldn't find the {name or 'element'} in the current app.",
                }

            err_role, role = element.copyAttributeValue_("AXRole", None)
            err_title, title = element.copyAttributeValue_("AXTitle", None)
            elem_name = (title or "") if not err_title else ""
            elem_type = (role or "") if not err_role else ""

            # Execute action
            self._execute_ax_action(element, action, value)

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

    def _find_ax_element(self, root, name, automation_id, control_type, max_depth=5):
        """Recursively search for an AX element matching the criteria."""
        return self._search_ax_tree(root, name, automation_id, control_type, 0, max_depth)

    def _search_ax_tree(self, element, name, automation_id, control_type, depth, max_depth):
        if depth > max_depth:
            return None
        try:
            err, children = element.copyAttributeValue_("AXChildren", None)
            if err or not children:
                return None
            for child in children:
                try:
                    err_role, role = child.copyAttributeValue_("AXRole", None)
                    role_str = (role or "") if not err_role else ""
                    err_title, title = child.copyAttributeValue_("AXTitle", None)
                    err_desc, desc = child.copyAttributeValue_("AXDescription", None)
                    child_name = (title or "") if not err_title else ""
                    if not child_name:
                        child_name = (desc or "") if not err_desc else ""

                    # Check automation_id (AXIdentifier) if provided
                    err_id, ax_id = child.copyAttributeValue_("AXIdentifier", None)
                    child_id = (ax_id or "") if not err_id else ""

                    # Match criteria
                    match = True
                    if automation_id and child_id != automation_id:
                        match = False
                    if name and name.lower() not in child_name.lower():
                        match = False
                    if control_type and role_str != control_type:
                        match = False
                    if match and (name or control_type or automation_id):
                        return child

                    # Recurse
                    result = self._search_ax_tree(child, name, automation_id, control_type, depth + 1, max_depth)
                    if result:
                        return result
                except Exception:
                    logger.debug("AX tree walk error at depth %d", depth, exc_info=True)
                    continue
        except Exception:
            logger.debug("AX tree walk failed at depth %d", depth, exc_info=True)
        return None

    def _execute_ax_action(self, element, action: str, value: str | None) -> None:
        """Execute an AXUIElement action."""
        from ApplicationServices import AXUIElementPerformAction, AXUIElementSetAttributeValue

        if action == "click":
            AXUIElementPerformAction(element, "AXPress")
        elif action == "set_value":
            AXUIElementSetAttributeValue(element, "AXValue", value or "")
        elif action == "toggle":
            AXUIElementPerformAction(element, "AXPress")
        elif action == "focus":
            AXUIElementSetAttributeValue(element, "AXFocused", True)
        elif action in ("expand", "collapse", "select"):
            # Try the generic press action for these
            AXUIElementPerformAction(element, "AXPress")
        else:
            raise ValueError(f"Unknown action: {action}")

    # -- Window resize/snap + clipboard (expanded tools) --

    def resize_window(
        self,
        title: str | None,
        width: int,
        height: int,
        x: int | None = None,
        y: int | None = None,
    ) -> bool:
        try:
            parts = []
            if title:
                # Sanitize title for JXA string interpolation — escape backslashes and quotes
                safe_title = title.replace("\\", "\\\\").replace('"', '\\"')
                parts.append(f'var app=Application("{safe_title}");var w=app.windows[0];')
            else:
                parts.append(
                    'var se=Application("System Events");'
                    "var fp=se.processes.whose({frontmost:true})[0];"
                    "var w=fp.windows[0];"
                )
            if x is not None and y is not None:
                parts.append(f"w.position=[{x},{y}];")
            parts.append(f"w.size=[{width},{height}];")
            parts.append('"true";')
            jxa = "".join(parts)
            result = subprocess.run(
                ["osascript", "-l", "JavaScript", "-e", jxa],
                capture_output=True, text=True, timeout=5,
            )
            return result.returncode == 0
        except Exception:
            logger.warning("Failed to resize window via JXA")
            return False

    def snap_window(self, title: str | None, layout: str) -> bool:
        if layout == "maximize":
            if title:
                self.focus_window(title)
            return self.maximize_window()
        try:
            # Build JXA that computes screen geometry and sets bounds
            target = ""
            if title:
                safe_title = title.replace("\\", "\\\\").replace('"', '\\"')
                target = (
                    f'Application("System Events").processes.whose({{name:"{safe_title}"}})[0].windows[0]'
                )
            else:
                target = (
                    'Application("System Events").processes.whose({frontmost:true})[0].windows[0]'
                )
            jxa_layouts = {
                "left_half": "w.position=[vf.origin.x,menuH];w.size=[sw/2,sh];",
                "right_half": "w.position=[vf.origin.x+sw/2,menuH];w.size=[sw/2,sh];",
                "top_half": "w.position=[vf.origin.x,menuH];w.size=[sw,sh/2];",
                "bottom_half": "w.position=[vf.origin.x,menuH+sh/2];w.size=[sw,sh/2];",
                "restore": "w.position=[vf.origin.x+50,menuH+50];w.size=[sw*0.7,sh*0.7];",
            }
            if layout not in jxa_layouts:
                logger.warning("Unknown snap layout: %s", layout)
                return False
            jxa = (
                'ObjC.import("AppKit");'
                "var vf=$.NSScreen.mainScreen.visibleFrame;"
                "var ff=$.NSScreen.mainScreen.frame;"
                "var sw=vf.size.width;"
                "var sh=vf.size.height;"
                "var menuH=ff.size.height-sh-vf.origin.y;"
                f"var w={target};"
                f"{jxa_layouts[layout]}"
                '"true";'
            )
            result = subprocess.run(
                ["osascript", "-l", "JavaScript", "-e", jxa],
                capture_output=True, text=True, timeout=5,
            )
            return result.returncode == 0
        except Exception:
            logger.warning("Failed to snap window via JXA")
            return False

    def clipboard_read(self) -> str:
        try:
            result = subprocess.run(
                ["pbpaste"],
                capture_output=True, text=True, timeout=5,
            )
            return result.stdout if result.returncode == 0 else ""
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return ""
        except Exception:
            logger.warning("Failed to read clipboard via pbpaste")
            return ""

    def clipboard_write(self, text: str) -> bool:
        try:
            result = subprocess.run(
                ["pbcopy"],
                input=text, text=True, timeout=5,
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
        except Exception:
            logger.warning("Failed to write clipboard via pbcopy")
            return False

    def _walk_ax_children(
        self, element, elements: list[dict], depth: int, max_depth: int
    ) -> None:
        """Recursively walk AXUIElement tree collecting interactive elements."""
        if depth > max_depth or len(elements) >= MAX_ELEMENTS:
            return
        try:
            err, children = element.copyAttributeValue_("AXChildren", None)
            if err or not children:
                return
            for child in children:
                if len(elements) >= MAX_ELEMENTS:
                    return
                try:
                    err_role, role = child.copyAttributeValue_("AXRole", None)
                    role_str = (role or "") if not err_role else ""
                    if role_str in _INTERACTIVE_ROLES:
                        err_title, title = child.copyAttributeValue_("AXTitle", None)
                        err_desc, desc = child.copyAttributeValue_("AXDescription", None)
                        name = (title or "") if not err_title else ""
                        if not name:
                            name = (desc or "") if not err_desc else ""
                        elements.append({
                            "name": name,
                            "type": role_str,
                            "automation_id": "",
                        })
                    self._walk_ax_children(child, elements, depth + 1, max_depth)
                except Exception:
                    continue
        except Exception:
            return
