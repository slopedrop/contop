import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AIState, AuthMode, ConnectionStatus, ConnectionFlowState, ConnectionPath, ConnectionType, LayoutMode, Orientation, ExecutionEntry, ProviderAuth, SessionMeta, SuggestedAction } from '../types';

const MOBILE_AUTH_PREF_KEY = '@contop:mobile_auth_pref';

type ConfirmationResponseFn = (requestId: string, approved: boolean) => void;

type AIStore = {
  aiState: AIState;
  connectionStatus: ConnectionStatus;
  connectionPath: ConnectionPath;
  connectionType: ConnectionType | null;
  connectionFlow: ConnectionFlowState;
  executionEntries: ExecutionEntry[];
  layoutMode: LayoutMode;
  orientation: Orientation;
  preferredPortraitLayout: LayoutMode;
  preferredLandscapeLayout: LayoutMode;
  setAIState: (s: AIState) => void;
  setConnectionStatus: (s: ConnectionStatus) => void;
  setConnectionPath: (p: ConnectionPath) => void;
  setConnectionType: (t: ConnectionType | null) => void;
  setConnectionFlow: (s: ConnectionFlowState) => void;
  addExecutionEntry: (entry: ExecutionEntry) => void;
  updateExecutionEntry: (id: string, updates: Partial<ExecutionEntry>) => void;
  setExecutionEntries: (entries: ExecutionEntry[]) => void;
  clearExecutionEntries: () => void;
  setLayoutMode: (mode: LayoutMode) => void;
  activeSession: SessionMeta | null;
  isHostKeepAwake: boolean;
  setIsHostKeepAwake: (v: boolean) => void;
  setActiveSession: (session: SessionMeta | null) => void;
  restoreSession: (session: SessionMeta, entries: ExecutionEntry[]) => void;
  setOrientation: (o: Orientation) => void;
  isManualMode: boolean;
  manualModeActive: boolean;
  suggestedActions: SuggestedAction[];
  setManualMode: (enabled: boolean) => void;
  setManualModeActive: (active: boolean) => void;
  setSuggestedActions: (actions: SuggestedAction[]) => void;
  clearSuggestedActions: () => void;
  isAwayMode: boolean;
  setIsAwayMode: (v: boolean) => void;
  sendConfirmationResponse: ConfirmationResponseFn | null;
  setSendConfirmationResponse: (fn: ConfirmationResponseFn | null) => void;
  /** Provider auth config received from server (available = proxy is configured on desktop) */
  providerAuth: ProviderAuth | null;
  /** User's per-provider auth preference on mobile (persists user choice) */
  mobileAuthPreference: Record<string, AuthMode>;
  setProviderAuth: (auth: ProviderAuth) => void;
  setMobileAuthPreference: (provider: string, mode: AuthMode) => void;
  loadMobileAuthPreference: () => Promise<void>;
  /** Returns true if the given provider is both available (desktop configured) and user prefers subscription */
  isSubscriptionActive: (provider: string) => boolean;
  softReset: () => void;
  hardReset: () => void;
  resetStore: () => void;
};

