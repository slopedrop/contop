---
sidebar_position: 1
---

# Contributing

## Development Setup

### Clone the Repository

```bash
git clone <repository-url>
cd contop
```

### Install Dependencies

Each package has its own dependency management:

```bash
# Server (Python)
cd contop-server
uv sync

# Mobile (React Native)
cd contop-mobile
npm install

# Desktop (Tauri)
cd contop-desktop
npm install
```

### Run in Development

```bash
# Server
cd contop-server && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Mobile
cd contop-mobile && npx expo run:android  # or npx expo run:ios

# Desktop
cd contop-desktop && npm run tauri dev
```

## Naming Conventions

### TypeScript (Mobile Client)

| Element | Convention | Example |
|---------|-----------|---------|
| Component files | `PascalCase.tsx` | `ExecutionThread.tsx` |
| Hooks & stores | `camelCase` with `use` prefix | `useWebRTC.ts`, `useAIStore.ts` |
| Types / Interfaces | `PascalCase`, **no `I` prefix** | `CommandEntry`, not `ICommandEntry` |
| Constants | `SCREAMING_SNAKE_CASE` | `PROCESSING_TIMEOUT_MS` |
| Zustand actions | `verb + Noun` camelCase | `setAIState()` |
| Data channel types | **`snake_case` strings** | `"tool_call"`, `"state_update"` |
| Layout type values | `kebab-case` strings | `"video-focus"`, `"split-view"` |

### Python (Contop Server)

| Element | Convention | Example |
|---------|-----------|---------|
| Files / Modules | `snake_case.py` | `dual_tool_evaluator.py` |
| Classes | `PascalCase` | `DualToolEvaluator` |
| Functions / Methods | `snake_case()` | `classify()` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_ITERATIONS` |
| Tool names | `snake_case` | `"execute_cli"` |
| FastAPI route paths | `kebab-case` segments | `/api/away-mode/status` |
| JSONL log keys | `snake_case` | `user_prompt`, `duration_ms` |

### Rust (Desktop App)

| Element | Convention | Example |
|---------|-----------|---------|
| Tauri commands | `snake_case` with `async_runtime` | `start_server`, `get_settings` |
| HTTP calls | `ureq` (bypasses Tauri network restrictions) | `ureq::get(url).call()` |
| Process management | Platform-specific group creation | `CREATE_NEW_PROCESS_GROUP` (Windows) |

## Code Quality Rules

- **TypeScript**: Strict mode mandatory. All components use NativeWind v4 utility classes.
- **Python**: Async `asyncio` logic mandatory throughout. Use `asyncio.to_thread()` for blocking calls. Never fail silently — all exceptions logged and returned as `ToolResult` with `status="error"`.
- **Rust**: All Tauri IPC commands use `tauri::async_runtime::spawn_blocking` for HTTP calls.
- **Documentation**: JSDoc/docstrings at core module boundaries (WebRTC, OmniParser, UI tools).
- **Data shapes**: WebRTC data channel messages must use the canonical envelope format (`type`, `id`, `payload`).

## PR Workflow

1. Create a feature branch from `main`
2. Implement changes following the conventions above
3. Run tests for affected packages
4. Create a PR with a clear description of changes
5. Address review feedback

---

**Related:** [Project Structure](/developer-guide/project-structure) · [Testing](/developer-guide/testing) · [Build & Release](/developer-guide/build-and-release)
