"""
Unit tests for Smart Vision Routing — observe_screen mode/intent params.

Covers all ACs from tech-spec-smart-vision-routing.md:
- AC1: Backward compatibility (no args → grounding with zone annotations)
- AC2: Understanding mode with intent → understanding prompt, no zones
- AC3: Understanding mode + omniparser → LLM fallback with intent
- AC4: Grounding mode with custom intent → grounding prompt, custom instruction
- AC5: Understanding mode with no intent → default understanding instruction
- AC6: Grounding mode with no intent → default grounding instruction
- AC7: Understanding mode with no backend → needs_llm_vision with intent
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# AC1: Backward compatibility — no args
# ---------------------------------------------------------------------------

class TestAC1_BackwardCompatibility:
    """Given observe_screen() called with no args,
    Then returns element coordinates with zone annotations (backward compatible)."""

    @pytest.mark.asyncio
    async def test_no_args_grounding_mode(self):
        import core.agent_tools as at

        mock_client = MagicMock()
        mock_client.ground = AsyncMock(return_value={
            "action": "ground",
            "description": "[Screen zones ...]\nButton at (640, 360) [PAGE CONTENT]",
            "source": "bytedance/ui-tars-1.5-7b",
        })

        old_backend = at._active_vision_backend
        old_clients = at._vision_clients.copy()
        at._active_vision_backend = "ui_tars"
        at._vision_clients["bytedance/ui-tars-1.5-7b"] = mock_client
        try:
            with patch("core.settings.get_openrouter_api_key", return_value="sk-test"), \
                 patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)):
                result = await at.observe_screen()
        finally:
            at._active_vision_backend = old_backend
            at._vision_clients = old_clients

        assert result["status"] == "success"
        assert "ui_elements" in result

        # Verify ground() was called with grounding prompt and annotate_zones=True
        call_kwargs = mock_client.ground.call_args
        assert call_kwargs.kwargs["system_prompt"] == at._VISION_PROMPT_GROUNDING
        assert call_kwargs.kwargs["annotate_zones"] is True


# ---------------------------------------------------------------------------
# AC2: Understanding mode with intent
# ---------------------------------------------------------------------------

class TestAC2_UnderstandingModeWithIntent:
    """Given observe_screen(mode='understanding', intent='check if PDF was sent'),
    Then vision model receives understanding prompt and intent as user message,
    and returns natural language description without zone annotations."""

    @pytest.mark.asyncio
    async def test_understanding_mode_sends_correct_prompt(self):
        import core.agent_tools as at

        mock_client = MagicMock()
        mock_client.ground = AsyncMock(return_value={
            "action": "ground",
            "description": "The PDF was sent successfully via WhatsApp.",
            "source": "bytedance/ui-tars-1.5-7b",
        })

        old_backend = at._active_vision_backend
        old_clients = at._vision_clients.copy()
        at._active_vision_backend = "ui_tars"
        at._vision_clients["bytedance/ui-tars-1.5-7b"] = mock_client
        try:
            with patch("core.settings.get_openrouter_api_key", return_value="sk-test"), \
                 patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)):
                result = await at.observe_screen(
                    mode="understanding", intent="check if PDF was sent"
                )
        finally:
            at._active_vision_backend = old_backend
            at._vision_clients = old_clients

        assert result["status"] == "success"
        assert "ui_elements" in result

        call_args = mock_client.ground.call_args
        # System prompt should be understanding
        assert call_args.kwargs["system_prompt"] == at._VISION_PROMPT_UNDERSTANDING
        # Annotate zones should be False
        assert call_args.kwargs["annotate_zones"] is False
        # Instruction should be the intent
        assert call_args.args[1] == "check if PDF was sent"


# ---------------------------------------------------------------------------
# AC3: Understanding mode + omniparser → LLM fallback
# ---------------------------------------------------------------------------

class TestAC3_UnderstandingOmniparserFallback:
    """Given observe_screen(mode='understanding', intent='what error is showing?'),
    When active backend is omniparser,
    Then OmniParser is skipped and returns needs_llm_vision=True with intent."""

    @pytest.mark.asyncio
    async def test_omniparser_understanding_skips_to_llm(self):
        import core.agent_tools as at

        old_backend = at._active_vision_backend
        at._active_vision_backend = "omniparser"
        try:
            with patch("core.settings.get_openrouter_api_key", return_value=""), \
                 patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)), \
                 patch("core.agent_tools.get_omniparser") as mock_omni:
                # OmniParser.parse should NOT be called
                mock_omni.return_value.parse = AsyncMock(return_value=None)
                result = await at.observe_screen(
                    mode="understanding", intent="what error is showing?"
                )
        finally:
            at._active_vision_backend = old_backend

        assert result["status"] == "success"
        assert result["needs_llm_vision"] is True
        assert result["intent"] == "what error is showing?"
        # OmniParser parse should NOT have been called
        mock_omni.return_value.parse.assert_not_called()


# ---------------------------------------------------------------------------
# AC4: Grounding mode with custom intent
# ---------------------------------------------------------------------------

class TestAC4_GroundingWithCustomIntent:
    """Given observe_screen(mode='grounding', intent='find the submit button'),
    Then vision model receives grounding prompt and custom intent as user message."""

    @pytest.mark.asyncio
    async def test_grounding_custom_intent(self):
        import core.agent_tools as at

        mock_client = MagicMock()
        mock_client.ground = AsyncMock(return_value={
            "action": "ground",
            "description": "Submit button at (640, 500) [PAGE CONTENT]",
            "source": "bytedance/ui-tars-1.5-7b",
        })

        old_backend = at._active_vision_backend
        old_clients = at._vision_clients.copy()
        at._active_vision_backend = "ui_tars"
        at._vision_clients["bytedance/ui-tars-1.5-7b"] = mock_client
        try:
            with patch("core.settings.get_openrouter_api_key", return_value="sk-test"), \
                 patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)):
                result = await at.observe_screen(
                    mode="grounding", intent="find the submit button"
                )
        finally:
            at._active_vision_backend = old_backend
            at._vision_clients = old_clients

        assert result["status"] == "success"
        call_args = mock_client.ground.call_args
        assert call_args.kwargs["system_prompt"] == at._VISION_PROMPT_GROUNDING
        assert call_args.kwargs["annotate_zones"] is True
        # Intent should be composed with default instruction
        instruction = call_args.args[1]
        assert "find the submit button" in instruction
        assert at._GROUNDING_DEFAULT_INSTRUCTION in instruction


# ---------------------------------------------------------------------------
# AC5: Understanding mode with no intent → default instruction
# ---------------------------------------------------------------------------

class TestAC5_UnderstandingDefaultIntent:
    """Given observe_screen(mode='understanding') with no intent,
    Then uses default instruction 'Describe what you see on this screen.'"""

    @pytest.mark.asyncio
    async def test_understanding_default_instruction(self):
        import core.agent_tools as at

        mock_client = MagicMock()
        mock_client.ground = AsyncMock(return_value={
            "action": "ground",
            "description": "Chrome browser showing Google homepage.",
            "source": "bytedance/ui-tars-1.5-7b",
        })

        old_backend = at._active_vision_backend
        old_clients = at._vision_clients.copy()
        at._active_vision_backend = "ui_tars"
        at._vision_clients["bytedance/ui-tars-1.5-7b"] = mock_client
        try:
            with patch("core.settings.get_openrouter_api_key", return_value="sk-test"), \
                 patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)):
                result = await at.observe_screen(mode="understanding")
        finally:
            at._active_vision_backend = old_backend
            at._vision_clients = old_clients

        assert result["status"] == "success"
        call_args = mock_client.ground.call_args
        assert call_args.args[1] == at._UNDERSTANDING_DEFAULT_INSTRUCTION


# ---------------------------------------------------------------------------
# AC6: Grounding mode with no intent → default grounding instruction
# ---------------------------------------------------------------------------

class TestAC6_GroundingDefaultIntent:
    """Given observe_screen(mode='grounding') with no intent,
    Then uses default grounding instruction (current behavior)."""

    @pytest.mark.asyncio
    async def test_grounding_default_instruction(self):
        import core.agent_tools as at

        mock_client = MagicMock()
        mock_client.ground = AsyncMock(return_value={
            "action": "ground",
            "description": "Elements found",
            "source": "bytedance/ui-tars-1.5-7b",
        })

        old_backend = at._active_vision_backend
        old_clients = at._vision_clients.copy()
        at._active_vision_backend = "ui_tars"
        at._vision_clients["bytedance/ui-tars-1.5-7b"] = mock_client
        try:
            with patch("core.settings.get_openrouter_api_key", return_value="sk-test"), \
                 patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)):
                result = await at.observe_screen(mode="grounding")
        finally:
            at._active_vision_backend = old_backend
            at._vision_clients = old_clients

        assert result["status"] == "success"
        call_args = mock_client.ground.call_args
        assert call_args.args[1] == at._GROUNDING_DEFAULT_INSTRUCTION


# ---------------------------------------------------------------------------
# AC7: Understanding mode with no vision backend → needs_llm_vision
# ---------------------------------------------------------------------------

class TestAC7_UnderstandingNoBackend:
    """Given understanding mode with no vision backend available,
    Then returns needs_llm_vision=True with intent."""

    @pytest.mark.asyncio
    async def test_no_backend_llm_fallback_with_intent(self):
        import core.agent_tools as at

        old_backend = at._active_vision_backend
        at._active_vision_backend = "ui_tars"
        try:
            with patch("core.settings.get_openrouter_api_key", return_value=""), \
                 patch("core.agent_tools._capture_screen_sync", return_value=("b64", 1280, 720, 1920, 1080)):
                result = await at.observe_screen(
                    mode="understanding", intent="is the page loaded?"
                )
        finally:
            at._active_vision_backend = old_backend

        assert result["status"] == "success"
        assert result["needs_llm_vision"] is True
        assert result["intent"] == "is the page loaded?"


# ---------------------------------------------------------------------------
# VisionClient: system_prompt and annotate_zones params
# ---------------------------------------------------------------------------

class TestVisionClientParams:
    """Verify VisionClient.ground() respects system_prompt and annotate_zones."""

    @pytest.mark.asyncio
    async def test_custom_system_prompt_passed(self):
        from tools.vision_client import VisionClient

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "A screen description."

        mock_openai = AsyncMock()
        mock_openai.chat.completions.create = AsyncMock(return_value=mock_response)

        client = VisionClient("sk-test")
        client._client = mock_openai

        result = await client.ground(
            "b64img", "what do I see?",
            system_prompt="Custom prompt",
            annotate_zones=False,
        )

        assert result is not None
        assert result["description"] == "A screen description."
        # Verify system prompt was custom
        call_kwargs = mock_openai.chat.completions.create.call_args.kwargs
        sys_msg = call_kwargs["messages"][0]
        assert sys_msg["content"] == "Custom prompt"

    @pytest.mark.asyncio
    async def test_annotate_zones_false_skips_annotation(self):
        from tools.vision_client import VisionClient

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Button at (640, 360)"

        mock_openai = AsyncMock()
        mock_openai.chat.completions.create = AsyncMock(return_value=mock_response)

        client = VisionClient("sk-test")
        client._client = mock_openai

        result = await client.ground(
            "b64img", "describe",
            annotate_zones=False,
        )

        # Should NOT have zone annotations
        assert "[PAGE CONTENT]" not in result["description"]
        assert "[Screen zones" not in result["description"]
        assert result["description"] == "Button at (640, 360)"

    @pytest.mark.asyncio
    async def test_annotate_zones_true_adds_annotation(self):
        from tools.vision_client import VisionClient

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Button at (640, 360)"

        mock_openai = AsyncMock()
        mock_openai.chat.completions.create = AsyncMock(return_value=mock_response)

        client = VisionClient("sk-test")
        client._client = mock_openai

        result = await client.ground(
            "b64img", "identify elements",
            annotate_zones=True,
        )

        # Should have zone annotations
        assert "[PAGE CONTENT]" in result["description"]
        assert "[Screen zones" in result["description"]
