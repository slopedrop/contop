import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AISettings } from '../types';
import { GEMINI_TEXT_MODEL } from '../constants/providerConfig';
import { CONVERSATION_AGENT_PROMPT } from '../prompts/conversation-agent';

const AI_SETTINGS_KEY = '@contop:ai_settings';

export const DEFAULT_AI_SETTINGS: AISettings = {
  conversationModel: GEMINI_TEXT_MODEL,
  executionModel: GEMINI_TEXT_MODEL,
  computerUseBackend: 'omniparser',
  customInstructions: null,
  thinkingEnabled: null,
  sttProvider: 'gemini',
};

export async function loadAISettings(): Promise<AISettings> {
  const raw = await AsyncStorage.getItem(AI_SETTINGS_KEY);
  if (!raw) return DEFAULT_AI_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    // Migration: old schema had `selectedModel` instead of per-role fields
    if (parsed.selectedModel && !parsed.conversationModel) {
      const migrated: AISettings = {
        ...DEFAULT_AI_SETTINGS,
        conversationModel: parsed.selectedModel,
        executionModel: parsed.selectedModel,
        customInstructions: parsed.customInstructions ?? parsed.customSystemPrompt ?? null,
        thinkingEnabled: parsed.thinkingEnabled ?? null,
      };
      await AsyncStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(migrated));
      return migrated;
    }
    // Migration: rename customSystemPrompt → customInstructions
    if ('customSystemPrompt' in parsed && !('customInstructions' in parsed)) {
      parsed.customInstructions = parsed.customSystemPrompt;
    }
    // Clean up stale migration key
    delete parsed.customSystemPrompt;
    delete parsed.selectedModel;
    const merged = { ...DEFAULT_AI_SETTINGS, ...parsed };
    return merged;
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export async function saveAISettings(settings: Partial<AISettings>): Promise<void> {
  const current = await loadAISettings();
  await AsyncStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
}

export function getActiveSystemPrompt(settings: AISettings): string {
  const base = CONVERSATION_AGENT_PROMPT;
  if (!settings.customInstructions) {
    return base;
  }
  return (
    base +
    '\n\n## User Custom Instructions\n\n' +
    'The following instructions were provided by the user. ' +
    'If they conflict with any instructions above, ' +
    'follow the user\'s instructions instead.\n\n' +
    settings.customInstructions
  );
}
