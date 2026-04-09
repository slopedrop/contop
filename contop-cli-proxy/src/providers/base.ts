import type { NdjsonEvent, NormalizedEventType } from '../types.js';

// ── Provider Abstraction ────────────────────────────────────────────

/**
 * ProviderConfig defines the CLI-specific behavior for each LLM provider.
 * 90% of the proxy code is shared - only this config differs.
 */
export interface ProviderConfig {
  /** CLI binary name (e.g. 'claude', 'gemini', 'codex') */
  binary: string;

  /** Human-readable name for logs */
  displayName: string;

  /** Default model for this provider */
  defaultModel: string;

  /** Available model IDs for /v1/models */
  models: string[];

  /**
   * Session mode:
   * - 'persistent': Spawn once, keep stdin open, send messages via stdin
   * - 'per-request': Spawn a new process for each request
   */
  mode: 'persistent' | 'per-request';

  /**
   * Whether the CLI emits an init event on startup.
   * If false, session is marked alive after a grace period.
   */
  emitsInit: boolean;

  /**
   * Whether stdin is used to deliver the prompt (true for Claude pipe mode).
   * If false, prompt is passed via CLI args (e.g. Gemini --prompt).
   */
  usesStdinPipe: boolean;

  /**
   * Whether to use --resume session chaining between requests.
   * Set to false when the proxy already sends full conversation history in
   * each message (e.g. Claude, where --resume would duplicate context and
   * cause session bleed across Contop user sessions).
   */
  useResume?: boolean;

  /**
   * Build spawn args for a request.
   * @param resumeSessionId - Session ID to resume from (empty on first request)
   */
  buildSpawnArgs(resumeSessionId: string): string[];

  /** Build the stdin payload for the prompt (used when usesStdinPipe is true) */
  buildStdinMessage(content: string): string;

  /** Map provider-specific NDJSON event type to normalized type */
  normalizeEventType(rawType: string): NormalizedEventType;

  /** Extract text content from a text/message event */
  extractTextContent(event: NdjsonEvent): string;

  /**
   * Extract the provider's session ID from a response event.
   * Used for --resume chaining in per-request mode.
   * Returns null if the event doesn't contain a session ID.
   */
  extractSessionId?(event: NdjsonEvent): string | null;
}
