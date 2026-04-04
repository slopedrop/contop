import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import ExecutionInputBar from './ExecutionInputBar';

// --- Mocks ---

jest.mock('../stores/useAIStore', () => ({
  __esModule: true,
  default: jest.fn(() => ({ aiState: 'idle' })),
}));

jest.mock('../constants/modelRegistry', () => ({
  findModel: (value: string) => {
    const map: Record<string, { label: string }> = {
      'gemini-2.5-flash': { label: 'Gemini 2.5 Flash' },
      'openai/gpt-5.4': { label: 'GPT-5.4' },
    };
    return map[value] ?? undefined;
  },
  getProviderForModel: (value: string) => {
    if (value.startsWith('openai/')) return 'openai';
    return 'gemini';
  },
}));

// Avoid require('react-native') inside factory — NativeWind's Babel transform
// would inject _ReactNativeCSSInterop which is invalid in hoisted mock factories.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// react-native-safe-area-context is globally mocked in jest.setup.js
// AuroraVoice is NOT mocked — real implementation renders testID="aurora-voice"
// with Reanimated/expo-haptics globally mocked in jest.setup.js

const useAIStoreMock = jest.requireMock('../stores/useAIStore') as {
  default: jest.Mock;
};

// --- Default props helpers ---

function makeAudioLevel() {
  return { value: 0 };
}

function defaultProps(overrides: Partial<React.ComponentProps<typeof ExecutionInputBar>> = {}) {
  return {
    chatInput: '',
    onChangeText: jest.fn(),
    isVoiceActive: false,
    isTranscribing: false,
    audioLevel: makeAudioLevel() as any,
    onSend: jest.fn(),
    onMicPress: jest.fn(),
    onVoiceCancel: jest.fn(),
    onVoiceSend: jest.fn(),
    onStopExecution: jest.fn(),
    ...overrides,
  };
}

// --- Tests ---

