---
sidebar_position: 4
---

# Skills Engine

Skills are modular capability extensions that add domain-specific knowledge and tools to the Contop agent.

## SKILL.md Specification

Every skill is defined by a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: web-research
description: Search the web and extract information from websites
version: 1.0.0
type: mixed
tools:
  - search_web
  - extract_page
---

# Web Research

Instructions for the agent on how to use this skill...
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique skill identifier (lowercase, hyphens) |
| `description` | `string` | Yes | Human-readable description |
| `version` | `string` | No | Semantic version |
| `type` | `string` | No | `prompt`, `workflow`, `python`, or `mixed` |
| `tools` | `array` | No | Tool names provided by this skill |

## Skill Types

| Type | Description | Contains |
|------|-------------|----------|
| **prompt** | Instructions only — extends agent knowledge | Just SKILL.md with text instructions |
| **workflow** | Deterministic YAML workflows | `scripts/*.yaml` — keyboard sequences, menu navigation, form filling |
| **python** | Custom FunctionTools | `scripts/*.py` — must export FunctionTool-compatible functions |
| **mixed** | All of the above | SKILL.md + YAML workflows + Python tools |

## Directory Structure

```
~/.contop/skills/
├── web-research/
│   ├── SKILL.md              # Skill definition and instructions
│   └── scripts/
│       ├── search.yaml       # Workflow script
│       └── extract.py        # Python tool
├── cli-command-patterns/
│   └── SKILL.md              # Prompt-only skill
└── ide-chat/
    ├── SKILL.md
    └── scripts/
        └── ide-shortcuts.yaml
```

## Built-in Skills

Contop ships with 5 built-in skills (installed to `~/.contop/skills/` on first run):

| Skill | Type | Description |
|-------|------|-------------|
| `advanced-workflows` | prompt | Multi-step workflow execution patterns |
| `cli-command-patterns` | prompt | Common CLI recipes across platforms |
| `ide-chat` | mixed | IDE interaction via keyboard shortcuts |
| `skill-authoring` | prompt | How to create and debug custom skills |
| `web-research` | mixed | Web search and page extraction |

## Progressive Disclosure

Skills use a two-phase loading strategy to keep the agent's context lean:

1. **Startup** — Only metadata (name, description, version, type) is loaded
2. **Activation** — When the agent needs the skill, it calls `load_skill` to inject the full SKILL.md instructions

This prevents unused skill instructions from consuming context window tokens.

## Conflict Detection

When enabling a skill, the system checks for:
- **Duplicate skill names** — Two skills with the same name
- **Tool name conflicts** — A skill registering a tool that conflicts with an existing tool

Conflicts return an HTTP 409 error and block the skill from being enabled until resolved.

## Custom Skill Authoring

1. Create the skill directory: `~/.contop/skills/my-skill/`
2. Write `SKILL.md` with proper frontmatter
3. Add scripts in `scripts/` subdirectory (optional)
4. Enable via Settings or `POST /api/skills/{name}/enable`
5. The agent can now `load_skill` and `execute_skill` your custom skill

---

**Related:** [REST API — Skills](/api-reference/rest-api) · [Tool Layers](/architecture/tool-layers) · [Skill Tools](/api-reference/tools/skill-tools)
