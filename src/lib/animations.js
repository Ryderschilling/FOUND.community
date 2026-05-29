/**
 * FOUND — Shared animation hooks
 * All use React Native's built-in Animated (no extra deps, runs on native driver).
 */

import { useRef, useEffect } from 'react';
import { Animated } from 'react-native';

// ── Fade + slide up on mount ─────────────────────────────────────────────────
// Use on list cards for a premium staggered entrance.
// delay: ms to wait before animating (use index * 60 for stagger)
export function useFadeUpEntrance(delay = 0) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        delay,
        damping: 22,
        stiffness: 180,
        mass: 0.7,
        useNativeDriver: true,
      }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { opacity, transform: [{ translateY }] };
}

// ── Spring press feedback ─────────────────────────────────────────────────────
// Returns { onPressIn, onPressOut, animStyle } to wire into a Touchable wrapper.
// Wrap the touchable in an Animated.View and spread animStyle onto it.
export function useSpringPress(pressedScale = 0.965) {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(scale, {
      toValue: pressedScale,
      damping: 12,
      stiffness: 240,
      mass: 0.5,
      useNativeDriver: true,
    }).start();

  const onPressOut = () =>
    Animated.spring(scale, {
      toValue: 1,
      damping: 14,
      stiffness: 200,
      mass: 0.6,
      useNativeDriver: true,
    }).start();

  return { onPressIn, onPressOut, animStyle: { transform: [{ scale }] } };
}

// ── Gentle looping pulse ──────────────────────────────────────────────────────
// Use on badges, count indicators — a slow, subtle heartbeat.
// Call with active=true to start; stops + resets when active=false.
export function usePulse(active = true, { min = 0.9, max = 1.1, duration = 950 } = {}) {
  const scale = useRef(new Animated.Value(1)).current;
  const anim  = useRef(null);

  useEffect(() => {
    if (active) {
      anim.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: max, duration, useNativeDriver: true }),
          Animated.timing(scale, { toValue: min, duration, useNativeDriver: true }),
        ])
      );
      anim.current.start();
    } else {
      anim.current?.stop();
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
    }
    return () => anim.current?.stop();
  }, [active]);

  return { transform: [{ scale }] };
}

// ── Icon spring bounce ────────────────────────────────────────────────────────
// Fires a quick overshoot-and-settle when `active` flips to true.
// Use on tab icons — keeps scale=1 baseline when inactive.
export function useIconBounce(active) {
  const scale    = useRef(new Animated.Value(1)).current;
  const didMount = useRef(false);

  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    if (!active) return;
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.22, damping: 6, stiffness: 280, mass: 0.4, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1,    damping: 14, stiffness: 200, mass: 0.6, useNativeDriver: true }),
    ]).start();
  }, [active]);

  return { transform: [{ scale }] };
}
