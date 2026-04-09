---
sidebar_position: 3
---

# WebRTC Transport

Contop uses WebRTC for all real-time communication between the mobile app and server, providing sub-700ms latency, NAT traversal, and end-to-end encryption.

## Why WebRTC?

- **Low latency** - Sub-700ms for data channel messages, real-time video streaming
- **NAT traversal** - Works across firewalls and NATs with STUN/TURN
- **E2E encryption** - DTLS for data channels, SRTP for video
- **P2P** - Direct connection between phone and desktop (no relay server in most cases)

## Connection Lifecycle

```mermaid
sequenceDiagram
    participant Phone
    participant Server

    Phone->>Server: Connect WebSocket (/ws/signaling)
    Phone->>Server: SDP Offer + device metadata
    Server-->>Phone: SDP Answer
    Phone->>Server: ICE Candidates
    Server-->>Phone: ICE Candidates
    Note over Phone,Server: P2P Connection Established
    Phone->>Server: Close WebSocket
    Note over Phone,Server: Signaling no longer needed
    Phone<-->Server: Data Channels + Video Track
```

### Signaling Phase

The WebSocket (`/ws/signaling`) is only used for the initial SDP/ICE exchange, handled by the [Contop Server](/architecture/contop-server). Once the P2P connection is established, the WebSocket is closed. Closing the signaling WebSocket does NOT close the peer connection.

### Device Metadata in SDP

The mobile app includes device metadata in the SDP offer:
- `device_name` - From expo-device (e.g., "iPhone 15 Pro")
- `location` - GPS coordinates from expo-location

The server extracts this during signaling for the device management panel.

## Data Channels

Two data channels are established for different reliability needs:

### Reliable Channel (`contop`)

- **Ordered, reliable delivery** (TCP-like semantics)
- Used for: commands, progress updates, results, confirmations, session control
- All messages use the canonical envelope format:

```json
{
  "type": "user_intent",
  "id": "uuid-v4",
  "payload": { "text": "...", "frame_b64": "..." }
}
```

### Unreliable Channel (`contop-fast`)

- **Unordered, no retransmission** (`ordered: false`, `maxRetransmits: 0`)
- Used for: `mouse_move`, `mouse_down`, `mouse_up` events during manual control
- Fire-and-forget for lowest possible latency

## Keepalive Heartbeat

- **Interval**: 30 seconds
- **Max missed**: 3 consecutive misses before timeout warning
- **Synchronous send** (not async - was causing race conditions)
- **Auto-restart**: Done callback restarts the timer if it crashes
- **No auto-close**: Timeout does NOT close the connection (mobile may be backgrounded)

## Connection Loss Behavior

When the WebRTC connection drops:

1. **Immediate execution kill** - `_kill_execution_on_disconnect()` fires with no grace period
2. **Confirmation cleanup** - Pending `agent_confirmation_request` futures are resolved as rejected (expired)
3. **Message queue** - A `deque(maxlen=1000)` queues messages while disconnected and flushes on reconnect
4. **Execution transfer** - If a new peer connects, the running execution is detached from the old peer and adopted by the new one

## STUN/TURN Infrastructure

- **STUN**: Google's public STUN servers (`stun:stun.l.google.com:19302`) for NAT traversal
- **TURN**: Available if needed for symmetric NAT scenarios (configured in mobile app)

## Video Bitrate Tuning

The server applies a two-pronged approach to maximize video quality from the first frame:

### Encoder Defaults

aiortc's default video encoder bitrates are overridden at import time for VP8 and H264:

| Parameter | Default (aiortc) | Contop Override |
|-----------|-------------------|-----------------|
| Start bitrate | 500 Kbps | **1.5 Mbps** |
| Max bitrate | 1.5 Mbps | **5 Mbps** |
| Min bitrate | 250 Kbps | 250 Kbps (unchanged) |

### SDP Bitrate Hints

The server injects `x-google-start-bitrate` and `x-google-max-bitrate` attributes into the SDP answer's video fmtp lines:

- `x-google-start-bitrate=2000` (2 Mbps) - tells the mobile client's libwebrtc to begin bandwidth estimation high
- `x-google-max-bitrate=8000` (8 Mbps) - raises the ceiling for congestion control

This is the same technique used by Chrome Remote Desktop to avoid the slow ramp-up problem where the first few seconds of video are pixelated while bandwidth estimation converges.

## Encryption

| Layer | Protocol | Purpose |
|-------|----------|---------|
| Data channels | DTLS 1.2+ | Encrypt commands, results, progress |
| Video track | SRTP | Encrypt screen capture stream |
| Certificate verification | QR code fingerprint | Out-of-band key exchange |

---

**Related:** [Connection Methods](/user-guide/connection-methods) · [Data Channel Protocol](/api-reference/data-channel-protocol) · [Architecture Overview](/architecture/overview)
