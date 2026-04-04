"""
ADK Execution Agent — autonomous multi-step task runner.

Wraps a google.adk LlmAgent with before/after tool callbacks that enforce
the Dual-Tool Evaluator security gate and stream progress to the mobile client.

All execution paths are routed through DualToolEvaluator.classify() via the
before_tool_callback. Direct tool invocation outside this module is FORBIDDEN.

[Source: project-context.md — Mandatory Dual-Tool Gate]
[Source: architecture.md — Split-Agent Architecture]
"""
import asyncio
import json
import logging
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from google.adk.agents import LlmAgent
from google.adk.planners import BuiltInPlanner
from google.adk.agents.run_config import StreamingMode
from google.adk.runners import Runner, RunConfig
from google.adk.sessions import DatabaseSessionService, InMemorySessionService
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types as genai_types

from google.adk.models.lite_llm import LiteLlm

from core.agent_config import (
    DEFAULT_COMPUTER_USE_BACKEND,
    EXECUTION_AGENT_MODEL,
    EXECUTION_AGENT_SYSTEM_PROMPT,
    LLM_CALL_TIMEOUT,
    MAX_EXECUTION_TIME,
    MAX_ITERATIONS,
    get_planning_system_prompt,
)

_LITELLM_PREFIXES = (
    "openai/", "anthropic/", "groq/", "mistral/", "together_ai/",
    "deepseek/", "fireworks_ai/", "cohere/", "openrouter/",
)


def _resolve_model(model_name: str, **kwargs):
    """Return LiteLlm wrapper for non-Gemini models, plain string for Gemini."""
    if any(model_name.startswith(p) for p in _LITELLM_PREFIXES):
        return LiteLlm(model=model_name, **kwargs)
    return model_name  # Gemini — ADK handles natively
from core.agent_tools import execute_accessible, execute_browser, execute_cli, execute_cli_sandboxed, execute_computer_use, execute_gui, get_action_history, get_ui_context, maximize_active_window, observe_screen, wait, set_status_callback, set_action_history_ref, set_session_cwd, reset_cu_client, set_cu_progress_callback, set_browser_client, set_vision_backend, process_info, system_info, download_file
from core.audit_logger import audit_logger
from core.dual_tool_evaluator import DualToolEvaluator
from core.document_tools import read_pdf, read_image, read_excel, write_excel
from core.file_tools import read_file, edit_file, find_files
from core.skill_loader import discover_skills, build_skills_prompt_section
from core.skill_executor import execute_skill, load_skill, load_python_tools, create_skill, edit_skill
from core.settings import get_enabled_skills, get_skills_dir
from core.tracing import init_tracing, tool_span, agent_span
from core.llm_logger import LlmLogger
from core.window_tools import window_list, window_focus, resize_window, clipboard_read, clipboard_write
from core.workflow_tools import save_dialog, open_dialog, launch_app, close_app

logger = logging.getLogger(__name__)

APP_NAME = "contop_execution"
PLANNING_MAX_LLM_CALLS = 15  # Budget for planning sub-agent investigation

MAX_MESSAGE_QUEUE = 1000
CONFIRMATION_TIMEOUT_S = 300
ACTION_HISTORY_MAX = 50

# Default path for persistent session database (~/.contop/data/sessions.db)
_SESSIONS_DB_PATH = os.path.join(str(Path.home()), ".contop", "data", "sessions.db")


async def cleanup_old_sessions(max_age_days: int = 7) -> int:
    """Delete ADK sessions older than max_age_days from persistent storage.

    Standalone function for use at server startup. Uses the ADK
    DatabaseSessionService API to avoid raw SQL and timestamp format issues.
    Returns the number of deleted sessions.
    """
    db_path = _SESSIONS_DB_PATH
    if not os.path.exists(db_path):
        return 0
    try:
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        svc = DatabaseSessionService(db_url=f"sqlite+aiosqlite:///{db_path}")
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        resp = await svc.list_sessions(app_name=APP_NAME, user_id="contop_user")
        deleted = 0
        for session_meta in resp.sessions:
            # list_sessions returns SessionListEntry with update_time
            if hasattr(session_meta, "update_time") and session_meta.update_time and session_meta.update_time < cutoff:
                await svc.delete_session(
                    app_name=APP_NAME,
                    user_id="contop_user",
                    session_id=session_meta.id,
                )
                deleted += 1
        if deleted:
            logger.info("Cleaned up %d sessions older than %d days", deleted, max_age_days)
        return deleted
    except Exception:
        logger.exception("Failed to clean up old sessions")
        return 0


# ---------------------------------------------------------------------------
# Module-level context for the generate_plan tool.  Set by ExecutionAgent
# before each intent so the tool can spin up a planning sub-agent with the
# same model, tools, and prompt as the execution agent.
# ---------------------------------------------------------------------------
_plan_context: dict | None = None


def set_plan_context(ctx: dict | None) -> None:
    global _plan_context
    _plan_context = ctx


async def generate_plan(task_description: str) -> dict:
    """Investigate the system state and generate a step-by-step plan for a complex task.

    Call this when you encounter a task that requires 3+ steps, involves multiple
    applications, or needs investigation before execution. A planning sub-agent
    will use tools to observe the current system state, then produce a concrete
    plan. The plan is sent to the user for approval before you proceed.

    Args:
        task_description: What the user wants to accomplish. Include any relevant
            context about the current state you already know.

    Returns:
        dict with 'status' ('approved', 'rejected', 'timeout', 'error') and
        'plan' (the plan text, if generated).
    """
    ctx = _plan_context
    if not ctx:
        return {"status": "error", "plan": "", "detail": "Planning context not initialized."}

    try:
        # Build tool descriptions from execution agent's current tool list
        planning_tools = []
        tool_descs = []
        for tool_fn in ctx["tools"]:
            name = getattr(tool_fn, "name", getattr(tool_fn, "__name__", str(tool_fn)))
            # Exclude generate_plan itself to prevent recursion
            if name == "generate_plan":
                continue
            planning_tools.append(tool_fn)
            doc = getattr(tool_fn, "__doc__", "") or ""
            first_line = doc.strip().split("\n")[0] if doc.strip() else ""
            tool_descs.append(f"- {name}: {first_line}")
        tool_descriptions = "\n".join(tool_descs)

        planning_prompt = get_planning_system_prompt(tool_descriptions)

        planning_agent = LlmAgent(
            name="contop_planner",
            model=ctx["model"],
            instruction=planning_prompt,
            tools=planning_tools,
            description="Planning sub-agent that investigates system state and generates step-by-step plans.",
        )

        # Apply thinking config if the execution agent has it enabled
        if ctx.get("thinking_config"):
            planning_agent.planner = BuiltInPlanner(
                thinking_config=ctx["thinking_config"],
            )

        planning_session_service = InMemorySessionService()
        planning_runner = Runner(
            app_name="contop_planning",
            agent=planning_agent,
            session_service=planning_session_service,
        )

        plan_session_id = str(uuid.uuid4())
        await planning_session_service.create_session(
            app_name="contop_planning",
            user_id="planner",
            session_id=plan_session_id,
        )

        user_msg = genai_types.Content(
            role="user",
            parts=[genai_types.Part.from_text(text=task_description)],
        )

        send_fn = ctx.get("send_fn")
        if send_fn:
            send_fn("agent_progress", {
                "step": 0,
                "tool": "generate_plan",
                "detail": "Planning agent investigating...",
                "status": "running",
            })

        plan_text = ""
        async for event in planning_runner.run_async(
            user_id="planner",
            session_id=plan_session_id,
            new_message=user_msg,
            run_config=RunConfig(max_llm_calls=PLANNING_MAX_LLM_CALLS),
        ):
            if event.is_final_response() and event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text and not getattr(part, "thought", False):
                        plan_text += part.text

        plan_text = plan_text.strip()
        logger.info("Planning sub-agent result: %s", plan_text[:300])

        if not plan_text or "PLAN" not in plan_text.upper():
            return {"status": "error", "plan": "", "detail": "Planning agent did not produce a valid plan."}

        # Strip "PLAN\n" prefix for display
        display_plan = plan_text
        if display_plan.upper().startswith("PLAN"):
            display_plan = display_plan.split("\n", 1)[-1].strip()

        # Parse plan into structured steps for rich mobile display
        plan_steps = []
        for line in display_plan.split("\n"):
            line = line.strip()
            if not line or not line[0].isdigit():
                continue
            after_num = re.sub(r"^\d+\.\s*", "", line)
            tool_name_parsed = ""
            description = after_num
            tool_match = re.search(r"\s*[—–-]\s*tool:\s*(\S+)", after_num)
            if tool_match:
                tool_name_parsed = tool_match.group(1)
                description = after_num[:tool_match.start()].strip()
            plan_steps.append({"description": description, "tool": tool_name_parsed})

        # Send plan to user for approval
        confirm_fn = ctx.get("confirm_fn")
        if not confirm_fn:
            return {"status": "approved", "plan": display_plan}

        approved = await confirm_fn(
            tool_name="planning_agent",
            args={"command": display_plan, "plan_steps": plan_steps},
            reason="plan_approval",
            voice_message="I've created a plan for this task. Would you like me to proceed?",
        )

        if approved is None:
            return {"status": "timeout", "plan": display_plan}
        elif approved:
            return {"status": "approved", "plan": display_plan}
        else:
            return {"status": "rejected", "plan": display_plan}

    except Exception:
        logger.exception("Planning sub-agent failed")
        return {"status": "error", "plan": "", "detail": "Planning sub-agent encountered an error."}


