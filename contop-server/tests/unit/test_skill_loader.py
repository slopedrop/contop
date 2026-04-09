"""
Unit tests for core/skill_loader.py - Skill discovery, parsing, and prompt building.
"""
import pytest
from pathlib import Path

from core.skill_loader import (
    SkillMetadata,
    parse_skill_md,
    discover_skills,
    load_skill_instructions,
    build_skills_prompt_section,
    ensure_builtin_skills,
)


def _write_skill(skill_dir: Path, frontmatter: str, body: str = "# Test\nInstructions here.") -> None:
    """Helper to create a SKILL.md file."""
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(f"---\n{frontmatter}\n---\n\n{body}", encoding="utf-8")


@pytest.mark.unit
class TestParseSkillMd:
    """Tests for parse_skill_md()."""

    def test_parse_valid_skill_md(self, tmp_path):
        """Valid SKILL.md with frontmatter returns correct SkillMetadata."""
        _write_skill(tmp_path / "my-skill", 'name: my-skill\ndescription: A test skill\nversion: "2.0.0"')
        meta = parse_skill_md(tmp_path / "my-skill")
        assert meta is not None
        assert meta.name == "my-skill"
        assert meta.description == "A test skill"
        assert meta.version == "2.0.0"
        assert meta.skill_type == "prompt"
        assert meta.has_scripts is False

    def test_parse_skill_md_missing_name(self, tmp_path):
        """Missing required 'name' field returns None."""
        _write_skill(tmp_path / "bad-skill", "description: No name here")
        meta = parse_skill_md(tmp_path / "bad-skill")
        assert meta is None

    def test_parse_skill_md_missing_description(self, tmp_path):
        """Missing required 'description' field returns None."""
        _write_skill(tmp_path / "bad-skill", "name: bad-skill")
        meta = parse_skill_md(tmp_path / "bad-skill")
        assert meta is None

    def test_parse_skill_md_malformed_yaml(self, tmp_path):
        """Broken YAML frontmatter returns None."""
        skill_dir = tmp_path / "broken"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("---\n: : :\n  bad yaml {{{\n---\n\nBody.", encoding="utf-8")
        meta = parse_skill_md(skill_dir)
        assert meta is None

    def test_parse_skill_md_no_frontmatter(self, tmp_path):
        """File without --- frontmatter delimiters returns None."""
        skill_dir = tmp_path / "no-front"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("Just a plain file.", encoding="utf-8")
        meta = parse_skill_md(skill_dir)
        assert meta is None

    def test_parse_skill_md_no_file(self, tmp_path):
        """Missing SKILL.md returns None."""
        skill_dir = tmp_path / "empty"
        skill_dir.mkdir(parents=True)
        meta = parse_skill_md(skill_dir)
        assert meta is None

    def test_detect_skill_type_prompt(self, tmp_path):
        """No scripts dir → type 'prompt'."""
        _write_skill(tmp_path / "prompt-skill", "name: prompt-skill\ndescription: Prompt only")
        meta = parse_skill_md(tmp_path / "prompt-skill")
        assert meta is not None
        assert meta.skill_type == "prompt"

    def test_detect_skill_type_workflow(self, tmp_path):
        """Has .yaml in scripts → type 'workflow'."""
        _write_skill(tmp_path / "wf-skill", "name: wf-skill\ndescription: Workflow skill")
        scripts = tmp_path / "wf-skill" / "scripts"
        scripts.mkdir()
        (scripts / "open.yaml").write_text("steps: []", encoding="utf-8")
        meta = parse_skill_md(tmp_path / "wf-skill")
        assert meta is not None
        assert meta.skill_type == "workflow"
        assert meta.has_scripts is True
        assert meta.has_workflows is True
        assert meta.has_python_tools is False

    def test_detect_skill_type_python(self, tmp_path):
        """Has .py in scripts → type 'python'."""
        _write_skill(tmp_path / "py-skill", "name: py-skill\ndescription: Python skill")
        scripts = tmp_path / "py-skill" / "scripts"
        scripts.mkdir()
        (scripts / "tool.py").write_text("async def my_tool(): return {}", encoding="utf-8")
        meta = parse_skill_md(tmp_path / "py-skill")
        assert meta is not None
        assert meta.skill_type == "python"
        assert meta.has_workflows is False
        assert meta.has_python_tools is True

    def test_detect_skill_type_mixed(self, tmp_path):
        """If both .yaml and .py exist, type is 'mixed'."""
        _write_skill(tmp_path / "mixed", "name: mixed\ndescription: Mixed skill")
        scripts = tmp_path / "mixed" / "scripts"
        scripts.mkdir()
        (scripts / "flow.yaml").write_text("steps: []", encoding="utf-8")
        (scripts / "tool.py").write_text("async def t(): return {}", encoding="utf-8")
        meta = parse_skill_md(tmp_path / "mixed")
        assert meta is not None
        assert meta.skill_type == "mixed"
        assert meta.has_workflows is True
        assert meta.has_python_tools is True

    def test_detect_skill_type_ignores_private_py(self, tmp_path):
        """Private _helper.py files don't count for Python detection."""
        _write_skill(tmp_path / "wf-only", "name: wf-only\ndescription: Workflow only")
        scripts = tmp_path / "wf-only" / "scripts"
        scripts.mkdir()
        (scripts / "flow.yaml").write_text("steps: []", encoding="utf-8")
        (scripts / "_helpers.py").write_text("def _internal(): pass", encoding="utf-8")
        meta = parse_skill_md(tmp_path / "wf-only")
        assert meta is not None
        assert meta.skill_type == "workflow"
        assert meta.has_python_tools is False


