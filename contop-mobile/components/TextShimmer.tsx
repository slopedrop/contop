import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import Text from './Text';

type Props = {
  children: string;
  style?: TextStyle | TextStyle[];
  highlightColor?: string;
  duration?: number;
  numberOfLines?: number;
  testID?: string;
};

const HIGHLIGHT_RATIO = 0.4;

/**
 * Text with a sweeping shimmer highlight — a bright "window" slides left-to-right
 * across the text, matching the motion-primitives TextShimmer pattern.
 *
 * Uses only react-native-reanimated (no LinearGradient / MaskedView).
 * Base text shows normally; an absolutely-positioned clip window reveals the same
 * text in `highlightColor` as it sweeps across.
 */
export default function TextShimmer({
  children,
  style,
  highlightColor = '#FFFFFF',
  duration = 1500,
  numberOfLines,
  testID,
}: Props): React.JSX.Element {
  const [containerWidth, setContainerWidth] = useState(0);
  const sweepX = useSharedValue(0);

  const highlightWidth = containerWidth * HIGHLIGHT_RATIO;

  useEffect(() => {
    if (containerWidth <= 0) return;
    const hw = containerWidth * HIGHLIGHT_RATIO;
    sweepX.value = -hw;
    sweepX.value = withRepeat(
      withTiming(containerWidth, { duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
    return () => cancelAnimation(sweepX);
  }, [containerWidth, duration, sweepX]);

  const windowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweepX.value }],
  }));

  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -sweepX.value }],
  }));

  // Extract flex for the outer container so it lays out identically to a plain <Text>.
  // Strip flex from the text style — flex on <Text> inside the fixed-width sweep
  // overlay causes it to collapse to zero width, hiding the shimmer.
  const { flex, textStyle } = useMemo(() => {
    const flat = StyleSheet.flatten(style) ?? {};
    const { flex: f, ...rest } = flat as Record<string, unknown> & { flex?: number };
    return { flex: f, textStyle: rest as TextStyle };
  }, [style]);

  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={children}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      style={[s.container, flex != null && { flex }]}
    >
      {/* Base text — renders at the style's own color */}
      <Text style={textStyle} numberOfLines={numberOfLines}>
        {children}
      </Text>

      {/* Sweep highlight — a sliding clip window revealing bright text */}
      {containerWidth > 0 && (
        <Animated.View
          style={[s.sweep, { width: highlightWidth }, windowStyle]}
          pointerEvents="none"
        >
          <Animated.View style={[{ width: containerWidth }, innerStyle]}>
            <Text
              style={[textStyle, { color: highlightColor }]}
              numberOfLines={numberOfLines}
            >
              {children}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'relative',
  },
  sweep: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});
