"""
Agentic system prompt and model configuration for the ADK execution agent.

Defines constants used by ExecutionAgent: model name, system instruction,
and iteration limits. System prompt is loaded from prompts/execution-agent.md
and can be overridden via ~/.contop/settings.json from the desktop UI.
"""
import logging
import os
import platform
from pathlib import Path

logger = logging.getLogger(__name__)

EXECUTION_AGENT_MODEL = "gemini-2.5-flash"  # Fallback when mobile doesn't specify a model

MAX_ITERATIONS = 50
LLM_CALL_TIMEOUT = 120  # seconds — abort if no LLM response within this window
MAX_EXECUTION_TIME = 600  # seconds (10 min) — total wall-clock cap per intent

COMPUTER_USE_MODELS = [
    "gemini-2.5-computer-use-preview-10-2025",
    "gemini-3-flash-preview",
]
DEFAULT_COMPUTER_USE_BACKEND = "omniparser"

PINCHTAB_DEFAULT_URL = "http://127.0.0.1:9867"


_PLATFORM = platform.system()  # "Windows", "Linux", "Darwin"
_HOME_DIR = os.path.expanduser("~").replace("\\", "/")
_MODIFIER = "Cmd" if _PLATFORM == "Darwin" else "Ctrl"
_UNDO_HOTKEY = "Cmd+Z" if _PLATFORM == "Darwin" else "Ctrl+Z"
_UNDO_KEYS = '["command", "z"]' if _PLATFORM == "Darwin" else '["ctrl", "z"]'
_cached_shell_note: str | None = None


def _get_shell_note() -> str:
    """Return shell note dynamically based on discovered shell."""
    global _cached_shell_note
    if _cached_shell_note is not None:
        return _cached_shell_note

    if _PLATFORM == "Windows":
        # Import here to avoid circular import at module level
        from tools.host_subprocess import _discover_bash
        if _discover_bash() is not None:
            _cached_shell_note = (
                "Shell: Git Bash. "
                "See Tool-Specific Instructions for path format and shell syntax per tool."
            )
        else:
            _cached_shell_note = (
                "Shell: cmd.exe (Git Bash not found). "
                "See Tool-Specific Instructions for path format and shell syntax per tool."
            )
    elif _PLATFORM == "Darwin":
        _cached_shell_note = "Shell: /bin/zsh (macOS default)."
    else:
        _cached_shell_note = "Shell: /bin/sh."
    return _cached_shell_note


_PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"
_EXECUTION_PROMPT_PATH = _PROMPT_DIR / "execution-agent.md"
_CONVERSATION_PROMPT_PATH = _PROMPT_DIR / "conversation-agent.md"
_PLANNING_PROMPT_PATH = _PROMPT_DIR / "planning-agent.md"

MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4000

_FORMAT_VARS = {
    "platform": _PLATFORM,
    "home_dir": _HOME_DIR,
    # shell_note removed — injected dynamically via _get_shell_note()
    "modifier": _MODIFIER,
    "undo_hotkey": _UNDO_HOTKEY,
    "undo_keys": _UNDO_KEYS,
    "max_iterations": MAX_ITERATIONS,
}

