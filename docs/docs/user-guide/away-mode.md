---
sidebar_position: 7
---

# Away Mode

Away Mode locks your desktop screen when you're physically away, preventing unauthorized access while still allowing remote control from your phone.

:::info
Away Mode is supported on **Windows** (full), **macOS** (full), and **Linux/X11** (partial). Linux/Wayland has limited support — no low-level keyboard grab or idle detection.
:::

## What It Does

When engaged, Away Mode:

- Displays a full-screen lock overlay on your desktop
- Blocks all keyboard input (except PIN entry digits)
- Prevents screen capture of the overlay content
- Allows your phone to continue controlling the desktop through the overlay

## Setting Up

### PIN Configuration

1. Open **Settings → Away Mode** in the desktop app
2. Set a PIN (4–12 digits)
3. Optionally set an emergency recovery PIN (6–12 digits, different from the main PIN)

### Auto-Engage

Configure an idle timeout to automatically engage Away Mode when no keyboard or mouse input is detected:

- Default: 5 minutes
- Configurable in Settings
- The system polls for input activity every 30 seconds

:::note
Auto-engage is not available on Linux/Wayland due to missing idle-time APIs.
:::

## Engaging Away Mode

You can engage Away Mode in two ways:

1. **From phone** — Send an `away_mode_engage` command from the mobile app
2. **Auto-engage** — Triggers automatically after the configured idle timeout

`[SCREENSHOT: Away Mode lock screen]`

## Unlocking

Three independent unlock methods:

| Method | How |
|--------|-----|
| **Screen PIN** | Type your PIN directly on the desktop keyboard (only digits 0–9, Backspace, and Enter are allowed) |
| **Phone command** | Send `away_mode_disengage` from the mobile app |
| **Emergency PIN** | Enter the emergency recovery PIN at the desktop (for when you've lost phone access) |

## Phone Control Through Lock Screen

While Away Mode is active, your phone retains full manual control capabilities. Mouse events pass through the overlay to the desktop, allowing you to continue working remotely even while the physical screen is locked.

## Security Protections

Away Mode uses multiple protection layers to ensure the lock screen cannot be bypassed:

- On Windows and macOS, the overlay is excluded from screen capture software, preventing remote viewing tools from seeing past the lock. Linux does not currently support capture exclusion.
- A low-level keyboard hook blocks most key combinations (Alt+F4, Alt+Tab, etc.). On macOS, Dock, menu bar, and process switching are also disabled. On Linux/Wayland, the overlay relies on fullscreen focus rather than a keyboard hook.
- The PIN is hashed with bcrypt (cost 10) — not stored in plaintext
- Your phone receives a security alert if the protection is disrupted

---

**Related:** [Away Mode Security](/security/away-mode-security) · [Desktop App](/user-guide/desktop-app) · [Device Management](/user-guide/device-management)
