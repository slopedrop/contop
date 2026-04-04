import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── LLM Call Logger (Sub Mode) ─────────────────────────────────────
//
// Logs every CLI subprocess spawn and direct API call with full
// input/output for debugging what goes in and out of AI models.
//
// One file per session: llm-sub-{sessionId8}-{timestamp}.log
// Stored in ~/.contop/logs/

const LOG_DIR = join(homedir(), '.contop', 'logs');

const SEP = '═'.repeat(80);
const THIN_SEP = '─'.repeat(80);

let logPath: string | null = null;
let turnCounter = 0;
let pendingOpts: { sessionId: string; provider: string; model: string } | null = null;

/** Register session info for logging. The log file is created lazily on
 *  the first actual LLM call — avoids empty files from proxy startup. */
export function initLlmLog(opts: {
  sessionId: string;
  provider: string;
  model: string;
}): void {
  // On restart, annotate the existing file rather than orphaning it
  if (logPath) {
    write(
      `${SEP}\n` +
      `  *** SESSION RESTARTED ***\n` +
      `  Time       : ${new Date().toISOString()}\n` +
      `  Turns so far: ${turnCounter}\n` +
      `${SEP}\n\n`,
    );
    logPath = null;
  }

  turnCounter = 0;
  pendingOpts = opts;
}

/** Create the log file on first use. */
function ensureLogFile(): void {
  if (logPath || !pendingOpts) return;

  mkdirSync(LOG_DIR, { recursive: true });
  const short = pendingOpts.sessionId.slice(0, 8);
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  logPath = join(LOG_DIR, `llm-sub-${short}-${ts}.log`);

  const header =
    `${SEP}\n` +
    `  LLM CALL LOG — SUBSCRIPTION MODE\n` +
    `${SEP}\n` +
    `  Session ID : ${pendingOpts.sessionId}\n` +
    `  Provider   : ${pendingOpts.provider}\n` +
    `  Model      : ${pendingOpts.model}\n` +
    `  Started    : ${new Date().toISOString()}\n` +
    `${SEP}\n\n`;

  writeFileSync(logPath, header, 'utf8');
  pendingOpts = null;
}

/** Log a CLI subprocess spawn (Claude, Gemini). */
export function logSubSpawn(opts: {
  binary: string;
  args: string[];
  model: string;
  prompt: string;
  resumeId?: string;
  hasTools: boolean;
  effort?: string;
}): void {
  ensureLogFile();
  turnCounter++;
  const block =
    `${SEP}\n` +
    `  TURN ${turnCounter} — SPAWN\n` +
    `${SEP}\n` +
    `  Time       : ${new Date().toISOString()}\n` +
    `  Binary     : ${opts.binary}\n` +
    `  Model      : ${opts.model}\n` +
    `  Resume ID  : ${opts.resumeId || '(none — new session)'}\n` +
    `  Has Tools  : ${opts.hasTools}\n` +
    `  Effort     : ${opts.effort || '(default)'}\n` +
    `${THIN_SEP}\n` +
    `  SPAWN COMMAND:\n` +
    `${THIN_SEP}\n` +
    `  ${opts.binary} ${opts.args.join(' ')}\n` +
    `${THIN_SEP}\n` +
    `  INPUT (prompt sent to stdin):\n` +
    `${THIN_SEP}\n` +
    `${opts.prompt}\n` +
    `${THIN_SEP}\n`;

  write(block);
}

/** Log the response received from a CLI subprocess. */
export function logSubResponse(opts: {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  durationMs: number;
  exitCode?: number | null;
}): void {
  let block =
    `  OUTPUT (response from model):\n` +
    `${THIN_SEP}\n`;

  if (opts.text) {
    block += `${opts.text}\n`;
  }

  if (opts.toolCalls.length > 0) {
    block += `${THIN_SEP}\n  TOOL CALLS:\n${THIN_SEP}\n`;
    for (const tc of opts.toolCalls) {
      block +=
        `  [${tc.id}] ${tc.name}\n`;
      // Parse arguments into readable key=value pairs unless the value is complex
      for (const [key, val] of Object.entries(tc.arguments)) {
        const display = typeof val === 'string' ? val : JSON.stringify(val);
        block += `    ${key}: ${display}\n`;
      }
    }
  }

  block += `${THIN_SEP}\n`;

  if (opts.usage) {
    block +=
      `  USAGE:\n` +
      `    Prompt tokens     : ${opts.usage.prompt_tokens ?? '?'}\n` +
      `    Completion tokens : ${opts.usage.completion_tokens ?? '?'}\n` +
      `    Total tokens      : ${opts.usage.total_tokens ?? '?'}\n`;
  }

  block +=
    `  Duration   : ${opts.durationMs}ms\n` +
    (opts.exitCode !== undefined && opts.exitCode !== null ? `  Exit Code  : ${opts.exitCode}\n` : '') +
    `${SEP}\n\n`;

  write(block);
}

