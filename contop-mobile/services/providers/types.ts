/** Provider-agnostic message format */
export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
};

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown>; thoughtSignature?: string }
  | { type: 'tool_result'; toolCallId: string; name: string; result: Record<string, unknown> };

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
};

export type GenerateResult = {
  text: string | null;
  toolCalls: ToolCall[] | null;
};

export type GenerateOptions = {
  model: string;
  messages: Message[];
  systemPrompt: string;
  tools?: unknown;
  thinkingEnabled?: boolean;
};

/** Interface that all provider adapters must implement */
export interface LLMProvider {
  name: string;
  initialize(apiKey: string): void;
  generateContent(options: GenerateOptions): Promise<GenerateResult>;
  toProviderMessages(messages: Message[]): unknown;
  parseResponse(response: unknown): GenerateResult;
}
