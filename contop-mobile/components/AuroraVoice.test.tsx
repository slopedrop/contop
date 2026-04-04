import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AuroraVoice from './AuroraVoice';

// react-native-reanimated is globally mocked in jest.setup.js

function makeProps(overrides: Partial<React.ComponentProps<typeof AuroraVoice>> = {}) {
  return {
    audioLevel: { value: 0 } as any,
    recordingSeconds: 5,
    onCancel: jest.fn(),
    onSend: jest.fn(),
    ...overrides,
  };
}

describe('AuroraVoice', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('[P0] 5.5-UNIT-001: renders aurora-voice testID', () => {
    render(<AuroraVoice {...makeProps()} />);
    expect(screen.getByTestId('aurora-voice')).toBeTruthy();
  });

  test('[P0] 5.5-UNIT-002: cancel, send, and duration all present', () => {
    render(<AuroraVoice {...makeProps()} />);
    expect(screen.getByTestId('aurora-cancel-button')).toBeTruthy();
    expect(screen.getByTestId('aurora-send-button')).toBeTruthy();
    expect(screen.getByTestId('aurora-duration')).toBeTruthy();
  });

  test('[P0] 5.5-UNIT-003: duration shows "0:05" when recordingSeconds=5', () => {
    render(<AuroraVoice {...makeProps({ recordingSeconds: 5 })} />);
    expect(screen.getByTestId('aurora-duration').props.children).toBe('0:05');
  });

  test('[P0] 5.5-UNIT-004: waveform container rendered', () => {
    render(<AuroraVoice {...makeProps()} />);
    expect(screen.getByTestId('aurora-waveform')).toBeTruthy();
  });

  test('[P0] 5.5-UNIT-005: recordingSeconds=65 shows "1:05"', () => {
    render(<AuroraVoice {...makeProps({ recordingSeconds: 65 })} />);
    expect(screen.getByTestId('aurora-duration').props.children).toBe('1:05');
  });

  test('[P1] 5.5-UNIT-006: accessibilityLabel is "Voice recording active"', () => {
    render(<AuroraVoice {...makeProps()} />);
    expect(screen.getByTestId('aurora-voice').props.accessibilityLabel).toBe(
      'Voice recording active',
    );
  });

  test('[P1] 5.5-UNIT-007: duration element has accessibilityRole="timer"', () => {
    render(<AuroraVoice {...makeProps()} />);
    expect(screen.getByTestId('aurora-duration').props.accessibilityRole).toBe('timer');
  });

  test('[P0] 5.5-UNIT-008: cancel button press calls onCancel', () => {
    const onCancel = jest.fn();
    render(<AuroraVoice {...makeProps({ onCancel })} />);
    fireEvent.press(screen.getByTestId('aurora-cancel-button'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('[P0] 5.5-UNIT-009: send button press calls onSend', () => {
    const onSend = jest.fn();
    render(<AuroraVoice {...makeProps({ onSend })} />);
    fireEvent.press(screen.getByTestId('aurora-send-button'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
