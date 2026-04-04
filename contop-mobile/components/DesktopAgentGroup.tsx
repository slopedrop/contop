import React, { useState, useMemo } from 'react';
import {
  View,
  Pressable,
  Modal,
  ScrollView,
  Image,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';
import ExecutionEntryCard from './ExecutionEntryCard';
import TextShimmer from './TextShimmer';
import type { ExecutionEntry } from '../types';

type Props = {
  entries: ExecutionEntry[];
  isActive: boolean;
};

/**
 * Collapsible "CONTOP DESKTOP" group — terminal-style subprocess view.
 *
 * Collapsed: header with step count + status.
 * Expanded: terminal-style command boxes. Tap any step to open detail modal.
 */
export default function DesktopAgentGroup({ entries, isActive }: Props): React.JSX.Element {
  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [modalEntry, setModalEntry] = useState<ExecutionEntry | null>(null);

  const stepCount = entries.filter((e) => e.type === 'agent_progress').length;
  const resultEntry = entries.find((e) => e.type === 'agent_result');
  const hasError = entries.some(
    (e) => e.type === 'agent_progress' && e.metadata?.status === 'failed',
  );
  // Extract model from first entry; backend from last (can change mid-execution)
  const modelEntry = entries.find((e) => e.metadata?.model);
  const model = modelEntry?.metadata?.model as string | undefined;
  const lastBackendEntry = [...entries].reverse().find((e) => e.metadata?.backend);
  const backend = lastBackendEntry?.metadata?.backend as string | undefined;

  // Find the latest running tool detail for collapsed shimmer
  const runningDetail = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.type === 'agent_progress' && e.metadata?.status === 'running') {
        return e.content;
      }
    }
    return null;
  }, [entries]);

  // Auto-expand when group contains a pending confirmation (AC #1, subtask 6.1)
  const hasPendingConfirmation = useMemo(
    () => entries.some((e) => e.type === 'agent_confirmation' && e.metadata?.status === 'pending'),
    [entries],
  );
  const isExpanded = isManualExpanded || hasPendingConfirmation;

  return (
    <View testID="desktop-agent-group" style={s.container}>
      {/* Header — always visible */}
      <Pressable onPress={() => setIsManualExpanded(!isManualExpanded)} style={s.header}>
        <View style={s.headerLeft}>
          <Ionicons name="desktop-outline" size={13} color="#6B7280" />
          {isActive
            ? <TextShimmer style={s.headerLabel} testID="group-active-shimmer">CONTOP DESKTOP</TextShimmer>
            : <Text style={s.headerLabel}>CONTOP DESKTOP</Text>
          }
          {stepCount > 0 && (
            <Text style={s.stepBadge}>{stepCount} step{stepCount !== 1 ? 's' : ''}</Text>
          )}
          {/* Amber indicator when collapsed with pending confirmation (subtask 6.2) */}
          {!isExpanded && hasPendingConfirmation && (
            <View testID="pending-confirmation-indicator" style={s.amberDot} />
          )}
        </View>
        <View style={s.headerRight}>
          {!isActive && !hasError && resultEntry && (
            <Ionicons name="checkmark-circle" size={14} color="#22C55E" />
          )}
          {!isActive && hasError && (
            <Ionicons name="warning" size={14} color="#F59E0B" />
          )}
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color="#6B7280"
          />
        </View>
      </Pressable>

      {/* Running tool detail — visible when collapsed */}
      {!isExpanded && isActive && runningDetail && (
        <View style={s.runningDetail}>
          <Ionicons name="terminal-outline" size={11} color="#4ADE80" />
          <TextShimmer style={s.runningDetailText} numberOfLines={1} testID="group-running-detail">
            {runningDetail}
          </TextShimmer>
        </View>
      )}

      {/* Model/backend subtitle — inside container, below header */}
      {(model || backend) && (
        <View style={s.modelSubtitle}>
          {model && (
            <Text style={s.modelSubtitleText} numberOfLines={1}>
              {model}
            </Text>
          )}
          {backend && (
            <Text style={s.backendSubtitleText} numberOfLines={1}>
              {backend}
            </Text>
          )}
        </View>
      )}

      {/* Expanded: terminal-style step list */}
      {isExpanded && (
        <View style={s.body}>
          {entries.map((entry) => (
            <ChildEntry key={entry.id} entry={entry} onPress={() => setModalEntry(entry)} />
          ))}
        </View>
      )}

      {/* Detail modal */}
      {modalEntry && (
        <CommandDetailModal entry={modalEntry} onClose={() => setModalEntry(null)} />
      )}
    </View>
  );
}

