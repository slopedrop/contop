"""
Integration-level tests for the accessibility backend execution path.

Tests tool set selection, DualToolEvaluator classification, and self-verification.

[Source: tech-spec-accessibility-tree-backend.md — Task 19]
"""
import os
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Accessibility backend tool set
# ---------------------------------------------------------------------------

class TestAccessibilityBackendToolSet:
    """Verify the accessibility backend configures the correct tool set."""

    def test_accessibility_tools_are_importable(self):
        """All tools for the accessibility backend should be importable."""
        from core.agent_tools import (
            execute_accessible, execute_gui, execute_cli,
            execute_browser, observe_screen, get_ui_context,
            maximize_active_window, wait, get_action_history,
        )
        expected = [
            execute_cli, execute_accessible, execute_gui, execute_browser,
            observe_screen, get_ui_context, maximize_active_window, wait,
            get_action_history,
        ]
        for tool in expected:
            assert callable(tool)

    def test_accessibility_is_valid_backend(self):
        """'accessibility' is accepted by the backend validation in webrtc_peer."""
        from core.webrtc_peer import VALID_BACKENDS
        assert "accessibility" in VALID_BACKENDS


# ---------------------------------------------------------------------------
# DualToolEvaluator classification
# ---------------------------------------------------------------------------

class TestDualToolEvaluatorAccessible:
    """Verify execute_accessible is handled correctly by the DualToolEvaluator."""

    def test_execute_accessible_in_known_tools(self):
        """execute_accessible must be registered in KNOWN_TOOL_NAMES."""
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        assert "execute_accessible" in KNOWN_TOOL_NAMES

    @pytest.mark.asyncio
    async def test_execute_accessible_classified_as_host(self):
        """execute_accessible is display-dependent → always routed to host."""
        from core.dual_tool_evaluator import DualToolEvaluator
        evaluator = DualToolEvaluator()
        result = await evaluator.classify("execute_accessible", {
            "action": "click",
            "target": "Submit button",
            "element_name": "Submit",
        })
        assert result.route == "host"
        assert result.reason == "display_requires_host"


# ---------------------------------------------------------------------------
# Self-verification (prompt-based)
# ---------------------------------------------------------------------------

class TestSelfVerification:
    """Verify the execution agent system prompt includes self-verification."""

    def test_system_prompt_contains_verification_guidance(self):
        """The execution agent prompt should include self-verification instructions."""
        prompt_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "prompts", "execution-agent.md"
        )
        prompt_path = os.path.normpath(prompt_path)
        assert os.path.exists(prompt_path), f"Prompt file not found: {prompt_path}"
        with open(prompt_path, "r", encoding="utf-8") as f:
            content = f.read().lower()
        # Prompt should contain self-verification guidance
        assert "verif" in content, "Prompt must include verification instructions"

    def test_system_prompt_mentions_accessibility_first(self):
        """The execution strategy should prioritize accessibility tree."""
        prompt_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "prompts", "execution-agent.md"
        )
        prompt_path = os.path.normpath(prompt_path)
        if not os.path.exists(prompt_path):
            pytest.skip("Prompt file not found")
        with open(prompt_path, "r", encoding="utf-8") as f:
            content = f.read().lower()
        assert "accessibility first" in content or "accessibility tree" in content


class TestAccessibilityModeInstructions:
    """Verify that selecting the accessibility backend injects mode-specific instructions."""

    def test_accessibility_mode_instructions_in_prompt(self):
        """The system prompt should include accessibility mode instructions
        when the accessibility backend is selected."""
        from core.agent_config import get_execution_system_prompt

        prompt = get_execution_system_prompt(computer_use_backend="accessibility")
        assert "Active Mode: Accessibility" in prompt
        assert "get_ui_context" in prompt
        assert "execute_accessible" in prompt

    def test_accessibility_prompt_includes_dialog_handling(self):
        """Accessibility mode instructions must include dialog handling guidance."""
        from core.agent_config import get_execution_system_prompt

        prompt = get_execution_system_prompt(computer_use_backend="accessibility")
        assert "window_title" in prompt
        assert "wait(2)" in prompt
        assert "Save As" in prompt

    def test_vision_mode_instructions_for_default_backend(self):
        """Non-accessibility backends should get vision mode instructions."""
        from core.agent_config import get_execution_system_prompt

        prompt = get_execution_system_prompt(computer_use_backend="omniparser")
        assert "Active Mode: Vision" in prompt
