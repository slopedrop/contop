"""
Pairing module — token generation, validation, revocation, and QR code encoding.

Handles the secure out-of-band pairing flow between the host desktop server
and mobile client via QR code containing DTLS fingerprint and STUN config.
"""
import asyncio
import io
import json
import os
import shutil
import socket
import subprocess
import re
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import qrcode
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

TOKEN_TTL_DAYS = 30
TEMP_TOKEN_TTL_HOURS = 4
_IPV4_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
SERVER_PORT = int(os.environ.get("CONTOP_PORT", "8000"))

DEFAULT_STUN_CONFIG = {
    "ice_servers": [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]
}


@dataclass
class PairingToken:
    """Represents a pairing token with DTLS fingerprint and connection metadata."""

    token: str
    dtls_fingerprint: str
    stun_config: dict
    created_at: datetime
    expires_at: datetime
    device_id: str | None
    connection_type: str = "permanent"  # "permanent" or "temp"
    device_name: str | None = None
    last_ip: str | None = None
    last_location: str | None = None
    last_seen: datetime | None = None
    connection_path: str | None = None  # "lan", "tailscale", or "tunnel"


# In-memory token registry keyed by token string
_token_registry: dict[str, PairingToken] = {}

# Last generated QR code PNG bytes (for GET /api/qr-image retrieval)
_last_qr_png: bytes | None = None

# Reverse lookup: device_id → token string (for single-active enforcement)
_device_token_map: dict[str, str] = {}

# Ring buffer of recent device events for desktop polling
_device_events: deque[dict] = deque(maxlen=100)


def record_device_event(
    event_type: str,
    device_id: str | None = None,
    device_name: str | None = None,
    details: str | None = None,
) -> None:
    """Append a device event to the ring buffer.

    Event types: "connected", "disconnected", "token_replaced".
    """
    event = {
        "type": event_type,
        "device_id": device_id,
        "device_name": device_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if details:
        event["details"] = details
    _device_events.append(event)


def get_device_events_since(since_iso: str | None) -> list[dict]:
    """Return events after the given ISO timestamp, or all if None."""
    if since_iso is None:
        return list(_device_events)
    try:
        since_dt = datetime.fromisoformat(since_iso.replace("Z", "+00:00"))
        return [e for e in _device_events
                if datetime.fromisoformat(e["timestamp"]) > since_dt]
    except (ValueError, TypeError):
        return list(_device_events)


def _tokens_path() -> Path:
    """Return the path to ~/.contop/tokens.json."""
    return Path.home() / ".contop" / "tokens.json"


def save_tokens_to_disk() -> None:
    """Persist permanent tokens to ~/.contop/tokens.json. Temp tokens are excluded.

    Uses atomic write (write to .tmp, then rename) to prevent data loss if the
    process is killed mid-write.
    """
    import logging as _logging
    from core.settings import _ensure_contop_dir
    _ensure_contop_dir()

    tokens_list = []
    for pt in _token_registry.values():
        if pt.connection_type == "temp":
            continue
        entry = {
            "token": pt.token,
            "device_id": pt.device_id,
            "connection_type": pt.connection_type,
            "dtls_fingerprint": pt.dtls_fingerprint,
            "created_at": pt.created_at.isoformat(),
            "expires_at": pt.expires_at.isoformat(),
            "stun_config": pt.stun_config,
        }
        if pt.device_name is not None:
            entry["device_name"] = pt.device_name
        if pt.last_ip is not None:
            entry["last_ip"] = pt.last_ip
        if pt.last_location is not None:
            entry["last_location"] = pt.last_location
        if pt.last_seen is not None:
            entry["last_seen"] = pt.last_seen.isoformat()
        if pt.connection_path is not None:
            entry["connection_path"] = pt.connection_path
        tokens_list.append(entry)

    path = _tokens_path()
    tmp_path = path.with_suffix(".tmp")
    content = json.dumps({"tokens": tokens_list}, indent=2)
    # Write to temp file first, then atomically replace to prevent corruption
    # if the process is killed mid-write (O_TRUNC on the real file would zero it).
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, content.encode("utf-8"))
    finally:
        os.close(fd)
    os.replace(str(tmp_path), str(path))
    _logging.getLogger(__name__).debug("Saved %d permanent token(s) to disk", len(tokens_list))


