# Contop Test Suite

Tests for the Contop dual-node system (mobile client + MCP server).

## Test Strategy

| Layer | Tool | Location |
|---|---|---|
| Backend unit/integration/API | **pytest** + pytest-asyncio | `contop-server/tests/` |
| Mobile unit | **Jest** + @testing-library/react-native | `contop-mobile/` (co-located `*.test.ts`) |
| Contract (mobile <-> server) | **Pact** | `pact/` |
| Mobile E2E | Detox or Maestro (future) | TBD |

## Setup

### Backend (pytest)

```bash
cd contop-server
uv sync --group dev
```

### Contract tests (Pact)

```bash
# From project root
npm install
```

## Running Tests

### pytest (Backend)

```bash
cd contop-server

# All tests
uv run pytest

# By marker
uv run pytest -m unit
uv run pytest -m integration
uv run pytest -m api

# With coverage
uv run pytest --cov=. --cov-report=html

# Verbose
uv run pytest -v
```

### Jest (Mobile)

```bash
cd contop-mobile
npm test
```

### Pact (Contract Tests)

```bash
# Consumer tests (mobile expectations of the server API)
npm run test:contract:consumer

# Provider verification (server fulfills contracts)
npm run test:contract:provider
```

## Architecture

```
contop-server/tests/            # pytest backend tests
├── conftest.py                 # Shared fixtures (FastAPI TestClient)
├── test_main.py                # Original health check tests
├── unit/                       # Fast, isolated unit tests
├── integration/                # Tests requiring running services
└── api/                        # FastAPI endpoint tests
    └── test_health.py

tests/support/factories/        # Shared TypeScript test data factories
├── data-channel-message.ts     # WebRTC data channel message factories
└── pairing.ts                  # Pairing token factories

pact/http/                      # Contract testing
├── consumer/                   # Consumer contract tests (mobile -> server)
│   └── contop-mobile.spec.ts
├── provider/                   # Provider verification tests
└── helpers/
    ├── states.ts               # Shared provider state constants
    └── request-filter.ts       # Auth injection for verification
```

## Key Patterns

### pytest Fixtures (Backend)

Shared fixtures in `conftest.py`:

```python
def test_example(client):
    response = client.get("/health")
    assert response.status_code == 200
```

### Data Factories (TypeScript)

Faker-based factories with overrides for parallel-safe test data:

```typescript
import { createToolCallMessage } from '../tests/support/factories/data-channel-message';

const msg = createToolCallMessage({ tool: 'execute_cli' });
```

### Test Markers (pytest)

```python
@pytest.mark.unit
def test_fast_thing(): ...

@pytest.mark.integration
def test_needs_services(): ...

@pytest.mark.api
def test_endpoint(): ...
```

## Best Practices

- **Isolation**: Each test creates its own data; no shared mutable state
- **API-first setup**: Seed data via API/fixtures, not UI interactions
- **Voice message coverage**: Every `tool_result` must include a `voice_message` (architecture rule)
- **Dual-tool gate**: All command execution tests must go through `dual_tool_evaluator.classify()`
