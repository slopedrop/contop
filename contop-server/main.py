"""
Contop Server - Entrypoint
Provides health check endpoint and initializes the FastAPI server.
"""
# WORKAROUND: Python 3.12+ added WMI queries to platform.uname() / platform.system().
# WMI can hang indefinitely on some Windows machines, which blocks the import chain:
#   aiortc -> aioice -> ifaddr._shared -> platform.system() -> WMI -> hangs
# Pre-populate the uname cache with known values so the WMI path is never hit.
# IMPORTANT: platform.node() and platform.machine() also route through WMI in 3.12+,
# so we must avoid calling ANY platform functions - use socket/os/sys only.
import platform as _platform
import sys as _sys
if _sys.platform == "win32" and not _platform._uname_cache:
    import socket as _socket, os as _os
    _wv = _sys.getwindowsversion()
    _platform._uname_cache = _platform.uname_result(
        system="Windows",
        node=_socket.gethostname(),
        release=str(_wv.major),
        version=f"{_wv.major}.{_wv.minor}.{_wv.build}",
        machine=_os.environ.get("PROCESSOR_ARCHITECTURE", "AMD64"),
    )
    del _wv, _socket, _os

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Configure file logging so errors are visible even when stdout/stderr are silenced (Tauri sidecar)
_log_path = Path.home() / ".contop" / "server.log"
_log_path.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(_log_path, mode="w"),
        logging.StreamHandler(),
    ],
)

# Silence noisy third-party libraries (they flood DEBUG/INFO with internal chatter)
for _lib in ("google", "google_adk", "google.adk", "google.auth", "google.api_core",
             "urllib3", "grpc", "aiortc", "aioice"):
    logging.getLogger(_lib).setLevel(logging.WARNING)

import asyncio

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from core.pairing import (
    generate_token,
    generate_qr_code,
    get_active_token_string,
    get_device_events_since,
    get_qr_image,
    get_token_status,
    load_tokens_from_disk,
    revoke_active_token,
    _get_local_ip,
    _get_tailscale_ip,
    _token_registry,
    SERVER_PORT,
)
from core import settings
from core.tunnel import get_tunnel_url, start_tunnel, stop_tunnel
from core.webrtc_signaling import signaling_websocket, force_close_session, _active_peers


async def _preload_omniparser_background():
    """Background task: preload OmniParser models so first observe_screen is fast."""
    try:
        from tools.omniparser_local import preload_omniparser
        await preload_omniparser()
        logging.getLogger(__name__).info("OmniParser models preloaded successfully")
    except Exception:
        logging.getLogger(__name__).warning(
            "OmniParser preload failed - models will load on first use",
            exc_info=True,
        )


async def _away_mode_watchdog():
    """Background task: poll Tauri health server to detect overlay being killed.

    When Away Mode is active and Tauri stops responding, send a security alert
    to the connected mobile client and attempt to restart the overlay.
    """
    import urllib.request
    logger = logging.getLogger("away_mode_watchdog")
    tauri_health_port = int(os.environ.get("CONTOP_PORT", "8000")) + 1
    url = f"http://127.0.0.1:{tauri_health_port}/api/away-status"
    consecutive_failures = 0
    was_away = False

    while True:
        await asyncio.sleep(2)
        try:
            resp = await asyncio.to_thread(
                lambda: urllib.request.urlopen(url, timeout=2).read().decode()
            )
            import json
            status = json.loads(resp)
            is_away = status.get("away_mode", False)

            if was_away and not is_away and consecutive_failures == 0:
                # Normal disengage - user unlocked via PIN or phone
                was_away = False
                continue

            was_away = is_away
            consecutive_failures = 0
        except Exception:
            consecutive_failures += 1
            if was_away and consecutive_failures >= 2:
                # Tauri overlay likely killed - send security alert to phone
                logger.warning(
                    "Tauri health check failed %d times while Away Mode was active - overlay may have been killed",
                    consecutive_failures,
                )
                # Send alert to all connected peers
                from core.webrtc_signaling import _active_peers
                for peer in list(_active_peers.values()):
                    try:
                        peer.send_message("security_alert", {
                            "reason": "overlay_killed",
                            "message": "Away Mode overlay may have been terminated",
                        })
                    except Exception:
                        pass
                # Only alert once per incident
                if consecutive_failures == 2:
                    logger.warning("Security alert sent to connected mobile clients")


