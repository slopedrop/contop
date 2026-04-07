"""
Skill loader — discovers, parses, and validates SKILL.md files.

Skills follow the Agent Skills standard (agentskills.io): SKILL.md with YAML
frontmatter + markdown instructions. Skills are stored in ~/.contop/skills/.
"""
import logging
from dataclasses import dataclass
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


@dataclass
class SkillMetadata:
    """Parsed metadata from a SKILL.md file."""

    name: str
    description: str
    version: str
    skill_type: str  # "prompt" | "workflow" | "python" | "mixed"
    enabled: bool
    path: Path
    has_scripts: bool
    has_workflows: bool = False
    has_python_tools: bool = False


def parse_skill_md(skill_dir: Path) -> SkillMetadata | None:
    """Read SKILL.md from a skill directory and extract metadata.

    Returns None if the file is missing, malformed, or lacks required fields.
    """
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        return None

    try:
        raw = skill_file.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("Could not read %s: %s", skill_file, e)
        return None

    # Extract YAML frontmatter (between --- delimiters)
    if not raw.startswith("---"):
        logger.warning("SKILL.md in %s has no YAML frontmatter", skill_dir.name)
        return None

    parts = raw.split("---", 2)
    if len(parts) < 3:
        logger.warning("SKILL.md in %s has malformed frontmatter", skill_dir.name)
        return None

    try:
        frontmatter = yaml.safe_load(parts[1])
    except yaml.YAMLError as e:
        logger.warning("SKILL.md in %s has invalid YAML: %s", skill_dir.name, e)
        return None

    if not isinstance(frontmatter, dict):
        logger.warning("SKILL.md in %s frontmatter is not a mapping", skill_dir.name)
        return None

    name = frontmatter.get("name")
    description = frontmatter.get("description")
    if not name or not description:
        logger.warning("SKILL.md in %s missing required 'name' or 'description'", skill_dir.name)
        return None

    version = str(frontmatter.get("version", "1.0.0"))

    # Detect skill type based on scripts/ directory contents
    scripts_dir = skill_dir / "scripts"
    has_scripts = scripts_dir.is_dir()
    has_workflows = False
    has_python_tools = False
    skill_type = "prompt"
    if has_scripts:
        yaml_files = list(scripts_dir.glob("*.yaml")) + list(scripts_dir.glob("*.yml"))
        py_files = [f for f in scripts_dir.glob("*.py") if not f.name.startswith("_")]
        has_workflows = bool(yaml_files)
        has_python_tools = bool(py_files)
        if has_workflows and has_python_tools:
            skill_type = "mixed"
        elif has_workflows:
            skill_type = "workflow"
        elif has_python_tools:
            skill_type = "python"

    return SkillMetadata(
        name=str(name),
        description=str(description),
        version=version,
        skill_type=skill_type,
        enabled=False,  # Caller sets this based on enabled_list
        path=skill_dir,
        has_scripts=has_scripts,
        has_workflows=has_workflows,
        has_python_tools=has_python_tools,
    )


def discover_skills(skills_dir: Path, enabled_list: list[str]) -> list[SkillMetadata]:
    """Scan skills_dir for subdirectories containing SKILL.md.

    Returns a sorted list of SkillMetadata with enabled flags set.
    """
    if not skills_dir.is_dir():
        return []

    skills: list[SkillMetadata] = []
    seen_names: dict[str, Path] = {}
    for entry in sorted(skills_dir.iterdir()):
        if not entry.is_dir():
            continue
        meta = parse_skill_md(entry)
        if meta is None:
            continue
        if meta.name in seen_names:
            logger.warning(
                "Duplicate skill name '%s' in %s (already loaded from %s) — skipping",
                meta.name, entry, seen_names[meta.name],
            )
            continue
        seen_names[meta.name] = entry
        meta.enabled = meta.name in enabled_list
        skills.append(meta)

    return skills


# Core tool names that are always registered — skill tools must not shadow these.
CORE_TOOL_NAMES: set[str] = {
    "execute_cli", "execute_gui", "execute_browser", "execute_accessible",
    "execute_computer_use", "observe_screen", "get_ui_context",
    "maximize_active_window", "wait", "get_action_history",
    "read_file", "edit_file", "find_files",
    "window_list", "window_focus", "resize_window",
    "clipboard_read", "clipboard_write",
    "read_pdf", "read_image", "read_excel", "write_excel",
    "process_info", "system_info", "download_file",
    "save_dialog", "open_dialog", "launch_app", "open_file", "close_app",
    "create_skill", "edit_skill", "execute_skill", "load_skill",
}


