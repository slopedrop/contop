"""
ATDD - Story 1.4: WebRTC P2P Session Tunnel — Peer Connection Manager Tests
Unit Tests for WebRTC peer connection lifecycle, data channel, message envelope, and keepalive

These tests validate acceptance criteria:
  AC4: WebRTC connection (DTLS/SRTP encrypted) must negotiate an ICE connection
  AC5: Data channel for JSON message exchange must be established
  AC6: Data channel must use canonical message envelope {type, id, payload}
  AC9: Keepalive mechanism (30s interval) must run over the data channel

Module under test: core.webrtc_peer
"""
import json
import re
import uuid
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from core.webrtc_peer import (
    WebRTCPeerManager,
    KEEPALIVE_INTERVAL_SECONDS,
    DATA_CHANNEL_NAME,
)


# UUID v4 pattern for message ID validation
UUID_V4_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

SAMPLE_STUN_CONFIG = {
    "ice_servers": [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]
}


@pytest.mark.unit
class TestPeerConnectionCreation:
    """1.4-UNIT-003: WebRTC peer connection creation and configuration"""

    async def test_peer_connection_created_with_ice_servers(self):
        """[P0] Peer connection is created with ICE servers from token stun_config.

        Given: A stun_config from the pairing token with specific ICE servers
        When:  A WebRTCPeerManager is created with that config
        Then:  The underlying RTCPeerConnection must be configured with those ICE servers
        """
        # Given / When
        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)

        # Then — RTCPeerConnection must have been created with the ICE servers
        MockRTCPC.assert_called_once()
        create_call_kwargs = MockRTCPC.call_args
        # The configuration should include the ICE servers from stun_config
        config = create_call_kwargs.kwargs.get(
            "configuration", create_call_kwargs.args[0] if create_call_kwargs.args else None
        )
        assert config is not None, "RTCPeerConnection must receive a configuration"
        assert hasattr(config, "iceServers"), (
            f"Configuration must include iceServers, got: {config}"
        )
        urls = [s.urls for s in config.iceServers]
        expected_urls = [s["urls"] for s in SAMPLE_STUN_CONFIG["ice_servers"]]
        assert urls == expected_urls, (
            f"ICE server URLs must match stun_config, got: {urls}"
        )

    async def test_sdp_offer_set_and_answer_created(self):
        """[P0] SDP offer is set as remote description and answer is created and returned.

        Given: A WebRTCPeerManager with an active peer connection
        When:  handle_offer() is called with an SDP offer string
        Then:  The offer must be set as remote description, an answer created,
               set as local description, and the answer SDP returned
        """
        # Given
        offer_sdp = "v=0\r\no=- 123 1 IN IP4 0.0.0.0\r\ns=contop\r\n..."
        answer_sdp = "v=0\r\no=- 456 1 IN IP4 0.0.0.0\r\ns=contop\r\n..."

        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            mock_answer = MagicMock()
            mock_answer.sdp = answer_sdp
            mock_answer.type = "answer"
            mock_pc.createAnswer = AsyncMock(return_value=mock_answer)
            mock_pc.localDescription = mock_answer
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)

            # When
            result = await manager.handle_offer(offer_sdp)

        # Then
        mock_pc.setRemoteDescription.assert_called_once()
        remote_desc_arg = mock_pc.setRemoteDescription.call_args.args[0]
        assert remote_desc_arg.sdp == offer_sdp, (
            "Remote description SDP must match the offer"
        )
        assert remote_desc_arg.type == "offer", (
            "Remote description type must be 'offer'"
        )

        mock_pc.createAnswer.assert_called_once()
        mock_pc.setLocalDescription.assert_called_once()

        assert result is not None, "handle_offer must return a result"
        assert result.get("type") == "answer", (
            f"Result type must be 'answer', got: {result.get('type')}"
        )
        assert result.get("sdp") == answer_sdp, (
            f"Result sdp must match the answer, got: {result.get('sdp')}"
        )

    async def test_data_channel_initially_none_awaiting_remote(self):
        """[P0] Data channel starts as None — received via datachannel event from mobile.

        Given: A WebRTCPeerManager with an active peer connection
        When:  The peer connection is created
        Then:  _data_channel must be None (awaiting mobile's data channel via event)
               and DATA_CHANNEL_NAME constant must be "contop"
        """
        # Given / When
        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)

        # Then
        assert manager._data_channel is None, (
            "Data channel must be None initially (received via datachannel event)"
        )
        assert DATA_CHANNEL_NAME == "contop", (
            f"DATA_CHANNEL_NAME constant must be 'contop', got: '{DATA_CHANNEL_NAME}'"
        )

    async def test_ice_candidates_added_to_peer_connection(self):
        """[P1] ICE candidates received from signaling are added to peer connection.

        Given: A WebRTCPeerManager with an active peer connection
        When:  add_ice_candidate() is called with candidate data
        Then:  The candidate must be added to the RTCPeerConnection
        """
        # Given
        candidate_data = {
            "candidate": "candidate:1 1 UDP 2130706431 192.168.1.1 54400 typ host",
            "sdpMid": "0",
            "sdpMLineIndex": 0,
        }

        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)

            # When
            await manager.add_ice_candidate(candidate_data)

        # Then
        mock_pc.addIceCandidate.assert_called_once()
        added_candidate = mock_pc.addIceCandidate.call_args.args[0]
        assert added_candidate.ip == "192.168.1.1", (
            f"ICE candidate IP must match, got: {added_candidate.ip}"
        )
        assert added_candidate.port == 54400, (
            f"ICE candidate port must match, got: {added_candidate.port}"
        )


