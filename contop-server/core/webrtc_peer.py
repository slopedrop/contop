"""
WebRTC peer connection manager - manages aiortc RTCPeerConnection lifecycle.

Handles SDP negotiation, ICE candidate exchange, data channel management,
keepalive emission, and canonical message envelope formatting.
"""
import asyncio
import json
import logging
import os
import uuid
import urllib.request
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable, Coroutine

from aiortc import RTCConfiguration, RTCIceCandidate, RTCIceServer, RTCPeerConnection, RTCSessionDescription

# Import ExecutionAgent at module level so the heavy google.adk / google.genai
# module chain loads at server startup - NOT on first user_intent, where the
# synchronous import would block the event loop and starve aiortc's SCTP
# heartbeat processing, causing the mobile to close the data channel.
from core.execution_agent import ExecutionAgent
from tools.screen_capture import ScreenCaptureTrack, start_jpeg_relay

logger = logging.getLogger(__name__)

KEEPALIVE_INTERVAL_SECONDS = 30
MAX_MISSED_CLIENT_RESPONSES = 3
DATA_CHANNEL_NAME = "contop"

# Accepted computer_use_backend values from the mobile client.
VALID_BACKENDS = {
    "omniparser", "ui_tars", "gemini_computer_use", "accessibility",
    "kimi_vision", "qwen_vision", "phi_vision", "molmo_vision", "holotron_vision",
}

# ---------------------------------------------------------------------------
# Video bitrate tuning - two-pronged approach (like Chrome Remote Desktop).
#
# Problem: aiortc's encoder starts at 500 kbps (VP8) / 1 Mbps (H264) and
# caps at 1.5 / 3 Mbps.  The mobile client's libwebrtc REMB feedback also
# starts low (~300 kbps) and ramps slowly → 10-15 s of pixelated video.
#
# Fix:
#   1. Monkey-patch aiortc codec constants so the encoder starts higher and
#      can reach a higher ceiling when REMB allows it.
#   2. Inject x-google-start-bitrate into the SDP answer so the mobile
#      client's libwebrtc starts its bandwidth estimate high and sends
#      high REMB from the very first RTCP packet.
# ---------------------------------------------------------------------------
_ENCODER_START_BITRATE = 1_500_000   # 1.5 Mbps - moderate start (3x VP8 default)
_ENCODER_MAX_BITRATE   = 5_000_000   # 5 Mbps - raised ceiling for REMB ramp
_ENCODER_MIN_BITRATE   = 250_000     # 250 kbps - keep original floor so encoder can back off
_CLIENT_START_KBPS     = 2000        # 2 Mbps - client REMB starts here (vs default 300 kbps)
_CLIENT_MAX_KBPS       = 8000        # 8 Mbps - client REMB ceiling

_codec_patched = False


def _patch_codec_bitrates() -> None:
    """Raise aiortc's default/min/max video bitrates for VP8 and H264.

    Called once before the first peer connection adds a video track.
    Safe to call multiple times (no-op after first run).
    """
    global _codec_patched
    if _codec_patched:
        return

    from aiortc.codecs import vpx, h264

    for mod in (vpx, h264):
        mod.DEFAULT_BITRATE = _ENCODER_START_BITRATE
        mod.MAX_BITRATE     = _ENCODER_MAX_BITRATE
        mod.MIN_BITRATE     = _ENCODER_MIN_BITRATE

    _codec_patched = True
    logger.info(
        "Patched aiortc codec bitrates: start=%d, min=%d, max=%d bps",
        _ENCODER_START_BITRATE,
        _ENCODER_MIN_BITRATE,
        _ENCODER_MAX_BITRATE,
    )


def _boost_sdp_bitrate(sdp: str) -> str:
    """Inject x-google bitrate hints into the SDP answer's video fmtp lines.

    When the mobile client (react-native-webrtc / libwebrtc) sets this as
    its remote description, it parses x-google-start-bitrate and uses it as
    the initial bandwidth estimate for its congestion controller.  This makes
    the client send high REMB values from the very first RTCP packet, so the
    server encoder ramps up almost instantly - the same trick CRD uses.
    """
    import re

    lines = sdp.split("\r\n")
    result: list[str] = []
    video_payload_types: set[str] = set()
    in_video = False

    for line in lines:
        if line.startswith("m="):
            in_video = line.startswith("m=video")
            if in_video:
                # Extract payload types from m=video line
                parts = line.split()
                video_payload_types = set(parts[3:])  # after "m=video <port> <proto>"

        # Append x-google params to video codec fmtp lines
        if in_video and line.startswith("a=fmtp:"):
            match = re.match(r"a=fmtp:(\d+)\s+(.*)", line)
            if match and match.group(1) in video_payload_types:
                pt, params = match.group(1), match.group(2)
                if "x-google-start-bitrate" not in params:
                    line = (
                        f"a=fmtp:{pt} {params}"
                        f";x-google-start-bitrate={_CLIENT_START_KBPS}"
                        f";x-google-max-bitrate={_CLIENT_MAX_KBPS}"
                    )

        result.append(line)

    return "\r\n".join(result)


