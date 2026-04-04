import React from 'react';
import { View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

type GlassPanelProps = {
  children: React.ReactNode;
  className?: string;
  intensity?: 'low' | 'medium' | 'high';
};

const BLUR_INTENSITY = {
  low: 30,
  medium: 60,
  high: 90,
} as const;

export default function GlassPanel({
  children,
  className = '',
  intensity = 'medium',
}: GlassPanelProps) {
  return (
    <View className={`bg-glass-dark/60 rounded-glass overflow-hidden ${className}`}>
      <BlurView
        intensity={BLUR_INTENSITY[intensity]}
        tint="dark"
        style={StyleSheet.absoluteFillObject}
      />
      {children}
    </View>
  );
}
