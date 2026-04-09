import React, { useState, useEffect, useCallback } from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  cancelAnimation,
} from 'react-native-reanimated';
import Text from './Text';
import MarkdownContent from './MarkdownContent';
import CopyButton from './CopyButton';
import TextShimmer from './TextShimmer';
import useAIStore from '../stores/useAIStore';
import type { ExecutionEntry, ModelErrorCode } from '../types';

type Props = {
  entry: ExecutionEntry;
  isLastThinking: boolean;
};

function UserMessageCard({ entry }: { entry: ExecutionEntry }) {
  const timeStr = formatTime(entry.timestamp);
  return (
    <View
      testID="entry-user-message"
      style={s.entryWrapper}
      accessibilityRole="text"
      accessibilityLabel={`User message: ${entry.content.slice(0, 60)}`}
    >
      <View style={s.labelRow}>
        <Text style={s.label}>You</Text>
        <View style={s.labelRowRight}>
          <CopyButton content={entry.content} size={12} color="#4B5563" />
          <Text style={s.timestamp}>{timeStr}</Text>
        </View>
      </View>
      <View style={s.userBubble}>
        <Text style={s.userText}>{entry.content}</Text>
      </View>
    </View>
  );
}

function AIResponseCard({ entry }: { entry: ExecutionEntry }) {
  return (
    <View
      testID="entry-ai-response"
      style={s.aiWrapper}
      accessibilityRole="text"
      accessibilityLabel={`AI response: ${entry.content.slice(0, 60)}`}
    >
      <View style={s.labelRowSpaced}>
        <Text testID="contop-label" style={s.aiLabel}>CONTOP</Text>
        <CopyButton content={entry.content} size={14} />
      </View>
      <MarkdownContent>{entry.content}</MarkdownContent>
    </View>
  );
}

