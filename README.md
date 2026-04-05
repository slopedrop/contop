<p align="center">
  <img src="contop-icon.png" width="128" alt="Contop" />
</p>

<h1 align="center">Contop</h1>

<p align="center">
  <strong>Your Desktop, From Anywhere</strong>
</p>

<p align="center">
  AI-powered remote desktop control from your phone
</p>

<p align="center">
  <a href="https://contop.app">Website</a> &bull;
  <a href="https://docs.contop.app">Docs</a> &bull;
  <a href="https://github.com/slopedrop/contop/releases">Releases</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/python-%3E%3D3.12-3776AB.svg?logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/TS%20%28mobile%29-5.9-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript (mobile)" />
  <img src="https://img.shields.io/badge/TS%20%28desktop%29-5.6-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript (desktop)" />
  <img src="https://img.shields.io/badge/React%20Native-0.83-61DAFB.svg?logo=react&logoColor=black" alt="React Native" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8D8.svg?logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/Gemini-ADK-886FBF.svg?logo=google&logoColor=white" alt="Google ADK" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform" />
</p>

---

Contop turns your phone into an AI remote control for any desktop. Speak or type a command on your mobile, and an autonomous agent on your computer observes your screen, runs CLI commands, clicks buttons, fills forms, automates browsers, and streams progress back — all in real time over a peer-to-peer WebRTC tunnel.

No port forwarding. No VPN. No SSH. Scan a QR code and start working.

## How It Works

```mermaid
graph LR
    subgraph Phone["Your Phone"]
        Input["Voice / Text Input"]
        Feed["Live Feed"]
    end

    subgraph Desktop["Your Desktop"]
        Agent["ADK Agent — 30+ Tools — Security Gate"]
        Proxy["CLI Proxy — Subscription Mode"]
    end

    subgraph Screen["Your Screen"]
        Targets["Screenshots + UI Elements + CLI / GUI Actions"]
    end

    Input <-->|WebRTC P2P Data Channel| Agent
    Agent -->|progress / results / video| Feed
    Agent -->|observe| Targets
    Agent -->|execute| Targets
    Agent -.->|subscription| Proxy
    Proxy -.->|CLI tool| Targets
```

## Features

### Autonomous AI Agent
- **30+ execution tools** — CLI, GUI automation, file operations, browser control, window management, document processing, app lifecycle, and more
- **Smart vision routing** — 9 backends: OmniParser V2, Gemini Computer Use, Accessibility Tree, and 6 OpenRouter vision models (UI-TARS, Kimi, Qwen, Phi, Molmo, Holotron)
- **Multi-step planning** — plan-generation tool with research sub-agent, tool chaining, and up to 50 iterations per task
- **Multi-provider LLM** — Gemini, OpenAI, Anthropic, Groq, Mistral, and more via LiteLLM
- **Subscription mode** — use your existing Claude Pro/Max, Gemini Pro, or ChatGPT Plus/Pro subscription instead of API keys via the built-in CLI proxy (text-only — no LLM vision fallback)
- **Skills system** — extensible via SKILL.md standard with YAML workflows and Python tool loading
- **Real-time feedback** — step-by-step progress, screenshots, and model/backend transparency streamed to your phone

### Security
- **Dual-Tool Evaluator** — every command classified and routed through a security gate before execution
- **Destructive action approval** — dangerous operations require explicit user confirmation
- **Sandboxed execution** — high-risk commands run in an isolated Docker container
- **Restricted path isolation** — prevents agent from accessing protected directories
- **JSONL audit log** — every tool call logged with timestamps, commands, and outcomes
- **Away Mode** — PIN-locked secure overlay with auto-engage on idle (Windows)

### Connectivity
- **QR code pairing** — scan to connect with 30-day persistent tokens, no IP configuration needed
- **Cloudflare Tunnel** — automatic public URL, zero port forwarding
- **WebRTC P2P** — dual data channels (reliable + unreliable) with live video streaming
- **Paired device management** — geo-location tracking, connection path visibility, per-device revoke, OS notifications
- **Connection loss resilience** — automatic execution kill on disconnect, chat-only fallback mode

### Desktop App (Tauri v2)
- Lightweight native shell (Rust) with settings GUI
- Manages the Python server as a sidecar process
- API key and subscription mode configuration, security rules, system prompts
- CLI proxy lifecycle management — auto-start, health monitoring, and watchdog restart
- Cross-platform: Windows, macOS, Linux

### Mobile App (Expo / React Native)
- Adaptive layouts: split-view, side-by-side, fullscreen video, thread-focus
- Real-time execution thread with tool outputs and screenshots
- Session history with persistence and restore
- Model selection, extended thinking toggle, custom instructions

## Architecture

