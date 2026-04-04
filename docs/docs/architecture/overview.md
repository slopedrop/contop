---
sidebar_position: 1
---

# Architecture Overview

Contop uses a **tri-node architecture** where three components collaborate to deliver AI-powered remote desktop control.

## System Topology

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

## Node Responsibilities

### Node 1: Mobile Client

- Voice input via configurable STT (Google STT default, also supports OpenAI Whisper and OpenRouter)
- Configurable conversation model (Gemini default, also supports OpenAI, Anthropic, OpenRouter) for intent classification
- Execution thread UI rendering
- Remote screen display via WebRTC video track
- Manual control input (joystick, clicks, keyboard)
- Session persistence and history

### Node 2: Contop Server (Python / FastAPI)

- WebRTC signaling (SDP/ICE exchange)
- [ADK](/architecture/adk-agent) execution agent with 30+ tools (40+ with optional skills)
- [Dual-Tool Evaluator](/security/dual-tool-evaluator) security classification
- Vision pipeline (9 backends for screen understanding)
- JSONL audit logging
- Skills engine (prompt, workflow, python, mixed)

### Node 3: Desktop Host (Tauri / Rust)

- Server lifecycle management (start/stop/restart sidecar)
- Settings GUI and QR code display
- [Away Mode](/user-guide/away-mode) overlay with keyboard blocking
- API key storage in local `settings.json`
- CLI proxy lifecycle management (start/stop/health monitoring for subscription mode)
- Device monitoring and OS notifications

## Why Three Nodes?

| Concern | Handled By |
|---------|-----------|
| User interface | Mobile Client — always in your pocket |
| AI reasoning + tool execution | Contop Server — needs desktop OS access |
| Native OS integration | Desktop Host — Rust for low-level APIs |
| Security isolation | Split between Server (evaluator) and Host (sandboxing) |

The mobile client handles user interaction; the server handles AI reasoning and tool execution; the desktop host handles native OS integration that Python can't do (overlay windows, keyboard hooks, process tree management).

## Communication Protocols

| Path | Protocol | Purpose |
|------|----------|---------|
| Phone ↔ Server | WebRTC Data Channel (DTLS) | Commands, progress, results |
| Phone ← Server | WebRTC Video Track (SRTP) | Live screen feed |
| Phone → Server | WebSocket (initial only) | SDP/ICE signaling exchange |
| Server ↔ Desktop | HTTP localhost | Settings, health, proxy lifecycle |
| Server → Cloud | HTTPS | LLM API calls, tunnel management |
| Server → CLI Proxy | HTTP localhost | Subscription mode LLM routing |

:::note Subscription Mode Vision Limitation
CLI tools (`claude -p`, `gemini`, `codex`) accept only text — they cannot receive base64 images. In subscription mode, the execution agent's LLM vision fallback (direct screenshot analysis when no local vision backend processes a frame) is unavailable. The agent falls back to text-only tools like `get_ui_context`. The mobile app shows a **NO VISION** badge on the execution model card when subscription mode is active.
:::

---

**Related:** [Contop Server](/architecture/contop-server) · [WebRTC Transport](/architecture/webrtc-transport) · [Tool Layers](/architecture/tool-layers)
