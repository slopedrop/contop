import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useDerivedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import Text from './Text';

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface AuroraVoiceProps {
  audioLevel: SharedValue<number>;
  recordingSeconds: number;
  onCancel: () => void;
  onSend: () => void;
}

const WAVE_HEIGHT = 60;
const STEPS = 60;

const WAVE_LINES = [
  { color: '#095BB9', phaseOffset: 0, ampScale: 1.0, freq: 2.5 },
  { color: '#3B82F6', phaseOffset: Math.PI * 0.4, ampScale: 0.7, freq: 3.0 },
  { color: '#06B6D4', phaseOffset: Math.PI * 0.9, ampScale: 0.85, freq: 2.0 },
  { color: '#7C3AED', phaseOffset: Math.PI * 1.4, ampScale: 0.6, freq: 3.5 },
];

function WaveLine({
  width,
  audioLevel,
  phase,
  config,
}: {
  width: number;
  audioLevel: SharedValue<number>;
  phase: SharedValue<number>;
  config: typeof WAVE_LINES[number];
}) {
  const pathD = useDerivedValue(() => {
    const centerY = WAVE_HEIGHT / 2;
    const baseAmp = 4;
    const audioAmp = audioLevel.value * 18;
    const amp = (baseAmp + audioAmp) * config.ampScale;
    const freq = (config.freq * 2 * Math.PI) / width;

    let d = '';
    for (let i = 0; i <= STEPS; i++) {
      const x = (i / STEPS) * width;
      const y = centerY + amp * Math.sin(freq * x + phase.value + config.phaseOffset);
      d += i === 0 ? `M${x.toFixed(0)},${y.toFixed(1)}` : `L${x.toFixed(0)},${y.toFixed(1)}`;
    }
    return d;
  });

  const glowProps = useAnimatedProps(() => ({ d: pathD.value }));
  const coreProps = useAnimatedProps(() => ({ d: pathD.value }));

  return (
    <>
      <AnimatedPath
        animatedProps={glowProps}
        stroke={config.color}
        strokeWidth={6}
        strokeOpacity={0.15}
        fill="none"
        strokeLinecap="round"
      />
      <AnimatedPath
        animatedProps={coreProps}
        stroke={config.color}
        strokeWidth={2}
        strokeOpacity={0.85}
        fill="none"
        strokeLinecap="round"
      />
    </>
  );
}

export default function AuroraVoice({
  audioLevel,
  recordingSeconds,
  onCancel,
  onSend,
}: AuroraVoiceProps) {
  const reducedMotion = useReducedMotion();
  const phase = useSharedValue(0);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    phase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 3000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [reducedMotion, phase]);

  const handleLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  const durationText = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`;

  return (
    <View
      testID="aurora-voice"
      accessibilityLabel="Voice recording active"
      style={styles.container}
    >
      <View
        testID="aurora-waveform"
        style={styles.waveformContainer}
        onLayout={handleLayout}
        pointerEvents="none"
      >
        {containerWidth > 0 && (
          <Svg width={containerWidth} height={WAVE_HEIGHT}>
            {WAVE_LINES.map((config, index) => (
              <WaveLine
                key={index}
                width={containerWidth}
                audioLevel={audioLevel}
                phase={phase}
                config={config}
              />
            ))}
          </Svg>
        )}
      </View>
      <View style={styles.controlRow}>
        <Pressable testID="aurora-cancel-button" onPress={onCancel} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Text testID="aurora-duration" accessibilityRole="timer" style={styles.durationText}>
          {durationText}
        </Text>
        <Pressable testID="aurora-send-button" onPress={onSend} style={styles.sendButton}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 8,
  },
  waveformContainer: {
    width: '100%',
    height: WAVE_HEIGHT,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  cancelButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  durationText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  sendButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    backgroundColor: '#095BB9',
    borderRadius: 12,
  },
  sendText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
});
