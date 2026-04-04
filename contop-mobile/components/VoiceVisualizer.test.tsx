import React from 'react';
import { render, screen } from '@testing-library/react-native';
import VoiceVisualizer from './VoiceVisualizer';
import type { AIState } from '../types';

// Access the reanimated mock to control useReducedMotion
const reanimatedMock = jest.requireMock('react-native-reanimated') as {
  useReducedMotion: jest.Mock;
};

// Access expo-haptics mock
const hapticsMock = jest.requireMock('expo-haptics') as {
  notificationAsync: jest.Mock;
  NotificationFeedbackType: { Warning: string };
};

function makeMockAudioLevel(value = 0) {
  return { value };
}

describe('VoiceVisualizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reanimatedMock.useReducedMotion.mockReturnValue(false);
  });

  const allStates: AIState[] = ['idle', 'listening', 'processing', 'executing', 'sandboxed', 'disconnected'];

  describe('rendering', () => {
    test.each(allStates)(
      '6.1: renders without crashing for aiState "%s"',
      (state) => {
        const audioLevel = makeMockAudioLevel();
        expect(() => {
          render(<VoiceVisualizer aiState={state} audioLevel={audioLevel} />);
        }).not.toThrow();
      },
    );

    const stateTestIDs: [AIState, string][] = [
      ['idle', 'visualizer-idle'],
      ['listening', 'visualizer-listening'],
      ['processing', 'visualizer-processing'],
      ['executing', 'visualizer-executing'],
      ['sandboxed', 'visualizer-sandboxed'],
      ['disconnected', 'visualizer-disconnected'],
    ];

    test.each(stateTestIDs)(
      '6.1b: renders correct animation testID for aiState "%s"',
      (state, expectedTestID) => {
        const audioLevel = makeMockAudioLevel();
        render(<VoiceVisualizer aiState={state} audioLevel={audioLevel} />);
        expect(screen.getByTestId(expectedTestID)).toBeTruthy();
      },
    );
  });

  describe('accessibility', () => {
    const expectedLabels: Record<AIState, string> = {
      idle: 'AI assistant is ready',
      listening: 'AI assistant is listening to your voice',
      processing: 'AI assistant is processing your request',
      executing: 'AI assistant is executing command',
      sandboxed: 'AI assistant is awaiting your approval for a sandboxed command',
      disconnected: 'AI assistant is disconnected',
    };

    test.each(allStates)(
      '6.2: correct accessibilityLabel for aiState "%s"',
      (state) => {
        const audioLevel = makeMockAudioLevel();
        render(<VoiceVisualizer aiState={state} audioLevel={audioLevel} />);
        const container = screen.getByTestId('voice-visualizer');
        expect(container.props.accessibilityLabel).toBe(expectedLabels[state]);
      },
    );

    test('6.3a: accessibilityState.busy is true for "processing"', () => {
      const audioLevel = makeMockAudioLevel();
      render(<VoiceVisualizer aiState="processing" audioLevel={audioLevel} />);
      const container = screen.getByTestId('voice-visualizer');
      expect(container.props.accessibilityState).toEqual({ busy: true });
    });

    test('6.3b: accessibilityState.busy is true for "executing"', () => {
      const audioLevel = makeMockAudioLevel();
      render(<VoiceVisualizer aiState="executing" audioLevel={audioLevel} />);
      const container = screen.getByTestId('voice-visualizer');
      expect(container.props.accessibilityState).toEqual({ busy: true });
    });

    test('6.3c: accessibilityState.busy is false for "idle"', () => {
      const audioLevel = makeMockAudioLevel();
      render(<VoiceVisualizer aiState="idle" audioLevel={audioLevel} />);
      const container = screen.getByTestId('voice-visualizer');
      expect(container.props.accessibilityState).toEqual({ busy: false });
    });
  });

  describe('Reduce Motion', () => {
    test('6.4: renders text labels instead of animated views when Reduce Motion is enabled', () => {
      reanimatedMock.useReducedMotion.mockReturnValue(true);
      const audioLevel = makeMockAudioLevel();

      const { rerender } = render(<VoiceVisualizer aiState="idle" audioLevel={audioLevel} />);
      expect(screen.getByTestId('visualizer-reduced-motion')).toBeTruthy();
      expect(screen.getByText('Ready')).toBeTruthy();

      rerender(<VoiceVisualizer aiState="listening" audioLevel={audioLevel} />);
      expect(screen.getByText('Listening...')).toBeTruthy();

      rerender(<VoiceVisualizer aiState="processing" audioLevel={audioLevel} />);
      expect(screen.getByText('Processing...')).toBeTruthy();

      rerender(<VoiceVisualizer aiState="executing" audioLevel={audioLevel} />);
      expect(screen.getByText('Executing...')).toBeTruthy();

      rerender(<VoiceVisualizer aiState="sandboxed" audioLevel={audioLevel} />);
      expect(screen.getByText('Sandbox Alert')).toBeTruthy();

      rerender(<VoiceVisualizer aiState="disconnected" audioLevel={audioLevel} />);
      expect(screen.getByText('Disconnected')).toBeTruthy();
    });
  });

  describe('haptics', () => {
    test('6.5: haptic feedback is triggered once when entering "sandboxed" state', () => {
      const audioLevel = makeMockAudioLevel();

      // Start with idle
      const { rerender } = render(<VoiceVisualizer aiState="idle" audioLevel={audioLevel} />);
      expect(hapticsMock.notificationAsync).not.toHaveBeenCalled();

      // Transition to sandboxed
      rerender(<VoiceVisualizer aiState="sandboxed" audioLevel={audioLevel} />);
      expect(hapticsMock.notificationAsync).toHaveBeenCalledTimes(1);
      expect(hapticsMock.notificationAsync).toHaveBeenCalledWith(
        hapticsMock.NotificationFeedbackType.Warning,
      );

      // Re-render with same state should not trigger again
      rerender(<VoiceVisualizer aiState="sandboxed" audioLevel={audioLevel} />);
      expect(hapticsMock.notificationAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('className prop', () => {
    test('6.6: component accepts and renders with className prop', () => {
      const audioLevel = makeMockAudioLevel();
      render(
        <VoiceVisualizer aiState="idle" audioLevel={audioLevel} className="mt-4" />,
      );
      const container = screen.getByTestId('voice-visualizer');
      expect(container).toBeTruthy();
    });
  });
});
