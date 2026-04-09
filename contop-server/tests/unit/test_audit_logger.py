"""
Unit tests for core/audit_logger.py - JSONL audit logging.

Tests 5.1–5.6 from Story 4.1.
"""

import json
import re
from unittest.mock import patch

import pytest

from core.audit_logger import AuditLogger


@pytest.fixture
def audit_logger(tmp_path):
    """Create an AuditLogger with log dir pointing to tmp_path."""
    al = AuditLogger(_lazy=True)
    al._log_dir = tmp_path / "logs"
    al._ensure_directory()
    return al


def _read_entries(tmp_path):
    """Read all JSONL entries from the log dir under tmp_path."""
    log_dir = tmp_path / "logs"
    entries = []
    for f in sorted(log_dir.glob("session-*.jsonl")):
        for line in f.read_text(encoding="utf-8").strip().splitlines():
            entries.append(json.loads(line))
    return entries


# ─── Test 5.1: log() creates directory and writes valid JSONL line ──────────


class TestLogCreatesDirectoryAndWritesJSONL:
    """5.1: AuditLogger.log() creates directory and writes valid JSONL line."""

    @pytest.mark.asyncio
    async def test_log_creates_directory_and_writes_jsonl(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="test-session",
            user_prompt="list files",
            classified_command="ls -la",
            tool_used="execute_cli",
            execution_result="success",
            voice_message="Listed files.",
            duration_ms=50,
        )

        log_dir = tmp_path / "logs"
        assert log_dir.exists()
        log_files = list(log_dir.glob("session-*.jsonl"))
        assert len(log_files) == 1
        content = log_files[0].read_text(encoding="utf-8").strip()
        entry = json.loads(content)
        assert entry["session_id"] == "test-session"
        assert entry["user_prompt"] == "list files"

    @pytest.mark.asyncio
    async def test_multiple_logs_append_to_same_file(self, tmp_path, audit_logger):
        for i in range(3):
            await audit_logger.log(
                session_id="s1",
                user_prompt=f"cmd {i}",
                classified_command=f"echo {i}",
                tool_used="execute_cli",
                execution_result="success",
            )

        entries = _read_entries(tmp_path)
        assert len(entries) == 3


# ─── Test 5.2: Log entry contains all required schema fields ────────────────


class TestLogEntryContainsAllFields:
    """5.2: Log entry contains all required schema fields."""

    @pytest.mark.asyncio
    async def test_all_required_fields_present(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="abc-123",
            user_prompt="restart container",
            classified_command="docker restart user-auth",
            tool_used="host_subprocess",
            execution_result="success",
            voice_message="Done.",
            duration_ms=1240,
        )

        entries = _read_entries(tmp_path)
        entry = entries[0]
        required_fields = [
            "timestamp", "session_id", "user_prompt", "classified_command",
            "tool_used", "execution_result", "voice_message", "duration_ms",
        ]
        for field in required_fields:
            assert field in entry, f"Missing required field: {field}"

    @pytest.mark.asyncio
    async def test_field_values_match_input(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="abc-123",
            user_prompt="restart container",
            classified_command="docker restart user-auth",
            tool_used="host_subprocess",
            execution_result="success",
            voice_message="Done.",
            duration_ms=1240,
        )

        entry = _read_entries(tmp_path)[0]
        assert entry["session_id"] == "abc-123"
        assert entry["user_prompt"] == "restart container"
        assert entry["classified_command"] == "docker restart user-auth"
        assert entry["tool_used"] == "host_subprocess"
        assert entry["execution_result"] == "success"
        assert entry["voice_message"] == "Done."
        assert entry["duration_ms"] == 1240

    @pytest.mark.asyncio
    async def test_timestamp_is_iso8601(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="s1",
            user_prompt="test",
            classified_command="echo",
            tool_used="execute_cli",
            execution_result="success",
        )

        entry = _read_entries(tmp_path)[0]
        # ISO 8601 pattern check
        assert re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", entry["timestamp"])


# ─── Test 5.3: Daily file rotation (date in filename) ───────────────────────


