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

  async function handleSignIn() {
    if (!email || !password) return Alert.alert('Enter your email and password');
    setBusy(true);
    try {
      await signInWithPassword({ email: email.trim().toLowerCase(), password });
    } catch (e) {
      Alert.alert('Sign in failed', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMagicLink() {
    if (!email) return Alert.alert('Enter your email first');
    setBusy(true);
    try {
      await signInWithMagicLink({ email: email.trim().toLowerCase() });
      Alert.alert('Check your inbox', 'We sent you a sign-in link.');
    } catch (e) {
      Alert.alert('Could not send link', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
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
});
