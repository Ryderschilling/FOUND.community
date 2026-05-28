import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, TYPE, SPACING, RADIUS } from '../../theme';
import { PrimaryButton } from '../../components/Atoms';
import { useAuth } from '../../auth/AuthContext';

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function ForgotPasswordScreen({ navigation }) {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [sent, setSent]       = useState(false);

  function friendlyError(raw) {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('seconds')) {
      return 'Too many requests. Wait a minute and try again.';
    }
    return raw || 'Could not send the reset email. Try again.';
  }

  async function handleSend() {
    setErrorMsg(null);
    const emailVal = email.trim().toLowerCase();
    if (!isValidEmail(emailVal)) {
      setErrorMsg("That doesn't look like a valid email. Make sure it has an @ and a domain.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset({ email: emailVal });
      // Supabase does not reveal whether the email has an account, so the
      // confirmation copy stays deliberately neutral.
      setSent(true);
    } catch (e) {
      setErrorMsg(friendlyError(e?.message));
    } finally {
      setBusy(false);
    }
  }

  function handleBack() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('SignIn');
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={handleBack} style={s.backLink} hitSlop={8}>
            <Text style={s.backLinkText}>← Back to sign in</Text>
          </TouchableOpacity>

          <View style={s.header}>
            <Text style={s.overline}>FOUND</Text>
            <Text style={s.title}>Reset your password.</Text>
            <Text style={s.subtitle}>
              Enter your email and we'll send you a link to set a new password.
            </Text>
          </View>

          <View style={s.form}>
            <Text style={s.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              editable={!sent}
              placeholder="you@example.com"
              placeholderTextColor={COLORS.textTertiary}
              style={[s.input, sent && s.inputDisabled]}
            />

            {errorMsg ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
            {sent ? (
              <View style={s.infoBox}>
                <Text style={s.infoText}>
                  Email sent. Check your inbox — might be in trash.
                </Text>
              </View>
            ) : null}

            <View style={{ height: SPACING.lg }} />
            {busy ? (
              <ActivityIndicator color={COLORS.text} />
            ) : sent ? (
              <TouchableOpacity onPress={() => { setSent(false); setErrorMsg(null); }} style={s.resendBtn}>
                <Text style={s.resendText}>Use a different email</Text>
              </TouchableOpacity>
            ) : (
              <PrimaryButton label="Send reset link" onPress={handleSend} />
            )}
          </View>

          <View style={s.footer}>
            <Text style={s.footerText}>Remember it?</Text>
            <TouchableOpacity onPress={handleBack}>
              <Text style={s.link}>Back to sign in</Text>
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
  subtitle:{ ...TYPE.body, color: COLORS.textSecondary, lineHeight: 21 },
  form:    { },
  label:   { ...TYPE.label, color: COLORS.textSecondary, marginBottom: SPACING.xs },
  input:   {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: 14,
    fontFamily: FONT.regular, fontSize: 15, color: COLORS.text,
  },
  inputDisabled: { opacity: 0.55 },

  resendBtn:  { alignSelf: 'center', paddingVertical: 4 },
  resendText: { ...TYPE.body, fontSize: 14, color: COLORS.textSecondary, textDecorationLine: 'underline' },

  footer:  { alignItems: 'center', paddingVertical: SPACING.xl, gap: 4 },
  footerText: { ...TYPE.body, color: COLORS.textSecondary },
  link:    { ...TYPE.h3 },

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
