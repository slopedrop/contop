import { renderHook, act } from '@testing-library/react-native';
import { useConversation } from './useConversation';
import useAIStore from '../stores/useAIStore';

// --- Mocks ---

jest.mock('../services/secureStorage', () => ({
  getGeminiApiKey: jest.fn(() => Promise.resolve('test-api-key')),
}));

const DEFAULT_TEST_SETTINGS = {
  conversationModel: 'gemini-2.5-flash',
  executionModel: 'gemini-2.5-flash',
  computerUseBackend: 'omniparser',
  customInstructions: null,
  thinkingEnabled: true,
};

jest.mock('../services/aiSettings', () => ({
  loadAISettings: jest.fn(() => Promise.resolve(DEFAULT_TEST_SETTINGS)),
  getActiveSystemPrompt: jest.fn((s: { customInstructions?: string | null }) =>
    s.customInstructions ? 'default + ' + s.customInstructions : 'default-system-instruction',
  ),
  DEFAULT_AI_SETTINGS: DEFAULT_TEST_SETTINGS,
}));

jest.mock('../services/webrtc', () => ({
  createMessageEnvelope: jest.fn(
    (type: string, payload: Record<string, unknown>) => ({
      type,
      id: 'mock-uuid',
      payload,
    }),
  ),
}));

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: (...args: any[]) => mockGenerateContent(...args) },
  })),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER' },
}));

