import useAIStore from './useAIStore';

describe('useAIStore Zustand store', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Reset the Zustand store to its initial state between tests
    useAIStore.getState().resetStore();
  });

  describe('connectionStatus', () => {
    test('[P0] 1.4-UNIT-014a: initial connectionStatus is "disconnected"', () => {
      // Given — a freshly initialized Zustand store

      // When — reading the initial state
      const state = useAIStore.getState();

      // Then — connectionStatus defaults to 'disconnected'
      expect(state.connectionStatus).toBe('disconnected');
    });

    test('[P0] 1.4-UNIT-014b: setConnectionStatus() updates state', () => {
      // Given — the store is in its initial state with connectionStatus 'disconnected'
      expect(useAIStore.getState().connectionStatus).toBe('disconnected');

      // When — setConnectionStatus is called with 'connected'
      useAIStore.getState().setConnectionStatus('connected');

      // Then — the connectionStatus is updated to 'connected'
      expect(useAIStore.getState().connectionStatus).toBe('connected');

      // When — setConnectionStatus is called with 'reconnecting'
      useAIStore.getState().setConnectionStatus('reconnecting');

      // Then — the connectionStatus is updated to 'reconnecting'
      expect(useAIStore.getState().connectionStatus).toBe('reconnecting');

      // When — setConnectionStatus is called with 'disconnected'
      useAIStore.getState().setConnectionStatus('disconnected');

      // Then — the connectionStatus is updated back to 'disconnected'
      expect(useAIStore.getState().connectionStatus).toBe('disconnected');
    });
  });

  describe('connectionPath', () => {
    test('initial connectionPath is "unknown"', () => {
      expect(useAIStore.getState().connectionPath).toBe('unknown');
    });

    test('setConnectionPath() updates state', () => {
      useAIStore.getState().setConnectionPath('lan');
      expect(useAIStore.getState().connectionPath).toBe('lan');

      useAIStore.getState().setConnectionPath('tailscale');
      expect(useAIStore.getState().connectionPath).toBe('tailscale');

      useAIStore.getState().setConnectionPath('tunnel');
      expect(useAIStore.getState().connectionPath).toBe('tunnel');
    });

    test('resetStore() resets connectionPath to "unknown"', () => {
      useAIStore.getState().setConnectionPath('lan');
      useAIStore.getState().resetStore();
      expect(useAIStore.getState().connectionPath).toBe('unknown');
    });
  });

  describe('aiState', () => {
    test('[P1] 1.4-UNIT-014c: initial aiState is "idle"', () => {
      // Given — a freshly initialized Zustand store

      // When — reading the initial state
      const state = useAIStore.getState();

      // Then — aiState defaults to 'idle'
      expect(state.aiState).toBe('idle');
    });
  });

  describe('resetStore (Story 1.5)', () => {
    test('[P0] 1.5-UNIT-008: resetStore() resets all state to initial values', () => {
      // Given — store has non-default state
      const store = useAIStore;
      store.getState().setConnectionStatus('connected');
      store.getState().setAIState('processing');
      store.getState().setConnectionFlow('session');
      store.getState().addExecutionEntry({ id: 'e1', type: 'user_message', content: 'test', timestamp: Date.now() });

      // When — resetStore() is called
      store.getState().resetStore();

      // Then — all state is reset to initial values
      const state = store.getState();
      expect(state.connectionStatus).toBe('disconnected');
      expect(state.aiState).toBe('idle');
      expect(state.connectionFlow).toBe('splash');
      expect(state.executionEntries).toEqual([]);
    });

    test('[P0] 5.8-UNIT-001: softReset() preserves isHostKeepAwake, hardReset() clears it', () => {
      // Given — keep-awake is active
      useAIStore.getState().setIsHostKeepAwake(true);
      expect(useAIStore.getState().isHostKeepAwake).toBe(true);

      // When — softReset() is called (e.g. on session disconnect)
      useAIStore.getState().softReset();
      // Then — isHostKeepAwake is preserved (same server)
      expect(useAIStore.getState().isHostKeepAwake).toBe(true);

      // When — hardReset() is called (e.g. forget connection)
      useAIStore.getState().hardReset();
      // Then — isHostKeepAwake is cleared (may connect to different server)
      expect(useAIStore.getState().isHostKeepAwake).toBe(false);
    });
  });

  describe('executionEntries (Story 5.3)', () => {
    test('[P0] 5.3-UNIT-001: initial executionEntries is empty array', () => {
      expect(useAIStore.getState().executionEntries).toEqual([]);
    });

    test('[P0] 5.3-UNIT-002: addExecutionEntry appends entry to array', () => {
      const entry = { id: 'e1', type: 'user_message' as const, content: 'hello', timestamp: 1000 };
      useAIStore.getState().addExecutionEntry(entry);
      expect(useAIStore.getState().executionEntries).toEqual([entry]);

      const entry2 = { id: 'e2', type: 'ai_response' as const, content: 'hi', timestamp: 1001 };
      useAIStore.getState().addExecutionEntry(entry2);
      expect(useAIStore.getState().executionEntries).toEqual([entry, entry2]);
    });

    test('[P0] 5.3-UNIT-003: updateExecutionEntry merges metadata without replacing', () => {
      const entry = {
        id: 'tc1',
        type: 'tool_call' as const,
        content: 'run_cmd({})',
        timestamp: 1000,
        metadata: { callId: 'c1', name: 'run_cmd', status: 'pending' },
      };
      useAIStore.getState().addExecutionEntry(entry);

      // Update only the status — callId and name should be preserved
      useAIStore.getState().updateExecutionEntry('tc1', {
        metadata: { status: 'success' },
      });

      const updated = useAIStore.getState().executionEntries[0];
      expect(updated.metadata).toEqual({ callId: 'c1', name: 'run_cmd', status: 'success' });
    });

    test('[P0] 5.3-UNIT-004: updateExecutionEntry merges top-level fields', () => {
      const entry = { id: 'e1', type: 'thinking' as const, content: 'Thinking...', timestamp: 1000 };
      useAIStore.getState().addExecutionEntry(entry);

      useAIStore.getState().updateExecutionEntry('e1', { content: 'Thought complete' });

      const updated = useAIStore.getState().executionEntries[0];
      expect(updated.content).toBe('Thought complete');
      expect(updated.type).toBe('thinking');
      expect(updated.timestamp).toBe(1000);
    });

    test('[P0] 5.3-UNIT-005: updateExecutionEntry preserves metadata when updates.metadata is undefined', () => {
      const entry = {
        id: 'tc1',
        type: 'tool_call' as const,
        content: 'test',
        timestamp: 1000,
        metadata: { callId: 'c1', status: 'pending' },
      };
      useAIStore.getState().addExecutionEntry(entry);

      // Update content only — metadata should stay intact
      useAIStore.getState().updateExecutionEntry('tc1', { content: 'updated' });

      const updated = useAIStore.getState().executionEntries[0];
      expect(updated.metadata).toEqual({ callId: 'c1', status: 'pending' });
    });

    test('[P0] 5.3-UNIT-006: updateExecutionEntry does nothing for non-matching id', () => {
      const entry = { id: 'e1', type: 'user_message' as const, content: 'hello', timestamp: 1000 };
      useAIStore.getState().addExecutionEntry(entry);

      useAIStore.getState().updateExecutionEntry('non-existent', { content: 'changed' });

      expect(useAIStore.getState().executionEntries[0].content).toBe('hello');
    });

    test('[P0] 5.3-UNIT-007: clearExecutionEntries sets array to empty', () => {
      useAIStore.getState().addExecutionEntry({ id: 'e1', type: 'user_message', content: 'a', timestamp: 1 });
      useAIStore.getState().addExecutionEntry({ id: 'e2', type: 'ai_response', content: 'b', timestamp: 2 });
      expect(useAIStore.getState().executionEntries).toHaveLength(2);

      useAIStore.getState().clearExecutionEntries();
      expect(useAIStore.getState().executionEntries).toEqual([]);
    });

    test('[P0] 5.3-UNIT-008: resetStore clears executionEntries', () => {
      useAIStore.getState().addExecutionEntry({ id: 'e1', type: 'user_message', content: 'a', timestamp: 1 });
      useAIStore.getState().resetStore();
      expect(useAIStore.getState().executionEntries).toEqual([]);
    });
  });

  describe('layout state (Story 5.2)', () => {
    test('[P0] 5.2-UNIT-001: initial layoutMode is "split-view"', () => {
      expect(useAIStore.getState().layoutMode).toBe('split-view');
    });

    test('[P0] 5.2-UNIT-002: initial orientation is "portrait"', () => {
      expect(useAIStore.getState().orientation).toBe('portrait');
    });

    test('[P0] 5.2-UNIT-003: initial preferred layouts match defaults', () => {
      const state = useAIStore.getState();
      expect(state.preferredPortraitLayout).toBe('split-view');
      expect(state.preferredLandscapeLayout).toBe('side-by-side');
    });

    test('[P0] 5.2-UNIT-004: setLayoutMode() updates layoutMode and preferred portrait layout when portrait', () => {
      // Given — orientation is portrait (default)
      expect(useAIStore.getState().orientation).toBe('portrait');

      // When — setLayoutMode is called
      useAIStore.getState().setLayoutMode('video-focus');

      // Then — layoutMode and preferred portrait layout update
      expect(useAIStore.getState().layoutMode).toBe('video-focus');
      expect(useAIStore.getState().preferredPortraitLayout).toBe('video-focus');
      // Landscape preference unchanged
      expect(useAIStore.getState().preferredLandscapeLayout).toBe('side-by-side');
    });

    test('[P0] 5.2-UNIT-005: setLayoutMode() updates preferred landscape layout when landscape', () => {
      // Given — orientation is landscape
      useAIStore.getState().setOrientation('landscape');

      // When — setLayoutMode is called with a landscape layout
      useAIStore.getState().setLayoutMode('fullscreen-video');

      // Then — landscapePreferred updates, portrait unchanged
      expect(useAIStore.getState().layoutMode).toBe('fullscreen-video');
      expect(useAIStore.getState().preferredLandscapeLayout).toBe('fullscreen-video');
      expect(useAIStore.getState().preferredPortraitLayout).toBe('split-view');
    });

    test('[P0] 5.2-UNIT-006: setOrientation() updates orientation', () => {
      useAIStore.getState().setOrientation('landscape');
      expect(useAIStore.getState().orientation).toBe('landscape');
    });

    test('[P0] 5.2-UNIT-007: resetStore() resets layout state to defaults', () => {
      // Given — store has non-default layout state
      useAIStore.getState().setOrientation('landscape');
      useAIStore.getState().setLayoutMode('fullscreen-video');

      // When — resetStore is called
      useAIStore.getState().resetStore();

      // Then — layout state reverts to defaults
      const state = useAIStore.getState();
      expect(state.layoutMode).toBe('split-view');
      expect(state.orientation).toBe('portrait');
      expect(state.preferredPortraitLayout).toBe('split-view');
      expect(state.preferredLandscapeLayout).toBe('side-by-side');
    });
  });

  describe('activeSession (Story 5.6)', () => {
    test('[P0] 5.6-UNIT-001: initial activeSession is null', () => {
      expect(useAIStore.getState().activeSession).toBeNull();
    });

    test('[P0] 5.6-UNIT-002: setActiveSession sets session', () => {
      useAIStore.getState().setActiveSession({
        id: 'abc',
        startTime: 1000,
        entryCount: 0,
        modelUsed: 'gemini-2.5-flash',
      });
      expect(useAIStore.getState().activeSession?.id).toBe('abc');
    });

    test('[P0] 5.6-UNIT-003: resetStore sets activeSession back to null', () => {
      useAIStore.getState().setActiveSession({
        id: 'abc',
        startTime: 1000,
        entryCount: 0,
        modelUsed: 'gemini-2.5-flash',
      });
      useAIStore.getState().resetStore();
      expect(useAIStore.getState().activeSession).toBeNull();
    });
  });

  describe('connectionFlow (Story 5.1)', () => {
    test('[P0] 5.1-UNIT-001: initial connectionFlow is "splash"', () => {
      expect(useAIStore.getState().connectionFlow).toBe('splash');
    });

    test('[P0] 5.1-UNIT-002: setConnectionFlow() updates state', () => {
      useAIStore.getState().setConnectionFlow('connect');
      expect(useAIStore.getState().connectionFlow).toBe('connect');

      useAIStore.getState().setConnectionFlow('reconnecting');
      expect(useAIStore.getState().connectionFlow).toBe('reconnecting');

      useAIStore.getState().setConnectionFlow('session');
      expect(useAIStore.getState().connectionFlow).toBe('session');
    });

    test('[P0] 5.1-UNIT-003: connecting status is supported', () => {
      useAIStore.getState().setConnectionStatus('connecting');
      expect(useAIStore.getState().connectionStatus).toBe('connecting');
    });
  });
});
