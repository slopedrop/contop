import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, TextInput, Pressable, View, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, cancelAnimation, Easing } from 'react-native-reanimated';
import { ScreenContainer, Text } from '../../components';
import { loadAISettings, saveAISettings } from '../../services/aiSettings';
import { GEMINI_TEXT_MODEL, COMPUTER_USE_BACKENDS, isThinkingEnabled, canToggleThinking } from '../../constants/providerConfig';
import { MODEL_REGISTRY, getAllModels, findModel, getProviderForModel } from '../../constants/modelRegistry';
import type { STTProvider as STTProviderType } from '../../types';
import useAIStore from '../../stores/useAIStore';
import { sendDeviceControl, sendAwayModeEngage, sendAwayModeDisengage, sendAwayModeStatus, sendRefreshProxyStatus } from '../../services/deviceControl';
import { clearPairingToken, clearAllApiKeys, getPairingToken, getAllApiKeys } from '../../services/secureStorage';
import { useWebRTC } from '../../hooks/useWebRTC';
import type { AISettings, AuthMode, ComputerUseBackend } from '../../types';

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (Codex)',
};

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const [settings, setSettings] = useState<AISettings>({
    conversationModel: GEMINI_TEXT_MODEL,
    executionModel: GEMINI_TEXT_MODEL,
    computerUseBackend: 'omniparser',
    customInstructions: null,
    thinkingEnabled: null,
    sttProvider: 'gemini',
  });
  const [sttPickerVisible, setSTTPickerVisible] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [rolePickerTarget, setRolePickerTarget] = useState<'conversationModel' | 'executionModel'>('conversationModel');
  const [backendPickerVisible, setBackendPickerVisible] = useState(false);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const promptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasAnyApiKey, setHasAnyApiKey] = useState(true); // assume true until checked
  const { isHostKeepAwake, setIsHostKeepAwake, isAwayMode, providerAuth, mobileAuthPreference, setMobileAuthPreference } = useAIStore();
  const { disconnect } = useWebRTC();
  const [isRefreshingProxy, setIsRefreshingProxy] = useState(false);
  const isRefreshingRef = useRef(false);
  const refreshRotation = useSharedValue(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${refreshRotation.value}deg` }],
  }));

  const stopRefreshSpin = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    cancelAnimation(refreshRotation);
    refreshRotation.value = withTiming(0, { duration: 200 });
    isRefreshingRef.current = false;
    setIsRefreshingProxy(false);
  }, [refreshRotation]);

  const handleRefreshProxy = useCallback(() => {
    if (isRefreshingRef.current) return;
    const sent = sendRefreshProxyStatus();
    if (!sent) return; // data channel not connected
    isRefreshingRef.current = true;
    setIsRefreshingProxy(true);
    refreshRotation.value = 0;
    refreshRotation.value = withRepeat(
      withTiming(360, { duration: 800, easing: Easing.linear }),
      -1,
    );
    // Auto-stop after 5s in case the server doesn't respond
    refreshTimerRef.current = setTimeout(stopRefreshSpin, 5000);
  }, [refreshRotation, stopRefreshSpin]);

  useEffect(() => {
    async function load() {
      const loaded = await loadAISettings();
      setSettings(loaded);
      const keys = await getAllApiKeys();
      setHasAnyApiKey(Object.values(keys).some((k) => !!k));
    }
    void load();
    // Request current away mode status so the toggle reflects reality
    sendAwayModeStatus();
    return () => {
      if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      cancelAnimation(refreshRotation);
    };
  }, [refreshRotation]);

  // Stop refresh spin when providerAuth updates from server
  useEffect(() => {
    if (isRefreshingRef.current) {
      stopRefreshSpin();
    }
  }, [providerAuth, stopRefreshSpin]);

  function openModelPicker(role: 'conversationModel' | 'executionModel') {
    setRolePickerTarget(role);
    setModelPickerVisible(true);
  }

  function handleModelSelect(modelValue: string) {
    setSettings((prev) => ({ ...prev, [rolePickerTarget]: modelValue }));
    setModelPickerVisible(false);
    void saveAISettings({ [rolePickerTarget]: modelValue });
  }

  function handleBackendSelect(value: ComputerUseBackend) {
    setSettings((prev) => ({ ...prev, computerUseBackend: value }));
    setBackendPickerVisible(false);
    void saveAISettings({ computerUseBackend: value });
  }

  function handlePromptChange(text: string) {
    const value = text.trim() ? text : null;
    setSettings((prev) => ({ ...prev, customInstructions: value }));
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    promptDebounceRef.current = setTimeout(() => {
      void saveAISettings({ customInstructions: value ? value.trim() : null });
    }, 500);
  }

  function handleClearInstructions() {
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    setSettings((prev) => ({ ...prev, customInstructions: null }));
    void saveAISettings({ customInstructions: null });
  }

  function handleThinkingToggle(value: boolean) {
    setSettings((prev) => ({ ...prev, thinkingEnabled: value }));
    void saveAISettings({ thinkingEnabled: value });
  }

  const thinkingToggleable = canToggleThinking(settings.conversationModel);
  const thinkingActive = isThinkingEnabled(settings.conversationModel, settings.thinkingEnabled);
  const activeModelConfig = findModel(settings.conversationModel);
  const thinkingAlwaysOn = activeModelConfig?.thinking === 'always';
  const thinkingNone = activeModelConfig?.thinking === 'none';

  function handleKeepAwakeToggle(value: boolean) {
    setIsHostKeepAwake(value);
    sendDeviceControl(value ? 'keep_awake_on' : 'keep_awake_off');
  }

  function handleLockConfirm() {
    setShowLockConfirm(false);
    sendDeviceControl('lock_screen');
  }

  function handleAwayModeToggle() {
    if (isAwayMode) {
      sendAwayModeDisengage();
    } else {
      sendAwayModeEngage();
    }
    // Request status update after a short delay to sync state
    setTimeout(() => sendAwayModeStatus(), 500);
  }

  function handleForgetConnection() {
    const isTemp = useAIStore.getState().connectionType === 'temp';

    if (isTemp) {
      // Temp connection: just disconnect, don't touch permanent credentials
      disconnect();
      useAIStore.getState().softReset();
      router.replace('/(connect)/connect');
      return;
    }

    // Permanent connection: show inline confirmation card
    setShowForgetConfirm(true);
  }

  async function handleForgetConfirm() {
    if (isConfirming) return;
    setIsConfirming(true);

    // Best-effort server notification with 3s timeout — never blocks local cleanup
    try {
      const payload = await getPairingToken();
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

  const allModels = getAllModels();
  const activeConversationModel = findModel(settings.conversationModel) ?? allModels[0];
  const activeExecutionModel = findModel(settings.executionModel) ?? allModels[0];

  const STT_OPTIONS: Array<{ value: STTProviderType; label: string; description: string }> = [
    { value: 'gemini', label: 'Gemini', description: 'Uses Gemini generateContent for transcription' },
    { value: 'openai', label: 'OpenAI Whisper', description: 'Dedicated STT API — fast and accurate' },
    { value: 'openrouter', label: 'OpenRouter', description: 'Whisper via OpenRouter gateway' },
    { value: 'disabled', label: 'Disabled', description: 'Voice input disabled — text only' },
  ];

  function handleSTTSelect(value: STTProviderType) {
    setSettings((prev) => ({ ...prev, sttProvider: value }));
    setSTTPickerVisible(false);
    void saveAISettings({ sttProvider: value });
  }

  const activeSTT = STT_OPTIONS.find((o) => o.value === settings.sttProvider) ?? STT_OPTIONS[0];

  const activeBackend =
    COMPUTER_USE_BACKENDS.find((b) => b.value === settings.computerUseBackend) ?? COMPUTER_USE_BACKENDS[0];

  const modelPickerTitle =
    rolePickerTarget === 'conversationModel' ? 'SELECT CONVERSATION MODEL' : 'SELECT EXECUTION MODEL';

  const modelPickerActiveValue =
    rolePickerTarget === 'conversationModel' ? settings.conversationModel : settings.executionModel;

  return (
    <ScreenContainer edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          testID="settings-back-button"
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        testID="settings-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Model Configuration Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MODEL CONFIGURATION</Text>

          {/* Conversation Model */}
          <Pressable
            testID="conversation-model-trigger"
            onPress={() => openModelPicker('conversationModel')}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel="Select conversation model"
          >
            <View style={styles.pickerRow}>
              <View style={styles.pickerTextGroup}>
                <Text style={styles.pickerDescription}>Conversation Model</Text>
                <View style={styles.pickerLabelRow}>
                  <Text style={styles.pickerLabel}>{activeConversationModel.label}</Text>
                  {useAIStore.getState().isSubscriptionActive(getProviderForModel(settings.conversationModel)) && (
                    <View style={styles.subBadge}><Text style={styles.subBadgeText}>SUB</Text></View>
                  )}
                </View>
                <Text style={styles.pickerDescription}>{activeConversationModel.description}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color="#6B7280" />
            </View>
          </Pressable>

          {/* Execution Model */}
          <Pressable
            testID="execution-model-trigger"
            onPress={() => openModelPicker('executionModel')}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel="Select execution model"
          >
            <View style={styles.pickerRow}>
              <View style={styles.pickerTextGroup}>
                <Text style={styles.pickerDescription}>Execution Model</Text>
                <View style={styles.pickerLabelRow}>
                  <Text style={styles.pickerLabel}>{activeExecutionModel.label}</Text>
                  {useAIStore.getState().isSubscriptionActive(getProviderForModel(settings.executionModel)) && (
                    <View style={styles.subBadge}><Text style={styles.subBadgeText}>SUB</Text></View>
                  )}
                  {useAIStore.getState().isSubscriptionActive(getProviderForModel(settings.executionModel)) && (
                    <View style={styles.noVisionBadge}><Text style={styles.noVisionBadgeText}>NO VISION</Text></View>
                  )}
                </View>
                <Text style={styles.pickerDescription}>{activeExecutionModel.description}</Text>
                {useAIStore.getState().isSubscriptionActive(getProviderForModel(settings.executionModel)) && (
                  <Text style={styles.pickerHint}>Vision fallback unavailable via CLI proxy — uses local vision backend only</Text>
                )}
              </View>
              <Ionicons name="chevron-down" size={16} color="#6B7280" />
            </View>
          </Pressable>

          {/* Computer Use Backend */}
          <Pressable
            testID="backend-picker-trigger"
            onPress={() => setBackendPickerVisible(true)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel="Select computer use backend"
          >
            <View style={styles.pickerRow}>
              <View style={styles.pickerTextGroup}>
                <Text style={styles.pickerDescription}>Computer Use Backend</Text>
                <Text style={styles.pickerLabel}>{activeBackend.label}</Text>
                <Text style={styles.pickerDescription}>{activeBackend.description}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color="#6B7280" />
            </View>
          </Pressable>

          {/* Speech-to-Text Provider */}
          <Pressable
            testID="stt-picker-trigger"
            onPress={() => setSTTPickerVisible(true)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel="Select speech-to-text provider"
          >
            <View style={styles.pickerRow}>
              <View style={styles.pickerTextGroup}>
                <Text style={styles.pickerDescription}>Speech-to-Text</Text>
                <Text style={styles.pickerLabel}>{activeSTT.label}</Text>
                <Text style={styles.pickerDescription}>{activeSTT.description}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color="#6B7280" />
            </View>
          </Pressable>
        </View>

        {/* Subscription Mode — right after model pickers */}
        {providerAuth && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>SUBSCRIPTION MODE</Text>
              <Pressable
                testID="refresh-proxy-button"
                onPress={handleRefreshProxy}
                disabled={isRefreshingProxy}
                accessibilityLabel="Refresh proxy status"
                accessibilityRole="button"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.refreshButton}
              >
                <Animated.View style={refreshAnimatedStyle}>
                  <Ionicons name="refresh" size={14} color={isRefreshingProxy ? '#6B7280' : '#9CA3AF'} />
                </Animated.View>
              </Pressable>
            </View>
            {(['gemini', 'anthropic', 'openai'] as const).map((provider) => {
              const config = providerAuth[provider];
              const isAvailable = config?.available === true;
              const isActive = isAvailable && mobileAuthPreference[provider] === 'cli_proxy';
              return (
                <View key={provider} style={styles.card}>
                  <View style={styles.controlRow}>
                    <View style={styles.controlTextGroup}>
                      <View style={styles.pickerLabelRow}>
                        <Text style={styles.controlLabel}>{PROVIDER_LABELS[provider] ?? provider}</Text>
                        <View style={[styles.statusDot, isAvailable ? styles.statusDotOn : styles.statusDotOff]} />
                      </View>
                      <Text style={styles.controlDescription}>
                        {!isAvailable
                          ? 'Proxy not running on desktop'
                          : isActive
                            ? 'Using desktop subscription'
                            : 'Using API key'}
                      </Text>
                    </View>
                    <Switch
                      value={isActive}
                      onValueChange={(v) => setMobileAuthPreference(provider, v ? 'cli_proxy' : 'api_key')}
                      disabled={!isAvailable}
                      trackColor={{ false: '#374151', true: '#095BB9' }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor="#374151"
                      accessibilityLabel={`${PROVIDER_LABELS[provider]} subscription mode`}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: isActive, disabled: !isAvailable }}
                    />
                  </View>
                </View>
              );
            })}
            <Text style={styles.hint}>
              Routes requests through your desktop CLI instead of API keys. Green dot means proxy is running.
            </Text>
            {!hasAnyApiKey && (
              <Text style={[styles.hint, { color: '#D97706', marginTop: 4 }]}>
                No API keys stored. If you add keys on desktop, rescan the QR code to use them here.
              </Text>
            )}
          </View>
        )}

        {/* Thinking Toggle Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>THINKING</Text>
          <View style={styles.card}>
            <View style={styles.controlRow}>
              <View style={styles.controlTextGroup}>
                <Text style={styles.controlLabel}>Extended Thinking</Text>
                <Text style={styles.controlDescription}>
                  {thinkingNone
                    ? 'Not supported by this model'
                    : thinkingAlwaysOn
                      ? 'Always enabled for this model'
                      : 'Show model reasoning between steps'}
                </Text>
              </View>
              <Switch
                testID="thinking-toggle"
                value={thinkingActive}
                onValueChange={handleThinkingToggle}
                disabled={!thinkingToggleable}
                trackColor={{ false: '#374151', true: '#095BB9' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#374151"
                accessibilityLabel="Extended thinking"
                accessibilityRole="switch"
                accessibilityState={{ checked: thinkingActive }}
              />
            </View>
          </View>
        </View>

        {/* Custom Instructions Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>CUSTOM INSTRUCTIONS</Text>
            {settings.customInstructions !== null && (
              <Pressable
                testID="clear-instructions-button"
                onPress={handleClearInstructions}
                accessibilityLabel="Clear custom instructions"
                accessibilityRole="button"
              >
                <Text style={styles.resetLabel}>Clear</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.card}>
            <TextInput
              testID="custom-instructions-input"
              value={settings.customInstructions ?? ''}
              onChangeText={handlePromptChange}
              multiline
              numberOfLines={8}
              maxLength={4000}
              placeholder={"Add personal instructions that are appended to the default system prompt. These take priority on conflicts.\n\nExamples:\n• Always use PowerShell instead of cmd\n• My project is at C:\\Dev\\myapp\n• Respond in Spanish\n• Never delete files without asking first"}
              placeholderTextColor="#4B5563"
              style={styles.promptInput}
              textAlignVertical="top"
              accessibilityLabel="Custom instructions"
            />
          </View>
          <Text testID="instructions-hint" style={styles.hint}>
            These are added to the default prompt, not replacing it. Edit full system prompts from the desktop app.
          </Text>
        </View>

        {/* Device Controls Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DEVICE CONTROLS</Text>

          {/* Keep Awake row */}
          <View style={styles.card}>
            <View style={styles.controlRow}>
              <View style={styles.controlTextGroup}>
                <Text style={styles.controlLabel}>Keep Host Awake</Text>
                <Text style={styles.controlDescription}>
                  Prevent your desktop from sleeping while the server is running
                </Text>
              </View>
              <Switch
                testID="keep-awake-toggle"
                value={isHostKeepAwake}
                onValueChange={handleKeepAwakeToggle}
                trackColor={{ false: '#374151', true: '#095BB9' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#374151"
                accessibilityLabel="Keep host awake"
                accessibilityRole="switch"
                accessibilityState={{ checked: isHostKeepAwake }}
              />
            </View>
          </View>

          {/* Away Mode — engage/disengage from phone */}
          <Pressable
            testID="away-mode-button"
            onPress={handleAwayModeToggle}
            style={[styles.lockButton, isAwayMode && { borderColor: '#22C55E' }]}
            accessibilityRole="button"
            accessibilityLabel={isAwayMode ? 'Disengage Away Mode' : 'Engage Away Mode'}
          >
            <Ionicons
              name={isAwayMode ? 'shield-checkmark' : 'shield-outline'}
              size={15}
              color={isAwayMode ? '#22C55E' : '#3B82F6'}
            />
            <Text style={[styles.lockButtonText, isAwayMode && { color: '#22C55E' }]}>
              {isAwayMode ? 'Disengage Away Mode' : 'Engage Away Mode'}
            </Text>
          </Pressable>

          {/* Lock Screen — button or inline confirmation */}
          {!showLockConfirm ? (
            <Pressable
              testID="lock-screen-button"
              onPress={() => setShowLockConfirm(true)}
              style={styles.lockButton}
              accessibilityRole="button"
              accessibilityLabel="Lock host screen"
            >
              <Ionicons name="lock-closed-outline" size={15} color="#EF4444" />
              <Text style={styles.lockButtonText}>Lock Screen</Text>
            </Pressable>
          ) : (
            <View testID="lock-confirm-card" style={styles.lockWarningCard}>
              <View style={styles.lockWarningHeader}>
                <Ionicons name="warning-outline" size={15} color="#F59E0B" />
                <Text style={styles.lockWarningTitle}>Lock host screen?</Text>
              </View>
              <Text style={styles.lockWarningBody}>
                This will immediately lock your host screen. You can still disconnect
                this session but will be unable to send commands until you unlock the
                desktop.
              </Text>
              <View style={styles.lockWarningActions}>
                <Pressable
                  testID="lock-cancel-button"
                  onPress={() => setShowLockConfirm(false)}
                  style={styles.lockCancelButton}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel lock"
                >
                  <Text style={styles.lockCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="lock-confirm-button"
                  onPress={handleLockConfirm}
                  style={styles.lockConfirmButton}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm lock screen"
                >
                  <Text style={styles.lockConfirmText}>Lock Now</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* Connection Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CONNECTION</Text>
          <Pressable
            testID="forget-connection-button"
            onPress={handleForgetConnection}
            style={styles.lockButton}
            accessibilityRole="button"
            accessibilityLabel="Forget connection"
          >
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
            <Text style={styles.lockButtonText}>Forget Connection</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Model Picker Modal (shared for conversation + execution) */}
      <Modal
        visible={modelPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModelPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModelPickerVisible(false)} />
          <View style={styles.dropdown} testID="model-picker">
            <Text style={styles.dropdownLabel}>{modelPickerTitle}</Text>
            <ScrollView style={styles.dropdownScroll} bounces={false} nestedScrollEnabled>
              {MODEL_REGISTRY.map((group, idx) => (
                <View key={`${group.provider}-${idx}`}>
                  <Text style={[styles.sectionLabel, { marginTop: 12, marginBottom: 4, marginLeft: 4 }]}>
                    {group.label.toUpperCase()}
                  </Text>
                  {group.models.map((model) => {
                    const isActive = modelPickerActiveValue === model.value;
                    return (
                      <Pressable
                        key={model.value}
                        testID={`model-option-${model.value}`}
                        onPress={() => handleModelSelect(model.value)}
                        style={[styles.dropdownItem, isActive && styles.dropdownItemActive]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: isActive }}
                      >
                        <View style={styles.dropdownItemContent}>
                          <Text
                            style={[styles.dropdownItemLabel, isActive && styles.dropdownItemLabelActive]}
                          >
                            {model.label}
                          </Text>
                        </View>
                        {isActive && <Ionicons name="checkmark" size={16} color="#095BB9" />}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Forget Connection Confirmation Modal */}
      <Modal
        visible={showForgetConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { if (!isConfirming) setShowForgetConfirm(false); }}
      >
        <View style={styles.modalBackdrop} accessibilityLiveRegion="assertive">
          <View style={styles.forgetModal}>
            <View style={styles.forgetModalIcon}>
              <Ionicons name="trash-outline" size={24} color="#EF4444" />
            </View>
            <Text style={styles.forgetModalTitle}>Forget Connection?</Text>
            <Text style={styles.forgetModalBody}>
              This will clear your pairing credentials and disconnect from the host. You will need to scan a new QR code to reconnect.
            </Text>
            <View style={styles.lockWarningActions}>
              <Pressable
                testID="forget-cancel-button"
                onPress={() => setShowForgetConfirm(false)}
                disabled={isConfirming}
                style={styles.lockCancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel forget connection"
              >
                <Text style={styles.lockCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="forget-confirm-button"
                onPress={() => { void handleForgetConfirm(); }}
                disabled={isConfirming}
                style={[styles.forgetConfirmButton, isConfirming && styles.forgetConfirmButtonDisabled]}
                accessibilityRole="button"
                accessibilityLabel="Confirm forget connection"
              >
                <Text style={styles.lockConfirmText}>{isConfirming ? 'Forgetting…' : 'Forget'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Computer Use Backend Picker Modal */}
      <Modal
        visible={backendPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBackendPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setBackendPickerVisible(false)} />
          <View style={styles.dropdown} testID="backend-picker">
            <Text style={styles.dropdownLabel}>SELECT COMPUTER USE BACKEND</Text>
            <ScrollView style={styles.dropdownScroll} bounces={false} nestedScrollEnabled>
              {COMPUTER_USE_BACKENDS.map((backend) => {
                const isActive = settings.computerUseBackend === backend.value;
                return (
                  <Pressable
                    key={backend.value}
                    testID={`backend-option-${backend.value}`}
                    onPress={() => handleBackendSelect(backend.value)}
                    style={[styles.dropdownItem, isActive && styles.dropdownItemActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isActive }}
                  >
                    <View style={styles.dropdownItemContent}>
                      <Text
                        style={[styles.dropdownItemLabel, isActive && styles.dropdownItemLabelActive]}
                      >
                        {backend.label}
                      </Text>
                      <Text style={styles.dropdownItemDescription}>{backend.description}</Text>
                    </View>
                    {isActive && <Ionicons name="checkmark" size={16} color="#095BB9" />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* STT Provider Picker Modal */}
      <Modal
        visible={sttPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSTTPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSTTPickerVisible(false)} />
          <View style={styles.dropdown} testID="stt-picker">
            <Text style={styles.dropdownLabel}>SELECT SPEECH-TO-TEXT PROVIDER</Text>
            <ScrollView style={styles.dropdownScroll} bounces={false} nestedScrollEnabled>
              {STT_OPTIONS.map((option) => {
                const isActive = settings.sttProvider === option.value;
                return (
                  <Pressable
                    key={option.value}
                    testID={`stt-option-${option.value}`}
                    onPress={() => handleSTTSelect(option.value)}
                    style={[styles.dropdownItem, isActive && styles.dropdownItemActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isActive }}
                  >
                    <View style={styles.dropdownItemContent}>
                      <Text
                        style={[styles.dropdownItemLabel, isActive && styles.dropdownItemLabelActive]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.dropdownItemDescription}>{option.description}</Text>
                    </View>
                    {isActive && <Ionicons name="checkmark" size={16} color="#095BB9" />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 24,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#6B7280',
    letterSpacing: 1,
  },
  resetLabel: {
    fontSize: 13,
    color: '#F59E0B',
  },
  refreshButton: {
    padding: 4,
  },
  card: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pickerTextGroup: {
    flex: 1,
    gap: 2,
  },
  pickerLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  pickerLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subBadge: {
    backgroundColor: '#095BB9',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  subBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  noVisionBadge: {
    backgroundColor: '#92400E',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  noVisionBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  pickerHint: {
    fontSize: 11,
    color: '#92400E',
    marginTop: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotOn: {
    backgroundColor: '#22C55E',
  },
  statusDotOff: {
    backgroundColor: '#6B7280',
    opacity: 0.4,
  },
  pickerDescription: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  promptInput: {
    padding: 16,
    fontSize: 14,
    color: '#FFFFFF',
    minHeight: 160,
    fontFamily: 'IBMPlexSans_400Regular',
  },
  hint: {
    fontSize: 12,
    color: '#6B7280',
    paddingHorizontal: 4,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  controlTextGroup: {
    flex: 1,
    gap: 2,
  },
  controlLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  controlDescription: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  lockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239,68,68,0.06)',
  },
  lockButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#EF4444',
  },
  lockWarningCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    padding: 16,
    gap: 12,
  },
  forgetModal: {
    backgroundColor: '#0A0A0A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  forgetModalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  forgetModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    fontFamily: 'IBMPlexSans_700Bold',
  },
  forgetModalBody: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
  forgetConfirmButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#EF4444',
  },
  forgetConfirmButtonDisabled: {
    opacity: 0.5,
  },
  lockWarningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockWarningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F59E0B',
  },
  lockWarningBody: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 20,
  },
  lockWarningActions: {
    flexDirection: 'row',
    gap: 8,
  },
  lockCancelButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  lockCancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  lockConfirmButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#EF4444',
  },
  lockConfirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dropdown: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    paddingTop: 12,
    paddingBottom: 4,
    maxHeight: '80%',
  },
  dropdownScroll: {
    flexGrow: 0,
  },
  dropdownLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#6B7280',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(9,91,185,0.08)',
  },
  dropdownItemContent: {
    flex: 1,
    gap: 2,
  },
  dropdownItemLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  dropdownItemLabelActive: {
    color: '#FFFFFF',
  },
  dropdownItemDescription: {
    fontSize: 12,
    color: '#6B7280',
  },
  dropdownItemCost: {
    fontSize: 11,
    color: '#4B5563',
    marginTop: 1,
  },
});
