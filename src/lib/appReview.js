// ─────────────────────────────────────────────────────────────────────────────
// App Store Review Prompt
//
// Uses Apple's native SKStoreReviewRequest via expo-store-review.
// We CANNOT build a custom star UI that submits to the store — Apple bans
// "review gating" (App Store Review Guidelines 5.6.1). This is the only
// compliant path. Apple controls the actual prompt display and limits it to
// ~3 times per user per 365 days automatically.
//
// Strategy:
//   - Fire after 5 minutes of active, authenticated session
//   - Only once per app install (tracked in AsyncStorage)
//   - Skip if already reviewed this version
//   - iOS only (Android would need a separate Play Store implementation)
// ─────────────────────────────────────────────────────────────────────────────

import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const STORAGE_KEY = '@found/review_prompted_version';

/**
 * Returns true if we should show the review prompt:
 *  1. iOS only
 *  2. Device supports StoreReview
 *  3. We haven't prompted for this app version yet
 */
async function shouldPrompt() {
  if (Platform.OS !== 'ios') return false;

  const isAvailable = await StoreReview.isAvailableAsync();
  if (!isAvailable) return false;

  const currentVersion = Constants.expoConfig?.version ?? '1.0.0';
  const lastPromptedVersion = await AsyncStorage.getItem(STORAGE_KEY);

  // Prompt once per version. If we ship a major update we can prompt again.
  return lastPromptedVersion !== currentVersion;
}

/**
 * Mark that we've prompted for the current version so we don't ask again.
 */
async function markPrompted() {
  const currentVersion = Constants.expoConfig?.version ?? '1.0.0';
  await AsyncStorage.setItem(STORAGE_KEY, currentVersion);
}

/**
 * Attempt to show the native App Store review sheet.
 * Safe to call — will no-op if conditions aren't met.
 */
export async function requestAppReview() {
  try {
    const ok = await shouldPrompt();
    if (!ok) return;

    await markPrompted();
    await StoreReview.requestReview();
  } catch (err) {
    // Never crash the app over a review prompt
    console.warn('[AppReview] requestReview failed silently:', err?.message);
  }
}

/**
 * For testing only — clears the "already prompted" flag so you can
 * trigger the prompt again in development.
 */
export async function resetReviewPromptForTesting() {
  await AsyncStorage.removeItem(STORAGE_KEY);
  console.log('[AppReview] Review prompt flag cleared');
}
