import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getPairingToken, clearPairingToken, clearAllApiKeys } from '../../services/secureStorage';
import type { ProviderAuth } from '../../types';
import { consumeTempPayload, setTempPayload } from '../../services/tempPayloadBridge';
import { useWebRTC } from '../../hooks/useWebRTC';
import useAIStore from '../../stores/useAIStore';
import { ScreenContainer, Text, ContopIcon } from '../../components';
import type { PairingPayload } from '../../types';

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1000, 2000, 3000, 5000, 8000];

export default function ReconnectingScreen(): React.JSX.Element {
  const router = useRouter();
  const { connect, disconnect } = useWebRTC();
  const connectionStatus = useAIStore((s) => s.connectionStatus);
  const [attempt, setAttempt] = useState(1);
  const [subtitle, setSubtitle] = useState('Using stored session token');
  const [failed, setFailed] = useState(false);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const mountedRef = useRef(true);
  const attemptingRef = useRef(false);
  const storedPayloadRef = useRef<PairingPayload | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    startReconnection();

    return () => {
      mountedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Navigate to session when connected — pass the payload via bridge so the
  // session screen can reconnect with the correct connection_type (temp vs permanent).
  // Each screen has its own useWebRTC() hook instance, so the session screen
  // must call connect() itself after the reconnecting screen's hook unmounts.
  useEffect(() => {
    if (connectionStatus === 'connected') {
      if (storedPayloadRef.current) {
        setTempPayload(storedPayloadRef.current);
      }
      router.replace('/(session)');
    }
  }, [connectionStatus, router]);

  async function startReconnection() {
    // Check for temp payload passed via in-memory bridge (not persisted)
    const tempPayload = consumeTempPayload();
    if (tempPayload) {
      storedPayloadRef.current = tempPayload;
      attemptConnection(tempPayload, 1);
      return;
    }

    const payload = await getPairingToken();
    if (!payload) {
      if (mountedRef.current) {
        router.replace({
          pathname: '/(connect)/connect',
          params: { message: 'Session token expired. Please pair again.' },
        });
      }
      return;
    }

    // Restore provider auth from stored payload so subscription mode is active
    // before the WebRTC state_update arrives (same logic as QR scan in connect.tsx)
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

    storedPayloadRef.current = payload;
    attemptConnection(payload, 1);
  }

  async function attemptConnection(payload: Parameters<typeof connect>[0], attemptNum: number) {
    if (!mountedRef.current || attemptingRef.current) return;
    attemptingRef.current = true;

    setAttempt(attemptNum);
    setSubtitle(
      attemptNum === 1
        ? 'Establishing secure connection...'
        : `Reconnection attempt ${attemptNum} of ${MAX_ATTEMPTS}`,
    );

    try {
      await connect(payload);
      // connect() resolves when WebSocket SDP offer is sent
      // Connection success is detected via connectionStatus store update
      attemptingRef.current = false;
    } catch {
      attemptingRef.current = false;
      if (!mountedRef.current) return;

      if (attemptNum >= MAX_ATTEMPTS) {
        setFailed(true);
        const isTemp = storedPayloadRef.current?.connection_type === 'temp';
        if (isTemp) {
          setSubtitle('Temporary connection failed. The server may be unreachable or the QR code expired.');
        } else {
          setSubtitle('Could not reach the host. Make sure the server is running and you have network access (LAN or Tailscale).');
        }
        return;
      }

      const backoff = BACKOFF_MS[attemptNum - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      setTimeout(() => {
        if (mountedRef.current) {
          attemptConnection(payload, attemptNum + 1);
        }
      }, backoff);
    }
  }

  function handleCancel() {
    disconnect();
    router.replace('/(connect)/connect');
  }

  function handleRetry() {
    if (storedPayloadRef.current) {
      setFailed(false);
      attemptConnection(storedPayloadRef.current, 1);
    } else {
      // No stored payload to retry with — go back to connect
      router.replace('/(connect)/connect');
    }
  }

  function handleForgetConnection() {
    const isTemp = storedPayloadRef.current?.connection_type === 'temp';

    if (isTemp) {
      // Temp connection: just disconnect, don't touch permanent credentials
      disconnect();
      router.replace('/(connect)/connect');
      return;
    }

    // Permanent connection: show confirmation modal
    setShowForgetConfirm(true);
  }

  async function handleForgetConfirm() {
    if (isConfirming) return;
    setIsConfirming(true);

    // Best-effort server notification with 3s timeout — never blocks local cleanup
    try {
      const payload = storedPayloadRef.current;
      if (payload) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3_000);
        const hosts = [
          `http://${payload.server_host}:${payload.server_port}`,
          payload.tailscale_host ? `http://${payload.tailscale_host}:${payload.server_port}` : null,
        ].filter((h): h is string => h !== null);
        for (const base of hosts) {
          if (ctrl.signal.aborted) break;
          try {
            await fetch(`${base}/api/pair`, { method: 'DELETE', signal: ctrl.signal });
            clearTimeout(timer);
            break; // Success — no need to try other hosts
          } catch { /* Host unreachable or timed out — try next */ }
        }
        clearTimeout(timer);
      }
    } catch { /* Ignore — local cleanup proceeds regardless */ }

    // Always clean up locally — wrapped so failures still navigate away
    try {
      disconnect();
      await clearPairingToken();
      await clearAllApiKeys();
      useAIStore.getState().hardReset();
    } catch { /* Best effort */ }
    router.replace('/(connect)/connect');
  }

  return (
    <ScreenContainer className="items-center justify-center px-8">
      {/* Logo */}
      <View testID="reconnecting-logo" className="mb-6">
        <ContopIcon size={56} color="#ffffff" />
      </View>

      {/* Spinner — hidden once all attempts exhausted */}
      {!failed && (
        <ActivityIndicator
          testID="reconnecting-spinner"
          size="large"
          color="#095BB9"
          className="mb-6"
        />
      )}

      {/* Subtitle */}
      <Text testID="reconnecting-subtitle" className="text-base text-gray-400 text-center mb-2">
        {subtitle}
      </Text>

      {/* Attempt counter */}
      {!failed && attempt > 0 && (
        <Text testID="attempt-counter" className="text-sm text-gray-500 mb-8">
          Attempt {attempt} of {MAX_ATTEMPTS}
        </Text>
      )}

      {/* Buttons */}
      {failed ? (
        <View className="gap-3 w-full mt-4">
          <Pressable
            testID="retry-button"
            onPress={handleRetry}
            className="py-4 bg-space-blue rounded-xl items-center"
          >
            <Text className="text-white text-base font-semibold">Retry</Text>
          </Pressable>
          <Pressable
            testID="back-button"
            onPress={handleCancel}
            className="py-4 bg-white/10 rounded-xl items-center"
          >
            <Text className="text-gray-300 text-base font-medium">Back</Text>
          </Pressable>
          <Pressable
            testID="forget-button"
            onPress={handleForgetConnection}
            className="py-3 items-center"
          >
            <Text className="text-red-400 text-sm font-medium">Forget Connection</Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-3 items-center mt-4">
          <Pressable
            testID="cancel-button"
            onPress={handleCancel}
            className="py-3 px-8 bg-white/10 rounded-xl"
          >
            <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
          </Pressable>
          <Pressable
            testID="forget-button"
            onPress={handleForgetConnection}
            className="py-3"
          >
            <Text className="text-red-400 text-sm font-medium">Forget Connection</Text>
          </Pressable>
        </View>
      )}
      {/* Forget Connection Confirmation Modal */}
      <Modal
        visible={showForgetConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { if (!isConfirming) setShowForgetConfirm(false); }}
      >
        <View
          className="flex-1 items-center justify-center bg-black/70"
          accessibilityLiveRegion="assertive"
        >
          <View className="bg-[#0A0A0A] border border-red-500/30 rounded-2xl mx-8 p-6 items-center w-full max-w-sm gap-3">
            <View className="w-12 h-12 rounded-full bg-red-500/10 items-center justify-center mb-1">
              <Ionicons name="trash-outline" size={24} color="#EF4444" />
            </View>
            <Text
              className="text-lg font-bold text-white text-center"
              style={{ fontFamily: 'IBMPlexSans_700Bold' }}
            >
              Forget Connection?
            </Text>
            <Text className="text-sm text-gray-400 text-center">
              This will clear your saved pairing credentials. You will need to scan a new QR code.
            </Text>
            <View className="flex-row gap-3 w-full mt-2">
              <Pressable
                testID="forget-cancel-button"
                onPress={() => setShowForgetConfirm(false)}
                disabled={isConfirming}
                className="flex-1 py-3 bg-white/10 rounded-xl items-center"
                accessibilityRole="button"
                accessibilityLabel="Cancel forget connection"
              >
                <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
              </Pressable>
              <Pressable
                testID="forget-confirm-button"
                onPress={() => { void handleForgetConfirm(); }}
                disabled={isConfirming}
                className={`flex-1 py-3 rounded-xl items-center bg-red-500${isConfirming ? ' opacity-50' : ''}`}
                accessibilityRole="button"
                accessibilityLabel="Confirm forget connection"
              >
                <Text className="text-white text-sm font-semibold">
                  {isConfirming ? 'Forgetting…' : 'Forget'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