const useAIStore = create<AIStore>((set, get) => ({
  aiState: 'idle',
  connectionStatus: 'disconnected',
  connectionPath: 'unknown',
  connectionType: null,
  connectionFlow: 'splash',
  executionEntries: [],
  layoutMode: 'split-view',
  orientation: 'portrait',
  activeSession: null,
  isHostKeepAwake: false,
  isManualMode: false,
  manualModeActive: true,
  suggestedActions: [],
  isAwayMode: false,
  sendConfirmationResponse: null,
  preferredPortraitLayout: 'split-view',
  preferredLandscapeLayout: 'side-by-side',
  providerAuth: null,
  mobileAuthPreference: {},
  setAIState: (aiState) => set({ aiState }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setConnectionPath: (connectionPath) => set({ connectionPath }),
  setConnectionType: (connectionType) => set({ connectionType }),
  setConnectionFlow: (connectionFlow) => set({ connectionFlow }),
  addExecutionEntry: (entry) =>
    set((state) => ({
      executionEntries: [...state.executionEntries, entry],
    })),
  updateExecutionEntry: (id, updates) =>
    set((state) => ({
      executionEntries: state.executionEntries.map((e) =>
        e.id === id
          ? {
              ...e,
              ...updates,
              metadata:
                updates.metadata !== undefined
                  ? { ...(e.metadata ?? {}), ...updates.metadata }
                  : e.metadata,
            }
          : e,
      ),
    })),
  setExecutionEntries: (entries) => set({ executionEntries: entries }),
  clearExecutionEntries: () => set({ executionEntries: [] }),
  setLayoutMode: (mode) => {
    const { orientation } = get();
    set((state) => ({
      layoutMode: mode,
      preferredPortraitLayout: orientation === 'portrait' ? mode : state.preferredPortraitLayout,
      preferredLandscapeLayout: orientation === 'landscape' ? mode : state.preferredLandscapeLayout,
    }));
  },
  setIsHostKeepAwake: (isHostKeepAwake) => set({ isHostKeepAwake }),
  setManualMode: (enabled) => {
    if (enabled) {
      set({ isManualMode: true, manualModeActive: true, aiState: 'manual', suggestedActions: [] });
    } else {
      // Don't force idle if the agent is mid-execution — let the server state_update resolve it
      const current = get().aiState;
      const restoreState = (current === 'manual') ? 'idle' : current;
      set({ isManualMode: false, manualModeActive: true, aiState: restoreState });
    }
  },
  setManualModeActive: (active) => set({ manualModeActive: active }),
  setSuggestedActions: (actions) => set({ suggestedActions: actions.slice(0, 4) }),
  clearSuggestedActions: () => set({ suggestedActions: [] }),
  setIsAwayMode: (isAwayMode) => set({ isAwayMode }),
  setSendConfirmationResponse: (fn) => set({ sendConfirmationResponse: fn }),
  setProviderAuth: (providerAuth) => set({ providerAuth }),
  setMobileAuthPreference: (provider, mode) => {
    set((state) => {
      const updated = { ...state.mobileAuthPreference, [provider]: mode };
      AsyncStorage.setItem(MOBILE_AUTH_PREF_KEY, JSON.stringify(updated)).catch(() => {});
      return { mobileAuthPreference: updated };
    });
  },
  loadMobileAuthPreference: async () => {
    try {
      const raw = await AsyncStorage.getItem(MOBILE_AUTH_PREF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, AuthMode>;
        set({ mobileAuthPreference: parsed });
      }
    } catch { /* ignore storage errors */ }
  },
  isSubscriptionActive: (provider) => {
    const state = get();
    const config = state.providerAuth?.[provider];
    return config?.available === true && state.mobileAuthPreference[provider] === 'cli_proxy';
  },
  setActiveSession: (activeSession) => set({ activeSession }),
  restoreSession: (session, entries) => set({ activeSession: session, executionEntries: entries }),
  setOrientation: (orientation) => set({ orientation }),
  softReset: () =>
    set({
      connectionStatus: 'disconnected',
      connectionPath: 'unknown',
      connectionType: null,
      aiState: 'idle',
      executionEntries: [],
      activeSession: null,
      isManualMode: false,
      manualModeActive: true,
      isAwayMode: false,
      suggestedActions: [],
      // isHostKeepAwake intentionally NOT reset — it's a global server setting
      sendConfirmationResponse: null,
    }),
  hardReset: () =>
    set({
      aiState: 'idle',
      connectionStatus: 'disconnected',
      connectionPath: 'unknown',
      connectionType: null,
      connectionFlow: 'splash',
      executionEntries: [],
      layoutMode: 'split-view',
      orientation: 'portrait',
      activeSession: null,
      isHostKeepAwake: false, // reset — may connect to a different server
      isManualMode: false,
      manualModeActive: true,
      isAwayMode: false,
      suggestedActions: [],
      sendConfirmationResponse: null,
      preferredPortraitLayout: 'split-view',
      preferredLandscapeLayout: 'side-by-side',
    }),
  resetStore: () =>
    set({
      aiState: 'idle',
      connectionStatus: 'disconnected',
      connectionPath: 'unknown',
      connectionType: null,
      connectionFlow: 'splash',
      executionEntries: [],
      layoutMode: 'split-view',
      orientation: 'portrait',
      activeSession: null,
      isHostKeepAwake: false, // full reset
      isManualMode: false,
      manualModeActive: true,
      isAwayMode: false,
      suggestedActions: [],
      sendConfirmationResponse: null,
      preferredPortraitLayout: 'split-view',
      preferredLandscapeLayout: 'side-by-side',
    }),
}));

export default useAIStore;
