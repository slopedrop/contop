"""
Skill executor — execute workflow YAML definitions and load Python tool functions.

Workflow steps map to existing execute_gui() actions. Python tool loading uses
importlib for dynamic module import — no exec() or eval().
"""
import importlib.util
import json
import logging
import re
import time as _time
from pathlib import Path
from typing import Any, Callable

import yaml

from core.settings import get_skills_dir

logger = logging.getLogger(__name__)

_VALID_SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,63}$")


async def execute_skill(skill_name: str, workflow_name: str, params: str = "{}") -> dict:
    """Execute a skill workflow definition (YAML steps).

    Args:
        skill_name: Name of the skill (directory name under ~/.contop/skills/).
        workflow_name: Name of the workflow file (without extension).
        params: JSON string of parameters to pass to the workflow.

    Returns:
        Standard tool result dict with status, steps_executed, duration_ms.
    """
    start = _time.monotonic()
    logger.info("execute_skill: skill=%s, workflow=%s", skill_name, workflow_name)

    # Validate skill_name — prevent path traversal (F2)
    if not _VALID_SKILL_NAME_RE.match(skill_name):
        return {
            "status": "error",
            "description": f"Invalid skill name '{skill_name}'.",
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }

    # F5: Verify skill is still enabled (could be disabled mid-session)
    from core.settings import get_enabled_skills
    if skill_name not in get_enabled_skills():
        return {
            "status": "error",
            "description": f"Skill '{skill_name}' is not enabled.",
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }

    skills_dir = get_skills_dir()
    workflow_path = skills_dir / skill_name / "scripts" / f"{workflow_name}.yaml"

    if not workflow_path.exists():
        # Try .yml extension
        workflow_path = skills_dir / skill_name / "scripts" / f"{workflow_name}.yml"
        if not workflow_path.exists():
            return {
                "status": "error",
                "description": f"Workflow '{workflow_name}' not found in skill '{skill_name}'",
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

    try:
        raw = workflow_path.read_text(encoding="utf-8")
        workflow_def = yaml.safe_load(raw)
    except (OSError, yaml.YAMLError) as e:
        return {
            "status": "error",
            "description": f"Failed to parse workflow YAML: {e}",
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }

    if not isinstance(workflow_def, dict) or "steps" not in workflow_def:
        return {
            "status": "error",
            "description": "Workflow YAML must contain a 'steps' list",
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }

    # Parse params
    try:
        param_dict = json.loads(params) if isinstance(params, str) else params
    except json.JSONDecodeError:
        param_dict = {}

    steps = workflow_def["steps"]
    if not isinstance(steps, list):
        return {
            "status": "error",
            "description": "Workflow 'steps' must be a list",
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }

    # Import tool functions at call time (same pattern as workflow_tools.py)
    from core.agent_tools import execute_gui, wait

    steps_executed = 0
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            return {
                "status": "error",
                "description": f"Step {i} is not a valid step object (got {type(step).__name__})",
                "steps_executed": steps_executed,
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }
        action = step.get("action", "")

        try:
            if action == "hotkey":
                keys = step.get("keys", [])
                await execute_gui(action="hotkey", target="skill workflow", coordinates={"keys": keys})
            elif action == "type_text":
                text = step.get("text", "")
                # Substitute params in a single pass to prevent chained injection (F11)
                if param_dict:
                    text = re.sub(
                        r"\{(\w+)\}",
                        lambda m: str(param_dict[m.group(1)]) if m.group(1) in param_dict else m.group(0),
                        text,
                    )
                await execute_gui(action="type", target="skill workflow", coordinates={"text": text})
            elif action == "click":
                coords: dict[str, Any] = {}
                if "x" in step and "y" in step:
                    coords = {"x": step["x"], "y": step["y"]}
                await execute_gui(action="click", target="skill workflow", coordinates=coords)
            elif action == "press_key":
                key = step.get("key", "")
                await execute_gui(action="press_key", target="skill workflow", coordinates={"key": key})
            elif action == "scroll":
                direction = step.get("direction", "down")
                amount = step.get("amount", 3)
                await execute_gui(action="scroll", target="skill workflow", coordinates={"direction": direction, "amount": amount})
            elif action == "wait":
                seconds = step.get("seconds", 0.5)
                await wait(seconds)
            else:
                return {
                    "status": "error",
                    "description": f"Unknown action '{action}' in step {i}",
                    "steps_executed": steps_executed,
                    "duration_ms": int((_time.monotonic() - start) * 1000),
                }
        except Exception as e:
            logger.exception("Workflow step %d failed: %s", steps_executed, e)
            return {
                "status": "error",
                "description": f"Step {steps_executed} ({action}) failed: {e}",
                "steps_executed": steps_executed,
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

        steps_executed += 1

    # F4: Fail if no valid steps were executed
    if steps_executed == 0:
        return {
            "status": "error",
            "description": f"Workflow '{workflow_name}' had no executable steps",
            "steps_executed": 0,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }

    return {
        "status": "success",
        "steps_executed": steps_executed,
        "duration_ms": int((_time.monotonic() - start) * 1000),
    }


def load_python_tools(skill_path: Path) -> list[Callable]:
    """Load Python tool functions from a skill's scripts/ directory.

    For Model C skills: dynamically imports .py files and collects top-level
    async functions that have a ``dict`` return annotation.

    **Security note:** Loaded modules execute with full server privileges.
    Only install skills from sources you trust. Module-scope code runs at
    import time before any function filtering occurs.

    Args:
        skill_path: Path to the skill directory.

    Returns:
        List of async callables ready to be wrapped as ADK FunctionTools.
    """
    import asyncio
    import inspect

    scripts_dir = skill_path / "scripts"
    if not scripts_dir.is_dir():
        return []

    logger.warning(
        "Loading Python skill tools from %s — code runs with full server privileges.",
        scripts_dir,
    )

    tools: list[Callable] = []
    for py_file in sorted(scripts_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        try:
            spec = importlib.util.spec_from_file_location(
                f"contop_skill_{skill_path.name}_{py_file.stem}", py_file
            )
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            # Collect async functions with dict return annotation (F9: filter properly)
            for attr_name in dir(module):
                if attr_name.startswith("_"):
                    continue
                attr = getattr(module, attr_name)
                if not asyncio.iscoroutinefunction(attr):
                    continue
                # Only collect functions defined in this module (skip re-exports)
                if getattr(attr, "__module__", None) != module.__name__:
                    continue
                # Prefer functions with dict return annotation, but accept unannotated
                hints = inspect.get_annotations(attr, eval_str=False)
                ret = hints.get("return")
                if ret is not None and ret is not dict:
                    logger.debug("Skipping %s: return type is %s, not dict", attr_name, ret)
                    continue
                tools.append(attr)
        except Exception as e:
            logger.warning("Failed to load Python tools from %s: %s", py_file, e)

    return tools


async def load_skill(skill_name: str) -> dict:
    """Load full SKILL.md instructions for a skill (progressive disclosure).

    Args:
        skill_name: Name of the skill to load.

    Returns:
        Dict with status, instructions (full markdown body), and available_workflows list.
    """
    from core.skill_loader import parse_skill_md, load_skill_instructions

    # Validate skill_name — prevent path traversal (F2)
    if not _VALID_SKILL_NAME_RE.match(skill_name):
        return {
            "status": "error",
            "description": f"Invalid skill name '{skill_name}'.",
        }

    skills_dir = get_skills_dir()
    skill_dir = skills_dir / skill_name

    if not skill_dir.is_dir():
        return {
            "status": "error",
            "description": f"Skill '{skill_name}' not found",
        }

    meta = parse_skill_md(skill_dir)
    if meta is None:
        return {
            "status": "error",
            "description": f"Skill '{skill_name}' has invalid SKILL.md",
        }

    instructions = load_skill_instructions(meta)

    # List available workflows
    available_workflows: list[str] = []
    scripts_dir = skill_dir / "scripts"
    if scripts_dir.is_dir():
        for f in sorted(scripts_dir.iterdir()):
            if f.suffix in (".yaml", ".yml"):
                available_workflows.append(f.stem)

    return {
        "status": "success",
        "instructions": instructions,
        "available_workflows": available_workflows,
    }


# --- Phase 2: Agent Skill Authoring Tools ---


async def create_skill(name: str, description: str, instructions: str, skill_type: str = "prompt") -> dict:
    """Create a new skill directory with SKILL.md.

    This is the `create_skill` ADK FunctionTool function.
    Created skills are DISABLED by default — user must enable manually.

    Args:
        name: Skill name (lowercase, hyphens only, max 64 chars).
        description: Short description for prompt metadata.
        instructions: Full markdown instructions for the SKILL.md body.
        skill_type: One of "prompt", "workflow", "python".

    Returns:
        Standard tool result dict.
    """
    logger.info("create_skill: name=%s, type=%s", name, skill_type)

    # Validate name — no path traversal
    if not _VALID_SKILL_NAME_RE.match(name):
        return {
            "status": "error",
            "description": f"Invalid skill name '{name}'. Must be lowercase letters, numbers, and hyphens only (max 64 chars).",
        }
    if ".." in name or "/" in name or "\\" in name:
        return {
            "status": "error",
            "description": f"Invalid skill name '{name}': path traversal detected.",
        }

    skills_dir = get_skills_dir()
    skill_dir = skills_dir / name

    if skill_dir.exists():
        return {
            "status": "error",
            "description": f"Skill '{name}' already exists. Use edit_skill to modify it.",
        }

    # Create directory and SKILL.md (use yaml.dump to prevent YAML injection — F5)
    skill_dir.mkdir(parents=True)
    frontmatter = {"name": name, "description": description, "version": "1.0.0"}
    fm_str = yaml.dump(frontmatter, default_flow_style=False).strip()
    skill_md = f"---\n{fm_str}\n---\n\n{instructions}\n"
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")

    # Create scripts/ directory for workflow/python skills
    if skill_type in ("workflow", "python"):
        (skill_dir / "scripts").mkdir()

    return {
        "status": "success",
        "skill_name": name,
        "path": str(skill_dir),
        "enabled": False,
        "note": "Skill created but NOT enabled. The user must enable it manually via the desktop UI or by saying 'enable the skill'.",
    }


async def edit_skill(name: str, instructions: str = "", description: str = "") -> dict:
    """Edit an existing skill's SKILL.md.

    This is the `edit_skill` ADK FunctionTool function.

    Args:
        name: Name of the skill to edit.
        instructions: New markdown body (replaces existing if provided).
        description: New description (updates frontmatter if provided).

    Returns:
        Standard tool result dict.
    """
    logger.info("edit_skill: name=%s", name)

    # Validate name — same check as create_skill (F3: prevent path traversal)
    if not _VALID_SKILL_NAME_RE.match(name):
        return {
            "status": "error",
            "description": f"Invalid skill name '{name}'. Must be lowercase letters, numbers, and hyphens only (max 64 chars).",
        }

    # F8: Early return if no changes requested
    if not instructions and not description:
        return {
            "status": "error",
            "description": "Nothing to update — provide 'instructions' and/or 'description'.",
        }

    skills_dir = get_skills_dir()
    skill_file = skills_dir / name / "SKILL.md"

    if not skill_file.exists():
        return {
            "status": "error",
            "description": f"Skill '{name}' not found.",
        }

    try:
        raw = skill_file.read_text(encoding="utf-8")
    except OSError as e:
        return {"status": "error", "description": str(e)}

    # Parse existing frontmatter
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {
            "status": "error",
            "description": f"SKILL.md for '{name}' has malformed frontmatter.",
        }

    try:
        frontmatter = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return {
            "status": "error",
            "description": f"SKILL.md for '{name}' has invalid YAML frontmatter.",
        }

    if not isinstance(frontmatter, dict):
        frontmatter = {}

    updated_fields: list[str] = []

    if description:
        frontmatter["description"] = description
        updated_fields.append("description")

    body = parts[2].strip()
    if instructions:
        body = instructions
        updated_fields.append("instructions")

    # Rebuild SKILL.md
    fm_str = yaml.dump(frontmatter, default_flow_style=False).strip()
    new_content = f"---\n{fm_str}\n---\n\n{body}\n"
    skill_file.write_text(new_content, encoding="utf-8")

    return {
        "status": "success",
        "skill_name": name,
        "updated_fields": updated_fields,
    }
