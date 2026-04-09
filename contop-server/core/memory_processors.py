"""
Memory processors - context management for the execution agent.

TokenLimiter: Caps total context tokens by summarizing old tool results.
ToolCallFilter: Strips verbose fields from non-recent tool results.

Used by ExecutionAgent._before_model_callback() to manage context size.
"""
import logging

logger = logging.getLogger(__name__)

# Rough token estimation: chars / 4 (avoids importing a tokenizer dependency)
_CHARS_PER_TOKEN = 4

# Fields to strip from old tool results
_VERBOSE_FIELDS = {"image_b64", "raw_image_b64", "ui_elements"}

# Maximum stdout/stderr length to keep in old tool results
_MAX_STDOUT_LEN = 400


class ToolCallFilter:
    """Strip verbose fields from non-recent tool results.

    Keeps the N most recent tool results fully intact. For older results:
    - Removes image_b64, raw_image_b64, ui_elements fields
    - Truncates long stdout to first 200 + last 200 chars
    """

    def __init__(self, keep_recent: int = 3):
        self.keep_recent = keep_recent

    def process(self, contents: list) -> list:
        """Process LLM request contents, stripping verbose fields from old results."""
        if not contents:
            return contents

        # Find all function response indices (newest last)
        fr_indices = []
        for ci, content in enumerate(contents):
            if not content or not content.parts:
                continue
            for part in content.parts:
                if part.function_response:
                    fr_indices.append((ci, part))

        if len(fr_indices) <= self.keep_recent:
            return contents  # Nothing to strip

        # Strip verbose fields from old results (all except the most recent N)
        old_results = fr_indices[:-self.keep_recent]
        stripped = 0
        for _ci, part in old_results:
            resp = part.function_response.response
            if not isinstance(resp, dict):
                continue

            for field in _VERBOSE_FIELDS:
                if field in resp:
                    resp.pop(field)
                    stripped += 1

            # Truncate long stdout/stderr
            for key in ("stdout", "stderr"):
                val = resp.get(key)
                if isinstance(val, str) and len(val) > _MAX_STDOUT_LEN:
                    half = _MAX_STDOUT_LEN // 2
                    resp[key] = val[:half] + "\n...[truncated]...\n" + val[-half:]
                    stripped += 1

        if stripped:
            logger.info("ToolCallFilter: stripped %d verbose fields from %d old results", stripped, len(old_results))

        return contents


class TokenLimiter:
    """Cap total context tokens by summarizing old tool results.

    Uses character-based estimation (chars/4) - not precise but avoids
    importing a tokenizer dependency. When total tokens exceed the threshold,
    old tool results (beyond the N most recent) are replaced with 1-line summaries.
    """

    def __init__(self, max_tokens: int = 100_000, keep_recent: int = 5):
        self.max_tokens = max_tokens
        self.keep_recent = keep_recent

    def _estimate_tokens(self, contents: list) -> int:
        """Estimate total tokens across all content parts."""
        total_chars = 0
        for content in contents:
            if not content or not content.parts:
                continue
            for part in content.parts:
                if part.text:
                    total_chars += len(part.text)
                elif part.function_response and isinstance(part.function_response.response, dict):
                    total_chars += len(str(part.function_response.response))
                elif part.function_call:
                    total_chars += len(str(part.function_call.args or {}))
        return total_chars // _CHARS_PER_TOKEN

    def process(self, contents: list) -> list:
        """Process LLM request contents, summarizing old results if over token limit."""
        if not contents:
            return contents

        estimated = self._estimate_tokens(contents)
        if estimated <= self.max_tokens:
            return contents

        logger.info(
            "TokenLimiter: estimated %d tokens exceeds limit %d - truncating old results",
            estimated, self.max_tokens,
        )

        # Find all function response parts (newest last)
        fr_parts = []
        for ci, content in enumerate(contents):
            if not content or not content.parts:
                continue
            for part in content.parts:
                if part.function_response:
                    fr_parts.append((ci, part))

        if len(fr_parts) <= self.keep_recent:
            return contents  # Can't truncate further

        # Summarize old results
        old_results = fr_parts[:-self.keep_recent]
        truncated = 0
        for _ci, part in old_results:
            resp = part.function_response.response
            if not isinstance(resp, dict):
                continue

            status = resp.get("status", "unknown")
            duration = resp.get("duration_ms", "?")
            tool_name = part.function_response.name or "unknown"

            # Replace with summary
            part.function_response.response = {
                "status": status,
                "summary": f"[Tool result truncated - {tool_name} returned {status} in {duration}ms]",
            }
            truncated += 1

        if truncated:
            new_estimated = self._estimate_tokens(contents)
            logger.info(
                "TokenLimiter: truncated %d old results. Tokens: %d → %d",
                truncated, estimated, new_estimated,
            )

        return contents
