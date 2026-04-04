import { GoogleGenAI } from '@google/genai';
import type { Content } from '@google/genai';
import { GEMINI_TOOL_DECLARATIONS } from '../../constants/providerConfig';
import type { LLMProvider, GenerateOptions, GenerateResult, Message, ToolCall } from './types';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private ai: GoogleGenAI | null = null;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  initialize(apiKey: string): void {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateContent(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.ai) throw new Error('GeminiProvider not initialized');

    const contents = this.toProviderMessages(options.messages) as Content[];
    const config: Record<string, unknown> = {
      systemInstruction: options.systemPrompt,
    };
    if (options.tools) {
      config.tools = [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }];
    }
    if (options.thinkingEnabled !== undefined) {
      config.thinkingConfig = { thinkingBudget: options.thinkingEnabled ? undefined : 0 };
    }

    const response = await this.ai.models.generateContent({
      model: options.model,
      contents,
      config,
    });

    return this.parseResponse(response);
  }

  toProviderMessages(messages: Message[]): unknown {
    const contents: Content[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue; // Gemini uses systemInstruction, not system messages

      const geminiRole = msg.role === 'assistant' ? 'model' : 'user';

      if (typeof msg.content === 'string') {
        contents.push({ role: geminiRole, parts: [{ text: msg.content }] });
        continue;
      }

      const parts: any[] = [];
      for (const part of msg.content) {
        switch (part.type) {
          case 'text':
            parts.push({ text: part.text });
            break;
          case 'image':
            parts.push({ inlineData: { data: part.data, mimeType: part.mimeType } });
            break;
          case 'tool_call': {
            const fc: any = { name: part.name, args: part.args };
            if (part.thoughtSignature) fc.thought_signature = part.thoughtSignature;
            parts.push({ functionCall: fc });
            break;
          }
          case 'tool_result':
            parts.push({ functionResponse: { name: part.name, response: part.result } });
            break;
        }
      }
      contents.push({ role: geminiRole, parts });
    }
    return contents;
  }

  parseResponse(response: any): GenerateResult {
    // Use raw parts to capture thought_signature (required by Gemini thinking models)
    const rawParts = response.candidates?.[0]?.content?.parts ?? [];
    const fcParts = rawParts.filter((p: any) => p.functionCall);
    if (fcParts.length > 0) {
      const toolCalls: ToolCall[] = fcParts.map((p: any) => ({
        id: p.functionCall.id ?? `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
        ...(p.functionCall.thought_signature ? { thoughtSignature: p.functionCall.thought_signature } : {}),
      }));
      return { text: null, toolCalls };
    }

    return { text: response.text ?? null, toolCalls: null };
  }

  /** Get raw Gemini response candidates parts for history reconstruction */
  getRawParts(response: any): any[] {
    return response.candidates?.[0]?.content?.parts ?? [];
  }
}
