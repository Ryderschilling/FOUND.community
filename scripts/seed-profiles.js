#!/usr/bin/env node
/*
 * seed-profiles.js
 * ----------------
 * Inserts a deterministic set of fake profiles for development.
 * Idempotent: re-running upserts existing seeds (looked up by email).
 *
 * Requires Node 18+ for built-in fetch. NO npm install needed.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
 *     node scripts/seed-profiles.js
 *
 * NEVER commit the service-role key. Only export it inline.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SR) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────
const SEED_PASSWORD = 'Seed!FoundDev2026'; // long enough; will never be used to sign in

const hdrs = (extra = {}) => ({
  apikey: SR,
  Authorization: `Bearer ${SR}`,
  'Content-Type': 'application/json',
  ...extra,
});

async function listUserByEmail(email) {
  // Auth Admin list endpoint supports filter by email
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent('email.eq.' + email)}`,
    { headers: hdrs() }
  );
  if (!res.ok) return null;
  const j = await res.json();
  return (j.users && j.users[0]) || null;
}

async function createUser({ email, full_name }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createUser(${email}) -> ${res.status} ${body}`);
  }
  return await res.json();
}

async function getOrCreateUser(seed) {
  const existing = await listUserByEmail(seed.email);
  if (existing) return existing;
  return await createUser(seed);
}

async function getChurchIdByName(name) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/churches?name=eq.${encodeURIComponent(name)}&select=id&limit=1`,
    { headers: hdrs() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.id ?? null;
}

async function patchProfile(userId, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...hdrs(), Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`patchProfile(${userId}) -> ${res.status} ${await res.text()}`);
  }
}

async function replaceM2M(table, userId, fkCol, ids) {
  // Delete existing rows for this user, then insert new ones
  const delRes = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?profile_id=eq.${userId}`,
    { method: 'DELETE', headers: hdrs() }
  );
  if (!delRes.ok && delRes.status !== 404) {
    throw new Error(`delete ${table} -> ${delRes.status} ${await delRes.text()}`);
  }
  if (!ids || !ids.length) return;
  const rows = ids.map((x) => ({ profile_id: userId, [fkCol]: x }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...hdrs(), Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`insert ${table} -> ${res.status} ${await res.text()}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// SEED DATA
// 25 profiles across 30A FL, Destin FL, Pensacola FL, Nashville TN, Atlanta GA.
// Life stages + activities chosen to give every signup at least a few matches.
// ─────────────────────────────────────────────────────────────────────
const SEEDS = [
  // ─── 30A area ────────────────────────────────────────────────────────
  {
    email: 'seed.jake.m@found.local', handle: 'seed.jake_m',
    full_name: 'Jake Mitchell', bio: 'Florida native, weekend surfer, Sunday Bible study leader.',
    life_stage: 'single', school_type: null, love_language: 'quality-time',
    is_initiator: true, is_outgoing: true,
    city: 'Santa Rosa Beach', state: 'FL', church_name: 'Bayside Church',
    activities: ['surfing', 'beach', 'sports', 'fitness'],
    goals: ['couple-friends', 'bible-study', 'activity-partners'],
    values: ['no-smoking', 'healthy-eating'],
  },
  {
    email: 'seed.caroline.h@found.local', handle: 'seed.caroline_h',
    full_name: 'Caroline Henley', bio: 'Coffee in the morning, beach in the afternoon. Looking for solid girlfriends.',
    life_stage: 'single', school_type: null, love_language: 'words',
    is_initiator: false, is_outgoing: true,
    city: 'Santa Rosa Beach', state: 'FL', church_name: 'Seacoast Community Church',
    activities: ['beach', 'fitness', 'dining', 'concerts'],
    goals: ['couple-friends', 'bible-study', 'prayer'],
    values: ['no-cussing', 'healthy-eating'],
  },
  {
    email: 'seed.tyler.b@found.local', handle: 'seed.tyler_b',
    full_name: 'Tyler Brooks', bio: 'Sales by day, pickup soccer & live music by night.',
    life_stage: 'single', school_type: null, love_language: 'acts-of-service',
    is_initiator: true, is_outgoing: true,
    city: 'Watersound', state: 'FL', church_name: 'CrossPoint Church',
    activities: ['sports', 'dining', 'concerts', 'fitness'],
    goals: ['activity-partners', 'networking', 'young-adult'],
    values: ['no-smoking'],
  },
  {
    email: 'seed.sarah.r@found.local', handle: 'seed.sarah_r',
    full_name: 'Sarah Reeves', bio: 'College senior. Worship team, beach walks, way too much coffee.',
    life_stage: 'student', school_type: null, love_language: 'quality-time',
    is_initiator: false, is_outgoing: false,
    city: 'Santa Rosa Beach', state: 'FL', church_name: 'Bayside Church',
    activities: ['beach', 'music', 'concerts', 'dining'],
    goals: ['bible-study', 'mentorship', 'young-adult'],
    values: ['no-alcohol', 'no-cussing'],
  },
  {
    email: 'seed.andrew.w@found.local', handle: 'seed.andrew_w',
    full_name: 'Andrew Watts', bio: 'Newlywed. Wife Claire & I host dinners; come hungry.',
    life_stage: 'married-no-kids', school_type: null, love_language: 'physical-touch',
    is_initiator: true, is_outgoing: true,
    city: 'Seaside', state: 'FL', church_name: 'Seacoast Community Church',
    activities: ['dining', 'hiking', 'beach', 'concerts'],
    goals: ['couple-friends', 'bible-study'],
    values: ['family-worship'],
  },
  {
    email: 'seed.marcus.p@found.local', handle: 'seed.marcus_p',
    full_name: 'Marcus Pena', bio: 'Crossfit, finance, faith. Wife is a designer, both 30 and figuring it out.',
    life_stage: 'married-no-kids', school_type: null, love_language: 'acts-of-service',
    is_initiator: true, is_outgoing: false,
    city: 'Santa Rosa Beach', state: 'FL', church_name: 'Bayside Church',
    activities: ['fitness', 'sports', 'dining', 'hiking'],
    goals: ['couple-friends', 'accountability', 'networking'],
    values: ['no-alcohol', 'healthy-eating'],
  },
  {
    email: 'seed.lauren.h@found.local', handle: 'seed.lauren_h',
    full_name: 'Lauren Hayes', bio: 'Mom of 2 under 3. Beach playdates & adult conversation welcome.',
    life_stage: 'married-babies', school_type: 'public', love_language: 'words',
    is_initiator: false, is_outgoing: true,
    city: 'Santa Rosa Beach', state: 'FL', church_name: 'Seacoast Community Church',
    activities: ['beach', 'playgrounds', 'dining'],
    goals: ['mom-friends', 'family-community', 'prayer'],
    values: ['family-worship', 'limit-phones', 'healthy-eating'],
  },
  {
    email: 'seed.ben.c@found.local', handle: 'seed.ben_c',
    full_name: 'Ben Cole', bio: 'Dad. Boys are 1 and 3. Sundays = church then beach.',
    life_stage: 'married-babies', school_type: 'public', love_language: 'quality-time',
    is_initiator: true, is_outgoing: true,
    city: 'Watersound', state: 'FL', church_name: 'CrossPoint Church',
    activities: ['sports', 'beach', 'playgrounds', 'fitness'],
    goals: ['couple-friends', 'family-community'],
    values: ['family-worship', 'limit-phones'],
  },
  {
    email: 'seed.rachel.d@found.local', handle: 'seed.rachel_d',
    full_name: 'Rachel Davies', bio: 'Kids 6 and 9. Trying to raise them without screens in their faces.',
    life_stage: 'married-young', school_type: 'christian', love_language: 'acts-of-service',
    is_initiator: false, is_outgoing: false,
    city: 'Santa Rosa Beach', state: 'FL', church_name: 'Bayside Church',
    activities: ['beach', 'playgrounds', 'hiking', 'dining'],
    goals: ['family-community', 'prayer', 'mom-friends'],
    values: ['family-worship', 'limit-phones', 'no-cussing'],
  },
  {
    email: 'seed.mark.d@found.local', handle: 'seed.mark_d',
    full_name: 'Mark Davies', bio: 'Husband, two kids, run my own contracting biz on 30A.',
    life_stage: 'married-young', school_type: 'christian', love_language: 'physical-touch',
    is_initiator: true, is_outgoing: false,
    city: 'Santa Rosa Beach', state: 'FL', church_name: 'Bayside Church',
    activities: ['hiking', 'fitness', 'beach', 'hunting'],
    goals: ['family-community', 'accountability', 'mentorship'],
    values: ['family-worship', 'no-cussing'],
  },
  {
    email: 'seed.ethan.h@found.local', handle: 'seed.ethan_h',
    full_name: 'Ethan Hill', bio: 'Teens at home. Mostly just trying to not screw it up.',
    life_stage: 'married-teens', school_type: 'public', love_language: 'words',
    is_initiator: false, is_outgoing: false,
    city: 'Inlet Beach', state: 'FL', church_name: 'Bayside Church',
    activities: ['fitness', 'hiking', 'hunting', 'dining'],
    goals: ['family-community', 'mentorship', 'accountability'],
    values: ['no-cussing', 'family-worship'],
  },

  // ─── Destin / Niceville ────────────────────────────────────────────
  {
    email: 'seed.megan.t@found.local', handle: 'seed.megan_t',
    full_name: 'Megan Tate', bio: 'PT, ultra runner, future missionary. Looking for accountability + community.',
    life_stage: 'single', school_type: null, love_language: 'quality-time',
    is_initiator: true, is_outgoing: false,
    city: 'Destin', state: 'FL', church_name: 'Calvary Chapel',
    activities: ['hiking', 'fitness', 'dining', 'camping'],
    goals: ['accountability', 'bible-study', 'mentorship'],
    values: ['no-alcohol', 'healthy-eating'],
  },
  {
    email: 'seed.caleb.r@found.local', handle: 'seed.caleb_r',
    full_name: 'Caleb Reed', bio: 'Mid-20s, music & water. Plays at our Sunday night service sometimes.',
    life_stage: 'single', school_type: null, love_language: 'physical-touch',
    is_initiator: true, is_outgoing: true,
    city: 'Destin', state: 'FL', church_name: 'Calvary Chapel',
    activities: ['surfing', 'music', 'beach', 'concerts'],
    goals: ['young-adult', 'bible-study', 'activity-partners'],
    values: ['no-smoking'],
  },
  {
    email: 'seed.jamie.p@found.local', handle: 'seed.jamie_p',
    full_name: 'Jamie Park', bio: 'Mom of 2 elementary kids. Homeschool curious.',
    life_stage: 'married-young', school_type: 'homeschool', love_language: 'acts-of-service',
    is_initiator: false, is_outgoing: true,
    city: 'Niceville', state: 'FL', church_name: 'CrossPoint Church',
    activities: ['playgrounds', 'beach', 'dining', 'music'],
    goals: ['mom-friends', 'family-community'],
    values: ['family-worship', 'limit-phones'],
  },
  {
    email: 'seed.daniel.p@found.local', handle: 'seed.daniel_p',
    full_name: 'Daniel Pham', bio: 'Eng manager remote. Anna and I love hosting + hiking.',
    life_stage: 'married-no-kids', school_type: null, love_language: 'quality-time',
    is_initiator: false, is_outgoing: false,
    city: 'Niceville', state: 'FL', church_name: 'CrossPoint Church',
    activities: ['hiking', 'dining', 'concerts', 'camping'],
    goals: ['couple-friends', 'networking'],
    values: ['no-smoking', 'healthy-eating'],
  },

  // ─── Pensacola ───────────────────────────────────────────────────
  {
    email: 'seed.olivia.b@found.local', handle: 'seed.olivia_b',
    full_name: 'Olivia Banks', bio: 'Worship leader, marketing day job. Big on community.',
    life_stage: 'single', school_type: null, love_language: 'words',
    is_initiator: false, is_outgoing: true,
    city: 'Pensacola', state: 'FL', church_name: null,
    activities: ['music', 'beach', 'dining', 'concerts'],
    goals: ['bible-study', 'young-adult', 'prayer'],
    values: ['no-alcohol', 'no-cussing'],
  },
  {
    email: 'seed.trevor.n@found.local', handle: 'seed.trevor_n',
    full_name: 'Trevor Nash', bio: 'Surf instructor. Faith, fitness, fish tacos.',
    life_stage: 'single', school_type: null, love_language: 'acts-of-service',
    is_initiator: true, is_outgoing: true,
    city: 'Pensacola', state: 'FL', church_name: null,
    activities: ['surfing', 'fitness', 'sports', 'beach'],
    goals: ['activity-partners', 'young-adult', 'accountability'],
    values: ['no-smoking', 'healthy-eating'],
  },
  {
    email: 'seed.bethany.c@found.local', handle: 'seed.bethany_c',
    full_name: 'Bethany Cole', bio: 'Mom of 3 elementary. Music teacher. Coffee snob.',
    life_stage: 'married-young', school_type: 'classical', love_language: 'words',
    is_initiator: false, is_outgoing: true,
    city: 'Pensacola', state: 'FL', church_name: null,
    activities: ['music', 'playgrounds', 'beach', 'dining'],
    goals: ['mom-friends', 'family-community', 'prayer'],
    values: ['family-worship', 'limit-phones', 'healthy-eating'],
  },

  // ─── Nashville ──────────────────────────────────────────────────
  {
    email: 'seed.mason.w@found.local', handle: 'seed.mason_w',
    full_name: 'Mason Wright', bio: 'Songwriter. Mid-20s. East Nash. Looking for actual friends, not industry contacts.',
    life_stage: 'single', school_type: null, love_language: 'quality-time',
    is_initiator: true, is_outgoing: false,
    city: 'Nashville', state: 'TN', church_name: null,
    activities: ['music', 'concerts', 'dining', 'hiking'],
    goals: ['young-adult', 'bible-study', 'networking'],
    values: ['no-smoking'],
  },
  {
    email: 'seed.emma.l@found.local', handle: 'seed.emma_l',
    full_name: 'Emma Lin', bio: 'PA student, hiker, hates small talk, loves real conversation.',
    life_stage: 'single', school_type: null, love_language: 'quality-time',
    is_initiator: false, is_outgoing: false,
    city: 'Nashville', state: 'TN', church_name: null,
    activities: ['fitness', 'hiking', 'music', 'camping'],
    goals: ['bible-study', 'accountability', 'young-adult'],
    values: ['no-alcohol', 'healthy-eating'],
  },
  {
    email: 'seed.cole.h@found.local', handle: 'seed.cole_h',
    full_name: 'Cole Henley', bio: 'New dad. Engineering team lead. Trying to keep weekends sacred.',
    life_stage: 'married-babies', school_type: 'public', love_language: 'physical-touch',
    is_initiator: false, is_outgoing: false,
    city: 'Nashville', state: 'TN', church_name: null,
    activities: ['dining', 'hiking', 'music', 'playgrounds'],
    goals: ['couple-friends', 'family-community'],
    values: ['family-worship', 'limit-phones'],
  },
  {
    email: 'seed.sophia.r@found.local', handle: 'seed.sophia_r',
    full_name: 'Sophia Reed', bio: 'Mom of 2 kids 4 & 7. Piano teacher.',
    life_stage: 'married-young', school_type: 'christian', love_language: 'words',
    is_initiator: false, is_outgoing: true,
    city: 'Nashville', state: 'TN', church_name: null,
    activities: ['music', 'playgrounds', 'dining', 'concerts'],
    goals: ['mom-friends', 'family-community'],
    values: ['family-worship', 'no-cussing'],
  },

  // ─── Atlanta ────────────────────────────────────────────────────
  {
    email: 'seed.grace.b@found.local', handle: 'seed.grace_b',
    full_name: 'Grace Bell', bio: 'Kids are grown. Finally have time to read again.',
    life_stage: 'empty-nester', school_type: null, love_language: 'words',
    is_initiator: false, is_outgoing: false,
    city: 'Atlanta', state: 'GA', church_name: null,
    activities: ['dining', 'hiking', 'concerts'],
    goals: ['mentorship', 'bible-study', 'couple-friends'],
    values: ['family-worship'],
  },
  {
    email: 'seed.patrick.h@found.local', handle: 'seed.patrick_h',
    full_name: 'Patrick Hayes', bio: 'Retired Navy. Wife and I are looking for couple friends post-kids.',
    life_stage: 'empty-nester', school_type: null, love_language: 'acts-of-service',
    is_initiator: true, is_outgoing: true,
    city: 'Atlanta', state: 'GA', church_name: null,
    activities: ['dining', 'hiking', 'fitness', 'concerts'],
    goals: ['couple-friends', 'mentorship'],
    values: ['no-smoking', 'no-cussing'],
  },
  {
    email: 'seed.david.c@found.local', handle: 'seed.david_c',
    full_name: 'David Cole', bio: '5 grandkids. Still teaching Sunday school.',
    life_stage: 'grandparent', school_type: null, love_language: 'acts-of-service',
    is_initiator: false, is_outgoing: true,
    city: 'Atlanta', state: 'GA', church_name: null,
    activities: ['dining', 'hiking', 'fitness'],
    goals: ['mentorship', 'bible-study'],
    values: ['family-worship'],
  },
];

// ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding ${SEEDS.length} profiles against ${SUPABASE_URL}`);
  const churchCache = {};
  const churchNames = [...new Set(SEEDS.map((s) => s.church_name).filter(Boolean))];
  for (const name of churchNames) {
    churchCache[name] = await getChurchIdByName(name);
    if (!churchCache[name]) console.warn(`! church not found: ${name}`);
  }

  let ok = 0, fail = 0;
  for (const s of SEEDS) {
    try {
      const user = await getOrCreateUser(s);
      const churchId = s.church_name ? churchCache[s.church_name] : null;
      await patchProfile(user.id, {
        handle: s.handle,
        full_name: s.full_name,
        bio: s.bio,
        life_stage_id: s.life_stage,
        school_type_id: s.school_type,
        love_language_id: s.love_language,
        church_id: churchId,
        city: s.city,
        state: s.state,
        is_initiator: s.is_initiator,
        is_outgoing: s.is_outgoing,
        onboarding_complete: true,
        last_active_at: new Date().toISOString(),
      });
      await replaceM2M('profile_activities', user.id, 'activity_id', s.activities);
      await replaceM2M('profile_goals', user.id, 'goal_id', s.goals);
      await replaceM2M('profile_values', user.id, 'value_id', s.values);
      console.log(`  ✓ ${s.full_name.padEnd(22)} ${s.city}, ${s.state}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${s.full_name}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
  if (fail) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
