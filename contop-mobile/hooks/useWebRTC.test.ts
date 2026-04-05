import { renderHook, act } from '@testing-library/react-native';
import { buildFakePairingPayload } from '../__tests__/factories';
import { useWebRTC } from './useWebRTC';

// --- Mocks ---

jest.mock('react-native-webrtc', () => {
  const mockDataChannel = {
    label: 'contop',
    ordered: true,
    readyState: 'open',
    send: jest.fn(),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };

  const mockPeerConnection = {
    createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp-offer' }),
    createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp-answer' }),
    setLocalDescription: jest.fn().mockResolvedValue(undefined),
    setRemoteDescription: jest.fn().mockResolvedValue(undefined),
    addIceCandidate: jest.fn().mockResolvedValue(undefined),
    createDataChannel: jest.fn().mockReturnValue(mockDataChannel),
    addTransceiver: jest.fn(),
    close: jest.fn(),
    restartIce: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    connectionState: 'new',
    localDescription: null,
    remoteDescription: null,
  };

  const MockMediaStream = jest.fn().mockImplementation(() => {
    const tracks: unknown[] = [];
    return {
      toURL: () => 'mock-stream-url',
      addTrack: jest.fn((track: unknown) => tracks.push(track)),
      getTracks: () => tracks,
    };
  });

  return {
    RTCPeerConnection: jest.fn().mockImplementation(() => mockPeerConnection),
    RTCSessionDescription: jest.fn().mockImplementation((desc: unknown) => desc),
    RTCIceCandidate: jest.fn().mockImplementation((candidate: unknown) => candidate),
    MediaStream: MockMediaStream,
    mediaDevices: { getUserMedia: jest.fn() },
    __mockPeerConnection: mockPeerConnection,
    __mockDataChannel: mockDataChannel,
  };
});

// Mock WebSocket globally
const mockWebSocketInstance = {
  send: jest.fn(),
  close: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  readyState: 1, // OPEN
  OPEN: 1,
  CLOSED: 3,
};

const MockWebSocket = Object.assign(
  jest.fn().mockImplementation(() => mockWebSocketInstance),
  { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
);
(global as Record<string, unknown>).WebSocket = MockWebSocket;

jest.mock('../stores/useAIStore', () => ({
  __esModule: true,
  default: Object.assign(
    jest.fn().mockReturnValue({
      connectionStatus: 'disconnected',
      setConnectionStatus: jest.fn(),
      setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
      setConnectionType: jest.fn(),
    }),
    {
      getState: jest.fn().mockReturnValue({
        setConnectionStatus: jest.fn(),
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setConnectionType: jest.fn(),
        setAIState: jest.fn(),
        clearExecutionEntries: jest.fn(),
        setActiveSession: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      }),
    },
  ),
}));

// Mock connectSignalingWithFallback — returns the mock WebSocket as if LAN succeeded.
// The actual fallback logic is tested in webrtc.test.ts.
jest.mock('../services/webrtc', () => {
  const actual = jest.requireActual('../services/webrtc');
  return {
    ...actual,
    connectSignalingWithFallback: jest.fn(),
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Heavy: 'heavy', Medium: 'medium', Light: 'light' },
  NotificationFeedbackType: { Error: 'error', Success: 'success', Warning: 'warning' },
}), { virtual: true });

// Access mocks for assertions
const {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream: MockMediaStream,
  __mockPeerConnection: mockPC,
  __mockDataChannel: mockDC,
} = jest.requireMock('react-native-webrtc') as {
  RTCPeerConnection: jest.Mock;
  RTCSessionDescription: jest.Mock;
  RTCIceCandidate: jest.Mock;
  MediaStream: jest.Mock;
  __mockPeerConnection: Record<string, jest.Mock>;
  __mockDataChannel: Record<string, jest.Mock>;
};

const useAIStoreMock = jest.requireMock('../stores/useAIStore') as {
  default: jest.Mock & { getState: jest.Mock };
};

const Haptics = jest.requireMock('expo-haptics') as {
  impactAsync: jest.Mock;
  notificationAsync: jest.Mock;
};

// Track WebSocket event handlers so tests can fire them after connect()
let wsHandlers: Record<string, ((event?: unknown) => void)[]>;

