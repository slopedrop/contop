import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import SettingsScreen from './settings';

// --- Mocks ---

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ back: mockBack, push: jest.fn(), replace: mockReplace })),
}));

jest.mock('../../components', () => ({
  ScreenContainer: ({ children }: { children: React.ReactNode }) =>
    require('react').createElement(require('react-native').View, { testID: 'screen-container' }, children),
  Text: ({ children, style, testID, ...props }: any) =>
    require('react').createElement(require('react-native').Text, { style, testID, ...props }, children),
}));

const mockLoadAISettings = jest.fn();
const mockSaveAISettings = jest.fn();

jest.mock('../../services/aiSettings', () => ({
  loadAISettings: (...args: any[]) => mockLoadAISettings(...args),
  saveAISettings: (...args: any[]) => mockSaveAISettings(...args),
  DEFAULT_AI_SETTINGS: {
    conversationModel: 'gemini-2.5-flash',
    executionModel: 'gemini-2.5-flash',
    computerUseBackend: 'omniparser',
    customInstructions: null,
    thinkingEnabled: null,
  },
  getActiveSystemPrompt: jest.fn((s: any) => s.customInstructions ? 'default + ' + s.customInstructions : 'default'),
}));

jest.mock('../../constants/providerConfig', () => ({
  LLM_MODELS: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',       description: 'Most powerful · Preview', cost: '$2.00 in · $12.00 out /1M' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',        description: 'Fast · Preview',          cost: '$0.50 in · $3.00 out /1M'  },
    { value: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro',        description: 'Stable · Powerful',       cost: '$1.25 in · $10.00 out /1M' },
    { value: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash',      description: 'Stable · Default',        cost: '$0.30 in · $2.50 out /1M'  },
    { value: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash Lite', description: 'Stable · Fastest',        cost: '$0.10 in · $0.40 out /1M'  },
  ],
  GEMINI_TEXT_MODEL: 'gemini-2.5-flash',
  SYSTEM_INSTRUCTION: 'Default system instruction for tests.',
  COMPUTER_USE_BACKENDS: [
    { value: 'omniparser', label: 'OmniParser + PyAutoGUI', description: 'Local element detection · Privacy-first' },
    { value: 'ui_tars', label: 'UI-TARS', description: 'OpenRouter vision grounding · Fast' },
    { value: 'gemini_computer_use', label: 'Gemini Computer Use', description: 'Native Gemini vision-to-action · Preview' },
  ],
  isThinkingEnabled: jest.fn(() => true),
  canToggleThinking: jest.fn(() => true),
}));

const mockSendDeviceControl = jest.fn();
jest.mock('../../services/deviceControl', () => ({
  sendDeviceControl: (...args: any[]) => mockSendDeviceControl(...args),
}));

const mockGetPairingToken = jest.fn();
const mockClearPairingToken = jest.fn();
const mockClearAllApiKeys = jest.fn();
jest.mock('../../services/secureStorage', () => ({
  getPairingToken: (...args: any[]) => mockGetPairingToken(...args),
  clearPairingToken: (...args: any[]) => mockClearPairingToken(...args),
  clearAllApiKeys: (...args: any[]) => mockClearAllApiKeys(...args),
}));

const mockDisconnect = jest.fn();
jest.mock('../../hooks/useWebRTC', () => ({
  useWebRTC: jest.fn(() => ({ disconnect: mockDisconnect })),
}));

// Mock useAIStore with controllable state
const mockSetIsHostKeepAwake = jest.fn();
const mockHardReset = jest.fn();
const mockSoftReset = jest.fn();
let mockIsHostKeepAwake = false;
let mockConnectionType = 'permanent';

jest.mock('../../stores/useAIStore', () => {
  return {
    __esModule: true,
    default: Object.assign(
      () => ({
        isHostKeepAwake: mockIsHostKeepAwake,
        setIsHostKeepAwake: mockSetIsHostKeepAwake,
      }),
      {
        getState: () => ({
          isHostKeepAwake: mockIsHostKeepAwake,
          setIsHostKeepAwake: mockSetIsHostKeepAwake,
          connectionType: mockConnectionType,
          hardReset: mockHardReset,
          softReset: mockSoftReset,
        }),
        subscribe: () => () => {},
      },
    ),
  };
});

const DEFAULT_SETTINGS = {
  conversationModel: 'gemini-2.5-flash',
  executionModel: 'gemini-2.5-flash',
  computerUseBackend: 'omniparser' as const,
  customInstructions: null,
  thinkingEnabled: null,
};

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    mockLoadAISettings.mockResolvedValue(DEFAULT_SETTINGS);
    mockSaveAISettings.mockResolvedValue(undefined);
    mockIsHostKeepAwake = false;

    // Restore mocks after resetAllMocks clears mock implementations
    const { useRouter } = jest.requireMock('expo-router') as { useRouter: jest.Mock };
    useRouter.mockReturnValue({ back: mockBack, push: jest.fn(), replace: mockReplace });
    const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as { useWebRTC: jest.Mock };
    useWebRTC.mockReturnValue({ disconnect: mockDisconnect });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('[P0] 5.7-SCREEN-001: renders conversation model picker trigger and shows all model options in dropdown', async () => {
    // Use real timers — fake timers prevent async Promise resolution in waitFor
    jest.useRealTimers();

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('conversation-model-trigger')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('conversation-model-trigger'));
    });

    expect(screen.getByTestId('model-picker')).toBeTruthy();
    expect(screen.getByTestId('model-option-gemini-3.1-pro-preview')).toBeTruthy();
    expect(screen.getByTestId('model-option-gemini-3-flash-preview')).toBeTruthy();
    expect(screen.getByTestId('model-option-gemini-2.5-pro')).toBeTruthy();
    expect(screen.getByTestId('model-option-gemini-2.5-flash')).toBeTruthy();
    expect(screen.getByTestId('model-option-gemini-2.5-flash-lite')).toBeTruthy();
  });

  test('[P0] 5.7-SCREEN-002: loads settings from AsyncStorage on mount', async () => {
    const stored = { ...DEFAULT_SETTINGS, conversationModel: 'gemini-2.5-pro', customInstructions: 'Custom prompt' };
    mockLoadAISettings.mockResolvedValue(stored);

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(mockLoadAISettings).toHaveBeenCalledTimes(1);
    });
  });

  test('[P0] 5.7-SCREEN-003: selecting a conversation model closes dropdown, saves immediately, and updates UI', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('conversation-model-trigger')).toBeTruthy();
    });

    // Open dropdown
    await act(async () => {
      fireEvent.press(screen.getByTestId('conversation-model-trigger'));
    });

    // Select a model
    await act(async () => {
      fireEvent.press(screen.getByTestId('model-option-gemini-2.5-pro'));
    });

    expect(mockSaveAISettings).toHaveBeenCalledWith({ conversationModel: 'gemini-2.5-pro' });
  });

  test('[P0] 5.7-SCREEN-004: custom instructions TextInput renders with loaded value', async () => {
    const stored = { ...DEFAULT_SETTINGS, customInstructions: 'Existing custom prompt' };
    mockLoadAISettings.mockResolvedValue(stored);

    render(<SettingsScreen />);

    await waitFor(() => {
      const input = screen.getByTestId('custom-instructions-input');
      expect(input.props.value).toBe('Existing custom prompt');
    });
  });

  test('[P0] 5.7-SCREEN-005: changing custom instructions triggers debounced save', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('custom-instructions-input')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('custom-instructions-input'), 'New prompt text');

    // Not saved immediately (debounced)
    expect(mockSaveAISettings).not.toHaveBeenCalledWith({ customInstructions: 'New prompt text' });

    // After debounce delay
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockSaveAISettings).toHaveBeenCalledWith({ customInstructions: 'New prompt text' });
  });

  test('[P0] 5.7-SCREEN-006: Clear button clears custom instructions and saves null', async () => {
    const stored = { ...DEFAULT_SETTINGS, customInstructions: 'Custom prompt text' };
    mockLoadAISettings.mockResolvedValue(stored);

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('clear-instructions-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('clear-instructions-button'));
    });

    expect(mockSaveAISettings).toHaveBeenCalledWith({ customInstructions: null });

    // Input should now show empty
    const input = screen.getByTestId('custom-instructions-input');
    expect(input.props.value).toBe('');
  });

  test('[P1] 5.7-SCREEN-007: back button navigates back', async () => {
    render(<SettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-back-button'));
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test('[P1] 5.7-SCREEN-008: shows instructions hint when customInstructions is null', async () => {
    mockLoadAISettings.mockResolvedValue({ ...DEFAULT_SETTINGS, customInstructions: null });

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('instructions-hint')).toBeTruthy();
    });
  });

  test('[P1] 5.7-SCREEN-009: active conversation model shows checkmark inside open dropdown', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('conversation-model-trigger')).toBeTruthy();
    });

    // Open dropdown
    await act(async () => {
      fireEvent.press(screen.getByTestId('conversation-model-trigger'));
    });

    // Gemini 2.5 Flash should be active (default) — its option should be visible
    const flashOption = screen.getByTestId('model-option-gemini-2.5-flash');
    expect(flashOption).toBeTruthy();
    expect(flashOption.props.accessibilityState?.checked).toBe(true);
  });
});

