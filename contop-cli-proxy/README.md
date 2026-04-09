# contop-cli-proxy

OpenAI-compatible HTTP proxy for Claude, Gemini, and Codex CLI subscriptions. Used internally by Contop to route LLM requests through subscription-based auth instead of API keys.

For a standalone version you can use in any project, see [llm-cli-proxy](https://github.com/Slopedrop/llm-cli-proxy).

## Prerequisites

Node.js 20+ and at least one CLI installed and authenticated:

| Provider | Subscription | Install | Authenticate |
|----------|-------------|---------|-------------|
| Claude | Claude Pro or Max | `npm install -g @anthropic-ai/claude-code` | Run `claude` and sign in |
| Gemini | Gemini Advanced (Google One AI Premium) | `npm install -g @google/gemini-cli` | Run `gemini` and sign in |
| Codex | ChatGPT Plus, Pro, or Team | `npm install -g @openai/codex` | Run `codex` and sign in |

## Setup

```bash
npm install
npm run build
```

## Usage

Start one instance per provider:

```bash
node dist/index.js --provider claude   # port 3456
node dist/index.js --provider gemini   # port 3457
node dist/index.js --provider codex    # port 3458
```

In dev mode:

```bash
npx tsx src/index.ts --provider claude --port 3456 --workspace /path/to/project
```

### Options

```
--provider, -p  <name>   claude | gemini | codex  (required)
--port          <port>   HTTP port (default: 3456/claude, 3457/gemini, 3458/codex)
--workspace, -w <dir>    Working directory for CLI context (default: cwd)
--model, -m     <model>  Model override
```

## Endpoints

- `POST /v1/chat/completions` - OpenAI-compatible, streaming and non-streaming
- `GET  /v1/models` - provider model list
- `GET  /health` - session status

## Integration with Contop Server

When subscription mode is enabled in Contop settings, the server injects:

```bash
ANTHROPIC_BASE_URL=http://localhost:3456/v1
GOOGLE_GEMINI_BASE_URL=http://localhost:3457/v1
OPENAI_BASE_URL=http://localhost:3458/v1
```

See `tech-spec-subscription-auth.md` for the full integration spec.

## How It Works

- **Claude / Gemini** - spawns the official CLI per request using `--resume` for conversation continuity
- **Codex** - calls the Codex API endpoint directly via the OAuth token in `~/.codex/auth.json`
