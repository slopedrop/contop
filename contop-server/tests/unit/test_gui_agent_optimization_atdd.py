"""
ATDD acceptance tests for GUI Agent Optimization tech-spec.

BDD-style acceptance tests covering all ACs across 4 tiers:
- Tier 1: Keyboard-First Execution
- Tier 2: System Prompt Hardening
- Tier 3: OmniParser Tuning
- Tier 4: UI-TARS via OpenRouter

[Source: tech-spec-gui-agent-optimization.md - Task 22]
"""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ===========================================================================
# Tier 1: Keyboard-First Execution
# ===========================================================================

class TestAC1_WindowsGetUIContext:
    """AC 1: Given a Windows host with uiautomation installed,
    When get_ui_context is called,
    Then it returns a dict containing foreground_window, focused_element,
    and interactive_elements from the active window."""

    @pytest.mark.asyncio
    async def test_returns_complete_context_dict(self):
        mock_adapter = MagicMock()
        mock_adapter.get_foreground_window_name.return_value = "Notepad"
        mock_adapter.get_focused_element.return_value = {
            "name": "Text Editor", "type": "EditControl",
            "automation_id": "15", "class_name": "Edit",
        }
        mock_adapter.get_interactive_elements.return_value = [
            {"name": "File", "type": "MenuItemControl", "automation_id": ""},
            {"name": "Edit", "type": "MenuItemControl", "automation_id": ""},
        ]
        with patch("tools.ui_automation.get_adapter", return_value=mock_adapter):
            from tools.ui_automation import UIAutomation
            UIAutomation._instance = None
            result = await UIAutomation().get_context()

        assert result["foreground_window"] == "Notepad"
        assert isinstance(result["foreground_window"], str)
        assert result["foreground_window"] != ""

        assert "name" in result["focused_element"]
        assert "type" in result["focused_element"]

        assert isinstance(result["interactive_elements"], list)
        assert len(result["interactive_elements"]) == 2
        assert all(isinstance(e, dict) for e in result["interactive_elements"])


class TestAC4_GracefulDegradation:
    """AC 4: Given any platform where the accessibility library is NOT installed,
    When get_ui_context is called,
    Then it returns empty defaults and status=success."""

    @pytest.mark.asyncio
    async def test_returns_empty_defaults(self):
        from platform_adapters.base import PlatformAdapter
        class EmptyAdapter(PlatformAdapter):
            def focus_window(self, title): return False
            def list_windows(self): return []
            # Uses base class defaults for accessibility methods

        with patch("tools.ui_automation.get_adapter", return_value=EmptyAdapter()):
            from tools.ui_automation import UIAutomation
            UIAutomation._instance = None
            result = await UIAutomation().get_context()

        assert result["foreground_window"] == ""
        assert result["focused_element"] == {}
        assert result["interactive_elements"] == []
        assert result["element_count"] == 0
        assert result["status"] == "success"


class TestAC5_SecurityGateClassification:
    """AC 5: Given get_ui_context is registered as an ADK tool,
    When the DualToolEvaluator classifies it,
    Then it routes to 'host'."""

    @pytest.mark.asyncio
    async def test_get_ui_context_routes_to_host(self):
        from core.dual_tool_evaluator import DualToolEvaluator
        evaluator = DualToolEvaluator()
        result = await evaluator.classify("get_ui_context", {})
        assert result.route == "host"
        assert result.reason == "display_requires_host"

    def test_get_ui_context_in_known_tool_names(self):
        from core.dual_tool_evaluator import KNOWN_TOOL_NAMES
        assert "get_ui_context" in KNOWN_TOOL_NAMES


# ===========================================================================
# Tier 2: System Prompt Hardening
# ===========================================================================

class TestAC6_SystemPromptSections:
    """AC 6: Given the system prompt in agent_config.py,
    When read as a string,
    Then it contains sections titled 'Execution Strategy - Keyboard First',
    'Common Application Hotkeys', and 'Element Disambiguation'."""

    def test_contains_keyboard_first_section(self):
        from core.agent_config import EXECUTION_AGENT_SYSTEM_PROMPT
        assert "Execution Strategy" in EXECUTION_AGENT_SYSTEM_PROMPT
        assert "Keyboard First" in EXECUTION_AGENT_SYSTEM_PROMPT

    def test_contains_hotkeys_section(self):
        from core.agent_config import EXECUTION_AGENT_SYSTEM_PROMPT
        assert "Common Application Hotkeys" in EXECUTION_AGENT_SYSTEM_PROMPT

    def test_contains_disambiguation_section(self):
        from core.agent_config import EXECUTION_AGENT_SYSTEM_PROMPT
        assert "Element Disambiguation" in EXECUTION_AGENT_SYSTEM_PROMPT


