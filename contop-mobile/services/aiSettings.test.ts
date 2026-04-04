import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadAISettings,
  saveAISettings,
  getActiveSystemPrompt,
  DEFAULT_AI_SETTINGS,
} from './aiSettings';
import { GEMINI_TEXT_MODEL } from '../constants/providerConfig';
import { CONVERSATION_AGENT_PROMPT } from '../prompts/conversation-agent';
import type { AISettings } from '../types';

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('aiSettings service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue();
  });

  describe('DEFAULT_AI_SETTINGS', () => {
    test('[P0] 5.7-UNIT-001: default settings use GEMINI_TEXT_MODEL and null customInstructions', () => {
      expect(DEFAULT_AI_SETTINGS.conversationModel).toBe(GEMINI_TEXT_MODEL);
      expect(DEFAULT_AI_SETTINGS.executionModel).toBe(GEMINI_TEXT_MODEL);
      expect(DEFAULT_AI_SETTINGS.computerUseBackend).toBe('omniparser');
      expect(DEFAULT_AI_SETTINGS.customInstructions).toBeNull();
    });
  });

  describe('loadAISettings', () => {
    test('[P0] 5.7-UNIT-002: returns DEFAULT_AI_SETTINGS when storage is empty', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const result = await loadAISettings();

      expect(result).toEqual(DEFAULT_AI_SETTINGS);
      expect(mockAsyncStorage.getItem).toHaveBeenCalledWith('@contop:ai_settings');
    });

    test('[P0] 5.7-UNIT-003: returns persisted settings when stored', async () => {
      const stored: AISettings = {
        conversationModel: 'gemini-2.5-pro',
        executionModel: 'gemini-2.5-pro',
        computerUseBackend: 'omniparser',
        customInstructions: 'You are a helpful assistant.',
        thinkingEnabled: null,
        sttProvider: 'gemini',
      };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(stored));

      const result = await loadAISettings();

      expect(result.conversationModel).toBe('gemini-2.5-pro');
      expect(result.customInstructions).toBe('You are a helpful assistant.');
    });

    test('[P0] 5.7-UNIT-004: merges partial overrides with defaults correctly', async () => {
      const partial = { conversationModel: 'gemini-2.5-pro' };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(partial));

      const result = await loadAISettings();

      expect(result.conversationModel).toBe('gemini-2.5-pro');
      expect(result.customInstructions).toBeNull(); // from DEFAULT
    });

    test('[P1] 5.7-UNIT-005: returns DEFAULT_AI_SETTINGS on corrupt JSON', async () => {
      mockAsyncStorage.getItem.mockResolvedValue('not-valid-json{{{');

      const result = await loadAISettings();

      expect(result).toEqual(DEFAULT_AI_SETTINGS);
    });

    test('[P0] migration: old selectedModel schema migrates to per-role fields', async () => {
      const oldSchema = { selectedModel: 'gemini-2.5-pro', customInstructions: 'Custom' };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(oldSchema));

      const result = await loadAISettings();

      expect(result.conversationModel).toBe('gemini-2.5-pro');
      expect(result.executionModel).toBe('gemini-2.5-pro');
      expect(result.computerUseBackend).toBe('omniparser');
      expect(result.customInstructions).toBe('Custom');
      // Should persist the migrated settings
      expect(mockAsyncStorage.setItem).toHaveBeenCalled();
    });
  });

  describe('saveAISettings', () => {
    test('[P0] 5.7-UNIT-006: saves merged settings to AsyncStorage', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null); // no prior settings

      await saveAISettings({ conversationModel: 'gemini-2.5-pro' });

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@contop:ai_settings',
        JSON.stringify({ ...DEFAULT_AI_SETTINGS, conversationModel: 'gemini-2.5-pro' }),
      );
    });

    test('[P0] 5.7-UNIT-007: saves custom instructions without overwriting model', async () => {
      const existing: AISettings = {
        conversationModel: 'gemini-2.5-pro',
        executionModel: 'gemini-2.5-pro',
        computerUseBackend: 'omniparser',
        customInstructions: null,
        thinkingEnabled: null,
        sttProvider: 'gemini',
      };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(existing));

      await saveAISettings({ customInstructions: 'Custom prompt here.' });

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@contop:ai_settings',
        JSON.stringify({ ...existing, customInstructions: 'Custom prompt here.' }),
      );
    });

    test('[P0] 5.7-UNIT-008: resetting custom instructions saves null', async () => {
      const existing: AISettings = {
        conversationModel: 'gemini-2.5-flash',
        executionModel: 'gemini-2.5-flash',
        computerUseBackend: 'omniparser',
        customInstructions: 'Old custom prompt',
        thinkingEnabled: null,
        sttProvider: 'gemini',
      };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(existing));

      await saveAISettings({ customInstructions: null });

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@contop:ai_settings',
        JSON.stringify({ ...existing, customInstructions: null }),
      );
    });
  });

  describe('getActiveSystemPrompt', () => {
    test('[P0] 5.7-UNIT-009: returns CONVERSATION_AGENT_PROMPT when customInstructions is null', () => {
      const settings: AISettings = {
        conversationModel: 'gemini-2.5-flash',
        executionModel: 'gemini-2.5-flash',
        computerUseBackend: 'omniparser',
        customInstructions: null,
        thinkingEnabled: null,
        sttProvider: 'gemini',
      };
      expect(getActiveSystemPrompt(settings)).toBe(CONVERSATION_AGENT_PROMPT);
    });

    test('[P0] 5.7-UNIT-010: returns prompt containing both base instruction and custom instructions when set', () => {
      const settings: AISettings = {
        conversationModel: 'gemini-2.5-flash',
        executionModel: 'gemini-2.5-flash',
        computerUseBackend: 'omniparser',
        customInstructions: 'You are a concise assistant.',
        thinkingEnabled: null,
        sttProvider: 'gemini',
      };
      const result = getActiveSystemPrompt(settings);
      expect(result).toContain(CONVERSATION_AGENT_PROMPT);
      expect(result).toContain('You are a concise assistant.');
    });

    test('[P1] 5.7-UNIT-011: returns base prompt when customInstructions is empty string (falsy)', () => {
      // '' is falsy — function returns base CONVERSATION_AGENT_PROMPT
      const settings: AISettings = {
        conversationModel: 'gemini-2.5-flash',
        executionModel: 'gemini-2.5-flash',
        computerUseBackend: 'omniparser',
        customInstructions: '',
        thinkingEnabled: null,
        sttProvider: 'gemini',
      };
      expect(getActiveSystemPrompt(settings)).toBe(CONVERSATION_AGENT_PROMPT);
    });
  });
});
