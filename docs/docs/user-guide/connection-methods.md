---
sidebar_position: 9
---

# Connection Methods

Contop supports three connection methods for reaching your desktop from anywhere.

## LAN (Local Network)

The fastest option — use when your phone and desktop are on the same Wi-Fi network.

- **Latency**: Under 10ms typical
- **Setup**: None (auto-detected)
- **How it works**: The QR code includes your desktop's LAN IP. WebRTC connects directly over the local network.

## Tailscale (VPN Mesh)

For remote access without exposing your desktop to the internet.

- **Latency**: 20–100ms depending on proximity
- **Setup**: Install [Tailscale](https://tailscale.com/) on both desktop and phone
- **How it works**: The QR code includes your Tailscale IP (100.x.y.z range). Traffic is encrypted end-to-end through the Tailscale mesh.
- **Detection**: Auto-detected via `tailscale ip -4` CLI or by scanning network interfaces for 100.x.y.z addresses

## Cloudflare Tunnel (Global Access)

For access from anywhere in the world, no VPN required.

- **Latency**: 50–200ms depending on region
- **Setup**: None — `cloudflared` is auto-installed
- **How it works**: The server starts a Cloudflare Tunnel on demand (when you generate a temporary QR code), creating a public WebSocket URL. The mobile app connects via this URL for signaling, then establishes a direct WebRTC P2P connection.

:::note
The Cloudflare Tunnel is only used for the initial WebRTC signaling (SDP/ICE exchange). Once the P2P connection is established, all data flows directly between your phone and desktop via WebRTC.
:::

## WebRTC P2P Encryption

Regardless of connection method, all data between your phone and desktop is encrypted:

- **DTLS** — Encrypts data channels
- **SRTP** — Encrypts video stream
- **Certificate fingerprint** — Verified during pairing via the QR code payload

[STUN servers](/architecture/webrtc-transport) (Google's public STUN) are used for NAT traversal to establish the P2P connection.

## Choosing the Right Method

| Scenario | Recommended Method |
|----------|--------------------|
| Same room / office | LAN |
| Home to office | Tailscale |
| Coffee shop / travel | Cloudflare Tunnel |
| Maximum security | Tailscale (no public exposure) |
| Quick one-time access | Cloudflare Tunnel (temp QR) |

## Troubleshooting

### Can't connect via LAN
- Verify both devices are on the same network
- Check if a firewall is blocking the server port (default 8000, configurable via `CONTOP_PORT`)
- Try the desktop's IP directly: `http://<desktop-ip>:8000/health`

### Tailscale not detected
- Run `tailscale status` on the desktop to verify it's connected
- Ensure Tailscale is running on both devices
- Check that the Tailscale IP is in the 100.x.y.z range

### Cloudflare Tunnel fails
- Verify `cloudflared` is installed and in PATH
- Check internet connectivity on the desktop
- The tunnel may fail if Cloudflare's edge is unreachable

---

**Related:** [WebRTC Transport](/architecture/webrtc-transport) · [Device Management](/user-guide/device-management) · [Quick Start](/getting-started/quick-start)
