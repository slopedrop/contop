---
sidebar_position: 3
---

# Window & Clipboard Tools

Tools for managing windows and clipboard content on the host machine.

## `window_list`

List all visible windows.

**Classification:** Host

**Return shape:**
```json
{
  "status": "success",
  "stdout": "JSON array of window objects",
  "exit_code": 0,
  "duration_ms": 50
}
```

Each window object includes: title, process name, dimensions, and position.

## `window_focus`

Bring a specific window to the foreground.

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | `string` | Window title (partial match supported) |

**Classification:** Host

## `resize_window`

Resize and/or move the active window.

| Parameter | Type | Description |
|-----------|------|-------------|
| `width` | `int` | New width in pixels |
| `height` | `int` | New height in pixels |
| `x` | `int` | New X position (optional) |
| `y` | `int` | New Y position (optional) |

**Classification:** Host

## `clipboard_read`

Read the current clipboard contents.

**Classification:** Host

**Return shape:**
```json
{
  "status": "success",
  "stdout": "clipboard text content",
  "exit_code": 0,
  "duration_ms": 10
}
```

## `clipboard_write`

Write text to the clipboard.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to write to clipboard |

**Classification:** Host

---

**Related:** [Core Tools](/api-reference/tools/core-tools) · [Platform Adapters](/developer-guide/platform-adapters)
