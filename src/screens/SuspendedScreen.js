// ─────────────────────────────────────────────────────────────────
// SuspendedScreen
// Shown instead of the whole app when the signed-in profile has
// `suspended = true` (set by a moderator via the admin panel).
// The gate lives in navigation/index.js — this screen renders with no
// NavigationContainer, so a suspended user can reach nothing else.
// Their only action is Sign Out.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { useAuth } from '../auth/AuthContext';

export default function SuspendedScreen() {
  const { profile, signOut } = useAuth();
  const reason = profile?.suspended_reason;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.mark}>FOUND</Text>

        <View style={styles.card}>
          <Text style={styles.title}>Account suspended</Text>
          <Text style={styles.copy}>
            Your account has been suspended for violating the FOUND community
            guidelines and is not currently accessible.
          </Text>

          {reason ? (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonLabel}>REASON</Text>
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          ) : null}

          <Text style={styles.copySmall}>
            If you believe this was a mistake, contact us at{' '}
            <Text style={styles.email}>hello@found.community</Text>.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.signOut}
          activeOpacity={0.8}
          onPress={signOut}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  mark: {
    fontFamily: FONT.bold,
    fontSize: 16,
    letterSpacing: 2,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
  },
  title: {
    fontFamily: FONT.serifRegular,
    fontSize: 26,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  copy: {
    fontFamily: FONT.regular,
    fontSize: 15,
    lineHeight: 23,
    color: COLORS.textSecondary,
  },
  copySmall: {
    fontFamily: FONT.regular,
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  email: { fontFamily: FONT.semiBold, color: COLORS.text },
  reasonBox: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  reasonLabel: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: COLORS.textTertiary,
    marginBottom: SPACING.xs,
  },
  reasonText: {
    fontFamily: FONT.regular,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.text,
  },
  signOut: {
    marginTop: SPACING.xl,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.full,
    paddingVertical: 15,
    alignItems: 'center',
  },
  signOutText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.accentText,
  },
});
