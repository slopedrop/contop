import { useRef, useCallback } from 'react';
import { getGeminiApiKey, getOpenAIApiKey, getAnthropicApiKey, getOpenRouterApiKey } from '../services/secureStorage';
import { loadAISettings, getActiveSystemPrompt } from '../services/aiSettings';
import useAIStore from '../stores/useAIStore';
import type { ExecutionEntry } from '../types';
import { isThinkingEnabled, TOOL_DECLARATIONS_JSON_SCHEMA } from '../constants/providerConfig';
import { getProviderForModel } from '../constants/modelRegistry';
import { createProvider } from '../services/providers';
import type { LLMProvider, Message, GenerateResult } from '../services/providers';
import { createSTTProvider } from '../services/providers/sttProvider';
import type { STTProvider } from '../services/providers/sttProvider';

/** Convert ArrayBuffer to base64 string, processing in chunks to avoid stack overflow. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

/** Decode a base64 string to Uint8Array. */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/** Create a 44-byte WAV header for raw PCM data (mono, 16-bit LE). */
function createWavHeader(pcmByteLength: number, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmByteLength, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeString(view, 36, 'data');
  view.setUint32(40, pcmByteLength, true);

  return new Uint8Array(header);
}

/** Combine base64 PCM chunks into a WAV base64 string. */
function pcmChunksToWavBase64(chunks: string[], sampleRate: number): string {
  const pcmArrays = chunks.map(base64ToUint8Array);
  const totalLength = pcmArrays.reduce((sum, arr) => sum + arr.length, 0);

  const wavHeader = createWavHeader(totalLength, sampleRate);
  const combined = new Uint8Array(wavHeader.length + totalLength);
  combined.set(wavHeader, 0);

  let offset = wavHeader.length;
  for (const arr of pcmArrays) {
    combined.set(arr, offset);
    offset += arr.length;
  }

  return arrayBufferToBase64(combined.buffer);
}

/** Build a compact text summary of the conversation history for the server agent. */
function buildConversationContext(history: Message[]): string {
  if (history.length === 0) return '';
  const recent = history.slice(-20);
  const lines: string[] = [];
  for (const turn of recent) {
    const role = turn.role === 'user' ? 'User' : 'Contop';
    const text = typeof turn.content === 'string'
      ? turn.content
      : turn.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join(' ');
    if (text) lines.push(`${role}: ${text}`);
  }
  return lines.join('\n');
}

/** Check if the execution model's provider is using subscription (CLI proxy) mode. */
function isExecutionSubscription(executionModel: string): boolean {
  const provider = getProviderForModel(executionModel);
  return useAIStore.getState().isSubscriptionActive(provider);
}

/** Max time in ms to wait for a response before resetting to idle.
 * Subscription mode needs more time: phone → server → CLI proxy → CLI tool. */
const PROCESSING_TIMEOUT_MS = 120_000;

/** Max number of conversation turns to keep in chat history (sliding window). */
const MAX_HISTORY_TURNS = 40;

/** Max automatic retries on 429 rate-limit errors. */
const MAX_RATE_LIMIT_RETRIES = 2;

/** Default retry delay (ms) when the API doesn't provide one. */
const DEFAULT_RETRY_DELAY_MS = 6_000;

/** Extract retry delay from a 429 error. Returns delay in ms, or 0 if not a 429. */
function parseRateLimitDelay(err: unknown): number {
  if (!err || typeof err !== 'object') return 0;

  const status = (err as any).status ?? (err as any).code ?? (err as any).httpCode;
  const message = (err as any).message ?? '';

  const is429 =
    status === 429 ||
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('quota') ||
    message.includes('rate_limit');

  if (!is429) return 0;

  const retryMatch = message.match(/retry in ([\d.]+)s/i);
  if (retryMatch) {
    return Math.ceil(parseFloat(retryMatch[1]) * 1000);
  }

  return DEFAULT_RETRY_DELAY_MS;
}