function ToolCallCard({ entry }: { entry: ExecutionEntry }) {
  const status = (entry.metadata?.status as string) ?? 'pending';
  return (
    <View
      style={s.aiWrapper}
      accessibilityRole="text"
      accessibilityLabel={`Tool call: ${entry.content.slice(0, 60)}`}
    >
      <Text style={s.aiLabel}>CONTOP</Text>
      <View testID="entry-tool-call" style={s.toolCardInner}>
        <View style={s.toolRow}>
          <View style={s.toolContent}>
            <Ionicons name="terminal-outline" size={14} color="#6B7280" />
            {status === 'pending'
              ? <TextShimmer style={s.toolText} numberOfLines={2} testID="tool-status-pending">{entry.content}</TextShimmer>
              : <Text style={s.toolText} numberOfLines={2}>{entry.content}</Text>
            }
          </View>
          <View>
            {status === 'success' && (
              <Ionicons testID="tool-status-success" name="checkmark-circle" size={16} color="#22C55E" />
            )}
            {status === 'error' && (
              <Ionicons testID="tool-status-error" name="close-circle" size={16} color="#EF4444" />
            )}
            {status === 'sandboxed' && (
              <Ionicons testID="tool-status-sandboxed" name="warning" size={16} color="#F59E0B" />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function ToolResultCard({ entry }: { entry: ExecutionEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isTruncated = entry.content.length > 200;
  const displayContent = isTruncated && !isExpanded
    ? entry.content.slice(0, 200) + '...'
    : entry.content;

  return (
    <View
      testID="entry-tool-result"
      style={s.toolResultCard}
      accessibilityRole="text"
      accessibilityLabel={`Tool result: ${entry.content.slice(0, 60)}`}
    >
      <View style={s.toolResultHeader}>
        <View style={{ flex: 1 }} />
        <CopyButton content={entry.content} size={12} />
      </View>
      <Text style={s.toolResultText}>{displayContent}</Text>
      {isTruncated && (
        <Pressable testID="show-more-button" onPress={() => setIsExpanded(!isExpanded)}>
          <View style={s.showMoreRow}>
            <Text style={s.showMoreText}>
              {isExpanded ? 'Show less' : 'Show more'}
            </Text>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={12}
              color="#095BB9"
            />
          </View>
        </Pressable>
      )}
    </View>
  );
}

function ThinkingCard({ isLastThinking }: { isLastThinking: boolean }) {
  const dot1Opacity = useSharedValue(0.3);
  const dot2Opacity = useSharedValue(0.3);
  const dot3Opacity = useSharedValue(0.3);

  useEffect(() => {
    if (isLastThinking) {
      dot1Opacity.value = withRepeat(withTiming(1, { duration: 500 }), -1, true);
      dot2Opacity.value = withDelay(150, withRepeat(withTiming(1, { duration: 500 }), -1, true));
      dot3Opacity.value = withDelay(300, withRepeat(withTiming(1, { duration: 500 }), -1, true));
    } else {
      cancelAnimation(dot1Opacity);
      cancelAnimation(dot2Opacity);
      cancelAnimation(dot3Opacity);
      dot1Opacity.value = 0.3;
      dot2Opacity.value = 0.3;
      dot3Opacity.value = 0.3;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLastThinking]);

  const dot1Style = useAnimatedStyle(() => ({ opacity: dot1Opacity.value }));
  const dot2Style = useAnimatedStyle(() => ({ opacity: dot2Opacity.value }));
  const dot3Style = useAnimatedStyle(() => ({ opacity: dot3Opacity.value }));

  if (!isLastThinking) {
    return (
      <View
        testID="entry-thinking-static"
        style={s.thinkingStatic}
        accessibilityRole="text"
        accessibilityLabel="Thought"
      >
        <Text style={s.thoughtText}>Thought</Text>
      </View>
    );
  }

  return (
    <View
      testID="entry-thinking-animated"
      style={s.thinkingAnimated}
      accessibilityRole="text"
      accessibilityLabel="Thinking"
    >
      <View style={s.dotsContainer}>
        <Animated.View testID="thinking-dot-1" style={[s.dot, dot1Style]} />
        <Animated.View testID="thinking-dot-2" style={[s.dot, dot2Style]} />
        <Animated.View testID="thinking-dot-3" style={[s.dot, dot3Style]} />
      </View>
      <Text testID="thinking-label" style={s.thinkingLabel}>Thinking...</Text>
    </View>
  );
}

function AgentThinkingCard({ entry, isLastThinking }: { entry: ExecutionEntry; isLastThinking: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isTruncated = entry.content.length > 200;
  const displayContent = isTruncated && !isExpanded
    ? entry.content.slice(0, 200) + '...'
    : entry.content;

  // While still thinking (last entry + active state), show animated dots
  if (isLastThinking && !entry.content) {
    return <ThinkingCard isLastThinking />;
  }

  return (
    <View
      testID="entry-agent-thinking"
      style={s.agentThinkingCard}
      accessibilityRole="text"
      accessibilityLabel={`Thinking: ${entry.content.slice(0, 60)}`}
    >
      <Pressable onPress={() => setIsExpanded(!isExpanded)}>
        <View style={s.thinkingHeader}>
          <View style={s.thinkingHeaderLeft}>
            <Ionicons name="bulb-outline" size={12} color="#6B7280" />
            <Text style={s.thinkingHeaderText}>Thinking</Text>
          </View>
          <View style={s.thinkingHeaderRight}>
            {isExpanded && <CopyButton content={entry.content} size={12} />}
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#6B7280"
            />
          </View>
        </View>
      </Pressable>
      {isExpanded && (
        <Text style={s.agentThinkingText}>{displayContent}</Text>
      )}
    </View>
  );
}

function AgentTextCard({ entry }: { entry: ExecutionEntry }) {
  return (
    <View
      testID="entry-agent-text"
      style={s.aiWrapper}
      accessibilityRole="text"
      accessibilityLabel={`Agent: ${entry.content.slice(0, 60)}`}
    >
      <View style={s.labelRowSpaced}>
        <View />
        <CopyButton content={entry.content} size={14} />
      </View>
      <MarkdownContent fontSize={14} color="#9CA3AF">{entry.content}</MarkdownContent>
    </View>
  );
}

function InterventionCard({ entry }: { entry: ExecutionEntry }) {
  const [isCommandExpanded, setIsCommandExpanded] = useState(false);
  const status = (entry.metadata?.status as string) ?? 'pending';
  const command = (entry.metadata?.command as string) ?? '';
  const reason = (entry.metadata?.reason as string) ?? '';
  const requestId = entry.metadata?.request_id as string | undefined;
  const isPending = status === 'pending';
  const isExecuted = status === 'executed';
  const isAborted = status === 'aborted';
  const isExpired = status === 'expired';
  const isDestructive = reason === 'destructive_command';

  const formattedCommand = command ? formatCommand(command) : '';
  const isCommandTruncated = formattedCommand.length > 200;
  const displayCommand = isCommandTruncated && !isCommandExpanded
    ? formattedCommand.slice(0, 200) + '...'
    : formattedCommand;

  // Haptic feedback on mount for pending cards
  // Destructive = Warning (lighter), Sandbox = Error (heavier)
  useEffect(() => {
    if (status !== 'pending') return;
    Haptics.notificationAsync(
      isDestructive
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Error,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = useCallback(() => {
    if (!isPending || !requestId) return;
    const store = useAIStore.getState();
    if (!store.sendConfirmationResponse) return;
    store.sendConfirmationResponse(requestId, true);
    store.updateExecutionEntry(entry.id, { metadata: { status: 'executed' } });
    store.setAIState('executing');
  }, [isPending, requestId, entry.id]);

  const handleReject = useCallback(() => {
    if (!isPending || !requestId) return;
    const store = useAIStore.getState();
    if (!store.sendConfirmationResponse) return;
    store.sendConfirmationResponse(requestId, false);
    store.updateExecutionEntry(entry.id, { metadata: { status: 'aborted' } });
    store.setAIState('processing');
  }, [isPending, requestId, entry.id]);

  const borderColor = isExecuted ? '#22C55E' : (isExpired || isAborted) ? '#6B7280' : '#F59E0B';
  const cardOpacity = (isAborted || isExpired) ? 0.5 : 1;

  // Header text varies by state and type (destructive vs sandbox)
  const pendingHeader = isDestructive
    ? 'WARNING - Destructive Command'
    : 'INTERVENTION - Sandbox Caught';
  const headerText = isExecuted
    ? (isDestructive ? 'EXECUTED - On host' : 'EXECUTED - Forced to host')
    : isAborted
      ? 'ABORTED'
      : isExpired
        ? 'EXPIRED - Connection lost'
        : pendingHeader;

  // Button labels vary by type
  const approveLabel = isDestructive ? 'RUN' : 'EXECUTE ANYWAY';
  const rejectLabel = isDestructive ? 'CANCEL' : 'ABORT ACTION';

  const accessLabel = isDestructive
    ? `Warning. Destructive command. ${command}. Run or Cancel.`
    : `Intervention. Sandbox caught dangerous command. ${command}. Execute Anyway or Abort Action.`;

  return (
    <View
      testID="intervention-card"
      style={[s.interventionCardFull, { borderTopColor: borderColor, opacity: cardOpacity }]}
      accessibilityRole="alert"
      accessibilityLabel={accessLabel}
      accessibilityLiveRegion="assertive"
    >
      {/* Header */}
      <View style={s.interventionHeaderRow}>
        {isExecuted ? (
          <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
        ) : isAborted ? (
          <Ionicons name="close-circle" size={16} color="#6B7280" />
        ) : isExpired ? (
          <Ionicons name="cloud-offline" size={16} color="#6B7280" />
        ) : (
          <Ionicons name="warning" size={16} color="#F59E0B" />
        )}
        <Text style={[s.interventionHeaderText, isExecuted && { color: '#22C55E' }, (isAborted || isExpired) && { color: '#6B7280' }]}>
          {headerText}
        </Text>
      </View>

      {/* User intent */}
      {entry.content ? (
        <View style={s.interventionSection}>
          <Text style={s.interventionSectionLabel}>Your request:</Text>
          <Text style={s.interventionQuote}>{entry.content}</Text>
        </View>
      ) : null}

      {/* Command */}
      {command ? (
        <View style={s.interventionSection}>
          <View style={s.labelRowSpaced}>
            <Text style={s.interventionSectionLabel}>Actual command:</Text>
            <CopyButton content={command} size={12} />
          </View>
          <View style={s.interventionCodeBlock}>
            <Text style={s.interventionCodeText}>{displayCommand}</Text>
          </View>
          {isCommandTruncated && (
            <Pressable
              testID="intervention-show-more"
              onPress={() => setIsCommandExpanded(!isCommandExpanded)}
              accessibilityRole="button"
              accessibilityLabel={isCommandExpanded ? 'Show less of command' : 'Show full command'}
            >
              <View style={s.showMoreRow}>
                <Text style={s.showMoreText}>
                  {isCommandExpanded ? 'Show less' : 'Show more'}
                </Text>
                <Ionicons
                  name={isCommandExpanded ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color="#095BB9"
                />
              </View>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* Reason */}
      {reason ? (
        <View style={s.interventionReasonRow}>
          <Ionicons name="warning" size={12} color="#F59E0B" />
          <Text style={s.interventionReasonText}>
            {isDestructive ? `Flagged as destructive command` : `Blocked because: ${reason}`}
          </Text>
        </View>
      ) : null}

      {/* Action buttons */}
      {isPending && (
        <View style={s.interventionButtonRow}>
          <Pressable
            testID="intervention-execute-btn"
            onPress={handleApprove}
            style={({ pressed }) => [s.interventionGhostBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={approveLabel}
          >
            <Text style={s.interventionGhostBtnText}>{approveLabel}</Text>
          </Pressable>
          <Pressable
            testID="intervention-abort-btn"
            onPress={handleReject}
            style={({ pressed }) => [s.interventionAccentBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={rejectLabel}
          >
            <Text style={s.interventionAccentBtnText}>{rejectLabel}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AgentStatusCard({ entry }: { entry: ExecutionEntry }) {
  return (
    <View
      testID="entry-agent-status"
      style={s.aiWrapper}
      accessibilityRole="text"
      accessibilityLabel={entry.content}
    >
      <View style={s.toolCardInner}>
        <View style={s.toolRow}>
          <View style={s.toolContent}>
            <TextShimmer style={[s.toolText, { color: '#F59E0B' }]} highlightColor="#FCD34D" numberOfLines={2}>
              {entry.content}
            </TextShimmer>
          </View>
        </View>
      </View>
    </View>
  );
}

const EXECUTION_RESULT_COLORS: Record<string, string> = {
  success: '#22C55E',
  error: '#EF4444',
  sandboxed: '#F59E0B',
  user_cancelled: '#6B7280',
  force_host: '#3B82F6',
};

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function AgentProgressCard({ entry }: { entry: ExecutionEntry }) {
  const step = entry.metadata?.step as number | undefined;
  const tool = (entry.metadata?.tool as string) ?? '';
  const status = (entry.metadata?.status as string) ?? 'running';
  const durationMs = entry.metadata?.duration_ms as number | undefined;
  const classifiedCommand = entry.metadata?.classified_command as string | undefined;
  const executionResult = entry.metadata?.execution_result as string | undefined;
  const model = entry.metadata?.model as string | undefined;
  const backend = entry.metadata?.backend as string | undefined;
  const showAuditRow = (status === 'completed' || status === 'failed') && (durationMs != null || classifiedCommand || executionResult);

  return (
    <View
      testID="entry-agent-progress"
      style={s.aiWrapper}
      accessibilityRole="text"
      accessibilityLabel={`Agent step ${step}: ${entry.content.slice(0, 60)}`}
    >
      <View style={s.toolCardInner}>
        <View style={s.toolRow}>
          <View style={s.toolContent}>
            <Ionicons
              name={tool === 'observe_screen' ? 'eye-outline' : tool === 'get_ui_context' ? 'list-outline' : 'terminal-outline'}
              size={14}
              color="#6B7280"
            />
            {status === 'running'
              ? <TextShimmer style={s.toolText} numberOfLines={2} testID="progress-status-running">
                {`${step ? `[${step}] ` : ''}${tool === 'observe_screen' ? 'Screenshot' : tool === 'get_ui_context' ? 'Accessibility tree' : entry.content}`}
              </TextShimmer>
              : <Text style={s.toolText} numberOfLines={2}>
                {step ? `[${step}] ` : ''}
                {tool === 'observe_screen' ? 'Screenshot' : tool === 'get_ui_context' ? 'Accessibility tree' : entry.content}
              </Text>
            }
          </View>
          <View>
            {status === 'completed' && (
              <Ionicons testID="progress-status-completed" name="checkmark-circle" size={16} color="#22C55E" />
            )}
            {status === 'failed' && (
              <Ionicons testID="progress-status-failed" name="close-circle" size={16} color="#EF4444" />
            )}
          </View>
        </View>
        {/* Model/backend inline - always visible when present */}
        {(model || backend) && (
          <View style={s.toolModelRow}>
            {model && <Text style={s.toolModelText}>{model}</Text>}
            {backend && <Text style={s.toolBackendText}>{backend}</Text>}
          </View>
        )}
        {showAuditRow && (
          <View testID="audit-info-row" style={s.auditInfoRow}>
            {durationMs != null && (
              <Text testID="audit-duration" style={s.auditInfoText}>{formatDuration(durationMs)}</Text>
            )}
            {classifiedCommand ? (
              <Text testID="audit-classified-command" style={s.auditCommandText} numberOfLines={1}>
                {classifiedCommand.length > 80 ? classifiedCommand.slice(0, 80) + '…' : classifiedCommand}
              </Text>
            ) : null}
            {executionResult ? (
              <View
                testID="audit-execution-result"
                style={[s.auditBadge, { backgroundColor: (EXECUTION_RESULT_COLORS[executionResult] ?? '#6B7280') + '33' }]}
              >
                <Text style={[s.auditBadgeText, { color: EXECUTION_RESULT_COLORS[executionResult] ?? '#6B7280' }]}>
                  {executionResult}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

/** Map error codes to icons for visual distinction. */
const ERROR_ICON_MAP: Record<ModelErrorCode, keyof typeof Ionicons.glyphMap> = {
  rate_limit: 'time-outline',
  auth_error: 'key-outline',
  quota_exceeded: 'card-outline',
  model_not_found: 'search-outline',
  content_blocked: 'shield-outline',
  timeout: 'hourglass-outline',
  context_length: 'document-text-outline',
  network_error: 'cloud-offline-outline',
  server_error: 'server-outline',
  unknown_error: 'alert-circle-outline',
};

function AgentResultCard({ entry }: { entry: ExecutionEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const errorCode = entry.metadata?.error_code as ModelErrorCode | undefined;
  const isError = !!errorCode;
  const model = entry.metadata?.model as string | undefined;
  const backend = entry.metadata?.backend as string | undefined;
  const durationMs = entry.metadata?.duration_ms as number | undefined;
  const stepsTaken = entry.metadata?.steps_taken as number | undefined;
  const isTruncated = entry.content.length > 300;
  const displayContent = isTruncated && !isExpanded
    ? entry.content.slice(0, 300) + '...'
    : entry.content;

  // Summary row: steps + duration (model/backend shown per-step in progress cards)
  const summaryRow = (stepsTaken != null || durationMs != null) ? (
    <View style={s.modelInfoRow}>
      {stepsTaken != null && (
        <Text style={s.auditInfoText}>{stepsTaken} steps</Text>
      )}
      {durationMs != null && (
        <Text style={s.auditInfoText}>{formatDuration(durationMs)}</Text>
      )}
    </View>
  ) : null;

  if (isError) {
    const iconName = ERROR_ICON_MAP[errorCode] ?? 'alert-circle-outline';
    return (
      <View
        testID="entry-agent-error"
        style={s.aiWrapper}
        accessibilityRole="text"
        accessibilityLabel={`Error: ${entry.content.slice(0, 60)}`}
      >
        <View style={s.errorCard}>
          <View style={s.errorHeader}>
            <Ionicons name={iconName} size={16} color="#F87171" />
            <Text style={s.errorLabel}>ERROR</Text>
          </View>
          <Text style={s.errorText}>{entry.content}</Text>
          {/* Show failed model in error cards - this is the only place it's visible */}
          {model && (
            <View style={s.modelInfoRow}>
              <Text style={s.toolModelText}>{model}</Text>
              {stepsTaken != null && <Text style={s.auditInfoText}>{stepsTaken} steps</Text>}
              {durationMs != null && <Text style={s.auditInfoText}>{formatDuration(durationMs)}</Text>}
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <View
      testID="entry-agent-result"
      style={s.aiWrapper}
      accessibilityRole="text"
      accessibilityLabel={`Agent result: ${entry.content.slice(0, 60)}`}
    >
      <View style={s.labelRowSpaced}>
        <Text style={s.aiLabel}>CONTOP</Text>
        <CopyButton content={entry.content} size={14} />
      </View>
      <MarkdownContent>{displayContent}</MarkdownContent>
      {summaryRow}
      {isTruncated && (
        <Pressable testID="agent-result-show-more" onPress={() => setIsExpanded(!isExpanded)}>
          <View style={s.showMoreRow}>
            <Text style={s.showMoreText}>
              {isExpanded ? 'Show less' : 'Show more'}
            </Text>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={12}
              color="#095BB9"
            />
          </View>
        </Pressable>
      )}
    </View>
  );
}

type PlanStep = { description: string; tool: string };

function PlanApprovalCard({ entry }: { entry: ExecutionEntry }) {
  const status = (entry.metadata?.status as string) ?? 'pending';
  const requestId = entry.metadata?.request_id as string | undefined;
  const planSteps = (entry.metadata?.plan_steps as PlanStep[]) ?? [];
  const isPending = status === 'pending';
  const isExecuted = status === 'executed';
  const isAborted = status === 'aborted';
  const isExpired = status === 'expired';

  useEffect(() => {
    if (status !== 'pending') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = useCallback(() => {
    if (!isPending || !requestId) return;
    const store = useAIStore.getState();
    if (!store.sendConfirmationResponse) return;
    store.sendConfirmationResponse(requestId, true);
    store.updateExecutionEntry(entry.id, { metadata: { status: 'executed' } });
    store.setAIState('executing');
  }, [isPending, requestId, entry.id]);

  const handleReject = useCallback(() => {
    if (!isPending || !requestId) return;
    const store = useAIStore.getState();
    if (!store.sendConfirmationResponse) return;
    store.sendConfirmationResponse(requestId, false);
    store.updateExecutionEntry(entry.id, { metadata: { status: 'aborted' } });
    store.setAIState('processing');
  }, [isPending, requestId, entry.id]);

  const accentColor = isExecuted ? '#22C55E' : (isExpired || isAborted) ? '#6B7280' : '#60A5FA';
  const cardOpacity = (isAborted || isExpired) ? 0.5 : 1;

  const headerText = isExecuted
    ? 'PLAN APPROVED'
    : isAborted
      ? 'PLAN REJECTED'
      : isExpired
        ? 'PLAN EXPIRED'
        : 'EXECUTION PLAN';

  const headerIcon = isExecuted
    ? 'checkmark-circle' as const
    : isAborted
      ? 'close-circle' as const
      : isExpired
        ? 'cloud-offline' as const
        : 'map-outline' as const;

  return (
    <View
      testID="plan-approval-card"
      style={[planStyles.card, { borderTopColor: accentColor, opacity: cardOpacity }]}
      accessibilityRole="alert"
      accessibilityLabel={`Execution plan with ${planSteps.length} steps. ${headerText}.`}
    >
      {/* Header */}
      <View style={planStyles.headerRow}>
        <Ionicons name={headerIcon} size={16} color={accentColor} />
        <Text style={[planStyles.headerText, { color: accentColor }]}>
          {headerText}
        </Text>
        <Text style={planStyles.stepCount}>{planSteps.length} steps</Text>
      </View>

      {/* Steps */}
      <View style={planStyles.stepsContainer}>
        {planSteps.map((step, i) => (
          <View key={i} style={planStyles.stepRow}>
            <View style={planStyles.stepNumberBadge}>
              <Text style={planStyles.stepNumberText}>{i + 1}</Text>
            </View>
            <View style={planStyles.stepContent}>
              <Text style={planStyles.stepDescription}>{step.description}</Text>
              {step.tool ? (
                <View style={planStyles.toolTag}>
                  <Ionicons name="code-slash-outline" size={10} color="#93C5FD" />
                  <Text style={planStyles.toolTagText}>{step.tool}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {/* Action buttons */}
      {isPending && (
        <View style={planStyles.buttonRow}>
          <Pressable
            testID="plan-reject-btn"
            onPress={handleReject}
            style={({ pressed }) => [planStyles.rejectBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Reject plan"
          >
            <Text style={planStyles.rejectBtnText}>REJECT</Text>
          </Pressable>
          <Pressable
            testID="plan-approve-btn"
            onPress={handleApprove}
            style={({ pressed }) => [planStyles.approveBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Approve plan"
          >
            <Text style={planStyles.approveBtnText}>EXECUTE</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const planStyles = StyleSheet.create({
  card: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    borderTopWidth: 4,
    borderTopColor: '#60A5FA',
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#60A5FA',
    letterSpacing: 0.5,
    flex: 1,
  },
  stepCount: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  stepsContainer: {
    gap: 8,
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1E3A5F',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#93C5FD',
  },
  stepContent: {
    flex: 1,
    gap: 4,
  },
  stepDescription: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 19,
  },
  toolTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#1E293B',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toolTagText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#93C5FD',
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  rejectBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1C1C1E',
    borderWidth: 1.5,
    borderColor: '#EF4444',
    alignItems: 'center',
  },
  rejectBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 0.8,
  },
  approveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  approveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});

function AgentConfirmationCard({ entry }: { entry: ExecutionEntry }) {
  // Route plan approvals to the dedicated PlanApprovalCard
  if (entry.metadata?.reason === 'plan_approval' && entry.metadata?.plan_steps) {
    return <PlanApprovalCard entry={entry} />;
  }
  return <InterventionCard entry={entry} />;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** Pretty-print JSON strings; pass through non-JSON as-is. */
function formatCommand(cmd: string): string {
  try {
    const parsed = JSON.parse(cmd);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return cmd;
  }
}

export default function ExecutionEntryCard({ entry, isLastThinking }: Props): React.JSX.Element | null {
  switch (entry.type) {
    case 'user_message':
      return <UserMessageCard entry={entry} />;
    case 'ai_response':
      return <AIResponseCard entry={entry} />;
    case 'tool_call':
      return <ToolCallCard entry={entry} />;
    case 'tool_result':
      return <ToolResultCard entry={entry} />;
    case 'thinking':
      return <ThinkingCard isLastThinking={isLastThinking} />;
    case 'intervention':
      return <InterventionCard entry={entry} />;
    case 'agent_progress':
      return <AgentProgressCard entry={entry} />;
    case 'agent_status':
      return <AgentStatusCard entry={entry} />;
    case 'agent_result':
      return <AgentResultCard entry={entry} />;
    case 'agent_confirmation':
      return <AgentConfirmationCard entry={entry} />;
    case 'agent_thinking':
      return <AgentThinkingCard entry={entry} isLastThinking={isLastThinking} />;
    case 'agent_text':
      return <AgentTextCard entry={entry} />;
    default:
      return null;
  }
}

const s = StyleSheet.create({
  // User message wrapper (85% max width)
  entryWrapper: {
    marginBottom: 16,
    maxWidth: '85%',
  },
  // Label row with space-between for copy button
  labelRowSpaced: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  // AI / tool wrapper (full width)
  aiWrapper: {
    marginBottom: 16,
  },

  // User message
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  label: {
    fontSize: 11,
    color: '#6B7280',
  },
  labelRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timestamp: {
    fontSize: 11,
    color: '#6B7280',
  },
  userBubble: {
    backgroundColor: '#101113',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  userText: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 21,
  },

  // AI response
  aiLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#095BB9',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  aiText: {
    fontSize: 15,
    color: '#D1D5DB',
    lineHeight: 21,
  },

  // Tool call (inner card - wrapper handles marginBottom)
  toolCardInner: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  toolText: {
    fontSize: 13,
    color: '#095BB9',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },

  // Tool result
  toolResultCard: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 16,
  },
  toolResultHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  toolResultText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
  showMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  showMoreText: {
    fontSize: 12,
    color: '#095BB9',
  },

  // Thinking - static
  thinkingStatic: {
    marginBottom: 16,
    paddingVertical: 8,
  },
  thoughtText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#6B7280',
  },

  // Thinking - animated
  thinkingAnimated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: '#0A0A0A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#095BB9',
  },
  thinkingLabel: {
    fontSize: 12,
    fontWeight: '300',
    color: '#6B7280',
  },

  // Agent thinking (collapsible)
  agentThinkingCard: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 16,
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  thinkingHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  thinkingHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  thinkingHeaderText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#6B7280',
  },
  agentThinkingText: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 18,
    marginTop: 8,
  },

  // Agent intermediate text
  agentIntermediateText: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 20,
    fontStyle: 'italic',
  },

  // Intervention - full interactive card
  interventionCardFull: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    borderTopWidth: 4,
    borderTopColor: '#F59E0B',
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  interventionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  interventionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F59E0B',
    letterSpacing: 0.5,
    flex: 1,
  },
  interventionSection: {
    marginBottom: 8,
  },
  interventionSectionLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
  },
  interventionQuote: {
    fontSize: 13,
    color: '#E5E7EB',
    fontStyle: 'italic',
    lineHeight: 19,
  },
  interventionCodeBlock: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1F1F1F',
    borderRadius: 8,
    padding: 10,
  },
  interventionCodeText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#D1D5DB',
    lineHeight: 18,
  },
  interventionReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  interventionReasonText: {
    fontSize: 12,
    color: '#F59E0B',
    flex: 1,
  },
  interventionButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  interventionGhostBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F59E0B',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  interventionGhostBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F59E0B',
    letterSpacing: 0.5,
  },
  interventionAccentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#60A5FA',
    alignItems: 'center',
  },
  interventionAccentBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // Audit info row (Story 4.2)
  auditInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  modelInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  toolModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  toolModelText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toolBackendText: {
    fontSize: 10,
    color: '#095BB9',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  auditInfoText: {
    fontSize: 11,
    color: '#71717A',
  },
  auditCommandText: {
    fontSize: 11,
    color: '#71717A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },
  auditBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  auditBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Error card
  errorCard: {
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.25)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  errorLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#F87171',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  errorText: {
    fontSize: 14,
    color: '#FCA5A5',
    lineHeight: 20,
  },
});
