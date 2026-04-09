import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, TextInput, Pressable, View, StyleSheet, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenContainer, Text } from '../components';
import TailscaleGuide from '../components/TailscaleGuide';
import { loadAISettings, saveAISettings } from '../services/aiSettings';
import { loadConnectionSettings, saveConnectionSettings } from '../services/connectionSettings';
import type { ConnectionSettings } from '../services/connectionSettings';
import { GEMINI_TEXT_MODEL, COMPUTER_USE_BACKENDS, isThinkingEnabled, canToggleThinking } from '../constants/providerConfig';
import { MODEL_REGISTRY, getAllModels, findModel } from '../constants/modelRegistry';
import { getPairingToken, clearPairingToken, clearAllApiKeys } from '../services/secureStorage';
import useAIStore from '../stores/useAIStore';
import type { AISettings, ComputerUseBackend, PairingPayload, RemoteAccessMethod } from '../types';

const REMOTE_ACCESS_OPTIONS: Array<{
  value: RemoteAccessMethod;
  label: string;
  description: string;
}> = [
    { value: 'tailscale', label: 'Tailscale', description: 'Stable, one-time setup' },
    { value: 'cloudflare', label: 'Cloudflare', description: 'Zero setup, limited reconnection' },
    { value: 'none', label: 'None', description: 'LAN only' },
  ];

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const [settings, setSettings] = useState<AISettings>({
    conversationModel: GEMINI_TEXT_MODEL,
    executionModel: GEMINI_TEXT_MODEL,
    computerUseBackend: 'omniparser',
    customInstructions: null,
    thinkingEnabled: null,
  });
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [rolePickerTarget, setRolePickerTarget] = useState<'conversationModel' | 'executionModel'>('conversationModel');
  const [backendPickerVisible, setBackendPickerVisible] = useState(false);
  const [remoteAccessPickerVisible, setRemoteAccessPickerVisible] = useState(false);
  const [connSettings, setConnSettings] = useState<ConnectionSettings>({ remoteAccess: 'cloudflare' });
  const [tailscaleGuideVisible, setTailscaleGuideVisible] = useState(false);
  const promptDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [storedPayload, setStoredPayload] = useState<PairingPayload | null>(null);

  useEffect(() => {
    async function load() {
      const [aiLoaded, connLoaded, payload] = await Promise.all([
        loadAISettings(),
        loadConnectionSettings(),
        getPairingToken(),
      ]);
      setSettings(aiLoaded);
      setConnSettings(connLoaded);
      setStoredPayload(payload);
    }
    void load();
    return () => {
      if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    };
  }, []);

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

  function handleRemoteAccessSelect(value: RemoteAccessMethod) {
    const prevAccess = connSettings.remoteAccess;
    setConnSettings((prev) => ({ ...prev, remoteAccess: value }));
    setRemoteAccessPickerVisible(false);
    void saveConnectionSettings({ remoteAccess: value });
    // Show Tailscale guide on first selection
    if (value === 'tailscale' && prevAccess !== 'tailscale') {
      setTailscaleGuideVisible(true);
    }
  }

  function handleForgetConnection() {
    Alert.alert(
      'Forget Connection',
      'This will clear your pairing credentials. You will need to scan a new QR code to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: async () => {
            if (storedPayload) {
              const hosts = [
                `http://${storedPayload.server_host}:${storedPayload.server_port}`,
                storedPayload.tailscale_host ? `http://${storedPayload.tailscale_host}:${storedPayload.server_port}` : null,
              ].filter(Boolean);
              for (const base of hosts) {
                try {
                  await fetch(`${base}/api/pair`, { method: 'DELETE' });
                  break; // Success - no need to try other hosts
                } catch { /* Host unreachable - try next */ }
              }
            }
            await clearPairingToken();
            await clearAllApiKeys();
            useAIStore.getState().hardReset();
            setStoredPayload(null);
            router.replace('/(connect)/connect');
          },
        },
      ],
    );
  }

  const activeConversationModel =
    findModel(settings.conversationModel) ?? getAllModels()[0];

  const activeExecutionModel =
    findModel(settings.executionModel) ?? getAllModels()[0];

  const activeBackend =
    COMPUTER_USE_BACKENDS.find((b) => b.value === settings.computerUseBackend) ?? COMPUTER_USE_BACKENDS[0];

  const activeRemoteAccess =
    REMOTE_ACCESS_OPTIONS.find((o) => o.value === connSettings.remoteAccess) ?? REMOTE_ACCESS_OPTIONS[1];

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
                <Text style={styles.pickerLabel}>{activeConversationModel.label}</Text>
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
                <Text style={styles.pickerLabel}>{activeExecutionModel.label}</Text>
                <Text style={styles.pickerDescription}>{activeExecutionModel.description}</Text>
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
        </View>

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

        {/* Remote Access Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>REMOTE ACCESS</Text>
          <Pressable
            testID="remote-access-trigger"
            onPress={() => setRemoteAccessPickerVisible(true)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel="Select remote access method"
          >
            <View style={styles.pickerRow}>
              <View style={styles.pickerTextGroup}>
                <Text style={styles.pickerLabel}>{activeRemoteAccess.label}</Text>
                <Text style={styles.pickerDescription}>{activeRemoteAccess.description}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color="#6B7280" />
            </View>
          </Pressable>
        </View>

        {/* Connection Section - only shown if a stored token exists */}
        {storedPayload && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CONNECTION</Text>
            <View style={styles.card}>
              <View style={styles.controlRow}>
                <View style={styles.controlTextGroup}>
                  <Text style={styles.controlLabel}>Paired Device</Text>
                  <Text style={styles.controlDescription}>
                    Expires {new Date(storedPayload.expires_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            </View>
            <Pressable
              testID="forget-connection-button"
              onPress={handleForgetConnection}
              style={styles.forgetButton}
              accessibilityRole="button"
              accessibilityLabel="Forget connection"
            >
              <Ionicons name="trash-outline" size={15} color="#EF4444" />
              <Text style={styles.forgetButtonText}>Forget Connection</Text>
            </Pressable>
          </View>
        )}
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

      {/* Remote Access Picker Modal */}
      <Modal
        visible={remoteAccessPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoteAccessPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRemoteAccessPickerVisible(false)} />
          <View style={styles.dropdown} testID="remote-access-picker">
            <Text style={styles.dropdownLabel}>SELECT REMOTE ACCESS</Text>
            <ScrollView style={styles.dropdownScroll} bounces={false} nestedScrollEnabled>
              {REMOTE_ACCESS_OPTIONS.map((option) => {
                const isActive = connSettings.remoteAccess === option.value;
                return (
                  <Pressable
                    key={option.value}
                    testID={`remote-access-option-${option.value}`}
                    onPress={() => handleRemoteAccessSelect(option.value)}
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

      {/* Tailscale Setup Guide */}
      <TailscaleGuide
        visible={tailscaleGuideVisible}
        onClose={() => setTailscaleGuideVisible(false)}
      />
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
  forgetButton: {
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
  forgetButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#EF4444',
  },
});
