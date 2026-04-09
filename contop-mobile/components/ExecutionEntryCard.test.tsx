import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import ExecutionEntryCard from './ExecutionEntryCard';
import type { ExecutionEntry } from '../types';

const baseEntry = (overrides: Partial<ExecutionEntry> = {}): ExecutionEntry => ({
  id: 'e1',
  type: 'user_message',
  content: 'Hello world',
  timestamp: Date.now(),
  ...overrides,
});

describe('ExecutionEntryCard', () => {
  describe('user_message card', () => {
    test('[P0] 5.3-UNIT-010: renders user message with You label and dark bubble', () => {
      render(<ExecutionEntryCard entry={baseEntry()} isLastThinking={false} />);
      const card = screen.getByTestId('entry-user-message');
      expect(card).toBeTruthy();
      expect(screen.getByText('Hello world')).toBeTruthy();
    });

    test('[P1] 5.3-UNIT-011: shows You label and HH:MM timestamp', () => {
      const fixedTimestamp = new Date(2024, 0, 15, 14, 28).getTime();
      render(<ExecutionEntryCard entry={baseEntry({ timestamp: fixedTimestamp })} isLastThinking={false} />);
      expect(screen.getByText('You')).toBeTruthy();
      expect(screen.getByText('14:28')).toBeTruthy();
    });
  });

  describe('ai_response card', () => {
    test('[P0] 5.3-UNIT-012: renders CONTOP label and response text', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'ai_response', content: 'AI says hello' })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('entry-ai-response')).toBeTruthy();
      expect(screen.getByTestId('contop-label')).toBeTruthy();
      expect(screen.getByText('CONTOP')).toBeTruthy();
      expect(screen.getByText('AI says hello')).toBeTruthy();
    });
  });

  describe('tool_call card', () => {
    test('[P0] 5.3-UNIT-013: renders pending status with spinner', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_call', content: 'run_cmd({})', metadata: { status: 'pending' } })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('entry-tool-call')).toBeTruthy();
      expect(screen.getByTestId('tool-status-pending')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-014: renders success status with green check', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_call', content: 'run_cmd({})', metadata: { status: 'success' } })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('tool-status-success')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-015: renders error status with red X', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_call', content: 'run_cmd({})', metadata: { status: 'error' } })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('tool-status-error')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-016: renders sandboxed status with amber warning', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_call', content: 'rm -rf /', metadata: { status: 'sandboxed' } })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('tool-status-sandboxed')).toBeTruthy();
    });

    test('[P1] 5.3-UNIT-017: shows terminal icon and command content', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_call', content: 'execute_cli({"cmd":"ls"})' })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText('execute_cli({"cmd":"ls"})')).toBeTruthy();
      expect(screen.getByText('terminal-outline')).toBeTruthy();
    });

    test('[P1] 5.3-UNIT-017b: tool_call card shows CONTOP label', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_call', content: 'run_cmd({})' })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText('CONTOP')).toBeTruthy();
    });
  });

  describe('tool_result card', () => {
    test('[P0] 5.3-UNIT-018: truncates content over 200 chars with "Show more"', () => {
      const longContent = 'a'.repeat(250);
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_result', content: longContent })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('entry-tool-result')).toBeTruthy();
      expect(screen.getByTestId('show-more-button')).toBeTruthy();
      expect(screen.getByText('Show more')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-019: expands on "Show more" press', () => {
      const longContent = 'a'.repeat(250);
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_result', content: longContent })}
          isLastThinking={false}
        />,
      );

      fireEvent.press(screen.getByTestId('show-more-button'));
      expect(screen.getByText(longContent)).toBeTruthy();
      expect(screen.getByText('Show less')).toBeTruthy();
    });

    test('[P1] 5.3-UNIT-020: short content shows without truncation', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'tool_result', content: 'OK' })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText('OK')).toBeTruthy();
      expect(screen.queryByTestId('show-more-button')).toBeNull();
    });
  });

  describe('thinking card', () => {
    test('[P0] 5.3-UNIT-021: static "Thought" text when not isLastThinking', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'thinking', content: 'Thinking...' })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('entry-thinking-static')).toBeTruthy();
      expect(screen.getByText('Thought')).toBeTruthy();
    });

    test('[P0] 5.3-UNIT-022: animated dots with Thinking label when isLastThinking', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'thinking', content: 'Thinking...' })}
          isLastThinking={true}
        />,
      );
      expect(screen.getByTestId('entry-thinking-animated')).toBeTruthy();
      expect(screen.getByTestId('thinking-dot-1')).toBeTruthy();
      expect(screen.getByTestId('thinking-dot-2')).toBeTruthy();
      expect(screen.getByTestId('thinking-dot-3')).toBeTruthy();
      expect(screen.getByTestId('thinking-label')).toBeTruthy();
      expect(screen.getByText('Thinking...')).toBeTruthy();
    });
  });

  describe('intervention card (interactive)', () => {
    const interventionEntry = (overrides: Partial<ExecutionEntry> = {}): ExecutionEntry =>
      baseEntry({
        type: 'agent_confirmation',
        content: 'delete the cache directory',
        metadata: {
          request_id: 'req-123',
          tool: 'execute_cli',
          command: 'rm -rf /var/cache/*',
          reason: 'forbidden_command',
          status: 'pending',
        },
        ...overrides,
      });

    test('[P0] 3.5-UNIT-001: renders amber border, header text, command, both buttons', () => {
      render(
        <ExecutionEntryCard entry={interventionEntry()} isLastThinking={false} />,
      );
      expect(screen.getByTestId('intervention-card')).toBeTruthy();
      expect(screen.getByText(/INTERVENTION - Sandbox Caught/)).toBeTruthy();
      expect(screen.getByText('rm -rf /var/cache/*')).toBeTruthy();
      expect(screen.getByText('delete the cache directory')).toBeTruthy();
      expect(screen.getByText(/forbidden_command/)).toBeTruthy();
      expect(screen.getByTestId('intervention-execute-btn')).toBeTruthy();
      expect(screen.getByTestId('intervention-abort-btn')).toBeTruthy();
    });

    test('[P0] 3.5-UNIT-002: EXECUTE ANYWAY sends approved=true and changes to executed state', () => {
      const mockSendConfirmation = jest.fn();
      const useAIStore = require('../stores/useAIStore').default;
      useAIStore.getState().setSendConfirmationResponse(mockSendConfirmation);

      const entry = interventionEntry({ id: 'confirm-1' });
      useAIStore.getState().addExecutionEntry(entry);

      render(<ExecutionEntryCard entry={entry} isLastThinking={false} />);
      fireEvent.press(screen.getByTestId('intervention-execute-btn'));

      expect(mockSendConfirmation).toHaveBeenCalledWith('req-123', true);
      const updated = useAIStore.getState().executionEntries.find((e: any) => e.id === 'confirm-1');
      expect(updated?.metadata?.status).toBe('executed');
      expect(useAIStore.getState().aiState).toBe('executing');
    });

    test('[P0] 3.5-UNIT-003: ABORT ACTION sends approved=false and changes to aborted state', () => {
      const mockSendConfirmation = jest.fn();
      const useAIStore = require('../stores/useAIStore').default;
      useAIStore.getState().setSendConfirmationResponse(mockSendConfirmation);

      const entry = interventionEntry({ id: 'confirm-2' });
      useAIStore.getState().addExecutionEntry(entry);

      render(<ExecutionEntryCard entry={entry} isLastThinking={false} />);
      fireEvent.press(screen.getByTestId('intervention-abort-btn'));

      expect(mockSendConfirmation).toHaveBeenCalledWith('req-123', false);
      const updated = useAIStore.getState().executionEntries.find((e: any) => e.id === 'confirm-2');
      expect(updated?.metadata?.status).toBe('aborted');
      expect(useAIStore.getState().aiState).toBe('processing');
    });

    test('[P0] 3.5-UNIT-004: buttons disabled (not rendered) after response sent', () => {
      render(
        <ExecutionEntryCard
          entry={interventionEntry({
            metadata: {
              request_id: 'req-123',
              tool: 'execute_cli',
              command: 'rm -rf /var/cache/*',
              reason: 'forbidden_command',
              status: 'executed',
            }
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.queryByTestId('intervention-execute-btn')).toBeNull();
      expect(screen.queryByTestId('intervention-abort-btn')).toBeNull();
      expect(screen.getByText(/EXECUTED/)).toBeTruthy();
    });

    test('[P0] 3.5-UNIT-005: haptic feedback triggered on mount', () => {
      const Haptics = require('expo-haptics');
      Haptics.notificationAsync.mockClear();

      render(<ExecutionEntryCard entry={interventionEntry()} isLastThinking={false} />);

      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Error,
      );
    });

    test('[P0] 3.5-UNIT-006: accessibilityRole="alert" and accessibilityLiveRegion present', () => {
      render(<ExecutionEntryCard entry={interventionEntry()} isLastThinking={false} />);
      const card = screen.getByTestId('intervention-card');
      expect(card.props.accessibilityRole).toBe('alert');
      expect(card.props.accessibilityLiveRegion).toBe('assertive');
    });

    test('[P0] 3.5-UNIT-009b: buttons do nothing when sendConfirmationResponse is null', () => {
      const useAIStore = require('../stores/useAIStore').default;
      // Ensure sendConfirmationResponse is null (no session wired yet)
      useAIStore.getState().setSendConfirmationResponse(null);

      const entry = interventionEntry({ id: 'confirm-null' });
      useAIStore.getState().addExecutionEntry(entry);

      render(<ExecutionEntryCard entry={entry} isLastThinking={false} />);
      fireEvent.press(screen.getByTestId('intervention-execute-btn'));

      // Entry status should remain 'pending' - action was blocked
      const updated = useAIStore.getState().executionEntries.find((e: any) => e.id === 'confirm-null');
      expect(updated?.metadata?.status).toBe('pending');
    });

    test('[P1] 3.5-UNIT-009: aborted state shows dimmed card', () => {
      render(
        <ExecutionEntryCard
          entry={interventionEntry({
            metadata: {
              request_id: 'req-123',
              tool: 'execute_cli',
              command: 'rm -rf /var/cache/*',
              reason: 'forbidden_command',
              status: 'aborted',
            }
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText(/ABORTED/)).toBeTruthy();
      expect(screen.queryByTestId('intervention-execute-btn')).toBeNull();
    });

    test('[P1] 3.5-UNIT-010: short command does not render Show more toggle', () => {
      render(
        <ExecutionEntryCard
          entry={interventionEntry({
            metadata: {
              request_id: 'req-123',
              tool: 'execute_cli',
              command: 'rm -rf /var/cache/*',
              reason: 'forbidden_command',
              status: 'pending',
            }
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.queryByTestId('intervention-show-more')).toBeNull();
    });

    test('[P1] 3.5-UNIT-011: long command renders truncated with Show more toggle', () => {
      const longCommand = 'echo ' + 'A'.repeat(300);
      render(
        <ExecutionEntryCard
          entry={interventionEntry({
            metadata: {
              request_id: 'req-123',
              tool: 'execute_cli',
              command: longCommand,
              reason: 'forbidden_command',
              status: 'pending',
            }
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('intervention-show-more')).toBeTruthy();
      expect(screen.getByText('Show more')).toBeTruthy();
      // Truncated body ends with ellipsis; full command is not yet on screen
      expect(screen.queryByText(longCommand)).toBeNull();
    });

    test('[P1] 3.5-UNIT-012: pressing Show more expands the command, pressing again collapses', () => {
      const longCommand = 'echo ' + 'B'.repeat(300);
      render(
        <ExecutionEntryCard
          entry={interventionEntry({
            metadata: {
              request_id: 'req-123',
              tool: 'execute_cli',
              command: longCommand,
              reason: 'forbidden_command',
              status: 'pending',
            }
          })}
          isLastThinking={false}
        />,
      );

      // Expand
      fireEvent.press(screen.getByTestId('intervention-show-more'));
      expect(screen.getByText('Show less')).toBeTruthy();
      expect(screen.getByText(longCommand)).toBeTruthy();

      // Collapse
      fireEvent.press(screen.getByTestId('intervention-show-more'));
      expect(screen.getByText('Show more')).toBeTruthy();
      expect(screen.queryByText(longCommand)).toBeNull();
    });
  });

  describe('agent_progress card', () => {
    test('[P0] 3.0-UNIT-006: renders running status with spinner', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Running: docker ps',
            metadata: { step: 1, tool: 'execute_cli', status: 'running' },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('entry-agent-progress')).toBeTruthy();
      expect(screen.getByTestId('progress-status-running')).toBeTruthy();
      expect(screen.getByText(/\[1\] Running: docker ps/)).toBeTruthy();
    });

    test('[P0] 3.0-UNIT-007: renders completed status with checkmark', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Running: ls',
            metadata: { step: 2, tool: 'execute_cli', status: 'completed' },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('progress-status-completed')).toBeTruthy();
    });

    test('[P1] 3.0-UNIT-008: renders failed status with red icon', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Running: bad-cmd',
            metadata: { step: 3, tool: 'execute_cli', status: 'failed' },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('progress-status-failed')).toBeTruthy();
    });

    test('[P0] 4.2-UNIT-001: renders audit info row with duration, classified_command, and execution_result badge on completed entries', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Running: pip install requests',
            metadata: {
              step: 5,
              tool: 'execute_cli',
              status: 'completed',
              duration_ms: 1500,
              classified_command: 'pip install requests',
              execution_result: 'success',
            },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('audit-info-row')).toBeTruthy();
      expect(screen.getByTestId('audit-duration')).toBeTruthy();
      expect(screen.getByText('1.5s')).toBeTruthy();
      expect(screen.getByTestId('audit-classified-command')).toBeTruthy();
      expect(screen.getByText('pip install requests')).toBeTruthy();
      expect(screen.getByTestId('audit-execution-result')).toBeTruthy();
      expect(screen.getByText('success')).toBeTruthy();
    });

    test('[P0] 4.2-UNIT-002: audit info row NOT shown for running entries', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Running: ls',
            metadata: { step: 1, tool: 'execute_cli', status: 'running' },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.queryByTestId('audit-info-row')).toBeNull();
    });

    test('[P1] 4.2-UNIT-003: duration_ms under 1000 shows as milliseconds', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Running: echo hi',
            metadata: {
              step: 1,
              tool: 'execute_cli',
              status: 'completed',
              duration_ms: 125,
              execution_result: 'success',
            },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText('125ms')).toBeTruthy();
    });

    test('[P1] 4.2-UNIT-004: execution_result badge shows on failed entries', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Running: bad-cmd',
            metadata: {
              step: 1,
              tool: 'execute_cli',
              status: 'failed',
              execution_result: 'error',
            },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('audit-info-row')).toBeTruthy();
      expect(screen.getByTestId('audit-execution-result')).toBeTruthy();
      expect(screen.getByText('error')).toBeTruthy();
    });

    test('[P1] 3.0-UNIT-009: shows eye icon for observe_screen tool', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_progress',
            content: 'Capturing screen...',
            metadata: { step: 1, tool: 'observe_screen', status: 'running' },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText('eye-outline')).toBeTruthy();
    });
  });

  describe('agent_result card', () => {
    test('[P0] 3.0-UNIT-010: renders CONTOP label and result text', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({ type: 'agent_result', content: 'Task completed successfully' })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('entry-agent-result')).toBeTruthy();
      expect(screen.getByText('CONTOP')).toBeTruthy();
      expect(screen.getByText('Task completed successfully')).toBeTruthy();
    });
  });

  describe('agent_confirmation card', () => {
    test('[P0] 3.0-UNIT-011: renders as interactive InterventionCard', () => {
      render(
        <ExecutionEntryCard
          entry={baseEntry({
            type: 'agent_confirmation',
            content: 'Restricted path access',
            metadata: {
              request_id: 'req-456',
              tool: 'execute_cli',
              command: 'rm -rf /',
              reason: 'forbidden_command',
              status: 'pending',
            },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByTestId('intervention-card')).toBeTruthy();
      expect(screen.getByText(/INTERVENTION - Sandbox Caught/)).toBeTruthy();
      expect(screen.getByText('Restricted path access')).toBeTruthy();
    });
  });

  describe('destructive warning card (Story 3.6)', () => {
    const destructiveEntry = (overrides: Partial<ExecutionEntry> = {}): ExecutionEntry =>
      baseEntry({
        type: 'agent_confirmation',
        content: 'delete a file',
        metadata: {
          request_id: 'req-dest-1',
          tool: 'execute_cli',
          command: 'rm myfile.txt',
          reason: 'destructive_command',
          status: 'pending',
        },
        ...overrides,
      });

    test('[P0] 3.6-UNIT-001: renders "WARNING - Destructive Command" when reason is destructive_command', () => {
      render(
        <ExecutionEntryCard entry={destructiveEntry()} isLastThinking={false} />,
      );
      expect(screen.getByTestId('intervention-card')).toBeTruthy();
      expect(screen.getByText(/WARNING - Destructive Command/)).toBeTruthy();
    });

    test('[P0] 3.6-UNIT-002: renders "INTERVENTION - Sandbox Caught" when reason is NOT destructive_command (regression)', () => {
      render(
        <ExecutionEntryCard
          entry={destructiveEntry({
            metadata: {
              request_id: 'req-dest-2',
              tool: 'execute_cli',
              command: 'rm -rf /',
              reason: 'forbidden_command',
              status: 'pending',
            },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText(/INTERVENTION - Sandbox Caught/)).toBeTruthy();
    });

    test('[P0] 3.6-UNIT-003: RUN button sends agent_confirmation_response with approved: true', () => {
      const mockSendConfirmation = jest.fn();
      const useAIStore = require('../stores/useAIStore').default;
      useAIStore.getState().setSendConfirmationResponse(mockSendConfirmation);

      const entry = destructiveEntry({ id: 'dest-approve-1' });
      useAIStore.getState().addExecutionEntry(entry);

      render(<ExecutionEntryCard entry={entry} isLastThinking={false} />);

      // Destructive cards show "RUN" instead of "EXECUTE ANYWAY"
      expect(screen.getByText('RUN')).toBeTruthy();
      fireEvent.press(screen.getByTestId('intervention-execute-btn'));

      expect(mockSendConfirmation).toHaveBeenCalledWith('req-dest-1', true);
    });

    test('[P0] 3.6-UNIT-004: CANCEL button sends agent_confirmation_response with approved: false', () => {
      const mockSendConfirmation = jest.fn();
      const useAIStore = require('../stores/useAIStore').default;
      useAIStore.getState().setSendConfirmationResponse(mockSendConfirmation);

      const entry = destructiveEntry({ id: 'dest-reject-1' });
      useAIStore.getState().addExecutionEntry(entry);

      render(<ExecutionEntryCard entry={entry} isLastThinking={false} />);

      // Destructive cards show "CANCEL" instead of "ABORT ACTION"
      expect(screen.getByText('CANCEL')).toBeTruthy();
      fireEvent.press(screen.getByTestId('intervention-abort-btn'));

      expect(mockSendConfirmation).toHaveBeenCalledWith('req-dest-1', false);
    });

    test('[P0] 3.6-UNIT-005b: renders "EXECUTED - On host" when destructive command is approved', () => {
      render(
        <ExecutionEntryCard
          entry={destructiveEntry({
            metadata: {
              request_id: 'req-dest-exec',
              tool: 'execute_cli',
              command: 'rm myfile.txt',
              reason: 'destructive_command',
              status: 'executed',
            },
          })}
          isLastThinking={false}
        />,
      );
      expect(screen.getByText(/EXECUTED - On host/)).toBeTruthy();
      // Buttons should not render after execution
      expect(screen.queryByTestId('intervention-execute-btn')).toBeNull();
      expect(screen.queryByTestId('intervention-abort-btn')).toBeNull();
    });

    test('[P0] 3.6-UNIT-005: haptic feedback uses Warning for destructive, Error for sandbox', () => {
      const Haptics = require('expo-haptics');

      // Test destructive → Warning
      Haptics.notificationAsync.mockClear();
      const { unmount } = render(
        <ExecutionEntryCard entry={destructiveEntry()} isLastThinking={false} />,
      );
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Warning,
      );
      unmount();

      // Test sandbox → Error
      Haptics.notificationAsync.mockClear();
      render(
        <ExecutionEntryCard
          entry={destructiveEntry({
            metadata: {
              request_id: 'req-sandbox-haptic',
              tool: 'execute_cli',
              command: 'rm -rf /',
              reason: 'forbidden_command',
              status: 'pending',
            },
          })}
          isLastThinking={false}
        />,
      );
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Error,
      );
    });
  });
});
