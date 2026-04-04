import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenContainer from '../../components/ScreenContainer';
import Text from '../../components/Text';
import ExecutionThread from '../../components/ExecutionThread';
import SessionList, { formatSessionDate } from '../../components/SessionList';
import * as sessionStorage from '../../services/sessionStorage';
import useAIStore from '../../stores/useAIStore';
import type { SessionMeta, ExecutionEntry } from '../../types';


export default function HistoryScreen(): React.JSX.Element {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionMeta | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<ExecutionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toolFilter, setToolFilter] = useState<string>('all');
  const [resultFilter, setResultFilter] = useState<string>('all');

  const currentConnectionType = useAIStore((s) => s.connectionType);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const index = await sessionStorage.loadSessionIndex();
      // Filter sessions by current connection type so temp and permanent histories are isolated
      const filtered = index.filter((s) => {
        const sessionType = s.connectionType ?? 'permanent';
        return sessionType === (currentConnectionType ?? 'permanent');
      });
      setSessions(filtered);
      setLoading(false);
    }
    void load();
  }, [currentConnectionType]);

  // Extract unique tool and execution_result values from entries for dynamic filter options
  const toolOptions = useMemo(() => {
    const tools = new Set<string>();
    selectedEntries.forEach((e) => {
      if (e.type === 'agent_progress' && e.metadata?.tool) {
        tools.add(e.metadata.tool as string);
      }
    });
    return ['all', ...Array.from(tools).sort()];
  }, [selectedEntries]);

  const resultOptions = useMemo(() => {
    const results = new Set<string>();
    selectedEntries.forEach((e) => {
      if (e.type === 'agent_progress' && e.metadata?.execution_result) {
        results.add(e.metadata.execution_result as string);
      }
    });
    return ['all', ...Array.from(results).sort()];
  }, [selectedEntries]);

  // Filter entries — only agent_progress entries are filtered; others always shown
  const filteredEntries = useMemo(() => {
    if (toolFilter === 'all' && resultFilter === 'all') return selectedEntries;
    return selectedEntries.filter((e) => {
      if (e.type !== 'agent_progress') return true;
      if (toolFilter !== 'all' && e.metadata?.tool !== toolFilter) return false;
      if (resultFilter !== 'all' && e.metadata?.execution_result !== resultFilter) return false;
      return true;
    });
  }, [selectedEntries, toolFilter, resultFilter]);

  async function handleSelectSession(session: SessionMeta) {
    setSelectedSession(session);
    setToolFilter('all');
    setResultFilter('all');
    const entries = await sessionStorage.loadSessionEntries(session.id);
    setSelectedEntries(entries);
  }

  function handleContinueSession() {
    if (!selectedSession || selectedEntries.length === 0) return;
    // Atomic set: session + entries in one Zustand update so the subscription
    // in index.tsx sees both the new session ID and the restored entries,
    // allowing it to rebuild Gemini's conversation context.
    const restoredSession = { ...selectedSession, startTime: Date.now(), endTime: undefined };
    useAIStore.getState().restoreSession(restoredSession, selectedEntries);
    void sessionStorage.upsertSessionMeta(restoredSession);
    router.back();
  }

  async function handleRenameSession(session: SessionMeta, newName: string) {
    try {
      const updated = { ...session, name: newName || undefined };
      await sessionStorage.upsertSessionMeta(updated);
      setSessions((prev) => prev.map((s) => (s.id === session.id ? updated : s)));
      if (selectedSession?.id === session.id) {
        setSelectedSession(updated);
      }
    } catch {
      // Storage error — UI remains consistent with previous state
    }
  }

  async function handleDeleteSession(session: SessionMeta) {
    try {
      await sessionStorage.deleteSession(session.id);
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      if (selectedSession?.id === session.id) {
        setSelectedSession(null);
        setSelectedEntries([]);
      }
    } catch {
      // Storage error — session remains in list
    }
  }

  if (selectedSession) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={historyStyles.header}>
          <Pressable testID="history-back-button" onPress={() => setSelectedSession(null)} style={historyStyles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </Pressable>
          <Text style={historyStyles.headerTitle}>{selectedSession.name || formatSessionDate(selectedSession.startTime)}</Text>
          <Pressable
            testID="history-continue-button"
            onPress={handleContinueSession}
            style={historyStyles.continueBtn}
          >
            <Ionicons name="play" size={14} color="#FFFFFF" />
            <Text style={historyStyles.continueBtnText}>Continue</Text>
          </Pressable>
        </View>
        {selectedEntries.length === 0 ? (
          <Text style={{ color: '#9CA3AF', textAlign: 'center', padding: 32 }}>No entries in this session</Text>
        ) : (
          <>
            {/* Filter bar — Tool and Result filters */}
            {(toolOptions.length > 1 || resultOptions.length > 1) && (
              <View testID="history-filter-bar" style={historyStyles.filterBar}>
                {toolOptions.length > 1 && (
                  <View style={historyStyles.filterGroup}>
                    <Text style={historyStyles.filterGroupLabel}>Tool</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {toolOptions.map((opt) => (
                        <Pressable
                          key={`tool-${opt}`}
                          testID={`filter-tool-${opt}`}
                          onPress={() => setToolFilter(opt)}
                          style={[historyStyles.filterPill, toolFilter === opt && historyStyles.filterPillActive]}
                        >
                          <Text style={[historyStyles.filterPillText, toolFilter === opt && historyStyles.filterPillTextActive]}>
                            {opt === 'all' ? 'All' : opt}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
                {resultOptions.length > 1 && (
                  <View style={historyStyles.filterGroup}>
                    <Text style={historyStyles.filterGroupLabel}>Result</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {resultOptions.map((opt) => (
                        <Pressable
                          key={`result-${opt}`}
                          testID={`filter-result-${opt}`}
                          onPress={() => setResultFilter(opt)}
                          style={[historyStyles.filterPill, resultFilter === opt && historyStyles.filterPillActive]}
                        >
                          <Text style={[historyStyles.filterPillText, resultFilter === opt && historyStyles.filterPillTextActive]}>
                            {opt === 'all' ? 'All' : opt}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}
            <ExecutionThread variant="full" entries={filteredEntries} />
          </>
        )}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View style={historyStyles.header}>
        <Pressable testID="history-back-button" onPress={() => router.back()} style={historyStyles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        </Pressable>
        <Text style={historyStyles.headerTitle}>Session History</Text>
        <View style={{ width: 44 }} />
      </View>
      {loading ? (
        <ActivityIndicator testID="history-loading" size="large" color="#095BB9" style={{ flex: 1 }} />
      ) : (
        <SessionList sessions={sessions} onSelectSession={handleSelectSession} onDeleteSession={handleDeleteSession} onRenameSession={handleRenameSession} />
      )}
    </ScreenContainer>
  );
}

const historyStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#095BB9',
    borderRadius: 16,
  },
  continueBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Filter bar (Story 4.2)
  filterBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterGroupLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
    minWidth: 38,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#27272A',
    marginRight: 6,
  },
  filterPillActive: {
    backgroundColor: 'rgba(9,91,185,0.8)',
  },
  filterPillText: {
    fontSize: 12,
    color: '#A1A1AA',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
});