/** Log a direct API call (Codex). */
export function logApiCall(opts: {
  endpoint: string;
  model: string;
  instructions: string;
  inputMessages: Array<{ role: string; text: string }>;
  totalHistoryTurns?: number;
}): void {
  ensureLogFile();
  turnCounter++;
  const historyNote = opts.totalHistoryTurns != null
    ? ` (showing ${opts.inputMessages.length} of ${opts.totalHistoryTurns} total)`
    : '';
  let block =
    `${SEP}\n` +
    `  TURN ${turnCounter} — API CALL\n` +
    `${SEP}\n` +
    `  Time       : ${new Date().toISOString()}\n` +
    `  Endpoint   : ${opts.endpoint}\n` +
    `  Model      : ${opts.model}\n` +
    `${THIN_SEP}\n` +
    `  SYSTEM INSTRUCTIONS:\n` +
    `${THIN_SEP}\n` +
    `${opts.instructions}\n` +
    `${THIN_SEP}\n` +
    `  INPUT MESSAGES${historyNote}:\n` +
    `${THIN_SEP}\n`;

  for (let i = 0; i < opts.inputMessages.length; i++) {
    const msg = opts.inputMessages[i];
    block += `  [${i + 1}] ${msg.role.toUpperCase()}:\n${msg.text}\n\n`;
  }

  block += `${THIN_SEP}\n`;
  write(block);
}

/** Log a direct API response (Codex). */
export function logApiResponse(opts: {
  text: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  durationMs: number;
}): void {
  let block =
    `  OUTPUT (response from model):\n` +
    `${THIN_SEP}\n` +
    `${opts.text}\n` +
    `${THIN_SEP}\n`;

  if (opts.usage) {
    block +=
      `  USAGE:\n` +
      `    Prompt tokens     : ${opts.usage.prompt_tokens ?? '?'}\n` +
      `    Completion tokens : ${opts.usage.completion_tokens ?? '?'}\n` +
      `    Total tokens      : ${opts.usage.total_tokens ?? '?'}\n`;
  }

  block +=
    `  Duration   : ${opts.durationMs}ms\n` +
    `${SEP}\n\n`;

  write(block);
}

/** Log the parsed OpenAI response (after toOpenAIResponse) to verify parsing. */
export function logParsedResult(opts: {
  finishReason: string;
  content: string | null;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}): void {
  let block =
    `  PARSED RESULT (sent back to caller):\n` +
    `${THIN_SEP}\n` +
    `  Finish Reason : ${opts.finishReason}\n`;

  if (opts.toolCalls && opts.toolCalls.length > 0) {
    block += `  Tool Calls    : ${opts.toolCalls.length}\n`;
    for (const tc of opts.toolCalls) {
      block += `    [${tc.id}] ${tc.function.name}\n`;
      // Parse arguments JSON into readable key=value
      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        for (const [key, val] of Object.entries(args)) {
          const display = typeof val === 'string' ? val : JSON.stringify(val);
          block += `      ${key}: ${display}\n`;
        }
      } catch {
        block += `      (raw): ${tc.function.arguments}\n`;
      }
    }
  }

  if (opts.content) {
    block += `  Content       :\n${opts.content}\n`;
  } else if (!opts.toolCalls?.length) {
    block += `  Content       : (empty)\n`;
  }

  block += `${SEP}\n\n`;
  write(block);
}

/** Get the current turn count (useful for external reference). */
export function getTurnCount(): number {
  return turnCounter;
}

function write(content: string): void {
  if (!logPath) return;
  try {
    appendFileSync(logPath, content, 'utf8');
  } catch {
    // Fire-and-forget — never block the proxy
  }
}
