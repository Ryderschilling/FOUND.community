import './src/lib/sentry';

import React, { useEffect } from 'react';
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

// On web, lock the viewport so pinch-zoom and double-tap-zoom can't kick in.
// Without this, mobile Safari/Chrome will zoom into inputs on focus and let
// the user pinch the whole app, which is exactly the "feels like a webpage"
// behavior Sam flagged. We also block iOS rubber-band/overscroll and
// double-tap-to-zoom gestures.
function lockWebViewport() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  // 1) Viewport meta — overwrite Expo's default which allows scale.
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    document.head.appendChild(meta);
  }
  meta.setAttribute(
    'content',
    'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover'
  );

  // 2) CSS — disable overscroll bounce + iOS Safari double-tap zoom +
  //    text-size auto-adjust. touch-action: manipulation kills the 300ms
  //    double-tap-to-zoom delay across the whole app.
  const style = document.createElement('style');
  style.setAttribute('data-found-web-lock', '');
  style.textContent = `
    html, body, #root {
      overscroll-behavior: none;
      -webkit-text-size-adjust: 100%;
      touch-action: manipulation;
    }
    body { position: fixed; inset: 0; }
    input, textarea, select { font-size: 16px; }
  `;
  document.head.appendChild(style);

  // 3) Belt-and-suspenders: actively block multi-touch and gesture* events.
  //    iOS Safari fires `gesturestart` for pinches even when user-scalable=no
  //    is set if the page was added to the home screen with old metadata.
  const blockGesture = (e) => e.preventDefault();
  document.addEventListener('gesturestart',  blockGesture, { passive: false });
  document.addEventListener('gesturechange', blockGesture, { passive: false });
  document.addEventListener('gestureend',    blockGesture, { passive: false });
  document.addEventListener(
    'touchmove',
    (e) => { if (e.touches.length > 1) e.preventDefault(); },
    { passive: false }
  );
}

export default function App() {
  useEffect(() => { lockWebViewport(); }, []);

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
