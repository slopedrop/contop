import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import SessionList, { formatDuration } from './SessionList';
import type { SessionMeta } from '../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const makeMeta = (id: string, startTime: number, overrides?: Partial<SessionMeta>): SessionMeta => ({
  id,
  startTime,
  entryCount: 3,
  modelUsed: 'gemini-2.5-flash',
  ...overrides,
});

describe('SessionList', () => {
  const mockOnSelect = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  test('[P0] 5.6-UNIT-020: renders session-list FlatList', () => {
    render(<SessionList sessions={[]} onSelectSession={mockOnSelect} />);
    expect(screen.getByTestId('session-list')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-021: renders "No sessions yet" when sessions=[]', () => {
    render(<SessionList sessions={[]} onSelectSession={mockOnSelect} />);
    expect(screen.getByText('No sessions yet')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-022: renders session card with testID for each session', () => {
    const sessions = [makeMeta('s1', 1000), makeMeta('s2', 2000)];
    render(<SessionList sessions={sessions} onSelectSession={mockOnSelect} />);
    expect(screen.getByTestId('session-card-s1')).toBeTruthy();
    expect(screen.getByTestId('session-card-s2')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-023: session card press calls onSelectSession with correct session', () => {
    const session = makeMeta('s1', 1000);
    render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} />);
    fireEvent.press(screen.getByTestId('session-card-s1'));
    expect(mockOnSelect).toHaveBeenCalledWith(session);
  });

  test('[P0] 5.6-UNIT-024: session-search-input is rendered', () => {
    render(<SessionList sessions={[]} onSelectSession={mockOnSelect} />);
    expect(screen.getByTestId('session-search-input')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-025: typing in search input filters sessions', () => {
    const sessions = [
      makeMeta('s1', 1000, { modelUsed: 'gemini-2.5-flash' }),
      makeMeta('s2', 2000, { modelUsed: 'gpt-4' }),
    ];
    render(<SessionList sessions={sessions} onSelectSession={mockOnSelect} />);

    fireEvent.changeText(screen.getByTestId('session-search-input'), 'gpt');

    expect(screen.queryByTestId('session-card-s1')).toBeNull();
    expect(screen.getByTestId('session-card-s2')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-026: clearing search restores all sessions', () => {
    const sessions = [makeMeta('s1', 1000), makeMeta('s2', 2000)];
    render(<SessionList sessions={sessions} onSelectSession={mockOnSelect} />);

    fireEvent.changeText(screen.getByTestId('session-search-input'), 'nonexistent');
    expect(screen.queryByTestId('session-card-s1')).toBeNull();

    fireEvent.changeText(screen.getByTestId('session-search-input'), '');
    expect(screen.getByTestId('session-card-s1')).toBeTruthy();
    expect(screen.getByTestId('session-card-s2')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-027: session-search-clear button appears when query is non-empty', () => {
    render(<SessionList sessions={[]} onSelectSession={mockOnSelect} />);

    expect(screen.queryByTestId('session-search-clear')).toBeNull();

    fireEvent.changeText(screen.getByTestId('session-search-input'), 'test');
    expect(screen.getByTestId('session-search-clear')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-028: filter-chip-all is rendered with active style by default', () => {
    render(<SessionList sessions={[]} onSelectSession={mockOnSelect} />);
    expect(screen.getByTestId('filter-chip-all')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-029: filter-chip-today press sets active filter', () => {
    const now = Date.now();
    const sessions = [
      makeMeta('today-s', now - 1000), // 1 second ago
      makeMeta('old-s', now - 2 * 86400000), // 2 days ago
    ];
    render(<SessionList sessions={sessions} onSelectSession={mockOnSelect} />);

    fireEvent.press(screen.getByTestId('filter-chip-today'));

    expect(screen.getByTestId('session-card-today-s')).toBeTruthy();
    expect(screen.queryByTestId('session-card-old-s')).toBeNull();
  });

  test('[P0] 5.6-UNIT-030: filter-chip-this-week press shows only sessions within 7 days', () => {
    const now = Date.now();
    const sessions = [
      makeMeta('recent-s', now - 3 * 86400000), // 3 days ago
      makeMeta('ancient-s', now - 10 * 86400000), // 10 days ago
    ];
    render(<SessionList sessions={sessions} onSelectSession={mockOnSelect} />);

    fireEvent.press(screen.getByTestId('filter-chip-this-week'));

    expect(screen.getByTestId('session-card-recent-s')).toBeTruthy();
    expect(screen.queryByTestId('session-card-ancient-s')).toBeNull();
  });

  test('[P0] 5.6-UNIT-031: all 3 filter chips rendered', () => {
    render(<SessionList sessions={[]} onSelectSession={mockOnSelect} />);
    expect(screen.getByTestId('filter-chip-all')).toBeTruthy();
    expect(screen.getByTestId('filter-chip-today')).toBeTruthy();
    expect(screen.getByTestId('filter-chip-this-week')).toBeTruthy();
  });

  test('[P0] 5.6-UNIT-032: session card shows date label derived from startTime', () => {
    const timestamp = new Date(2026, 2, 12, 14, 34).getTime(); // Mar 12, 2026
    render(<SessionList sessions={[makeMeta('s1', timestamp)]} onSelectSession={mockOnSelect} />);
    // The date label should contain "Mar" and "12" and "2026"
    expect(screen.getByText(/Mar/)).toBeTruthy();
  });

  test('session card shows name as title when name is set', () => {
    render(<SessionList sessions={[makeMeta('s1', 1000, { name: 'My Debug Session' })]} onSelectSession={mockOnSelect} />);
    expect(screen.getByText('My Debug Session')).toBeTruthy();
  });

  test('search filters by session name', () => {
    const sessions = [
      makeMeta('s1', 1000, { name: 'Fix login bug' }),
      makeMeta('s2', 2000, { name: 'Deploy pipeline' }),
    ];
    render(<SessionList sessions={sessions} onSelectSession={mockOnSelect} />);
    fireEvent.changeText(screen.getByTestId('session-search-input'), 'login');
    expect(screen.getByTestId('session-card-s1')).toBeTruthy();
    expect(screen.queryByTestId('session-card-s2')).toBeNull();
  });

  describe('rename session', () => {
    const mockOnRename = jest.fn();

    test('pencil icon shown when onRenameSession provided', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} onRenameSession={mockOnRename} />);
      expect(screen.getByTestId('session-rename-s1')).toBeTruthy();
    });

    test('pencil icon not shown when onRenameSession omitted', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} />);
      expect(screen.queryByTestId('session-rename-s1')).toBeNull();
    });

    test('tapping pencil shows name input', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} onRenameSession={mockOnRename} />);
      fireEvent.press(screen.getByTestId('session-rename-s1'));
      expect(screen.getByTestId('session-name-input-s1')).toBeTruthy();
    });

    test('submitting name input calls onRenameSession', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} onRenameSession={mockOnRename} />);
      fireEvent.press(screen.getByTestId('session-rename-s1'));
      fireEvent.changeText(screen.getByTestId('session-name-input-s1'), 'New Name');
      fireEvent(screen.getByTestId('session-name-input-s1'), 'submitEditing');
      expect(mockOnRename).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'New Name');
    });
  });

  describe('status pills (AC3 / H2)', () => {
    test('status pills not rendered when toolStats is undefined', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} />);
      expect(screen.queryByTestId('pill-executed-s1')).toBeNull();
      expect(screen.queryByTestId('pill-blocked-s1')).toBeNull();
      expect(screen.queryByTestId('pill-errors-s1')).toBeNull();
    });

    test('status pills not rendered when all counts are zero', () => {
      const session = makeMeta('s1', 1000, { toolStats: { executed: 0, blocked: 0, errors: 0 } });
      render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} />);
      expect(screen.queryByTestId('pill-executed-s1')).toBeNull();
    });

    test('executed pill renders with correct count', () => {
      const session = makeMeta('s1', 1000, { toolStats: { executed: 4, blocked: 0, errors: 0 } });
      render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} />);
      expect(screen.getByTestId('pill-executed-s1')).toBeTruthy();
      expect(screen.getByText('4 exec')).toBeTruthy();
    });

    test('blocked pill renders with correct count', () => {
      const session = makeMeta('s1', 1000, { toolStats: { executed: 0, blocked: 2, errors: 0 } });
      render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} />);
      expect(screen.getByTestId('pill-blocked-s1')).toBeTruthy();
      expect(screen.getByText('2 blocked')).toBeTruthy();
    });

    test('errors pill renders singular for count 1', () => {
      const session = makeMeta('s1', 1000, { toolStats: { executed: 0, blocked: 0, errors: 1 } });
      render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} />);
      expect(screen.getByTestId('pill-errors-s1')).toBeTruthy();
      expect(screen.getByText('1 error')).toBeTruthy();
    });

    test('errors pill renders plural for count > 1', () => {
      const session = makeMeta('s1', 1000, { toolStats: { executed: 0, blocked: 0, errors: 3 } });
      render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} />);
      expect(screen.getByText('3 errors')).toBeTruthy();
    });

    test('all three pills render when all counts are non-zero', () => {
      const session = makeMeta('s1', 1000, { toolStats: { executed: 5, blocked: 1, errors: 2 } });
      render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} />);
      expect(screen.getByTestId('pill-executed-s1')).toBeTruthy();
      expect(screen.getByTestId('pill-blocked-s1')).toBeTruthy();
      expect(screen.getByTestId('pill-errors-s1')).toBeTruthy();
    });
  });

  describe('formatDuration human-readable output', () => {
    test('seconds only for durations < 1 minute', () => {
      const now = Date.now();
      expect(formatDuration(now - 42000, now)).toBe('42s');
    });

    test('minutes and seconds for durations < 1 hour', () => {
      const now = Date.now();
      expect(formatDuration(now - 342000, now)).toBe('5m 42s'); // 5 min 42 sec
    });

    test('hours and minutes for durations < 1 day', () => {
      const now = Date.now();
      expect(formatDuration(now - 8100000, now)).toBe('2h 15m'); // 2 hr 15 min
    });

    test('days and hours for durations >= 1 day', () => {
      const now = Date.now();
      expect(formatDuration(now - 93600000, now)).toBe('1d 2h'); // 26 hours = 1d 2h
    });

    test('0s for zero-length duration', () => {
      const now = Date.now();
      expect(formatDuration(now, now)).toBe('0s');
    });
  });

  describe('delete session', () => {
    const mockOnDelete = jest.fn();

    test('delete button shown when onDeleteSession provided', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} onDeleteSession={mockOnDelete} />);
      expect(screen.getByTestId('session-delete-s1')).toBeTruthy();
    });

    test('delete button not shown when onDeleteSession omitted', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} />);
      expect(screen.queryByTestId('session-delete-s1')).toBeNull();
    });

    test('tapping delete shows confirmation modal', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} onDeleteSession={mockOnDelete} />);
      fireEvent.press(screen.getByTestId('session-delete-s1'));
      expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy();
      expect(screen.getByText('Delete Session')).toBeTruthy();
    });

    test('cancel dismisses modal without deleting', () => {
      render(<SessionList sessions={[makeMeta('s1', 1000)]} onSelectSession={mockOnSelect} onDeleteSession={mockOnDelete} />);
      fireEvent.press(screen.getByTestId('session-delete-s1'));
      fireEvent.press(screen.getByTestId('delete-confirm-cancel'));
      expect(mockOnDelete).not.toHaveBeenCalled();
    });

    test('confirm calls onDeleteSession with correct session', () => {
      const session = makeMeta('s1', 1000);
      render(<SessionList sessions={[session]} onSelectSession={mockOnSelect} onDeleteSession={mockOnDelete} />);
      fireEvent.press(screen.getByTestId('session-delete-s1'));
      fireEvent.press(screen.getByTestId('delete-confirm-ok'));
      expect(mockOnDelete).toHaveBeenCalledWith(session);
    });
  });
});
