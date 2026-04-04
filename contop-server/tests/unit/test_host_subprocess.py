"""
Unit tests for tools/host_subprocess.py — Host subprocess execution (safe route).

Tests 3.1-3.8 from Story 3.2, plus interactive prompt handling tests.
"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.host_subprocess import (
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_TIMEOUT_S,
    STALL_TIMEOUT_S,
    HostSubprocess,
    _build_result,
    _discover_bash,
    _is_search_command,
    _match_editor,
    _match_prompt,
    _sanitize_env,
    _terminate_process,
    _truncate,
)


# ─── Task 3.2: Successful command execution ──────────────────────────────────


class TestSuccessfulExecution:
    """Test successful command execution — verify stdout, stderr, status, exit_code, duration_ms."""

    @pytest.mark.asyncio
    async def test_successful_echo_command(self):
        host = HostSubprocess()
        if sys.platform == "win32":
            result = await host.run("echo hello")
        else:
            result = await host.run("echo hello")

        assert result["status"] == "success"
        assert "hello" in result["stdout"]
        assert result["exit_code"] == 0
        assert result["duration_ms"] >= 0

    @pytest.mark.asyncio
    async def test_result_dict_has_all_required_keys(self):
        host = HostSubprocess()
        result = await host.run("echo test")
        required_keys = {"status", "stdout", "stderr", "exit_code", "duration_ms", "voice_message"}
        assert required_keys == set(result.keys())

    @pytest.mark.asyncio
    async def test_stderr_populated_on_success(self):
        """stderr should be empty string on successful commands."""
        host = HostSubprocess()
        result = await host.run("echo success")
        assert isinstance(result["stderr"], str)
        assert result["stderr"] == ""


# ─── Task 3.3: Command failure (non-zero exit code) ─────────────────────────


class TestCommandFailure:
    """Test command failure — verify error status."""

    @pytest.mark.asyncio
    async def test_nonzero_exit_code_returns_error_status(self):
        host = HostSubprocess()
        # 'exit 1' works in both bash and /bin/sh
        result = await host.run("exit 1")
        assert result["status"] == "error"
        assert result["exit_code"] != 0

    @pytest.mark.asyncio
    async def test_nonexistent_command_returns_error(self):
        host = HostSubprocess()
        result = await host.run("nonexistent_command_xyz_12345")
        assert result["status"] == "error"


# ─── Task 3.4: Timeout enforcement ──────────────────────────────────────────


class TestTimeoutEnforcement:
    """Test timeout — verify subprocess killed and error payload returned."""

    @pytest.mark.asyncio
    async def test_timeout_kills_process_and_returns_error(self):
        host = HostSubprocess()
        if sys.platform == "win32":
            cmd = "ping -n 60 127.0.0.1"
        else:
            cmd = "sleep 60"
        result = await host.run(cmd, timeout_s=1)
        assert result["status"] == "error"
        assert result["exit_code"] == -1
        assert result["duration_ms"] < 5000

    @pytest.mark.asyncio
    async def test_timeout_captures_partial_output(self):
        """AC #2: partial stdout/stderr captured before timeout must be included."""
        host = HostSubprocess()
        # Print output with flush=True then sleep — timeout should capture the printed text
        if sys.platform == "win32":
            cmd = 'python -c "import sys; print(\'PARTIAL_BEFORE_TIMEOUT\', flush=True); import time; time.sleep(60)"'
        else:
            cmd = "python3 -c \"import sys; print('PARTIAL_BEFORE_TIMEOUT', flush=True); import time; time.sleep(60)\""
        result = await host.run(cmd, timeout_s=3)
        assert result["status"] == "error"
        assert "PARTIAL_BEFORE_TIMEOUT" in result["stdout"]

    @pytest.mark.asyncio
    async def test_timeout_respects_configured_value(self):
        host = HostSubprocess()
        if sys.platform == "win32":
            cmd = "ping -n 60 127.0.0.1"
        else:
            cmd = "sleep 60"
        result = await host.run(cmd, timeout_s=1)
        # Duration should be roughly 1-3 seconds (allowing for process teardown)
        assert result["duration_ms"] < 5000


