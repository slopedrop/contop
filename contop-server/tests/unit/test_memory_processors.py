"""
Unit tests for core/memory_processors.py - TokenLimiter and ToolCallFilter.

Tests context management processors used in _before_model_callback.

Module under test: core.memory_processors
"""
import pytest

from core.memory_processors import ToolCallFilter, TokenLimiter


class FakeFunctionResponse:
    """Minimal mock of genai_types FunctionResponse."""
    def __init__(self, name: str, response: dict):
        self.name = name
        self.response = response


class FakeFunctionCall:
    """Minimal mock of genai_types FunctionCall."""
    def __init__(self, args: dict | None = None):
        self.args = args or {}


class FakePart:
    """Minimal mock of genai_types Part with text, function_response, function_call."""
    def __init__(self, text=None, function_response=None, function_call=None):
        self.text = text
        self.function_response = function_response
        self.function_call = function_call
        self.inline_data = None


class FakeContent:
    """Minimal mock of genai_types Content."""
    def __init__(self, parts=None):
        self.parts = parts or []


def _make_tool_result(name: str, response: dict) -> FakeContent:
    """Helper: create a Content with a single FunctionResponse part."""
    return FakeContent(parts=[
        FakePart(function_response=FakeFunctionResponse(name, response))
    ])


# --- ToolCallFilter tests ---

@pytest.mark.unit
class TestToolCallFilter:
    def test_strips_image_b64_from_old_results(self):
        """Old results should have image_b64 stripped."""
        contents = [
            _make_tool_result("observe_screen", {"status": "success", "image_b64": "huge_base64_data"}),
            _make_tool_result("observe_screen", {"status": "success", "image_b64": "data2", "raw_image_b64": "raw2"}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "ok"}),
            _make_tool_result("observe_screen", {"status": "success", "image_b64": "recent1"}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "latest"}),
        ]

        result = ToolCallFilter(keep_recent=3).process(contents)

        # Old results (index 0, 1) should have image_b64 stripped
        old_0 = result[0].parts[0].function_response.response
        assert "image_b64" not in old_0

        old_1 = result[1].parts[0].function_response.response
        assert "image_b64" not in old_1
        assert "raw_image_b64" not in old_1

        # Recent results (index 2, 3, 4) should be intact
        recent = result[3].parts[0].function_response.response
        assert recent["image_b64"] == "recent1"

    def test_truncates_long_stdout(self):
        """Old results with long stdout should be truncated."""
        long_output = "x" * 600
        contents = [
            _make_tool_result("execute_cli", {"status": "success", "stdout": long_output}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "ok"}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "ok2"}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "ok3"}),
        ]

        result = ToolCallFilter(keep_recent=3).process(contents)

        old_stdout = result[0].parts[0].function_response.response["stdout"]
        assert len(old_stdout) < 600
        assert "truncated" in old_stdout.lower()

    def test_does_nothing_when_fewer_than_keep_recent(self):
        """If there are fewer results than keep_recent, nothing is stripped."""
        contents = [
            _make_tool_result("observe_screen", {"status": "success", "image_b64": "data"}),
            _make_tool_result("execute_cli", {"status": "success"}),
        ]

        result = ToolCallFilter(keep_recent=3).process(contents)

        assert result[0].parts[0].function_response.response["image_b64"] == "data"

    def test_empty_contents_returns_empty(self):
        assert ToolCallFilter().process([]) == []
        assert ToolCallFilter().process(None) is None


# --- TokenLimiter tests ---

@pytest.mark.unit
class TestTokenLimiter:
    def test_truncates_old_results_when_over_limit(self):
        """When tokens exceed limit, old results are replaced with summaries."""
        # Create contents that total > 100 chars / 4 = 25 tokens
        # Use a very low limit to trigger truncation
        contents = [
            _make_tool_result("execute_cli", {"status": "success", "stdout": "a" * 200, "duration_ms": 50}),
            _make_tool_result("observe_screen", {"status": "success", "image_b64": "b" * 200, "duration_ms": 100}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "c" * 200, "duration_ms": 75}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "recent1", "duration_ms": 10}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "recent2", "duration_ms": 20}),
            _make_tool_result("execute_cli", {"status": "success", "stdout": "recent3", "duration_ms": 30}),
        ]

        result = TokenLimiter(max_tokens=50, keep_recent=3).process(contents)

        # Old results (index 0, 1, 2) should be summarized
        old_0 = result[0].parts[0].function_response.response
        assert "summary" in old_0
        assert "truncated" in old_0["summary"].lower()
        assert old_0["status"] == "success"

        # Recent results (index 3, 4, 5) should be intact
        recent = result[5].parts[0].function_response.response
        assert recent["stdout"] == "recent3"

    def test_does_nothing_when_under_limit(self):
        """When tokens are under limit, contents are unchanged."""
        contents = [
            _make_tool_result("execute_cli", {"status": "success", "stdout": "short"}),
        ]

        result = TokenLimiter(max_tokens=100_000).process(contents)

        assert result[0].parts[0].function_response.response["stdout"] == "short"

    def test_does_nothing_when_fewer_than_keep_recent(self):
        """Even if over limit, don't truncate if fewer results than keep_recent."""
        contents = [
            _make_tool_result("execute_cli", {"status": "success", "stdout": "a" * 10000}),
        ]

        result = TokenLimiter(max_tokens=10, keep_recent=5).process(contents)

        # Should be untouched since 1 < keep_recent
        assert "a" * 100 in result[0].parts[0].function_response.response["stdout"]

    def test_empty_contents_returns_empty(self):
        assert TokenLimiter().process([]) == []
        assert TokenLimiter().process(None) is None

    def test_estimate_tokens_counts_text_parts(self):
        """Token estimator should count characters from text parts."""
        limiter = TokenLimiter()
        contents = [
            FakeContent(parts=[FakePart(text="a" * 400)]),
        ]
        assert limiter._estimate_tokens(contents) == 100  # 400 chars / 4
