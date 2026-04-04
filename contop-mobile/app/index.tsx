import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { getPairingToken } from '../services/secureStorage';

/**
 * Entry point — connection flow controller.
 * Checks stored token + credentials to determine routing:
 *   - Token + (any API key OR subscription provider) → splash → reconnecting
 *   - Token but no keys/subscriptions → splash → connect (with message)
 *   - No token → splash (full) → connect
 */
export default function HomeScreen(): React.JSX.Element {
  const router = useRouter();

  useEffect(() => {
    checkStoredCredentials();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  async function checkStoredCredentials() {
    const token = await getPairingToken();

    if (!token) {
      // No stored token — first launch flow
      router.replace({
        pathname: '/(connect)/splash',
        params: { next: 'connect' },
      });
      return;
    }

    // Valid token — returning user flow
    router.replace({
      pathname: '/(connect)/splash',
      params: { next: 'reconnecting' },
    });
  }

  // Show black screen while checking (native splash still visible)
  return <View className="flex-1 bg-space-black" />;
}