def load_tokens_from_disk() -> int:
    """Load persisted tokens from ~/.contop/tokens.json into the in-memory registry.

    Skips expired entries. Returns the number of tokens loaded.
    """
    path = _tokens_path()
    if not path.exists():
        return 0

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        import logging
        logging.getLogger(__name__).warning("Failed to load tokens from %s: %s", path, exc)
        return 0

    now = datetime.now(timezone.utc)
    loaded = 0
    skipped_expired = 0
    for entry in data.get("tokens", []):
        try:
            expires_at = datetime.fromisoformat(entry["expires_at"])
            if now >= expires_at:
                skipped_expired += 1
                continue  # skip expired

            last_seen_raw = entry.get("last_seen")
            pt = PairingToken(
                token=entry["token"],
                dtls_fingerprint=entry["dtls_fingerprint"],
                stun_config=entry.get("stun_config", DEFAULT_STUN_CONFIG),
                created_at=datetime.fromisoformat(entry["created_at"]),
                expires_at=expires_at,
                device_id=entry.get("device_id"),
                connection_type=entry.get("connection_type", "permanent"),
                device_name=entry.get("device_name"),
                last_ip=entry.get("last_ip"),
                last_location=entry.get("last_location"),
                last_seen=datetime.fromisoformat(last_seen_raw) if last_seen_raw else None,
                connection_path=entry.get("connection_path"),
            )
            _token_registry[pt.token] = pt
            if pt.device_id is not None:
                _device_token_map[pt.device_id] = pt.token
            loaded += 1
        except (KeyError, ValueError) as exc:
            import logging
            logging.getLogger(__name__).warning("Skipping malformed token entry: %s", exc)
            continue

    if skipped_expired:
        import logging
        logging.getLogger(__name__).info("Skipped %d expired token(s) during load", skipped_expired)

    return loaded


