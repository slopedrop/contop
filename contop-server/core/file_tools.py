"""
File tools — structured file operations for the execution agent.

Provides read_file, edit_file, and find_files as ADK FunctionTools.
These replace ad-hoc CLI workarounds (type, dir /s, sed) with reliable,
cross-platform, token-efficient alternatives.

All tools follow the standard async pattern: async def, dict return with
status field, logger.info at entry, try/except with logger.exception.
"""
import asyncio
import logging
import os
import re
import tempfile
import time as _time
from pathlib import Path

logger = logging.getLogger(__name__)

# Track which files have been read (edit_file requires a prior read).
# Bounded to prevent unbounded growth in long-running sessions.
_MAX_READ_CACHE = 500
_files_read: set[str] = set()

# Directories to skip during find_files searches
_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache"}

MAX_LINE_LENGTH = 2000
FIND_TIMEOUT_S = 20


async def read_file(file_path: str, offset: int = 0, limit: int = 200) -> dict:
    """Read a text file and return its content with line numbers.

    Args:
        file_path: Absolute path to the file.
        offset: Zero-based line offset to start reading from.
        limit: Maximum number of lines to return.

    Returns dict with status, content, total_lines, lines_shown, truncated.
    For image files (.png, .jpg, .gif, .webp), returns image_b64 and mime_type.
    """
    logger.info("read_file called: file_path=%s, offset=%d, limit=%d", file_path, offset, limit)
    start = _time.monotonic()
    try:
        p = Path(file_path)

        # Image files: return base64-encoded content
        image_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff"}
        if p.suffix.lower() in image_exts:
            import base64
            data = await asyncio.to_thread(p.read_bytes)
            mime_map = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
                ".tiff": "image/tiff",
            }
            if len(_files_read) >= _MAX_READ_CACHE:
                _files_read.pop()
            _files_read.add(str(p.resolve()))
            return {
                "status": "success",
                "image_b64": base64.b64encode(data).decode(),
                "mime_type": mime_map.get(p.suffix.lower(), "application/octet-stream"),
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

        # Text files
        raw = await asyncio.to_thread(p.read_text, "utf-8", "replace")
        lines = raw.splitlines()
        total = len(lines)

        # Apply offset and limit
        selected = lines[offset:offset + limit]
        truncated = (offset + limit) < total

        # Format with line numbers, truncate long lines
        formatted_lines = []
        for i, line in enumerate(selected, start=offset + 1):
            if len(line) > MAX_LINE_LENGTH:
                line = line[:MAX_LINE_LENGTH] + "...[truncated]"
            formatted_lines.append(f"{i:>6}\t{line}")
        content = "\n".join(formatted_lines)

        _files_read.add(str(p.resolve()))

        if total == 0:
            return {
                "status": "success",
                "content": "",
                "total_lines": 0,
                "lines_shown": 0,
                "truncated": False,
                "note": "File exists but is empty",
                "duration_ms": int((_time.monotonic() - start) * 1000),
            }

        return {
            "status": "success",
            "content": content,
            "total_lines": total,
            "lines_shown": len(selected),
            "truncated": truncated,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except FileNotFoundError:
        return {
            "status": "error",
            "description": f"File not found: {file_path}",
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": f"I couldn't find the file {Path(file_path).name}.",
        }
    except Exception as exc:
        logger.exception("read_file failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I had trouble reading that file.",
        }


async def edit_file(
    file_path: str, old_string: str, new_string: str, replace_all: bool = False
) -> dict:
    """Edit a file by replacing an exact string match.

    The file must have been read via read_file first. Fails if old_string
    is not found or is ambiguous (unless replace_all=True).

    Args:
        file_path: Absolute path to the file.
        old_string: The text to replace.
        new_string: The replacement text.
        replace_all: If True, replace all occurrences.

    Returns dict with status, replacements, file_path.
    """
    logger.info("edit_file called: file_path=%s, replace_all=%s", file_path, replace_all)
    start = _time.monotonic()
    try:
        p = Path(file_path)
        resolved = str(p.resolve())

        if resolved not in _files_read:
            return {
                "status": "error",
                "description": "You must read_file before editing. Call read_file first.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "I need to read the file before editing it.",
            }

        if old_string == new_string:
            return {
                "status": "error",
                "description": "old_string and new_string are identical.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "The old and new text are the same — nothing to change.",
            }

        content = await asyncio.to_thread(p.read_text, "utf-8", "replace")

        count = content.count(old_string)
        if count == 0:
            return {
                "status": "error",
                "description": f"old_string not found in {file_path}.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "I couldn't find the text to replace.",
            }

        if count > 1 and not replace_all:
            return {
                "status": "error",
                "description": f"old_string found {count} times. Use replace_all=True or provide more context to make it unique.",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": f"The text appears {count} times. Provide more context or use replace all.",
            }

        if replace_all:
            new_content = content.replace(old_string, new_string)
        else:
            new_content = content.replace(old_string, new_string, 1)

        # Atomic write: use unpredictable temp file in same dir, then rename
        def _atomic_write():
            fd, tmp_name = tempfile.mkstemp(dir=str(p.parent), suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(new_content)
                Path(tmp_name).replace(p)
            except Exception:
                os.unlink(tmp_name)
                raise
        await asyncio.to_thread(_atomic_write)

        return {
            "status": "success",
            "replacements": count if replace_all else 1,
            "file_path": file_path,
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except Exception as exc:
        logger.exception("edit_file failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I had trouble editing the file.",
        }


async def find_files(
    pattern: str = "",
    search_text: str = "",
    path: str = "",
    max_results: int = 50,
) -> dict:
    """Find files by glob pattern and/or content search.

    Args:
        pattern: Glob pattern for filenames (e.g., "*.py", "**/*.ts").
        search_text: Regex to search within file contents.
        path: Directory to search in. Defaults to home directory.
        max_results: Maximum number of results to return.

    Returns dict with status, matches, total, truncated.
    """
    logger.info(
        "find_files called: pattern=%s, search_text=%s, path=%s",
        pattern, search_text, path,
    )
    start = _time.monotonic()

    if not pattern and not search_text:
        return {
            "status": "error",
            "description": "Provide at least one of: pattern (filename glob) or search_text (content regex).",
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I need a pattern or search text to find files.",
        }

    try:
        search_dir = Path(path) if path else Path.home()
        if not search_dir.exists():
            return {
                "status": "error",
                "description": f"Directory not found: {search_dir}",
                "duration_ms": int((_time.monotonic() - start) * 1000),
                "voice_message": "The search directory doesn't exist.",
            }

        # Pre-compile regex to catch invalid patterns early and avoid ReDoS
        compiled_re = None
        if search_text:
            try:
                compiled_re = re.compile(search_text)
            except re.error as e:
                return {
                    "status": "error",
                    "description": f"Invalid regex pattern: {e}",
                    "duration_ms": int((_time.monotonic() - start) * 1000),
                    "voice_message": "The search pattern is not valid.",
                }

        def _search():
            matches = []
            file_iter = search_dir.rglob(pattern) if pattern else search_dir.rglob("*")

            # Use manual iteration so PermissionError on inaccessible dirs
            # (e.g. System Volume Information, $Recycle.Bin) skips instead of crashing
            while True:
                if len(matches) >= max_results:
                    break
                try:
                    fp = next(file_iter)
                except StopIteration:
                    break
                except (PermissionError, OSError):
                    continue

                # Skip hidden/build directories
                try:
                    parts = fp.relative_to(search_dir).parts
                except ValueError:
                    parts = fp.parts
                if any(p in _SKIP_DIRS for p in parts):
                    continue
                if not fp.is_file():
                    continue

                if compiled_re:
                    # Content search — skip binary files
                    try:
                        text = fp.read_text("utf-8", errors="ignore")
                        for line_num, line in enumerate(text.splitlines(), 1):
                            if compiled_re.search(line):
                                matches.append({
                                    "path": str(fp),
                                    "line": line_num,
                                    "content": line.strip()[:200],
                                })
                                if len(matches) >= max_results:
                                    break
                    except (OSError, UnicodeDecodeError):
                        continue
                else:
                    matches.append({"path": str(fp)})

            return matches

        matches = await asyncio.wait_for(
            asyncio.to_thread(_search),
            timeout=FIND_TIMEOUT_S,
        )

        return {
            "status": "success",
            "matches": matches,
            "total": len(matches),
            "truncated": len(matches) >= max_results,
            "searched_dir": str(search_dir),
            "duration_ms": int((_time.monotonic() - start) * 1000),
        }
    except asyncio.TimeoutError:
        return {
            "status": "error",
            "description": f"Search timed out after {FIND_TIMEOUT_S}s. Try a narrower path or pattern.",
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "The file search timed out. Try narrowing your search.",
        }
    except Exception as exc:
        logger.exception("find_files failed")
        return {
            "status": "error",
            "description": str(exc),
            "duration_ms": int((_time.monotonic() - start) * 1000),
            "voice_message": "I had trouble searching for files.",
        }
