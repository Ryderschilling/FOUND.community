// ─────────────────────────────────────────
// Global auth state via React Context.
// Wrap the app once; useAuth() anywhere.
// ─────────────────────────────────────────

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthCtx = createContext({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signInWithPassword: async () => {},
  signUpWithPassword: async () => {},
  signInWithMagicLink: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: read any existing session from AsyncStorage
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Whenever user changes, hydrate their profile row
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!session?.user) {
        setProfile(null);
        return;
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled) {
        if (error) console.warn('[auth] profile fetch failed', error.message);
        setProfile(data ?? null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      async signInWithPassword({ email, password }) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
      },
      async signUpWithPassword({ email, password, fullName }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName ?? '' } },
        });
        if (error) throw error;
        return data;
      },
      async signInWithMagicLink({ email }) {
        const { error } = await supabase.auth.signInWithOtp({ email });
        if (error) throw error;
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      async refreshProfile() {
        if (!session?.user) return;
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        setProfile(data ?? null);
      },
    }),
    [session, profile, loading]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
