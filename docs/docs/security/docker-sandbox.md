---
sidebar_position: 4
---

# Docker Sandbox

Commands classified as forbidden or restricted by the Dual-Tool Evaluator are executed in hardened Docker containers for isolation.

## When Sandbox Is Used

The sandbox is invoked when the evaluator classifies a command as:
- **Forbidden** - Matches the `forbidden_commands` list
- **Restricted** - Targets a path in the `restricted_paths` list
- **Unknown tool** - Defense-in-depth for unrecognized tool names

## Container Configuration

Each sandbox execution creates a short-lived container with aggressive hardening:

| Setting | Value | Purpose |
|---------|-------|---------|
| `network_disabled` | `True` | No network access |
| `mem_limit` | `256m` | Memory ceiling |
| CPU | 50% | CPU limit |
| `pids_limit` | `100` | Process count limit |
| `read_only` | `True` | Read-only root filesystem |
| `tmpfs` | `/tmp:64M` | Small writable scratch space |
| `security_opt` | `no-new-privileges` | Prevent privilege escalation |
| `user` | `nobody` | Non-root user |
| `cap_drop` | `["ALL"]` | Drop all Linux capabilities |
| `labels` | `{"contop.sandbox": "ephemeral"}` | Container identification |

## Docker Desktop Auto-Start

The server checks platform-specific paths for Docker Desktop and starts it if needed:
- Polls the Docker daemon every 2 seconds
- Waits up to 45 seconds for Docker to become available
- Reports status to the mobile UI via real-time status callback messages

## Fallback Without Docker

When Docker is unavailable (not installed or failed to start), the sandbox falls back to a **restricted host subprocess**:

| Setting | Value |
|---------|-------|
| `auto_confirm` | `False` (always requires confirmation) |
| `timeout` | `min(timeout_s, 10)` - 10 seconds maximum |
| Output limit | 50 KB (standard `max_output_bytes` default) |

This fallback is intentionally restrictive - it prevents unattended execution of potentially dangerous commands without Docker's isolation guarantees.

## Environment Sanitization

The sandbox container does not inherit the host's environment variables. Sensitive variables (API keys, tokens) are never passed to the container.

## Base Image

The Docker container uses `python:3.12-slim` as its base image. The image is pulled on first use if not present locally.

---

**Related:** [Dual-Tool Evaluator](/security/dual-tool-evaluator) · [Core Tools](/api-reference/tools/core-tools) · [Security Overview](/security/overview)
