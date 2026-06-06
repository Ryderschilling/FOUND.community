import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator, ScrollView, Pressable, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, TYPE, SPACING, RADIUS } from '../../theme';
import { PrimaryButton } from '../../components/Atoms';
import { useAuth } from '../../auth/AuthContext';
import { geocodeZip, geocode } from '../../lib/geocode';

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
function formatPhone(value) {
  const digits = digitsOnly(value).slice(0, 10);
  if (digits.length < 4)  return digits;
  if (digits.length < 7)  return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
}

export default function SignUpScreen({ navigation }) {
  const { signUpWithPassword } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  // Address autocomplete fields
  const [addressQuery, setAddressQuery] = useState('');    // what the user types
  const [suggestions, setSuggestions]   = useState([]);    // Photon results
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [resolvedCoords, setResolvedCoords]   = useState(null); // { lat, lng } from selection

  // Stored fields
  const [zip, setZip]           = useState('');
  const [city, setCity]         = useState('');
  const [state, setState]       = useState('');
  // Up to 3 structured hometown city rows for matching
  const [hometownCities, setHometownCities] = useState([
    { city: '', state: '' },
    { city: '', state: '' },
    { city: '', state: '' },
  ]);
  const [password, setPassword] = useState('');
  const [agree, setAgree]       = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [infoMsg, setInfoMsg]   = useState(null);

  const debounceRef    = useRef(null);
  const skipFetchRef   = useRef(false); // true while/after a suggestion is selected

  // ── Nominatim autocomplete (free OSM, no API key, better US coverage) ────────
  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.trim().length < 3) { setSuggestions([]); return; }
    try {
      const url =
        'https://nominatim.openstreetmap.org/search' +
        '?format=json&addressdetails=1&limit=6&countrycodes=us' +
        '&q=' + encodeURIComponent(q.trim());
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'FOUND-community-app/1.0 (found.community)',
        },
      });
      if (!res.ok) return;
      const data = await res.json();
      // Filter to US results and dedupe by display_name
      const seen = new Set();
      const results = (data ?? []).filter((r) => {
        const key = r.display_name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setSuggestions(results);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!addressQuery.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    // Skip re-fetching when the query was set programmatically by selectSuggestion
    if (skipFetchRef.current) { skipFetchRef.current = false; return; }
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(addressQuery);
      setShowSuggestions(true);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [addressQuery, fetchSuggestions]);

  function selectSuggestion(result) {
    skipFetchRef.current = true; // prevent the query change from re-triggering fetch
    clearTimeout(debounceRef.current);
    const a = result.address ?? {};

    // Build readable label from the address parts
    const streetNum  = a.house_number || '';
    const street     = a.road || a.pedestrian || '';
    const streetLine = [streetNum, street].filter(Boolean).join(' ');
    const detectedCity  = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
    const detectedState = (a.state_code || a.state || '').slice(0, 2).toUpperCase();
    const detectedZip   = a.postcode || '';

    const label = streetLine || detectedCity;
    setAddressQuery(label);
    setCity(detectedCity);
    setState(detectedState);
    setZip(detectedZip);

    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setResolvedCoords({ lat, lng });

    setSuggestions([]);
    setShowSuggestions(false);
  }

  function formatSuggestionLabel(result) {
    const a = result.address ?? {};
    const streetNum = a.house_number || '';
    const street    = a.road || a.pedestrian || '';
    const streetLine = [streetNum, street].filter(Boolean).join(' ');
    const city   = a.city || a.town || a.village || a.hamlet || a.suburb || '';
    const state  = (a.state_code || a.state || '').slice(0, 2).toUpperCase();
    const zip    = a.postcode ? `  ${a.postcode}` : '';
    if (streetLine && city) return `${streetLine},  ${city}, ${state}${zip}`;
    if (city)               return `${city}, ${state}${zip}`;
    // Fall back to Nominatim display name trimmed to US portion
    return (result.display_name || '').split(', United States')[0];
  }

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
    // Derive hometown from primary city row
    const primaryRow = hometownCities[0];
    const homeVal = primaryRow.city.trim()
      ? primaryRow.state.trim()
        ? `${primaryRow.city.trim()}, ${primaryRow.state.trim().toUpperCase().slice(0, 2)}`
        : primaryRow.city.trim()
      : '';

    if (!name)    { setErrorMsg('Please enter your name.');       return; }
    if (!isValidEmail(emailVal)) {
      setErrorMsg("That doesn't look like a valid email.");       return;
    }
    if (digitsOnly(phoneVal).length < 10) {
      setErrorMsg('Please enter a valid phone number.');          return;
    }
    const hometownMissingState = hometownCities.some((r) => r.city.trim() && !r.state.trim());
    if (hometownMissingState) {
      setErrorMsg('Please add a state abbreviation next to each city you entered (e.g. IL).'); return;
    }
    if (!cityVal) { setErrorMsg('Please enter your city.');       return; }
    if (!/^[A-Z]{2}$/.test(stateVal)) {
      setErrorMsg('Please enter your 2-letter state (e.g. FL).'); return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');    return;
    }
    if (!agree) {
      setErrorMsg('Please agree to the Terms of Use and Privacy Policy to continue.'); return;
    }

    setBusy(true);
    try {
      // Use already-resolved coords from autocomplete selection if available.
      // Fall back to geocoding from zip or city+state. Non-fatal.
      let lat = resolvedCoords?.lat ?? null;
      let lng = resolvedCoords?.lng ?? null;
      if (lat == null) {
        try {
          const q = zipVal || `${cityVal}, ${stateVal}`;
          const geo = /^\d{5}$/.test(q) ? await geocodeZip(q) : await geocode(q);
          if (geo.lat != null) { lat = geo.lat; lng = geo.lng; }
        } catch { /* non-fatal */ }
      }

      // Build hometown_cities array from structured rows
      const hometownCitiesArr = hometownCities
        .filter((r) => r.city.trim())
        .map((r) => {
          const c = r.city.trim();
          const st = r.state.trim().toUpperCase().slice(0, 2);
          return st ? `${c}, ${st}` : c;
        });

      const { session } = await signUpWithPassword({
        email:         emailVal,
        password,
        fullName:      name,
        phone:         phoneVal,
        zip:           zipVal || addressQuery.trim(),
        city:          cityVal,
        state:         stateVal,
        hometown:      homeVal,
        hometown_cities: hometownCitiesArr.length > 0 ? hometownCitiesArr : null,
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
              onChangeText={v => setPhone(formatPhone(v))}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="(555) 123-4567"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />

            <Text style={[s.label, { marginTop: SPACING.md }]}>Address</Text>
            <TextInput
              value={addressQuery}
              onChangeText={(v) => { skipFetchRef.current = false; setAddressQuery(v); setResolvedCoords(null); }}
              onFocus={() => addressQuery.trim().length >= 3 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 400)}
              keyboardType="default"
              autoCapitalize="words"
              autoComplete="street-address"
              textContentType="fullStreetAddress"
              placeholder="Start typing your address…"
              placeholderTextColor={COLORS.textTertiary}
              style={[s.input, showSuggestions && suggestions.length > 0 && s.inputDropdownOpen]}
            />

            {/* Suggestions render inline — avoids ScrollView clipping on web */}
            {showSuggestions && suggestions.length > 0 ? (
              <View style={s.dropdown}>
                {suggestions.map((feat, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[s.suggestionRow, i < suggestions.length - 1 && s.suggestionDivider]}
                    onPress={() => selectSuggestion(feat)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="location-outline" size={14} color={COLORS.clay} style={{ marginTop: 2 }} />
                    <Text style={s.suggestionText} numberOfLines={2}>
                      {formatSuggestionLabel(feat)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <Text style={[s.hint, resolvedCoords && s.hintConfirmed]}>
              {resolvedCoords
                ? '✓ Location confirmed'
                : suggestions.length === 0 && addressQuery.length >= 3
                  ? 'No results — try a different address or enter city below manually.'
                  : 'Type your address for better connections on FOUND, or fill in city/state/ZIP below.'}
            </Text>

            <View style={[s.row, { zIndex: 1 }]}>
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
              <View style={s.rowColZip}>
                <Text style={s.label}>ZIP</Text>
                <TextInput
                  value={zip}
                  onChangeText={(v) => setZip(v.replace(/\D/g, '').slice(0, 5))}
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholder="00000"
                  placeholderTextColor={COLORS.textTertiary}
                  style={s.input}
                />
              </View>
            </View>

            {/* Where are you from */}
            <Text style={[s.label, { marginTop: SPACING.md }]}>
              From <Text style={s.optional}>(optional)</Text>
            </Text>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[s.hometownRow, i > 0 && { marginTop: 8 }]}>
                <TextInput
                  value={hometownCities[i].city}
                  onChangeText={(v) => {
                    const updated = [...hometownCities];
                    updated[i] = { ...updated[i], city: v };
                    setHometownCities(updated);
                  }}
                  autoCapitalize="words"
                  placeholder={i === 0 ? 'City (e.g. Charleston)' : `City (optional)`}
                  placeholderTextColor={COLORS.textTertiary}
                  style={[s.input, s.hometownCity]}
                  maxLength={60}
                />
                <TextInput
                  value={hometownCities[i].state}
                  onChangeText={(v) => {
                    const updated = [...hometownCities];
                    updated[i] = { ...updated[i], state: v.slice(0, 30) };
                    setHometownCities(updated);
                  }}
                  autoCapitalize="words"
                  placeholder="ST / Country"
                  placeholderTextColor={COLORS.textTertiary}
                  style={[s.input, s.hometownState]}
                  maxLength={30}
                />
              </View>
            ))}

            <Text style={[s.label, { marginTop: SPACING.md }]}>Password</Text>
            <View style={s.inputWrap}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password-new"
                textContentType="newPassword"
                placeholder="At least 8 characters"
                placeholderTextColor={COLORS.textTertiary}
                style={[s.input, s.inputFlex]}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={s.eyeBtn} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>

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
  hint:          { ...TYPE.caption, color: COLORS.textTertiary, marginTop: 6, marginBottom: 2 },
  hintConfirmed: { color: COLORS.sage },
  inputWrap: { position: 'relative' },
  inputFlex: { paddingRight: 44 },
  eyeBtn:    { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  optional:  { ...TYPE.label, color: COLORS.textTertiary, fontStyle: 'italic' },
  hintError: { color: '#8A2D2D' },

  // Hometown city rows
  hometownRowLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, marginTop: 10, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  hometownRow:   { flexDirection: 'row', gap: 8, marginTop: 4 },
  hometownCity:  { flex: 1 },
  hometownState: { width: 110 },

  // City / State / ZIP row
  row:         { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  rowCol:      { flex: 1 },
  rowColState: { width: 64 },
  rowColZip:   { width: 80 },

  // Input open state — bottom corners flatten to join the dropdown visually
  inputDropdownOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomColor: COLORS.borderLight,
  },

  // Autocomplete dropdown — inline (no absolute), works in ScrollView on web
  dropdown: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: COLORS.border,
    borderBottomLeftRadius: RADIUS.md,
    borderBottomRightRadius: RADIUS.md,
    marginBottom: 4,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  suggestionText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },

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