/** Sleep for the given ms. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Get the API key for a given provider from secure storage */
async function getApiKeyForProvider(provider: string): Promise<string | null> {
  switch (provider) {
    case 'gemini': return getGeminiApiKey();
    case 'openai': return getOpenAIApiKey();
    case 'anthropic': return getAnthropicApiKey();
    case 'openrouter': return getOpenRouterApiKey();
    default: return null;
  }
}

/** Classify a subscription proxy error into a user-friendly message. */
function classifyProxyError(errMsg: string): string {
  const msg = errMsg.toLowerCase();
  if (msg.includes('readtimeout') || msg.includes('read timeout'))
    return 'Subscription proxy timed out. The provider may be slow or unreachable — try again.';
  if (msg.includes('connecttimeout') || msg.includes('connect timeout') || msg.includes('connection refused'))
    return 'Could not reach the subscription proxy. Make sure the proxy is running on desktop.';
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('auth'))
    return 'Subscription auth failed. Re-authenticate in your desktop CLI.';
  if (msg.includes('429') || msg.includes('rate'))
    return 'Rate limited by provider. Wait a moment and try again.';
  if (msg.includes('500') || msg.includes('internal'))
    return 'The subscription proxy returned an error. Try again or switch to API key mode.';
  return `Subscription error: ${errMsg}`;
}

/** Classify a mobile-side API error into a user-friendly message. */
function classifyMobileApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (msg.includes('network request failed') || msg.includes('fetch failed') || msg.includes('connection'))
    return 'Network error — could not reach the AI service. Check your internet connection.';
  if (msg.includes('rate') && msg.includes('limit') || msg.includes('429'))
    return 'Rate limited — please wait a moment and try again.';
  if (msg.includes('401') || msg.includes('403') || msg.includes('api key') || msg.includes('unauthorized'))
    return 'API key error — please check your API key in settings.';
  if (msg.includes('404') || msg.includes('model not found'))
    return 'Model not found — please check your model selection in settings.';
  if (msg.includes('timeout') || msg.includes('timed out'))
    return 'The request timed out. Please try again.';
  if (msg.includes('quota') || msg.includes('billing'))
    return 'API quota exceeded — please check your usage limits.';
  return 'Something went wrong. Please try again.';
}

export type SendDataChannelMessage = (
  type: string,
  payload: Record<string, unknown>,
) => void;

