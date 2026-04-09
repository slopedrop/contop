---
sidebar_position: 8
---

# Device Management

Manage all phones paired with your desktop from the Devices tab in the desktop app.

## Pairing a New Device

1. Generate a QR code from the desktop app (permanent or temporary)
2. Scan the QR code from the mobile app
3. Complete biometric authentication on the phone
4. The device appears in the Devices tab

### Permanent vs Temporary Pairing

| Type | Token TTL | Persistence | Use Case |
|------|-----------|-------------|----------|
| **Permanent** | 30 days | Saved to disk, survives server restart | Your personal phone |
| **Temporary** | 4 hours | In-memory only | Guest access, one-time use |

## Viewing Paired Devices

The Devices tab displays all paired devices with live status (polled every 5 seconds):

| Field | Description |
|-------|-------------|
| **Device name** | From Expo Device API (e.g., "iPhone 15 Pro") |
| **Connection status** | Connected (green) or Disconnected (grey) |
| **Connection path** | LAN, Tailscale, or Cloudflare Tunnel |
| **Location** | City and country via reverse geocoding from expo-location (if granted) |
| **Last seen** | Timestamp of last activity |
| **Paired at** | When the device was first paired |

## Revoking Access

To disconnect and permanently revoke a device's access:

1. Click the **Revoke** button next to the device
2. Confirm in the modal dialog

Revoking a device:
- Immediately force-closes any active WebRTC session via `DELETE /api/pair?device_id=...`
- Invalidates the pairing token
- The phone must re-scan a QR code to connect again

## OS Notifications

The desktop app sends OS-level notifications for device events:

- **Device connected** - A paired device established a WebRTC session
- **Device disconnected** - A paired device's session ended
- **Token replaced** - A device re-paired, replacing its old token

---

**Related:** [Connection Methods](/user-guide/connection-methods) · [REST API - Devices](/api-reference/rest-api) · [Pairing & Encryption](/security/pairing-and-encryption)
