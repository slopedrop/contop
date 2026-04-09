"""
Unit tests for core/file_tools.py - File operations tools.

Tests read_file, edit_file, find_files with happy path, error, and edge cases.

Module under test: core.file_tools
"""
import os
import textwrap

import pytest

from core.file_tools import read_file, edit_file, find_files, _files_read


@pytest.fixture(autouse=True)
def clear_read_cache():
    """Clear the files-read tracking set between tests."""
    _files_read.clear()
    yield
    _files_read.clear()


@pytest.fixture
def text_file(tmp_path):
    """Create a temporary text file with numbered lines."""
    content = "\n".join(f"Line {i}" for i in range(1, 21))
    p = tmp_path / "sample.txt"
    p.write_text(content, encoding="utf-8")
    return str(p)


@pytest.fixture
def empty_file(tmp_path):
    """Create an empty temporary file."""
    p = tmp_path / "empty.txt"
    p.write_text("", encoding="utf-8")
    return str(p)


@pytest.fixture
def unicode_file(tmp_path):
    """Create a temporary file with Unicode content."""
    p = tmp_path / "unicode.txt"
    p.write_text("こんにちは\n日本語テスト\n🎉🚀", encoding="utf-8")
    return str(p)


# --- read_file tests ---

@pytest.mark.unit
class TestReadFile:
    """Test read_file happy path, errors, and edge cases."""

    async def test_read_existing_file_returns_content_with_line_numbers(self, text_file):
        result = await read_file(text_file)
        assert result["status"] == "success"
        assert result["total_lines"] == 20
        assert "1\tLine 1" in result["content"]
        assert "duration_ms" in result

    async def test_read_file_pagination_offset_limit(self, text_file):
        result = await read_file(text_file, offset=9, limit=5)
        assert result["status"] == "success"
        assert result["lines_shown"] == 5
        assert "10\tLine 10" in result["content"]
        assert "14\tLine 14" in result["content"]
        assert result["truncated"] is True

    async def test_read_nonexistent_file_returns_error(self, tmp_path):
        result = await read_file(str(tmp_path / "nope.txt"))
        assert result["status"] == "error"
        assert "not found" in result["description"].lower()

    async def test_read_empty_file(self, empty_file):
        result = await read_file(empty_file)
        assert result["status"] == "success"
        assert result["total_lines"] == 0
        assert result["lines_shown"] == 0
        assert "empty" in result.get("note", "").lower()

    async def test_read_unicode_file(self, unicode_file):
        result = await read_file(unicode_file)
        assert result["status"] == "success"
        assert "こんにちは" in result["content"]

    async def test_read_file_long_line_truncation(self, tmp_path):
        p = tmp_path / "long.txt"
        p.write_text("x" * 3000, encoding="utf-8")
        result = await read_file(str(p))
        assert result["status"] == "success"
        assert "[truncated]" in result["content"]

    async def test_read_image_file_returns_base64(self, tmp_path):
        p = tmp_path / "test.png"
        p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
        result = await read_file(str(p))
        assert result["status"] == "success"
        assert "image_b64" in result
        assert result["mime_type"] == "image/png"


# --- edit_file tests ---

@pytest.mark.unit
class TestEditFile:
    """Test edit_file happy path, errors, and edge cases."""

    async def test_edit_file_happy_path(self, text_file):
        # Must read first
        await read_file(text_file)
        result = await edit_file(text_file, "Line 5\nLine 6", "Modified 5\nModified 6")
        assert result["status"] == "success"
        assert result["replacements"] == 1

        # Verify the file was actually modified
        with open(text_file, encoding="utf-8") as f:
            content = f.read()
            assert "Modified 5" in content
            assert "Modified 6" in content

    async def test_edit_file_without_read_returns_error(self, text_file):
        result = await edit_file(text_file, "Line 1", "Modified")
        assert result["status"] == "error"
        assert "read_file" in result["description"].lower() or "read" in result["description"].lower()

    async def test_edit_file_ambiguous_match_returns_error(self, tmp_path):
        p = tmp_path / "dup.txt"
        p.write_text("hello\nhello\nhello", encoding="utf-8")
        path = str(p)
        await read_file(path)
        result = await edit_file(path, "hello", "world")
        assert result["status"] == "error"
        assert "3 times" in result["description"]

    async def test_edit_file_replace_all(self, tmp_path):
        p = tmp_path / "dup.txt"
        p.write_text("hello\nhello\nhello", encoding="utf-8")
        path = str(p)
        await read_file(path)
        result = await edit_file(path, "hello", "world", replace_all=True)
        assert result["status"] == "success"
        assert result["replacements"] == 3

    async def test_edit_file_old_string_not_found(self, text_file):
        await read_file(text_file)
        result = await edit_file(text_file, "NONEXISTENT_STRING", "replacement")
        assert result["status"] == "error"
        assert "not found" in result["description"].lower()

    async def test_edit_file_same_old_new_returns_error(self, text_file):
        await read_file(text_file)
        result = await edit_file(text_file, "Line 1", "Line 1")
        assert result["status"] == "error"
        assert "identical" in result["description"].lower()


# --- find_files tests ---

@pytest.mark.unit
class TestFindFiles:
    """Test find_files happy path, errors, and edge cases."""

    async def test_find_by_glob_pattern(self, tmp_path):
        (tmp_path / "a.py").write_text("# python file", encoding="utf-8")
        (tmp_path / "b.py").write_text("# another", encoding="utf-8")
        (tmp_path / "c.txt").write_text("not python", encoding="utf-8")
        result = await find_files(pattern="*.py", path=str(tmp_path))
        assert result["status"] == "success"
        assert result["total"] == 2
        paths = [m["path"] for m in result["matches"]]
        assert all(p.endswith(".py") for p in paths)

    async def test_find_by_content_search(self, tmp_path):
        (tmp_path / "target.txt").write_text("the answer is 42", encoding="utf-8")
        (tmp_path / "other.txt").write_text("nothing here", encoding="utf-8")
        result = await find_files(search_text="42", path=str(tmp_path))
        assert result["status"] == "success"
        assert result["total"] >= 1
        assert any("42" in m.get("content", "") for m in result["matches"])

    async def test_find_no_pattern_or_text_returns_error(self):
        result = await find_files()
        assert result["status"] == "error"

    async def test_find_nonexistent_dir_returns_error(self, tmp_path):
        result = await find_files(pattern="*", path=str(tmp_path / "nonexistent"))
        assert result["status"] == "error"

    async def test_find_skips_git_directory(self, tmp_path):
        git_dir = tmp_path / ".git"
        git_dir.mkdir()
        (git_dir / "config").write_text("git config", encoding="utf-8")
        (tmp_path / "real.py").write_text("# real file", encoding="utf-8")
        result = await find_files(pattern="*", path=str(tmp_path))
        assert result["status"] == "success"
        paths = [m["path"] for m in result["matches"]]
        assert not any(".git" in p for p in paths)
