/**
 * TutorialOverlay — first-time onboarding experience.
 *
 * Flow:
 *   Step 0 — "We all need people to run with." (vision / welcome, no spotlight)
 *   Step 1 — "How FOUND works" compact 5-step list   (no spotlight)
 *   Steps 2-7 — interactive coach marks on UI elements
 *
 * Full-screen Modal with a dimmed backdrop and a spotlight cut-out around
 * each highlighted element. Tooltip card is centered horizontally (maxWidth 320)
 * so it renders correctly on both native phone and web preview.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING } from '../theme';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Step definitions ─────────────────────────────────────────────────────────
// refKey     : key in props.refs to measure for the spotlight (null = no hole)
// tabIndex   : use tab-bar slot position instead of a ref (0-indexed)
// tooltipPos : 'above' | 'below' | 'center'
// arrowDir   : 'up' | 'down' | 'none'
// miniSteps  : optional — renders a compact numbered list instead of body text
const STEPS = [
  // ── Interactive coach marks ────────────────────────────────────────────────
  {
    id: 'location',
    title: 'Filter by location',
    body: 'Tap to see people near you, in a specific city, or anywhere.',
    refKey: 'locPill',
    tabIndex: null,
    tooltipPos: 'below',
    arrowDir: 'up',
  },
  {
    id: 'search',
    title: 'Search',
    body: 'Find people by name, church, interests, or life stage.',
    refKey: 'search',
    tabIndex: null,
    tooltipPos: 'below',
    arrowDir: 'up',
  },
  {
    id: 'filters',
    title: 'Sort your feed',
    body: 'Switch between Connections, Life Stage, Interests, and more.',
    refKey: 'filterChips',
    tabIndex: null,
    tooltipPos: 'below',
    arrowDir: 'up',
  },
  {
    id: 'connect',
    title: 'Connect with people',
    body: "Tap Connect on a card to reach out. If they connect back, you're matched.",
    refKey: 'firstCard',
    tabIndex: null,
    tooltipPos: 'below',
    arrowDir: 'up',
  },
  {
    id: 'activity',
    title: 'Activity',
    body: "See everyone who's reached out to you. Accept or pass — your call.",
    refKey: null,
    tabIndex: 1,
    tooltipPos: 'above',
    arrowDir: 'down',
  },
  {
    id: 'messages',
    title: 'Messages',
    body: 'Once you match with someone, start a conversation here.',
    refKey: null,
    tabIndex: 2,
    tooltipPos: 'above',
    arrowDir: 'down',
  },
];

const TAB_COUNT        = 5;
const TAB_BAR_HEIGHT   = 72;
const SPOT_PAD         = 10;
const TOOLTIP_GAP      = 14;  // gap between spotlight edge and tooltip card
const CARD_MAX_W       = 320;
const CARD_H_PAD       = 20;  // horizontal padding inside the card container

const NULL_SPOT = { x: SW / 2 - 1, y: SH / 2 - 1, width: 2, height: 2 };

export default function TutorialOverlay({ visible, onDone, refs = {}, appMetrics = null }) {
  const insets = useSafeAreaInsets();
  const [step, setStep]   = useState(0);
  const [spot, setSpot]   = useState(NULL_SPOT);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;

  const animateIn = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(cardAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 16,
        stiffness: 180,
        mass: 0.6,
      }),
    ]).start();
  }, [fadeAnim, cardAnim]);

  const transitionToStep = useCallback((next) => {
    fadeAnim.setValue(0);
    cardAnim.setValue(0);
    setStep(next);
  }, [fadeAnim, cardAnim]);

  const measureStep = useCallback((stepDef) => {
    if (!stepDef) return;

    // Tab-bar slot — use real app frame metrics when available so the
    // spotlight is correct on web (where the app renders in a centered
    // browser frame and Dimensions.get('window') returns browser width).
    if (stepDef.tabIndex != null) {
      const appX = appMetrics?.x      ?? 0;
      const appW = appMetrics?.width   ?? SW;
      const appH = appMetrics?.height  ?? SH;
      const appY = appMetrics?.y       ?? 0;

      const tabBarBottom = appY + appH - Math.max(insets.bottom, 16) - 8;
      const tabBarTop    = tabBarBottom - TAB_BAR_HEIGHT;
      const TAB_BAR_H_INSET = 20;
      const tabW = (appW - TAB_BAR_H_INSET * 2) / TAB_COUNT;
      const x    = appX + TAB_BAR_H_INSET + stepDef.tabIndex * tabW;
      setSpot({
        x:      x + SPOT_PAD,
        y:      tabBarTop,
        width:  tabW - SPOT_PAD * 2,
        height: TAB_BAR_HEIGHT,
      });
      return;
    }

    const refKey = stepDef.refKey;
    if (!refKey || !refs[refKey]?.current) {
      setSpot(NULL_SPOT);
      return;
    }

    refs[refKey].current.measure((fx, fy, w, h, px, py) => {
      if (!w || !h) { setSpot(NULL_SPOT); return; }
      setSpot({
        x:      px - SPOT_PAD,
        y:      py - SPOT_PAD,
        width:  w  + SPOT_PAD * 2,
        height: h  + SPOT_PAD * 2,
      });
    });
  }, [refs, insets.bottom, appMetrics]);

  useEffect(() => {
    if (!visible) return;
    const stepDef = STEPS[step];
    if (!stepDef) return;
    const t = setTimeout(() => {
      measureStep(stepDef);
      animateIn();
    }, 80);
    return () => clearTimeout(t);
  }, [step, visible, measureStep, animateIn]);

  useEffect(() => {
    if (visible) { setStep(0); setSpot(NULL_SPOT); }
  }, [visible]);

  function handleNext() {
    fadeAnim.setValue(0);
    cardAnim.setValue(0);
    if (step >= STEPS.length - 1) {
      onDone?.();
    } else {
      transitionToStep(step + 1);
    }
  }

  const stepDef  = STEPS[step] ?? STEPS[0];
  const isLast   = step === STEPS.length - 1;
  const isCenter = stepDef.tooltipPos === 'center';

  const { x, y, width: spotW, height: spotH } = spot;

  // ── Tooltip container style ───────────────────────────────────────────────
  let tooltipContainer;
  if (isCenter) {
    tooltipContainer = {
      position:         'absolute',
      left:             0,
      right:            0,
      top:              SH * 0.28,
      alignItems:       'center',
      paddingHorizontal: CARD_H_PAD,
    };
  } else if (stepDef.tooltipPos === 'above') {
    tooltipContainer = {
      position:         'absolute',
      left:             0,
      right:            0,
      bottom:           SH - y + TOOLTIP_GAP,
      alignItems:       'center',
      paddingHorizontal: CARD_H_PAD,
    };
  } else {
    tooltipContainer = {
      position:         'absolute',
      left:             0,
      right:            0,
      top:              y + spotH + TOOLTIP_GAP,
      alignItems:       'center',
      paddingHorizontal: CARD_H_PAD,
    };
  }

  const cardScale = cardAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [0.94, 1],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => onDone?.()}
    >
      {/* ── Dimmed backdrop ─────────────────────────────────────────────── */}
      {!isCenter && (
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { opacity: fadeAnim }]}
          pointerEvents="none"
        >
          {/* Top */}
          <View style={[styles.dim, { top: 0, left: 0, right: 0, height: Math.max(y, 0) }]} />
          {/* Left */}
          <View style={[styles.dim, { top: y, left: 0, width: Math.max(x, 0), height: spotH }]} />
          {/* Right */}
          <View style={[styles.dim, { top: y, left: x + spotW, right: 0, height: spotH }]} />
          {/* Bottom */}
          <View style={[styles.dim, { top: y + spotH, left: 0, right: 0, bottom: 0 }]} />
          {/* Spotlight ring */}
          <View
            style={{
              position:    'absolute',
              top:         y,
              left:        x,
              width:       spotW,
              height:      spotH,
              borderRadius: 12,
              borderWidth:  2,
              borderColor: 'rgba(255,255,255,0.65)',
            }}
          />
        </Animated.View>
      )}

      {/* Full dim for centered steps (welcome + how it works) */}
      {isCenter && (
        <Animated.View
          style={[StyleSheet.absoluteFillObject, styles.dim, { opacity: fadeAnim }]}
          pointerEvents="none"
        />
      )}

      {/* ── Tooltip card ───────────────────────────────────────────────── */}
      <Animated.View
        style={[
          tooltipContainer,
          {
            opacity:   fadeAnim,
            transform: [{ scale: cardScale }],
          },
        ]}
      >
        {stepDef.arrowDir === 'up' && <View style={styles.arrowUp} />}

        <View style={styles.card}>
          <Text style={styles.stepLabel}>{step + 1} / {STEPS.length}</Text>
          <Text style={styles.cardTitle}>{stepDef.title}</Text>

          {/* Regular body text */}
          {stepDef.body ? (
            <Text style={styles.cardBody}>{stepDef.body}</Text>
          ) : null}

          {/* Compact numbered steps (How it works) */}
          {stepDef.miniSteps ? (
            <View style={styles.miniStepsList}>
              {stepDef.miniSteps.map((s) => (
                <View key={s.num} style={styles.miniStepRow}>
                  <Text style={styles.miniStepNum}>{s.num}</Text>
                  <View style={styles.miniStepText}>
                    <Text style={styles.miniStepLabel}>{s.label}</Text>
                    <Text style={styles.miniStepDesc}>{s.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.cardButtons}>
            {!isLast && (
              <TouchableOpacity onPress={() => onDone?.()} style={styles.skipBtn} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleNext}
              style={[styles.nextBtn, isLast && styles.nextBtnFull]}
              activeOpacity={0.85}
            >
              <Text style={styles.nextText}>{isLast ? 'Got it' : 'Next'}</Text>
              {!isLast && (
                <Ionicons name="arrow-forward" size={13} color={COLORS.white} style={{ marginLeft: 4 }} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {stepDef.arrowDir === 'down' && <View style={styles.arrowDown} />}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.74)',
  },

  arrowUp: {
    width:            0,
    height:           0,
    borderLeftWidth:  10,
    borderRightWidth: 10,
    borderBottomWidth: 11,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.white,
    marginBottom:     -1,
  },

  arrowDown: {
    width:           0,
    height:          0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth:  11,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    borderTopColor:  COLORS.white,
    marginTop:       -1,
  },

  card: {
    width:           '100%',
    maxWidth:        CARD_MAX_W,
    backgroundColor: COLORS.white,
    borderRadius:    18,
    padding:         SPACING.lg,
    borderWidth:     1,
    borderColor:     COLORS.border,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.13,
    shadowRadius:    20,
    elevation:       8,
  },

  stepLabel: {
    fontFamily:    FONT.mono,
    fontSize:      9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color:         COLORS.textTertiary,
    marginBottom:  SPACING.sm,
  },

  cardTitle: {
    fontFamily:   FONT.serifRegular,
    fontSize:     20,
    color:        COLORS.text,
    marginBottom: 6,
    letterSpacing: -0.2,
  },

  cardBody: {
    fontFamily:   FONT.regular,
    fontSize:     14,
    color:        COLORS.textSecondary,
    lineHeight:   21,
    marginBottom: SPACING.lg,
  },

  // ── Compact numbered steps (How it works) ─────────────────────────────────
  miniStepsList: {
    marginTop:    SPACING.sm,
    marginBottom: SPACING.lg,
    gap:          10,
  },
  miniStepRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
  },
  miniStepNum: {
    fontFamily:    FONT.mono,
    fontSize:      9,
    letterSpacing: 1.4,
    color:         COLORS.textTertiary,
    marginTop:     2,
    width:         20,
  },
  miniStepText: {
    flex: 1,
  },
  miniStepLabel: {
    fontFamily: FONT.semiBold,
    fontSize:   13,
    color:      COLORS.text,
    lineHeight: 18,
  },
  miniStepDesc: {
    fontFamily: FONT.regular,
    fontSize:   12,
    color:      COLORS.textSecondary,
    lineHeight: 17,
  },

  cardButtons: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'flex-end',
    gap:            SPACING.sm,
  },

  skipBtn: {
    paddingVertical:   10,
    paddingHorizontal: SPACING.md,
  },
  skipText: {
    fontFamily: FONT.semiBold,
    fontSize:   14,
    color:      COLORS.textSecondary,
  },

  nextBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   COLORS.text,
    paddingVertical:   11,
    paddingHorizontal: SPACING.lg,
    borderRadius:      999,
  },
  nextBtnFull: {
    paddingHorizontal: SPACING.xl,
  },
  nextText: {
    fontFamily: FONT.semiBold,
    fontSize:   14,
    color:      COLORS.white,
  },
});
