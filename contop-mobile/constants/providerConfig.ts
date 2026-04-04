// LLM provider configuration constants
// Naming convention: SCREAMING_SNAKE_CASE

import { Type } from '@google/genai';
import type { ComputerUseBackend } from '../types';
import { CONVERSATION_AGENT_PROMPT } from '../prompts/conversation-agent';

/** Standard model for text/voice chat via generateContent. */
export const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';

/**
 * Thinking support per model:
 * - 'always': thinking is always on, cannot be disabled (e.g. gemini-2.5-pro, 3.1-pro)
 * - 'optional': thinking supported, on by default but can be toggled off
 * - 'off-by-default': thinking supported but off unless explicitly enabled (e.g. flash-lite)
 * - 'none': model does not support thinking at all
 */
export type ThinkingSupport = 'always' | 'optional' | 'off-by-default' | 'none';

export type LLMModelConfig = {
  value: string;
  label: string;
  description: string;
  cost: string;
  thinking: ThinkingSupport;
};

export const LLM_MODELS: LLMModelConfig[] = [
  { value: 'gemini-3.1-pro-preview-customtools', label: 'Gemini 3.1 Pro (Tools)', description: 'Best for agents · Preview', cost: '$2.00 in · $12.00 out /1M', thinking: 'always' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Most powerful · Preview', cost: '$2.00 in · $12.00 out /1M', thinking: 'always' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Fast · Preview', cost: '$0.50 in · $3.00 out /1M', thinking: 'optional' },
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', description: 'Fastest · Preview', cost: '$0.25 in · $1.50 out /1M', thinking: 'optional' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Stable · Powerful', cost: '$1.25 in · $10.00 out /1M', thinking: 'always' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Stable · Default', cost: '$0.30 in · $2.50 out /1M', thinking: 'optional' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Stable · Fastest', cost: '$0.10 in · $0.40 out /1M', thinking: 'off-by-default' },
];

export type ComputerUseBackendConfig = {
  value: ComputerUseBackend;
  label: string;
  description: string;
};

export const COMPUTER_USE_BACKENDS: ComputerUseBackendConfig[] = [
  { value: 'omniparser', label: 'OmniParser + PyAutoGUI', description: 'Local element detection · Uses screenshots' },
  { value: 'ui_tars', label: 'UI-TARS 1.5 (7B)', description: 'OpenRouter vision grounding · Uses screenshots' },
  { value: 'gemini_computer_use', label: 'Gemini Computer Use', description: 'Native Gemini vision · Uses screenshots · Preview' },
  { value: 'accessibility', label: 'Accessibility Tree + UI-TARS Fallback', description: 'Text-first · Falls back to screenshots when tree is sparse' },
  { value: 'kimi_vision', label: 'Kimi K2.5', description: 'Moonshot vision grounding via OpenRouter' },
  { value: 'qwen_vision', label: 'Qwen3-VL (8B)', description: 'Qwen vision-language via OpenRouter' },
  { value: 'phi_vision', label: 'Phi-4 / Phi-Ground (14B)', description: 'Microsoft Phi-4 vision via OpenRouter' },
  { value: 'molmo_vision', label: 'Molmo2 (8B)', description: 'Allen AI vision grounding via OpenRouter' },
  { value: 'holotron_vision', label: 'Holotron (12B)', description: 'H Company vision grounding via OpenRouter' },
];

export const COMPUTER_USE_MODELS = [
  'gemini-2.5-computer-use-preview-10-2025',
  'gemini-3-flash-preview',
];

/** Returns the effective thinking enabled state for a model given user preference. */
export function isThinkingEnabled(modelValue: string, userPref: boolean | null): boolean {
  const model = LLM_MODELS.find((m) => m.value === modelValue);
  if (!model || model.thinking === 'none') return false;
  if (model.thinking === 'always') return true;
  if (userPref !== null) return userPref;
  // Default: on for 'optional', off for 'off-by-default'
  return model.thinking === 'optional';
}

/** Returns whether the user can toggle thinking for this model. */
export function canToggleThinking(modelValue: string): boolean {
  const model = LLM_MODELS.find((m) => m.value === modelValue);
  if (!model) return false;
  return model.thinking === 'optional' || model.thinking === 'off-by-default';
}

/** @deprecated Use CONVERSATION_AGENT_PROMPT from prompts/conversation-agent.ts */
export const SYSTEM_INSTRUCTION = CONVERSATION_AGENT_PROMPT;

