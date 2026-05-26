import './src/lib/sentry';

import React from 'react';
import { View, ActivityIndicator, Platform, StyleSheet } from 'react-native';
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
  JetBrainsMono_400Regular,
} from '@expo-google-fonts/jetbrains-mono';
import AppNavigator from './src/navigation';
import { AuthProvider } from './src/auth/AuthContext';
import { ConfirmProvider } from './src/components/ConfirmProvider';

export default function App() {
  const [fontsLoaded] = useFonts({
    // Sans
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    // Serif headlines use Georgia (system font on iOS/web), no async load needed
    // Mono overlines
    JetBrainsMono_400Regular,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#1A1A1A" />
      </View>
    );
  }

  // FOUND is a phone-first product. On web, cap the app to a phone-width
  // column centered on a dark backdrop so it reads as an intentional device
  // frame instead of stretching edge-to-edge on desktop. On native this is a
  // no-op — `maxWidth` is undefined so the app fills the screen as normal.
  return (
    <SafeAreaProvider>
      <View style={styles.backdrop}>
        <View style={styles.phone}>
          <AuthProvider>
            <ConfirmProvider>
              <AppNavigator />
            </ConfirmProvider>
          </AuthProvider>
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const IS_WEB = Platform.OS === 'web';

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F7F4EF',
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: IS_WEB ? '#15140F' : '#F7F4EF',
  },
  phone: {
    flex: 1,
    width: '100%',
    maxWidth: IS_WEB ? 430 : undefined,
    backgroundColor: '#F7F4EF',
    overflow: 'hidden',
    ...(IS_WEB
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.45,
          shadowRadius: 40,
        }
      : null),
  },
});
