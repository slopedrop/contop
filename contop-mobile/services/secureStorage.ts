import * as SecureStore from 'expo-secure-store';
import type { PairingPayload } from '../types';
import {
  CONTOP_PAIRING_TOKEN,
  GEMINI_API_KEY_STORAGE_KEY,
  OPENAI_API_KEY_STORAGE_KEY,
  ANTHROPIC_API_KEY_STORAGE_KEY,
  OPENROUTER_API_KEY_STORAGE_KEY,
} from '../constants';

const ALL_API_KEY_STORAGE_KEYS = [
  GEMINI_API_KEY_STORAGE_KEY,
  OPENAI_API_KEY_STORAGE_KEY,
  ANTHROPIC_API_KEY_STORAGE_KEY,
  OPENROUTER_API_KEY_STORAGE_KEY,
];

export async function savePairingToken(token: PairingPayload): Promise<void> {
  await SecureStore.setItemAsync(CONTOP_PAIRING_TOKEN, JSON.stringify(token));
}

export async function getPairingToken(): Promise<PairingPayload | null> {
  const raw = await SecureStore.getItemAsync(CONTOP_PAIRING_TOKEN);
  if (!raw) return null;

  let payload: PairingPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    await SecureStore.deleteItemAsync(CONTOP_PAIRING_TOKEN);
    await clearAllApiKeys();
    return null;
  }

  if (new Date(payload.expires_at) <= new Date()) {
    await SecureStore.deleteItemAsync(CONTOP_PAIRING_TOKEN);
    await clearAllApiKeys();
    return null;
  }

  return payload;
}

export async function clearPairingToken(): Promise<void> {
  await SecureStore.deleteItemAsync(CONTOP_PAIRING_TOKEN);
}

// --- Gemini ---
export async function saveGeminiApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(GEMINI_API_KEY_STORAGE_KEY, key);
}

export async function getGeminiApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(GEMINI_API_KEY_STORAGE_KEY);
}

export async function clearGeminiApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(GEMINI_API_KEY_STORAGE_KEY);
}

// --- OpenAI ---
export async function saveOpenAIApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(OPENAI_API_KEY_STORAGE_KEY, key);
}

export async function getOpenAIApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(OPENAI_API_KEY_STORAGE_KEY);
}

export async function clearOpenAIApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(OPENAI_API_KEY_STORAGE_KEY);
}

// --- Anthropic ---
export async function saveAnthropicApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(ANTHROPIC_API_KEY_STORAGE_KEY, key);
}

export async function getAnthropicApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(ANTHROPIC_API_KEY_STORAGE_KEY);
}

export async function clearAnthropicApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(ANTHROPIC_API_KEY_STORAGE_KEY);
}

// --- OpenRouter ---
export async function saveOpenRouterApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(OPENROUTER_API_KEY_STORAGE_KEY, key);
}

export async function getOpenRouterApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(OPENROUTER_API_KEY_STORAGE_KEY);
}

export async function clearOpenRouterApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(OPENROUTER_API_KEY_STORAGE_KEY);
}

// --- Bulk operations ---

/** Clear all stored API keys (used on connection forget / token expiry) */
export async function clearAllApiKeys(): Promise<void> {
  await Promise.all(
    ALL_API_KEY_STORAGE_KEYS.map((key) => SecureStore.deleteItemAsync(key))
  );
}

/** Store all API keys from a QR pairing payload. Clears stale keys not in the new payload. */
export async function saveApiKeysFromPayload(payload: {
  gemini_api_key?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
  openrouter_api_key?: string;
}): Promise<void> {
  // Clear all keys first to remove stale ones from previous pairings
  await clearAllApiKeys();

  const saves: Promise<void>[] = [];
  if (payload.gemini_api_key) saves.push(saveGeminiApiKey(payload.gemini_api_key));
  if (payload.openai_api_key) saves.push(saveOpenAIApiKey(payload.openai_api_key));
  if (payload.anthropic_api_key) saves.push(saveAnthropicApiKey(payload.anthropic_api_key));
  if (payload.openrouter_api_key) saves.push(saveOpenRouterApiKey(payload.openrouter_api_key));
  await Promise.all(saves);
}

/** Get all configured API keys as a map */
export async function getAllApiKeys(): Promise<Record<string, string | null>> {
  const [gemini, openai, anthropic, openrouter] = await Promise.all([
    getGeminiApiKey(),
    getOpenAIApiKey(),
    getAnthropicApiKey(),
    getOpenRouterApiKey(),
  ]);
  return { gemini, openai, anthropic, openrouter };
}

/** Check if pairing token exists with either API keys or subscription providers */
export async function hasValidPairingData(): Promise<{ valid: boolean; reason?: string }> {
  const token = await getPairingToken();
  if (!token) return { valid: false, reason: 'no_token' };

  const keys = await getAllApiKeys();
  const hasAnyKey = Object.values(keys).some((k) => !!k);
  const hasSubscriptionProvider = token.pa && (token.pa.g || token.pa.a || token.pa.o);
  if (!hasAnyKey && !hasSubscriptionProvider) return { valid: false, reason: 'no_credentials' };

  return { valid: true };
}
