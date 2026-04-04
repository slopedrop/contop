import React from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { Text } from './Text';
import type { ManualControlPayload, SuggestedAction } from '../types';

interface QuickActionBarProps {
  actions: SuggestedAction[];
  onAction: (payload: ManualControlPayload) => void;
  visible: boolean;
}

const ACTION_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  click: 'finger-print',
  right_click: 'ellipsis-horizontal-circle',
  scroll: 'swap-vertical',
  key_combo: 'keypad',
};

export default function QuickActionBar({ actions, onAction, visible }: QuickActionBarProps): React.JSX.Element | null {
  if (!visible || !actions || actions.length === 0) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOutDown.duration(150)}
      style={styles.container}
    >
      {actions.slice(0, 4).map((action, index) => {
        const iconName = action.icon
          ? (action.icon as keyof typeof Ionicons.glyphMap)
          : ACTION_ICONS[action.action] ?? 'flash';
        return (
          <TouchableOpacity
            key={`${action.label}-${index}`}
            testID={`quick-action-${index}`}
            style={styles.button}
            activeOpacity={0.7}
            onPress={() => onAction(action.payload)}
          >
            <Ionicons name={iconName} size={14} color="#ffffff" style={styles.icon} />
            <Text style={styles.label} numberOfLines={1}>{action.label}</Text>
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    gap: 6,
  },
  icon: {
    opacity: 0.8,
  },
  label: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
  },
});