# Backend-specific prompt fragments injected into {backend_mode_instructions}
_BACKEND_MODE_INSTRUCTIONS: dict[str, str] = {
    "accessibility": (
        "### Active Mode: Accessibility\n\n"
        "You are running in **accessibility mode**. Tool selection depends on what you are interacting with.\n\n"
        "#### Native desktop apps (File Explorer, Notepad, Office, Settings, dialogs)\n"
        "- **Observation**: `get_ui_context` — ALWAYS call this first. Do NOT call `observe_screen` "
        "unless `get_ui_context` returns zero interactive elements.\n"
        "- **Interaction**: `execute_accessible` — use the EXACT element_name and control_type from "
        "`get_ui_context`. Only fall back to `execute_gui` if `execute_accessible` returns found=false.\n"
        "- **NEVER call `observe_screen` after a successful `get_ui_context`** — if `get_ui_context` "
        "returned elements, use `execute_accessible` to interact. Calling `observe_screen` wastes "
        "12-18 seconds on CPU and image tokens. `get_ui_context` IS your verification tool.\n"
        "- **NEVER call `execute_accessible` without first calling `get_ui_context`** — element names "
        "are often different from what you expect.\n"
        "- If `execute_accessible` returns found=false, check `available_elements` and retry ONCE "
        "before falling back to vision.\n"
        "- **WARNING about `observe_screen` element_id**: Element IDs are numbered by screen position "
        "and include ALL visible UI — taskbar, system tray, browser chrome, other windows, not just the "
        "target app. Never assume a specific element_id corresponds to the element you want. Always read "
        "the element description/content before clicking.\n\n"
        "#### Web pages / browser tasks\n"
        "`get_ui_context` only sees browser chrome (address bar, tabs, toolbar buttons) — NOT the web "
        "page content. `execute_accessible` cannot interact with DOM elements.\n\n"
        "**Default: Use `execute_browser` (PinchTab CDP)**. No screenshot, no image tokens, no "
        "coordinate guessing. It is faster, cheaper, and more reliable than vision.\n\n"
        "**When to use `execute_browser`:**\n"
        "- Navigating to a URL, searching, reading page content, filling forms, clicking buttons/links\n"
        "- Extracting text from a page (action=\"extract_text\")\n"
        "- Any task where the user does NOT need to see the browser on their desktop\n\n"
        "**When to use `execute_browser` with `visible: true`:**\n"
        "- ONLY when the user explicitly wants to WATCH the automation — phrases like "
        "\"show me\", \"I want to see it\", \"let me watch\", \"display it on screen\"\n"
        "- \"Open in Chrome\" or \"open in browser\" does NOT mean visible — the user just wants "
        "you to navigate to the URL. Use headless (default) unless they specifically ask to see the process.\n"
        "- Pass params={{\"visible\": true}} on the navigate/open_tab action to launch a headed browser\n\n"
        "**When to use `observe_screen` + `execute_gui` instead:**\n"
        "- You need to verify visual layout, colors, images, or canvas content\n"
        "- Drag-and-drop or complex mouse interactions on the page\n"
        "- `execute_browser` failed or PinchTab is unavailable\n\n"
        "**Example — \"open this article in Chrome and scroll down\" (headless, default):**\n"
        "1. `execute_browser` action=\"navigate\", url=\"https://example.com/article\"\n"
        "2. `execute_browser` action=\"snapshot\" → get element refs\n"
        "3. `execute_browser` action=\"press\", params={{\"ref\": \"e0\", \"key\": \"End\"}}\n"
        "4. `execute_browser` action=\"snapshot\" → read results\n\n"
        "**Example — searching the web:**\n"
        "1. `execute_browser` action=\"navigate\", url=\"https://google.com\"\n"
        "2. `execute_browser` action=\"snapshot\" → get element refs\n"
        "3. `execute_browser` action=\"fill\", params={{\"ref\": \"e5\", \"value\": \"search query\"}}\n"
        "4. `execute_browser` action=\"press\", params={{\"ref\": \"e5\", \"key\": \"Enter\"}}\n"
        "5. `execute_browser` action=\"snapshot\" → read results\n\n"
        "**Example — user says \"show me the browser\" (visible):**\n"
        "1. `execute_browser` action=\"navigate\", url=\"https://example.com\", "
        "params={{\"visible\": true}}\n"
        "2. `execute_browser` action=\"snapshot\" → verify page loaded\n\n"
        "#### Dialog handling (Save As, Open, Print)\n"
        "After sending a hotkey that opens a dialog (Ctrl+S, Ctrl+O):\n"
        "1. Call `wait(1.5)` — dialogs take time to appear.\n"
        "2. Pass `window_title` to `get_ui_context` (e.g., `window_title=\"Save As\"`).\n"
        "3. Pass the same `window_title` to `execute_accessible`."
    ),
    "_default": (
        "### Active Mode: Vision (with Accessibility-First Strategy)\n\n"
        "#### Native desktop apps\n"
        "**ALWAYS call `get_ui_context` FIRST** for native desktop apps. It returns the accessibility "
        "tree with element names and control types — faster and more reliable than screenshots.\n"
        "- If `get_ui_context` returns interactive elements, use `execute_accessible` to interact. "
        "**Do NOT call `observe_screen`** — you already have what you need.\n"
        "- **NEVER call `observe_screen` after a successful `get_ui_context`** — if `get_ui_context` "
        "returned elements, use `execute_accessible` to interact. Calling `observe_screen` wastes "
        "12-18 seconds and image tokens. `get_ui_context` IS your observation.\n"
        "- **NEVER call `execute_accessible` without first calling `get_ui_context`** — element names "
        "are often different from what you expect.\n"
        "- Only call `observe_screen` if `get_ui_context` returns ZERO interactive elements or you "
        "specifically need pixel coordinates for drag/drop or visual verification.\n"
        "- If `execute_accessible` returns found=false, check `available_elements` and retry ONCE "
        "before falling back to vision.\n"
        "- **WARNING about `observe_screen` element_id**: Element IDs are numbered by screen position "
        "and include ALL visible UI — taskbar, system tray, browser chrome, other windows, not just the "
        "target app. Never assume a specific element_id corresponds to the element you want. Always read "
        "the element description/content before clicking.\n\n"
        "#### Web pages / browser tasks\n"
        "**Default: Use `execute_browser` (PinchTab CDP)** for web tasks — no screenshot needed, "
        "no image tokens wasted. It is faster and more reliable than vision-based clicking.\n\n"
        "**Use `execute_browser` when:**\n"
        "- Navigating to a URL, searching, reading/extracting page content, filling forms, clicking links\n"
        "- Any task where the user does NOT need to see the browser on their desktop\n\n"
        "**Use `execute_browser` with `visible: true` when:**\n"
        "- ONLY when the user explicitly wants to WATCH the automation (\"show me\", \"let me see it\", "
        "\"display it on screen\"). \"Open in Chrome\" does NOT mean visible — use headless.\n"
        "- Pass params={{\"visible\": true}} on navigate/open_tab to launch a headed browser\n\n"
        "**Use `observe_screen` + `execute_gui` ONLY when:**\n"
        "- `get_ui_context` returned zero elements (sparse accessibility tree)\n"
        "- You need to verify visual layout, colors, images, or canvas content\n"
        "- Drag-and-drop or complex mouse interactions\n"
        "- `execute_browser` failed or PinchTab is unavailable"
    ),
}


