import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Pressable, TextInput, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Camera } from 'expo-camera';
import {
  checkBiometricAvailability,
  authenticateWithBiometrics,
} from '../../services/biometrics';
import {
  savePairingToken,
  saveApiKeysFromPayload,
  clearPairingToken,
  clearAllApiKeys,
  getPairingToken,
} from '../../services/secureStorage';
import QRScanner from '../../components/QRScanner';
import { ScreenContainer, Text, ContopIcon } from '../../components';
import { setTempPayload } from '../../services/tempPayloadBridge';
import useAIStore from '../../stores/useAIStore';
import { DEFAULT_STUN_CONFIG } from '../../services/pairingPayload';
import type { PairingPayload, ProviderAuth } from '../../types';

type Mode = 'chooser' | 'qr' | 'manual';

export default function ConnectScreen(): React.JSX.Element {
  const router = useRouter();
  const { message } = useLocalSearchParams<{ message?: string }>();
  const [mode, setMode] = useState<Mode>('chooser');
  const [scanError, setScanError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [isTempScan, setIsTempScan] = useState(false);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [isForgetting, setIsForgetting] = useState(false);
  const storedPayloadRef = useRef<PairingPayload | null>(null);

  // Check if user has stored permanent credentials
  useEffect(() => {
    (async () => {
      const stored = await getPairingToken();
      if (stored && stored.connection_type !== 'temp') {
        setIsReturningUser(true);
        storedPayloadRef.current = stored;
      }
    })();
  }, []);

  // Manual entry fields
  const [manualToken, setManualToken] = useState('');
  const [hostIp, setHostIp] = useState('');
  const [port, setPort] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [showApiKeys, setShowApiKeys] = useState(false);

  // Reconnect with stored credentials (returning user only)
  const handleReconnect = useCallback(async () => {
    setErrorMessage('');

    const biometrics = await checkBiometricAvailability();
    if (!biometrics.available || !biometrics.enrolled) {
      setErrorMessage(
        'Biometric authentication is required. Please enable biometrics in device settings.',
      );
      return;
    }

    try {
      const authenticated = await authenticateWithBiometrics();
      if (!authenticated) {
        setErrorMessage('Biometric authentication failed. Please try again.');
        return;
      }
    } catch {
      setErrorMessage('Biometric authentication error. Please try again.');
      return;
    }

    router.replace('/(connect)/reconnecting');
  }, [router]);

  // Start a temp QR scan flow
  const handleTempConnect = useCallback(async () => {
    setIsTempScan(true);
    setMode('qr');
    setErrorMessage('');

    const biometrics = await checkBiometricAvailability();
    if (!biometrics.available || !biometrics.enrolled) {
      setErrorMessage(
        'Biometric authentication is required. Please enable biometrics in device settings.',
      );
      return;
    }

    try {
      const authenticated = await authenticateWithBiometrics();
      if (!authenticated) {
        setErrorMessage('Biometric authentication failed. Please try again.');
        return;
      }
    } catch {
      setErrorMessage('Biometric authentication error. Please try again.');
      return;
    }

    setErrorMessage('');
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setErrorMessage(
        'Camera permission is required to scan QR codes. Please grant camera access in settings.',
      );
      return;
    }
    setCameraReady(true);
  }, []);

  // When entering QR mode, immediately trigger biometric → camera
  const handleQRSelect = useCallback(async () => {
    setIsTempScan(false);
    setMode('qr');
    setErrorMessage('');

    const biometrics = await checkBiometricAvailability();
    if (!biometrics.available || !biometrics.enrolled) {
      setErrorMessage(
        'Biometric authentication is required. Please enable biometrics in device settings.',
      );
      return;
    }

    try {
      const authenticated = await authenticateWithBiometrics();
      if (!authenticated) {
        setErrorMessage('Biometric authentication failed. Please try again.');
        return;
      }
    } catch {
      setErrorMessage('Biometric authentication error. Please try again.');
      return;
    }

    setErrorMessage('');
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setErrorMessage(
        'Camera permission is required to scan QR codes. Please grant camera access in settings.',
      );
      return;
    }
    setCameraReady(true);
  }, []);

  function handleBack() {
    setMode('chooser');
    setErrorMessage('');
    setScanError('');
    setCameraReady(false);
    setIsTempScan(false);
  }

  async function handleForgetConfirm() {
    if (isForgetting) return;
    setIsForgetting(true);

    // Best-effort server notification (3s timeout — don't block the user)
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
            break;
          } catch { /* Host unreachable — continue */ }
        }
        clearTimeout(timer);
      }
    } catch { /* Ignore — local cleanup proceeds regardless */ }

    // Reset UI state before hardReset to avoid setters on potentially unmounted component
    setIsForgetting(false);
    setShowForgetConfirm(false);
    setIsReturningUser(false);
    storedPayloadRef.current = null;

    try {
      await clearPairingToken();
      await clearAllApiKeys();
      useAIStore.getState().hardReset();
    } catch { /* Best effort */ }
  }

  async function handleScanSuccess(payload: PairingPayload, { skipKeyCheck = false } = {}) {
    // Allow subscription-mode QRs where all providers use CLI proxy (no API keys needed).
    // Manual-entry connections skip this check — the server already validated the config.
    if (!skipKeyCheck) {
      const hasAnyKey = payload.gemini_api_key || payload.openai_api_key || payload.anthropic_api_key || payload.openrouter_api_key;
      const hasSubscriptionProvider = payload.pa && (payload.pa.g || payload.pa.a || payload.pa.o);
      if (!hasAnyKey && !hasSubscriptionProvider) {
        setScanError('Invalid QR code: no API keys configured. Set at least one key on the desktop app.');
        return;
      }
    }

    // Apply provider auth from QR pa field into store immediately so subscription
    // mode is active even before the WebSocket state_update arrives.
    if (payload.pa) {
      const providerAuth: ProviderAuth = {
        gemini: { mode: payload.pa.g === 'sub' ? 'cli_proxy' : 'api_key', available: payload.pa.g === 'sub' },
        anthropic: { mode: payload.pa.a === 'sub' ? 'cli_proxy' : 'api_key', available: payload.pa.a === 'sub' },
        openai: { mode: payload.pa.o === 'sub' ? 'cli_proxy' : 'api_key', available: payload.pa.o === 'sub' },
      };
      useAIStore.getState().setProviderAuth(providerAuth);
      // Pre-set mobile auth preference for subscription providers — only if the user
      // hasn't already made an explicit manual choice (don't silently override preferences).
      const existingPrefs = useAIStore.getState().mobileAuthPreference;
      if (payload.pa.g === 'sub' && !existingPrefs.gemini) useAIStore.getState().setMobileAuthPreference('gemini', 'cli_proxy');
      if (payload.pa.a === 'sub' && !existingPrefs.anthropic) useAIStore.getState().setMobileAuthPreference('anthropic', 'cli_proxy');
      if (payload.pa.o === 'sub' && !existingPrefs.openai) useAIStore.getState().setMobileAuthPreference('openai', 'cli_proxy');
    }

    setIsConnecting(true);

    const isTemp = isTempScan || payload.connection_type === 'temp';

    if (isTemp) {
      // Temp connections: hold payload in memory only via bridge module
      const tempPayload = { ...payload, connection_type: 'temp' as const };
      setTempPayload(tempPayload);
      router.replace('/(connect)/reconnecting');
      return;
    }

    // Permanent connections: strip signaling_url to avoid persisting stale Cloudflare URLs
    const permanentPayload = { ...payload };
    delete permanentPayload.signaling_url;
    if (!permanentPayload.connection_type) {
      permanentPayload.connection_type = 'permanent';
    }

    try {
      await savePairingToken(permanentPayload);
      await saveApiKeysFromPayload(payload);
    } catch {
      await clearPairingToken().catch(() => {});
      setScanError('Failed to save pairing credentials. Please try again.');
      setIsConnecting(false);
      return;
    }

    router.replace('/(connect)/reconnecting');
  }

  function handleScanError(error: string) {
    setScanError(error);
    setTimeout(() => setScanError(''), 3000);
  }

  async function handleManualConnect() {
    const trimmedToken = manualToken.trim();
    const trimmedIp = hostIp.trim();
    const trimmedPort = port.trim();

    if (!trimmedToken || !trimmedIp || !trimmedPort) {
      setErrorMessage('Token, host, and port are required.');
      return;
    }

    const portNum = parseInt(trimmedPort, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setErrorMessage('Port must be a number between 1 and 65535.');
      return;
    }

    setIsConnecting(true);
    setErrorMessage('');

    // Build the same payload structure that a QR scan would produce
    const payload: PairingPayload = {
      token: trimmedToken,
      dtls_fingerprint: '',
      stun_config: DEFAULT_STUN_CONFIG,
      server_host: trimmedIp,
      server_port: portNum,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const trimmedGemini = geminiKey.trim();
    const trimmedOpenai = openaiKey.trim();
    const trimmedAnthropic = anthropicKey.trim();
    const trimmedOpenrouter = openrouterKey.trim();
    if (trimmedGemini) payload.gemini_api_key = trimmedGemini;
    if (trimmedOpenai) payload.openai_api_key = trimmedOpenai;
    if (trimmedAnthropic) payload.anthropic_api_key = trimmedAnthropic;
    if (trimmedOpenrouter) payload.openrouter_api_key = trimmedOpenrouter;

    // Same flow as QR scan (skip key check — API keys are optional for manual entry)
    await handleScanSuccess(payload, { skipKeyCheck: true });
  }

  return (
    <ScreenContainer className="px-8">
      <View className="flex-1 justify-center pt-6">
      {/* Header */}
      <View className="items-center mb-8">
        <ContopIcon size={56} color="#ffffff" />
        <Text className="text-lg text-white mt-3" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
          Connect to Host
        </Text>
        {message ? (
          <View testID="info-message" className="mt-4 px-4 py-3 bg-space-blue/20 rounded-xl">
            <Text className="text-sm text-gray-300 text-center">{message}</Text>
          </View>
        ) : null}
      </View>

      {/* Error display */}
      {errorMessage ? (
        <View testID="error-message" className="mb-4 px-4 py-3 bg-red-900/60 rounded-xl">
          <Text className="text-sm text-center text-white">{errorMessage}</Text>
        </View>
      ) : null}

      {/* Chooser — context-dependent buttons */}
      {mode === 'chooser' && (
        <View testID="chooser-content" className="gap-4">
          {isReturningUser ? (
            <>
              <Pressable
                testID="reconnect-button"
                onPress={handleReconnect}
                className="py-4 bg-space-blue rounded-xl items-center"
              >
                <Text className="text-white text-base font-semibold">Reconnect</Text>
              </Pressable>
              <Pressable
                testID="temp-connect-button"
                onPress={handleTempConnect}
                className="py-4 bg-white/10 rounded-xl items-center"
              >
                <Text className="text-gray-200 text-base font-semibold">Temp Connection</Text>
              </Pressable>
              <Pressable
                testID="forget-connection-button"
                onPress={() => setShowForgetConfirm(true)}
                className="py-3 items-center"
              >
                <Text className="text-red-400 text-sm font-medium">Forget Connection</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                testID="qr-select-button"
                onPress={handleQRSelect}
                className="py-4 bg-space-blue rounded-xl items-center"
              >
                <Text className="text-white text-base font-semibold">Connect</Text>
              </Pressable>
              <Pressable
                testID="temp-connect-button"
                onPress={handleTempConnect}
                className="py-4 bg-white/10 rounded-xl items-center"
              >
                <Text className="text-gray-200 text-base font-semibold">Temp Connection</Text>
              </Pressable>
            </>
          )}
          <Pressable
            testID="manual-select-button"
            onPress={() => { setMode('manual'); setErrorMessage(''); }}
            className="py-3 items-center"
          >
            <Text className="text-gray-400 text-sm font-medium">Enter Manually</Text>
          </Pressable>
        </View>
      )}

      {/* QR Scanner view */}
      {mode === 'qr' && (
        <View testID="qr-content" className="flex-1">
          {cameraReady ? (
            <View className="flex-1 rounded-2xl overflow-hidden">
              <QRScanner
                onScanSuccess={handleScanSuccess}
                onScanError={handleScanError}
              />
              {scanError ? (
                <View
                  testID="scan-error"
                  className="absolute bottom-4 left-4 right-4 bg-red-900/80 rounded-xl p-4"
                >
                  <Text className="text-center text-white">{scanError}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text className="text-gray-400 text-center px-8">
                Authenticating...
              </Text>
            </View>
          )}
          <Pressable
            testID="back-button"
            onPress={handleBack}
            className="mt-4 py-3 items-center"
          >
            <Text className="text-gray-400 text-sm font-medium">Back</Text>
          </Pressable>
        </View>
      )}

      {/* Manual Entry view */}
      {mode === 'manual' && (
        <View testID="manual-content">
          <View className="gap-4">
            <View>
              <Text className="text-sm text-gray-400 mb-2">Pairing Token</Text>
              <TextInput
                testID="token-input"
                value={manualToken}
                onChangeText={setManualToken}
                placeholder="From desktop app pairing screen"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
                className="bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white text-sm"
              />
            </View>
            <View>
              <Text className="text-sm text-gray-400 mb-2">Host IP Address</Text>
              <TextInput
                testID="host-ip-input"
                value={hostIp}
                onChangeText={setHostIp}
                placeholder="192.168.1.100"
                placeholderTextColor="#666"
                keyboardType="decimal-pad"
                autoCapitalize="none"
                className="bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white text-sm"
              />
            </View>
            <View>
              <Text className="text-sm text-gray-400 mb-2">Port</Text>
              <TextInput
                testID="port-input"
                value={port}
                onChangeText={setPort}
                placeholder="8000"
                placeholderTextColor="#666"
                keyboardType="number-pad"
                className="bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white text-sm"
              />
            </View>

            {/* API Keys — opens modal */}
            <Pressable
              testID="api-keys-toggle"
              onPress={() => setShowApiKeys(true)}
              className="flex-row items-center justify-between bg-white/5 border border-white/20 rounded-xl px-4 py-3"
            >
              <Text className="text-sm text-gray-400">
                API Keys <Text className="text-gray-600">(optional)</Text>
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#666" />
            </Pressable>

            {/* Connection help */}
            <View className="bg-white/5 rounded-xl px-4 py-3">
              <Text className="text-xs text-gray-400 mb-1" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                How to connect
              </Text>
              <Text className="text-xs text-gray-500">
                LAN: Use your computer's local IP (e.g. 192.168.x.x){'\n'}
                Tailscale: Use your Tailscale IP (100.x.x.x){'\n'}
                Default port is 8000 unless changed in settings.
              </Text>
            </View>
          </View>

          <Pressable
            testID="connect-button"
            onPress={handleManualConnect}
            disabled={isConnecting}
            className={`mt-8 py-4 rounded-xl items-center ${
              isConnecting ? 'bg-space-blue/50' : 'bg-space-blue'
            }`}
          >
            <Text className="text-white text-base font-semibold">
              {isConnecting ? 'Connecting...' : 'CONNECT'}
            </Text>
          </Pressable>

          <Pressable
            testID="back-button"
            onPress={handleBack}
            className="mt-4 py-3 items-center"
          >
            <Text className="text-gray-400 text-sm font-medium">Back</Text>
          </Pressable>
        </View>
      )}

      {/* API Keys Modal */}
      <Modal
        visible={showApiKeys}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowApiKeys(false)}
      >
        <View className="flex-1 justify-end bg-black/70">
          <View className="bg-[#0A0A0A] border-t border-white/10 rounded-t-2xl px-6 pt-5 pb-10">
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-base text-white" style={{ fontFamily: 'IBMPlexSans_500Medium' }}>
                API Keys
              </Text>
              <Pressable onPress={() => setShowApiKeys(false)} className="p-1">
                <Ionicons name="close" size={20} color="#999" />
              </Pressable>
            </View>
            <View className="gap-4">
              <View>
                <Text className="text-xs text-gray-500 mb-1">Gemini</Text>
                <TextInput
                  testID="gemini-key-input"
                  value={geminiKey}
                  onChangeText={setGeminiKey}
                  placeholder="Gemini API key"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                  secureTextEntry
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"
                />
              </View>
              <View>
                <Text className="text-xs text-gray-500 mb-1">OpenAI</Text>
                <TextInput
                  testID="openai-key-input"
                  value={openaiKey}
                  onChangeText={setOpenaiKey}
                  placeholder="OpenAI API key"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                  secureTextEntry
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"
                />
              </View>
              <View>
                <Text className="text-xs text-gray-500 mb-1">Anthropic</Text>
                <TextInput
                  testID="anthropic-key-input"
                  value={anthropicKey}
                  onChangeText={setAnthropicKey}
                  placeholder="Anthropic API key"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                  secureTextEntry
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"
                />
              </View>
              <View>
                <Text className="text-xs text-gray-500 mb-1">OpenRouter</Text>
                <TextInput
                  testID="openrouter-key-input"
                  value={openrouterKey}
                  onChangeText={setOpenrouterKey}
                  placeholder="OpenRouter API key"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                  secureTextEntry
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm"
                />
              </View>
            </View>
            <Pressable
              onPress={() => setShowApiKeys(false)}
              className="mt-6 py-3 bg-space-blue rounded-xl items-center"
            >
              <Text className="text-white text-sm font-semibold">Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </View>
      {/* Forget Connection Confirmation Modal */}
      <Modal
        visible={showForgetConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { if (!isForgetting) setShowForgetConfirm(false); }}
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
                disabled={isForgetting}
                className="flex-1 py-3 bg-white/10 rounded-xl items-center"
                accessibilityRole="button"
                accessibilityLabel="Cancel forget connection"
              >
                <Text className="text-gray-300 text-sm font-medium">Cancel</Text>
              </Pressable>
              <Pressable
                testID="forget-confirm-button"
                onPress={() => { void handleForgetConfirm(); }}
                disabled={isForgetting}
                className={`flex-1 py-3 rounded-xl items-center bg-red-500${isForgetting ? ' opacity-50' : ''}`}
                accessibilityRole="button"
                accessibilityLabel="Confirm forget connection"
              >
                <Text className="text-white text-sm font-semibold">
                  {isForgetting ? 'Forgetting\u2026' : 'Forget'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
