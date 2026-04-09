"""
Geo-location utility - resolve IP addresses to human-readable locations.

Private/LAN IPs → "Local Network", Tailscale CGNAT → "Tailscale Network",
public IPs → "{city}, {country}" via ip-api.com (free, no key needed).
"""
import asyncio
import ipaddress
import json
import logging
import urllib.request

logger = logging.getLogger(__name__)

# Module-level LRU cache: IP → location string (IPs rarely change geo)
_GEO_CACHE_MAX = 256
_geo_cache: dict[str, str] = {}


def _is_tailscale(ip: str) -> bool:
    """Check if an IP is in the Tailscale CGNAT range (100.64-127.x.x).

    Must be checked BEFORE is_private because Python's ipaddress treats
    100.64.0.0/10 as private (CGNAT range), which would misclassify Tailscale.
    """
    try:
        parts = ip.split(".")
        if len(parts) != 4 or parts[0] != "100":
            return False
        second = int(parts[1])
        return 64 <= second <= 127
    except (ValueError, IndexError):
        return False


def _is_private(ip: str) -> bool:
    """Check if an IP is in a private/loopback range (excluding Tailscale CGNAT)."""
    if _is_tailscale(ip):
        return False
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


def classify_connection_path(ip: str) -> str:
    """Classify an IP into a connection path: 'lan', 'tailscale', or 'tunnel'."""
    if _is_tailscale(ip):
        return "tailscale"
    if _is_private(ip):
        return "lan"
    return "tunnel"


import re as _re

# Only allow letters, digits, spaces, commas, periods, hyphens, apostrophes in geo strings
_SAFE_GEO_RE = _re.compile(r"[^a-zA-Z0-9\s,.\-'À-ÿ]")


def _sanitize_geo(value: str) -> str:
    """Strip characters that could be used for injection from geo API responses."""
    return _SAFE_GEO_RE.sub("", value).strip()


def _lookup_sync(ip: str) -> str | None:
    """Synchronous HTTP call to ip-api.com (called via asyncio.to_thread)."""
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,city,country"
        req = urllib.request.Request(url, headers={"User-Agent": "contop-server/0.1"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
        if data.get("status") == "success":
            city = _sanitize_geo(data.get("city", ""))
            country = _sanitize_geo(data.get("country", ""))
            if city and country:
                return f"{city}, {country}"
            return country or city or None
    except Exception:
        logger.debug("Geo-location lookup failed for %s", ip, exc_info=True)
    return None


async def geolocate_ip(ip: str) -> str | None:
    """Resolve an IP address to a location string.

    Returns "Local Network" for private IPs, "Tailscale Network" for CGNAT range,
    "{city}, {country}" for public IPs, or None on failure.
    Results are cached per IP.
    """
    if not ip:
        return None

    if ip in _geo_cache:
        return _geo_cache[ip]

    if _is_private(ip):
        _geo_cache[ip] = "Local Network"
        return "Local Network"

    if _is_tailscale(ip):
        _geo_cache[ip] = "Tailscale Network"
        return "Tailscale Network"

    result = await asyncio.to_thread(_lookup_sync, ip)
    if result:
        if len(_geo_cache) >= _GEO_CACHE_MAX:
            # Evict oldest entry (first inserted)
            try:
                _geo_cache.pop(next(iter(_geo_cache)))
            except StopIteration:
                pass
        _geo_cache[ip] = result
    return result
