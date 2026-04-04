import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import Text from './Text';
import ContopIcon from './ContopIcon';

export default function SplashContent(): React.JSX.Element {
  const barTranslateX = useSharedValue(-200);

  useEffect(() => {
    barTranslateX.value = withRepeat(
      withTiming(200, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [barTranslateX]);

  const barAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: barTranslateX.value }],
  }));

  return (
    <View testID="splash-content" className="items-center justify-center">
      <View testID="splash-logo">
        <ContopIcon size={72} color="#ffffff" />
      </View>
      <Text
        testID="splash-tagline"
        className="text-base text-gray-400 mt-3"
        style={{ fontFamily: 'IBMPlexSans_300Light' }}
      >
        Remote Compute Agent
      </Text>
      <View className="w-48 h-1 bg-white/10 rounded-full mt-8 overflow-hidden">
        <Animated.View
          testID="splash-loading-bar"
          className="w-24 h-full bg-space-blue rounded-full"
          style={barAnimatedStyle}
        />
      </View>
    </View>
  );
}
