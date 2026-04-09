---
sidebar_position: 2
---

# Contop Server

The Contop server is a Python FastAPI application that serves as the brain of the system - handling WebRTC signaling, AI agent execution, and all tool operations.

## Application Structure

The server entry point is `contop-server/main.py`, which creates a FastAPI app with the following structure:

```
contop-server/
├── main.py                    # FastAPI app, REST endpoints, lifespan
├── core/
│   ├── execution_agent.py     # ADK LlmAgent + runner
│   ├── agent_tools.py         # Core tool function definitions
│   ├── agent_config.py        # System prompt, model config
│   ├── dual_tool_evaluator.py # Security classification gate
│   ├── audit_logger.py        # JSONL audit trail
│   ├── settings.py            # ~/.contop/settings.json management
│   ├── pairing.py             # QR code + token management ([Pairing & Encryption](/security/pairing-and-encryption))
│   ├── webrtc_peer.py         # WebRTC peer connection
│   ├── webrtc_signaling.py    # WebSocket SDP/ICE exchange
│   ├── skill_loader.py        # SKILL.md discovery + parsing ([Skills Engine](/api-reference/skills))
│   ├── skill_executor.py      # Workflow + Python tool execution
│   ├── tunnel.py              # Cloudflare tunnel management
│   ├── document_tools.py      # read_pdf, read_image, read_excel, write_excel
│   ├── file_tools.py          # read_file, edit_file, find_files
│   ├── window_tools.py        # window_list, window_focus, resize_window, clipboard
│   ├── workflow_tools.py      # save_dialog, open_dialog, launch_app, etc.
│   ├── geo.py                 # GPS/location utilities
│   ├── memory_processors.py   # ToolCallFilter, TokenLimiter for non-Gemini models
│   └── tracing.py             # OpenTelemetry tracing integration
├── tools/
│   ├── gui_automation.py      # PyAutoGUI + coordinate scaling
│   ├── host_subprocess.py     # CLI execution, Git Bash
│   ├── docker_sandbox.py      # Docker container isolation
│   ├── omniparser_local.py    # Local OmniParser V2
│   ├── vision_client.py       # UI-TARS + OpenRouter VLMs (VisionClient)
│   ├── gemini_computer_use.py # Gemini CU adapter
│   ├── browser_automation.py  # PinchTab CDP integration
│   ├── ui_automation.py       # Accessibility tree interaction
│   ├── device_control.py      # Keep-awake, device operations
│   ├── manual_control.py      # Hybrid control mode
│   ├── screen_capture.py      # mss capture + cursor rendering
│   └── omniparser_client.py   # Remote OmniParser API client
├── platform_adapters/
│   ├── base.py                # Abstract base class
│   ├── windows.py             # pywinauto + ctypes
│   ├── macos.py               # pyobjc + JXA
│   └── linux.py               # wmctrl + xdotool + pyatspi
└── prompts/
    ├── execution-agent.md     # Execution agent system prompt
    ├── conversation-agent.md  # Mobile conversation agent prompt
    └── planning-agent.md      # Planning agent prompt
```

## REST Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Root endpoint |
| `GET` | `/health` | Server health check |
| `POST` | `/api/pair` | Generate pairing token + QR code |
| `GET` | `/api/qr-image` | Current QR code as PNG |
| `GET` | `/api/pair/status` | Token status without exposing value |
| `DELETE` | `/api/pair` | Revoke token + force-disconnect |
| `GET` | `/api/devices` | List paired devices with status |
| `GET` | `/api/connection-info` | LAN/Tailscale/Tunnel status |
| `POST` | `/api/tunnel/start` | Start Cloudflare tunnel on demand |
| `GET` | `/api/settings` | Current settings JSON |
| `PUT` | `/api/settings` | Update settings |
| `POST` | `/api/settings/reset` | Reset to defaults |
| `GET` | `/api/decrypted-keys` | API keys (plaintext from settings, legacy DPAPI fallback) |
| `GET` | `/api/default-prompts` | Built-in system prompt text |
| `GET` | `/api/skills` | List all skills |
| `POST` | `/api/skills` | Create a new skill |
| `GET/PUT` | `/api/skills/{name}` | Read or update SKILL.md |
| `POST` | `/api/skills/{name}/enable` | Enable a skill |
| `POST` | `/api/skills/{name}/disable` | Disable a skill |
| `GET` | `/api/skills/{name}/workflows` | List skill scripts |
| `GET` | `/api/away-mode/status` | Away Mode status |
| `WebSocket` | `/ws/signaling` | WebRTC SDP/ICE exchange |

## Sidecar Lifecycle

The Tauri desktop app spawns the server as a sidecar process:

```
Tauri → uv run uvicorn main:app → Python FastAPI server
```

Key lifecycle details:
- **Process group management**: `uv` spawns `uvicorn` as a grandchild process - the entire process tree must be killed
- **Windows**: `CREATE_NEW_PROCESS_GROUP` flag, killed via `taskkill /F /T /PID`
- **Unix**: `setpgid` for group management, SIGTERM → 2s grace → SIGKILL
- **Clean shutdown**: `RunEvent::Exit` handler in Tauri kills the process tree

## Server Startup Sequence

1. Ensure `~/.contop/settings.json` exists (create defaults if missing)
2. Restore persisted pairing tokens from `~/.contop/tokens.json`
3. Restore `keep_host_awake` setting
4. Install built-in skills to `~/.contop/skills/` if missing
5. Background: Preload OmniParser models
6. Background: Download and start PinchTab binary
7. Background: Start Away Mode protection monitoring

---

**Related:** [REST API](/api-reference/rest-api) · [ADK Agent](/architecture/adk-agent) · [Tool Layers](/architecture/tool-layers) · [Project Structure](/developer-guide/project-structure)
