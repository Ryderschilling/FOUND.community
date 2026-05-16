import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, TYPE, SPACING, RADIUS } from '../../theme';
import { PrimaryButton } from '../../components/Atoms';
import { useAuth } from '../../auth/AuthContext';

export default function SignInScreen({ navigation }) {
  const { signInWithPassword, signInWithMagicLink } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [infoMsg, setInfoMsg]   = useState(null);

  // Map Supabase auth errors to plain-English copy users can act on.
  function friendlySignInError(raw) {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('invalid login credentials')) {
      return 'No account found with that email and password. Double-check, or create an account below.';
    }
    if (msg.includes('email not confirmed')) {
      return "You haven't confirmed your email yet. Check your inbox for the confirmation link.";
    }
    if (msg.includes('rate limit') || msg.includes('too many')) {
      return 'Too many attempts. Wait a minute and try again.';
    }
    return raw || 'Sign in failed. Try again.';
  }

  async function handleSignIn() {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email || !password) {
      setErrorMsg('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      await signInWithPassword({ email: email.trim().toLowerCase(), password });
    } catch (e) {
      setErrorMsg(friendlySignInError(e?.message));
    } finally {
      setBusy(false);
    }
  }

  // Back to the app's splash (the screen with "Get Started" / "I already have
  // an account"). Same behavior on web and native.
  function handleBack() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Splash');
  }

  async function handleMagicLink() {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email) {
      setErrorMsg('Enter your email first.');
      return;
    }
    setBusy(true);
    try {
      await signInWithMagicLink({ email: email.trim().toLowerCase() });
      setInfoMsg('Check your inbox — we sent you a sign-in link.');
    } catch (e) {
      setErrorMsg(e?.message || 'Could not send link. Try again.');
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
            <Text style={s.title}>Welcome back.</Text>
            <Text style={s.subtitle}>Sign in to find your people.</Text>
          </View>

          <View style={s.form}>
            <Text style={s.label}>Email</Text>
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
              placeholder="••••••••"
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
              <PrimaryButton label="Sign in" onPress={handleSignIn} />
            )}

            <TouchableOpacity onPress={handleMagicLink} style={{ marginTop: SPACING.md, alignSelf: 'center' }}>
              <Text style={s.linkSubtle}>Email me a magic link instead</Text>
            </TouchableOpacity>
          </View>

          <View style={s.footer}>
            <Text style={s.footerText}>New to FOUND?</Text>
            <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
              <Text style={s.link}>Create an account</Text>
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
  linkSubtle: { ...TYPE.caption, color: COLORS.textSecondary, textDecorationLine: 'underline' },

  // Inline error / info banners — replaces Alert.alert for auth feedback
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

  // Back-to-home link at the top of the screen
  backLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  backLinkText: { ...TYPE.body, fontSize: 14, color: COLORS.textSecondary },
});