def _parse_ice_candidate(candidate_data: dict) -> RTCIceCandidate | None:
    """Parse a WebRTC ICE candidate string into an aiortc RTCIceCandidate.

    Format: candidate:<foundation> <component> <protocol> <priority> <ip> <port> typ <type> [...]
    """
    raw = candidate_data.get("candidate", "")
    if not raw:
        return None

    # Strip the "candidate:" prefix if present
    body = raw.split(":", 1)[1] if ":" in raw else raw
    parts = body.split()
    if len(parts) < 8:
        logger.warning("Cannot parse ICE candidate: %s", raw)
        return None

    foundation, component, protocol, priority, ip, port = parts[0:6]
    # parts[6] is "typ"
    cand_type = parts[7]

    related_address = None
    related_port = None
    tcp_type = None
    i = 8
    while i < len(parts) - 1:
        if parts[i] == "raddr":
            related_address = parts[i + 1]
        elif parts[i] == "rport":
            related_port = int(parts[i + 1])
        elif parts[i] == "tcptype":
            tcp_type = parts[i + 1]
        i += 2

    return RTCIceCandidate(
        component=int(component),
        foundation=foundation,
        ip=ip,
        port=int(port),
        priority=int(priority),
        protocol=protocol,
        type=cand_type,
        relatedAddress=related_address,
        relatedPort=related_port,
        sdpMid=candidate_data.get("sdpMid"),
        sdpMLineIndex=candidate_data.get("sdpMLineIndex"),
        tcpType=tcp_type,
    )


