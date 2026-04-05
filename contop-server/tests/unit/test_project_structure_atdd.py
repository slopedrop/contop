"""
ATDD - Story 1.1: Project Initialization & Infrastructure Scaffold
Unit Tests for server configuration and project structure (GREEN PHASE)

These tests validate acceptance criteria:
  AC2: Host server initialized with FastAPI + dependencies
  AC3: Both environments build and run locally without errors
"""
import os
import pytest

# Resolve project root relative to this test file
# tests/unit/test_project_structure_atdd.py -> contop-server/
SERVER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


@pytest.mark.unit
class TestServerDependencies:
    """1.1-UNIT-007: pyproject.toml has all required dependencies"""

    def test_pyproject_toml_exists(self):
        """[P1] pyproject.toml must exist in server root"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        assert os.path.isfile(pyproject_path), f"pyproject.toml not found at {pyproject_path}"

    def test_pyproject_has_fastapi(self):
        """[P1] pyproject.toml must include fastapi dependency"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        with open(pyproject_path, "r") as f:
            content = f.read()
        assert "fastapi" in content, "fastapi not found in pyproject.toml dependencies"

    def test_pyproject_has_uvicorn(self):
        """[P1] pyproject.toml must include uvicorn dependency"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        with open(pyproject_path, "r") as f:
            content = f.read()
        assert "uvicorn" in content, "uvicorn not found in pyproject.toml dependencies"

    def test_pyproject_has_websockets(self):
        """[P1] pyproject.toml must include websockets dependency"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        with open(pyproject_path, "r") as f:
            content = f.read()
        assert "websockets" in content, "websockets not found in pyproject.toml dependencies"

    def test_pyproject_has_mss(self):
        """[P1] pyproject.toml must include mss (screen capture) dependency"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        with open(pyproject_path, "r") as f:
            content = f.read()
        assert "mss" in content, "mss not found in pyproject.toml dependencies"

    def test_pyproject_has_pyautogui(self):
        """[P1] pyproject.toml must include pyautogui dependency"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        with open(pyproject_path, "r") as f:
            content = f.read()
        assert "pyautogui" in content, "pyautogui not found in pyproject.toml dependencies"

    def test_pyproject_has_pillow(self):
        """[P1] pyproject.toml must include pillow dependency"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        with open(pyproject_path, "r") as f:
            content = f.read()
        assert "pillow" in content, "pillow not found in pyproject.toml dependencies"


@pytest.mark.unit
class TestPythonVersion:
    """1.1-UNIT-009: Python version requirement is >=3.12"""

    def test_pyproject_requires_python_312(self):
        """[P2] pyproject.toml must require Python >= 3.12"""
        pyproject_path = os.path.join(SERVER_ROOT, "pyproject.toml")
        with open(pyproject_path, "r") as f:
            content = f.read()
        assert "3.12" in content, "Python 3.12 requirement not found in pyproject.toml"


@pytest.mark.unit
class TestServerFolderStructure:
    """1.1-UNIT-008: Server folder structure exists"""

    def test_tools_directory_exists(self):
        """[P2] tools/ directory must exist in server root"""
        tools_dir = os.path.join(SERVER_ROOT, "tools")
        assert os.path.isdir(tools_dir), f"tools/ directory not found at {tools_dir}"

    def test_core_directory_exists(self):
        """[P2] core/ directory must exist in server root"""
        core_dir = os.path.join(SERVER_ROOT, "core")
        assert os.path.isdir(core_dir), f"core/ directory not found at {core_dir}"

    def test_platform_adapters_directory_exists(self):
        """[P2] platform_adapters/ directory must exist in server root"""
        platform_dir = os.path.join(SERVER_ROOT, "platform_adapters")
        assert os.path.isdir(platform_dir), f"platform_adapters/ directory not found at {platform_dir}"

    def test_tests_directory_exists(self):
        """[P2] tests/ directory must exist in server root"""
        tests_dir = os.path.join(SERVER_ROOT, "tests")
        assert os.path.isdir(tests_dir), f"tests/ directory not found at {tests_dir}"

    def test_main_py_exists(self):
        """[P2] main.py entrypoint must exist in server root"""
        main_path = os.path.join(SERVER_ROOT, "main.py")
        assert os.path.isfile(main_path), f"main.py not found at {main_path}"