describe('Device Controls', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    mockLoadAISettings.mockResolvedValue(DEFAULT_SETTINGS);
    mockSaveAISettings.mockResolvedValue(undefined);
    mockIsHostKeepAwake = false;

    const { useRouter } = jest.requireMock('expo-router') as { useRouter: jest.Mock };
    useRouter.mockReturnValue({ back: mockBack, push: jest.fn(), replace: mockReplace });
    const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as { useWebRTC: jest.Mock };
    useWebRTC.mockReturnValue({ disconnect: mockDisconnect });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('[P0] 5.8-DC-001: keep-awake toggle renders with value=false by default', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      const toggle = screen.getByTestId('keep-awake-toggle');
      expect(toggle).toBeTruthy();
      expect(toggle.props.value).toBe(false);
    });
  });

  test('[P0] 5.8-DC-002: toggling keep-awake ON calls sendDeviceControl and updates store', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('keep-awake-toggle')).toBeTruthy();
    });

    await act(async () => {
      fireEvent(screen.getByTestId('keep-awake-toggle'), 'valueChange', true);
    });

    expect(mockSetIsHostKeepAwake).toHaveBeenCalledWith(true);
    expect(mockSendDeviceControl).toHaveBeenCalledWith('keep_awake_on');
  });

  test('[P0] 5.8-DC-003: toggling keep-awake OFF calls sendDeviceControl and updates store', async () => {
    mockIsHostKeepAwake = true;
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('keep-awake-toggle')).toBeTruthy();
    });

    await act(async () => {
      fireEvent(screen.getByTestId('keep-awake-toggle'), 'valueChange', false);
    });

    expect(mockSetIsHostKeepAwake).toHaveBeenCalledWith(false);
    expect(mockSendDeviceControl).toHaveBeenCalledWith('keep_awake_off');
  });

  test('[P0] 5.8-DC-004: Lock Screen button renders initially', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('lock-screen-button')).toBeTruthy();
    });

    expect(screen.queryByTestId('lock-confirm-card')).toBeNull();
  });

  test('[P0] 5.8-DC-005: pressing Lock Screen shows confirmation card and hides button', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('lock-screen-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-screen-button'));
    });

    expect(screen.getByTestId('lock-confirm-card')).toBeTruthy();
    expect(screen.queryByTestId('lock-screen-button')).toBeNull();
  });

  test('[P0] 5.8-DC-006: pressing Cancel hides card, restores button, does NOT call sendDeviceControl', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('lock-screen-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-screen-button'));
    });

    expect(screen.getByTestId('lock-confirm-card')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-cancel-button'));
    });

    expect(screen.queryByTestId('lock-confirm-card')).toBeNull();
    expect(screen.getByTestId('lock-screen-button')).toBeTruthy();
    expect(mockSendDeviceControl).not.toHaveBeenCalled();
  });

  test('[P0] 5.8-DC-007: pressing Lock Now calls sendDeviceControl and hides card', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('lock-screen-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-screen-button'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('lock-confirm-button'));
    });

    expect(mockSendDeviceControl).toHaveBeenCalledWith('lock_screen');
    expect(screen.queryByTestId('lock-confirm-card')).toBeNull();
  });
});

