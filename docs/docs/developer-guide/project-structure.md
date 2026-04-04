---
sidebar_position: 2
---

# Project Structure

Contop is a monorepo with three packages, each responsible for one node in the architecture.

```
contop/
├── contop-mobile/              # Node 1: React Native mobile client
│   ├── app/                    # Expo Router screens
│   │   ├── (connect)/          # Connection & pairing screens
│   │   ├── (session)/          # Active session screens
│   │   └── settings.tsx        # App-level settings
│   ├── components/             # Reusable UI components
│   │   ├── ExecutionThread.tsx
│   │   ├── InputBar.tsx
│   │   ├── RemoteScreen.tsx
│   │   ├── ManualControlOverlay.tsx
│   │   └── ...
│   ├── hooks/                  # Custom hooks
│   │   ├── useWebRTC.ts        # WebRTC connection management
│   │   └── ...
│   ├── services/               # Business logic
│   │   ├── providers/          # LLM provider adapters
│   │   │   ├── geminiProvider.ts
│   │   │   ├── openaiProvider.ts
│   │   │   └── anthropicProvider.ts
│   │   ├── sessionStorage.ts
│   │   └── tempPayloadBridge.ts
│   ├── stores/                 # Zustand state management
│   │   └── useAIStore.ts       # Single source of truth
│   ├── package.json
│   └── tsconfig.json
│
├── contop-server/              # Node 2: Python FastAPI server
│   ├── main.py                 # App entry point, REST endpoints
│   ├── core/                   # Core modules
│   │   ├── execution_agent.py  # ADK LlmAgent + runner
│   │   ├── agent_tools.py      # 40+ FunctionTool definitions
│   │   ├── agent_config.py     # System prompt + model config
│   │   ├── dual_tool_evaluator.py # Security classification
│   │   ├── audit_logger.py     # JSONL audit trail
│   │   ├── settings.py         # Settings persistence
│   │   ├── pairing.py          # QR code + token management
│   │   ├── webrtc_peer.py      # WebRTC peer connection
│   │   ├── webrtc_signaling.py # WebSocket signaling
│   │   ├── skill_loader.py     # Skill discovery + parsing
│   │   ├── skill_executor.py   # Workflow execution
│   │   ├── file_tools.py       # read/edit/find files
│   │   ├── window_tools.py     # Window + clipboard management
│   │   ├── document_tools.py   # PDF/image/Excel handling
│   │   ├── workflow_tools.py   # Dialog/app management
│   │   ├── geo.py              # IP geolocation, connection classification
│   │   ├── memory_processors.py # Memory management
│   │   ├── tracing.py          # Tracing/observability
│   │   └── tunnel.py           # Cloudflare tunnel management
│   ├── tools/                  # Execution tool modules
│   │   ├── gui_automation.py   # PyAutoGUI + coord scaling
│   │   ├── host_subprocess.py  # CLI execution, Git Bash
│   │   ├── docker_sandbox.py   # Docker container isolation
│   │   ├── omniparser_local.py # OmniParser V2 (local)
│   │   ├── vision_client.py    # UI-TARS + OpenRouter VLMs (VisionClient)
│   │   ├── gemini_computer_use.py # Gemini CU adapter
│   │   ├── browser_automation.py  # PinchTab CDP
│   │   ├── ui_automation.py    # Accessibility tree
│   │   ├── device_control.py   # Keep-awake, device ops
│   │   ├── manual_control.py   # Hybrid control mode
│   │   └── screen_capture.py   # mss + cursor rendering
│   ├── platform_adapters/      # OS-specific automation
│   │   ├── base.py             # Abstract base class
│   │   ├── windows.py          # pywinauto + ctypes
│   │   ├── macos.py            # pyobjc + JXA
│   │   └── linux.py            # wmctrl + xdotool + pyatspi
│   ├── prompts/                # Agent system prompts
│   │   ├── execution-agent.md
│   │   ├── conversation-agent.md
│   │   └── planning-agent.md
│   ├── skills/
│   │   └── builtin/            # 5 built-in skills
│   ├── tests/                  # Test suite
│   │   ├── unit/
│   │   └── api/
│   └── pyproject.toml
│
├── contop-cli-proxy/           # CLI Proxy: subscription mode LLM routing
│   ├── src/
│   │   ├── index.ts            # Entry point, proxy startup
│   │   ├── server.ts           # Express HTTP server (OpenAI-compatible)
│   │   ├── openai-adapter.ts   # OpenAI → XML prompt conversion
│   │   ├── session-manager.ts  # CLI subprocess lifecycle
│   │   ├── llm-logger.ts       # Per-session LLM call logging
│   │   ├── request-pacer.ts    # Request queue and pacing
│   │   ├── types.ts            # Shared type definitions
│   │   └── providers/          # Provider-specific adapters
│   │       ├── base.ts         # Base provider interface
│   │       ├── claude.ts       # @anthropic-ai/claude-code
│   │       ├── gemini.ts       # @google/gemini-cli
│   │       ├── codex.ts        # @openai/codex
│   │       └── index.ts        # Provider registry
│   ├── package.json
│   └── tsconfig.json
│
├── contop-desktop/             # Node 3: Tauri v2 desktop app
│   ├── index.html              # Main app HTML
│   ├── away-overlay.html       # Away Mode overlay page
│   ├── src/                    # Frontend (TypeScript)
│   │   ├── main.ts
│   │   └── styles.css
│   ├── src-tauri/              # Rust backend
│   │   ├── src/
│   │   │   ├── lib.rs          # Tauri IPC commands
│   │   │   ├── away_mode.rs    # Away Mode (cross-platform)
│   │   │   └── main.rs
│   │   ├── tauri.conf.json     # Tauri configuration
│   │   └── Cargo.toml
│   └── package.json
│
├── docs/                       # Docusaurus documentation site
├── website/                    # Next.js website
├── sync-public.sh              # Public repo sync script
├── README.md
└── .gitignore
```

## Key Entry Points

| Package | Entry Point | What It Does |
|---------|------------|--------------|
| `contop-server` | `main.py` | Starts FastAPI with all REST/WebSocket endpoints |
| `contop-mobile` | `app/` (Expo Router) | File-based routing for mobile screens |
| `contop-desktop` | `src-tauri/src/lib.rs` | Tauri IPC commands + server sidecar management |

## Shared Configuration

| File | Purpose |
|------|---------|
| `README.md` | Project overview, architecture diagram, quick start |
| `.gitignore` | Shared ignore rules for all packages |

---

**Related:** [Architecture Overview](/architecture/overview) · [Contop Server](/architecture/contop-server) · [Contributing](/developer-guide/contributing)
