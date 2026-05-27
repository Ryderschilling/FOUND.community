// ─────────────────────────────────────────────────────────────────────────
// ToastProvider — lightweight in-app toast for one-off messages.
//
// Replaces Alert.alert('Error', msg) / Alert.alert('Success', msg) calls
// that on web show the ugly native browser dialog.
//
// API:
//   const toast = useToast();
//   toast({ title: 'Could not join', message: error.message, type: 'error' });
//   toast({ title: 'Saved!', type: 'success' });
//   toast({ title: 'Heads up', message: 'Something happened.' });
//
// Types:  'error' (red)  |  'success' (sage)  |  'info' (dark) [default]
//
// Shows at the bottom of the screen for 3 s then fades out.
// If a new toast fires before the old one clears, it replaces it immediately.
// ─────────────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';

const ToastContext = createContext(null);

const DURATION = 3000; // ms visible
const FADE_MS  = 220;  // ms for fade in / out

const BG = {
  error:   '#D24A4A',
  success: COLORS.sage,
  info:    COLORS.text,
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider>');
  return ctx.show;
}

export function ToastProvider({ children }) {
  const [toast, setToast]   = useState(null);
  const opacity             = useRef(new Animated.Value(0)).current;
  const timerRef            = useRef(null);
  const insets              = useSafeAreaInsets();

  const show = useCallback(({ title, message, type = 'info' }) => {
    // Cancel any in-flight timer / animation
    if (timerRef.current) clearTimeout(timerRef.current);
    opacity.stopAnimation();

    setToast({ title, message, type });

    // Fade in
    Animated.timing(opacity, {
      toValue:        1,
      duration:       FADE_MS,
      useNativeDriver: true,
    }).start();

    // Fade out after DURATION
    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue:        0,
        duration:       FADE_MS,
        useNativeDriver: true,
      }).start(() => {
        setToast(null);
        timerRef.current = null;
      });
    }, DURATION);
  }, [opacity]);

  // Sit above the floating tab bar (≈ 90 pt) + safe area bottom.
  const bottomOffset = Math.max(insets.bottom, 16) + 90;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}

      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            { backgroundColor: BG[toast.type] ?? BG.info, bottom: bottomOffset, opacity },
          ]}
        >
          <Text style={styles.title} numberOfLines={2}>{toast.title}</Text>
          {toast.message ? (
            <Text style={styles.message} numberOfLines={3}>{toast.message}</Text>
          ) : null}
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position:      'absolute',
    left:          SPACING.md,
    right:         SPACING.md,
    // On web, confine to the phone column (maxWidth 430 in App.js). Since the
    // toast is absolutely positioned inside ToastProvider which is inside the
    // phone View, this is already correct — no extra cap needed.
    borderRadius:  RADIUS.lg,
    padding:       SPACING.md,
    gap:           3,
    ...SHADOW.lg,
  },
  title: {
    fontFamily: FONT.semiBold,
    fontSize:   14,
    color:      COLORS.white,
    lineHeight: 20,
  },
  message: {
    fontFamily: FONT.regular,
    fontSize:   13,
    color:      'rgba(255,255,255,0.85)',
    lineHeight: 18,
  },
});
