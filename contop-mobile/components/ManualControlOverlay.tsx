import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface ManualControlOverlayProps {
  sendMessage: (type: string, payload: Record<string, unknown>) => void;
  sendFastMessage: (type: string, payload: Record<string, unknown>) => void;
  onClose: () => void;
  visible: boolean;
}

// ── Joystick constants ──────────────────────────────────────────────────
const JOY_SIZE = 130;
const THUMB_SIZE = 52;
const MAX_RADIUS = (JOY_SIZE - THUMB_SIZE) / 2;
const MOVE_INTERVAL_MS = 33; // ~30fps
const SPEED_MULTIPLIER = 5; // pixels per tick at max displacement
const SCROLL_AMOUNT = 5; // wheel clicks per scroll event
const SCROLL_REPEAT_MS = 80; // interval for continuous scroll on long press

// ── Key shortcuts ───────────────────────────────────────────────────────
const KEY_SHORTCUTS: Array<{ label: string; keys: string[] }> = [
  { label: 'Esc', keys: ['escape'] },
  { label: 'Tab', keys: ['tab'] },
  { label: 'Enter', keys: ['enter'] },
  { label: 'Bksp', keys: ['backspace'] },
  { label: 'Del', keys: ['delete'] },
  { label: 'Copy', keys: ['ctrl', 'c'] },
  { label: 'Paste', keys: ['ctrl', 'v'] },
  { label: 'Undo', keys: ['ctrl', 'z'] },
  { label: 'Save', keys: ['ctrl', 's'] },
  { label: '←', keys: ['left'] },
  { label: '↑', keys: ['up'] },
  { label: '↓', keys: ['down'] },
  { label: '→', keys: ['right'] },
];

export default function ManualControlOverlay({
  sendMessage,
  sendFastMessage,
  visible,
}: ManualControlOverlayProps): React.JSX.Element | null {
  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.container}
      pointerEvents="box-none"
    >
      {/* Joystick — bottom left */}
      <View style={styles.joystickArea}>
        <Joystick sendFastMessage={sendFastMessage} />
      </View>

      {/* Right side — 2x2 grid: [L][▲] / [R][▼] */}
      <View style={styles.buttonGrid}>
        <View style={styles.buttonGridRow}>
          <LeftClickButton sendMessage={sendMessage} />
          <ScrollButton direction="up" sendMessage={sendMessage} />
        </View>
        <View style={styles.buttonGridRow}>
          <Pressable
            testID="manual-right-click"
            style={styles.rBtn}
            onPress={() => sendMessage('manual_control', { action: 'right_click' })}
          >
            <RNText style={styles.btnLabel}>R</RNText>
          </Pressable>
          <ScrollButton direction="down" sendMessage={sendMessage} />
        </View>
      </View>

      {/* Key shortcuts — bottom center strip */}
      <View style={styles.keysArea}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.keysRow}
        >
          {KEY_SHORTCUTS.map((shortcut) => (
            <Pressable
              key={shortcut.label}
              style={styles.keyPill}
              onPress={() =>
                sendMessage('manual_control', { action: 'key_combo', keys: shortcut.keys })
              }
            >
              <RNText style={styles.keyLabel}>{shortcut.label}</RNText>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

// ── Left click button — uses RNGH Manual gesture for simultaneous touch with joystick ──

function LeftClickButton({
  sendMessage,
}: {
  sendMessage: ManualControlOverlayProps['sendMessage'];
}) {
  const [held, setHeld] = useState(false);

  const handleDown = useCallback(() => {
    setHeld(true);
    sendMessage('manual_control', { action: 'mouse_down' });
  }, [sendMessage]);

  const handleUp = useCallback(() => {
    setHeld(false);
    sendMessage('manual_control', { action: 'mouse_up' });
  }, [sendMessage]);

  const gesture = Gesture.LongPress()
    .minDuration(0)
    .shouldCancelWhenOutside(false)
    .onStart(() => {
      runOnJS(handleDown)();
    })
    .onFinalize(() => {
      runOnJS(handleUp)();
    });

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.lBtn, held && styles.lBtnHeld]} testID="manual-left-click">
        <RNText style={styles.btnLabel}>L</RNText>
        <RNText style={styles.btnHint}>hold = drag</RNText>
      </View>
    </GestureDetector>
  );
}

// ── Scroll button — tap fires once, long-press repeats ──────────────────

const SCROLL_HOLD_DELAY_MS = 250; // delay before continuous repeat starts

