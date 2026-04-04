import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import HistoryScreen from './history';

jest.mock('../../services/sessionStorage', () => ({
  loadSessionIndex: jest.fn(() => Promise.resolve([])),
  loadSessionEntries: jest.fn(() => Promise.resolve([])),
  deleteSession: jest.fn(() => Promise.resolve()),
  upsertSessionMeta: jest.fn(() => Promise.resolve()),
}));

const mockRestoreSession = jest.fn();
jest.mock('../../stores/useAIStore', () => ({
  __esModule: true,
  default: { getState: () => ({ restoreSession: mockRestoreSession }) },
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// Mock individual component files to avoid CSS interop barrel issues
jest.mock('../../components/SessionList', () => {
  return {
    __esModule: true,
    default: ({ sessions, onSelectSession }: { sessions: any[]; onSelectSession: (s: any) => void }) => {
      const RN = require('react-native');
      return require('react').createElement(RN.View, { testID: 'session-list' },
        sessions.map((s: any) =>
          require('react').createElement(RN.Pressable, { key: s.id, testID: `session-card-${s.id}`, onPress: () => onSelectSession(s) },
            require('react').createElement(RN.Text, null, s.id)
          )
        )
      );
    },
    formatSessionDate: (ts: number) => new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    }),
  };
});

jest.mock('../../components/ScreenContainer', () => {
  return {
    __esModule: true,
    default: (props: any) => require('react').createElement(require('react-native').View, { testID: 'screen-container' }, props.children),
  };
});

jest.mock('../../components/ExecutionEntryCard', () => {
  return {
    __esModule: true,
    default: (props: any) => require('react').createElement(require('react-native').View, { testID: `entry-card-${props.entry.id}` }),
  };
});

jest.mock('../../components/ExecutionThread', () => {
  return {
    __esModule: true,
    default: (props: any) => {
      const RN = require('react-native');
      const React = require('react');
      return React.createElement(RN.View, { testID: 'execution-thread' },
        (props.entries ?? []).map((e: any) =>
          React.createElement(RN.View, { key: e.id, testID: `thread-entry-${e.id}` })
        )
      );
    },
  };
});

const sessionStorage = jest.requireMock('../../services/sessionStorage') as {
  loadSessionIndex: jest.Mock;
  loadSessionEntries: jest.Mock;
  deleteSession: jest.Mock;
  upsertSessionMeta: jest.Mock;
};

describe('HistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.loadSessionIndex.mockResolvedValue([]);
    sessionStorage.loadSessionEntries.mockResolvedValue([]);
  });

  test('[P0] 5.6-UNIT-033: renders history-loading spinner while loading', () => {
    sessionStorage.loadSessionIndex.mockReturnValue(new Promise(() => {}));
    render(<HistoryScreen />);
    expect(screen.getByTestId('history-loading')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-034a: renders session-list after loading completes', async () => {
    render(<HistoryScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('session-list')).toBeTruthy();
    });
  });

  test('[P0] 5.6-UNIT-035a: tapping a session card shows history-entry-list', async () => {
    const sessions = [{ id: 's1', startTime: 1000, entryCount: 1, modelUsed: 'gemini-2.5-flash' }];
    sessionStorage.loadSessionIndex.mockResolvedValue(sessions);
    sessionStorage.loadSessionEntries.mockResolvedValue([
      { id: 'e1', type: 'user_message', content: 'hello', timestamp: 1000 },
    ]);

    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('session-card-s1')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-card-s1'));
    });

    expect(screen.getByTestId('execution-thread')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-036: history-back-button calls router.back() in list view', async () => {
    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('history-back-button')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('history-back-button'));
    expect(mockBack).toHaveBeenCalled();
  });

  test('[P0] 5.6-UNIT-037: history-back-button in detail view returns to list view', async () => {
    const sessions = [{ id: 's1', startTime: 1000, entryCount: 1, modelUsed: 'gemini-2.5-flash' }];
    sessionStorage.loadSessionIndex.mockResolvedValue(sessions);

    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('session-card-s1')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-card-s1'));
    });

    fireEvent.press(screen.getByTestId('history-back-button'));

    await waitFor(() => {
      expect(screen.getByTestId('session-list')).toBeTruthy();
    });
  });

  test('continue button restores session atomically and navigates back', async () => {
    const sessions = [{ id: 's1', startTime: 1000, entryCount: 1, modelUsed: 'gemini-2.5-flash' }];
    const entries = [{ id: 'e1', type: 'user_message', content: 'hello', timestamp: 1000 }];
    sessionStorage.loadSessionIndex.mockResolvedValue(sessions);
    sessionStorage.loadSessionEntries.mockResolvedValue(entries);

    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('session-card-s1')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-card-s1'));
    });

    fireEvent.press(screen.getByTestId('history-continue-button'));
    expect(mockRestoreSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', endTime: undefined, startTime: expect.any(Number) }),
      entries,
    );
    // startTime should be updated to now (not the original 1000)
    const calledSession = mockRestoreSession.mock.calls[0][0];
    expect(calledSession.startTime).toBeGreaterThan(1000);
    expect(mockBack).toHaveBeenCalled();
  });

  test('[P0] 4.2-UNIT-005: filter bar renders when entries have tool/execution_result metadata', async () => {
    const sessions = [{ id: 's1', startTime: 1000, entryCount: 2, modelUsed: 'gemini-2.5-flash' }];
    const entries = [
      {
        id: 'e1', type: 'agent_progress', content: 'Running: ls', timestamp: 1000,
        metadata: { step: 1, tool: 'execute_cli', status: 'completed', execution_result: 'success' },
      },
      {
        id: 'e2', type: 'agent_progress', content: 'Capturing screen...', timestamp: 1001,
        metadata: { step: 2, tool: 'observe_screen', status: 'completed', execution_result: 'success' },
      },
    ];
    sessionStorage.loadSessionIndex.mockResolvedValue(sessions);
    sessionStorage.loadSessionEntries.mockResolvedValue(entries);

    render(<HistoryScreen />);
    await waitFor(() => { expect(screen.getByTestId('session-card-s1')).toBeTruthy(); });
    await act(async () => { fireEvent.press(screen.getByTestId('session-card-s1')); });

    expect(screen.getByTestId('history-filter-bar')).toBeTruthy();
    expect(screen.getByTestId('filter-tool-all')).toBeTruthy();
    expect(screen.getByTestId('filter-tool-execute_cli')).toBeTruthy();
    expect(screen.getByTestId('filter-tool-observe_screen')).toBeTruthy();
  });

  test('[P0] 4.2-UNIT-006: filter bar not rendered when no tool metadata exists', async () => {
    const sessions = [{ id: 's1', startTime: 1000, entryCount: 1, modelUsed: 'gemini-2.5-flash' }];
    const entries = [
      { id: 'e1', type: 'user_message', content: 'hello', timestamp: 1000 },
    ];
    sessionStorage.loadSessionIndex.mockResolvedValue(sessions);
    sessionStorage.loadSessionEntries.mockResolvedValue(entries);

    render(<HistoryScreen />);
    await waitFor(() => { expect(screen.getByTestId('session-card-s1')).toBeTruthy(); });
    await act(async () => { fireEvent.press(screen.getByTestId('session-card-s1')); });

    expect(screen.queryByTestId('history-filter-bar')).toBeNull();
  });

  test('[P1] 4.2-UNIT-009: tapping a tool filter chip filters entries to only matching tool', async () => {
    const sessions = [{ id: 's1', startTime: 1000, entryCount: 3, modelUsed: 'gemini-2.5-flash' }];
    const entries = [
      {
        id: 'e1', type: 'agent_progress', content: 'ls', timestamp: 1000,
        metadata: { step: 1, tool: 'execute_cli', status: 'completed', execution_result: 'success' },
      },
      {
        id: 'e2', type: 'agent_progress', content: 'screenshot', timestamp: 1001,
        metadata: { step: 2, tool: 'observe_screen', status: 'completed', execution_result: 'success' },
      },
      {
        id: 'e3', type: 'user_message', content: 'hello', timestamp: 1002,
      },
    ];
    sessionStorage.loadSessionIndex.mockResolvedValue(sessions);
    sessionStorage.loadSessionEntries.mockResolvedValue(entries);

    render(<HistoryScreen />);
    await waitFor(() => { expect(screen.getByTestId('session-card-s1')).toBeTruthy(); });
    await act(async () => { fireEvent.press(screen.getByTestId('session-card-s1')); });

    // Before filtering: all 3 entries visible
    expect(screen.getByTestId('thread-entry-e1')).toBeTruthy();
    expect(screen.getByTestId('thread-entry-e2')).toBeTruthy();
    expect(screen.getByTestId('thread-entry-e3')).toBeTruthy();

    // Press execute_cli filter — should hide observe_screen, keep execute_cli and non-agent_progress
    await act(async () => { fireEvent.press(screen.getByTestId('filter-tool-execute_cli')); });

    expect(screen.getByTestId('thread-entry-e1')).toBeTruthy();   // execute_cli — shown
    expect(screen.queryByTestId('thread-entry-e2')).toBeNull();   // observe_screen — filtered out
    expect(screen.getByTestId('thread-entry-e3')).toBeTruthy();   // user_message — always shown
  });

  test('[P0] 5.6-UNIT-038: header title in detail view shows formatted date', async () => {
    const timestamp = new Date(2026, 2, 12, 14, 34).getTime();
    const sessions = [{ id: 's1', startTime: timestamp, entryCount: 0, modelUsed: 'gemini-2.5-flash' }];
    sessionStorage.loadSessionIndex.mockResolvedValue(sessions);

    render(<HistoryScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('session-card-s1')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('session-card-s1'));
    });

    expect(screen.getByText(/Mar/)).toBeTruthy();
  });
});
