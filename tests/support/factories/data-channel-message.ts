import { faker } from '@faker-js/faker';

type DataChannelMessageType =
  | 'tool_call'
  | 'tool_result'
  | 'frame'
  | 'state_update'
  | 'keepalive';

type DataChannelMessage = {
  type: DataChannelMessageType;
  id: string;
  payload: Record<string, unknown>;
};

export const createDataChannelMessage = (
  overrides: Partial<DataChannelMessage> = {},
): DataChannelMessage => ({
  type: 'keepalive',
  id: faker.string.uuid(),
  payload: {},
  ...overrides,
});

type ToolCallPayload = {
  tool: string;
  args: Record<string, unknown>;
};

export const createToolCallMessage = (
  overrides: Partial<ToolCallPayload> = {},
): DataChannelMessage =>
  createDataChannelMessage({
    type: 'tool_call',
    payload: {
      tool: overrides.tool ?? 'execute_cli',
      args: overrides.args ?? { command: 'echo hello', timeout_s: 30 },
    },
  });

type ToolResultPayload = {
  status: 'success' | 'error' | 'sandboxed';
  output: string | null;
  voice_message: string;
  retry_suggested: boolean;
};

export const createToolResultMessage = (
  overrides: Partial<ToolResultPayload> = {},
): DataChannelMessage =>
  createDataChannelMessage({
    type: 'tool_result',
    payload: {
      status: overrides.status ?? 'success',
      output: overrides.output ?? 'command output',
      voice_message:
        overrides.voice_message ?? 'The command completed successfully.',
      retry_suggested: overrides.retry_suggested ?? false,
    },
  });

type AIState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'executing'
  | 'sandboxed'
  | 'disconnected';

export const createStateUpdateMessage = (
  aiState: AIState = 'idle',
): DataChannelMessage =>
  createDataChannelMessage({
    type: 'state_update',
    payload: { ai_state: aiState },
  });