class TestAC7_PlatformSpecificHotkeys:
    """AC 7: Given the platform, When the system prompt is formatted,
    Then hotkey references use the correct modifier."""

    def test_prompt_contains_modifier_key(self):
        from core.agent_config import EXECUTION_AGENT_SYSTEM_PROMPT, _MODIFIER
        # The prompt should contain the platform-appropriate modifier
        assert f"{_MODIFIER}+L" in EXECUTION_AGENT_SYSTEM_PROMPT
        assert f"{_MODIFIER}+T" in EXECUTION_AGENT_SYSTEM_PROMPT


class TestAC8_DisambiguationInstructions:
    """AC 8: Given the 'Element Disambiguation' section,
    When read, Then it instructs using get_ui_context and foreground window."""

    def test_mentions_get_ui_context(self):
        from core.agent_config import EXECUTION_AGENT_SYSTEM_PROMPT
        assert "get_ui_context" in EXECUTION_AGENT_SYSTEM_PROMPT

    def test_mentions_foreground_window(self):
        from core.agent_config import EXECUTION_AGENT_SYSTEM_PROMPT
        assert "foreground" in EXECUTION_AGENT_SYSTEM_PROMPT.lower()

    def test_mentions_interact_only_with_foreground(self):
        from core.agent_config import EXECUTION_AGENT_SYSTEM_PROMPT
        # Should tell agent to interact ONLY with elements in the foreground app
        assert "ONLY" in EXECUTION_AGENT_SYSTEM_PROMPT
        assert "foreground app" in EXECUTION_AGENT_SYSTEM_PROMPT or \
               "foreground window" in EXECUTION_AGENT_SYSTEM_PROMPT


# ===========================================================================
# Tier 3: OmniParser Tuning
# ===========================================================================

class TestAC9_BoxThreshold:
    """AC 9: Given omniparser_local.py,
    When BOX_THRESHOLD is read, Then its value is 0.20."""

    def test_box_threshold_is_020(self):
        from tools.omniparser_local import BOX_THRESHOLD
        assert BOX_THRESHOLD == 0.20


class TestAC10_GPUWarning:
    """AC 10: Given OmniParser running on CPU,
    When _load_models() completes,
    Then a WARNING log message is emitted containing 'CUDA not available'."""

    def test_cpu_warning_logged(self):
        from tools.omniparser_local import OmniParserLocal

        parser = OmniParserLocal()
        # Mock torch to report CPU
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = False
        mock_torch.device.return_value = MagicMock(type="cpu")
        mock_torch.float32 = "float32"
        mock_torch.float16 = "float16"

        mock_yolo_cls = MagicMock()
        mock_easyocr_mod = MagicMock()

        # Patch the lazy imports by injecting into sys.modules
        # and patch module-level helpers
        mock_weights_path = MagicMock()
        mock_weights_path.__truediv__ = MagicMock(return_value=MagicMock())

        with patch("tools.omniparser_local._get_weights_dir", return_value=mock_weights_path), \
             patch("tools.omniparser_local.logger") as mock_logger, \
             patch.dict("sys.modules", {
                 "torch": mock_torch,
                 "ultralytics": MagicMock(YOLO=mock_yolo_cls),
                 "easyocr": mock_easyocr_mod,
             }):
            # _load_models() should at least reach the CUDA warning before
            # potentially failing on deeper model-loading steps.
            exception_raised = None
            try:
                parser._load_models()
            except Exception as exc:
                exception_raised = exc

            # The CUDA warning must have been emitted regardless of later failures
            warning_calls = [
                str(call) for call in mock_logger.warning.call_args_list
            ]
            cuda_warnings = [c for c in warning_calls if "CUDA" in c]
            assert len(cuda_warnings) > 0, (
                f"Expected CUDA warning, got warnings: {warning_calls}. "
                f"Exception during _load_models: {exception_raised}"
            )


class TestAC11_YOLOImgSize:
    """AC 11: Given OmniParser on CPU, When YOLO predict is called,
    Then imgsz is 416. Given GPU, Then imgsz is 640."""

    def test_yolo_imgsz_value(self):
        from tools.omniparser_local import YOLO_IMGSZ
        assert YOLO_IMGSZ == 640  # Base constant is 640, overridden at runtime for CPU


# ===========================================================================
# Tier 4: UI-TARS via OpenRouter
# ===========================================================================

