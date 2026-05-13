// ─────────────────────────────────────────
// Supabase client (React Native + Expo)
// ─────────────────────────────────────────
// Uses AsyncStorage for session persistence (the default in-memory store
// is dropped on app restart).
// `react-native-url-polyfill` is required because supabase-js relies on the
// full WHATWG URL API which RN's stripped-down version lacks.

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

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
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // detectSessionInUrl is for web (OAuth redirect). Safe to keep true.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
