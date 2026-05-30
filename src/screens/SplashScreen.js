import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  SafeAreaView,
  Image,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { PrimaryButton, GhostButton, Wordmark } from '../components/Atoms';

// Static fallback — overridden by onLayout once the FlatList renders
const { width: SCREEN_W } = Dimensions.get('window');

// ─── Slide definitions (from Sam's Welcome Screen spec, 2026-05-30) ──────────
const SLIDES = [
  {
    id: 'welcome',
    type: 'brand',
    title: 'Welcome to FOUND',
    body:
      'We all need people to run with.\n\nFOUND is a Christian community app designed to help people build meaningful relationships rooted in faith, authenticity, and real-life connection. Whether you\u2019re new to town, looking for community, searching for a church, or simply hoping to meet like-minded people, FOUND helps you discover others nearby and build lasting friendships.\n\nOur mission is simple: to help people become fully known, deeply connected, and never do life alone.',
  },
  {
    id: 'step1',
    type: 'step',
    step: 'Step 1',
    title: 'Create Your Profile',
    icon: 'person-circle-outline',
    body: 'Tell your story. Add a photo, write a short bio, select your interests, and create your Highlight Reel. The more complete your profile, the easier it is for others to get to know you before you meet.',
  },
  {
    id: 'step2',
    type: 'step',
    step: 'Step 2',
    title: 'Discover People',
    icon: 'compass-outline',
    body: 'Explore people in your area who share similar interests, values, or life experiences. Whether you\u2019re new in town or simply looking to expand your community, there\u2019s someone waiting to meet you.',
  },
  {
    id: 'step3',
    type: 'step',
    step: 'Step 3',
    title: 'Connect',
    icon: 'link-outline',
    body: 'Send a connection request and start a conversation. Ask a question, share a common interest, or simply introduce yourself. Great friendships often begin with a simple message.',
  },
  {
    id: 'step4',
    type: 'step',
    step: 'Step 4',
    title: 'Meet Up',
    icon: 'cafe-outline',
    body: 'Take the next step. Grab coffee, go for a walk, catch some waves, invite someone to dinner, or join a local event. Community grows when people move beyond screens and into real life.',
  },
  {
    id: 'step5',
    type: 'step',
    step: 'Step 5',
    title: 'Do Life Together',
    icon: 'people-outline',
    body: 'The goal isn\u2019t more followers\u2014it\u2019s meaningful relationships. Build a community where people know you, encourage you, celebrate with you, and walk alongside you through life\u2019s highs and lows.',
  },
];

const LAST_INDEX = SLIDES.length - 1;

