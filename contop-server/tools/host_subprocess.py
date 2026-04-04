"""
Host subprocess execution — the "safe route" for CLI commands.

Executes shell commands classified as "host" by the DualToolEvaluator.
Provides async execution with timeout enforcement, output truncation,
cancellation support, environment sanitization, and interactive prompt
handling (auto-responds to common confirmation prompts, detects stalls
from unexpected input requests).

[Source: architecture.md — Execution Routing Decision, tools/host_subprocess.py is FR12]
[Source: project-context.md — Mandatory Dual-Tool Gate, Error Handling]
"""
import asyncio
import logging
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Bash discovery (Windows) ─────────────────────────────────────────────────

_cached_bash_path: str | None = None
_bash_discovery_done = False


def _discover_bash() -> str | None:
    """Find Git Bash on Windows. Returns cached path or None.

    Skips WSL bash (System32\\bash.exe) which is fundamentally
    incompatible (different filesystem, PATH, env model).
    """
    global _cached_bash_path, _bash_discovery_done
    if _bash_discovery_done:
        return _cached_bash_path
    _bash_discovery_done = True

    if sys.platform != "win32":
        return None  # Unix uses /bin/sh by default

    # 1. Bundled path (set by Tauri desktop app)
    bundled = os.environ.get("CONTOP_BASH_PATH")
    if bundled and os.path.isabs(bundled) and os.path.isfile(bundled):
        _cached_bash_path = bundled
        logger.info("Using bundled bash: %s", bundled)
        return _cached_bash_path

    # 2. Common Git for Windows install locations
    candidates = [
        os.path.join(os.environ.get("PROGRAMFILES", ""), "Git", "bin", "bash.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "Git", "bin", "bash.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Git", "bin", "bash.exe"),
        os.path.join(os.environ.get("USERPROFILE", ""), "scoop", "apps", "git", "current", "bin", "bash.exe"),
    ]
    for c in candidates:
        if c and os.path.isabs(c) and os.path.isfile(c):
            _cached_bash_path = c
            logger.info("Found Git Bash at: %s", c)
            return _cached_bash_path

    # 3. PATH lookup (skip WSL bash)
    found = shutil.which("bash")
    if found:
        # Guard: System32\bash.exe is the WSL launcher, NOT Git Bash
        if "system32" not in found.lower():
            _cached_bash_path = found
            logger.info("Found bash on PATH: %s", found)
            return _cached_bash_path
        else:
            logger.info("Skipping WSL bash at %s", found)

    logger.warning("Git Bash not found — falling back to cmd.exe")
    return None


# ── Env sanitization (allowlist approach) ────────────────────────────────────
# Instead of denylisting sensitive patterns (which misses many vars), we use
# an explicit allowlist of environment variables needed for command execution.
# Only vars present in this set AND in os.environ are copied to the subprocess.

_ENV_ALLOWLIST = frozenset({
    # Core POSIX / cross-platform
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG",
    "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP",
    # Windows-specific
    "COMSPEC", "PATHEXT", "SYSTEMROOT", "WINDIR", "HOMEDRIVE", "HOMEPATH",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA",
    # MSYS / Git Bash (Windows)
    "MSYSTEM", "MSYS_NO_PATHCONV", "MINGW_PREFIX",
    # Linux desktop
    "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
    "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
    # Terminal / color support
    "COLORTERM", "TERM_PROGRAM", "LS_COLORS",
})

DEFAULT_TIMEOUT_S = 30
DEFAULT_MAX_OUTPUT_BYTES = 51200  # 50 KB
TRUNCATION_MARKER = "\n[truncated]"

# ── Interactive prompt detection ─────────────────────────────────────────────

# Seconds with no output before we assume the process is waiting for input.
STALL_TIMEOUT_S = 5.0

# Patterns that indicate the process is asking for confirmation.
# Each tuple: (compiled regex, response bytes to write to stdin)
_PROMPT_PATTERNS: list[tuple[re.Pattern, bytes]] = [
    # Y/n or y/N style (apt, brew, pacman, etc.)
    # Case-sensitive so [Y/n] (default=yes) and [y/N] (default=no) are distinct
    (re.compile(r"\[Y/n\]\s*$"), b"Y\n"),
    (re.compile(r"\[y/N\]\s*$"), b"y\n"),
    (re.compile(r"\(y/n\)\s*[?:]?\s*$", re.IGNORECASE), b"y\n"),
    (re.compile(r"\(yes/no\)\s*[?:]?\s*$", re.IGNORECASE), b"yes\n"),
    # "Do you want to continue?" / "Are you sure?" without specific brackets
    (re.compile(r"Do you (?:want|wish) to continue\??\s*$", re.IGNORECASE), b"y\n"),
    (re.compile(r"Are you sure\??\s*$", re.IGNORECASE), b"y\n"),
    (re.compile(r"Continue\?\s*$", re.IGNORECASE), b"y\n"),
    # "Press Enter to continue" / "Press any key"
    (re.compile(r"Press (?:Enter|ENTER|any key|RETURN)\b.*$", re.IGNORECASE), b"\n"),
    # npm "Ok to proceed?" / "proceed? (y)"
    (re.compile(r"Ok to proceed\?\s*\(y\)\s*$", re.IGNORECASE), b"y\n"),
    (re.compile(r"proceed\?\s*\(y(?:/N)?\)\s*$", re.IGNORECASE), b"y\n"),
    # pip "Proceed (Y/n)?"
    (re.compile(r"Proceed\s*\(Y/n\)\s*[?:]?\s*$", re.IGNORECASE), b"Y\n"),
    # git "Type 'yes' to confirm"
    (re.compile(r"type\s+'?yes'?\s+to\s+confirm", re.IGNORECASE), b"yes\n"),
    # Overwrite file prompts
    (re.compile(r"overwrite\s+.*\?\s*\[y/N\]\s*$", re.IGNORECASE), b"y\n"),
    (re.compile(r"already exists.*overwrite\??\s*$", re.IGNORECASE), b"y\n"),
]

# Patterns that indicate an interactive editor or pager — these cannot be
# auto-handled; close stdin immediately so the process falls back or exits.
_EDITOR_PATTERNS: list[re.Pattern] = [
    re.compile(r"~\s*$"),  # vim empty-line markers
    re.compile(r"^:$", re.MULTILINE),  # vim command mode
    re.compile(r"\(END\)\s*$"),  # less/more pager
    re.compile(r"--More--\s*$"),  # more pager
    re.compile(r"lines \d+-\d+/\d+"),  # less-style line counter
]


def _match_prompt(text: str) -> bytes | None:
    """Check the tail of accumulated output for a known prompt.

    Returns the response bytes to write, or None if no match.
    """
    # Only check the last 200 chars (prompts appear at the end of output)
    tail = text[-200:] if len(text) > 200 else text
    for pattern, response in _PROMPT_PATTERNS:
        if pattern.search(tail):
            return response
    return None


def _match_editor(text: str) -> bool:
    """Detect if the output suggests an interactive editor or pager is open."""
    tail = text[-200:] if len(text) > 200 else text
    return any(p.search(tail) for p in _EDITOR_PATTERNS)


# ── Windows command rewriting ─────────────────────────────────────────────────

# Matches `python -c`, `python3 -c`, `python.exe -c`, etc.
_PYTHON_C_RE = re.compile(
    r"^(python[3]?(?:\.exe)?)\s+-c\s+", re.IGNORECASE
)


def _fix_windows_command(command: str, cwd: str) -> tuple[str, list[str]]:
    """Rewrite commands that would break under Windows cmd.exe.

    cmd.exe has two fundamental limitations that break LLM-generated commands:
    1. Newlines inside quoted arguments are treated as command separators.
    2. ``\\"`` is NOT a valid escape — ``"`` always toggles quoting, so
       ``python -c "print(\\"hello\\")"`` gets mangled before Python sees it.

    To avoid both issues, ``python -c`` commands are ALWAYS rewritten to a
    temp ``.py`` file.  Other multiline commands go to a temp ``.cmd`` file.

    Returns (rewritten_command, list_of_temp_files_to_cleanup).
    """
    if sys.platform != "win32":
        return command, []

    # Case 1: ALL python -c commands → temp .py file
    # This eliminates quoting, newline, and escape issues in one stroke.
    m = _PYTHON_C_RE.match(command)
    if m:
        python_exe = m.group(1)
        code = command[m.end():]
        # Strip surrounding quotes
        if len(code) >= 2 and code[0] in ('"', "'") and code[-1] == code[0]:
            code = code[1:-1]
        # Unescape \" → " (the model generates bash-style escapes that
        # cmd.exe doesn't understand, but the code needs real quotes)
        code = code.replace('\\"', '"')
        fd, py_file = tempfile.mkstemp(suffix=".py", prefix="_contop_", dir=cwd)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(code)
        logger.info("python -c → temp file: %s", Path(py_file).name)
        return f'{python_exe} "{py_file}"', [py_file]

    # Case 2: other commands with embedded newlines → temp .cmd batch file
    if "\n" in command:
        fd, cmd_file = tempfile.mkstemp(suffix=".cmd", prefix="_contop_", dir=cwd)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("@echo off\n")
            f.write(command)
            f.write("\n")
        logger.info("Multiline command → temp .cmd: %s", Path(cmd_file).name)
        return f'"{cmd_file}"', [cmd_file]

    return command, []


# ── Env / truncation / voice helpers ────────────────────────────────────────

def _sanitize_env(using_bash: bool = False) -> dict[str, str]:
    """Return an environment dict containing ONLY allowlisted variables.

    Builds the env from scratch by copying only vars present in both
    ``_ENV_ALLOWLIST`` and ``os.environ``.  This is safer than a denylist
    because any new sensitive var (e.g. ``GITHUB_TOKEN``, ``AWS_SECRET_*``)
    is excluded by default.

    When *using_bash* is True, injects ``MSYS_NO_PATHCONV=1`` to prevent
    Git Bash from auto-translating Windows paths in command arguments.
    """
    env = {key: os.environ[key] for key in _ENV_ALLOWLIST if key in os.environ}
    if using_bash:
        env["MSYS_NO_PATHCONV"] = "1"
    return env


def _truncate(text: str, max_bytes: int) -> tuple[str, bool]:
    """Truncate text to max_bytes. Returns (text, was_truncated)."""
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= max_bytes:
        return text, False
    truncated = encoded[:max_bytes].decode("utf-8", errors="replace")
    return truncated + TRUNCATION_MARKER, True


# ── Log redaction ────────────────────────────────────────────────────────────

_SECRET_REDACT_RE = re.compile(
    r"(?i)"
    r"(?:password|passwd|secret|token|api[_-]?key|auth|credential|bearer)"
    r"[\s=:\"']+\S+",
)


def _redact_for_log(text: str, max_len: int = 200) -> str:
    """Truncate *text* to *max_len* chars and redact common secret patterns."""
    truncated = text[:max_len] + ("..." if len(text) > max_len else "")
    return _SECRET_REDACT_RE.sub("[REDACTED]", truncated)


# ── Search command detection ─────────────────────────────────────────────────

# Commands that return exit code 1 to mean "no results" (not a real error).
_SEARCH_COMMANDS = re.compile(
    r"^\s*(?:dir|where|findstr|find|grep|which)\b", re.IGNORECASE
)


def _is_search_command(command: str) -> bool:
    """Check if a command is a search/lookup that uses exit code 1 for 'not found'."""
    return bool(_SEARCH_COMMANDS.search(command))


# ── Core executor ────────────────────────────────────────────────────────────

class HostSubprocess:
    """Execute shell commands asynchronously with safety controls.

    Provides timeout enforcement, output truncation, cancellation support,
    environment sanitization, and interactive prompt auto-response.
    """

    async def run(
        self,
        command: str,
        timeout_s: int = DEFAULT_TIMEOUT_S,
        max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES,
        cancel_event: Optional[asyncio.Event] = None,
        cwd: str | None = None,
        auto_confirm: bool = True,
    ) -> dict:
        """Execute a shell command and return a standardized result dict.

        Uses real-time output streaming to detect and auto-respond to
        interactive prompts. Falls back to closing stdin (EOF) when a stall
        is detected — this unblocks most programs that read from stdin.

        Args:
            command: The shell command string to execute.
            timeout_s: Maximum execution time in seconds (default 30).
            max_output_bytes: Maximum output size in bytes (default 50KB).
            cancel_event: Optional asyncio.Event — if set, the subprocess is terminated.
            cwd: Working directory for the subprocess.  When provided the
                 directory is assumed to be managed externally (e.g. session-
                 scoped) and will NOT be cleaned up.  When *None*, a fresh
                 temp directory is created per-command and removed afterwards.
            auto_confirm: When True (default), auto-respond to interactive
                 prompts with "yes". When False, close stdin (EOF) on any
                 prompt detection instead of answering — use this for
                 untrusted/sandboxed execution.

        Returns:
            dict with status, stdout, stderr, exit_code, duration_ms.
        """
        start = time.monotonic()

        # Discover bash on Windows — if found, execute through bash -c
        # instead of cmd.exe /c for better LLM command compatibility.
        bash_path = _discover_bash()
        using_bash = bash_path is not None

        env = _sanitize_env(using_bash=using_bash)

        # Use the caller-supplied working directory (session-scoped), or fall
        # back to a disposable temp directory so accidental file creation
        # doesn't pollute the project tree.
        owns_tmp_dir = cwd is None
        if owns_tmp_dir:
            cwd = tempfile.mkdtemp(prefix="contop_exec_")

        # On Windows without bash, rewrite commands that contain embedded
        # newlines so they survive cmd.exe parsing (writes temp .py / .cmd
        # files).  Bash handles these natively — skip when bash is available.
        temp_files: list[str] = []
        if not using_bash:
            command, temp_files = _fix_windows_command(command, cwd)

        proc: asyncio.subprocess.Process | None = None
        try:
            if using_bash:
                # Use create_subprocess_exec to invoke bash with -c flag
                # directly.  create_subprocess_shell(executable=bash) does
                # NOT work on Windows: CPython still constructs
                # "{COMSPEC} /c {command}" args, so bash receives "/c"
                # instead of "-c".
                proc = await asyncio.create_subprocess_exec(
                    bash_path, "-c", command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                    cwd=cwd,
                )
            else:
                proc = await asyncio.create_subprocess_shell(
                    command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                    cwd=cwd,
                )

            stdout_str, stderr_str, timed_out, was_cancelled, stall_killed = await _stream_and_interact(
                proc, timeout_s, cancel_event, auto_confirm=auto_confirm,
            )

            duration_ms = int((time.monotonic() - start) * 1000)

            if was_cancelled:
                return _build_result(
                    "cancelled", stdout_str, stderr_str, -1, duration_ms,
                    max_output_bytes, command,
                )

            if timed_out:
                return _build_result(
                    "error", stdout_str, stderr_str, -1, duration_ms,
                    max_output_bytes, command,
                )

            # Stall-killed means the process produced no output and was
            # terminated after the grace period.  For GUI app launchers
            # (e.g. `start notepad.exe`) this is expected — the app is
            # running independently.  Treat as success.
            if stall_killed:
                return _build_result(
                    "success", stdout_str, stderr_str, 0, duration_ms,
                    max_output_bytes, command,
                )

            exit_code = proc.returncode if proc.returncode is not None else -1

            # On Windows, search commands (dir, where, findstr) return exit
            # code 1 when no results are found — this is a normal "empty result",
            # not an error. Treating it as "error" confuses the LLM agent.
            if exit_code == 1 and _is_search_command(command):
                status = "success"
            else:
                status = "success" if exit_code == 0 else "error"

            return _build_result(
                status, stdout_str, stderr_str, exit_code, duration_ms,
                max_output_bytes, command,
            )

        except asyncio.CancelledError:
            if proc is not None:
                await _terminate_process(proc)
            duration_ms = int((time.monotonic() - start) * 1000)
            return _build_result(
                "cancelled", "", "", -1, duration_ms, max_output_bytes, command,
            )
        except Exception as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            logger.exception("HostSubprocess.run() failed for command: %s", _redact_for_log(command[:200]))
            return {
                "status": "error",
                "stdout": "",
                "stderr": str(exc),
                "exit_code": -1,
                "duration_ms": duration_ms,
                "voice_message": "The command failed to execute due to an internal error.",
            }
        finally:
            # Clean up temp files generated by _fix_windows_command
            for tf in temp_files:
                try:
                    os.unlink(tf)
                except OSError:
                    pass
            # Only remove the working directory if we created it (per-command temp dir)
            if owns_tmp_dir:
                shutil.rmtree(cwd, ignore_errors=True)


async def _stream_and_interact(
    proc: asyncio.subprocess.Process,
    timeout_s: int,
    cancel_event: Optional[asyncio.Event],
    *,
    auto_confirm: bool = True,
) -> tuple[str, str, bool, bool, bool]:
    """Stream stdout/stderr in real-time, auto-respond to prompts, detect stalls.

    When *auto_confirm* is False, stdin is closed (EOF) on any prompt detection
    instead of sending a yes/no response.

    Returns (stdout_str, stderr_str, timed_out, was_cancelled, stall_killed).
    """
    stdout_chunks: list[bytes] = []
    stderr_chunks: list[bytes] = []
    last_output_time = time.monotonic()
    stdin_closed = False
    prompts_answered = 0
    timed_out = False
    was_cancelled = False
    stall_killed = False  # True when stall monitor killed the process

    async def _read_stdout():
        nonlocal last_output_time, stdin_closed, prompts_answered
        assert proc.stdout is not None
        while True:
            chunk = await proc.stdout.read(4096)
            if not chunk:
                break
            stdout_chunks.append(chunk)
            last_output_time = time.monotonic()

            if stdin_closed:
                continue

            # Decode accumulated tail for prompt detection
            accumulated = b"".join(stdout_chunks)
            tail_text = accumulated[-500:].decode("utf-8", errors="replace")

            # Check for interactive editor/pager — close stdin to exit
            if _match_editor(tail_text):
                logger.info("Editor/pager detected — closing stdin to exit")
                await _close_stdin(proc)
                stdin_closed = True
                continue

            # Check for confirmation prompts
            response = _match_prompt(tail_text)
            if response is not None:
                if auto_confirm:
                    # Auto-respond to the prompt
                    try:
                        assert proc.stdin is not None
                        proc.stdin.write(response)
                        await proc.stdin.drain()
                        prompts_answered += 1
                        logger.info(
                            "Auto-responded to prompt with %r (total: %d)",
                            response.strip(), prompts_answered,
                        )
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        stdin_closed = True
                else:
                    # Not allowed to auto-confirm — close stdin (EOF)
                    logger.info(
                        "Prompt detected but auto_confirm=False — closing stdin (EOF)"
                    )
                    await _close_stdin(proc)
                    stdin_closed = True
                    continue

    async def _read_stderr():
        nonlocal last_output_time
        assert proc.stderr is not None
        while True:
            chunk = await proc.stderr.read(4096)
            if not chunk:
                break
            stderr_chunks.append(chunk)
            last_output_time = time.monotonic()

    async def _stall_monitor():
        """Close stdin if process produces no output for STALL_TIMEOUT_S.

        After closing stdin, waits a short grace period for the process to
        exit naturally.  If it doesn't (common with GUI apps launched via
        ``start``), terminates the process so we don't block until the full
        command timeout.
        """
        nonlocal stdin_closed, stall_killed
        while proc.returncode is None and not stdin_closed and not was_cancelled:
            await asyncio.sleep(1.0)
            elapsed_since_output = time.monotonic() - last_output_time
            if elapsed_since_output >= STALL_TIMEOUT_S and not stdin_closed:
                logger.info(
                    "Stall detected (%.1fs no output) — closing stdin (EOF)",
                    elapsed_since_output,
                )
                await _close_stdin(proc)
                stdin_closed = True

                # Give the process a short grace period to exit after stdin
                # closure (e.g. `start notepad.exe` should return once notepad
                # is detached).  If it doesn't exit, kill it — the GUI app is
                # already running independently.
                await asyncio.sleep(3.0)
                if proc.returncode is None:
                    logger.info(
                        "Process still running after stall+stdin close — terminating"
                    )
                    await _terminate_process(proc)
                    stall_killed = True
                break

    # Build the core I/O tasks (these finish when the process pipes close)
    read_out = asyncio.create_task(_read_stdout())
    read_err = asyncio.create_task(_read_stderr())
    stall_mon = asyncio.create_task(_stall_monitor())

    io_tasks: set[asyncio.Task] = {read_out, read_err, stall_mon}

    async def _cancel_watcher():
        """Wait for cancellation, then kill the process to unblock readers."""
        nonlocal was_cancelled
        if cancel_event is not None:
            await cancel_event.wait()
            was_cancelled = True
            await _terminate_process(proc)

    cancel_watcher: asyncio.Task | None = None
    if cancel_event is not None:
        cancel_watcher = asyncio.create_task(_cancel_watcher())

    try:
        # Poll with 1s intervals so we can break on cancellation.
        # On Windows, taskkill kills the process but asyncio IOCP pipe
        # transports may not close, leaving readers blocked indefinitely.
        start_wait = time.monotonic()
        pending = io_tasks
        proc_exited_at: float | None = None
        while pending:
            remaining = timeout_s - (time.monotonic() - start_wait)
            if remaining <= 0:
                break
            if was_cancelled:
                break
            # Stall monitor already killed the process — on Windows, IOCP
            # pipe transports may never close, so don't wait for io_tasks.
            if stall_killed:
                break
            # Process exited but pipe readers still blocked — happens on
            # Windows when grandchild processes (e.g. notepad launched via
            # ``start``) inherit our pipe handles via IOCP.  Give readers
            # a short grace period to drain, then stop waiting.
            if proc.returncode is not None:
                if proc_exited_at is None:
                    proc_exited_at = time.monotonic()
                elif time.monotonic() - proc_exited_at > 2.0:
                    logger.info(
                        "Process exited (rc=%d) but readers still pending — "
                        "breaking (likely grandchild pipe inheritance)",
                        proc.returncode,
                    )
                    break
            wait_time = min(remaining, 1.0)
            done, pending = await asyncio.wait(
                pending, timeout=wait_time, return_when=asyncio.ALL_COMPLETED,
            )

        if pending and not was_cancelled and not stall_killed:
            # If process already exited normally, this isn't a timeout — it's
            # the pipe inheritance case.  Don't mark as timed_out.
            if proc.returncode is None:
                timed_out = True
                await _terminate_process(proc)

    except asyncio.CancelledError:
        was_cancelled = True
        await _terminate_process(proc)
    finally:
        # Clean up all tasks
        all_tasks = io_tasks | ({cancel_watcher} if cancel_watcher else set())
        for t in all_tasks:
            if not t.done():
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
        if not stdin_closed:
            await _close_stdin(proc)

    # Ensure returncode is set (on Windows, it's async via IOCP)
    if proc.returncode is None and not timed_out and not was_cancelled:
        try:
            await asyncio.wait_for(proc.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass

    stdout_str = b"".join(stdout_chunks).decode("utf-8", errors="replace")
    stderr_str = b"".join(stderr_chunks).decode("utf-8", errors="replace")
    return stdout_str, stderr_str, timed_out, was_cancelled, stall_killed


async def _close_stdin(proc: asyncio.subprocess.Process) -> None:
    """Safely close the subprocess stdin pipe."""
    if proc.stdin is not None:
        try:
            proc.stdin.close()
            if hasattr(proc.stdin, "wait_closed"):
                await proc.stdin.wait_closed()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


async def _terminate_process(proc: asyncio.subprocess.Process) -> None:
    """Terminate a subprocess and its children.

    On Windows, uses taskkill /T to kill the entire process tree (the shell
    wraps child processes which survive a plain TerminateProcess call).
    On Unix, uses SIGTERM then SIGKILL after 2s.
    """
    if proc.returncode is not None:
        return  # Already exited

    try:
        if sys.platform == "win32":
            # Kill entire process tree on Windows
            import subprocess as _sp
            try:
                _sp.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    capture_output=True, timeout=5,
                )
            except Exception:
                proc.kill()
            try:
                await asyncio.wait_for(proc.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                pass
        else:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
    except ProcessLookupError:
        pass


def _build_result(
    status: str,
    stdout: str,
    stderr: str,
    exit_code: int,
    duration_ms: int,
    max_output_bytes: int,
    command: str,
) -> dict:
    """Build the standardized result dict with truncation."""
    stdout, _ = _truncate(stdout, max_output_bytes)
    stderr, _ = _truncate(stderr, max_output_bytes)

    if status == "cancelled":
        voice = "The command was cancelled."
    elif status == "error":
        voice = f"The command failed with exit code {exit_code}."
    else:
        voice = "The command completed successfully."

    result = {
        "status": status,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "voice_message": voice,
    }

    # Help the model understand silent successes — without this hint, the
    # model sees status=success + empty stdout and retries endlessly.
    if status == "success" and not stdout.strip() and not stderr.strip() and exit_code == 0:
        result["note"] = (
            "Command completed successfully but produced no output. "
            "This is normal for commands that write to files, launch apps, "
            "or perform actions without printing. Do NOT retry — the command worked."
        )

    return result