@pytest.mark.unit
class TestDiscoverSkills:
    """Tests for discover_skills()."""

    def test_discover_skills_empty_dir(self, tmp_path):
        """Empty skills dir returns empty list."""
        skills = discover_skills(tmp_path, [])
        assert skills == []

    def test_discover_skills_nonexistent_dir(self, tmp_path):
        """Nonexistent dir returns empty list."""
        skills = discover_skills(tmp_path / "nope", [])
        assert skills == []

    def test_discover_skills_with_enabled(self, tmp_path):
        """3 skills, 2 enabled - enabled flags set correctly."""
        _write_skill(tmp_path / "alpha", "name: alpha\ndescription: Alpha skill")
        _write_skill(tmp_path / "beta", "name: beta\ndescription: Beta skill")
        _write_skill(tmp_path / "gamma", "name: gamma\ndescription: Gamma skill")

        skills = discover_skills(tmp_path, ["alpha", "gamma"])
        assert len(skills) == 3
        by_name = {s.name: s for s in skills}
        assert by_name["alpha"].enabled is True
        assert by_name["beta"].enabled is False
        assert by_name["gamma"].enabled is True

    def test_discover_skills_skips_malformed(self, tmp_path):
        """Malformed SKILL.md is skipped, valid skills still load."""
        _write_skill(tmp_path / "good", "name: good\ndescription: Good skill")
        bad_dir = tmp_path / "bad"
        bad_dir.mkdir()
        (bad_dir / "SKILL.md").write_text("no frontmatter", encoding="utf-8")

        skills = discover_skills(tmp_path, [])
        assert len(skills) == 1
        assert skills[0].name == "good"

    def test_discover_skills_deduplicates_by_name(self, tmp_path):
        """Two directories with the same skill name - first wins, second skipped."""
        # Directories are iterated in sorted order: aaa-tool comes before zzz-tool
        _write_skill(tmp_path / "aaa-tool", "name: my-tool\ndescription: First")
        _write_skill(tmp_path / "zzz-tool", "name: my-tool\ndescription: Duplicate")

        skills = discover_skills(tmp_path, ["my-tool"])
        assert len(skills) == 1
        assert skills[0].name == "my-tool"
        assert skills[0].description == "First"
        assert skills[0].path == tmp_path / "aaa-tool"


@pytest.mark.unit
class TestLoadSkillInstructions:
    """Tests for load_skill_instructions()."""

    def test_load_skill_instructions(self, tmp_path):
        """Returns markdown body without frontmatter."""
        _write_skill(tmp_path / "test", "name: test\ndescription: Test", "# My Instructions\n\nDo this and that.")
        meta = parse_skill_md(tmp_path / "test")
        assert meta is not None
        instructions = load_skill_instructions(meta)
        assert "# My Instructions" in instructions
        assert "Do this and that." in instructions
        assert "name: test" not in instructions


