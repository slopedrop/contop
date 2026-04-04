import OpenAI from 'openai-react-native';
import { TOOL_DECLARATIONS_JSON_SCHEMA } from '../../constants/providerConfig';
import type { LLMProvider, GenerateOptions, GenerateResult, Message, ToolCall } from './types';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI | null = null;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  initialize(apiKey: string): void {
    this.client = new OpenAI({ apiKey });
  }

  async generateContent(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.client) throw new Error('OpenAIProvider not initialized');

    const messages = this.toProviderMessages(options.messages) as any[];

    // Prepend system message
    messages.unshift({ role: 'system', content: options.systemPrompt });

    const params: any = {
      model: options.model.replace(/^openai\//, '').replace(/^openrouter\//, ''),
      messages,
    };

    if (options.tools) {
      params.tools = TOOL_DECLARATIONS_JSON_SCHEMA;
    }

    const response = await this.client.chat.completions.create(params);
    return this.parseResponse(response);
  }

  toProviderMessages(messages: Message[]): unknown {
    const result: any[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Handle structured content parts
      const parts = msg.content;
      const contentParts: any[] = [];
      const toolCalls: any[] = [];
      const toolResults: any[] = [];

      for (const part of parts) {
        switch (part.type) {
          case 'text':
            contentParts.push({ type: 'text', text: part.text });
            break;
          case 'image':
            // OpenAI vision format — keep in same message with text parts
            contentParts.push({
              type: 'image_url',
              image_url: { url: `data:${part.mimeType};base64,${part.data}` },
            });
            break;
          case 'tool_call':
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: { name: part.name, arguments: JSON.stringify(part.args) },
            });
            break;
          case 'tool_result':
            toolResults.push({
              role: 'tool',
              tool_call_id: part.toolCallId,
              content: JSON.stringify(part.result),
            });
            break;
        }
      }

      if (toolCalls.length > 0) {
        const textContent = contentParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
        result.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls,
        });
      } else if (toolResults.length > 0) {
        result.push(...toolResults);
      } else if (contentParts.length > 0) {
        // Use array format for multi-modal, string for text-only
        const hasImages = contentParts.some((p) => p.type === 'image_url');
        result.push({
          role: msg.role,
          content: hasImages ? contentParts : contentParts.map((p) => p.text).join('\n'),
        });
      }
    }

    return result;
  }

  parseResponse(response: any): GenerateResult {
    const choice = response.choices?.[0];
    if (!choice) return { text: null, toolCalls: null };

    const message = choice.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCalls: ToolCall[] = message.tool_calls.map((tc: any) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          console.warn(`[OpenAI] Failed to parse tool call arguments for ${tc.function.name}`);
        }
        return { id: tc.id, name: tc.function.name, args };
      });
      return { text: message.content ?? null, toolCalls };
    }

    return { text: message.content ?? null, toolCalls: null };
  }
}
