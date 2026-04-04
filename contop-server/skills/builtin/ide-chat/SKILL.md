---
name: ide-chat
description: Control AI coding IDE chats (VS Code Claude Code, Cursor) from your phone. Open, send, scroll, switch tabs, manage history, accept/reject suggestions.
version: "2.0.0"
---

# IDE Chat Control

Use `execute_skill` to control AI coding IDE chat panels via keyboard shortcuts.

## Available Workflows

### VS Code — Claude Code
- `vscode-claude-open` — Open Claude Code chat panel
- `vscode-claude-send` — Send a message in Claude Code (params: message)
- `vscode-claude-new` — Start a new Claude Code conversation
- `vscode-claude-history` — Open Claude Code chat history picker
- `vscode-claude-accept` — Accept Claude Code's pending suggestion/diff
- `vscode-claude-reject` — Reject Claude Code's pending suggestion/diff

### VS Code — Copilot Chat
- `vscode-copilot-open` — Open Copilot Chat panel
- `vscode-copilot-send` — Send a message in Copilot Chat (params: message)

### Cursor
- `cursor-open` — Open Cursor chat panel
- `cursor-send` — Send a message in Cursor chat (params: message)
- `cursor-composer-open` — Open Cursor Composer
- `cursor-composer-send` — Send a message in Cursor Composer (params: message)
- `cursor-accept` — Accept Cursor's suggestion
- `cursor-reject` — Reject Cursor's suggestion

### General IDE
- `ide-scroll-up` — Scroll the active editor/chat up
- `ide-scroll-down` — Scroll the active editor/chat down
- `ide-next-tab` — Switch to the next editor tab
- `ide-prev-tab` — Switch to the previous editor tab
- `ide-close-tab` — Close the current editor tab
- `ide-toggle-sidebar` — Toggle the sidebar panel
- `ide-toggle-terminal` — Toggle the integrated terminal
- `ide-save-file` — Save the current file

## When to Use
When the user asks to: chat with Claude Code, send a message to Cursor/Copilot, open the AI chat, scroll through a conversation, switch between tabs, close a tab, accept or reject a code suggestion, open chat history, start a new conversation, or interact with their coding IDE's AI assistant.

## Usage Examples
- "Open Claude Code chat" → `execute_skill(skill_name="ide-chat", workflow_name="vscode-claude-open")`
- "Tell Claude to fix the tests" → `execute_skill(skill_name="ide-chat", workflow_name="vscode-claude-send", params='{"message": "fix the tests"}')`
- "Start a new Claude conversation" → `execute_skill(skill_name="ide-chat", workflow_name="vscode-claude-new")`
- "Show me the Claude history" → `execute_skill(skill_name="ide-chat", workflow_name="vscode-claude-history")`
- "Accept the suggestion" → `execute_skill(skill_name="ide-chat", workflow_name="vscode-claude-accept")`
- "Scroll up in the chat" → `execute_skill(skill_name="ide-chat", workflow_name="ide-scroll-up")`
- "Go to the next tab" → `execute_skill(skill_name="ide-chat", workflow_name="ide-next-tab")`
- "Close this tab" → `execute_skill(skill_name="ide-chat", workflow_name="ide-close-tab")`