def _generate_dtls_fingerprint_sync() -> str:
    """Synchronous DTLS fingerprint generation (CPU-bound: RSA keygen + cert signing)."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "contop-dtls"),
    ])

    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=365))
        .sign(private_key, hashes.SHA256())
    )

    der_bytes = cert.public_bytes(serialization.Encoding.DER)
    digest = hashes.Hash(hashes.SHA256())
    digest.update(der_bytes)
    fingerprint_bytes = digest.finalize()

    return ":".join(f"{b:02X}" for b in fingerprint_bytes)


async def generate_dtls_fingerprint() -> str:
    """Generate an ephemeral self-signed X.509 certificate and return its SHA-256 fingerprint.

    Returns colon-separated hex pairs (e.g., "AB:CD:EF:12:..."), the standard WebRTC format.
    Runs in a thread to avoid blocking the event loop during RSA key generation.
    """
    return await asyncio.to_thread(_generate_dtls_fingerprint_sync)


async def generate_token(device_id: str | None = None, connection_type: str = "permanent") -> PairingToken:
    """Create a new pairing token with UUID v4, DTLS fingerprint, and STUN config.

    If device_id is provided, any existing token for that device is automatically revoked
    (single-active-token-per-device enforcement).
    Temp tokens get a short TTL (TEMP_TOKEN_TTL_HOURS); permanent tokens get TOKEN_TTL_DAYS.
    """
    if device_id is not None and device_id in _device_token_map:
        old_token = _device_token_map[device_id]
        old_pt = _token_registry.get(old_token)
        old_device_name = old_pt.device_name if old_pt else None
        record_device_event("token_replaced", device_id, old_device_name, details="New pairing initiated")
        await revoke_token(old_token)

    now = datetime.now(timezone.utc)
    dtls_fingerprint = await generate_dtls_fingerprint()

    if connection_type == "temp":
        expires_at = now + timedelta(hours=TEMP_TOKEN_TTL_HOURS)
    else:
        expires_at = now + timedelta(days=TOKEN_TTL_DAYS)

    pairing_token = PairingToken(
        token=str(uuid.uuid4()),
        dtls_fingerprint=dtls_fingerprint,
        stun_config=DEFAULT_STUN_CONFIG,
        created_at=now,
        expires_at=expires_at,
        device_id=device_id,
        connection_type=connection_type,
    )

    _token_registry[pairing_token.token] = pairing_token
    if device_id is not None:
        _device_token_map[device_id] = pairing_token.token

    if connection_type == "permanent":
        save_tokens_to_disk()

    return pairing_token


async def validate_token(token: str) -> PairingToken | None:
    """Check if a token exists and is not expired.

    Returns the PairingToken if valid, None otherwise.
    """
    pairing_token = _token_registry.get(token)
    if pairing_token is None:
        return None

    now = datetime.now(timezone.utc)
    if now >= pairing_token.expires_at:
        _token_registry.pop(token, None)
        if pairing_token.device_id is not None:
            _device_token_map.pop(pairing_token.device_id, None)
        return None

    return pairing_token


async def revoke_token(token: str) -> bool:
    """Remove a token from the registry.

    Returns True if the token was found and removed, False otherwise.
    Always clears cached QR image on revocation since the cached QR may
    belong to the revoked token and we don't track which token generated it.
    """
    global _last_qr_png
    pairing_token = _token_registry.pop(token, None)
    if pairing_token is None:
        return False

    if pairing_token.device_id is not None:
        _device_token_map.pop(pairing_token.device_id, None)

    _last_qr_png = None

    if pairing_token.connection_type == "permanent":
        save_tokens_to_disk()

    return True


def _find_permanent_token() -> PairingToken | None:
    """Return the first valid permanent token in the registry, or None."""
    now = datetime.now(timezone.utc)
    for pt in _token_registry.values():
        if pt.connection_type == "permanent" and now < pt.expires_at:
            return pt
    return None


def get_token_status(device_id: str | None = None) -> dict:
    """Return the status of the current active token without exposing the token value.

    If device_id is provided, returns status for that specific device.
    Otherwise returns status of the active permanent token (preferred) or the
    most recently created token.
    """
    if device_id is not None:
        token_key = _device_token_map.get(device_id)
        if token_key is None:
            return {"status": "none"}
        pairing_token = _token_registry.get(token_key)
        if pairing_token is None:
            return {"status": "none"}
    elif _token_registry:
        # Prefer permanent tokens — temp tokens shouldn't shadow a valid permanent one
        pairing_token = _find_permanent_token() or list(_token_registry.values())[-1]
    else:
        return {"status": "none"}

    now = datetime.now(timezone.utc)
    if now >= pairing_token.expires_at:
        return {"status": "none"}

    return {
        "status": "active",
        "expires_at": pairing_token.expires_at.isoformat(),
        "device_id": pairing_token.device_id,
        "connection_type": pairing_token.connection_type,
    }


def get_active_token_string(device_id: str | None = None) -> str | None:
    """Return the token string for the active token, without exposing the PairingToken.

    If device_id is provided, returns the token string for that device.
    Otherwise returns the active permanent token string (preferred) or the
    most recently created token string.
    """
    if device_id is not None:
        return _device_token_map.get(device_id)

    if not _token_registry:
        return None

    # Prefer permanent tokens — a temp token should never shadow the permanent one
    perm = _find_permanent_token()
    if perm is not None:
        return perm.token

    return list(_token_registry.keys())[-1]


async def revoke_active_token(device_id: str | None = None) -> bool:
    """Revoke the active token, optionally targeting a specific device.

    If device_id is provided, revokes the token for that device.
    Otherwise revokes the most recently created token.
    """
    if device_id is not None:
        token_key = _device_token_map.get(device_id)
        if token_key is None:
            return False
        return await revoke_token(token_key)

    if not _token_registry:
        return False

    # Prefer revoking the permanent token (what "forget connection" means)
    perm = _find_permanent_token()
    target_key = perm.token if perm else list(_token_registry.keys())[-1]
    return await revoke_token(target_key)


def _generate_device_label(token_str: str) -> str:
    """Generate a stable unique label from the token string for unnamed devices."""
    return f"Device-{token_str[:6].upper()}"


def update_device_metadata(
    token_str: str,
    device_name: str | None = None,
    ip: str | None = None,
    location: str | None = None,
    path: str | None = None,
) -> None:
    """Update device metadata on an in-memory token and persist if permanent.

    Disk persistence runs in a background thread to avoid blocking the event loop.
    """
    pt = _token_registry.get(token_str)
    if pt is None:
        return
    if device_name is not None:
        pt.device_name = device_name
    elif pt.device_name is None:
        pt.device_name = _generate_device_label(token_str)
    if ip is not None:
        pt.last_ip = ip
    if location is not None:
        pt.last_location = location
    if path is not None:
        pt.connection_path = path
    pt.last_seen = datetime.now(timezone.utc)
    if pt.connection_type == "permanent":
        try:
            asyncio.get_running_loop().run_in_executor(None, save_tokens_to_disk)
        except RuntimeError:
            save_tokens_to_disk()


def get_qr_image() -> bytes | None:
    """Return the last generated QR code PNG bytes, or None if no QR has been generated."""
    return _last_qr_png


def _get_local_ip() -> str:
    """Get the machine's local IP address for LAN connectivity."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(2)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass
    # Fallback — may return 127.0.0.1 on Docker/WSL/misconfigured hosts
    fallback = socket.gethostbyname(socket.gethostname())
    if fallback.startswith("127."):
        import logging
        logging.getLogger(__name__).warning(
            "Local IP resolved to %s — mobile clients may not be able to connect via LAN", fallback
        )
    return fallback


