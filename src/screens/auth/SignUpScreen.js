import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator, ScrollView, Pressable, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, TYPE, SPACING, RADIUS } from '../../theme';
import { PrimaryButton } from '../../components/Atoms';
import { useAuth } from '../../auth/AuthContext';
import { geocodeZip } from '../../lib/geocode';

// Terms / Privacy live on the marketing site — same docs the website signup links to.
const TERMS_URL   = 'https://found.community/terms.html';
const PRIVACY_URL = 'https://found.community/privacy.html';

// ── Field validation helpers (mirror the website signup form) ────────────────
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function digitsOnly(value) {
  return (value || '').replace(/\D/g, '');
}

export default function SignUpScreen({ navigation }) {
  const { signUpWithPassword } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [zip, setZip]           = useState('');
  const [city, setCity]         = useState('');
  const [state, setState]       = useState('');
  const [hometown, setHometown] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree]       = useState(false);

  const [busy, setBusy]         = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [infoMsg, setInfoMsg]   = useState(null);
  const [zipHint, setZipHint]   = useState('We use your ZIP to match you with community nearby.');
  const [zipHintError, setZipHintError] = useState(false);

  // Guards against a stale ZIP lookup overwriting a newer one.
  const zipTokenRef = useRef(0);

  function friendlySignUpError(raw) {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user_already_exists')) {
      return 'That email is already registered. Try signing in instead.';
    }
    if (msg.includes('password') && msg.includes('weak')) {
      return 'That password is too weak. Try a longer one.';
    }
    if (msg.includes('rate limit') || msg.includes('too many')) {
      return 'Too many sign-up attempts. Wait a minute and try again.';
    }
    return raw || 'Sign up failed. Try again.';
  }

  // ZIP validation only — we no longer auto-fill city/state. Many users live
  // in named subareas (e.g. "Inlet Beach", "Seacrest", "Rosemary") that don't
  // match the ZIP's official city. ZIP drives the location/geocoding under
  // the hood; the city name is the display label others see, so the user
  // types whatever they actually call home.
  async function lookupZip() {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) return;

    const token = ++zipTokenRef.current;
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${z}`);
      if (token !== zipTokenRef.current) return;
      if (!res.ok) throw new Error('not found');
      setZipHint('We use your ZIP to match you with community nearby.');
      setZipHintError(false);
    } catch {
      if (token !== zipTokenRef.current) return;
      setZipHint("That ZIP didn't look right — double-check it.");
      setZipHintError(true);
    }
  }

  async function openLink(url) {
    try { await Linking.openURL(url); } catch { /* no-op */ }
  }

  function handleBack() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Splash');
  }

  async function handleSignUp() {
    setErrorMsg(null);
    setInfoMsg(null);

    const name      = fullName.trim();
    const emailVal  = email.trim().toLowerCase();
    const phoneVal  = phone.trim();
    const zipVal    = zip.trim();
    const cityVal   = city.trim();
    const stateVal  = state.trim().toUpperCase();
    const homeVal   = hometown.trim();

    // Client-side validation — instant feedback, no API roundtrip.
    if (!name) {
      setErrorMsg('Please enter your name.');
      return;
    }
    if (!isValidEmail(emailVal)) {
      setErrorMsg("That doesn't look like a valid email. Make sure it has an @ and a domain.");
      return;
    }
    if (digitsOnly(phoneVal).length < 10) {
      setErrorMsg('Please enter a valid phone number.');
      return;
    }
    if (!/^\d{5}$/.test(zipVal)) {
      setErrorMsg('Please enter a valid 5-digit ZIP code.');
      return;
    }
    if (!cityVal) {
      setErrorMsg('Please enter your city.');
      return;
    }
    if (!/^[A-Z]{2}$/.test(stateVal)) {
      setErrorMsg('Please enter your 2-letter state (e.g. FL).');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (!agree) {
      setErrorMsg('Please agree to the Terms of Use and Privacy Policy to continue.');
      return;
    }

    setBusy(true);
    try {
      // Resolve coordinates from the ZIP so the account is geocoded the moment
      // it's created — this is the ONLY place location is captured. Done here
      // (not relying on the on-blur lookup) so a fast "Create account" tap
      // can't race past it. Non-fatal: if the ZIP can't be resolved we sign
      // up without coords and AuthContext heals the location on first load.
      let lat = null;
      let lng = null;
      try {
        const geo = await geocodeZip(zipVal);
        if (geo.lat != null && geo.lng != null) {
          lat = geo.lat;
          lng = geo.lng;
        }
      } catch {
        // ignore — covered by the AuthContext self-heal
      }

      const { session } = await signUpWithPassword({
        email:    emailVal,
        password,
        fullName: name,
        phone:    phoneVal,
        zip:      zipVal,
        city:     cityVal,
        state:    stateVal,
        hometown: homeVal,
        lat,
        lng,
      });
      // If "Confirm email" is disabled in Supabase: session is set and the
      // AuthContext auto-routes into onboarding. If confirmation is required
      // (default), session is null and we tell them to check their inbox.
      if (!session) {
        setInfoMsg('Account created. Check your inbox for the confirmation link, then come back and sign in.');
      }
    } catch (e) {
      setErrorMsg(friendlySignUpError(e?.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={handleBack} style={s.backLink} hitSlop={8}>
            <Text style={s.backLinkText}>← Back to home</Text>
          </TouchableOpacity>

          <View style={s.header}>
            <Text style={s.overline}>FOUND</Text>
            <Text style={s.title}>Create your account.</Text>
            <Text style={s.subtitle}>Local Christian community starts here.</Text>
          </View>

          <View style={s.form}>
            <Text style={s.label}>Full name</Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              placeholder="Your name"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />

            <Text style={[s.label, { marginTop: SPACING.md }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="you@example.com"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />

            <Text style={[s.label, { marginTop: SPACING.md }]}>Phone number</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="(555) 123-4567"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />

            <Text style={[s.label, { marginTop: SPACING.md }]}>ZIP code</Text>
            <TextInput
              value={zip}
              onChangeText={(v) => setZip(v.replace(/\D/g, '').slice(0, 5))}
              onBlur={lookupZip}
              keyboardType="number-pad"
              autoComplete="postal-code"
              textContentType="postalCode"
              maxLength={5}
              placeholder="30A area — e.g. 32461"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />
            <Text style={[s.hint, zipHintError && s.hintError]}>{zipHint}</Text>

            <View style={s.row}>
              <View style={s.rowCol}>
                <Text style={s.label}>City</Text>
                <TextInput
                  value={city}
                  onChangeText={setCity}
                  autoCapitalize="words"
                  placeholder="City"
                  placeholderTextColor={COLORS.textTertiary}
                  style={s.input}
                />
              </View>
              <View style={s.rowColState}>
                <Text style={s.label}>State</Text>
                <TextInput
                  value={state}
                  onChangeText={(v) => setState(v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2))}
                  autoCapitalize="characters"
                  maxLength={2}
                  placeholder="ST"
                  placeholderTextColor={COLORS.textTertiary}
                  style={s.input}
                />
              </View>
            </View>

            <Text style={[s.label, { marginTop: SPACING.md }]}>Where you're from <Text style={s.optional}>(optional)</Text></Text>
            <TextInput
              value={hometown}
              onChangeText={setHometown}
              autoCapitalize="words"
              placeholder="Hometown — e.g. Nashville, TN"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />
            <Text style={s.hint}>We use this to connect you with people from the same place.</Text>

            <Text style={[s.label, { marginTop: SPACING.md }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password-new"
              textContentType="newPassword"
              placeholder="At least 8 characters"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />

            {/* ── Terms & Privacy acknowledgment (mirrors website signup) ── */}
            <View style={s.termsBlock}>
              <Text style={s.termsHeading}>Terms &amp; Privacy Acknowledgment</Text>
              <Text style={s.termsBody}>
                By creating an account you agree to receive launch updates and
                related communications from FOUND, and you agree to FOUND's Terms
                of Use and Privacy Policy.
              </Text>
              <Pressable
                style={s.checkRow}
                onPress={() => setAgree((v) => !v)}
                hitSlop={6}
              >
                <View style={[s.checkbox, agree && s.checkboxOn]}>
                  {agree ? <Ionicons name="checkmark" size={14} color={COLORS.white} /> : null}
                </View>
                <Text style={s.checkLabel}>
                  I agree to the{' '}
                  <Text style={s.linkInline} onPress={() => openLink(TERMS_URL)}>Terms of Use</Text>
                  {' '}and acknowledge the{' '}
                  <Text style={s.linkInline} onPress={() => openLink(PRIVACY_URL)}>Privacy Policy</Text>.
                </Text>
              </Pressable>
            </View>

            {errorMsg ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
            {infoMsg ? (
              <View style={s.infoBox}>
                <Text style={s.infoText}>{infoMsg}</Text>
              </View>
            ) : null}

            <View style={{ height: SPACING.lg }} />
            {busy ? (
              <ActivityIndicator color={COLORS.text} />
            ) : (
              <PrimaryButton label="Create account" onPress={handleSignUp} />
            )}
          </View>

          <View style={s.footer}>
            <Text style={s.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => navigation.replace('SignIn')}>
              <Text style={s.link}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { padding: SPACING.lg, paddingTop: SPACING.xl, flexGrow: 1, justifyContent: 'space-between' },
  header:  { marginTop: SPACING.lg, marginBottom: SPACING.lg },
  overline:{ ...TYPE.overline, marginBottom: SPACING.sm },
  title:   { ...TYPE.h1, marginBottom: SPACING.xs },
  subtitle:{ ...TYPE.body, color: COLORS.textSecondary },
  form:    { },
  label:   { ...TYPE.label, color: COLORS.textSecondary, marginBottom: SPACING.xs },
  input:   {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: 14,
    fontFamily: FONT.regular, fontSize: 15, color: COLORS.text,
  },
  hint:      { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 6 },
  optional:  { ...TYPE.label, color: COLORS.textTertiary, fontStyle: 'italic' },
  hintError: { color: '#8A2D2D' },

  // City / State two-column row
  row:         { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  rowCol:      { flex: 1 },
  rowColState: { width: 88 },

  // Terms block
  termsBlock:   { marginTop: SPACING.lg },
  termsHeading: { ...TYPE.label, fontSize: 13, color: COLORS.text, marginBottom: 6 },
  termsBody:    { ...TYPE.caption, color: COLORS.textSecondary, marginBottom: SPACING.sm, lineHeight: 18 },
  checkRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5,
    borderColor: COLORS.textTertiary, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkboxOn:  { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkLabel:  { ...TYPE.body, fontSize: 14, color: COLORS.textSecondary, flex: 1, lineHeight: 20 },
  linkInline:  { color: COLORS.text, textDecorationLine: 'underline' },

  footer:  { alignItems: 'center', paddingVertical: SPACING.xl, gap: 4 },
  footerText: { ...TYPE.body, color: COLORS.textSecondary },
  link:       { ...TYPE.h3 },

  errorBox: {
    marginTop: SPACING.md,
    backgroundColor: '#FBECEC',
    borderColor: '#E6BBBB',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  errorText: { ...TYPE.body, color: '#8A2D2D', fontSize: 14, lineHeight: 20 },
  infoBox: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.sageBg,
    borderColor: COLORS.sageLight,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  infoText: { ...TYPE.body, color: COLORS.sage, fontSize: 14, lineHeight: 20 },

  backLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  backLinkText: { ...TYPE.body, fontSize: 14, color: COLORS.textSecondary },
});
