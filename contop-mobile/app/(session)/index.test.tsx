import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import SessionScreen from './index';

// --- Mocks ---

jest.mock('../../stores/useAIStore', () => {
  const mockGetState = jest.fn().mockReturnValue({
    setLayoutMode: jest.fn(),
    setConnectionStatus: jest.fn(),
    setAIState: jest.fn(),
    setConnectionFlow: jest.fn(),
    addExecutionEntry: jest.fn(),
    updateExecutionEntry: jest.fn(),
    clearExecutionEntries: jest.fn(),
    setExecutionEntries: jest.fn(),
    executionEntries: [],
    activeSession: null,
    setActiveSession: jest.fn(),
    setSendConfirmationResponse: jest.fn(),
    connectionStatus: 'disconnected',
    connectionType: 'permanent',
    connectionPath: null,
    setProviderAuth: jest.fn(),
    setMobileAuthPreference: jest.fn(),
    mobileAuthPreference: null,
    softReset: jest.fn(),
  });
  const mockStore = jest.fn();
  mockStore.mockReturnValue({
    connectionStatus: 'disconnected',
    setConnectionStatus: jest.fn(),
    layoutMode: 'split-view',
    orientation: 'portrait',
    executionEntries: [],
    aiState: 'idle',
    suggestedActions: [],
    isManualMode: false,
    connectionPath: null,
    connectionType: 'permanent',
  });
  mockStore.getState = mockGetState;
  mockStore.subscribe = jest.fn(() => jest.fn());
  return {
    __esModule: true,
    default: mockStore,
  };
});

const mockDisconnect = jest.fn();
const mockConnect = jest.fn();

jest.mock('../../hooks/useWebRTC', () => ({
  useWebRTC: jest.fn().mockReturnValue({
    connect: mockConnect,
    disconnect: mockDisconnect,
    sendMessage: jest.fn(),
    setOnDataChannelMessage: jest.fn(),
    remoteStream: null,
  }),
}));