async def _setup_pinchtab_background():
    """Background task: download PinchTab if missing and start it."""
    try:
        from tools.browser_automation import BrowserAutomation, ensure_pinchtab_installed
        from core.agent_tools import set_browser_client
        from core.settings import get_pinchtab_url

        path = await ensure_pinchtab_installed()
        if not path:
            logging.getLogger(__name__).warning(
                "PinchTab not available - execute_browser will fall back to GUI"
            )
            return

        # Pre-initialize the global client and start PinchTab now
        client = BrowserAutomation(base_url=get_pinchtab_url())
        set_browser_client(client)

        if await client.ensure_running():
            logging.getLogger(__name__).info("PinchTab running and ready: %s", path)
        else:
            logging.getLogger(__name__).warning(
                "PinchTab binary found but failed to start - will retry on first use"
            )
    except Exception:
        logging.getLogger(__name__).warning(
            "PinchTab setup failed - execute_browser will fall back to GUI",
            exc_info=True,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage server lifecycle - load settings, stop tunnel on shutdown."""
    # Task 2.1: Ensure settings file exists on startup (creates defaults if missing)
    settings_path = settings.get_settings_path()
    already_existed = settings_path.exists()
    loaded = settings.load_settings()
    if already_existed:
        print(f"  Settings loaded from {settings_path}")
    else:
        print(f"  Default settings created at {settings_path}")

    # Restore persisted pairing tokens from disk
    logger = logging.getLogger(__name__)
    token_count = load_tokens_from_disk()
    if token_count > 0:
        logger.info("Restored %d pairing token(s) from disk", token_count)
        token_status = get_token_status()
        if token_status.get("status") == "active":
            logger.info("Active token expires: %s", token_status["expires_at"])
    else:
        logger.info("No persisted pairing tokens found")

    # Tunnel is NOT started at boot - it starts on-demand when the desktop
    # generates a temp QR code via POST /api/tunnel/start.
    print("\n  Tunnel: on-demand (starts when temp QR is generated)")

    # Restore keep_host_awake from settings (global, not per-session)
    from tools.device_control import apply_keep_awake_from_settings
    await apply_keep_awake_from_settings()

    # Ensure built-in skills are installed (copies to ~/.contop/skills/ if missing)
    from core.skill_loader import ensure_builtin_skills
    from core.settings import get_skills_dir
    ensure_builtin_skills(get_skills_dir())

    # Clean up stale ADK sessions from persistent storage (>7 days old)
    from core.execution_agent import cleanup_old_sessions
    await cleanup_old_sessions(max_age_days=7)

    # Preload OmniParser models in background so first observe_screen is fast
    omni_task = asyncio.create_task(_preload_omniparser_background())

    # Ensure PinchTab binary is installed (downloads pinned release if missing)
    pinchtab_task = asyncio.create_task(_setup_pinchtab_background())

    # Start Away Mode watchdog (polls Tauri health server)
    watchdog_task = asyncio.create_task(_away_mode_watchdog())

    yield
    omni_task.cancel()
    pinchtab_task.cancel()
    watchdog_task.cancel()
    await stop_tunnel()

    # Terminate any managed PinchTab process
    from core.agent_tools import _browser_client
    if _browser_client is not None:
        await _browser_client.close()


app = FastAPI(title="Contop Server", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    # Allow localhost, private network IPs (LAN/Tailscale), and Tauri origins
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|100\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint to verify server is running."""
    return JSONResponse(
        content={
            "status": "healthy",
            "service": "contop-server",
            "version": "0.1.0"
        }
    )


@app.get("/")
async def root():
    """Root endpoint with basic server information."""
    return JSONResponse(
        content={
            "service": "contop-server",
            "description": "Contop server for mobile client desktop automation",
            "health_endpoint": "/health"
        }
    )


@app.post("/api/pair")
async def create_pairing(
    device_id: str | None = Query(default=None),
    connection_type: str = Query(default="permanent"),
):
    """Generate a new pairing token and return QR code as PNG image.

    For permanent connections, reuses an existing valid token if one exists.
    Temp connections always generate a fresh token.
    """
    if connection_type not in ("permanent", "temp"):
        return Response(content="Invalid connection_type", status_code=400)
    try:
        # Reuse existing valid permanent token if available
        if connection_type == "permanent":
            existing_token_str = get_active_token_string(device_id)
            if existing_token_str is not None:
                from core.pairing import validate_token
                existing = await validate_token(existing_token_str)
                if existing is not None and existing.connection_type == "permanent":
                    # Always regenerate QR for existing token to ensure it reflects
                    # current network config (LAN IP, Tailscale status, tunnel URL)
                    qr_bytes = await generate_qr_code(existing)
                    return Response(
                        content=qr_bytes,
                        media_type="image/png",
                        headers={
                            "x-pairing-token": existing.token,
                            "x-pairing-expires-at": existing.expires_at.isoformat(),
                        },
                    )

        token = await generate_token(device_id=device_id, connection_type=connection_type)
        qr_bytes = await generate_qr_code(token)
    except ValueError as e:
        return JSONResponse(
            status_code=500,
            content={"error": "configuration_error", "message": str(e)},
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "message": "Failed to generate pairing token"},
        )

    return Response(
        content=qr_bytes,
        media_type="image/png",
        headers={
            "x-pairing-token": token.token,
            "x-pairing-expires-at": token.expires_at.isoformat(),
        },
    )


