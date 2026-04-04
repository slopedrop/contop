---
sidebar_position: 4
---

# Testing

## Mobile Client Tests

### Organization

Test files are **co-located** with the source files they test:

```
components/
├── ExecutionThread.tsx
├── ExecutionThread.test.tsx    # ← co-located
app/
├── index.tsx
├── index.test.tsx              # ← co-located
├── settings.tsx
└── settings.test.tsx           # ← co-located
```

### Running Tests

```bash
cd contop-mobile
npx jest
```

### Mocking Strategy

- **WebRTC**: Mock `react-native-webrtc` in Jest setup — never expect WebRTC tunnels to open during tests
- **Expo APIs**: Mock `expo-local-authentication`, `expo-haptics`, `expo-camera`, and other native modules
- **Stores**: Test Zustand stores by calling actions and asserting state changes

## Server Tests

### Organization

All tests go in the dedicated `tests/` directory:

```
contop-server/
└── tests/
    ├── unit/
    │   ├── test_dual_tool_evaluator_atdd.py
    │   ├── test_execution_agent_atdd.py
    │   ├── test_pairing.py
    │   └── test_audit_logger.py
    └── api/
        ├── test_health.py
        ├── test_pair_endpoints_atdd.py
        ├── test_qr_image_endpoint_atdd.py
        └── test_settings_endpoint_atdd.py
```

### Running Tests

```bash
cd contop-server

# All tests
uv run pytest

# Specific test file
uv run pytest tests/unit/test_dual_tool_evaluator_atdd.py -v

# With markers
uv run pytest -m "unit" -v
```

### Primary Test Targets

Unit test coverage focuses on these critical modules:

| Module | What to Test |
|--------|-------------|
| `core/dual_tool_evaluator.py` | Classification cascade, forbidden/restricted/destructive detection |
| `core/pairing.py` | Token generation, validation, expiration, revocation |
| `core/audit_logger.py` | JSONL format, fire-and-forget, daily rotation |

### Mocking Strategy

- **OS tools**: Mock `tools/host_subprocess.py` and `tools/docker_sandbox.py` when testing the dual-tool execution gate
- **External APIs**: Mock LLM API calls and vision backends
- **File system**: Use temporary directories for settings and audit log tests

## Test Commands Summary

| Package | Command | Framework |
|---------|---------|-----------|
| Mobile | `cd contop-mobile && npx jest` | Jest |
| Server | `cd contop-server && uv run pytest` | pytest |
| Server (unit only) | `cd contop-server && uv run pytest -m "unit"` | pytest |
| Server (API only) | `cd contop-server && uv run pytest tests/api/` | pytest |

---

**Related:** [Contributing](/developer-guide/contributing) · [Build & Release](/developer-guide/build-and-release) · [Docker Sandbox](/security/docker-sandbox)
