"""
Shared pytest fixtures for contop-server tests.
"""
import logging
from pathlib import Path

import pytest

# Silence noisy third-party loggers during tests
for _lib in ("google", "google_adk", "google.adk", "google.auth", "google.api_core",
             "urllib3", "grpc", "aiortc", "aioice"):
    logging.getLogger(_lib).setLevel(logging.WARNING)

from fastapi.testclient import TestClient
from main import app


@pytest.fixture(autouse=True)
def set_gemini_api_key(monkeypatch):
    """Set GEMINI_API_KEY for all tests so QR code generation succeeds by default."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-api-key")


@pytest.fixture(autouse=True)
def isolate_token_persistence(tmp_path, monkeypatch):
    """Redirect token persistence to a temp directory so tests never clobber
    the real ~/.contop/tokens.json."""
    fake_tokens = tmp_path / "tokens.json"
    monkeypatch.setattr("core.pairing._tokens_path", lambda: fake_tokens)


@pytest.fixture()
def client():
    """Create a FastAPI test client."""
    return TestClient(app)


@pytest.fixture()
def base_url():
    """Base URL for the test server."""
    return "http://localhost:8000"
