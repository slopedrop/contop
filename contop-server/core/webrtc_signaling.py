"""
WebRTC signaling module - FastAPI WebSocket endpoint for SDP/ICE exchange.

Handles the signaling phase of WebRTC connection setup between mobile client
and host server. After ICE negotiation completes, all communication moves
to the peer-to-peer data channel.
"""
import logging

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from core.geo import classify_connection_path, geolocate_ip
from core.pairing import validate_token, update_device_metadata, record_device_event, _token_registry
from core.webrtc_peer import WebRTCPeerManager

logger = logging.getLogger(__name__)

# Active WebSocket connections keyed by token string.
# Value: {"websocket": WebSocket, "peer_manager": WebRTCPeerManager}
connection_registry: dict[str, dict] = {}

# Active peer managers that outlive the signaling WebSocket.
# Keyed by token string. Cleaned up on reconnection, revocation, or keepalive timeout.
# NOTE: This is process-local state. Contop must run with a single uvicorn worker.
# Multi-worker deployments would require shared state (e.g., Redis).
_active_peers: dict[str, WebRTCPeerManager] = {}


async def signaling_websocket(websocket: WebSocket) -> None:
    """WebSocket signaling endpoint handler at /ws/signaling.

    Expects a `token` query parameter for authentication.
    Routes signaling messages (offer, answer, ice_candidate) between
    the mobile client and the host-side WebRTC peer manager.
    """
    token_str = websocket.query_params.get("token")
    if not token_str:
        await websocket.close(code=4001)
        return

    pairing_token = await validate_token(token_str)
    if pairing_token is None:
        logger.warning(
            "Signaling auth rejected: token=%s… (token registry has %d entry/entries)",
            token_str[:8], len(_token_registry),
        )
        await websocket.close(code=4001)
        return

    # Extract client IP for geo-location and metadata
    client_ip: str | None = None
    connection_path: str | None = None
    try:
        if websocket.client:
            raw = websocket.client.host
            if isinstance(raw, str):
                client_ip = raw
    except Exception:
        pass
    if client_ip:
        connection_path = classify_connection_path(client_ip)

    # Accept immediately so the client's WebSocket open event fires without
    # waiting for old-peer teardown, which can be slow (DTLS close, etc.).
    # SDP messages sent by the client before the message loop starts are
    # buffered and processed normally once we enter the receive loop.
    await websocket.accept()

    # Close existing peer and WebSocket for this token if reconnecting.
    # If the old peer has a running execution, detach it for transfer.
    old_peer = _active_peers.pop(token_str, None)
    is_reconnection = old_peer is not None
    detached_execution = None
    if old_peer:
        detached_execution = old_peer.detach_execution()
        await old_peer.close()
    if token_str in connection_registry:
        old_session = connection_registry.pop(token_str)
        try:
            await old_session["websocket"].close(code=4002)
        except Exception:
            pass

    peer_manager = WebRTCPeerManager(
        stun_config=pairing_token.stun_config,
        connection_type=pairing_token.connection_type,
    )

    # Register both the WebSocket connection and the peer manager
    connection_registry[token_str] = {
        "websocket": websocket,
        "peer_manager": peer_manager,
    }
    _active_peers[token_str] = peer_manager

    # Set up ICE candidate callback to send host candidates to mobile
    async def on_ice_candidate(candidate_data: dict) -> None:
        try:
            await websocket.send_json({
                "type": "ice_candidate",
                "candidate": candidate_data,
            })
        except Exception:
            logger.warning("Failed to send ICE candidate to mobile")

    peer_manager.on_ice_candidate = on_ice_candidate

    # Transfer running execution from old peer to new peer
    if detached_execution:
        agent, task, queued = detached_execution
        peer_manager.adopt_execution(agent, task, queued)
        logger.info("Transferred running execution to new peer for token %s", token_str)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "offer":
                # Allow client to request temp session (downgrade only).
                # This enables "Temp Connection" via a permanent QR code:
                # mobile scans permanent QR but signals connection_type=temp.
                client_conn_type = data.get("connection_type")
                if client_conn_type == "temp" and peer_manager.connection_type == "permanent":
                    peer_manager.connection_type = "temp"
                    logger.info("Connection downgraded to temp at client request for token %s", token_str)

                # Capture device metadata from the offer message
                device_name = data.get("device_name")
                # Prefer device-reported location (from expo-location) over IP-based geo
                device_location = data.get("device_location")
                if device_location and isinstance(device_location, str):
                    location = device_location
                else:
                    location = await geolocate_ip(client_ip) if client_ip else None
                update_device_metadata(token_str, device_name, client_ip, location, connection_path)
                if not is_reconnection:
                    record_device_event("connected", pairing_token.device_id, device_name)

                answer = await peer_manager.handle_offer(data["sdp"])
                try:
                    await websocket.send_json(answer)
                except RuntimeError:
                    logger.warning("Signaling WS closed before SDP answer could be sent (token %s)", token_str)
                    break

            elif msg_type == "device_location":
                location = data.get("location")
                if location and isinstance(location, str):
                    update_device_metadata(token_str, location=location)

            elif msg_type == "ice_candidate":
                await peer_manager.add_ice_candidate(data["candidate"])

            elif msg_type == "answer":
                # Server normally sends the answer, but handle gracefully
                pass

            else:
                # Unknown message type - handle gracefully, keep connection open
                logger.debug("Unknown signaling message type: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("Signaling WebSocket disconnected for token %s", token_str)
        # Only fire disconnect if this peer wasn't replaced by a new connection
        if token_str not in _active_peers or _active_peers.get(token_str) is peer_manager:
            record_device_event("disconnected", pairing_token.device_id, pairing_token.device_name)
    except Exception:
        logger.exception("Error in signaling handler for token %s", token_str)
        if token_str not in _active_peers or _active_peers.get(token_str) is peer_manager:
            record_device_event("disconnected", pairing_token.device_id, pairing_token.device_name)
    finally:
        # Remove WebSocket from registry but do NOT close the peer connection.
        # The signaling WebSocket is only needed for the initial SDP/ICE exchange.
        # Once P2P is established, the tunnel WebSocket may be dropped by Cloudflare
        # (idle timeout) - this must not kill the working P2P connection.
        # The peer_manager stays alive and is only closed when:
        #   - A new signaling connection arrives for the same token (reconnection, line 41-48)
        #   - The session is explicitly revoked via force_close_session()
        #   - The keepalive monitor detects client is unresponsive
        #   - The client sends session_end via data channel
        connection_registry.pop(token_str, None)


async def force_close_session(token: str, device_id: str | None = None, device_name: str | None = None) -> None:
    """Force-close a WebRTC session associated with a token.

    Used when a pairing token is revoked to tear down the active session.
    """
    peer_manager = _active_peers.pop(token, None)
    session = connection_registry.pop(token, None)

    if peer_manager:
        record_device_event("revoked", device_id, device_name, details="Token revoked")
        await peer_manager.close()
    if session:
        ws = session.get("websocket")
        if ws:
            try:
                await ws.close()
            except Exception:
                pass
