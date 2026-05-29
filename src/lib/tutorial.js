import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'found:tutorial_pending';

/** Called at the end of onboarding — arms the tutorial for the next HomeScreen mount. */
export async function markTutorialPending() {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch (e) {
    console.warn('[tutorial] markTutorialPending failed', e?.message);
  }
}

/**
 * Called once when HomeScreen mounts.
 * Returns true (and clears the flag) if the tutorial should fire.
 */
export async function checkAndClearTutorial() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) {
      await AsyncStorage.removeItem(KEY);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[tutorial] checkAndClearTutorial failed', e?.message);
    return false;
  }
}
