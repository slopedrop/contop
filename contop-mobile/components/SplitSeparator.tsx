import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { Orientation } from '../types';

type SplitSeparatorProps = {
  orientation: Orientation;
  onDrag: (delta: number) => void;
};

/**
 * Draggable separator between video and thread panels.
 * Portrait: horizontal pill, reports Y-delta (incremental).
 * Landscape: vertical pill, reports X-delta (incremental).
 *
 * Uses onChange (not onUpdate) so each callback receives the incremental
 * delta since the previous event - prevents the cumulative-translation
 * drift bug that caused jerky/snapping behavior.
 */
export default function SplitSeparator({ orientation, onDrag }: SplitSeparatorProps): React.JSX.Element {
  const isPortrait = orientation === 'portrait';

  const panGesture = Gesture.Pan()
    .minDistance(4)
    .onChange((e) => {
      runOnJS(onDrag)(isPortrait ? e.changeY : e.changeX);
    });

  return (
    <GestureDetector gesture={panGesture}>
      <View
        testID="split-separator"
        style={isPortrait ? styles.containerHorizontal : styles.containerVertical}
        hitSlop={isPortrait ? { top: 10, bottom: 10 } : { left: 10, right: 10 }}
      >
        <View style={isPortrait ? styles.lineHorizontal : styles.lineVertical} />
        <View
          testID={isPortrait ? 'split-separator-pill-horizontal' : 'split-separator-pill-vertical'}
          style={isPortrait ? styles.pillHorizontal : styles.pillVertical}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  containerHorizontal: {
    width: '100%',
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  containerVertical: {
    width: 20,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  lineHorizontal: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.06)',
    width: '100%',
    height: 1,
  },
  lineVertical: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.06)',
    width: 1,
    height: '100%',
  },
  pillHorizontal: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pillVertical: {
    width: 4,
    height: 40,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});