describe('ExecutionInputBar', () => {
  const defaultStoreValue = () => ({
    aiState: 'idle',
    providerAuth: null as Record<string, { available: boolean }> | null,
    mobileAuthPreference: {} as Record<string, string>,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    useAIStoreMock.default.mockReturnValue(defaultStoreValue());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('text mode (isVoiceActive=false)', () => {
    test('[P0] 5.4-UNIT-001: text mode — chat-text-input, mic-button, chat-send-button all rendered', () => {
      render(<ExecutionInputBar {...defaultProps()} />);

      expect(screen.getByTestId('chat-text-input')).toBeTruthy();
      expect(screen.getByTestId('mic-button')).toBeTruthy();
      expect(screen.getByTestId('chat-send-button')).toBeTruthy();
    });

    test('[P0] 5.4-UNIT-002: stop button NOT rendered when aiState=idle', () => {
      useAIStoreMock.default.mockReturnValue(defaultStoreValue());

      render(<ExecutionInputBar {...defaultProps()} />);

      expect(screen.queryByTestId('stop-execution-button')).toBeNull();
    });

    test('[P0] 5.4-UNIT-003: stop button rendered when aiState=processing', () => {
      useAIStoreMock.default.mockReturnValue({ ...defaultStoreValue(), aiState: 'processing' });

      render(<ExecutionInputBar {...defaultProps()} />);

      expect(screen.getByTestId('stop-execution-button')).toBeTruthy();
    });

    test('[P0] 5.4-UNIT-004: stop button rendered when aiState=executing', () => {
      useAIStoreMock.default.mockReturnValue({ ...defaultStoreValue(), aiState: 'executing' });

      render(<ExecutionInputBar {...defaultProps()} />);

      expect(screen.getByTestId('stop-execution-button')).toBeTruthy();
    });

    test('[P0] 5.4-UNIT-005: stop button press calls onStopExecution', () => {
      useAIStoreMock.default.mockReturnValue({ ...defaultStoreValue(), aiState: 'processing' });
      const onStopExecution = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ onStopExecution })} />);

      fireEvent.press(screen.getByTestId('stop-execution-button'));
      expect(onStopExecution).toHaveBeenCalledTimes(1);
    });

    test('[P0] 5.4-UNIT-006: send button does not call onSend when chatInput is empty', () => {
      const onSend = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ chatInput: '', onSend })} />);

      // When disabled, onPress is undefined — pressing it should not trigger onSend
      fireEvent.press(screen.getByTestId('chat-send-button'));
      expect(onSend).not.toHaveBeenCalled();
    });

    test('[P0] 5.4-UNIT-007: send button calls onSend when chatInput has non-empty text', () => {
      const onSend = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ chatInput: 'hello', onSend })} />);

      fireEvent.press(screen.getByTestId('chat-send-button'));
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    test('[P0] 5.4-UNIT-008: send button calls onSend when not disabled', () => {
      const onSend = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ chatInput: 'test', onSend })} />);

      fireEvent.press(screen.getByTestId('chat-send-button'));
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    test('[P0] 5.4-UNIT-009: mic button press calls onMicPress', () => {
      const onMicPress = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ onMicPress })} />);

      fireEvent.press(screen.getByTestId('mic-button'));
      expect(onMicPress).toHaveBeenCalledTimes(1);
    });

    test('[P0] 5.4-UNIT-010: text mode shown by default — chat-text-input rendered, aurora-voice absent', () => {
      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: false })} />);

      expect(screen.getByTestId('chat-text-input')).toBeTruthy();
      expect(screen.queryByTestId('aurora-voice')).toBeNull();
    });

    test('[P1] 5.4-UNIT-019: isTranscribing=true makes TextInput non-editable', () => {
      render(<ExecutionInputBar {...defaultProps({ isTranscribing: true })} />);

      const input = screen.getByTestId('chat-text-input');
      expect(input.props.editable).toBe(false);
    });

    test('[P1] 5.4-UNIT-020: send button disabled during transcription even with non-empty input', () => {
      const onSend = jest.fn();

      render(
        <ExecutionInputBar
          {...defaultProps({ chatInput: 'hello', isTranscribing: true, onSend })}
        />,
      );

      fireEvent.press(screen.getByTestId('chat-send-button'));
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe('voice mode (isVoiceActive=true)', () => {
    test('[P0] 5.4-UNIT-024: voice mode shows AuroraVoice when isVoiceActive=true', () => {
      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: true })} />);

      expect(screen.getByTestId('aurora-voice')).toBeTruthy();
    });

    test('[P0] 5.4-UNIT-025: voice mode shows cancel and send buttons via AuroraVoice', () => {
      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: true })} />);

      expect(screen.getByTestId('aurora-cancel-button')).toBeTruthy();
      expect(screen.getByTestId('aurora-send-button')).toBeTruthy();
    });

    test('[P0] 5.4-UNIT-026: cancel button press calls onVoiceCancel via AuroraVoice', () => {
      const onVoiceCancel = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: true, onVoiceCancel })} />);

      fireEvent.press(screen.getByTestId('aurora-cancel-button'));
      expect(onVoiceCancel).toHaveBeenCalledTimes(1);
    });

    test('[P0] 5.4-UNIT-027: voice send button press calls onVoiceSend via AuroraVoice', () => {
      const onVoiceSend = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: true, onVoiceSend })} />);

      fireEvent.press(screen.getByTestId('aurora-send-button'));
      expect(onVoiceSend).toHaveBeenCalledTimes(1);
    });

    test('[P0] 5.4-UNIT-028: recording-duration text shows "0:00" initially via AuroraVoice', () => {
      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: true })} />);

      expect(screen.getByTestId('aurora-duration')).toBeTruthy();
      expect(screen.getByTestId('aurora-duration').props.children).toBe('0:00');
    });

    test('[P1] 5.4-UNIT-029: recording duration increments after 1 second', () => {
      jest.useFakeTimers();

      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: true })} />);

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(screen.getByTestId('aurora-duration').props.children).toBe('0:01');
    });

    test('[P1] 5.4-UNIT-030: recording duration resets to 0:00 when voice becomes inactive then active again', () => {
      jest.useFakeTimers();

      const { rerender } = render(
        <ExecutionInputBar {...defaultProps({ isVoiceActive: true })} />,
      );

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      // Switch back to text mode — timer clears and resets
      rerender(<ExecutionInputBar {...defaultProps({ isVoiceActive: false })} />);

      // Re-enter voice mode — duration should reset to 0:00
      rerender(<ExecutionInputBar {...defaultProps({ isVoiceActive: true })} />);

      expect(screen.getByTestId('aurora-duration').props.children).toBe('0:00');
    });

    test('[P0] 5.4-UNIT-031: voice mode no longer shows voice-visualizer', () => {
      render(<ExecutionInputBar {...defaultProps({ isVoiceActive: true })} />);

      expect(screen.queryByTestId('voice-visualizer')).toBeNull();
    });
  });

  describe('model indicator', () => {
    test('model-indicator renders with resolved label when conversationModel is provided', () => {
      render(<ExecutionInputBar {...defaultProps({ conversationModel: 'gemini-2.5-flash' })} />);
      expect(screen.getByTestId('model-indicator')).toBeTruthy();
      expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy();
      expect(screen.getByText('Chat')).toBeTruthy();
    });

    test('model-indicator shows both models when executionModel is provided', () => {
      render(<ExecutionInputBar {...defaultProps({ conversationModel: 'gemini-2.5-flash', executionModel: 'openai/gpt-5.4' })} />);
      expect(screen.getByTestId('model-indicator')).toBeTruthy();
      expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy();
      expect(screen.getByText('GPT-5.4')).toBeTruthy();
      expect(screen.getByText('Chat')).toBeTruthy();
      expect(screen.getByText('Agent')).toBeTruthy();
    });

    test('model-indicator shows SUB badge when subscription is active', () => {
      useAIStoreMock.default.mockReturnValue({
        ...defaultStoreValue(),
        providerAuth: { gemini: { available: true }, openai: { available: true } },
        mobileAuthPreference: { gemini: 'cli_proxy', openai: 'cli_proxy' },
      });
      render(<ExecutionInputBar {...defaultProps({ conversationModel: 'gemini-2.5-flash', executionModel: 'openai/gpt-5.4' })} />);
      expect(screen.getAllByText('SUB')).toHaveLength(2);
    });

    test('model-indicator hides SUB badge when subscription is inactive', () => {
      render(<ExecutionInputBar {...defaultProps({ conversationModel: 'gemini-2.5-flash', executionModel: 'openai/gpt-5.4' })} />);
      expect(screen.queryByText('SUB')).toBeNull();
    });

    test('model-indicator is not rendered when conversationModel is omitted', () => {
      render(<ExecutionInputBar {...defaultProps()} />);
      expect(screen.queryByTestId('model-indicator')).toBeNull();
    });

    test('model-indicator is hidden in voice mode', () => {
      render(<ExecutionInputBar {...defaultProps({ conversationModel: 'gemini-2.5-flash', isVoiceActive: true })} />);
      expect(screen.queryByTestId('model-indicator')).toBeNull();
    });

    test('pressing model-indicator calls onModelPress', () => {
      const onModelPress = jest.fn();
      render(<ExecutionInputBar {...defaultProps({ conversationModel: 'gemini-2.5-flash', onModelPress })} />);
      fireEvent.press(screen.getByTestId('model-indicator'));
      expect(onModelPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('undo button', () => {
    test('[P0] 3.7-UNIT-001: undo button renders when hasHistory=true and aiState=idle', () => {
      useAIStoreMock.default.mockReturnValue(defaultStoreValue());
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: true, onUndo })} />);

      expect(screen.getByTestId('undo-button')).toBeTruthy();
    });

    test('[P0] 3.7-UNIT-002: undo button disabled when hasHistory=false', () => {
      useAIStoreMock.default.mockReturnValue(defaultStoreValue());
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: false, onUndo })} />);

      const undoButton = screen.getByTestId('undo-button');
      expect(undoButton.props.accessibilityState?.disabled).toBe(true);
    });

    test('[P0] 3.7-UNIT-003: undo button hidden when aiState=processing (even with history)', () => {
      useAIStoreMock.default.mockReturnValue({ ...defaultStoreValue(), aiState: 'processing' });
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: true, onUndo })} />);

      expect(screen.queryByTestId('undo-button')).toBeNull();
    });

    test('[P0] 3.7-UNIT-004: undo button press calls onUndo callback', () => {
      useAIStoreMock.default.mockReturnValue(defaultStoreValue());
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: true, onUndo })} />);

      fireEvent.press(screen.getByTestId('undo-button'));
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    test('[P0] 3.7-UNIT-005: undo button accessibility label is "Undo last action"', () => {
      useAIStoreMock.default.mockReturnValue(defaultStoreValue());
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: true, onUndo })} />);

      const undoButton = screen.getByTestId('undo-button');
      expect(undoButton.props.accessibilityLabel).toBe('Undo last action');
    });

    test('[P0] 3.7-UNIT-006: disabled undo button does NOT call onUndo', () => {
      useAIStoreMock.default.mockReturnValue(defaultStoreValue());
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: false, onUndo })} />);

      fireEvent.press(screen.getByTestId('undo-button'));
      expect(onUndo).not.toHaveBeenCalled();
    });

    test('[P1] 3.7-UNIT-007: undo button hidden when onUndo is not provided', () => {
      useAIStoreMock.default.mockReturnValue(defaultStoreValue());

      render(<ExecutionInputBar {...defaultProps({ hasHistory: true })} />);

      expect(screen.queryByTestId('undo-button')).toBeNull();
    });

    test('[P1] 3.7-UNIT-008: undo button hidden when aiState=executing', () => {
      useAIStoreMock.default.mockReturnValue({ ...defaultStoreValue(), aiState: 'executing' });
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: true, onUndo })} />);

      expect(screen.queryByTestId('undo-button')).toBeNull();
    });

    test('[P1] 3.7-UNIT-009: undo button hidden when aiState=recording', () => {
      useAIStoreMock.default.mockReturnValue({ ...defaultStoreValue(), aiState: 'recording' });
      const onUndo = jest.fn();

      render(<ExecutionInputBar {...defaultProps({ hasHistory: true, onUndo })} />);

      expect(screen.queryByTestId('undo-button')).toBeNull();
    });
  });

  describe('input-bar container', () => {
    test('[P1] 5.4-UNIT-018: input-bar testID is present', () => {
      render(<ExecutionInputBar {...defaultProps()} />);
      expect(screen.getByTestId('input-bar')).toBeTruthy();
    });
  });
});
