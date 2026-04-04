"""Tests for _resolve_model() and multi-provider API key setup."""

import os
from unittest.mock import patch, MagicMock

import pytest


class TestResolveModel:
    """Verify _resolve_model returns LiteLlm for prefixed models, plain str for Gemini."""

    def test_gemini_model_returns_string(self):
        from core.execution_agent import _resolve_model

        result = _resolve_model("gemini-2.5-flash")
        assert isinstance(result, str)
        assert result == "gemini-2.5-flash"

    def test_gemini_pro_returns_string(self):
        from core.execution_agent import _resolve_model

        result = _resolve_model("gemini-2.5-pro")
        assert isinstance(result, str)

    def test_openai_prefix_returns_litellm(self):
        from core.execution_agent import _resolve_model
        from google.adk.models.lite_llm import LiteLlm

        result = _resolve_model("openai/gpt-5.4")
        assert isinstance(result, LiteLlm)

    def test_anthropic_prefix_returns_litellm(self):
        from core.execution_agent import _resolve_model
        from google.adk.models.lite_llm import LiteLlm

        result = _resolve_model("anthropic/claude-opus-4-6")
        assert isinstance(result, LiteLlm)

    def test_openrouter_prefix_returns_litellm(self):
        from core.execution_agent import _resolve_model
        from google.adk.models.lite_llm import LiteLlm

        result = _resolve_model("openrouter/meta-llama/llama-3.1-70b-instruct")
        assert isinstance(result, LiteLlm)

    def test_groq_prefix_returns_litellm(self):
        from core.execution_agent import _resolve_model
        from google.adk.models.lite_llm import LiteLlm

        result = _resolve_model("groq/llama-3-70b")
        assert isinstance(result, LiteLlm)

    def test_empty_string_returns_string(self):
        from core.execution_agent import _resolve_model

        result = _resolve_model("")
        assert isinstance(result, str)

    @pytest.mark.parametrize(
        "prefix",
        ["openai/", "anthropic/", "groq/", "mistral/", "together_ai/",
         "deepseek/", "fireworks_ai/", "cohere/", "openrouter/"],
    )
    def test_all_litellm_prefixes(self, prefix):
        from core.execution_agent import _resolve_model
        from google.adk.models.lite_llm import LiteLlm

        result = _resolve_model(f"{prefix}some-model")
        assert isinstance(result, LiteLlm), f"Expected LiteLlm for prefix '{prefix}'"


class TestApiKeySetup:
    """Verify multi-provider API keys are set in os.environ during agent init."""

    def test_openai_key_from_settings(self):
        from core.settings import get_openai_api_key

        with patch("core.settings.get_settings", return_value={"openai_api_key": "test-openai-key"}):
            assert get_openai_api_key() == "test-openai-key"

    def test_anthropic_key_from_settings(self):
        from core.settings import get_anthropic_api_key

        with patch("core.settings.get_settings", return_value={"anthropic_api_key": "test-anthropic-key"}):
            assert get_anthropic_api_key() == "test-anthropic-key"

    def test_openai_key_env_fallback(self):
        from core.settings import get_openai_api_key

        with patch("core.settings.get_settings", return_value={}):
            with patch.dict(os.environ, {"OPENAI_API_KEY": "env-openai-key"}):
                assert get_openai_api_key() == "env-openai-key"

    def test_anthropic_key_env_fallback(self):
        from core.settings import get_anthropic_api_key

        with patch("core.settings.get_settings", return_value={}):
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "env-anthropic-key"}):
                assert get_anthropic_api_key() == "env-anthropic-key"