/** Gemini-format tool declarations using Type enums */
export const GEMINI_TOOL_DECLARATIONS = [
  {
    name: 'execute_cli',
    description:
      'Execute a command-line command on the host machine. Use for terminal operations, file management, and system commands.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'The CLI command to execute',
        },
        working_directory: {
          type: Type.STRING,
          description: 'The working directory for the command (optional)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'execute_gui',
    description:
      'Perform a GUI automation action on the host machine. ALWAYS call observe_screen first to get coordinates. Supported actions: click, double_click, right_click, type, scroll, hotkey, press_key, move_mouse, drag. Coordinates are in screenshot space and auto-scaled to native resolution.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            "The GUI action: 'click', 'double_click', 'right_click', 'type', 'scroll', 'hotkey', 'press_key', 'move_mouse', or 'drag'",
        },
        target: {
          type: Type.STRING,
          description: 'Human description of the UI element to interact with',
        },
        coordinates: {
          type: Type.OBJECT,
          description:
            'Action-specific parameters. Click/double_click/right_click/move_mouse: {x, y} or {element_id}. Type: {x, y, text}. Scroll: {x, y, direction, amount}. Hotkey: {keys: [...]}. Press key: {key: "..."}. Drag: {start_x, start_y, end_x, end_y}. Prefer element_id when ui_elements are available from observe_screen.',
          properties: {
            element_id: { type: Type.NUMBER, description: 'ID of a UI element detected by observe_screen (preferred over x/y)' },
            x: { type: Type.NUMBER, description: 'X coordinate in screenshot space' },
            y: { type: Type.NUMBER, description: 'Y coordinate in screenshot space' },
            text: { type: Type.STRING, description: 'Text to type (for type action)' },
            direction: { type: Type.STRING, description: 'Scroll direction: up, down, left, right' },
            amount: { type: Type.NUMBER, description: 'Scroll amount (default 5)' },
            keys: { type: Type.ARRAY, description: 'Key combination list (for hotkey)', items: { type: Type.STRING } },
            key: { type: Type.STRING, description: 'Single key name (for press_key)' },
            start_x: { type: Type.NUMBER, description: 'Drag start X' },
            start_y: { type: Type.NUMBER, description: 'Drag start Y' },
            end_x: { type: Type.NUMBER, description: 'Drag end X' },
            end_y: { type: Type.NUMBER, description: 'Drag end Y' },
          },
        },
      },
      required: ['action', 'target', 'coordinates'],
    },
  },
  {
    name: 'observe_screen',
    description:
      'Capture the current desktop screen as an image. Use when the user asks what is on their screen, wants you to read something visible, or needs visual context from their computer.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_ui_context',
    description:
      'Get the current UI context including active window, focused element, and list of interactive elements. Use before keyboard-based actions.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },
];

/** @deprecated Use GEMINI_TOOL_DECLARATIONS */
export const TOOL_DECLARATIONS = GEMINI_TOOL_DECLARATIONS;

/** JSON Schema format tool declarations for OpenAI/Anthropic providers */
export const TOOL_DECLARATIONS_JSON_SCHEMA = [
  {
    type: 'function' as const,
    function: {
      name: 'execute_cli',
      description: 'Execute a command-line command on the host machine. Use for terminal operations, file management, and system commands.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The CLI command to execute' },
          working_directory: { type: 'string', description: 'The working directory for the command (optional)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'execute_gui',
      description: 'Perform a GUI automation action on the host machine. ALWAYS call observe_screen first to get coordinates. Supported actions: click, double_click, right_click, type, scroll, hotkey, press_key, move_mouse, drag.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: "The GUI action: 'click', 'double_click', 'right_click', 'type', 'scroll', 'hotkey', 'press_key', 'move_mouse', or 'drag'" },
          target: { type: 'string', description: 'Human description of the UI element to interact with' },
          coordinates: {
            type: 'object',
            description: 'Action-specific parameters. Click: {x, y} or {element_id}. Type: {x, y, text}. Scroll: {x, y, direction, amount}. Hotkey: {keys: [...]}.',
            properties: {
              element_id: { type: 'number', description: 'ID of a UI element detected by observe_screen' },
              x: { type: 'number', description: 'X coordinate in screenshot space' },
              y: { type: 'number', description: 'Y coordinate in screenshot space' },
              text: { type: 'string', description: 'Text to type (for type action)' },
              direction: { type: 'string', description: 'Scroll direction: up, down, left, right' },
              amount: { type: 'number', description: 'Scroll amount (default 5)' },
              keys: { type: 'array', description: 'Key combination list (for hotkey)', items: { type: 'string' } },
              key: { type: 'string', description: 'Single key name (for press_key)' },
              start_x: { type: 'number', description: 'Drag start X' },
              start_y: { type: 'number', description: 'Drag start Y' },
              end_x: { type: 'number', description: 'Drag end X' },
              end_y: { type: 'number', description: 'Drag end Y' },
            },
          },
        },
        required: ['action', 'target', 'coordinates'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'observe_screen',
      description: 'Capture the current desktop screen as an image. Use when the user asks what is on their screen or needs visual context.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ui_context',
      description: 'Get the current UI context including active window, focused element, and list of interactive elements.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
