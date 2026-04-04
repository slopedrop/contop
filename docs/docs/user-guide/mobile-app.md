---
sidebar_position: 1
---

# Mobile App

The Contop mobile app is your primary interface for controlling your desktop remotely. Built with React Native and Expo, it runs on both iOS and Android.

## Connection Flow

1. **Splash Screen** — App loads and checks for saved pairing tokens
2. **Connect Screen** — Scan [QR code](/user-guide/connection-methods) or auto-reconnect to a previously paired device. A **Forget Connection** button lets you clear saved credentials and pair with a different desktop.
3. **Biometric Auth** — Confirm identity with Face ID, Touch ID, or Android biometrics
4. **Session Screen** — Connected and ready to send commands

`[SCREENSHOT: Connection flow screens]`

### Auto-Reconnect

If you've previously paired with a device (permanent connection), the app navigates to biometric re-authentication on launch and then reconnects using saved credentials from the secure keychain.

For temporary connections that drop mid-session, the app auto-reconnects with exponential backoff (1s → 2s → 3s → 5s → 8s) with a maximum of 5 attempts. An ICE restart is attempted first for lightweight recovery. A 2-second silent window prevents flickering "reconnecting" UI on fast connections.

Permanent connections do not auto-reconnect on mid-session drops — you must manually re-authenticate.

## Viewport Layouts

The session screen supports 5 adaptive layout modes, switchable at any time:

| Layout | Description |
|--------|-------------|
| **Video Focus** | Large remote screen feed, small [execution thread](#execution-thread) overlay |
| **Split View** | 50/50 split between video feed and execution thread |
| **Thread Focus** | Full execution thread, small video preview |
| **Side by Side** | Landscape: video and thread side by side |
| **Fullscreen Video** | Full-screen remote desktop view for manual control |

`[SCREENSHOT: Layout modes comparison]`

Layout preferences are saved per orientation — portrait and landscape each remember your last selected layout.

## Execution Thread

The execution thread displays all interactions with the AI agent:

- **User messages** — Your text or transcribed voice commands
- **AI responses** — Natural language responses from the agent
- **Tool call cards** — Each tool execution shown with:
  - Tool name and parameters
  - Model used (e.g., `gemini-2.5-flash`)
  - Vision backend used (e.g., `omniparser`, `ui_tars`)
  - Execution status (running, completed, failed)
  - Duration in milliseconds
- **Confirmation requests** — Destructive action approval prompts
- **Thinking indicators** — Animated shimmer when the agent is planning

`[SCREENSHOT: Execution thread with tool call cards]`

## Model Badges

The execution input bar shows badges on model chips to indicate the current auth mode:

- **NO KEY** — The selected model's provider has no API key configured. The model can still be used if subscription mode is active for that provider.
- **SUB** — The selected model is routed through the CLI proxy (subscription mode). Vision fallback is unavailable in this mode.

## Navigation

- **Execution bar** at the bottom for text input and voice recording
- **Layout switcher** to toggle between viewport modes
- **Session menu** for session history, settings, and device management
- **Stop button** appears during active [agent execution](/user-guide/agent-execution) to cancel

---

**Related:** [Desktop App](/user-guide/desktop-app) · [Voice & Text Input](/user-guide/voice-and-text-input) · [Connection Methods](/user-guide/connection-methods)
