import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SessionMeta } from '../types';

interface SessionListProps {
  sessions: SessionMeta[];
  onSelectSession: (session: SessionMeta) => void;
  onDeleteSession?: (session: SessionMeta) => void;
  onRenameSession?: (session: SessionMeta, newName: string) => void;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'this-week', label: 'This Week' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

export function formatSessionDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDuration(startTime: number, endTime?: number): string {
  const durationMs = (endTime ?? Date.now()) - startTime;
  const totalSeconds = Math.floor(durationMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

interface SessionCardProps {
  session: SessionMeta;
  onPress: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
}

function SessionCard({ session, onPress, onDelete, onRename }: SessionCardProps) {
  const dateLabel = formatSessionDate(session.startTime);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.name ?? '');
  const inputRef = useRef<TextInput>(null);

  // Refresh every second for live sessions (no endTime) so duration stays current
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (session.endTime) return;
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [session.endTime]);

  const duration = formatDuration(session.startTime, session.endTime);

  const title = session.name || dateLabel;

  function handleEditPress() {
    setEditValue(session.name ?? '');
    setIsEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleSubmit() {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed !== (session.name ?? '') && onRename) {
      onRename(trimmed);
    }
  }

  return (
    <Pressable
      testID={`session-card-${session.id}`}
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`Session ${title}, ${session.entryCount} entries`}
    >
      <View style={styles.cardTopRow}>
        {isEditing ? (
          <TextInput
            ref={inputRef}
            testID={`session-name-input-${session.id}`}
            value={editValue}
            onChangeText={setEditValue}
            onSubmitEditing={handleSubmit}
            onBlur={handleSubmit}
            placeholder={dateLabel}
            placeholderTextColor="#6B7280"
            style={styles.cardNameInput}
            maxLength={60}
            returnKeyType="done"
          />
        ) : (
          <>
            <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
            {onRename && (
              <Pressable testID={`session-rename-${session.id}`} onPress={handleEditPress} hitSlop={8}>
                <Ionicons name="pencil-outline" size={14} color="#6B7280" />
              </Pressable>
            )}
          </>
        )}
        {!isEditing && onDelete && (
          <Pressable testID={`session-delete-${session.id}`} onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color="#6B7280" />
          </Pressable>
        )}
      </View>
      {session.name && (
        <Text style={styles.cardDate}>{dateLabel}</Text>
      )}
      <View style={styles.cardMeta}>
        <Text style={styles.cardMetaText}>{duration}</Text>
        <Text style={styles.cardMetaText}>·</Text>
        <Text style={styles.cardMetaText}>{session.entryCount} entries</Text>
        <Text style={styles.cardMetaText}>·</Text>
        <Text style={styles.cardMetaText}>{session.modelUsed}</Text>
      </View>
      {session.toolStats &&
        (session.toolStats.executed > 0 || session.toolStats.blocked > 0 || session.toolStats.errors > 0) && (
          <View style={styles.pillRow}>
            {session.toolStats.executed > 0 && (
              <View testID={`pill-executed-${session.id}`} style={[styles.pill, styles.pillSuccess]}>
                <Text style={[styles.pillText, styles.pillSuccessText]}>{session.toolStats.executed} exec</Text>
              </View>
            )}
            {session.toolStats.blocked > 0 && (
              <View testID={`pill-blocked-${session.id}`} style={[styles.pill, styles.pillBlocked]}>
                <Text style={[styles.pillText, styles.pillBlockedText]}>{session.toolStats.blocked} blocked</Text>
              </View>
            )}
            {session.toolStats.errors > 0 && (
              <View testID={`pill-errors-${session.id}`} style={[styles.pill, styles.pillError]}>
                <Text style={[styles.pillText, styles.pillErrorText]}>
                  {session.toolStats.errors} error{session.toolStats.errors > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        )}
      {session.toolStats?.byTool && Object.keys(session.toolStats.byTool).length > 0 && (
        <View testID={`tool-breakdown-${session.id}`} style={styles.pillRow}>
          {Object.entries(session.toolStats.byTool).map(([tool, count]) => {
            const label = tool.replace('execute_', '').replace('observe_', '').toUpperCase();
            return (
              <View key={tool} style={[styles.pill, styles.pillTool]}>
                <Text style={[styles.pillText, styles.pillToolText]}>{label}: {count}</Text>
              </View>
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

export default function SessionList({ sessions, onSelectSession, onDeleteSession, onRenameSession }: SessionListProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [pendingDelete, setPendingDelete] = useState<SessionMeta | null>(null);

  const filteredSessions = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 86400000;
    let result = sessions;
    if (filter === 'today') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      result = result.filter((s) => s.startTime >= startOfDay.getTime());
    } else if (filter === 'this-week') {
      result = result.filter((s) => s.startTime >= now - weekMs);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          (s.name ?? '').toLowerCase().includes(q) ||
          formatSessionDate(s.startTime).toLowerCase().includes(q) ||
          s.modelUsed.toLowerCase().includes(q),
      );
    }
    return result;
  }, [sessions, filter, searchQuery]);

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#9CA3AF" />
        <TextInput
          testID="session-search-input"
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search sessions..."
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
        />
        {searchQuery.length > 0 && (
          <Pressable testID="session-search-clear" onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={16} color="#9CA3AF" />
          </Pressable>
        )}
      </View>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            testID={`filter-chip-${f.key}`}
            onPress={() => setFilter(f.key)}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Session list */}
      <FlatList
        testID="session-list"
        data={filteredSessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SessionCard
            session={item}
            onPress={() => onSelectSession(item)}
            onDelete={onDeleteSession ? () => setPendingDelete(item) : undefined}
            onRename={onRenameSession ? (newName) => onRenameSession(item, newName) : undefined}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No sessions yet</Text>
          </View>
        }
      />

      {/* Delete confirmation modal — matches app aesthetic */}
      <Modal
        testID="delete-confirm-modal"
        visible={!!pendingDelete}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPendingDelete(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setPendingDelete(null)}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="trash-outline" size={22} color="#EF4444" />
            </View>
            <Text style={styles.modalTitle}>Delete Session</Text>
            <Text style={styles.modalDesc}>
              This session and all its entries will be permanently removed.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                testID="delete-confirm-cancel"
                style={styles.modalBtnGhost}
                onPress={() => setPendingDelete(null)}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="delete-confirm-ok"
                style={styles.modalBtnDanger}
                onPress={() => {
                  if (pendingDelete && onDeleteSession) {
                    onDeleteSession(pendingDelete);
                  }
                  setPendingDelete(null);
                }}
              >
                <Text style={styles.modalBtnDangerText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', paddingTop: 12 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 8, flexGrow: 0, flexShrink: 0 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: '#095BB9' },
  filterChipText: { fontSize: 13, color: '#9CA3AF' },
  filterChipTextActive: { color: '#FFFFFF' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 8,
    flexShrink: 0,
  },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14 },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTitle: { fontSize: 15, fontWeight: '500', color: '#FFFFFF', flex: 1, marginBottom: 4 },
  cardDate: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  cardNameInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#095BB9',
    paddingVertical: 2,
    marginBottom: 4,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  cardMetaText: { fontSize: 12, color: '#9CA3AF' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { fontSize: 16, color: '#9CA3AF' },

  // Status pills (AC3)
  pillRow: { flexDirection: 'row', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillSuccess: { backgroundColor: 'rgba(34,197,94,0.15)' },
  pillBlocked: { backgroundColor: 'rgba(245,158,11,0.15)' },
  pillError: { backgroundColor: 'rgba(239,68,68,0.15)' },
  pillText: { fontSize: 11, fontWeight: '500' },
  pillSuccessText: { color: '#22C55E' },
  pillBlockedText: { color: '#F59E0B' },
  pillErrorText: { color: '#EF4444' },
  pillTool: { backgroundColor: 'rgba(9,91,185,0.15)' },
  pillToolText: { color: '#60A5FA' },

  // Delete confirmation modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  modalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239,68,68,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalBtnGhost: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  modalBtnGhostText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  modalBtnDanger: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239,68,68,0.2)',
    alignItems: 'center',
  },
  modalBtnDangerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
});