describe('useConversation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    useAIStore.getState().resetStore();

    // Restore mocks after resetAllMocks
    const { getGeminiApiKey } = jest.requireMock('../services/secureStorage') as {
      getGeminiApiKey: jest.Mock;
    };
    getGeminiApiKey.mockReturnValue(Promise.resolve('test-api-key'));

    const { loadAISettings, getActiveSystemPrompt } = jest.requireMock('../services/aiSettings') as {
      loadAISettings: jest.Mock;
      getActiveSystemPrompt: jest.Mock;
    };
    loadAISettings.mockReturnValue(Promise.resolve(DEFAULT_TEST_SETTINGS));
    getActiveSystemPrompt.mockImplementation(
      (s: { customInstructions?: string | null }) => s.customInstructions ? 'default + ' + s.customInstructions : 'default-system-instruction',
    );

    const { GoogleGenAI } = jest.requireMock('@google/genai') as {
      GoogleGenAI: jest.Mock;
    };
    GoogleGenAI.mockImplementation(() => ({
      models: { generateContent: (...args: any[]) => mockGenerateContent(...args) },
    }));

    const { createMessageEnvelope } = jest.requireMock('../services/webrtc') as {
      createMessageEnvelope: jest.Mock;
    };
    createMessageEnvelope.mockImplementation(
      (type: string, payload: Record<string, unknown>) => ({
        type,
        id: 'mock-uuid',
        payload,
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('[P0] 2.5-UNIT-001: hook initializes with correct API', () => {
    const { result } = renderHook(() => useConversation());

    expect(typeof result.current.connect).toBe('function');
    expect(typeof result.current.sendTextMessage).toBe('function');
    expect(typeof result.current.transcribeAudio).toBe('function');
    expect(typeof result.current.handleToolResult).toBe('function');
    expect(typeof result.current.close).toBe('function');
  });

  test('[P0] 2.5-UNIT-002: connect initializes AI instance and sets idle state', async () => {
    const { GoogleGenAI } = jest.requireMock('@google/genai') as {
      GoogleGenAI: jest.Mock;
    };

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    expect(useAIStore.getState().aiState).toBe('idle');
  });

  test('[P0] 2.5-UNIT-003: connect does nothing when API key is missing', async () => {
    const { getGeminiApiKey } = jest.requireMock('../services/secureStorage') as {
      getGeminiApiKey: jest.Mock;
    };
    getGeminiApiKey.mockReturnValue(Promise.resolve(null));

    const { GoogleGenAI } = jest.requireMock('@google/genai') as {
      GoogleGenAI: jest.Mock;
    };

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    // AI instance should not be created
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });

  test('[P0] 2.5-UNIT-004: sendTextMessage calls generateContent with text model', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello from Gemini!',
      functionCalls: null,
      candidates: [{ content: { parts: [{ text: 'Hello from Gemini!' }] } }],
    });

    const { result } = renderHook(() => useConversation());
    const mockTextHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnTextResponse(mockTextHandler);
    });

    await act(async () => {
      await result.current.sendTextMessage('Hi there');
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const genArgs = mockGenerateContent.mock.calls[0][0];
    expect(genArgs.model).toBe('gemini-2.5-flash');
    expect(genArgs.config.systemInstruction).toBeDefined();
    expect(genArgs.config.tools).toBeDefined();

    expect(mockTextHandler).toHaveBeenCalledWith('Hello from Gemini!');
    expect(useAIStore.getState().aiState).toBe('idle');
  });

  test('[P0] 2.5-UNIT-005: sendTextMessage with frame includes image in request', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'I see your screen',
      functionCalls: null,
      candidates: [{ content: { parts: [{ text: 'I see your screen' }] } }],
    });

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    await act(async () => {
      await result.current.sendTextMessage('What do you see?', 'base64jpeg');
    });

    const genArgs = mockGenerateContent.mock.calls[0][0];
    const lastContent = genArgs.contents[genArgs.contents.length - 1];
    expect(lastContent.parts).toEqual([
      { inlineData: { data: 'base64jpeg', mimeType: 'image/jpeg' } },
      { text: 'What do you see?' },
    ]);
  });

  test('[P0] 2.5-UNIT-006: tool calls dispatched via data channel', async () => {
    mockGenerateContent.mockResolvedValue({
      text: null,
      functionCalls: [{ name: 'execute_cli', args: { command: 'pwd' }, id: 'text-call-1' }],
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'execute_cli', args: { command: 'pwd' } } }],
        },
      }],
    });

    const { result } = renderHook(() => useConversation());
    const mockSendDC = jest.fn();
    const mockOnToolCall = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setSendDataChannelMessage(mockSendDC);
      result.current.setOnToolCall(mockOnToolCall);
    });

    await act(async () => {
      await result.current.sendTextMessage('Run pwd');
    });

    expect(mockSendDC).toHaveBeenCalledWith('tool_call', {
      name: 'execute_cli',
      args: { command: 'pwd' },
      gemini_call_id: 'text-call-1',
    });
    expect(useAIStore.getState().aiState).toBe('executing');
    expect(mockOnToolCall).toHaveBeenCalledWith('execute_cli', 'text-call-1', { command: 'pwd' });
  });

  test('[P0] 2.5-UNIT-007: tool result continues conversation via generateContent', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: null,
        functionCalls: [{ name: 'execute_cli', args: { command: 'ls' }, id: 'text-call-2' }],
        candidates: [{
          content: {
            parts: [{ functionCall: { name: 'execute_cli', args: { command: 'ls' } } }],
          },
        }],
      })
      .mockResolvedValueOnce({
        text: 'Here are your files: a.txt, b.txt',
        functionCalls: null,
        candidates: [{ content: { parts: [{ text: 'Here are your files: a.txt, b.txt' }] } }],
      });

    const { result } = renderHook(() => useConversation());
    const mockSendDC = jest.fn();
    const mockTextHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setSendDataChannelMessage(mockSendDC);
      result.current.setOnTextResponse(mockTextHandler);
    });

    await act(async () => {
      await result.current.sendTextMessage('List files');
    });

    await act(async () => {
      await result.current.handleToolResult('text-call-2', 'execute_cli', {
        stdout: 'a.txt\nb.txt',
        exit_code: 0,
      });
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockTextHandler).toHaveBeenCalledWith('Here are your files: a.txt, b.txt');
    expect(useAIStore.getState().aiState).toBe('idle');
  });

  test('[P0] 2.5-UNIT-008: transcribeAudio sends WAV to Gemini and returns text', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello world',
    });

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    let transcription = '';
    await act(async () => {
      // Small PCM chunks (base64-encoded silence)
      transcription = await result.current.transcribeAudio(['AAAA', 'AAAA']);
    });

    expect(transcription).toBe('Hello world');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const genArgs = mockGenerateContent.mock.calls[0][0];
    expect(genArgs.model).toBe('gemini-2.5-flash');
    // Should contain audio inline data
    const parts = genArgs.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe('audio/wav');
    expect(parts[1].text).toContain('Transcribe');
  });

  test('[P1] 2.5-UNIT-009: transcribeAudio returns empty string on empty chunks', async () => {
    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    let transcription = '';
    await act(async () => {
      transcription = await result.current.transcribeAudio([]);
    });

    expect(transcription).toBe('');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('[P1] 2.5-UNIT-010: transcribeAudio returns empty string on API failure', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API error'));

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    let transcription = '';
    await act(async () => {
      transcription = await result.current.transcribeAudio(['AAAA']);
    });

    expect(transcription).toBe('');
  });

  test('[P0] 2.5-UNIT-011: close clears state', async () => {
    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    act(() => {
      result.current.close();
    });

    // After close, sendTextMessage should warn (no AI instance)
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    await act(async () => {
      await result.current.sendTextMessage('test');
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('no provider'),
    );
    consoleSpy.mockRestore();
  });

  test('[P1] 2.5-UNIT-012: unknown tool call ID logs warning', async () => {
    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    await act(async () => {
      await result.current.handleToolResult('unknown-id', 'execute_cli', { exit_code: 0 });
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown tool call ID'), 'unknown-id',
    );
    consoleSpy.mockRestore();
  });

  test('[P1] 2.5-UNIT-013: processing timeout resets to idle after 30s', async () => {
    // Make generateContent hang indefinitely (never resolves during this test)
    mockGenerateContent.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    // Start a request (won't resolve — generateContent hangs)
    await act(async () => {
      result.current.sendTextMessage('test');
      // Let the ensureProvider() promise resolve
      await Promise.resolve();
    });

    expect(useAIStore.getState().aiState).toBe('processing');

    // Advance past 30s timeout
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(useAIStore.getState().aiState).toBe('idle');

    // Clean up to prevent leaked timers
    act(() => {
      result.current.close();
    });
  });

  test('[P1] 2.5-UNIT-014: setOnTextResponse(null) clears callback', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'response',
      functionCalls: null,
      candidates: [{ content: { parts: [{ text: 'response' }] } }],
    });

    const { result } = renderHook(() => useConversation());
    const mockTextHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnTextResponse(mockTextHandler);
      result.current.setOnTextResponse(null);
    });

    await act(async () => {
      await result.current.sendTextMessage('test');
    });

    expect(mockTextHandler).not.toHaveBeenCalled();
  });

  test('[P1] 2.5-UNIT-015: sendTextMessage error triggers onError callback', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API error'));

    const { result } = renderHook(() => useConversation());
    const mockErrorHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnError(mockErrorHandler);
    });

    await act(async () => {
      await result.current.sendTextMessage('test');
    });

    expect(mockErrorHandler).toHaveBeenCalledWith(
      expect.stringContaining('failed to send'),
    );
    expect(useAIStore.getState().aiState).toBe('idle');
  });

  test('[P1] 2.5-UNIT-016: concurrent sendTextMessage calls are rejected', async () => {
    // First call hangs forever
    mockGenerateContent.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useConversation());
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    await act(async () => {
      await result.current.connect();
    });

    // Start first message (will hang)
    await act(async () => {
      result.current.sendTextMessage('first');
      await Promise.resolve();
    });

    // Attempt second message while first is in-flight
    await act(async () => {
      result.current.sendTextMessage('second');
      await Promise.resolve();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('already processing'),
    );
    consoleSpy.mockRestore();

    // Clean up
    act(() => {
      result.current.close();
    });
  });

  test('[P1] 2.5-UNIT-017: close clears onTextResponse and sendDCMessage refs', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'response after close',
      functionCalls: null,
      candidates: [{ content: { parts: [{ text: 'response after close' }] } }],
    });

    const { result } = renderHook(() => useConversation());
    const mockTextHandler = jest.fn();
    const mockSendDC = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnTextResponse(mockTextHandler);
      result.current.setSendDataChannelMessage(mockSendDC);
    });

    act(() => {
      result.current.close();
    });

    // Re-connect and send — old callbacks should NOT fire
    await act(async () => {
      await result.current.connect();
    });

    await act(async () => {
      await result.current.sendTextMessage('test');
    });

    expect(mockTextHandler).not.toHaveBeenCalled();
  });

  test('[P0] 2.5-UNIT-019: 429 rate limit retries and succeeds', async () => {
    const rateLimitError = new Error(
      '429 RESOURCE_EXHAUSTED. Please retry in 2s.',
    );
    (rateLimitError as any).status = 429;

    mockGenerateContent
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({
        text: 'Retry success',
        functionCalls: null,
        candidates: [{ content: { parts: [{ text: 'Retry success' }] } }],
      });

    const { result } = renderHook(() => useConversation());
    const mockTextHandler = jest.fn();
    const mockErrorHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnTextResponse(mockTextHandler);
      result.current.setOnError(mockErrorHandler);
    });

    // Start send (will block on sleep after first 429)
    act(() => {
      result.current.sendTextMessage('Hi');
    });

    // Advance past the retry delay and flush microtasks repeatedly
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
    }

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockTextHandler).toHaveBeenCalledWith('Retry success');
    expect(mockErrorHandler).toHaveBeenCalledWith(expect.stringContaining('retrying'));
    expect(useAIStore.getState().aiState).toBe('idle');
  });

  test('[P0] 2.5-UNIT-020: 429 rate limit exhausts retries and shows error', async () => {
    const rateLimitError = new Error(
      '429 RESOURCE_EXHAUSTED: quota exceeded. Please retry in 5s.',
    );
    (rateLimitError as any).status = 429;

    mockGenerateContent.mockRejectedValue(rateLimitError);

    const { result } = renderHook(() => useConversation());
    const mockErrorHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnError(mockErrorHandler);
    });

    // Start send (will block on sleep after first 429)
    act(() => {
      result.current.sendTextMessage('Hi');
    });

    // Run pending timers multiple times to get through both retries
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
    }

    // 1 initial + 2 retries = 3 total
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    // Last error message should be the rate limit exhausted message
    expect(mockErrorHandler).toHaveBeenLastCalledWith(
      expect.stringContaining('Rate limit exceeded'),
    );
    expect(useAIStore.getState().aiState).toBe('idle');
  });

  test('[P1] 2.5-UNIT-021: non-429 errors are not retried', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Internal server error'));

    const { result } = renderHook(() => useConversation());
    const mockErrorHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnError(mockErrorHandler);
    });

    await act(async () => {
      await result.current.sendTextMessage('Hi');
    });

    // Only 1 attempt, no retries
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockErrorHandler).toHaveBeenCalledWith(
      expect.stringContaining('failed to send'),
    );
  });

  test('[P0] 5.7-UNIT-020: sendTextMessage uses persisted model when overridden', async () => {
    const { loadAISettings, getActiveSystemPrompt } = jest.requireMock('../services/aiSettings') as {
      loadAISettings: jest.Mock;
      getActiveSystemPrompt: jest.Mock;
    };
    loadAISettings.mockReturnValue(
      Promise.resolve({
        conversationModel: 'gemini-2.5-pro',
        executionModel: 'gemini-2.5-pro',
        computerUseBackend: 'omniparser',
        customInstructions: null,
        thinkingEnabled: null,
      }),
    );
    getActiveSystemPrompt.mockReturnValue('default-system-instruction');

    mockGenerateContent.mockResolvedValue({
      text: 'Pro model response',
      functionCalls: null,
      candidates: [{ content: { parts: [{ text: 'Pro model response' }] } }],
    });

    const { result } = renderHook(() => useConversation());

    await act(async () => {
      await result.current.connect();
    });

    await act(async () => {
      await result.current.sendTextMessage('Test with pro model');
    });

    const genArgs = mockGenerateContent.mock.calls[0][0];
    expect(genArgs.model).toBe('gemini-2.5-pro');
  });

  test('[P1] 2.5-UNIT-018: transcription failure triggers onError callback', async () => {
    mockGenerateContent.mockRejectedValue(new Error('STT failure'));

    const { result } = renderHook(() => useConversation());
    const mockErrorHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnError(mockErrorHandler);
    });

    let transcription = '';
    await act(async () => {
      transcription = await result.current.transcribeAudio(['AAAA']);
    });

    expect(transcription).toBe('');
    expect(mockErrorHandler).toHaveBeenCalledWith(
      expect.stringContaining('transcription failed'),
    );
  });

  // ─── sendUserIntent tests (Story 3.0) ──────────────────────────────────

  test('[P0] 3.0-UNIT-001: sendUserIntent sends user_intent via data channel when connected (no API key)', async () => {
    // No API key → ensureProvider returns null → direct server route
    const { getGeminiApiKey } = jest.requireMock('../services/secureStorage') as { getGeminiApiKey: jest.Mock };
    getGeminiApiKey.mockReturnValue(Promise.resolve(null));

    const { result } = renderHook(() => useConversation());
    const mockSendDC = jest.fn();

    await act(async () => {
      result.current.setSendDataChannelMessage(mockSendDC);
    });

    useAIStore.getState().setConnectionStatus('connected');

    await act(async () => {
      await result.current.sendUserIntent('open terminal');
    });

    expect(mockSendDC).toHaveBeenCalledWith('user_intent', {
      text: 'open terminal',
      execution_model: 'gemini-2.5-flash',
      computer_use_backend: 'omniparser',
      thinking: true,
    });
    expect(useAIStore.getState().aiState).toBe('processing');
    // Should NOT call generateContent (no API key → no provider)
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  test('[P0] 3.0-UNIT-001b: sendUserIntent includes custom_instructions when set', async () => {
    // Set up mock BEFORE renderHook so useEffect picks it up
    const { loadAISettings } = require('../services/aiSettings');
    loadAISettings.mockResolvedValue({
      conversationModel: 'gemini-2.5-flash',
      executionModel: 'gemini-2.5-flash',
      computerUseBackend: 'omniparser',
      customInstructions: 'Always use PowerShell',
      thinkingEnabled: null,
    });

    const { result, unmount } = renderHook(() => useConversation());
    const mockSendDC = jest.fn();

    await act(async () => {
      result.current.setSendDataChannelMessage(mockSendDC);
    });

    useAIStore.getState().setConnectionStatus('connected');

    await act(async () => {
      await result.current.sendUserIntent('list files');
    });

    expect(mockSendDC).toHaveBeenCalledWith('user_intent', expect.objectContaining({
      text: 'list files',
      custom_instructions: 'Always use PowerShell',
    }));

    unmount();

    // Restore default mock for subsequent tests
    loadAISettings.mockResolvedValue({
      conversationModel: 'gemini-2.5-flash',
      executionModel: 'gemini-2.5-flash',
      computerUseBackend: 'omniparser',
      customInstructions: null,
      thinkingEnabled: null,
    });
  });

  test('[P0] 3.0-UNIT-002: sendUserIntent sends text-only payload (no frame passthrough)', async () => {
    // No API key → ensureProvider returns null → direct server route (no frame)
    const { getGeminiApiKey } = jest.requireMock('../services/secureStorage') as { getGeminiApiKey: jest.Mock };
    getGeminiApiKey.mockReturnValue(Promise.resolve(null));

    const { result } = renderHook(() => useConversation());
    const mockSendDC = jest.fn();

    await act(async () => {
      result.current.setSendDataChannelMessage(mockSendDC);
    });

    useAIStore.getState().setConnectionStatus('connected');

    await act(async () => {
      await result.current.sendUserIntent('what is on screen?');
    });

    // Screen capture is handled server-side via observe_screen tool — no frame_b64 in payload
    expect(mockSendDC).toHaveBeenCalledWith('user_intent', {
      text: 'what is on screen?',
      execution_model: 'gemini-2.5-flash',
      computer_use_backend: 'omniparser',
      thinking: true,
    });
  });

  test('[P0] 3.0-UNIT-003: sendUserIntent falls back to sendTextMessage when disconnected', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Offline response',
      functionCalls: null,
      candidates: [{ content: { parts: [{ text: 'Offline response' }] } }],
    });

    const { result } = renderHook(() => useConversation());
    const mockTextHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnTextResponse(mockTextHandler);
    });

    // connectionStatus defaults to 'disconnected' — no DC message fn set
    expect(useAIStore.getState().connectionStatus).toBe('disconnected');

    await act(async () => {
      await result.current.sendUserIntent('hello');
    });

    // Should fall back to REST API
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockTextHandler).toHaveBeenCalledWith('Offline response');
  });

  test('[P1] 3.0-UNIT-004: sendUserIntent falls back when connected but no DC function', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Fallback response',
      functionCalls: null,
      candidates: [{ content: { parts: [{ text: 'Fallback response' }] } }],
    });

    const { result } = renderHook(() => useConversation());
    const mockTextHandler = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setOnTextResponse(mockTextHandler);
    });

    // Set connected but do NOT set a DC send function
    useAIStore.getState().setConnectionStatus('connected');

    await act(async () => {
      await result.current.sendUserIntent('test');
    });

    // Should fall back to REST API since sendDCMessageRef is null
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockTextHandler).toHaveBeenCalledWith('Fallback response');
  });

  test('[P0] 3.0-UNIT-005: hook exposes sendUserIntent function', () => {
    const { result } = renderHook(() => useConversation());
    expect(typeof result.current.sendUserIntent).toBe('function');
  });

  // ─── Voice override tests (Story 3.5) ──────────────────────────────────

  test('[P0] 3.5-UNIT-008: voice override auto-approves pending confirmation', async () => {
    const mockSendConfirmation = jest.fn();
    useAIStore.getState().setSendConfirmationResponse(mockSendConfirmation);
    useAIStore.getState().setConnectionStatus('connected');

    // Add a pending agent_confirmation entry
    useAIStore.getState().addExecutionEntry({
      id: 'confirm-voice-1',
      type: 'agent_confirmation',
      content: 'Delete cache directory',
      timestamp: Date.now(),
      metadata: {
        request_id: 'voice-req-1',
        tool: 'execute_cli',
        command: 'rm -rf /cache',
        reason: 'forbidden_command',
        status: 'pending',
      },
    });

    const { result } = renderHook(() => useConversation());
    const mockSendDC = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setSendDataChannelMessage(mockSendDC);
    });

    await act(async () => {
      await result.current.sendUserIntent('force run');
    });

    // Should auto-approve instead of sending to Gemini
    expect(mockSendConfirmation).toHaveBeenCalledWith('voice-req-1', true);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(mockSendDC).not.toHaveBeenCalled();

    const updated = useAIStore.getState().executionEntries.find(
      (e) => e.id === 'confirm-voice-1',
    );
    expect(updated?.metadata?.status).toBe('executed');
    expect(useAIStore.getState().aiState).toBe('executing');
  });

  test('[P1] 3.5-UNIT-008b: non-override phrase does not auto-approve', async () => {
    useAIStore.getState().setConnectionStatus('connected');
    useAIStore.getState().addExecutionEntry({
      id: 'confirm-voice-2',
      type: 'agent_confirmation',
      content: 'Delete cache directory',
      timestamp: Date.now(),
      metadata: {
        request_id: 'voice-req-2',
        tool: 'execute_cli',
        command: 'rm -rf /cache',
        reason: 'forbidden_command',
        status: 'pending',
      },
    });

    const { result } = renderHook(() => useConversation());
    const mockSendDC = jest.fn();

    await act(async () => {
      await result.current.connect();
      result.current.setSendDataChannelMessage(mockSendDC);
    });

    await act(async () => {
      await result.current.sendUserIntent('open the browser instead');
    });

    // Should NOT auto-approve — this isn't an override phrase
    // It should be processed normally (either by Gemini or sent to server)
    const entry = useAIStore.getState().executionEntries.find(
      (e) => e.id === 'confirm-voice-2',
    );
    expect(entry?.metadata?.status).toBe('pending');
  });
});
