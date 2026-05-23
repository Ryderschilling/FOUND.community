// ─────────────────────────────────────────────────────────────────────────
// push.js
//
// OS-level push notifications (the banner on the lock screen / app icon
// badge). The in-app feed lives in lib/notifications.js — this file is only
// about the native push channel.
//
// How it fits together:
//   1. registerForPush()  → asks permission, gets an Expo push token, stores
//                            it server-side via the register_push_token RPC.
//   2. The DB trigger from migration 0028 POSTs to Expo whenever a
//      `notifications` row is inserted.
//   3. attachNotificationResponseListener() → routes a tapped notification
//      to the right screen.
//
// Push is native-only. On web — and on a simulator, or before the native
// modules are installed — every export here is a guarded no-op, so the app
// never crashes and nothing needs editing when the native build ships.
// ─────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import { supabase } from './supabase';

// Last token we registered — kept so we can unregister it on sign-out.
let _cachedToken = null;

// ─── Lazy native-module load ───────────────────────────────────────────────
// require() inside a try/catch so a missing/uninstalled package, or the web
// bundle, can never white-screen the app. Push simply stays dormant.
function loadModules() {
  if (Platform.OS === 'web') return null;
  try {
    return {
      Notifications: require('expo-notifications'),
      Device: require('expo-device'),
      Constants: require('expo-constants').default,
    };
  } catch (e) {
    console.warn('[push] native modules unavailable:', e?.message);
    return null;
  }
}

// ─── Foreground display behaviour ──────────────────────────────────────────
// Without this, notifications that arrive while the app is open are silently
// swallowed. Call once at app start.
export function configureNotificationHandler() {
  const m = loadModules();
  if (!m) return;
  m.Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

// ─── Register this device ──────────────────────────────────────────────────
// Safe to call on every launch. Returns the Expo push token, or null if push
// isn't available / permission was denied.
export async function registerForPush() {
  const m = loadModules();
  if (!m) return null;
  const { Notifications, Device, Constants } = m;

  // Simulators / emulators can't receive a real push token.
  if (!Device.isDevice) return null;

  // Android requires a channel before any notification will display.
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#5A7A4A',
      });
    } catch (e) {
      console.warn('[push] could not set Android channel:', e?.message);
    }
  }

  // Permission — ask only if not already decided.
  let status;
  try {
    const existing = await Notifications.getPermissionsAsync();
    status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
  } catch (e) {
    console.warn('[push] permission check failed:', e?.message);
    return null;
  }
  if (status !== 'granted') return null;

  // EAS project id — auto-written into app.json by `eas init` / `eas build`.
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId ??
    null;

  let token;
  try {
    const resp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    token = resp?.data ?? null;
  } catch (e) {
    console.warn('[push] could not get Expo push token:', e?.message);
    return null;
  }
  if (!token) return null;
  _cachedToken = token;

  // Store it server-side. Idempotent — the RPC upserts on the token.
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS,
  });
  if (error) console.warn('[push] register_push_token failed:', error.message);

  return token;
}

// ─── Unregister on sign-out ────────────────────────────────────────────────
// Stops the device receiving pushes for the account that just left it.
export async function unregisterForPush() {
  if (!_cachedToken) return;
  try {
    await supabase.rpc('unregister_push_token', { p_token: _cachedToken });
  } catch (e) {
    // Non-fatal — the next account's registerForPush() re-points the token.
    console.warn('[push] unregister failed:', e?.message);
  }
  _cachedToken = null;
}

// ─── Deep-link routing ─────────────────────────────────────────────────────
// Mirrors NotificationsFeedScreen.handleOpen so a tapped push lands on the
// same screen the in-app feed would.
export function routeFromNotificationData(navigationRef, data) {
  if (!navigationRef || !data) return;
  if (typeof navigationRef.isReady === 'function' && !navigationRef.isReady()) {
    return;
  }

  const { type, entity_id } = data;

  if (type === 'direct_message' && entity_id) {
    navigationRef.navigate('Chat', {
      thread_id: entity_id,
      other: {
        id: data.actor_id,
        full_name: data.actor_name,
        avatar_url: data.actor_avatar_url,
      },
    });
  } else if ((type === 'group_message' || type === 'group_post') && entity_id) {
    navigationRef.navigate('GroupDetail', { groupId: entity_id });
  } else {
    // connection / match → Activity tab (Accept / Dismiss live there)
    navigationRef.navigate('Main', { screen: 'Activity' });
  }
}

// ─── Tap listener ──────────────────────────────────────────────────────────
// Handles taps while the app is foreground/background, plus the cold-start
// case (app launched by tapping a notification). Returns an unsubscribe fn.
export function attachNotificationResponseListener(navigationRef) {
  const m = loadModules();
  if (!m) return () => {};
  const { Notifications } = m;

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response?.notification?.request?.content?.data;
    routeFromNotificationData(navigationRef, data);
  });

  // Cold start — the navigation tree may still be mounting, so give it a beat.
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      const data = response?.notification?.request?.content?.data;
      if (data) {
        setTimeout(() => routeFromNotificationData(navigationRef, data), 600);
      }
    })
    .catch(() => {});

  return () => {
    try { sub.remove(); } catch (e) { /* noop */ }
  };
}

// Configure foreground display as soon as this module is imported.
configureNotificationHandler();