export function useConversation() {
  const providerRef = useRef<LLMProvider | null>(null);
  const currentProviderNameRef = useRef<string | null>(null);
  const closedRef = useRef(false);
  const sendDCMessageRef = useRef<SendDataChannelMessage | null>(null);
  const onTextResponseRef = useRef<((text: string, toolSummary?: string[]) => void) | null>(null);
  const onErrorRef = useRef<((message: string) => void) | null>(null);
  const onToolCallRef = useRef<((name: string, callId: string, args: Record<string, unknown>) => void) | null>(null);
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSendingRef = useRef(false);
  // Accumulates streaming deltas from subscription conversation_request
  const streamingBufferRef = useRef<string>('');
  // Tracks pending classification: when set, the next conversation_response
  // should be routed (tool_calls → execution agent, text → display directly)
  const classificationPendingRef = useRef<{ text: string; settings: Awaited<ReturnType<typeof loadAISettings>> } | null>(null);

  // --- Chat history (provider-agnostic Message[] format) ---
  const chatHistoryRef = useRef<Message[]>([]);
  const pendingTextToolCallsRef = useRef<Set<string>>(new Set());
  const sessionGenRef = useRef(0);

  // Offset tracking: index into chatHistoryRef up to which the ADK execution
  // agent already has context (via its own session history).  When building
  // conversation_context for the next execution call we only send turns AFTER
  // this index so the agent never receives duplicate history.
  const lastExecutionSyncIndexRef = useRef(0);

  /** Trim chat history to sliding window to prevent unbounded growth. */
  const trimHistory = () => {
    const overflow = chatHistoryRef.current.length - MAX_HISTORY_TURNS;
    if (overflow > 0) {
      chatHistoryRef.current = chatHistoryRef.current.slice(-MAX_HISTORY_TURNS);
      lastExecutionSyncIndexRef.current = Math.max(0, lastExecutionSyncIndexRef.current - overflow);
    }
  };

  /**
   * Generate content with automatic 429 retry via the provider abstraction.
   */
  const generateWithRetry = async (
    provider: LLMProvider,
    model: string,
    messages: Message[],
    systemPrompt: string,
    withTools: boolean,
    thinkingEnabled?: boolean,
  ): Promise<GenerateResult> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        return await provider.generateContent({
          model,
          messages,
          systemPrompt,
          tools: withTools ? true : undefined,
          thinkingEnabled,
        });
      } catch (err) {
        const delayMs = parseRateLimitDelay(err);
        if (delayMs === 0 || attempt === MAX_RATE_LIMIT_RETRIES) {
          throw err;
        }
        lastError = err;
        console.warn(`[Conversation] Rate limited (429). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`);
        onErrorRef.current?.(`Rate limited — retrying in ${Math.ceil(delayMs / 1000)}s…`);
        await sleep(delayMs);
      }
    }
    throw lastError;
  };

  /** Start a safety timer: if stuck in 'processing' for too long, reset to idle. */
  const startProcessingTimeout = useCallback(() => {
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    processingTimerRef.current = setTimeout(() => {
      const { aiState } = useAIStore.getState();
      if (aiState === 'processing') {
        console.warn('[Conversation] Processing timeout — resetting to idle');
        useAIStore.getState().setAIState('idle');
      }
    }, PROCESSING_TIMEOUT_MS);
  }, []);

  const clearProcessingTimeout = useCallback(() => {
    if (processingTimerRef.current) {
      clearTimeout(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  }, []);

  /** Initialize or re-initialize the AI provider for the given (or current) model. */
  const initProvider = useCallback(async (modelOverride?: string) => {
    const settings = await loadAISettings();
    const model = modelOverride ?? settings.conversationModel;
    const providerName = getProviderForModel(model);

    // Subscription mode: no API key needed — sendTextMessage routes via data channel.
    if (useAIStore.getState().isSubscriptionActive(providerName)) {
      providerRef.current = null;
      currentProviderNameRef.current = providerName;
      return null;
    }

    const apiKey = await getApiKeyForProvider(providerName);
    if (!apiKey) {
      console.warn(`[Conversation] No API key found for provider: ${providerName}`);
      return null;
    }

    providerRef.current = createProvider(providerName, apiKey);
    currentProviderNameRef.current = providerName;
    console.log(`[Conversation] Provider initialized: ${providerName}`);
    return providerRef.current;
  }, []);

  /** Initialize the AI provider instance based on current settings. */
  const connect = useCallback(async () => {
    closedRef.current = false;
    await initProvider();
    // Always set idle — subscription mode works without a provider instance.
    useAIStore.getState().setAIState('idle');
  }, [initProvider]);

  /** Ensure provider matches current model; re-initialize if provider changed. */
  const ensureProvider = useCallback(async (): Promise<LLMProvider | null> => {
    if (closedRef.current) return null;
    const settings = await loadAISettings();
    const neededProvider = getProviderForModel(settings.conversationModel);
    if (providerRef.current && currentProviderNameRef.current === neededProvider) {
      return providerRef.current;
    }
    // Only wipe chat history when the provider name actually changed (e.g.
    // user switched from Gemini to Anthropic).  In subscription mode
    // providerRef is always null by design, so the early-return above never
    // fires — but the provider name stays the same, so we must NOT clear
    // history on every call or multi-turn context is lost.
    if (currentProviderNameRef.current !== null && currentProviderNameRef.current !== neededProvider) {
      console.log(`[Conversation] Provider changed: ${currentProviderNameRef.current} → ${neededProvider}`);
      chatHistoryRef.current = [];
    }
    return initProvider(settings.conversationModel);
  }, [initProvider]);

  // ─── Text model: generateContent methods ───────────────────────────────

  const processTextResponseRef = useRef<(result: GenerateResult) => Promise<void>>();
  const continueTextConversationRef = useRef<(
    callId: string,
    name: string,
    result: Record<string, unknown>,
  ) => Promise<void>>();

  processTextResponseRef.current = async (result: GenerateResult) => {
    const store = useAIStore.getState();

    if (result.toolCalls && result.toolCalls.length > 0) {
      // Add model turn with tool calls to history
      chatHistoryRef.current.push({
        role: 'assistant',
        content: result.toolCalls.map((tc) => ({
          type: 'tool_call' as const,
          id: tc.id,
          name: tc.name,
          args: tc.args,
          ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
        })),
      });
      trimHistory();

      for (const tc of result.toolCalls) {
        console.log('[Conversation] Tool call:', tc.name, 'id:', tc.id);
        store.setAIState('executing');
        pendingTextToolCallsRef.current.add(tc.id);
        sendDCMessageRef.current?.('tool_call', {
          name: tc.name,
          args: tc.args,
          gemini_call_id: tc.id,
        });
        onToolCallRef.current?.(tc.name, tc.id, tc.args);
      }
    } else if (result.text) {
      chatHistoryRef.current.push({
        role: 'assistant',
        content: result.text,
      });
      trimHistory();
      console.log('[Conversation] Response:', result.text.substring(0, 100));
      onTextResponseRef.current?.(result.text);
      store.setAIState('idle');
    } else {
      console.warn('[Conversation] Empty response from model');
      store.setAIState('idle');
    }
  };

  continueTextConversationRef.current = async (
    callId: string,
    name: string,
    result: Record<string, unknown>,
  ) => {
    const provider = await ensureProvider();
    if (!provider) return;

    pendingTextToolCallsRef.current.delete(callId);

    // Add tool result to history
    chatHistoryRef.current.push({
      role: 'user',
      content: [{
        type: 'tool_result' as const,
        toolCallId: callId,
        name,
        result,
      }],
    });
    trimHistory();

    try {
      console.log('[Conversation] Continuing after tool result for:', name);
      const settings = await loadAISettings();
      const generateResult = await generateWithRetry(
        provider,
        settings.conversationModel,
        chatHistoryRef.current,
        getActiveSystemPrompt(settings),
        true,
        isThinkingEnabled(settings.conversationModel, settings.thinkingEnabled),
      );
      await processTextResponseRef.current?.(generateResult);
    } catch (err) {
      console.error('[Conversation] Continue conversation failed:', err);
      onErrorRef.current?.(classifyMobileApiError(err));
      useAIStore.getState().setAIState('idle');
    }
  };

  /** Send a text message via the provider (with optional screen frame). */
  const sendTextMessage = useCallback(async (text: string, frame?: string) => {
    if (isSendingRef.current) {
      console.warn('[Conversation] sendTextMessage: already processing a message, ignoring');
      return;
    }

    // Subscription routing: if the conversation model's provider has an active CLI proxy,
    // route the request through the server instead of calling the API directly.
    const settings = await loadAISettings();
    const modelProvider = getProviderForModel(settings.conversationModel);
    const isSubscription = useAIStore.getState().isSubscriptionActive(modelProvider);

    if (isSubscription && sendDCMessageRef.current) {
      if (closedRef.current) return;
      isSendingRef.current = true;
      streamingBufferRef.current = '';
      chatHistoryRef.current.push({ role: 'user', content: text });
      trimHistory();
      useAIStore.getState().setAIState('processing');
      startProcessingTimeout();
      console.log('[Conversation] sendTextMessage via subscription proxy:', text.substring(0, 80));
      sendDCMessageRef.current('conversation_request', {
        model: settings.conversationModel,
        messages: chatHistoryRef.current,
        system_prompt: getActiveSystemPrompt(settings),
        thinking_enabled: isThinkingEnabled(settings.conversationModel, settings.thinkingEnabled),
        stream: true,
      });
      return;
    }

    const provider = await ensureProvider();
    if (!provider) {
      console.warn('[Conversation] sendTextMessage: no provider (call connect first)');
      return;
    }

    try {
      isSendingRef.current = true;
      console.log('[Conversation] sendTextMessage:', text.substring(0, 80), frame ? '(+frame)' : '');
      useAIStore.getState().setAIState('processing');
      startProcessingTimeout();

      // Store text-only in history
      chatHistoryRef.current.push({ role: 'user', content: text });
      trimHistory();

      // Build messages: history + current turn with optional frame
      const messages: Message[] = [...chatHistoryRef.current];
      if (frame) {
        // Replace the last message with one that includes the frame
        messages[messages.length - 1] = {
          role: 'user',
          content: [
            { type: 'image', data: frame, mimeType: 'image/jpeg' },
            { type: 'text', text },
          ],
        };
      }

      const settings = await loadAISettings();
      const result = await generateWithRetry(
        provider,
        settings.conversationModel,
        messages,
        getActiveSystemPrompt(settings),
        true,
        isThinkingEnabled(settings.conversationModel, settings.thinkingEnabled),
      );

      clearProcessingTimeout();
      await processTextResponseRef.current?.(result);
    } catch (err) {
      console.error('[Conversation] sendTextMessage failed:', err);
      clearProcessingTimeout();
      onErrorRef.current?.(classifyMobileApiError(err));
      useAIStore.getState().setAIState('idle');
    } finally {
      isSendingRef.current = false;
    }
  }, [startProcessingTimeout, clearProcessingTimeout]);

  // ─── Voice transcription ──────────────────────────────────────────────

  /** Transcribe accumulated PCM audio chunks to text via selected STT provider. */
  const transcribeAudio = useCallback(async (chunks: string[]): Promise<string> => {
    if (chunks.length === 0) return '';

    try {
      const settings = await loadAISettings();
      const sttProviderName = settings.sttProvider || 'gemini';

      if (sttProviderName === 'disabled') return '';

      const apiKey = await getApiKeyForProvider(sttProviderName);
      if (!apiKey) {
        console.warn(`[Conversation] No API key for STT provider: ${sttProviderName}`);
        onErrorRef.current?.(`No API key configured for ${sttProviderName} speech-to-text.`);
        return '';
      }

      console.log('[Conversation] Transcribing audio via:', sttProviderName, chunks.length, 'chunks');
      const wavBase64 = pcmChunksToWavBase64(chunks, 16000);

      const sttProvider: STTProvider | null = createSTTProvider(sttProviderName, apiKey);
      if (!sttProvider) return '';

      const transcription = await sttProvider.transcribe(wavBase64);
      console.log('[Conversation] Transcription:', transcription.substring(0, 100));
      return transcription;
    } catch (err) {
      console.error('[Conversation] Transcription failed:', err);
      const delayMs = parseRateLimitDelay(err);
      onErrorRef.current?.(
        delayMs > 0
          ? 'Rate limit exceeded. Please wait a moment and try again.'
          : 'Voice transcription failed. Please try again.',
      );
      return '';
    }
  }, []);

  // ─── Subscription data channel response handlers ─────────────────────

  /**
   * Handle data channel messages from the server that are responses to a
   * subscription conversation_request (conversation_stream_delta / _end / _response).
   */
  const handleDataChannelMessage = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      if (type === 'conversation_stream_delta') {
        const delta = payload.delta as string;
        if (delta) {
          streamingBufferRef.current += delta;
          clearProcessingTimeout();
          useAIStore.getState().setAIState('processing');
        }
      } else if (type === 'conversation_stream_end') {
        let text = streamingBufferRef.current;
        streamingBufferRef.current = '';
        isSendingRef.current = false;
        clearProcessingTimeout();
        // CLI proxies may wrap responses in {"tool_call":null,"response":"..."}
        // JSON format — extract the actual response text if present.
        if (text) {
          const trimmed = text.trim();
          if (trimmed.startsWith('{"tool_call":')) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.tool_call === null && parsed.response) {
                text = parsed.response;
              }
            } catch { /* not valid JSON — use raw text */ }
          }
          chatHistoryRef.current.push({ role: 'assistant', content: text });
          trimHistory();
          onTextResponseRef.current?.(text);
        }
        useAIStore.getState().setAIState('idle');
      } else if (type === 'conversation_response') {
        isSendingRef.current = false;
        clearProcessingTimeout();

        const pending = classificationPendingRef.current;
        classificationPendingRef.current = null;

        if (payload.error) {
          const errMsg = payload.error as string;
          console.error('[Conversation] Subscription proxy error:', errMsg);
          onErrorRef.current?.(classifyProxyError(errMsg));
          const last = chatHistoryRef.current[chatHistoryRef.current.length - 1];
          if (last?.role === 'user') {
            chatHistoryRef.current.pop();
          }
          useAIStore.getState().setAIState('idle');
        } else if (pending && payload.tool_calls) {
          // Classification result: model wants tools → route to execution agent
          chatHistoryRef.current.pop(); // remove user message (execution agent manages its own)
          const conversationContext = buildConversationContext(chatHistoryRef.current.slice(lastExecutionSyncIndexRef.current));
          const thinking = isThinkingEnabled(pending.settings.executionModel, pending.settings.thinkingEnabled);
          sendDCMessageRef.current?.('user_intent', {
            text: pending.text,
            execution_model: pending.settings.executionModel,
            computer_use_backend: pending.settings.computerUseBackend,
            thinking,
            conversation_context: conversationContext,
            custom_instructions: pending.settings.customInstructions || undefined,
            use_subscription: isExecutionSubscription(pending.settings.executionModel),
          });
        } else {
          // Text-only response (conversation or classification with no tools needed)
          const text = payload.text as string;
          if (pending && !text) {
            // Classification returned empty — fall back to execution
            chatHistoryRef.current.pop();
            const conversationContext = buildConversationContext(chatHistoryRef.current.slice(lastExecutionSyncIndexRef.current));
            const thinking = isThinkingEnabled(pending.settings.executionModel, pending.settings.thinkingEnabled);
            sendDCMessageRef.current?.('user_intent', {
              text: pending.text,
              execution_model: pending.settings.executionModel,
              computer_use_backend: pending.settings.computerUseBackend,
              thinking,
              conversation_context: conversationContext,
              custom_instructions: pending.settings.customInstructions || undefined,
            });
          } else if (text) {
            chatHistoryRef.current.push({ role: 'assistant', content: text });
            trimHistory();
            onTextResponseRef.current?.(text);
            useAIStore.getState().setAIState('idle');
          } else {
            useAIStore.getState().setAIState('idle');
          }
        }
      }
    },
    [clearProcessingTimeout],
  );

  // ─── Shared methods ───────────────────────────────────────────────────

  const setOnTextResponse = useCallback(
    (handler: ((text: string, toolSummary?: string[]) => void) | null) => {
      onTextResponseRef.current = handler;
    },
    [],
  );

  const handleToolResult = useCallback(
    async (callId: string, name: string, result: Record<string, unknown>) => {
      if (pendingTextToolCallsRef.current.has(callId)) {
        await continueTextConversationRef.current?.(callId, name, result);
        return;
      }
      console.warn('[Conversation] Unknown tool call ID:', callId);
    },
    [],
  );

  const setSendDataChannelMessage = useCallback(
    (fn: SendDataChannelMessage) => {
      sendDCMessageRef.current = fn;
    },
    [],
  );

  const setOnError = useCallback(
    (handler: ((message: string) => void) | null) => {
      onErrorRef.current = handler;
    },
    [],
  );

  const setOnToolCall = useCallback(
    (handler: ((name: string, callId: string, args: Record<string, unknown>) => void) | null) => {
      onToolCallRef.current = handler;
    },
    [],
  );

  const resetHistory = useCallback(() => {
    sessionGenRef.current += 1;
    chatHistoryRef.current = [];
    lastExecutionSyncIndexRef.current = 0;
    pendingTextToolCallsRef.current.clear();
    isSendingRef.current = false;
  }, []);

  const restoreHistory = useCallback((entries: ExecutionEntry[]) => {
    sessionGenRef.current += 1;
    chatHistoryRef.current = [];
    lastExecutionSyncIndexRef.current = 0;
    pendingTextToolCallsRef.current.clear();
    isSendingRef.current = false;

    for (const entry of entries) {
      if (!entry.content) continue;
      if (entry.type === 'user_message') {
        chatHistoryRef.current.push({ role: 'user', content: entry.content });
      } else if (entry.type === 'ai_response') {
        // Reconstruct tool summary prefix from persisted metadata
        const ts = entry.metadata?.toolSummary as string[] | undefined;
        const toolInfo = ts?.length
          ? `[Desktop agent used: ${ts.join('\n')}]\n\n`
          : '';
        chatHistoryRef.current.push({ role: 'assistant', content: toolInfo + entry.content });
      }
    }
    trimHistory();
  }, []);

  const close = useCallback(() => {
    closedRef.current = true;
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    processingTimerRef.current = null;
    providerRef.current = null;
    currentProviderNameRef.current = null;
    chatHistoryRef.current = [];
    lastExecutionSyncIndexRef.current = 0;
    pendingTextToolCallsRef.current.clear();
    onTextResponseRef.current = null;
    onErrorRef.current = null;
    onToolCallRef.current = null;
    sendDCMessageRef.current = null;
    isSendingRef.current = false;
  }, []);

  /**
   * Process a server-side agent_result. The execution agent's output is
   * displayed directly to the user — no extra summarization API call needed.
   * History is synced so future conversation turns have context.
   */
  const processAgentResult = useCallback(async (userText: string, agentAnswer: string, _stepsTaken: number, _durationMs: number, toolSummary?: string[]) => {
    const gen = sessionGenRef.current;

    // Optionally prefix the assistant entry with tool details so the
    // conversation agent can reference specifics in later turns.
    const toolInfo = toolSummary?.length
      ? `[Desktop agent used: ${toolSummary.join('\n')}]\n\n`
      : '';

    // Sync into chat history so future conversation turns have context
    chatHistoryRef.current.push({ role: 'user', content: userText });
    chatHistoryRef.current.push({ role: 'assistant', content: toolInfo + agentAnswer });
    trimHistory();

    // Advance the sync offset — ADK now has everything up to this point.
    lastExecutionSyncIndexRef.current = chatHistoryRef.current.length;

    if (gen !== sessionGenRef.current) return;

    onTextResponseRef.current?.(agentAnswer, toolSummary);
    useAIStore.getState().setAIState('idle');
  }, []);

  /** Override phrases that auto-approve a pending sandbox confirmation. */
  const OVERRIDE_PHRASES = /^(force run|execute|run it|approve|do it|yes run it|go ahead|confirm)$/i;

  /**
   * Smart intent router: sends through mobile model first to classify.
   * - Text response → conversational, handled locally.
   * - Tool calls → needs desktop execution → route to server ADK agent.
   */
  const sendUserIntent = useCallback(async (text: string) => {
    const storeState = useAIStore.getState();
    const pendingConfirmation = [...storeState.executionEntries].reverse().find(
      (e) => e.type === 'agent_confirmation' && e.metadata?.status === 'pending',
    );
    if (pendingConfirmation && OVERRIDE_PHRASES.test(text.trim())) {
      const requestId = pendingConfirmation.metadata?.request_id as string;
      if (requestId) {
        storeState.sendConfirmationResponse?.(requestId, true);
        storeState.updateExecutionEntry(pendingConfirmation.id, {
          metadata: { ...pendingConfirmation.metadata, status: 'executed' },
        });
        storeState.setAIState('executing');
        return;
      }
    }

    const { connectionStatus } = useAIStore.getState();

    if (connectionStatus !== 'connected' || !sendDCMessageRef.current) {
      await sendTextMessage(text);
      return;
    }

    const provider = await ensureProvider();
    if (!provider) {
      // Subscription mode: route through conversation agent first for classification,
      // just like the API key flow does with the local provider.
      const settings = await loadAISettings();
      const modelProvider = getProviderForModel(settings.conversationModel);
      const isSubscription = useAIStore.getState().isSubscriptionActive(modelProvider);

      if (isSubscription && sendDCMessageRef.current) {
        useAIStore.getState().setAIState('processing');
        chatHistoryRef.current.push({ role: 'user', content: text });
        trimHistory();
        startProcessingTimeout();
        // Mark that the next conversation_response should be routed (not just displayed)
        classificationPendingRef.current = { text, settings };
        sendDCMessageRef.current('conversation_request', {
          model: settings.conversationModel,
          messages: chatHistoryRef.current,
          system_prompt: getActiveSystemPrompt(settings),
          tools: TOOL_DECLARATIONS_JSON_SCHEMA,
          stream: false,
        });
        return;
      }

      // No subscription available — fall back to sending directly to execution agent
      if (!sendDCMessageRef.current) return;
      useAIStore.getState().setAIState('processing');
      const thinking = isThinkingEnabled(settings.executionModel, settings.thinkingEnabled);
      sendDCMessageRef.current('user_intent', {
        text,
        execution_model: settings.executionModel,
        computer_use_backend: settings.computerUseBackend,
        thinking,
        custom_instructions: settings.customInstructions || undefined,
        use_subscription: isExecutionSubscription(settings.executionModel),
      });
      return;
    }

    try {
      useAIStore.getState().setAIState('processing');
      startProcessingTimeout();

      chatHistoryRef.current.push({ role: 'user', content: text });
      trimHistory();

      const settings = await loadAISettings();
      const result = await generateWithRetry(
        provider,
        settings.conversationModel,
        chatHistoryRef.current,
        getActiveSystemPrompt(settings),
        true,
      );

      clearProcessingTimeout();

      if (result.toolCalls && result.toolCalls.length > 0) {
        // Model wants tools → route to server ADK agent
        chatHistoryRef.current.pop();

        const conversationContext = buildConversationContext(chatHistoryRef.current.slice(lastExecutionSyncIndexRef.current));
        const thinking = isThinkingEnabled(settings.executionModel, settings.thinkingEnabled);
        sendDCMessageRef.current('user_intent', {
          text,
          execution_model: settings.executionModel,
          computer_use_backend: settings.computerUseBackend,
          thinking,
          conversation_context: conversationContext,
          custom_instructions: settings.customInstructions || undefined,
          use_subscription: isExecutionSubscription(settings.executionModel),
        });
      } else if (result.text) {
        chatHistoryRef.current.push({
          role: 'assistant',
          content: result.text,
        });
        trimHistory();
        onTextResponseRef.current?.(result.text);
        useAIStore.getState().setAIState('idle');
      } else {
        chatHistoryRef.current.pop();
        const conversationContext = buildConversationContext(chatHistoryRef.current.slice(lastExecutionSyncIndexRef.current));
        const thinking = isThinkingEnabled(settings.executionModel, settings.thinkingEnabled);
        sendDCMessageRef.current('user_intent', {
          text,
          execution_model: settings.executionModel,
          computer_use_backend: settings.computerUseBackend,
          thinking,
          conversation_context: conversationContext,
          custom_instructions: settings.customInstructions || undefined,
          use_subscription: isExecutionSubscription(settings.executionModel),
        });
      }
    } catch (err) {
      console.error('[Conversation] sendUserIntent classification failed, falling back to server:', err);
      clearProcessingTimeout();
      // Show the error to the user
      onErrorRef.current?.(classifyMobileApiError(err));
      if (chatHistoryRef.current.length > 0 &&
          chatHistoryRef.current[chatHistoryRef.current.length - 1].role === 'user') {
        chatHistoryRef.current.pop();
      }
      const conversationContext = buildConversationContext(chatHistoryRef.current.slice(lastExecutionSyncIndexRef.current));
      const settings = await loadAISettings();
      const thinking = isThinkingEnabled(settings.executionModel, settings.thinkingEnabled);
      sendDCMessageRef.current?.('user_intent', {
        text,
        execution_model: settings.executionModel,
        computer_use_backend: settings.computerUseBackend,
        thinking,
        conversation_context: conversationContext,
        custom_instructions: settings.customInstructions || undefined,
        use_subscription: isExecutionSubscription(settings.executionModel),
      });
    }
  }, [sendTextMessage, ensureProvider, startProcessingTimeout, clearProcessingTimeout]);

  return {
    connect,
    sendTextMessage,
    sendUserIntent,
    processAgentResult,
    transcribeAudio,
    handleToolResult,
    handleDataChannelMessage,
    resetHistory,
    restoreHistory,
    setSendDataChannelMessage,
    setOnTextResponse,
    setOnError,
    setOnToolCall,
    close,
  };
}