@app.get("/api/qr-image")
async def get_qr_image_endpoint():
    """Return the current QR code as a PNG image, or 404 if no active QR exists."""
    png_bytes = get_qr_image()
    if png_bytes is None:
        return JSONResponse(
            status_code=404,
            content={"error": "no_active_qr", "message": "No active QR code"},
        )
    return Response(content=png_bytes, media_type="image/png")


@app.get("/api/pair/status")
async def pairing_status(device_id: str | None = Query(default=None)):
    """Return current pairing token status without exposing the token value."""
    return JSONResponse(content=get_token_status(device_id))


@app.websocket("/ws/signaling")
async def ws_signaling(websocket: WebSocket):
    """WebSocket signaling endpoint for WebRTC SDP/ICE exchange."""
    await signaling_websocket(websocket)


@app.delete("/api/pair")
async def delete_pairing(device_id: str | None = Query(default=None)):
    """Revoke the current active pairing token and force-disconnect any active WebRTC session."""
    # Get token string and metadata before revoking so we can force-close the session
    token_str = get_active_token_string(device_id)
    token_device_name: str | None = None
    if token_str:
        pt = _token_registry.get(token_str)
        if pt:
            token_device_name = pt.device_name
            device_id = device_id or pt.device_id

    revoked = await revoke_active_token(device_id)
    if not revoked:
        return JSONResponse(content={"revoked": False, "message": "No active token to revoke"})

    # Force-close the WebRTC session if one exists for this token
    if token_str:
        await force_close_session(token_str, device_id=device_id, device_name=token_device_name)

    return JSONResponse(content={"revoked": True})


@app.get("/api/devices")
async def list_devices(since: str | None = Query(default=None)):
    """Return all paired devices with connection status and recent events."""
    devices = []
    for pt in _token_registry.values():
        devices.append({
            "device_id": pt.device_id,
            "device_name": pt.device_name,
            "connection_type": pt.connection_type,
            "connected": pt.token in _active_peers,
            "connection_path": pt.connection_path,
            "last_location": pt.last_location,
            "last_seen": pt.last_seen.isoformat() if pt.last_seen else None,
            "paired_at": pt.created_at.isoformat(),
            "expires_at": pt.expires_at.isoformat(),
        })
    events = get_device_events_since(since)
    return JSONResponse(content={"devices": devices, "events": events})


@app.post("/api/tunnel/start")
async def start_tunnel_endpoint():
    """Start the Cloudflare tunnel on demand (e.g., when generating a temp QR).

    Returns the tunnel URL if successful, or an error if the tunnel could not start.
    If the tunnel is already running, returns the existing URL immediately.
    """
    existing = get_tunnel_url()
    if existing:
        return JSONResponse(content={"tunnel_url": existing, "already_running": True})
    tunnel_url = await start_tunnel(SERVER_PORT)
    if tunnel_url:
        return JSONResponse(content={"tunnel_url": tunnel_url, "already_running": False})
    return JSONResponse(
        status_code=503,
        content={"error": "tunnel_unavailable", "message": "Could not start Cloudflare tunnel. cloudflared may not be installed."},
    )