@pytest.mark.unit
class TestMessageEnvelope:
    """1.4-UNIT-004: Data channel canonical message envelope format"""

    async def test_data_channel_messages_use_canonical_envelope(self):
        """[P0] Data channel messages use canonical envelope {type, id, payload}.

        Given: A WebRTCPeerManager with a data channel received from mobile
        When:  A message is sent on the data channel
        Then:  The message must be a JSON object with exactly the keys: type, id, payload
        """
        # Given
        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)
            mock_channel = MagicMock()
            mock_channel.readyState = "open"
            manager._data_channel = mock_channel

            # When
            manager.send_message("test_type", {"key": "value"})

        # Then
        mock_channel.send.assert_called_once()
        sent_raw = mock_channel.send.call_args.args[0]
        sent_msg = json.loads(sent_raw)

        required_keys = {"type", "id", "payload"}
        assert set(sent_msg.keys()) == required_keys, (
            f"Message must have exactly keys {required_keys}, got: {set(sent_msg.keys())}"
        )
        assert sent_msg["type"] == "test_type", (
            f"Message type must match, got: {sent_msg['type']}"
        )
        assert sent_msg["payload"] == {"key": "value"}, (
            f"Message payload must match, got: {sent_msg['payload']}"
        )

    async def test_message_id_is_valid_uuid_v4(self):
        """[P0] Message id field is a valid UUID v4 string.

        Given: A WebRTCPeerManager with a data channel received from mobile
        When:  A message is sent on the data channel
        Then:  The id field must be a valid UUID v4
        """
        # Given
        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)
            mock_channel = MagicMock()
            mock_channel.readyState = "open"
            manager._data_channel = mock_channel

            # When
            manager.send_message("test_type", {})

        # Then
        sent_raw = mock_channel.send.call_args.args[0]
        sent_msg = json.loads(sent_raw)

        msg_id = sent_msg["id"]
        assert UUID_V4_PATTERN.match(msg_id), (
            f"Message id must be a valid UUID v4, got: '{msg_id}'"
        )

        # Also verify it parses as UUID v4
        parsed_uuid = uuid.UUID(msg_id)
        assert parsed_uuid.version == 4, (
            f"Message id UUID version must be 4, got: {parsed_uuid.version}"
        )


@pytest.mark.unit
class TestKeepalive:
    """1.4-UNIT-005: Keepalive mechanism on data channel"""

    async def test_keepalive_interval_is_30_seconds(self):
        """[P0] Keepalive interval constant must be 30 seconds.

        Given: The KEEPALIVE_INTERVAL_SECONDS module constant
        When:  We read its value
        Then:  It must be 30
        """
        assert KEEPALIVE_INTERVAL_SECONDS == 30, (
            f"KEEPALIVE_INTERVAL_SECONDS should be 30, got {KEEPALIVE_INTERVAL_SECONDS}"
        )

    async def test_keepalive_sent_on_data_channel(self):
        """[P0] Keepalive is sent every 30s on the data channel.

        Given: A WebRTCPeerManager with an open data channel
        When:  The keepalive task fires
        Then:  A keepalive message must be sent on the data channel
        """
        # Given
        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            mock_channel = MagicMock()
            mock_channel.readyState = "open"
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)
            manager._data_channel = mock_channel

            # When — directly invoke the keepalive send method
            manager.send_keepalive()

        # Then
        mock_channel.send.assert_called_once()
        sent_raw = mock_channel.send.call_args.args[0]
        sent_msg = json.loads(sent_raw)

        assert sent_msg["type"] == "keepalive", (
            f"Keepalive message type must be 'keepalive', got: '{sent_msg['type']}'"
        )

    async def test_keepalive_uses_canonical_envelope(self):
        """[P0] Keepalive message uses canonical envelope with type "keepalive".

        Given: A WebRTCPeerManager with an open data channel
        When:  A keepalive message is sent
        Then:  The message must follow canonical format: {type: "keepalive", id: "<uuid-v4>", payload: {}}
        """
        # Given
        with patch("core.webrtc_peer.RTCPeerConnection") as MockRTCPC:
            mock_pc = AsyncMock()
            mock_channel = MagicMock()
            mock_channel.readyState = "open"
            MockRTCPC.return_value = mock_pc

            manager = WebRTCPeerManager(stun_config=SAMPLE_STUN_CONFIG)
            manager._data_channel = mock_channel

            # When
            manager.send_keepalive()

        # Then
        sent_raw = mock_channel.send.call_args.args[0]
        sent_msg = json.loads(sent_raw)

        # Must have exactly the canonical keys
        assert set(sent_msg.keys()) == {"type", "id", "payload"}, (
            f"Keepalive must have canonical envelope keys, got: {set(sent_msg.keys())}"
        )
        assert sent_msg["type"] == "keepalive", (
            f"Keepalive type must be 'keepalive', got: '{sent_msg['type']}'"
        )
        assert sent_msg["payload"] == {}, (
            f"Keepalive payload must be empty dict, got: {sent_msg['payload']}"
        )

        # Verify UUID v4 id
        msg_id = sent_msg["id"]
        assert UUID_V4_PATTERN.match(msg_id), (
            f"Keepalive id must be valid UUID v4, got: '{msg_id}'"
        )
        parsed_uuid = uuid.UUID(msg_id)
        assert parsed_uuid.version == 4, (
            f"Keepalive id UUID version must be 4, got: {parsed_uuid.version}"
        )
