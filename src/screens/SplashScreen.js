import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, StatusBar, SafeAreaView, Image, Animated, Easing,
} from 'react-native';
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

// ── Subtle entrance animation ────────────────────────────────────────────────
// Each block fades in + slides up ~24px. Slight stagger (brand → hero → CTA)
// gives a "welcome" feel without being heavy-handed. Native driver so it stays
// smooth on lower-end devices.
function useEntrance(delay = 0) {
  const opacity   = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 650,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 0,
        duration: 650,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translate, delay]);

  return { opacity, transform: [{ translateY: translate }] };
}

export default function SplashScreen({ navigation }) {
  const brandAnim = useEntrance(0);
  const heroAnim  = useEntrance(180);
  const ctaAnim   = useEntrance(360);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={{ flex: 1 }} />

      {/* Brand */}
      <Animated.View style={[styles.brand, brandAnim]}>
        <FoundLogo size={84} />
        <Wordmark size="xl" />
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>Real. Christian. Community.</Text>
        </View>
      </Animated.View>

      {/* Hero copy — mirrors the found.community landing page */}
      <Animated.View style={[styles.hero, heroAnim]}>
        <Text style={styles.headline}>Find your people.</Text>
        <Text style={styles.body}>
          FOUND helps Christians discover like-minded people nearby who share
          their faith, life stage, interests, and desire to go deeper.
        </Text>
        <Text style={styles.subtext}>Because we all need people to run with.</Text>
      </Animated.View>

      <View style={{ flex: 1 }} />

      {/* CTAs */}
      <Animated.View style={[styles.ctaWrap, ctaAnim]}>
        <PrimaryButton label="Get Started" onPress={() => navigation.navigate('SignUp')} />
        <GhostButton label="Already have an account? Sign in" onPress={() => navigation.navigate('SignIn')} />
      </Animated.View>

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
