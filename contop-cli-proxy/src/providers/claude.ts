import type { NdjsonEvent, NormalizedEventType } from '../types.js';
import type { ProviderConfig } from './base.js';

/**
 * Claude Code CLI provider configuration.
 *
 * Mode: per-request with --resume chaining.
 *
 * Flow:
 * 1. First request:  `echo "prompt" | claude -p --output-format stream-json`
 * 2. Capture session_id from the "system" event response
 * 3. Next request:   `echo "prompt" | claude -p --output-format stream-json --resume <id>`
 *
 * This mimics a developer using `claude -p` and resuming conversations,
 * which is the normal, intended usage pattern.
 */
export const claudeProvider: ProviderConfig = {
  binary: 'claude',
  displayName: 'Claude Code',
  defaultModel: 'claude-sonnet-4-6',
  models: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  mode: 'per-request',
  emitsInit: false,
  usesStdinPipe: true,
  // Full conversation history is sent in every request via toCliMessage, so
  // --resume would only duplicate context and bleed state across Contop user
  // sessions.  Always spawn a fresh claude -p process per request.
  useResume: false,

  buildSpawnArgs(resumeSessionId: string): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
    ];
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }
    return args;
  },

  buildStdinMessage(content: string): string {
    return content;
  },

  normalizeEventType(rawType: string): NormalizedEventType {
    if (rawType === 'assistant') return 'text_delta';
    if (rawType === 'result') return 'result';
    if (rawType === 'system') return 'init';
    if (rawType === 'error') return 'error';
    if (rawType === 'tool_use') return 'tool_use';
    if (rawType === 'tool_result') return 'tool_result';
    return 'unknown';
  },

  extractTextContent(event: NdjsonEvent): string {
    const e = event as Record<string, unknown>;
    const message = e.message as Record<string, unknown> | undefined;
    if (!message) return '';

    const content = message.content as Array<{ type: string; text?: string }> | undefined;
    if (!content || !Array.isArray(content)) return '';

    return content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('');
  },

  extractSessionId(event: NdjsonEvent): string | null {
    const e = event as Record<string, unknown>;
    // Claude's "system" event contains session_id
    if (e.type === 'system' && e.session_id) {
      return e.session_id as string;
    }
    return null;
  },
};
