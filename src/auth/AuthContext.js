// ─────────────────────────────────────────
// Global auth state via React Context.
// Wrap the app once; useAuth() anywhere.
// ─────────────────────────────────────────

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, Linking } from 'react-native';
import { supabase } from '../lib/supabase';
import { geocodeZip } from '../lib/geocode';

// Where Supabase sends the user after they click the password-reset email.
// Web: back to wherever the app is running (localhost / Vercel / found.community)
//      — `detectSessionInUrl` then parses the recovery token from the URL hash.
// Native: a custom-scheme deep link the OS routes back into the app. The
//      `found` scheme must stay in sync with app.json -> expo.scheme.
// NOTE: every value this can return must also be added to Supabase ->
//      Authentication -> URL Configuration -> Redirect URLs, or the email
//      link will refuse to redirect.
export function passwordResetRedirectTo() {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && window.location
      ? window.location.origin
      : undefined;
  }
  return 'found://reset';
}

const AuthCtx = createContext({
  session: null,
  user: null,
  profile: null,
  loading: true,
  recoveryMode: false,
  signInWithPassword: async () => {},
  signUpWithPassword: async () => {},
  sendPasswordReset: async () => {},
  updatePassword: async () => {},
  cancelRecovery: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // recoveryMode is true between the moment a user opens a password-reset link
  // and the moment they set a new password. While true, the navigator forces
  // the "Set a new password" screen even though a (recovery) session exists —
  // otherwise the user would silently land in the app without ever resetting.
  const [recoveryMode, setRecoveryMode] = useState(false);
  // profileLoading is true while we're fetching the user's profile after a
  // session change. The navigator uses it to avoid flashing the Onboarding
  // screen for returning users between sign-in and profile fetch.
  const [profileLoading, setProfileLoading] = useState(false);

  // Bootstrap: read any existing session from AsyncStorage
  useEffect(() => {
    let mounted = true;

    // On web, if the URL hash contains a recovery token, do NOT clear loading
    // until PASSWORD_RECOVERY fires. Without this, getSession() returns null
    // while Supabase is still processing the hash async, loading flips false,
    // and the navigator briefly flashes the Splash/Auth screen before the
    // recovery session lands. Holding the spinner prevents that race.
    const hasWebRecoveryHash =
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      window.location.hash.includes('type=recovery');

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session ?? null);
      if (!hasWebRecoveryHash) {
        setLoading(false);
      } else {
        // Failsafe: if PASSWORD_RECOVERY never fires (bad token, etc.),
        // unblock the UI after 4s so the user isn't stuck on a spinner.
        setTimeout(() => { if (mounted) setLoading(false); }, 4000);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      // Fired by supabase-js on web when it parses a recovery token out of the
      // URL hash (detectSessionInUrl). On native we set this flag ourselves in
      // the deep-link effect below, since detectSessionInUrl is web-only.
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        // Clear loading now that we know it's a recovery flow — the navigator
        // will immediately render RecoveryStack instead of Splash/Auth.
        if (mounted) setLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ── Native deep-link handler ────────────────────────────────────────
  // On native, supabase-js does NOT parse auth tokens out of incoming URLs
  // (detectSessionInUrl is web-only). When the password-reset email link
  // routes back into the app via the `found://` scheme, the OS hands us a URL
  // like `found://reset#access_token=...&refresh_token=...&type=recovery`.
  // We parse the hash, establish the session, and flip recoveryMode so the
  // navigator shows the "Set a new password" screen.
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    let cancelled = false;

    async function handleUrl(url) {
      if (!url || url.indexOf('#') === -1) return;
      const hash = url.slice(url.indexOf('#') + 1);
      let params;
      try {
        params = new URLSearchParams(hash);
      } catch {
        return;
      }
      const accessToken  = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const linkType     = params.get('type');
      if (!accessToken || !refreshToken) return;

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (cancelled || error) return;
      if (linkType === 'recovery') setRecoveryMode(true);
    }

    // Cold start: the app was launched by the link.
    Linking.getInitialURL().then((url) => { if (!cancelled) handleUrl(url); });
    // Warm: the app was already open when the link was tapped.
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Whenever user changes, hydrate their profile row.
  // Set profileLoading=true at the start so the navigator can show a spinner
  // instead of guessing about onboarding state while the fetch is in flight.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!session?.user) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }
      setProfileLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled) {
        if (error) console.warn('[auth] profile fetch failed', error.message);
        setProfile(data ?? null);
        setProfileLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  // One-time location self-heal.
  // Accounts created before signup-geocoding (migration 0030) have a city/ZIP
  // but a NULL PostGIS `location`, so "Near Me" and the radius filter can't
  // place them. The first time such a profile loads we resolve its stored ZIP
  // to coordinates and persist the point — silently, in the background.
  // Idempotent: once `location` is set this never runs again, which is what
  // lets a user never re-enter their location after signup.
  useEffect(() => {
    if (!session?.user || !profile) return;
    if (profile.location) return;   // already geocoded — nothing to do
    if (!profile.zip) return;       // no ZIP to geocode from (Node backfill covers these)

    let cancelled = false;
    (async () => {
      const { lat, lng, error } = await geocodeZip(profile.zip);
      if (cancelled || error || lat == null || lng == null) return;

      const { error: rpcErr } = await supabase.rpc('set_profile_location', {
        p_lat: lat,
        p_lng: lng,
      });
      if (cancelled || rpcErr) return;

      // Re-pull the row so `profile.location` reflects the new point; this
      // effect then short-circuits on its next run.
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled && data) setProfile(data);
    })();

    return () => { cancelled = true; };
  }, [session?.user?.id, profile?.id, profile?.location, profile?.zip]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      profileLoading,
      recoveryMode,
      async signInWithPassword({ email, password }) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
      },
      async signUpWithPassword({ email, password, fullName, phone, zip, city, state, hometown, lat, lng }) {
        // Metadata keys MUST match the found.community website signup
        // (assets/auth.js) — the handle_new_user() trigger reads these keys to
        // populate the profiles row, so app + web signups must be identical.
        //
        // lat/lng are resolved from the ZIP at signup. The trigger (migration
        // 0030) turns them into the PostGIS `location` point — this is the ONE
        // place a user's location is captured. Sent as strings; absent/empty
        // -> trigger writes a NULL location (web signup, which omits coords).
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName ?? '',
              phone:     phone ?? '',
              zip:       zip ?? '',
              city:      city ?? '',
              state:     (state ?? '').toUpperCase(),
              hometown:  hometown ?? '',
              lat:       lat != null ? String(lat) : '',
              lng:       lng != null ? String(lng) : '',
            },
          },
        });
        if (error) throw error;
        return data;
      },
      // Send the "reset your password" email. Supabase intentionally does NOT
      // error when the email has no account (prevents account enumeration), so
      // the caller must show a neutral "if an account exists…" message.
      async sendPasswordReset({ email }) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: passwordResetRedirectTo(),
        });
        if (error) throw error;
      },
      // Set the new password. Requires the recovery session established when
      // the user opened the reset link. On success we clear recoveryMode — the
      // user now has a valid full session and the navigator routes them in.
      async updatePassword({ password }) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setRecoveryMode(false);
      },
      // Bail out of the reset flow (user opened the link but changed their
      // mind). Drops the recovery session so they're not left half-signed-in.
      async cancelRecovery() {
        setRecoveryMode(false);
        await supabase.auth.signOut();
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      async refreshProfile() {
        if (!session?.user) return;
        setProfileLoading(true);
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        setProfile(data ?? null);
        setProfileLoading(false);
      },
    }),
    [session, profile, loading, profileLoading, recoveryMode]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