@app.get("/api/connection-info")
async def get_connection_info():
    """Return current connection info for the desktop GUI."""
    # Run blocking calls (subprocess, socket) off the event loop to avoid
    # stalling WebSocket signaling and other async handlers (F1 fix).
    tailscale_ip = await asyncio.to_thread(_get_tailscale_ip)
    lan_ip = await asyncio.to_thread(_get_local_ip)
    tunnel_url = get_tunnel_url()
    token_status = get_token_status()
    active_token = get_active_token_string() if token_status.get("status") == "active" else None
    return JSONResponse(content={
        "lan_ip": lan_ip,
        "tailscale_ip": tailscale_ip,
        "tailscale_available": tailscale_ip is not None,
        "tunnel_url": tunnel_url,
        "tunnel_active": tunnel_url is not None,
        "connected_clients": len(_active_peers),
        "has_active_token": token_status.get("status") == "active",
        "token_expires_at": token_status.get("expires_at"),
        "token_connection_type": token_status.get("connection_type"),
        "active_token": active_token,
        "server_port": SERVER_PORT,
    })


@app.get("/api/settings")
async def get_settings_endpoint():
    """Return current settings JSON."""
    return JSONResponse(content=settings.get_settings())


@app.put("/api/settings")
async def put_settings_endpoint(request_body: dict):
    """Update settings. Requires version, restricted_paths, forbidden_commands keys."""
    try:
        settings.save_settings(request_body)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(content=settings.get_settings())


@app.post("/api/settings/reset")
async def post_settings_reset_endpoint():
    """Reset settings to defaults."""
    return JSONResponse(content=settings.reset_settings())


import re
import yaml
_VALID_SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,63}$")


def _validate_skill_name(skill_name: str) -> None:
    """Raise HTTPException if skill_name contains path traversal or invalid chars."""
    if not _VALID_SKILL_NAME_RE.match(skill_name):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid skill name '{skill_name}'. Must be lowercase alphanumeric and hyphens only.",
        )


@app.get("/api/skills")
async def get_skills_endpoint():
    """Return list of all discovered skills (metadata only)."""
    from core.skill_loader import discover_skills
    from core.settings import get_skills_dir, get_enabled_skills

    skills = discover_skills(get_skills_dir(), get_enabled_skills())
    return JSONResponse(content=[
        {
            "name": s.name,
            "description": s.description,
            "version": s.version,
            "skill_type": s.skill_type,
            "enabled": s.enabled,
            "has_scripts": s.has_scripts,
        }
        for s in skills
    ])


@app.post("/api/skills/{skill_name}/enable")
async def enable_skill_endpoint(skill_name: str):
    """Add a skill to the enabled_skills list in settings."""
    _validate_skill_name(skill_name)
    # F8: Verify skill actually exists before enabling
    from core.settings import get_skills_dir
    from core.skill_loader import check_skill_conflicts
    skills_dir = get_skills_dir()
    if not (skills_dir / skill_name / "SKILL.md").exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    current = settings.get_settings()
    enabled = list(current.get("enabled_skills", []))
    if skill_name not in enabled:
        enabled.append(skill_name)
    # Check for tool name conflicts before saving
    warnings = check_skill_conflicts(skill_name, skills_dir, enabled)
    current["enabled_skills"] = enabled
    settings.save_settings(current)
    return JSONResponse(content={"enabled": True, "skill_name": skill_name, "warnings": warnings})


@app.post("/api/skills/{skill_name}/disable")
async def disable_skill_endpoint(skill_name: str):
    """Remove a skill from the enabled_skills list in settings."""
    _validate_skill_name(skill_name)
    current = settings.get_settings()
    enabled = list(current.get("enabled_skills", []))
    enabled = [s for s in enabled if s != skill_name]
    current["enabled_skills"] = enabled
    settings.save_settings(current)
    return JSONResponse(content={"enabled": False, "skill_name": skill_name})


