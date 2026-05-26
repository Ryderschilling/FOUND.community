// ─────────────────────────────────────────
// Supabase client (React Native + Expo)
// ─────────────────────────────────────────
// SECURITY (2026-05): session tokens live in expo-secure-store on native
// (iOS Keychain / Android Keystore). AsyncStorage is unencrypted on
// Android (plain SQLite) — a stolen device or a malicious app with
// broad permissions can read the JWT and impersonate the user until
// refresh expires. Keychain/Keystore is the only acceptable home for
// auth tokens on a community app with religious + location PII.
//
// On web, expo-secure-store is unavailable; passing `undefined` lets
// supabase-js fall back to its default localStorage adapter.
//
// `react-native-url-polyfill` is required because supabase-js relies on the
// full WHATWG URL API which RN's stripped-down version lacks.

import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// SecureStore adapter conforming to the supabase-js GoTrueClient storage API.
// iOS Keychain has a ~2KB-per-item soft limit. Supabase JWTs are typically
// 700–1200 bytes and fit comfortably. If you ever add custom claims that
// blow past 2KB, swap this for a chunked adapter that stores an AES key
// in SecureStore and the encrypted token in AsyncStorage.
const SecureStoreAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loud in dev. In prod builds this should be impossible if env wiring is right.
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Create /found-app/.env using supabase/README.md → step 8, then restart `expo start --clear`.'
  );
}

export const supabase = createClient(SUPABASE_URL ?? 'http://invalid', SUPABASE_ANON_KEY ?? 'invalid', {
  auth: {
    // Native → Keychain/Keystore via expo-secure-store.
    // Web   → undefined → supabase-js uses localStorage (default).
    storage: Platform.OS === 'web' ? undefined : SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // detectSessionInUrl is for web (OAuth redirect). Safe to keep true.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// On native, pause/resume the refresh loop with app state. Without this, iOS
// will silently kill the refresh timer in the background and the user gets
// bounced to sign-in after a long sleep. No-op on web.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
