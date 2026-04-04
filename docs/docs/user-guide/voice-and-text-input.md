---
sidebar_position: 3
---

# Voice & Text Input

Contop supports two input methods for sending commands to the AI agent.

## Text Input

Type commands directly in the execution bar at the bottom of the session screen. Press Send or hit Enter to submit.

The text input supports multi-line messages and preserves your input history within the session.

## Voice Input

Tap the microphone button to start recording. Contop supports multiple speech-to-text providers: **Gemini** (default), **OpenAI Whisper**, and **OpenRouter Whisper**. You can switch providers or disable voice entirely in AI Settings.

### How Voice Works

1. **Tap microphone** — Recording begins with an aurora voice effect animation
2. **Speak naturally** — Audio is captured at 16 kHz mono PCM and sent to your configured [STT provider](/architecture/adk-agent) for transcription
3. **Release or tap stop** — Recording ends and the transcribed text appears
4. **Review and send** — The transcribed text is shown in the input bar for review before sending

### Conversation History

The mobile app includes recent conversation context with each request, managed by token limits rather than a fixed turn count. When the conversation model on your phone detects that a command requires tool execution (not just a text response), it bundles the relevant conversation context and sends it to the server [execution agent](/architecture/adk-agent) as a `user_intent` message.

### Intent Routing

The mobile conversation model (default: Gemini 2.5 Flash) classifies your input locally:

- **Text response** — Handled entirely on the phone (no server round-trip)
- **Tool execution** — Routed to the server agent for autonomous execution

After the server completes execution, the result is polished through the mobile conversation model for a natural response.

---

**Related:** [Mobile App](/user-guide/mobile-app) · [Agent Execution](/user-guide/agent-execution) · [Model Selection](/user-guide/model-selection)
