import { useRef, useCallback, useState, useEffect } from 'react';
import {
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
} from 'react-native-webrtc';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import useAIStore from '../stores/useAIStore';
import {
  createPeerConnection,
  createMessageEnvelope,
  connectSignalingWithFallback,
  MSG_TYPE_SESSION_END,
  SILENT_RECONNECT_WINDOW_MS,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BACKOFF_MS,
} from '../services/webrtc';
import type { PairingPayload, DataChannelMessage, AIState } from '../types';

const KEEPALIVE_INTERVAL_MS = 30_000;
const KEEPALIVE_MAX_MISSED = 3;

async function triggerDisconnectHaptic(): Promise<void> {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

export function useWebRTC() {
  const pcRef = useRef<ReturnType<typeof createPeerConnection> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dcRef = useRef<ReturnType<ReturnType<typeof createPeerConnection>['createDataChannel']> | null>(null);
  const fastDcRef = useRef<ReturnType<ReturnType<typeof createPeerConnection>['createDataChannel']> | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const missedKeepalivesRef = useRef(0);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // Reconnection state refs (useRef to avoid stale closures in async callbacks)
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentWindowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReconnectingRef = useRef(false);
  const payloadRef = useRef<PairingPayload | null>(null);

  // Guard against concurrent initConnection calls (reconnection race)
  const connectingRef = useRef(false);

  // Callback ref for forwarding data channel messages to consumers (e.g. useConversation)
  const onDataChannelMessageRef = useRef<((message: DataChannelMessage) => void) | null>(null);

  // Ref for shared connection setup - breaks circular useCallback dependency
  // between initConnection → handleIce* → attemptFullReconnect → initConnection
  const initConnectionRef = useRef<(payload: PairingPayload) => Promise<void>>(
    () => Promise.resolve(),
  );

  const cancelReconnection = useCallback(() => {
    isReconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    if (silentWindowTimerRef.current) {
      clearTimeout(silentWindowTimerRef.current);
      silentWindowTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const attemptFullReconnect = useCallback(async () => {
    // Cancel pending timers to prevent duplicate calls racing with this one.
    // handleIceFailed + handleIceDisconnected can both schedule calls, and a
    // late-firing timer would close refs out from under an in-flight _doInitConnection.
    if (silentWindowTimerRef.current) {
      clearTimeout(silentWindowTimerRef.current);
      silentWindowTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Stop stale keepalive warnings from the dead connection
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    const payload = payloadRef.current;
    if (!payload || !isReconnectingRef.current) return;

    // If another _doInitConnection is in flight, force-close it.
    // A hung connection (e.g. waiting for SDP answer that never comes)
    // would block all subsequent reconnection attempts forever.
    if (connectingRef.current) {
      console.warn('[WebRTC] Force-closing hung connection attempt for reconnection');
      const prevWs = wsRef.current;
      const prevPc = pcRef.current;
      const prevDc = dcRef.current;
      const prevFastDc = fastDcRef.current;
      wsRef.current = null;
      pcRef.current = null;
      dcRef.current = null;
      fastDcRef.current = null;
      if (prevFastDc) try { prevFastDc.close(); } catch { }
      if (prevDc) try { prevDc.close(); } catch { }
      if (prevPc) try { prevPc.close(); } catch { }
      if (prevWs) try { prevWs.close(); } catch { }
      connectingRef.current = false;
    }

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      // All attempts exhausted
      isReconnectingRef.current = false;
      const { setConnectionStatus, setAIState } = useAIStore.getState();
      setConnectionStatus('disconnected');
      setAIState('disconnected');
      return;
    }
    reconnectAttemptsRef.current += 1;

    try {
      // _doInitConnection closes existing PC/WS/DC internally (lines 180-188).
      // Do NOT close refs here - a concurrent _doInitConnection may be using them.
      await initConnectionRef.current(payload);
    } catch (err) {
      console.warn('[WebRTC] Reconnection attempt failed:', (err as Error)?.message ?? err);
      // Reconnection attempt failed - schedule next with backoff
      if (!isReconnectingRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        isReconnectingRef.current = false;
        const { setConnectionStatus, setAIState } = useAIStore.getState();
        setConnectionStatus('disconnected');
        setAIState('disconnected');
        return;
      }
      const backoff = RECONNECT_BACKOFF_MS[reconnectAttemptsRef.current - 1] ?? RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];
      reconnectTimerRef.current = setTimeout(() => {
        attemptFullReconnect();
      }, backoff);
    }
  }, []);

  const handleIceDisconnected = useCallback(() => {
    // Stop keepalive timer from old connection - prevents stale warnings during reconnect
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    if (isReconnectingRef.current) {
      // Already reconnecting - this disconnect is from a failed reconnection attempt
      attemptFullReconnect();
      return;
    }

    // For permanent connections: stop and require manual reconnect with biometric
    // For temp connections: auto-reconnect (user is actively present)
    const payload = payloadRef.current;
    const isTemp = payload?.connection_type === 'temp';

    if (!isTemp) {
      // Permanent: set disconnected, user must manually reconnect
      const { setConnectionStatus, setAIState, setProviderAuth, providerAuth } = useAIStore.getState();
      setAIState('idle');
      setConnectionStatus('disconnected');
      // Mark all proxies as unavailable - they can't be reached without a connection
      if (providerAuth) {
        const unavailable: Record<string, { mode: string; available: boolean }> = {};
        for (const [p, cfg] of Object.entries(providerAuth)) {
          unavailable[p] = { ...cfg, available: false };
        }
        setProviderAuth(unavailable as typeof providerAuth);
      }
      triggerDisconnectHaptic();
      return;
    }

    // Temp connections: auto-reconnect as before
    isReconnectingRef.current = true;
    reconnectAttemptsRef.current = 0;
    useAIStore.getState().setAIState('idle');
    useAIStore.getState().setConnectionStatus('reconnecting');

    // Try ICE restart first (lightweight)
    if (pcRef.current) {
      pcRef.current.restartIce();
    }

    // Start 2-second silent window
    silentWindowTimerRef.current = setTimeout(async () => {
      silentWindowTimerRef.current = null;
      if (!isReconnectingRef.current) return;

      // Silent window expired - trigger haptic and start full reconnection
      await triggerDisconnectHaptic();
      attemptFullReconnect();
    }, SILENT_RECONNECT_WINDOW_MS);
  }, [attemptFullReconnect]);

  const handleIceFailed = useCallback(() => {
    if (!isReconnectingRef.current) {
      isReconnectingRef.current = true;
      reconnectAttemptsRef.current = 0;
    }
    useAIStore.getState().setConnectionStatus('reconnecting');

    // ICE failed permanently - skip silent window but alert user with haptic
    triggerDisconnectHaptic();
    // Immediately attempt full reconnection
    attemptFullReconnect();
  }, [attemptFullReconnect]);

  // Shared connection setup - creates WS, PC, DC, event handlers, and SDP exchange.
  // Reassigned every render so closures always capture the latest useCallback refs.
  // Safety: setRemoteStream is stable (React useState setter identity guarantee),
  // and all useCallback refs are stable due to ref-based dependencies.
  initConnectionRef.current = async (payload: PairingPayload) => {
    // Prevent concurrent connection attempts (reconnection race)
    if (connectingRef.current) {
      console.log('[WebRTC] Connection attempt already in progress, skipping');
      return;
    }
    connectingRef.current = true;

    try {
      await _doInitConnection(payload);
    } finally {
      connectingRef.current = false;
    }
  };

  async function _doInitConnection(payload: PairingPayload) {
    const { stun_config } = payload;

    // Close any existing connections to prevent stale event handlers
    const prevWs = wsRef.current;
    const prevPc = pcRef.current;
    const prevDc = dcRef.current;
    const prevFastDc = fastDcRef.current;
    wsRef.current = null;
    pcRef.current = null;
    dcRef.current = null;
    fastDcRef.current = null;
    if (prevFastDc) prevFastDc.close();
    if (prevDc) prevDc.close();
    if (prevPc) prevPc.close();
    if (prevWs) prevWs.close();

    // LAN-first connection with fallback - tries all available paths automatically
    console.log('[WebRTC] Connecting with fallback strategy');
    const { ws, path } = await connectSignalingWithFallback(payload);
    console.log('[WebRTC] Connected via:', path);
    wsRef.current = ws;
    useAIStore.getState().setConnectionPath(path);

    // Create peer connection with ICE servers via service layer
    const pc = createPeerConnection(stun_config.ice_servers);
    pcRef.current = pc;

    // Add receive-only video transceiver so SDP offer includes video m-line
    pc.addTransceiver('video', { direction: 'recvonly' });

    // Create data channel with ordered delivery
    const dc = pc.createDataChannel('contop', { ordered: true });
    dcRef.current = dc;

    // Create unreliable data channel for latency-sensitive mouse_move messages.
    // ordered=false + maxRetransmits=0 eliminates SCTP head-of-line blocking.
    const fastDc = pc.createDataChannel('contop-fast', {
      ordered: false,
      maxRetransmits: 0,
    });
    fastDcRef.current = fastDc;

    dc.addEventListener('open', () => {
      // Guard: ignore stale DC open events from a previous (dead) peer connection.
      // Use ref check instead of pc.connectionState - the ref is nulled in cleanup
      // while connectionState can lag behind on react-native-webrtc.
      if (pc !== pcRef.current) {
        console.log('[WebRTC] DC open from stale PC - ignoring');
        return;
      }
      console.log('[WebRTC] Data channel opened');
      // Start keepalive monitoring only when data channel is ready.
      // Starting earlier (e.g. after SDP offer) would accumulate false
      // "missed" warnings during ICE/DTLS handshake.
      missedKeepalivesRef.current = 0;
      if (keepaliveTimerRef.current) {
        clearInterval(keepaliveTimerRef.current);
      }
      keepaliveTimerRef.current = setInterval(() => {
        missedKeepalivesRef.current += 1;
        if (missedKeepalivesRef.current >= KEEPALIVE_MAX_MISSED) {
          console.warn('[WebRTC] Server keepalives missed:', missedKeepalivesRef.current);
        }
      }, KEEPALIVE_INTERVAL_MS);
    });
    dc.addEventListener('close', () => {
      console.warn('[WebRTC] Data channel closed');
      // Data channel can die while ICE/RTP stays alive (SCTP transport issue).
      // Video keeps playing but messages can't get through - trigger reconnection.
      if (dc === dcRef.current && !isReconnectingRef.current) {
        console.log('[WebRTC] Data channel lost - triggering reconnection');
        handleIceDisconnected();
      }
    });
    dc.addEventListener('error', (e: any) => {
      console.error('[WebRTC] Data channel error:', e?.message || e);
    });

    // Handle data channel messages
    dc.addEventListener('message', (event: { data: string }) => {
      // Guard: ignore messages from a stale DC after cleanup nulled the ref.
      if (pc !== pcRef.current) return;

      let message: DataChannelMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        console.warn('[WebRTC] Malformed data channel message, ignoring:', event.data?.slice(0, 100));
        return;
      }

      if (message.type === 'keepalive') {
        // Reset counter AND restart timer so the 30s window begins from this
        // keepalive - eliminates false "missed" warnings caused by phase drift
        // between independently-started client/server timers.
        missedKeepalivesRef.current = 0;
        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
        }
        keepaliveTimerRef.current = setInterval(() => {
          missedKeepalivesRef.current += 1;
          if (missedKeepalivesRef.current >= KEEPALIVE_MAX_MISSED) {
            console.warn('[WebRTC] Server keepalives missed:', missedKeepalivesRef.current);
          }
        }, KEEPALIVE_INTERVAL_MS);
        // Reply with keepalive
        const reply = createMessageEnvelope('keepalive', {});
        dc.send(JSON.stringify(reply));
        return;
      }

      if (message.type === 'state_update') {
        const validStates: AIState[] = ['idle', 'listening', 'processing', 'executing', 'sandboxed', 'disconnected'];
        const newState = (message.payload?.ai_state ?? message.payload?.state) as AIState | undefined;
        if (newState && validStates.includes(newState)) {
          // Don't let server state_update overwrite manual mode - user is in direct control
          const current = useAIStore.getState().aiState;
          if (current !== 'manual') {
            useAIStore.getState().setAIState(newState);
          }
        }
        // Sync global keep_host_awake state from server (sent in initial state_update)
        if (typeof message.payload?.keep_host_awake === 'boolean') {
          useAIStore.getState().setIsHostKeepAwake(message.payload.keep_host_awake as boolean);
        }
        // Sync connection_type from server (authoritative source of truth)
        const serverConnType = message.payload?.connection_type;
        if (serverConnType === 'temp' || serverConnType === 'permanent') {
          useAIStore.getState().setConnectionType(serverConnType);
        }
        // Sync provider_auth - tells mobile which providers have a proxy configured on desktop.
        // Also default mobileAuthPreference to cli_proxy for newly-available providers
        // so subscription mode activates without requiring a re-scan or manual toggle.
        if (message.payload?.provider_auth) {
          const providerAuth = message.payload.provider_auth as import('../types').ProviderAuth;
          useAIStore.getState().setProviderAuth(providerAuth);
          const existingPrefs = useAIStore.getState().mobileAuthPreference;
          for (const [provider, cfg] of Object.entries(providerAuth)) {
            if (cfg.available && !existingPrefs[provider]) {
              useAIStore.getState().setMobileAuthPreference(provider, 'cli_proxy');
            }
          }
        }
        return;
      }

      // Handle agent_progress: add or update progress entry in execution thread
      if (message.type === 'agent_progress') {
        const p = message.payload as Record<string, unknown>;
        const store = useAIStore.getState();
        if (store.aiState !== 'executing') {
          store.setAIState('executing');
        }
        // Find existing entry for this step to update (before→running, after→completed).
        // Match 'running' or 'cancelled' to avoid collisions across requests
        // (step counter resets per intent, so step numbers repeat).
        const existing = store.executionEntries.find(
          (e) => e.type === 'agent_progress' && e.metadata?.step === p.step
            && (e.metadata?.status === 'running' || e.metadata?.status === 'cancelled')
        );
        // Guard: if the step was already marked cancelled (user hit stop),
        // ignore late completion messages - the cancelled state is final.
        if (existing && existing.metadata?.status === 'cancelled') {
          return;
        }
        if (existing) {
          // Update running → completed/failed, merge in output data
          store.updateExecutionEntry(existing.id, {
            content: (p.detail as string) ?? existing.content,
            metadata: {
              ...existing.metadata,
              status: p.status,
              stdout: p.stdout as string | undefined,
              stderr: p.stderr as string | undefined,
              exit_code: p.exit_code as number | undefined,
              duration_ms: p.duration_ms as number | undefined,
              image_b64: p.image_b64 as string | undefined,
              classified_command: p.classified_command as string | undefined,
              execution_result: p.execution_result as string | undefined,
              model: p.model as string | undefined,
              backend: p.backend as string | undefined,
            },
          });
        } else {
          store.addExecutionEntry({
            id: message.id,
            type: 'agent_progress',
            content: (p.detail as string) ?? '',
            timestamp: Date.now(),
            metadata: {
              step: p.step,
              tool: p.tool,
              command: p.command,
              status: p.status,
              classified_command: p.classified_command as string | undefined,
              execution_result: p.execution_result as string | undefined,
              model: p.model as string | undefined,
              backend: p.backend as string | undefined,
            },
          });
        }
        return;
      }

      // Handle agent_status: transient status updates (e.g. OmniParser loading, model info)
      // Each statusType gets its own slot - only same-type updates replace each other.
      if (message.type === 'agent_status') {
        const p = message.payload as Record<string, unknown>;
        const store = useAIStore.getState();
        const statusType = (p.type as string) ?? 'generic';
        const existingStatus = store.executionEntries.find(
          (e) => e.type === 'agent_status' && e.metadata?.statusType === statusType
        );
        if (existingStatus) {
          store.updateExecutionEntry(existingStatus.id, {
            content: (p.message as string) ?? '',
          });
        } else {
          store.addExecutionEntry({
            id: message.id,
            type: 'agent_status',
            content: (p.message as string) ?? '',
            timestamp: Date.now(),
            metadata: { statusType },
          });
        }
        return;
      }

      // Skip agent_thinking and agent_text - too verbose for mobile UI.
      // Only tool execution steps (agent_progress) are shown.
      if (message.type === 'agent_thinking' || message.type === 'agent_text') {
        return;
      }

      // Handle agent_result: add to store for desktop group display, then
      // forward to consumer for mobile model processing (the "presenter").
      // AI state is set to idle by processAgentResult when the mobile model finishes.
      if (message.type === 'agent_result') {
        const p = message.payload as Record<string, unknown>;
        const store = useAIStore.getState();

        // Mark any still-running steps as cancelled. The server does not send
        // step-completion messages for tools that were mid-flight when the user
        // cancelled, so their spinners would persist forever.
        // Safety: the data channel is ordered, so on the happy path all
        // step-completion messages arrive before agent_result - this loop is
        // a no-op for successful completions. Snapshot IDs first to avoid
        // iterating over a store array while issuing mutations.
        const runningIds = store.executionEntries
          .filter((e) => e.type === 'agent_progress' && e.metadata?.status === 'running')
          .map((e) => e.id);
        for (const id of runningIds) {
          const entry = store.executionEntries.find((e) => e.id === id);
          if (entry) {
            store.updateExecutionEntry(id, {
              metadata: { ...entry.metadata, status: 'cancelled' },
            });
          }
        }

        store.addExecutionEntry({
          id: message.id,
          type: 'agent_result',
          content: (p.answer as string) ?? '',
          timestamp: Date.now(),
          metadata: {
            steps_taken: p.steps_taken,
            duration_ms: p.duration_ms,
            ...(p.error_code ? { error_code: p.error_code } : {}),
            model: p.model as string | undefined,
            backend: p.backend as string | undefined,
          },
        });

        // Extract and validate suggested_actions from agent_result
        const rawActions = p.suggested_actions;
        if (Array.isArray(rawActions) && rawActions.length > 0) {
          const valid = rawActions.filter(
            (a): a is { label: string; action: string; payload: Record<string, unknown> } =>
              typeof a === 'object' && a !== null &&
              typeof a.label === 'string' &&
              typeof a.action === 'string' &&
              typeof a.payload === 'object' && a.payload !== null,
          );
          if (valid.length > 0) {
            store.setSuggestedActions(valid as import('../types').SuggestedAction[]);
          } else {
            store.clearSuggestedActions();
          }
        } else {
          store.clearSuggestedActions();
        }

        onDataChannelMessageRef.current?.(message);
        return;
      }

      // Handle agent_confirmation_request: show confirmation card
      if (message.type === 'agent_confirmation_request') {
        const p = message.payload as Record<string, unknown>;
        const store = useAIStore.getState();
        store.addExecutionEntry({
          id: message.id,
          type: 'agent_confirmation',
          content: (p.voice_message as string) ?? '',
          timestamp: Date.now(),
          metadata: {
            request_id: p.request_id,
            tool: p.tool,
            command: p.command,
            reason: p.reason,
            status: 'pending',
            ...(p.plan_steps ? { plan_steps: p.plan_steps } : {}),
          },
        });
        store.setAIState('sandboxed');
        return;
      }

      // Handle away_mode_status - sync away mode state
      if (message.type === 'away_mode_status') {
        const p = message.payload as Record<string, unknown>;
        useAIStore.getState().setIsAwayMode(!!p.away_mode);
        return;
      }

      // Handle security_alert - overlay was tampered with
      if (message.type === 'security_alert') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const store = useAIStore.getState();
        store.addExecutionEntry({
          id: `security-alert-${Date.now()}`,
          type: 'agent_status',
          content: `Security Alert: Away Mode overlay was disrupted (${(message.payload as Record<string, unknown>)?.reason ?? 'unknown'})`,
          timestamp: Date.now(),
          metadata: { status: 'error' },
        });
        return;
      }

      // Handle manual_control_result - haptic feedback on error, no state change
      if (message.type === 'manual_control_result') {
        const p = message.payload as Record<string, unknown>;
        if (p.status === 'error') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        return;
      }

      // Forward frame, tool_result, device_control_result, and subscription response messages to consumer
      if (
        message.type === 'frame' ||
        message.type === 'tool_result' ||
        message.type === 'device_control_result' ||
        message.type === 'conversation_response' ||
        message.type === 'conversation_stream_delta' ||
        message.type === 'conversation_stream_end'
      ) {
        onDataChannelMessageRef.current?.(message);
      }
    });

    // Capture incoming video track from host
    // Note: aiortc's addTrack() does not associate the track with a MediaStream,
    // so event.streams may be empty. Fall back to creating a stream from the track.
    pc.addEventListener('track', (event: { track: MediaStreamTrack; streams?: MediaStream[] }) => {
      if (event.track.kind === 'video') {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        } else {
          const stream = new MediaStream();
          stream.addTrack(event.track);
          setRemoteStream(stream);
        }
      }
    });

    // Handle connection state changes → update Zustand store
    pc.addEventListener('connectionstatechange', () => {
      // Ignore events from stale peer connections (previous attempts)
      if (pc !== pcRef.current) return;
      const state = pc.connectionState;
      const store = useAIStore.getState();

      if (state === 'connected') {
        if (isReconnectingRef.current) {
          cancelReconnection();
        }
        store.setConnectionStatus('connected');
        // Re-request provider_auth so sub mode indicators recover after
        // disconnect.  ICE recovery keeps the same data channel open, so
        // the server's initial state_update (sent on DC open) never
        // re-fires.  Sending refresh_proxy_status triggers a fresh
        // health check + push.  On the very first connect the DC may not
        // be open yet - harmless: the server already sends provider_auth
        // when the DC opens.
        const curDc = dcRef.current;
        if (curDc && curDc.readyState === 'open') {
          curDc.send(JSON.stringify(createMessageEnvelope('refresh_proxy_status', {})));
        }
      } else if (state === 'disconnected') {
        handleIceDisconnected();
      } else if (state === 'failed') {
        handleIceFailed();
      } else if (state === 'closed') {
        if (!isReconnectingRef.current) {
          store.setConnectionStatus('disconnected');
        }
      }
    });

    // Send local ICE candidates to remote via signaling WebSocket
    pc.addEventListener('icecandidate', (event: { candidate: unknown }) => {
      if (event.candidate && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'ice_candidate',
            candidate: event.candidate,
          }),
        );
      }
    });

    // Handle signaling messages from server
    ws.addEventListener('message', async (event: { data: string }) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.warn('[WebRTC] Malformed signaling message, ignoring:', event.data?.slice(0, 100));
        return;
      }

      if (data.type === 'answer') {
        const answerDesc = new RTCSessionDescription({
          type: 'answer',
          sdp: data.sdp,
        });
        await pc.setRemoteDescription(answerDesc);
      } else if (data.type === 'ice_candidate') {
        const candidate = new RTCIceCandidate(data.candidate);
        await pc.addIceCandidate(candidate);
      }
    });

    // Handle WebSocket errors - guarded for stale instances
    ws.addEventListener('error', (e: any) => {
      console.log('[WebRTC] WebSocket error:', e?.message || e);
      if (ws !== wsRef.current) return;
      // Error events are always followed by a close event - let the close
      // handler decide whether to reconnect or set disconnected.
    });

    // Handle WebSocket close.
    // Once P2P is established the signaling WS is disposable (Cloudflare may
    // drop it on idle timeout), so we only act when the PC hasn't connected.
    ws.addEventListener('close', (e: any) => {
      console.log('[WebRTC] WebSocket closed:', e?.code, e?.reason);
      if (ws !== wsRef.current) return;

      // P2P is active - signaling WS is no longer needed.
      if (pcRef.current?.connectionState === 'connected') return;

      // SDP answer can never arrive on a dead WS - trigger reconnection.
      if (!isReconnectingRef.current) {
        handleIceDisconnected();
      } else {
        // Already reconnecting - this attempt's WS died (e.g. 4002 superseded).
        // Retry immediately.
        attemptFullReconnect();
      }
    });

    // WebSocket is already open from connectSignalingWithFallback - send SDP offer directly
    console.log('[WebRTC] WebSocket already open, creating SDP offer...');
    const offer = await pc.createOffer({
      mandatory: { OfferToReceiveAudio: true, OfferToReceiveVideo: true },
    });
    await pc.setLocalDescription(offer);

    // Guard: if the signaling WS closed while createOffer/setLocalDescription
    // were awaiting (e.g. server sent 4002 "superseded"), ws.send() would
    // silently drop the offer in React Native, leaving the system stuck at
    // "reconnecting" with no retry.  Throw so attemptFullReconnect's catch
    // schedules the next attempt.
    if (ws.readyState !== ws.OPEN) {
      throw new Error('[WebRTC] WebSocket closed during SDP exchange');
    }

    // Start location lookup in the background - must not delay the offer.
    // ICE gathering begins at setLocalDescription, so candidates are already
    // flowing to the server. The offer must arrive before them.
    const locationPromise = (async (): Promise<string | null> => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        let loc = await Promise.race([
          Location.getLastKnownPositionAsync(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]) as Location.LocationObject | null;
        if (!loc) {
          loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]) as Location.LocationObject | null;
        }
        if (!loc) return null;
        const [geo] = await Promise.race([
          Location.reverseGeocodeAsync(loc.coords),
          new Promise<Location.LocationGeocodedAddress[]>((resolve) =>
            setTimeout(() => resolve([]), 2000)),
        ]);
        return geo ? ([geo.city, geo.country].filter(Boolean).join(', ') || null) : null;
      } catch {
        return null;
      }
    })();

    // Send offer immediately so it arrives before any ICE candidates.
    // Include connection_type so server can create the correct peer type
    // (e.g. temp session via permanent QR → server downgrades to temp)
    const offerMsg: Record<string, unknown> = {
      type: 'offer',
      sdp: offer.sdp,
      device_name: Device.deviceName || Device.modelName || null,
    };
    if (payload.connection_type) {
      offerMsg.connection_type = payload.connection_type;
    }
    ws.send(JSON.stringify(offerMsg));

    // Send location as a follow-up once resolved (best-effort)
    const deviceLocation = await locationPromise;
    if (deviceLocation && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'device_location', location: deviceLocation }));
    }

    // Keepalive monitoring is started in dc.addEventListener('open') - not here.
    // Starting here would accumulate false "missed" warnings during ICE/DTLS setup.
    // Clear any stale timer from a previous connection attempt.
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
  }

  // Clean up all connections and timers on component unmount to prevent
  // orphaned PCs from firing close events that corrupt global state
  useEffect(() => {
    return () => {
      // Null refs before closing so stale handlers see pc !== pcRef.current
      const prevDc = dcRef.current;
      const prevFastDc = fastDcRef.current;
      const prevPc = pcRef.current;
      const prevWs = wsRef.current;
      dcRef.current = null;
      fastDcRef.current = null;
      pcRef.current = null;
      wsRef.current = null;
      isReconnectingRef.current = false;
      if (prevFastDc) prevFastDc.close();
      if (prevDc) prevDc.close();
      if (prevPc) prevPc.close();
      if (prevWs) prevWs.close();
      if (silentWindowTimerRef.current) {
        clearTimeout(silentWindowTimerRef.current);
        silentWindowTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (keepaliveTimerRef.current) {
        clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = null;
      }
    };
  }, []);

  const connect = useCallback(async (payload: PairingPayload) => {
    payloadRef.current = payload;
    const store = useAIStore.getState();
    store.setConnectionType(payload.connection_type ?? 'permanent');
    // Clear entries for a fresh session (isolates temp from permanent history)
    store.clearExecutionEntries();
    store.setActiveSession(null);
    await initConnectionRef.current(payload);
  }, []);

  const disconnect = useCallback(() => {
    // Cancel any active reconnection first
    cancelReconnection();

    // Clear keepalive timer
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    // Send session_end via data channel before closing
    if (dcRef.current && dcRef.current.readyState === 'open') {
      const envelope = createMessageEnvelope(MSG_TYPE_SESSION_END, {});
      dcRef.current.send(JSON.stringify(envelope));
    }

    // Close data channels
    if (fastDcRef.current) {
      fastDcRef.current.close();
      fastDcRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear remote stream
    setRemoteStream(null);

    // Soft reset: clear runtime state but preserve stored credentials and settings
    useAIStore.getState().softReset();
  }, [cancelReconnection]);

  const sendMessage = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      if (dcRef.current && dcRef.current.readyState === 'open') {
        const envelope = createMessageEnvelope(type, payload);
        dcRef.current.send(JSON.stringify(envelope));
      }
    },
    [],
  );

  const sendFastMessage = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      // Send via unreliable channel if available, fall back to reliable
      const dc = fastDcRef.current?.readyState === 'open'
        ? fastDcRef.current
        : dcRef.current;
      if (dc && dc.readyState === 'open') {
        const envelope = createMessageEnvelope(type, payload);
        dc.send(JSON.stringify(envelope));
      }
    },
    [],
  );

  const setOnDataChannelMessage = useCallback(
    (handler: ((message: DataChannelMessage) => void) | null) => {
      onDataChannelMessageRef.current = handler;
    },
    [],
  );

  return { connect, disconnect, sendMessage, sendFastMessage, setOnDataChannelMessage, remoteStream };
}