def _get_tailscale_ip() -> str | None:
    """Detect the Tailscale IPv4 address if Tailscale is running.

    Tries `tailscale ip -4` CLI first. Falls back to scanning network
    interfaces for 100.x.y.z (CGNAT range used by Tailscale).
    Returns None if Tailscale is not installed or not running.
    """
    # Strategy 1: Use the Tailscale CLI
    tailscale_bin = shutil.which("tailscale")
    if tailscale_bin:
        try:
            result = subprocess.run(
                [tailscale_bin, "ip", "-4"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if result.returncode == 0:
                ip = result.stdout.strip().split("\n")[0].strip()
                if ip and _IPV4_RE.match(ip):
                    return ip
        except (subprocess.TimeoutExpired, OSError):
            pass

    # Strategy 2: Scan network interfaces for Tailscale CGNAT range (100.64-127.x.x)
    try:
        import psutil
        for _name, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and addr.address.startswith("100."):
                    parts = addr.address.split(".")
                    if len(parts) == 4 and 64 <= int(parts[1]) <= 127:
                        return addr.address
    except (ImportError, Exception):
        pass

    return None


def _generate_qr_code_sync(token: PairingToken, gemini_api_key: str, signaling_url: str | None) -> bytes:
    """Synchronous QR code generation (CPU-bound: QR encoding + PNG rendering)."""
    from core.settings import get_openai_api_key, get_anthropic_api_key, get_openrouter_api_key, is_subscription_mode

    # Compact keys to reduce QR module count for easier scanning.
    # Mobile QRScanner expands these back to full PairingPayload keys.
    payload: dict = {
        "t": token.token,
        "d": token.dtls_fingerprint.replace(":", ""),
        "h": _get_local_ip(),
        "p": SERVER_PORT,
        "e": token.expires_at.isoformat(),
        "c": token.connection_type,
    }
    if gemini_api_key:
        payload["g"] = gemini_api_key

    # Always include API keys if present — mobile can use either API key or subscription
    oai = get_openai_api_key()
    if oai:
        payload["o"] = oai
    ant = get_anthropic_api_key()
    if ant:
        payload["a"] = ant
    orr = get_openrouter_api_key()
    if orr:
        payload["r"] = orr

    # Compact provider auth (pa) — tells mobile which providers have subscription available.
    # API keys and subscription coexist — mobile user can switch between them.
    pa: dict = {}
    if is_subscription_mode("gemini"):
        pa["g"] = "sub"
    if is_subscription_mode("anthropic"):
        pa["a"] = "sub"
    if is_subscription_mode("openai"):
        pa["o"] = "sub"
    if pa:
        payload["pa"] = pa

    # STUN config is hardcoded on mobile — omitted from QR to save space

    tailscale_ip = _get_tailscale_ip()
    if tailscale_ip:
        payload["ts"] = tailscale_ip

    # Only include signaling_url for temp connections — prevents stale Cloudflare URLs
    # from being persisted on the mobile device for permanent connections
    if signaling_url and token.connection_type == "temp":
        payload["s"] = signaling_url

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(json.dumps(payload, separators=(",", ":")))
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


async def generate_qr_code(token: PairingToken) -> bytes:
    """Serialize token payload as JSON and encode as a QR code PNG image.

    Returns PNG bytes. Runs in a thread to avoid blocking the event loop.
    Raises ValueError if no API keys and no subscription providers are configured.
    Includes signaling_url from Cloudflare Tunnel when active.
    """
    from core.settings import get_gemini_api_key, get_openai_api_key, get_anthropic_api_key, get_openrouter_api_key, is_subscription_mode
    from core.tunnel import get_tunnel_url

    gemini_api_key = get_gemini_api_key() or ""
    has_any_key = bool(gemini_api_key or get_openai_api_key() or get_anthropic_api_key() or get_openrouter_api_key())
    has_any_subscription = any(is_subscription_mode(p) for p in ("gemini", "anthropic", "openai"))
    if not has_any_key and not has_any_subscription:
        raise ValueError(
            "No API keys or subscription providers configured. "
            "Set at least one API key in Settings or enable a subscription provider."
        )

    tunnel_url = get_tunnel_url()
    signaling_url = f"{tunnel_url.replace('https://', 'wss://')}/ws/signaling" if tunnel_url else None

    global _last_qr_png
    png_bytes = await asyncio.to_thread(_generate_qr_code_sync, token, gemini_api_key, signaling_url)
    _last_qr_png = png_bytes
    return png_bytes
