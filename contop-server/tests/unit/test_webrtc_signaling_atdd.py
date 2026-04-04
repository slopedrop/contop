"""
ATDD - Story 1.4: WebRTC P2P Session Tunnel — Signaling Server Tests
Unit Tests for WebSocket signaling endpoint, token validation, and connection registry

These tests validate acceptance criteria:
  AC3: Server must validate the token before proceeding with the WebRTC handshake
  AC8: Server WebSocket signaling endpoint must run over WSS-ready path (/ws/signaling)
  AC10: All signaling messages (SDP offer/answer, ICE candidates) exchanged over WebSocket

Module under test: core.webrtc_signaling
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.websockets import WebSocketDisconnect

from core.webrtc_signaling import (
    signaling_websocket,
    connection_registry,
    _active_peers,
)


@pytest.fixture(autouse=True)
def clear_connection_registry():
    """Clear the connection registry and active peers before each test."""
    connection_registry.clear()
    _active_peers.clear()
    yield
    connection_registry.clear()
    _active_peers.clear()


def _make_valid_pairing_token():
    """Create a mock PairingToken object for testing."""
    token = MagicMock()
    token.token = str(uuid.uuid4())
    token.dtls_fingerprint = "AA:BB:CC:DD:" + ":".join(f"{i:02X}" for i in range(28))
    token.stun_config = {
        "ice_servers": [
            {"urls": "stun:stun.l.google.com:19302"},
        ]
    }
    token.created_at = datetime.now(timezone.utc)
    token.expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    token.device_id = "test-device"
    return token


@pytest.mark.unit
class TestSignalingTokenValidation:
    """1.4-UNIT-001: WebSocket signaling token validation"""

    async def test_valid_token_accepts_websocket(self):
        """[P0] Valid pairing token allows WebSocket connection to be accepted.

        Given: A valid pairing token in the registry
        When:  A WebSocket connects to /ws/signaling?token=<valid-token>
        Then:  The connection must be accepted (websocket.accept() called)
        """
        # Given
        mock_token = _make_valid_pairing_token()
        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": mock_token.token}
        mock_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        with patch(
            "core.webrtc_signaling.validate_token",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        # Then
        mock_ws.accept.assert_called_once()

    async def test_invalid_token_closes_with_4001(self):
        """[P0] Invalid token causes WebSocket to close with code 4001.

        Given: An invalid pairing token (not in registry)
        When:  A WebSocket connects to /ws/signaling?token=<invalid-token>
        Then:  The connection must be closed with code 4001
        """
        # Given
        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": "invalid-token-not-in-registry"}

        with patch(
            "core.webrtc_signaling.validate_token",
            new_callable=AsyncMock,
            return_value=None,
        ):
            await signaling_websocket(mock_ws)

        # Then
        mock_ws.close.assert_called_once_with(code=4001)
        mock_ws.accept.assert_not_called()

    async def test_missing_token_query_param_rejects(self):
        """[P1] Missing token query parameter causes WebSocket rejection.

        Given: A WebSocket connection request with no token query parameter
        When:  The signaling endpoint processes the connection
        Then:  The connection must be closed with code 4001 (no accept)
        """
        # Given
        mock_ws = AsyncMock()
        mock_ws.query_params = {}

        # When
        await signaling_websocket(mock_ws)

        # Then
        mock_ws.close.assert_called_once_with(code=4001)
        mock_ws.accept.assert_not_called()

    async def test_expired_token_rejects_websocket(self):
        """[P1] Expired token causes WebSocket rejection with code 4001.

        Given: A pairing token that has expired (validate_token returns None)
        When:  A WebSocket connects with the expired token
        Then:  The connection must be closed with code 4001
        """
        # Given
        expired_token_str = str(uuid.uuid4())
        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": expired_token_str}

        with patch(
            "core.webrtc_signaling.validate_token",
            new_callable=AsyncMock,
            return_value=None,  # expired tokens return None
        ):
            await signaling_websocket(mock_ws)

        # Then
        mock_ws.close.assert_called_once_with(code=4001)
        mock_ws.accept.assert_not_called()


@pytest.mark.unit
class TestSignalingMessageRouting:
    """1.4-UNIT-002: Signaling message routing through WebSocket"""

    async def test_sdp_offer_forwarded_to_peer_manager(self):
        """[P0] SDP offer message received on WebSocket is forwarded to peer manager.

        Given: An authenticated WebSocket connection
        When:  The client sends {"type": "offer", "sdp": "<sdp-string>"}
        Then:  The peer manager must receive the offer for processing
        """
        # Given
        mock_token = _make_valid_pairing_token()
        offer_sdp = "v=0\r\no=- 123 1 IN IP4 0.0.0.0\r\n..."
        offer_msg = {"type": "offer", "sdp": offer_sdp}

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": mock_token.token}
        mock_ws.receive_json = AsyncMock(
            side_effect=[offer_msg, Exception("disconnect")]
        )

        mock_peer_manager = AsyncMock()
        mock_peer_manager.handle_offer = AsyncMock(
            return_value={"type": "answer", "sdp": "answer-sdp"}
        )

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer_manager,
            ),
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        # Then
        mock_peer_manager.handle_offer.assert_called_once_with(offer_sdp)

    async def test_sdp_answer_sent_back_via_websocket(self):
        """[P0] SDP answer generated by peer manager is sent back through WebSocket.

        Given: An authenticated WebSocket and a peer manager that creates an SDP answer
        When:  The client sends an SDP offer
        Then:  The server must send the answer back via websocket.send_json()
        """
        # Given
        mock_token = _make_valid_pairing_token()
        offer_msg = {"type": "offer", "sdp": "offer-sdp-string"}
        answer_payload = {"type": "answer", "sdp": "answer-sdp-string"}

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": mock_token.token}
        mock_ws.receive_json = AsyncMock(
            side_effect=[offer_msg, Exception("disconnect")]
        )

        mock_peer_manager = AsyncMock()
        mock_peer_manager.handle_offer = AsyncMock(return_value=answer_payload)

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer_manager,
            ),
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        # Then — answer sent back to client via WebSocket
        sent_messages = [
            call.args[0]
            for call in mock_ws.send_json.call_args_list
        ]
        assert any(
            msg.get("type") == "answer" and msg.get("sdp") == "answer-sdp-string"
            for msg in sent_messages
        ), (
            f"Expected answer message with sdp sent via WebSocket, "
            f"got sent messages: {sent_messages}"
        )

    async def test_ice_candidate_added_to_peer_connection(self):
        """[P0] ICE candidate message is forwarded to peer connection.

        Given: An authenticated WebSocket and active peer manager
        When:  The client sends {"type": "ice_candidate", "candidate": {...}}
        Then:  The candidate must be added to the peer connection
        """
        # Given
        mock_token = _make_valid_pairing_token()
        candidate_data = {
            "candidate": "candidate:1 1 UDP 2130706431 192.168.1.1 54400 typ host",
            "sdpMid": "0",
            "sdpMLineIndex": 0,
        }
        ice_msg = {"type": "ice_candidate", "candidate": candidate_data}

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": mock_token.token}
        mock_ws.receive_json = AsyncMock(
            side_effect=[ice_msg, Exception("disconnect")]
        )

        mock_peer_manager = AsyncMock()
        mock_peer_manager.add_ice_candidate = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer_manager,
            ),
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        # Then
        mock_peer_manager.add_ice_candidate.assert_called_once_with(candidate_data)

    async def test_unknown_message_type_handled_gracefully(self):
        """[P1] Unknown or invalid message type does not crash the signaling handler.

        Given: An authenticated WebSocket connection
        When:  The client sends {"type": "unknown_type", "data": "..."}
        Then:  The server must handle it gracefully (no crash, connection stays open)
        """
        # Given
        mock_token = _make_valid_pairing_token()
        unknown_msg = {"type": "unknown_type", "data": "some-data"}

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": mock_token.token}
        mock_ws.receive_json = AsyncMock(
            side_effect=[unknown_msg, Exception("disconnect")]
        )

        mock_peer_manager = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer_manager,
            ),
        ):
            # When / Then — no unhandled exception should propagate
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        # Then — the WebSocket should have been accepted (connection was valid)
        mock_ws.accept.assert_called_once()
        # And the server should not have force-closed the connection
        mock_ws.close.assert_not_called()


@pytest.mark.unit
class TestConnectionRegistryCleanup:
    """1.4-UNIT-006: Connection registry cleanup on disconnect and revocation"""

    async def test_websocket_disconnect_removes_registry_entry(self):
        """[P1] WebSocket disconnect causes connection registry entry to be removed.

        Given: An authenticated WebSocket registered in the connection registry
        When:  The WebSocket disconnects
        Then:  The connection_registry entry for that token must be removed
        """
        # Given
        mock_token = _make_valid_pairing_token()
        token_str = mock_token.token

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": token_str}
        # Simulate immediate disconnect after connect
        mock_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        mock_peer_manager = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer_manager,
            ),
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        # Then — the token should no longer be in the connection registry
        assert token_str not in connection_registry, (
            f"Token '{token_str}' should have been removed from connection_registry after disconnect"
        )

    async def test_token_revoke_force_closes_webrtc_session(self):
        """[P2] Revoking a token force-closes the associated WebRTC session.

        Given: An active WebRTC session registered in the connection registry
        When:  The token associated with that session is revoked
        Then:  The WebSocket and peer connection must be force-closed
              and the registry entry removed
        """
        # Given — manually seed the connection registry and active peers with a mock session
        token_str = str(uuid.uuid4())
        mock_ws = AsyncMock()
        mock_peer_manager = AsyncMock()
        connection_registry[token_str] = {
            "websocket": mock_ws,
            "peer_manager": mock_peer_manager,
        }
        _active_peers[token_str] = mock_peer_manager

        # When — import and call the force-close function
        from core.webrtc_signaling import force_close_session

        await force_close_session(token_str)

        # Then
        mock_peer_manager.close.assert_called_once()
        mock_ws.close.assert_called_once()
        assert token_str not in connection_registry, (
            "Registry entry must be removed after force-close"
        )
        assert token_str not in _active_peers, (
            "Active peers entry must be removed after force-close"
        )
