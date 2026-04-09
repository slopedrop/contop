"""
Unit tests for tools/gemini_computer_use.py - Gemini Computer Use plan-only adapter.

Tests coordinate denormalization, CU→gui_automation action mapping, safety_decision
handling, blocked key combos, navigate decomposition, and conversation history.
"""
import asyncio
import base64
import platform
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.gemini_computer_use import (
    GeminiComputerUseClient,
    PlannedAction,
    PlanResult,
    resize_screenshot_for_cu,
    _BLOCKED_KEY_COMBOS,
)


# ── Coordinate denormalization ────────────────────────────────────────────────


class TestDenormalizeToCapture:
    """Test 0-999 normalized coord → capture-space pixel coord conversion."""

    def test_center_coords(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))
        px, py = client._denormalize_to_capture(500, 500)
        assert px == 640
        assert py == 360

    def test_origin(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))
        px, py = client._denormalize_to_capture(0, 0)
        assert px == 0
        assert py == 0

    def test_max_coords(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))
        px, py = client._denormalize_to_capture(999, 999)
        assert px == int((999 / 1000) * 1280)
        assert py == int((999 / 1000) * 720)

    def test_different_capture_size(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1920, 1080))
        px, py = client._denormalize_to_capture(500, 500)
        assert px == 960
        assert py == 540


# ── CU → gui_automation action mapping ───────────────────────────────────────


class TestActionMapping:
    """Test that each CU action maps to the correct gui_automation action(s)."""

    @pytest.fixture
    def client(self):
        return GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))

    def test_click_at(self, client):
        actions = client._map_to_gui_actions("click_at", {"x": 500, "y": 500})
        assert len(actions) == 1
        assert actions[0].action == "click"
        assert actions[0].coordinates == {"x": 640, "y": 360}
        assert actions[0].cu_function_name == "click_at"

    def test_hover_at(self, client):
        actions = client._map_to_gui_actions("hover_at", {"x": 100, "y": 200})
        assert len(actions) == 1
        assert actions[0].action == "move_mouse"

    def test_type_text_at(self, client):
        actions = client._map_to_gui_actions("type_text_at", {"x": 100, "y": 200, "text": "hello"})
        assert len(actions) == 1
        assert actions[0].action == "type"
        assert actions[0].coordinates["text"] == "hello"

    def test_scroll_at(self, client):
        actions = client._map_to_gui_actions("scroll_at", {"x": 500, "y": 500, "direction": "down", "magnitude": 3})
        assert len(actions) == 1
        assert actions[0].action == "scroll"
        assert actions[0].coordinates["direction"] == "down"
        assert actions[0].coordinates["amount"] == 3

    def test_key_combination(self, client):
        actions = client._map_to_gui_actions("key_combination", {"keys": "ctrl+c"})
        assert len(actions) == 1
        assert actions[0].action == "hotkey"
        assert actions[0].coordinates["keys"] == ["ctrl", "c"]

    def test_key_combination_blocked(self, client):
        """Blocked combos return empty list - no action planned."""
        actions = client._map_to_gui_actions("key_combination", {"keys": "alt+f4"})
        assert len(actions) == 0

    def test_key_combination_blocked_win_r(self, client):
        actions = client._map_to_gui_actions("key_combination", {"keys": "win+r"})
        assert len(actions) == 0

    def test_drag_and_drop(self, client):
        actions = client._map_to_gui_actions("drag_and_drop", {"x": 100, "y": 100, "dest_x": 500, "dest_y": 500})
        assert len(actions) == 1
        assert actions[0].action == "drag"
        assert "start_x" in actions[0].coordinates
        assert "end_x" in actions[0].coordinates

    def test_navigate_decomposes_to_three_actions(self, client):
        """navigate should decompose into hotkey + type + press_key."""
        actions = client._map_to_gui_actions("navigate", {"url": "https://example.com"})
        assert len(actions) == 3
        assert actions[0].action == "hotkey"  # focus address bar
        assert actions[1].action == "type"    # type URL
        assert actions[1].coordinates["text"] == "https://example.com"
        assert actions[2].action == "press_key"  # Enter

    def test_navigate_bare_domain_gets_https(self, client):
        actions = client._map_to_gui_actions("navigate", {"url": "example.com"})
        assert actions[1].coordinates["text"] == "https://example.com"

    def test_navigate_blocked_scheme(self, client):
        actions = client._map_to_gui_actions("navigate", {"url": "file:///etc/passwd"})
        assert len(actions) == 0

    def test_wait_5_seconds(self, client):
        actions = client._map_to_gui_actions("wait_5_seconds", {})
        assert len(actions) == 1
        assert actions[0].action == "wait"
        assert actions[0].coordinates["seconds"] == 5

    def test_scroll_document(self, client):
        actions = client._map_to_gui_actions("scroll_document", {"direction": "down"})
        assert len(actions) == 1
        assert actions[0].action == "press_key"
        assert actions[0].coordinates["key"] == "End"

    def test_go_back(self, client):
        actions = client._map_to_gui_actions("go_back", {})
        assert len(actions) == 1
        assert actions[0].action == "hotkey"

    def test_go_forward(self, client):
        actions = client._map_to_gui_actions("go_forward", {})
        assert len(actions) == 1
        assert actions[0].action == "hotkey"

    def test_search(self, client):
        actions = client._map_to_gui_actions("search", {})
        assert len(actions) == 1
        assert actions[0].action == "hotkey"

    def test_open_web_browser(self, client):
        actions = client._map_to_gui_actions("open_web_browser", {})
        assert len(actions) == 1
        assert actions[0].action == "cli"
        assert "command" in actions[0].coordinates

    def test_unknown_action_returns_empty(self, client):
        actions = client._map_to_gui_actions("nonexistent_action", {})
        assert len(actions) == 0


