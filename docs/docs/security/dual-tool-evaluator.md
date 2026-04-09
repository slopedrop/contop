---
sidebar_position: 3
---

# Dual-Tool Evaluator

The Dual-Tool Evaluator is the security gate that classifies every tool call before execution. It determines whether a command runs on the host, in a Docker sandbox, or requires user confirmation.

## Classification Cascade

The evaluator's `classify()` method processes every tool call through a multi-step cascade, stopping at the first match:

### Step 1: Force Host Override

If the user has explicitly approved a command via the UI confirmation modal, it runs on the host regardless of other rules.

**Result:** `host`

### Step 2: Known Tool Routing

Each tool category is routed based on its nature:

**Display-dependent tools** - always host (require physical display access):
- `execute_gui`, `observe_screen`, `get_ui_context`, `execute_accessible`
- `execute_browser`, `execute_computer_use`
- `maximize_active_window`, `wait`, `get_action_history`

**Skill tools** - always host:
- `execute_skill`, `load_skill`, `create_skill`, `edit_skill`
- Dynamically registered skill Python tools

**File tools** - host with restricted path checking:
- `read_file`, `edit_file`, `find_files`

**Window & clipboard tools** - always host:
- `window_list`, `window_focus`, `resize_window`, `clipboard_read`, `clipboard_write`

**Document tools** - always host:
- `read_pdf`, `read_image`, `read_excel`, `write_excel`

**System tools** - always host:
- `process_info`, `system_info`, `download_file`

**Workflow tools** - always host:
- `save_dialog`, `open_dialog`, `launch_app`, `close_app`, `app_menu`, `install_app`, `copy_between_apps`, `fill_form`, `extract_text`, `set_env_var`, `change_setting`, `find_and_replace_in_files`

### Step 3: Unknown Tool Names

Any tool name not recognized by the evaluator is routed to the sandbox as a defense-in-depth measure.

**Result:** `sandbox`

### Step 4: CLI Command Checks

For `execute_cli`, commands go through sub-checks in order:

**4a. Forbidden commands** - Commands matching the `forbidden_commands` list are always sandboxed. Uses substring and word boundary matching.

**Example forbidden commands:**
- `rm -rf /`
- `mkfs`
- `dd if=`
- `format C:`

**Result:** `sandbox`

**4b. Restricted paths** - Commands targeting paths in the `restricted_paths` list are sandboxed.

- **Windows:** Case-insensitive path matching
- **Unix:** Case-sensitive path matching

**Example restricted paths:**
- `/root`, `/etc/shadow`, `/etc/passwd`
- `C:\Windows`, `C:\Windows\System32`

**Result:** `sandbox`

### Step 5: Destructive Command Check

Commands matching `destructive_patterns` run on the host but require explicit user confirmation first.

**Example destructive patterns:**
- File deletion: `rm`, `rmdir`, `del`, `erase`
- Process management: `kill`, `killall`, `pkill`, `taskkill`
- System control: `shutdown`, `reboot`, `poweroff`
- Database: `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`

The evaluator uses pre-compiled regex patterns (`_destructive_re_cache`) for performance.

**Result:** `host` with `require_confirmation=True`

### Step 6: Default

If no previous step matched, the command is considered safe.

**Result:** `host`

## PowerShell Security Floor

14 PowerShell destructive cmdlets have a hardcoded security floor that cannot be overridden via settings:

- `Remove-Item`, `Move-Item`, `Stop-Process`
- `Restart-Computer`, `Stop-Computer`
- `Clear-Content`, `Clear-Item`, `Set-Content`
- `Remove-ItemProperty`, `Stop-Service`, `Remove-Service`
- `Invoke-Expression` (`iex`), `Format-Volume`

These always trigger the destructive confirmation flow regardless of user configuration.

## Encoded PowerShell Detection

The evaluator detects Base64-encoded PowerShell commands (`-EncodedCommand` flag) and blocks them from running on the host - a common technique for bypassing command-line pattern matching.

## Subshell Content Extraction

Commands containing subshells (`$()` and backtick expressions) have their inner content extracted and evaluated separately. This prevents circumventing the evaluator by wrapping dangerous commands in subshells.

## Command Prefix Stripping

Common command prefixes are stripped before evaluation:
- `sudo`, `env`, `nohup`, `nice`, `time`, `doas`

This ensures `sudo rm -rf /` is evaluated the same as `rm -rf /`.

## Confirmation Flow

When a command is classified as destructive (`require_confirmation=True`):

1. Server sends `agent_confirmation_request` to mobile with the command and reason
2. Agent execution pauses
3. User taps **Approve** or **Deny** on their phone
4. If approved: command executes on host
5. If denied: command is skipped, agent continues with next step
6. If no response within timeout: automatically rejected

## Performance

The classification target is **under 100ms** per evaluation - the evaluator should never be the bottleneck in the execution pipeline.

---

**Related:** [Docker Sandbox](/security/docker-sandbox) · [Tool Layers](/architecture/tool-layers) · [Agent Execution](/user-guide/agent-execution)
