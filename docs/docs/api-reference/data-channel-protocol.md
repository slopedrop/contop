---
sidebar_position: 2
---

# Data Channel Protocol

All WebRTC data channel messages use a canonical envelope format. Messages are JSON-encoded strings sent over the reliable or unreliable data channel.

## Envelope Format

```json
{
  "type": "snake_case_message_type",
  "id": "uuid-v4",
  "payload": { ... }
}
```

Every message must include all three fields. Never mix payloads outside this envelope.

## Reliable Channel (`contop`)

Ordered, reliable delivery. Used for all messages except low-latency mouse movement.

### Phone → Server

#### `user_intent`

Send a user command to the execution agent.

```json
{
  "type": "user_intent",
  "id": "uuid",
  "payload": {
    "text": "Open Chrome and search for the weather",
    "frame_b64": "<optional base64 screenshot>"
  }
}
```

#### `agent_confirmation_response`

Respond to a destructive action confirmation request.

```json
{
  "type": "agent_confirmation_response",
  "id": "uuid",
  "payload": {
    "approved": true,
    "request_id": "uuid-of-original-request"
  }
}
```

#### `execution_stop`

Cancel the currently running execution.

```json
{
  "type": "execution_stop",
  "id": "uuid",
  "payload": {}
}
```

#### `manual_control`

Send a manual control action (click, right-click, scroll, key combo).

```json
{
  "type": "manual_control",
  "id": "uuid",
  "payload": {
    "action": "click",
    "x": 640,
    "y": 360
  }
}
```

#### `set_manual_mode`

Toggle manual control mode.

```json
{
  "type": "set_manual_mode",
  "id": "uuid",
  "payload": { "enabled": true }
}
```

#### `new_session`

Start a new session, clearing previous context.

```json
{
  "type": "new_session",
  "id": "uuid",
  "payload": {}
}
```

#### `tool_call`

Execute a specific tool directly (legacy/testing).

```json
{
  "type": "tool_call",
  "id": "uuid",
  "payload": {
    "tool": "execute_cli",
    "args": { "command": "ls -la" }
  }
}
```

#### `session_context`

Send conversation context for execution.

```json
{
  "type": "session_context",
  "id": "uuid",
  "payload": {
    "turns": [...]
  }
}
```

#### `device_control`

Send a device control command (wake, sleep, etc.).

```json
{
  "type": "device_control",
  "id": "uuid",
  "payload": {
    "action": "wake"
  }
}
```

#### `away_mode_status`

Query Away Mode status from the phone.

```json
{
  "type": "away_mode_status",
  "id": "uuid",
  "payload": {}
}
```

#### `away_mode_engage` / `away_mode_disengage`

Control Away Mode from the phone.

```json
{
  "type": "away_mode_engage",
  "id": "uuid",
  "payload": {}
}
```

### Server → Phone

#### `agent_progress`

Step-by-step execution progress.

```json
{
  "type": "agent_progress",
  "id": "uuid",
  "payload": {
    "step": 3,
    "tool": "execute_cli",
    "detail": "Running: git status",
    "status": "running",
    "model": "gemini-2.5-flash",
    "backend": "omniparser"
  }
}
```

**Status values:** `running`, `completed`, `failed`

#### `agent_result`

Final execution result.

```json
{
  "type": "agent_result",
  "id": "uuid",
  "payload": {
    "answer": "I've created the folder on your desktop.",
    "steps_taken": 5,
    "duration_ms": 12340,
    "model": "gemini-2.5-flash",
    "backend": "omniparser"
  }
}
```

#### `agent_confirmation_request`

Request user approval for a destructive command.

```json
{
  "type": "agent_confirmation_request",
  "id": "uuid",
  "payload": {
    "tool": "execute_cli",
    "command": "rm -rf ./old-data",
    "reason": "destructive_command",
    "voice_message": "Should I delete the old-data folder?"
  }
}
```

#### `state_update`

Synchronize AI state to the mobile app.

```json
{
  "type": "state_update",
  "id": "uuid",
  "payload": {
    "ai_state": "idle",
    "connection_type": "permanent",
    "keep_host_awake": false
  }
}
```

#### `agent_status`

Transparency status updates.

```json
{
  "type": "agent_status",
  "id": "uuid",
  "payload": {
    "status_type": "vision_fallback",
    "message": "UI-TARS rate limited, falling back to OmniParser"
  }
}
```

**Status types:** `vision_fallback`, `sandbox_fallback`, `model_error`

#### `away_mode_status`

Away Mode state update.

```json
{
  "type": "away_mode_status",
  "id": "uuid",
  "payload": {
    "away_mode": true,
    "overlay_active": true
  }
}
```

#### `tool_result`

Individual tool execution result (sent per-step during execution).

```json
{
  "type": "tool_result",
  "id": "uuid",
  "payload": {
    "tool": "execute_cli",
    "status": "success",
    "stdout": "output text",
    "duration_ms": 1250
  }
}
```

#### `device_control_result`

Result of a device control operation (wake, sleep, etc.).

```json
{
  "type": "device_control_result",
  "id": "uuid",
  "payload": {
    "action": "wake",
    "status": "success"
  }
}
```

#### `security_alert`

Security event notification (e.g., Away Mode overlay was terminated).

```json
{
  "type": "security_alert",
  "id": "uuid",
  "payload": {
    "reason": "overlay_killed",
    "message": "Away Mode overlay may have been terminated"
  }
}
```

#### `agent_thinking`

Agent reasoning/thinking content (streamed during execution).

```json
{
  "type": "agent_thinking",
  "id": "uuid",
  "payload": {
    "text": "I need to first check if the file exists..."
  }
}
```

#### `agent_text`

Agent text response content (streamed during execution).

```json
{
  "type": "agent_text",
  "id": "uuid",
  "payload": {
    "text": "The file has been created successfully."
  }
}
```

#### `keepalive`

Heartbeat (sent every 30 seconds).

```json
{
  "type": "keepalive",
  "id": "uuid",
  "payload": {}
}
```

## Unreliable Channel (`contop-fast`)

Unordered, no retransmission (`ordered: false`, `maxRetransmits: 0`). Used for low-latency mouse control during manual mode.

### Phone → Server

#### `manual_control` (mouse movement)

```json
{
  "type": "manual_control",
  "id": "uuid",
  "payload": {
    "action": "mouse_move",
    "x": 640,
    "y": 360
  }
}
```

Also used for `mouse_down` and `mouse_up` events. These are fire-and-forget for minimal latency.

---

**Related:** [WebRTC Transport](/architecture/webrtc-transport) · [REST API](/api-reference/rest-api) · [Agent Execution](/user-guide/agent-execution)
