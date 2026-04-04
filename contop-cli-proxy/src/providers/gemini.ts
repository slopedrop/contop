import type { NdjsonEvent, NormalizedEventType } from '../types.js';
import type { ProviderConfig } from './base.js';

/**
 * Gemini CLI provider configuration.
 *
 * Mode: per-request with stdin pipe — NO resume chaining.
 *
 * Resume is disabled because lastProviderSessionId is a single shared variable
 * overwritten by ANY request (classification, execution, or chat). Since resume
 * only fires on tool-free requests (plain chat), it almost always resumes the
 * wrong session (e.g. a classification session with a different system prompt).
 * We handle context ourselves via toCliMessage() — full history is always in
 * the prompt.
 *
 * Actual Gemini stream-json events (discovered via testing):
 *   - "init"    — session init with session_id, model
 *   - "message" — role:"user" (echo, skip) and role:"assistant" (response)
 *   - "result"  — completion with status and stats
 */
export const geminiProvider: ProviderConfig = {
  binary: 'gemini',
  displayName: 'Gemini CLI',
  defaultModel: 'gemini-2.5-flash',
  models: [
    'gemini-3.1-pro-preview-customtools',
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  mode: 'per-request',
  emitsInit: false,
  usesStdinPipe: true,
  useResume: false,

  buildSpawnArgs(resumeSessionId: string): string[] {
    const args = [
      '--output-format', 'stream-json',
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
    if (rawType === 'message') return 'text_delta';
    if (rawType === 'init') return 'init';
    if (rawType === 'result') return 'result';
    if (rawType === 'error') return 'error';
    if (rawType === 'tool_use') return 'tool_use';
    if (rawType === 'tool_result') return 'tool_result';
    if (rawType === 'api_retry') return 'unknown';
    return 'unknown';
  },

  extractTextContent(event: NdjsonEvent): string {
    const e = event as Record<string, unknown>;
    // Skip user message echo — only extract assistant responses
    if ((e.role as string) === 'user') return '';
    return (e.content as string) || (e.text as string) || '';
  },

  extractSessionId(event: NdjsonEvent): string | null {
    const e = event as Record<string, unknown>;
    // Gemini's "init" event contains session_id
    if (e.type === 'init' && e.session_id) {
      return e.session_id as string;
    }
    return null;
  },
};