describe('useWebRTC hook', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    // Restore default mock implementations after reset
    mockPC.createOffer.mockResolvedValue({ type: 'offer', sdp: 'mock-sdp-offer' });
    mockPC.setLocalDescription.mockResolvedValue(undefined);
    mockPC.setRemoteDescription.mockResolvedValue(undefined);
    mockPC.addIceCandidate.mockResolvedValue(undefined);
    mockPC.createDataChannel.mockReturnValue(mockDC);
    mockDC.readyState = 'open';
    mockWebSocketInstance.readyState = 1;

    // Track WS handlers and auto-fire 'open' so connect() can resolve
    wsHandlers = {};
    mockWebSocketInstance.addEventListener = jest.fn(
      (event: string, handler: (event?: unknown) => void) => {
        if (!wsHandlers[event]) wsHandlers[event] = [];
        wsHandlers[event].push(handler);
        // Auto-fire 'open' to unblock the Promise in connect()
        if (event === 'open') {
          Promise.resolve().then(() => handler());
        }
      },
    );

    RTCPeerConnection.mockImplementation(() => mockPC);
    RTCSessionDescription.mockImplementation((desc: unknown) => desc);
    RTCIceCandidate.mockImplementation((candidate: unknown) => candidate);
    MockMediaStream.mockImplementation(() => {
      const tracks: unknown[] = [];
      return {
        toURL: () => 'mock-stream-url',
        addTrack: jest.fn((track: unknown) => tracks.push(track)),
        getTracks: () => tracks,
      };
    });
    MockWebSocket.mockImplementation(() => mockWebSocketInstance);
    (global as Record<string, unknown>).WebSocket = MockWebSocket;

    const mockSetConnectionStatus = jest.fn();
    const mockSetConnectionPath = jest.fn();
    const mockSetAIState = jest.fn();
    const mockSoftReset = jest.fn();
    const mockHardReset = jest.fn();
    const mockResetStore = jest.fn();
    useAIStoreMock.default.mockReturnValue({
      connectionStatus: 'disconnected',
      setConnectionStatus: mockSetConnectionStatus,
      setConnectionPath: mockSetConnectionPath,
      setAIState: mockSetAIState,
    });
    useAIStoreMock.default.getState.mockReturnValue({
      setConnectionStatus: mockSetConnectionStatus,
      setConnectionPath: mockSetConnectionPath,
      setConnectionType: jest.fn(),
      setAIState: mockSetAIState,
      clearExecutionEntries: jest.fn(),
      setActiveSession: jest.fn(),
      softReset: mockSoftReset,
      hardReset: mockHardReset,
      resetStore: mockResetStore,
    });

    // Restore connectSignalingWithFallback mock — returns the mock WebSocket
    const webrtcMock = jest.requireMock('../services/webrtc') as {
      connectSignalingWithFallback: jest.Mock;
    };
    webrtcMock.connectSignalingWithFallback.mockResolvedValue({
      ws: mockWebSocketInstance,
      path: 'lan' as const,
    });
  });

  describe('connect() — signaling setup', () => {
    test('[P0] 1.4-UNIT-007a: connect() calls connectSignalingWithFallback with correct payload', async () => {
      // Given — a valid pairing payload with server_host, server_port, and token
      const payload = buildFakePairingPayload();

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };

      // When — connect() is called with the pairing payload
      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Then — connectSignalingWithFallback is called with the payload
      expect(webrtcMock.connectSignalingWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          server_host: payload.server_host,
          server_port: payload.server_port,
          token: payload.token,
        }),
      );
    });

    test('[P0] 1.4-UNIT-007b: connect() creates RTCPeerConnection with ICE servers from stun_config', async () => {
      // Given — a pairing payload with stun_config containing ICE servers
      const payload = buildFakePairingPayload();

      // When — connect() is called
      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Then — RTCPeerConnection is created with ICE servers from the payload
      expect(RTCPeerConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          iceServers: payload.stun_config.ice_servers,
        }),
      );
    });

    test('[P0] 1.4-UNIT-007c: connect() creates SDP offer and sends via WebSocket', async () => {
      // Given — a pairing payload and an open WebSocket
      const payload = buildFakePairingPayload();

      // When — connect() is called and WebSocket is open
      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Then — an SDP offer is created and sent via the WebSocket
      expect(mockPC.createOffer).toHaveBeenCalled();
      expect(mockPC.setLocalDescription).toHaveBeenCalled();
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"offer"'),
      );
    });

    test('[P0] 1.4-UNIT-007d: receives SDP answer and sets remote description', async () => {
      // Given — connect() has been called and an offer was sent
      const payload = buildFakePairingPayload();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — an SDP answer is received via WebSocket
      const answerMessage = JSON.stringify({ type: 'answer', sdp: 'mock-remote-sdp' });
      const wsMessageHandler = wsHandlers['message']?.[0] as
        | ((event: { data: string }) => void)
        | undefined;
      await act(async () => {
        wsMessageHandler?.({ data: answerMessage });
      });

      // Then — the remote description is set on the peer connection
      expect(mockPC.setRemoteDescription).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'answer', sdp: 'mock-remote-sdp' }),
      );
    });
  });

  describe('ICE candidate exchange', () => {
    test('[P0] 1.4-UNIT-008a: local ICE candidates sent via WebSocket', async () => {
      // Given — connect() has been called and peer connection emits ICE candidates
      const payload = buildFakePairingPayload();
      let iceCandidateHandler: ((event: { candidate: unknown }) => void) | undefined;
      mockPC.addEventListener.mockImplementation(
        (event: string, handler: (event: { candidate: unknown }) => void) => {
          if (event === 'icecandidate') iceCandidateHandler = handler;
        },
      );

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — a local ICE candidate is generated
      const mockCandidate = { candidate: 'candidate:1234', sdpMid: '0', sdpMLineIndex: 0 };
      await act(async () => {
        iceCandidateHandler?.({ candidate: mockCandidate });
      });

      // Then — the ICE candidate is sent via WebSocket
      expect(mockWebSocketInstance.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"ice_candidate"'),
      );
    });

    test('[P0] 1.4-UNIT-008b: remote ICE candidates added to peer connection', async () => {
      // Given — connect() has been called and WebSocket receives an ICE candidate
      const payload = buildFakePairingPayload();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — a remote ICE candidate message arrives via WebSocket
      const remoteCandidateMsg = JSON.stringify({
        type: 'ice_candidate',
        candidate: { candidate: 'candidate:5678', sdpMid: '0', sdpMLineIndex: 0 },
      });
      const wsMessageHandler = wsHandlers['message']?.[0] as
        | ((event: { data: string }) => void)
        | undefined;
      await act(async () => {
        wsMessageHandler?.({ data: remoteCandidateMsg });
      });

      // Then — the candidate is added to the peer connection
      expect(mockPC.addIceCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ candidate: 'candidate:5678' }),
      );
    });
  });

  describe('data channel', () => {
    test('[P0] 1.4-UNIT-009a: data channel "contop" created with ordered: true', async () => {
      // Given — connect() is called with a valid payload
      const payload = buildFakePairingPayload();

      // When — the peer connection is set up
      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Then — a data channel named "contop" is created with ordered delivery
      expect(mockPC.createDataChannel).toHaveBeenCalledWith('contop', { ordered: true });
    });

    test('[P0] 1.4-UNIT-009b: sendMessage() wraps in canonical envelope {type, id, payload} with UUID v4', async () => {
      // Given — a connected hook with an open data channel
      const payload = buildFakePairingPayload();
      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — sendMessage() is called with a type and payload
      await act(async () => {
        result.current.sendMessage('tool_call', { command: 'ls' });
      });

      // Then — the message is sent via data channel in canonical envelope format with UUID v4 id
      expect(mockDC.send).toHaveBeenCalledTimes(1);
      const sentData = JSON.parse(mockDC.send.mock.calls[0][0] as string) as {
        type: string;
        id: string;
        payload: { command: string };
      };
      expect(sentData.type).toBe('tool_call');
      expect(sentData.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(sentData.payload).toEqual({ command: 'ls' });
    });

    test('[P1] 1.4-UNIT-009c: data channel message events parsed and handled', async () => {
      // Given — a connected hook with a data channel that receives messages
      const payload = buildFakePairingPayload();
      let dcMessageHandler: ((event: { data: string }) => void) | undefined;
      mockDC.addEventListener.mockImplementation(
        (event: string, handler: (event: { data: string }) => void) => {
          if (event === 'message') dcMessageHandler = handler;
        },
      );

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — a message arrives on the data channel
      const incomingMessage = JSON.stringify({
        type: 'state_update',
        id: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
        payload: { aiState: 'processing' },
      });
      await act(async () => {
        dcMessageHandler?.({ data: incomingMessage });
      });

      // Then — the message is parsed without throwing (handler is registered)
      expect(mockDC.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('agent_progress audit field extraction (Story 4.2)', () => {
    test('[P0] 4.2-UNIT-008: classified_command and execution_result extracted from agent_progress completion', async () => {
      const payload = buildFakePairingPayload();
      let dcMessageHandler: ((event: { data: string }) => void) | undefined;
      mockDC.addEventListener.mockImplementation(
        (event: string, handler: (event: { data: string }) => void) => {
          if (event === 'message') dcMessageHandler = handler;
        },
      );

      const mockUpdateEntry = jest.fn();
      const mockAddEntry = jest.fn();
      const existingEntry = {
        id: 'prog-1', type: 'agent_progress', content: 'Running: pip install requests',
        timestamp: Date.now(), metadata: { step: 1, tool: 'execute_cli', status: 'running' },
      };
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: jest.fn(), setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(), softReset: jest.fn(), hardReset: jest.fn(), resetStore: jest.fn(),
        aiState: 'executing',
        executionEntries: [existingEntry],
        updateExecutionEntry: mockUpdateEntry,
        addExecutionEntry: mockAddEntry,
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => { await result.current.connect(payload); });

      // Simulate agent_progress completion with audit fields
      const progressMsg = JSON.stringify({
        type: 'agent_progress',
        id: 'prog-1-update',
        payload: {
          step: 1, tool: 'execute_cli',
          detail: 'Running: pip install requests',
          status: 'completed',
          stdout: 'Successfully installed',
          duration_ms: 1500,
          classified_command: 'pip install requests',
          execution_result: 'success',
        },
      });
      await act(async () => { dcMessageHandler?.({ data: progressMsg }); });

      // Verify updateExecutionEntry was called with the audit fields in metadata
      expect(mockUpdateEntry).toHaveBeenCalledTimes(1);
      const updateArgs = mockUpdateEntry.mock.calls[0];
      expect(updateArgs[0]).toBe('prog-1'); // existing entry ID
      const updatedData = updateArgs[1];
      expect(updatedData.metadata.classified_command).toBe('pip install requests');
      expect(updatedData.metadata.execution_result).toBe('success');
      expect(updatedData.metadata.duration_ms).toBe(1500);
    });
  });

  describe('connectionStatus state management', () => {
    test('[P0] 1.4-UNIT-010a: connectionStatus → "connected" when PC connectionState is "connected"', async () => {
      // Given — connect() has been called and peer connection state changes
      const payload = buildFakePairingPayload();
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — peer connection state becomes 'connected'
      mockPC.connectionState = 'connected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — connectionStatus is set to 'connected' in the Zustand store
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('connected');
    });

    test('[P0] 1.4-UNIT-010b: connectionStatus transitions for "disconnected"/"failed"/"closed" PC states (permanent connection)', async () => {
      // Given — connect() has been called with a permanent connection (no connection_type = permanent)
      // Persistent Pairing update: permanent connections do NOT auto-reconnect on ICE disconnect,
      // they set 'disconnected' and require manual reconnect with biometric.
      const payload = buildFakePairingPayload();
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      const mockSetAIState = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: mockSetAIState,
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — peer connection state becomes 'disconnected' (permanent connection)
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — connectionStatus is set to 'disconnected' (permanent: no auto-reconnect)
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('disconnected');
      expect(mockSetAIState).toHaveBeenCalledWith('idle');

      // When — peer connection state becomes 'failed'
      mockSetConnectionStatus.mockClear();
      mockPC.connectionState = 'failed';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — connectionStatus is set to 'reconnecting' (failed always triggers reconnect)
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('reconnecting');

      // When — peer connection state becomes 'closed'
      mockSetConnectionStatus.mockClear();
      mockPC.connectionState = 'closed';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — 'closed' during reconnection is suppressed (isReconnecting is true from failed)
      expect(mockSetConnectionStatus).not.toHaveBeenCalledWith('disconnected');
    });
  });

  describe('keepalive mechanism', () => {
    test('[P0] 1.4-UNIT-011a: keepalive response sent when server keepalive received', async () => {
      // Given — a connected hook with an open data channel
      const payload = buildFakePairingPayload();
      let dcMessageHandler: ((event: { data: string }) => void) | undefined;
      mockDC.addEventListener.mockImplementation(
        (event: string, handler: (event: { data: string }) => void) => {
          if (event === 'message') dcMessageHandler = handler;
        },
      );

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — a keepalive message is received from the server
      const keepaliveMsg = JSON.stringify({
        type: 'keepalive',
        id: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
        payload: {},
      });
      await act(async () => {
        dcMessageHandler?.({ data: keepaliveMsg });
      });

      // Then — a keepalive response is sent back via the data channel
      const sentCalls = mockDC.send.mock.calls;
      const keepaliveResponse = sentCalls.find((call: unknown[]) => {
        const parsed = JSON.parse(call[0] as string) as { type: string };
        return parsed.type === 'keepalive';
      });
      expect(keepaliveResponse).toBeDefined();
    });

    test('[P0] 1.4-UNIT-011b: 3 missed keepalives → does NOT disconnect (mobile may be backgrounded)', async () => {
      // Given — a connected hook expecting keepalive messages every 30s
      const payload = buildFakePairingPayload();
      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — 3+ keepalive intervals pass without receiving a keepalive (90s total)
      await act(async () => {
        jest.advanceTimersByTime(90_000);
      });

      // Then — the connection is NOT declared dead
      // (mobile JS pauses when backgrounded, but ICE/P2P stays alive)
      expect(mockSetConnectionStatus).not.toHaveBeenCalledWith('disconnected');

      jest.useRealTimers();
    });

    test('[P1] 1.4-UNIT-011c: keepalive counter resets on received keepalive', async () => {
      // Given — a connected hook that has missed some keepalives
      const payload = buildFakePairingPayload();
      let dcMessageHandler: ((event: { data: string }) => void) | undefined;
      mockDC.addEventListener.mockImplementation(
        (event: string, handler: (event: { data: string }) => void) => {
          if (event === 'message') dcMessageHandler = handler;
        },
      );

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — 2 keepalive intervals pass (60s) but then a keepalive is received
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      const keepaliveMsg = JSON.stringify({
        type: 'keepalive',
        id: 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
        payload: {},
      });
      await act(async () => {
        dcMessageHandler?.({ data: keepaliveMsg });
      });

      // Then — after another 60s (only 2 more missed), connection is NOT declared dead
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      // The connection should NOT have been set to disconnected due to keepalive timeout
      // because the counter was reset by the received keepalive
      const disconnectedCalls = mockSetConnectionStatus.mock.calls.filter(
        (call: unknown[]) => call[0] === 'disconnected',
      );
      expect(disconnectedCalls.length).toBe(0);

      jest.useRealTimers();
    });
  });

  describe('disconnect()', () => {
    test('[P0] 1.4-UNIT-012a: disconnect() closes data channel, peer connection, WebSocket', async () => {
      // Given — an active connection with open data channel, peer connection, and WebSocket
      const payload = buildFakePairingPayload();
      const mockSoftReset = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: jest.fn(),
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: mockSoftReset,
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — disconnect() is called
      await act(async () => {
        result.current.disconnect();
      });

      // Then — all resources are cleaned up
      expect(mockDC.close).toHaveBeenCalled();
      expect(mockPC.close).toHaveBeenCalled();
      expect(mockWebSocketInstance.close).toHaveBeenCalled();
    });

    test('[P0] 1.4-UNIT-012b: disconnect() calls softReset (preserves stored credentials)', async () => {
      // Given — an active connection
      const payload = buildFakePairingPayload();
      const mockSoftReset = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: jest.fn(),
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: mockSoftReset,
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — disconnect() is called
      await act(async () => {
        result.current.disconnect();
      });

      // Then — softReset() is called (clears runtime state but preserves stored credentials)
      expect(mockSoftReset).toHaveBeenCalled();
    });
  });

  describe('auto-reconnect (Story 1.5)', () => {
    test('[P0] 1.5-UNIT-001: ICE disconnect → connectionStatus "reconnecting" and restartIce() called (temp connection)', async () => {
      // Given — an active temp connection with peer connection state 'connected'
      // Persistent Pairing: only temp connections auto-reconnect on ICE disconnect
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — ICE connection state transitions to 'disconnected'
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — connectionStatus is set to 'reconnecting' and restartIce() is called
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('reconnecting');
      expect(mockPC.restartIce).toHaveBeenCalled();
    });

    test('[P0] 1.5-UNIT-002: ICE recovery within 2s silent window → connectionStatus "connected", timers cancelled (temp connection)', async () => {
      // Given — an active temp connection that has entered 'disconnected' ICE state
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Trigger disconnected state to start reconnection (temp → auto-reconnect)
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // When — ICE recovers within 2s silent window
      jest.advanceTimersByTime(1000); // only 1s elapsed
      mockPC.connectionState = 'connected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — status went through 'reconnecting' before recovering to 'connected'
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('reconnecting');
      expect(mockSetConnectionStatus).toHaveBeenLastCalledWith('connected');
      // And no haptic feedback was triggered during the silent window
      expect(Haptics.notificationAsync).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('[P0] 1.5-UNIT-003: Silent window expires → haptic feedback triggered (temp connection)', async () => {
      // Given — an active temp connection that has entered reconnecting state
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Trigger disconnected state to start reconnection
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // When — the 2s silent window expires without ICE recovery
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Then — haptic feedback is triggered to notify the user
      expect(Haptics.notificationAsync).toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('[P0] 1.5-UNIT-004: Full reconnection after silent window (new WS + PC + SDP) (temp connection)', async () => {
      // Given — an active temp connection that has entered reconnecting state
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };
      const initialFallbackCalls = webrtcMock.connectSignalingWithFallback.mock.calls.length;

      // Trigger disconnected state and let restartIce fail (stays disconnected)
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // When — the silent window expires and full reconnection is attempted
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Then — connectSignalingWithFallback is called again (full reconnect)
      expect(webrtcMock.connectSignalingWithFallback.mock.calls.length).toBeGreaterThan(initialFallbackCalls);

      jest.useRealTimers();
    });

    test('[P0] 1.5-UNIT-005: Max reconnect attempts (5) exhausted → disconnected + aiState disconnected (temp connection)', async () => {
      // Given — an active temp connection that keeps failing to reconnect
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      const mockSetAIState = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: mockSetAIState,
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — initial disconnect triggers reconnection (counter=0)
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Silent window expires → first full reconnect attempt (counter: 0→1)
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Subsequent disconnects trigger attempts 2 through 5 (counter: 1→2, 2→3, 3→4, 4→5)
      for (let attempt = 0; attempt < 4; attempt++) {
        mockPC.connectionState = 'disconnected';
        await act(async () => {
          connectionStateHandler?.();
        });
      }

      // Final disconnect hits exhaustion check (counter=5 >= MAX=5)
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — connectionStatus is 'disconnected' and aiState is 'disconnected'
      expect(mockSetConnectionStatus).toHaveBeenLastCalledWith('disconnected');
      expect(mockSetAIState).toHaveBeenCalledWith('disconnected');

      jest.useRealTimers();
    });

    test('[P0] 1.5-UNIT-009: ICE "failed" → skip silent window, immediately full reconnect', async () => {
      // Given — an active connection
      const payload = buildFakePairingPayload();
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };
      const callsBefore = webrtcMock.connectSignalingWithFallback.mock.calls.length;

      // When — ICE state transitions directly to 'failed'
      mockPC.connectionState = 'failed';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — full reconnect is triggered immediately (no 2s silent window)
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('reconnecting');
      expect(webrtcMock.connectSignalingWithFallback.mock.calls.length).toBeGreaterThan(callsBefore);
      // And haptic feedback fires even though silent window was skipped
      expect(Haptics.notificationAsync).toHaveBeenCalled();

      jest.useRealTimers();
    });

    test('[P1] 1.5-UNIT-014: WS error/close during reconnection does NOT set disconnected (temp connection)', async () => {
      // Given — an active temp connection that is in reconnecting state
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Trigger reconnecting state (temp → auto-reconnect)
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Reset to track only calls after reconnecting is set
      mockSetConnectionStatus.mockClear();

      // When — WebSocket fires error/close during reconnection
      const wsErrorHandler = wsHandlers['error']?.[0];
      const wsCloseHandler = wsHandlers['close']?.[0];
      await act(async () => {
        wsErrorHandler?.();
        wsCloseHandler?.();
      });

      // Then — connectionStatus should NOT be set to 'disconnected' (stay in 'reconnecting')
      const disconnectedCalls = mockSetConnectionStatus.mock.calls.filter(
        (call: unknown[]) => call[0] === 'disconnected',
      );
      expect(disconnectedCalls.length).toBe(0);
    });
  });

  describe('graceful termination (Story 1.5)', () => {
    test('[P0] 1.5-UNIT-006: disconnect() sends session_end via data channel', async () => {
      // Given — an active connection with open data channel
      const payload = buildFakePairingPayload();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: jest.fn(),
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — disconnect() is called
      await act(async () => {
        result.current.disconnect();
      });

      // Then — a session_end message is sent via the data channel before closing
      const sentCalls = mockDC.send.mock.calls;
      const sessionEndMsg = sentCalls.find((call: unknown[]) => {
        const parsed = JSON.parse(call[0] as string) as { type: string };
        return parsed.type === 'session_end';
      });
      expect(sessionEndMsg).toBeDefined();
    });

    test('[P1] 1.5-UNIT-007: disconnect() during reconnection cancels all reconnection timers', async () => {
      // Given — an active temp connection that is in reconnecting state
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Trigger reconnecting state — must set status to 'reconnecting'
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Verify we entered reconnecting state (prerequisite for this test)
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('reconnecting');

      // When — disconnect() is called during reconnection
      await act(async () => {
        result.current.disconnect();
      });

      // Clear mock to track calls after disconnect
      mockSetConnectionStatus.mockClear();
      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };
      webrtcMock.connectSignalingWithFallback.mockClear();

      // Then — advancing timers should NOT trigger any reconnection attempts
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });

      // No new connection attempts should be made after explicit disconnect
      expect(webrtcMock.connectSignalingWithFallback).not.toHaveBeenCalled();
      // connectionStatus should not change to 'reconnecting' again
      const reconnectingCalls = mockSetConnectionStatus.mock.calls.filter(
        (call: unknown[]) => call[0] === 'reconnecting',
      );
      expect(reconnectingCalls.length).toBe(0);

      jest.useRealTimers();
    });
  });

  describe('remote video stream (Story 2.3)', () => {
    test('[P0] 2.3-UNIT-001: remoteStream is null before any connection', () => {
      // Given — a freshly created hook
      const { result } = renderHook(() => useWebRTC());

      // Then — remoteStream should be null
      expect(result.current.remoteStream).toBeNull();
    });

    test('[P0] 2.3-UNIT-002: ontrack event with video track updates remoteStream', async () => {
      // Given — a connected hook with peer connection that fires ontrack
      const payload = buildFakePairingPayload();
      let trackHandler: ((event: { track: { kind: string }; streams: unknown[] }) => void) | undefined;
      mockPC.addEventListener.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'track') trackHandler = handler as typeof trackHandler;
        },
      );

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Verify ontrack handler was registered
      expect(mockPC.addEventListener).toHaveBeenCalledWith('track', expect.any(Function));

      // When — a video track event is received
      const mockStream = { toURL: () => 'mock-stream-url', id: 'stream-1' };
      await act(async () => {
        trackHandler?.({ track: { kind: 'video' }, streams: [mockStream] });
      });

      // Then — remoteStream is set to the stream from the event
      expect(result.current.remoteStream).toBe(mockStream);
    });

    test('[P0] 2.3-UNIT-002b: ontrack with empty streams array creates MediaStream from track', async () => {
      // Given — a connected hook where aiortc sends track without associated stream
      const payload = buildFakePairingPayload();
      let trackHandler: ((event: { track: { kind: string }; streams?: unknown[] }) => void) | undefined;
      mockPC.addEventListener.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'track') trackHandler = handler as typeof trackHandler;
        },
      );

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — a video track event is received with empty streams (aiortc behavior)
      const mockTrack = { kind: 'video', id: 'track-1' };
      await act(async () => {
        trackHandler?.({ track: mockTrack, streams: [] });
      });

      // Then — a new MediaStream is created and set as remoteStream
      expect(result.current.remoteStream).not.toBeNull();
      expect(result.current.remoteStream?.toURL()).toBe('mock-stream-url');
    });

    test('[P0] 2.3-UNIT-003: disconnect() clears remoteStream to null', async () => {
      // Given — a connected hook with an active remote stream
      const payload = buildFakePairingPayload();
      let trackHandler: ((event: { track: { kind: string }; streams: unknown[] }) => void) | undefined;
      mockPC.addEventListener.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'track') trackHandler = handler as typeof trackHandler;
        },
      );

      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: jest.fn(),
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Set remote stream
      const mockStream = { toURL: () => 'mock-stream-url', id: 'stream-1' };
      await act(async () => {
        trackHandler?.({ track: { kind: 'video' }, streams: [mockStream] });
      });
      expect(result.current.remoteStream).toBe(mockStream);

      // When — disconnect() is called
      await act(async () => {
        result.current.disconnect();
      });

      // Then — remoteStream is cleared to null
      expect(result.current.remoteStream).toBeNull();
    });

    test('[P1] 2.3-UNIT-004: ontrack with audio track does NOT update remoteStream', async () => {
      // Given — a connected hook
      const payload = buildFakePairingPayload();
      let trackHandler: ((event: { track: { kind: string }; streams: unknown[] }) => void) | undefined;
      mockPC.addEventListener.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'track') trackHandler = handler as typeof trackHandler;
        },
      );

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — an audio track event is received (not video)
      const mockStream = { toURL: () => 'mock-audio-url', id: 'audio-stream' };
      await act(async () => {
        trackHandler?.({ track: { kind: 'audio' }, streams: [mockStream] });
      });

      // Then — remoteStream remains null
      expect(result.current.remoteStream).toBeNull();
    });
  });

  describe('signaling URL support (Story 1.7)', () => {
    test('[P0] 1.7-UNIT-007c: connect() passes payload with signaling_url to connectSignalingWithFallback (AC4)', async () => {
      // Given — a pairing payload with signaling_url from Cloudflare Tunnel
      const payload = buildFakePairingPayload({
        signaling_url: 'wss://my-tunnel.trycloudflare.com/ws/signaling',
      });

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };

      // When — connect() is called with the payload
      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Then — connectSignalingWithFallback is called with the payload containing signaling_url
      expect(webrtcMock.connectSignalingWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          signaling_url: 'wss://my-tunnel.trycloudflare.com/ws/signaling',
          token: payload.token,
        }),
      );
    });

    test('[P0] 1.7-UNIT-007d: connect() without signaling_url passes payload to connectSignalingWithFallback (AC5)', async () => {
      // Given — a pairing payload WITHOUT signaling_url (LAN-only mode)
      const payload = buildFakePairingPayload();

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };

      // When — connect() is called
      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Then — connectSignalingWithFallback is called with the payload (no signaling_url)
      expect(webrtcMock.connectSignalingWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          server_host: payload.server_host,
          server_port: payload.server_port,
          token: payload.token,
        }),
      );
      // signaling_url should not be present (or undefined)
      const calledPayload = webrtcMock.connectSignalingWithFallback.mock.calls[0][0];
      expect(calledPayload.signaling_url).toBeUndefined();
    });

    test('[P0] 1.7-UNIT-007e: attemptFullReconnect calls connectSignalingWithFallback with stored payload (AC4)', async () => {
      // Given — a connected temp session with signaling_url in the payload
      const payload = buildFakePairingPayload({
        signaling_url: 'wss://reconnect-tunnel.trycloudflare.com/ws/signaling',
        connection_type: 'temp',
      });

      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      const mockSetConnectionPath = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: mockSetConnectionPath,
        setConnectionType: jest.fn(),
        setAIState: jest.fn(),
        clearExecutionEntries: jest.fn(),
        setActiveSession: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // Clear to track only reconnection calls
      webrtcMock.connectSignalingWithFallback.mockClear();

      // When — ICE disconnects and silent window expires, triggering full reconnect
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Then — connectSignalingWithFallback is called again with the same payload
      expect(webrtcMock.connectSignalingWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          signaling_url: 'wss://reconnect-tunnel.trycloudflare.com/ws/signaling',
          token: payload.token,
        }),
      );

      jest.useRealTimers();
    });
  });

  describe('reconnection robustness fixes', () => {
    test('[P0] WS closed during SDP exchange throws and triggers retry', async () => {
      // Given — a connected session that enters reconnecting state
      const payload = buildFakePairingPayload();
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      // When — WS readyState becomes CLOSED before the SDP offer can be sent
      mockWebSocketInstance.readyState = 3; // CLOSED

      mockPC.connectionState = 'failed';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then — the system should NOT get stuck; it should schedule a retry
      // (the error is caught by attemptFullReconnect, which schedules backoff)
      // Advance past the backoff timer to trigger the next attempt
      mockWebSocketInstance.readyState = 1; // restore OPEN for next attempt
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Should still be in reconnecting (not stuck, attempting retries)
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('reconnecting');

      jest.useRealTimers();
    });

    test('[P1] handleIceFailed + handleIceDisconnected race does not fire duplicate attemptFullReconnect', async () => {
      // Given — a connected temp session (temp uses auto-reconnect on disconnect)
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      let connectionStateHandler: (() => void) | undefined;
      mockPC.addEventListener.mockImplementation((event: string, handler: () => void) => {
        if (event === 'connectionstatechange') connectionStateHandler = handler;
      });

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      const callsAfterConnect = webrtcMock.connectSignalingWithFallback.mock.calls.length;

      // When — ICE goes 'disconnected' (starts 2s silent window)
      mockPC.connectionState = 'disconnected';
      await act(async () => {
        connectionStateHandler?.();
      });

      // Then immediately 'failed' (calls attemptFullReconnect directly)
      mockPC.connectionState = 'failed';
      await act(async () => {
        connectionStateHandler?.();
      });

      const callsAfterFailed = webrtcMock.connectSignalingWithFallback.mock.calls.length;
      // One reconnection attempt should have been made (from handleIceFailed)
      expect(callsAfterFailed).toBe(callsAfterConnect + 1);

      // When — the 2s silent window timer fires
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Then — no additional reconnection attempt (timer was cancelled)
      const callsAfterTimer = webrtcMock.connectSignalingWithFallback.mock.calls.length;
      expect(callsAfterTimer).toBe(callsAfterFailed);

      jest.useRealTimers();
    });

    test('[P0] WS 4002 close after SDP offer sent triggers reconnection (temp connection)', async () => {
      // Given — an initial temp connection where the SDP offer is sent successfully
      // but the WS dies with 4002 before the SDP answer arrives (PC still 'new')
      const payload = buildFakePairingPayload({ connection_type: 'temp' });
      mockPC.connectionState = 'new';

      const mockSetConnectionStatus = jest.fn();
      useAIStoreMock.default.getState.mockReturnValue({
        setConnectionStatus: mockSetConnectionStatus,
        setConnectionPath: jest.fn(), setConnectionType: jest.fn(), clearExecutionEntries: jest.fn(), setActiveSession: jest.fn(),
        setAIState: jest.fn(),
        softReset: jest.fn(),
        hardReset: jest.fn(),
        resetStore: jest.fn(),
      });

      const webrtcMock = jest.requireMock('../services/webrtc') as {
        connectSignalingWithFallback: jest.Mock;
      };

      jest.useFakeTimers();

      const { result } = renderHook(() => useWebRTC());
      await act(async () => {
        await result.current.connect(payload);
      });

      const callsAfterConnect = webrtcMock.connectSignalingWithFallback.mock.calls.length;

      // When — WS closes with 4002 while PC is still 'new' (answer never arrived)
      const wsCloseHandler = wsHandlers['close']?.[0];
      await act(async () => {
        wsCloseHandler?.({ code: 4002, reason: 'superseded' });
      });

      // Then — reconnection is triggered (handleIceDisconnected called)
      expect(mockSetConnectionStatus).toHaveBeenCalledWith('reconnecting');

      // And after the 2s silent window, a full reconnection attempt is made
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      expect(webrtcMock.connectSignalingWithFallback.mock.calls.length).toBeGreaterThan(callsAfterConnect);

      jest.useRealTimers();
    });
  });
});
