import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, TYPE, SPACING, RADIUS } from '../../theme';
import { PrimaryButton } from '../../components/Atoms';
import { useAuth } from '../../auth/AuthContext';

const MARKETING_URL = 'https://sweet-capybara-3e213a.netlify.app/';

export default function SignUpScreen({ navigation }) {
  const { signUpWithPassword } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [infoMsg, setInfoMsg]   = useState(null);

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

  // Web → marketing site. Native → previous screen (Splash or SignIn).
  function handleBack() {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.location.href = MARKETING_URL;
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Splash');
  }

  async function handleSignUp() {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email || !password) {
      setErrorMsg('Enter your email and a password.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const { session } = await signUpWithPassword({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
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
              placeholder="Jane Doe"
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
              placeholder="you@example.com"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />

            <Text style={[s.label, { marginTop: SPACING.md }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={COLORS.textTertiary}
              style={s.input}
            />

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
            <TouchableOpacity onPress={() => navigation.goBack()}>
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
  header:  { marginTop: SPACING.xl, marginBottom: SPACING.xl },
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
