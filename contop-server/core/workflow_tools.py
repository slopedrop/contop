"""
Workflow tools — deterministic multi-step workflows exposed as single tool calls.

These are NOT LLM-driven — they orchestrate existing primitives with deterministic
branching/conditions. The LLM decides *what* to do; the workflow handles *how*.

All tools follow the standard async pattern: async def, dict return with
status field, logger.info at entry, try/except with logger.exception.
"""
import asyncio
import json
import logging
import os
import platform
import re
import shlex
import time as _time

logger = logging.getLogger(__name__)

# Pattern for validating shell-safe identifiers (app names, env var names)
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._\-+/ ]+$")

# Platform detection
_PLATFORM = platform.system()
_MODIFIER = "command" if _PLATFORM == "Darwin" else "ctrl"


async def save_dialog(file_path: str, file_type: str = "") -> dict:
    """Automate a Save As dialog — open dialog, enter path, click Save.

    Orchestrates execute_gui, wait, get_ui_context, and execute_accessible
    to complete a Save As workflow without LLM involvement.

    Args:
        file_path: Full path to save the file to.
        file_type: Optional file type to select in the dropdown.

    Returns dict with status, saved_path, steps_taken.
    """
    logger.info("save_dialog called: file_path=%s, file_type=%s", file_path, file_type)
    start = _time.monotonic()
    steps = 0
    try:
        from core.agent_tools import execute_gui, wait, get_ui_context, execute_accessible

        # Step 1: Send Ctrl+Shift+S (Save As) then fallback to Ctrl+S
        await execute_gui(action="hotkey", coordinates=json.dumps({"keys": [_MODIFIER, "shift", "s"]}))
        steps += 1
        await wait(2)
        steps += 1

        # Step 2: Look for Save As dialog
        dialog_title = None
        for title in ["Save As", "Save", "Browse"]:
            ctx = await get_ui_context(window_title=title)
            steps += 1
            if isinstance(ctx, dict) and ctx.get("interactive_elements"):
                dialog_title = title
                break

        if not dialog_title:
            # Fallback: try Ctrl+S which might open Save As for unsaved files
            await execute_gui(action="hotkey", coordinates=json.dumps({"keys": [_MODIFIER, "s"]}))
            steps += 1
            await wait(2)
            steps += 1
            for title in ["Save As", "Save", "Browse"]:
                ctx = await get_ui_context(window_title=title)
                steps += 1
                if isinstance(ctx, dict) and ctx.get("interactive_elements"):
                    dialog_title = title
                    break

        if not dialog_title:
            return {
                "status": "error",
                "description": "Could not find a Save dialog. The app may not support Ctrl+S/Ctrl+Shift+S.",
                "steps_taken": steps,
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "I couldn't open the save dialog.",
            }

        # Step 3: Set the file path in the filename field
        result = await execute_accessible(
            action="set_value", element_name="File name:", value=file_path,
            window_title=dialog_title,
        )
        steps += 1

        # Step 4: If file_type given, handle the type dropdown
        if file_type:
            await execute_accessible(
                action="click", element_name="Save as type:",
                window_title=dialog_title,
            )
            steps += 1
            await wait(0.5)
            await execute_accessible(
                action="click", element_name=file_type,
                window_title=dialog_title,
            )
            steps += 1

        # Step 5: Click Save
        await execute_accessible(
            action="click", element_name="Save",
            window_title=dialog_title,
        )
        steps += 1
        await wait(1)
        steps += 1

        return {
            "status": "success",
            "saved_path": file_path,
            "steps_taken": steps,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("save_dialog failed")
        return {
            "status": "error",
            "description": str(exc),
            "steps_taken": steps,
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "The save dialog workflow failed.",
        }


async def open_dialog(file_path: str) -> dict:
    """Automate an Open dialog — open dialog, enter path, click Open.

    Args:
        file_path: Full path of the file to open.

    Returns dict with status, opened_path, steps_taken.
    """
    logger.info("open_dialog called: file_path=%s", file_path)
    start = _time.monotonic()
    steps = 0
    try:
        from core.agent_tools import execute_gui, wait, get_ui_context, execute_accessible

        # Step 1: Ctrl+O
        await execute_gui(action="hotkey", coordinates=json.dumps({"keys": [_MODIFIER, "o"]}))
        steps += 1
        await wait(2)
        steps += 1

        # Step 2: Find Open dialog
        dialog_title = None
        for title in ["Open", "Browse"]:
            ctx = await get_ui_context(window_title=title)
            steps += 1
            if isinstance(ctx, dict) and ctx.get("interactive_elements"):
                dialog_title = title
                break

        if not dialog_title:
            return {
                "status": "error",
                "description": "Could not find an Open dialog.",
                "steps_taken": steps,
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "I couldn't open the file dialog.",
            }

        # Step 3: Set file path
        await execute_accessible(
            action="set_value", element_name="File name:", value=file_path,
            window_title=dialog_title,
        )
        steps += 1

        # Step 4: Click Open
        await execute_accessible(
            action="click", element_name="Open",
            window_title=dialog_title,
        )
        steps += 1
        await wait(1)
        steps += 1

        return {
            "status": "success",
            "opened_path": file_path,
            "steps_taken": steps,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("open_dialog failed")
        return {
            "status": "error",
            "description": str(exc),
            "steps_taken": steps,
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "The open dialog workflow failed.",
        }


async def find_and_replace_in_files(
    path: str, pattern: str, old_text: str, new_text: str, dry_run: bool = True
) -> dict:
    """Find and replace text across multiple files.

    Args:
        path: Directory to search in.
        pattern: Glob pattern for filenames (e.g., "*.py").
        old_text: Text to find.
        new_text: Text to replace with.
        dry_run: If True, only report what would change, don't write.

    Returns dict with status, files_modified, total_replacements, changes, dry_run.
    """
    logger.info(
        "find_and_replace_in_files called: path=%s, pattern=%s, dry_run=%s",
        path, pattern, dry_run,
    )
    start = _time.monotonic()
    try:
        from core.file_tools import find_files as _find, read_file as _read, edit_file as _edit

        # Find matching files
        found = await _find(pattern=pattern, search_text=old_text, path=path)
        if found.get("status") != "success" or not found.get("matches"):
            return {
                "status": "success",
                "files_modified": 0,
                "total_replacements": 0,
                "changes": [],
                "dry_run": dry_run,
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

        # Get unique file paths
        file_paths = list({m["path"] for m in found["matches"] if "path" in m})
        changes = []
        total_replacements = 0

        for fp in file_paths:
            # Read the file (required before editing)
            await _read(fp)
            # Count occurrences
            import pathlib
            content = pathlib.Path(fp).read_text("utf-8", errors="replace")
            count = content.count(old_text)
            if count == 0:
                continue

            changes.append({"path": fp, "count": count})
            total_replacements += count

            if not dry_run:
                await _edit(fp, old_text, new_text, replace_all=True)

        return {
            "status": "success",
            "files_modified": len(changes),
            "total_replacements": total_replacements,
            "changes": changes,
            "dry_run": dry_run,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("find_and_replace_in_files failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "The find and replace operation failed.",
        }


async def launch_app(name: str, wait_ready: bool = True) -> dict:
    """Launch an application and wait for its window to appear.

    Args:
        name: Application name (e.g., "notepad", "Chrome", "TextEdit").
        wait_ready: If True, poll until the app window appears (up to 10s).

    Returns dict with status, window_title, wait_seconds.
    """
    logger.info("launch_app called: name=%s, wait_ready=%s", name, wait_ready)
    start = _time.monotonic()
    try:
        if not _SAFE_NAME_RE.match(name):
            return {
                "status": "error",
                "description": f"Invalid app name: {name!r}. Only alphanumeric, dots, hyphens, underscores, plus, slashes, and spaces are allowed.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "That app name contains invalid characters.",
            }

        from core.agent_tools import execute_cli
        from core.window_tools import window_list as _wl, window_focus as _wf

        # Build platform-specific launch command (name validated above)
        if _PLATFORM == "Windows":
            # Commands run through Git Bash, so cmd.exe built-ins like
            # `start` must be invoked via `cmd.exe /c`.  Neither `start`
            # nor PowerShell `Start-Process` return meaningful exit codes
            # (both return 0 even on failure), so we use a window-list
            # snapshot to detect whether a new window actually appeared.
            launched = False
            name_lower = name.lower()

            # Snapshot window titles before launch attempt
            pre_windows = set()
            pre_wl = await _wl()
            if pre_wl.get("status") == "success":
                pre_windows = set(pre_wl.get("windows", []))

            async def _check_new_window() -> bool:
                """Quick poll (up to 3s) to see if a new window appeared."""
                for _ in range(3):
                    await asyncio.sleep(1)
                    post_wl = await _wl()
                    if post_wl.get("status") == "success":
                        for title in post_wl.get("windows", []):
                            if title not in pre_windows and name_lower in title.lower():
                                return True
                return False

            # 1. Try cmd.exe start (works for .exe apps on PATH:
            #    notepad, chrome, calc, etc.)
            await execute_cli(
                command=f'cmd.exe /c start "" "{name}"'
            )
            if await _check_new_window():
                launched = True

            if not launched:
                # 2. Try URI scheme via PowerShell (works for UWP/Store apps:
                #    whatsapp:, spotify:, slack:, etc.)
                uri_name = name_lower.replace(" ", "")
                await execute_cli(
                    command=f"powershell -Command 'Start-Process \"{uri_name}:\"'"
                )
                if await _check_new_window():
                    launched = True
        elif _PLATFORM == "Darwin":
            cmd = f'open -a {shlex.quote(name)}'
            await execute_cli(command=cmd)
        else:
            # Linux: try multiple strategies — not all apps have a PATH binary.
            launched = False
            # 1. Try direct command (works for apps on PATH)
            which_result = await execute_cli(command=f'which {shlex.quote(name.lower())}')
            if which_result.get("status") == "success" and which_result.get("output", "").strip():
                await execute_cli(command=f'{shlex.quote(name.lower())} &')
                launched = True
            if not launched:
                # 2. Try gtk-launch (works for .desktop file apps)
                gtk_result = await execute_cli(command=f'gtk-launch {shlex.quote(name.lower())}')
                if gtk_result.get("status") == "success":
                    launched = True
            if not launched:
                # 3. Try flatpak
                flatpak_result = await execute_cli(command=f'flatpak run com.{name.lower()}.{name} 2>/dev/null || flatpak run org.{name.lower()}.{name}')
                if flatpak_result.get("status") == "success":
                    launched = True
            if not launched:
                # 4. Try snap
                snap_result = await execute_cli(command=f'snap run {shlex.quote(name.lower())}')
                if snap_result.get("status") == "success":
                    launched = True
            if not launched:
                # 5. Final fallback — xdg-open (for URI-scheme apps)
                await execute_cli(command=f'xdg-open {name.lower()}:')

        if not wait_ready:
            return {
                "status": "success",
                "window_title": "",
                "wait_seconds": 0,
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

        # Poll for window to appear — try both exact name and common variants
        matched_title = ""
        name_lower = name.lower()
        # Some apps use different window titles (e.g., "WhatsApp" → "WhatsApp Desktop")
        search_terms = [name_lower]
        # Add without spaces for compound names
        no_space = name_lower.replace(" ", "")
        if no_space != name_lower:
            search_terms.append(no_space)

        poll_start = _time.monotonic()
        while _time.monotonic() - poll_start < 10:
            await asyncio.sleep(1)
            wl_result = await _wl()
            if wl_result.get("status") == "success":
                for title in wl_result.get("windows", []):
                    title_lower = title.lower()
                    for term in search_terms:
                        if term in title_lower:
                            matched_title = title
                            break
                    if matched_title:
                        break
            if matched_title:
                break

        if matched_title:
            await _wf(matched_title)
            from core.agent_tools import maximize_active_window
            await maximize_active_window()
        else:
            # Window title didn't match but the app may still have launched.
            # Check if a process with the name exists and try to focus it.
            from core.agent_tools import process_info as _pi
            pi_result = await _pi(name=name)
            if pi_result.get("status") == "success" and pi_result.get("processes"):
                # Process is running — try focusing via partial title match
                wl_result = await _wl()
                if wl_result.get("status") == "success":
                    for title in wl_result.get("windows", []):
                        # Broader match: check if any word from the app name appears
                        for word in name_lower.split():
                            if len(word) >= 3 and word in title.lower():
                                matched_title = title
                                break
                        if matched_title:
                            break
                if matched_title:
                    await _wf(matched_title)
                    from core.agent_tools import maximize_active_window
                    await maximize_active_window()

        return {
            "status": "success",
            "window_title": matched_title,
            "wait_seconds": round(_time.monotonic() - poll_start, 1),
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("launch_app failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't launch {name}.",
        }


async def install_app(name: str, method: str = "auto") -> dict:
    """Install an application using the system package manager.

    Args:
        name: Package/app name to install.
        method: "auto" (detect), "winget", "brew", "apt", "snap", "flatpak".

    Returns dict with status, installed, method, version.
    """
    logger.info("install_app called: name=%s, method=%s", name, method)
    start = _time.monotonic()
    try:
        if not _SAFE_NAME_RE.match(name):
            return {
                "status": "error",
                "description": f"Invalid package name: {name!r}. Only alphanumeric, dots, hyphens, underscores, plus, slashes, and spaces are allowed.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "That package name contains invalid characters.",
            }

        from core.agent_tools import execute_cli

        if method == "auto":
            if _PLATFORM == "Windows":
                method = "winget"
            elif _PLATFORM == "Darwin":
                method = "brew"
            else:
                method = "apt"

        safe_name = shlex.quote(name)
        install_cmds = {
            "winget": f"winget install --accept-package-agreements --accept-source-agreements {safe_name}",
            "brew": f"brew install {safe_name}",
            "apt": f"sudo apt install -y {safe_name}",
            "snap": f"sudo snap install {safe_name}",
            "flatpak": f"flatpak install -y {safe_name}",
        }

        cmd = install_cmds.get(method)
        if not cmd:
            return {
                "status": "error",
                "description": f"Unknown install method: {method}",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": f"I don't know the install method '{method}'.",
            }

        result = await execute_cli(command=cmd)

        installed = isinstance(result, dict) and result.get("status") == "success"

        return {
            "status": "success" if installed else "error",
            "installed": installed,
            "method": method,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("install_app failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't install {name}.",
        }


async def close_app(name: str, save: bool = False) -> dict:
    """Close an application, optionally saving first.

    Args:
        name: Application/window name to close.
        save: If True, send Ctrl+S before closing.

    Returns dict with status, closed, saved.
    """
    logger.info("close_app called: name=%s, save=%s", name, save)
    start = _time.monotonic()
    try:
        from core.agent_tools import execute_gui, wait, get_ui_context
        from core.window_tools import window_list as _wl, window_focus as _wf

        # Find the window
        wl = await _wl()
        matched = ""
        for title in wl.get("windows", []):
            if name.lower() in title.lower():
                matched = title
                break

        if not matched:
            return {
                "status": "error",
                "description": f"Window '{name}' not found.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": f"I couldn't find {name}.",
            }

        await _wf(matched)

        # Save if requested
        if save:
            await execute_gui(action="hotkey", coordinates=json.dumps({"keys": [_MODIFIER, "s"]}))
            await wait(1)

        # Close with Alt+F4
        await execute_gui(action="hotkey", coordinates=json.dumps({"keys": ["alt", "F4"]}))
        await wait(1)

        # Check for "save changes?" dialog
        ctx = await get_ui_context()
        if isinstance(ctx, dict):
            elements = ctx.get("interactive_elements", [])
            for elem in elements:
                elem_name = elem.get("name", "").lower()
                if "don't save" in elem_name or "dont save" in elem_name:
                    if not save:
                        from core.agent_tools import execute_accessible
                        await execute_accessible(action="click", element_name=elem["name"])
                        break
                elif "save" in elem_name and save:
                    from core.agent_tools import execute_accessible
                    await execute_accessible(action="click", element_name=elem["name"])
                    break

        return {
            "status": "success",
            "closed": True,
            "saved": save,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("close_app failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't close {name}.",
        }


async def app_menu(app_name: str, menu_path: str) -> dict:
    """Navigate an application's menu bar.

    Args:
        app_name: Application name (to focus it first).
        menu_path: Menu path separated by " > " (e.g., "File > Export > PDF").

    Returns dict with status, navigated, steps_taken.
    """
    logger.info("app_menu called: app_name=%s, menu_path=%s", app_name, menu_path)
    start = _time.monotonic()
    steps = 0
    try:
        from core.agent_tools import execute_accessible, wait, get_ui_context
        from core.window_tools import window_focus as _wf

        await _wf(app_name)
        steps += 1

        menu_items = [item.strip() for item in menu_path.split(">")]

        for item in menu_items:
            result = await execute_accessible(action="click", element_name=item)
            steps += 1
            await wait(0.5)
            steps += 1

        return {
            "status": "success",
            "navigated": menu_path,
            "steps_taken": steps,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("app_menu failed")
        return {
            "status": "error",
            "description": str(exc),
            "steps_taken": steps,
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't navigate the menu {menu_path}.",
        }


async def copy_between_apps(
    source_app: str, target_app: str, select_all: bool = True
) -> dict:
    """Copy content from one application to another via clipboard.

    Args:
        source_app: Source application window name.
        target_app: Target application window name.
        select_all: If True, select all content before copying.

    Returns dict with status, source, target.
    """
    logger.info(
        "copy_between_apps called: source=%s, target=%s, select_all=%s",
        source_app, target_app, select_all,
    )
    start = _time.monotonic()
    try:
        from core.agent_tools import execute_gui, wait
        from core.window_tools import window_focus as _wf

        await _wf(source_app)
        await wait(0.5)

        if select_all:
            await execute_gui(action="hotkey", coordinates=json.dumps({"keys": [_MODIFIER, "a"]}))
            await wait(0.3)

        await execute_gui(action="hotkey", coordinates=json.dumps({"keys": [_MODIFIER, "c"]}))
        await wait(0.5)

        await _wf(target_app)
        await wait(0.5)

        await execute_gui(action="hotkey", coordinates=json.dumps({"keys": [_MODIFIER, "v"]}))

        return {
            "status": "success",
            "source": source_app,
            "target": target_app,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("copy_between_apps failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't copy between {source_app} and {target_app}.",
        }


async def fill_form(fields: str) -> dict:
    """Fill a form by setting field values via accessibility tree.

    Args:
        fields: JSON string of fields to fill, e.g.:
            [{"label": "Name", "value": "John"},
             {"label": "Email", "value": "john@example.com"}]

    Returns dict with status, fields_filled, total_fields, failed_fields.
    """
    logger.info("fill_form called")
    start = _time.monotonic()
    try:
        from core.agent_tools import execute_accessible, get_ui_context

        field_list = json.loads(fields)
        filled = 0
        failed = []

        for field in field_list:
            label = field.get("label", "")
            value = field.get("value", "")

            result = await execute_accessible(
                action="set_value", element_name=label, value=value,
            )

            if isinstance(result, dict) and result.get("found"):
                filled += 1
            else:
                failed.append(label)

        return {
            "status": "success",
            "fields_filled": filled,
            "total_fields": len(field_list),
            "failed_fields": failed,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except json.JSONDecodeError as exc:
        return {
            "status": "error",
            "description": f"Invalid JSON in fields: {exc}",
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "The form fields format was invalid.",
        }
    except Exception as exc:
        logger.exception("fill_form failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't fill the form.",
        }


async def extract_text(region: str = "", element_name: str = "") -> dict:
    """Extract text from the screen or a specific UI element.

    Args:
        region: Screen region as "x1,y1,x2,y2" for OCR-based extraction.
        element_name: UI element name for accessibility-based extraction.

    Returns dict with status, text, source.
    """
    logger.info("extract_text called: region=%s, element_name=%s", region, element_name)
    start = _time.monotonic()
    try:
        if element_name:
            from core.agent_tools import get_ui_context
            ctx = await get_ui_context()
            if isinstance(ctx, dict):
                for elem in ctx.get("interactive_elements", []):
                    if element_name.lower() in (elem.get("name", "")).lower():
                        return {
                            "status": "success",
                            "text": elem.get("name", ""),
                            "source": "accessibility",
                            "duration_ms": int((_time.monotonic() - start) * 1000),
                        }
            return {
                "status": "error",
                "description": f"Element '{element_name}' not found.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": f"I couldn't find the element {element_name}.",
            }

        # Screen-based extraction
        from core.agent_tools import observe_screen
        result = await observe_screen()

        if isinstance(result, dict) and result.get("status") == "success":
            return {
                "status": "success",
                "text": result.get("description", ""),
                "source": "screenshot",
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

        return {
            "status": "error",
            "description": "Could not capture screen.",
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't capture the screen for text extraction.",
        }
    except Exception as exc:
        logger.exception("extract_text failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't extract text.",
        }


async def set_env_var(name: str, value: str, scope: str = "session") -> dict:
    """Set an environment variable.

    Args:
        name: Variable name.
        value: Variable value.
        scope: "session" (current process), "user" (persistent), "system" (persistent, may need elevation).

    Returns dict with status, name, scope, persistent.
    """
    logger.info("set_env_var called: name=%s, scope=%s", name, scope)
    start = _time.monotonic()
    try:
        # Validate env var name (alphanumeric + underscore only)
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
            return {
                "status": "error",
                "description": f"Invalid environment variable name: {name!r}. Must be alphanumeric/underscores only.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "That variable name contains invalid characters.",
            }

        if scope == "session":
            os.environ[name] = value
            return {
                "status": "success",
                "name": name,
                "scope": "session",
                "persistent": False,
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

        from core.agent_tools import execute_cli

        safe_name = shlex.quote(name)
        safe_value = shlex.quote(value)

        if _PLATFORM == "Windows":
            if scope == "user":
                cmd = f'setx {safe_name} {safe_value}'
            else:
                cmd = f'setx /M {safe_name} {safe_value}'
        elif _PLATFORM == "Darwin":
            cmd = f'launchctl setenv {safe_name} {safe_value}'
        else:
            # Linux: append to .bashrc using printf to avoid shell interpretation
            cmd = f'printf "\\nexport %s=%s\\n" {safe_name} {safe_value} >> ~/.bashrc'

        result = await execute_cli(command=cmd)
        # Also set in current process
        os.environ[name] = value

        return {
            "status": "success",
            "name": name,
            "scope": scope,
            "persistent": True,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("set_env_var failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't set the environment variable {name}.",
        }


async def change_setting(setting_path: str, value: str) -> dict:
    """Change a system setting by navigating the Settings app.

    This workflow is fragile — settings UIs change across OS versions.
    Falls back to clear error messages when navigation fails.

    Args:
        setting_path: Setting path (e.g., "Windows > Display > Scale").
        value: New value for the setting.

    Returns dict with status, setting, new_value.
    """
    logger.info("change_setting called: setting_path=%s, value=%s", setting_path, value)
    start = _time.monotonic()
    try:
        from core.agent_tools import execute_cli, execute_accessible, wait, get_ui_context

        # Open Settings app
        if _PLATFORM == "Windows":
            await execute_cli(command="start ms-settings:")
        elif _PLATFORM == "Darwin":
            await execute_cli(command='open "x-apple.systempreferences:"')
        else:
            await execute_cli(command="gnome-control-center &")

        await wait(2)

        # Parse the path and navigate
        parts = [p.strip() for p in setting_path.split(">")]
        for part in parts[1:]:  # Skip the first part (usually "Windows" or "System Preferences")
            result = await execute_accessible(action="click", element_name=part)
            await wait(1)

        # Try to set the value
        # This is inherently fragile — best effort
        result = await execute_accessible(action="set_value", element_name=parts[-1], value=value)

        return {
            "status": "success",
            "setting": setting_path,
            "new_value": value,
            "note": "Settings changes may require app restart or system restart to take effect.",
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("change_setting failed")
        return {
            "status": "error",
            "description": f"Settings navigation failed: {exc}. Try changing the setting manually.",
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I couldn't navigate to that setting. You may need to change it manually.",
        }
