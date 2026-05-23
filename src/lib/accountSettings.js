// ─────────────────────────────────────────────────────────────────────────
// accountSettings.js
//
// Read/write helper for the Profile → Settings screens.
//   - fetchAccountSettings()        → current prefs (+ city/state)
//   - saveNotificationPrefs(prefs)  → persist the notifications group
//   - savePrivacyPrefs(prefs)       → persist the privacy group
//   - saveDiscoveryRadius(miles)    → persist the discovery radius
//
// Backed by migration 0025: account_settings() + update_account_settings().
// ─────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase';

// Defaults — used when a profile predates the columns, or a jsonb group is {}.
export const DEFAULT_NOTIFICATION_PREFS = {
  new_messages:   true,
  connections:    true,
  group_posts:    true,
  group_messages: true,
};

export const DEFAULT_PRIVACY_PREFS = {
  discoverable:  true,
  show_church:   true,
  show_location: true,
};

export const DEFAULT_RADIUS = 50; // miles; 0 = Anywhere

/**
 * Load the caller's settings. Always returns a fully-populated object — any
 * missing keys fall back to the defaults above so the UI never sees undefined.
 * @returns {Promise<{ settings: object, error: Error|null }>}
 */
export async function fetchAccountSettings() {
  const { data, error } = await supabase.rpc('account_settings');
  if (error) {
    return {
      settings: {
        notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
        privacyPrefs:      { ...DEFAULT_PRIVACY_PREFS },
        radius:            DEFAULT_RADIUS,
        city:              null,
        state:             null,
      },
      error,
    };
  }
  const row = (data ?? [])[0] ?? {};
  return {
    settings: {
      notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...(row.notification_prefs ?? {}) },
      privacyPrefs:      { ...DEFAULT_PRIVACY_PREFS,      ...(row.privacy_prefs ?? {}) },
      radius:            typeof row.discovery_radius_miles === 'number'
                           ? row.discovery_radius_miles
                           : DEFAULT_RADIUS,
      city:              row.city ?? null,
      state:             row.state ?? null,
    },
    error: null,
  };
}

export async function saveNotificationPrefs(prefs) {
  const { error } = await supabase.rpc('update_account_settings', {
    p_notification_prefs: prefs,
  });
  return { error };
}

export async function savePrivacyPrefs(prefs) {
  const { error } = await supabase.rpc('update_account_settings', {
    p_privacy_prefs: prefs,
  });
  return { error };
}

export async function saveDiscoveryRadius(miles) {
  const { error } = await supabase.rpc('update_account_settings', {
    p_discovery_radius_miles: miles,
  });
  return { error };
}
