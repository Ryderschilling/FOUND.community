// ─────────────────────────────────────────────────────────────────────────
// locationFilter.js
//
// Persistence + helpers for the Discover location filter.
//
// Shape stored under AsyncStorage key `found:locationFilter`:
//   { mode: 'anywhere',  radiusMi }
//   { mode: 'self',      radiusMi }
//   { mode: 'city',      cityText, lat, lng, radiusMi }
//
// Helpers expose the filter as RPC args ({ lat, lng, radius_mi }) so the
// caller doesn't need to know the mode logic.
// ─────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'found:locationFilter';

export const DEFAULT_RADIUS = 25;
export const RADIUS_OPTIONS = [5, 10, 25, 50, 100, 250];

export const DEFAULT_FILTER = { mode: 'anywhere', radiusMi: DEFAULT_RADIUS };

export async function loadFilter() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_FILTER;
    const parsed = JSON.parse(raw);
    // Backstop against malformed/legacy values
    if (!parsed?.mode) return DEFAULT_FILTER;
    if (!RADIUS_OPTIONS.includes(parsed.radiusMi)) {
      parsed.radiusMi = DEFAULT_RADIUS;
    }
    return parsed;
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
 *   - mode 'anywhere': no override (returns nulls → RPC returns everyone)
 *   - mode 'self':     pass `selfLocation` lat/lng if available, else fall back to no override
 *   - mode 'city':     pass the saved lat/lng
 *
 * `selfLocation` is { lat, lng } — caller passes the current user's profile
 * geocoded coords (parsed from the geography point). Optional.
 */
export function filterToRpcArgs(filter, selfLocation = null) {
  const fallback = { p_lat: null, p_lng: null, p_radius_mi: null };
  if (!filter) return fallback;

  const radius = filter.radiusMi ?? DEFAULT_RADIUS;

  switch (filter.mode) {
    case 'anywhere':
      return fallback;
    case 'self':
      if (!selfLocation?.lat || !selfLocation?.lng) return fallback;
      return { p_lat: selfLocation.lat, p_lng: selfLocation.lng, p_radius_mi: radius };
    case 'city':
      if (filter.lat == null || filter.lng == null) return fallback;
      return { p_lat: filter.lat, p_lng: filter.lng, p_radius_mi: radius };
    default:
      return fallback;
  }
}

/**
 * Human label for the pill at the top of Discover.
 */
export function filterLabel(filter) {
  if (!filter) return 'Anywhere';
  const r = filter.radiusMi ?? DEFAULT_RADIUS;
  switch (filter.mode) {
    case 'anywhere': return 'Anywhere';
    case 'self':     return `Near Me · ${r} mi`;
    case 'city':     return `${filter.cityText || 'Custom'} · ${r} mi`;
    default:         return 'Anywhere';
  }
}
