import { RTCPeerConnection } from 'react-native-webrtc';
import type { DataChannelMessage, PairingPayload, ConnectionPath } from '../types';

export const MSG_TYPE_OFFER = 'offer';
export const MSG_TYPE_ANSWER = 'answer';
export const MSG_TYPE_ICE_CANDIDATE = 'ice_candidate';
export const MSG_TYPE_KEEPALIVE = 'keepalive';
export const MSG_TYPE_SESSION_END = 'session_end';

export const SILENT_RECONNECT_WINDOW_MS = 2000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_BACKOFF_MS = [1000, 2000, 3000, 5000, 8000];

export const LAN_TIMEOUT_MS = 1500;
export const TAILSCALE_TIMEOUT_MS = 3000;
export const TUNNEL_TIMEOUT_MS = 5000;

export function createPeerConnection(
  iceServers: Array<{ urls: string }>,
): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 10,
  });
}

export function createSignalingSocket(
  serverHost: string,
  serverPort: number,
  token: string,
  signalingUrl?: string,
): WebSocket {
  const url = signalingUrl
    ? `${signalingUrl}?token=${token}`
    : `ws://${serverHost}:${serverPort}/ws/signaling?token=${token}`;
  return new WebSocket(url);
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createMessageEnvelope(
  type: string,
  payload: Record<string, unknown>,
): DataChannelMessage {
  return {
    type,
    id: uuidv4(),
    payload,
  };
}

type FallbackResult = {
  ws: WebSocket;
  path: ConnectionPath;
};

/**
 * Try to open a WebSocket with a timeout. Resolves with the open WebSocket
 * or rejects if it fails or times out.
 */
function tryWebSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);

    const settle = (result: 'resolve' | 'reject', value: WebSocket | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result === 'resolve') {
        resolve(value as WebSocket);
      } else {
        ws.close();
        reject(value as Error);
      }
    };

    const timer = setTimeout(() => {
      settle('reject', new Error(`WebSocket timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      settle('resolve', ws);
    });
    ws.addEventListener('error', () => {
      settle('reject', new Error('WebSocket connection error'));
    });
    ws.addEventListener('close', () => {
      settle('reject', new Error('WebSocket closed before opening'));
    });
  });
}

/**
 * LAN-first connection with multi-fallback.
 *
 * Always tries all available paths in order - no settings gate:
 * 1. LAN (ws://server_host:server_port) - 1.5s timeout
 * 2. Tailscale (ws://tailscale_host:server_port) - 3s timeout (if tailscale_host in payload)
 * 3. Cloudflare tunnel (wss://signaling_url) - 5s timeout (if signaling_url in payload)
 * 4. If all fail: throw with details
 */
export async function connectSignalingWithFallback(
  payload: PairingPayload,
): Promise<FallbackResult> {
  const { server_host, server_port, token, signaling_url, tailscale_host } = payload;
  const failures: string[] = [];

  // 1. Always try LAN first
  const lanUrl = `ws://${server_host}:${server_port}/ws/signaling?token=${token}`;
  try {
    const ws = await tryWebSocket(lanUrl, LAN_TIMEOUT_MS);
    return { ws, path: 'lan' };
  } catch (e: any) {
    failures.push(`LAN (${server_host}): ${e.message}`);
  }

  // 2. Try Tailscale if available in payload
  if (tailscale_host) {
    const tsUrl = `ws://${tailscale_host}:${server_port}/ws/signaling?token=${token}`;
    try {
      const ws = await tryWebSocket(tsUrl, TAILSCALE_TIMEOUT_MS);
      return { ws, path: 'tailscale' };
    } catch (e: any) {
      failures.push(`Tailscale (${tailscale_host}): ${e.message}`);
    }
  }

  // 3. Try Cloudflare tunnel if available in payload
  if (signaling_url) {
    const tunnelUrl = `${signaling_url}?token=${token}`;
    try {
      const ws = await tryWebSocket(tunnelUrl, TUNNEL_TIMEOUT_MS);
      return { ws, path: 'tunnel' };
    } catch (e: any) {
      failures.push(`Tunnel: ${e.message}`);
    }
  }

  // 4. All paths failed
  throw new Error(`All connection paths failed:\n${failures.join('\n')}`);
}
