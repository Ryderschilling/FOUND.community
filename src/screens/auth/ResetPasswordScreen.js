import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, TYPE, SPACING, RADIUS } from '../../theme';
import { PrimaryButton } from '../../components/Atoms';
import { useAuth } from '../../auth/AuthContext';

// Shown only while AuthContext.recoveryMode is true — i.e. the user arrived
// here by opening a password-reset link. On a successful update, recoveryMode
// flips to false and the navigator routes the user into the app; this screen
// never has to navigate itself.
export default function ResetPasswordScreen() {
  const { updatePassword, cancelRecovery } = useAuth();
  const [password, setPassword]         = useState('');
  const [confirm, setConfirm]           = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  function friendlyError(raw) {
    const msg = (raw || '').toLowerCase();
    if (msg.includes('session') || msg.includes('expired') || msg.includes('jwt') || msg.includes('token')) {
      return 'This reset link has expired. Tap "Cancel" below and request a new one.';
    }
    if (msg.includes('same') || msg.includes('different from the old')) {
      return 'Your new password must be different from your old one.';
    }
    if (msg.includes('weak')) {
      return 'That password is too weak. Try a longer one.';
    }
    if (msg.includes('rate limit') || msg.includes('too many')) {
      return 'Too many attempts. Wait a minute and try again.';
    }
    return raw || 'Could not update your password. Try again.';
  }

  async function handleUpdate() {
    setErrorMsg(null);
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Those passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      // On success recoveryMode flips false and this screen unmounts as the
      // navigator swaps stacks — so we intentionally leave `busy` true.
      await updatePassword({ password });
    } catch (e) {
      setErrorMsg(friendlyError(e?.message));
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    try {
      await cancelRecovery();
    } catch {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.overline}>FOUND</Text>
            <Text style={s.title}>Set a new password.</Text>
            <Text style={s.subtitle}>
              Choose a new password for your account. You'll be signed in once it's saved.
            </Text>
          </View>

          <View style={s.form}>
            <Text style={s.label}>New password</Text>
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

            <Text style={[s.label, { marginTop: SPACING.md }]}>Confirm new password</Text>
            <View style={s.inputWrap}>
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showConfirm}
                autoComplete="password-new"
                textContentType="newPassword"
                placeholder="Re-enter your password"
                placeholderTextColor={COLORS.textTertiary}
                style={[s.input, s.inputFlex]}
              />
              <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={s.eyeBtn} hitSlop={8}>
                <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>

            {errorMsg ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <View style={{ height: SPACING.lg }} />
            {busy ? (
              <ActivityIndicator color={COLORS.text} />
            ) : (
              <>
                <PrimaryButton label="Update password" onPress={handleUpdate} />
                <TouchableOpacity onPress={handleCancel} style={s.cancelBtn} hitSlop={8}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <View style={{ height: SPACING.xl }} />
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

  inputWrap: { position: 'relative' },
  inputFlex: { paddingRight: 44 },
  eyeBtn:    { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },

  cancelBtn:  { alignSelf: 'center', paddingVertical: SPACING.md, marginTop: SPACING.xs },
  cancelText: { ...TYPE.body, fontSize: 14, color: COLORS.textSecondary, textDecorationLine: 'underline' },

  errorBox: {
    marginTop: SPACING.md,
    backgroundColor: '#FBECEC',
    borderColor: '#E6BBBB',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  errorText: { ...TYPE.body, color: '#8A2D2D', fontSize: 14, lineHeight: 20 },
});
