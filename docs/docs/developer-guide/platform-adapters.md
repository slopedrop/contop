---
sidebar_position: 3
---

# Platform Adapters

Contop abstracts OS-specific GUI automation behind a platform adapter layer, ensuring consistent behavior across Windows, macOS, and Linux.

## Architecture

```python
# Factory function auto-detects OS
adapter = get_adapter()  # Returns WindowsAdapter, MacOSAdapter, or LinuxAdapter
```

The factory function in `platform_adapters/base.py` uses `platform.system()` to select the correct adapter. Concrete classes are lazy-imported inside the factory to avoid import errors on platforms where dependencies aren't installed.

## Abstract Base Class (`base.py`)

### Required Methods (must implement)

| Method | Purpose |
|--------|---------|
| `focus_window(title)` | Bring a window to the foreground by title |
| `list_windows()` | Return list of visible windows |

### Graceful Degradation Methods (safe defaults)

These methods return falsy values when the platform doesn't support them:

| Method | Default Return | Purpose |
|--------|---------------|---------|
| `get_foreground_window_name()` | `""` | Current active window title |
| `get_focused_element()` | `{}` | Currently focused UI element |
| `get_interactive_elements()` | `[]` | List of interactive elements |
| `interact_element()` | `{"found": False, "status": "error"}` | Programmatic UI interaction |
| `get_element_tree()` | `[]` | Accessibility tree walk |
| `is_window_maximized()` | `False` | Check if window is maximized |
| `maximize_window()` | `False` | Maximize the active window |

This design ensures code works across all platforms even with missing features.

## Windows Adapter (`windows.py`)

**Dependencies**: `pywinauto` (optional, feature-flagged via `_HAS_PYWINAUTO`), `ctypes.windll.user32`

### Key Features

- **High-DPI support**: Uses `ctypes.wintypes.*` for proper type marshalling
- **Window placement**: `_WINDOWPLACEMENT` struct with `GetWindowPlacement()` / `ShowWindow()`
- **Interactive control types**: Button, Edit, ComboBox, CheckBox, RadioButton, Hyperlink, MenuItem, ListItem, TabItem
- **Element interaction**: `invoke()` (programmatic click), `set_edit_text()` (deterministic typing), `toggle()`, `select()`, `expand()`, `collapse()`, `set_focus()`. Falls back to `click_input()` / `type_keys()` on failure.
- **Tree walk guards**: `MAX_ELEMENTS=200`, respects `max_depth` limit

## macOS Adapter (`macos.py`)

**Dependencies**: `pyobjc` (optional), ApplicationServices (optional), JXA via `osascript`

### Key Features

- **API version detection**: Modern `activate()` if available (macOS 14+), falls back to deprecated `activateWithOptions_()`
- **JXA for window state**: Menu bar height accounting with 20px tolerance for maximize detection
- **Interactive AX roles**: AXButton, AXTextField, AXCheckBox, AXRadioButton, AXLink, AXMenuItem, AXPopUpButton, AXComboBox, AXSecureTextField, AXTextArea

## Linux Adapter (`linux.py`)

**Dependencies**: `wmctrl`, `xdotool`, `xprop`, `pyatspi` (fallback chain)

### Key Features

- **Subprocess-first design**: `wmctrl` → `xdotool` → `xprop` → `pyatspi` fallback chain
- **Three-tier foreground detection**: (1) `xdotool getactivewindow getwindowname`, (2) pyatspi `STATE_ACTIVE` app, (3) deep search
- **Maximize**: Primary `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`, fallback `xdotool key super+Up`
- **pyatspi limitation**: Can confirm a window exists but cannot bring it to the foreground

## Adding a New Adapter

1. Create `platform_adapters/newos.py`
2. Implement the abstract base class methods
3. Add detection logic in `get_adapter()` factory
4. Use optional imports with feature flags for OS-specific libraries

:::important
Never write OS-specific automation directly in tool files (e.g., `gui_automation.py`). All OS-specific UI interaction logic must go through platform adapters.
:::

---

**Related:** [Project Structure](/developer-guide/project-structure) · [Tool Layers](/architecture/tool-layers) · [Testing](/developer-guide/testing)
