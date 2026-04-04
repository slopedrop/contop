/**
 * Shared utilities for expanding compact pairing payloads.
 *
 * The server encodes payloads with short keys (t, d, g, h, p, …) to keep
 * QR codes small.  The same compact format is returned by the manual-pairing
 * REST endpoint.  This module provides the canonical expansion logic used by
 * both QRScanner and the manual-entry connect flow.
 */

// Default STUN servers — hardcoded to keep QR payload small
export const DEFAULT_STUN_CONFIG = {
  ice_servers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/** Restore colon-separated DTLS fingerprint from compact hex string. */
export function expandFingerprint(hex: string): string {
  if (hex.includes(':')) return hex; // already expanded
  return hex.match(/.{2}/g)?.join(':') ?? hex;
}

/**
 * Expand compact pairing keys to full PairingPayload keys.
 *
 * Compact format uses short keys (t, d, g, h, p, e, c, etc.) to reduce
 * QR density.  If the payload already contains full keys it is returned
 * as-is.
 */
export function expandPayload(raw: Record<string, unknown>): Record<string, unknown> {
  if ('token' in raw) return raw; // already full format

  const expanded: Record<string, unknown> = {
    token: raw.t,
    dtls_fingerprint: typeof raw.d === 'string' ? expandFingerprint(raw.d) : raw.d,
    stun_config: DEFAULT_STUN_CONFIG,
    server_host: raw.h,
    server_port: raw.p,
    expires_at: raw.e,
  };
  if (raw.g != null) expanded.gemini_api_key = raw.g;
  if (raw.c != null) expanded.connection_type = raw.c;
  if (raw.o != null) expanded.openai_api_key = raw.o;
  if (raw.a != null) expanded.anthropic_api_key = raw.a;
  if (raw.r != null) expanded.openrouter_api_key = raw.r;
  if (raw.ts != null) expanded.tailscale_host = raw.ts;
  if (raw.s != null) expanded.signaling_url = raw.s;
  if (raw.pa != null && typeof raw.pa === 'object' && !Array.isArray(raw.pa))
    expanded.pa = raw.pa as { g?: string; a?: string; o?: string };
  return expanded;
}
