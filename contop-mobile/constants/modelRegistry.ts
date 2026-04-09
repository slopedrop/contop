// Multi-provider model registry
// Naming convention: SCREAMING_SNAKE_CASE for constants, PascalCase for types

export type Provider = 'gemini' | 'openai' | 'anthropic' | 'openrouter';

export type ThinkingSupport = 'always' | 'optional' | 'off-by-default' | 'none';

export type ModelConfig = {
  value: string;
  label: string;
  provider: Provider;
  thinking: ThinkingSupport;
  supportsTools: boolean;
  supportsVision: boolean;
};

export type ProviderGroup = {
  provider: Provider;
  label: string;
  models: ModelConfig[];
};

export const MODEL_REGISTRY: ProviderGroup[] = [
  {
    provider: 'gemini',
    label: 'Gemini',
    models: [
      { value: 'gemini-3.1-pro-preview-customtools', label: 'Gemini 3.1 Pro (Tools)', provider: 'gemini', thinking: 'always', supportsTools: true, supportsVision: true },
      { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'gemini', thinking: 'always', supportsTools: true, supportsVision: true },
      { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', provider: 'gemini', thinking: 'optional', supportsTools: true, supportsVision: true },
      { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', provider: 'gemini', thinking: 'optional', supportsTools: true, supportsVision: true },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', thinking: 'always', supportsTools: true, supportsVision: true },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', thinking: 'optional', supportsTools: true, supportsVision: true },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'gemini', thinking: 'off-by-default', supportsTools: true, supportsVision: true },
    ],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [
      { value: 'openai/gpt-5.4', label: 'GPT-5.4', provider: 'openai', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openai/gpt-4.1', label: 'GPT-4.1', provider: 'openai', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openai/gpt-4.1-nano', label: 'GPT-4.1 Nano', provider: 'openai', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openai/o3', label: 'o3', provider: 'openai', thinking: 'always', supportsTools: true, supportsVision: true },
      { value: 'openai/o4-mini', label: 'o4 Mini', provider: 'openai', thinking: 'always', supportsTools: true, supportsVision: true },
    ],
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { value: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', thinking: 'optional', supportsTools: true, supportsVision: true },
      { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', thinking: 'optional', supportsTools: true, supportsVision: true },
      { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', thinking: 'none', supportsTools: true, supportsVision: true },
    ],
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter - Agentic',
    models: [
      { value: 'openrouter/x-ai/grok-4.20-beta', label: 'Grok 4.20 Beta', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openrouter/xiaomi/mimo-v2-pro', label: 'MiMo V2 Pro', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: false },
      { value: 'openrouter/mistralai/devstral-2512', label: 'Devstral 2', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: false },
      { value: 'openrouter/qwen/qwen3.5-397b-a17b', label: 'Qwen 3.5 397B', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openrouter/nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: false },
    ],
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter - Small / Free',
    models: [
      { value: 'openrouter/mistralai/devstral-small-2505', label: 'Devstral Small 2 (24B)', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: false },
      { value: 'openrouter/qwen/qwen3.5-9b', label: 'Qwen 3.5 9B', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: true },
      { value: 'openrouter/nvidia/nemotron-3-nano-30b-a3b:free', label: 'Nemotron 3 Nano (Free)', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: false },
      { value: 'openrouter/microsoft/phi-4', label: 'Phi-4 (14B)', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: false },
      { value: 'openrouter/minimax/minimax-m2.5:free', label: 'MiniMax M2.5 (Free)', provider: 'openrouter', thinking: 'none', supportsTools: true, supportsVision: false },
    ],
  },
];

/** Flatten all models into a single array */
export function getAllModels(): ModelConfig[] {
  return MODEL_REGISTRY.flatMap((group) => group.models);
}

/** Find a model config by value */
export function findModel(value: string): ModelConfig | undefined {
  return getAllModels().find((m) => m.value === value);
}

/** Get the provider for a model value */
export function getProviderForModel(value: string): Provider {
  const model = findModel(value);
  if (model) return model.provider;
  // Fallback: detect from prefix
  if (value.startsWith('openai/')) return 'openai';
  if (value.startsWith('anthropic/')) return 'anthropic';
  if (value.startsWith('openrouter/')) return 'openrouter';
  return 'gemini';
}

/** Map provider to the secure storage key name */
export function getApiKeyNameForProvider(provider: Provider): string {
  switch (provider) {
    case 'gemini': return 'gemini';
    case 'openai': return 'openai';
    case 'anthropic': return 'anthropic';
    case 'openrouter': return 'openrouter';
  }
}
