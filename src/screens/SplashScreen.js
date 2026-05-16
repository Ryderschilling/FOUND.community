import React from 'react';
import { View, Text, StyleSheet, StatusBar, SafeAreaView } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Wordmark, PrimaryButton, GhostButton } from '../components/Atoms';

// FOUND mark — F + dot inside a black circle.
// Same geometry as the website's header SVG (viewBox 0 0 40 40).
function FoundLogo({ size = 64, color = COLORS.text, bg = COLORS.bg }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      {/* Outer ring */}
      <Circle cx="20" cy="20" r="20" fill={color} />
      {/* Inner field */}
      <Circle cx="20" cy="20" r="17" fill={bg} />
      {/* F vertical stem */}
      <Rect x="11" y="8" width="5" height="23" rx="2" fill={color} />
      {/* F top bar */}
      <Rect x="11" y="8" width="14" height="5" rx="2" fill={color} />
      {/* F middle bar */}
      <Rect x="11" y="17.5" width="10.5" height="4.5" rx="2" fill={color} />
      {/* Dot */}
      <Circle cx="27" cy="29.5" r="3" fill={color} />
    </Svg>
  );
}

export default function SplashScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={{ flex: 1 }} />

      {/* Brand */}
      <View style={styles.brand}>
        <FoundLogo size={72} color={COLORS.text} bg={COLORS.bg} />
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