# ─── Task 3.5: Output truncation ────────────────────────────────────────────


class TestOutputTruncation:
    """Test large output truncation with marker."""

    @pytest.mark.asyncio
    async def test_large_stdout_is_truncated(self):
        host = HostSubprocess()
        # Generate output larger than 1KB
        if sys.platform == "win32":
            # Use python to generate output on Windows
            cmd = 'python -c "print(\'x\' * 2000)"'
        else:
            cmd = "python3 -c \"print('x' * 2000)\""
        result = await host.run(cmd, max_output_bytes=100)
        assert "[truncated]" in result["stdout"]

    def test_truncate_function_within_limit(self):
        text = "short text"
        result, was_truncated = _truncate(text, 1000)
        assert result == "short text"
        assert was_truncated is False

    def test_truncate_function_exceeds_limit(self):
        text = "x" * 200
        result, was_truncated = _truncate(text, 50)
        assert was_truncated is True
        assert "[truncated]" in result
        assert len(result.encode("utf-8")) <= 50 + len("\n[truncated]".encode("utf-8"))


# ─── Task 3.6: Cancellation ─────────────────────────────────────────────────


class TestCancellation:
    """Test cancellation — verify subprocess terminated and cancelled status returned."""

    @pytest.mark.asyncio
    async def test_cancel_event_terminates_subprocess(self):
        host = HostSubprocess()
        cancel_event = asyncio.Event()

        async def set_cancel_soon():
            await asyncio.sleep(0.5)
            cancel_event.set()

        # Use Python sleep — avoids Windows child process tree issues with ping
        cmd = 'python -c "import time; time.sleep(60)"'

        cancel_task = asyncio.create_task(set_cancel_soon())
        result = await host.run(cmd, timeout_s=30, cancel_event=cancel_event)
        await cancel_task

        assert result["status"] == "cancelled"
        assert result["exit_code"] == -1

    @pytest.mark.asyncio
    async def test_cancel_returns_quickly(self):
        host = HostSubprocess()
        cancel_event = asyncio.Event()

        async def set_cancel_soon():
            await asyncio.sleep(0.5)
            cancel_event.set()

        cmd = 'python -c "import time; time.sleep(60)"'

        cancel_task = asyncio.create_task(set_cancel_soon())
        result = await host.run(cmd, timeout_s=30, cancel_event=cancel_event)
        await cancel_task

        # Should return in ~0.5s + teardown, not 30s
        assert result["duration_ms"] < 10000


# ─── Task 3.7: Environment sanitization ─────────────────────────────────────


class TestEnvironmentSanitization:
    """Test sensitive vars stripped from subprocess env."""

    def test_sanitize_env_strips_api_key(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "secret123", "PATH": "/usr/bin"}):
            env = _sanitize_env()
            assert "GEMINI_API_KEY" not in env
            assert "PATH" in env

    def test_sanitize_env_strips_secret_patterns(self):
        with patch.dict(os.environ, {
            "MY_SECRET_VAR": "val",
            "AUTH_TOKEN": "val",
            "DB_PASSWORD": "val",
            "SOME_API_KEY": "val",
            "PATH": "/usr/bin",
            "HOME": "/home/user",
        }):
            env = _sanitize_env()
            assert "MY_SECRET_VAR" not in env
            assert "AUTH_TOKEN" not in env
            assert "DB_PASSWORD" not in env
            assert "SOME_API_KEY" not in env
            assert "PATH" in env
            assert "HOME" in env

    def test_sanitize_env_preserves_safe_vars(self):
        with patch.dict(os.environ, {
            "PATH": "/usr/bin",
            "HOME": "/home/user",
            "TERM": "xterm",
        }, clear=True):
            env = _sanitize_env()
            assert "PATH" in env
            assert "HOME" in env
            assert "TERM" in env

    @pytest.mark.asyncio
    async def test_subprocess_does_not_see_sensitive_vars(self):
        """Integration test: verify subprocess cannot see GEMINI_API_KEY."""
        with patch.dict(os.environ, {"GEMINI_API_KEY": "should_not_leak"}):
            host = HostSubprocess()
            # Works in both bash and /bin/sh
            cmd = "echo $GEMINI_API_KEY"
            result = await host.run(cmd)
            assert "should_not_leak" not in result["stdout"]


