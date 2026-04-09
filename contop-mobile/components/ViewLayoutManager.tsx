import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import useAIStore from '../stores/useAIStore';
import SplitSeparator from './SplitSeparator';
import type { LayoutMode } from '../types';

const TIMING_CONFIG = { duration: 300, easing: Easing.out(Easing.cubic) };

type ViewLayoutManagerProps = {
  videoContent: React.ReactNode;
  threadContent: React.ReactNode;
};

/**
 * Sole layout controller (FR24). Renders all 5 layout modes.
 * Components (video + thread) are NEVER unmounted - only repositioned via style changes.
 */
export default function ViewLayoutManager({
  videoContent,
  threadContent,
}: ViewLayoutManagerProps): React.JSX.Element {
  const { layoutMode, orientation } = useAIStore();

  // Measure actual container size for accurate drag ratio calculation
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const handleRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      containerSizeRef.current = { width, height };
    }
  }, []);

  // Shared values that drive animated container styles
  const videoFlex = useSharedValue(0.45);
  const threadFlex = useSharedValue(0.55);

  // Split ratio for draggable separator (0.30–0.70, stored for real-time drag)
  const splitRatio = useSharedValue(0.45);

  // Track previous layout to skip animation when transitioning from overlay modes
  const prevLayoutRef = useRef<LayoutMode>(layoutMode);

  // Animate shared values to match the current layoutMode
  useEffect(() => {
    const fromOverlay = prevLayoutRef.current === 'video-focus' || prevLayoutRef.current === 'fullscreen-video';
    prevLayoutRef.current = layoutMode;

    switch (layoutMode) {
      case 'split-view':
        splitRatio.value = 0.45;
        if (fromOverlay) {
          // Snap immediately - thread content is mounting; animation causes layout bugs
          videoFlex.value = 0.45;
          threadFlex.value = 0.55;
        } else {
          videoFlex.value = withTiming(0.45, TIMING_CONFIG);
          threadFlex.value = withTiming(0.55, TIMING_CONFIG);
        }
        break;
      case 'video-focus':
      case 'fullscreen-video':
        videoFlex.value = withTiming(1, TIMING_CONFIG);
        threadFlex.value = withTiming(0, TIMING_CONFIG);
        break;
      case 'thread-focus':
        videoFlex.value = withTiming(0, TIMING_CONFIG);
        threadFlex.value = withTiming(1, TIMING_CONFIG);
        break;
      case 'side-by-side':
        splitRatio.value = 0.55;
        if (fromOverlay) {
          videoFlex.value = 0.55;
          threadFlex.value = 0.45;
        } else {
          videoFlex.value = withTiming(0.55, TIMING_CONFIG);
          threadFlex.value = withTiming(0.45, TIMING_CONFIG);
        }
        break;
    }
  }, [layoutMode, videoFlex, threadFlex, splitRatio]);

  // SplitSeparator drag handler - updates flex values in real-time (no withTiming during drag)
  function handleSeparatorDrag(delta: number) {
    const size = orientation === 'portrait'
      ? containerSizeRef.current.height
      : containerSizeRef.current.width;
    if (size === 0) return;
    const ratioDelta = delta / size;
    const newRatio = Math.max(0.3, Math.min(0.7, splitRatio.value + ratioDelta));
    splitRatio.value = newRatio;
    videoFlex.value = newRatio;
    threadFlex.value = 1 - newRatio;
  }

  const isPortrait = orientation === 'portrait';
  const isOverlayMode = layoutMode === 'video-focus' || layoutMode === 'fullscreen-video';
  const isThreadFocus = layoutMode === 'thread-focus';
  const isSplit = layoutMode === 'split-view' || layoutMode === 'side-by-side';

  // Animated styles for flex values
  const videoAnimatedStyle = useAnimatedStyle(() => ({
    flex: videoFlex.value,
  }));

  const threadAnimatedStyle = useAnimatedStyle(() => ({
    flex: threadFlex.value,
  }));

  return (
    <View
      testID="view-layout-manager"
      style={[
        styles.root,
        !isPortrait && styles.rootLandscape,
      ]}
      onLayout={handleRootLayout}
    >
      {/* Video container - ALWAYS mounted, style changes per layout */}
      <Animated.View
        testID="video-container"
        style={[
          videoAnimatedStyle,
          isThreadFocus && styles.miniVideoCard,
        ]}
      >
        {videoContent}
      </Animated.View>

      {/* Split separator (split-view / side-by-side only) */}
      {isSplit && (
        <SplitSeparator
          orientation={orientation}
          onDrag={handleSeparatorDrag}
        />
      )}

      {/* Thread container - ALWAYS mounted, style changes per layout */}
      <Animated.View
        testID="thread-container"
        style={[
          threadAnimatedStyle,
          isThreadFocus && styles.flex1,
        ]}
        pointerEvents={isOverlayMode ? 'box-none' : 'auto'}
      >
        {threadContent}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: '#000',
  },
  rootLandscape: {
    flexDirection: 'row',
  },
  flex1: {
    flex: 1,
  },
  miniVideoCard: {
    height: 160,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(9,91,185,0.3)', // accent border
    overflow: 'hidden',
  },
});

// Re-export LayoutMode so callers that need it can import from here
export type { LayoutMode };
