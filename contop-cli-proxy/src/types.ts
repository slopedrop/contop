// ── Shared TypeScript Types ──────────────────────────────────────────

/**
 * Raw NDJSON event from any CLI provider.
 * The `type` field is provider-specific (e.g. claude uses "text_delta", gemini/codex use "message").
 * Normalization happens via ProviderConfig.normalizeEventType().
 */
export interface NdjsonEvent {
  type: string;
  [key: string]: unknown;
}

/** Normalized event type after provider mapping */
export type NormalizedEventType =
  | 'init'
  | 'text_delta'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'unknown';

/** Aggregated response from a CLI session message exchange */
export interface CliResponse {
  text: string;
  toolCalls: ToolCallEvent[];
  usage: UsageInfo | null;
  events: NdjsonEvent[];
}

export interface ToolCallEvent {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface UsageInfo {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

// ── OpenAI-compatible types ─────────────────────────────────────────

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Tool definition (OpenAI format) passed in a chat completions request */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length';
}

export interface OpenAIChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIChunkChoice[];
}

export interface OpenAIChunkChoice {
  index: number;
  delta: Partial<OpenAIMessage>;
  finish_reason: 'stop' | 'tool_calls' | 'length' | null;
}

// ── Session interface ───────────────────────────────────────────────

/**
 * Common interface implemented by both SessionManager (CLI-based) and
 * CodexDirectSession (direct API). server.ts depends only on this shape.
 */
export interface ISession {
  start(): Promise<void>;
  isAlive(): boolean;
  getSessionId(): string;
  getResumeSessionId(): string;
  getModel(): string;
  getProvider(): import('./providers/base.js').ProviderConfig;
  sendMessage(messages: OpenAIMessage[], tools?: OpenAITool[], effort?: string, model?: string): Promise<CliResponse>;
  sendMessageStreaming(
    messages: OpenAIMessage[],
    onEvent: (event: NdjsonEvent) => void,
    tools?: OpenAITool[],
    effort?: string,
    model?: string,
  ): Promise<CliResponse>;
  destroy(): void;
}

// ── Configuration types ─────────────────────────────────────────────

export interface SessionConfig {
  provider: string;
  workspaceDir: string;
  sessionId: string;
  model?: string;
}

export interface ProxyConfig {
  port: number;
  workspace: string;
  provider: string;
  model?: string;
}
