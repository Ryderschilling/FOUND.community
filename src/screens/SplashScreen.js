import React from 'react';
import { View, Text, StyleSheet, StatusBar, SafeAreaView, Image } from 'react-native';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { Wordmark, PrimaryButton, GhostButton } from '../components/Atoms';

// FOUND brand mark — the official circle logo PNG (assets/brand-mark.png).
// Single source of truth: the same file is used for the app icon and favicon.
function FoundLogo({ size = 64 }) {
  return (
    <Image
      source={require('../../assets/brand-mark.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="FOUND"
    />
  );
}

export default function SplashScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={{ flex: 1 }} />

      {/* Brand */}
      <View style={styles.brand}>
        <FoundLogo size={84} />
        <Wordmark size="xl" />
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>Real. Christian. Community.</Text>
        </View>
      </View>

      {/* Hero copy — mirrors the found.community landing page */}
      <View style={styles.hero}>
        <Text style={styles.headline}>Find your people.</Text>
        <Text style={styles.body}>
          FOUND helps Christians discover like-minded people nearby who share
          their faith, life stage, interests, and desire to go deeper.
        </Text>
        <Text style={styles.subtext}>Because we all need people to run with.</Text>
      </View>

      <View style={{ flex: 1 }} />

      {/* CTAs */}
      <View style={styles.ctaWrap}>
        <PrimaryButton label="Get Started" onPress={() => navigation.navigate('SignUp')} />
        <GhostButton label="Already have an account? Sign in" onPress={() => navigation.navigate('SignIn')} />
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
    gap: SPACING.md,
    paddingHorizontal: H_PAD,
  },
  // "Real. Christian. Community." pill — matches the website badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.full,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 2,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.sage,
  },
  badgeText: {
    fontFamily: FONT.regular,
    fontSize: 12.5,
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  // Hero copy block — same words as found.community
  hero: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: H_PAD,
    marginTop: SPACING.xl,
  },
  headline: {
    fontFamily: FONT.serifItalic,
    fontSize: 34,
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  body: {
    fontFamily: FONT.regular,
    fontSize: 15.5,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  subtext: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: 2,
  },
  ctaWrap: {
    gap: SPACING.md,
    marginHorizontal: H_PAD,
  },
});