class WebRTCPeerManager:
    """Manages a single WebRTC peer connection on the host side.

    Creates the RTCPeerConnection with ICE servers from the pairing token,
    receives the data channel created by the mobile client via the datachannel
    event, and handles SDP/ICE negotiation.
    """

    def __init__(self, stun_config: dict, connection_type: str = "permanent") -> None:
        raw_servers = stun_config.get("ice_servers", [])
        ice_servers = [RTCIceServer(urls=s["urls"]) for s in raw_servers]
        configuration = RTCConfiguration(iceServers=ice_servers)

        self._pc = RTCPeerConnection(configuration=configuration)
        self._data_channel = None
        self._fast_data_channel = None  # Unreliable channel for mouse_move
        self.connection_type = connection_type
        self._keepalive_task: asyncio.Task | None = None
        self._device_control_task: asyncio.Task | None = None
        self._manual_control_task: asyncio.Task | None = None
        self._missed_client_responses: int = 0
        self._screen_track: ScreenCaptureTrack | None = None
        self._jpeg_relay_task: asyncio.Task | None = None
        self._closed = False
        self._execution_cancelled = False
        self._evaluator = None  # DualToolEvaluator, lazy-initialized once per peer
        self._execution_agent = None  # ExecutionAgent, lazy-initialized once per peer
        self._reconnect_context: str = ""  # Conversation backstory from mobile reconnection
        self._pending_adk_session_id: str | None = None  # ADK session to restore on next intent
        self._execution_task: asyncio.Task | None = None
        self._message_queue: deque[tuple[str, dict]] = deque(maxlen=1000)  # Disconnect-resilient queue
        self._disconnect_cleanup_task: asyncio.Task | None = None  # prevent GC of fire-and-forget task
        self.on_ice_candidate: Callable[
            [dict], Coroutine[Any, Any, None]
        ] | None = None

        self._setup_event_handlers()

    @property
    def is_closed(self) -> bool:
        """Whether close() has been called on this peer manager."""
        return self._closed

    def _setup_event_handlers(self) -> None:
        """Register ICE candidate forwarding and data channel handlers."""
        try:
            pc_on = self._pc.on

            @pc_on("icecandidate")
            async def on_icecandidate(candidate: Any) -> None:
                if candidate and self.on_ice_candidate:
                    await self.on_ice_candidate({
                        "candidate": candidate.candidate,
                        "sdpMid": candidate.sdpMid,
                        "sdpMLineIndex": candidate.sdpMLineIndex,
                    })

            @pc_on("datachannel")
            def on_datachannel(channel: Any) -> None:
                label = getattr(channel, "label", "unknown")

                # Unreliable fast channel for latency-sensitive mouse_move messages
                if label == "contop-fast":
                    self._fast_data_channel = channel
                    logger.info("Fast data channel '%s' received (unreliable)", label)

                    @channel.on("message")
                    def on_fast_message(message: str) -> None:
                        self._on_data_channel_message(message)

                    return

                # Primary reliable data channel
                self._data_channel = channel
                self.start_keepalive()
                self._flush_message_queue()
                # Send initial state_update with connection_type and global settings
                # so mobile knows whether this is a temp or permanent session
                # and can sync server-side state (e.g. keep_host_awake).
                from core.settings import get_keep_host_awake, get_provider_auth, is_subscription_mode
                provider_auth_raw = get_provider_auth()
                # Send immediate state_update with optimistic availability
                # (assumes proxy is running if configured). A follow-up async
                # health check corrects this within a few seconds.
                provider_auth_payload = {
                    p: {
                        "mode": cfg.get("mode", "api_key"),
                        "available": (
                            cfg.get("mode") == "cli_proxy"
                            and bool(cfg.get("proxy_url"))
                        ),
                    }
                    for p, cfg in provider_auth_raw.items()
                }
                self.send_message("state_update", {
                    "ai_state": "idle",
                    "connection_type": self.connection_type,
                    "keep_host_awake": get_keep_host_awake(),
                    "provider_auth": provider_auth_payload,
                })
                # Schedule actual proxy health check to correct the status
                asyncio.get_event_loop().create_task(
                    self._check_and_push_proxy_health()
                )
                # NOTE: JPEG relay is NOT started here. Continuous 1fps screenshot
                # streaming (~150KB/frame) over the SCTP data channel overwhelms
                # the reliable transport on slower links (Tailscale/tunnel),
                # causing SCTP abort and data channel death within seconds.
                # Frames are sent on-demand when user_intent needs LLM context.
                # The video track (RTP) handles live display - it's unreliable
                # and gracefully degrades under congestion.
                logger.info("Data channel '%s' received from mobile (connection_type=%s)", label, self.connection_type)

                @channel.on("message")
                def on_message(message: str) -> None:
                    self._on_data_channel_message(message)

                @channel.on("close")
                def on_dc_close() -> None:
                    self._data_channel = None
                    if self._has_running_execution():
                        logger.warning("Data channel closed during execution - killing execution immediately")
                        self._disconnect_cleanup_task = asyncio.create_task(self._kill_execution_on_disconnect())
                    else:
                        logger.warning("Data channel closed - closing peer connection")
                        asyncio.create_task(self._close_and_unregister())

        except (TypeError, AttributeError):
            # Gracefully handle mocked peer connections in tests
            pass

    async def handle_offer(self, sdp: str) -> dict:
        """Process an SDP offer from the mobile client and return an answer.

        Sets the offer as remote description, creates an answer, sets it
        as local description, and returns the answer as a dict.
        """
        offer = RTCSessionDescription(sdp=sdp, type="offer")
        await self._pc.setRemoteDescription(offer)

        # Ensure the encoder will use our raised bitrate defaults before the
        # first frame is encoded (encoder is created lazily in aiortc).
        _patch_codec_bitrates()

        try:
            self._screen_track = ScreenCaptureTrack()
            self._pc.addTrack(self._screen_track)
        except Exception:
            logger.exception("Failed to create screen capture track - continuing without video")
            self._screen_track = None

        answer = await self._pc.createAnswer()
        await self._pc.setLocalDescription(answer)

        # Inject x-google-start-bitrate so the mobile client's libwebrtc
        # starts its bandwidth estimate high → sends high REMB immediately.
        sdp = _boost_sdp_bitrate(self._pc.localDescription.sdp)

        return {
            "type": "answer",
            "sdp": sdp,
        }

    async def add_ice_candidate(self, candidate_data: dict) -> None:
        """Add a remote ICE candidate to the peer connection."""
        candidate = _parse_ice_candidate(candidate_data)
        if candidate is None:
            return
        await self._pc.addIceCandidate(candidate)

    def send_message(self, msg_type: str, payload: dict) -> None:
        """Send a message on the data channel using canonical envelope format.

        If the data channel is unavailable, queues the message for delivery
        when the connection is restored (disconnect-resilient queue).
        """
        envelope = {
            "type": msg_type,
            "id": str(uuid.uuid4()),
            "payload": payload,
        }
        if self._data_channel is None or self._data_channel.readyState != "open":
            self._message_queue.append((msg_type, payload))
            return
        self._data_channel.send(json.dumps(envelope))

    def _flush_message_queue(self) -> None:
        """Flush queued messages on reconnect. Called when data channel opens."""
        if not self._message_queue:
            return
        flushed = 0
        while self._message_queue:
            msg_type, payload = self._message_queue.popleft()
            try:
                self.send_message(msg_type, payload)
                flushed += 1
            except Exception:
                self._message_queue.appendleft((msg_type, payload))
                break
        if flushed:
            logger.info("Flushed %d queued messages on reconnect", flushed)

    async def _check_and_push_proxy_health(self, delay: float = 3.0) -> None:
        """Check actual proxy health and push corrected provider_auth to mobile."""
        if delay > 0:
            await asyncio.sleep(delay)  # give proxies time to start after server boot
        try:
            from main import _build_provider_auth_payload
            payload = await _build_provider_auth_payload()
            self.send_message("state_update", {"provider_auth": payload})
        except Exception:
            logger.warning("Failed to check proxy health for initial state_update", exc_info=True)

    def send_keepalive(self) -> None:
        """Send a keepalive message on the data channel."""
        self.send_message("keepalive", {})

    def start_keepalive(self) -> None:
        """Start the periodic keepalive task.

        Restarts the task if the previous one crashed (done with exception)
        or finished unexpectedly. This prevents a single iteration failure
        from permanently killing server→mobile heartbeat.
        """
        if self._keepalive_task is not None:
            if not self._keepalive_task.done():
                logger.warning("Keepalive already running - skipped start")
                return
            # Previous task ended (crashed or exited) - log and restart
            try:
                exc = self._keepalive_task.exception() if not self._keepalive_task.cancelled() else None
            except (asyncio.CancelledError, BaseException):
                exc = None  # Task raised CancelledError explicitly (not via .cancel())
            if exc:
                logger.error("Previous keepalive task crashed: %s - restarting", exc)
            else:
                logger.warning("Previous keepalive task ended - restarting")
            self._keepalive_task = None

        logger.info("Keepalive loop starting (closed=%s)", self._closed)
        self._keepalive_task = asyncio.create_task(self._keepalive_loop())
        self._keepalive_task.add_done_callback(self._on_keepalive_task_done)

    def _on_keepalive_task_done(self, task: asyncio.Task) -> None:
        """Log and auto-restart when the keepalive task exits unexpectedly."""
        if task.cancelled():
            return  # Normal shutdown via close()
        try:
            exc = task.exception()
        except (asyncio.CancelledError, BaseException):
            exc = None
        if exc:
            logger.error("Keepalive task died: %s - auto-restarting", exc, exc_info=exc)
        elif not self._closed:
            logger.warning("Keepalive task exited without error while peer is still open - auto-restarting")
        else:
            return  # Peer is closed, don't restart
        # Auto-restart: clear the dead task and start a fresh one
        self._keepalive_task = None
        if not self._closed:
            self.start_keepalive()

    def _on_data_channel_message(self, message: str) -> None:
        """Handle incoming data channel messages. Resets client liveness counter."""
        self._missed_client_responses = 0
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            logger.warning("Invalid JSON on data channel: %s", message[:100])
            return

        msg_type = data.get("type")
        if msg_type == "session_end":
            asyncio.create_task(self._close_and_unregister())
            return
        if msg_type == "keepalive":
            return
        if msg_type == "device_control":
            if self._device_control_task and not self._device_control_task.done():
                self._device_control_task.cancel()
            self._device_control_task = asyncio.create_task(self._handle_device_control(data))
            return
        if msg_type == "set_manual_mode":
            enabled = data.get("payload", {}).get("enabled", False)
            if self._screen_track is not None:
                self._screen_track.set_manual_mode(enabled)
            return
        if msg_type == "manual_control":
            payload = data.get("payload", {})
            action = payload.get("action", "")
            if action == "mouse_move":
                # Fast path: fire-and-forget, no task tracking, no result message
                from tools.manual_control import handle_mouse_move
                asyncio.create_task(handle_mouse_move(
                    payload.get("dx", 0), payload.get("dy", 0),
                    self._screen_track,
                ))
            elif action in ("mouse_down", "mouse_up"):
                # Fast path for drag: mouseDown/mouseUp, fire-and-forget
                from tools.manual_control import handle_mouse_down, handle_mouse_up
                if action == "mouse_down":
                    asyncio.create_task(handle_mouse_down())
                else:
                    asyncio.create_task(handle_mouse_up())
            elif action == "scroll":
                # Fast path: fire-and-forget so rapid scrolls don't cancel each other
                from tools.manual_control import handle_scroll
                asyncio.create_task(handle_scroll(payload))
            else:
                if self._manual_control_task and not self._manual_control_task.done():
                    self._manual_control_task.cancel()
                self._manual_control_task = asyncio.create_task(self._handle_manual_control(data))
            return
        if msg_type == "tool_call":
            task = asyncio.create_task(self._handle_tool_call(data))
            task.add_done_callback(self._on_tool_call_task_done)
            return
        if msg_type == "execution_stop":
            self._execution_cancelled = True
            if self._execution_agent is not None:
                self._execution_agent.cancel()
            # Send immediate state_update so mobile UI transitions to idle
            self.send_message("state_update", {"ai_state": "idle"})
            # Cancel the running execution task to interrupt mid-API calls
            if self._execution_task is not None and not self._execution_task.done():
                self._execution_task.cancel()
            logger.info("Execution stop requested by client")
            return
        if msg_type == "new_session":
            # Mobile started a new chat - reset ADK session to clear multi-turn memory
            if self._execution_agent is not None:
                self._execution_agent.reset_session()
            self._reconnect_context = ""
            self._pending_adk_session_id = None
            logger.info("New session requested by client - ADK session reset")
            return
        if msg_type == "session_context":
            # Mobile reconnected with an existing session - store conversation
            # backstory so the ADK agent has context on the next user_intent.
            payload = data.get("payload", {})
            entries = payload.get("entries", [])
            lines = [f"{e['role'].title()}: {e['text']}" for e in entries if e.get("text")]
            self._reconnect_context = "\n".join(lines)
            logger.info("Session context received: %d turns, %d chars", len(lines), len(self._reconnect_context))
            # Store the ADK session ID for restoration on the next user_intent.
            # Restoration is deferred to _handle_user_intent (which is async) to
            # avoid a race between fire-and-forget restore and run_intent.
            self._pending_adk_session_id = payload.get("adk_session_id")
            return
        if msg_type == "user_intent":
            task = asyncio.create_task(self._handle_user_intent(data))
            task.add_done_callback(self._on_tool_call_task_done)
            return
        if msg_type == "agent_confirmation_response":
            self._handle_agent_confirmation_response(data)
            return
        if msg_type == "away_mode_engage":
            asyncio.create_task(self._handle_away_mode_engage())
            return
        if msg_type == "away_mode_disengage":
            pin = data.get("payload", {}).get("pin")
            asyncio.create_task(self._handle_away_mode_disengage(pin))
            return
        if msg_type == "away_mode_status":
            asyncio.create_task(self._send_away_mode_status_async())
            return
        if msg_type == "refresh_proxy_status":
            now = asyncio.get_event_loop().time()
            if now - getattr(self, '_last_proxy_refresh', 0) < 3:
                return  # rate limit: 1 refresh per 3 seconds
            self._last_proxy_refresh = now
            task = asyncio.create_task(self._check_and_push_proxy_health(delay=0))
            task.add_done_callback(self._on_tool_call_task_done)
            return
        if msg_type == "conversation_request":
            task = asyncio.create_task(self._handle_conversation_request(data))
            task.add_done_callback(self._on_tool_call_task_done)
            return
        # Other message types can be handled here in the future

    def _on_tool_call_task_done(self, task: asyncio.Task) -> None:
        """Log unhandled exceptions from tool_call async tasks."""
        if not task.cancelled() and task.exception() is not None:
            logger.error(
                "Unhandled error in tool_call handler",
                exc_info=task.exception(),
            )

    async def _handle_tool_call(self, data: dict) -> None:
        """Handle tool_call message: classify via DualToolEvaluator and respond.

        Routes through the evaluator BEFORE any execution. For now returns
        a stub tool_result since execution tools are not yet built (Stories 3.2-3.4).
        """
        # Reset cancellation flag at the start of each new tool call (H2)
        self._execution_cancelled = False

        # Lazy-initialize the evaluator once per peer connection (H3)
        if self._evaluator is None:
            from core.dual_tool_evaluator import DualToolEvaluator
            self._evaluator = DualToolEvaluator()

        payload = data.get("payload", {})
        tool_name = payload.get("name", "")
        args = payload.get("args", {})
        gemini_call_id = payload.get("gemini_call_id", "")
        # H3: force_host must NOT come from the raw tool_call payload - it can
        # only be set by the confirmation flow in execution_agent._before_tool_callback.
        force_host = False

        try:
            result = await self._evaluator.classify(tool_name, args, force_host)
        except Exception:
            logger.exception("DualToolEvaluator.classify() failed for tool '%s'", tool_name)
            self.send_message("tool_result", {
                "gemini_call_id": gemini_call_id,
                "name": tool_name,
                "status": "error",
                "output": None,
                "voice_message": "I couldn't classify that command. Please try rephrasing.",
                "retry_suggested": False,
            })
            return

        # Send state_update BEFORE tool_result
        ai_state = "executing" if result.route == "host" else "sandboxed"
        self.send_message("state_update", {"ai_state": ai_state})

        # Build stub tool_result (execution tools not yet implemented)
        if result.route == "host":
            tool_result_payload = {
                "gemini_call_id": gemini_call_id,
                "name": tool_name,
                "status": "success",
                "output": "[stub] Command would execute on host",
                "voice_message": "Command classified as safe. Execution tools not yet implemented.",
                "retry_suggested": False,
            }
        else:
            tool_result_payload = {
                "gemini_call_id": gemini_call_id,
                "name": tool_name,
                "status": "sandboxed",
                "output": None,
                "voice_message": result.voice_message,
                "retry_suggested": False,
            }

        self.send_message("tool_result", tool_result_payload)

    async def _handle_device_control(self, data: dict) -> None:
        """Handle device_control message. Bypasses the Dual-Tool Evaluator."""
        from tools.device_control import handle_device_control
        payload = data.get("payload", {})
        action = payload.get("action", "")
        result = await handle_device_control(action)
        self.send_message("device_control_result", result)

    @staticmethod
    def _get_provider_for_model(model: str) -> str:
        """Map a model name string to its provider key."""
        m = model.lower()
        if "claude" in m or "anthropic" in m:
            return "anthropic"
        if "gpt" in m or "openai" in m or "o1" in m or "o3" in m or "o4" in m:
            return "openai"
        if "gemini" in m or "google" in m:
            return "gemini"
        return "unknown"

    async def _handle_conversation_request(self, data: dict) -> None:
        """Proxy a conversation_request from mobile through the configured CLI proxy.

        Sends conversation_stream_delta messages during streaming, followed by
        conversation_stream_end. For non-streaming, sends conversation_response.
        On error, sends conversation_response with an error field.
        """
        import httpx
        from core.settings import is_subscription_mode, get_proxy_url

        payload = data.get("payload", {})
        model = payload.get("model", "")
        provider = self._get_provider_for_model(model)
        # Strip provider prefix that mobile model registry uses (e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6")
        if "/" in model:
            model = model.split("/", 1)[1]

        if not is_subscription_mode(provider):
            self.send_message("conversation_response", {
                "error": f"Provider '{provider}' is not configured for subscription mode",
                "model": model,
            })
            return

        proxy_url = get_proxy_url(provider)
        if not proxy_url:
            self.send_message("conversation_response", {
                "error": f"No proxy URL configured for provider '{provider}'",
                "model": model,
            })
            return

        stream = payload.get("stream", False)
        messages = list(payload.get("messages", []))
        system_prompt = payload.get("system_prompt")

        # Sanitize the system prompt for CLI providers: strip identity
        # overrides that cause CLI tools to reject the prompt as injection.
        # The original prompt is preserved for API mode - this only affects
        # the subscription path through CLI proxies.
        if system_prompt and isinstance(system_prompt, str):
            system_prompt = system_prompt.replace(
                "You are Contop, a remote desktop assistant. You run on the user's phone and communicate via text.",
                "This project is a remote desktop automation system controlled from a mobile device.",
            ).replace(
                "You are one half of a two-agent system:",
                "The system uses a two-agent architecture:",
            ).replace(
                "- **You (mobile agent)** - handle conversation, memory, and routing. You decide whether a request needs desktop execution or can be answered directly.",
                "- **Conversation agent** - handles conversation, memory, and routing. Decides whether a request needs desktop execution or can be answered directly.",
            ).replace(
                "You CANNOT see the desktop screen - only the desktop agent can.",
                "The conversation agent cannot see the desktop screen - only the desktop agent can.",
            ).replace(
                "You remember everything said in this conversation. The conversation history IS your memory. Never claim you cannot remember something from earlier. If the user told you their name, you know it.",
                "The conversation history serves as memory. Everything said in this conversation is available for reference.",
            )

        if system_prompt:
            messages.insert(0, {"role": "system", "content": system_prompt})

        request_body: dict = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        tools = payload.get("tools")
        if tools:
            request_body["tools"] = tools

        try:
            async with httpx.AsyncClient() as client:
                if stream:
                    async with client.stream(
                        "POST",
                        f"{proxy_url}/v1/chat/completions",
                        json=request_body,
                        timeout=120.0,
                    ) as response:
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            raw = line[6:]
                            if raw == "[DONE]":
                                self.send_message("conversation_stream_end", {"model": model})
                                break
                            try:
                                chunk = json.loads(raw)
                                delta = (
                                    chunk.get("choices", [{}])[0]
                                    .get("delta", {})
                                    .get("content", "")
                                )
                                if delta:
                                    self.send_message("conversation_stream_delta", {
                                        "delta": delta,
                                        "model": model,
                                    })
                            except json.JSONDecodeError:
                                continue
                else:
                    response = await client.post(
                        f"{proxy_url}/v1/chat/completions",
                        json=request_body,
                        timeout=120.0,
                    )
                    result = response.json()
                    if response.status_code != 200 or "error" in result:
                        err_detail = result.get("error", {})
                        err_msg = err_detail.get("message", str(err_detail)) if isinstance(err_detail, dict) else str(err_detail)
                        logger.warning("CLI proxy returned error for %s: status=%s body=%s", provider, response.status_code, err_msg)
                        self.send_message("conversation_response", {
                            "error": err_msg or f"CLI proxy error (HTTP {response.status_code})",
                            "model": model,
                        })
                        return
                    self.send_message("conversation_response", {
                        "text": result["choices"][0]["message"]["content"],
                        "tool_calls": result["choices"][0]["message"].get("tool_calls"),
                        "model": model,
                        "auth_type": "subscription",
                    })
        except Exception as exc:
            logger.warning("conversation_request proxy failed for provider=%s: %s (%s)", provider, exc, type(exc).__name__, exc_info=True)
            self.send_message("conversation_response", {
                "error": f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__,
                "model": model,
            })

    async def _handle_away_mode_engage(self) -> None:
        """Engage Away Mode via Tauri health server POST endpoint."""
        try:
            tauri_health_port = self._tauri_health_port()
            url = f"http://127.0.0.1:{tauri_health_port}/api/away-engage"
            result = await asyncio.to_thread(self._http_post, url)
            status = json.loads(result)
            self.send_message("away_mode_status", {**status, "source": "phone"})
            logger.info("Away Mode engage requested from phone")
        except Exception as e:
            logger.warning("Away Mode engage failed: %s", e)
            self.send_message("away_mode_status", {"engaged": False, "error": str(e)})

    async def _handle_away_mode_disengage(self, pin: str | None) -> None:
        """Disengage Away Mode via Tauri health server POST endpoint.

        Phone-initiated unlock does not require PIN (AC-4). The Tauri
        endpoint accepts a `source=phone` parameter to skip PIN verification.
        """
        try:
            tauri_health_port = self._tauri_health_port()
            url = f"http://127.0.0.1:{tauri_health_port}/api/away-disengage?source=phone"
            result = await asyncio.to_thread(self._http_post, url)
            status = json.loads(result)
            self.send_message("away_mode_status", {**status, "source": "phone"})
            logger.info("Away Mode disengage requested from phone")
        except Exception as e:
            logger.warning("Away Mode disengage failed: %s", e)
            self.send_message("away_mode_status", {"away_mode": False, "error": str(e)})

    async def _send_away_mode_status_async(self) -> None:
        """Send current Away Mode status to the mobile client (async-safe)."""
        try:
            tauri_health_port = self._tauri_health_port()
            url = f"http://127.0.0.1:{tauri_health_port}/api/away-status"
            result = await asyncio.to_thread(self._http_get, url)
            status = json.loads(result)
            self.send_message("away_mode_status", status)
        except Exception:
            self.send_message("away_mode_status", {"away_mode": False, "overlay_active": False})

    @staticmethod
    def _tauri_health_port() -> int:
        """Return the Tauri Away Mode health server port (main port + 1)."""
        return int(os.environ.get("CONTOP_PORT", "8000")) + 1

    @staticmethod
    def _http_get(url: str, timeout: float = 2.0) -> str:
        """Synchronous HTTP GET helper (run via asyncio.to_thread)."""
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")

    @staticmethod
    def _http_post(url: str, timeout: float = 5.0) -> str:
        """Synchronous HTTP POST helper (run via asyncio.to_thread)."""
        req = urllib.request.Request(url, data=b"", method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")

    async def _handle_manual_control(self, data: dict) -> None:
        """Handle manual_control message. Bypasses the Dual-Tool Evaluator.

        If the agent is currently executing, cancels it first (take-over pattern).
        """
        # Cancel running execution if active (manual control takes over)
        if self._has_running_execution():
            self._execution_cancelled = True
            if self._execution_agent is not None:
                self._execution_agent.cancel()
            if self._execution_task is not None and not self._execution_task.done():
                self._execution_task.cancel()
            logger.info("Manual control interrupted running execution")

        from tools.manual_control import handle_manual_control
        payload = data.get("payload", {})
        action = payload.get("action", "")
        result = await handle_manual_control(action, payload)
        self.send_message("manual_control_result", result)

    async def _handle_user_intent(self, data: dict) -> None:
        """Handle user_intent message: relay to ADK ExecutionAgent.

        Lazy-initializes the ExecutionAgent on first use. The heavy module
        imports are done at server startup (module-level import above), so
        the constructor here is fast and safe to call on the event loop.
        """
        # Reset cancellation flag (H2 pattern from Story 3.1)
        self._execution_cancelled = False

        try:
            # Lazy-initialize the execution agent on first use.
            # Module-level import ensures google.adk/genai are already loaded,
            # so the constructor is fast (no heavy I/O or network calls).
            if self._execution_agent is None:
                self._execution_agent = ExecutionAgent()

            # Attempt to restore ADK session from persistent storage (reconnect).
            # Done here (not in session_context handler) to avoid race with run_intent.
            if self._pending_adk_session_id:
                logger.info("Attempting ADK session restore: %s", self._pending_adk_session_id)
                await self._execution_agent.restore_session(self._pending_adk_session_id)
                self._pending_adk_session_id = None
            else:
                logger.info("No pending ADK session to restore")

            payload = data.get("payload", {})
            text = payload.get("text", "")
            # Backward compat: old clients send "model", new send "execution_model"
            execution_model = payload.get("execution_model") or payload.get("model")
            raw_backend = payload.get("computer_use_backend", "omniparser")
            computer_use_backend = raw_backend if raw_backend in VALID_BACKENDS else "omniparser"
            thinking = payload.get("thinking", True)  # Thinking preference from mobile
            conversation_context = payload.get("conversation_context", "") or self._reconnect_context
            custom_instructions = payload.get("custom_instructions") or None
            # Mobile tells us whether it's using subscription (CLI proxy) for this model.
            # If explicitly False, the server must NOT route through the CLI proxy even
            # if the server's own settings say cli_proxy - mobile's choice wins.
            use_subscription = payload.get("use_subscription")

            # Send state_update immediately
            self.send_message("state_update", {"ai_state": "processing"})

            # Store as a task so execution_stop can cancel it
            self._execution_task = asyncio.current_task()
            try:
                await self._execution_agent.run_intent(
                    text=text,
                    send_message_fn=self.send_message,
                    model=execution_model,
                    thinking=thinking,
                    conversation_context=conversation_context,
                    computer_use_backend=computer_use_backend,
                    custom_instructions=custom_instructions,
                    use_subscription=use_subscription,
                )
            finally:
                self._execution_task = None

        except asyncio.CancelledError:
            raise  # Preserve cancellation semantics
        except Exception:
            logger.exception("_handle_user_intent failed")
            self.send_message("agent_result", {
                "answer": "An error occurred while initializing the execution agent. Please try again.",
                "steps_taken": 0,
                "duration_ms": 0,
            })
            self.send_message("state_update", {"ai_state": "idle"})

    def _handle_agent_confirmation_response(self, data: dict) -> None:
        """Handle agent_confirmation_response: resolve pending confirmation future."""
        if self._execution_agent is None:
            logger.warning("Confirmation response received but no execution agent active")
            return

        payload = data.get("payload", {})
        request_id = payload.get("request_id", "")
        approved = payload.get("approved", False)

        self._execution_agent.resolve_confirmation(request_id, approved)

    async def _keepalive_loop(self) -> None:
        """Periodically send keepalive messages every KEEPALIVE_INTERVAL_SECONDS.

        Does NOT close the connection on missed responses. Mobile apps pause JS
        execution when backgrounded - keepalive replies stop but the P2P ICE
        transport stays alive (STUN binding requests continue at the ICE layer).
        Closing the connection here would kill a viable session.

        The connection is closed by:
        - Client sending session_end via data channel
        - New signaling connection for the same token (reconnection)
        - Server shutdown
        """
        send_count = 0
        try:
            logger.info("Keepalive loop running - first send in %ds", KEEPALIVE_INTERVAL_SECONDS)
            while True:
                await asyncio.sleep(KEEPALIVE_INTERVAL_SECONDS)
                if self._closed:
                    logger.info("Keepalive loop exiting - peer closed (sent %d total)", send_count)
                    return
                try:
                    dc = self._data_channel
                    if dc and dc.readyState == "open":
                        self._missed_client_responses += 1
                        if self._missed_client_responses == MAX_MISSED_CLIENT_RESPONSES:
                            logger.warning(
                                "Client unresponsive after %d keepalives - keeping connection alive (mobile may be backgrounded)",
                                self._missed_client_responses,
                            )
                        self.send_message("keepalive", {})
                        send_count += 1
                        logger.debug("Keepalive #%d sent (missed_responses=%d)", send_count, self._missed_client_responses)
                    else:
                        logger.warning("Keepalive skip - dc=%s state=%s", dc is not None, getattr(dc, "readyState", "N/A") if dc else "N/A")
                except Exception:
                    logger.exception("Keepalive iteration failed - continuing")
        except asyncio.CancelledError:
            logger.info("Keepalive loop cancelled (sent %d total)", send_count)
        except Exception:
            logger.exception("Keepalive loop crashed - this kills server→mobile heartbeat")

    def _has_running_execution(self) -> bool:
        """Check if an execution task is currently running."""
        return self._execution_task is not None and not self._execution_task.done()

    async def _kill_execution_on_disconnect(self) -> None:
        """Immediately cancel running execution when data channel closes.

        Connection loss means the mobile can't receive progress or confirmations,
        so continuing execution is pointless and potentially dangerous (no user
        oversight). Queues a notification for the mobile to see on reconnect.
        """
        logger.warning("Killing execution due to connection loss")

        if self._execution_agent is not None:
            self._execution_agent.cancel()
        if self._execution_task and not self._execution_task.done():
            self._execution_task.cancel()
            try:
                await self._execution_task
            except (asyncio.CancelledError, Exception):
                pass

        # Queue messages so mobile sees them on reconnect
        self._message_queue.append(("agent_result", {
            "answer": "Connection lost - the running execution was stopped for safety.",
            "steps_taken": 0,
            "duration_ms": 0,
        }))
        self._message_queue.append(("state_update", {"ai_state": "idle"}))

        # Close peer connection and unregister to prevent resource leak
        await self._close_and_unregister()

    def detach_execution(self) -> tuple | None:
        """Detach running execution from this peer for transfer to a new peer.

        Returns (agent, task, queued_messages) if execution is running, else None.
        The peer will NOT cancel the execution on close() after detachment.
        """
        if not self._has_running_execution():
            return None

        agent = self._execution_agent
        task = self._execution_task
        queued = list(self._message_queue)

        # Null out so close() won't cancel
        self._execution_agent = None
        self._execution_task = None
        self._message_queue.clear()

        logger.info("Detached execution agent + task for peer transfer")
        return (agent, task, queued)

    def adopt_execution(self, agent: "ExecutionAgent", task: asyncio.Task, queued_messages: list) -> None:
        """Adopt a running execution from a previous peer.

        Re-wires the agent's send_message_fn to this peer's send_message,
        loads queued messages, and flushes them when the data channel opens.
        """
        self._execution_agent = agent
        self._execution_task = task

        # Re-wire the agent to send through this peer
        agent._send_message_fn = self.send_message

        # Load queued messages from old peer
        for msg_type, payload in queued_messages:
            self._message_queue.append((msg_type, payload))

        # If data channel is already open, flush immediately
        if self._data_channel and self._data_channel.readyState == "open":
            self._flush_message_queue()

        logger.info("Adopted execution agent + task from previous peer (%d queued messages)", len(queued_messages))

    async def _close_and_unregister(self) -> None:
        """Close peer connection and remove from the active peers registry."""
        await self.close()
        # Remove ourselves from _active_peers to prevent memory leaks
        try:
            from core.webrtc_signaling import _active_peers
            keys_to_remove = [k for k, v in _active_peers.items() if v is self]
            for k in keys_to_remove:
                _active_peers.pop(k, None)
        except Exception:
            pass

    async def close(self) -> None:
        """Close the peer connection and cancel keepalive task."""
        self._closed = True

        if self._keepalive_task:
            self._keepalive_task.cancel()
            self._keepalive_task = None

        if self._device_control_task and not self._device_control_task.done():
            self._device_control_task.cancel()
        self._device_control_task = None

        if self._manual_control_task and not self._manual_control_task.done():
            self._manual_control_task.cancel()
        self._manual_control_task = None

        if self._execution_task and not self._execution_task.done():
            self._execution_task.cancel()
        self._execution_task = None

        self._fast_data_channel = None

        if self._jpeg_relay_task:
            self._jpeg_relay_task.cancel()
            self._jpeg_relay_task = None

        if self._screen_track:
            self._screen_track.stop()
            self._screen_track = None

        # keep_host_awake is a global setting - do NOT turn it off on session close.

        try:
            await self._pc.close()
        except Exception:
            logger.debug("Error closing peer connection", exc_info=True)
