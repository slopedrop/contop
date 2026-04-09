"""
Unit tests for core/skill_executor.py - Workflow execution and Python tool loading.
"""
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock

from core.skill_executor import execute_skill, load_skill, load_python_tools


def _create_workflow(skill_dir: Path, workflow_name: str, steps: list) -> None:
    """Helper to create a workflow YAML file."""
    import yaml
    scripts = skill_dir / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    (scripts / f"{workflow_name}.yaml").write_text(
        yaml.dump({"name": workflow_name, "steps": steps}),
        encoding="utf-8",
    )


def _create_skill(skill_dir: Path, name: str, description: str, body: str = "Instructions.") -> None:
    """Helper to create a SKILL.md file."""
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n\n{body}",
        encoding="utf-8",
    )


def _mock_enabled(monkeypatch, *names):
    """Helper to mock get_enabled_skills to return the given skill names."""
    monkeypatch.setattr("core.settings.get_enabled_skills", lambda: list(names))


@pytest.mark.unit
class TestExecuteSkill:
    """Tests for execute_skill()."""

    async def test_execute_skill_success(self, tmp_path, monkeypatch):
        """Executes workflow steps in order, returns success."""
        skill_dir = tmp_path / "test-skill"
        _create_workflow(skill_dir, "open", [
            {"action": "hotkey", "keys": ["ctrl", "l"]},
            {"action": "wait", "seconds": 0.1},
            {"action": "type_text", "text": "hello"},
        ])
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        mock_gui = AsyncMock(return_value={"status": "success"})
        mock_wait = AsyncMock()
        monkeypatch.setattr("core.agent_tools.execute_gui", mock_gui)
        monkeypatch.setattr("core.agent_tools.wait", mock_wait)

        result = await execute_skill("test-skill", "open")
        assert result["status"] == "success"
        assert result["steps_executed"] == 3

    async def test_execute_skill_missing_yaml(self, tmp_path, monkeypatch):
        """Nonexistent workflow file returns error dict."""
        skill_dir = tmp_path / "test-skill"
        skill_dir.mkdir(parents=True)
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        result = await execute_skill("test-skill", "nonexistent")
        assert result["status"] == "error"
        assert "not found" in result["description"]

    async def test_execute_skill_invalid_yaml(self, tmp_path, monkeypatch):
        """Malformed YAML returns error dict."""
        skill_dir = tmp_path / "test-skill" / "scripts"
        skill_dir.mkdir(parents=True)
        (skill_dir / "bad.yaml").write_text(": : : bad yaml {{{", encoding="utf-8")
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        result = await execute_skill("test-skill", "bad")
        assert result["status"] == "error"

    async def test_execute_skill_no_steps_key(self, tmp_path, monkeypatch):
        """YAML without 'steps' key returns error."""
        skill_dir = tmp_path / "test-skill" / "scripts"
        skill_dir.mkdir(parents=True)
        (skill_dir / "nosteps.yaml").write_text("name: nosteps\n", encoding="utf-8")
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        result = await execute_skill("test-skill", "nosteps")
        assert result["status"] == "error"
        assert "steps" in result["description"].lower()

    async def test_execute_skill_with_params(self, tmp_path, monkeypatch):
        """Params are substituted into type_text steps."""
        skill_dir = tmp_path / "test-skill"
        _create_workflow(skill_dir, "send", [
            {"action": "type_text", "text": "{message}"},
        ])
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        mock_gui = AsyncMock(return_value={"status": "success"})
        monkeypatch.setattr("core.agent_tools.execute_gui", mock_gui)

        result = await execute_skill("test-skill", "send", json.dumps({"message": "hello world"}))
        assert result["status"] == "success"
        call_args = mock_gui.call_args
        coords = call_args.kwargs.get("coordinates", call_args[1].get("coordinates", {}))
        assert coords["text"] == "hello world"

    async def test_execute_skill_path_traversal(self, tmp_path, monkeypatch):
        """Path traversal in skill_name returns error (F2)."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        result = await execute_skill("../etc", "passwd")
        assert result["status"] == "error"
        assert "Invalid" in result["description"]

    async def test_execute_skill_disabled_returns_error(self, tmp_path, monkeypatch):
        """Skill disabled mid-session returns error (F5)."""
        skill_dir = tmp_path / "test-skill"
        _create_workflow(skill_dir, "open", [{"action": "wait", "seconds": 0.1}])
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch)  # No skills enabled

        result = await execute_skill("test-skill", "open")
        assert result["status"] == "error"
        assert "not enabled" in result["description"]

    async def test_execute_skill_no_chained_param_substitution(self, tmp_path, monkeypatch):
        """Params with {other_key} in values don't cascade (F11)."""
        skill_dir = tmp_path / "test-skill"
        _create_workflow(skill_dir, "chain", [
            {"action": "type_text", "text": "{a}"},
        ])
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        mock_gui = AsyncMock(return_value={"status": "success"})
        monkeypatch.setattr("core.agent_tools.execute_gui", mock_gui)

        result = await execute_skill(
            "test-skill", "chain",
            json.dumps({"a": "{b}", "b": "injected"}),
        )
        assert result["status"] == "success"
        call_args = mock_gui.call_args
        coords = call_args.kwargs.get("coordinates", call_args[1].get("coordinates", {}))
        assert coords["text"] == "{b}"

    async def test_execute_skill_unknown_action_returns_error(self, tmp_path, monkeypatch):
        """Unknown action type returns error immediately (F4)."""
        skill_dir = tmp_path / "test-skill"
        _create_workflow(skill_dir, "bad-action", [
            {"action": "unknown_action_xyz"},
        ])
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        result = await execute_skill("test-skill", "bad-action")
        assert result["status"] == "error"
        assert "Unknown action" in result["description"]
        assert result["steps_executed"] == 0

    async def test_execute_skill_malformed_step_returns_error(self, tmp_path, monkeypatch):
        """Non-dict step returns error immediately (F4)."""
        skill_dir = tmp_path / "test-skill"
        _create_workflow(skill_dir, "bad-step", [
            "not-a-dict",
        ])
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _mock_enabled(monkeypatch, "test-skill")

        result = await execute_skill("test-skill", "bad-step")
        assert result["status"] == "error"
        assert "not a valid step" in result["description"]
        assert result["steps_executed"] == 0


