import { useState, useEffect, useCallback, useRef } from 'react';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { AudioModule } from 'expo-audio';
import LiveAudioStream from 'react-native-live-audio-stream';

/** Compute normalized [0,1] audio level from base64-encoded 16-bit LE PCM. */
function computeAudioLevel(base64Pcm: string): number {
  const binary = atob(base64Pcm);
  const sampleCount = Math.floor(binary.length / 2);
  if (sampleCount === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < binary.length; i += 2) {
    const raw = binary.charCodeAt(i) | (binary.charCodeAt(i + 1) << 8);
    const sample = raw > 32767 ? raw - 65536 : raw;
    sumSquares += (sample / 32768) ** 2;
  }

  const rms = Math.sqrt(sumSquares / sampleCount);
  if (rms < 0.0001) return 0;
  // Convert to dB, normalize: -60dB floor → 0, 0dB → 1
  const dB = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (dB + 60) / 60));
}

export function useVoiceCapture() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const audioLevel = useSharedValue(0);
  const isCapturingRef = useRef(false);
  const onAudioDataRef = useRef<((base64Pcm: string) => void) | null>(null);
  const audioChunksRef = useRef<string[]>([]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const result = await AudioModule.requestRecordingPermissionsAsync();
      setHasPermission(result.granted);
      return result.granted;
    } catch (err) {
      console.warn('[useVoiceCapture] Permission request failed:', err);
      setHasPermission(false);
      return false;
    }
  }, []);

  const startCapture = useCallback(async (): Promise<void> => {
    if (isCapturingRef.current) return;

    try {
      let permitted = hasPermission;
      if (permitted !== true) {
        permitted = await requestPermission();
      }
      if (!permitted) return;

      LiveAudioStream.init({
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6, // VOICE_RECOGNITION (Android); iOS ignores this
        wavFile: '', // Not recording to file - streaming only
      });

      audioChunksRef.current = [];

      LiveAudioStream.on('data', (base64Pcm: string) => {
        // Accumulate for later transcription
        audioChunksRef.current.push(base64Pcm);
        // Forward raw PCM to consumer if set
        onAudioDataRef.current?.(base64Pcm);
        // Compute metering for VoiceVisualizer
        const level = computeAudioLevel(base64Pcm);
        audioLevel.value = withTiming(level, { duration: 80 });
      });

      LiveAudioStream.start();
      isCapturingRef.current = true;
      setIsCapturing(true);
    } catch (err) {
      console.warn('[useVoiceCapture] Failed to start capture:', err);
      isCapturingRef.current = false;
      setIsCapturing(false);
    }
  }, [hasPermission, requestPermission, audioLevel]);

  const stopCapture = useCallback(async (): Promise<void> => {
    if (!isCapturingRef.current) return;

    try {
      LiveAudioStream.stop();
    } catch (err) {
      console.warn('[useVoiceCapture] Stop capture error:', err);
    } finally {
      isCapturingRef.current = false;
      setIsCapturing(false);
      audioLevel.value = withTiming(0, { duration: 80 });
    }
  }, [audioLevel]);

  /** Return accumulated PCM chunks and clear the buffer. */
  const getAudioBuffer = useCallback((): string[] => {
    const chunks = audioChunksRef.current;
    audioChunksRef.current = [];
    return chunks;
  }, []);

  /** Set callback to receive raw PCM audio chunks (base64). */
  const setOnAudioData = useCallback(
    (handler: ((base64Pcm: string) => void) | null) => {
      onAudioDataRef.current = handler;
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isCapturingRef.current) {
        try { LiveAudioStream.stop(); } catch { /* already stopped */ }
        isCapturingRef.current = false;
      }
    };
  }, []);

  return {
    audioLevel,
    isCapturing,
    hasPermission,
    startCapture,
    stopCapture,
    getAudioBuffer,
    requestPermission,
    setOnAudioData,
  };
}
