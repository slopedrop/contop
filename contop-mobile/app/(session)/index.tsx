import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Pressable, StatusBar, Keyboard, Platform, AppState, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import useAIStore from '../../stores/useAIStore';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useConversation } from '../../hooks/useConversation';
import { getPairingToken, getAllApiKeys, clearPairingToken, clearAllApiKeys } from '../../services/secureStorage';
import { checkBiometricAvailability, authenticateWithBiometrics } from '../../services/biometrics';
import { RemoteScreen, ScreenContainer, Text, ViewLayoutManager, HamburgerMenu, ExecutionThread, ExecutionInputBar, QuickActionBar, ManualControlOverlay } from '../../components';
import { useVoiceCapture } from '../../hooks/useVoiceCapture';
import { useOrientation } from '../../hooks/useOrientation';
import { Ionicons } from '@expo/vector-icons';
import * as sessionStorage from '../../services/sessionStorage';
import { loadAISettings } from '../../services/aiSettings';
import { registerDeviceControlSender } from '../../services/deviceControl';
import { consumeTempPayload } from '../../services/tempPayloadBridge';
import type { DataChannelMessage, ExecutionEntry, LayoutMode, SessionMeta, ProviderAuth } from '../../types';

const generateId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

/** Build session_context entries from execution entries, including tool_summary prefix. */
function buildSessionContextEntries(entries: ExecutionEntry[]): { role: string; text: string }[] {
  return entries
    .filter((e) => e.type === 'user_message' || e.type === 'ai_response')
    .map((e) => {
      const role = e.type === 'user_message' ? 'user' : 'model';
      const ts = e.metadata?.toolSummary as string[] | undefined;
      const toolInfo = ts?.length ? `[Desktop agent used: ${ts.join('\n')}]\n\n` : '';
      return { role, text: toolInfo + e.content };
    });
}

function computeToolStats(entries: ExecutionEntry[]): {
  executed: number; blocked: number; errors: number;
  byTool?: Record<string, number>; byResult?: Record<string, number>;
} {
  const toolResults = entries.filter((e) => e.type === 'tool_result');
  const byTool: Record<string, number> = {};
  const byResult: Record<string, number> = {};
  for (const e of entries) {
    if (e.type !== 'agent_progress') continue;
    const tool = e.metadata?.tool as string | undefined;
    const result = e.metadata?.execution_result as string | undefined;
    if (tool) byTool[tool] = (byTool[tool] ?? 0) + 1;
    if (result) byResult[result] = (byResult[result] ?? 0) + 1;
  }
  return {
    executed: toolResults.filter((e) => e.metadata?.status === 'success').length,
    blocked: toolResults.filter((e) => e.metadata?.status === 'sandboxed').length,
    errors: toolResults.filter((e) => e.metadata?.status === 'error').length,
    byTool: Object.keys(byTool).length > 0 ? byTool : undefined,
    byResult: Object.keys(byResult).length > 0 ? byResult : undefined,
  };
}

