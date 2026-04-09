---
sidebar_position: 1
---

# System Requirements

## Desktop (Server Host)

| Requirement | Details |
|-------------|---------|
| **OS** | Windows 10/11, macOS 12+, Linux (Ubuntu 22.04+, Fedora 38+) |
| **Python** | 3.12+ (required for the Contop server) |
| **Node.js** | 18+ (for the desktop GUI and build tools) |
| **Package Manager** | [uv](https://docs.astral.sh/uv/) (Python dependency management) |
| **RAM** | 4 GB minimum, 8 GB recommended (16 GB if using local OmniParser) |
| **Disk** | ~500 MB for server + dependencies |
| **[Docker](/security/docker-sandbox)** | Optional - required for sandboxed command execution |
| **GPU** | Optional - NVIDIA GPU accelerates OmniParser (CPU fallback available) |

### Platform-Specific Notes

- **Windows**: Git Bash is auto-discovered and used as the default shell for CLI execution. PyAutoGUI and platform adapters use `pywinauto` + `ctypes` for GUI automation.
- **macOS**: Accessibility permissions must be granted for GUI automation. Uses `pyobjc` for native accessibility APIs.
- **Linux**: Requires `wmctrl` and `xdotool` for window management. Falls back to `pyatspi` for accessibility.

## Mobile Client

| Requirement | Details |
|-------------|---------|
| **iOS** | 15.0+ (standalone build required; Expo Go for development only) |
| **Android** | API 24+ (Android 7.0+) with Expo Go or standalone APK |
| **Biometrics** | Face ID, Touch ID, or Android biometric required for pairing |

## Network

- Both devices must be able to establish a WebRTC peer connection
- **LAN**: Same local network (fastest, no external dependencies)
- **Tailscale**: VPN mesh network for remote access without public exposure
- **Cloudflare Tunnel**: Automatic public URL for global access (cloudflared auto-installed)
- STUN/TURN servers used for NAT traversal (Google STUN servers by default)

---

**Related:** [Installation](/getting-started/installation) · [Quick Start](/getting-started/quick-start)
