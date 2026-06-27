// ─────────────────────────────────────────────────────────────────────────────
// useAppReview hook
//
// Drop into any component that's mounted when the user is authenticated
// and actively using the app. Starts a 5-minute countdown. If the user
// is still in the app when it fires, triggers the native review prompt.
//
// Usage:
//   useAppReview({ enabled: !!user });
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { requestAppReview } from './appReview';

const REVIEW_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @param {{ enabled: boolean }} options
 *   enabled — set to true when the user is authenticated and past onboarding
 */
export function useAppReview({ enabled = false } = {}) {
  const timerRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!enabled) return;

    // Don't start a new timer if one is already running
    if (timerRef.current) return;

    // Start the 5-minute countdown
    timerRef.current = setTimeout(() => {
      // Only fire if the app is still in the foreground
      if (appStateRef.current === 'active') {
        requestAppReview();
      }
      timerRef.current = null;
    }, REVIEW_DELAY_MS);

    // Track app state so we don't prompt while the app is backgrounded
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;

      // If app goes to background, cancel the timer — we don't want to
      // prompt on re-open, that feels intrusive
      if (nextState !== 'active' && timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      subscription.remove();
    };
  }, [enabled]);
}
