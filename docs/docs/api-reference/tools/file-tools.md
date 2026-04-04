---
sidebar_position: 2
---

# File Tools

Tools for reading, editing, and searching files on the host machine.

## `read_file`

Read the contents of a file.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file_path` | `string` | Absolute or relative file path |
| `offset` | `int` | Starting line offset (default: 0) |
| `limit` | `int` | Number of lines to read (default: 200) |

**Classification:** Host (path-checked against restricted paths)

**Return shape:**
```json
{
  "status": "success",
  "stdout": "file contents with line numbers",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 15
}
```

## `edit_file`

Apply an edit to a file using search-and-replace.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file_path` | `string` | File path to edit |
| `old_string` | `string` | Text to find (must be unique in file) |
| `new_string` | `string` | Replacement text |
| `replace_all` | `bool` | Replace all occurrences (default: `false`) |

**Classification:** Host (path-checked against restricted paths)

**Return shape:**
```json
{
  "status": "success",
  "stdout": "Edit applied successfully",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 20
}
```

**Notes:**
- The `old_string` must match exactly one location in the file (unless `replace_all` is `true`)
- If the text appears multiple times and `replace_all` is `false`, the edit fails with an error describing the ambiguity

## `find_files`

Search for files matching a pattern.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pattern` | `string` | Glob pattern (e.g., `**/*.py`, `src/**/*.ts`) |
| `search_text` | `string` | Text to search for within matched files (optional) |
| `path` | `string` | Directory to search in (default: working directory) |
| `max_results` | `int` | Maximum number of results to return (default: 50) |

**Classification:** Host (path-checked)

**Return shape:**
```json
{
  "status": "success",
  "stdout": "list of matching file paths",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 150
}
```

---

**Related:** [Core Tools](/api-reference/tools/core-tools) · [Docker Sandbox](/security/docker-sandbox)