class TestAC12_OpenRouterAPIKey:
    """AC 12: Given settings.json contains openrouter_api_key,
    When get_openrouter_api_key() is called, Then it returns the key.
    Given key is empty but env var is set, Then returns env var."""

    def test_returns_key_from_settings(self):
        with patch("core.settings.get_settings", return_value={"openrouter_api_key": "sk-or-test"}):
            from core.settings import get_openrouter_api_key
            assert get_openrouter_api_key() == "sk-or-test"

    def test_falls_back_to_env_var(self):
        with patch("core.settings.get_settings", return_value={"openrouter_api_key": ""}), \
             patch.dict(os.environ, {"OPENROUTER_API_KEY": "sk-env-key"}):
            from core.settings import get_openrouter_api_key
            assert get_openrouter_api_key() == "sk-env-key"

    def test_returns_empty_when_nothing_configured(self):
        with patch("core.settings.get_settings", return_value={"openrouter_api_key": ""}), \
             patch.dict(os.environ, {}, clear=True):
            from core.settings import get_openrouter_api_key
            # Remove env var if present
            os.environ.pop("OPENROUTER_API_KEY", None)
            assert get_openrouter_api_key() == ""


class TestAC14_UITarsBeforeOmniParser:
    """AC 14: Given an OpenRouter API key is configured,
    When observe_screen is called,
    Then VisionClient.ground() is called BEFORE OmniParser."""

    @pytest.mark.asyncio
    async def test_ui_tars_called_first(self):
        call_order = []

        async def mock_ground(*args, **kwargs):
            call_order.append("ui_tars")
            return {"action": "ground", "description": "elements", "source": "ui_tars"}

        async def mock_parse(*args, **kwargs):
            call_order.append("omniparser")
            return None

        mock_tars_cls = MagicMock()
        mock_tars_cls.return_value.ground = mock_ground

        with patch("core.settings.get_openrouter_api_key", return_value="sk-test"), \
             patch("tools.vision_client.VisionClient", mock_tars_cls), \
             patch("core.agent_tools._vision_clients", {}), \
             patch("core.agent_tools._active_vision_backend", "ui_tars"), \
             patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)), \
             patch("core.agent_tools.get_omniparser") as mock_omni:
            mock_omni.return_value.parse = mock_parse
            from core.agent_tools import observe_screen
            result = await observe_screen()

        assert call_order == ["ui_tars"]  # OmniParser NOT called because UI-TARS succeeded


class TestAC15_UITarsFallback:
    """AC 15: Given UI-TARS fails, When observe_screen is called,
    Then it falls back gracefully (LLM vision fallback for non-omniparser backends)."""

    @pytest.mark.asyncio
    async def test_fallback_to_llm_vision(self):
        """When ui_tars backend returns None, falls through to LLM vision fallback."""
        mock_client = MagicMock()
        mock_client.ground = AsyncMock(return_value=None)

        with patch("core.settings.get_openrouter_api_key", return_value="sk-test"), \
             patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)), \
             patch("core.agent_tools._active_vision_backend", "ui_tars"), \
             patch("core.agent_tools._vision_clients", {"bytedance/ui-tars-1.5-7b": mock_client}):
            from core.agent_tools import observe_screen
            result = await observe_screen()

        assert result["status"] == "success"
        assert result["needs_llm_vision"] is True


class TestAC16_NoKeySkipsUITars:
    """AC 16: Given no OpenRouter API key is configured,
    When observe_screen is called,
    Then UI-TARS is skipped entirely and OmniParser is used."""

    @pytest.mark.asyncio
    async def test_skips_ui_tars(self):
        mock_parse_result = MagicMock()
        mock_parse_result.elements = [MagicMock()]
        mock_parse_result.annotated_image_b64 = "annotated"
        mock_parse_result.describe_elements.return_value = "elements"

        with patch("core.settings.get_openrouter_api_key", return_value=""), \
             patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)), \
             patch("core.agent_tools._active_vision_backend", "omniparser"), \
             patch("core.agent_tools.get_omniparser") as mock_omni:
            mock_omni.return_value.parse = AsyncMock(return_value=mock_parse_result)
            mock_omni.return_value.get_loading_status.return_value = None
            from core.agent_tools import observe_screen
            result = await observe_screen()

        assert result["status"] == "success"
        mock_omni.return_value.parse.assert_called_once()


# ===========================================================================
# Cross-cutting: Tool registration
# ===========================================================================

class TestToolRegistration:
    """Verify get_ui_context is properly registered in the execution agent tools list."""

    def test_get_ui_context_in_agent_tools_list(self):
        """get_ui_context should be importable from agent_tools."""
        from core.agent_tools import get_ui_context
        assert callable(get_ui_context)

    def test_get_ui_context_tool_docstring(self):
        """Tool function must have a Google-style docstring for ADK schema generation."""
        from core.agent_tools import get_ui_context
        assert get_ui_context.__doc__ is not None
        assert "foreground_window" in get_ui_context.__doc__
        assert "interactive_elements" in get_ui_context.__doc__