// ─── Brand slide ──────────────────────────────────────────────────────────────
function BrandSlide({ item, width, height }) {
  return (
    <ScrollView
      style={[styles.slideScroll, { width, height: height || undefined }]}
      contentContainerStyle={styles.brandScrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brandTop}>
        <Image
          source={require('../../assets/brand-mark.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="FOUND"
        />
        <Wordmark size="xl" />
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>Real. Christian. Community.</Text>
        </View>
      </View>
      <View style={styles.brandBody}>
        <Text style={[styles.slideTitle, styles.slideTitleCenter]}>{item.title}</Text>
        <Text style={[styles.slideBody,  styles.slideBodyCenter]}>{item.body}</Text>
      </View>
    </ScrollView>
  );
}

// ─── Step slide ───────────────────────────────────────────────────────────────
function StepSlide({ item, isLast, width, height }) {
  return (
    <View style={[styles.slide, { width, height: height || undefined }]}>
      <View style={styles.stepIconWrap}>
        <Ionicons name={item.icon} size={64} color={COLORS.text} />
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepLabel}>{item.step}</Text>
        <Text style={styles.slideTitle}>{item.title}</Text>
        <Text style={styles.slideBody}>{item.body}</Text>
        {isLast && (
          <Text style={styles.closingLine}>Welcome to FOUND.{'\n'}Find Community.</Text>
        )}
      </View>
    </View>
  );
}

// ─── Pagination dots ──────────────────────────────────────────────────────────
function Dots({ count, active }) {
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === active && styles.dotActive]}
        />
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function SplashScreen({ navigation }) {
  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Real width of the FlatList container — starts with Dimensions fallback,
  // updated by onLayout so it reflects the actual app frame on web too.
  const [listWidth,  setListWidth]  = useState(SCREEN_W);
  const [listHeight, setListHeight] = useState(0);

  const isLast = activeIndex === LAST_INDEX;

  const goTo = useCallback((index) => {
    listRef.current?.scrollToIndex({ index, animated: true });
  }, []);

  const handleNext = useCallback(() => {
    if (isLast) {
      navigation.navigate('SignUp');
    } else {
      goTo(activeIndex + 1);
    }
  }, [isLast, activeIndex, goTo, navigation]);

  const handleSkip = useCallback(() => {
    goTo(LAST_INDEX);
  }, [goTo]);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const renderItem = useCallback(({ item, index }) => {
    if (item.type === 'brand') return <BrandSlide item={item} width={listWidth} height={listHeight} />;
    return <StepSlide item={item} isLast={index === LAST_INDEX} width={listWidth} height={listHeight} />;
  }, [listWidth, listHeight]);

  const getItemLayout = useCallback((_, index) => ({
    length: listWidth,
    offset: listWidth * index,
    index,
  }), [listWidth]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Skip button — hidden on last slide */}
      <View style={styles.skipRow}>
        {!isLast ? (
          <TouchableOpacity onPress={handleSkip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View /> // spacer
        )}
      </View>

      {/* Carousel */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={getItemLayout}
        style={styles.list}
        bounces={false}
        onLayout={(e) => {
          setListWidth(e.nativeEvent.layout.width);
          setListHeight(e.nativeEvent.layout.height);
        }}
      />

      {/* Footer: dots + CTAs */}
      <View style={styles.footer}>
        <Dots count={SLIDES.length} active={activeIndex} />

        {isLast ? (
          // Last slide: full CTA pair
          <View style={styles.ctaWrap}>
            <PrimaryButton label="Get Started" onPress={() => navigation.navigate('SignUp')} />
            <GhostButton
              label="Already have an account? Sign in"
              onPress={() => navigation.navigate('SignIn')}
            />
          </View>
        ) : (
          // Mid-slides: Next arrow button
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext} activeOpacity={0.8}>
            <Text style={styles.nextLabel}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color={COLORS.bg} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const H_PAD = SPACING.xl;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: H_PAD,
    paddingTop: SPACING.md,
    minHeight: 36,
  },
  skipText: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  list: {
    flex: 1,
  },

  // ── Slide shell ────────────────────────────────────────────────────────────
  // width is injected as an inline prop — measured from FlatList onLayout.
  // height:'100%' is required because flex:1 doesn't fill the cross-axis in
  // a horizontal FlatList on RN Web, so justifyContent:'center' had nothing
  // to center against.
  slide: {
    paddingHorizontal: H_PAD,
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  // Brand slide uses a ScrollView so long body text doesn't bleed under footer
  slideScroll: {},
  brandScrollContent: {
    paddingHorizontal: H_PAD,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },

  // ── Brand slide ────────────────────────────────────────────────────────────
  brandTop: {
    alignItems: 'center',
    gap: SPACING.sm,
  },
  logo: {
    width: 72,
    height: 72,
  },
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
    backgroundColor: COLORS.text,
  },
  badgeText: {
    fontFamily: FONT.regular,
    fontSize: 12.5,
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  brandBody: {
    gap: SPACING.sm,
    alignItems: 'center',
  },

  // ── Step slide ─────────────────────────────────────────────────────────────
  stepIconWrap: {
    alignItems: 'center',
    paddingTop: SPACING.sm,
  },
  stepBody: {
    gap: SPACING.xs,
    alignItems: 'center',
  },
  stepLabel: {
    fontFamily: FONT.medium,
    fontSize: 12,
    color: '#B5A090',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 2,
    textAlign: 'center',
  },
  closingLine: {
    fontFamily: FONT.serifItalic,
    fontSize: 20,
    color: COLORS.text,
    lineHeight: 28,
    marginTop: SPACING.md,
    textAlign: 'center',
  },

  // ── Shared text ────────────────────────────────────────────────────────────
  slideTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 28,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 34,
    textAlign: 'center',
  },
  slideBody: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 24,
    textAlign: 'center',
  },
  // Brand-slide-only overrides
  slideTitleCenter: { textAlign: 'center' },
  slideBodyCenter:  { textAlign: 'center' },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: H_PAD,
    paddingBottom: Platform.OS === 'android' ? SPACING.xl : SPACING.lg,
    gap: SPACING.lg,
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
  },
  dotActive: {
    width: 20,
    borderRadius: 3,
    backgroundColor: COLORS.text,
  },
  ctaWrap: {
    gap: SPACING.md,
    alignSelf: 'stretch',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.text,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: RADIUS.full,
  },
  nextLabel: {
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.bg,
  },
});
