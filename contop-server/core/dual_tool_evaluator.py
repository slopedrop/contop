"""
Dual-Tool Evaluator - THE security gate for all LLM-derived command execution.

All execution paths MUST be routed through DualToolEvaluator.classify() before
invoking any tool. Direct calls to host_subprocess.run() or docker_sandbox.run()
are FORBIDDEN.

Exception: device_control messages bypass the evaluator (direct device operations).

[Source: project-context.md - Mandatory Dual-Tool Gate]
[Source: architecture.md - Execution Routing Decision (Dual-Tool Architecture)]
"""
import hashlib
import logging
import re
import sys
from dataclasses import dataclass, field

from core.settings import get_destructive_patterns, get_forbidden_commands, get_restricted_paths

logger = logging.getLogger(__name__)

KNOWN_TOOL_NAMES = {
    # Existing tools
    "execute_cli", "execute_gui", "observe_screen", "get_ui_context",
    "maximize_active_window", "wait", "get_action_history",
    "execute_computer_use", "execute_browser", "execute_accessible",
    # File tools (Layer 1)
    "read_file", "edit_file", "find_files",
    # Window & clipboard tools (Layer 1)
    "window_list", "window_focus", "resize_window",
    "clipboard_read", "clipboard_write",
    # Document tools (Layer 2)
    "read_pdf", "read_image", "read_excel", "write_excel",
    # System tools (Layer 2)
    "process_info", "system_info", "download_file",
    # Workflow tools (Layer 2)
    "save_dialog", "open_dialog", "launch_app", "open_file", "close_app", "app_menu",
    "install_app", "copy_between_apps", "fill_form", "extract_text",
    "set_env_var", "change_setting", "find_and_replace_in_files",
    # Skill tools
    "execute_skill", "load_skill",
    # Skill authoring tools (Phase 2)
    "create_skill", "edit_skill",
}

# Command prefixes that should be skipped when checking for destructive verbs.
# e.g. "sudo rm file.txt" → check "rm", not "sudo".
COMMAND_PREFIXES = {"sudo", "env", "nohup", "nice", "time", "doas"}

# PowerShell destructive cmdlets - always checked via deep scan regardless of
# user settings.  These are PS equivalents of Unix destructive commands that
# bypass the first-token check when wrapped (e.g. powershell -Command "Remove-Item ...").
# This is a hardcoded security floor: users can ADD patterns via settings but
# cannot remove these built-in checks.
POWERSHELL_DESTRUCTIVE = {
    "remove-item", "move-item", "stop-process", "restart-computer",
    "stop-computer", "clear-content", "clear-item", "set-content",
    "remove-itemproperty", "stop-service", "remove-service",
    "invoke-expression", "iex", "format-volume",
}

# PowerShell flags that execute opaque payloads invisible to pattern scanning.
# Commands using these are always classified as destructive.
_ENCODED_COMMAND_RE = re.compile(
    r"\b(?:powershell|pwsh)(?:\.exe)?\b.*\s-(?:EncodedCommand|e|ec)\b",
    re.IGNORECASE,
)

# Subshell / backtick extraction - surfaces commands inside $(...) and `...`
_SUBSHELL_RE = re.compile(r"\$\(([^)]+)\)|`([^`]+)`")

# M9: Compiled destructive-pattern regex cache.  Stores (patterns_hash, compiled_re)
# so we only recompile when the user's destructive_patterns setting changes.
_destructive_re_cache: tuple[str, re.Pattern | None] | None = None


@dataclass
class ClassificationResult:
    """Result of the dual-tool evaluator classification.

    Attributes:
        route: "host" (safe for direct execution) or "sandbox" (containerized).
        reason: Machine-readable reason for the routing decision.
        voice_message: Gemini-ready spoken response explaining the decision.
        require_confirmation: If True, user must confirm before execution.
    """

    route: str  # "host" | "sandbox"
    reason: str
    voice_message: str
    require_confirmation: bool = False


