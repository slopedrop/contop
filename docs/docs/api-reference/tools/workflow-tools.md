---
sidebar_position: 6
---

# Workflow Tools

Tools for interacting with native OS dialogs, applications, and automated workflows.

## `save_dialog`

Interact with a native Save As dialog.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filename` | `string` | Desired filename |
| `directory` | `string` | Target directory (optional) |

**Classification:** Host (display-dependent)

**Notes:**
- Uses platform adapter accessibility APIs for deterministic file dialog interaction
- On Windows, uses `set_edit_text()` for the filename field and programmatic button invocation

## `open_dialog`

Interact with a native Open File dialog.

| Parameter | Type | Description |
|-----------|------|-------------|
| `filename` | `string` | File to open |
| `directory` | `string` | Directory to navigate to (optional) |

**Classification:** Host (display-dependent)

## `launch_app`

Launch an application by name.

| Parameter | Type | Description |
|-----------|------|-------------|
| `app_name` | `string` | Application name or executable path |

**Classification:** Host

**Notes:**
- On Windows, searches Start Menu, `Program Files`, and common install paths
- On macOS, searches `/Applications` and uses `open -a`
- On Linux, uses `which` and XDG application directories

## `open_file`

Open a file in its default application.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file_path` | `string` | Absolute path to the file to open |
| `wait_ready` | `boolean` | Wait for the app window to appear (default: `true`) |

**Classification:** Host (display-dependent)

**Notes:**
- Uses `os.startfile()` on Windows, `open` on macOS, `xdg-open` on Linux
- Polls for the application window to appear and returns the matched window title
- Use this instead of `launch_app` when opening a specific file (`.xlsx`, `.pdf`, `.docx`, `.png`, etc.)
- Do NOT pass file paths to `launch_app` — use `open_file` instead

## `close_app`

Close an application.

| Parameter | Type | Description |
|-----------|------|-------------|
| `app_name` | `string` | Application name or window title |

**Classification:** Host

**Notes:** Attempts graceful close first, then force-kills if needed.

## `app_menu`

Navigate and activate an application menu item.

| Parameter | Type | Description |
|-----------|------|-------------|
| `menu_path` | `string` | Menu path (e.g., `"File > Save As"`) |

**Classification:** Host (display-dependent)

**Notes:**
- Uses platform adapter accessibility APIs to traverse menu hierarchies
- Supports nested menus (e.g., `"Edit > Preferences > General"`)
- Platform behavior varies: Windows uses pywinauto menu traversal, macOS uses AX menu APIs

## `install_app`

Install an application via platform package manager or installer.

| Parameter | Type | Description |
|-----------|------|-------------|
| `app_name` | `string` | Application name or package identifier |
| `method` | `string` | Installation method (optional — auto-detected) |

**Classification:** Host

## `copy_between_apps`

Copy content from one application to another.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source_app` | `string` | Source application |
| `target_app` | `string` | Target application |
| `content` | `string` | Content description or selector |

**Classification:** Host (display-dependent)

## `fill_form`

Fill form fields in the active application.

| Parameter | Type | Description |
|-----------|------|-------------|
| `fields` | `object` | Key-value mapping of field names to values |

**Classification:** Host (display-dependent)

## `extract_text`

Extract text content from the active window or application.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string` | Source description or selector (optional) |

**Classification:** Host

## `set_env_var`

Set an environment variable on the host.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Variable name |
| `value` | `string` | Variable value |
| `scope` | `string` | Scope: `"process"`, `"user"`, or `"system"` (optional) |

**Classification:** Host

## `change_setting`

Modify an OS or application setting.

| Parameter | Type | Description |
|-----------|------|-------------|
| `setting` | `string` | Setting name or path |
| `value` | `string` | New value |

**Classification:** Host

## `find_and_replace_in_files`

Find and replace text across multiple files.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pattern` | `string` | Search pattern (glob) for files |
| `find` | `string` | Text to find |
| `replace` | `string` | Replacement text |
| `path` | `string` | Directory to search in |

**Classification:** Host (path-checked)

---

**Related:** [Core Tools](/api-reference/tools/core-tools) · [Skills Engine](/api-reference/skills)
