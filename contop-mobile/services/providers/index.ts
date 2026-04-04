import type { Provider } from '../../constants/modelRegistry';
import type { LLMProvider } from './types';
import { GeminiProvider } from './geminiProvider';
import { OpenAIProvider } from './openaiProvider';
import { AnthropicProvider } from './anthropicProvider';

export type { LLMProvider, GenerateOptions, GenerateResult, Message, ToolCall, ContentPart } from './types';

export function createProvider(provider: Provider, apiKey: string): LLMProvider {
  switch (provider) {
    case 'gemini':
      return new GeminiProvider(apiKey);
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'openrouter':
      return new OpenAIProvider(apiKey, 'https://openrouter.ai/api/v1');
  }
}
