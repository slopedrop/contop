"""
ATDD - Story 1.9: Settings Persistence & Configuration Panel
Unit Tests for settings module persistence, hot-reload, and corruption fallback

These tests validate acceptance criteria:
  AC1: Fresh installation creates default settings file at ~/.contop/settings.json
  AC3: Modified settings hot-reload without server restart via mtime checking
  AC4: Corrupted or missing-key settings file falls back to defaults with warning

Module under test: core.settings
"""
import json
import logging
import os
import time

import pytest

from core.settings import (
    DEFAULT_SETTINGS,
    get_forbidden_commands,
    get_restricted_paths,
    get_settings,
    load_settings,
    reset_settings,
    save_settings,
    _resolve_settings_path,
)


@pytest.fixture(autouse=True)
def isolate_settings(tmp_path, monkeypatch):
    """Redirect settings file to tmp_path so tests never touch ~/.contop/.

    Also reset any cached settings between tests.
    """
    settings_file = tmp_path / ".contop" / "settings.json"
    monkeypatch.setattr("core.settings._resolve_settings_path", lambda: settings_file)

    # Reset module-level cache between tests
    monkeypatch.setattr("core.settings._cached_settings", None)
    monkeypatch.setattr("core.settings._cached_mtime", None)

    yield settings_file


@pytest.mark.unit
class TestDefaultSettingsCreation:
    """1.9-UNIT-001: Default settings created on fresh install (AC1)"""

    def test_default_settings_created_on_fresh_install(self, isolate_settings):
        """[P0] load_settings() must create default settings file when none exists.

        Given: No settings file exists (fresh installation)
        When:  load_settings() is called
        Then:  A file at the settings path must be created with DEFAULT_SETTINGS
        """
        # Given — file does not exist
        assert not isolate_settings.exists(), "Settings file should not exist before first load"

        # When
        settings = load_settings()

        # Then
        assert isolate_settings.exists(), "Settings file must be created on first load"
        assert settings == DEFAULT_SETTINGS, (
            f"Returned settings must match DEFAULT_SETTINGS, got {settings}"
        )

    def test_default_settings_schema_has_required_keys(self):
        """[P0] DEFAULT_SETTINGS must contain version, restricted_paths, forbidden_commands.

        Given: The DEFAULT_SETTINGS module constant
        When:  We inspect its keys
        Then:  It must contain 'version', 'restricted_paths', 'forbidden_commands'
        """
        # Then
        assert "version" in DEFAULT_SETTINGS, "DEFAULT_SETTINGS must contain 'version'"
        assert "restricted_paths" in DEFAULT_SETTINGS, "DEFAULT_SETTINGS must contain 'restricted_paths'"
        assert "forbidden_commands" in DEFAULT_SETTINGS, "DEFAULT_SETTINGS must contain 'forbidden_commands'"
        assert DEFAULT_SETTINGS["version"] == 1, (
            f"DEFAULT_SETTINGS version must be 1, got {DEFAULT_SETTINGS['version']}"
        )
        assert isinstance(DEFAULT_SETTINGS["restricted_paths"], list), "restricted_paths must be a list"
        assert isinstance(DEFAULT_SETTINGS["forbidden_commands"], list), "forbidden_commands must be a list"
        assert len(DEFAULT_SETTINGS["restricted_paths"]) > 0, "Default restricted_paths must not be empty"
        assert len(DEFAULT_SETTINGS["forbidden_commands"]) > 0, "Default forbidden_commands must not be empty"


@pytest.mark.unit
class TestLoadValidSettings:
    """1.9-UNIT-002: Load valid custom settings from file (AC1, AC3)"""

    def test_load_valid_settings(self, isolate_settings):
        """[P1] load_settings() must return custom settings when file contains valid JSON.

        Given: A settings file with custom restricted paths and commands
        When:  load_settings() is called
        Then:  The custom values must be returned (not defaults)
        """
        # Given
        custom_settings = {
            "version": 1,
            "restricted_paths": ["/custom/path"],
            "forbidden_commands": ["custom-cmd"],
        }
        isolate_settings.parent.mkdir(parents=True, exist_ok=True)
        isolate_settings.write_text(json.dumps(custom_settings, indent=2))

        # When
        settings = load_settings()

        # Then
        assert settings["restricted_paths"] == ["/custom/path"], (
            f"Expected custom restricted_paths, got {settings['restricted_paths']}"
        )
        assert settings["forbidden_commands"] == ["custom-cmd"], (
            f"Expected custom forbidden_commands, got {settings['forbidden_commands']}"
        )


@pytest.mark.unit
class TestCorruptedFileFallback:
    """1.9-UNIT-003: Corrupted settings file falls back to defaults (AC4)"""

    def test_corrupted_file_falls_back_to_defaults(self, isolate_settings, caplog):
        """[P0] load_settings() must return defaults when file contains invalid JSON.

        Given: A settings file with corrupted (non-JSON) content
        When:  load_settings() is called
        Then:  Defaults must be returned, a warning logged, and file overwritten
        """
        # Given
        isolate_settings.parent.mkdir(parents=True, exist_ok=True)
        isolate_settings.write_text("{{{{not valid json at all!!!!")

        # When
        with caplog.at_level(logging.WARNING):
            settings = load_settings()

        # Then
        assert settings == DEFAULT_SETTINGS, (
            "Corrupted file must fall back to DEFAULT_SETTINGS"
        )
        assert any("warning" in record.message.lower() or "corrupt" in record.message.lower()
                    or "invalid" in record.message.lower() or "fallback" in record.message.lower()
                    or "default" in record.message.lower()
                    for record in caplog.records), (
            "A warning must be logged when settings file is corrupted"
        )
        # Verify file was overwritten with defaults
        restored = json.loads(isolate_settings.read_text())
        assert restored == DEFAULT_SETTINGS, "Corrupted file must be overwritten with defaults"

    def test_missing_keys_falls_back_to_defaults(self, isolate_settings, caplog):
        """[P0] load_settings() must return defaults when required keys are missing.

        Given: A settings file with valid JSON but missing 'restricted_paths' key
        When:  load_settings() is called
        Then:  Defaults must be returned and file overwritten
        """
        # Given
        incomplete = {"version": 1, "forbidden_commands": ["rm -rf /"]}
        isolate_settings.parent.mkdir(parents=True, exist_ok=True)
        isolate_settings.write_text(json.dumps(incomplete))

        # When
        with caplog.at_level(logging.WARNING):
            settings = load_settings()

        # Then
        assert settings == DEFAULT_SETTINGS, (
            "Settings with missing keys must fall back to DEFAULT_SETTINGS"
        )


