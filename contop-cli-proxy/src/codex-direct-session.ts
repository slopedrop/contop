import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ISession, NdjsonEvent, CliResponse, OpenAIMessage } from './types.js';
import type { ProviderConfig } from './providers/base.js';
import { initLlmLog, logApiCall, logApiResponse } from './llm-logger.js';

// ── Types ────────────────────────────────────────────────────────────

interface CodexAuth {
  tokens: {
    access_token: string;
    refresh_token: string;
    id_token?: string;
  };
  last_refresh: string;
}

// ── Constants ────────────────────────────────────────────────────────

const AUTH_FILE = join(homedir(), '.codex', 'auth.json');
const TOKEN_REFRESH_URL = 'https://auth.openai.com/oauth/token';
// Subscription endpoint discovered from Codex binary strings + blog post
const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

// Refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ── CodexDirectSession ───────────────────────────────────────────────

/**
 * Calls chatgpt.com/backend-api/codex/responses directly using the OAuth
 * token stored by the Codex CLI at ~/.codex/auth.json.
 *
 * The endpoint requires:
 * - stream: true (always)
 * - store: false (always - endpoint rejects store:true)
 * - instructions: string (system prompt - separate from input, never duplicated)
 * - input: array of user/assistant messages only
 * - previous_response_id: NOT supported on this endpoint
 *
 * Conversation history is maintained client-side in this.history.
 * System prompt stays in `instructions` field - sent once per call, never
 * accumulates in the input array. This is how Codex CLI itself works internally.
 */
export class CodexDirectSession implements ISession {
  private proxySessionId: string;
  private model: string;
  private auth: CodexAuth;
  private tokenExpiry: number = 0;

  // Client-side conversation history (user + assistant turns only)
  // System prompt is kept separate in `instructions` field
  private history: Array<{ role: 'user' | 'assistant'; text: string }> = [];

  private _alive = false;

  constructor(model?: string) {
    this.proxySessionId = randomUUID();
    this.model = model ?? 'gpt-5.4';
    this.auth = this.loadAuth();
    this.tokenExpiry = this.parseExpiry(this.auth.tokens.access_token);
  }

  // ── ISession lifecycle ──────────────────────────────────────────

  async start(): Promise<void> {
    await this.ensureFreshToken();
    this._alive = true;
    initLlmLog({
      sessionId: this.proxySessionId,
      provider: 'Codex (Direct API)',
      model: this.model,
    });
    console.log('[codex-direct] Ready - chatgpt.com/backend-api/codex/responses');
  }

  isAlive(): boolean { return this._alive; }
  getSessionId(): string { return this.proxySessionId; }
  getResumeSessionId(): string { return ''; }
  getModel(): string { return this.model; }

  getProvider(): ProviderConfig {
    return {
      binary: 'codex',
      displayName: 'Codex (Direct)',
      defaultModel: this.model,
      models: ['gpt-5.4', 'gpt-5.4-pro'],
      mode: 'per-request',
      emitsInit: false,
      usesStdinPipe: false,
      buildSpawnArgs: () => [],
      buildStdinMessage: (c) => c,
      normalizeEventType: () => 'unknown',
      extractTextContent: () => '',
    };
  }

  destroy(): void {
    this._alive = false;
  }

  // ── ISession messaging ──────────────────────────────────────────

  async sendMessage(messages: OpenAIMessage[]): Promise<CliResponse> {
    return this.callApi(messages, false, () => { });
  }

  async sendMessageStreaming(
    messages: OpenAIMessage[],
    onEvent: (event: NdjsonEvent) => void,
  ): Promise<CliResponse> {
    return this.callApi(messages, true, (delta) => {
      onEvent({ type: 'text_delta', content: delta });
    });
  }

  // ── Core API call ───────────────────────────────────────────────

  private async callApi(
    messages: OpenAIMessage[],
    _streaming: boolean,
    onDelta: (text: string) => void,
  ): Promise<CliResponse> {
    await this.ensureFreshToken();

    // Extract system prompt from messages → goes into `instructions` field
    const systemMsg = messages.find((m) => m.role === 'system');
    const instructions = systemMsg?.content ?? 'You are a helpful assistant.';

    // Latest user message
    const latestUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!latestUser?.content) throw new Error('No user message found');

