import React, { useState, useEffect, useMemo } from 'react';
import { View, TextInput, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { SharedValue } from 'react-native-reanimated';
import useAIStore from '../stores/useAIStore';
import { findModel, getProviderForModel } from '../constants/modelRegistry';
import AuroraVoice from './AuroraVoice';

interface ExecutionInputBarProps {
  chatInput: string;
  onChangeText: (text: string) => void;
  isVoiceActive: boolean;
  isTranscribing: boolean;
  audioLevel: SharedValue<number>;
  onSend: () => void;
  onMicPress: () => void;
  onVoiceCancel: () => void;
  onVoiceSend: () => void;
  onStopExecution: () => void;
  onUndo?: () => void;
  hasHistory?: boolean;
  conversationModel?: string;
  executionModel?: string;
  onModelPress?: () => void;
  availableKeys?: Record<string, boolean>;
}

export default function ExecutionInputBar({
  chatInput,
  onChangeText,
  isVoiceActive,
  isTranscribing,
  audioLevel,
  onSend,
  onMicPress,
  onVoiceCancel,
  onVoiceSend,
  onStopExecution,
  onUndo,
  hasHistory,
  conversationModel,
  executionModel,
  onModelPress,
  availableKeys,
}: ExecutionInputBarProps) {
  const { aiState, providerAuth, mobileAuthPreference } = useAIStore();
  const insets = useSafeAreaInsets();
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [inputHeight, setInputHeight] = useState(44);

  useEffect(() => {
    if (!isVoiceActive) {
      setRecordingSeconds(0);
      return;
    }
    const interval = setInterval(() => setRecordingSeconds(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [isVoiceActive]);

  const isSendDisabled = chatInput.trim() === '' || isTranscribing;
  const showStopButton = aiState === 'processing' || aiState === 'executing';

  const { chatLabel, agentLabel, chatIsSub, agentIsSub, chatNoKey, agentNoKey } = useMemo(() => {
    const isSub = (model: string) => {
      const provider = getProviderForModel(model);
      return providerAuth?.[provider]?.available === true && mobileAuthPreference[provider] === 'cli_proxy';
    };
    const hasNoKey = (model: string) => {
      const provider = getProviderForModel(model);
      return availableKeys?.[provider] !== true;
    };
    return {
      chatLabel: conversationModel ? (findModel(conversationModel)?.label ?? conversationModel) : '',
      agentLabel: executionModel ? (findModel(executionModel)?.label ?? executionModel) : '',
      chatIsSub: conversationModel ? isSub(conversationModel) : false,
      agentIsSub: executionModel ? isSub(executionModel) : false,
      chatNoKey: conversationModel ? hasNoKey(conversationModel) : false,
      agentNoKey: executionModel ? hasNoKey(executionModel) : false,
    };
  }, [conversationModel, executionModel, providerAuth, mobileAuthPreference, availableKeys]);

  return (
    <View
      testID="input-bar"
      accessibilityRole="none"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}
    >
      {!isVoiceActive && conversationModel ? (
        <Pressable testID="model-indicator" onPress={onModelPress} style={styles.modelChip}>
          <Text style={styles.modelRoleText}>Chat</Text>
          <Text numberOfLines={1} style={styles.modelText}>{chatLabel}</Text>
          {chatIsSub && <View style={styles.subBadge}><Text style={styles.subBadgeText}>SUB</Text></View>}
          {chatNoKey && <View style={styles.noKeyBadge}><Text style={styles.noKeyBadgeText}>NO KEY</Text></View>}
          {executionModel ? (
            <>
              <View style={styles.modelDivider} />
              <Text style={styles.modelRoleText}>Agent</Text>
              <Text numberOfLines={1} style={styles.modelText}>{agentLabel}</Text>
              {agentIsSub && <View style={styles.subBadge}><Text style={styles.subBadgeText}>SUB</Text></View>}
              {agentNoKey && <View style={styles.noKeyBadge}><Text style={styles.noKeyBadgeText}>NO KEY</Text></View>}
            </>
          ) : null}
          <Ionicons name="chevron-down" size={10} color="#9CA3AF" />
        </Pressable>
      ) : null}
      {isVoiceActive ? (
        <AuroraVoice
          audioLevel={audioLevel}
          recordingSeconds={recordingSeconds}
          onCancel={onVoiceCancel}
          onSend={onVoiceSend}
        />
      ) : (
        <View style={styles.textInputRow}>
          <TextInput
            testID="chat-text-input"
            value={chatInput}
            onChangeText={onChangeText}
            placeholder="Type a message..."
            placeholderTextColor="#888"
            editable={!isTranscribing}
            multiline
            scrollEnabled
            onContentSizeChange={(e) => {
              const h = Math.min(180, Math.max(44, e.nativeEvent.contentSize.height));
              setInputHeight(h);
            }}
            style={[styles.textInput, { height: inputHeight }]}
          />
          <Pressable
            testID="mic-button"
            onPress={onMicPress}
            style={styles.micButton}
            accessibilityLabel="Voice input"
            accessibilityRole="button"
          >
            <Ionicons name="mic" size={16} color="#ffffff" />
          </Pressable>
          {aiState === 'idle' && onUndo && (
            <Pressable
              testID="undo-button"
              onPress={hasHistory ? onUndo : undefined}
              style={[styles.undoButton, !hasHistory && styles.undoButtonDisabled]}
              accessibilityLabel="Undo last action"
              accessibilityRole="button"
              disabled={!hasHistory}
            >
              <Ionicons name="arrow-undo" size={16} color="#ffffff" />
            </Pressable>
          )}
          <Pressable
            testID="chat-send-button"
            onPress={isSendDisabled ? undefined : onSend}
            style={[styles.sendButton, isSendDisabled && styles.sendButtonDisabled]}
            accessibilityLabel="Send message"
            accessibilityRole="button"
          >
            <Ionicons name="send" size={16} color="#ffffff" />
          </Pressable>
          {showStopButton && (
            <Pressable
              testID="stop-execution-button"
              onPress={onStopExecution}
              style={styles.stopButton}
              accessibilityLabel="Stop execution"
              accessibilityRole="button"
            >
              <Ionicons name="stop" size={14} color="#EF4444" />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#0A0A0A', // surface-1
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingTop: 8,
    alignItems: 'center',
  },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  modelRoleText: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modelText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    flexShrink: 1,
  },
  modelDivider: {
    width: 1,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 4,
  },
  subBadge: {
    backgroundColor: '#095BB9',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  subBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  noKeyBadge: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  noKeyBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  textInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  textInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    minHeight: 44,
    textAlignVertical: 'top',
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoButtonDisabled: {
    opacity: 0.3,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#095BB9', // space-blue
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  stopButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239,68,68,0.25)', // red/25
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
