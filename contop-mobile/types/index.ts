// TypeScript types directory
// Naming convention: PascalCase, strictly NO 'I' prefix

export type AuthMode = 'api_key' | 'cli_proxy';

export type ProviderAuthConfig = {
  mode: AuthMode;
  available: boolean;
};

export type ProviderAuth = Record<string, ProviderAuthConfig>;

export type PairingPayload = {
  token: string;
  dtls_fingerprint: string;
  gemini_api_key?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
  openrouter_api_key?: string;
  stun_config: { ice_servers: Array<{ urls: string }> };
  server_host: string;
  server_port: number;
  signaling_url?: string;
  tailscale_host?: string;
  expires_at: string;
  connection_type?: ConnectionType;
  /** Compact provider auth from QR (pa.g=gemini, pa.a=anthropic, pa.o=openai) */
  pa?: { g?: string; a?: string; o?: string };
};

export type BiometricResult = {
  available: boolean;
  enrolled: boolean;
  biometricTypes: string[];
};

export type AuthState =
  | 'checking'
  | 'authenticating'
  | 'scanning'
  | 'connecting'
  | 'error';

/**
 * Canonical data channel message envelope.
 */
export type DataChannelMessageType =
  | 'user_intent'
  | 'agent_progress'
  | 'agent_result'
  | 'agent_confirmation_request'
  | 'agent_confirmation_response'
  | 'state_update'
  | 'tool_call'
  | 'tool_result'
  | 'session_end'
  | 'keepalive'
  | 'device_control'
  | 'device_control_result'
  | 'manual_control'
  | 'manual_control_result'
  | 'set_manual_mode'
  | 'execution_stop'
  | 'screen_frame'
  | 'frame'
  | 'agent_status'
  | 'agent_thinking'
  | 'agent_text'
  | 'away_mode_engage'
  | 'away_mode_disengage'
  | 'away_mode_status'
  | 'security_alert'
  | 'conversation_request'
  | 'conversation_response'
  | 'conversation_stream_delta'
  | 'conversation_stream_end';

export type DataChannelMessage = {
  type: DataChannelMessageType;
  id: string;
  payload: Record<string, unknown>;
};

export type SignalingMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice_candidate'; candidate: RTCIceCandidateInit };

export type AIState =
  | 'idle'
  | 'listening'   // keep for VoiceVisualizer backward compatibility
  | 'recording'   // Zustand state when mic is actively recording
  | 'processing'
  | 'executing'
  | 'sandboxed'
  | 'manual'
  | 'disconnected';

export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export type ConnectionFlowState = 'splash' | 'connect' | 'reconnecting' | 'session';

export type LayoutMode =
  | 'video-focus'
  | 'split-view'
  | 'thread-focus'
  | 'side-by-side'
  | 'fullscreen-video';

export type Orientation = 'portrait' | 'landscape';

export type LayoutOption = {
  mode: LayoutMode;
  label: string;
  icon: string;
  orientation: Orientation;
};

export const LAYOUT_OPTIONS: LayoutOption[] = [
  { mode: 'video-focus', label: 'Video Focus', icon: 'expand-outline', orientation: 'portrait' },
  { mode: 'split-view', label: 'Split View', icon: 'tablet-landscape-outline', orientation: 'portrait' },
  { mode: 'thread-focus', label: 'Thread Focus', icon: 'chatbubbles-outline', orientation: 'portrait' },
  { mode: 'side-by-side', label: 'Side-by-Side', icon: 'tablet-landscape-outline', orientation: 'landscape' },
  { mode: 'fullscreen-video', label: 'Fullscreen Video', icon: 'expand-outline', orientation: 'landscape' },
];

export type ExecutionEntryType =
  | 'user_message'
  | 'ai_response'
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'intervention'
  | 'agent_progress'
  | 'agent_result'
  | 'agent_status'
  | 'agent_confirmation'
  | 'agent_thinking'
  | 'agent_text';

/** Status values for agent_progress step metadata. */
export type ProgressStepStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Error codes sent by the server when a model API call fails. */
export type ModelErrorCode =
  | 'rate_limit'
  | 'auth_error'
  | 'quota_exceeded'
  | 'model_not_found'
  | 'content_blocked'
  | 'timeout'
  | 'context_length'
  | 'network_error'
  | 'server_error'
  | 'unknown_error';

export type ExecutionEntry = {
  id: string;
  type: ExecutionEntryType;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
};

export type SessionMeta = {
  id: string;
  name?: string;
  startTime: number;
  endTime?: number;
  entryCount: number;
  modelUsed: string;
  connectionType?: 'permanent' | 'temp';
  /** Server-side ADK session ID for restoring execution context after server restart. */
  adkSessionId?: string;
  toolStats?: {
    executed: number;
    blocked: number;
    errors: number;
    byTool?: Record<string, number>;
    byResult?: Record<string, number>;
  };
};

export type ComputerUseBackend =
  | 'omniparser'
  | 'ui_tars'
  | 'gemini_computer_use'
  | 'accessibility'
  | 'kimi_vision'
  | 'qwen_vision'
  | 'phi_vision'
  | 'molmo_vision'
  | 'holotron_vision';

export type STTProvider = 'openai' | 'gemini' | 'openrouter' | 'disabled';

export type AISettings = {
  conversationModel: string;
  executionModel: string;
  computerUseBackend: ComputerUseBackend;
  /** Additional instructions appended to the default system prompt. null = none. */
  customInstructions: string | null;
  /** User's thinking preference: true=on, false=off, null=use model default */
  thinkingEnabled: boolean | null;
  /** Speech-to-text provider selection */
  sttProvider: STTProvider;
};

export type ConnectionPath = 'lan' | 'tailscale' | 'tunnel' | 'unknown';

export type ConnectionType = 'permanent' | 'temp';

export type RemoteAccessMethod = 'tailscale' | 'cloudflare' | 'none';

// ── Manual Control Types ─────────────────────────────────────────────────

export type ManualControlAction = 'click' | 'right_click' | 'scroll' | 'mouse_move' | 'mouse_down' | 'mouse_up' | 'key_combo';

export type ManualControlPayload = {
  action: ManualControlAction;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  keys?: string[];
};

export type SuggestedAction = {
  label: string;
  action: ManualControlAction;
  payload: ManualControlPayload;
  icon?: string;
};
