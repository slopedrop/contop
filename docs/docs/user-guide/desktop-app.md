---
sidebar_position: 2
---

# Desktop App

The Contop desktop app is a lightweight Tauri v2 application (Rust + HTML/CSS/JS) that manages the Python server and provides a settings interface.

## Server Lifecycle

The desktop app manages the Python FastAPI server as a [sidecar](/architecture/contop-server) process:

- **Start** — Launches `uv run uvicorn main:app` automatically on app startup
- **Stop** — Kills the entire process tree (uv → uvicorn → Python) on app exit
- **Restart** — Available via the settings panel for configuration changes

`[SCREENSHOT: Desktop app main window]`

Process group management ensures clean shutdown — on Windows, the entire process tree is terminated; on Unix, `setpgid` group kills are used.

## QR Code Display

The main window displays the pairing QR code:

- **Permanent QR** — Always available for devices on the same LAN
- **Temporary QR** — Generated on demand with a Cloudflare Tunnel URL for remote access (4-hour TTL)

The QR code auto-refreshes when network conditions change (new LAN IP, Tailscale connection, tunnel URL).

## Device Monitoring

The Devices tab shows all paired devices with live status:

- Device name and connection type (permanent/temporary)
- Connection status (connected/disconnected) with 5-second polling
- Connection path (LAN, Tailscale, or Cloudflare Tunnel)
- Location — city and country via reverse geocoding (if location permission granted on phone)
- Last seen timestamp
- **Revoke** button to disconnect and invalidate a device's pairing token

`[SCREENSHOT: Device management panel]`

OS notifications fire on device connect, disconnect, and token replacement events.

## CLI Proxy Controls

The desktop app manages CLI proxy processes for [subscription mode](/getting-started/configuration#subscription-mode-optional):

- **Start/Stop buttons** per provider (Anthropic, Gemini, OpenAI) — manually control each proxy process
- **Port inputs** — Configure the local port for each proxy (defaults: Anthropic 3456, Gemini 3457, OpenAI 3458)
- **Status indicators** — Shows `running`, `starting`, `stopped`, or `degraded` per provider
- **Watchdog** — Auto-restarts crashed proxy processes unless the user explicitly stopped them
- **Auto-start** — When `proxy_auto_start` is enabled in settings, proxies start automatically with the server

Proxy logs are written to `~/.contop/proxy-{provider}.log`.

## Settings Panel

Configure all Contop settings through the desktop GUI:

- **API Keys** — Gemini, OpenAI, Anthropic, OpenRouter (stored in plaintext in `settings.json`)
- **Subscription Auth** — Per-provider toggle between "API Key" and "Subscription" mode
- **Security** — Restricted paths, forbidden commands, destructive patterns
- **System Prompts** — Custom conversation and execution agent prompts
- **Skills** — Enable/disable skills, create custom skills, edit SKILL.md files
- **[Away Mode](/user-guide/away-mode)** — Set PIN, configure auto-engage timeout, emergency PIN

`[SCREENSHOT: Settings panel]`

---

**Related:** [Mobile App](/user-guide/mobile-app) · [Away Mode](/user-guide/away-mode) · [Configuration](/getting-started/configuration)