def _get_backend_mode_instructions(backend: str) -> str:
    """Return mode-specific instructions for the given backend."""
    return _BACKEND_MODE_INSTRUCTIONS.get(
        backend, _BACKEND_MODE_INSTRUCTIONS["_default"]
    )


# ---------------------------------------------------------------------------
# Per-tool instructions — platform-aware guidance injected into system prompt
# ---------------------------------------------------------------------------
# Keys: tool name → dict with "_all" (all platforms) and/or platform keys
# ("Windows", "Darwin", "Linux"). At prompt-build time the current platform's
# entries are rendered into a ## Tool-Specific Instructions section.
# ---------------------------------------------------------------------------

_TOOL_INSTRUCTIONS: dict[str, dict[str, str]] = {
    # ── Path-sensitive tools ──────────────────────────────────────────────
    "execute_cli": {
        # Windows value is dynamic — resolved in _build_tool_instructions()
        # based on whether Git Bash is discovered at runtime.
        "Windows": None,  # placeholder, replaced by _get_execute_cli_windows_instruction()
        "Darwin": (
            "Commands run in /bin/sh (POSIX). Use forward-slash Unix paths. "
            "Use `open -a AppName` to launch GUI apps."
        ),
        "Linux": (
            "Commands run in /bin/sh (POSIX). Use forward-slash Unix paths. "
            "Use `xdg-open` or launch commands with `&` to background GUI apps."
        ),
    },
    "save_dialog": {
        "Windows": (
            "The `file_path` parameter MUST use **Windows backslash paths** "
            "(`C:\\Users\\name\\Documents\\file.txt`). This path is typed into "
            "a native Windows file dialog via the accessibility tree — forward "
            "slashes will cause navigation failures or save to the wrong location. "
            "Always provide the FULL absolute path including drive letter."
        ),
        "Darwin": (
            "The `file_path` parameter uses standard Unix paths "
            "(`/Users/name/Documents/file.txt`). macOS Save dialogs accept "
            "forward-slash paths natively."
        ),
        "Linux": (
            "The `file_path` parameter uses standard Unix paths "
            "(`/home/name/Documents/file.txt`). GTK/Qt Save dialogs accept "
            "forward-slash paths natively."
        ),
    },
    "open_dialog": {
        "Windows": (
            "The `file_path` parameter MUST use **Windows backslash paths** "
            "(`C:\\Users\\name\\Documents\\file.txt`). This path is typed into "
            "a native Windows file dialog — forward slashes will fail. "
            "Always provide the FULL absolute path including drive letter."
        ),
        "Darwin": (
            "The `file_path` uses standard Unix paths. macOS Open dialogs "
            "accept forward-slash paths natively."
        ),
        "Linux": (
            "The `file_path` uses standard Unix paths. GTK/Qt Open dialogs "
            "accept forward-slash paths natively."
        ),
    },
    "download_file": {
        "Windows": (
            "The `destination` path should use **backslashes** "
            "(`C:\\Users\\name\\Downloads\\file.zip`). If omitted, defaults "
            "to ~/Downloads. The path must be within the user's home directory."
        ),
        "Darwin": (
            "The `destination` uses Unix paths (`/Users/name/Downloads/file.zip`). "
            "If omitted, defaults to ~/Downloads."
        ),
        "Linux": (
            "The `destination` uses Unix paths (`/home/name/Downloads/file.zip`). "
            "If omitted, defaults to ~/Downloads."
        ),
    },
    "read_file": {
        "Windows": (
            "Accepts both forward-slash and backslash paths, but prefer "
            "**backslashes** for consistency with other Windows tools. "
            "Always use absolute paths with a drive letter (`C:\\...`)."
        ),
    },
    "edit_file": {
        "Windows": (
            "Accepts both path formats. Use the SAME path format you used in "
            "`read_file` — the tool checks that the file was previously read, "
            "and the resolved path must match."
        ),
    },
    "find_files": {
        "Windows": (
            "The `path` parameter accepts both slash formats. Glob `pattern` "
            "uses forward slashes even on Windows (e.g., `**/*.py`). "
            "Results return Windows-native backslash paths."
        ),
    },

    # ── App & process naming ──────────────────────────────────────────────
    "launch_app": {
        "Windows": (
            "Use the executable name or common name: `notepad`, `chrome`, "
            "`calc`, `explorer`, `code`, `excel`, `word`, `powershell`. "
            "UWP/Store apps work via URI scheme (`whatsapp`, `spotify`). "
            "The tool tries `cmd.exe start`, then PowerShell URI launch."
        ),
        "Darwin": (
            "Use the macOS app name: `TextEdit`, `Safari`, `Finder`, "
            "`Preview`, `Terminal`, `Calculator`, `Notes`. "
            "The tool uses `open -a` which accepts .app bundle names."
        ),
        "Linux": (
            "Use the binary name or desktop entry: `gedit`, `nautilus`, "
            "`firefox`, `gnome-terminal`, `libreoffice`. "
            "The tool tries: direct binary, gtk-launch, flatpak, snap, "
            "then xdg-open as fallback."
        ),
    },
    "close_app": {
        "Windows": (
            "Match by window title substring. Windows titles typically include "
            "the document name and app name: `Untitled - Notepad`, "
            "`Google Chrome`, `Document1 - Word`. Pass the app name portion."
        ),
        "Darwin": (
            "Match by window title. macOS titles are typically just the document "
            "name: `Untitled`, `Document1`. Pass the app name (e.g., `TextEdit`) "
            "or document name."
        ),
        "Linux": (
            "Match by window title. Titles vary by toolkit — typically "
            "`filename - AppName` or just `AppName`."
        ),
    },
    "window_focus": {
        "Windows": (
            "Window titles often follow `DocumentName - AppName` pattern: "
            "`Untitled - Notepad`, `New Tab - Google Chrome`. "
            "Search is case-insensitive substring match."
        ),
        "Darwin": (
            "macOS window titles are often just the document name. "
            "Search is case-insensitive substring match."
        ),
        "Linux": (
            "Window titles vary by desktop environment and toolkit. "
            "Search is case-insensitive substring match."
        ),
    },
    "process_info": {
        "Windows": (
            "Process names include `.exe` extension: `chrome.exe`, "
            "`notepad.exe`, `explorer.exe`, `python.exe`. "
            "Search by name without extension also works."
        ),
        "Darwin": (
            "Process names use the app bundle name: `Google Chrome`, "
            "`TextEdit`, `Finder`, `python3`."
        ),
        "Linux": (
            "Process names use the binary name: `chrome`, `gedit`, "
            "`nautilus`, `python3`, `firefox`."
        ),
    },

    # ── Accessibility & UI ────────────────────────────────────────────────
    "execute_accessible": {
        "Windows": (
            "Uses pywinauto. Control types: `Button`, `Edit`, `ComboBox`, "
            "`CheckBox`, `RadioButton`, `Hyperlink`, `MenuItem`, `ListItem`, "
            "`TabItem`. Element names come from UIA — always call "
            "`get_ui_context` first to get exact names. "
            "For file dialogs: `File name:` (Edit), `Save` (Button), "
            "`Save as type:` (ComboBox), `Cancel` (Button)."
        ),
        "Darwin": (
            "Uses pyobjc AXUIElement. Roles: `AXButton`, `AXTextField`, "
            "`AXCheckBox`, `AXPopUpButton`, `AXMenuItem`. "
            "Element names use accessibility labels — always call "
            "`get_ui_context` first. macOS file dialog labels differ from Windows."
        ),
        "Linux": (
            "Uses pyatspi (AT-SPI). Roles: `push button`, `text`, "
            "`check box`, `combo box`, `menu item`. "
            "GTK and Qt apps expose different element naming conventions. "
            "Always call `get_ui_context` first to discover exact names."
        ),
    },

    # ── System tools ──────────────────────────────────────────────────────
    "install_app": {
        "Windows": (
            "Uses `winget` by default. Package names follow winget conventions: "
            "`Google.Chrome`, `Mozilla.Firefox`, `Microsoft.VisualStudioCode`. "
            "Search with `winget search <name>` if unsure of the exact ID."
        ),
        "Darwin": (
            "Uses `brew` by default. Package names follow Homebrew conventions: "
            "`google-chrome`, `firefox`, `visual-studio-code`. "
            "Use `brew search <name>` to find the correct formula/cask."
        ),
        "Linux": (
            "Uses `apt` by default. Package names follow distro conventions: "
            "`google-chrome-stable`, `firefox`, `code`. "
            "Also supports snap and flatpak as `method` parameter."
        ),
    },
    "set_env_var": {
        "Windows": (
            "Session scope sets in current process only. "
            "User/system scope uses `setx` — requires a new terminal session "
            "to take effect. System scope may need admin elevation."
        ),
        "Darwin": (
            "Session scope sets in current process. "
            "User scope uses `launchctl setenv` — affects new processes. "
            "For shell-persistent vars, also add to `~/.zshrc`."
        ),
        "Linux": (
            "Session scope sets in current process. "
            "User scope appends `export` to `~/.bashrc` — only affects new "
            "shell sessions. Run `source ~/.bashrc` to apply immediately."
        ),
    },
    "change_setting": {
        "Windows": (
            "Opens `ms-settings:` URI. Settings paths use Windows Settings "
            "section names: `Display > Scale`, `System > Sound`, "
            "`Personalization > Themes`. The tool navigates via accessibility "
            "tree — exact names depend on Windows version."
        ),
        "Darwin": (
            "Opens System Preferences via `x-apple.systempreferences:`. "
            "Pane names: `Displays`, `Sound`, `Desktop & Screen Saver`. "
            "macOS Ventura+ uses System Settings with different section names."
        ),
        "Linux": (
            "Opens GNOME Control Center. Section names: `display`, `sound`, "
            "`background`, `network`. Other DEs (KDE, XFCE) have different "
            "settings apps — this tool is GNOME-focused."
        ),
    },

    # ── Scroll & GUI ──────────────────────────────────────────────────────
    "execute_gui": {
        "Windows": (
            "Scroll uses native Win32 `mouse_event` with `WHEEL_DELTA=120` "
            "(pyautogui.scroll is broken on Windows). Horizontal scroll is "
            "supported. Non-ASCII text is pasted via clipboard (pyautogui.write "
            "breaks on Unicode). DPI scaling is handled automatically."
        ),
    },
}


