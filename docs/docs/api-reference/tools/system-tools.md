---
sidebar_position: 5
---

# System Tools

Tools for querying system information and downloading files.

## `process_info`

List running processes with resource usage.

**Classification:** Host

**Return shape:**
```json
{
  "status": "success",
  "stdout": "process list with PID, name, CPU%, memory",
  "exit_code": 0,
  "duration_ms": 200
}
```

## `system_info`

Return system information (OS, CPU, memory, disk, display).

**Classification:** Host

**Return shape:**
```json
{
  "status": "success",
  "stdout": "system information summary",
  "exit_code": 0,
  "duration_ms": 100
}
```

Includes: OS version, CPU model and cores, RAM total/available, disk usage, screen resolution, GPU info (if available).

## `download_file`

Download a file from a URL to a local path.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | URL to download from |
| `path` | `string` | Local destination path |

**Classification:** Host (path-checked)

**Return shape:**
```json
{
  "status": "success",
  "stdout": "Downloaded 2.5 MB to /path/to/file",
  "exit_code": 0,
  "duration_ms": 3500
}
```

---

**Related:** [Core Tools](/api-reference/tools/core-tools) · [Security Overview](/security/overview)
