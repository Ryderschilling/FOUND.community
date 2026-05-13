import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, TYPE, SPACING, RADIUS } from '../../theme';
import { PrimaryButton } from '../../components/Atoms';
import { useAuth } from '../../auth/AuthContext';

export default function SignUpScreen({ navigation }) {
  const { signUpWithPassword } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSignUp() {
    if (!email || !password) return Alert.alert('Enter your email and a password');
    if (password.length < 8) return Alert.alert('Password must be at least 8 characters');
    setBusy(true);
    try {
      const { session } = await signUpWithPassword({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
      });
      // If "Confirm email" is disabled in Supabase auth settings, `session` is set
      // and the AuthContext will route the user into the app. If confirmation is
      // required, prompt them to verify.
      if (!session) {
        Alert.alert(
          'Check your email',
          'We sent you a confirmation link. Tap it, then come back and sign in.'
        );
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Sign up failed', e.message);
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
});