# ─── Task 3.8: Cross-platform shell selection ───────────────────────────────


class TestCrossPlatformShell:
    """Test correct shell used per platform."""

    @pytest.mark.asyncio
    async def test_command_executes_on_current_platform(self):
        """Verify the command actually runs on the current platform's shell."""
        host = HostSubprocess()
        # Use bash-compatible echo on all platforms
        result = await host.run("echo hello_platform")
        assert result["status"] == "success"
        assert "hello_platform" in result["stdout"]

    @pytest.mark.asyncio
    async def test_shell_cmd_format_windows(self):
        """Verify Windows shell executes bash-compatible commands."""
        if sys.platform != "win32":
            pytest.skip("Windows-only test")
        host = HostSubprocess()
        result = await host.run("echo hello_windows")
        assert result["status"] == "success"
        assert "hello_windows" in result["stdout"]

    @pytest.mark.asyncio
    async def test_shell_cmd_format_unix(self):
        """Verify Unix shell executes Unix-specific syntax."""
        if sys.platform == "win32":
            pytest.skip("Unix-only test")
        host = HostSubprocess()
        # $HOME is expanded by /bin/sh
        result = await host.run("echo $HOME")
        assert result["status"] == "success"
        assert result["stdout"].strip() != ""
        assert result["stdout"].strip() != "$HOME"


# ─── _build_result helper tests ──────────────────────────────────────────────


class TestBuildResult:
    """Test _build_result helper."""

    def test_build_result_keys(self):
        result = _build_result("success", "out", "err", 0, 100, DEFAULT_MAX_OUTPUT_BYTES, "echo")
        assert set(result.keys()) == {"status", "stdout", "stderr", "exit_code", "duration_ms", "voice_message"}

    def test_build_result_truncates_large_output(self):
        large = "x" * 200
        result = _build_result("success", large, "", 0, 100, 50, "echo")
        assert "[truncated]" in result["stdout"]


# ─── Interactive prompt detection tests ──────────────────────────────────────


class TestPromptDetection:
    """Test _match_prompt for various interactive prompt patterns."""

    def test_yn_bracket_uppercase(self):
        assert _match_prompt("Do you want to continue? [Y/n] ") == b"Y\n"

    def test_yn_bracket_lowercase(self):
        # [y/N] now correctly matches the second pattern (case-sensitive) — responds y
        assert _match_prompt("Continue? [y/N] ") == b"y\n"

    def test_yn_paren(self):
        assert _match_prompt("Proceed? (y/n) ") == b"y\n"

    def test_yes_no_paren(self):
        assert _match_prompt("Are you sure? (yes/no) ") == b"yes\n"

    def test_do_you_want_to_continue(self):
        assert _match_prompt("Do you want to continue?") == b"y\n"

    def test_are_you_sure(self):
        assert _match_prompt("Are you sure?") == b"y\n"

    def test_press_enter(self):
        assert _match_prompt("Press Enter to continue...") == b"\n"

    def test_press_any_key(self):
        assert _match_prompt("Press any key to continue") == b"\n"

    def test_npm_proceed(self):
        assert _match_prompt("Ok to proceed? (y) ") == b"y\n"

    def test_pip_proceed(self):
        # Proceed (Y/n) matches the generic (y/n) pattern (case-insensitive) first
        assert _match_prompt("Proceed (Y/n)? ") == b"y\n"

    def test_git_type_yes(self):
        assert _match_prompt("type 'yes' to confirm") == b"yes\n"

    def test_overwrite_yn(self):
        # Matches the dedicated overwrite [y/N] pattern
        assert _match_prompt("overwrite foo.txt? [y/N] ") == b"y\n"

    def test_no_match_normal_output(self):
        assert _match_prompt("hello world\nsome output") is None

    def test_no_match_partial_prompt(self):
        assert _match_prompt("Processing files...") is None

    def test_only_checks_tail(self):
        """Prompt detection should only look at the tail of output."""
        long_prefix = "x" * 1000
        assert _match_prompt(long_prefix + " [Y/n] ") == b"Y\n"


