import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

type Props = {
  content: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Small copy-to-clipboard button with "copied" visual feedback.
 */
export default function CopyButton({ content, size = 16, color = '#6B7280', style }: Props) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    Clipboard.setStringAsync(content);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <Pressable
      testID="copy-button"
      onPress={handleCopy}
      hitSlop={8}
      style={({ pressed }) => [s.btn, pressed && { opacity: 0.5 }, style]}
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : 'Copy to clipboard'}
    >
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={size}
        color={copied ? '#22C55E' : color}
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    padding: 4,
  },
});
