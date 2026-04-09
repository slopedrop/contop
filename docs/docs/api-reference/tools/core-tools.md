---
sidebar_position: 1
---

# Core Tools

The foundational tools for CLI execution, GUI automation, screen observation, and browser control.

## `execute_cli`

Execute a CLI command on the host machine.

| Parameter | Type | Description |
|-----------|------|-------------|
| `command` | `string` | Shell command to execute |

**Classification:** Evaluator decides (depends on command content - may be host, sandbox, or confirmation-required)

**Return shape:**
```json
{
  "status": "success",
  "stdout": "output text",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 1250,
  "voice_message": "Command completed successfully",
  "note": "optional context"
}
```

**Notes:**
- On Windows, Git Bash is auto-discovered as the default shell. Falls back to `cmd.exe` if not found.
- `MSYS_NO_PATHCONV=1` injected on Windows to prevent path mangling
- GUI app launches auto-wrapped with `&` (bash backgrounding)
- Interactive prompt detection: ~10 regex patterns for `[Y/n]`, `(y/n)`, etc. Auto-responds or closes stdin
- Stall detection: No output for 5s → close stdin (EOF)
- Output truncated at 50 KB (`DEFAULT_MAX_OUTPUT_BYTES=51200`)
- Working directory persists across calls within a session (managed internally via `_session_cwd`, not a tool parameter)
- Timeout defaults to 30 seconds (`DEFAULT_TIMEOUT_S` in `host_subprocess.py`)

## `execute_gui`

Perform a GUI automation action on the desktop.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | `string` | One of: `click`, `double_click`, `right_click`, `type`, `scroll`, `hotkey`, `press_key`, `move_mouse`, `drag` |
| `x` | `int` | X coordinate (screenshot-space) |
| `y` | `int` | Y coordinate (screenshot-space) |
| `text` | `string` | Text to type (for `type` action) |
| `key` | `string` | Key name (for `press_key` / `hotkey`) |
| `direction` | `string` | Scroll direction: `up`, `down`, `left`, `right` |
| `clicks` | `int` | Number of scroll clicks (default: 5) |

**Classification:** Always host (display-dependent)

**Notes:**
- Coordinates are in screenshot-space (1280px max width) and automatically scaled to native screen coordinates via `_scale()`
- Non-ASCII text uses clipboard paste (pyautogui.write() breaks on Unicode)
- Windows scroll uses direct `ctypes.windll.user32.mouse_event()` (pyautogui.scroll() is broken on Windows)
- `FAILSAFE = True` - moving mouse to corner aborts

## `observe_screen`

Capture a screenshot and optionally detect UI elements.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mode` | `string` | `"grounding"` (element coordinates) or `"understanding"` (screen description) |
| `intent` | `string` | Optional description of what to look for |

**Classification:** Always host (display-dependent)

**Return shape:**
```json
{
  "status": "success",
  "stdout": "element detection results or description",
  "image_b64": "base64 annotated screenshot",
  "duration_ms": 850
}
```

## `get_ui_context`

Query the accessibility tree for the active window.

| Parameter | Type | Description |
|-----------|------|-------------|
| `max_depth` | `int` | Maximum tree traversal depth |

**Classification:** Always host (display-dependent)

**Return shape:** JSON array of UI elements with names, types, and automation IDs.

## `execute_browser`

Interact with web browsers via PinchTab CDP.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | `string` | One of: `navigate`, `click`, `fill`, `press`, `extract_text`, `snapshot`, `open_tab`, `close_tab` |
| `url` | `string` | URL for navigate action (http/https only) |
| `params` | `object` | Action-specific parameters |

**Classification:** Always host (PinchTab runs locally)

**Notes:**
- Token-efficient: ~800 tokens for text extraction vs 10k+ for screenshots
- URL scheme validation prevents SSRF (http/https only)
- Auto-downloads PinchTab binary from pinned GitHub release on first use
- Falls back to `execute_gui` if PinchTab is unavailable

## `execute_accessible`

Interact with UI elements via accessibility APIs (by name, automation ID, or control type).

| Parameter | Type | Description |
|-----------|------|-------------|
| `element_name` | `string` | Element to interact with |
| `action` | `string` | Action to perform (click, type, select, etc.) |
| `value` | `string` | Value for type/select actions |

**Classification:** Always host

## `execute_computer_use`

Delegate to Gemini Computer Use API for autonomous screen interaction.

| Parameter | Type | Description |
|-----------|------|-------------|
| `instruction` | `string` | What to accomplish on screen |

**Classification:** Always host (conditional - only registered when model supports CU)

**Notes:**
- Planning only - maps Gemini CU function calls to `gui_automation` vocabulary, does not execute directly
- Blocked key combos: `Win+R`, `Super+R`, `Ctrl+Alt+Del`, `Ctrl+Alt+Delete`, `Alt+F4`
- History management: Smart trimming to 30 entries

## `maximize_active_window`

Maximize the currently focused window.

**Classification:** Always host

## `wait`

Pause execution for a specified duration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `seconds` | `float` | Duration to wait |

**Classification:** Always host

## `get_action_history`

Return recent tool execution history (50-entry ring buffer).

**Classification:** Always host

**Return shape:** Array of recent actions with tool name, command, result summary, and timestamp.

---

**Related:** [Tool Layers](/architecture/tool-layers) · [Dual-Tool Evaluator](/security/dual-tool-evaluator)
