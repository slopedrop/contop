import {
  createPeerConnection,
  createSignalingSocket,
  createMessageEnvelope,
  connectSignalingWithFallback,
  LAN_TIMEOUT_MS,
} from './webrtc';
import type { PairingPayload } from '../types';

// --- Mocks ---

jest.mock('react-native-webrtc', () => {
  const mockPeerConnection = {
    createOffer: jest.fn(),
    createAnswer: jest.fn(),
    setLocalDescription: jest.fn(),
    setRemoteDescription: jest.fn(),
    addIceCandidate: jest.fn(),
    createDataChannel: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    connectionState: 'new',
  };

  return {
    RTCPeerConnection: jest.fn().mockImplementation(() => mockPeerConnection),
    RTCSessionDescription: jest.fn().mockImplementation((desc: unknown) => desc),
    RTCIceCandidate: jest.fn().mockImplementation((candidate: unknown) => candidate),
    __mockPeerConnection: mockPeerConnection,
  };
});

const mockWebSocketInstance = {
  send: jest.fn(),
  close: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  readyState: 1,
};

const MockWebSocket = jest.fn().mockImplementation(() => mockWebSocketInstance);
(global as Record<string, unknown>).WebSocket = MockWebSocket;

const { RTCPeerConnection } = jest.requireMock('react-native-webrtc') as {
  RTCPeerConnection: jest.Mock;
};

