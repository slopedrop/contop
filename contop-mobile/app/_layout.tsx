import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  IBMPlexSans_300Light,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from "@expo-google-fonts/ibm-plex-sans";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { pruneOldSessions } from "../services/sessionStorage";
import useAIStore from "../stores/useAIStore";

SplashScreen.preventAutoHideAsync();

export default function RootLayout(): React.JSX.Element {
  const [fontsLoaded] = useFonts({
    IBMPlexSans_300Light,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
      // Prune old sessions on startup to prevent gradual storage bloat
      void pruneOldSessions();
      void useAIStore.getState().loadMobileAuthPreference();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return <View className="flex-1 bg-space-black" />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#000000' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(connect)" />
        <Stack.Screen name="(session)" />
        <Stack.Screen name="settings" />
      </Stack>
      <StatusBar style="light" />
    </GestureHandlerRootView>
  );
}
