import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { View, FlatList, ScrollView, Pressable, StyleSheet, type ViewToken } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import useAIStore from '../stores/useAIStore';
import ExecutionEntryCard from './ExecutionEntryCard';
import DesktopAgentGroup from './DesktopAgentGroup';
import Text from './Text';
import type { ExecutionEntry, ExecutionEntryType } from '../types';

type Props = {
  variant: 'full' | 'overlay';
  /** When provided, renders these entries instead of the live store (read-only history mode). */
  entries?: ExecutionEntry[];
};

/** Entry types that belong to the desktop agent subprocess. */
const DESKTOP_AGENT_TYPES: Set<ExecutionEntryType> = new Set([
  'agent_progress',
  'agent_result',
  'agent_confirmation',
]);

/**
 * A render item is either a regular entry or a group of desktop agent entries.
 * Groups are rendered as a collapsible "CONTOP DESKTOP" card.
 */
type RenderItem =
  | { kind: 'entry'; entry: ExecutionEntry }
  | { kind: 'group'; id: string; entries: ExecutionEntry[]; isActive: boolean };

export default function ExecutionThread({ variant, entries: externalEntries }: Props): React.JSX.Element | null {
  const store = useAIStore();
  const isHistoryMode = !!externalEntries;
  const executionEntries = externalEntries ?? store.executionEntries;
  const aiState = isHistoryMode ? 'idle' : store.aiState;
  const flatListRef = useRef<FlatList<RenderItem>>(null);
  const overlayScrollRef = useRef<ScrollView>(null);
  const isAtBottomRef = useRef(true);
  const isAutoScrollingRef = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Track whether the pending intervention card is visible in the viewport
  const [interventionVisible, setInterventionVisible] = useState(true);
  const visibleIdsRef = useRef<Set<string>>(new Set());

  const isLastThinking = useCallback(
    (entry: ExecutionEntry): boolean => {
      return (
        entry.type === 'thinking' &&
        entry.id === executionEntries[executionEntries.length - 1]?.id &&
        (aiState === 'processing' || aiState === 'executing')
      );
    },
    [executionEntries, aiState],
  );

  // Find the pending intervention entry (if any)
  const pendingIntervention = useMemo(() => {
    return executionEntries.find(
      (e) => e.type === 'agent_confirmation' && e.metadata?.status === 'pending',
    );
  }, [executionEntries]);

  // Stable ref for pendingIntervention — avoids recreating onViewableItemsChanged
  // (FlatList warns when onViewableItemsChanged changes during its lifetime)
  const pendingInterventionRef = useRef(pendingIntervention);
  pendingInterventionRef.current = pendingIntervention;

  /** Group consecutive desktop-agent entries into collapsible groups. */
  const renderItems = useMemo((): RenderItem[] => {
    const items: RenderItem[] = [];
    let currentGroup: ExecutionEntry[] | null = null;

    for (const entry of executionEntries) {
      if (DESKTOP_AGENT_TYPES.has(entry.type)) {
        if (!currentGroup) currentGroup = [];
        currentGroup.push(entry);
      } else {
        // Flush any pending group
        if (currentGroup) {
          items.push({
            kind: 'group',
            id: `group-${currentGroup[0].id}`,
            entries: currentGroup,
            isActive: false, // will be computed below
          });
          currentGroup = null;
        }
        items.push({ kind: 'entry', entry });
      }
    }
    // Flush trailing group
    if (currentGroup) {
      const hasRunning = currentGroup.some(
        (e) => e.type === 'agent_progress' && e.metadata?.status === 'running',
      );
      const hasNoResult = !currentGroup.some((e) => e.type === 'agent_result');
      items.push({
        kind: 'group',
        id: `group-${currentGroup[0].id}`,
        entries: currentGroup,
        isActive: !isHistoryMode && (hasRunning || (hasNoResult && (aiState === 'processing' || aiState === 'executing'))),
      });
    }

    return items;
  }, [executionEntries, aiState, isHistoryMode]);

  // Auto-scroll when content size changes (fires after FlatList renders new items).
  // setTimeout lets the last entry finish layout (text wrapping, dynamic height) so
  // scrollToEnd targets the final content height, not an intermediate one.
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const triggerAutoScroll = useCallback(() => {
    if (isAtBottomRef.current) {
      isAutoScrollingRef.current = true;
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
    }
  }, []);

  // Supplement onContentSizeChange: when new entries arrive (e.g. agent_progress
  // added to a collapsed DesktopAgentGroup), content height barely changes so
  // onContentSizeChange may not fire. Watch entry count to ensure auto-scroll.
  const prevEntryCountRef = useRef(executionEntries.length);
  useEffect(() => {
    if (executionEntries.length > prevEntryCountRef.current) {
      triggerAutoScroll();
    }
    prevEntryCountRef.current = executionEntries.length;
  }, [executionEntries.length, triggerAutoScroll]);

  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 50;
      // Only update auto-scroll intent from user-initiated scrolls — programmatic
      // scrollToEnd fires intermediate onScroll events that would falsely disable auto-scroll
      if (!isAutoScrollingRef.current) {
        isAtBottomRef.current = atBottom;
      } else if (atBottom) {
        isAutoScrollingRef.current = false;
      }
      setIsAtBottom(atBottom);
    },
    [],
  );

  // User starts dragging — any subsequent onScroll is user-initiated
  const handleScrollBeginDrag = useCallback(() => {
    isAutoScrollingRef.current = false;
  }, []);

  const handleJumpToBottom = useCallback(() => {
    isAutoScrollingRef.current = true;
    flatListRef.current?.scrollToEnd({ animated: true });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // Track viewable items to determine if intervention card is off-screen
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 10 }).current;
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ids = new Set<string>();
      for (const item of viewableItems) {
        if (item.isViewable && item.key) ids.add(item.key);
      }
      visibleIdsRef.current = ids;
      // Check if any pending intervention is visible (via ref to avoid callback recreation)
      const pending = pendingInterventionRef.current;
      if (pending) {
        setInterventionVisible(ids.has(pending.id) || ids.has(`group-${pending.id}`));
      }
    },
    [],
  );

  // Scroll to the pending intervention card
  const handleBannerPress = useCallback(() => {
    if (!pendingIntervention) return;
    const idx = renderItems.findIndex(
      (item) => item.kind === 'entry' && item.entry.id === pendingIntervention.id,
    );
    // Also check inside groups
    if (idx === -1) {
      const groupIdx = renderItems.findIndex(
        (item) =>
          item.kind === 'group' &&
          item.entries.some((e) => e.id === pendingIntervention.id),
      );
      if (groupIdx >= 0) {
        flatListRef.current?.scrollToIndex({ index: groupIdx, animated: true });
      }
      return;
    }
    flatListRef.current?.scrollToIndex({ index: idx, animated: true });
  }, [pendingIntervention, renderItems]);

  const showBanner = !!pendingIntervention && !interventionVisible;

  if (variant === 'overlay') {
    // Use the same grouped renderItems as full mode so desktop agent entries
    // appear inside DesktopAgentGroup cards (not as loose "CONTOP" entries).
    const recentItems = renderItems.slice(-10);

    const handleOverlayLongPress = () => {
      const { orientation } = useAIStore.getState();
      useAIStore.getState().setLayoutMode(
        orientation === 'portrait' ? 'split-view' : 'side-by-side',
      );
    };

    // Always render the container (never return null) so the parent View stays in
    // the native hierarchy on Android — returning null causes the parent to be
    // collapsed by the view optimizer, and re-expansion when entries appear can fail.
    if (recentItems.length === 0) {
      return <View testID="execution-thread-overlay" />;
    }

    return (
      <View
        testID="execution-thread-overlay"
        style={styles.overlayContainer}
      >
        <ScrollView
          ref={overlayScrollRef}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.overlayScrollContent}
          onContentSizeChange={() => {
            overlayScrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {recentItems.map((item) => (
            <Pressable
              key={item.kind === 'entry' ? item.entry.id : item.id}
              testID="overlay-entry-pressable"
              onLongPress={handleOverlayLongPress}
              delayLongPress={500}
              style={styles.overlayEntry}
            >
              {item.kind === 'group' ? (
                <DesktopAgentGroup entries={item.entries} isActive={item.isActive} />
              ) : (
                <ExecutionEntryCard entry={item.entry} isLastThinking={isLastThinking(item.entry)} />
              )}
            </Pressable>
          ))}
        </ScrollView>
        {/* Gradient fade at top — fixed overlay above scroll content */}
        <View style={styles.overlayFadeOverlay} pointerEvents="none">
          <View style={styles.execFadeStep1} />
          <View style={styles.execFadeStep2} />
          <View style={styles.execFadeStep3} />
        </View>
      </View>
    );
  }

  // Full mode: FlatList with auto-scroll and FAB
  return (
    <View testID="execution-thread" className="flex-1">
      {/* Floating amber banner for off-screen pending intervention */}
      {showBanner && (
        <Pressable
          testID="intervention-banner"
          onPress={handleBannerPress}
          style={styles.interventionBanner}
          accessibilityRole="button"
          accessibilityLabel="Intervention Pending. Tap to review."
        >
          <Ionicons name="warning" size={14} color="#000000" />
          <Text style={styles.interventionBannerText}>Intervention Pending — Tap to Review</Text>
        </Pressable>
      )}
      <FlatList
        ref={flatListRef}
        testID="execution-flatlist"
        data={renderItems}
        keyExtractor={(item) => (item.kind === 'entry' ? item.entry.id : item.id)}
        renderItem={({ item }) => {
          if (item.kind === 'group') {
            return <DesktopAgentGroup entries={item.entries} isActive={item.isActive} />;
          }
          return <ExecutionEntryCard entry={item.entry} isLastThinking={isLastThinking(item.entry)} />;
        }}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        scrollEventThrottle={16}
        contentContainerStyle={styles.flatListContent}
        onContentSizeChange={triggerAutoScroll}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      />
      {!isAtBottom && (
        <Pressable
          testID="jump-to-bottom-fab"
          onPress={handleJumpToBottom}
          style={styles.fab}
          accessibilityLabel="Jump to bottom"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-down" size={22} color="#ffffff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flatListContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  overlayContainer: {
    maxHeight: 130,
    overflow: 'hidden',
  },
  overlayScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 28, // space for fade gradient overlay
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  overlayFadeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  execFadeStep1: {
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  execFadeStep2: {
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  execFadeStep3: {
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  overlayEntry: {
    opacity: 0.75,
    marginBottom: 6,
  },
  fab: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(16,17,19,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  interventionBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#F59E0B',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  interventionBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000000',
    flex: 1,
  },
});
