"""
Settings persistence module for Contop.

Manages ~/.contop/settings.json — security restrictions (restricted paths,
forbidden commands) with hot-reload via file mtime caching.
"""

import copy
import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Task 1.1: Default settings schema
DEFAULT_SETTINGS: dict = {
    "version": 1,
    "gemini_api_key": "",
    "openai_api_key": "",
    "anthropic_api_key": "",
    "openrouter_api_key": "",
    "provider_auth": {
        "gemini": {
            "mode": "api_key",
            "proxy_url": "",
        },
        "anthropic": {
            "mode": "api_key",
            "proxy_url": "",
        },
        "openai": {
            "mode": "api_key",
            "proxy_url": "",
        },
    },
    "proxy_auto_start": True,
    "conversation_system_prompt": "",   # empty = use built-in default
    "execution_system_prompt": "",      # empty = use prompts/execution-agent.md
    "restricted_paths": [
        "/root",
        "/etc/shadow",
        "/etc/passwd",
        "C:\\Windows",
        "C:\\Windows\\System32",
        "C:\\Windows\\SysWOW64",
    ],
    "forbidden_commands": [
        "rm -rf /",
        "mkfs",
        "dd if=",
        "format C:",
        "del /f /s /q C:\\",
    ],
    "keep_host_awake": False,
    "enabled_skills": [],
    "destructive_patterns": [
        "rm", "rmdir", "del", "deltree", "rd", "erase",
        "mv",
        "kill", "killall", "pkill", "taskkill",
        "shutdown", "halt", "reboot", "poweroff",
        "format", "mkfs", "fdisk", "dd",
        "DROP TABLE", "DROP DATABASE", "TRUNCATE",
        "remove-item", "move-item", "stop-process",
        "restart-computer", "stop-computer", "clear-content", "clear-item",
    ],
}

REQUIRED_KEYS = {"version", "restricted_paths", "forbidden_commands"}

# Module-level cache for hot-reload (Task 1.6)
_cached_settings: dict | None = None
_cached_mtime: float | None = None


# Task 1.2
def _resolve_settings_path() -> Path:
    """Return the path to ~/.contop/settings.json."""
    return Path.home() / ".contop" / "settings.json"


def get_settings_path() -> Path:
    """Public accessor for the settings file path."""
    return _resolve_settings_path()


# Task 1.3
def _ensure_contop_dir() -> None:
    """Create ~/.contop/ directory if it doesn't exist."""
    _resolve_settings_path().parent.mkdir(parents=True, exist_ok=True)


# Task 1.5
def _create_defaults() -> dict:
    """Write DEFAULT_SETTINGS to ~/.contop/settings.json and return them."""
    _ensure_contop_dir()
    path = _resolve_settings_path()
    path.write_text(json.dumps(DEFAULT_SETTINGS, indent=2), encoding="utf-8")
    return copy.deepcopy(DEFAULT_SETTINGS)


# Task 1.4
def load_settings() -> dict:
    """Read settings from JSON file, with fallback to defaults on error.

    - FileNotFoundError → create defaults and return them.
    - json.JSONDecodeError or missing keys → log warning, overwrite with defaults.
    """
    path = _resolve_settings_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return _create_defaults()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(
            "Settings file %s is corrupted (invalid JSON). Restoring defaults.", path
        )
        return _create_defaults()

    if not isinstance(data, dict) or not REQUIRED_KEYS.issubset(data.keys()):
        logger.warning(
            "Settings file %s is missing required keys. Restoring defaults.", path
        )
        return _create_defaults()

    return data


# Task 1.6
def get_settings() -> dict:
    """Return cached settings, re-reading only when file mtime changes."""
    global _cached_settings, _cached_mtime

    path = _resolve_settings_path()
    try:
        current_mtime = os.stat(path).st_mtime
    except FileNotFoundError:
        _cached_settings = _create_defaults()
        _cached_mtime = os.stat(path).st_mtime
        return _cached_settings

    if _cached_mtime is None or current_mtime != _cached_mtime:
        _cached_settings = load_settings()
        # Re-stat after load in case load_settings() recreated the file
        try:
            _cached_mtime = os.stat(path).st_mtime
        except FileNotFoundError:
            _cached_mtime = None
        return _cached_settings

    return _cached_settings  # type: ignore[return-value]