@app.get("/api/skills/{skill_name}")
async def get_skill_content_endpoint(skill_name: str):
    """Return full SKILL.md content for viewing/editing."""
    _validate_skill_name(skill_name)
    from core.settings import get_skills_dir

    skill_file = get_skills_dir() / skill_name / "SKILL.md"
    if not skill_file.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    content = skill_file.read_text(encoding="utf-8")
    return JSONResponse(content={"skill_name": skill_name, "content": content})


@app.put("/api/skills/{skill_name}")
async def put_skill_content_endpoint(skill_name: str, request_body: dict):
    """Update SKILL.md content for a skill."""
    _validate_skill_name(skill_name)
    from core.settings import get_skills_dir

    skill_file = get_skills_dir() / skill_name / "SKILL.md"
    if not skill_file.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    content = request_body.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")

    # F6: Validate that content has valid SKILL.md frontmatter before writing
    if not content.startswith("---"):
        raise HTTPException(status_code=400, detail="SKILL.md must start with YAML frontmatter (---)")
    parts = content.split("---", 2)
    if len(parts) < 3:
        raise HTTPException(status_code=400, detail="SKILL.md frontmatter is malformed (missing closing ---)")
    try:
        fm = yaml.safe_load(parts[1])
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML frontmatter: {e}")
    if not isinstance(fm, dict) or not fm.get("name") or not fm.get("description"):
        raise HTTPException(status_code=400, detail="Frontmatter must include 'name' and 'description'")

    skill_file.write_text(content, encoding="utf-8")
    return JSONResponse(content={"skill_name": skill_name, "updated": True})


@app.get("/api/skills/{skill_name}/workflows")
async def get_skill_workflows_endpoint(skill_name: str):
    """Return list of script files (YAML workflows + Python tools) with content."""
    _validate_skill_name(skill_name)
    from core.settings import get_skills_dir

    scripts_dir = get_skills_dir() / skill_name / "scripts"
    if not scripts_dir.is_dir():
        return JSONResponse(content={"skill_name": skill_name, "workflows": []})

    workflows = []
    for f in sorted(scripts_dir.iterdir()):
        if f.suffix in (".yaml", ".yml", ".py") and not f.name.startswith("_"):
            try:
                content = f.read_text(encoding="utf-8")
            except OSError:
                content = ""
            workflows.append({"name": f.stem, "filename": f.name, "content": content})
    return JSONResponse(content={"skill_name": skill_name, "workflows": workflows})


@app.post("/api/skills")
async def create_skill_endpoint(request_body: dict):
    """Create a new skill from the desktop UI."""
    name = request_body.get("name", "").strip()
    description = request_body.get("description", "").strip()
    if not name or not description:
        raise HTTPException(status_code=400, detail="'name' and 'description' are required")
    _validate_skill_name(name)
    from core.settings import get_skills_dir

    skill_dir = get_skills_dir() / name
    if skill_dir.exists():
        raise HTTPException(status_code=409, detail=f"Skill '{name}' already exists")

    skill_dir.mkdir(parents=True)
    frontmatter = yaml.dump({"name": name, "description": description, "version": "1.0.0"}, default_flow_style=False).strip()
    skill_md = f"---\n{frontmatter}\n---\n\n# {name}\n\nAdd your skill instructions here.\n"
    (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    return JSONResponse(content={"skill_name": name, "created": True})


@app.get("/api/away-mode/status")
async def get_away_mode_status():
    """Return Away Mode status by querying the Tauri health server."""
    import urllib.request
    tauri_health_port = int(os.environ.get("CONTOP_PORT", "8000")) + 1
    url = f"http://127.0.0.1:{tauri_health_port}/api/away-status"
    try:
        resp = await asyncio.to_thread(
            lambda: urllib.request.urlopen(url, timeout=2).read().decode()
        )
        import json as _json
        return JSONResponse(content=_json.loads(resp))
    except Exception:
        return JSONResponse(content={"away_mode": False, "overlay_active": False})


@app.get("/api/decrypted-keys")
async def get_decrypted_keys():
    """Return API keys decrypted via Tauri DPAPI endpoint.

    Falls back to plaintext keys from settings if Tauri endpoint is unavailable.
    """
    import urllib.request
    tauri_health_port = int(os.environ.get("CONTOP_PORT", "8000")) + 1
    url = f"http://127.0.0.1:{tauri_health_port}/api/decrypted-keys"
    try:
        resp = await asyncio.to_thread(
            lambda: urllib.request.urlopen(url, timeout=5).read().decode()
        )
        import json as _json
        return JSONResponse(content=_json.loads(resp))
    except Exception:
        # Fallback: read plaintext keys from settings
        s = settings.get_settings()
        return JSONResponse(content={
            "gemini_api_key": s.get("gemini_api_key", ""),
            "openai_api_key": s.get("openai_api_key", ""),
            "anthropic_api_key": s.get("anthropic_api_key", ""),
            "openrouter_api_key": s.get("openrouter_api_key", ""),
        })


@app.post("/api/provider-health")
async def check_provider_health(request: Request):
    """Check connectivity to the CLI proxy for a given provider.

    Body: { "provider": "anthropic" | "openai" | "gemini" }
    Returns: { "status": "ok"|"error", "models": [...], "message": str }
    """
    from core.settings import get_proxy_url

    body = await request.json()
    provider = body.get("provider")

    if not provider or provider not in ("anthropic", "openai", "gemini"):
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "provider must be one of: anthropic, openai, gemini"},
        )

    proxy_url = get_proxy_url(provider)
    if not proxy_url:
        return JSONResponse(content={"status": "error", "message": "No proxy URL configured for provider"})

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{proxy_url}/v1/models", timeout=5.0)
            models_data = resp.json()
        return JSONResponse(content={
            "status": "ok",
            "models": models_data.get("data", []),
            "auth_type": "subscription",
        })
    except Exception as exc:
        return JSONResponse(content={"status": "error", "message": str(exc)})


