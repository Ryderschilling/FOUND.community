import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import {
  JetBrainsMono_400Regular,
} from '@expo-google-fonts/jetbrains-mono';
import AppNavigator from './src/navigation';

export default function App() {
  const [fontsLoaded] = useFonts({
    // Sans
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    // Serif headlines
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    // Mono overlines
    JetBrainsMono_400Regular,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F7F4EF' }}>
        <ActivityIndicator color="#1A1A1A" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