class TestEditorDetection:
    """Test _match_editor for interactive editor/pager patterns."""

    def test_less_end_marker(self):
        assert _match_editor("some content\n(END)") is True

    def test_more_marker(self):
        assert _match_editor("some content\n--More--") is True

    def test_less_line_counter(self):
        assert _match_editor("some content\nlines 1-20/100") is True

    def test_normal_output_not_detected(self):
        assert _match_editor("hello world\nsome normal output") is False


class TestInteractiveAutoResponse:
    """Integration tests for interactive prompt auto-response."""

    @pytest.mark.asyncio
    async def test_auto_responds_to_yn_prompt(self):
        """Verify the executor auto-responds to a Y/n prompt."""
        host = HostSubprocess()
        if sys.platform == "win32":
            # Python script that prompts then echoes the response
            cmd = 'python -c "r=input(\'Continue? [Y/n] \'); print(f\'GOT:{r}\')"'
        else:
            cmd = "python3 -c \"r=input('Continue? [Y/n] '); print(f'GOT:{r}')\""
        result = await host.run(cmd, timeout_s=10)
        assert result["status"] == "success"
        assert "GOT:Y" in result["stdout"]

    @pytest.mark.asyncio
    async def test_auto_responds_to_yes_no_prompt(self):
        """Verify the executor auto-responds to a (yes/no) prompt."""
        host = HostSubprocess()
        if sys.platform == "win32":
            cmd = 'python -c "r=input(\'Confirm? (yes/no) \'); print(f\'GOT:{r}\')"'
        else:
            cmd = "python3 -c \"r=input('Confirm? (yes/no) '); print(f'GOT:{r}')\""
        result = await host.run(cmd, timeout_s=10)
        assert result["status"] == "success"
        assert "GOT:yes" in result["stdout"]

    @pytest.mark.asyncio
    async def test_stall_detection_closes_stdin(self):
        """Verify that a stalled process gets stdin closed (EOF)."""
        host = HostSubprocess()
        # This command reads from stdin with no prompt — should stall then get EOF.
        # On Windows, closing stdin to cmd.exe may cause an error exit rather than
        # clean EOF, so we wrap in try/except and accept either outcome.
        if sys.platform == "win32":
            cmd = (
                'python -c "'
                "import sys;"
                " data='';"
                " exec('try:\\n data=sys.stdin.read()\\nexcept:\\n pass');"
                " print('EOF_RECEIVED')"
                '"'
            )
        else:
            cmd = "python3 -c \"import sys; sys.stdin.read(); print('EOF_RECEIVED')\""
        result = await host.run(cmd, timeout_s=15)
        # Stall monitor should close stdin after STALL_TIMEOUT_S — process should
        # finish well before the 15s timeout regardless of exit status.
        assert result["duration_ms"] < 12000, "Stall detection should unblock process before timeout"
        # On clean platforms, stdin.read() returns '' on EOF and process exits 0
        if result["status"] == "success":
            assert "EOF_RECEIVED" in result["stdout"]

    @pytest.mark.asyncio
    async def test_stall_timeout_is_5_seconds(self):
        assert STALL_TIMEOUT_S == 5.0


# ─── Temp directory enforcement tests ────────────────────────────────────────


