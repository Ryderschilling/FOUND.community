import React from 'react';
import { View, Text, StyleSheet, StatusBar, SafeAreaView } from 'react-native';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Wordmark, PrimaryButton, GhostButton } from '../components/Atoms';

export default function SplashScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={{ flex: 1 }} />

      {/* Brand */}
      <View style={styles.brand}>
        <View style={styles.crossWrap}>
          <Text style={styles.crossSymbol}>✝</Text>
        </View>
        <Wordmark size="xl" />
        <Text style={styles.tagline}>Find real Christian{'\n'}community near you.</Text>
      </View>

      <View style={{ flex: 1 }} />

      {/* Editorial quote card */}
      <View style={styles.quoteCard}>
        <Text style={styles.quoteRule}>— from someone who found it</Text>
        <Text style={styles.quoteText}>
          "It's possible to sit in church every week{'\n'}and still feel alone."
        </Text>
        <View style={styles.quoteDivider} />
        <Text style={styles.quoteResolution}>FOUND fixes that.</Text>
      </View>

      {/* CTAs */}
      <View style={styles.ctaWrap}>
        <PrimaryButton label="Get Started" onPress={() => navigation.navigate('Onboarding')} />
        <GhostButton label="I already have an account" onPress={() => navigation.navigate('Main')} />
      </View>

      <View style={{ height: SPACING.lg }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: SPACING.lg,
  },
  brand: {
    alignItems: 'center',
    gap: SPACING.md,
  },
  crossWrap: {
    width: 68,
    height: 68,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.md,
  },
  crossSymbol: { color: COLORS.white, fontSize: 28, fontWeight: '300' },
  tagline: {
    fontFamily: FONT.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 25,
  },
  quoteCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
    ...SHADOW.sm,
  },
  quoteRule: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
  },
  quoteText: {
    fontFamily: FONT.serifItalic,
    fontSize: 18,
    color: COLORS.text,
    lineHeight: 27,
  },
  quoteDivider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: 2 },
  quoteResolution: {
    fontFamily: FONT.bold,
    fontSize: 13,
    color: COLORS.sage,
    letterSpacing: 0.3,
  },
  ctaWrap: { gap: SPACING.sm },
});
