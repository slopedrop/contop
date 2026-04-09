"""Unit tests for device_control tool."""
from unittest.mock import AsyncMock, patch, MagicMock
import pytest
import tools.device_control as dc_module
from tools.device_control import handle_device_control


# Patch _persist_keep_awake for all keep-awake tests (we don't want real settings I/O)
_PERSIST_PATCH = "tools.device_control._persist_keep_awake"


@pytest.mark.unit
class TestRouting:
    async def test_unknown_action_returns_error(self):
        result = await handle_device_control("unknown")
        assert result["status"] == "error"
        assert "voice_message" in result

    async def test_result_always_has_required_keys(self):
        result = await handle_device_control("unknown")
        assert all(k in result for k in ["action", "status", "message", "voice_message"])

    async def test_exception_returns_error_result(self):
        with patch("tools.device_control.platform.system", side_effect=RuntimeError("boom")):
            result = await handle_device_control("lock_screen")
        assert result["status"] == "error"


@pytest.mark.unit
class TestLockScreen:
    async def test_windows_subprocess_args(self):
        with patch("tools.device_control.platform.system", return_value="Windows"), \
             patch("tools.device_control.asyncio.to_thread", new_callable=AsyncMock) as m:
            result = await handle_device_control("lock_screen")
        assert m.call_args[0][1] == ["rundll32.exe", "user32.dll,LockWorkStation"]
        assert result["status"] == "success"

    async def test_macos_subprocess_args(self):
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch("tools.device_control.asyncio.to_thread", new_callable=AsyncMock) as m:
            result = await handle_device_control("lock_screen")
        assert m.call_args[0][1] == ["pmset", "displaysleepnow"]
        assert result["status"] == "success"

    async def test_linux_subprocess_args(self):
        with patch("tools.device_control.platform.system", return_value="Linux"), \
             patch("tools.device_control.asyncio.to_thread", new_callable=AsyncMock) as m:
            result = await handle_device_control("lock_screen")
        assert m.call_args[0][1] == ["loginctl", "lock-session"]
        assert result["status"] == "success"

    async def test_subprocess_error_returns_error(self):
        with patch("tools.device_control.platform.system", return_value="Linux"), \
             patch("tools.device_control.asyncio.to_thread", side_effect=Exception("not found")):
            result = await handle_device_control("lock_screen")
        assert result["status"] == "error"
        assert "voice_message" in result


@pytest.mark.unit
class TestKeepAwake:
    def setup_method(self):
        dc_module._keep_awake_process = None

    async def test_keep_awake_on_macos_spawns_caffeinate(self):
        mock_proc = AsyncMock()
        mock_proc.wait = AsyncMock(return_value=0)
        mock_proc.returncode = None  # process is running
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch("tools.device_control.asyncio.create_subprocess_exec",
                   return_value=mock_proc) as m, \
             patch(_PERSIST_PATCH):
            result = await handle_device_control("keep_awake_on")
        assert m.call_args[0][0] == "caffeinate"
        assert result["status"] == "success"
        assert dc_module._keep_awake_process is mock_proc

    async def test_keep_awake_on_linux_spawns_systemd_inhibit(self):
        mock_proc = AsyncMock()
        mock_proc.wait = AsyncMock(return_value=0)
        mock_proc.returncode = None  # process is running
        with patch("tools.device_control.platform.system", return_value="Linux"), \
             patch("tools.device_control.asyncio.create_subprocess_exec",
                   return_value=mock_proc) as m, \
             patch(_PERSIST_PATCH):
            result = await handle_device_control("keep_awake_on")
        assert m.call_args[0][0] == "systemd-inhibit"
        assert result["status"] == "success"

    async def test_keep_awake_on_windows_calls_set_thread_execution_state(self):
        with patch("tools.device_control.platform.system", return_value="Windows"), \
             patch("tools.device_control._win_set_execution_state", return_value=True) as m, \
             patch(_PERSIST_PATCH):
            result = await handle_device_control("keep_awake_on")
        assert result["status"] == "success"
        assert result["action"] == "keep_awake_on"
        # Called twice: once for _keep_awake_off_internal (ES_CONTINUOUS), once for on (all flags)
        assert m.call_count == 2

    async def test_keep_awake_on_windows_failure_returns_error(self):
        # Simulate SetThreadExecutionState returning 0 (failure) on the "on" call
        call_count = 0
        def mock_set_state(flags):
            nonlocal call_count
            call_count += 1
            # First call is _keep_awake_off_internal - allow it
            if call_count == 1:
                return True
            # Second call is the actual enable - fail it
            return False
        with patch("tools.device_control.platform.system", return_value="Windows"), \
             patch("tools.device_control._win_set_execution_state", side_effect=mock_set_state):
            result = await handle_device_control("keep_awake_on")
        assert result["status"] == "error"
        assert "failed" in result["message"].lower()

    async def test_keep_awake_on_process_exits_immediately_returns_error(self):
        mock_proc = AsyncMock()
        mock_proc.wait = AsyncMock(return_value=1)
        mock_proc.returncode = 1  # exited immediately - binary not found or crashed
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch("tools.device_control.asyncio.create_subprocess_exec",
                   return_value=mock_proc):
            result = await handle_device_control("keep_awake_on")
        assert result["status"] == "error"
        assert "exited immediately" in result["message"]
        assert dc_module._keep_awake_process is None

    async def test_keep_awake_off_terminates_subprocess(self):
        mock_proc = AsyncMock()
        mock_proc.wait = AsyncMock(return_value=0)
        dc_module._keep_awake_process = mock_proc
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch(_PERSIST_PATCH):
            result = await handle_device_control("keep_awake_off")
        mock_proc.terminate.assert_called_once()
        assert dc_module._keep_awake_process is None
        assert result["status"] == "success"

    async def test_keep_awake_off_with_no_process_is_safe(self):
        dc_module._keep_awake_process = None
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch(_PERSIST_PATCH):
            result = await handle_device_control("keep_awake_off")
        assert result["status"] == "success"

    async def test_keep_awake_on_twice_cleans_up_first_process(self):
        mock_1 = AsyncMock()
        mock_1.wait = AsyncMock(return_value=0)
        mock_1.returncode = None  # process is running
        mock_2 = AsyncMock()
        mock_2.wait = AsyncMock(return_value=0)
        mock_2.returncode = None  # process is running
        calls = iter([mock_1, mock_2])
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch("tools.device_control.asyncio.create_subprocess_exec",
                   side_effect=lambda *a, **kw: next(calls)), \
             patch(_PERSIST_PATCH):
            await handle_device_control("keep_awake_on")
            await handle_device_control("keep_awake_on")
        mock_1.terminate.assert_called_once()
        assert dc_module._keep_awake_process is mock_2

    async def test_keep_awake_on_persists_setting(self):
        mock_proc = AsyncMock()
        mock_proc.wait = AsyncMock(return_value=0)
        mock_proc.returncode = None
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch("tools.device_control.asyncio.create_subprocess_exec",
                   return_value=mock_proc), \
             patch(_PERSIST_PATCH) as m_persist:
            await handle_device_control("keep_awake_on")
        m_persist.assert_called_with(True)

    async def test_keep_awake_off_persists_setting(self):
        dc_module._keep_awake_process = None
        with patch("tools.device_control.platform.system", return_value="Darwin"), \
             patch(_PERSIST_PATCH) as m_persist:
            await handle_device_control("keep_awake_off")
        m_persist.assert_called_with(False)
