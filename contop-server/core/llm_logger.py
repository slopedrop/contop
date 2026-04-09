"""
LLM Call Logger - human-readable log of every model call (API mode).

Logs the full input (system prompt, messages, tool calls) and output
(response text, tool calls, thinking) for every LLM invocation made
by the execution agent.

One file per session: llm-api-{sessionId8}-{timestamp}.log
Stored in ~/.contop/logs/

Instance-based: each ExecutionAgent creates its own LlmLogger to avoid
cross-session corruption when multiple agents run concurrently.

[Source: project-context.md - JSONL-Auditing]
"""

import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

LOG_DIR = Path.home() / ".contop" / "logs"

SEP = "═" * 80
THIN_SEP = "─" * 80


class LlmLogger:
    """Per-session LLM call logger. Each ExecutionAgent holds its own instance."""

    def __init__(self) -> None:
        self._log_path: Path | None = None
        self._turn_counter: int = 0

    def init(self, *, session_id: str, model: str) -> None:
        """Initialize the logger for a new session. Writes the header block."""
        self._turn_counter = 0

        LOG_DIR.mkdir(parents=True, exist_ok=True)

        short = session_id[:8]
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        self._log_path = LOG_DIR / f"llm-api-{short}-{ts}.log"

        header = (
            f"{SEP}\n"
            f"  LLM CALL LOG - API MODE\n"
            f"{SEP}\n"
            f"  Session ID : {session_id}\n"
            f"  Model      : {model}\n"
            f"  Started    : {datetime.now(timezone.utc).isoformat()}\n"
            f"{SEP}\n\n"
        )
        self._write(header, overwrite=True)

    def log_input(
        self,
        *,
        model: str,
        system_prompt_preview: str,
        messages: list[dict],
    ) -> None:
        """Log the full input sent to the LLM.

        `messages` should be a list of dicts with keys:
            role, text, (optional) tool_name, (optional) tool_args
        """
        self._turn_counter += 1

        lines = [
            f"{SEP}",
            f"  TURN {self._turn_counter} - LLM INPUT",
            f"{SEP}",
            f"  Time       : {datetime.now(timezone.utc).isoformat()}",
            f"  Model      : {model}",
            f"{THIN_SEP}",
            f"  SYSTEM PROMPT (first 500 chars):",
            f"{THIN_SEP}",
            f"{system_prompt_preview[:500]}",
            f"{THIN_SEP}",
            f"  MESSAGES ({len(messages)} parts):",
            f"{THIN_SEP}",
        ]

        for i, msg in enumerate(messages):
            role = msg.get("role", "?").upper()
            lines.append(f"  [{i + 1}] {role}:")

            if msg.get("tool_name"):
                lines.append(f"      Tool: {msg['tool_name']}")
                if msg.get("tool_args"):
                    args = msg["tool_args"]
                    if isinstance(args, dict):
                        for k, v in args.items():
                            display = v if isinstance(v, str) else _safe_repr(v)
                            if len(str(display)) > 300:
                                display = str(display)[:300] + "...[truncated]"
                            lines.append(f"      {k}: {display}")
                    else:
                        lines.append(f"      Args: {_safe_repr(args)}")
                if msg.get("tool_result"):
                    result_str = msg["tool_result"]
                    if isinstance(result_str, dict):
                        for k, v in result_str.items():
                            display = v if isinstance(v, str) else _safe_repr(v)
                            if len(str(display)) > 500:
                                display = str(display)[:500] + "...[truncated]"
                            lines.append(f"      {k}: {display}")
                    elif isinstance(result_str, str) and len(result_str) > 500:
                        lines.append(f"      Result: {result_str[:500]}...[truncated]")
                    else:
                        lines.append(f"      Result: {result_str}")
            elif msg.get("text"):
                text = msg["text"]
                if len(text) > 1000:
                    lines.append(f"  {text[:1000]}...[truncated, {len(text)} chars total]")
                else:
                    lines.append(f"  {text}")

            lines.append("")

        lines.append(THIN_SEP)
        self._write("\n".join(lines) + "\n")

    def log_output(
        self,
        *,
        text: str = "",
        tool_calls: list[dict] | None = None,
        thinking: str = "",
        duration_ms: int = 0,
    ) -> None:
        """Log the LLM response output.

        `tool_calls` should be a list of dicts with keys: name, args (dict)
        """
        lines = [
            f"  OUTPUT (response from model):",
            f"{THIN_SEP}",
        ]

        if thinking:
            lines.append(f"  THINKING:")
            if len(thinking) > 1000:
                lines.append(f"  {thinking[:1000]}...[truncated, {len(thinking)} chars total]")
            else:
                lines.append(f"  {thinking}")
            lines.append(THIN_SEP)

        if text:
            lines.append(text)
        elif not tool_calls:
            lines.append("  (empty response)")

        if tool_calls:
            lines.append(f"{THIN_SEP}")
            lines.append(f"  TOOL CALLS:")
            lines.append(f"{THIN_SEP}")
            for tc in tool_calls:
                lines.append(f"  → {tc.get('name', '?')}")
                args = tc.get("args", {})
                if isinstance(args, dict):
                    for k, v in args.items():
                        display = v if isinstance(v, str) else _safe_repr(v)
                        if len(str(display)) > 300:
                            display = str(display)[:300] + "...[truncated]"
                        lines.append(f"    {k}: {display}")
                else:
                    lines.append(f"    Args: {_safe_repr(args)}")

        lines.append(THIN_SEP)
        lines.append(f"  Duration   : {duration_ms}ms")
        lines.append(f"{SEP}\n")
        self._write("\n".join(lines) + "\n")

    def log_final_result(
        self,
        *,
        answer: str,
        steps_taken: int = 0,
        duration_ms: int = 0,
        model: str = "",
        error_code: str = "",
    ) -> None:
        """Log the final agent_result sent to the user."""
        lines = [
            f"{SEP}",
            f"  FINAL RESULT (shown to user)",
            f"{SEP}",
            f"  Time       : {datetime.now(timezone.utc).isoformat()}",
            f"  Model      : {model}",
            f"  Steps      : {steps_taken}",
            f"  Duration   : {duration_ms}ms",
        ]
        if error_code:
            lines.append(f"  Error      : {error_code}")
        lines.append(THIN_SEP)
        lines.append(answer)
        lines.append(f"{SEP}\n")
        self._write("\n".join(lines) + "\n")

    @property
    def turn_count(self) -> int:
        return self._turn_counter

    def _write(self, content: str, *, overwrite: bool = False) -> None:
        if self._log_path is None:
            return
        try:
            mode = "w" if overwrite else "a"
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._log_path, mode, encoding="utf-8") as f:
                f.write(content)
        except Exception:
            logger.debug("LLM log write failed", exc_info=True)


def _safe_repr(obj) -> str:
    """Return a string representation that doesn't blow up."""
    try:
        import json
        return json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return repr(obj)
