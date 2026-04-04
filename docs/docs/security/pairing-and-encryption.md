---
sidebar_position: 2
---

# Pairing & Encryption

Contop uses QR code pairing for out-of-band key exchange and WebRTC for end-to-end encrypted communication.

## QR Code Pairing

The QR code serves as a secure out-of-band channel for exchanging connection details and cryptographic material.

### QR Payload

The QR code contains a compact JSON payload with short keys for ~40% smaller QR codes:

| Key | Full Name | Required | Description |
|-----|-----------|----------|-------------|
| `t` | token | Yes | Pairing token string |
| `d` | dtls_fingerprint | Yes | SHA-256 fingerprint of server's DTLS certificate |
| `h` | host | Yes | Server LAN IP |
| `p` | port | Yes | Server port |
| `e` | expires_at | Yes | Token expiration timestamp (ISO 8601) |
| `c` | connection_type | Yes | `"permanent"` or `"temp"` |
| `g` | gemini_api_key | No | Gemini API key for mobile use (omitted if empty or in subscription mode) |
| `o` | openai_api_key | No | OpenAI API key (if configured) |
| `a` | anthropic_api_key | No | Anthropic API key (if configured) |
| `r` | openrouter_api_key | No | OpenRouter API key (if configured) |
| `ts` | tailscale_ip | No | Tailscale IP (if available) |
| `s` | signaling_url | No | Signaling URL (temp connections only) |
| `pa` | provider_auth | No | Compact subscription flags (`pa.g`, `pa.a`, `pa.o` = `"sub"`) |

Pairing requires at least one API key **or** at least one provider configured in subscription mode. When a provider is in subscription mode, its API key is omitted from the QR payload (the mobile app doesn't need it — requests route through the desktop's CLI proxy instead). This means subscription-only users can pair without configuring any API keys.

### DTLS Certificate

- Ephemeral self-signed X.509 certificate (RSA 2048)
- SHA-256 fingerprint in `AB:CD:EF:...` format
- Generated via `asyncio.to_thread()` to avoid blocking
- Fingerprint is embedded in the QR code for verification during WebRTC handshake

## Token Management

### Token Types

| Type | TTL | Persistence | Use Case |
|------|-----|-------------|----------|
| **Permanent** | 30 days | `~/.contop/tokens.json` on disk | Your personal devices |
| **Temporary** | 4 hours | In-memory only | Guest access, demos |

### Token Lifecycle

1. **Generation** — `POST /api/pair` creates a token with metadata
2. **Validation** — Token verified on every WebRTC signaling connection
3. **Renewal** — Permanent tokens reused if still valid (QR regenerated with fresh network info)
4. **Revocation** — `DELETE /api/pair` or per-device `DELETE /api/pair?device_id=...`
5. **Single active per device** — Auto-revokes old token when same `device_id` re-pairs
6. **Per-device revoke** — `DELETE /api/pair?device_id=...` revokes a specific device's token and force-disconnects the session

### Token Storage

- **Server**: `~/.contop/tokens.json` with `0o600` permissions (owner-only read/write)
- **Mobile**: OS secure enclave via `expo-secure-store` (Keychain on iOS, Keystore on Android) — **never** in AsyncStorage

## WebRTC Encryption

All data between phone and desktop is encrypted end-to-end:

| Channel | Encryption | Key Exchange |
|---------|-----------|-------------|
| Data channels | DTLS 1.2+ | Certificate fingerprint verified via QR |
| Video stream | SRTP | Keys derived from DTLS handshake |

### Certificate Fingerprint Verification

During the WebRTC handshake, the mobile app verifies that the server's DTLS certificate fingerprint matches the one embedded in the QR code. This prevents man-in-the-middle attacks even if the signaling channel is compromised.

## Network Detection

The server detects available network paths for the QR code:

1. **LAN IP** — Socket-based detection of local network address
2. **Tailscale IP** — `tailscale ip -4` CLI or 100.x.y.z interface scan
3. **Tunnel URL** — Cloudflare Tunnel URL (started on demand)

The mobile app uses `connectSignalingWithFallback()` to try LAN → Tailscale → Tunnel in order.

## Mobile Device Metadata

The mobile app sends device metadata during pairing:
- **Device name** — From `expo-device` (e.g., "iPhone 15 Pro")
- **Location** — GPS from `expo-location` (if permission granted)

This metadata is stored alongside the token and displayed in the desktop's device management panel.

---

**Related:** [Connection Methods](/user-guide/connection-methods) · [Device Management](/user-guide/device-management) · [REST API — Pairing](/api-reference/rest-api)
