import { Stack } from 'expo-router';
import React from 'react';

export default function ConnectLayout(): React.JSX.Element {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#000000' },
        animation: 'fade',
      }}
    />
  );
}