async def _build_provider_auth_payload() -> dict:
    """Check actual proxy health for all providers and return provider_auth payload."""
    from core.settings import get_provider_auth

    provider_auth_raw = get_provider_auth()

    async def check_one(provider: str, cfg: dict) -> tuple[str, dict]:
        if cfg.get("mode") == "cli_proxy" and cfg.get("proxy_url"):
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"{cfg['proxy_url']}/v1/models", timeout=2.0)
                    available = resp.status_code == 200
            except Exception:
                available = False
        else:
            available = False
        return provider, {"mode": cfg.get("mode", "api_key"), "available": available}

    results = await asyncio.gather(*(check_one(p, c) for p, c in provider_auth_raw.items()))
    return dict(results)


def _push_provider_auth_to_peers(payload: dict) -> int:
    """Push provider_auth state_update to all connected mobile clients."""
    pushed = 0
    for peer in list(_active_peers.values()):
        try:
            peer.send_message("state_update", {"provider_auth": payload})
            pushed += 1
        except Exception:
            pass
    return pushed


@app.post("/api/notify-proxy-change")
async def notify_proxy_change():
    """Notify all connected mobile clients of proxy status changes.

    Called by the desktop app after starting/stopping CLI proxies.
    Re-checks actual proxy health and pushes updated provider_auth
    to all connected peers via WebRTC data channel.
    """
    payload = await _build_provider_auth_payload()
    pushed = _push_provider_auth_to_peers(payload)
    return JSONResponse(content={"pushed": pushed, "provider_auth": payload})


@app.get("/api/default-prompts")
async def get_default_prompts():
    """Return the default system prompts (from .md files) for desktop editing."""
    from core.agent_config import _load_prompt_from_file, load_conversation_prompt

    conv_prompt = load_conversation_prompt()
    exec_prompt = _load_prompt_from_file()

    return JSONResponse(content={
        "conversation": conv_prompt,
        "execution": exec_prompt,
    })


@app.get("/api/ml-status")
async def get_ml_status():
    """Return GPU type, torch version, CUDA availability, and device name."""
    from tools.setup_ml import check_torch_status, detect_gpu

    gpu_info = detect_gpu()
    torch_status = check_torch_status()
    return JSONResponse(content={**gpu_info, **torch_status})


def main():
    """Run the FastAPI server with uvicorn."""
    host = os.environ.get("CONTOP_HOST", "0.0.0.0")
    uvicorn.run(
        "main:app",
        host=host,
        port=SERVER_PORT,
    )


if __name__ == "__main__":
    main()
