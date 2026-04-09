import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai-react-native';
import { GEMINI_TEXT_MODEL } from '../../constants/providerConfig';
import type { STTProvider as STTProviderType } from '../../types';

export interface STTProvider {
  transcribe(wavBase64: string): Promise<string>;
}

/** Gemini STT - sends audio to generateContent with a transcription prompt */
export class GeminiSTT implements STTProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async transcribe(wavBase64: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: wavBase64, mimeType: 'audio/wav' } },
          { text: 'Transcribe the audio exactly. Output only the transcription text, nothing else.' },
        ],
      }],
    });
    return response.text?.trim() ?? '';
  }
}

/** OpenAI Whisper - dedicated STT endpoint */
export class OpenAISTT implements STTProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(wavBase64: string): Promise<string> {
    // Convert base64 WAV to a Blob (File is unavailable in React Native)
    const binary = atob(wavBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/wav' });
    // Attach name property for the transcription API
    const file = Object.assign(blob, { name: 'audio.wav' });

    const response = await this.client.audio.transcriptions.create({
      file: file as any,
      model: 'whisper-1',
    });

    return response.text?.trim() ?? '';
  }
}

/** OpenRouter STT - routes Whisper through OpenRouter */
export class OpenRouterSTT implements STTProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
  }

  async transcribe(wavBase64: string): Promise<string> {
    const binary = atob(wavBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/wav' });
    const file = Object.assign(blob, { name: 'audio.wav' });

    const response = await this.client.audio.transcriptions.create({
      file: file as any,
      model: 'openai/whisper-1',
    });

    return response.text?.trim() ?? '';
  }
}

export function createSTTProvider(provider: STTProviderType, apiKey: string): STTProvider | null {
  switch (provider) {
    case 'openai': return new OpenAISTT(apiKey);
    case 'gemini': return new GeminiSTT(apiKey);
    case 'openrouter': return new OpenRouterSTT(apiKey);
    case 'disabled': return null;
    default: return null;
  }
}