def _get_execute_cli_windows_instruction() -> str:
    """Return execute_cli instruction based on discovered Windows shell."""
    from tools.host_subprocess import _discover_bash
    if _discover_bash() is not None:
        return (
            "Commands run in **Git Bash**. Use **forward-slash paths** "
            f"(`C:/Users/name/file.txt`). Do NOT use backslashes in shell "
            "commands — Git Bash treats `\\` as an escape character. "
            f"Use `$HOME` or the absolute forward-slash home path, never `~` "
            f"(MSYS expansion is disabled, home dir is {_HOME_DIR}). "
            "Windows `.exe` programs are on PATH and work normally. "
            "To launch a GUI app, append `&` to background it."
        )
    return (
        "Commands run in **cmd.exe** (Git Bash not found). "
        "Use **backslash paths** (`C:\\Users\\name\\file.txt`). "
        "Do NOT use `~`, `$HOME`, or Unix paths. "
        "Use `start \"\" \"AppName\"` to launch GUI apps in the background. "
        "Forward slashes work in most contexts but not all "
        "(e.g. some arguments to `del`, `rd`)."
    )


# Dynamic instruction resolvers — keyed by tool name.
# Called at prompt-build time when the static entry is None.
_DYNAMIC_TOOL_INSTRUCTIONS: dict[str, dict[str, callable]] = {
    "execute_cli": {"Windows": _get_execute_cli_windows_instruction},
}