export default function SessionScreen(): React.JSX.Element {
  const router = useRouter();
  const { connectionStatus, aiState, layoutMode, orientation, executionEntries = [], isManualMode, suggestedActions } = useAIStore();
  const { connect, disconnect, sendMessage, sendFastMessage, setOnDataChannelMessage, remoteStream } = useWebRTC();
  const { audioLevel, hasPermission, startCapture, stopCapture, getAudioBuffer } = useVoiceCapture();
  const conversation = useConversation();
  const [silentWindow, setSilentWindow] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isOverlayCollapsed, setIsOverlayCollapsed] = useState(false);
  const latestFrameRef = useRef<string | null>(null);
  const toolCallEntryMapRef = useRef<Map<string, string>>(new Map());
  const lastSentIntentRef = useRef<string | null>(null);
  const adkSessionIdRef = useRef<string | null>(null);
  const geminiConnectAttemptedRef = useRef(false);
  const persistDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentModel, setCurrentModel] = useState('');
  const [currentExecutionModel, setCurrentExecutionModel] = useState('');
  const [isSubscriptionOnly, setIsSubscriptionOnly] = useState(false);
  const [availableKeys, setAvailableKeys] = useState<Record<string, boolean>>({});

  const insets = useSafeAreaInsets();

  // Activate orientation detection - syncs orientation + preferred layout to Zustand
  useOrientation();

  // Reload current models on screen focus (e.g. returning from settings)
  useFocusEffect(
    useCallback(() => {
      loadAISettings().then((settings) => {
        setCurrentModel(settings.conversationModel);
        setCurrentExecutionModel(settings.executionModel);
        // Update active session's model if it changed
        const session = useAIStore.getState().activeSession;
        if (session && session.modelUsed !== settings.conversationModel) {
          useAIStore.getState().setActiveSession({ ...session, modelUsed: settings.conversationModel });
        }
      });
    }, []),
  );

  // Track keyboard height for manual keyboard avoidance (replaces KeyboardAvoidingView)
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Payload ref for AppState listener - must be initialized before the listener
  const payloadRef = useRef<import('../../types').PairingPayload | null>(null);
  useEffect(() => {
    getPairingToken().then((p) => { payloadRef.current = p; });
  }, []);

  // Biometric lock on app resume (permanent connections only)
  const [isLocked, setIsLocked] = useState(false);
  const backgroundedAtRef = useRef<number | null>(null);
  const LOCK_THRESHOLD_MS = 30_000; // 30 seconds

  useEffect(() => {
    const subscription = AppState.addEventListener?.('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAtRef.current = Date.now();
        return;
      }

      if (nextState === 'active' && backgroundedAtRef.current) {
        const elapsed = Date.now() - backgroundedAtRef.current;
        backgroundedAtRef.current = null;

        // Only lock permanent connections that were connected, and only after threshold
        const store = useAIStore.getState();
        const payload = payloadRef.current;
        const isTemp = payload?.connection_type === 'temp';
        if (!isTemp && elapsed >= LOCK_THRESHOLD_MS && store.connectionStatus === 'connected') {
          disconnect();
          setIsLocked(true);
        }
      }
    });
    return () => subscription?.remove();
  }, [disconnect]);

  async function handleUnlock() {
    const bio = await checkBiometricAvailability();
    if (bio.available && bio.enrolled) {
      const ok = await authenticateWithBiometrics();
      if (ok) {
        setIsLocked(false);
        router.replace('/(connect)/reconnecting');
        return;
      }
    } else {
      // Biometrics unavailable - bypass lock to prevent user being stuck
      setIsLocked(false);
      router.replace('/(connect)/reconnecting');
    }
  }

  useEffect(() => {
    ScreenOrientation.unlockAsync();
    // Initialize default layout for session
    useAIStore.getState().setLayoutMode('split-view');
    registerDeviceControlSender(sendMessage);

    async function initConnection() {
      // Check the in-memory bridge first - the reconnecting screen passes the
      // correct payload (temp OR permanent) via the bridge before navigating here.
      // Fall back to SecureStore (permanent-only) if no bridge payload exists.
      const bridgePayload = consumeTempPayload();
      const payload = bridgePayload ?? await getPairingToken();
      if (!payload) {
        router.replace({
          pathname: '/(connect)/connect',
          params: { message: 'Session token missing or expired. Please pair again.' },
        });
        return;
      }

      // Track which providers have API keys for per-model indicators
      const keys = await getAllApiKeys();
      setAvailableKeys({
        gemini: !!keys.gemini,
        openai: !!keys.openai,
        anthropic: !!keys.anthropic,
        openrouter: !!keys.openrouter,
      });

      // Flag subscription-only mode so UI can show a hint to rescan for API keys
      const hasAnyKey = Object.values(keys).some((k) => !!k);
      const hasSubscriptionProvider = payload.pa && (payload.pa.g || payload.pa.a || payload.pa.o);
      if (!hasAnyKey && hasSubscriptionProvider) {
        setIsSubscriptionOnly(true);
      }

      // Restore provider auth from stored payload so subscription mode is active
      // before the WebRTC state_update arrives
      if (payload.pa) {
        const providerAuth: ProviderAuth = {
          gemini: { mode: payload.pa.g === 'sub' ? 'cli_proxy' : 'api_key', available: payload.pa.g === 'sub' },
          anthropic: { mode: payload.pa.a === 'sub' ? 'cli_proxy' : 'api_key', available: payload.pa.a === 'sub' },
          openai: { mode: payload.pa.o === 'sub' ? 'cli_proxy' : 'api_key', available: payload.pa.o === 'sub' },
        };
        useAIStore.getState().setProviderAuth(providerAuth);
        const existingPrefs = useAIStore.getState().mobileAuthPreference;
        if (payload.pa.g === 'sub' && !existingPrefs.gemini) useAIStore.getState().setMobileAuthPreference('gemini', 'cli_proxy');
        if (payload.pa.a === 'sub' && !existingPrefs.anthropic) useAIStore.getState().setMobileAuthPreference('anthropic', 'cli_proxy');
        if (payload.pa.o === 'sub' && !existingPrefs.openai) useAIStore.getState().setMobileAuthPreference('openai', 'cli_proxy');
      }

      try {
        useAIStore.getState().setConnectionStatus('connecting');
        await connect(payload);
      } catch {
        // Bug fix 6.1: redirect to connect screen instead of silent failure
        router.replace({
          pathname: '/(connect)/connect',
          params: { message: 'Connection failed. Please try again.' },
        });
      }
    }

    initConnection();

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      conversation.close();
      disconnect();
      registerDeviceControlSender(null);
      // Clear persist debounce on unmount
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run once on mount
  }, []);

  // Wire confirmation response sender so InterventionCard can send via data channel
  useEffect(() => {
    useAIStore.getState().setSendConfirmationResponse((requestId, approved) => {
      sendMessage('agent_confirmation_response', { request_id: requestId, approved });
    });
    return () => {
      useAIStore.getState().setSendConfirmationResponse(null);
    };
  }, [sendMessage]);

  // Wire data channel send function and tool call callback to Gemini
  useEffect(() => {
    conversation.setSendDataChannelMessage(sendMessage);
    conversation.setOnToolCall((name, callId, args) => {
      const entryId = generateId();
      toolCallEntryMapRef.current.set(callId, entryId);
      useAIStore.getState().addExecutionEntry({
        id: entryId,
        type: 'tool_call',
        content: `${name}(${JSON.stringify(args)})`,
        timestamp: Date.now(),
        metadata: { callId, name, status: 'pending' },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSendDataChannelMessage/setOnToolCall are stable useCallback refs
  }, [sendMessage]);

  // Bridge data channel messages (frame, tool_result) to Gemini
  useEffect(() => {
    setOnDataChannelMessage((message: DataChannelMessage) => {
      if (message.type === 'frame') {
        const jpegBase64 = message.payload?.jpeg_b64 as string;
        if (jpegBase64) {
          latestFrameRef.current = jpegBase64;
        }
      } else if (message.type === 'tool_result') {
        const callId = message.payload?.gemini_call_id as string;
        const name = message.payload?.name as string;
        const result = (message.payload?.result as Record<string, unknown>) ?? {};
        if (callId && name) {
          conversation.handleToolResult(callId, name, result);

          // Update corresponding tool_call entry status
          const resultStatus = (result.execution_result === 'sandboxed') ? 'sandboxed'
            : (result.error || result.execution_result === 'error') ? 'error' : 'success';
          const toolCallEntryId = toolCallEntryMapRef.current.get(callId);
          if (toolCallEntryId) {
            useAIStore.getState().updateExecutionEntry(toolCallEntryId, {
              metadata: { status: resultStatus },
            });
            toolCallEntryMapRef.current.delete(callId);
          }
          // Add tool_result entry
          useAIStore.getState().addExecutionEntry({
            id: generateId(),
            type: 'tool_result',
            content: JSON.stringify(result.output ?? result),
            timestamp: Date.now(),
            metadata: { callId, name, status: resultStatus },
          });
        }
      } else if (message.type === 'agent_result') {
        // Display execution agent output directly to user (no extra API call).
        const answer = (message.payload?.answer as string) ?? '';
        const stepsTaken = (message.payload?.steps_taken as number) ?? 0;
        const durationMs = (message.payload?.duration_ms as number) ?? 0;
        const toolSummary = (message.payload?.tool_summary as string[]) ?? undefined;
        // Persist ADK session ID for session restoration after server restart
        const adkSessionId = message.payload?.session_id as string | undefined;
        if (adkSessionId) {
          adkSessionIdRef.current = adkSessionId;
          // Save to session meta so it survives screen remounts and app restarts
          const session = useAIStore.getState().activeSession;
          if (session && session.adkSessionId !== adkSessionId) {
            const updated = { ...session, adkSessionId };
            useAIStore.getState().setActiveSession(updated);
            void sessionStorage.upsertSessionMeta(updated);
          }
        }
        if (lastSentIntentRef.current) {
          const intentText = lastSentIntentRef.current;
          lastSentIntentRef.current = null;
          // Syncs history and fires onTextResponse callback
          conversation.processAgentResult(intentText, answer, stepsTaken, durationMs, toolSummary);
        } else if (answer) {
          // Reconnection case: intent ref was lost but server completed execution.
          const store = useAIStore.getState();
          const kept = store.executionEntries.filter((e) => e.type !== 'thinking');
          store.setExecutionEntries(kept);
          store.addExecutionEntry({
            id: generateId(),
            type: 'ai_response',
            content: answer,
            timestamp: Date.now(),
          });
          store.setAIState('idle');
        }
      } else if (message.type === 'device_control_result') {
        const status = message.payload?.status as string;
        const msg = message.payload?.message as string;
        useAIStore.getState().addExecutionEntry({
          id: generateId(),
          type: 'tool_result',
          content: msg ?? (status === 'success' ? 'Done' : 'Error'),
          timestamp: Date.now(),
          metadata: { name: 'device_control', status: status === 'success' ? 'success' : 'error' },
        });
      } else if (
        message.type === 'conversation_response' ||
        message.type === 'conversation_stream_delta' ||
        message.type === 'conversation_stream_end'
      ) {
        conversation.handleDataChannelMessage(
          message.type,
          message.payload as Record<string, unknown>,
        );
      }
    });

    return () => setOnDataChannelMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleToolResult is a stable useCallback ref
  }, [setOnDataChannelMessage]);

  // Initialize Gemini AI instance when WebRTC connects, or re-initialize
  // on disconnect for chat-only mode (conversational model without desktop).
  useEffect(() => {
    if (connectionStatus === 'connected' && !geminiConnectAttemptedRef.current) {
      geminiConnectAttemptedRef.current = true;
      conversation.connect();
    } else if (connectionStatus === 'disconnected') {
      // Re-initialize conversational model for chat-only mode, but only once per disconnect
      if (geminiConnectAttemptedRef.current) {
        geminiConnectAttemptedRef.current = false;
        conversation.connect();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect is a stable useCallback ref; guard via ref prevents loops
  }, [connectionStatus]);

  // Create session in memory when WebRTC connects (NOT persisted until first entry)
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    const existingSession = useAIStore.getState().activeSession;
    // Reconnection: existing session with entries → rebuild Gemini context and
    // sync conversation backstory to the fresh server-side ADK agent.
    if (existingSession) {
      const entries = useAIStore.getState().executionEntries;
      if (entries.length > 0) {
        // Restore ADK session ID from persisted meta if ref was lost (screen remount / app restart)
        if (!adkSessionIdRef.current && existingSession.adkSessionId) {
          adkSessionIdRef.current = existingSession.adkSessionId;
        }
        conversation.restoreHistory(entries);
        sendMessage('session_context', {
          adk_session_id: adkSessionIdRef.current,
          entries: buildSessionContextEntries(entries),
        });
      }
      return;
    }
    async function init() {
      const aiSettings = await loadAISettings();
      // M2: re-check after async load - user may have disconnected during settings fetch
      if (useAIStore.getState().connectionStatus !== 'connected') return;
      if (useAIStore.getState().activeSession) return;
      const newSession: SessionMeta = {
        id: generateId(),
        startTime: Date.now(),
        entryCount: 0,
        modelUsed: aiSettings.conversationModel,
        connectionType: useAIStore.getState().connectionType ?? 'permanent',
      };
      useAIStore.getState().setActiveSession(newSession);
    }
    void init();
    // Don't persist yet - the debounced subscription will save on first entry
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fires only when connectionStatus changes to 'connected'
  }, [connectionStatus]);

  // Debounced persistence via Zustand subscription (avoids re-renders)
  useEffect(() => {
    const unsubscribe = useAIStore.subscribe((state, prevState) => {
      if (state.executionEntries === prevState.executionEntries) return;
      const session = state.activeSession;
      if (!session || state.executionEntries.length === 0) return;
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = setTimeout(() => {
        const toolStats = computeToolStats(state.executionEntries);
        void sessionStorage.saveSessionEntries(session.id, state.executionEntries);
        void sessionStorage.upsertSessionMeta({ ...session, entryCount: state.executionEntries.length, toolStats });
      }, 500);
    });
    return () => {
      unsubscribe();
      if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    };
  }, []); // intentional empty deps - set up once on mount

  // Reset or restore Gemini history when activeSession changes
  // (e.g., from history "Continue" or "New Session") to prevent context leak.
  const activeSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const unsubscribe = useAIStore.subscribe((state) => {
      const newId = state.activeSession?.id ?? null;
      if (activeSessionRef.current && newId && newId !== activeSessionRef.current) {
        // Clear stale mappings from the previous session
        toolCallEntryMapRef.current.clear();
        if (state.executionEntries.length > 0) {
          // Restored from history - rebuild Gemini context from saved entries
          conversation.restoreHistory(state.executionEntries);
          // Restore ADK session ID so the server can resume the execution session
          adkSessionIdRef.current = state.activeSession?.adkSessionId ?? null;
          sendMessage('session_context', {
            adk_session_id: adkSessionIdRef.current,
            entries: buildSessionContextEntries(state.executionEntries),
          });
        } else {
          conversation.resetHistory();
          sendMessage('new_session', {});
          adkSessionIdRef.current = null;
        }
      }
      activeSessionRef.current = newId;
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs
  }, []);

  // On disconnect: stop voice, expire pending confirmations, enable chat-only mode.
  // The server kills execution on disconnect, so any pending confirmation
  // cards are stale - mark them expired so the UI stops showing action buttons.
  useEffect(() => {
    if (connectionStatus === 'disconnected') {
      stopCapture();
      setIsVoiceActive(false);
      const store = useAIStore.getState();
      // Reset aiState to idle so input bar and chat-only mode work
      if (store.aiState === 'disconnected' || store.aiState === 'executing' || store.aiState === 'processing') {
        store.setAIState('idle');
      }
      // Single-pass mutation: expire confirmations, cancel running steps, remove thinking.
      // Using one setExecutionEntries call avoids earlier updateExecutionEntry changes
      // being overwritten by a subsequent setExecutionEntries.
      const entries = store.executionEntries;
      if (entries.length > 0) {
        const hasThinking = entries.some((e) => e.type === 'thinking');
        const hasPending = entries.some((e) => e.type === 'agent_confirmation' && e.metadata?.status === 'pending');
        const hasRunning = entries.some((e) => e.type === 'agent_progress' && e.metadata?.status === 'running');
        if (hasThinking || hasPending || hasRunning) {
          const updated = entries
            .filter((e) => e.type !== 'thinking')
            .map((e) => {
              if (e.type === 'agent_confirmation' && e.metadata?.status === 'pending') {
                return { ...e, metadata: { ...e.metadata, status: 'expired' } };
              }
              if (e.type === 'agent_progress' && e.metadata?.status === 'running') {
                return { ...e, metadata: { ...e.metadata, status: 'cancelled' } };
              }
              return e;
            });
          store.setExecutionEntries(updated);
        }
      }
    }
  }, [connectionStatus, stopCapture]);

  // Receive text responses from Gemini
  useEffect(() => {
    conversation.setOnTextResponse((text: string, toolSummary?: string[]) => {
      const store = useAIStore.getState();
      // Remove stale thinking placeholder - we now have an actual response
      const kept = store.executionEntries.filter((e) => e.type !== 'thinking');
      store.setExecutionEntries(kept);
      store.addExecutionEntry({
        id: generateId(),
        type: 'ai_response',
        content: text,
        timestamp: Date.now(),
        metadata: toolSummary?.length ? { toolSummary } : undefined,
      });
    });
    return () => conversation.setOnTextResponse(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOnTextResponse is a stable useCallback ref
  }, []);

  // Receive error messages from Gemini and display as error cards
  useEffect(() => {
    conversation.setOnError((message: string) => {
      // Infer error_code from the classified message for icon selection
      const msgLower = message.toLowerCase();
      let errorCode = 'unknown_error';
      if (msgLower.includes('network')) errorCode = 'network_error';
      else if (msgLower.includes('rate limit')) errorCode = 'rate_limit';
      else if (msgLower.includes('api key')) errorCode = 'auth_error';
      else if (msgLower.includes('model not found')) errorCode = 'model_not_found';
      else if (msgLower.includes('timed out') || msgLower.includes('timeout')) errorCode = 'timeout';
      else if (msgLower.includes('quota')) errorCode = 'quota_exceeded';

      useAIStore.getState().addExecutionEntry({
        id: generateId(),
        type: 'agent_result',
        content: message,
        timestamp: Date.now(),
        metadata: { error_code: errorCode },
      });
    });
    return () => conversation.setOnError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOnError is a stable useCallback ref
  }, []);

  // Enter voice mode: start audio capture
  const handleMicPress = useCallback(() => {
    startCapture();
    setIsVoiceActive(true);
    useAIStore.getState().setAIState('recording');
  }, [startCapture]);

  // Exit voice mode: discard recording, back to text input
  const handleVoiceCancel = useCallback(() => {
    stopCapture();
    getAudioBuffer(); // discard accumulated audio
    setIsVoiceActive(false);
    useAIStore.getState().setAIState('idle');
  }, [stopCapture, getAudioBuffer]);

  // Stop recording, transcribe audio, and exit voice mode
  const handleVoiceSend = useCallback(async () => {
    await stopCapture();
    const chunks = getAudioBuffer();
    setIsVoiceActive(false);
    useAIStore.getState().setAIState('idle');
    if (chunks.length === 0) return;
    setIsTranscribing(true);
    const transcription = await conversation.transcribeAudio(chunks);
    setIsTranscribing(false);
    if (transcription) {
      setChatInput(transcription);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transcribeAudio is a stable useCallback ref
  }, [stopCapture, getAudioBuffer]);

  // Send text message to server-side ADK agent
  const handleSend = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    Keyboard.dismiss();
    // Remove only the previous "thinking" placeholder - keep all conversation and desktop agent entries
    const store = useAIStore.getState();
    const kept = store.executionEntries.filter((e) => e.type !== 'thinking');
    store.setExecutionEntries(kept);
    store.addExecutionEntry({ id: generateId(), type: 'user_message', content: text, timestamp: Date.now() });
    store.addExecutionEntry({ id: generateId(), type: 'thinking', content: 'Thinking...', timestamp: Date.now() + 1 });
    setChatInput('');
    lastSentIntentRef.current = text;
    conversation.sendUserIntent(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendUserIntent is a stable useCallback ref
  }, [chatInput]);

  // Undo last action: inject "Undo the last action" as a user message (subtask 6.1)
  const handleUndo = useCallback(() => {
    Keyboard.dismiss();
    const store = useAIStore.getState();
    const kept = store.executionEntries.filter((e) => e.type !== 'thinking');
    store.setExecutionEntries(kept);
    store.addExecutionEntry({ id: generateId(), type: 'user_message', content: 'Undo the last action', timestamp: Date.now() });
    store.addExecutionEntry({ id: generateId(), type: 'thinking', content: 'Thinking...', timestamp: Date.now() + 1 });
    lastSentIntentRef.current = 'Undo the last action';
    conversation.sendUserIntent('Undo the last action');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sendUserIntent is a stable useCallback ref
  }, []);

  // Send execution_stop to server to cancel running tool call.
  // Optimistic UI: set idle immediately so the stop button is responsive,
  // then the server's state_update confirmation will reinforce the state.
  const handleStopExecution = useCallback(() => {
    sendMessage('execution_stop', { reason: 'user_cancelled' });
    useAIStore.getState().setAIState('idle');
  }, [sendMessage]);

  // ── Manual control ─────────────────────────────────────────────────────
  const handleToggleManualMode = useCallback(() => {
    const { isManualMode, aiState: currentState } = useAIStore.getState();
    if (!isManualMode) {
      if (currentState === 'processing' || currentState === 'executing') {
        sendMessage('execution_stop', { reason: 'manual_takeover' });
      }
      useAIStore.getState().setManualMode(true);
      sendMessage('set_manual_mode', { enabled: true });
    } else {
      useAIStore.getState().setManualMode(false);
      sendMessage('set_manual_mode', { enabled: false });
    }
  }, [sendMessage]);

  // Auto-disable manual mode when leaving landscape
  useEffect(() => {
    if (orientation !== 'landscape' && isManualMode) {
      useAIStore.getState().setManualMode(false);
      sendMessage('set_manual_mode', { enabled: false });
    }
  }, [orientation, isManualMode, sendMessage]);

  // HUD mic: in video-focus, capture voice directly and send without confirmation.
  // First press starts recording; second press stops, transcribes, and sends - stays in video-focus.
  const handleHudMicPress = useCallback(async () => {
    if (isVoiceActive) {
      // Stop recording → transcribe → send directly (no confirmation)
      await stopCapture();
      const chunks = getAudioBuffer();
      setIsVoiceActive(false);
      useAIStore.getState().setAIState('idle');
      if (chunks.length === 0) return;

      setIsTranscribing(true);
      const transcription = await conversation.transcribeAudio(chunks);
      setIsTranscribing(false);

      if (transcription) {
        // Ensure overlay panel is visible before adding entries
        setIsOverlayCollapsed(false);
        // Remove only the previous "thinking" placeholder - keep all entries
        const store = useAIStore.getState();
        const kept = store.executionEntries.filter((e) => e.type !== 'thinking');
        store.setExecutionEntries(kept);
        store.addExecutionEntry({
          id: generateId(),
          type: 'user_message',
          content: transcription,
          timestamp: Date.now(),
        });
        store.addExecutionEntry({
          id: generateId(),
          type: 'thinking',
          content: 'Thinking...',
          timestamp: Date.now() + 1,
        });
        lastSentIntentRef.current = transcription;
        conversation.sendUserIntent(transcription);
      }
      // Stay in video-focus - no layout change
    } else {
      // Start recording - stay in video-focus
      startCapture();
      setIsVoiceActive(true);
      useAIStore.getState().setAIState('recording');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transcribeAudio/sendUserIntent are stable useCallback refs
  }, [isVoiceActive, startCapture, stopCapture, getAudioBuffer]);

  // Silent window timer: when entering 'reconnecting', hide UI changes for 2s
  useEffect(() => {
    if (connectionStatus === 'reconnecting') {
      setSilentWindow(true);
      const timer = setTimeout(() => {
        setSilentWindow(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
    // Reset silent window when not reconnecting
    setSilentWindow(true);
  }, [connectionStatus]);


  async function handleNewSession() {
    // FR29: gracefully close current session before starting a new one
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = null;
    }
    const session = useAIStore.getState().activeSession;
    if (session) {
      const finalEntries = useAIStore.getState().executionEntries;
      if (finalEntries.length > 0) {
        const toolStats = computeToolStats(finalEntries);
        await sessionStorage.saveSessionEntries(session.id, finalEntries);
        await sessionStorage.upsertSessionMeta({ ...session, entryCount: finalEntries.length, toolStats });
        await sessionStorage.finalizeSession(session.id, Date.now());
      }
    }
    // Clear thread and reset AI state for fresh session.
    // Note: resetHistory + sendMessage('new_session') are handled by the
    // activeSession subscription when setActiveSession fires below with empty entries.
    useAIStore.getState().setAIState('idle');
    useAIStore.getState().clearExecutionEntries();
    toolCallEntryMapRef.current.clear();
    const aiSettings = await loadAISettings();
    const newSession: SessionMeta = {
      id: generateId(),
      startTime: Date.now(),
      entryCount: 0,
      modelUsed: aiSettings.conversationModel,
      connectionType: useAIStore.getState().connectionType ?? 'permanent',
    };
    useAIStore.getState().setActiveSession(newSession);
  }

  async function handleLeaveSession() {
    // Flush pending debounce and finalize session
    if (persistDebounceRef.current) {
      clearTimeout(persistDebounceRef.current);
      persistDebounceRef.current = null;
    }
    const session = useAIStore.getState().activeSession;
    if (session) {
      const finalEntries = useAIStore.getState().executionEntries;
      if (finalEntries.length > 0) {
        const toolStats = computeToolStats(finalEntries);
        await sessionStorage.saveSessionEntries(session.id, finalEntries);
        await sessionStorage.upsertSessionMeta({ ...session, entryCount: finalEntries.length, toolStats });
        await sessionStorage.finalizeSession(session.id, Date.now());
      }
      useAIStore.getState().setActiveSession(null);
    }
    // Bug fix 6.5: explicitly stop voice capture before disconnect
    stopCapture();
    setIsVoiceActive(false);
    useAIStore.getState().clearExecutionEntries();
    toolCallEntryMapRef.current.clear();
    conversation.close();
    disconnect();
    // Credentials are preserved - user will see "Reconnect" on the connect screen.
    // Only "Forget Connection" in settings should clear credentials.
    router.replace('/(connect)/connect');
  }

  async function handleRetry() {
    // Reset stale state from failed connection before retrying
    const store = useAIStore.getState();
    store.setAIState('idle');
    store.setConnectionStatus('connecting');
    const payload = await getPairingToken();
    if (payload) {
      try {
        await connect(payload);
      } catch {
        // Connection failed - fall back to disconnected
        useAIStore.getState().setConnectionStatus('disconnected');
      }
    } else {
      store.setConnectionStatus('disconnected');
    }
  }

  // Undo button visibility: true only if an undoable tool (execute_cli, execute_gui,
  // execute_computer_use) has completed. Informational tools (observe_screen, etc.) are no-ops.
  const hasHistory = useMemo(() => executionEntries.some(
    (e) => e.type === 'agent_progress'
      && e.metadata?.status === 'completed'
      && ['execute_cli', 'execute_gui', 'execute_computer_use'].includes(e.metadata?.tool as string),
  ), [executionEntries]);

  const hasVideoStream = !!remoteStream;
  const isConnecting = connectionStatus === 'connecting';
  const isReconnectingSilent = connectionStatus === 'reconnecting' && silentWindow;
  const isReconnectingVisible = connectionStatus === 'reconnecting' && !silentWindow;
  const isConnectionLost = connectionStatus === 'disconnected' && aiState === 'disconnected';
  const isConnected = connectionStatus === 'connected';
  const isDisconnected = connectionStatus === 'disconnected';

  // Connection path label for the pill
  const connectionPath = useAIStore((s) => s.connectionPath);
  const connectionType = useAIStore((s) => s.connectionType);
  const pathLabel = connectionPath === 'lan' ? 'LAN'
    : connectionPath === 'tailscale' ? 'Tailscale'
      : connectionPath === 'tunnel' ? 'Tunnel'
        : '';

  // Connection status pill - small glassmorphic indicator in the video overlay
  function renderConnectionPill() {
    if (isConnected) {
      const isTemp = connectionType === 'temp';
      const pillLabel = isTemp ? `Temp \u00B7 ${pathLabel}` : `Connected \u00B7 ${pathLabel}`;
      const dotStyle = isTemp ? pillStyles.dotTemp : pillStyles.dotConnected;

      return (
        <View className="absolute top-3 right-3" style={{ zIndex: 20 }}>
          <View testID="connection-pill" style={pillStyles.pill}>
            <View testID="connection-dot" style={[pillStyles.dot, dotStyle]} />
            <Text testID="connection-status" style={pillStyles.pillText}>{pillLabel}</Text>
          </View>
        </View>
      );
    }

    // Silent window: show "Connected" to mask brief reconnection (< 2s)
    if (isReconnectingSilent) {
      return (
        <View className="absolute top-3 right-3">
          <View testID="connection-pill" style={pillStyles.pill}>
            <View testID="connection-dot" style={[pillStyles.dot, pillStyles.dotConnected]} />
            <Text testID="connection-status" style={pillStyles.pillText}>Connected</Text>
          </View>
        </View>
      );
    }

    // After silent window: show reconnecting with dismiss option
    if (isReconnectingVisible) {
      return (
        <View className="absolute top-3 right-3 flex-row items-center gap-2">
          <View testID="reconnecting-banner" style={[pillStyles.pill, pillStyles.pillWarning]}>
            <View testID="connection-dot" style={[pillStyles.dot, pillStyles.dotReconnecting]} />
            <Text style={pillStyles.pillText}>Reconnecting...</Text>
          </View>
          <Pressable
            testID="cancel-reconnection-button"
            onPress={handleLeaveSession}
            style={pillStyles.dismissButton}
          >
            <Ionicons name="close" size={16} color="#EF4444" />
          </Pressable>
        </View>
      );
    }

    return null;
  }

  // Inline connection pill for thread-focus mode (no absolute positioning)
  function renderConnectionPillInline() {
    if (isConnected) {
      const isTemp = connectionType === 'temp';
      const pillLabel = isTemp ? `Temp \u00B7 ${pathLabel}` : `Connected \u00B7 ${pathLabel}`;
      const dotStyle = isTemp ? pillStyles.dotTemp : pillStyles.dotConnected;
      return (
        <View testID="connection-pill-inline" style={pillStyles.pill}>
          <View style={[pillStyles.dot, dotStyle]} />
          <Text style={pillStyles.pillText}>{pillLabel}</Text>
        </View>
      );
    }
    if (isReconnectingSilent) {
      return (
        <View testID="connection-pill-inline" style={pillStyles.pill}>
          <View style={[pillStyles.dot, pillStyles.dotConnected]} />
          <Text style={pillStyles.pillText}>Connected</Text>
        </View>
      );
    }
    if (isReconnectingVisible) {
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View testID="connection-pill-inline" style={[pillStyles.pill, pillStyles.pillWarning]}>
            <View style={[pillStyles.dot, pillStyles.dotReconnecting]} />
            <Text style={pillStyles.pillText}>Reconnecting...</Text>
          </View>
          <Pressable onPress={handleLeaveSession} style={pillStyles.dismissButton}>
            <Ionicons name="close" size={16} color="#EF4444" />
          </Pressable>
        </View>
      );
    }
    return null;
  }

  // Full-screen state overlays (connecting, waiting for video, disconnected placeholder)
  function renderStateOverlay() {
    if (isDisconnected || connectionStatus === 'reconnecting' || isConnecting) {
      return (
        <View className="flex-1 items-center justify-center">
          <Ionicons name="desktop-outline" size={48} color="rgba(255,255,255,0.25)" />
          <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 8 }}>
            Video not available
          </Text>
        </View>
      );
    }

    if (isConnected && !hasVideoStream) {
      const isTemp = connectionType === 'temp';
      return (
        <View className="flex-1 items-center justify-center">
          {isTemp && (
            <View testID="temp-badge" style={pillStyles.tempBadge}>
              <Text style={pillStyles.tempBadgeText}>Temp Session</Text>
            </View>
          )}
          <Text testID="connection-status" className="text-lg">
            Connected{pathLabel ? ` via ${pathLabel}` : ''}
          </Text>
          <Text className="text-sm text-gray-400 mt-2">Waiting for video stream...</Text>
          <Pressable
            testID="disconnect-button"
            onPress={handleLeaveSession}
            className="mt-6 px-8 py-2 bg-white/10 rounded-xl"
          >
            <Text className="text-sm font-medium text-gray-300">Disconnect</Text>
          </Pressable>
        </View>
      );
    }

    // Connected with video - handled by renderConnectionPill()
    return null;
  }

  // Derive RemoteScreen display mode from current layout
  const isCompactVideo = layoutMode === 'thread-focus';
  const isFillVideo = layoutMode === 'video-focus' || layoutMode === 'fullscreen-video';
  const isOverlayMode = isFillVideo;
  const isLandscape = orientation === 'landscape';

  // HUD pill state label - reflects actual aiState (not hardcoded)
  const hudStateLabel =
    aiState === 'processing' ? 'Thinking'
      : aiState === 'executing' ? 'Executing'
        : aiState === 'recording' ? 'Recording'
          : aiState === 'listening' ? 'Listening'
            : aiState === 'manual' ? 'Manual'
              : 'Ready';
  const showHudStopButton = aiState === 'processing' || aiState === 'executing';

  // Navigate from overlay/HUD to split view for full interaction
  const handleHudPress = useCallback(() => {
    const { orientation } = useAIStore.getState();
    useAIStore.getState().setLayoutMode(
      orientation === 'portrait' ? 'split-view' : 'side-by-side',
    );
  }, []);

  // Video content: RemoteScreen with connection pill + state overlays + HUD pill
  // In thread-focus: controls render OUTSIDE ViewLayoutManager (see return JSX below)
  // to avoid being clipped by the 160px miniVideoCard overflow:hidden.
  const videoContent = (
    <View style={{ flex: 1 }} onTouchStart={() => Keyboard.dismiss()}>
      <RemoteScreen
        stream={remoteStream}
        fillViewport={isFillVideo}
        compact={isCompactVideo}
      >
        {!isCompactVideo && (
          <>
            <View style={pillStyles.buttonRow}>
              <HamburgerMenu
                onNewSession={handleNewSession}
                onHistory={() => router.push('./history')}
                onSettings={() => router.push('./settings')}
                onDisconnect={handleLeaveSession}
              />
            </View>
            {renderConnectionPill()}
          </>
        )}
        {renderStateOverlay()}
      </RemoteScreen>
    </View>
  );

  // Thread content: empty in immersive overlay modes (overlay rendered separately), full UI otherwise.
  // Also shown when disconnected (chat-only mode - user can still talk to conversational model).
  const isReconnecting = connectionStatus === 'reconnecting';
  const showThread = (isConnected && !isOverlayMode) || isDisconnected || isReconnecting || isConnecting;
  const threadContent = (
    <>
      {showThread ? (
        <>
          {hasPermission === false && isConnected && (
            <View testID="mic-permission-banner" className="px-4 pt-2 items-center">
              <Text className="text-sm text-amber-warn text-center">
                Microphone access denied. Grant permission in Settings for voice commands.
              </Text>
            </View>
          )}
          {isSubscriptionOnly && isConnected && (
            <View testID="subscription-only-banner" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(245,158,11,0.08)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(245,158,11,0.2)' }}>
              <Ionicons name="information-circle-outline" size={16} color="#F59E0B" />
              <Text style={{ color: '#D97706', fontSize: 12, flex: 1 }}>
                No API keys - using subscription only. Rescan QR if you add keys on desktop.
              </Text>
            </View>
          )}
          {isDisconnected && (
            <View testID="disconnected-banner" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(239,68,68,0.1)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(239,68,68,0.3)' }}>
              <Ionicons name="cloud-offline" size={16} color="#EF4444" />
              <Text style={{ color: '#EF4444', fontSize: 13, flex: 1 }}>
                Offline - chat-only mode (no desktop access)
              </Text>
              <Pressable testID="retry-button" onPress={handleRetry} style={{ paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(9,91,185,0.8)', borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Retry</Text>
              </Pressable>
              <Pressable testID="disconnect-button" onPress={handleLeaveSession} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <Ionicons name="close" size={16} color="#EF4444" />
              </Pressable>
            </View>
          )}
          {isReconnecting && !silentWindow && (
            <View testID="reconnecting-thread-banner" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(245,158,11,0.1)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(245,158,11,0.3)' }}>
              <Ionicons name="cloud-offline" size={16} color="#F59E0B" />
              <Text style={{ color: '#F59E0B', fontSize: 13, flex: 1 }}>
                Reconnecting - chat-only mode (no desktop access)
              </Text>
              <Pressable testID="cancel-reconnect-button" onPress={handleLeaveSession} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <Ionicons name="close" size={16} color="#EF4444" />
              </Pressable>
            </View>
          )}
          {isConnecting && (
            <View testID="connecting-thread-banner" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(9,91,185,0.1)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(9,91,185,0.3)' }}>
              <Ionicons name="wifi-outline" size={16} color="#095BB9" />
              <Text style={{ color: '#095BB9', fontSize: 13, flex: 1 }}>
                Connecting - chat-only mode (no desktop access)
              </Text>
              <Pressable testID="cancel-connect-button" onPress={handleLeaveSession} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <Ionicons name="close" size={16} color="#EF4444" />
              </Pressable>
            </View>
          )}
          <View style={{ flex: 1, paddingBottom: keyboardHeight > 0 ? keyboardHeight + 8 : 0 }}>
            <ExecutionThread variant="full" />
            <ExecutionInputBar
              chatInput={chatInput}
              onChangeText={setChatInput}
              isVoiceActive={isVoiceActive}
              isTranscribing={isTranscribing}
              audioLevel={audioLevel}
              onSend={handleSend}
              onMicPress={handleMicPress}
              onVoiceCancel={handleVoiceCancel}
              onVoiceSend={handleVoiceSend}
              onStopExecution={handleStopExecution}
              onUndo={handleUndo}
              hasHistory={hasHistory}
              conversationModel={currentModel}
              executionModel={currentExecutionModel}
              onModelPress={() => router.push('./settings')}
              availableKeys={availableKeys}
            />
          </View>
        </>
      ) : null}
    </>
  );

  // Biometric lock overlay
  if (isLocked) {
    return (
      <ScreenContainer className="items-center justify-center">
        <StatusBar hidden={false} />
        <Text className="text-xl text-white mb-2">Session Locked</Text>
        <Text className="text-sm text-gray-400 mb-6 text-center px-8">
          Authenticate to reconnect to your desktop
        </Text>
        <Pressable
          testID="unlock-button"
          onPress={handleUnlock}
          className="px-8 py-4 bg-space-blue rounded-xl"
        >
          <Text className="text-white text-base font-semibold">Unlock</Text>
        </Pressable>
        <Pressable
          testID="leave-locked-button"
          onPress={() => { setIsLocked(false); router.replace('/(connect)/connect'); }}
          className="mt-4 py-3"
        >
          <Text className="text-gray-400 text-sm">Back to Connect</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={['top']}>
      <StatusBar hidden={false} />
      {/* Thread-focus: controls above the video card (outside ViewLayoutManager
          to avoid being clipped by miniVideoCard overflow:hidden) */}
      {isCompactVideo && (
        <View style={pillStyles.threadFocusControls}>
          <HamburgerMenu
            onNewSession={handleNewSession}
            onHistory={() => router.push('./history')}
            onSettings={() => router.push('./settings')}
            onDisconnect={handleLeaveSession}
          />
          <View style={{ flex: 1 }} />
          {renderConnectionPillInline()}
        </View>
      )}
      <ViewLayoutManager
        videoContent={videoContent}
        threadContent={threadContent}
      />
      {/* Manual control overlay - landscape-only joystick + buttons */}
      <ManualControlOverlay
        sendMessage={sendMessage}
        sendFastMessage={sendFastMessage}
        onClose={handleToggleManualMode}
        visible={isManualMode && isLandscape}
      />
      {/* HUD overlay - single container for exec overlay + pill, outside RemoteScreen to avoid RNGH */}
      {isOverlayMode && isConnected && (
        <View style={hudOverlayStyles.container} pointerEvents="box-none">
          {/* Landscape: right-side exec panel (separate from pill stack) */}
          {isLandscape && !isOverlayCollapsed && (
            <View style={hudOverlayStyles.landscapeExecPanel}>
              <ExecutionThread variant="overlay" />
            </View>
          )}
          <View
            style={[
              hudOverlayStyles.stack,
              { paddingBottom: isLandscape ? 8 : Math.max(insets.bottom + 4, 16) },
            ]}
            pointerEvents="box-none"
          >
            {/* Portrait: exec overlay above pill */}
            {!isLandscape && !isOverlayCollapsed && (
              <View style={hudOverlayStyles.execWrapper}>
                <ExecutionThread variant="overlay" />
              </View>
            )}
            {/* Quick action buttons - visible when agent has suggestions and not in manual mode */}
            <QuickActionBar
              actions={suggestedActions}
              onAction={(payload) => sendMessage('manual_control', payload)}
              visible={!isManualMode && suggestedActions.length > 0}
            />
            {/* HUD pill */}
            <Pressable
              testID="hud-pill"
              style={hudStyles.pill}
              onPress={handleHudPress}
            >
              <Pressable
                testID="overlay-toggle"
                style={hudStyles.toggleBtn}
                onPress={() => setIsOverlayCollapsed(prev => !prev)}
              >
                <Ionicons
                  name={
                    isLandscape
                      ? (isOverlayCollapsed ? 'chevron-forward' : 'chevron-back')
                      : (isOverlayCollapsed ? 'chevron-up' : 'chevron-down')
                  }
                  size={14}
                  color="rgba(255,255,255,0.5)"
                />
              </Pressable>
              <View style={hudStyles.orb} />
              <Text style={hudStyles.stateText}>{hudStateLabel}</Text>
              {(aiState === 'idle' || aiState === 'manual') && (
                <Pressable
                  testID="hud-manual-button"
                  style={[hudStyles.micBtn, isManualMode && hudStyles.manualBtnActive] as ViewStyle[]}
                  onPress={handleToggleManualMode}
                >
                  <Ionicons name="hand-left" size={14} color="#ffffff" />
                </Pressable>
              )}
              <Pressable
                testID="hud-mic-button"
                style={[hudStyles.micBtn, isVoiceActive && hudStyles.micBtnActive] as ViewStyle[]}
                onPress={handleHudMicPress}
              >
                <Ionicons name={isVoiceActive ? 'send' : 'mic'} size={14} color="#ffffff" />
              </Pressable>
              {showHudStopButton && (
                <Pressable testID="hud-stop-button" style={hudStyles.stopBtn} onPress={handleStopExecution}>
                  <Ionicons name="stop" size={12} color="#EF4444" />
                </Pressable>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </ScreenContainer>
  );
}

const pillStyles = StyleSheet.create({
  threadFocusControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
  },
  buttonRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(16,17,19,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  pillWarning: {
    borderColor: 'rgba(245,158,11,0.3)',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: '#22C55E',
  },
  dotReconnecting: {
    backgroundColor: '#F59E0B',
  },
  dotTemp: {
    backgroundColor: '#F59E0B',
  },
  tempBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    marginBottom: 12,
  },
  tempBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F59E0B',
  },
  dismissButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(16,17,19,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
});

// Single absolute container for exec overlay + HUD pill - avoids z-index/touch conflicts
const hudOverlayStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  stack: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  execWrapper: {
    width: '100%',
    marginBottom: 8,
  },
  landscapeExecPanel: {
    position: 'absolute',
    right: 8,
    bottom: 48,
    width: 240,
    maxHeight: 120,
  },
});

const hudStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 28,
    paddingVertical: 6,
    backgroundColor: '#000000',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  toggleBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#095BB9',
  },
  stateText: {
    fontSize: 14,
    fontWeight: '300',
    color: '#FFFFFF',
  },
  micBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  micBtnActive: {
    backgroundColor: '#095BB9',
    opacity: 1,
  },
  manualBtnActive: {
    backgroundColor: '#D97706',
    opacity: 1,
  },
  stopBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(239,68,68,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