/** Truncatable result row with show more/less toggle. */
function ResultRow({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isTruncated = content.length > 200;
  const displayContent = isTruncated && !isExpanded
    ? content.slice(0, 200) + '...'
    : content;

  return (
    <View style={s.resultRow}>
      <Text style={s.resultLabel}>Result</Text>
      <Text style={s.resultText}>{displayContent}</Text>
      {isTruncated && (
        <Pressable testID="result-show-more" onPress={() => setIsExpanded(!isExpanded)}>
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

/** Route entry to the right renderer. */
function ChildEntry({ entry, onPress }: { entry: ExecutionEntry; onPress: () => void }): React.JSX.Element {
  if (entry.type === 'agent_progress') {
    return <TerminalStep entry={entry} onPress={onPress} />;
  }
  if (entry.type === 'agent_result') {
    return <ResultRow content={entry.content} />;
  }
  if (entry.type === 'agent_confirmation') {
    // Render the full interactive InterventionCard inside the group
    return <ExecutionEntryCard entry={entry} isLastThinking={false} />;
  }
  return <View />;
}

const STEP_ICON_COLOR: Record<string, string> = {
  running: '#4ADE80',
  completed: '#4ADE80',
  failed: '#EF4444',
  cancelled: '#6B7280',
};

/** Terminal-style command step — shows command, truncated output, status. */
function TerminalStep({ entry, onPress }: { entry: ExecutionEntry; onPress: () => void }) {
  const meta = entry.metadata ?? {};
  const tool = (meta.tool as string) ?? '';
  const status = (meta.status as string) ?? 'running';
  const command = (meta.command as string) || entry.content;
  const stdout = (meta.stdout as string) ?? '';
  const stderr = (meta.stderr as string) ?? '';
  const imageB64 = (meta.image_b64 as string) ?? '';
  const stepModel = (meta.model as string) ?? '';
  const stepBackend = (meta.backend as string) ?? '';
  const hasOutput = stdout.length > 0 || stderr.length > 0;
  const isScreen = tool === 'observe_screen';
  const isUIContext = tool === 'get_ui_context';
  const isObservation = isScreen || isUIContext;

  return (
    <Pressable onPress={onPress} style={s.termBox}>
      {/* Command line */}
      <View style={s.termHeader}>
        <Ionicons
          name={isScreen ? 'eye-outline' : isUIContext ? 'list-outline' : 'terminal-outline'}
          size={11}
          color={STEP_ICON_COLOR[status] ?? '#4ADE80'}
        />
        {status === 'running'
          ? <TextShimmer style={s.termCommand} numberOfLines={2}>
              {isScreen ? 'observe_screen (screenshot)' : isUIContext ? 'get_ui_context (accessibility)' : command}
            </TextShimmer>
          : <Text style={s.termCommand} numberOfLines={2}>
              {isScreen ? 'observe_screen (screenshot)' : isUIContext ? 'get_ui_context (accessibility)' : command}
            </Text>
        }
        <View style={s.termStatus}>
          {status === 'completed' && <Ionicons name="checkmark-circle" size={12} color="#22C55E" />}
          {status === 'failed' && <Ionicons name="close-circle" size={12} color="#EF4444" />}
          {status === 'cancelled' && <Ionicons name="stop-circle" size={12} color="#6B7280" />}
        </View>
      </View>

      {/* Model/backend per step */}
      {(stepModel || stepBackend) ? (
        <View style={s.termModelRow}>
          {stepModel ? <Text style={s.termModelText}>{stepModel}</Text> : null}
          {stepBackend ? <Text style={s.termBackendText}>{stepBackend}</Text> : null}
        </View>
      ) : null}

      {/* Screenshot thumbnail for observe_screen */}
      {isScreen && imageB64.length > 0 && (
        <Image
          source={{ uri: `data:image/jpeg;base64,${imageB64}` }}
          style={s.screenThumb}
          resizeMode="contain"
        />
      )}

      {/* Truncated output preview */}
      {hasOutput && (
        <Text style={s.termOutput} numberOfLines={3}>
          {stdout || stderr}
        </Text>
      )}

      {/* Cancelled indicator when no output was captured */}
      {status === 'cancelled' && !hasOutput && (
        <Text style={s.cancelledLabel}>Cancelled</Text>
      )}

      {/* Tap hint */}
      {(hasOutput || command.length > 60 || isObservation) && (
        <Text style={s.tapHint}>Tap for details</Text>
      )}
    </Pressable>
  );
}

/** Full-screen modal showing command + output details. */
function CommandDetailModal({ entry, onClose }: { entry: ExecutionEntry; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const meta = entry.metadata ?? {};
  const tool = (meta.tool as string) ?? '';
  const step = meta.step as number | undefined;
  const status = (meta.status as string) ?? '';
  const command = (meta.command as string) || entry.content;
  const stdout = (meta.stdout as string) ?? '';
  const stderr = (meta.stderr as string) ?? '';
  const imageB64 = (meta.image_b64 as string) ?? '';
  const exitCode = meta.exit_code as number | undefined;
  const durationMs = meta.duration_ms as number | undefined;
  const isProgress = entry.type === 'agent_progress';
  const isScreen = tool === 'observe_screen';

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[m.container, { paddingTop: insets.top }]}>
        {/* Header bar */}
        <View style={m.header}>
          <View style={m.headerLeft}>
            <Ionicons name="terminal-outline" size={16} color="#9CA3AF" />
            <Text style={m.headerTitle}>
              {step ? `Step ${step}` : 'Details'} — {tool}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={20} color="#9CA3AF" />
          </Pressable>
        </View>

        {/* Status bar */}
        {isProgress && (
          <View style={m.statusBar}>
            {status === 'completed' && <Ionicons name="checkmark-circle" size={14} color="#22C55E" />}
            {status === 'failed' && <Ionicons name="close-circle" size={14} color="#EF4444" />}
            {status === 'cancelled' && <Ionicons name="stop-circle" size={14} color="#6B7280" />}
            {status === 'running'
              ? <TextShimmer style={[m.statusText, { color: STEP_ICON_COLOR[status] ?? '#22C55E' }]}>{status}</TextShimmer>
              : <Text style={[m.statusText, { color: STEP_ICON_COLOR[status] ?? '#22C55E' }]}>
                  {status}
                </Text>
            }
            {exitCode !== undefined && (
              <Text style={m.metaText}>exit {exitCode}</Text>
            )}
            {durationMs !== undefined && (
              <Text style={m.metaText}>{durationMs}ms</Text>
            )}
          </View>
        )}

        <ScrollView style={m.scroll} contentContainerStyle={[m.scrollContent, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Command section */}
          {isProgress && command ? (
            <View style={m.section}>
              <Text style={m.sectionLabel}>COMMAND</Text>
              <View style={m.codeBlock}>
                <Text style={m.codeText} selectable>{command}</Text>
              </View>
            </View>
          ) : null}

          {/* Screenshot section for observe_screen */}
          {isScreen && imageB64.length > 0 ? (
            <View style={m.section}>
              <Text style={m.sectionLabel}>SCREENSHOT</Text>
              <Image
                source={{ uri: `data:image/jpeg;base64,${imageB64}` }}
                style={m.screenshotImage}
                resizeMode="contain"
              />
            </View>
          ) : null}

          {/* stdout section */}
          {stdout ? (
            <View style={m.section}>
              <Text style={m.sectionLabel}>OUTPUT</Text>
              <View style={m.codeBlock}>
                <Text style={m.codeText} selectable>{stdout}</Text>
              </View>
            </View>
          ) : null}

          {/* stderr section */}
          {stderr ? (
            <View style={m.section}>
              <Text style={m.sectionLabel}>STDERR</Text>
              <View style={[m.codeBlock, { borderColor: '#7F1D1D' }]}>
                <Text style={[m.codeText, { color: '#FCA5A5' }]} selectable>{stderr}</Text>
              </View>
            </View>
          ) : null}

          {/* Non-progress entries (result, confirmation) */}
          {!isProgress && entry.content ? (
            <View style={m.section}>
              <Text style={m.sectionLabel}>{entry.type.toUpperCase().replace('AGENT_', '')}</Text>
              <View style={m.codeBlock}>
                <Text style={m.codeText} selectable>{entry.content}</Text>
              </View>
            </View>
          ) : null}

          {/* Empty state */}
          {isProgress && !stdout && !stderr && !(isScreen && imageB64.length > 0) && (
            <Text style={m.emptyText}>No output captured yet.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Inline styles ──────────────────────────────────────────────────────────

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const s = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 1,
  },
  stepBadge: {
    fontSize: 10,
    color: '#4B5563',
  },
  modelSubtitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  modelSubtitleText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  backendSubtitleText: {
    fontSize: 10,
    color: '#095BB9',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  runningDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  runningDetailText: {
    flex: 1,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#6B7280',
  },
  amberDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
    marginLeft: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },

  // ── Terminal step box ──
  termBox: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1F1F1F',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  termHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  termCommand: {
    flex: 1,
    fontSize: 12,
    fontFamily: mono,
    color: '#D1D5DB',
    lineHeight: 18,
  },
  termStatus: {
    width: 16,
    alignItems: 'center',
    paddingTop: 2,
  },
  termOutput: {
    fontSize: 11,
    fontFamily: mono,
    color: '#6B7280',
    lineHeight: 16,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1F1F1F',
  },
  screenThumb: {
    width: '100%',
    height: 80,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: '#0A0A0A',
  },
  cancelledLabel: {
    fontSize: 11,
    fontFamily: mono,
    color: '#6B7280',
    fontStyle: 'italic',
    marginTop: 6,
  },
  termModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  termModelText: {
    fontSize: 9,
    color: '#9CA3AF',
    fontFamily: mono,
  },
  termBackendText: {
    fontSize: 9,
    color: '#095BB9',
    fontFamily: mono,
  },
  tapHint: {
    fontSize: 9,
    color: '#4B5563',
    marginTop: 4,
    textAlign: 'right',
  },

  // ── Result / confirmation rows ──
  resultRow: {
    paddingTop: 6,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  resultLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#4B5563',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  resultText: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
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
});

// ── Modal styles ──

const m = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D1D5DB',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#22C55E',
    textTransform: 'capitalize',
  },
  metaText: {
    fontSize: 11,
    color: '#6B7280',
    fontFamily: mono,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 1,
  },
  codeBlock: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#1F1F1F',
    borderRadius: 8,
    padding: 12,
  },
  codeText: {
    fontSize: 12,
    fontFamily: mono,
    color: '#D1D5DB',
    lineHeight: 18,
  },
  screenshotImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    backgroundColor: '#111111',
  },
  emptyText: {
    fontSize: 12,
    color: '#4B5563',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 24,
  },
});