    // Append to history
    this.history.push({ role: 'user', text: latestUser.content });

    // Build input array: full history, user+assistant only, no system
    // System prompt is in `instructions` - never touches input[]
    const input = this.history.map((h) => ({
      type: 'message',
      role: h.role,
      content: [{ type: h.role === 'user' ? 'input_text' : 'output_text', text: h.text }],
    }));

    const body = {
      model: this.model,
      instructions,
      input,
      stream: true,   // endpoint requires stream:true always
      store: false,   // endpoint requires store:false always
    };

    // ── LLM Logger: log API call input (latest turn only to avoid O(n²) growth) ──
    const latestTurns = this.history.slice(-2); // latest user + previous assistant (if any)
    logApiCall({
      endpoint: CODEX_ENDPOINT,
      model: this.model,
      instructions,
      inputMessages: latestTurns,
      totalHistoryTurns: this.history.length,
    });
    const callStartTime = Date.now();

    const response = await fetch(CODEX_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.auth.tokens.access_token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'codex-cli/0.117.0',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Codex API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const result = await this.consumeStream(response, onDelta);

    // ── LLM Logger: log API response ──
    logApiResponse({
      text: result.text,
      usage: result.usage,
      durationMs: Date.now() - callStartTime,
    });

    // Save assistant response to history for next turn
    if (result.text) {
      this.history.push({ role: 'assistant', text: result.text });
    }

    return result;
  }

  // ── Stream consumer ─────────────────────────────────────────────

  private async consumeStream(
    response: Response,
    onDelta: (text: string) => void,
  ): Promise<CliResponse> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();

        try {
          const event = JSON.parse(data) as Record<string, unknown>;

          if (event.type === 'response.output_text.delta') {
            const delta = (event.delta as string) ?? '';
            if (delta) { fullText += delta; onDelta(delta); }
          }

          if (event.type === 'response.completed') {
            const r = event.response as Record<string, unknown> | undefined;
            const usage = r?.usage as Record<string, number> | undefined;
            if (usage) {
              promptTokens = usage.input_tokens ?? 0;
              completionTokens = usage.output_tokens ?? 0;
            }
          }
        } catch { /* skip malformed lines */ }
      }
    }

    return {
      text: fullText,
      toolCalls: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      events: [],
    };
  }

  // ── Token management ────────────────────────────────────────────

  private loadAuth(): CodexAuth {
    try {
      return JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as CodexAuth;
    } catch (err) {
      throw new Error(
        `Cannot read Codex auth at ${AUTH_FILE}. Run "codex" once to authenticate.\n${(err as Error).message}`
      );
    }
  }

  private parseExpiry(jwt: string): number {
    try {
      const payload = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString()
      ) as { exp?: number };
      return (payload.exp ?? 0) * 1000;
    } catch {
      return 0;
    }
  }

  private async ensureFreshToken(): Promise<void> {
    if (Date.now() < this.tokenExpiry - REFRESH_BUFFER_MS) return;

    console.log('[codex-direct] Refreshing OAuth token...');
    const response = await fetch(TOKEN_REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.auth.tokens.refresh_token,
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed ${response.status}: ${text.slice(0, 200)}`);
    }

    const refreshed = await response.json() as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
    };

    this.auth.tokens.access_token = refreshed.access_token;
    if (refreshed.refresh_token) this.auth.tokens.refresh_token = refreshed.refresh_token;
    if (refreshed.id_token) this.auth.tokens.id_token = refreshed.id_token;
    this.auth.last_refresh = new Date().toISOString();
    this.tokenExpiry = this.parseExpiry(refreshed.access_token);

    try {
      writeFileSync(AUTH_FILE, JSON.stringify(this.auth, null, 2));
    } catch {
      console.warn('[codex-direct] Could not persist refreshed token to disk');
    }

    console.log(`[codex-direct] Token refreshed, expires: ${new Date(this.tokenExpiry).toISOString()}`);
  }
}