describe('webrtc service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    MockWebSocket.mockImplementation(() => mockWebSocketInstance);
    (global as Record<string, unknown>).WebSocket = MockWebSocket;
  });

  describe('createPeerConnection', () => {
    test('[P1] 1.4-UNIT-013a: createPeerConnection(iceServers) returns configured RTCPeerConnection', () => {
      // Given - a list of ICE servers from the pairing payload
      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];

      // When - createPeerConnection is called with the ICE servers
      const pc = createPeerConnection(iceServers);

      // Then - an RTCPeerConnection is created with the provided ICE servers
      expect(RTCPeerConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          iceServers,
        }),
      );
      expect(pc).toBeDefined();
    });
  });

  describe('createSignalingSocket', () => {
    test('[P1] 1.4-UNIT-013b: createSignalingSocket(host, port, token) returns WebSocket to correct URL', () => {
      // Given - server connection details from the pairing payload
      const host = '192.168.1.100';
      const port = 8000;
      const token = 'abc-def-ghi-jkl';

      // When - createSignalingSocket is called
      const ws = createSignalingSocket(host, port, token);

      // Then - a WebSocket is created with the correct signaling URL
      const expectedUrl = `ws://${host}:${port}/ws/signaling?token=${token}`;
      expect(MockWebSocket).toHaveBeenCalledWith(expectedUrl);
      expect(ws).toBeDefined();
    });

    test('[P0] 1.7-UNIT-007a: createSignalingSocket uses signalingUrl when provided (AC4)', () => {
      // Given - a tunnel-provided signaling URL from QR payload
      const host = '192.168.1.100';
      const port = 8000;
      const token = 'abc-def-ghi-jkl';
      const signalingUrl = 'wss://my-tunnel.trycloudflare.com/ws/signaling';

      // When - createSignalingSocket is called with signalingUrl
      const ws = createSignalingSocket(host, port, token, signalingUrl);

      // Then - WebSocket uses the signalingUrl directly (with token appended)
      const expectedUrl = `${signalingUrl}?token=${token}`;
      expect(MockWebSocket).toHaveBeenCalledWith(expectedUrl);
      expect(ws).toBeDefined();
    });

    test('[P0] 1.7-UNIT-007b: createSignalingSocket falls back to ws://host:port when signalingUrl undefined (AC5)', () => {
      // Given - no tunnel URL (signalingUrl is undefined)
      const host = '10.0.0.5';
      const port = 9000;
      const token = 'test-token-xyz';

      // When - createSignalingSocket is called without signalingUrl
      const ws = createSignalingSocket(host, port, token, undefined);

      // Then - WebSocket falls back to constructed ws:// URL
      const expectedUrl = `ws://${host}:${port}/ws/signaling?token=${token}`;
      expect(MockWebSocket).toHaveBeenCalledWith(expectedUrl);
      expect(ws).toBeDefined();
    });
  });

  describe('createMessageEnvelope', () => {
    test('[P0] 1.4-UNIT-013c: createMessageEnvelope(type, payload) produces {type, id: uuid-v4, payload}', () => {
      // Given - a message type and payload to wrap
      const type = 'tool_call';
      const payload = { command: 'ls -la', workingDir: '/home/user' };

      // When - createMessageEnvelope is called
      const envelope = createMessageEnvelope(type, payload);

      // Then - the envelope has the correct structure with a UUID v4 id
      expect(envelope).toEqual(
        expect.objectContaining({
          type: 'tool_call',
          payload: { command: 'ls -la', workingDir: '/home/user' },
        }),
      );
      expect(envelope.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      // Ensure id is a string
      expect(typeof envelope.id).toBe('string');
    });
  });

  describe('connectSignalingWithFallback', () => {
    const FALLBACK_PAYLOAD: PairingPayload = {
      token: 'test-token',
      dtls_fingerprint: 'AA:BB',
      gemini_api_key: 'key',
      stun_config: { ice_servers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      server_host: '192.168.1.100',
      server_port: 8000,
      signaling_url: 'wss://tunnel.example.com/ws/signaling',
      tailscale_host: '100.64.0.2',
      expires_at: '2026-04-01T00:00:00Z',
    };

    let wsCallCount: number;
    let openHandlers: Array<() => void>;
    let errorHandlers: Array<() => void>;

    beforeEach(() => {
      jest.useFakeTimers();
      wsCallCount = 0;
      openHandlers = [];
      errorHandlers = [];

      MockWebSocket.mockImplementation((url: string) => {
        const idx = wsCallCount++;
        const instance = {
          url,
          send: jest.fn(),
          close: jest.fn(),
          readyState: 0,
          addEventListener: jest.fn((event: string, handler: () => void) => {
            if (event === 'open') openHandlers[idx] = handler;
            if (event === 'error') errorHandlers[idx] = handler;
          }),
          removeEventListener: jest.fn(),
        };
        return instance;
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('LAN succeeds immediately → returns "lan"', async () => {
      const promise = connectSignalingWithFallback(FALLBACK_PAYLOAD);
      await jest.advanceTimersByTimeAsync(0);

      // LAN WebSocket opens successfully
      expect(wsCallCount).toBe(1);
      openHandlers[0]();
      const result = await promise;
      expect(result.path).toBe('lan');
    });

    test('LAN error → falls back to Tailscale then Tunnel', async () => {
      const promise = connectSignalingWithFallback(FALLBACK_PAYLOAD);
      await jest.advanceTimersByTimeAsync(0);

      // LAN fails
      errorHandlers[0]();
      await jest.advanceTimersByTimeAsync(0);

      // Tailscale WebSocket opens (tried before tunnel)
      expect(wsCallCount).toBe(2);
      openHandlers[1]();
      const result = await promise;
      expect(result.path).toBe('tailscale');
    });

    test('LAN + Tailscale error → falls back to Tunnel', async () => {
      const promise = connectSignalingWithFallback(FALLBACK_PAYLOAD);
      await jest.advanceTimersByTimeAsync(0);

      // LAN fails
      errorHandlers[0]();
      await jest.advanceTimersByTimeAsync(0);

      // Tailscale fails
      errorHandlers[1]();
      await jest.advanceTimersByTimeAsync(0);

      // Tunnel WebSocket opens
      expect(wsCallCount).toBe(3);
      openHandlers[2]();
      const result = await promise;
      expect(result.path).toBe('tunnel');
    });

    test('no tailscale/tunnel in payload → LAN only, throws on failure', async () => {
      const lanOnlyPayload = { ...FALLBACK_PAYLOAD, tailscale_host: undefined, signaling_url: undefined };
      const promise = connectSignalingWithFallback(lanOnlyPayload).catch((e) => e);
      await jest.advanceTimersByTimeAsync(0);

      errorHandlers[0]();
      await jest.advanceTimersByTimeAsync(0);

      expect(wsCallCount).toBe(1);
      const error = await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('All connection paths failed');
    });

    test('all paths fail → throws with details', async () => {
      const promise = connectSignalingWithFallback(FALLBACK_PAYLOAD).catch((e) => e);
      await jest.advanceTimersByTimeAsync(0);

      // LAN fails
      errorHandlers[0]();
      await jest.advanceTimersByTimeAsync(0);

      // Tailscale fails
      errorHandlers[1]();
      await jest.advanceTimersByTimeAsync(0);

      // Tunnel fails
      errorHandlers[2]();
      await jest.advanceTimersByTimeAsync(0);

      const error = await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('All connection paths failed');
    });

    test('LAN timeout triggers fallback to Tailscale', async () => {
      const promise = connectSignalingWithFallback(FALLBACK_PAYLOAD);
      await jest.advanceTimersByTimeAsync(0);

      // Advance past LAN timeout without triggering open or error
      await jest.advanceTimersByTimeAsync(LAN_TIMEOUT_MS + 100);

      // Tailscale WebSocket should have been created
      expect(wsCallCount).toBe(2);
      openHandlers[1]();
      const result = await promise;
      expect(result.path).toBe('tailscale');
    });
  });
});
