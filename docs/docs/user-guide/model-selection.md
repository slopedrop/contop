---
sidebar_position: 10
---

# Model Selection

Contop uses a multi-model architecture with three distinct model roles. You can configure each independently.

## Three Model Roles

| Role | Where It Runs | Default | Purpose |
|------|--------------|---------|---------|
| **Conversation Model** | Mobile (phone) | `gemini-2.5-flash` | Classifies user intent, generates conversational responses, polishes execution results |
| **Execution Model** | Server (desktop) | `gemini-2.5-flash` | Controls the autonomous ADK agent for multi-step task execution |
| **Computer Use Backend** | Server (desktop) | `omniparser` | Screen understanding and UI element detection |

## Available Providers

The execution model supports multiple LLM providers via LiteLLM routing:

| Provider | Example Models | API Key Required |
|----------|---------------|-----------------|
| **Google Gemini** | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-flash-lite` | `gemini_api_key` |
| **OpenAI** | `openai/gpt-5.4`, `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `openai/o3`, `openai/o4-mini` | `openai_api_key` |
| **Anthropic** | `anthropic/claude-opus-4-6`, `anthropic/claude-sonnet-4-6`, `anthropic/claude-haiku-4-5` | `anthropic_api_key` |
| **OpenRouter** | Grok, Devstral, Qwen, Nemotron, Phi-4, MiniMax, and any model on OpenRouter | `openrouter_api_key` |

:::tip
Non-Gemini models must use the provider prefix (e.g., `openai/gpt-5.4`, `anthropic/claude-sonnet-4-6`). Gemini models use bare names. Community models from providers like Groq, Mistral, and DeepSeek are accessed through OpenRouter.
:::

## Switching Models at Runtime

Change models from the mobile app's AI Settings without restarting:

1. Open the session menu → AI Settings
2. Select your preferred model for each role
3. Changes take effect on the next command

## Thinking Mode

Toggle extended thinking for supported models (Gemini 2.5/3.x, OpenAI o3/o4-mini, Claude Opus/Sonnet):

- **Enabled** — Model uses chain-of-thought reasoning (slower but more accurate for complex tasks)
- **Disabled** — Faster responses for simple tasks
- **Default** — Uses the model's built-in default

## Cost/Capability Tradeoffs

| Model Tier | Speed | Cost | Best For |
|-----------|-------|------|----------|
| Flash (e.g., Gemini Flash) | Fast | Low | Simple tasks, quick commands |
| Pro (e.g., Gemini Pro, GPT-5.4) | Medium | Medium | Complex multi-step tasks |
| Large (e.g., Claude Opus) | Slow | High | Nuanced reasoning, code generation |

## Subscription Mode

Instead of API keys, you can use your existing LLM subscription (Claude Pro/Max, Gemini Pro, ChatGPT Pro). In subscription mode, requests route through a local CLI proxy on the desktop that wraps the provider's official CLI tool.

- The mobile app shows a **SUB** badge on model chips when subscription mode is active for that provider
- A **NO KEY** badge appears when no API key is configured for a provider (the model can still be used via subscription)
- The mobile `use_subscription` flag is authoritative — the phone decides per-request whether to use subscription or API key mode
- **Vision limitation**: CLI tools accept text only — in subscription mode, the execution agent's LLM vision fallback (direct screenshot analysis) is unavailable. The agent relies on local vision backends instead.

See [Configuration — Subscription Mode](/getting-started/configuration#subscription-mode-optional) for setup instructions.

## Vision Backends

The computer use backend determines how the agent understands your screen:

| Backend | Speed | Accuracy | Notes |
|---------|-------|----------|-------|
| **OmniParser** | Medium | High | Default; local-first, privacy-preserving, GPU/CPU adaptive |
| **UI-TARS** | Fast | High | Single API call via OpenRouter |
| **Gemini Computer Use** | Medium | High | Gemini-native computer use with stateful history |
| **Accessibility Tree** | Fast | Variable | Deterministic, best for native apps |
| **Kimi / Qwen / Phi / Molmo / Holotron** | Fast | Variable | Alternative VLMs via OpenRouter |

---

**Related:** [Configuration](/getting-started/configuration) · [Agent Execution](/user-guide/agent-execution) · [ADK Agent](/architecture/adk-agent)