class DualToolEvaluator:
    """Central classification gate for LLM-derived tool calls.

    Pure classification - does NOT execute commands. Routes each tool call
    to either "host" (direct execution) or "sandbox" (Docker container).
    """

    def __init__(self) -> None:
        # Dynamic tool names registered by Model C skills at run_intent() time
        self._skill_tool_names: set[str] = set()

    def reset_skill_tools(self) -> None:
        """Clear previously registered dynamic skill tools (F6/F12: prevent stale accumulation)."""
        if self._skill_tool_names:
            KNOWN_TOOL_NAMES.difference_update(self._skill_tool_names)
            self._skill_tool_names.clear()

    def register_skill_tools(self, names: set[str]) -> None:
        """Register dynamic skill tool names so they route to host."""
        self._skill_tool_names.update(names)
        # Also add to module-level KNOWN_TOOL_NAMES so they don't hit unknown_tool
        KNOWN_TOOL_NAMES.update(names)

    async def classify(
        self, tool_name: str, args: dict, force_host: bool = False
    ) -> ClassificationResult:
        """Classify a tool call and return the routing decision.

        Args:
            tool_name: The tool to invoke ("execute_cli" or "execute_gui").
            args: Tool arguments (e.g., {"command": "docker ps"}).
            force_host: If True, bypass all classification (user override
                        from InterventionModal).

        Returns:
            ClassificationResult with route, reason, and voice_message.
        """
        # 1. force_host override (InterventionModal user approval)
        if force_host:
            return ClassificationResult(
                route="host",
                reason="user_override",
                voice_message="Command approved by user override.",
            )

        # 2. GUI and display-dependent tools always run on host (sandbox has no display)
        if tool_name == "execute_gui":
            return ClassificationResult(
                route="host",
                reason="gui_requires_host",
                voice_message="GUI command routed to host.",
            )

        if tool_name == "execute_computer_use":
            return ClassificationResult(
                route="host",
                reason="gemini_computer_use_native",
                voice_message="Gemini Computer Use taking control of the screen.",
            )

        if tool_name in ("observe_screen", "get_ui_context", "maximize_active_window", "wait", "get_action_history", "execute_accessible"):
            return ClassificationResult(
                route="host",
                reason="display_requires_host",
                voice_message="",
            )

        if tool_name == "execute_browser":
            return ClassificationResult(
                route="host",
                reason="browser_requires_host",
                voice_message="Browser command routed to host.",
            )

        # 2a-skills. Skill tools - route to host
        if tool_name == "execute_skill":
            return ClassificationResult(
                route="host",
                reason="skill_workflow_execution",
                voice_message="Running a skill workflow.",
            )
        if tool_name == "load_skill":
            return ClassificationResult(
                route="host",
                reason="skill_instructions_load",
                voice_message="",
            )
        if tool_name == "create_skill":
            return ClassificationResult(
                route="host",
                reason="skill_authoring",
                voice_message="Creating a new skill.",
                require_confirmation=True,
            )
        if tool_name == "edit_skill":
            return ClassificationResult(
                route="host",
                reason="skill_authoring",
                voice_message="Editing a skill.",
                require_confirmation=True,
            )
        # Model C dynamic skill tool names
        if tool_name in self._skill_tool_names:
            return ClassificationResult(
                route="host",
                reason="skill_python_tool",
                voice_message="",
            )

        # 2b. File-operation tools - pure compute, no shell, route to host
        #     Check file_path argument against restricted paths (defense-in-depth).
        if tool_name in ("read_file", "edit_file", "find_files"):
            file_path = args.get("file_path", "") or args.get("path", "")
            if file_path:
                restricted_paths = get_restricted_paths()
                for rp in restricted_paths:
                    if self._path_referenced(file_path, rp):
                        return ClassificationResult(
                            route="sandbox",
                            reason=f"restricted_path: {rp}",
                            voice_message="This file is in a restricted location.",
                        )
            return ClassificationResult(
                route="host",
                reason="file_operation",
                voice_message="",
            )

        # 2c. Window & clipboard tools - need display access, route to host
        if tool_name in ("window_list", "window_focus", "resize_window", "clipboard_read", "clipboard_write"):
            return ClassificationResult(
                route="host",
                reason="display_requires_host",
                voice_message="",
            )

        # 2d. Document tools - file I/O only, route to host
        if tool_name in ("read_pdf", "read_image", "read_excel", "write_excel"):
            return ClassificationResult(
                route="host",
                reason="file_operation",
                voice_message="",
            )

        # 2e. System info tools - read-only system queries, route to host
        if tool_name in ("process_info", "system_info"):
            return ClassificationResult(
                route="host",
                reason="system_info",
                voice_message="",
            )

        # 2f. Download tool - URL validated internally, route to host
        if tool_name == "download_file":
            return ClassificationResult(
                route="host",
                reason="safe",
                voice_message="",
            )

        # 2g. Workflow tools - orchestrate primitives, route to host
        if tool_name in (
            "save_dialog", "open_dialog", "launch_app", "open_file",
            "close_app", "app_menu",
            "install_app", "copy_between_apps", "fill_form", "extract_text",
            "set_env_var", "change_setting", "find_and_replace_in_files",
        ):
            return ClassificationResult(
                route="host",
                reason="workflow_operation",
                voice_message="",
            )

        # 3. Unknown tool names - default to sandbox (defense-in-depth)
        if tool_name not in KNOWN_TOOL_NAMES:
            logger.warning("Unknown tool name: %s", tool_name)
            return ClassificationResult(
                route="sandbox",
                reason="unknown_tool",
                voice_message=f"I don't recognize the tool '{tool_name}'. The command has been sandboxed for safety.",
            )

        # 4. CLI tools: check command against forbidden commands + restricted paths
        command = args.get("command", "")
        if not command:
            return ClassificationResult(
                route="host",
                reason="empty_command",
                voice_message="",
                require_confirmation=True,
            )

        # 4a. Check forbidden commands (substring/startswith matching)
        forbidden_commands = get_forbidden_commands()
        for forbidden in forbidden_commands:
            if self._forbidden_matches(command, forbidden):
                return ClassificationResult(
                    route="sandbox",
                    reason=f"forbidden_command: {forbidden}",
                    voice_message=(
                        f"This command matches a forbidden pattern. "
                        f"It has been routed to the sandbox."
                    ),
                )

        # 4b. Check restricted paths (case-sensitive per platform)
        restricted_paths = get_restricted_paths()
        for path in restricted_paths:
            if self._path_referenced(command, path):
                return ClassificationResult(
                    route="sandbox",
                    reason=f"restricted_path: {path}",
                    voice_message=(
                        "This command targets a restricted path. "
                        "It has been routed to the sandbox."
                    ),
                )

        # 5. Destructive command check (warning, still host-routed)
        if self._is_destructive(command):
            return ClassificationResult(
                route="host",
                reason="destructive_command",
                voice_message=(
                    "This command may be destructive. "
                    "Do you want me to proceed?"
                ),
                require_confirmation=True,
            )

        # 6. Default: safe
        return ClassificationResult(
            route="host",
            reason="safe",
            voice_message="Command classified as safe for host execution.",
        )

    def _is_destructive(self, command: str) -> bool:
        """Check if command matches a known destructive pattern.

        Handles simple commands, flags, pipes/chaining, case insensitivity,
        full paths (e.g. /usr/bin/rm → rm), wrapper commands
        (e.g. powershell -Command "Remove-Item ...", cmd /c "del ..."),
        subshells ($(...), backticks), and encoded PowerShell commands.
        """
        # PowerShell -EncodedCommand is always destructive (opaque payload)
        if _ENCODED_COMMAND_RE.search(command):
            return True

        global _destructive_re_cache

        patterns = get_destructive_patterns()
        single_word = {p.lower() for p in patterns if " " not in p}
        multi_word = [p.lower() for p in patterns if " " in p]

        # Build a single pre-compiled alternation regex for all single-word
        # patterns + hardcoded PowerShell cmdlets (avoids N separate re.search
        # calls per subcommand).  Cached and only recompiled when patterns change.
        all_single = single_word | POWERSHELL_DESTRUCTIVE
        patterns_hash = hashlib.md5(
            "|".join(sorted(all_single)).encode()
        ).hexdigest()

        if _destructive_re_cache is not None and _destructive_re_cache[0] == patterns_hash:
            deep_scan_re = _destructive_re_cache[1]
        elif all_single:
            deep_scan_re = re.compile(
                r"\b(?:" + "|".join(re.escape(p) for p in sorted(all_single)) + r")\b",
                re.IGNORECASE,
            )
            _destructive_re_cache = (patterns_hash, deep_scan_re)
        else:
            deep_scan_re = None
            _destructive_re_cache = (patterns_hash, None)

        # Extract subshell contents so destructive verbs inside $() or
        # backticks are also checked (e.g. echo $(rm file)).
        subshell_extras = []
        for m in _SUBSHELL_RE.finditer(command):
            inner = m.group(1) or m.group(2)
            if inner:
                subshell_extras.append(inner)

        subcommands = re.split(r"[|;&]+", command) + subshell_extras
        for sub in subcommands:
            tokens = sub.strip().split()
            if not tokens:
                continue

            # Skip multiple command prefixes (handles sudo env rm, nohup sudo kill, etc.)
            idx = 0
            while idx < len(tokens) - 1:
                t_base = tokens[idx].lower().rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
                if t_base in COMMAND_PREFIXES:
                    idx += 1
                else:
                    break
            cmd_verb = tokens[idx].lower()
            cmd_base = cmd_verb.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
            if cmd_base in single_word:
                return True

            # Deep scan: single pre-compiled regex against full subcommand.
            # Catches destructive verbs embedded in wrapper commands and
            # hardcoded PowerShell cmdlets.
            if deep_scan_re:
                sub_lower = sub.strip().lower()
                if deep_scan_re.search(sub_lower):
                    return True

            # Check multi-word patterns (e.g. SQL keywords) against full subcommand
            sub_lower = sub.strip().lower()
            for pattern in multi_word:
                if pattern in sub_lower:
                    return True
        return False

    @staticmethod
    def _forbidden_matches(command: str, forbidden: str) -> bool:
        """Check if command matches a forbidden command pattern.

        Uses word-boundary aware matching to avoid false positives from
        naive substring matching (e.g. 'dd if=' should not match 'add if=').
        """
        return bool(re.search(
            r"\b" + re.escape(forbidden),
            command,
            re.IGNORECASE,
        ))

    @staticmethod
    def _path_referenced(command: str, path: str) -> bool:
        """Check if command references a restricted path.

        Case-insensitive on Windows, case-sensitive on Linux/macOS.
        """
        if sys.platform == "win32":
            return path.lower() in command.lower()
        return path in command