class TestDailyFileRotation:
    """5.3: Daily file rotation (date in filename)."""

    @pytest.mark.asyncio
    async def test_log_file_contains_date_in_name(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="s1",
            user_prompt="test",
            classified_command="echo hi",
            tool_used="execute_cli",
            execution_result="success",
        )

        log_files = list((tmp_path / "logs").glob("session-*.jsonl"))
        assert len(log_files) == 1
        assert re.match(r"session-\d{4}-\d{2}-\d{2}\.jsonl", log_files[0].name)

    @pytest.mark.asyncio
    async def test_different_dates_create_different_files(self, tmp_path, audit_logger):
        """Simulate date change by patching datetime."""
        from datetime import datetime as real_datetime

        class FakeDate1(real_datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime(2026, 3, 15, tzinfo=tz)

        class FakeDate2(real_datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime(2026, 3, 16, tzinfo=tz)

        with patch("core.audit_logger.datetime", FakeDate1):
            await audit_logger.log(
                session_id="s1",
                user_prompt="day1",
                classified_command="cmd1",
                tool_used="execute_cli",
                execution_result="success",
            )

        with patch("core.audit_logger.datetime", FakeDate2):
            await audit_logger.log(
                session_id="s1",
                user_prompt="day2",
                classified_command="cmd2",
                tool_used="execute_cli",
                execution_result="success",
            )

        log_files = sorted((tmp_path / "logs").glob("session-*.jsonl"))
        assert len(log_files) == 2
        assert "2026-03-15" in log_files[0].name
        assert "2026-03-16" in log_files[1].name


# ─── Test 5.4: Write errors are caught and logged, not raised ────────────────


class TestWriteErrorsCaughtNotRaised:
    """5.4: Write errors are caught and logged, not raised."""

    @pytest.mark.asyncio
    async def test_write_error_does_not_raise(self, tmp_path, audit_logger):
        with patch("builtins.open", side_effect=PermissionError("No permission")):
            # Must NOT raise - fire-and-forget
            await audit_logger.log(
                session_id="s1",
                user_prompt="test",
                classified_command="cmd",
                tool_used="execute_cli",
                execution_result="error",
            )

    @pytest.mark.asyncio
    async def test_write_error_is_logged(self, tmp_path, audit_logger, caplog):
        import logging

        with caplog.at_level(logging.ERROR, logger="core.audit_logger"):
            with patch("builtins.open", side_effect=OSError("Disk full")):
                await audit_logger.log(
                    session_id="s1",
                    user_prompt="test",
                    classified_command="cmd",
                    tool_used="execute_cli",
                    execution_result="error",
                )

        assert "Audit log write failed" in caplog.text


# ─── Test 5.5: Session start/end events produce correct entries ──────────────


class TestSessionStartEndEvents:
    """5.5: Session start/end events produce correct entries."""

    @pytest.mark.asyncio
    async def test_session_start_event(self, tmp_path, audit_logger):
        await audit_logger.log_session_start(session_id="sess-1")

        entry = _read_entries(tmp_path)[0]
        assert entry["execution_result"] == "session_start"
        assert entry["tool_used"] == "session_lifecycle"
        assert entry["session_id"] == "sess-1"
        assert entry["voice_message"] == "session_start"

    @pytest.mark.asyncio
    async def test_session_end_event(self, tmp_path, audit_logger):
        await audit_logger.log_session_end(
            session_id="sess-1", total_steps=5, duration_ms=3000,
        )

        entry = _read_entries(tmp_path)[0]
        assert entry["execution_result"] == "session_end"
        assert entry["duration_ms"] == 3000
        assert entry["classified_command"] == ""
        assert "total_steps=5" in entry["voice_message"]


# ─── Test 5.6: Confirmation outcomes appear correctly in execution_result ────


class TestConfirmationOutcomes:
    """5.6: Confirmation outcomes (user_cancelled, force_host) appear correctly."""

    @pytest.mark.asyncio
    async def test_user_cancelled_outcome(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="s1",
            user_prompt="rm -rf /tmp/test",
            classified_command="rm -rf /tmp/test",
            tool_used="execute_cli",
            execution_result="user_cancelled",
        )

        entry = _read_entries(tmp_path)[0]
        assert entry["execution_result"] == "user_cancelled"

    @pytest.mark.asyncio
    async def test_force_host_outcome(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="s1",
            user_prompt="dangerous command",
            classified_command="rm -rf /var/log",
            tool_used="execute_cli",
            execution_result="force_host",
        )

        entry = _read_entries(tmp_path)[0]
        assert entry["execution_result"] == "force_host"

    @pytest.mark.asyncio
    async def test_sandboxed_outcome(self, tmp_path, audit_logger):
        await audit_logger.log(
            session_id="s1",
            user_prompt="install package",
            classified_command="pip install malware",
            tool_used="execute_cli",
            execution_result="sandboxed",
        )

        entry = _read_entries(tmp_path)[0]
        assert entry["execution_result"] == "sandboxed"