class TestTempDirectoryEnforcement:
    """Verify subprocess runs in a temp dir and temp files are cleaned up."""

    @pytest.mark.asyncio
    async def test_subprocess_runs_in_temp_dir(self):
        """Subprocess CWD should be a temp directory, not the project tree."""
        import tempfile
        host = HostSubprocess()
        # Use pwd — works in both bash and /bin/sh. On Windows cmd.exe
        # fallback, cd prints CWD, but with bash as default we need pwd.
        cmd = "pwd"
        result = await host.run(cmd)
        assert result["status"] == "success"
        cwd = result["stdout"].strip()
        # CWD should be under the system temp directory
        tmp_root = tempfile.gettempdir()
        assert cwd.startswith(tmp_root) or "contop_exec_" in cwd

    @pytest.mark.asyncio
    async def test_temp_dir_cleaned_up_after_execution(self):
        """Temp directory should be deleted after command completes."""
        import tempfile
        host = HostSubprocess()
        cmd = "pwd"
        result = await host.run(cmd)
        cwd = result["stdout"].strip()
        # The temp dir should have been cleaned up
        assert not os.path.exists(cwd), f"Temp dir {cwd} was not cleaned up"

    @pytest.mark.asyncio
    async def test_file_created_by_subprocess_lands_in_temp_dir(self):
        """Files created with relative paths should land in temp dir, not project."""
        host = HostSubprocess()
        if sys.platform == "win32":
            cmd = 'python -c "open(\'test_junk.txt\', \'w\').write(\'junk\'); import os; print(os.path.abspath(\'test_junk.txt\'))"'
        else:
            cmd = "python3 -c \"open('test_junk.txt', 'w').write('junk'); import os; print(os.path.abspath('test_junk.txt'))\""
        result = await host.run(cmd)
        assert result["status"] == "success"
        file_path = result["stdout"].strip()
        # File should have been in the temp dir (now cleaned up)
        assert "contop_exec_" in file_path
        # And it should be cleaned up
        assert not os.path.exists(file_path)


# ─── Bash discovery tests ────────────────────────────────────────────────────


class TestDiscoverBash:
    """Test _discover_bash() — Windows Git Bash auto-discovery with WSL guard."""

    def _reset_cache(self):
        """Reset the module-level discovery cache between tests."""
        import tools.host_subprocess as mod
        mod._cached_bash_path = None
        mod._bash_discovery_done = False

    def test_returns_none_on_non_windows(self):
        self._reset_cache()
        with patch("tools.host_subprocess.sys") as mock_sys:
            mock_sys.platform = "linux"
            result = _discover_bash()
            assert result is None

    def test_finds_bundled_bash_from_env(self):
        self._reset_cache()
        with patch("tools.host_subprocess.sys") as mock_sys, \
             patch.dict(os.environ, {"CONTOP_BASH_PATH": "C:\\bundled\\bash.exe"}), \
             patch("tools.host_subprocess.os.path.isabs", return_value=True), \
             patch("tools.host_subprocess.os.path.isfile", return_value=True):
            mock_sys.platform = "win32"
            result = _discover_bash()
            assert result == "C:\\bundled\\bash.exe"

    def test_finds_git_bash_at_common_path(self):
        self._reset_cache()
        git_bash = "C:\\Program Files\\Git\\bin\\bash.exe"
        with patch("tools.host_subprocess.sys") as mock_sys, \
             patch.dict(os.environ, {"PROGRAMFILES": "C:\\Program Files"}, clear=False), \
             patch("tools.host_subprocess.os.path.isabs", return_value=True), \
             patch("tools.host_subprocess.os.path.isfile") as mock_isfile:
            mock_sys.platform = "win32"
            # No CONTOP_BASH_PATH, first candidate matches
            os.environ.pop("CONTOP_BASH_PATH", None)
            mock_isfile.side_effect = lambda p: p == git_bash
            result = _discover_bash()
            assert result == git_bash

    def test_skips_wsl_bash(self):
        self._reset_cache()
        wsl_bash = "C:\\Windows\\System32\\bash.exe"
        with patch("tools.host_subprocess.sys") as mock_sys, \
             patch.dict(os.environ, {}, clear=False), \
             patch("tools.host_subprocess.os.path.isabs", return_value=True), \
             patch("tools.host_subprocess.os.path.isfile", return_value=False), \
             patch("tools.host_subprocess.shutil.which", return_value=wsl_bash):
            mock_sys.platform = "win32"
            os.environ.pop("CONTOP_BASH_PATH", None)
            result = _discover_bash()
            assert result is None  # WSL bash should be skipped

    def test_finds_bash_on_path(self):
        self._reset_cache()
        path_bash = "C:\\tools\\Git\\bin\\bash.exe"
        with patch("tools.host_subprocess.sys") as mock_sys, \
             patch.dict(os.environ, {}, clear=False), \
             patch("tools.host_subprocess.os.path.isabs", return_value=True), \
             patch("tools.host_subprocess.os.path.isfile", return_value=False), \
             patch("tools.host_subprocess.shutil.which", return_value=path_bash):
            mock_sys.platform = "win32"
            os.environ.pop("CONTOP_BASH_PATH", None)
            result = _discover_bash()
            assert result == path_bash

    def test_returns_none_when_no_bash_found(self):
        self._reset_cache()
        with patch("tools.host_subprocess.sys") as mock_sys, \
             patch.dict(os.environ, {}, clear=False), \
             patch("tools.host_subprocess.os.path.isabs", return_value=True), \
             patch("tools.host_subprocess.os.path.isfile", return_value=False), \
             patch("tools.host_subprocess.shutil.which", return_value=None):
            mock_sys.platform = "win32"
            os.environ.pop("CONTOP_BASH_PATH", None)
            result = _discover_bash()
            assert result is None


