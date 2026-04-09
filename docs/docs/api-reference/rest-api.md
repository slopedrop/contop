---
sidebar_position: 1
---

# REST API

All REST endpoints are served by the FastAPI server on port 8000.

## Health

### `GET /health`

Returns server health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "contop-server",
  "version": "0.1.0"
}
```

## [Pairing](/security/pairing-and-encryption)

### `POST /api/pair`

Generate a new pairing token and return QR code as PNG image.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `device_id` | `string` | `null` | Device identifier (auto-generated if omitted) |
| `connection_type` | `string` | `"permanent"` | `"permanent"` (30-day) or `"temp"` (4-hour) |

**Response:** PNG image bytes with headers:
- `x-pairing-token` - The generated token string
- `x-pairing-expires-at` - ISO 8601 expiration timestamp

**Notes:** For permanent connections, reuses an existing valid token if one exists. The QR code is always regenerated to reflect current network configuration.

### `GET /api/qr-image`

Return the current QR code as a PNG image.

**Response:** PNG image bytes, or 404 if no active QR exists.

### `GET /api/pair/status`

Return current pairing token status without exposing the token value.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `device_id` | `string` | `null` | Filter by device ID |

**Response:**
```json
{
  "status": "active",
  "expires_at": "2026-04-26T12:00:00Z",
  "connection_type": "permanent"
}
```

### `DELETE /api/pair`

Revoke the active pairing token and force-disconnect any active WebRTC session.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `device_id` | `string` | `null` | Revoke specific device's token |

**Response:**
```json
{ "revoked": true }
```

## Devices

### `GET /api/devices`

Return all paired devices with connection status and recent events.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `since` | `string` | `null` | ISO timestamp - return events since this time |

**Response:**
```json
{
  "devices": [
    {
      "device_id": "abc123",
      "device_name": "iPhone 15 Pro",
      "connection_type": "permanent",
      "connected": true,
      "connection_path": "LAN",
      "last_location": { "lat": 37.7749, "lon": -122.4194 },
      "last_seen": "2026-03-27T10:30:00Z",
      "paired_at": "2026-03-01T08:00:00Z",
      "expires_at": "2026-03-31T08:00:00Z"
    }
  ],
  "events": []
}
```

## Connection

### `GET /api/connection-info`

Return current network connection information.

**Response:**
```json
{
  "lan_ip": "192.168.1.100",
  "tailscale_ip": "100.64.0.1",
  "tailscale_available": true,
  "tunnel_url": "https://abc.trycloudflare.com",
  "tunnel_active": true,
  "connected_clients": 1,
  "has_active_token": true,
  "token_expires_at": "2026-04-26T12:00:00Z",
  "token_connection_type": "permanent"
}
```

### `POST /api/tunnel/start`

Start the Cloudflare tunnel on demand. Returns existing URL if already running.

**Response:**
```json
{
  "tunnel_url": "https://abc.trycloudflare.com",
  "already_running": false
}
```

## Settings

### `GET /api/settings`

Return current settings JSON.

### `PUT /api/settings`

Update settings. Requires `version`, `restricted_paths`, `forbidden_commands` keys.

**Request Body:** Full settings JSON object.

**Response:** Updated settings JSON.

### `POST /api/settings/reset`

Reset all settings to defaults.

### `GET /api/decrypted-keys`

Return API keys from the Tauri desktop app. Keys are stored in plaintext in `settings.json`.

**Response:**
```json
{
  "gemini_api_key": "...",
  "openai_api_key": "...",
  "anthropic_api_key": "...",
  "openrouter_api_key": "..."
}
```

### `GET /api/default-prompts`

Return the built-in default system prompts.

**Response:**
```json
{
  "conversation": "...",
  "execution": "..."
}
```

## [Skills](/api-reference/skills)

### `GET /api/skills`

List all discovered [skills](/api-reference/skills) (metadata only).

**Response:**
```json
[
  {
    "name": "web-research",
    "description": "Search the web and extract information",
    "version": "1.0.0",
    "skill_type": "mixed",
    "enabled": true,
    "has_scripts": true
  }
]
```

### `POST /api/skills`

Create a new skill.

**Request Body:**
```json
{
  "name": "my-skill",
  "description": "What this skill does"
}
```

### `GET /api/skills/{name}`

Return full SKILL.md content for a skill.

### `PUT /api/skills/{name}`

Update a skill's SKILL.md content. Validates YAML frontmatter.

### `GET /api/skills/{name}/workflows`

Return list of script files (YAML workflows and Python tools) with content for a skill.

**Response:**
```json
{
  "skill_name": "web-research",
  "workflows": [
    { "name": "search", "filename": "search.yaml", "content": "..." }
  ]
}
```

### `POST /api/skills/{name}/enable`

Enable a skill. Checks for tool name conflicts before saving.

### `POST /api/skills/{name}/disable`

Disable a skill.

## WebSocket Signaling

### `WS /ws/signaling`

WebSocket endpoint for WebRTC SDP/ICE exchange. Used only during initial connection setup - the WebSocket is closed once the P2P connection is established.

## CLI Proxy

### `POST /api/provider-health`

Check connectivity to the CLI proxy for a given provider.

**Request Body:**
```json
{ "provider": "anthropic" }
```

**Response:**
```json
{
  "status": "ok",
  "models": [{ "id": "claude-sonnet-4-6", "object": "model" }],
  "auth_type": "subscription"
}
```

### `POST /api/notify-proxy-change`

Notify connected mobile clients of proxy status changes. Called by the desktop app after starting/stopping CLI proxies.

**Response:**
```json
{
  "pushed": 1,
  "provider_auth": {
    "anthropic": { "mode": "cli_proxy", "available": true },
    "gemini": { "mode": "api_key", "available": false },
    "openai": { "mode": "api_key", "available": false }
  }
}
```

## Away Mode

### `GET /api/away-mode/status`

Return Away Mode status by querying the Tauri health server.

**Response:**
```json
{
  "away_mode": false,
  "overlay_active": false
}
```

---

**Related:** [Contop Server](/architecture/contop-server) · [Data Channel Protocol](/api-reference/data-channel-protocol) · [Configuration](/api-reference/configuration)