@pytest.mark.unit
class TestLoadSkill:
    """Tests for load_skill()."""

    async def test_load_skill_success(self, tmp_path, monkeypatch):
        """Returns instructions and available workflows list."""
        skill_dir = tmp_path / "test-skill"
        _create_skill(skill_dir, "test-skill", "A test skill", "# Instructions\n\nDo stuff.")
        _create_workflow(skill_dir, "open", [{"action": "wait", "seconds": 0.1}])
        _create_workflow(skill_dir, "send", [{"action": "wait", "seconds": 0.1}])

        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await load_skill("test-skill")
        assert result["status"] == "success"
        assert "# Instructions" in result["instructions"]
        assert "open" in result["available_workflows"]
        assert "send" in result["available_workflows"]

    async def test_load_skill_not_found(self, tmp_path, monkeypatch):
        """Nonexistent skill returns error."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await load_skill("nonexistent")
        assert result["status"] == "error"

    async def test_load_skill_invalid_skill(self, tmp_path, monkeypatch):
        """Skill with invalid SKILL.md returns error."""
        skill_dir = tmp_path / "broken"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("no frontmatter", encoding="utf-8")

        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        result = await load_skill("broken")
        assert result["status"] == "error"


@pytest.mark.unit
class TestLoadPythonTools:
    """Tests for load_python_tools()."""

    def test_load_python_tools_success(self, tmp_path):
        """Loads async functions from .py files in scripts/."""
        skill_dir = tmp_path / "py-skill"
        scripts = skill_dir / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "my_tool.py").write_text(
            "async def custom_action(param: str = '') -> dict:\n"
            "    return {'status': 'success', 'param': param}\n",
            encoding="utf-8",
        )

        tools = load_python_tools(skill_dir)
        assert len(tools) == 1
        assert tools[0].__name__ == "custom_action"

    def test_load_python_tools_skips_private(self, tmp_path):
        """Files starting with _ are skipped."""
        skill_dir = tmp_path / "py-skill"
        scripts = skill_dir / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "_helpers.py").write_text(
            "async def helper(): return {}\n",
            encoding="utf-8",
        )

        tools = load_python_tools(skill_dir)
        assert len(tools) == 0

    def test_load_python_tools_no_scripts_dir(self, tmp_path):
        """No scripts directory returns empty list."""
        skill_dir = tmp_path / "no-scripts"
        skill_dir.mkdir(parents=True)
        tools = load_python_tools(skill_dir)
        assert tools == []

    def test_load_python_tools_invalid_module(self, tmp_path):
        """Broken .py file returns empty list with warning."""
        skill_dir = tmp_path / "broken-py"
        scripts = skill_dir / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "broken.py").write_text("this is not valid python !!!", encoding="utf-8")

        tools = load_python_tools(skill_dir)
        assert tools == []


# --- Phase 2: Agent Skill Authoring Tests ---

from core.skill_executor import create_skill, edit_skill


@pytest.mark.unit
class TestCreateSkill:
    """Tests for create_skill()."""

    async def test_create_skill_success(self, tmp_path, monkeypatch):
        """Valid inputs create SKILL.md with correct frontmatter and body."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await create_skill(
            name="my-test-skill",
            description="A test skill for testing",
            instructions="# Test\n\nDo the thing.",
        )
        assert result["status"] == "success"
        assert result["enabled"] is False
        assert "NOT enabled" in result["note"]

        # Verify SKILL.md was written
        skill_file = tmp_path / "my-test-skill" / "SKILL.md"
        assert skill_file.exists()
        content = skill_file.read_text()
        assert "name: my-test-skill" in content
        assert "A test skill for testing" in content
        assert "# Test" in content

    async def test_create_skill_already_exists(self, tmp_path, monkeypatch):
        """Existing skill dir returns error."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        (tmp_path / "existing").mkdir()

        result = await create_skill(name="existing", description="test", instructions="test")
        assert result["status"] == "error"
        assert "already exists" in result["description"]

    async def test_create_skill_invalid_name_traversal(self, tmp_path, monkeypatch):
        """Name with path traversal returns error."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await create_skill(name="../escape", description="test", instructions="test")
        assert result["status"] == "error"

    async def test_create_skill_invalid_name_uppercase(self, tmp_path, monkeypatch):
        """Uppercase name returns error."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await create_skill(name="MySkill", description="test", instructions="test")
        assert result["status"] == "error"

    async def test_create_skill_disabled_by_default(self, tmp_path, monkeypatch):
        """Created skill has enabled=False in return."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await create_skill(name="new-skill", description="test", instructions="test")
        assert result["enabled"] is False

    async def test_create_skill_workflow_type_creates_scripts_dir(self, tmp_path, monkeypatch):
        """Workflow skill type creates scripts/ directory."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await create_skill(name="wf-skill", description="test", instructions="test", skill_type="workflow")
        assert result["status"] == "success"
        assert (tmp_path / "wf-skill" / "scripts").is_dir()


@pytest.mark.unit
class TestEditSkill:
    """Tests for edit_skill()."""

    async def test_edit_skill_update_instructions(self, tmp_path, monkeypatch):
        """Existing skill gets new instructions, frontmatter preserved."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _create_skill(tmp_path / "my-skill", "my-skill", "Original desc", "Original body.")

        result = await edit_skill(name="my-skill", instructions="New instructions here.")
        assert result["status"] == "success"
        assert "instructions" in result["updated_fields"]

        content = (tmp_path / "my-skill" / "SKILL.md").read_text()
        assert "New instructions here." in content
        assert "my-skill" in content  # Name preserved

    async def test_edit_skill_update_description(self, tmp_path, monkeypatch):
        """Existing skill gets new description, body preserved."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _create_skill(tmp_path / "my-skill", "my-skill", "Original desc", "Keep this body.")

        result = await edit_skill(name="my-skill", description="Updated description")
        assert result["status"] == "success"
        assert "description" in result["updated_fields"]

        content = (tmp_path / "my-skill" / "SKILL.md").read_text()
        assert "Updated description" in content
        assert "Keep this body." in content

    async def test_edit_skill_nonexistent(self, tmp_path, monkeypatch):
        """Nonexistent skill returns error."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await edit_skill(name="does-not-exist", instructions="test")
        assert result["status"] == "error"
        assert "not found" in result["description"]

    async def test_edit_skill_invalid_name_traversal(self, tmp_path, monkeypatch):
        """Name with path traversal returns error (F3)."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)

        result = await edit_skill(name="../escape", instructions="test")
        assert result["status"] == "error"
        assert "Invalid skill name" in result["description"]

    async def test_edit_skill_noop_returns_error(self, tmp_path, monkeypatch):
        """Calling with no instructions and no description returns error (F8)."""
        monkeypatch.setattr("core.skill_executor.get_skills_dir", lambda: tmp_path)
        _create_skill(tmp_path / "my-skill", "my-skill", "desc", "body")

        result = await edit_skill(name="my-skill")
        assert result["status"] == "error"
        assert "Nothing to update" in result["description"]
