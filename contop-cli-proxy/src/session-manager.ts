import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { ProviderConfig } from './providers/base.js';
import type { NdjsonEvent, CliResponse, ToolCallEvent, OpenAIMessage, OpenAITool } from './types.js';
import { toCliMessage } from './openai-adapter.js';
import { initLlmLog, logSubSpawn, logSubResponse } from './llm-logger.js';

// ── Constants ───────────────────────────────────────────────────────

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30000;
const STARTUP_GRACE_MS = 3000;
const RESULT_TIMEOUT_MS = 300000; // 5 minutes max per request

// ── SessionManager ──────────────────────────────────────────────────

/**
 * Manages CLI provider sessions with --resume chaining for conversation context.
 *
 * Per-request flow:
 * 1. First request:  spawn CLI without --resume
 * 2. Capture session_id from response (provider-specific)
 * 3. Next request:   spawn CLI with --resume <captured-session-id>
 *
 * This mimics a developer using `claude -p` / `gemini --prompt` naturally.
 */
export class SessionManager {
  private provider: ProviderConfig;
  private workspaceDir: string;
  private proxySessionId: string; // Our internal tracking ID
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private alive = false;
  private destroyed = false;
  private restartCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private model: string;

  // Resume chaining: track the provider's session ID for --resume
  private lastProviderSessionId: string = '';

  // Event handling (persistent mode)
  private eventHandlers: Array<(event: NdjsonEvent) => void> = [];
  private initResolve: ((value: void) => void) | null = null;
  private initReject: ((reason: Error) => void) | null = null;

  // Request queue for single-concurrency serialization
  private requestQueue: Array<{
    content: string;     // pre-converted CLI string
    hasTools: boolean;   // true → tool-calling mode: skip --resume, add --tools ""
    effort?: string;     // thinking level: 'low' | 'medium' | 'high' | 'max'
    model?: string;      // per-request model override (e.g. "claude-sonnet-4-6")
    onEvent?: (event: NdjsonEvent) => void;
    resolve: (response: CliResponse) => void;
    reject: (reason: Error) => void;
  }> = [];
  private processing = false;

