import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  withSpring,
  withRepeat,
  cancelAnimation,
  Easing,
  useReducedMotion,
  SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Text from './Text';
import type { AIState } from '../types';

type VoiceVisualizerProps = {
  aiState: AIState;
  audioLevel: SharedValue<number>;
  className?: string;
};

const STATE_LABELS: Record<AIState, string> = {
  idle: 'ready',
  listening: 'listening to your voice',
  recording: 'recording your voice',
  processing: 'processing your request',
  executing: 'executing command',
  sandboxed: 'awaiting your approval for a sandboxed command',
  disconnected: 'disconnected',
};

const REDUCED_MOTION_LABELS: Record<AIState, string> = {
  idle: 'Ready',
  listening: 'Listening...',
  recording: 'Recording...',
  processing: 'Processing...',
  executing: 'Executing...',
  sandboxed: 'Sandbox Alert',
  disconnected: 'Disconnected',
};

function IdleAnimation() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.15, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    opacity.value = withRepeat(
      withTiming(0.5, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [scale, opacity]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View testID="visualizer-idle" className="items-center justify-center">
      <Animated.View
        style={glowStyle}
        className="absolute w-[64px] h-[64px] rounded-full border-2 border-space-blue/30"
      />
      <Animated.View
        style={orbStyle}
        className="w-[48px] h-[48px] rounded-full bg-space-blue"
      />
    </View>
  );
}

function ListeningAnimation({ audioLevel }: { audioLevel: SharedValue<number> }) {
  const bars = [0, 1, 2, 3, 4, 5, 6];

  return (
    <View testID="visualizer-listening" className="flex-row items-center justify-center gap-[4px]">
      {bars.map((index) => (
        <ListeningBar key={index} index={index} audioLevel={audioLevel} />
      ))}
    </View>
  );
}

function ListeningBar({ index, audioLevel }: { index: number; audioLevel: SharedValue<number> }) {
  // Center bar (3) gets full amplitude, edges get reduced
  const amplitudeScale = 1 - Math.abs(index - 3) * 0.12;

  const barHeight = useDerivedValue(() => {
    const amplitude = audioLevel.value * amplitudeScale;
    const targetHeight = 8 + amplitude * 48; // min 8, max 56
    return targetHeight;
  });

  const barStyle = useAnimatedStyle(() => ({
    height: withSpring(barHeight.value, { damping: 12, stiffness: 150 }),
    opacity: withSpring(0.5 + audioLevel.value * 0.5, { damping: 12, stiffness: 150 }),
  }));

  return (
    <Animated.View
      style={[{ width: 4, borderRadius: 2 }, barStyle]}
      className="bg-space-blue"
    />
  );
}

function ProcessingAnimation() {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 800, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View testID="visualizer-processing" className="items-center justify-center">
      <Animated.View
        style={ringStyle}
        className="w-[56px] h-[56px] rounded-full border-[3px] border-space-blue border-t-transparent"
      />
      <View className="absolute w-[8px] h-[8px] rounded-full bg-space-blue" />
    </View>
  );
}

function ExecutingAnimation() {
  const scale = useSharedValue(1);
  const rippleScale = useSharedValue(1);
  const rippleOpacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.3, { duration: 1000, easing: Easing.out(Easing.quad) }),
      -1,
      true,
    );
    rippleScale.value = withRepeat(
      withTiming(2.0, { duration: 1000, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    rippleOpacity.value = withRepeat(
      withTiming(0, { duration: 1000, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(rippleScale);
      cancelAnimation(rippleOpacity);
    };
  }, [scale, rippleScale, rippleOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rippleScale.value }],
    opacity: rippleOpacity.value,
  }));

  return (
    <View testID="visualizer-executing" className="items-center justify-center">
      <Animated.View
        style={rippleStyle}
        className="absolute w-[48px] h-[48px] rounded-full border-2 border-space-blue"
      />
      <Animated.View
        style={pulseStyle}
        className="w-[48px] h-[48px] rounded-full bg-space-blue/80"
      />
    </View>
  );
}

function SandboxedAnimation() {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.4, { duration: 600, easing: Easing.out(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(scale);
    };
  }, [scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View testID="visualizer-sandboxed" className="items-center justify-center">
      <Animated.View
        style={pulseStyle}
        className="w-[48px] h-[48px] rounded-full bg-amber-warn"
      />
    </View>
  );
}

function DisconnectedIndicator() {
  return (
    <View testID="visualizer-disconnected" className="items-center justify-center">
      <View className="w-[48px] h-[48px] rounded-full bg-glass-dark opacity-40 items-center justify-center">
        <Text className="text-lg text-white/60">×</Text>
      </View>
    </View>
  );
}

function ReducedMotionIndicator({ aiState }: { aiState: AIState }) {
  const isAmber = aiState === 'sandboxed';
  const colorClass = isAmber ? 'bg-amber-warn' : 'bg-space-blue';
  const label = REDUCED_MOTION_LABELS[aiState];

  return (
    <View testID="visualizer-reduced-motion" className="items-center justify-center">
      <View className={`w-[48px] h-[48px] rounded-full ${colorClass} ${aiState === 'disconnected' ? 'opacity-40' : ''}`} />
      <Text className="text-sm text-white mt-2u">{label}</Text>
    </View>
  );
}

export default function VoiceVisualizer({ aiState, audioLevel, className }: VoiceVisualizerProps) {
  const reducedMotion = useReducedMotion();
  const prevStateRef = useRef<AIState>(aiState);
  const transitionOpacity = useSharedValue(1);

  // Haptic feedback + crossfade transition on state changes
  useEffect(() => {
    if (aiState === 'sandboxed' && prevStateRef.current !== 'sandboxed') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    // Crossfade: fade in the new state over 100ms (skip for reduced motion)
    if (prevStateRef.current !== aiState && !reducedMotion) {
      transitionOpacity.value = 0;
      transitionOpacity.value = withTiming(1, { duration: 100 });
    }
    prevStateRef.current = aiState;
  }, [aiState, reducedMotion, transitionOpacity]);

  const transitionStyle = useAnimatedStyle(() => ({
    opacity: transitionOpacity.value,
  }));

  const accessibilityLabel = `AI assistant is ${STATE_LABELS[aiState]}`;
  const isBusy = aiState === 'processing' || aiState === 'executing';

  function renderVisualizer() {
    if (reducedMotion) {
      return <ReducedMotionIndicator aiState={aiState} />;
    }

    switch (aiState) {
      case 'idle':
        return <IdleAnimation />;
      case 'listening':
      case 'recording':
        return <ListeningAnimation audioLevel={audioLevel} />;
      case 'processing':
        return <ProcessingAnimation />;
      case 'executing':
        return <ExecutingAnimation />;
      case 'sandboxed':
        return <SandboxedAnimation />;
      case 'disconnected':
        return <DisconnectedIndicator />;
    }
  }

  return (
    <View
      testID="voice-visualizer"
      className={`items-center ${className ?? ''}`}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: isBusy }}
    >
      <Animated.View style={transitionStyle} className="w-[160px] h-[80px] items-center justify-center">
        {renderVisualizer()}
      </Animated.View>
    </View>
  );
}
