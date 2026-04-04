---
sidebar_position: 5
---

# Audit Logging

Every tool execution is logged to an append-only JSONL audit trail for security review and debugging.

## Log Format

Audit logs use JSON Lines format — one JSON object per line, append-only:

```json
{
  "timestamp": "2026-03-27T10:30:15.123Z",
  "session_id": "abc-123-def",
  "user_prompt": "Delete the old-data folder",
  "classified_command": "rm -rf ./old-data",
  "tool_used": "execute_cli",
  "execution_result": "success",
  "voice_message": "Folder deleted successfully",
  "duration_ms": 1250
}
```

### Entry Schema

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `string` | ISO 8601 timestamp |
| `session_id` | `string` | WebRTC session identifier |
| `user_prompt` | `string` | Original user command |
| `classified_command` | `string` | Actual command as classified by evaluator |
| `tool_used` | `string` | Tool name (e.g., `execute_cli`, `execute_gui`) |
| `execution_result` | `string` | `success`, `error`, or `rejected` |
| `voice_message` | `string` | Voice feedback sent to user |
| `duration_ms` | `int` | Execution time in milliseconds |

## Log Files

### Location

```
~/.contop/logs/session-{YYYY-MM-DD}.jsonl
```

One file per calendar day with daily rotation.

### Examples

```
~/.contop/logs/session-2026-03-27.jsonl
~/.contop/logs/session-2026-03-26.jsonl
```

## Session Lifecycle Events

Special log entries mark session boundaries:

- **`log_session_start()`** — Records session ID, device info, connection type
- **`log_session_end()`** — Records summary stats (total commands, duration, error count)

## Fire-and-Forget Strategy

Audit logging uses an async fire-and-forget pattern:

```python
async def log(...):
    await asyncio.to_thread(self._write_line, ...)
```

- Logging **never blocks** tool execution
- Exceptions in the logger are caught and logged to stderr, never raised
- A missed log entry is acceptable; a blocked execution is not

## Action History Ring Buffer

In addition to the JSONL audit trail, the agent maintains a 50-entry ring buffer of recent actions (accessible via `get_action_history` tool). This provides the agent with short-term memory of what it has done without needing to read log files.

## LLM Call Logging

Per-session LLM call logs capture the full request/response cycle for debugging and cost tracking:

### Subscription Mode (CLI Proxy)

The CLI proxy writes detailed logs to `~/.contop/logs/llm-sub-{sessionId}-{timestamp}.log`:

- **Lazy creation** — Log file is only created on the first LLM call, not on proxy startup (avoids empty files)
- **Logged per call**: CLI binary spawned, arguments, model, prompt text, response text, tool calls, token usage, duration, and exit code

### API Mode (Direct)

When using API keys directly, the execution agent logs calls via its own logger (`_llm_logger`), initialized per-intent. In subscription mode, API-mode logging is skipped since the CLI proxy handles it.

### Log Location

```
~/.contop/logs/llm-sub-{8-char-session-id}-{timestamp}.log    # Subscription mode
~/.contop/logs/session-{YYYY-MM-DD}.jsonl                      # Audit trail (all modes)
```

---

**Related:** [Security Overview](/security/overview) · [Dual-Tool Evaluator](/security/dual-tool-evaluator) · [REST API](/api-reference/rest-api)
