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

// ─────────────────────────────────────────────────────────────────────────
// geocodeZip(zip)
//
// Resolves a 5-digit US ZIP to { lat, lng, city, state } via Zippopotam.us —
// the same free service the signup form uses for ZIP → City/State auto-fill.
// A ZIP maps to a single exact centroid, so this is more reliable than the
// "City, State" Nominatim path (no ambiguous duplicate-city matches) and is
// not rate-limited for our volume.
//
// This is the canonical way location is captured: once, from the ZIP entered
// at signup. The user never types a location anywhere else.
//
// Returns { lat, lng, city, state, error }. A ZIP that simply isn't found is
// NOT an error — it returns null coords with error: null.
// ─────────────────────────────────────────────────────────────────────────
export async function geocodeZip(zip) {
  const z = (zip || '').trim();
  if (!/^\d{5}$/.test(z)) {
    return { lat: null, lng: null, city: null, state: null, error: null };
  }

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${z}`);
    // 404 = ZIP not in the dataset. Treat as "no match", not a hard failure.
    if (res.status === 404) {
      return { lat: null, lng: null, city: null, state: null, error: null };
    }
    if (!res.ok) {
      return { error: new Error(`ZIP lookup returned ${res.status}`) };
    }
    const data  = await res.json();
    const place = data?.places?.[0];
    if (!place) {
      return { lat: null, lng: null, city: null, state: null, error: null };
    }
    const lat = parseFloat(place.latitude);
    const lng = parseFloat(place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: new Error('ZIP lookup returned invalid coordinates') };
    }
    return {
      lat,
      lng,
      city:  place['place name'] || null,
      state: place['state abbreviation'] || null,
      error: null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}
