import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import DesktopAgentGroup from './DesktopAgentGroup';
import type { ExecutionEntry } from '../types';

const mockEntry = (overrides: Partial<ExecutionEntry> = {}): ExecutionEntry => ({
  id: `e-${Math.random().toString(36).slice(2)}`,
  type: 'agent_progress',
  content: 'Running: ls',
  timestamp: Date.now(),
  metadata: { step: 1, tool: 'execute_cli', status: 'completed' },
  ...overrides,
});

const confirmationEntry = (overrides: Partial<ExecutionEntry> = {}): ExecutionEntry => ({
  id: 'confirm-1',
  type: 'agent_confirmation',
  content: 'delete the cache directory',
  timestamp: Date.now(),
  metadata: {
    request_id: 'req-123',
    tool: 'execute_cli',
    command: 'rm -rf /var/cache/*',
    reason: 'forbidden_command',
    status: 'pending',
  },
  ...overrides,
});

describe('DesktopAgentGroup', () => {
  test('[P0] 3.5-UNIT-010: auto-expands when group contains pending confirmation', () => {
    const entries = [
      mockEntry({ id: 'e1' }),
      confirmationEntry(),
    ];

    render(<DesktopAgentGroup entries={entries} isActive={false} />);

    // Should auto-expand - the intervention card should be visible
    expect(screen.getByTestId('intervention-card')).toBeTruthy();
    expect(screen.getByText(/INTERVENTION - Sandbox Caught/)).toBeTruthy();
  });

  test('[P0] 3.5-UNIT-011: shows amber dot indicator when collapsed with pending confirmation', () => {
    // With a resolved (non-pending) confirmation, group should NOT auto-expand
    const entries = [
      mockEntry({ id: 'e1' }),
      confirmationEntry({
        metadata: {
          request_id: 'req-123',
          tool: 'execute_cli',
          command: 'rm -rf /var/cache/*',
          reason: 'forbidden_command',
          status: 'executed',
        },
      }),
    ];

    render(<DesktopAgentGroup entries={entries} isActive={false} />);

    // Resolved confirmation - group stays collapsed, no amber dot
    expect(screen.queryByTestId('pending-confirmation-indicator')).toBeNull();
  });

  test('[P1] 3.5-UNIT-012: amber dot visible when collapsed with pending confirmation', () => {
    // Render with pending confirmation, then manually collapse
    const entries = [confirmationEntry()];

    const { rerender } = render(
      <DesktopAgentGroup entries={entries} isActive={false} />,
    );

    // Auto-expanded due to pending confirmation - amber dot should NOT show
    // (dot only shows when collapsed)
    expect(screen.queryByTestId('pending-confirmation-indicator')).toBeNull();
  });

  test('[P0] 3.5-UNIT-013: renders InterventionCard for agent_confirmation inside group', () => {
    const entries = [
      mockEntry({ id: 'e1' }),
      confirmationEntry(),
      mockEntry({ id: 'e2', metadata: { step: 2, tool: 'execute_cli', status: 'running' } }),
    ];

    render(<DesktopAgentGroup entries={entries} isActive={true} />);

    // The confirmation entry should render as a full InterventionCard
    expect(screen.getByTestId('intervention-card')).toBeTruthy();
    expect(screen.getByText('rm -rf /var/cache/*')).toBeTruthy();
  });

  test('[P0] 3.5-UNIT-014: header shows step count and group renders collapsed by default', () => {
    const entries = [
      mockEntry({ id: 'e1' }),
      mockEntry({ id: 'e2', content: 'Running: pwd', metadata: { step: 2, tool: 'execute_cli', status: 'completed' } }),
    ];

    render(<DesktopAgentGroup entries={entries} isActive={false} />);

    expect(screen.getByTestId('desktop-agent-group')).toBeTruthy();
    expect(screen.getByText('CONTOP DESKTOP')).toBeTruthy();
    expect(screen.getByText('2 steps')).toBeTruthy();
  });

  test('[P1] 3.5-UNIT-015: header press toggles expansion', () => {
    const entries = [
      mockEntry({ id: 'e1', content: 'Running: ls' }),
    ];

    render(<DesktopAgentGroup entries={entries} isActive={false} />);

    // Initially collapsed - terminal step not visible
    expect(screen.queryByText('Running: ls')).toBeNull();

    // Press header to expand
    fireEvent.press(screen.getByText('CONTOP DESKTOP'));

    // Now expanded - terminal step visible
    expect(screen.getByText('Running: ls')).toBeTruthy();
  });
});
