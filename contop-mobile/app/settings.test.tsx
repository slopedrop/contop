import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import SettingsScreen from './settings';

// --- Mocks ---

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ back: mockBack, push: jest.fn() })),
}));

jest.mock('../components', () => ({
  ScreenContainer: ({ children }: { children: React.ReactNode }) =>
    require('react').createElement(require('react-native').View, { testID: 'screen-container' }, children),
  Text: ({ children, style, testID, ...props }: any) =>
    require('react').createElement(require('react-native').Text, { style, testID, ...props }, children),
}));

const mockLoadAISettings = jest.fn();
const mockSaveAISettings = jest.fn();

jest.mock('../services/aiSettings', () => ({
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

jest.mock('../components/TailscaleGuide', () => ({
  __esModule: true,
  default: ({ visible }: { visible: boolean; onClose: () => void }) =>
    visible
      ? require('react').createElement(
        require('react-native').View,
        { testID: 'tailscale-guide' },
      )
      : null,
}));

const mockLoadConnectionSettings = jest.fn();
const mockSaveConnectionSettings = jest.fn();

jest.mock('../services/connectionSettings', () => ({
  loadConnectionSettings: (...args: any[]) => mockLoadConnectionSettings(...args),
  saveConnectionSettings: (...args: any[]) => mockSaveConnectionSettings(...args),
  DEFAULT_CONNECTION_SETTINGS: { remoteAccess: 'cloudflare' },
}));

jest.mock('../constants/providerConfig', () => ({
  LLM_MODELS: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Most powerful · Preview', cost: '$2.00 in · $12.00 out /1M' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Fast · Preview', cost: '$0.50 in · $3.00 out /1M' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Stable · Powerful', cost: '$1.25 in · $10.00 out /1M' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Stable · Default', cost: '$0.30 in · $2.50 out /1M' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Stable · Fastest', cost: '$0.10 in · $0.40 out /1M' },
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
    mockLoadConnectionSettings.mockResolvedValue({ remoteAccess: 'cloudflare' });
    mockSaveConnectionSettings.mockResolvedValue(undefined);

    // Restore useRouter after resetAllMocks clears mock implementations
    const { useRouter } = jest.requireMock('expo-router') as { useRouter: jest.Mock };
    useRouter.mockReturnValue({ back: mockBack, push: jest.fn() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('[P0] 5.7-SCREEN-001: renders conversation model picker trigger and shows all model options in dropdown', async () => {
    // Use real timers - fake timers prevent async Promise resolution in waitFor
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

    // Gemini 2.5 Flash should be active (default) - its option should be visible
    const flashOption = screen.getByTestId('model-option-gemini-2.5-flash');
    expect(flashOption).toBeTruthy();
    expect(flashOption.props.accessibilityState?.checked).toBe(true);
  });

  test('renders Remote Access section with trigger', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('remote-access-trigger')).toBeTruthy();
    });
  });

  test('opening remote access picker shows all options', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('remote-access-trigger')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('remote-access-trigger'));
    });

    expect(screen.getByTestId('remote-access-picker')).toBeTruthy();
    expect(screen.getByTestId('remote-access-option-tailscale')).toBeTruthy();
    expect(screen.getByTestId('remote-access-option-cloudflare')).toBeTruthy();
    expect(screen.getByTestId('remote-access-option-none')).toBeTruthy();
  });

  test('selecting remote access option persists via saveConnectionSettings', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('remote-access-trigger')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('remote-access-trigger'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('remote-access-option-tailscale'));
    });

    expect(mockSaveConnectionSettings).toHaveBeenCalledWith({ remoteAccess: 'tailscale' });
  });

  test('selecting Tailscale shows setup guide', async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('remote-access-trigger')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('remote-access-trigger'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('remote-access-option-tailscale'));
    });

    expect(screen.getByTestId('tailscale-guide')).toBeTruthy();
  });
});
