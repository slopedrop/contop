---
name: skill-authoring
description: Instructions for creating and editing Contop skills. Load when user asks to make a skill, create a workflow, or teach you a new capability.
version: "1.0.0"
---

# Skill Authoring Guide

You can create new skills when the user asks you to. Use `create_skill` to write a new skill and `edit_skill` to modify an existing one.

## When to Create a Skill
- User says "make a skill for...", "create a workflow for...", "teach yourself to..."
- User describes a repetitive task they want automated
- User wants to bundle a set of instructions for future use

## How to Create a Good Skill
1. Ask the user what the skill should do (if not clear from context)
2. Write clear, specific instructions in the SKILL.md body
3. For workflow skills: describe the keyboard shortcuts and steps in YAML files under `scripts/`
4. Call `create_skill(name="...", description="...", instructions="...", skill_type="...")`
5. Tell the user the skill was created but needs to be enabled

## Skill Types
- **prompt** — Instructions only (SKILL.md markdown). The agent reads the instructions and follows them using existing tools.
- **workflow** — YAML step definitions in `scripts/`. Executed via `execute_skill(skill_name, workflow_name)`. Steps: hotkey, type_text, click, scroll, press_key, wait.
- **python** — Custom Python tools in `scripts/`. Async functions with `dict` return type are auto-registered as agent tools.
- **mixed** — Both workflow YAML and Python tools.

## Workflow YAML Format
```yaml
name: workflow-name
description: What this workflow does
steps:
  - action: hotkey
    keys: [ctrl, shift, p]
  - action: wait
    seconds: 0.5
  - action: type_text
    text: "Some text with {param_name} substitution"
  - action: press_key
    key: enter
  - action: scroll
    direction: down
    amount: 5
  - action: click
    x: 100
    y: 200
```

## Python Tool Format
```python
async def my_tool(param1: str, param2: int = 10) -> dict:
    """Tool description shown to the agent."""
    # Your code here — full server privileges
    return {"status": "success", "result": "..."}
```

## Rules
- NEVER enable a skill you just created — tell the user to enable it
- NEVER overwrite an existing skill — use `edit_skill` to modify
- Keep skill names lowercase with hyphens (e.g., "my-email-workflow")
- Keep descriptions under 200 chars — they appear in the prompt metadata
