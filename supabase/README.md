# FOUND.community — Supabase Setup

This is the 10-minute path from zero to a working backend. Do it once; commit the env keys to your password manager (NOT to git).

## 1. Create the project

1. Go to https://supabase.com → New Project.
2. **Org**: create one called `found-community` (or use existing). Add Sam as a member later.
3. **Project name**: `found-prod` (we'll add `found-dev` later if needed).
4. **Region**: `us-east-1` (closest to 30A; lowest latency for Florida users).
5. **Database password**: generate a strong one and save to 1Password/Bitwarden.
6. Wait ~2 min for provisioning.

## 2. Capture the keys

From Settings → API copy these into your `.env` (NEVER commit):

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=ey...
```

The **service role key** is NEVER used in the mobile app. Only store it server-side (cloud functions, scripts).

## 3. Enable PostGIS

Database → Extensions → search `postgis` → toggle on.
(The migration also runs `create extension if not exists postgis`, but enabling it via UI is the cleanest path on a fresh project.)

## 4. Run the migrations

SQL editor → New query → paste each file in order:

1. `migrations/0001_init.sql` — schema, indexes, RLS, functions
2. `migrations/0002_seed_taxonomies.sql` — life stages, activities, goals, values, churches

Hit RUN on each. Both are idempotent — safe to re-run during dev.

## 5. Configure auth

Authentication → Providers:
- **Email** — enable. Disable "Confirm email" only in dev. Re-enable for prod.
- **Apple** — required for iOS App Store. Set up later (needs Apple Developer account).
- **Google** — recommended. Add via Authentication → Providers → Google.

Authentication → URL Configuration:
- Site URL: `https://found.community`
- Redirect URLs:
  - `https://found.community/auth/callback`
  - `foundapp://auth/callback` (the Expo deep link)
  - `exp://*` (Expo Go dev)

## 6. Storage buckets

Storage → New bucket:
- `profile-photos` — public read, authenticated write
- `group-photos` — public read, authenticated write (admins only via RLS — handled in app)

For each, Policies → Add policy:
```sql
-- profile-photos: only the owning user can upload/update
create policy "users upload own profile photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
```

## 7. Verify

Run this in SQL editor — should return ~13 activities, ~9 life stages, ~4 churches:

```sql
select (select count(*) from public.activities)     as activities,
       (select count(*) from public.life_stages)    as life_stages,
       (select count(*) from public.community_goals)as goals,
       (select count(*) from public.family_values)  as values,
       (select count(*) from public.churches)       as churches;
```

## 8. Hand keys to the Expo app

Drop these into `/found-app/.env` (already in `.gitignore`):

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=ey...
```

Restart Expo (`npm start -- --clear`) and the app is live.

---

## Schema cheatsheet

- `profiles` extends `auth.users` 1:1, auto-created on signup via trigger.
- `profile_activities`, `profile_goals`, `profile_values` — M:M to the taxonomy tables.
- `photos` — polymorphic, owns `profile` OR `group` photos (5–10 per Meeting 1 spec).
- `groups` + `group_members` (+ `group_activities` tags) + denormalized `member_count`.
- `threads` + `thread_participants` + `messages` — supports direct AND group chats.
- `connections` — like/skip/block between profiles.
- `match_score(viewer, candidate)` — function returning 0–100. Call via the `top_matches()` RPC.
- All user tables have RLS. The app's anon key cannot bypass it. Service role can.

## Things deliberately deferred

- Posts/feed (Sam wants this Phase 2; not in MVP).
- Push notifications — Expo Notifications wire-up. Adding a `device_tokens` table later.
- Church B2B subscriptions — separate `church_subscriptions` table when we get to Stripe.
- Moderation/reporting — `reports` table + admin tools before App Store submission.
