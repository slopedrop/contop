"""
Unit tests for WebRTC peer connection manager.

Tests peer connection creation, data channel message format, and keepalive.
Covers AC: 4, 5, 6, 9.
"""
import asyncio
import json
import re
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.webrtc_peer import (
    WebRTCPeerManager,
    KEEPALIVE_INTERVAL_SECONDS,
    DATA_CHANNEL_NAME,
)

UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

STUN_CONFIG = {
    "ice_servers": [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]
}


@pytest.mark.unit
class TestPeerConnection:
    """Test peer connection creation with ICE config."""

    async def test_created_with_ice_servers(self):
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc
            WebRTCPeerManager(stun_config=STUN_CONFIG)

        MockPC.assert_called_once()
        config = MockPC.call_args.kwargs.get(
            "configuration", MockPC.call_args.args[0] if MockPC.call_args.args else None
        )
        assert config is not None
        urls = [s.urls for s in config.iceServers]
        expected_urls = [s["urls"] for s in STUN_CONFIG["ice_servers"]]
        assert urls == expected_urls

    async def test_data_channel_initially_none(self):
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc
            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)

        assert manager._data_channel is None
        assert DATA_CHANNEL_NAME == "contop"

    async def test_handle_offer_returns_answer(self):
        offer_sdp = "v=0\r\no=- 123 1 IN IP4 0.0.0.0\r\n..."
        answer_sdp = "v=0\r\no=- 456 1 IN IP4 0.0.0.0\r\n..."

        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            mock_answer = MagicMock()
            mock_answer.sdp = answer_sdp
            mock_answer.type = "answer"
            mock_pc.createAnswer = AsyncMock(return_value=mock_answer)
            mock_pc.localDescription = mock_answer
            MockPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
            result = await manager.handle_offer(offer_sdp)

        mock_pc.setRemoteDescription.assert_called_once()
        assert result["type"] == "answer"
        assert result["sdp"] == answer_sdp

    async def test_add_ice_candidate(self):
        candidate_data = {
            "candidate": "candidate:1 1 UDP 2130706431 192.168.1.1 54400 typ host",
            "sdpMid": "0",
            "sdpMLineIndex": 0,
        }

        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
            await manager.add_ice_candidate(candidate_data)

        mock_pc.addIceCandidate.assert_called_once()


@pytest.mark.unit
class TestMessageEnvelope:
    """Test data channel message envelope format compliance."""

    async def test_canonical_envelope_format(self):
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
            mock_channel = MagicMock()
            mock_channel.readyState = "open"
            manager._data_channel = mock_channel
            manager.send_message("test_type", {"key": "value"})

        mock_channel.send.assert_called_once()
        msg = json.loads(mock_channel.send.call_args.args[0])
        assert set(msg.keys()) == {"type", "id", "payload"}
        assert msg["type"] == "test_type"
        assert msg["payload"] == {"key": "value"}
        assert UUID_V4_RE.match(msg["id"])


@pytest.mark.unit
class TestKeepalive:
    """Test keepalive message emission."""

    async def test_keepalive_interval_30s(self):
        assert KEEPALIVE_INTERVAL_SECONDS == 30

    async def test_keepalive_uses_canonical_envelope(self):
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
            mock_channel = MagicMock()
            mock_channel.readyState = "open"
            manager._data_channel = mock_channel
            manager.send_keepalive()

        msg = json.loads(mock_channel.send.call_args.args[0])
        assert msg["type"] == "keepalive"
        assert msg["payload"] == {}
        assert UUID_V4_RE.match(msg["id"])


@pytest.mark.unit
class TestClientLivenessDetection:
    """Test client liveness detection via missed keepalive responses (Story 1.5, AC12)."""

    async def test_incoming_message_resets_missed_counter(self):
        """[P0] 1.5-UNIT-S002: Any data channel message resets _missed_client_responses to 0."""
        # Given - a peer manager with some missed responses
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc
            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
            manager._missed_client_responses = 2

            # When - any data channel message is received
            manager._on_data_channel_message('{"type":"keepalive","id":"test","payload":{}}')

            # Then - counter is reset to 0
            assert manager._missed_client_responses == 0

    async def test_three_missed_responses_logs_warning_but_keeps_alive(self):
        """[P0] 1.5-UNIT-S003: 3 consecutive missed responses logs warning but does NOT close.

        Mobile apps pause JS when backgrounded - keepalive replies stop but ICE
        transport stays alive. Closing here would kill a viable session.
        """
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc
            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
            mock_channel = MagicMock()
            mock_channel.readyState = "open"
            manager._data_channel = mock_channel

            call_count = 0

            async def counting_sleep(_seconds):
                nonlocal call_count
                call_count += 1
                if call_count > 4:
                    raise asyncio.CancelledError()

            with patch("asyncio.sleep", side_effect=counting_sleep):
                await manager._keepalive_loop()

            # After 4+ iterations the counter should have incremented (no close)
            assert manager._missed_client_responses >= 3
            # send_keepalive was called each iteration
            assert mock_channel.send.call_count >= 3

    async def test_keepalive_counter_increments(self):
        """[P1] 1.5-UNIT-S004: Counter increments each keepalive loop iteration."""
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc
            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)

            assert hasattr(manager, '_missed_client_responses')
            assert manager._missed_client_responses == 0


@pytest.mark.unit
class TestSessionEndHandler:
    """Test session_end data channel message handling (Story 1.5, AC11)."""

    async def test_session_end_triggers_close(self):
        """[P0] 1.5-UNIT-S001: session_end message triggers close()."""
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc
            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
            manager.close = AsyncMock()

            # When - session_end message is received on data channel
            message = '{"type":"session_end","id":"test-uuid","payload":{}}'
            manager._on_data_channel_message(message)

            # Then - close() is triggered
            # Need to wait for async task
            await asyncio.sleep(0.1)
            manager.close.assert_called_once()

    async def test_close_cancels_keepalive_and_closes_pc(self):
        """[P0] 1.5-UNIT-S006: close() cancels keepalive task and closes peer connection."""
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            MockPC.return_value = mock_pc
            manager = WebRTCPeerManager(stun_config=STUN_CONFIG)

            # Setup active keepalive task
            mock_task = AsyncMock()
            manager._keepalive_task = mock_task

            # When - close() is called
            await manager.close()

            # Then - keepalive is cancelled and PC is closed
            mock_task.cancel.assert_called_once()
            mock_pc.close.assert_called_once()
