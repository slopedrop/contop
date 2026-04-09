import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Edge = 'top' | 'bottom' | 'left' | 'right';

type ScreenContainerProps = {
  children: React.ReactNode;
  className?: string;
  edges?: Edge[];
};

export default function ScreenContainer({
  children,
  className = '',
  edges = ['top', 'bottom'],
}: ScreenContainerProps) {
  const insets = useSafeAreaInsets();

  // Only set padding for requested edges - omit others so className
  // padding (e.g. px-8) is not overridden by explicit 0 values
  const paddingStyle: Record<string, number> = {};
  if (edges.includes('top')) paddingStyle.paddingTop = insets.top;
  if (edges.includes('bottom')) paddingStyle.paddingBottom = insets.bottom;
  if (edges.includes('left')) paddingStyle.paddingLeft = insets.left;
  if (edges.includes('right')) paddingStyle.paddingRight = insets.right;

  return (
    <View className={`flex-1 bg-space-black ${className}`} style={paddingStyle}>
      {children}
    </View>
  );
}
