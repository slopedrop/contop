---
sidebar_position: 5
---

# Configuration Reference

Complete reference for `~/.contop/settings.json` — all configurable fields, defaults, and behavior.

## Settings File Location

| Platform | Path |
|----------|------|
| Windows | `C:\Users\<name>\.contop\settings.json` |
| macOS | `/Users/<name>/.contop/settings.json` |
| Linux | `/home/<name>/.contop/settings.json` |

Created automatically with defaults on first server startup.

## Full Schema

```json
{
  "version": 1,
  "gemini_api_key": "",
  "openai_api_key": "",
  "anthropic_api_key": "",
  "openrouter_api_key": "",
  "provider_auth": {
    "gemini": { "mode": "api_key", "proxy_url": "" },
    "anthropic": { "mode": "api_key", "proxy_url": "" },
    "openai": { "mode": "api_key", "proxy_url": "" }
  },
  "proxy_auto_start": true,
  "conversation_system_prompt": "",
  "execution_system_prompt": "",
  "restricted_paths": [
    "/root",
    "/etc/shadow",
    "/etc/passwd",
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Windows\\SysWOW64"
  ],
  "forbidden_commands": [
    "rm -rf /",
    "mkfs",
    "dd if=",
    "format C:",
    "del /f /s /q C:\\"
  ],
  "destructive_patterns": [
    "rm", "rmdir", "del", "deltree", "rd", "erase",
    "mv", "kill", "killall", "pkill", "taskkill",
    "shutdown", "halt", "reboot", "poweroff",
    "format", "mkfs", "fdisk", "dd",
    "DROP TABLE", "DROP DATABASE", "TRUNCATE",
    "remove-item", "move-item", "stop-process",
    "restart-computer", "stop-computer",
    "clear-content", "clear-item"
  ],
  "keep_host_awake": false,
  "enabled_skills": [],
  "away_mode": {
    "enabled": false,
    "pin_hash": "",
    "emergency_pin_hash": "",
    "auto_engage_minutes": 5,
    "idle_timeout_enabled": true
  },
  "pinchtab_url": "http://127.0.0.1:9867"
}
```

## Field Reference

### API Keys

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gemini_api_key` | `string` | `""` | Google Gemini API key |
| `openai_api_key` | `string` | `""` | OpenAI API key |
| `anthropic_api_key` | `string` | `""` | Anthropic API key |
| `openrouter_api_key` | `string` | `""` | OpenRouter API key (access to 100+ models) |

API keys are stored as plaintext in `settings.json`. On startup, the desktop app runs `migrate_keys_to_plaintext()` to reverse-migrate any legacy DPAPI or keyring-encrypted keys from older installations. The `GET /api/decrypted-keys` endpoint still exists for backward compatibility but now reads plaintext keys directly from settings.

### Subscription Auth

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider_auth.<provider>.mode` | `string` | `"api_key"` | `"api_key"` or `"cli_proxy"` |
| `provider_auth.<provider>.proxy_url` | `string` | `""` | CLI proxy URL (e.g. `http://localhost:3456`) |
| `proxy_auto_start` | `boolean` | `true` | Auto-start CLI proxy processes with the server |

Providers: `gemini`, `anthropic`, `openai`. When `mode` is `"cli_proxy"`, the server routes LLM requests through the local CLI proxy instead of calling the API directly.

**Vision limitation:** CLI tools accept text only — no base64 images. In subscription mode, the execution agent's LLM vision fallback (direct screenshot analysis) is unavailable. The agent uses local vision backends and falls back to `get_ui_context` when none process a frame.

### System Prompts

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `conversation_system_prompt` | `string` | `""` | Custom mobile conversation model instructions |
| `execution_system_prompt` | `string` | `""` | Custom instructions appended to execution agent prompt |

Empty strings use the built-in defaults. View defaults via `GET /api/default-prompts`.

### Security

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `restricted_paths` | `string[]` | OS system dirs | Paths that trigger sandbox routing |
| `forbidden_commands` | `string[]` | Destructive OS commands | Commands always routed to sandbox |
| `destructive_patterns` | `string[]` | rm, kill, shutdown, etc. | Patterns requiring user confirmation |

### Behavior

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `keep_host_awake` | `boolean` | `false` | Prevent host from sleeping (persisted across restarts) |
| `enabled_skills` | `string[]` | `[]` | List of enabled skill names |
| `pinchtab_url` | `string` | `"http://127.0.0.1:9867"` | PinchTab browser automation endpoint |

### Away Mode

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `away_mode.enabled` | `boolean` | `false` | Whether Away Mode is configured |
| `away_mode.pin_hash` | `string` | `""` | bcrypt hash of the unlock PIN |
| `away_mode.emergency_pin_hash` | `string` | `""` | bcrypt hash of the emergency PIN |
| `away_mode.auto_engage_minutes` | `int` | `5` | Idle timeout before auto-engaging (minutes) |
| `away_mode.idle_timeout_enabled` | `boolean` | `true` | Whether idle auto-engage is active |

### Required Keys

The following keys must always be present: `version`, `restricted_paths`, `forbidden_commands`.

## Hot Reload

Settings are reloaded automatically when the file's `st_mtime` (modification timestamp) changes. The `get_settings()` function checks the mtime on each call — no polling or restart required.

## Environment Variable Fallbacks

API keys can also be set via environment variables:
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`

The settings file is checked first; environment variables are used as a fallback when the settings value is empty.

---

**Related:** [Configuration Guide](/getting-started/configuration) · [REST API](/api-reference/rest-api) · [Security Overview](/security/overview)
