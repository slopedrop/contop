import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Text } from '../../components';
import SplashContent from '../../components/SplashContent';

export default function SplashScreen(): React.JSX.Element {
  const router = useRouter();
  const { next, message } = useLocalSearchParams<{ next?: string; message?: string }>();

  useEffect(() => {
    // Determine splash duration based on routing context
    // Returning user (reconnecting): abbreviated 0.5s
    // First launch / fallback: full 1.5s
    const duration = next === 'reconnecting' ? 500 : 1500;

    const timer = setTimeout(() => {
      if (next === 'reconnecting') {
        router.replace('/(connect)/reconnecting');
      } else if (next === 'connect') {
        router.replace({
          pathname: '/(connect)/connect',
          params: message ? { message } : undefined,
        });
      } else {
        router.replace('/(connect)/connect');
      }
    }, duration);

    return () => clearTimeout(timer);
  }, [next, message, router]);

  return (
    <View testID="splash-screen" className="flex-1 bg-space-black items-center justify-center">
      <SplashContent />
    </View>
  );
}
