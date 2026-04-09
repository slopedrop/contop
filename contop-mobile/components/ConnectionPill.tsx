import React from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Text from './Text';
import type { ConnectionStatus, ConnectionPath } from '../types';

const PATH_LABELS: Record<ConnectionPath, string> = {
  lan: 'LAN',
  tailscale: 'Tailscale',
  tunnel: 'Tunnel',
  unknown: '',
};

type ConnectionPillProps = {
  status: ConnectionStatus;
  latencyMs?: number | null;
  connectionPath?: ConnectionPath;
};

const DOT_COLORS: Record<ConnectionStatus, string> = {
  connected: '#22C55E',
  connecting: '#F59E0B',
  reconnecting: '#F59E0B',
  disconnected: '#EF4444',
};

export default function ConnectionPill({
  status,
  latencyMs,
  connectionPath,
}: ConnectionPillProps): React.JSX.Element {
  const pulseOpacity = useSharedValue(1);

  React.useEffect(() => {
    if (status === 'connected') {
      pulseOpacity.value = withRepeat(
        withTiming(0.3, { duration: 1200 }),
        -1,
        true,
      );
    } else {
      pulseOpacity.value = 1;
    }
  }, [status, pulseOpacity]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const latencyText =
    status === 'connected' && latencyMs != null ? `${latencyMs}ms` : '-';

  const pathLabel =
    status === 'connected' && connectionPath
      ? PATH_LABELS[connectionPath]
      : '';

  const label =
    status === 'connected' && latencyMs != null
      ? `Connection status: connected via ${pathLabel || 'unknown'}, latency ${latencyMs} milliseconds`
      : `Connection status: ${status}`;

  return (
    <View
      testID="connection-pill"
      className="flex-row items-center bg-black/40 rounded-full px-3 py-1.5"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <Animated.View
        testID="connection-dot"
        className="w-2 h-2 rounded-full mr-2"
        style={[{ backgroundColor: DOT_COLORS[status] }, dotStyle]}
      />
      <Text className="text-xs text-gray-300">{latencyText}</Text>
      {pathLabel ? (
        <Text testID="connection-path-label" className="text-xs text-gray-500 ml-1">
          {pathLabel}
        </Text>
      ) : null}
    </View>
  );
}
