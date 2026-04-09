"""
Advanced workflow tools - delegators to core workflow_tools.py.

These are registered as agent FunctionTools when the skill is enabled.
Each wraps the original implementation to preserve signatures and docstrings.
"""
import sys
from pathlib import Path

# Ensure contop-server root is importable
_server_root = str(Path(__file__).resolve().parent.parent.parent.parent)
if _server_root not in sys.path:
    sys.path.insert(0, _server_root)

from core.workflow_tools import (
    fill_form as _fill_form,
    extract_text as _extract_text,
    copy_between_apps as _copy_between_apps,
    set_env_var as _set_env_var,
    change_setting as _change_setting,
    app_menu as _app_menu,
    install_app as _install_app,
    find_and_replace_in_files as _find_and_replace_in_files,
)


async def fill_form(fields: str) -> dict:
    """Fill a form by setting field values via accessibility.

    Args:
        fields: JSON array of objects with "label" and "value" keys.

    Returns:
        dict with status and fields_filled count.
    """
    return await _fill_form(fields)


async def extract_text(region: str = "", element_name: str = "") -> dict:
    """Extract text from the screen or a specific UI element.

    Args:
        region: Screen region to extract from (e.g., "top_half", "center").
        element_name: Name of a specific UI element to target.

    Returns:
        dict with status and extracted text.
    """
    return await _extract_text(region, element_name)


async def copy_between_apps(source_app: str, target_app: str, select_all: bool = True) -> dict:
    """Copy content from one app to another via clipboard.

    Args:
        source_app: Window title of the source application.
        target_app: Window title of the target application.
        select_all: Whether to Ctrl+A before copying (default True).

    Returns:
        dict with status and description.
    """
    return await _copy_between_apps(source_app, target_app, select_all)


async def set_env_var(name: str, value: str, scope: str = "session") -> dict:
    """Set an environment variable.

    Args:
        name: Variable name.
        value: Variable value.
        scope: "session", "user", or "system".

    Returns:
        dict with status and description.
    """
    return await _set_env_var(name, value, scope)


async def change_setting(setting_path: str, value: str) -> dict:
    """Change a system setting by navigating the Settings app.

    Args:
        setting_path: Dot-separated path to the setting (e.g., "display.night_light").
        value: The value to set.

    Returns:
        dict with status and description.
    """
    return await _change_setting(setting_path, value)


async def app_menu(app_name: str, menu_path: str) -> dict:
    """Navigate an application's menu bar.

    Args:
        app_name: Name of the application window.
        menu_path: Menu path like "File > Export > PDF".

    Returns:
        dict with status and description.
    """
    return await _app_menu(app_name, menu_path)


async def install_app(name: str, method: str = "") -> dict:
    """Install a package using the system package manager.

    Args:
        name: Package name to install.
        method: Package manager to use (winget, brew, apt, snap, flatpak). Auto-detected if empty.

    Returns:
        dict with status and description.
    """
    return await _install_app(name, method)


async def find_and_replace_in_files(path: str, pattern: str = "**/*", old_text: str = "", new_text: str = "", dry_run: bool = False) -> dict:
    """Find and replace text across multiple files.

    Args:
        path: Root directory to search.
        pattern: Glob pattern for files (default "**/*").
        old_text: Text to find.
        new_text: Replacement text.
        dry_run: If True, preview changes without writing.

    Returns:
        dict with status, files_matched, and replacements count.
    """
    return await _find_and_replace_in_files(path, pattern, old_text, new_text, dry_run)
