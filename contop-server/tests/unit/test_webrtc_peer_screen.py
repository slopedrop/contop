"""
Integration tests for WebRTCPeerManager screen capture lifecycle.

Tests that handle_offer() creates a ScreenCaptureTrack, data channel
open starts JPEG relay, and close() cleans up all resources.

Covers AC: 3 (resource cleanup).
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from core.webrtc_peer import WebRTCPeerManager
from tools.screen_capture import start_jpeg_relay


STUN_CONFIG = {
    "ice_servers": [
        {"urls": "stun:stun.l.google.com:19302"},
    ]
}


def _create_manager():
    """Create a WebRTCPeerManager with mocked RTCPeerConnection and ScreenCaptureTrack."""
    with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
        mock_pc = AsyncMock()
        MockPC.return_value = mock_pc
        manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
    return manager, mock_pc


@pytest.mark.unit
class TestHandleOfferScreenCapture:
    """5.1: Test that handle_offer creates ScreenCaptureTrack (without adding to PC).

    The track is NOT added to the peer connection because the mobile SDP offer
    only contains a data channel m-line — no video m-line. Adding a video track
    crashes aiortc's setLocalDescription with ValueError when there is no
    matching offer direction. Frames are sent via the JPEG relay on the data
    channel instead.
    """

    async def test_handle_offer_creates_screen_track(self):
        """handle_offer() must create a ScreenCaptureTrack and store it on the manager."""
        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            mock_answer = MagicMock()
            mock_answer.sdp = "v=0\r\nanswer"
            mock_answer.type = "answer"
            mock_pc.createAnswer = AsyncMock(return_value=mock_answer)
            mock_pc.localDescription = mock_answer
            MockPC.return_value = mock_pc

            with patch("core.webrtc_peer.ScreenCaptureTrack") as MockTrack:
                mock_track_instance = MagicMock()
                MockTrack.return_value = mock_track_instance

                manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
                await manager.handle_offer("v=0\r\noffer")

        # ScreenCaptureTrack was created
        MockTrack.assert_called_once()
        # Track is added to peer connection so mobile receives video via WebRTC
        mock_pc.addTrack.assert_called_once_with(mock_track_instance)
        # Track is stored on the manager for JPEG relay use
        assert manager._screen_track is mock_track_instance

    async def test_handle_offer_creates_track_after_remote_before_answer(self):
        """Track must be created AFTER setRemoteDescription and BEFORE createAnswer."""
        call_order = []

        with patch("core.webrtc_peer.RTCPeerConnection") as MockPC:
            mock_pc = AsyncMock()
            mock_answer = MagicMock()
            mock_answer.sdp = "v=0\r\nanswer"
            mock_answer.type = "answer"

            async def track_set_remote(*args):
                call_order.append("setRemoteDescription")
            mock_pc.setRemoteDescription = AsyncMock(side_effect=track_set_remote)

            def track_add_track(track):
                call_order.append("addTrack")
            mock_pc.addTrack = MagicMock(side_effect=track_add_track)

            async def track_create_answer():
                call_order.append("createAnswer")
                return mock_answer
            mock_pc.createAnswer = AsyncMock(side_effect=track_create_answer)
            mock_pc.localDescription = mock_answer
            MockPC.return_value = mock_pc

            with patch("core.webrtc_peer.ScreenCaptureTrack") as MockTrack:
                def track_screen_capture():
                    call_order.append("ScreenCaptureTrack")
                    return MagicMock()
                MockTrack.side_effect = track_screen_capture
                manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
                await manager.handle_offer("v=0\r\noffer")

        assert call_order == ["setRemoteDescription", "ScreenCaptureTrack", "addTrack", "createAnswer"]


class _MockPCWithEvents:
    """Mock RTCPeerConnection that supports the .on() decorator pattern."""

    def __init__(self):
        self._handlers = {}
        self.close = AsyncMock()
        self.setRemoteDescription = AsyncMock()
        self.createAnswer = AsyncMock(
            return_value=MagicMock(sdp="v=0\r\nanswer", type="answer")
        )
        self.setLocalDescription = AsyncMock()
        self.addTrack = MagicMock()
        self.addIceCandidate = AsyncMock()
        self.localDescription = MagicMock(sdp="v=0\r\nanswer")

    def on(self, event):
        def decorator(fn):
            self._handlers[event] = fn
            return fn
        return decorator

    def trigger(self, event, *args):
        handler = self._handlers.get(event)
        if handler:
            return handler(*args)


@pytest.mark.unit
class TestDataChannelStartsRelay:
    """5.2: Test that data channel open does NOT start JPEG relay.

    Continuous 1fps screenshot streaming (~150KB/frame) over the SCTP data
    channel overwhelms reliable transport on slower links, causing SCTP abort.
    Frames are sent on-demand when user_intent needs LLM context. The video
    track (RTP) handles live display.
    """

    async def test_datachannel_event_does_not_start_jpeg_relay(self):
        """When data channel is received, JPEG relay must NOT start (on-demand only)."""
        mock_pc = _MockPCWithEvents()
        with patch("core.webrtc_peer.RTCPeerConnection", return_value=mock_pc):
            with patch("core.webrtc_peer.start_jpeg_relay") as mock_start_relay:
                manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
                mock_track = MagicMock()
                manager._screen_track = mock_track

                # Simulate mobile opening the data channel
                mock_channel = MagicMock()
                mock_channel.label = "contop"
                mock_pc.trigger("datachannel", mock_channel)

        mock_start_relay.assert_not_called()
        assert manager._jpeg_relay_task is None

    async def test_datachannel_event_skips_relay_when_no_track(self):
        """When data channel opens but no screen track exists, relay must NOT start."""
        mock_pc = _MockPCWithEvents()
        with patch("core.webrtc_peer.RTCPeerConnection", return_value=mock_pc):
            with patch("core.webrtc_peer.start_jpeg_relay") as mock_start_relay:
                manager = WebRTCPeerManager(stun_config=STUN_CONFIG)
                assert manager._screen_track is None

                mock_channel = MagicMock()
                mock_channel.label = "contop"
                mock_pc.trigger("datachannel", mock_channel)

        mock_start_relay.assert_not_called()
        assert manager._jpeg_relay_task is None

    async def test_jpeg_relay_task_attribute_initialized(self):
        """Manager must initialize _jpeg_relay_task attribute to None."""
        manager, _ = _create_manager()
        assert hasattr(manager, "_jpeg_relay_task")
        assert manager._jpeg_relay_task is None

    async def test_screen_track_attribute_initialized(self):
        """Manager must initialize _screen_track attribute to None."""
        manager, _ = _create_manager()
        assert hasattr(manager, "_screen_track")
        assert manager._screen_track is None


@pytest.mark.unit
class TestCloseCleanup:
    """5.3, 5.4: Test that close() cancels JPEG relay and stops screen track."""

    async def test_close_cancels_relay_and_stops_track(self):
        """5.3: close() must cancel JPEG relay task and stop screen track."""
        manager, mock_pc = _create_manager()

        mock_relay_task = MagicMock()
        manager._jpeg_relay_task = mock_relay_task

        mock_track = MagicMock()
        manager._screen_track = mock_track

        await manager.close()

        mock_relay_task.cancel.assert_called_once()
        mock_track.stop.assert_called_once()
        assert manager._jpeg_relay_task is None
        assert manager._screen_track is None
        mock_pc.close.assert_called_once()

    async def test_close_works_without_screen_capture(self):
        """5.4: close() must work cleanly when screen capture was never started."""
        manager, mock_pc = _create_manager()

        assert manager._screen_track is None
        assert manager._jpeg_relay_task is None

        # Should not raise
        await manager.close()

        mock_pc.close.assert_called_once()

    async def test_close_cleanup_order(self):
        """5.3: Cleanup order must be: keepalive -> relay -> track -> PC close."""
        call_order = []

        manager, mock_pc = _create_manager()

        mock_keepalive = MagicMock()
        mock_keepalive.cancel = MagicMock(side_effect=lambda: call_order.append("keepalive_cancel"))
        manager._keepalive_task = mock_keepalive

        mock_relay = MagicMock()
        mock_relay.cancel = MagicMock(side_effect=lambda: call_order.append("relay_cancel"))
        manager._jpeg_relay_task = mock_relay

        mock_track = MagicMock()
        mock_track.stop = MagicMock(side_effect=lambda: call_order.append("track_stop"))
        manager._screen_track = mock_track

        async def track_pc_close():
            call_order.append("pc_close")
        mock_pc.close = AsyncMock(side_effect=track_pc_close)

        await manager.close()

        assert call_order == ["keepalive_cancel", "relay_cancel", "track_stop", "pc_close"]
