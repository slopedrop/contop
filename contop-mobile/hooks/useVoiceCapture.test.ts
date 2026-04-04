import { renderHook, act } from '@testing-library/react-native';
import { useVoiceCapture } from './useVoiceCapture';

// Access mocks
const expoAudioMock = jest.requireMock('expo-audio') as {
  AudioModule: {
    requestRecordingPermissionsAsync: jest.Mock;
  };
};

const LiveAudioStreamMock = jest.requireMock('react-native-live-audio-stream') as {
  default: {
    init: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
    on: jest.Mock;
  };
};

describe('useVoiceCapture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    expoAudioMock.AudioModule.requestRecordingPermissionsAsync.mockResolvedValue({ granted: true });
  });

  test('7.1: requestPermission() calls AudioModule.requestRecordingPermissionsAsync()', async () => {
    const { result } = renderHook(() => useVoiceCapture());

    await act(async () => {
      await result.current.requestPermission();
    });

    expect(expoAudioMock.AudioModule.requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('7.2: startCapture() initializes and starts LiveAudioStream when permission granted', async () => {
    const { result } = renderHook(() => useVoiceCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    expect(expoAudioMock.AudioModule.requestRecordingPermissionsAsync).toHaveBeenCalled();
    expect(LiveAudioStreamMock.default.init).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
      }),
    );
    expect(LiveAudioStreamMock.default.start).toHaveBeenCalled();
    expect(result.current.isCapturing).toBe(true);
  });

  test('7.3: startCapture() does NOT start recording when permission denied', async () => {
    expoAudioMock.AudioModule.requestRecordingPermissionsAsync.mockResolvedValue({ granted: false });

    const { result } = renderHook(() => useVoiceCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    expect(LiveAudioStreamMock.default.start).not.toHaveBeenCalled();
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.hasPermission).toBe(false);
  });

  test('7.4: stopCapture() stops LiveAudioStream', async () => {
    const { result } = renderHook(() => useVoiceCapture());

    await act(async () => {
      await result.current.startCapture();
    });
    expect(result.current.isCapturing).toBe(true);

    await act(async () => {
      await result.current.stopCapture();
    });

    expect(LiveAudioStreamMock.default.stop).toHaveBeenCalled();
    expect(result.current.isCapturing).toBe(false);
  });

  test('7.5: cleanup on unmount stops active stream', async () => {
    const { result, unmount } = renderHook(() => useVoiceCapture());

    await act(async () => {
      await result.current.startCapture();
    });
    expect(result.current.isCapturing).toBe(true);

    unmount();

    expect(LiveAudioStreamMock.default.stop).toHaveBeenCalled();
  });

  test('7.6: double startCapture() calls are guarded (no double-start)', async () => {
    const { result } = renderHook(() => useVoiceCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    await act(async () => {
      await result.current.startCapture();
    });

    // init + start should only be called once
    expect(LiveAudioStreamMock.default.init).toHaveBeenCalledTimes(1);
    expect(LiveAudioStreamMock.default.start).toHaveBeenCalledTimes(1);
  });

  test('7.7: onAudioData callback receives PCM chunks from LiveAudioStream', async () => {
    const { result } = renderHook(() => useVoiceCapture());
    const mockCallback = jest.fn();

    act(() => {
      result.current.setOnAudioData(mockCallback);
    });

    await act(async () => {
      await result.current.startCapture();
    });

    // Simulate LiveAudioStream emitting a data chunk
    const onDataHandler = LiveAudioStreamMock.default.on.mock.calls.find(
      (call: any[]) => call[0] === 'data',
    )?.[1];
    expect(onDataHandler).toBeDefined();

    // Call the handler with mock base64 PCM data
    act(() => {
      onDataHandler('AAAAAAAAAA==');
    });

    expect(mockCallback).toHaveBeenCalledWith('AAAAAAAAAA==');
  });

  test('7.8a: getAudioBuffer returns accumulated chunks and clears buffer', async () => {
    const { result } = renderHook(() => useVoiceCapture());

    await act(async () => {
      await result.current.startCapture();
    });

    // Simulate LiveAudioStream emitting data chunks
    const onDataHandler = LiveAudioStreamMock.default.on.mock.calls.find(
      (call: any[]) => call[0] === 'data',
    )?.[1];
    expect(onDataHandler).toBeDefined();

    act(() => {
      onDataHandler('AAAA');
      onDataHandler('BBBB');
      onDataHandler('CCCC');
    });

    // getAudioBuffer returns all accumulated chunks
    let chunks: string[] = [];
    act(() => {
      chunks = result.current.getAudioBuffer();
    });
    expect(chunks).toEqual(['AAAA', 'BBBB', 'CCCC']);

    // Second call returns empty (buffer was cleared)
    act(() => {
      chunks = result.current.getAudioBuffer();
    });
    expect(chunks).toEqual([]);
  });

  test('7.8b: startCapture clears previous audio buffer', async () => {
    const { result } = renderHook(() => useVoiceCapture());

    // First recording session
    await act(async () => {
      await result.current.startCapture();
    });

    const onDataHandler1 = LiveAudioStreamMock.default.on.mock.calls.find(
      (call: any[]) => call[0] === 'data',
    )?.[1];
    act(() => {
      onDataHandler1('AAAAAAAAAA==');
    });

    await act(async () => {
      await result.current.stopCapture();
    });

    // Start new recording — buffer should be cleared
    await act(async () => {
      await result.current.startCapture();
    });

    let chunks: string[] = [];
    act(() => {
      chunks = result.current.getAudioBuffer();
    });
    expect(chunks).toEqual([]);
  });

  test('7.9: setOnAudioData(null) clears the callback', async () => {
    const { result } = renderHook(() => useVoiceCapture());
    const mockCallback = jest.fn();

    act(() => {
      result.current.setOnAudioData(mockCallback);
    });

    await act(async () => {
      await result.current.startCapture();
    });

    // Clear callback
    act(() => {
      result.current.setOnAudioData(null);
    });

    // Simulate data — callback should NOT be called
    const onDataHandler = LiveAudioStreamMock.default.on.mock.calls.find(
      (call: any[]) => call[0] === 'data',
    )?.[1];

    act(() => {
      onDataHandler('AAAAAAAAAA==');
    });

    expect(mockCallback).not.toHaveBeenCalled();
  });
});