  constructor(
    provider: ProviderConfig,
    workspaceDir: string,
    sessionId?: string,
    model?: string,
  ) {
    this.provider = provider;
    this.workspaceDir = workspaceDir;
    this.proxySessionId = sessionId || randomUUID();
    this.model = model || provider.defaultModel;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async start(): Promise<void> {
    // Initialize LLM call logger for this session
    initLlmLog({
      sessionId: this.proxySessionId,
      provider: this.provider.displayName,
      model: this.model,
    });

    if (this.provider.mode === 'per-request') {
      this.alive = true;
      this.restartCount = 0;
      console.log(`[session] ${this.provider.displayName} ready (per-request mode)`);
      return;
    }

    // Persistent mode: spawn the CLI binary
    const args = this.provider.buildSpawnArgs(this.lastProviderSessionId);

    console.log(`[session] Spawning ${this.provider.binary}:`, args.join(' '));
    console.log(`[session] Working directory: ${this.workspaceDir}`);

    this.process = spawn(this.provider.binary, args, {
      cwd: this.workspaceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env },
    });

    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line) => this.handleLine(line));

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.warn(`[${this.provider.displayName} stderr]`, text);
    });

    this.process.on('exit', (code, signal) => {
      console.warn(`[session] ${this.provider.displayName} exited: code=${code}, signal=${signal}`);
      this.alive = false;
      this.readline?.close();
      this.readline = null;
      if (!this.destroyed) this.scheduleRestart();
    });

    this.process.on('error', (err) => {
      console.error(`[session] ${this.provider.displayName} spawn error:`, err.message);
      this.alive = false;
      if (this.initReject) {
        this.initReject(err);
        this.initReject = null;
        this.initResolve = null;
      }
    });

    if (this.provider.emitsInit) {
      await this.waitForInit();
    } else {
      await this.waitForGracePeriod();
    }

    this.alive = true;
    this.restartCount = 0;
    console.log(`[session] ${this.provider.displayName} session ready`);
  }

  private waitForGracePeriod(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const graceTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.process && !this.process.killed) {
          resolve();
        } else {
          reject(new Error(`${this.provider.displayName} exited during startup`));
        }
      }, STARTUP_GRACE_MS);

      this.process?.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(graceTimeout);
        reject(new Error(`${this.provider.displayName} exited with code ${code} during startup`));
      });
    });
  }

  private waitForInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      const timeout = setTimeout(() => {
        this.initReject = null;
        this.initResolve = null;
        reject(new Error(`${this.provider.displayName} init timeout after 30s`));
      }, 30000);
      const origResolve = resolve;
      this.initResolve = () => {
        clearTimeout(timeout);
        origResolve();
      };
    });
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.destroyed) return;
    if (this.provider.mode === 'per-request') return;

    const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, this.restartCount), BACKOFF_MAX_MS);
    this.restartCount++;
    console.log(`[session] Auto-restart in ${backoffMs}ms (attempt ${this.restartCount})`);

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      if (this.destroyed) return;
      try {
        await this.start();
        this.processQueue();
      } catch (err) {
        console.error('[session] Restart failed:', (err as Error).message);
        this.scheduleRestart();
      }
    }, backoffMs);
  }

  isAlive(): boolean { return this.alive; }
  getSessionId(): string { return this.proxySessionId; }
  getResumeSessionId(): string { return this.lastProviderSessionId; }
  getModel(): string { return this.model; }
  getProvider(): ProviderConfig { return this.provider; }

  async restart(): Promise<void> {
    this.destroy();
    this.destroyed = false;
    await this.start();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.alive = false;
    this.readline?.close();
    this.readline = null;

    while (this.requestQueue.length > 0) {
      const req = this.requestQueue.shift()!;
      req.reject(new Error('Session destroyed'));
    }

    const proc = this.process;
    this.process = null;
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
    }
  }

  // ── NDJSON Parsing (persistent mode) ───────────────────────────

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: NdjsonEvent;
    try { event = JSON.parse(trimmed) as NdjsonEvent; }
    catch { console.warn('[session] Non-JSON line:', trimmed.slice(0, 200)); return; }

    const normalizedType = this.provider.normalizeEventType(event.type);
    if (normalizedType === 'init' && this.initResolve) {
      this.initResolve();
      this.initResolve = null;
      this.initReject = null;
    }

    for (const handler of this.eventHandlers) handler(event);
  }

  // ── Message Sending ─────────────────────────────────────────────

  sendMessage(messages: OpenAIMessage[], tools?: OpenAITool[], effort?: string, model?: string): Promise<CliResponse> {
    const hasTools = !!(tools && tools.length > 0);
    const content = toCliMessage(messages, tools);
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ content, hasTools, effort, model, resolve, reject });
      this.processQueue();
    });
  }

  sendMessageStreaming(
    messages: OpenAIMessage[],
    onEvent: (event: NdjsonEvent) => void,
    tools?: OpenAITool[],
    effort?: string,
    model?: string,
  ): Promise<CliResponse> {
    const hasTools = !!(tools && tools.length > 0);
    const content = toCliMessage(messages, tools);
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ content, hasTools, effort, model, onEvent, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.processing || this.requestQueue.length === 0 || !this.alive) return;

    this.processing = true;
    const request = this.requestQueue.shift()!;

    const execute = this.provider.mode === 'per-request'
      ? this.executePerRequest.bind(this)
      : this.executePersistent.bind(this);

    execute(request)
      .then((response) => {
        this.processing = false;
        request.resolve(response);
        this.processQueue();
      })
      .catch((err) => {
        this.processing = false;
        request.reject(err as Error);
        this.processQueue();
      });
  }

  // ── Persistent Mode ───────────────────────────────────────────

  private executePersistent(request: {
    content: string;
    onEvent?: (event: NdjsonEvent) => void;
  }): Promise<CliResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('CLI subprocess stdin not writable'));
        return;
      }

      // ── LLM Logger: log persistent-mode input ──
      logSubSpawn({
        binary: this.provider.binary,
        args: ['(persistent session — stdin pipe)'],
        model: this.model,
        prompt: request.content,
        hasTools: false,
      });
      const persistStartTime = Date.now();

      const events: NdjsonEvent[] = [];
      let text = '';
      const toolCalls: ToolCallEvent[] = [];

      const handler = (event: NdjsonEvent) => {
        const normalizedType = this.provider.normalizeEventType(event.type);
        events.push(event);
        if (request.onEvent) request.onEvent(event);

        switch (normalizedType) {
          case 'text_delta': text += this.provider.extractTextContent(event); break;
          case 'tool_use': {
            const e = event as Record<string, unknown>;
            toolCalls.push({
              id: (e.id as string) || `call_${randomUUID().slice(0, 8)}`,
              name: (e.name as string) || 'unknown',
              arguments: (e.arguments as Record<string, unknown>) || (e.input as Record<string, unknown>) || {},
            });
            break;
          }
          case 'result': {
            cleanup();
            const e = event as Record<string, unknown>;
            const usage = e.usage ? {
              prompt_tokens: (e.usage as Record<string, number>).prompt_tokens || 0,
              completion_tokens: (e.usage as Record<string, number>).completion_tokens || 0,
              total_tokens: (e.usage as Record<string, number>).total_tokens || 0,
            } : null;
            // ── LLM Logger: log persistent-mode response ──
            logSubResponse({ text, toolCalls, usage, durationMs: Date.now() - persistStartTime });
            resolve({ text, toolCalls, usage, events });
            break;
          }
          case 'error': {
            cleanup();
            const e = event as Record<string, unknown>;
            logSubResponse({ text: `[ERROR] ${(e.message as string) || JSON.stringify(event)}`, toolCalls: [], usage: null, durationMs: Date.now() - persistStartTime });
            reject(new Error(`CLI error: ${(e.message as string) || JSON.stringify(event)}`));
            break;
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        const idx = this.eventHandlers.indexOf(handler);
        if (idx >= 0) this.eventHandlers.splice(idx, 1);
      };

      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timeout after ${RESULT_TIMEOUT_MS}ms`)); }, RESULT_TIMEOUT_MS);
      this.eventHandlers.push(handler);

      const payload = this.provider.buildStdinMessage(request.content);
      this.process!.stdin!.write(payload);
    });
  }

  // ── Per-Request Mode with --resume Chaining ───────────────────

  private executePerRequest(request: {
    content: string;
    hasTools: boolean;
    effort?: string;
    model?: string;
    onEvent?: (event: NdjsonEvent) => void;
  }): Promise<CliResponse> {
    return new Promise((resolve, reject) => {
      // If the provider sends full history in every message (useResume=false),
      // never pass --resume — it would duplicate context and bleed session
      // state across user sessions.
      // In tool-calling mode ADK also sends full history, so skip resume there too.
      const canResume = this.provider.useResume !== false;
      const resumeId = (canResume && !request.hasTools) ? this.lastProviderSessionId : '';
      const args = this.provider.buildSpawnArgs(resumeId);

      // Per-request model override: pass the model flag to the CLI so it uses
      // the model selected by the user, not the CLI's default.
      const requestModel = request.model || this.model;
      if (requestModel) {
        if (this.provider.binary === 'codex') {
          args.push('-c', `model="${requestModel}"`);
        } else {
          // Claude (--model) and Gemini (--model / -m) both use --model
          args.push('--model', requestModel);
        }
      }

      // --tools and --effort are Claude CLI-only flags
      if (this.provider.binary === 'claude') {
        if (request.hasTools) {
          args.push('--tools', '""');
        }
        if (request.effort) {
          args.push('--effort', request.effort);
        }
      }

      // For Gemini: append --prompt with the content
      if (!this.provider.usesStdinPipe) {
        args.push('--prompt', request.content);
      }

      const isResume = !!resumeId;
      console.log(`[session] Spawning ${this.provider.binary} (${isResume ? 'resume: ' + resumeId.slice(0, 8) + '...' : request.hasTools ? 'tool-call (stateless)' : 'new session'})`);

      // ── LLM Logger: log spawn + input ──
      logSubSpawn({
        binary: this.provider.binary,
        args,
        model: requestModel,
        prompt: request.content,
        resumeId: resumeId || undefined,
        hasTools: request.hasTools,
        effort: request.effort,
      });
      const spawnStartTime = Date.now();

      const proc = spawn(this.provider.binary, args, {
        cwd: this.workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env },
      });

      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

      const events: NdjsonEvent[] = [];
      let text = '';
      const toolCalls: ToolCallEvent[] = [];
      let settled = false;

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let event: NdjsonEvent;
        try { event = JSON.parse(trimmed) as NdjsonEvent; }
        catch { console.warn('[session] Non-JSON line:', trimmed.slice(0, 200)); return; }

        const normalizedType = this.provider.normalizeEventType(event.type);
        events.push(event);

        // Extract session ID for --resume chaining
        if (this.provider.extractSessionId) {
          const sid = this.provider.extractSessionId(event);
          if (sid) {
            this.lastProviderSessionId = sid;
            console.log(`[session] Captured session ID for resume: ${sid.slice(0, 8)}...`);
          }
        }

        if (request.onEvent) request.onEvent(event);

        switch (normalizedType) {
          case 'text_delta': {
            text += this.provider.extractTextContent(event);
            break;
          }
          case 'tool_use': {
            const e = event as Record<string, unknown>;
            toolCalls.push({
              id: (e.id as string) || `call_${randomUUID().slice(0, 8)}`,
              name: (e.name as string) || 'unknown',
              arguments: (e.arguments as Record<string, unknown>) || (e.input as Record<string, unknown>) || {},
            });
            break;
          }
          case 'result': {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              // Extract usage if available (Codex turn.completed, Claude result)
              const e = event as Record<string, unknown>;
              const rawUsage = e.usage as Record<string, number> | undefined;
              const usage = rawUsage ? {
                prompt_tokens: rawUsage.input_tokens || rawUsage.prompt_tokens || 0,
                completion_tokens: rawUsage.output_tokens || rawUsage.completion_tokens || 0,
                total_tokens: (rawUsage.input_tokens || rawUsage.prompt_tokens || 0) +
                  (rawUsage.output_tokens || rawUsage.completion_tokens || 0),
              } : null;
              // ── LLM Logger: log response ──
              logSubResponse({
                text, toolCalls, usage, durationMs: Date.now() - spawnStartTime,
              });
              resolve({ text, toolCalls, usage, events });
            }
            break;
          }
          case 'error': {
            const e = event as Record<string, unknown>;
            console.warn(`[session] Error event:`, (e.message as string) || JSON.stringify(event));
            break;
          }
        }
      });

      let stderrOutput = '';
      proc.stderr?.on('data', (data: Buffer) => {
        const t = data.toString().trim();
        if (t) {
          stderrOutput += t + '\n';
          console.warn(`[${this.provider.displayName} stderr]`, t);
        }
      });

      proc.on('exit', (code) => {
        rl.close();
        clearTimeout(timeout);
        if (settled) return;
        settled = true;

        if (code !== 0 && text === '' && events.length === 0) {
          logSubResponse({ text: `[ERROR] ${stderrOutput.slice(0, 500)}`, toolCalls: [], usage: null, durationMs: Date.now() - spawnStartTime, exitCode: code });
          reject(new Error(
            `${this.provider.displayName} exited with code ${code}. stderr: ${stderrOutput.slice(0, 500)}`
          ));
          return;
        }
        // ── LLM Logger: log response (exit fallback) ──
        logSubResponse({ text, toolCalls, usage: null, durationMs: Date.now() - spawnStartTime, exitCode: code });
        resolve({ text, toolCalls, usage: null, events });
      });

      proc.on('error', (err) => {
        rl.close();
        clearTimeout(timeout);
        if (!settled) { settled = true; reject(new Error(`Spawn error: ${err.message}`)); }
      });

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGTERM');
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
          reject(new Error(`Request timeout after ${RESULT_TIMEOUT_MS}ms`));
        }
      }, RESULT_TIMEOUT_MS);

      // For stdin-pipe providers (Claude): write prompt then close stdin
      if (this.provider.usesStdinPipe) {
        const payload = this.provider.buildStdinMessage(request.content);
        proc.stdin!.write(payload, () => {
          proc.stdin!.end();
        });
      }
    });
  }
}