@pytest.mark.unit
class TestHotReload:
    """1.9-UNIT-004: Hot-reload detects external file changes (AC3)"""

    def test_hot_reload_detects_file_changes(self, isolate_settings):
        """[P0] get_settings() must detect file mtime changes and reload.

        Given: Settings loaded and cached
        When:  The file is modified externally with new values
        Then:  get_settings() must return the new values (not stale cache)
        """
        # Given — initial load creates defaults
        initial = load_settings()
        assert initial == DEFAULT_SETTINGS

        # When — modify file externally
        modified = {
            "version": 1,
            "restricted_paths": ["/new/restricted"],
            "forbidden_commands": ["new-forbidden"],
        }
        # Force mtime to differ: set file timestamp 2 seconds into the future
        # to handle filesystems with 1-second mtime resolution (FAT32, HFS+)
        isolate_settings.write_text(json.dumps(modified, indent=2))
        future_time = time.time() + 2
        os.utime(isolate_settings, (future_time, future_time))

        # Then — get_settings() must detect change
        reloaded = get_settings()
        assert reloaded["restricted_paths"] == ["/new/restricted"], (
            f"get_settings() must detect file changes, got {reloaded['restricted_paths']}"
        )
        assert reloaded["forbidden_commands"] == ["new-forbidden"], (
            f"get_settings() must detect file changes, got {reloaded['forbidden_commands']}"
        )


@pytest.mark.unit
class TestSaveSettings:
    """1.9-UNIT-005: save_settings() persists data to file (AC3)"""

    def test_save_settings_persists_to_file(self, isolate_settings):
        """[P0] save_settings() must write provided settings to disk.

        Given: An initial load (creates defaults)
        When:  save_settings() is called with custom data
        Then:  Reading the file directly must show the custom data
        """
        # Given
        load_settings()

        # When
        custom = {
            "version": 1,
            "restricted_paths": ["/saved/path"],
            "forbidden_commands": ["saved-cmd"],
        }
        save_settings(custom)

        # Then — read file directly (bypass cache)
        on_disk = json.loads(isolate_settings.read_text())
        assert on_disk["restricted_paths"] == ["/saved/path"], (
            f"File on disk must contain saved paths, got {on_disk['restricted_paths']}"
        )
        assert on_disk["forbidden_commands"] == ["saved-cmd"], (
            f"File on disk must contain saved commands, got {on_disk['forbidden_commands']}"
        )


@pytest.mark.unit
class TestResetSettings:
    """1.9-UNIT-006: reset_settings() restores defaults (AC3)"""

    def test_reset_settings_restores_defaults(self, isolate_settings):
        """[P1] reset_settings() must overwrite file with DEFAULT_SETTINGS.

        Given: Custom settings have been saved
        When:  reset_settings() is called
        Then:  The returned settings and file contents must match DEFAULT_SETTINGS
        """
        # Given
        custom = {
            "version": 1,
            "restricted_paths": ["/custom"],
            "forbidden_commands": ["custom"],
        }
        load_settings()
        save_settings(custom)

        # When
        result = reset_settings()

        # Then
        assert result == DEFAULT_SETTINGS, (
            f"reset_settings() must return DEFAULT_SETTINGS, got {result}"
        )
        on_disk = json.loads(isolate_settings.read_text())
        assert on_disk == DEFAULT_SETTINGS, "File on disk must be reset to defaults"


@pytest.mark.unit
class TestConvenienceGetters:
    """1.9-UNIT-007: Convenience getter functions (AC3)"""

    def test_get_restricted_paths_returns_list(self, isolate_settings):
        """[P1] get_restricted_paths() must return the restricted_paths list.

        Given: Default settings loaded
        When:  get_restricted_paths() is called
        Then:  It must return a list matching DEFAULT_SETTINGS['restricted_paths']
        """
        # Given
        load_settings()

        # When
        paths = get_restricted_paths()

        # Then
        assert isinstance(paths, list), f"Expected list, got {type(paths).__name__}"
        assert paths == DEFAULT_SETTINGS["restricted_paths"], (
            f"get_restricted_paths() must return default paths, got {paths}"
        )

    def test_get_forbidden_commands_returns_list(self, isolate_settings):
        """[P1] get_forbidden_commands() must return the forbidden_commands list.

        Given: Default settings loaded
        When:  get_forbidden_commands() is called
        Then:  It must return a list matching DEFAULT_SETTINGS['forbidden_commands']
        """
        # Given
        load_settings()

        # When
        commands = get_forbidden_commands()

        # Then
        assert isinstance(commands, list), f"Expected list, got {type(commands).__name__}"
        assert commands == DEFAULT_SETTINGS["forbidden_commands"], (
            f"get_forbidden_commands() must return default commands, got {commands}"
        )
