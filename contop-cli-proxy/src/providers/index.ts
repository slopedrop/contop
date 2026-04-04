export type { ProviderConfig } from './base.js';
import type { ProviderConfig } from './base.js';
import { claudeProvider } from './claude.js';
import { geminiProvider } from './gemini.js';
import { codexProvider } from './codex.js';

// ── Provider Factory ────────────────────────────────────────────────

const PROVIDER_MAP: Record<string, ProviderConfig> = {
  claude: claudeProvider,
  anthropic: claudeProvider,  // alias used by Tauri frontend
  gemini: geminiProvider,
  codex: codexProvider,
  openai: codexProvider,      // alias used by Tauri frontend
};

export function getProvider(name: string): ProviderConfig {
  const provider = PROVIDER_MAP[name];
  if (!provider) {
    const supported = Object.keys(PROVIDER_MAP).join(', ');
    throw new Error(`Unknown provider: ${name}. Supported: ${supported}`);
  }
  return provider;
}

export function getSupportedProviders(): string[] {
  return Object.keys(PROVIDER_MAP);
}