def check_skill_conflicts(
    skill_name: str,
    skills_dir: Path,
    enabled_list: list[str],
) -> list[str]:
    """Check if enabling a skill would cause tool name conflicts.

    Returns a list of human-readable warning strings (empty = no conflicts).
    """
    import asyncio
    import inspect

    skill_dir = skills_dir / skill_name
    scripts_dir = skill_dir / "scripts"

    # Collect tool names this skill would register
    skill_tool_names: list[str] = []
    if scripts_dir.is_dir():
        for py_file in sorted(scripts_dir.glob("*.py")):
            if py_file.name.startswith("_"):
                continue
            try:
                import importlib.util
                spec = importlib.util.spec_from_file_location(
                    f"_conflict_check_{skill_name}_{py_file.stem}", py_file
                )
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                for attr_name in dir(module):
                    if attr_name.startswith("_"):
                        continue
                    attr = getattr(module, attr_name)
                    if not asyncio.iscoroutinefunction(attr):
                        continue
                    if getattr(attr, "__module__", None) != module.__name__:
                        continue
                    hints = inspect.get_annotations(attr, eval_str=False)
                    ret = hints.get("return")
                    if ret is not None and ret is not dict:
                        continue
                    skill_tool_names.append(attr_name)
            except Exception:
                pass

    if not skill_tool_names:
        return []

    warnings: list[str] = []

    # Check against core tools
    for name in skill_tool_names:
        if name in CORE_TOOL_NAMES:
            warnings.append(f"Tool '{name}' conflicts with a built-in core tool and will be skipped.")

    # Check against other enabled skills' tools
    other_enabled = [s for s in enabled_list if s != skill_name]
    for other_name in other_enabled:
        other_scripts = skills_dir / other_name / "scripts"
        if not other_scripts.is_dir():
            continue
        for py_file in sorted(other_scripts.glob("*.py")):
            if py_file.name.startswith("_"):
                continue
            try:
                import importlib.util
                spec = importlib.util.spec_from_file_location(
                    f"_conflict_check_{other_name}_{py_file.stem}", py_file
                )
                if spec is None or spec.loader is None:
                    continue
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                for attr_name in dir(module):
                    if attr_name.startswith("_"):
                        continue
                    attr = getattr(module, attr_name)
                    if not asyncio.iscoroutinefunction(attr):
                        continue
                    if getattr(attr, "__module__", None) != module.__name__:
                        continue
                    if attr_name in skill_tool_names:
                        warnings.append(
                            f"Tool '{attr_name}' conflicts with the same tool in enabled skill '{other_name}'."
                        )
            except Exception:
                pass

    return warnings


def load_skill_instructions(skill: SkillMetadata) -> str:
    """Load the full SKILL.md body (everything after frontmatter).

    Called only when the agent activates a skill (progressive disclosure).
    """
    skill_file = skill.path / "SKILL.md"
    try:
        raw = skill_file.read_text(encoding="utf-8")
    except OSError:
        return ""

    parts = raw.split("---", 2)
    if len(parts) < 3:
        return ""

    return parts[2].strip()


def build_skills_prompt_section(skills: list[SkillMetadata]) -> str:
    """Build compact XML-style metadata block for enabled skills.

    Only includes enabled skills. Returns empty string if no skills are enabled.
    """
    enabled = [s for s in skills if s.enabled]
    if not enabled:
        return ""

    lines = ["## Available Skills", "<skills>"]
    for s in enabled:
        # F9: Escape XML special chars in user-controlled content
        desc = s.description.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        name = s.name.replace("&", "&amp;").replace('"', "&quot;")
        lines.append(f'<skill name="{name}" type="{s.skill_type}">{desc}</skill>')
    lines.append("</skills>")
    lines.append("When a task matches a skill's description, call `load_skill` to load its full instructions before proceeding.")

    return "\n".join(lines)


def _hash_skill_dir(skill_dir: Path) -> str:
    """Compute a content hash of all files in a skill directory."""
    import hashlib
    h = hashlib.sha256()
    for f in sorted(skill_dir.rglob("*")):
        if f.is_file():
            h.update(f.relative_to(skill_dir).as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()


def ensure_builtin_skills(skills_dir: Path) -> None:
    """Copy built-in skills to ~/.contop/skills/, with version-aware updates.

    - If skill doesn't exist: copies it and stores content hash.
    - If skill exists and hash matches (unmodified): auto-updates to new version.
    - If skill exists and hash doesn't match (user modified): skips with warning.
    """
    import json
    import shutil

    builtin_dir = Path(__file__).resolve().parent.parent / "skills" / "builtin"
    if not builtin_dir.is_dir():
        return

    # Load stored hashes
    hashes_path = skills_dir / ".builtin-hashes.json"
    hashes: dict[str, str] = {}
    if hashes_path.exists():
        try:
            hashes = json.loads(hashes_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            hashes = {}

    changed = False
    for entry in builtin_dir.iterdir():
        if not entry.is_dir():
            continue
        target = skills_dir / entry.name
        bundled_hash = _hash_skill_dir(entry)

        if not target.exists():
            # Fresh install
            try:
                shutil.copytree(entry, target)
                hashes[entry.name] = bundled_hash
                changed = True
                logger.info("Installed built-in skill: %s", entry.name)
            except OSError as e:
                logger.warning("Failed to install built-in skill %s: %s", entry.name, e)
        else:
            # Skill exists — check if user modified it
            stored_hash = hashes.get(entry.name, "")
            current_hash = _hash_skill_dir(target)

            if current_hash == stored_hash:
                # Unmodified by user — safe to update if bundled version changed
                if bundled_hash != stored_hash:
                    try:
                        shutil.rmtree(target)
                        shutil.copytree(entry, target)
                        hashes[entry.name] = bundled_hash
                        changed = True
                        logger.info("Updated built-in skill: %s", entry.name)
                    except OSError as e:
                        logger.warning("Failed to update built-in skill %s: %s", entry.name, e)
            else:
                # User modified — don't overwrite
                logger.debug("Skipping built-in skill %s: user has modified it", entry.name)

    if changed:
        try:
            hashes_path.write_text(json.dumps(hashes, indent=2), encoding="utf-8")
        except OSError as e:
            logger.warning("Failed to write builtin hashes: %s", e)
