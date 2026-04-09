---
sidebar_position: 2
---

# Installation

## Desktop App (Recommended)

The [Tauri desktop app](/user-guide/desktop-app) provides a GUI for settings management, [QR code](/user-guide/connection-methods) pairing, and automatic server lifecycle management.

### macOS

**Homebrew (recommended - no security warnings):**

```bash
brew install slopedrop/contop/contop
```

**Manual download:**

Download the `.dmg` from the [Releases page](https://github.com/slopedrop/contop/releases), open it, and drag Contop to the Applications folder.

On first launch, macOS may show a security warning since the app is not code-signed. Right-click the app → **Open** → click **Open** in the dialog. Grant Accessibility permissions when prompted.

### Windows

**Scoop (recommended - no SmartScreen warnings):**

```powershell
scoop bucket add contop https://github.com/slopedrop/scoop-contop
scoop install contop
```

**Manual download:**

Download and run the NSIS installer (`.exe`) from the [Releases page](https://github.com/slopedrop/contop/releases). The installer registers Contop in the Start Menu and handles all dependencies including CUDA if an NVIDIA GPU is detected.

Windows SmartScreen may show a warning since the app is not code-signed. Click **More info** → **Run anyway**.

### Linux

Download from the [Releases page](https://github.com/slopedrop/contop/releases):

```bash
# AppImage (any distro)
chmod +x contop-desktop_x.x.x_amd64.AppImage
./contop-desktop_x.x.x_amd64.AppImage

# Debian / Ubuntu
sudo dpkg -i contop-desktop_x.x.x_amd64.deb
```

### First-Launch Setup

When you install via Homebrew, Scoop, or download the macOS/Linux build directly, Python dependencies are installed automatically on first launch. The app shows a progress overlay with download status - this takes a few minutes depending on your internet speed (~500 MB for CPU, ~2.5 GB with CUDA).

The Windows NSIS installer handles this during installation instead.

:::tip
All download links are available on the [Releases page](https://github.com/slopedrop/contop/releases).
:::

## Mobile App

### iOS (TestFlight)

1. Join the Contop TestFlight beta (link on website)
2. Install via TestFlight
3. Open and grant camera + microphone permissions

### Android (APK)

1. Download the latest APK from the releases page
2. Enable "Install from unknown sources" if prompted
3. Install and open
4. Grant camera + microphone permissions

:::tip
Production builds are created via Expo EAS Build. The native WebRTC bridge requires bare workflow compilation - Expo Go is only for development.
:::

## Developer Setup (Server Only)

If you want to run just the Python server without the desktop app:

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager

### Install and Run

```bash
cd contop-server
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

The server starts on port 8000 and prints connection info to the console.

### Optional: Docker for Sandbox Execution

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) to enable sandboxed execution of dangerous commands. The server auto-detects Docker and starts it if needed.

Without Docker, restricted commands run in a limited host subprocess with a 10-second timeout and 10 KB output limit.

## CLI Proxy Setup (Subscription Mode)

If you have a Claude Pro/Max, Gemini Pro, or ChatGPT Pro subscription, install the corresponding CLI to use it with Contop:

```bash
# Claude (Anthropic)
npm install -g @anthropic-ai/claude-code
claude           # complete OAuth login

# Gemini (Google)
npm install -g @google/gemini-cli
gemini auth login  # authenticate with Google

# OpenAI (Codex)
npm install -g @openai/codex
codex auth         # authenticate with OpenAI
```

The desktop app manages the CLI proxy processes automatically. Enable subscription mode in the Settings panel.

:::info
You only need to install CLIs for providers whose subscription you want to use. API keys continue to work for all providers.
:::

---

**Related:** [System Requirements](/getting-started/system-requirements) · [Quick Start](/getting-started/quick-start) · [Desktop App](/user-guide/desktop-app)