class ExecutionAgent:
    """Wraps an ADK LlmAgent with security callbacks and progress streaming.

    Provides run_intent() to process user intents autonomously, streaming
    agent_progress messages back to the mobile client via send_message_fn.
    """

    def __init__(self) -> None:
        self._evaluator = DualToolEvaluator()
        self._tracer = init_tracing()
        self._cancelled = False
        self._step_counter = 0
        self._start_time: float = 0.0
        self._send_message_fn: Callable[[str, dict], None] | None = None
        self._message_queue: deque[tuple[str, dict]] = deque(maxlen=MAX_MESSAGE_QUEUE)
        self._confirmation_futures: dict[str, asyncio.Future] = {}
        self._action_history: deque[dict] = deque(maxlen=ACTION_HISTORY_MAX)
        self._running = False  # Concurrency guard for run_intent
        self._run_lock = asyncio.Lock()  # M3: proper concurrency guard
        self._user_id = "contop_user"
        self._session_id: str | None = None  # Reused across intents for multi-turn memory
        self._session_cwd: str | None = None  # Persistent working dir for CLI commands
        self._computer_use_backend: str = DEFAULT_COMPUTER_USE_BACKEND
        # Audit context: stored by _before_tool_callback, read by _after_tool_callback
        self._last_classified_command: str = ""
        self._last_confirmation_outcome: str = ""
        self._current_intent: str = ""
        self._active_tool_spans: dict[int, Any] = {}  # step → span context manager
        # LLM call logging: per-instance logger + accumulate output between callbacks
        self._llm_logger = LlmLogger()
        self._llm_call_start_time: float = 0.0
        self._llm_first_output_time: float = 0.0  # When first output event arrives
        self._llm_output_text: str = ""
        self._llm_output_thinking: str = ""
        self._llm_output_tool_calls: list[dict] = []

        # Set API keys for ADK and LiteLlm providers
        from core.settings import (
            get_gemini_api_key, get_openai_api_key, get_anthropic_api_key, get_openrouter_api_key,
        )
        for env_var, getter in [
            ("GOOGLE_API_KEY", get_gemini_api_key),
            ("OPENAI_API_KEY", get_openai_api_key),
            ("ANTHROPIC_API_KEY", get_anthropic_api_key),
            ("OPENROUTER_API_KEY", get_openrouter_api_key),
        ]:
            key = getter()
            if key:
                os.environ[env_var] = key

        # NOTE: Gemini subscription routing is handled per-request in the model
        # resolution block below (routed via LiteLLM's OpenAI handler), NOT via
        # GOOGLE_GEMINI_BASE_URL (which would try Google's native API endpoints
        # that the CLI proxy doesn't serve).

        self._agent = LlmAgent(
            name="contop_executor",
            model=EXECUTION_AGENT_MODEL,
            instruction=EXECUTION_AGENT_SYSTEM_PROMPT,
            description="Autonomous desktop execution agent with CLI, GUI, and screen observation tools.",
            tools=[execute_cli, execute_gui, observe_screen, get_ui_context, maximize_active_window, wait, get_action_history, read_file, edit_file, find_files, window_list, window_focus, resize_window, clipboard_read, clipboard_write, read_pdf, read_image, read_excel, write_excel, process_info, system_info, download_file, save_dialog, open_dialog, launch_app, close_app, create_skill, edit_skill],
            before_tool_callback=self._before_tool_callback,
            after_tool_callback=self._after_tool_callback,
            before_model_callback=self._before_model_callback,
        )
        self._thinking_enabled = False  # Updated per-request based on mobile settings
        self._is_cli_proxy = False  # True when model routes through CLI proxy (sub mode)

        # Persistent session storage — survives server restarts.
        # Planning sub-agent uses InMemorySessionService (ephemeral one-shot).
        os.makedirs(os.path.dirname(_SESSIONS_DB_PATH), exist_ok=True)
        self._session_service = DatabaseSessionService(db_url=f"sqlite+aiosqlite:///{_SESSIONS_DB_PATH}")
        self._runner = Runner(
            app_name=APP_NAME,
            agent=self._agent,
            session_service=self._session_service,
        )

    def _get_model_display_name(self) -> str:
        """Return a short display-friendly model name for the current agent model."""
        model = self._agent.model
        if isinstance(model, LiteLlm):
            name = model.model
            # Strip LiteLLM routing prefix (e.g. "openai/claude-sonnet-4-6" → "claude-sonnet-4-6")
            if "/" in name:
                name = name.split("/", 1)[1]
            return name
        return str(model) if model else EXECUTION_AGENT_MODEL

    def _flush_llm_output(self) -> None:
        """Flush accumulated LLM output to the log file."""
        if not self._llm_call_start_time:
            return  # No pending output
        # Use time from call start to last output event (not wall-clock to next call)
        end_time = self._llm_first_output_time or time.time()
        duration = int((end_time - self._llm_call_start_time) * 1000)
        self._llm_logger.log_output(
            text=self._llm_output_text,
            tool_calls=self._llm_output_tool_calls,
            thinking=self._llm_output_thinking,
            duration_ms=duration,
        )
        self._llm_output_text = ""
        self._llm_output_thinking = ""
        self._llm_output_tool_calls = []
        self._llm_call_start_time = 0.0
        self._llm_first_output_time = 0.0

    def _send_or_queue(self, msg_type: str, payload: dict) -> None:
        """Send a message via send_message_fn, or queue if unavailable."""
        if self._send_message_fn is not None:
            try:
                self._send_message_fn(msg_type, payload)
                return
            except Exception:
                logger.warning("send_message_fn failed, queuing message")

        # Queue for later delivery (deque with maxlen handles overflow)
        self._message_queue.append((msg_type, payload))

    def _send_agent_result(self, payload: dict) -> None:
        """Send agent_result and log the final response shown to the user."""
        self._llm_logger.log_final_result(
            answer=payload.get("answer", ""),
            steps_taken=payload.get("steps_taken", 0),
            duration_ms=payload.get("duration_ms", 0),
            model=payload.get("model", ""),
            error_code=payload.get("error_code", ""),
        )
        self._send_or_queue("agent_result", payload)

    def flush_queued_messages(self) -> int:
        """Flush queued messages via send_message_fn. Returns count flushed."""
        if not self._send_message_fn or not self._message_queue:
            return 0

        flushed = 0
        while self._message_queue:
            msg_type, payload = self._message_queue.popleft()
            try:
                self._send_message_fn(msg_type, payload)
                flushed += 1
            except Exception:
                # Re-queue at front and stop
                self._message_queue.appendleft((msg_type, payload))
                break
        return flushed

    async def _await_user_confirmation(
        self, tool_name: str, args: dict, reason: str, voice_message: str,
    ) -> bool | None:
        """Send a confirmation request and wait for the user's response.

        Returns True if approved, False if rejected, None if timed out.
        """
        request_id = str(uuid.uuid4())
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._confirmation_futures[request_id] = future

        payload = {
            "request_id": request_id,
            "tool": tool_name,
            "command": args.get("command", str(args)),
            "reason": reason,
            "voice_message": voice_message,
        }
        # Forward extra keys from args (e.g. plan_steps for plan_approval)
        for key in args:
            if key != "command" and key not in payload:
                payload[key] = args[key]
        self._send_or_queue("agent_confirmation_request", payload)

        try:
            approved = await asyncio.wait_for(future, timeout=CONFIRMATION_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.warning("Confirmation timeout for request %s", request_id)
            self._send_or_queue("agent_progress", {
                "step": self._step_counter,
                "tool": tool_name,
                "detail": "User confirmation timed out",
                "status": "failed",
            })
            return None
        finally:
            self._confirmation_futures.pop(request_id, None)

        if not approved:
            self._send_or_queue("agent_progress", {
                "step": self._step_counter,
                "tool": tool_name,
                "detail": "Rejected by user",
                "status": "failed",
            })
        return approved

    async def _before_tool_callback(
        self, tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
    ) -> dict | None:
        """Security gate: classify every tool call via DualToolEvaluator.

        Returns None to proceed with tool execution, or a dict to skip
        the tool and return the dict as the tool result.
        """
        # Check cancellation
        if self._cancelled:
            return {"status": "cancelled", "output": "Execution was cancelled by user."}

        tool_name = tool.name
        self._step_counter += 1

        # Send progress: status=running (include full command for mobile display)
        self._send_or_queue("agent_progress", {
            "step": self._step_counter,
            "tool": tool_name,
            "detail": _summarize_args(tool_name, args),
            "command": args.get("command", ""),
            "status": "running",
            "model": self._get_model_display_name(),
            "backend": self._computer_use_backend,
        })

        # Wire CU sub-step progress so execute_computer_use can update the
        # same mobile entry with real-time feedback (e.g., "CU step 3: click → search bar")
        if tool_name == "execute_computer_use":
            step = self._step_counter
            def cu_progress(detail: str, status: str = "running") -> None:
                self._send_or_queue("agent_progress", {
                    "step": step,
                    "tool": "execute_computer_use",
                    "detail": detail,
                    "status": status,
                })
            set_cu_progress_callback(cu_progress)

        # Start OTel tracing span for this tool call
        try:
            span_cm = tool_span(tool_name, args)
            span = span_cm.__enter__()
            self._active_tool_spans[self._step_counter] = (span_cm, span)
        except Exception:
            logger.debug("Failed to start tool span for %s", tool_name)

        # Reset audit context for this tool call
        self._last_classified_command = args.get("command", "")
        self._last_confirmation_outcome = ""

        # Classify via DualToolEvaluator (MANDATORY security gate)
        try:
            result = await self._evaluator.classify(tool_name, args)
        except Exception:
            logger.exception("DualToolEvaluator.classify() failed for tool '%s'", tool_name)
            self._send_or_queue("agent_progress", {
                "step": self._step_counter,
                "tool": tool_name,
                "detail": "Classification failed",
                "status": "failed",
            })
            self._last_confirmation_outcome = "error"
            return {
                "status": "error",
                "output": "Security classification failed. Skipping this tool call.",
            }

        # Destructive host commands: require user confirmation but execute on host
        if result.require_confirmation and result.route == "host":
            approved = await self._await_user_confirmation(
                tool_name, args, result.reason, result.voice_message,
            )
            if approved is None:
                self._last_confirmation_outcome = "timeout"
                return {"status": "timeout", "output": "User confirmation timed out. Skipping this command."}
            if approved:
                self._last_confirmation_outcome = "force_host"
                return None  # Proceed with HOST execution
            # User rejected destructive command
            self._last_confirmation_outcome = "user_cancelled"
            return {
                "status": "rejected",
                "output": "User cancelled destructive command.",
                "voice_message": "OK, I won't run that command.",
                "execution_result": "user_cancelled",
            }

        if result.route == "host":
            # Safe — proceed with tool execution
            return None

        # Sandbox route — request confirmation from user
        approved = await self._await_user_confirmation(
            tool_name, args, result.reason, result.voice_message,
        )
        if approved is None:
            self._last_confirmation_outcome = "timeout"
            return {"status": "timeout", "output": "User confirmation timed out. Skipping this command."}
        if approved:
            # User approved — execute in sandbox (NOT on host)
            self._last_confirmation_outcome = "sandboxed"
            command = args.get("command", str(args))
            sandbox_result = await execute_cli_sandboxed(command)
            # M1: Track sandbox execution in action history (mirrors _after_tool_callback)
            sandbox_status = sandbox_result.get("status", "success") if isinstance(sandbox_result, dict) else "success"
            if sandbox_status != "error":
                entry = {
                    "step": self._step_counter,
                    "tool": tool_name,
                    "args": args,
                    "result_summary": str(sandbox_result)[:500] if sandbox_result else "",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "undoable_hint": "check_command",
                    "sandboxed": True,
                }
                self._action_history.append(entry)
            return sandbox_result  # Return result directly — skips normal tool execution
        # User rejected
        self._last_confirmation_outcome = "user_cancelled"
        return {
            "status": "rejected",
            "output": "User rejected this command. Try an alternative approach.",
        }

    async def _after_tool_callback(
        self,
        tool: BaseTool,
        args: dict[str, Any],
        tool_context: ToolContext,
        tool_response: dict,
    ) -> dict | None:
        """Progress reporter: send agent_progress with completed/failed + output."""
        tool_name = tool.name
        # Clear CU sub-step callback after execute_computer_use completes
        if tool_name == "execute_computer_use":
            set_cu_progress_callback(None)
        if isinstance(tool_response, dict) and tool_response.get("status") == "error":
            status = "failed"
        elif isinstance(tool_response, dict) and tool_response.get("status") == "rejected":
            status = "cancelled"
        else:
            status = "completed"

        # Determine execution_result: use confirmation outcome if set,
        # otherwise derive from tool_response status (shared by payload + audit)
        if self._last_confirmation_outcome:
            audit_result = self._last_confirmation_outcome
        elif isinstance(tool_response, dict):
            audit_result = tool_response.get("status", status)
        else:
            audit_result = status

        # Use actual_backend from tool response if available (reflects vision fallback)
        actual_backend = self._computer_use_backend
        if isinstance(tool_response, dict) and tool_response.get("actual_backend"):
            actual_backend = tool_response["actual_backend"]

        payload: dict[str, Any] = {
            "step": self._step_counter,
            "tool": tool_name,
            "detail": _summarize_args(tool_name, args),
            "command": args.get("command", ""),
            "status": status,
            "classified_command": self._last_classified_command,
            "execution_result": audit_result,
            "model": self._get_model_display_name(),
            "backend": actual_backend,
        }

        # Include tool output for mobile display (truncated to keep payload small)
        if isinstance(tool_response, dict):
            stdout = tool_response.get("stdout", "") or ""
            stderr = tool_response.get("stderr", "") or ""
            payload["stdout"] = stdout[:2000]
            payload["stderr"] = stderr[:500]
            payload["exit_code"] = tool_response.get("exit_code")
            payload["duration_ms"] = tool_response.get("duration_ms")

            # For observe_screen, include the clean screenshot for mobile display
            # (raw_image_b64 = no debug overlay; image_b64 = annotated for LLM)
            mobile_image = tool_response.get("raw_image_b64") or tool_response.get("image_b64")
            if mobile_image:
                payload["image_b64"] = mobile_image

        # Log truncated tool output to server.log for debugging
        if isinstance(tool_response, dict):
            _log_parts = []
            for _k in ("status", "stdout", "stderr", "exit_code", "ui_elements", "description", "needs_llm_vision", "intent"):
                if _k in tool_response:
                    _v = tool_response[_k]
                    _v_str = str(_v)
                    if len(_v_str) > 500:
                        _v_str = _v_str[:500] + "...[truncated]"
                    _log_parts.append(f"{_k}={_v_str}")
            if _log_parts:
                logger.info("Tool %s output: %s", tool_name, " | ".join(_log_parts))

        self._send_or_queue("agent_progress", payload)

        # Append to action history for undo capability (subtasks 1.2, 1.3, 1.5)
        if status == "completed":
            undoable_hints = {
                "execute_cli": "check_command",
                "execute_gui": "ctrl_z",
                "execute_accessible": "no_undo",
                "execute_computer_use": "ctrl_z",
                "execute_browser": "check_command",
                "observe_screen": "no_op",
                "get_ui_context": "no_op",
                "maximize_active_window": "no_op",
                "wait": "no_op",
                "get_action_history": "no_op",
                "read_file": "no_op",
                "edit_file": "check_command",
                "find_files": "no_op",
                "window_list": "no_op",
                "window_focus": "no_op",
                "resize_window": "no_op",
                "clipboard_read": "no_op",
                "clipboard_write": "no_op",
                "read_pdf": "no_op",
                "read_image": "no_op",
                "read_excel": "no_op",
                "write_excel": "check_command",
                "process_info": "no_op",
                "system_info": "no_op",
                "download_file": "check_command",
                "save_dialog": "ctrl_z",
                "open_dialog": "no_op",
                "find_and_replace_in_files": "check_command",
                "launch_app": "no_op",
                "install_app": "no_op",
                "close_app": "no_op",
                "app_menu": "ctrl_z",
                "copy_between_apps": "ctrl_z",
                "fill_form": "ctrl_z",
                "extract_text": "no_op",
                "set_env_var": "no_op",
                "change_setting": "no_op",
                "execute_skill": "no_undo",
                "load_skill": "no_op",
                "create_skill": "no_undo",
                "edit_skill": "no_undo",
            }
            result_summary = str(tool_response)[:500] if tool_response else ""
            entry = {
                "step": self._step_counter,
                "tool": tool_name,
                "args": args,
                "result_summary": result_summary,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "undoable_hint": undoable_hints.get(tool_name, "no_op"),
            }
            self._action_history.append(entry)

        # Audit log: fire-and-forget JSONL entry (Story 4.1)
        try:
            await audit_logger.log(
                session_id=self._session_id or "",
                user_prompt=self._current_intent,
                classified_command=self._last_classified_command,
                tool_used=tool_name,
                execution_result=audit_result,
                voice_message=tool_response.get("voice_message", "") if isinstance(tool_response, dict) else "",
                duration_ms=tool_response.get("duration_ms", 0) if isinstance(tool_response, dict) else 0,
            )
        except Exception:
            logger.exception("Audit logging failed (fire-and-forget)")

        # End OTel tracing span for this tool call
        span_entry = self._active_tool_spans.pop(self._step_counter, None)
        if span_entry:
            span_cm, span = span_entry
            try:
                if span:
                    span.set_attribute("tool.status", status)
                    if isinstance(tool_response, dict):
                        span.set_attribute("tool.duration_ms", tool_response.get("duration_ms", 0))
                # Pass error info if tool failed so the span records the failure
                if status == "failed":
                    span_cm.__exit__(type(Exception), Exception(f"Tool {tool_name} failed"), None)
                else:
                    span_cm.__exit__(None, None, None)
            except Exception:
                logger.debug("Failed to end tool span for %s", tool_name)

        logger.info(
            "Tool %s step %d %s", tool_name, self._step_counter, status
        )

        # Strip large image blobs from tool responses before ADK persists them
        # to SQLite. The LLM already received text descriptions from vision
        # backends; raw screenshots (200KB+) would bloat the DB rapidly.
        if isinstance(tool_response, dict):
            tool_response.pop("image_b64", None)
            tool_response.pop("raw_image_b64", None)
            return tool_response

        return None  # Don't modify result

    async def _before_model_callback(self, callback_context, llm_request):
        """Strip image data from tool responses and handle LLM vision fallback.

        Screenshots are processed by vision backends (UI-TARS, OmniParser, etc.)
        and the LLM receives only text descriptions. Images are stripped from
        tool responses to avoid bloating the context.

        Only when no vision backend is available (needs_llm_vision=True) is the
        raw screenshot injected as an inline image Part for the LLM to interpret
        directly. This should be rare.

        For non-Gemini models (LiteLlm), skip image injection entirely — LiteLlm
        handles image content via its own content format.
        """
        # ── LLM Logger: flush previous output, log this call's input ──
        # Skip when routing through CLI proxy — the proxy-side llm-sub log
        # captures the actual model I/O (spawn command, raw prompt, raw response).
        if not self._is_cli_proxy:
            self._flush_llm_output()
            self._llm_call_start_time = time.time()
            self._llm_first_output_time = 0.0
        try:
            # Parse system prompt
            si = ""
            if llm_request.config and llm_request.config.system_instruction:
                raw_si = llm_request.config.system_instruction
                si = raw_si if isinstance(raw_si, str) else str(raw_si)

            # Parse message contents into readable format
            parsed_msgs: list[dict] = []
            for content in (llm_request.contents or []):
                if not content or not content.parts:
                    continue
                role = getattr(content, "role", "?")
                for part in content.parts:
                    msg: dict = {"role": role}
                    if part.text:
                        is_thought = getattr(part, "thought", False)
                        msg["role"] = f"{role}/thinking" if is_thought else role
                        msg["text"] = part.text
                    elif part.function_call:
                        fc = part.function_call
                        msg["role"] = f"{role}/tool_call"
                        msg["tool_name"] = fc.name
                        msg["tool_args"] = dict(fc.args) if fc.args else {}
                        msg["text"] = f"→ {fc.name}()"
                    elif part.function_response:
                        fr = part.function_response
                        msg["role"] = f"{role}/tool_result"
                        msg["tool_name"] = fr.name
                        resp = fr.response
                        if isinstance(resp, dict):
                            msg["tool_result"] = resp
                            msg["text"] = f"← {fr.name} result"
                        else:
                            msg["text"] = str(resp)[:500] if resp else "(empty)"
                    elif hasattr(part, "inline_data") and part.inline_data:
                        msg["text"] = f"[inline image: {getattr(part.inline_data, 'mime_type', '?')}]"
                    else:
                        continue
                    parsed_msgs.append(msg)

            if not self._is_cli_proxy:
                self._llm_logger.log_input(
                    model=self._get_model_display_name(),
                    system_prompt_preview=si,
                    messages=parsed_msgs,
                )
        except Exception:
            logger.debug("LLM input logging failed", exc_info=True)
        # Non-Gemini models use LiteLlm — apply token limits, thinking config,
        # and (for CLI proxy only) prompt sanitization and image stripping.
        if isinstance(self._agent.model, LiteLlm):
            from core.memory_processors import ToolCallFilter, TokenLimiter
            llm_request.contents = ToolCallFilter().process(llm_request.contents)
            llm_request.contents = TokenLimiter().process(llm_request.contents)

            if self._is_cli_proxy:
                # CLI proxies cannot receive base64 images — strip image data
                # from observe_screen responses and replace with a text notice
                # so the LLM knows vision fallback is unavailable.
                for content in (llm_request.contents or []):
                    if not content or not content.parts:
                        continue
                    for part in content.parts:
                        if (
                            part.function_response
                            and part.function_response.name == "observe_screen"
                            and isinstance(part.function_response.response, dict)
                        ):
                            resp = part.function_response.response
                            needs_fallback = resp.pop("needs_llm_vision", False)
                            resp.pop("image_b64", None)
                            resp.pop("raw_image_b64", None)
                            if needs_fallback:
                                resp["vision_notice"] = (
                                    "No vision backend processed this screenshot and "
                                    "direct image analysis is unavailable in subscription mode. "
                                    "Use get_ui_context (accessibility tree) or execute_browser "
                                    "action=snapshot instead."
                                )

                # Sanitize the system prompt for CLI providers to avoid
                # triggering injection/safety guardrails in claude -p / gemini CLI.
                si = llm_request.config.system_instruction
                if isinstance(si, str) and si:
                    # Line 1: Strip Contop identity
                    si = si.replace(
                        "You are Contop's desktop execution agent.",
                        "You are a desktop automation agent.",
                    )
                    # Section A: Multi-agent identity → neutral third-person
                    si = si.replace(
                        "You are one half of a two-agent system:",
                        "The system uses a two-agent architecture:",
                    )
                    si = si.replace(
                        "- **You (desktop agent)** — run on the host machine. You execute commands, interact with the GUI, and capture the screen.",
                        "- **Desktop agent** — runs on the host machine. Executes commands, interacts with the GUI, and captures the screen.",
                    )
                    si = si.replace(
                        "- **Mobile agent** — runs on the user's phone. It handles conversation and routing. It decides when to dispatch tasks to you. Your output is displayed directly to the user on their phone.",
                        "- **Mobile agent** — handles conversation and routing. Decides when to dispatch tasks to the desktop agent.",
                    )
                    # Section B: Blind execution framing → neutral
                    si = si.replace(
                        "You receive a text message describing the task, you execute it, and you return a concise summary of what you did. Your output goes straight to the user — be clear, factual, and well-structured.",
                        "The desktop agent receives task descriptions, executes them, and returns a concise summary. Output should be clear, factual, and well-structured.",
                    )
                    # Section C: Strip "## Conversation Context" section entirely —
                    # it instructs the model to parse embedded structured instructions
                    # inside user messages, which looks like prompt injection to CLIs.
                    si = re.sub(
                        r'## Conversation Context\n.*?(?=\n## )',
                        '',
                        si,
                        flags=re.DOTALL,
                    )
                    llm_request.config.system_instruction = si

            # Apply thinking for LiteLlm — BuiltInPlanner only works for native
            # Gemini, so we inject the thinking config directly on the request.
            if self._thinking_enabled:
                llm_request.config.thinking_config = genai_types.ThinkingConfig(
                    include_thoughts=True,
                )
            else:
                llm_request.config.thinking_config = None
            return None

        import base64 as b64

        # Track the latest observe_screen that needs LLM vision fallback
        fallback_image_b64: str | None = None
        fallback_content_idx: int = -1

        for ci, content in enumerate(llm_request.contents or []):
            if not content or not content.parts:
                continue

            filtered_parts = []
            for part in content.parts:
                # Strip previously-injected inline JPEG Parts
                if (
                    hasattr(part, "inline_data")
                    and part.inline_data
                    and getattr(part.inline_data, "mime_type", "") == "image/jpeg"
                ):
                    continue  # Drop old screenshot

                filtered_parts.append(part)

                # Strip image_b64 from observe_screen responses — LLM doesn't need it
                # unless needs_llm_vision is set (no vision backend available)
                if (
                    part.function_response
                    and part.function_response.name == "observe_screen"
                    and isinstance(part.function_response.response, dict)
                ):
                    resp = part.function_response.response
                    needs_fallback = resp.pop("needs_llm_vision", False)
                    image_b64 = resp.pop("image_b64", None)
                    resp.pop("raw_image_b64", None)

                    if needs_fallback and image_b64:
                        # No vision backend processed this — LLM must see the image
                        intent_text = resp.pop("intent", "")
                        resp["image_b64"] = "[screenshot attached as image below]"
                        if intent_text:
                            resp["intent"] = intent_text
                        fallback_image_b64 = image_b64
                        fallback_content_idx = ci
                    elif image_b64:
                        # Vision backend already processed it — LLM has the text
                        resp["image_b64"] = "[processed by vision backend — see ui_elements]"

            content.parts = filtered_parts

        # Inject screenshot only for LLM vision fallback (rare)
        if fallback_image_b64 and fallback_content_idx >= 0:
            try:
                image_bytes = b64.b64decode(fallback_image_b64)
                image_part = genai_types.Part.from_bytes(
                    data=image_bytes, mime_type="image/jpeg"
                )
                llm_request.contents[fallback_content_idx].parts.append(image_part)
                logger.info(
                    "LLM vision fallback: injected screenshot (%d bytes)",
                    len(image_bytes),
                )
            except Exception:
                logger.exception("Failed to decode fallback screenshot")

        # Memory processors — strip verbose fields and limit tokens
        from core.memory_processors import ToolCallFilter, TokenLimiter
        llm_request.contents = ToolCallFilter().process(llm_request.contents)
        llm_request.contents = TokenLimiter().process(llm_request.contents)

        return None  # Proceed with model call

    def resolve_confirmation(self, request_id: str, approved: bool) -> None:
        """Resolve a pending confirmation future from a user response."""
        future = self._confirmation_futures.get(request_id)
        if future and not future.done():
            future.set_result(approved)
        else:
            logger.warning("No pending confirmation for request_id=%s", request_id)

    def cancel(self) -> None:
        """Set the cancellation flag to stop the agent loop.

        Also rejects any pending confirmation futures so _await_user_confirmation
        unblocks immediately instead of hanging until the 300s timeout.
        """
        self._cancelled = True
        for request_id, future in list(self._confirmation_futures.items()):
            if not future.done():
                future.set_result(False)  # Reject — execution is being cancelled
            self._confirmation_futures.pop(request_id, None)

    def reset_session(self) -> None:
        """Reset the ADK session for a new chat. Clears multi-turn memory."""
        self._session_id = None
        self._action_history.clear()
        # Clean up the session working directory
        if self._session_cwd:
            shutil.rmtree(self._session_cwd, ignore_errors=True)
            self._session_cwd = None
            set_session_cwd(None)
        # Clear the session-scoped CU client
        reset_cu_client()
        # Clear the session-scoped browser client
        set_browser_client(None)
        logger.info("ADK session reset for new chat")

    async def restore_session(self, session_id: str) -> bool:
        """Attempt to restore a previous session from persistent storage.

        Returns True if the session was found and restored, False otherwise.
        Mobile sends the last known session_id on reconnect so the server
        can resume full tool-call history instead of relying on summaries.
        """
        try:
            session = await self._session_service.get_session(
                app_name=APP_NAME,
                user_id=self._user_id,
                session_id=session_id,
            )
            if session is None:
                logger.info("Session %s not found in persistent storage", session_id)
                return False
            self._session_id = session_id
            logger.info("Restored ADK session: %s (%d events)", session_id, len(session.events or []))
            return True
        except Exception:
            logger.exception("Failed to restore session %s", session_id)
            return False


    async def run_intent(
        self,
        text: str,
        send_message_fn: Callable[[str, dict], None],
        model: str | None = None,
        thinking: bool = True,
        conversation_context: str = "",
        computer_use_backend: str = DEFAULT_COMPUTER_USE_BACKEND,
        custom_instructions: str | None = None,
        use_subscription: bool | None = None,
    ) -> None:
        """Process a user intent through the ADK agent loop.

        Args:
            text: The user's intent text.
            send_message_fn: Function to send data channel messages.
            model: Optional model override from mobile settings (e.g. 'gemini-2.5-pro').
            thinking: Whether to enable extended thinking (from mobile settings).
            conversation_context: Recent mobile-side conversation history (turns
                handled locally) so the desktop agent has full context.
            computer_use_backend: GUI automation backend ('omniparser', 'ui_tars',
                or 'gemini_computer_use'). When 'gemini_computer_use', the
                execute_computer_use tool is registered on the agent.
            custom_instructions: Optional additional instructions from the mobile
                user. Appended to the system prompt with priority over defaults.

        Sessions are reused across intents for multi-turn conversation memory.
        The agent uses observe_screen tool to capture the screen when needed.
        """
        if self._running:
            logger.warning("run_intent called while already running — cancelling previous")
            self._cancelled = True
            # Wait for the previous run to release the lock instead of a blind sleep
            async with self._run_lock:
                pass  # Previous run has finished

        async with self._run_lock:
            self._running = True
            self._send_message_fn = send_message_fn
            # Let agent_tools send status messages (e.g. OmniParser loading) to mobile
            set_status_callback(send_message_fn)
            # Wire action history ref for get_action_history tool
            set_action_history_ref(lambda n=5: (list(self._action_history)[-n:], len(self._action_history)) if self._action_history else ([], 0))

            # Create a session-scoped working directory so files created by one
            # execute_cli call persist for subsequent calls in the same session.
            if self._session_cwd is None:
                self._session_cwd = tempfile.mkdtemp(prefix="contop_session_")
                logger.info("Created session working directory: %s", self._session_cwd)
            set_session_cwd(self._session_cwd)

            # Use the model selected by the user on mobile
            if model:
                from core.settings import get_proxy_url
                resolved_model = model
                litellm_kwargs: dict = {}

                # Mobile tells us whether to use subscription (CLI proxy) mode.
                # Both modes are always available — the mobile user picks which
                # to use per request based on their preference and availability.
                if use_subscription:
                    if model.startswith("anthropic/"):
                        resolved_model = "openai/" + model.split("/", 1)[1]
                        litellm_kwargs = {
                            "api_base": get_proxy_url("anthropic").rstrip("/") + "/v1",
                            "api_key": "sk-proxy-placeholder",
                            "effort": "max" if thinking else "low",
                        }
                    elif model.startswith("openai/"):
                        litellm_kwargs = {
                            "api_base": get_proxy_url("openai").rstrip("/") + "/v1",
                            "api_key": "sk-proxy-placeholder",
                        }
                    elif not model.startswith(("openai/", "anthropic/", "openrouter/")):
                        # Gemini models (no prefix) — route via LiteLLM's OpenAI handler
                        resolved_model = "openai/" + model
                        litellm_kwargs = {
                            "api_base": get_proxy_url("gemini").rstrip("/") + "/v1",
                            "api_key": "sk-proxy-placeholder",
                        }
                    if litellm_kwargs:
                        logger.info("Subscription mode: routing %s via CLI proxy → %s", model, litellm_kwargs.get("api_base"))

                self._is_cli_proxy = bool(litellm_kwargs.get("api_base"))
                self._agent.model = _resolve_model(resolved_model, **litellm_kwargs)
                logger.info("Using mobile-selected model: %s (resolved: %s, cli_proxy: %s)", model, resolved_model, self._is_cli_proxy)
            else:
                self._is_cli_proxy = False
                self._agent.model = EXECUTION_AGENT_MODEL
                logger.info("No model specified by mobile, using fallback: %s", EXECUTION_AGENT_MODEL)

            # Clear stale dynamic skill tool registrations before rediscovery (F6/F12)
            self._evaluator.reset_skill_tools()

            # Discover enabled skills and build prompt section
            from core.agent_config import get_execution_system_prompt
            from google.adk.tools import FunctionTool
            enabled_skills = discover_skills(get_skills_dir(), get_enabled_skills())
            skills_prompt = build_skills_prompt_section(enabled_skills)

            # Update system prompt per-request (picks up desktop overrides + mobile custom instructions + skills)
            self._agent.instruction = get_execution_system_prompt(
                custom_instructions, skills_prompt=skills_prompt,
                computer_use_backend=computer_use_backend,
            )

            # Dynamically adjust tool list based on computer use backend.
            # When Gemini CU is selected, it handles screenshots + actions internally,
            # so the agent should NOT also have observe_screen / execute_gui (which
            # would cause duplicate actions — e.g. opening two Chrome tabs).
            #
            # When the backend changes mid-session, the ADK session must be reset
            # because the LLM's conversation history references tools that may no
            # longer exist (e.g. execute_computer_use after switching to ui_tars),
            # causing "Function X is not found in the tools_dict" errors.
            if computer_use_backend != self._computer_use_backend:
                logger.info(
                    "CU backend changed %s → %s — resetting ADK session",
                    self._computer_use_backend, computer_use_backend,
                )
                self._session_id = None
                self._action_history.clear()
                reset_cu_client()

            # Common tools available in all backends.
            # Advanced workflow tools (fill_form, extract_text, copy_between_apps,
            # set_env_var, change_setting, app_menu, install_app,
            # find_and_replace_in_files) are loaded on-demand via the
            # "advanced-workflows" skill to reduce baseline context.
            _common_tools = [read_file, edit_file, find_files, window_list, window_focus, resize_window, clipboard_read, clipboard_write, read_pdf, read_image, read_excel, write_excel, process_info, system_info, download_file, save_dialog, open_dialog, launch_app, close_app, create_skill, edit_skill, generate_plan]

            # Append skill tools if any skills are enabled
            has_enabled_skills = any(s.enabled for s in enabled_skills)
            if has_enabled_skills:
                _common_tools.append(execute_skill)
                _common_tools.append(load_skill)
                # Track registered tool names to detect duplicates
                _registered_tool_names = {t.__name__ if hasattr(t, '__name__') else t.name for t in _common_tools}
                # Load Model C (Python) tools from enabled skills
                for skill in enabled_skills:
                    if skill.enabled and skill.skill_type in ("python", "mixed"):
                        py_tools = load_python_tools(skill.path)
                        for fn in py_tools:
                            if fn.__name__ in _registered_tool_names:
                                logger.warning(
                                    "Skill '%s' defines tool '%s' which conflicts with an existing tool — skipping",
                                    skill.name, fn.__name__,
                                )
                                continue
                            _registered_tool_names.add(fn.__name__)
                            _common_tools.append(FunctionTool(fn))
                            self._evaluator.register_skill_tools({fn.__name__})
                logger.info("Skills enabled: %d tools added", sum(1 for s in enabled_skills if s.enabled))

            # Configure vision grounding backend for observe_screen
            set_vision_backend(computer_use_backend)

            if computer_use_backend == "gemini_computer_use":
                self._agent.tools = [execute_computer_use, execute_cli, execute_browser, wait, get_action_history] + _common_tools
                logger.info("Gemini Computer Use backend — agent has %d tools", len(self._agent.tools))
            elif computer_use_backend == "accessibility":
                # Hybrid: accessibility tree + vision fallback (observe_screen uses UI-TARS, not OmniParser)
                self._agent.tools = [execute_cli, execute_accessible, execute_gui, execute_browser, observe_screen, get_ui_context, maximize_active_window, wait, get_action_history] + _common_tools
                logger.info("Accessibility backend — agent has %d tools", len(self._agent.tools))
            else:
                self._agent.tools = [execute_cli, execute_accessible, execute_gui, execute_browser, observe_screen, get_ui_context, maximize_active_window, wait, get_action_history] + _common_tools
                logger.info("Backend %s — agent has %d tools", computer_use_backend, len(self._agent.tools))
            self._computer_use_backend = computer_use_backend

            # Apply thinking config via BuiltInPlanner (ADK requires this path)
            self._thinking_enabled = thinking
            if thinking:
                self._agent.planner = BuiltInPlanner(
                    thinking_config=genai_types.ThinkingConfig(include_thoughts=True),
                )
            else:
                self._agent.planner = None
            self._cancelled = False
            self._step_counter = 0
            self._action_history_start = len(self._action_history)
            self._start_time = time.time()
            self._current_intent = text  # Store for audit logging

            # Flush any messages queued during disconnect/reconnect
            flushed = self.flush_queued_messages()
            if flushed:
                logger.info("Flushed %d queued messages on new intent", flushed)

            # Build user message — include mobile conversation context so the desktop
            # agent knows about turns handled locally (e.g. user's name, prior discussion).
            if conversation_context:
                full_text = (
                    f"[Prior conversation for context]\n{conversation_context}\n\n"
                    f"[Current request]\n{text}"
                )
                logger.info(
                    "Conversation context included: %d chars, %d lines",
                    len(conversation_context),
                    conversation_context.count("\n") + 1,
                )
            else:
                full_text = text
                logger.info("No conversation context provided for this intent")
            user_message = genai_types.Content(
                role="user",
                parts=[genai_types.Part.from_text(text=full_text)],
            )

            # Reuse session across intents for multi-turn conversation memory
            if self._session_id is None:
                self._session_id = str(uuid.uuid4())
                await self._session_service.create_session(
                    app_name=APP_NAME,
                    user_id=self._user_id,
                    session_id=self._session_id,
                )
                logger.info("Created new ADK session: %s", self._session_id)
                # Initialize LLM call logger (API mode only).
                # In sub mode, all I/O is logged by the CLI proxy's llm-sub log.
                if not use_subscription:
                    self._llm_logger.init(
                        session_id=self._session_id,
                        model=self._get_model_display_name(),
                    )
                # Audit: session start — only on new session (Task 4.1)
                await audit_logger.log_session_start(session_id=self._session_id)

            # Set planning context so generate_plan tool can access agent state
            set_plan_context({
                "model": self._agent.model,
                "tools": self._agent.tools,
                "send_fn": self._send_or_queue,
                "confirm_fn": self._await_user_confirmation,
                "thinking_config": genai_types.ThinkingConfig(include_thoughts=True) if self._thinking_enabled else None,
            })

            with agent_span(text) as _agent_span:
                try:
                    logger.info(
                        "run_intent starting: model=%s, thinking=%s, text=%s, session=%s",
                        self._agent.model, self._thinking_enabled, text[:80], self._session_id[:8],
                    )
                    final_text = ""
                    event_iter = self._runner.run_async(
                        user_id=self._user_id,
                        session_id=self._session_id,
                        new_message=user_message,
                        run_config=RunConfig(
                            max_llm_calls=MAX_ITERATIONS,
                            streaming_mode=StreamingMode.SSE,
                        ),
                    ).__aiter__()
                    while True:
                        # Total wall-clock cap per intent
                        elapsed = time.time() - self._start_time
                        if elapsed > MAX_EXECUTION_TIME:
                            logger.warning(
                                "Total execution time exceeded %ds — aborting",
                                MAX_EXECUTION_TIME,
                            )
                            try:
                                await event_iter.aclose()
                            except Exception:
                                pass
                            duration_ms = int(elapsed * 1000)
                            self._send_agent_result({
                                "answer": f"Execution stopped — reached the {MAX_EXECUTION_TIME // 60}-minute time limit. The task may be partially complete.",
                                "steps_taken": self._step_counter,
                                "duration_ms": duration_ms,
                                "error_code": "timeout",
                                "session_id": self._session_id,
                                "model": self._get_model_display_name(),
                                "backend": self._computer_use_backend,
                            })
                            self._running = False
                            set_status_callback(None)
                            set_action_history_ref(None)
                            return

                        try:
                            event = await asyncio.wait_for(
                                event_iter.__anext__(), timeout=LLM_CALL_TIMEOUT,
                            )
                        except StopAsyncIteration:
                            break
                        except asyncio.TimeoutError:
                            logger.warning(
                                "LLM call timed out after %ds — aborting execution",
                                LLM_CALL_TIMEOUT,
                            )
                            # Clean up the async generator to avoid resource leaks
                            try:
                                await event_iter.aclose()
                            except Exception:
                                pass
                            duration_ms = int((time.time() - self._start_time) * 1000)
                            self._send_agent_result({
                                "answer": "The AI model took too long to respond. Please try again or use a different model.",
                                "steps_taken": self._step_counter,
                                "duration_ms": duration_ms,
                                "error_code": "timeout",
                                "session_id": self._session_id,
                                "model": self._get_model_display_name(),
                                "backend": self._computer_use_backend,
                            })
                            self._running = False
                            set_status_callback(None)
                            set_action_history_ref(None)
                            return

                        logger.debug("ADK event: author=%s, is_final=%s, actions=%s", getattr(event, 'author', '?'), event.is_final_response(), getattr(event, 'actions', None))

                        # Log thinking for server-side debugging; don't send to mobile
                        # (mobile only shows tool execution steps, not verbose reasoning)
                        if event.content and event.content.parts:
                            for part in event.content.parts:
                                is_thought = getattr(part, "thought", False)
                                if is_thought and part.text:
                                    logger.info("Thinking: %s", part.text[:200])
                                    # ── LLM Logger: accumulate thinking ──
                                    if not self._is_cli_proxy:
                                        self._llm_output_thinking += part.text

                        # ── LLM Logger: accumulate model output (API mode only) ──
                        if not self._is_cli_proxy and event.content and event.content.parts:
                            if not self._llm_first_output_time:
                                self._llm_first_output_time = time.time()
                            for part in event.content.parts:
                                if part.text and not getattr(part, "thought", False):
                                    self._llm_output_text += part.text
                                elif part.function_call:
                                    fc = part.function_call
                                    self._llm_output_tool_calls.append({
                                        "name": fc.name,
                                        "args": dict(fc.args) if fc.args else {},
                                    })

                        if event.is_final_response() and event.content and event.content.parts:
                            for part in event.content.parts:
                                if part.text and not getattr(part, "thought", False):
                                    final_text += part.text

                    duration_ms = int((time.time() - self._start_time) * 1000)
                    if _agent_span:
                        _agent_span.set_attribute("agent.steps_taken", self._step_counter)
                        _agent_span.set_attribute("agent.duration_ms", duration_ms)

                    # Parse suggested_actions from agent response
                    suggested_actions, clean_text = _extract_suggested_actions(final_text or "")

                    # Build tool_summary for mobile's chatHistoryRef so the
                    # conversation agent can reference tool specifics later.
                    # Only include actions from the current intent (not prior intents).
                    tool_summary = []
                    current_actions = list(self._action_history)[self._action_history_start:]
                    for entry in current_actions:
                        tool_summary.append(f"Called: {entry['tool']}({json.dumps(entry['args'], default=str)[:200]})")
                        if entry.get("result_summary"):
                            tool_summary.append(f"Result: {entry['result_summary'][:200]}")

                    logger.info(
                        "Agent result: session=%s, steps=%d, tool_summary=%d entries",
                        self._session_id, self._step_counter, len(tool_summary),
                    )

                    self._send_agent_result({
                        "answer": clean_text or "Task completed.",
                        "steps_taken": self._step_counter,
                        "duration_ms": duration_ms,
                        "suggested_actions": suggested_actions,
                        "tool_summary": tool_summary,
                        "session_id": self._session_id,
                        "model": self._get_model_display_name(),
                        "backend": self._computer_use_backend,
                    })

                except asyncio.CancelledError:
                    logger.info("run_intent cancelled (user requested stop)")
                    duration_ms = int((time.time() - self._start_time) * 1000)
                    self._send_agent_result({
                        "answer": "Execution cancelled.",
                        "steps_taken": self._step_counter,
                        "duration_ms": duration_ms,
                        "session_id": self._session_id,
                        "model": self._get_model_display_name(),
                        "backend": self._computer_use_backend,
                    })
                    raise  # Re-raise to preserve asyncio cancellation semantics
                except Exception as exc:
                    logger.exception("ExecutionAgent.run_intent() failed")
                    duration_ms = int((time.time() - self._start_time) * 1000)
                    error_code, user_message_text = _classify_model_error(exc)
                    model_name = self._get_model_display_name()
                    # Surface the failed model attempt so the user sees which model errored
                    self._send_or_queue("agent_status", {
                        "type": "model_error",
                        "message": f"Failed: {model_name} ({error_code})",
                    })
                    self._send_agent_result({
                        "answer": user_message_text,
                        "steps_taken": self._step_counter,
                        "duration_ms": duration_ms,
                        "error_code": error_code,
                        "session_id": self._session_id,
                        "model": model_name,
                        "backend": self._computer_use_backend,
                    })
                finally:
                    # ── LLM Logger: flush any remaining output ──
                    self._flush_llm_output()
                    # Audit: session end (Task 4.2)
                    end_duration_ms = int((time.time() - self._start_time) * 1000)
                    await audit_logger.log_session_end(
                        session_id=self._session_id or "",
                        total_steps=self._step_counter,
                        duration_ms=end_duration_ms,
                    )
                    self._running = False
                    set_status_callback(None)
                    set_action_history_ref(None)


def _classify_model_error(exc: Exception) -> tuple[str, str]:
    """Classify an exception into an error code and user-friendly message.

    Uses structured exception attributes (status_code, grpc code) when available,
    falling back to targeted string matching to avoid false positives.
    """
    exc_type = type(exc).__name__
    exc_str = str(exc).lower()

    # ── Structured status code (litellm, httpx, google-api-core) ──
    status_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(status_code, int):
        if status_code == 429:
            return "rate_limit", "The AI model is currently rate-limited. Please wait a moment and try again."
        if status_code == 401:
            return "auth_error", "There's an issue with the AI model API key. Please check your API key in settings."
        if status_code == 403:
            # Distinguish content-safety 403 from auth 403
            if any(k in exc_str for k in ("safety", "content_filter", "harm", "blocked")):
                return "content_blocked", "The request was blocked by the model's safety filters. Try rephrasing your request."
            return "auth_error", "There's an issue with the AI model API key or permissions. Please check settings."
        if status_code == 404:
            return "model_not_found", "The selected AI model was not found. Please check your model selection in settings."
        if status_code in (500, 502, 503, 504):
            return "server_error", "The AI model service is temporarily unavailable. Please try again in a moment."

    # ── Content safety / blocked (before auth to avoid shadowing) ──
    if any(k in exc_str for k in ("safety", "content_filter", "harm_category", "blocked_reason", "recitation", "finish_reason: safety")):
        return "content_blocked", "The request was blocked by the model's safety filters. Try rephrasing your request."

    # ── Rate limiting (explicit parens for clarity) ──
    if ("rate" in exc_str and "limit" in exc_str) or "resource_exhausted" in exc_str:
        return "rate_limit", "The AI model is currently rate-limited. Please wait a moment and try again."

    # ── Authentication / API key ──
    if any(k in exc_str for k in ("unauthenticated", "permission_denied", "invalid api key", "invalid_api_key")):
        return "auth_error", "There's an issue with the AI model API key. Please check your API key in settings."

    # ── Quota / billing (specific phrases to avoid matching "insufficient permissions") ──
    if any(k in exc_str for k in ("quota exceeded", "billing", "payment required", "insufficient_quota")):
        return "quota_exceeded", "Your API quota has been exceeded. Please check your billing or usage limits."

    # ── Model not found (specific phrases, not bare "not found" or "404") ──
    if any(k in exc_str for k in ("model not found", "model_not_found", "invalid model", "model does not exist")):
        return "model_not_found", "The selected AI model was not found. Please check your model selection in settings."

    # ── Timeout ──
    if "timeout" in exc_str or "timed out" in exc_str or exc_type in ("TimeoutError", "ReadTimeout", "ConnectTimeout"):
        return "timeout", "The AI model took too long to respond. Please try again."

    # ── Context length exceeded ──
    if any(k in exc_str for k in ("context length", "token limit", "max_tokens exceeded", "context_length_exceeded")):
        return "context_length", "The conversation is too long for the model. Try starting a new session."

    # ── Network / connection (exception types + specific phrases) ──
    if exc_type in ("ConnectionError", "ConnectError", "NetworkError", "DNSError", "SSLError"):
        return "network_error", "Could not reach the AI model service. Please check your internet connection."
    if any(k in exc_str for k in ("connection refused", "name resolution", "unreachable", "connection reset")):
        return "network_error", "Could not reach the AI model service. Please check your internet connection."

    # ── Server-side errors (phrases, not bare numbers) ──
    if any(k in exc_str for k in ("internal server error", "service unavailable", "bad gateway", "server overloaded")):
        return "server_error", "The AI model service is temporarily unavailable. Please try again in a moment."

    # ── Generic fallback ──
    return "unknown_error", "An error occurred while processing your request. Please try again."


_SUGGESTED_ACTIONS_RE = re.compile(
    r"```suggested_actions\s*\n(.*?)\n```",
    re.DOTALL,
)


def _extract_suggested_actions(text: str) -> tuple[list[dict], str]:
    """Extract suggested_actions JSON block from agent response text.

    Returns (actions_list, cleaned_text) where cleaned_text has the block removed.
    On parse failure, returns ([], original_text).
    """
    match = _SUGGESTED_ACTIONS_RE.search(text)
    if not match:
        return [], text

    try:
        actions = json.loads(match.group(1))
        if not isinstance(actions, list):
            return [], text
        # Validate and cap at 4
        valid = []
        for entry in actions[:4]:
            if isinstance(entry, dict) and "label" in entry and "action" in entry and "payload" in entry:
                valid.append(entry)
        clean_text = text[:match.start()].rstrip() + text[match.end():].lstrip()
        return valid, clean_text
    except (json.JSONDecodeError, TypeError):
        logger.debug("Failed to parse suggested_actions from agent response")
        return [], text


def _summarize_args(tool_name: str, args: dict) -> str:
    """Create a brief description of tool call args for progress messages."""
    if tool_name == "execute_cli":
        cmd = args.get("command", "")
        return f"Running: {cmd[:80]}..." if len(cmd) > 80 else f"Running: {cmd}"
    if tool_name == "execute_gui":
        action = args.get("action", "")
        target = args.get("target", "")
        return f"{action} on {target}"
    if tool_name == "execute_accessible":
        action = args.get("action", "")
        target = args.get("target", "")
        return f"A11y {action} on {target}"
    if tool_name == "observe_screen":
        return "Capturing screen..."
    if tool_name == "get_ui_context":
        return "Reading UI context..."
    if tool_name == "wait":
        return f"Waiting {args.get('seconds', '?')}s..."
    if tool_name == "get_action_history":
        return "Retrieving action history..."
    if tool_name == "maximize_active_window":
        return "Maximizing window..."
    if tool_name == "execute_computer_use":
        instruction = args.get("instruction", "")
        return f"Computer Use: {instruction[:60]}..." if len(instruction) > 60 else f"Computer Use: {instruction}"
    if tool_name == "execute_browser":
        action = args.get("action", "")
        url = args.get("url", "")
        return f"Browser: {action} {url}".strip()[:80]
    if tool_name == "read_file":
        fp = args.get("file_path", "")
        return f"Reading: {fp[-60:]}" if len(fp) > 60 else f"Reading: {fp}"
    if tool_name == "edit_file":
        fp = args.get("file_path", "")
        return f"Editing: {fp[-60:]}" if len(fp) > 60 else f"Editing: {fp}"
    if tool_name == "find_files":
        return f"Finding files: pattern={args.get('pattern', '')}, text={args.get('search_text', '')}"[:80]
    if tool_name == "window_list":
        return "Listing windows..."
    if tool_name == "window_focus":
        return f"Focusing window: {args.get('title', '')}"[:80]
    if tool_name == "resize_window":
        layout = args.get("layout", "")
        return f"Resizing window: {layout}" if layout else "Resizing window..."
    if tool_name == "clipboard_read":
        return "Reading clipboard..."
    if tool_name == "clipboard_write":
        return f"Writing to clipboard ({len(args.get('text', ''))} chars)"
    if tool_name == "read_pdf":
        fp = args.get("file_path", "")
        return f"Reading PDF: {fp[-60:]}" if len(fp) > 60 else f"Reading PDF: {fp}"
    if tool_name == "read_image":
        fp = args.get("file_path", "")
        return f"Reading image: {fp[-60:]}" if len(fp) > 60 else f"Reading image: {fp}"
    if tool_name == "read_excel":
        fp = args.get("file_path", "")
        return f"Reading Excel: {fp[-60:]}" if len(fp) > 60 else f"Reading Excel: {fp}"
    if tool_name == "write_excel":
        fp = args.get("file_path", "")
        return f"Writing Excel: {fp[-60:]}" if len(fp) > 60 else f"Writing Excel: {fp}"
    if tool_name == "process_info":
        return f"Process info: {args.get('name', 'all')}"
    if tool_name == "system_info":
        return "Getting system info..."
    if tool_name == "download_file":
        return f"Downloading: {args.get('url', '')[:60]}"
    if tool_name == "save_dialog":
        return f"Save dialog: {args.get('file_path', '')[-50:]}"
    if tool_name == "open_dialog":
        return f"Open dialog: {args.get('file_path', '')[-50:]}"
    if tool_name == "find_and_replace_in_files":
        return f"Find/replace in files: {args.get('old_text', '')[:30]}"
    if tool_name == "launch_app":
        return f"Launching: {args.get('name', '')}"
    if tool_name == "install_app":
        return f"Installing: {args.get('name', '')}"
    if tool_name == "close_app":
        return f"Closing: {args.get('name', '')}"
    if tool_name == "app_menu":
        return f"Menu: {args.get('menu_path', '')}"[:60]
    if tool_name == "copy_between_apps":
        return f"Copying: {args.get('source_app', '')} → {args.get('target_app', '')}"
    if tool_name == "fill_form":
        return "Filling form fields..."
    if tool_name == "extract_text":
        return f"Extracting text: {args.get('element_name', 'screen')}"
    if tool_name == "set_env_var":
        return f"Set env: {args.get('name', '')}={args.get('scope', 'session')}"
    if tool_name == "change_setting":
        return f"Changing setting: {args.get('setting_path', '')}"[:60]
    if tool_name == "execute_skill":
        return f"Skill: {args.get('skill_name', '?')} → {args.get('workflow_name', '?')}"
    if tool_name == "load_skill":
        return f"Loading skill: {args.get('skill_name', '?')}"
    if tool_name == "create_skill":
        return f"Creating skill: {args.get('name', '?')}"
    if tool_name == "edit_skill":
        return f"Editing skill: {args.get('name', '?')}"
    return str(args)[:100]