# ─── Sanitize env with bash tests ────────────────────────────────────────────


class TestSanitizeEnvBash:
    """Test _sanitize_env() with using_bash parameter."""

    def test_injects_msys_no_pathconv_when_using_bash(self):
        with patch.dict(os.environ, {"PATH": "/usr/bin"}, clear=True):
            env = _sanitize_env(using_bash=True)
            assert env.get("MSYS_NO_PATHCONV") == "1"

    def test_no_msys_var_when_not_using_bash(self):
        with patch.dict(os.environ, {"PATH": "/usr/bin"}, clear=True):
            env = _sanitize_env(using_bash=False)
            assert "MSYS_NO_PATHCONV" not in env

    def test_default_is_not_using_bash(self):
        with patch.dict(os.environ, {"PATH": "/usr/bin"}, clear=True):
            env = _sanitize_env()
            assert "MSYS_NO_PATHCONV" not in env


# ─── Search command regex tests ──────────────────────────────────────────────


class TestSearchCommandDetection:
    """Test _is_search_command() with updated regex including bash commands."""

    def test_grep_is_search_command(self):
        assert _is_search_command("grep pattern file.txt") is True

    def test_find_is_search_command(self):
        assert _is_search_command("find /home -name '*.py'") is True

    def test_which_is_search_command(self):
        assert _is_search_command("which python") is True

    def test_dir_is_search_command(self):
        assert _is_search_command("dir /s /b *.txt") is True

    def test_where_is_search_command(self):
        assert _is_search_command("where python") is True

    def test_findstr_is_search_command(self):
        assert _is_search_command("findstr /i pattern file.txt") is True

    def test_ls_is_not_search_command(self):
        assert _is_search_command("ls -la") is False

    def test_echo_is_not_search_command(self):
        assert _is_search_command("echo hello") is False

    def test_random_command_is_not_search(self):
        assert _is_search_command("python script.py") is False


# ─── Bash vs cmd.exe execution path tests ────────────────────────────────────


