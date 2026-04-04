import type { NdjsonEvent, NormalizedEventType } from '../types.js';
import type { ProviderConfig } from './base.js';

/**
 * OpenAI Codex CLI provider configuration.
 *
 * NOTE: The CLI binary (`codex exec`) is NOT used at runtime.  Codex uses
 * CodexDirectSession which makes direct OAuth-authenticated HTTP calls to
 * the ChatGPT backend API (chatgpt.com/backend-api/codex/responses).
 * See codex-direct-session.ts for the actual implementation.
 *
 * This provider config exists only as a model registry for /v1/models and
 * as a fallback definition.  The JSONL event mappings below were discovered
 * during initial CLI testing and are kept for reference.
 *
 * Codex JSONL events (from CLI binary, not currently used):
 *   - "thread.started"  — contains thread_id (session ID for resume)
 *   - "turn.started"    — turn begins
 *   - "item.completed"  — response with item.text containing the message
 *   - "turn.completed"  — completion with usage stats (input_tokens, output_tokens)
 */
export const codexProvider: ProviderConfig = {
  binary: 'codex',
  displayName: 'Codex CLI',
  defaultModel: 'gpt-5.4',
  models: [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'o3',
    'o4-mini',
  ],
  mode: 'per-request',
  emitsInit: false,
  usesStdinPipe: true,

  buildSpawnArgs(resumeSessionId: string): string[] {
    if (resumeSessionId) {
      return [
        'exec', 'resume',
        '--last',
        '--json',
      ];
    }
    return [
      'exec',
      '--json',
      '-',  // Read prompt from stdin
    ];
  },

  buildStdinMessage(content: string): string {
    return content;
  },

  normalizeEventType(rawType: string): NormalizedEventType {
    // Codex JSONL event types (verified via testing)
    if (rawType === 'item.completed') return 'text_delta';     // Contains item.text
    if (rawType === 'turn.completed') return 'result';          // Completion with usage
    if (rawType === 'thread.started') return 'init';            // Session start with thread_id
    if (rawType === 'turn.started') return 'unknown';           // Informational, ignore
    if (rawType === 'error') return 'error';
    return 'unknown';
  },

  extractTextContent(event: NdjsonEvent): string {
    const e = event as Record<string, unknown>;
    // Codex item.completed: { type: "item.completed", item: { text: "..." } }
    const item = e.item as Record<string, unknown> | undefined;
    if (!item) return '';

    // Only extract agent_message items (skip tool calls, etc.)
    if (item.type && item.type !== 'agent_message') return '';

    return (item.text as string) || '';
  },

  extractSessionId(event: NdjsonEvent): string | null {
    const e = event as Record<string, unknown>;
    // Codex thread.started: { type: "thread.started", thread_id: "..." }
    if (e.type === 'thread.started' && e.thread_id) {
      return e.thread_id as string;
    }
    return null;
  },
};