def _build_tool_instructions() -> str:
    """Render platform-specific tool instructions for the current OS.

    Returns a formatted string with per-tool guidance, or empty string
    if no instructions apply to the current platform.
    """
    lines: list[str] = []
    for tool_name, platform_map in _TOOL_INSTRUCTIONS.items():
        # Collect applicable instructions: _all + current platform
        parts: list[str] = []
        if "_all" in platform_map:
            parts.append(platform_map["_all"])
        if _PLATFORM in platform_map:
            value = platform_map[_PLATFORM]
            if value is None:
                # Resolve dynamically
                resolver = _DYNAMIC_TOOL_INSTRUCTIONS.get(tool_name, {}).get(_PLATFORM)
                if resolver:
                    value = resolver()
            if value:
                parts.append(value)
        if not parts:
            continue
        instruction = " ".join(parts)
        lines.append(f"- **`{tool_name}`**: {instruction}")

    if not lines:
        return ""

    header = f"## Tool-Specific Instructions ({_PLATFORM})\n\n"
    header += (
        "These instructions override general guidance for the current platform. "
        "Follow them exactly when calling these tools.\n\n"
    )
    return header + "\n".join(lines)


# Primary tool names per backend, injected into template placeholders
_BACKEND_PRIMARY_TOOLS: dict[str, tuple[str, str]] = {
    "accessibility": ("`get_ui_context`", "`execute_accessible`"),
    "_default": ("`get_ui_context` (then `observe_screen` only if needed)", "`execute_accessible` (then `execute_gui` only if needed)"),
}


