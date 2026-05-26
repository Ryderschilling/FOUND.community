// ─────────────────────────────────────────────────────────────────────────
// sentry.js
//
// Initialize Sentry as early as possible (before any React render).
// Imported once from App.js. Safe to call multiple times — Sentry guards it.
//
// If EXPO_PUBLIC_SENTRY_DSN is not set, this module is a no-op so dev /
// preview builds without a DSN don't crash.
// ─────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? 'development' : 'production',
    release: Constants.expoConfig?.version ?? '0.0.0',

    // Performance sampling — keep low until you have traffic
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,

    // Strip anything that looks like PII before sending
    beforeSend(event) {
      if (event.user) {
        // Keep user id for grouping, drop email / IP
        event.user = { id: event.user.id };
      }
      // Scrub anything that looks like a JWT or Supabase anon key
      const scrub = (s) =>
        typeof s === 'string'
          ? s.replace(
              /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
              '[redacted-jwt]'
            )
          : s;
      if (event.message) event.message = scrub(event.message);
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = scrub(ex.value);
        }
      }
      return event;
    },
  });
}

export { Sentry };

/** Wrap an async function so any throw is sent to Sentry and rethrown. */
export function trackAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (DSN) Sentry.captureException(e);
      throw e;
    }
  };
}

/** Set the signed-in user id so events group by user. Never pass email. */
export function setSentryUser(userId) {
  if (!DSN) return;
  if (!userId) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: String(userId) });
}