```mermaid
graph TB
    subgraph Phone["Mobile Client — Expo / React Native"]
        STT["Multi-Provider STT — Voice Input"]
        LLM["Multi-Provider LLM — Conversation Agent"]
        UI["Session UI — Execution Thread + Remote Screen"]
    end

    subgraph Desktop["Desktop Host"]
        subgraph Tauri["Tauri v2 — Rust + Vite"]
            GUI["Settings GUI — QR Pairing / Config"]
            Sidecar["Python Sidecar — Process Manager"]
            Away["Away Mode — PIN Overlay"]
            CLIProxy["CLI Proxy — Claude / Gemini / Codex"]
        end

        subgraph Server["FastAPI Server — Python 3.12"]
            Signal["WebRTC Signaling"]
            ADK["ADK Execution Agent — Multi-Provider"]
            DTE["Dual-Tool Evaluator — Security Gate"]
            Audit["JSONL Audit Logger"]
            Skills["Skills Engine"]
        end

        subgraph Tools["30+ Execution Tools"]
            CLI["execute_cli — Host / Git Bash"]
            GUIAuto["execute_gui — PyAutoGUI"]
            Sandbox["execute_cli_sandboxed — Docker"]
            Screen["observe_screen — Smart Vision Routing"]
            CU["execute_computer_use — Gemini CU"]
            Browser["execute_browser — PinchTab CDP"]
            FileOps["File / Document / Window Tools"]
        end
    end

    subgraph Cloud["External Services"]
        GeminiAPI["Gemini / OpenAI / Anthropic / OpenRouter"]
        CF["Cloudflare Tunnel"]
    end

    STT --> LLM
    LLM --> UI
    UI <-->|WebRTC Data Channel| Signal
    Screen -->|WebRTC Video Track| UI

    Signal --> ADK
    ADK --> DTE
    DTE -->|host| CLI
    DTE -->|host| GUIAuto
    DTE -->|host| Screen
    DTE -->|host| CU
    DTE -->|host| Browser
    DTE -->|host| FileOps
    DTE -->|sandbox| Sandbox
    ADK --> Audit
    ADK --> Skills

    ADK -.->|API| GeminiAPI
    ADK -.->|subscription| CLIProxy
    LLM -.->|API| GeminiAPI
    Signal -.-> CF

    Sidecar --> Server
    Sidecar --> CLIProxy
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Mobile** | React Native 0.83, Expo 55, TypeScript, NativeWind v4, Zustand |
| **Desktop** | Tauri v2 (Rust + Vite), Win32 APIs for Away Mode |
| **Server** | Python 3.12, FastAPI, asyncio, aiortc |
| **AI Agent** | Google ADK, LiteLLM (multi-provider routing) |
| **AI Models** | Gemini, OpenAI, Anthropic, Any model on OpenRouter (API keys or CLI subscriptions) |
| **Vision** | OmniParser V2, Gemini Computer Use, Accessibility Tree, 6 OpenRouter models |
| **Automation** | PyAutoGUI, platform adapters (Win/Mac/Linux), PinchTab CDP |
| **Networking** | WebRTC (aiortc), Cloudflare Tunnels, DTLS encryption |
| **Security** | Dual-Tool Evaluator, Docker sandbox |

## Quick Start

### Prerequisites

- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Node.js 18+
- A Gemini API key ([get one free](https://aistudio.google.com/apikey)) — or an existing Claude Pro/Max / Gemini Pro / ChatGPT Pro subscription
- Android / iOS device with Expo dev build

### 1. Start the Server

```bash
cd contop-server
uv sync
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Run the Desktop App (optional)

```bash
cd contop-desktop
npm install
npm run tauri dev
```

### 3. Run the Mobile App

```bash
cd contop-mobile
npm install
npx expo run:android   # or: npx expo run:ios
```

### 4. Pair and Go

1. Open the desktop app (or visit `http://localhost:8000`) to see the QR code
2. Scan the QR code from the mobile app
3. Start speaking or typing — the agent observes your screen and executes your commands

> For detailed setup, platform-specific instructions, and configuration options, see the [full documentation](https://docs.contop.app).

## Project Structure

```
contop/
├── contop-server/           # Python FastAPI server + AI agent
│   ├── core/                # Agent, evaluator, signaling, pairing, skills engine
│   ├── tools/               # Vision backends, Docker sandbox, browser automation
│   ├── platform_adapters/   # OS-specific automation (Win / Mac / Linux)
│   ├── skills/              # Built-in skills (web research, IDE chat, CLI patterns)
│   ├── prompts/             # Agent system prompts
│   └── tests/               # pytest (unit + ATDD)
├── contop-mobile/           # Expo / React Native mobile client
│   ├── app/                 # Expo Router screens
│   ├── components/          # ExecutionThread, ExecutionInputBar, RemoteScreen
│   ├── hooks/               # useWebRTC, useConversation
│   ├── stores/              # Zustand state management
│   └── services/            # AI settings, session storage
├── contop-cli-proxy/        # CLI subscription proxy (Node.js / TypeScript)
│   └── src/                 # OpenAI-compatible proxy wrapping Claude/Gemini/Codex CLIs
├── contop-desktop/          # Tauri v2 desktop app
│   ├── src/                 # Vite frontend (HTML/CSS/JS)
│   └── src-tauri/           # Rust backend, Away Mode, sidecar + proxy management
├── website/                 # Next.js 15 marketing site
└── docs/                    # Docusaurus 3 documentation
```

## Testing

```bash
cd contop-server && uv run pytest                # all server tests
cd contop-mobile && npx jest                     # all mobile tests
```

## Links

- **Website** — [contop.app](https://contop.app)
- **Documentation** — [docs.contop.app](https://docs.contop.app)
- **Releases** — [GitHub Releases](https://github.com/slopedrop/contop/releases)
- **Issues** — [GitHub Issues](https://github.com/slopedrop/contop/issues)

## License

[MIT](LICENSE)