# ── plan_step integration ────────────────────────────────────────────────────


class TestPlanStep:
    """Test plan_step returns PlanResult with mapped actions (no execution)."""

    @pytest.mark.asyncio
    async def test_plan_step_with_function_call(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))

        # Mock: model returns a click_at function call
        mock_response = MagicMock()
        mock_candidate = MagicMock()
        mock_content = MagicMock()

        mock_fc_part = MagicMock()
        mock_fc_part.text = None
        mock_fc_part.function_call = MagicMock()
        mock_fc_part.function_call.name = "click_at"
        mock_fc_part.function_call.args = {"x": 500, "y": 500}
        mock_fc_part.safety_decision = None

        mock_content.parts = [mock_fc_part]
        mock_candidate.content = mock_content
        mock_response.candidates = [mock_candidate]

        with patch.object(client._client.models, "generate_content", return_value=mock_response):
            fake_screenshot = base64.b64encode(b"fake_jpeg").decode()
            result = await client.plan_step(fake_screenshot, "click the button")

        assert result.status == "success"
        assert len(result.planned_actions) == 1
        assert result.planned_actions[0].action == "click"
        assert result.planned_actions[0].coordinates == {"x": 640, "y": 360}

    @pytest.mark.asyncio
    async def test_plan_step_text_response_means_done(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))

        mock_response = MagicMock()
        mock_candidate = MagicMock()
        mock_content = MagicMock()
        mock_text_part = MagicMock()
        mock_text_part.text = "Task complete."
        mock_text_part.function_call = None
        mock_content.parts = [mock_text_part]
        mock_candidate.content = mock_content
        mock_response.candidates = [mock_candidate]

        with patch.object(client._client.models, "generate_content", return_value=mock_response):
            fake_screenshot = base64.b64encode(b"fake_jpeg").decode()
            result = await client.plan_step(fake_screenshot, "test instruction")

        assert result.status == "done"
        assert result.description == "Task complete."


# ── Safety decision handling ──────────────────────────────────────────────────


class TestSafetyDecision:
    """Test that safety_decision with require_confirmation returns confirmation request."""

    @pytest.mark.asyncio
    async def test_safety_decision_require_confirmation(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))

        mock_response = MagicMock()
        mock_candidate = MagicMock()
        mock_content = MagicMock()

        mock_safety_part = MagicMock()
        mock_safety_part.text = None
        mock_safety_part.function_call = None
        mock_safety_decision = MagicMock()
        mock_safety_decision.decision = "require_confirmation"
        mock_safety_decision.reason = "Potentially dangerous action"
        mock_safety_decision.message = "This action may be harmful."
        mock_safety_part.safety_decision = mock_safety_decision

        mock_content.parts = [mock_safety_part]
        mock_candidate.content = mock_content
        mock_response.candidates = [mock_candidate]

        with patch.object(client._client.models, "generate_content", return_value=mock_response):
            fake_screenshot = base64.b64encode(b"fake_jpeg").decode()
            result = await client.plan_step(fake_screenshot, "click dangerous button")

        assert result.status == "confirmation_required"
        assert result.confirmation_request is not None
        assert result.confirmation_request["reason"] == "Potentially dangerous action"


# ── Conversation history ──────────────────────────────────────────────────────


class TestConversationHistory:
    """Test that history accumulates and reset clears it."""

    def test_initial_history_empty(self):
        client = GeminiComputerUseClient(api_key="test")
        assert len(client._history) == 0

    @pytest.mark.asyncio
    async def test_reset_clears_history(self):
        client = GeminiComputerUseClient(api_key="test")
        client._history.append(MagicMock())
        client._history.append(MagicMock())
        assert len(client._history) == 2
        await client.reset()
        assert len(client._history) == 0

    @pytest.mark.asyncio
    async def test_plan_step_adds_to_history(self):
        client = GeminiComputerUseClient(api_key="test", capture_size=(1280, 720))

        # Mock: model returns text (done)
        mock_response = MagicMock()
        mock_candidate = MagicMock()
        mock_content = MagicMock()
        mock_text_part = MagicMock()
        mock_text_part.text = "Task complete."
        mock_text_part.function_call = None
        mock_content.parts = [mock_text_part]
        mock_candidate.content = mock_content
        mock_response.candidates = [mock_candidate]

        with patch.object(client._client.models, "generate_content", return_value=mock_response):
            fake_screenshot = base64.b64encode(b"fake_jpeg").decode()
            result = await client.plan_step(fake_screenshot, "test instruction")

        assert result.status == "done"
        # History should have user content + model content
        assert len(client._history) == 2


# ── resize_screenshot_for_cu ─────────────────────────────────────────────────


class TestResizeScreenshot:
    """Test screenshot resizing preserves aspect ratio."""

    def test_resize_preserves_aspect_ratio(self):
        from PIL import Image
        import io

        # Create a 1920x1080 test image
        img = Image.new("RGB", (1920, 1080), color="red")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80)
        b64 = base64.b64encode(buf.getvalue()).decode()

        resized_b64 = resize_screenshot_for_cu(b64)
        resized_bytes = base64.b64decode(resized_b64)
        resized_img = Image.open(io.BytesIO(resized_bytes))

        # thumbnail preserves aspect ratio - should fit within 1440x900
        assert resized_img.width <= 1440
        assert resized_img.height <= 900