function ScrollButton({
  direction,
  sendMessage,
}: {
  direction: 'up' | 'down';
  sendMessage: ManualControlOverlayProps['sendMessage'];
}) {
  const [held, setHeld] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireScroll = useCallback(() => {
    sendMessage('manual_control', { action: 'scroll', direction, amount: SCROLL_AMOUNT });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [sendMessage, direction]);

  const stopRepeat = useCallback(() => {
    if (delayRef.current) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setHeld(false);
  }, []);

  const startRepeat = useCallback(() => {
    stopRepeat(); // F4: clear any orphaned timers before starting
    setHeld(true);
    fireScroll(); // immediate first scroll on touch
    // F7: delay before continuous repeat so quick taps fire exactly once
    delayRef.current = setTimeout(() => {
      intervalRef.current = setInterval(fireScroll, SCROLL_REPEAT_MS);
    }, SCROLL_HOLD_DELAY_MS);
  }, [fireScroll, stopRepeat]);

  useEffect(() => {
    return () => {
      if (delayRef.current) clearTimeout(delayRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const gesture = Gesture.LongPress()
    .minDuration(0)
    .shouldCancelWhenOutside(false)
    .onStart(() => {
      runOnJS(startRepeat)();
    })
    .onFinalize(() => {
      runOnJS(stopRepeat)();
    });

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={`manual-scroll-${direction}`}
        style={[styles.scrollBtn, held && styles.scrollBtnHeld]}
      >
        <Ionicons
          name={direction === 'up' ? 'chevron-up' : 'chevron-down'}
          size={24}
          color="#fff"
        />
      </View>
    </GestureDetector>
  );
}

// ── Joystick sub-component ──────────────────────────────────────────────

function Joystick({
  sendFastMessage,
}: {
  sendFastMessage: ManualControlOverlayProps['sendFastMessage'];
}) {
  const joyX = useSharedValue(0);
  const joyY = useSharedValue(0);

  const joystickActiveRef = useRef(false);
  const joystickDeltaRef = useRef({ dx: 0, dy: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onJoystickUpdate = useCallback(
    (normX: number, normY: number) => {
      joystickDeltaRef.current = { dx: normX, dy: normY };
      if (!joystickActiveRef.current) {
        joystickActiveRef.current = true;
        intervalRef.current = setInterval(() => {
          const { dx, dy } = joystickDeltaRef.current;
          if (dx !== 0 || dy !== 0) {
            sendFastMessage('manual_control', {
              action: 'mouse_move',
              dx: Math.round(dx * SPEED_MULTIPLIER),
              dy: Math.round(dy * SPEED_MULTIPLIER),
            });
          }
        }, MOVE_INTERVAL_MS);
      }
    },
    [sendFastMessage],
  );

  const onJoystickEnd = useCallback(() => {
    joystickActiveRef.current = false;
    joystickDeltaRef.current = { dx: 0, dy: 0 };
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const joystickGesture = Gesture.Pan()
    .onUpdate((e) => {
      const dist = Math.sqrt(e.translationX ** 2 + e.translationY ** 2);
      const clamped = Math.min(dist, MAX_RADIUS);
      const angle = Math.atan2(e.translationY, e.translationX);
      const dx = clamped * Math.cos(angle);
      const dy = clamped * Math.sin(angle);
      joyX.value = dx;
      joyY.value = dy;
      runOnJS(onJoystickUpdate)(dx / MAX_RADIUS, dy / MAX_RADIUS);
    })
    .onEnd(() => {
      joyX.value = withTiming(0, { duration: 100 });
      joyY.value = withTiming(0, { duration: 100 });
      runOnJS(onJoystickEnd)();
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: joyX.value }, { translateY: joyY.value }],
  }));

  return (
    <GestureDetector gesture={joystickGesture}>
      <View style={joyStyles.outer}>
        <Animated.View style={[joyStyles.thumb, thumbStyle]} />
      </View>
    </GestureDetector>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────
//
// Layout (landscape):
//   ┌──────────────────────────────────────────────────────────┐
//   │                                                          │
//   │   ┌─────┐                              ┌────┐ ┌──┐      │
//   │   │     │   [keys scroll strip]        │ L  │ │▲ │      │
//   │   │  ○  │                              ├────┤ ├──┤      │
//   │   │     │                              │ R  │ │▼ │      │
//   │   └─────┘       [ HUD PILL ]           └────┘ └──┘      │
//   └──────────────────────────────────────────────────────────┘

const BTN_W = 110;
const BTN_H = 64;
const SCROLL_W = 48;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },

  // Joystick — bottom left
  joystickArea: {
    position: 'absolute',
    bottom: 12,
    left: 20,
  },

  // 2×2 grid: [L][▲] / [R][▼]
  buttonGrid: {
    position: 'absolute',
    bottom: 12,
    right: 16,
    gap: 8,
  },
  buttonGridRow: {
    flexDirection: 'row',
    gap: 8,
  },

  // L button — large, supports hold-to-drag
  lBtn: {
    width: BTN_W,
    height: BTN_H,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lBtnHeld: {
    backgroundColor: 'rgba(217,119,6,0.5)',
    borderColor: 'rgba(217,119,6,0.8)',
  },

  // R button — same size as L
  rBtn: {
    width: BTN_W,
    height: BTN_H,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  btnLabel: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  btnHint: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 9,
    marginTop: 1,
  },

  // Scroll buttons
  scrollBtn: {
    width: SCROLL_W,
    height: BTN_H,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.40)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBtnHeld: {
    backgroundColor: 'rgba(59,130,246,0.45)',
    borderColor: 'rgba(59,130,246,0.7)',
  },

  // Keys — between joystick and buttons, above pill
  keysArea: {
    position: 'absolute',
    bottom: 56,
    left: 164,
    right: BTN_W + SCROLL_W + 16 + 8 + 16, // button grid width + gap + right margin
  },
  keysRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  keyPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.40)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    minWidth: 48,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '500',
  },
});

const joyStyles = StyleSheet.create({
  outer: {
    width: JOY_SIZE,
    height: JOY_SIZE,
    borderRadius: JOY_SIZE / 2,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});
