#!/usr/bin/env node
/*
 * backfill-locations.js
 * ---------------------
 * Geocodes every profile that has a city/state but no PostGIS `location`,
 * so the mile-radius filter (migration 0029) can place them on the map.
 *
 * Without this, pre-existing seed/test profiles vanish from any radius-
 * filtered Discover feed — you can't measure distance to a profile with
 * no location. New users are already geocoded at the end of onboarding;
 * this is a one-time cleanup for older rows.
 *
 * Idempotent: only touches rows where `location` IS NULL. Safe to re-run.
 * Requires Node 18+ (built-in fetch). No npm install needed.
 *
 * Run migration 0029 FIRST — this script calls the set_location_by_id RPC
 * that 0029 creates.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
 *     node scripts/backfill-locations.js
 *
 * NEVER commit the service-role key. Only export it inline.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SR) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

// Nominatim usage policy: identify yourself, max ~1 req/sec.
const USER_AGENT = 'FOUND-Community/0.1 (hello@found.community)';
const RATE_LIMIT_MS = 1100;

const hdrs = (extra = {}) => ({
  apikey: SR,
  Authorization: `Bearer ${SR}`,
  'Content-Type': 'application/json',
  ...extra,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "City, State" -> { lat, lng } via OpenStreetMap Nominatim. null = no match.
async function geocode(query) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const lat = parseFloat(arr[0].lat);
  const lng = parseFloat(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function main() {
  // Profiles that have a city but no geocoded location.
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles` +
      `?select=id,full_name,city,state&location=is.null&city=not.is.null`,
    { headers: hdrs() }
  );
  if (!listRes.ok) {
    console.error('Failed to list profiles:', listRes.status, await listRes.text());
    process.exit(1);
  }
  const rows = await listRes.json();
  console.log(`${rows.length} profile(s) need geocoding.\n`);
  if (rows.length === 0) return;

  let ok = 0;
  let miss = 0;
  let fail = 0;

  for (const r of rows) {
    const who = r.full_name || r.id;
    const query = [r.city, r.state].filter(Boolean).join(', ');
    try {
      const hit = await geocode(query);
      if (!hit) {
        miss++;
        console.log(`  ?  ${who} — no match for "${query}"`);
      } else {
        const upRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_location_by_id`, {
          method: 'POST',
          headers: hdrs(),
          body: JSON.stringify({ p_id: r.id, p_lat: hit.lat, p_lng: hit.lng }),
        });
        if (!upRes.ok) {
          fail++;
          console.log(`  x  ${who} — update failed ${upRes.status} ${await upRes.text()}`);
        } else {
          ok++;
          console.log(
            `  ok ${who} — ${query} -> ${hit.lat.toFixed(4)}, ${hit.lng.toFixed(4)}`
          );
        }
      }
    } catch (e) {
      fail++;
      console.log(`  x  ${who} — ${e.message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\nDone. ${ok} geocoded, ${miss} no-match, ${fail} failed.`);
  if (miss > 0) {
    console.log('No-match rows usually have a vague or misspelled city — fix the');
    console.log('city/state on those profiles and re-run.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
