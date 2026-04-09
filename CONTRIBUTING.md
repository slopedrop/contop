# Contributing to Contop

Thanks for your interest in contributing! Here's how to get started.

## Reporting Bugs

Open a [Bug Report](https://github.com/slopedrop/contop/issues/new?template=bug_report.yml) with:
- Steps to reproduce
- Expected vs actual behavior
- OS and version
- Logs or screenshots if available

## Suggesting Features

Open a [Feature Request](https://github.com/slopedrop/contop/issues/new?template=feature_request.yml) describing:
- The problem or motivation
- Your proposed solution

## Development Setup

### Prerequisites

- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Node.js 18+
- [Tauri v2](https://v2.tauri.app/start/prerequisites/) (for desktop app)
- At least one LLM API key (Gemini, OpenAI, Anthropic, or OpenRouter) - or a CLI subscription

### Running Locally

```bash
# Server
cd contop-server && uv sync && uv run uvicorn main:app --host 0.0.0.0 --port 8000

# Desktop
cd contop-desktop && npm install && npm run tauri dev

# Mobile
cd contop-mobile && npm install && npx expo run:android

# Website
cd website && npm install && npm run dev

# Docs
cd docs && npm install && npm start
```

## Pull Request Process

1. **Fork** the repo and create a branch from `main`
2. Make your changes
3. Ensure the project builds and linting passes:
   ```bash
   cd contop-server && uv run ruff check .
   cd contop-mobile && npx jest
   ```
4. Open a PR with a clear title and description
5. PRs are reviewed by maintainers before merge

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - new feature
- `fix:` - bug fix
- `docs:` - documentation only
- `refactor:` - code restructuring without behavior change
- `test:` - adding or updating tests
- `chore:` - maintenance, dependencies, CI

## Code Style

| Language | Tool |
|----------|------|
| Python | [Ruff](https://docs.astral.sh/ruff/) |
| TypeScript | ESLint + Prettier |
| Rust | rustfmt |

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
