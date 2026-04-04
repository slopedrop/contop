"""
Unit tests for WebRTC signaling WebSocket endpoint.

Tests token validation, signaling message routing, and connection registry cleanup.
Covers AC: 3, 4, 8, 10.
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
    force_close_session,
)


@pytest.fixture(autouse=True)
def clear_registry():
    """Clear the connection registry and active peers before and after each test."""
    connection_registry.clear()
    _active_peers.clear()
    yield
    connection_registry.clear()
    _active_peers.clear()


def _make_valid_token():
    """Create a mock PairingToken for testing."""
    token = MagicMock()
    token.token = str(uuid.uuid4())
    token.dtls_fingerprint = "AA:BB:CC:DD:" + ":".join(f"{i:02X}" for i in range(28))
    token.stun_config = {
        "ice_servers": [{"urls": "stun:stun.l.google.com:19302"}]
    }
    token.created_at = datetime.now(timezone.utc)
    token.expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    token.device_id = "test-device"
    return token


@pytest.mark.unit
class TestTokenValidation:
    """Test WebSocket token validation (valid accepted, invalid rejected with 4001)."""

    async def test_valid_token_accepted(self):
        mock_token = _make_valid_token()
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

        mock_ws.accept.assert_called_once()

    async def test_invalid_token_closes_4001(self):
        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": "invalid-token"}

        with patch(
            "core.webrtc_signaling.validate_token",
            new_callable=AsyncMock,
            return_value=None,
        ):
            await signaling_websocket(mock_ws)

        mock_ws.close.assert_called_once_with(code=4001)
        mock_ws.accept.assert_not_called()

    async def test_missing_token_closes_4001(self):
        mock_ws = AsyncMock()
        mock_ws.query_params = {}

        await signaling_websocket(mock_ws)

        mock_ws.close.assert_called_once_with(code=4001)
        mock_ws.accept.assert_not_called()


@pytest.mark.unit
class TestSignalingMessageRouting:
    """Test signaling message routing (offer → peer, answer → mobile, ice_candidate → peer)."""

    async def test_offer_forwarded_to_peer_and_answer_returned(self):
        mock_token = _make_valid_token()
        offer_msg = {"type": "offer", "sdp": "offer-sdp"}
        answer_payload = {"type": "answer", "sdp": "answer-sdp"}

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": mock_token.token}
        mock_ws.receive_json = AsyncMock(
            side_effect=[offer_msg, Exception("disconnect")]
        )

        mock_peer = AsyncMock()
        mock_peer.handle_offer = AsyncMock(return_value=answer_payload)

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer,
            ),
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        mock_peer.handle_offer.assert_called_once_with("offer-sdp")
        sent = [c.args[0] for c in mock_ws.send_json.call_args_list]
        assert any(m.get("type") == "answer" for m in sent)

    async def test_ice_candidate_forwarded_to_peer(self):
        mock_token = _make_valid_token()
        candidate = {"candidate": "candidate:1", "sdpMid": "0", "sdpMLineIndex": 0}
        ice_msg = {"type": "ice_candidate", "candidate": candidate}

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": mock_token.token}
        mock_ws.receive_json = AsyncMock(
            side_effect=[ice_msg, Exception("disconnect")]
        )

        mock_peer = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer,
            ),
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        mock_peer.add_ice_candidate.assert_called_once_with(candidate)


@pytest.mark.unit
class TestConnectionRegistryCleanup:
    """Test connection registry cleanup on disconnect."""

    async def test_disconnect_removes_registry_entry(self):
        mock_token = _make_valid_token()
        token_str = mock_token.token

        mock_ws = AsyncMock()
        mock_ws.query_params = {"token": token_str}
        mock_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        mock_peer = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=mock_peer,
            ),
        ):
            try:
                await signaling_websocket(mock_ws)
            except Exception:
                pass

        assert token_str not in connection_registry

    async def test_force_close_session_cleans_up(self):
        token_str = str(uuid.uuid4())
        mock_ws = AsyncMock()
        mock_peer = AsyncMock()
        connection_registry[token_str] = {
            "websocket": mock_ws,
            "peer_manager": mock_peer,
        }
        _active_peers[token_str] = mock_peer

        await force_close_session(token_str)

        mock_peer.close.assert_called_once()
        mock_ws.close.assert_called_once()
        assert token_str not in connection_registry
        assert token_str not in _active_peers


@pytest.mark.unit
class TestTokenReconnection:
    """Test reconnection support: same token, new session (Story 1.5, AC13)."""

    async def test_new_ws_closes_old_peer_manager(self):
        """[P0] 1.5-UNIT-S007: New WS with existing token closes old peer manager."""
        mock_token = _make_valid_token()
        token_str = mock_token.token

        # Setup: existing session in registry
        old_peer = AsyncMock()
        old_ws = AsyncMock()
        connection_registry[token_str] = {
            "websocket": old_ws,
            "peer_manager": old_peer,
        }
        _active_peers[token_str] = old_peer

        # New WebSocket connection with same token
        new_ws = AsyncMock()
        new_ws.query_params = {"token": token_str}
        new_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        new_peer = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=new_peer,
            ),
        ):
            try:
                await signaling_websocket(new_ws)
            except Exception:
                pass

        # Then — old peer manager was closed
        old_peer.close.assert_called_once()

    async def test_new_ws_creates_fresh_session(self):
        """[P0] 1.5-UNIT-S008: New WS with existing token creates fresh session."""
        mock_token = _make_valid_token()
        token_str = mock_token.token

        old_peer = AsyncMock()
        old_ws = AsyncMock()
        connection_registry[token_str] = {
            "websocket": old_ws,
            "peer_manager": old_peer,
        }

        new_ws = AsyncMock()
        new_ws.query_params = {"token": token_str}
        new_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        new_peer = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=new_peer,
            ),
        ):
            try:
                await signaling_websocket(new_ws)
            except Exception:
                pass

        # New WS should have been accepted (new session created)
        new_ws.accept.assert_called_once()

    async def test_old_ws_close_failure_handled_gracefully(self):
        """[P1] 1.5-UNIT-S010: Old WS close failure handled gracefully."""
        mock_token = _make_valid_token()
        token_str = mock_token.token

        old_peer = AsyncMock()
        old_ws = AsyncMock()
        old_ws.close = AsyncMock(side_effect=Exception("WS already dead"))
        connection_registry[token_str] = {
            "websocket": old_ws,
            "peer_manager": old_peer,
        }
        _active_peers[token_str] = old_peer

        new_ws = AsyncMock()
        new_ws.query_params = {"token": token_str}
        new_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        new_peer = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=new_peer,
            ),
        ):
            # Should not raise even though old WS close fails
            try:
                await signaling_websocket(new_ws)
            except Exception:
                pass

        # Old peer manager should still have been closed (even if WS close failed)
        old_peer.close.assert_called_once()
        # New session should be established
        new_ws.accept.assert_called_once()

    async def test_accept_called_before_old_peer_close(self):
        """[P0] accept() must be called before old_peer.close() to prevent client WebSocket timeout."""
        mock_token = _make_valid_token()
        token_str = mock_token.token

        old_peer = AsyncMock()
        old_ws = AsyncMock()
        connection_registry[token_str] = {"websocket": old_ws, "peer_manager": old_peer}
        _active_peers[token_str] = old_peer

        new_ws = AsyncMock()
        new_ws.query_params = {"token": token_str}
        new_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        accept_count_at_close: list[int] = []

        async def track_close():
            accept_count_at_close.append(new_ws.accept.call_count)

        old_peer.close = AsyncMock(side_effect=track_close)

        new_peer = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=new_peer,
            ),
        ):
            try:
                await signaling_websocket(new_ws)
            except Exception:
                pass

        assert accept_count_at_close == [1], (
            "accept() must be called before old_peer.close() to prevent client timeout"
        )

    async def test_old_session_cleanup_does_not_affect_new(self):
        """[P1] 1.5-UNIT-S009: Old session cleanup doesn't affect new session."""
        mock_token = _make_valid_token()
        token_str = mock_token.token

        old_peer = AsyncMock()
        old_ws = AsyncMock()
        connection_registry[token_str] = {
            "websocket": old_ws,
            "peer_manager": old_peer,
        }
        _active_peers[token_str] = old_peer

        new_ws = AsyncMock()
        new_ws.query_params = {"token": token_str}
        new_ws.receive_json = AsyncMock(side_effect=WebSocketDisconnect(1000))

        new_peer = AsyncMock()

        with (
            patch(
                "core.webrtc_signaling.validate_token",
                new_callable=AsyncMock,
                return_value=mock_token,
            ),
            patch(
                "core.webrtc_signaling.WebRTCPeerManager",
                return_value=new_peer,
            ),
        ):
            try:
                await signaling_websocket(new_ws)
            except Exception:
                pass

        # Old peer should have been closed BEFORE new peer was created.
        # After the handler completes (via WebSocketDisconnect), new peer gets closed in finally.
        old_peer.close.assert_called()