# Task 1.7
def save_settings(settings: dict) -> None:
    """Validate and persist settings to file, updating cache."""
    global _cached_settings, _cached_mtime

    if not isinstance(settings, dict) or not REQUIRED_KEYS.issubset(settings.keys()):
        raise ValueError(
            f"Settings must contain keys: {', '.join(sorted(REQUIRED_KEYS))}"
        )

    _ensure_contop_dir()
    path = _resolve_settings_path()
    path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    _cached_settings = copy.deepcopy(settings)
    _cached_mtime = os.stat(path).st_mtime


# Task 1.8
def reset_settings() -> dict:
    """Overwrite settings file with defaults and return them."""
    global _cached_settings, _cached_mtime

    defaults = _create_defaults()
    path = _resolve_settings_path()
    _cached_settings = defaults
    _cached_mtime = os.stat(path).st_mtime
    return defaults


# Task 1.9
def get_restricted_paths() -> list[str]:
    """Return the current list of restricted paths."""
    return get_settings()["restricted_paths"]


def get_forbidden_commands() -> list[str]:
    """Return the current list of forbidden commands."""
    return get_settings()["forbidden_commands"]


def get_destructive_patterns() -> list[str]:
    """Return the current list of destructive command patterns."""
    return get_settings().get("destructive_patterns", DEFAULT_SETTINGS["destructive_patterns"])


def get_gemini_api_key() -> str:
    """Return the Gemini API key from settings, falling back to env var."""
    key = get_settings().get("gemini_api_key", "")
    return key if key else os.environ.get("GEMINI_API_KEY", "")


def get_openai_api_key() -> str:
    """Return the OpenAI API key from settings, falling back to env var."""
    key = get_settings().get("openai_api_key", "")
    return key if key else os.environ.get("OPENAI_API_KEY", "")


def get_anthropic_api_key() -> str:
    """Return the Anthropic API key from settings, falling back to env var."""
    key = get_settings().get("anthropic_api_key", "")
    return key if key else os.environ.get("ANTHROPIC_API_KEY", "")


def get_openrouter_api_key() -> str:
    """Return the OpenRouter API key from settings, falling back to env var."""
    key = get_settings().get("openrouter_api_key", "")
    return key if key else os.environ.get("OPENROUTER_API_KEY", "")


def get_conversation_system_prompt() -> str:
    """Return the conversation system prompt override (empty string = use default)."""
    return get_settings().get("conversation_system_prompt", "")


def get_execution_system_prompt() -> str:
    """Return the execution system prompt override (empty string = use default .md file)."""
    return get_settings().get("execution_system_prompt", "")


def get_keep_host_awake() -> bool:
    """Return whether keep_host_awake is enabled."""
    return bool(get_settings().get("keep_host_awake", False))


def get_enabled_skills() -> list[str]:
    """Return the list of enabled skill names."""
    return list(get_settings().get("enabled_skills", []))


def get_skills_dir() -> Path:
    """Return the skills directory (~/.contop/skills/), creating it if needed."""
    skills_dir = Path.home() / ".contop" / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    return skills_dir


def get_away_mode_config() -> dict:
    """Return the away_mode configuration block from settings."""
    return get_settings().get("away_mode", {
        "enabled": False,
        "pin_hash": "",
        "emergency_pin_hash": "",
        "auto_engage_minutes": 5,
        "idle_timeout_enabled": True,
    })


def is_away_mode_enabled() -> bool:
    """Return whether Away Mode is enabled in settings."""
    return bool(get_away_mode_config().get("enabled", False))


def get_pinchtab_url() -> str:
    """Return the PinchTab REST API URL from settings, with fallback to default."""
    url = get_settings().get("pinchtab_url", "")
    if url:
        return url
    return "http://127.0.0.1:9867"


def get_provider_auth() -> dict:
    """Return provider_auth config with safe defaults for existing installs."""
    settings = get_settings()
    return settings.get("provider_auth", DEFAULT_SETTINGS["provider_auth"])


def is_subscription_mode(provider: str) -> bool:
    """Check if a provider is configured for CLI proxy subscription mode."""
    auth = get_provider_auth()
    return auth.get(provider, {}).get("mode") == "cli_proxy"


def get_proxy_url(provider: str) -> str:
    """Return the proxy URL for a given provider, or empty string."""
    auth = get_provider_auth()
    return auth.get(provider, {}).get("proxy_url", "")