class TestBashExecutionPath:
    """Test that the correct subprocess method is called based on bash availability."""

    @pytest.mark.asyncio
    async def test_uses_create_subprocess_exec_when_bash_available(self):
        """When _discover_bash() returns a path, create_subprocess_exec should be used."""
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.stdout = AsyncMock()
        mock_proc.stdout.read = AsyncMock(return_value=b"")
        mock_proc.stderr = AsyncMock()
        mock_proc.stderr.read = AsyncMock(return_value=b"")
        mock_proc.stdin = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)

        with patch("tools.host_subprocess._discover_bash", return_value="/usr/bin/bash"), \
             patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=mock_proc) as mock_exec, \
             patch("asyncio.create_subprocess_shell", new_callable=AsyncMock) as mock_shell:
            host = HostSubprocess()
            await host.run("echo hello", timeout_s=5)
            mock_exec.assert_called_once()
            mock_shell.assert_not_called()
            # Verify bash -c args
            call_args = mock_exec.call_args
            assert call_args[0][0] == "/usr/bin/bash"
            assert call_args[0][1] == "-c"
            assert call_args[0][2] == "echo hello"

    @pytest.mark.asyncio
    async def test_uses_create_subprocess_shell_when_no_bash(self):
        """When _discover_bash() returns None, create_subprocess_shell should be used."""
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.stdout = AsyncMock()
        mock_proc.stdout.read = AsyncMock(return_value=b"")
        mock_proc.stderr = AsyncMock()
        mock_proc.stderr.read = AsyncMock(return_value=b"")
        mock_proc.stdin = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)

        with patch("tools.host_subprocess._discover_bash", return_value=None), \
             patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec, \
             patch("asyncio.create_subprocess_shell", new_callable=AsyncMock, return_value=mock_proc) as mock_shell:
            host = HostSubprocess()
            await host.run("echo hello", timeout_s=5)
            mock_shell.assert_called_once()
            mock_exec.assert_not_called()

    @pytest.mark.asyncio
    async def test_cmd_fallback_calls_fix_windows_command(self):
        """When no bash, _fix_windows_command should be called on Windows."""
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.stdout = AsyncMock()
        mock_proc.stdout.read = AsyncMock(return_value=b"")
        mock_proc.stderr = AsyncMock()
        mock_proc.stderr.read = AsyncMock(return_value=b"")
        mock_proc.stdin = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)

        with patch("tools.host_subprocess._discover_bash", return_value=None), \
             patch("tools.host_subprocess.sys") as mock_sys, \
             patch("tools.host_subprocess._fix_windows_command", return_value=("echo hello", [])) as mock_fix, \
             patch("asyncio.create_subprocess_shell", new_callable=AsyncMock, return_value=mock_proc):
            mock_sys.platform = "win32"
            host = HostSubprocess()
            await host.run("echo hello", timeout_s=5)
            mock_fix.assert_called_once()

    @pytest.mark.asyncio
    async def test_cmd_fallback_does_not_inject_msys_env(self):
        """When no bash, MSYS_NO_PATHCONV should NOT be in the environment."""
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.stdout = AsyncMock()
        mock_proc.stdout.read = AsyncMock(return_value=b"")
        mock_proc.stderr = AsyncMock()
        mock_proc.stderr.read = AsyncMock(return_value=b"")
        mock_proc.stdin = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)

        with patch("tools.host_subprocess._discover_bash", return_value=None), \
             patch("asyncio.create_subprocess_shell", new_callable=AsyncMock, return_value=mock_proc) as mock_shell:
            host = HostSubprocess()
            await host.run("echo hello", timeout_s=5)
            # Check the env kwarg passed to create_subprocess_shell
            call_kwargs = mock_shell.call_args
            env = call_kwargs.kwargs.get("env") or call_kwargs[1].get("env")
            if env is not None:
                assert "MSYS_NO_PATHCONV" not in env

    @pytest.mark.asyncio
    async def test_bash_path_skips_fix_windows_command(self):
        """When bash is available, _fix_windows_command should NOT be called."""
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.stdout = AsyncMock()
        mock_proc.stdout.read = AsyncMock(return_value=b"")
        mock_proc.stderr = AsyncMock()
        mock_proc.stderr.read = AsyncMock(return_value=b"")
        mock_proc.stdin = MagicMock()
        mock_proc.wait = AsyncMock(return_value=0)

        with patch("tools.host_subprocess._discover_bash", return_value="/usr/bin/bash"), \
             patch("tools.host_subprocess._fix_windows_command") as mock_fix, \
             patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=mock_proc):
            host = HostSubprocess()
            await host.run("echo hello", timeout_s=5)
            mock_fix.assert_not_called()
