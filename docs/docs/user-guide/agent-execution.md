---
sidebar_position: 4
---

# Agent Execution

When your command requires tool execution, the server-side [ADK](/architecture/adk-agent) agent takes over to autonomously complete the task.

## How Execution Works

1. **Intent received** - Server receives `user_intent` with your command and optional screen context
2. **Planning** - Agent analyzes the request and plans execution steps
3. **Tool execution** - Agent iterates through tools: observe screen, run commands, click UI elements
4. **Progress streaming** - Each tool call streams `agent_progress` updates to your phone in real time
5. **Result delivery** - Final `agent_result` sent with the answer, step count, and duration

## Execution Thread Entries

Your phone displays each step of the execution:

| Entry Type | Description |
|-----------|-------------|
| `user_message` | Your original command |
| `agent_progress` | Step-by-step tool calls with status indicators |
| `tool_call` | Detailed tool invocation (name, parameters, model, backend) |
| `tool_result` | Tool output (stdout, stderr, exit code, duration) |
| `agent_confirmation_request` | Destructive action approval request |
| `agent_thinking` | Planning indicator with shimmer animation |
| `agent_result` | Final response from the agent |
| `agent_status` | Status updates (vision fallback, [Docker sandbox](/security/docker-sandbox) fallback, model error) |

## Safety Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| Max iterations | 50 | Prevents infinite tool-calling loops |
| Wall-clock timeout | 10 minutes | Hard cap on total execution time |
| Per-LLM-call timeout | 120 seconds | Prevents hanging on slow API responses |

## Stopping Execution

Tap the **Stop** button during active execution to cancel immediately. The server kills any running processes and sends a completion message.

## Confirmation Requests

When the agent encounters a destructive command (matching your configured `destructive_patterns`), it pauses and sends a confirmation request to your phone:

- The command and reason are displayed
- Tap **Approve** to continue or **Deny** to skip that step
- If no response within a timeout, the command is automatically rejected

Confirmation requests include a `voice_message` for audio feedback if voice input is active.

---

**Related:** [Tool Layers](/architecture/tool-layers) · [Dual-Tool Evaluator](/security/dual-tool-evaluator) · [REST API](/api-reference/rest-api)
