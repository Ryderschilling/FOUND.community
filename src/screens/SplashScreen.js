import React from 'react';
import { View, Text, StyleSheet, StatusBar, SafeAreaView } from 'react-native';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Wordmark, PrimaryButton, GhostButton } from '../components/Atoms';

// Clean Latin cross — stroke weight matched to Inter Bold
function CrossIcon({ size = 64, color = COLORS.text }) {
  const barW = Math.round(size * 0.21);       // thick bars to match Inter Bold stroke weight
  const hOffset = Math.round(size * 0.27);    // horizontal bar at 27% from top (Latin cross proportion)
  const hWidth = Math.round(size * 0.68);     // horizontal arm width
  return (
    <View style={{ width: hWidth, height: size }}>
      {/* Vertical bar */}
      <View style={{
        position: 'absolute',
        left: (hWidth - barW) / 2,
        top: 0,
        width: barW,
        height: size,
        backgroundColor: color,
        borderRadius: barW / 2,
      }} />
      {/* Horizontal bar */}
      <View style={{
        position: 'absolute',
        left: 0,
        top: hOffset,
        width: hWidth,
        height: barW,
        backgroundColor: color,
        borderRadius: barW / 2,
      }} />
    </View>
  );
}

export default function SplashScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={{ flex: 1 }} />

      {/* Brand */}
      <View style={styles.brand}>
        <CrossIcon size={52} color={COLORS.text} />
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
        <PrimaryButton label="Get Started" onPress={() => navigation.navigate('SignUp')} />
        <GhostButton label="I already have an account" onPress={() => navigation.navigate('SignIn')} />
      </View>

      <View style={{ height: SPACING['2xl'] }} />
    </SafeAreaView>
  );
}

const H_PAD = SPACING.xl; // 32px — explicit, applied per-element so it can't be dropped

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    // NO paddingHorizontal here — applied per element below so it's guaranteed
  },
  brand: {
    alignItems: 'center',
    gap: SPACING.lg,
    paddingHorizontal: H_PAD,
  },
  tagline: {
    fontFamily: FONT.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 26,
  },
  quoteCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
    marginHorizontal: H_PAD,        // explicit — no ambiguity
    marginBottom: SPACING.lg,
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
    lineHeight: 28,
  },
  quoteDivider: { height: 1, backgroundColor: COLORS.borderLight, marginVertical: 4 },
  quoteResolution: {
    fontFamily: FONT.bold,
    fontSize: 13,
    color: COLORS.sage,
    letterSpacing: 0.3,
  },
  ctaWrap: {
    gap: SPACING.md,
    marginHorizontal: H_PAD,        // explicit — matches quoteCard
  },
});