jest.mock('../../hooks/useConversation', () => ({
  useConversation: jest.fn().mockReturnValue({
    connect: jest.fn(() => Promise.resolve()),
    sendTextMessage: jest.fn(),
    sendUserIntent: jest.fn(),
    transcribeAudio: jest.fn(() => Promise.resolve('')),
    handleToolResult: jest.fn(),
    resetHistory: jest.fn(),
    restoreHistory: jest.fn(),
    setSendDataChannelMessage: jest.fn(),
    setOnTextResponse: jest.fn(),
    setOnError: jest.fn(),
    setOnToolCall: jest.fn(),
    close: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: jest.fn().mockReturnValue({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
  }),
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/secureStorage', () => ({
  getPairingToken: jest.fn(() => Promise.resolve(null)),
  getAllApiKeys: jest.fn(() => Promise.resolve({})),
  clearPairingToken: jest.fn(() => Promise.resolve()),
  clearAllApiKeys: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/tempPayloadBridge', () => ({
  consumeTempPayload: jest.fn(() => null),
  setTempPayload: jest.fn(),
}));

jest.mock('../../services/biometrics', () => ({
  checkBiometricAvailability: jest.fn(() => Promise.resolve({ available: false, enrolled: false })),
  authenticateWithBiometrics: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('../../services/sessionStorage', () => ({
  upsertSessionMeta: jest.fn(() => Promise.resolve()),
  saveSessionEntries: jest.fn(() => Promise.resolve()),
  finalizeSession: jest.fn(() => Promise.resolve()),
  loadSessionEntries: jest.fn(() => Promise.resolve([])),
  loadSessionIndex: jest.fn(() => Promise.resolve([])),
  deleteSession: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/aiSettings', () => ({
  loadAISettings: jest.fn(() =>
    Promise.resolve({
      conversationModel: 'gemini-2.5-flash',
      executionModel: 'gemini-2.5-flash',
      computerUseBackend: 'omniparser',
      customInstructions: null,
      thinkingEnabled: null,
    }),
  ),
  saveAISettings: jest.fn(() => Promise.resolve()),
  getActiveSystemPrompt: jest.fn((s: any) => s.customInstructions ? 'default + ' + s.customInstructions : 'default-instruction'),
  DEFAULT_AI_SETTINGS: {
    conversationModel: 'gemini-2.5-flash',
    executionModel: 'gemini-2.5-flash',
    computerUseBackend: 'omniparser',
    customInstructions: null,
    thinkingEnabled: null,
  },
}));

jest.mock('../../services/deviceControl', () => ({
  registerDeviceControlSender: jest.fn(),
}));

jest.mock('../../hooks/useVoiceCapture', () => ({
  useVoiceCapture: jest.fn().mockReturnValue({
    audioLevel: { value: 0 },
    isCapturing: false,
    hasPermission: null,
    startCapture: jest.fn(),
    stopCapture: jest.fn(),
    getAudioBuffer: jest.fn(() => []),
    requestPermission: jest.fn(),
    setOnAudioData: jest.fn(),
  }),
}));

// Mock useOrientation to avoid Dimensions.addEventListener side effects in tests
jest.mock('../../hooks/useOrientation', () => ({
  useOrientation: jest.fn(),
}));

// Mock ViewLayoutManager, ExecutionThread, and ExecutionInputBar for easier child-level testing
jest.mock('../../components', () => {
  const actual = jest.requireActual('../../components');
  const React = require('react');
  const { View, TextInput, Pressable } = require('react-native');
  return {
    ...actual,
    ViewLayoutManager: ({ videoContent, threadContent }: { videoContent: React.ReactNode; threadContent: React.ReactNode }) => (
      <View testID="view-layout-manager-mock">
        <View testID="video-slot">{videoContent}</View>
        <View testID="thread-slot">{threadContent}</View>
      </View>
    ),
    ExecutionThread: ({ variant }: { variant: string }) => (
      <View testID="execution-thread" data-variant={variant} />
    ),
    // Functional mock: preserves testIDs and prop callbacks used by existing session tests
    ExecutionInputBar: ({
      chatInput,
      onChangeText,
      isVoiceActive,
      isTranscribing,
      onSend,
      onMicPress,
      onVoiceCancel,
      onVoiceSend,
      onStopExecution,
    }: {
      chatInput: string;
      onChangeText: (t: string) => void;
      isVoiceActive: boolean;
      isTranscribing: boolean;
      audioLevel: unknown;
      onSend: () => void;
      onMicPress: () => void;
      onVoiceCancel: () => void;
      onVoiceSend: () => void;
      onStopExecution: () => void;
    }) => (
      <View testID="execution-input-bar">
        {isVoiceActive ? (
          <View testID="voice-input-bar">
            <View testID="voice-visualizer" />
            <Pressable testID="voice-cancel-button" onPress={onVoiceCancel} />
            <Pressable testID="voice-send-button" onPress={onVoiceSend} />
          </View>
        ) : (
          <View testID="chat-input-bar">
            <TextInput
              testID="chat-text-input"
              value={chatInput}
              onChangeText={onChangeText}
              editable={!isTranscribing}
            />
            <Pressable testID="mic-button" onPress={onMicPress} />
            <Pressable testID="chat-send-button" onPress={onSend} />
          </View>
        )}
        <Pressable testID="stop-execution-button" onPress={onStopExecution} />
      </View>
    ),
  };
});

const useAIStoreMock = jest.requireMock('../../stores/useAIStore') as {
  default: jest.Mock;
};

const { useRouter: useRouterMock } = jest.requireMock('expo-router') as {
  useRouter: jest.Mock;
};

// CI runners (Ubuntu, 2-core) are slower - give hooks and tests more headroom
jest.setTimeout(15000);

describe('SessionScreen', () => {
  const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    useAIStoreMock.default.mockReturnValue({
      connectionStatus: 'disconnected',
      setConnectionStatus: jest.fn(),
      layoutMode: 'split-view',
      orientation: 'portrait',
      executionEntries: [],
      aiState: 'idle',
      suggestedActions: [],
      isManualMode: false,
      connectionPath: null,
      connectionType: 'permanent',
    });
    useRouterMock.mockReturnValue(mockRouter);
    mockDisconnect.mockReset();
    mockConnect.mockReset();

    const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as {
      useWebRTC: jest.Mock;
    };
    useWebRTC.mockReturnValue({
      connect: mockConnect,
      disconnect: mockDisconnect,
      sendMessage: jest.fn(),
      setOnDataChannelMessage: jest.fn(),
      remoteStream: null,
    });

    const { useVoiceCapture } = jest.requireMock('../../hooks/useVoiceCapture') as {
      useVoiceCapture: jest.Mock;
    };
    useVoiceCapture.mockReturnValue({
      audioLevel: { value: 0 },
      isCapturing: false,
      hasPermission: null,
      startCapture: jest.fn(),
      stopCapture: jest.fn(),
      getAudioBuffer: jest.fn(() => []),
      requestPermission: jest.fn(),
      setOnAudioData: jest.fn(),
    });

    const { useConversation } = jest.requireMock('../../hooks/useConversation') as {
      useConversation: jest.Mock;
    };
    useConversation.mockReturnValue({
      connect: jest.fn(() => Promise.resolve()),
      sendTextMessage: jest.fn(),
      sendUserIntent: jest.fn(),
      transcribeAudio: jest.fn(() => Promise.resolve('')),
      handleToolResult: jest.fn(),
      resetHistory: jest.fn(),
      restoreHistory: jest.fn(),
      setSendDataChannelMessage: jest.fn(),
      setOnTextResponse: jest.fn(),
      setOnError: jest.fn(),
      setOnToolCall: jest.fn(),
      close: jest.fn(),
    });

    // Restore aiSettings mock after resetAllMocks
    const { loadAISettings } = jest.requireMock('../../services/aiSettings') as {
      loadAISettings: jest.Mock;
    };
    loadAISettings.mockResolvedValue({
      conversationModel: 'gemini-2.5-flash',
      executionModel: 'gemini-2.5-flash',
      computerUseBackend: 'omniparser',
      customInstructions: null,
      thinkingEnabled: null,
    });
  });

  describe('connection status display', () => {
    test('[P1] 1.4-UNIT-015a: session screen renders connection status from Zustand store', () => {
      // Given - the Zustand store has connectionStatus 'connected'
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
      });

      // When - the session screen is rendered
      render(<SessionScreen />);

      // Then - the connection status is displayed on screen (multiple elements possible: pill + overlay)
      expect(screen.getAllByTestId('connection-status').length).toBeGreaterThan(0);
    });
  });

  describe('disconnect functionality', () => {
    test('[P2] 1.4-UNIT-015b: disconnect button triggers disconnect and navigates back', async () => {
      // Given - the session screen is rendered with an active connection
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
      });

      render(<SessionScreen />);

      // When - the disconnect button is pressed
      const disconnectButton = screen.getByTestId('disconnect-button');
      fireEvent.press(disconnectButton);

      // Then - disconnect() is called and navigation goes back to pairing
      await waitFor(() => {
        expect(mockDisconnect).toHaveBeenCalled();
      });
      expect(mockRouter.replace).toHaveBeenCalledWith('/(connect)/connect');
    });
  });

  describe('reconnection UI (Story 1.5)', () => {
    test('[P0] 1.5-UNIT-010: silent window - no UI change during first 2s of reconnecting', () => {
      // Given - the connection status is 'reconnecting' (just entered)
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'reconnecting',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      // When - the session screen is rendered (immediately within the 2s silent window)
      render(<SessionScreen />);

      // Then - no reconnecting banner is shown and the previous connection status text persists
      expect(screen.queryByTestId('reconnecting-banner')).toBeNull();
      // The status text should still show "Connected" (not "Reconnecting") during silent window
      expect(screen.queryByText(/reconnecting/i)).toBeNull();
    });

    test('[P0] 1.5-UNIT-011: reconnecting banner shown after silent window expires', async () => {
      // Given - the connection status is 'reconnecting'
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'reconnecting',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      // When - the session screen is rendered and 2s silent window expires (real timers)
      render(<SessionScreen />);

      // Then - the reconnecting banner appears after the 2s silent window
      await waitFor(() => {
        expect(screen.getByTestId('reconnecting-banner')).toBeTruthy();
      }, { timeout: 5000 });
    });

    test('[P1] 1.5-UNIT-012: "Connection Lost" shows offline banner with Retry button (chat-only mode)', () => {
      // Given - the connection status is 'disconnected' after failed reconnection
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'disconnected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle', // Reset to idle for chat-only mode
      });

      // When - the session screen is rendered
      render(<SessionScreen />);

      // Then - an offline banner and Retry button are displayed (chat-only mode)
      expect(screen.getByTestId('disconnected-banner')).toBeTruthy();
      expect(screen.getByTestId('retry-button')).toBeTruthy();
    });

    test('[P1] 1.5-UNIT-013: disconnect during reconnection shows confirmation and navigates to pairing', async () => {
      // Given - the connection status is 'reconnecting' and silent window has expired
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'reconnecting',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // Wait for silent window to expire so reconnection UI is visible (real timers)
      await waitFor(() => {
        expect(screen.getByTestId('cancel-reconnection-button')).toBeTruthy();
      }, { timeout: 5000 });

      // When - the cancel-reconnection button is pressed during active reconnection
      fireEvent.press(screen.getByTestId('cancel-reconnection-button'));

      // Then - disconnect is called and user navigates back to pairing screen
      // handleLeaveSession is synchronous when activeSession is null (default mock),
      // so disconnect() is called immediately during fireEvent.press.
      expect(mockDisconnect).toHaveBeenCalled();
      expect(mockRouter.replace).toHaveBeenCalledWith('/(connect)/connect');
    });
  });

  describe('remote video viewport (Story 2.3)', () => {
    test('[P0] 2.3-UNIT-005: RemoteScreen receives stream from useWebRTC', () => {
      const mockStream = { toURL: () => 'mock-stream-url' };
      const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as {
        useWebRTC: jest.Mock;
      };
      useWebRTC.mockReturnValue({
        connect: mockConnect,
        disconnect: mockDisconnect,
        sendMessage: jest.fn(),
        setOnDataChannelMessage: jest.fn(),
        remoteStream: mockStream,
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
      });

      render(<SessionScreen />);

      // When stream is present, RemoteScreen renders gesture root (not fallback)
      expect(screen.getByTestId('remote-screen-gesture-root')).toBeTruthy();
      expect(screen.queryByTestId('remote-screen-fallback')).toBeNull();
    });

    test('[P1] 5.2-UNIT-070: ViewLayoutManager is rendered as the session layout container', () => {
      render(<SessionScreen />);
      // ViewLayoutManager (mocked as transparent wrapper) wraps video and thread slots
      expect(screen.getByTestId('view-layout-manager-mock')).toBeTruthy();
      expect(screen.getByTestId('video-slot')).toBeTruthy();
      expect(screen.getByTestId('thread-slot')).toBeTruthy();
    });

    test('[P1] 2.3-UNIT-007: orientation unlocked on session mount', () => {
      const ScreenOrientation = jest.requireMock('expo-screen-orientation') as {
        unlockAsync: jest.Mock;
      };

      render(<SessionScreen />);

      expect(ScreenOrientation.unlockAsync).toHaveBeenCalled();
    });

    test('[P1] 2.3-UNIT-008: orientation locked to portrait on unmount', () => {
      const ScreenOrientation = jest.requireMock('expo-screen-orientation') as {
        lockAsync: jest.Mock;
        OrientationLock: { PORTRAIT_UP: number };
      };

      const { unmount } = render(<SessionScreen />);
      unmount();

      expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
    });

    test('[P0] 2.3-UNIT-009: RemoteScreen shows black fallback when no stream', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
      });

      render(<SessionScreen />);

      // Default mock returns remoteStream: null → fallback
      expect(screen.getByTestId('remote-screen-fallback')).toBeTruthy();
    });
  });

  describe('VoiceVisualizer integration (Story 2.4)', () => {
    test('[P0] 2.4-UNIT-001: mic button shown when connected, tapping it shows VoiceVisualizer', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // VoiceVisualizer is NOT shown until mic button is tapped
      expect(screen.queryByTestId('voice-visualizer')).toBeNull();
      expect(screen.getByTestId('mic-button')).toBeTruthy();

      // Tap mic button to enter voice mode
      fireEvent.press(screen.getByTestId('mic-button'));
      expect(screen.getByTestId('voice-visualizer')).toBeTruthy();
    });

    test('[P0] 2.4-UNIT-002: VoiceVisualizer hidden when disconnected', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'disconnected',
        setConnectionStatus: jest.fn(),
        aiState: 'disconnected',
      });

      render(<SessionScreen />);
      expect(screen.queryByTestId('voice-visualizer')).toBeNull();
    });

    test('[P0] 2.4-UNIT-003: chat input bar shown during reconnecting (chat-only mode)', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'reconnecting',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);
      // Input bar is visible during reconnecting - user can chat with conversational model
      expect(screen.getByTestId('chat-input-bar')).toBeTruthy();
      expect(screen.getByTestId('mic-button')).toBeTruthy();
    });

    test('[P1] 2.4-UNIT-004: mic permission denied banner shown when connected', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      const { useVoiceCapture } = jest.requireMock('../../hooks/useVoiceCapture') as {
        useVoiceCapture: jest.Mock;
      };
      useVoiceCapture.mockReturnValue({
        audioLevel: { value: 0 },
        isCapturing: false,
        hasPermission: false,
        startCapture: jest.fn(),
        stopCapture: jest.fn(),
        getAudioBuffer: jest.fn(() => []),
        requestPermission: jest.fn(),
        setOnAudioData: jest.fn(),
      });

      render(<SessionScreen />);
      expect(screen.getByTestId('mic-permission-banner')).toBeTruthy();
    });

    test('[P1] 2.4-UNIT-005: voice capture does NOT auto-start on connect (toggle required)', () => {
      const mockStartCapture = jest.fn();
      const { useVoiceCapture } = jest.requireMock('../../hooks/useVoiceCapture') as {
        useVoiceCapture: jest.Mock;
      };
      useVoiceCapture.mockReturnValue({
        audioLevel: { value: 0 },
        isCapturing: false,
        hasPermission: null,
        startCapture: mockStartCapture,
        stopCapture: jest.fn(),
        getAudioBuffer: jest.fn(() => []),
        requestPermission: jest.fn(),
        setOnAudioData: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);
      // Voice capture should NOT auto-start - user must tap the voice button
      expect(mockStartCapture).not.toHaveBeenCalled();
    });

    test('[P0] 2.5-UNIT-025: mic button enters voice mode, cancel stops capture', () => {
      const mockStartCapture = jest.fn();
      const mockStopCapture = jest.fn();
      const { useVoiceCapture } = jest.requireMock('../../hooks/useVoiceCapture') as {
        useVoiceCapture: jest.Mock;
      };
      useVoiceCapture.mockReturnValue({
        audioLevel: { value: 0 },
        isCapturing: false,
        hasPermission: null,
        startCapture: mockStartCapture,
        stopCapture: mockStopCapture,
        getAudioBuffer: jest.fn(() => []),
        requestPermission: jest.fn(),
        setOnAudioData: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // Initially in text mode - no voice input bar
      expect(screen.getByTestId('chat-input-bar')).toBeTruthy();
      expect(screen.queryByTestId('voice-input-bar')).toBeNull();

      // Tap mic button to enter voice mode
      fireEvent.press(screen.getByTestId('mic-button'));
      expect(mockStartCapture).toHaveBeenCalledTimes(1);

      // Voice mode active - voice input bar shown, text input bar hidden
      expect(screen.getByTestId('voice-input-bar')).toBeTruthy();
      expect(screen.queryByTestId('chat-input-bar')).toBeNull();

      // Tap cancel to exit voice mode
      fireEvent.press(screen.getByTestId('voice-cancel-button'));
      expect(mockStopCapture).toHaveBeenCalledTimes(1);

      // Back to text mode
      expect(screen.getByTestId('chat-input-bar')).toBeTruthy();
      expect(screen.queryByTestId('voice-input-bar')).toBeNull();
    });

    test('[P0] 2.5-UNIT-026: voice send button stops capture and exits voice mode', async () => {
      const mockStartCapture = jest.fn();
      const mockStopCapture = jest.fn();
      const { useVoiceCapture } = jest.requireMock('../../hooks/useVoiceCapture') as {
        useVoiceCapture: jest.Mock;
      };
      useVoiceCapture.mockReturnValue({
        audioLevel: { value: 0 },
        isCapturing: false,
        hasPermission: null,
        startCapture: mockStartCapture,
        stopCapture: mockStopCapture,
        getAudioBuffer: jest.fn(() => []),
        requestPermission: jest.fn(),
        setOnAudioData: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // Enter voice mode
      fireEvent.press(screen.getByTestId('mic-button'));
      expect(mockStartCapture).toHaveBeenCalledTimes(1);

      // Tap send - stops capture and returns to text mode (async handler)
      await act(async () => {
        fireEvent.press(screen.getByTestId('voice-send-button'));
      });
      expect(mockStopCapture).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('chat-input-bar')).toBeTruthy();
    });
  });

  describe('ExecutionThread integration (Story 5.3)', () => {
    test('[P0] 5.3-UNIT-040: ExecutionThread rendered when connected', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);
      expect(screen.getByTestId('execution-thread')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-041: ExecutionThread rendered in chat-only mode when disconnected', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'disconnected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle', // Reset to idle for chat-only mode
      });

      render(<SessionScreen />);
      // Chat-only mode: thread IS rendered so user can continue chatting
      expect(screen.getByTestId('execution-thread')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-042: setOnToolCall is wired on mount', () => {
      const mockSetOnToolCall = jest.fn();
      const { useConversation } = jest.requireMock('../../hooks/useConversation') as {
        useConversation: jest.Mock;
      };
      useConversation.mockReturnValue({
        connect: jest.fn(() => Promise.resolve()),
        sendTextMessage: jest.fn(),
        sendUserIntent: jest.fn(),
        transcribeAudio: jest.fn(() => Promise.resolve('')),
        handleToolResult: jest.fn(),
        resetHistory: jest.fn(),
        setSendDataChannelMessage: jest.fn(),
        setOnTextResponse: jest.fn(),
        setOnError: jest.fn(),
        setOnToolCall: mockSetOnToolCall,
        close: jest.fn(),
      });

      render(<SessionScreen />);
      expect(mockSetOnToolCall).toHaveBeenCalledWith(expect.any(Function));
    });

    test('[P0] 5.3-UNIT-044: HUD pill shown in video-focus mode when connected', () => {
      const mockStream = { toURL: () => 'mock-stream-url' };
      const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as {
        useWebRTC: jest.Mock;
      };
      useWebRTC.mockReturnValue({
        connect: mockConnect,
        disconnect: mockDisconnect,
        sendMessage: jest.fn(),
        setOnDataChannelMessage: jest.fn(),
        remoteStream: mockStream,
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'executing',
        layoutMode: 'video-focus',
        orientation: 'portrait',
        executionEntries: [],
        isManualMode: false,
        suggestedActions: [],
      });

      render(<SessionScreen />);
      expect(screen.getByTestId('hud-pill')).toBeTruthy();
      expect(screen.getByText('Executing')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-045: input bar hidden in overlay mode (video-focus)', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
        layoutMode: 'video-focus',
        orientation: 'portrait',
        executionEntries: [],
        isManualMode: false,
        suggestedActions: [],
      });

      render(<SessionScreen />);
      expect(screen.queryByTestId('chat-input-bar')).toBeNull();
      expect(screen.queryByTestId('mic-button')).toBeNull();
      expect(screen.queryByTestId('chat-send-button')).toBeNull();
    });

    test('[P0] 5.3-UNIT-046: input bar hidden in fullscreen-video mode', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
        layoutMode: 'fullscreen-video',
        orientation: 'landscape',
        executionEntries: [],
        isManualMode: false,
        suggestedActions: [],
      });

      render(<SessionScreen />);
      expect(screen.queryByTestId('chat-input-bar')).toBeNull();
      expect(screen.queryByTestId('mic-button')).toBeNull();
    });

    test('[P0] 5.3-UNIT-047: handleSend adds user_message and thinking execution entries', () => {
      const mockAddExecutionEntry = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: mockAddExecutionEntry,
        updateExecutionEntry: jest.fn(),
        setExecutionEntries: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      const textInput = screen.getByTestId('chat-text-input');
      fireEvent.changeText(textInput, 'Hello AI');
      fireEvent.press(screen.getByTestId('chat-send-button'));

      // Should add user_message entry then thinking entry
      expect(mockAddExecutionEntry).toHaveBeenCalledTimes(2);
      expect(mockAddExecutionEntry).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user_message', content: 'Hello AI' }),
      );
      expect(mockAddExecutionEntry).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'thinking', content: 'Thinking...' }),
      );
    });

    test('[P0] 5.3-UNIT-048: onTextResponse callback adds ai_response entry', () => {
      const mockAddExecutionEntry = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: mockAddExecutionEntry,
        updateExecutionEntry: jest.fn(),
        setExecutionEntries: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      const mockSetOnTextResponse = jest.fn();
      const { useConversation } = jest.requireMock('../../hooks/useConversation') as {
        useConversation: jest.Mock;
      };
      useConversation.mockReturnValue({
        connect: jest.fn(() => Promise.resolve()),
        sendTextMessage: jest.fn(),
        sendUserIntent: jest.fn(),
        transcribeAudio: jest.fn(() => Promise.resolve('')),
        handleToolResult: jest.fn(),
        resetHistory: jest.fn(),
        setSendDataChannelMessage: jest.fn(),
        setOnTextResponse: mockSetOnTextResponse,
        setOnError: jest.fn(),
        setOnToolCall: jest.fn(),
        close: jest.fn(),
      });

      render(<SessionScreen />);

      // Extract the handler passed to setOnTextResponse and invoke it
      const textHandler = mockSetOnTextResponse.mock.calls[0][0];
      textHandler('Hello from AI');

      expect(mockAddExecutionEntry).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ai_response', content: 'Hello from AI' }),
      );
    });

    test('[P0] 5.3-UNIT-049: tool_result data channel message updates tool_call status', () => {
      const mockUpdateExecutionEntry = jest.fn();
      const mockAddExecutionEntry = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: mockAddExecutionEntry,
        updateExecutionEntry: mockUpdateExecutionEntry,
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      let dataChannelHandler: ((msg: any) => void) | null = null;
      const mockSetOnDataChannelMessage = jest.fn((handler: any) => {
        dataChannelHandler = handler;
      });
      const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as {
        useWebRTC: jest.Mock;
      };
      useWebRTC.mockReturnValue({
        connect: mockConnect,
        disconnect: mockDisconnect,
        sendMessage: jest.fn(),
        setOnDataChannelMessage: mockSetOnDataChannelMessage,
        remoteStream: null,
      });

      render(<SessionScreen />);

      // Simulate a tool_result data channel message
      if (dataChannelHandler) {
        dataChannelHandler({
          type: 'tool_result',
          id: 'msg-1',
          payload: {
            gemini_call_id: 'call-1',
            name: 'execute_cli',
            result: { output: 'hello', execution_result: 'success' },
          },
        });
      }

      // Should add a tool_result execution entry
      expect(mockAddExecutionEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_result',
          metadata: expect.objectContaining({ status: 'success' }),
        }),
      );
    });

    test('[P0] 5.3-UNIT-043: clearExecutionEntries called on leave session', async () => {
      const mockClearExecutionEntries = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: mockClearExecutionEntries,
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      const disconnectButton = screen.getByTestId('disconnect-button');
      fireEvent.press(disconnectButton);

      await waitFor(() => {
        expect(mockClearExecutionEntries).toHaveBeenCalled();
      });
    });
  });

  describe('ExecutionInputBar integration (Story 5.4)', () => {
    test('[P0] 5.4-UNIT-050: ExecutionInputBar rendered when isConnected === true', () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);
      expect(screen.getByTestId('execution-input-bar')).toBeTruthy();
    });

    test('[P0] 5.4-UNIT-051: handleStopExecution calls sendMessage with type execution_stop', () => {
      const mockSendMessage = jest.fn();
      const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as {
        useWebRTC: jest.Mock;
      };
      useWebRTC.mockReturnValue({
        connect: mockConnect,
        disconnect: mockDisconnect,
        sendMessage: mockSendMessage,
        setOnDataChannelMessage: jest.fn(),
        remoteStream: null,
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      fireEvent.press(screen.getByTestId('stop-execution-button'));

      expect(mockSendMessage).toHaveBeenCalledWith(
        'execution_stop',
        expect.objectContaining({ reason: 'user_cancelled' }),
      );
    });

    test('[P0] 5.4-UNIT-052: handleMicPress calls setAIState with recording', () => {
      const mockSetAIState = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: mockSetAIState,
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      fireEvent.press(screen.getByTestId('mic-button'));

      expect(mockSetAIState).toHaveBeenCalledWith('recording');
    });

    test('[P0] 5.4-UNIT-053: handleVoiceCancel calls setAIState with idle', () => {
      const mockSetAIState = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: mockSetAIState,
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // Enter voice mode first
      fireEvent.press(screen.getByTestId('mic-button'));

      // Then cancel
      fireEvent.press(screen.getByTestId('voice-cancel-button'));

      expect(mockSetAIState).toHaveBeenCalledWith('idle');
    });
  });

  describe('session persistence (Story 5.6)', () => {
    test('[P0] 5.6-UNIT-016: connectionStatus connected creates new session via setActiveSession', async () => {
      const mockSetActiveSession = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
        connectionStatus: 'connected', // required for M2 post-await guard
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      await waitFor(() => {
        expect(mockSetActiveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.any(String),
            startTime: expect.any(Number),
            entryCount: 0,
            modelUsed: 'gemini-2.5-flash',
          }),
        );
      });
    });

    test('[P0] 5.7-UNIT-030: session modelUsed reflects persisted non-default model (AC#3)', async () => {
      const { loadAISettings } = jest.requireMock('../../services/aiSettings') as {
        loadAISettings: jest.Mock;
      };
      loadAISettings.mockResolvedValue({
        conversationModel: 'gemini-2.5-pro',
        executionModel: 'gemini-2.5-pro',
        computerUseBackend: 'omniparser',
        customInstructions: null,
        thinkingEnabled: null,
      });

      const mockSetActiveSession = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
        connectionStatus: 'connected',
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      await waitFor(() => {
        expect(mockSetActiveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            modelUsed: 'gemini-2.5-pro',
          }),
        );
      });
    });

    test('[P0] 5.6-UNIT-017: existing activeSession preserved on new connection (restore flow)', () => {
      const sessionStorage = jest.requireMock('../../services/sessionStorage') as {
        finalizeSession: jest.Mock;
        upsertSessionMeta: jest.Mock;
      };

      const existingSession = { id: 'old-sess', startTime: 1000, entryCount: 2, modelUsed: 'gemini-2.5-flash' };
      const mockSetActiveSession = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [{ id: 'e1', type: 'user_message', content: 'hi', timestamp: 1 }],
        activeSession: existingSession,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // Existing session should NOT be finalized - it's kept for restore/continue flow
      expect(sessionStorage.finalizeSession).not.toHaveBeenCalled();
      expect(mockSetActiveSession).not.toHaveBeenCalled();
      expect(sessionStorage.upsertSessionMeta).not.toHaveBeenCalled();
    });

    test('[P0] 5.6-UNIT-018: handleLeaveSession finalizes active session with entries', async () => {
      const sessionStorage = jest.requireMock('../../services/sessionStorage') as {
        finalizeSession: jest.Mock;
        saveSessionEntries: jest.Mock;
      };

      const activeSession = { id: 'active-sess', startTime: 2000, entryCount: 1, modelUsed: 'gemini-2.5-flash' };
      const mockSetActiveSession = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [{ id: 'e1', type: 'user_message', content: 'hi', timestamp: 1 }],
        activeSession: activeSession,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      const disconnectButton = screen.getByTestId('disconnect-button');
      fireEvent.press(disconnectButton);

      await waitFor(() => {
        expect(sessionStorage.finalizeSession).toHaveBeenCalledWith('active-sess', expect.any(Number));
      });
    });

    test('handleLeaveSession skips persistence when entries are empty', async () => {
      const sessionStorage = jest.requireMock('../../services/sessionStorage') as {
        finalizeSession: jest.Mock;
        saveSessionEntries: jest.Mock;
        upsertSessionMeta: jest.Mock;
      };

      const activeSession = { id: 'empty-sess', startTime: 2000, entryCount: 0, modelUsed: 'gemini-2.5-flash' };
      const mockSetActiveSession = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: activeSession,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      const disconnectButton = screen.getByTestId('disconnect-button');
      fireEvent.press(disconnectButton);

      await waitFor(() => {
        expect(mockSetActiveSession).toHaveBeenCalledWith(null);
      });

      expect(sessionStorage.saveSessionEntries).not.toHaveBeenCalled();
      expect(sessionStorage.upsertSessionMeta).not.toHaveBeenCalled();
      expect(sessionStorage.finalizeSession).not.toHaveBeenCalled();
    });

    test('[P0] 5.6-UNIT-019: handleLeaveSession calls setActiveSession(null)', async () => {
      const activeSession = { id: 'active-sess', startTime: 2000, entryCount: 1, modelUsed: 'gemini-2.5-flash' };
      const mockSetActiveSession = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: activeSession,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      const disconnectButton = screen.getByTestId('disconnect-button');
      fireEvent.press(disconnectButton);

      await waitFor(() => {
        expect(mockSetActiveSession).toHaveBeenCalledWith(null);
      });
    });

    test('hamburger menu renders in session screen with new-session action', async () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);
      expect(screen.getByTestId('hamburger-menu-button')).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-menu-button'));
      });
      expect(screen.getByTestId('hamburger-new-session')).toBeTruthy();
    });

    test('new-session via hamburger menu finalizes current session and creates fresh session', async () => {
      const sessionStorage = jest.requireMock('../../services/sessionStorage') as {
        finalizeSession: jest.Mock;
        saveSessionEntries: jest.Mock;
        upsertSessionMeta: jest.Mock;
      };

      const activeSession = { id: 'old-sess', startTime: 1000, entryCount: 2, modelUsed: 'gemini-2.5-flash' };
      const mockSetActiveSession = jest.fn();
      const mockClearExecutionEntries = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: mockClearExecutionEntries,
        executionEntries: [{ id: 'e1', type: 'user_message', content: 'hi', timestamp: 1 }],
        activeSession: activeSession,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-menu-button'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-new-session'));
      });

      // Old session finalized
      expect(sessionStorage.finalizeSession).toHaveBeenCalledWith('old-sess', expect.any(Number));
      // Thread cleared
      expect(mockClearExecutionEntries).toHaveBeenCalled();
      // New session created
      expect(mockSetActiveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          startTime: expect.any(Number),
          entryCount: 0,
          modelUsed: 'gemini-2.5-flash',
        }),
      );
    });

    test('new-session via hamburger menu skips persistence when current session has no entries', async () => {
      const sessionStorage = jest.requireMock('../../services/sessionStorage') as {
        finalizeSession: jest.Mock;
        saveSessionEntries: jest.Mock;
        upsertSessionMeta: jest.Mock;
      };

      const activeSession = { id: 'empty-sess', startTime: 1000, entryCount: 0, modelUsed: 'gemini-2.5-flash' };
      const mockSetActiveSession = jest.fn();
      const mockClearExecutionEntries = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: mockClearExecutionEntries,
        executionEntries: [],
        activeSession: activeSession,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-menu-button'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-new-session'));
      });

      // No persistence for empty session
      expect(sessionStorage.saveSessionEntries).not.toHaveBeenCalled();
      expect(sessionStorage.finalizeSession).not.toHaveBeenCalled();
      // But thread is cleared and new session is created
      expect(mockClearExecutionEntries).toHaveBeenCalled();
      expect(mockSetActiveSession).toHaveBeenCalledWith(
        expect.objectContaining({ entryCount: 0 }),
      );
    });

    test('hamburger history button navigates to history screen', async () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-menu-button'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-history'));
      });

      expect(mockRouter.push).toHaveBeenCalledWith('./history');
    });

    test('hamburger settings button navigates to settings screen', async () => {
      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-menu-button'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-settings'));
      });

      expect(mockRouter.push).toHaveBeenCalledWith('./settings');
    });

    test('hamburger disconnect button triggers handleLeaveSession', async () => {
      const mockSetActiveSession = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: jest.fn(),
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: mockSetActiveSession,
        setSendConfirmationResponse: jest.fn(),
      });
      (useAIStoreMock.default as jest.Mock & { subscribe: jest.Mock }).subscribe = jest.fn(() => jest.fn());

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-menu-button'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('hamburger-disconnect'));
      });

      expect(mockRouter.replace).toHaveBeenCalledWith('/(connect)/connect');
    });
  });

  describe('AuroraVoice integration (Story 5.5)', () => {
    test('[P0] 5.5-UNIT-034: handleVoiceSend with empty audio buffer exits voice mode immediately', async () => {
      const mockStopCapture = jest.fn();
      const mockGetAudioBuffer = jest.fn(() => []); // empty buffer
      const { useVoiceCapture } = jest.requireMock('../../hooks/useVoiceCapture') as {
        useVoiceCapture: jest.Mock;
      };
      useVoiceCapture.mockReturnValue({
        audioLevel: { value: 0 },
        isCapturing: false,
        hasPermission: null,
        startCapture: jest.fn(),
        stopCapture: mockStopCapture,
        getAudioBuffer: mockGetAudioBuffer,
        requestPermission: jest.fn(),
        setOnAudioData: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // Enter voice mode
      fireEvent.press(screen.getByTestId('mic-button'));
      expect(screen.getByTestId('voice-input-bar')).toBeTruthy();

      // Press send with empty buffer - should exit voice mode immediately
      await act(async () => {
        fireEvent.press(screen.getByTestId('voice-send-button'));
      });

      expect(mockStopCapture).toHaveBeenCalled();
      expect(screen.getByTestId('chat-input-bar')).toBeTruthy();
    });

    test('[P0] 5.8-DC-008: device_control_result success adds tool_result entry to execution thread', () => {
      const mockAddExecutionEntry = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: mockAddExecutionEntry,
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      let dataChannelHandler: ((msg: any) => void) | null = null;
      const mockSetOnDataChannelMessage = jest.fn((handler: any) => {
        dataChannelHandler = handler;
      });
      const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as { useWebRTC: jest.Mock };
      useWebRTC.mockReturnValue({
        connect: mockConnect,
        disconnect: mockDisconnect,
        sendMessage: jest.fn(),
        setOnDataChannelMessage: mockSetOnDataChannelMessage,
        remoteStream: null,
      });

      render(<SessionScreen />);

      if (dataChannelHandler) {
        dataChannelHandler({
          type: 'device_control_result',
          id: 'msg-2',
          payload: { action: 'lock_screen', status: 'success', message: 'Screen locked.', voice_message: 'Screen locked.' },
        });
      }

      expect(mockAddExecutionEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_result',
          content: 'Screen locked.',
          metadata: expect.objectContaining({ name: 'device_control', status: 'success' }),
        }),
      );
    });

    test('[P0] 5.8-DC-009: device_control_result error adds tool_result entry with error status', () => {
      const mockAddExecutionEntry = jest.fn();
      (useAIStoreMock.default as jest.Mock & { getState: jest.Mock }).getState = jest.fn().mockReturnValue({
        setLayoutMode: jest.fn(),
        setConnectionStatus: jest.fn(),
        setAIState: jest.fn(),
        setConnectionFlow: jest.fn(),
        addExecutionEntry: mockAddExecutionEntry,
        updateExecutionEntry: jest.fn(),
        clearExecutionEntries: jest.fn(),
        executionEntries: [],
        activeSession: null,
        setActiveSession: jest.fn(),
        setSendConfirmationResponse: jest.fn(),
      });

      let dataChannelHandler: ((msg: any) => void) | null = null;
      const mockSetOnDataChannelMessage = jest.fn((handler: any) => {
        dataChannelHandler = handler;
      });
      const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as { useWebRTC: jest.Mock };
      useWebRTC.mockReturnValue({
        connect: mockConnect,
        disconnect: mockDisconnect,
        sendMessage: jest.fn(),
        setOnDataChannelMessage: mockSetOnDataChannelMessage,
        remoteStream: null,
      });

      render(<SessionScreen />);

      if (dataChannelHandler) {
        dataChannelHandler({
          type: 'device_control_result',
          id: 'msg-3',
          payload: { action: 'keep_awake_on', status: 'error', message: 'Keep-awake process exited immediately.', voice_message: 'Keep awake failed to start.' },
        });
      }

      expect(mockAddExecutionEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_result',
          content: 'Keep-awake process exited immediately.',
          metadata: expect.objectContaining({ name: 'device_control', status: 'error' }),
        }),
      );
    });

    test('[P0] 5.5-UNIT-035: handleVoiceSend exits voice mode immediately and populates chatInput', async () => {
      let resolveTranscription: (value: string) => void;
      const transcriptionPromise = new Promise<string>((resolve) => {
        resolveTranscription = resolve;
      });

      const mockStopCapture = jest.fn();
      const mockGetAudioBuffer = jest.fn(() => [new Uint8Array([1, 2, 3])]); // non-empty
      const { useVoiceCapture } = jest.requireMock('../../hooks/useVoiceCapture') as {
        useVoiceCapture: jest.Mock;
      };
      useVoiceCapture.mockReturnValue({
        audioLevel: { value: 0 },
        isCapturing: false,
        hasPermission: null,
        startCapture: jest.fn(),
        stopCapture: mockStopCapture,
        getAudioBuffer: mockGetAudioBuffer,
        requestPermission: jest.fn(),
        setOnAudioData: jest.fn(),
      });

      const mockTranscribeAudio = jest.fn(() => transcriptionPromise);
      const { useConversation } = jest.requireMock('../../hooks/useConversation') as {
        useConversation: jest.Mock;
      };
      useConversation.mockReturnValue({
        connect: jest.fn(() => Promise.resolve()),
        sendTextMessage: jest.fn(),
        sendUserIntent: jest.fn(),
        transcribeAudio: mockTranscribeAudio,
        handleToolResult: jest.fn(),
        resetHistory: jest.fn(),
        setSendDataChannelMessage: jest.fn(),
        setOnTextResponse: jest.fn(),
        setOnError: jest.fn(),
        setOnToolCall: jest.fn(),
        close: jest.fn(),
      });

      useAIStoreMock.default.mockReturnValue({
        connectionStatus: 'connected',
        setConnectionStatus: jest.fn(),
        aiState: 'idle',
      });

      render(<SessionScreen />);

      // Enter voice mode
      fireEvent.press(screen.getByTestId('mic-button'));
      expect(screen.getByTestId('voice-input-bar')).toBeTruthy();

      // Press send - starts transcription, voice mode stays active
      let sendPromise: Promise<void>;
      await act(async () => {
        sendPromise = (async () => {
          fireEvent.press(screen.getByTestId('voice-send-button'));
        })();
      });

      // Voice mode exits immediately (before transcription resolves)
      expect(screen.getByTestId('chat-input-bar')).toBeTruthy();
      expect(screen.queryByTestId('voice-input-bar')).toBeNull();
      expect(mockTranscribeAudio).toHaveBeenCalled();

      // Resolve transcription
      await act(async () => {
        resolveTranscription!('hello world');
      });

      // chatInput populated with transcription
      expect(screen.getByTestId('chat-text-input').props.value).toBe('hello world');
    });
  });
});
