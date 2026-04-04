import React from 'react';
import Svg, { Rect, Polyline, Line } from 'react-native-svg';

interface ContopIconProps {
  size?: number;
  color?: string;
  bgColor?: string;
}

/**
 * Contop brand icon — mobile device behind desktop screen with terminal prompt.
 * Square composition: phone height = total base width.
 * Phone 1:2, desktop 16:10, desktop occludes phone where they overlap.
 */
export default function ContopIcon({
  size = 48,
  color = '#ffffff',
  bgColor = '#000000',
}: ContopIconProps): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      {/* Mobile device (behind, taller) — 150x300, 1:2 ratio */}
      <Rect
        x={106} y={106} width={150} height={300} rx={14}
        stroke={color} strokeWidth={36} fill={bgColor}
      />
      {/* Desktop screen (foreground, wider) — 240x150, 16:10 ratio */}
      <Rect
        x={166} y={256} width={240} height={150} rx={12}
        stroke={color} strokeWidth={36} fill={bgColor}
      />
      {/* Terminal prompt ">" */}
      <Polyline
        points="226,298 270,331 226,364"
        stroke={color} strokeWidth={28}
        strokeLinecap="round" strokeLinejoin="round"
        fill="none"
      />
      {/* Underscore cursor "_" */}
      <Line
        x1={288} y1={364} x2={356} y2={364}
        stroke={color} strokeWidth={28}
        strokeLinecap="round"
      />
    </Svg>
  );
}
