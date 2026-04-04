---
sidebar_position: 6
---

# Away Mode Security

Away Mode provides physical access protection when you're away from your desktop, preventing someone from using your computer while still allowing remote control from your phone.

:::info
Away Mode is available on **Windows**, **macOS**, and **Linux** with platform-specific keyboard blocking and idle detection.
:::

## What It Protects Against

| Threat | Protection |
|--------|-----------|
| Shoulder surfing | Lock overlay covers the screen |
| Unauthorized keyboard use | Low-level keyboard hook blocks all keys except PIN digits |
| Screen capture bypass | Overlay is invisible to screen capture software (Windows) |
| Brute force PIN guessing | bcrypt-hashed PIN (cost 10) |
| Removing the lock programmatically | Multiple protection layers ensure resilience |

## User-Facing Protections

### Screen Lock Overlay

A full-screen, always-on-top overlay covers the desktop. The overlay:
- Covers all content on screen
- Cannot be moved, minimized, or closed via standard UI
- On Windows, invisible to screen capture and remote viewing tools (preventing attackers from seeing past the lock)

### Keyboard Blocking

Platform-specific keyboard interception ensures only PIN entry keys work:

| Platform | Method | Behavior |
|----------|--------|----------|
| **Windows** | `WH_KEYBOARD_LL` hook | Allows digits 0–9 (incl. numpad), Backspace, Enter. Blocks all other keys including system shortcuts |
| **macOS** | `CGEventTap` + `NSApplication` presentation options | Allows digit keys, numpad 0–9, Backspace, Return, numpad Enter. Passes through modifier flag changes |
| **Linux (X11)** | `XGrabKeyboard` | Grabs all keyboard input to the overlay window |
| **Linux (Wayland)** | Fullscreen overlay focus | Relies on fullscreen focus to capture input (no low-level key filtering) |

### Mouse Pass-Through

While the overlay is active, mouse events pass through to the desktop below. This allows your phone to continue controlling the desktop via manual control mode — you can work remotely while the physical screen is locked.

## PIN Security

- **Regular PIN length**: 4–12 digits
- **Emergency PIN length**: 6–12 digits (higher minimum for security)
- **Storage**: bcrypt hash (cost factor 10) — PINs are never stored in plaintext
- **Three unlock methods**: Screen PIN, phone command, emergency PIN — all independent

## API Key Protection

API keys are stored as plaintext in `~/.contop/settings.json`. The desktop app runs `migrate_keys_to_plaintext()` on startup to reverse-migrate any legacy DPAPI or keyring-encrypted keys from older installations. The settings file is created with restrictive permissions to limit access to the current OS user.

## Auto-Engage

Away Mode can automatically engage when no keyboard or mouse activity is detected:

- **Default timeout**: 5 minutes (configurable)
- **Detection method**: Polls for input activity every 30 seconds
- **Behavior**: Engages silently — no confirmation dialog

## Security Alerts

If the Away Mode protection is disrupted while active, your phone receives a `security_alert` message with details about the event. This ensures you're always aware if someone attempts to interfere with the lock while you're away.

## Platform Notes

| Platform | Idle Detection | Screen Capture Protection | Keyboard Blocking |
|----------|---------------|--------------------------|-------------------|
| **Windows** | Win32 `GetLastInputInfo` | Yes (excluded from capture) | `WH_KEYBOARD_LL` hook with selective filtering |
| **macOS** | IOKit `HIDIdleTime` | No | `CGEventTap` with selective filtering |
| **Linux (X11)** | `XScreenSaverQueryInfo` | No | `XGrabKeyboard` (all keys grabbed) |
| **Linux (Wayland)** | Not available (returns 0) | No | Fullscreen focus only |

## Limitations

- **PIN only** — No biometric unlock on the desktop side
- **Monitor-based** — The overlay protects the primary display; multi-monitor support covers the primary monitor
- **Wayland** — Idle detection and keyboard grabbing are limited due to Wayland's security model

---

**Related:** [Away Mode](/user-guide/away-mode) · [Desktop App](/user-guide/desktop-app) · [Pairing & Encryption](/security/pairing-and-encryption)
