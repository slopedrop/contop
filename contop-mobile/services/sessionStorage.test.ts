import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadSessionIndex, upsertSessionMeta, saveSessionEntries,
  loadSessionEntries, finalizeSession, deleteSession,
  pruneOldSessions, emergencyClearEntries,
} from './sessionStorage';
import type { SessionMeta, ExecutionEntry } from '../types';

// jest.setup.js provides the AsyncStorage mock globally
const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

const makeMeta = (overrides?: Partial<SessionMeta>): SessionMeta => ({
  id: 'test-session-1',
  startTime: 1000000,
  entryCount: 0,
  modelUsed: 'gemini-2.5-flash',
  ...overrides,
});

describe('sessionStorage', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('loadSessionIndex', () => {
    test('[P0] 5.6-UNIT-004: returns [] when AsyncStorage returns null', async () => {
      mockGetItem.mockResolvedValueOnce(null);
      const result = await loadSessionIndex();
      expect(result).toEqual([]);
    });

    test('[P0] 5.6-UNIT-005: returns parsed array when AsyncStorage returns valid JSON', async () => {
      const sessions = [makeMeta()];
      mockGetItem.mockResolvedValueOnce(JSON.stringify(sessions));
      const result = await loadSessionIndex();
      expect(result).toEqual(sessions);
    });

    test('[P0] 5.6-UNIT-006: returns [] when AsyncStorage returns invalid JSON', async () => {
      mockGetItem.mockResolvedValueOnce('not-valid-json');
      const result = await loadSessionIndex();
      expect(result).toEqual([]);
    });
  });

  describe('upsertSessionMeta', () => {
    test('[P0] 5.6-UNIT-007: inserts new session (index was empty)', async () => {
      mockGetItem.mockResolvedValueOnce(null); // loadSessionIndex returns []
      const meta = makeMeta();
      await upsertSessionMeta(meta);

      expect(mockSetItem).toHaveBeenCalledWith(
        '@contop:session_index',
        JSON.stringify([meta]),
      );
    });

    test('[P0] 5.6-UNIT-008: prepends new session so newest is first', async () => {
      const older = makeMeta({ id: 'old', startTime: 500 });
      mockGetItem.mockResolvedValueOnce(JSON.stringify([older]));
      const newer = makeMeta({ id: 'new', startTime: 2000 });
      await upsertSessionMeta(newer);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved[0].id).toBe('new');
      expect(saved[1].id).toBe('old');
    });

    test('[P0] 5.6-UNIT-009: updates existing session by ID (not duplicates)', async () => {
      const original = makeMeta({ id: 's1', entryCount: 0 });
      mockGetItem.mockResolvedValueOnce(JSON.stringify([original]));
      const updated = makeMeta({ id: 's1', entryCount: 5 });
      await upsertSessionMeta(updated);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved).toHaveLength(1);
      expect(saved[0].entryCount).toBe(5);
    });

    test('updated session moves to top of index (auto-sort)', async () => {
      const s1 = makeMeta({ id: 's1', startTime: 1000 });
      const s2 = makeMeta({ id: 's2', startTime: 2000 });
      const s3 = makeMeta({ id: 's3', startTime: 3000 });
      // s3 is first (newest), s1 is last
      mockGetItem.mockResolvedValueOnce(JSON.stringify([s3, s2, s1]));
      // Update s1 (oldest) — should move to top
      const updatedS1 = { ...s1, entryCount: 10 };
      await upsertSessionMeta(updatedS1);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved).toHaveLength(3);
      expect(saved[0].id).toBe('s1');
      expect(saved[0].entryCount).toBe(10);
      expect(saved[1].id).toBe('s3');
      expect(saved[2].id).toBe('s2');
    });
  });

  describe('saveSessionEntries', () => {
    test('[P0] 5.6-UNIT-010: calls AsyncStorage.setItem with correct key and JSON', async () => {
      const entries: ExecutionEntry[] = [
        { id: 'e1', type: 'user_message', content: 'hello', timestamp: 1000 },
      ];
      await saveSessionEntries('sess-1', entries);

      expect(mockSetItem).toHaveBeenCalledWith(
        '@contop:session:sess-1:entries',
        JSON.stringify(entries),
      );
    });

    test('strips image_b64 from metadata before persisting', async () => {
      const entries: ExecutionEntry[] = [
        {
          id: 'e1', type: 'agent_progress', content: 'observe_screen', timestamp: 1000,
          metadata: { step: 1, status: 'completed', image_b64: 'A'.repeat(500) },
        },
      ];
      await saveSessionEntries('sess-1', entries);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved[0].metadata).not.toHaveProperty('image_b64');
      expect(saved[0].metadata.step).toBe(1);
    });

    test('strips base64 from content when it contains image_b64 JSON', async () => {
      const bigB64 = 'A'.repeat(2000);
      const entries: ExecutionEntry[] = [
        {
          id: 'e1', type: 'tool_result', timestamp: 1000,
          content: `{"status":"success","image_b64":"${bigB64}","ui_elements":"text"}`,
        },
      ];
      await saveSessionEntries('sess-1', entries);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved[0].content).not.toContain(bigB64);
      expect(saved[0].content).toContain('[stripped]');
    });

    test('auto-cleans on SQLITE_FULL and retries', async () => {
      mockSetItem.mockRejectedValueOnce(new Error('database or disk is full (code 13 SQLITE_FULL[13])'));
      // After emergencyClearEntries: reads index, removes entries, saves reset index
      mockGetItem.mockResolvedValueOnce(JSON.stringify([makeMeta({ id: 'old-1' })]));
      mockRemoveItem.mockResolvedValueOnce(undefined);
      mockSetItem.mockResolvedValueOnce(undefined); // reset index
      mockSetItem.mockResolvedValueOnce(undefined); // retry save

      const entries: ExecutionEntry[] = [
        { id: 'e1', type: 'user_message', content: 'hi', timestamp: 1000 },
      ];
      await saveSessionEntries('sess-1', entries);

      // Should have retried after cleanup
      expect(mockSetItem).toHaveBeenCalledTimes(3);
    });
  });

  describe('loadSessionEntries', () => {
    test('[P0] 5.6-UNIT-011: returns [] when nothing stored', async () => {
      mockGetItem.mockResolvedValueOnce(null);
      const result = await loadSessionEntries('sess-1');
      expect(result).toEqual([]);
    });

    test('[P0] 5.6-UNIT-012: returns parsed entries array', async () => {
      const entries: ExecutionEntry[] = [
        { id: 'e1', type: 'ai_response', content: 'hi', timestamp: 2000 },
      ];
      mockGetItem.mockResolvedValueOnce(JSON.stringify(entries));
      const result = await loadSessionEntries('sess-1');
      expect(result).toEqual(entries);
    });
  });

  describe('finalizeSession', () => {
    test('[P0] 5.6-UNIT-013: sets endTime on existing session meta', async () => {
      const meta = makeMeta({ id: 's1' });
      // First call: finalizeSession reads index
      mockGetItem.mockResolvedValueOnce(JSON.stringify([meta]));
      // Second call: upsertSessionMeta reads index again
      mockGetItem.mockResolvedValueOnce(JSON.stringify([meta]));

      await finalizeSession('s1', 9999);

      // upsertSessionMeta should have been called with endTime set
      const lastSetCall = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
      const saved = JSON.parse(lastSetCall[1]);
      expect(saved[0].endTime).toBe(9999);
    });

    test('[P0] 5.6-UNIT-014: does nothing if session not found in index', async () => {
      mockGetItem.mockResolvedValueOnce(JSON.stringify([]));
      await finalizeSession('nonexistent', 9999);
      expect(mockSetItem).not.toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    test('[P0] 5.6-UNIT-015: removes meta from index and calls removeItem with entries key', async () => {
      const meta = makeMeta({ id: 's1' });
      mockGetItem.mockResolvedValueOnce(JSON.stringify([meta]));

      await deleteSession('s1');

      // Index should be saved without the deleted session
      expect(mockSetItem).toHaveBeenCalledWith(
        '@contop:session_index',
        JSON.stringify([]),
      );
      // Entries key should be removed
      expect(mockRemoveItem).toHaveBeenCalledWith('@contop:session:s1:entries');
    });
  });

  describe('pruneOldSessions', () => {
    test('removes sessions beyond MAX_SESSIONS (20)', async () => {
      const sessions = Array.from({ length: 25 }, (_, i) =>
        makeMeta({ id: `s${i}`, startTime: 25000 - i }),
      );
      mockGetItem.mockResolvedValueOnce(JSON.stringify(sessions));

      await pruneOldSessions();

      // Should save only the first 20
      const savedIndex = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(savedIndex).toHaveLength(20);
      // Should remove 5 oldest
      expect(mockRemoveItem).toHaveBeenCalledTimes(5);
    });

    test('does nothing when under MAX_SESSIONS', async () => {
      mockGetItem.mockResolvedValueOnce(JSON.stringify([makeMeta()]));
      await pruneOldSessions();
      expect(mockSetItem).not.toHaveBeenCalled();
    });
  });

  describe('emergencyClearEntries', () => {
    test('removes all entry keys and resets counts', async () => {
      const sessions = [makeMeta({ id: 's1', entryCount: 10 }), makeMeta({ id: 's2', entryCount: 5 })];
      mockGetItem.mockResolvedValueOnce(JSON.stringify(sessions));

      await emergencyClearEntries();

      expect(mockRemoveItem).toHaveBeenCalledWith('@contop:session:s1:entries');
      expect(mockRemoveItem).toHaveBeenCalledWith('@contop:session:s2:entries');
      const savedIndex = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(savedIndex[0].entryCount).toBe(0);
      expect(savedIndex[1].entryCount).toBe(0);
    });
  });

  describe('name and toolStats fields (L4)', () => {
    test('[P1] 5.6-UNIT-L4-001: upsertSessionMeta preserves name field on update', async () => {
      const original: SessionMeta = { ...makeMeta({ id: 's1' }), name: 'My Session' };
      mockGetItem.mockResolvedValueOnce(JSON.stringify([original]));
      const updated = { ...original, entryCount: 5 };
      await upsertSessionMeta(updated);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved[0].name).toBe('My Session');
      expect(saved[0].entryCount).toBe(5);
    });

    test('[P1] 5.6-UNIT-L4-002: upsertSessionMeta preserves toolStats field on update', async () => {
      const toolStats = { executed: 3, blocked: 1, errors: 0 };
      const original: SessionMeta = { ...makeMeta({ id: 's1' }), toolStats };
      mockGetItem.mockResolvedValueOnce(JSON.stringify([original]));
      const updated = { ...original, entryCount: 10 };
      await upsertSessionMeta(updated);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved[0].toolStats).toEqual(toolStats);
    });

    test('[P1] 5.6-UNIT-L4-003: upsertSessionMeta can insert session with name and toolStats', async () => {
      mockGetItem.mockResolvedValueOnce(null);
      const meta: SessionMeta = {
        ...makeMeta({ id: 's1' }),
        name: 'Debug',
        toolStats: { executed: 2, blocked: 0, errors: 1 },
      };
      await upsertSessionMeta(meta);

      const saved = JSON.parse(mockSetItem.mock.calls[0][1]);
      expect(saved[0].name).toBe('Debug');
      expect(saved[0].toolStats).toEqual({ executed: 2, blocked: 0, errors: 1 });
    });

    test('[P0] 4.2-UNIT-007: audit metadata (classified_command, execution_result, duration_ms) survives save/load cycle', async () => {
      const entries: ExecutionEntry[] = [
        {
          id: 'e1',
          type: 'agent_progress',
          content: 'Running: pip install requests',
          timestamp: 1000,
          metadata: {
            step: 1,
            tool: 'execute_cli',
            status: 'completed',
            classified_command: 'pip install requests',
            execution_result: 'success',
            duration_ms: 1500,
          },
        },
        {
          id: 'e2',
          type: 'agent_progress',
          content: 'Capturing screen...',
          timestamp: 1001,
          metadata: {
            step: 2,
            tool: 'observe_screen',
            status: 'completed',
            classified_command: '',
            execution_result: 'success',
            duration_ms: 250,
            image_b64: 'AAAA'.repeat(100), // will be stripped
          },
        },
      ];

      await saveSessionEntries('s-audit', entries);

      // Read back what was persisted
      const savedJson = mockSetItem.mock.calls[0][1];
      const saved = JSON.parse(savedJson) as ExecutionEntry[];

      // Audit fields preserved
      expect(saved[0].metadata?.classified_command).toBe('pip install requests');
      expect(saved[0].metadata?.execution_result).toBe('success');
      expect(saved[0].metadata?.duration_ms).toBe(1500);

      // image_b64 stripped but audit fields preserved
      expect(saved[1].metadata?.image_b64).toBeUndefined();
      expect(saved[1].metadata?.classified_command).toBe('');
      expect(saved[1].metadata?.execution_result).toBe('success');
      expect(saved[1].metadata?.duration_ms).toBe(250);
    });

    test('[P1] 5.6-UNIT-L4-004: finalizeSession preserves toolStats when setting endTime', async () => {
      const toolStats = { executed: 5, blocked: 0, errors: 2 };
      const meta: SessionMeta = { ...makeMeta({ id: 's1' }), toolStats };
      mockGetItem.mockResolvedValueOnce(JSON.stringify([meta])); // finalizeSession reads index
      mockGetItem.mockResolvedValueOnce(JSON.stringify([meta])); // upsertSessionMeta reads index

      await finalizeSession('s1', 9999);

      const lastSetCall = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
      const saved = JSON.parse(lastSetCall[1]);
      expect(saved[0].endTime).toBe(9999);
      expect(saved[0].toolStats).toEqual(toolStats);
    });
  });
});
