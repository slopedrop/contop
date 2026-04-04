---
sidebar_position: 4
---

# Configuration

All settings are stored in `~/.contop/settings.json` and can be edited via the desktop app's Settings panel or the [REST API](/api-reference/rest-api).

## API Keys

Contop requires at least one LLM API key **or** at least one provider configured in subscription mode. Configure keys in the desktop Settings panel or edit `settings.json` directly.

| Key | Provider | Required |
|-----|----------|----------|
| `gemini_api_key` | Google Gemini | Recommended (default provider) |
| `openai_api_key` | OpenAI | Optional |
| `anthropic_api_key` | Anthropic | Optional |
| `openrouter_api_key` | OpenRouter | Optional (access to 100+ models) |

Get a free Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### Subscription Mode (Optional)

Instead of API keys, you can use your existing LLM subscription (Claude Pro/Max, Gemini Pro, ChatGPT Pro). In the desktop Settings panel, switch a provider's auth mode from "API Key" to "Subscription". Contop starts a local CLI proxy that routes requests through the provider's official CLI tool.

| Provider | CLI | Subscription |
|----------|-----|-------------|
| Anthropic | `@anthropic-ai/claude-code` | Claude Pro / Max |
| Google | `@google/gemini-cli` | Gemini Pro |
| OpenAI | `@openai/codex` | ChatGPT Pro |

Requirements:
1. Install the provider's CLI: `npm install -g <package>`
2. Authenticate: run the CLI once to complete OAuth login
3. Toggle "Subscription" mode in desktop settings

:::caution
Subscription mode is experimental. Providers may restrict usage outside their official CLI. Use at your own risk.
:::

:::warning
**Vision limitation:** CLI tools cannot receive images. In subscription mode, the execution agent's LLM vision fallback (direct screenshot analysis) is unavailable. The agent relies on local vision backends (OmniParser, Accessibility Tree, etc.) and falls back to text-only tools like `get_ui_context` when no backend processes a screenshot. The mobile settings UI shows a **NO VISION** badge on the execution model when subscription mode is active.
:::

:::info
The mobile app also supports configuring the STT provider (Google STT, OpenAI Whisper, OpenRouter Whisper) and conversation model provider (Gemini, OpenAI, Anthropic, OpenRouter) independently in its settings. These are stored on-device, not in `settings.json`.
:::

:::tip
API keys are stored as plaintext in `settings.json`. On startup, the desktop app automatically migrates any legacy DPAPI or keyring-encrypted keys from older installations to plaintext.
:::

## Security Settings

### [Restricted Paths](/security/overview)

Directories the agent cannot access. Commands targeting these paths are routed to the Docker sandbox.

```json
{
  "restricted_paths": [
    "/root",
    "/etc/shadow",
    "/etc/passwd",
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Windows\\SysWOW64"
  ]
}
```

### [Forbidden Commands](/security/overview)

Commands that are always sandboxed, regardless of context.

```json
{
  "forbidden_commands": [
    "rm -rf /",
    "mkfs",
    "dd if=",
    "format C:",
    "del /f /s /q C:\\"
  ]
}
```

### Destructive Patterns

Commands matching these patterns require explicit user approval via the [Dual-Tool Evaluator](/security/dual-tool-evaluator) before execution. The agent sends a confirmation request to your phone.

```json
{
  "destructive_patterns": [
    "rm", "rmdir", "del", "deltree", "rd", "erase",
    "mv", "kill", "killall", "pkill", "taskkill",
    "shutdown", "halt", "reboot", "poweroff",
    "format", "mkfs", "fdisk", "dd",
    "DROP TABLE", "DROP DATABASE", "TRUNCATE",
    "remove-item", "move-item", "stop-process"
  ]
}
```

:::warning
PowerShell destructive cmdlets (`Remove-Item`, `Stop-Process`, `Restart-Computer`, etc.) have a hardcoded security floor that cannot be disabled via settings.
:::

## Custom System Prompts

Override the default conversation and execution prompts:

| Setting | Purpose |
|---------|---------|
| `conversation_system_prompt` | Custom instructions for the mobile conversation model |
| `execution_system_prompt` | Custom instructions appended to the server execution agent's prompt |

Leave empty to use the built-in defaults. View defaults via the Settings panel or `GET /api/default-prompts`.

## Settings File Location

| Platform | Path |
|----------|------|
| Windows | `C:\Users\<name>\.contop\settings.json` |
| macOS | `/Users/<name>/.contop/settings.json` |
| Linux | `/home/<name>/.contop/settings.json` |

### Hot Reload

Settings are reloaded automatically when the file's modification time changes. No server restart required.

## Full Settings Schema

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
  "restricted_paths": ["..."],
  "forbidden_commands": ["..."],
  "destructive_patterns": ["..."],
  "keep_host_awake": false,
  "enabled_skills": []
}
```

---

**Related:** [Quick Start](/getting-started/quick-start) · [REST API](/api-reference/rest-api) · [Security Overview](/security/overview) · [Settings Configuration](/api-reference/configuration)