describe('Forget Connection', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useRealTimers();
    mockLoadAISettings.mockResolvedValue(DEFAULT_SETTINGS);
    mockSaveAISettings.mockResolvedValue(undefined);
    mockIsHostKeepAwake = false;
    mockConnectionType = 'permanent';
    mockClearPairingToken.mockResolvedValue(undefined);
    mockClearAllApiKeys.mockResolvedValue(undefined);

    const { useRouter } = jest.requireMock('expo-router') as { useRouter: jest.Mock };
    useRouter.mockReturnValue({ back: mockBack, push: jest.fn(), replace: mockReplace });
    const { useWebRTC } = jest.requireMock('../../hooks/useWebRTC') as { useWebRTC: jest.Mock };
    useWebRTC.mockReturnValue({ disconnect: mockDisconnect });

    global.fetch = mockFetch;
  });

  afterEach(() => {
    // @ts-expect-error — restore global fetch
    delete global.fetch;
  });

  test('[P0] FORGET-001: forget button opens confirmation modal', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('forget-connection-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-connection-button'));
    });

    expect(screen.getByTestId('forget-confirm-button')).toBeTruthy();
    expect(screen.getByTestId('forget-cancel-button')).toBeTruthy();
  });

  test('[P0] FORGET-002: confirming forget clears tokens, disconnects, and navigates to connect', async () => {
    mockGetPairingToken.mockResolvedValue({
      server_host: '192.168.1.10',
      server_port: 8000,
      tailscale_host: null,
    });
    mockFetch.mockResolvedValue({ ok: true });

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('forget-connection-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-connection-button'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-confirm-button'));
    });

    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockClearPairingToken).toHaveBeenCalled();
    expect(mockClearAllApiKeys).toHaveBeenCalled();
    expect(mockHardReset).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(connect)/connect');
  });

  test('[P0] FORGET-003: local cleanup proceeds when server is unreachable', async () => {
    mockGetPairingToken.mockResolvedValue({
      server_host: '192.168.1.10',
      server_port: 8000,
      tailscale_host: null,
    });
    mockFetch.mockRejectedValue(new Error('Network error'));

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('forget-connection-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-connection-button'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-confirm-button'));
    });

    // Local cleanup must still happen even though server DELETE failed
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockClearPairingToken).toHaveBeenCalled();
    expect(mockClearAllApiKeys).toHaveBeenCalled();
    expect(mockHardReset).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(connect)/connect');
  });

  test('[P0] FORGET-004: local cleanup proceeds when no stored token exists', async () => {
    mockGetPairingToken.mockResolvedValue(null);

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('forget-connection-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-connection-button'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-confirm-button'));
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockClearPairingToken).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(connect)/connect');
  });

  test('[P1] FORGET-005: cancel button dismisses modal without cleanup', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('forget-connection-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-connection-button'));
    });

    expect(screen.getByTestId('forget-confirm-button')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-cancel-button'));
    });

    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(mockClearPairingToken).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('[P1] FORGET-006: temp connection skips confirmation modal and does not clear tokens', async () => {
    mockConnectionType = 'temp';

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('forget-connection-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-connection-button'));
    });

    // Should navigate immediately without showing modal
    expect(screen.queryByTestId('forget-confirm-button')).toBeNull();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockClearPairingToken).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(connect)/connect');
  });

  test('[P1] FORGET-007: navigates even if local cleanup throws', async () => {
    mockGetPairingToken.mockResolvedValue(null);
    mockClearPairingToken.mockRejectedValue(new Error('Storage error'));

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('forget-connection-button')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-connection-button'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('forget-confirm-button'));
    });

    // Must still navigate away even if clearPairingToken threw
    expect(mockReplace).toHaveBeenCalledWith('/(connect)/connect');
  });
});
