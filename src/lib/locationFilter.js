// ─────────────────────────────────────────────────────────────────────────
// locationFilter.js
//
// Persistence + helpers for the Discover location filter.
//
// Shape stored under AsyncStorage key `found:locationFilter`:
//   { mode: 'anywhere', radiusMi }   → no override; feed uses Settings radius
//   { mode: 'self',     radiusMi }   → hard radius centered on my location
//
// Helpers expose the filter as RPC args ({ p_lat, p_lng, p_radius_mi }) so the
// caller doesn't need to know the mode logic.
// ─────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'found:locationFilter';

export const DEFAULT_RADIUS = 25;
export const RADIUS_OPTIONS = [5, 10, 25, 50, 100, 250];

export const DEFAULT_FILTER = { mode: 'anywhere', radiusMi: DEFAULT_RADIUS };

// Supported modes. Anything else (e.g. a legacy mode from an older build)
// is migrated back to 'anywhere' on load.
const VALID_MODES = ['anywhere', 'self', 'custom'];

export async function loadFilter() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_FILTER;
    const parsed = JSON.parse(raw);
    if (!parsed?.mode) return DEFAULT_FILTER;
    // Migrate / reject unsupported modes (legacy 'city' search).
    if (!VALID_MODES.includes(parsed.mode)) {
      return { mode: 'anywhere', radiusMi: DEFAULT_RADIUS };
    }
    if (!RADIUS_OPTIONS.includes(parsed.radiusMi)) {
      parsed.radiusMi = DEFAULT_RADIUS;
    }
    if (parsed.mode === 'custom') {
      // Custom requires geocoded coords — fall back if they're missing.
      if (!parsed.lat || !parsed.lng) return DEFAULT_FILTER;
      return {
        mode: 'custom',
        radiusMi: parsed.radiusMi,
        lat: parsed.lat,
        lng: parsed.lng,
        displayName: parsed.displayName || '',
      };
    }
    return { mode: parsed.mode, radiusMi: parsed.radiusMi };
  } catch {
    return DEFAULT_FILTER;
  }
}

export async function saveFilter(filter) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(filter));
  } catch {
    // non-fatal — filter just won't persist
  }
}

/**
 * Turn a filter into RPC override args.
 *   - mode 'anywhere': no override → RPC falls back to the saved Settings radius
 *   - mode 'self':     pass `selfLocation` lat/lng if available, else no override
 *
 * `selfLocation` is { lat, lng } — the current user's geocoded coords. Optional.
 */
export function filterToRpcArgs(filter, selfLocation = null) {
  const fallback = { p_lat: null, p_lng: null, p_radius_mi: null };
  if (!filter) return fallback;

  const radius = filter.radiusMi ?? DEFAULT_RADIUS;

  switch (filter.mode) {
    case 'self':
      if (!selfLocation?.lat || !selfLocation?.lng) return fallback;
      return { p_lat: selfLocation.lat, p_lng: selfLocation.lng, p_radius_mi: radius, p_anywhere: false };
    case 'custom':
      if (!filter.lat || !filter.lng) return fallback;
      return { p_lat: filter.lat, p_lng: filter.lng, p_radius_mi: radius, p_anywhere: false };
    case 'anywhere':
    default:
      // p_anywhere: true tells the RPC to bypass all geo filters and sort by
      // score + mutual connections instead of distance.
      return { p_lat: null, p_lng: null, p_radius_mi: null, p_anywhere: true };
  }
}

/**
 * Human label for the pill at the top of Discover.
 */
export function filterLabel(filter) {
  if (!filter) return 'Anywhere';
  const r = filter.radiusMi ?? DEFAULT_RADIUS;
  switch (filter.mode) {
    case 'self':   return `Near Me · ${r} mi`;
    case 'custom': return filter.displayName ? `${filter.displayName} · ${r} mi` : `Custom · ${r} mi`;
    case 'anywhere':
    default:       return 'Anywhere';
  }
}
