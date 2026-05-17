// ─────────────────────────────────────────────────────────────────────────
// geocode.js
//
// Turns a "City, State" string into { lat, lng } using OpenStreetMap's
// Nominatim service. Free, no API key, but bound by usage policy:
//   - max 1 req/sec
//   - must identify yourself in User-Agent
//   - results may be cached server-side for ~24h
//
// For an MVP / personal use this is plenty. When we scale we should:
//   (a) move to a dedicated geocoder (Google / Mapbox / Geoapify), OR
//   (b) proxy through a Supabase Edge Function with our own cache.
//
// Returns { lat, lng, displayName } on success, or { error } on failure.
// Returns { lat: null, lng: null } if the query is empty (not an error —
// the caller should clear the profile's location instead of throwing).
// ─────────────────────────────────────────────────────────────────────────

const USER_AGENT = 'FOUND-Community/0.1 (hello@found.community)';

export async function geocode(query) {
  const q = (query || '').trim();
  if (!q) return { lat: null, lng: null, displayName: null, error: null };

  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q=' +
    encodeURIComponent(q);

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      return { error: new Error(`Geocoder returned ${res.status}`) };
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return { lat: null, lng: null, displayName: null, error: null };
    }
    const hit = arr[0];
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: new Error('Geocoder returned invalid coordinates') };
    }
    return { lat, lng, displayName: hit.display_name ?? null, error: null };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}
