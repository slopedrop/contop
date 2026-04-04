import Anthropic from 'anthropic-react-native';
import { TOOL_DECLARATIONS_JSON_SCHEMA } from '../../constants/providerConfig';
import type { LLMProvider, GenerateOptions, GenerateResult, Message, ToolCall } from './types';

/** Convert OpenAI-format tool declarations to Anthropic format */
function toAnthropicTools(tools: any[]): any[] {
  return tools.map((t: any) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic | null = null;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  initialize(apiKey: string): void {
    this.client = new Anthropic({ apiKey });
  }

  async generateContent(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.client) throw new Error('AnthropicProvider not initialized');

    const messages = this.toProviderMessages(options.messages) as any[];

    const params: any = {
      model: options.model.replace(/^anthropic\//, ''),
      messages,
      system: options.systemPrompt,
      max_tokens: 4096,
    };

    if (options.tools) {
      params.tools = toAnthropicTools(TOOL_DECLARATIONS_JSON_SCHEMA);
    }

    const response = await this.client.messages.create(params);
    return this.parseResponse(response);
  }

  toProviderMessages(messages: Message[]): unknown {
    const result: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // Anthropic uses top-level `system` param

      const role = msg.role === 'assistant' ? 'assistant' : 'user';

      if (typeof msg.content === 'string') {
        result.push({ role, content: msg.content });
        continue;
      }

      const content: any[] = [];
      for (const part of msg.content) {
        switch (part.type) {
          case 'text':
            content.push({ type: 'text', text: part.text });
            break;
          case 'image':
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: part.mimeType, data: part.data },
            });
            break;
          case 'tool_call':
            content.push({
              type: 'tool_use',
              id: part.id,
              name: part.name,
              input: part.args,
            });
            break;
          case 'tool_result':
            content.push({
              type: 'tool_result',
              tool_use_id: part.toolCallId,
              content: JSON.stringify(part.result),
            });
            break;
        }
      }

      result.push({ role, content });
    }

    return result;
  }

  parseResponse(response: any): GenerateResult {
    const content = response.content;
    if (!content || content.length === 0) return { text: null, toolCalls: null };

    const textBlocks = content.filter((b: any) => b.type === 'text');
    const toolUseBlocks = content.filter((b: any) => b.type === 'tool_use');

    if (toolUseBlocks.length > 0) {
      const toolCalls: ToolCall[] = toolUseBlocks.map((b: any) => ({
        id: b.id,
        name: b.name,
        args: b.input ?? {},
      }));
      const text = textBlocks.map((b: any) => b.text).join('\n') || null;
      return { text, toolCalls };
    }

    const text = textBlocks.map((b: any) => b.text).join('\n') || null;
    return { text, toolCalls: null };
  }
}