def _get_primary_tools(backend: str) -> tuple[str, str]:
    """Return (primary_observe_tool, primary_interact_tool) for the backend."""
    return _BACKEND_PRIMARY_TOOLS.get(backend, _BACKEND_PRIMARY_TOOLS["_default"])


def _safe_substitute(template: str, variables: dict[str, str]) -> str:
    """Replace {key} placeholders without converting {{ to {.

    Unlike str.format(), this preserves double-brace JSON examples (e.g.
    {{"x": N}}) so ADK's inject_session_state won't treat them as variables.
    """
    result = template
    for key, value in variables.items():
        result = result.replace("{" + key + "}", str(value))
    return result


def _load_prompt_from_file(backend: str = "omniparser") -> str:
    """Load the execution agent prompt from the .md file and apply format vars."""
    try:
        raw = _EXECUTION_PROMPT_PATH.read_text(encoding="utf-8")
        observe_tool, interact_tool = _get_primary_tools(backend)
        fmt = {
            **_FORMAT_VARS,
            "shell_note": _get_shell_note(),
            "backend_mode_instructions": _get_backend_mode_instructions(backend),
            "primary_observe_tool": observe_tool,
            "primary_interact_tool": interact_tool,
            "tool_instructions": _build_tool_instructions(),
        }
        return _safe_substitute(raw, fmt)
    except FileNotFoundError:
        logger.warning(
            "Prompt file %s not found, using empty prompt.", _EXECUTION_PROMPT_PATH
        )
        return ""


