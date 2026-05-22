// =============================================================================
// auth.js — shared Supabase auth client + helpers + header session swap
//
// Load this on every page AFTER the Supabase UMD bundle:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/..."></script>
//   <script src="/assets/auth.js"></script>
//
// Exposes:
//   window._supabase            — the shared Supabase client
//   window.foundAuth.getSession()
//   window.foundAuth.signIn({email, password})
//   window.foundAuth.signUp({email, password, fullName})
//   window.foundAuth.signInWithMagicLink({email})
//   window.foundAuth.signOut()
//   window.foundAuth.applyHeaderSession()   — swaps "Get Early Access" CTA
//                                             for "Open app" + initials avatar
//                                             when logged in
// =============================================================================

(function () {
  const SUPABASE_URL  = 'https://froqanfagdkjmfrmpfye.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_TWr-nQ9gwyvuxUsdtR49hA_dkk2TNLO';

  // Reuse if index.html already initialized one
  if (!window._supabase) {
    const { createClient } = window.supabase;
    window._supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // handles magic-link callback hash
      },
    });
  }

  const sb = window._supabase;

  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data.session ?? null;
  }

  async function signIn({ email, password }) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp({ email, password, fullName }) {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName ?? '' },
        emailRedirectTo: `${window.location.origin}/account.html`,
      },
    });
    if (error) throw error;
    return data;
  }

  async function signInWithMagicLink({ email }) {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/account.html` },
    });
    if (error) throw error;
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  function initialsFrom(name, email) {
    const src = (name || email || '').trim();
    if (!src) return '··';
    const parts = src.split(/\s+/);
    if (parts.length > 1) {
      return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
    }
    return (src[0] || '·').toUpperCase();
  }

  // Replace any [data-cta-when-logged-out] CTA with an [data-cta-when-logged-in]
  // version: "Open app" + initials avatar. Re-runs on auth state changes.
  //
  // Tailwind gotcha: `hidden` sets display:none. When we remove `hidden`, the
  // element falls back to its default `display` — for an <a>, that's `inline`,
  // which kills `items-center` / `gap-*` (those require flex). So we explicitly
  // toggle `inline-flex` to make the pill lay out correctly.
  async function applyHeaderSession() {
    const session = await getSession();
    const loggedOutEls = document.querySelectorAll('[data-cta-when-logged-out]');
    const loggedInEls  = document.querySelectorAll('[data-cta-when-logged-in]');

    if (session) {
      const fullName = session.user?.user_metadata?.full_name;
      const initials = initialsFrom(fullName, session.user?.email);
      loggedInEls.forEach((el) => {
        el.classList.remove('hidden');
        el.classList.add('inline-flex');
        const slot = el.querySelector('[data-initials]');
        if (slot) slot.textContent = initials;
      });
      loggedOutEls.forEach((el) => el.classList.add('hidden'));
    } else {
      loggedInEls.forEach((el) => {
        el.classList.add('hidden');
        el.classList.remove('inline-flex');
      });
      loggedOutEls.forEach((el) => el.classList.remove('hidden'));
    }
  }

  // Auto-refresh header on auth state change (sign in, sign out, token refresh)
  sb.auth.onAuthStateChange(() => {
    applyHeaderSession();
  });

  window.foundAuth = {
    getSession,
    signIn,
    signUp,
    signInWithMagicLink,
    signOut,
    initialsFrom,
    applyHeaderSession,
  };
})();
