"""
Local JSONL audit logger — append-only, fire-and-forget audit trail.

Logs every AI tool execution to ~/.contop/logs/session-{YYYY-MM-DD}.jsonl
as a single JSON object per line. Write failures are caught and logged
via Python's logging module — they never raise or block the execution pipeline.

[Source: architecture.md#Data-Architecture—Audit-Log]
[Source: project-context.md#JSONL-Auditing]
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class AuditLogger:
    """Append-only JSONL audit logger for tool executions.

    One file per calendar day: session-{YYYY-MM-DD}.jsonl
    All writes are fire-and-forget — errors logged, never raised.
    """

    def __init__(self, *, _lazy: bool = False) -> None:
        self._log_dir: Path | None = None
        if not _lazy:
            self._init_log_dir()

    def _init_log_dir(self) -> None:
        """Resolve and create the log directory on first use."""
        if self._log_dir is not None:
            return
        self._log_dir = Path.home() / ".contop" / "logs"
        self._ensure_directory()

    def _resolve_log_path(self) -> Path:
        """Return path to today's JSONL log file."""
        self._init_log_dir()
        assert self._log_dir is not None
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return self._log_dir / f"session-{date_str}.jsonl"

    def _ensure_directory(self) -> None:
        """Create ~/.contop/logs/ if it doesn't exist."""
        if self._log_dir is None:
            return
        try:
            self._log_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            logger.exception("Failed to create audit log directory: %s", self._log_dir)

    async def log(
        self,
        *,
        session_id: str,
        user_prompt: str,
        classified_command: str,
        tool_used: str,
        execution_result: str,
        voice_message: str = "",
        duration_ms: int = 0,
    ) -> None:
        """Append a single audit entry as one JSON line.

        Fire-and-forget: all errors caught and logged, never raised.
        """
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "user_prompt": user_prompt,
            "classified_command": classified_command,
            "tool_used": tool_used,
            "execution_result": execution_result,
            "voice_message": voice_message,
            "duration_ms": duration_ms,
        }
        try:
            path = self._resolve_log_path()
            line = json.dumps(entry) + "\n"
            await asyncio.to_thread(self._write_line, path, line)
        except Exception:
            logger.exception("Audit log write failed")

    @staticmethod
    def _write_line(path: Path, line: str) -> None:
        """Synchronous file append — run via asyncio.to_thread."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(line)

    async def log_session_start(self, *, session_id: str) -> None:
        """Log a session start event."""
        await self.log(
            session_id=session_id,
            user_prompt="",
            classified_command="",
            tool_used="session_lifecycle",
            execution_result="session_start",
            voice_message="session_start",
        )

    async def log_session_end(
        self, *, session_id: str, total_steps: int = 0, duration_ms: int = 0
    ) -> None:
        """Log a session end event with summary stats."""
        await self.log(
            session_id=session_id,
            user_prompt="",
            classified_command="",
            tool_used="session_lifecycle",
            execution_result="session_end",
            voice_message=f"total_steps={total_steps}",
            duration_ms=duration_ms,
        )


# Module-level singleton (Task 1.1) — lazy init to avoid
# creating directories at import time (test isolation).
audit_logger = AuditLogger(_lazy=True)