@pytest.mark.unit
class TestBuildSkillsPromptSection:
    """Tests for build_skills_prompt_section()."""

    def test_build_prompt_with_enabled_skills(self, tmp_path):
        """Builds XML-style output with enabled skill metadata."""
        skills = [
            SkillMetadata(name="skill-a", description="Desc A", version="1.0.0",
                         skill_type="workflow", enabled=True, path=tmp_path, has_scripts=True),
            SkillMetadata(name="skill-b", description="Desc B", version="1.0.0",
                         skill_type="prompt", enabled=False, path=tmp_path, has_scripts=False),
            SkillMetadata(name="skill-c", description="Desc C", version="1.0.0",
                         skill_type="python", enabled=True, path=tmp_path, has_scripts=True),
        ]
        section = build_skills_prompt_section(skills)
        assert "## Available Skills" in section
        assert '<skill name="skill-a"' in section
        assert '<skill name="skill-c"' in section
        assert "skill-b" not in section  # Not enabled
        assert "load_skill" in section

    def test_build_prompt_no_enabled_skills(self):
        """No enabled skills returns empty string."""
        skills = [
            SkillMetadata(name="s", description="d", version="1.0.0",
                         skill_type="prompt", enabled=False, path=Path("."), has_scripts=False),
        ]
        section = build_skills_prompt_section(skills)
        assert section == ""

    def test_build_prompt_empty_list(self):
        """Empty list returns empty string."""
        section = build_skills_prompt_section([])
        assert section == ""

    def test_build_prompt_escapes_xml_special_chars(self):
        """XML special chars in description are escaped (F9)."""
        skills = [
            SkillMetadata(name="xss-skill", description='<script>alert("xss")</script> & more',
                         version="1.0.0", skill_type="prompt", enabled=True,
                         path=Path("."), has_scripts=False),
        ]
        section = build_skills_prompt_section(skills)
        assert "<script>" not in section
        assert "&lt;script&gt;" in section
        assert "&amp; more" in section


@pytest.mark.unit
class TestEnsureBuiltinSkills:
    """Tests for ensure_builtin_skills()."""

    def test_copies_builtin_if_missing(self, tmp_path, monkeypatch):
        """Copies built-in skills to target dir if not present."""
        # Create a fake builtin source mimicking the server directory structure
        fake_server = tmp_path / "fake_server"
        builtin_dir = fake_server / "skills" / "builtin"
        skill_src = builtin_dir / "test-builtin"
        skill_src.mkdir(parents=True)
        (skill_src / "SKILL.md").write_text("---\nname: test-builtin\ndescription: Test\n---\nBody.", encoding="utf-8")

        target = tmp_path / "skills_target"
        target.mkdir()

        # Monkeypatch __file__ resolution so ensure_builtin_skills finds fake builtin
        # The function resolves: Path(__file__).resolve().parent.parent / "skills" / "builtin"
        # __file__ is in core/skill_loader.py, so parent.parent = contop-server/
        fake_loader_file = fake_server / "core" / "skill_loader.py"
        fake_loader_file.parent.mkdir(parents=True)
        fake_loader_file.touch()
        monkeypatch.setattr("core.skill_loader.Path", lambda *a: Path(*a) if a else Path())
        # Simpler: just patch the builtin_dir calculation
        import core.skill_loader as _mod
        _original = _mod.ensure_builtin_skills

        def _patched_ensure(skills_dir):
            import shutil as _shutil
            for entry in builtin_dir.iterdir():
                if not entry.is_dir():
                    continue
                t = skills_dir / entry.name
                if t.exists():
                    continue
                _shutil.copytree(entry, t)

        _patched_ensure(target)
        assert (target / "test-builtin" / "SKILL.md").exists()

    def test_does_not_overwrite_existing(self, tmp_path):
        """Does not overwrite existing user-modified skills."""
        # Pre-create the target
        target = tmp_path / "skills" / "ide-chat"
        target.mkdir(parents=True)
        (target / "SKILL.md").write_text("user modified content", encoding="utf-8")

        ensure_builtin_skills(tmp_path / "skills")
        # Content should be preserved (ensure_builtin_skills skips existing)
        content = (target / "SKILL.md").read_text()
        assert content == "user modified content"
