import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { RTCView, MediaStream } from 'react-native-webrtc';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

const VIDEO_ASPECT = 16 / 9;

interface RemoteScreenProps {
  stream: MediaStream | null;
  className?: string;
  children?: React.ReactNode;
  fillViewport?: boolean;
  /** When true: disables gesture handlers, uses objectFit cover, hides overlay children (mini card in Thread Focus) */
  compact?: boolean;
}

export default function RemoteScreen({
  stream,
  className,
  children,
  fillViewport = false,
  compact = false,
}: RemoteScreenProps): React.JSX.Element {
  // Use onLayout to measure actual container dimensions - supports split view where
  // useWindowDimensions() would return the full window, causing wrong aspect ratio
  const [containerWidth, setContainerWidth] = useState(1);
  const [containerHeight, setContainerHeight] = useState(1);

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) {
        setContainerWidth(width);
        setContainerHeight(height);
      }
    },
    [],
  );

  // Video display area (contain: 16:9 fits inside container, letterboxed)
  const containerAspect = containerWidth / containerHeight;
  const displayW =
    VIDEO_ASPECT > containerAspect ? containerWidth : containerHeight * VIDEO_ASPECT;
  const displayH =
    VIDEO_ASPECT > containerAspect ? containerWidth / VIDEO_ASPECT : containerHeight;

  // Scale at which the video fills the entire container (cover-equivalent)
  const fillScale = Math.max(containerWidth / displayW, containerHeight / displayH);
  const minScale = fillViewport ? fillScale : 1;
  const maxScale = fillViewport ? fillScale + 3 : 3;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Animate to new base zoom when toggling Full / Fit (full mode only)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (compact) return;
    const target = fillViewport ? fillScale : 1;
    scale.value = withTiming(target);
    savedScale.value = target;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [fillViewport, compact]);

  // Max allowed translation in screen-space pixels for a given axis
  const maxPan = (
    displaySize: number,
    viewportSize: number,
    s: number,
  ): number => {
    'worklet';
    return Math.max(0, (displaySize * s - viewportSize) / 2);
  };

  const clamp = (value: number, max: number): number => {
    'worklet';
    return Math.min(max, Math.max(-max, value));
  };

  // Elastic overscroll: 15% pull capped at 20px. Zero movement when max=0.
  const rubberBand = (value: number, max: number): number => {
    'worklet';
    if (max === 0) return 0;
    if (value > max) return max + Math.min((value - max) * 0.15, 20);
    if (value < -max) return -max - Math.min((-value - max) * 0.15, 20);
    return value;
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(maxScale, Math.max(minScale, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= minScale) {
        scale.value = withTiming(minScale);
        savedScale.value = minScale;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        const mX = maxPan(displayW, containerWidth, scale.value);
        const mY = maxPan(displayH, containerHeight, scale.value);
        const cx = clamp(translateX.value, mX);
        const cy = clamp(translateY.value, mY);
        translateX.value = withTiming(cx);
        translateY.value = withTiming(cy);
        savedTranslateX.value = cx;
        savedTranslateY.value = cy;
      }
    });

  const panGesture = Gesture.Pan()
    .activeOffsetX([-5, 5])
    .activeOffsetY([-5, 5])
    .onUpdate((e) => {
      const mX = maxPan(displayW, containerWidth, scale.value);
      const mY = maxPan(displayH, containerHeight, scale.value);
      if (mX > 0 || mY > 0) {
        translateX.value = rubberBand(
          savedTranslateX.value + e.translationX,
          mX,
        );
        translateY.value = rubberBand(
          savedTranslateY.value + e.translationY,
          mY,
        );
      }
    })
    .onEnd(() => {
      const mX = maxPan(displayW, containerWidth, scale.value);
      const mY = maxPan(displayH, containerHeight, scale.value);
      const cx = clamp(translateX.value, mX);
      const cy = clamp(translateY.value, mY);
      translateX.value = withTiming(cx);
      translateY.value = withTiming(cy);
      savedTranslateX.value = cx;
      savedTranslateY.value = cy;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      scale.value = withTiming(minScale);
      savedScale.value = minScale;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    });

  const gesture = Gesture.Race(
    Gesture.Simultaneous(pinchGesture, panGesture),
    doubleTapGesture,
  );

  // CRITICAL: translate BEFORE scale so translation is in screen-space pixels
  const animatedStyle = useAnimatedStyle(() => ({
    flex: 1,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!stream) {
    return (
      <View
        testID="remote-screen-fallback"
        className={`flex-1 bg-space-black ${className ?? ''}`}
        onLayout={handleLayout}
      >
        {children}
      </View>
    );
  }

  // Compact mode: simple RTCView with objectFit cover, no gesture handling
  if (compact) {
    return (
      <View
        testID="remote-screen-compact"
        style={styles.container}
      >
        <RTCView
          streamURL={stream.toURL()}
          objectFit="cover"
          zOrder={0}
          style={styles.rtcView}
          testID="rtc-view-compact"
        />
        {children && (
          <View style={styles.overlay} pointerEvents="box-none">
            {children}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container} testID="remote-screen-gesture-root" onLayout={handleLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={animatedStyle} testID="remote-screen-animated">
          <RTCView
            streamURL={stream.toURL()}
            objectFit="contain"
            zOrder={0}
            style={styles.rtcView}
            testID="rtc-view"
          />
        </Animated.View>
      </GestureDetector>
      {children && (
        <View style={styles.overlay} pointerEvents="box-none">
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  rtcView: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
});