def get_execution_system_prompt(
    custom_instructions: str | None = None,
    skills_prompt: str | None = None,
    computer_use_backend: str = "omniparser",
) -> str:
    """Return the execution agent system prompt.

    Checks ~/.contop/settings.json for a desktop-edited override first,
    then falls back to the .md file default. Skills metadata is injected
    after the base prompt, before custom instructions.

    The computer_use_backend controls which mode-specific instructions are
    injected (e.g. accessibility mode uses get_ui_context as primary tool).
    """
    from core.settings import get_settings

    settings = get_settings()
    override = settings.get("execution_system_prompt")

    if override:
        observe_tool, interact_tool = _get_primary_tools(computer_use_backend)
        fmt = {
            **_FORMAT_VARS,
            "shell_note": _get_shell_note(),
            "backend_mode_instructions": _get_backend_mode_instructions(computer_use_backend),
            "primary_observe_tool": observe_tool,
            "primary_interact_tool": interact_tool,
            "tool_instructions": _build_tool_instructions(),
        }
        base_prompt = _safe_substitute(override, fmt)
    else:
        base_prompt = _load_prompt_from_file(computer_use_backend)

    # Inject skills metadata after base prompt, before custom instructions
    if skills_prompt:
        base_prompt += "\n\n" + skills_prompt

    # Strip and cap length of custom instructions
    if custom_instructions:
        custom_instructions = custom_instructions.strip()[:MAX_CUSTOM_INSTRUCTIONS_LENGTH]

    if custom_instructions:
        base_prompt += (
            "\n\n## User Custom Instructions\n\n"
            "The following instructions were provided by the user. "
            "If they conflict with any instructions above, "
            "follow the user's instructions instead.\n\n"
            f"{custom_instructions}"
        )

    return base_prompt


def get_conversation_system_prompt() -> str | None:
    """Return the conversation agent system prompt override from desktop settings.

    Returns None if no override is set (mobile uses its built-in default).
    """
    from core.settings import get_settings

    settings = get_settings()
    return settings.get("conversation_system_prompt") or None


def load_conversation_prompt() -> str:
    """Load the conversation agent prompt from the .md file."""
    try:
        return _CONVERSATION_PROMPT_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning(
            "Conversation prompt file %s not found.", _CONVERSATION_PROMPT_PATH
        )
        return ""


def get_planning_system_prompt(tool_descriptions: str = "") -> str:
    """Return the planning agent system prompt with tool descriptions injected."""
    try:
        raw = _PLANNING_PROMPT_PATH.read_text(encoding="utf-8")
        return raw.replace("{tool_descriptions}", tool_descriptions)
    except FileNotFoundError:
        logger.warning(
            "Planning prompt file %s not found, using fallback.", _PLANNING_PROMPT_PATH
        )
        return (
            "You are a planning agent. Classify tasks as SIMPLE or COMPLEX.\n"
            "For COMPLEX tasks, produce a numbered step-by-step plan."
        )


# Backward-compatible constant — frozen at import time.
# New code should call get_execution_system_prompt() instead.
EXECUTION_AGENT_SYSTEM_PROMPT = _load_prompt_from_file()
